import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signInWithEmail: (email: string, password: string) => Promise<{ error?: string }>;
  signUpWithEmail: (email: string, password: string, fullName?: string) => Promise<{ error?: string }>;
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
  const setIsResettingPassword = (v: boolean) => {
    setIsResettingPasswordState(v);
    try {
      if (v) sessionStorage.setItem('wbs-password-reset-in-progress', '1');
      else sessionStorage.removeItem('wbs-password-reset-in-progress');
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInWithEmail = async (email: string, password: string) => {
    if (!supabase) return { error: 'Supabase not configured' };
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message };
  };

  const signUpWithEmail = async (email: string, password: string, fullName?: string) => {
    if (!supabase) return { error: 'Supabase not configured' };
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: fullName?.trim() ? { data: { full_name: fullName.trim() } } : undefined,
    });
    return { error: error?.message };
  };

  const verifySignupOtp = async (email: string, token: string) => {
    if (!supabase) return { error: 'Supabase not configured' };
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'signup' });
    return { error: error?.message };
  };

  const resendSignupOtp = async (email: string) => {
    if (!supabase) return { error: 'Supabase not configured' };
    const { error } = await supabase.auth.resend({ email, type: 'signup' });
    return { error: error?.message };
  };

  const requestPasswordResetOtp = async (email: string) => {
    if (!supabase) return { error: 'Supabase not configured' };
    // resetPasswordForEmail는 메일 템플릿이 OTP({{ .Token }})를 사용하도록 설정되어
    // 있으면 6자리 코드를 메일로 발송한다.
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    return { error: error?.message };
  };

  const verifyPasswordResetOtp = async (email: string, token: string) => {
    if (!supabase) return { error: 'Supabase not configured' };
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'recovery' });
    return { error: error?.message };
  };

  const updatePassword = async (newPassword: string) => {
    if (!supabase) return { error: 'Supabase not configured' };
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    return { error: error?.message };
  };

  const signInWithOAuth = async (provider: 'google' | 'github') => {
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.href },
    });
  };

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  const value: AuthContextType = {
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
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
