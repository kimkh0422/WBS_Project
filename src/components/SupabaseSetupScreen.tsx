import React from 'react';
import { Database } from 'lucide-react';

export function SupabaseSetupScreen() {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900 overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-amber-500/10 rounded-full blur-[120px] animate-pulse" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-orange-500/10 rounded-full blur-[120px] animate-pulse delay-700" />

      <div className="relative w-full max-w-lg p-8">
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-500 to-orange-600 opacity-50" />

          <div className="flex flex-col items-center text-center space-y-6">
            <div className="w-16 h-16 bg-gradient-to-br from-amber-500 to-orange-600 rounded-2xl flex items-center justify-center shadow-lg shadow-amber-500/20">
              <Database className="text-white w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-white tracking-tight">Supabase 설정 필요</h1>
              <p className="text-slate-400 text-sm">이 앱은 Supabase를 사용합니다. 환경 변수를 설정한 뒤 앱을 다시 시작하세요.</p>
            </div>

            <div className="w-full text-left bg-slate-800/50 rounded-xl p-5 font-mono text-sm text-slate-300 space-y-3">
              <p className="text-amber-400 font-semibold">프로젝트 루트에 .env 파일을 만들고 다음을 추가하세요:</p>
              <pre className="whitespace-pre-wrap break-all">
                {`VITE_SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
VITE_SUPABASE_ANON_KEY="YOUR_ANON_KEY"`}
              </pre>
              <p className="text-slate-500 text-xs pt-2">
                Supabase 대시보드 → Project Settings → API 에서 Project URL과 anon public 키를 확인할 수 있습니다.
              </p>
            </div>

            <a
              href="https://supabase.com/dashboard"
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-400 hover:text-amber-300 text-sm font-medium underline"
            >
              Supabase 대시보드 열기 →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
