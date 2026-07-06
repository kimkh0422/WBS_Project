import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { isDevAuthBypass, DEV_BYPASS_USER_ID } from '../lib/devAuthBypass';
import { setRememberMe } from '../lib/authPersistence';
import { isLoginLockdownActive, LOGIN_LOCKDOWN_MESSAGE } from '../constants/loginLockdown';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  /** rememberMe=true면 세션을 localStorage에 저장(자동로그인 유지), false면 sessionStorage(브라우저 닫으면 로그아웃) */
  signInWithEmail: (email: string, password: string, rememberMe?: boolean) => Promise<{ error?: string }>;
  signUpWithEmail: (email: string, password: string, fullName: string) => Promise<{ error?: string }>;
  /** 회원가입 OTP(6자리) 검증. 성공 시 세션 발급되어 자동 로그인 */
  verifySignupOtp: (email: string, token: string) => Promise<{ error?: string }>;
  /** 비밀번호 재설정 OTP를 이메일로 발송 */
  requestPasswordResetOtp: (email: string) => Promise<{ error?: string }>;
  /** 비밀번호 재설정 OTP(6자리) 검증. 성공 시 임시 세션 발급되어 updatePassword 가능 */
  verifyPasswordResetOtp: (email: string, token: string) => Promise<{ error?: string }>;
  /** 현재 세션의 비밀번호 변경 (비밀번호 재설정 OTP 검증 직후 사용) */
  updatePassword: (newPassword: string) => Promise<{ error?: string }>;
  /** 회원가입 OTP 재발송 */
  resendSignupOtp: (email: string) => Promise<{ error?: string }>;
  signInWithOAuth: (provider: 'google' | 'github') => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * 비밀번호 재설정 진행 중 여부.
   * verifyOtp(recovery)가 성공하면 임시 세션이 발급되어 user가 set되지만,
   * 이 시점은 비밀번호 변경 단계로 가야 하지 메인 화면으로 진입하면 안 된다.
   * App.tsx가 이 플래그를 보고 LoginScreen을 계속 보여준다.
   */
  isResettingPassword: boolean;
  setIsResettingPassword: (v: boolean) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isResettingPassword, setIsResettingPasswordState] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('wbs-password-reset-in-progress') === '1';
    } catch {
      return false;
    }
  });
  const setIsResettingPassword = useCallback((v: boolean) => {
    setIsResettingPasswordState(v);
    try {
      if (v) sessionStorage.setItem('wbs-password-reset-in-progress', '1');
      else sessionStorage.removeItem('wbs-password-reset-in-progress');
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    // 개발 전용 로그인 우회(?devauth=1): 가짜 사용자를 주입해 로그인 화면을 건너뛴다.
    // 운영 빌드에서는 isDevAuthBypass()가 항상 false라 이 분기는 죽은 코드.
    if (isDevAuthBypass()) {
      // @gmtc.kr 도메인 → effectiveIsAdmin=true(isInternalCompanyEmail)로 주간보고 등 관리자 메뉴까지 모두 보이게 해
      // 미리보기에서 전체 UI를 검증할 수 있게 한다. (로컬 전용이라 실제 DB 권한과는 무관)
      const mockUser = {
        id: DEV_BYPASS_USER_ID,
        email: 'preview@gmtc.kr',
        app_metadata: {},
        user_metadata: { full_name: '미리보기 사용자' },
        aud: 'authenticated',
        created_at: '2026-01-01T00:00:00.000Z',
      } as unknown as User;
      setUser(mockUser);
      setSession({
        user: mockUser,
        access_token: 'dev-bypass',
        refresh_token: 'dev-bypass',
        token_type: 'bearer',
        expires_in: 3600,
      } as unknown as Session);
      setLoading(false);
      return;
    }

    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (isLoginLockdownActive() && session) {
        await supabase.auth.signOut();
        setSession(null);
        setUser(null);
      } else {
        setSession(session);
        setUser(session?.user ?? null);
      }
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (isLoginLockdownActive() && session) {
        void supabase.auth.signOut();
        setSession(null);
        setUser(null);
        return;
      }
      setSession(session);
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string, rememberMe = true) => {
    if (isLoginLockdownActive()) return { error: LOGIN_LOCKDOWN_MESSAGE };
    if (!supabase) return { error: 'Supabase not configured' };
    // 토큰 기록 전에 저장 위치를 먼저 결정해야 한다(storage 어댑터가 이 플래그를 읽음).
    setRememberMe(rememberMe);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message };
  }, []);

  const signUpWithEmail = useCallback(async (email: string, password: string, fullName: string) => {
    if (isLoginLockdownActive()) return { error: LOGIN_LOCKDOWN_MESSAGE };
    if (!supabase) return { error: 'Supabase not configured' };
    const trimmedName = fullName.trim();
    if (!trimmedName) return { error: '이름을 입력하세요.' };
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: trimmedName } },
    });
    return { error: error?.message };
  }, []);

  const verifySignupOtp = useCallback(async (email: string, token: string) => {
    if (isLoginLockdownActive()) return { error: LOGIN_LOCKDOWN_MESSAGE };
    if (!supabase) return { error: 'Supabase not configured' };
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'signup' });
    return { error: error?.message };
  }, []);

  const resendSignupOtp = useCallback(async (email: string) => {
    if (isLoginLockdownActive()) return { error: LOGIN_LOCKDOWN_MESSAGE };
    if (!supabase) return { error: 'Supabase not configured' };
    const { error } = await supabase.auth.resend({ email, type: 'signup' });
    return { error: error?.message };
  }, []);

  const requestPasswordResetOtp = useCallback(async (email: string) => {
    if (isLoginLockdownActive()) return { error: LOGIN_LOCKDOWN_MESSAGE };
    if (!supabase) return { error: 'Supabase not configured' };
    // resetPasswordForEmail는 메일 템플릿이 OTP({{ .Token }})를 사용하도록 설정되어
    // 있으면 6자리 코드를 메일로 발송한다.
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    return { error: error?.message };
  }, []);

  const verifyPasswordResetOtp = useCallback(async (email: string, token: string) => {
    if (isLoginLockdownActive()) return { error: LOGIN_LOCKDOWN_MESSAGE };
    if (!supabase) return { error: 'Supabase not configured' };
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'recovery' });
    return { error: error?.message };
  }, []);

  const updatePassword = useCallback(async (newPassword: string) => {
    if (isLoginLockdownActive()) return { error: LOGIN_LOCKDOWN_MESSAGE };
    if (!supabase) return { error: 'Supabase not configured' };
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    return { error: error?.message };
  }, []);

  const signInWithOAuth = useCallback(async (provider: 'google' | 'github') => {
    if (isLoginLockdownActive()) return;
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.href },
    });
  }, []);

  const signOut = useCallback(async () => {
    // 미리보기(devauth) 모드에서는 실제 세션이 없어 supabase.signOut만으로는 로그아웃되지 않으므로,
    // 우회 플래그(?devauth=0)를 끄고 로그인 화면으로 되돌린다. (운영 빌드에서는 isDevAuthBypass()가 항상 false라 무영향)
    if (isDevAuthBypass()) {
      window.location.href = `${window.location.pathname}?devauth=0`;
      return;
    }
    if (!supabase) return;
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      session,
      loading,
      signInWithEmail,
      signUpWithEmail,
      verifySignupOtp,
      resendSignupOtp,
      requestPasswordResetOtp,
      verifyPasswordResetOtp,
      updatePassword,
      signInWithOAuth,
      signOut,
      isResettingPassword,
      setIsResettingPassword,
    }),
    [
      user,
      session,
      loading,
      signInWithEmail,
      signUpWithEmail,
      verifySignupOtp,
      resendSignupOtp,
      requestPasswordResetOtp,
      verifyPasswordResetOtp,
      updatePassword,
      signInWithOAuth,
      signOut,
      isResettingPassword,
      setIsResettingPassword,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
