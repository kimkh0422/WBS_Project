import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import logo from '../assets/logo.png';

export function LoginScreen() {
  const { signInWithEmail, signUpWithEmail } = useAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!email.trim() || !password) {
      setError('이메일과 비밀번호를 입력하세요.');
      return;
    }
    if (password.length < 6) {
      setError('비밀번호는 6자 이상이어야 합니다.');
      return;
    }
    setLoading(true);
    try {
      const result = isSignUp
        ? await signUpWithEmail(email.trim(), password, fullName.trim() || undefined)
        : await signInWithEmail(email.trim(), password);
      if (result?.error) {
        setError(result.error);
      } else if (isSignUp) {
        setSuccess('가입이 완료되었습니다. 로컬에서 바로 사용할 수 있으며, 관리자 승인 후 DB와 동기화할 수 있습니다.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)' }}>
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-indigo-500/8 rounded-full blur-[150px]" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-violet-500/8 rounded-full blur-[150px]" />

      <div className="relative w-full max-w-md px-6">
        <div className="bg-white/[0.06] backdrop-blur-2xl border border-white/[0.08] rounded-3xl p-8 overflow-hidden group" style={{ boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)' }}>
          <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-indigo-400/60 to-transparent" />

          <div className="flex flex-col items-center text-center space-y-7">
            <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center overflow-hidden group-hover:scale-105 transition-transform duration-500" style={{ boxShadow: '0 8px 30px rgba(15,23,42,0.4)' }}>
              <img src={logo} alt="지엠티 프로젝트 매니저 로고" className="w-16 h-16 object-contain" />
            </div>

            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-white tracking-tight">지엠티 프로젝트 매니저</h1>
              <p className="text-slate-400 text-sm leading-relaxed">
                {isSignUp ? '회원가입하여 프로젝트를 만들고 팀원과 공유하세요.' : '로그인하여 프로젝트를 관리하세요.'}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="w-full space-y-3.5">
              {isSignUp && (
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="이름"
                  className="w-full bg-white/[0.06] border border-white/[0.08] rounded-xl px-4 py-3.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/40 transition-all"
                  autoComplete="name"
                  disabled={loading}
                />
              )}
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="이메일"
                className="w-full bg-white/[0.06] border border-white/[0.08] rounded-xl px-4 py-3.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/40 transition-all"
                autoComplete="email"
                disabled={loading}
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호 (6자 이상)"
                className="w-full bg-white/[0.06] border border-white/[0.08] rounded-xl px-4 py-3.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/40 transition-all"
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                disabled={loading}
              />
              {error && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
                  <p className="text-red-400 text-sm text-left">{error}</p>
                </div>
              )}
              {success && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <p className="text-emerald-400 text-sm text-left">{success}</p>
                </div>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-white text-slate-900 font-bold py-3.5 rounded-xl hover:bg-slate-50 active:scale-[0.98] transition-all flex items-center justify-center gap-2 group/btn disabled:opacity-50 disabled:cursor-not-allowed mt-2"
                style={{ boxShadow: '0 4px 15px rgba(255,255,255,0.1)' }}
              >
                {loading ? '처리 중...' : isSignUp ? '회원가입' : '로그인'}
                {!loading && <ArrowRight className="w-4 h-4 group-hover/btn:translate-x-1 transition-transform" />}
              </button>
            </form>

            <button
              type="button"
              onClick={() => { setIsSignUp(!isSignUp); setError(null); setSuccess(null); setFullName(''); }}
              className="text-sm text-slate-500 hover:text-white transition-colors duration-200"
            >
              {isSignUp ? '이미 계정이 있으신가요? 로그인' : '계정이 없으신가요? 회원가입'}
            </button>

            <p className="text-[11px] text-slate-500/80 pt-2" title="앱 버전">
              v{__APP_VERSION__}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
