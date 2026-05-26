import React, { useState } from 'react';
import { ArrowRight, Eye, EyeOff, ArrowLeft, KeyRound, MailCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import logo from '../assets/logo.png';
import { isAllowedSignupEmail, SIGNUP_EMAIL_FORMAT_ERROR } from '../lib/emailDomain';
import { APP_VERSION, APP_COMMIT_DATE } from '../appRelease';
import { formatTodayKoLongWithWeekday } from '../lib/utils';

/** Supabase 기본 영문 메시지를 한국어 안내로 보강 */
function formatSignInErrorMessage(raw: string): string {
  const t = raw.trim();
  if (/invalid login credentials/i.test(t) || /invalid email or password/i.test(t)) {
    return '이메일 또는 비밀번호가 올바르지 않거나, Supabase Auth에 등록된 사용자가 없습니다. 대시보드 → Authentication → Users에서 사용자를 추가했는지 확인하거나, 회원가입으로 계정을 만든 뒤 다시 시도해 주세요.';
  }
  return t;
}

type Mode = 'signIn' | 'signUp' | 'verifySignup' | 'forgotEmail' | 'forgotVerify' | 'forgotReset';

export function LoginScreen() {
  const {
    signInWithEmail,
    signUpWithEmail,
    verifySignupOtp,
    resendSignupOtp,
    requestPasswordResetOtp,
    verifyPasswordResetOtp,
    updatePassword,
    setIsResettingPassword,
  } = useAuth();
  const [mode, setMode] = useState<Mode>('signIn');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [otpToken, setOtpToken] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const isSignUp = mode === 'signUp';
  const isSignIn = mode === 'signIn';
  const isVerifySignup = mode === 'verifySignup';
  const isForgotEmail = mode === 'forgotEmail';
  const isForgotVerify = mode === 'forgotVerify';
  const isForgotReset = mode === 'forgotReset';

  const goMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setSuccess(null);
    // 비밀번호 재설정 흐름 진입/이탈 시 AuthContext 플래그 동기화.
    // verifyOtp(recovery)가 임시 세션을 발급해도 LoginScreen이 계속 보이도록 한다.
    const isInResetFlow = m === 'forgotEmail' || m === 'forgotVerify' || m === 'forgotReset';
    setIsResettingPassword(isInResetFlow);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (isSignIn) {
      if (!email.trim() || !password) {
        setError('이메일과 비밀번호를 입력하세요.');
        return;
      }
      setLoading(true);
      try {
        const result = await signInWithEmail(email.trim(), password);
        if (result?.error) setError(formatSignInErrorMessage(result.error));
      } finally {
        setLoading(false);
      }
      return;
    }

    if (isSignUp) {
      if (!fullName.trim()) {
        setError('이름을 입력하세요.');
        return;
      }
      if (!email.trim() || !password) {
        setError('이메일과 비밀번호를 입력하세요.');
        return;
      }
      if (!isAllowedSignupEmail(email)) {
        setError(SIGNUP_EMAIL_FORMAT_ERROR);
        return;
      }
      if (password.length < 6) {
        setError('비밀번호는 6자 이상이어야 합니다.');
        return;
      }
      setLoading(true);
      try {
        const result = await signUpWithEmail(email.trim(), password, fullName.trim());
        if (result?.error) {
          setError(result.error);
        } else {
          setSuccess(`${email.trim()}로 인증 코드를 보냈습니다. 메일함을 확인해 주세요.`);
          setMode('verifySignup');
        }
      } finally {
        setLoading(false);
      }
      return;
    }

    if (isVerifySignup) {
      const token = otpToken.trim();
      if (token.length < 6) {
        setError('인증 코드를 입력하세요.');
        return;
      }
      setLoading(true);
      try {
        const result = await verifySignupOtp(email.trim(), token);
        if (result?.error) setError(result.error);
        // 성공 시 onAuthStateChange로 자동 로그인 → 화면 전환됨
      } finally {
        setLoading(false);
      }
      return;
    }

    if (isForgotEmail) {
      if (!email.trim()) {
        setError('이메일을 입력하세요.');
        return;
      }
      setLoading(true);
      try {
        const result = await requestPasswordResetOtp(email.trim());
        if (result?.error) {
          setError(result.error);
        } else {
          setSuccess(`${email.trim()}로 비밀번호 재설정 코드를 보냈습니다.`);
          setOtpToken('');
          setMode('forgotVerify');
        }
      } finally {
        setLoading(false);
      }
      return;
    }

    if (isForgotVerify) {
      const token = otpToken.trim();
      if (token.length < 6) {
        setError('인증 코드를 입력하세요.');
        return;
      }
      setLoading(true);
      try {
        const result = await verifyPasswordResetOtp(email.trim(), token);
        if (result?.error) {
          setError(result.error);
        } else {
          setSuccess('인증 완료. 새 비밀번호를 설정하세요.');
          setNewPassword('');
          setMode('forgotReset');
        }
      } finally {
        setLoading(false);
      }
      return;
    }

    if (isForgotReset) {
      if (!newPassword || newPassword.length < 6) {
        setError('비밀번호는 6자 이상이어야 합니다.');
        return;
      }
      setLoading(true);
      try {
        const result = await updatePassword(newPassword);
        if (result?.error) {
          setError(result.error);
        } else {
          // 비밀번호 변경 완료 → 재설정 흐름 종료 → user 세션 그대로 메인 화면으로 자동 진입
          setIsResettingPassword(false);
        }
      } finally {
        setLoading(false);
      }
      return;
    }
  };

  const handleResendSignupOtp = async () => {
    if (!email.trim()) return;
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const result = await resendSignupOtp(email.trim());
      if (result?.error) setError(result.error);
      else setSuccess('인증 코드를 다시 보냈습니다.');
    } finally {
      setLoading(false);
    }
  };

  const title = (() => {
    switch (mode) {
      case 'signIn':
        return '지엠티 스마트시트';
      case 'signUp':
        return '회원가입';
      case 'verifySignup':
        return '이메일 인증';
      case 'forgotEmail':
        return '비밀번호 찾기';
      case 'forgotVerify':
        return '인증 코드 입력';
      case 'forgotReset':
        return '새 비밀번호 설정';
    }
  })();

  const subtitle = (() => {
    switch (mode) {
      case 'signIn':
        return '로그인하여 프로젝트를 관리하세요.';
      case 'signUp':
        return '사내 직원은 @gmtc.kr, 외주 파트너는 본인 업체 이메일로 가입할 수 있어요. 외주 계정은 초대·공유된 프로젝트만 열립니다.';
      case 'verifySignup':
        return '메일로 받은 인증 코드를 입력하세요.';
      case 'forgotEmail':
        return '가입한 회사 메일로 인증 코드를 보내드립니다.';
      case 'forgotVerify':
        return '메일로 받은 인증 코드를 입력하세요.';
      case 'forgotReset':
        return '사용할 새 비밀번호를 입력하세요(6자 이상).';
    }
  })();

  const submitLabel = (() => {
    switch (mode) {
      case 'signIn':
        return '로그인';
      case 'signUp':
        return '가입 코드 받기';
      case 'verifySignup':
        return '인증 완료';
      case 'forgotEmail':
        return '인증 코드 받기';
      case 'forgotVerify':
        return '코드 확인';
      case 'forgotReset':
        return '비밀번호 변경';
    }
  })();

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)' }}
    >
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-indigo-500/8 rounded-full blur-[150px]" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-violet-500/8 rounded-full blur-[150px]" />

      <div className="relative w-full max-w-md px-6">
        <div
          className="bg-white/[0.06] backdrop-blur-2xl border border-white/[0.08] rounded-3xl p-8 overflow-hidden group"
          style={{ boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)' }}
        >
          <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-indigo-400/60 to-transparent" />

          <div className="flex flex-col items-center text-center space-y-7">
            <div
              className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center overflow-hidden group-hover:scale-105 transition-transform duration-500"
              style={{ boxShadow: '0 8px 30px rgba(15,23,42,0.4)' }}
            >
              <img src={logo} alt="지엠티 스마트시트 로고" className="w-16 h-16 object-contain" />
            </div>

            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-white tracking-tight">{title}</h1>
              <p className="text-slate-400 text-sm leading-relaxed">{subtitle}</p>
            </div>

            <form onSubmit={handleSubmit} className="w-full space-y-3.5">
              {/* 이름 입력: 가입 첫 단계 */}
              {isSignUp && (
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="이름 (필수)"
                  className="w-full bg-white/[0.06] border border-white/[0.08] rounded-xl px-4 py-3.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/40 transition-all"
                  autoComplete="name"
                  required
                  disabled={loading}
                  aria-label="이름"
                />
              )}

              {/* 이메일 입력: 로그인/가입/비밀번호 찾기 첫 단계 */}
              {(isSignIn || isSignUp || isForgotEmail) && (
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={isSignUp ? '이메일 (예: name@gmtc.kr 또는 name@partner.com)' : '이메일'}
                  className="w-full bg-white/[0.06] border border-white/[0.08] rounded-xl px-4 py-3.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/40 transition-all"
                  autoComplete="email"
                  disabled={loading}
                  aria-label="이메일"
                />
              )}

              {/* 인증 코드 입력: 가입 OTP / 비밀번호 재설정 OTP */}
              {(isVerifySignup || isForgotVerify) && (
                <>
                  <div className="px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-xs text-slate-300 text-left">
                    <span className="text-slate-400">받는 메일: </span>
                    <span className="font-medium text-white">{email}</span>
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={10}
                    value={otpToken}
                    onChange={(e) => setOtpToken(e.target.value.replace(/\D/g, ''))}
                    placeholder="인증 코드"
                    className="w-full bg-white/[0.06] border border-white/[0.08] rounded-xl px-4 py-3.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/40 transition-all text-center tracking-[0.3em] text-lg font-semibold"
                    autoComplete="one-time-code"
                    disabled={loading}
                    aria-label="인증 코드"
                  />
                </>
              )}

              {/* 비밀번호 입력: 로그인/가입 첫 단계 */}
              {(isSignIn || isSignUp) && (
                <div className="relative w-full">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={isSignUp ? '비밀번호 (6자 이상)' : '비밀번호'}
                    className="w-full bg-white/[0.06] border border-white/[0.08] rounded-xl pl-4 pr-12 py-3.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/40 transition-all"
                    autoComplete={isSignUp ? 'new-password' : 'current-password'}
                    disabled={loading}
                    aria-label="비밀번호"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
                    title={showPassword ? '비밀번호 숨기기' : '비밀번호 표시'}
                    disabled={loading}
                    aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 표시'}
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              )}

              {/* 새 비밀번호 입력: 비밀번호 재설정 마지막 단계 */}
              {isForgotReset && (
                <div className="relative w-full">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="새 비밀번호 (6자 이상)"
                    className="w-full bg-white/[0.06] border border-white/[0.08] rounded-xl pl-4 pr-12 py-3.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/40 transition-all"
                    autoComplete="new-password"
                    disabled={loading}
                    aria-label="새 비밀번호"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
                    title={showPassword ? '비밀번호 숨기기' : '비밀번호 표시'}
                    disabled={loading}
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
                  <p className="text-red-400 text-sm text-left">{error}</p>
                </div>
              )}
              {success && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <MailCheck className="w-4 h-4 mt-0.5 text-emerald-400 shrink-0" />
                  <p className="text-emerald-400 text-sm text-left">{success}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-white text-slate-900 font-bold py-3.5 rounded-xl hover:bg-slate-50 active:scale-[0.98] transition-all flex items-center justify-center gap-2 group/btn disabled:opacity-50 disabled:cursor-not-allowed mt-2"
                style={{ boxShadow: '0 4px 15px rgba(255,255,255,0.1)' }}
              >
                {loading ? '처리 중...' : submitLabel}
                {!loading && <ArrowRight className="w-4 h-4 group-hover/btn:translate-x-1 transition-transform" />}
              </button>
            </form>

            {/* 보조 링크들: 모드별 */}
            <div className="w-full space-y-2">
              {isSignIn && (
                <div className="flex flex-col items-center gap-2">
                  <button
                    type="button"
                    onClick={() => goMode('forgotEmail')}
                    className="text-xs text-slate-400 hover:text-white transition-colors flex items-center gap-1"
                  >
                    <KeyRound className="w-3 h-3" /> 비밀번호 찾기
                  </button>
                  <button
                    type="button"
                    onClick={() => goMode('signUp')}
                    className="text-sm text-slate-500 hover:text-white transition-colors"
                  >
                    계정이 없으신가요? 회원가입
                  </button>
                </div>
              )}
              {isSignUp && (
                <button
                  type="button"
                  onClick={() => goMode('signIn')}
                  className="text-sm text-slate-500 hover:text-white transition-colors"
                >
                  이미 계정이 있으신가요? 로그인
                </button>
              )}
              {isVerifySignup && (
                <div className="flex flex-col items-center gap-2">
                  <button
                    type="button"
                    onClick={handleResendSignupOtp}
                    disabled={loading}
                    className="text-xs text-slate-400 hover:text-white transition-colors disabled:opacity-50"
                  >
                    코드 다시 받기
                  </button>
                  <button
                    type="button"
                    onClick={() => goMode('signUp')}
                    className="text-xs text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1"
                  >
                    <ArrowLeft className="w-3 h-3" /> 가입 정보 다시 입력
                  </button>
                </div>
              )}
              {(isForgotEmail || isForgotVerify || isForgotReset) && (
                <button
                  type="button"
                  onClick={() => goMode('signIn')}
                  className="text-xs text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1 mx-auto"
                >
                  <ArrowLeft className="w-3 h-3" /> 로그인으로 돌아가기
                </button>
              )}
            </div>

            <p
              className="text-[11px] text-slate-500/80 pt-2"
              title={`오늘 ${formatTodayKoLongWithWeekday()} (로컬) · 앱 v${APP_VERSION} · 릴리스 수정일 ${new Date(APP_COMMIT_DATE).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })}`}
            >
              <span className="text-slate-400/90">오늘 {formatTodayKoLongWithWeekday()}</span>
              <span className="text-slate-400/80">
                {' '}
                · v{APP_VERSION} · 수정일{' '}
                {new Date(APP_COMMIT_DATE).toLocaleDateString('ko-KR', {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                })}
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
