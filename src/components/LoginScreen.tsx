import React, { useState } from 'react';
import { Lock, ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

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
        setSuccess('가입 완료! 이메일 확인 링크를 확인해 주세요. (스팸함도 확인)');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-stone-900 overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-500/10 rounded-full blur-[120px] animate-pulse" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/10 rounded-full blur-[120px] animate-pulse delay-700" />

      <div className="relative w-full max-w-md p-8">
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-purple-600 opacity-50" />

          <div className="flex flex-col items-center text-center space-y-6">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20 group-hover:scale-110 transition-transform duration-300">
              <Lock className="text-white w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-white tracking-tight">지엠티 WBS 매니저</h1>
              <p className="text-stone-400 text-sm">
                {isSignUp ? '회원가입하여 프로젝트를 만들고 팀원과 공유하세요.' : '로그인하여 프로젝트를 만들고 팀원과 공유하세요.'}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="w-full space-y-4">
              {isSignUp && (
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="이름"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-white placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all"
                  autoComplete="name"
                  disabled={loading}
                />
              )}
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="이메일"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-white placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all"
                autoComplete="email"
                disabled={loading}
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호 (6자 이상)"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-white placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all"
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                disabled={loading}
              />
              {error && (
                <p className="text-red-400 text-sm text-left">{error}</p>
              )}
              {success && (
                <p className="text-emerald-400 text-sm text-left">{success}</p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-white text-stone-900 font-bold py-3.5 rounded-xl hover:bg-stone-100 active:scale-95 transition-all flex items-center justify-center gap-2 group/btn disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? '처리 중...' : isSignUp ? '회원가입' : '로그인'}
                <ArrowRight className="w-4 h-4 group-hover/btn:translate-x-1 transition-transform" />
              </button>
            </form>

            <button
              type="button"
              onClick={() => { setIsSignUp(!isSignUp); setError(null); setSuccess(null); setFullName(''); }}
              className="text-sm text-stone-400 hover:text-white transition-colors"
            >
              {isSignUp ? '이미 계정이 있으신가요? 로그인' : '계정이 없으신가요? 회원가입'}
            </button>

          </div>
        </div>
      </div>
    </div>
  );
}
