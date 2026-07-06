import React from 'react';
import { Clock, Info } from 'lucide-react';
import logo from '../assets/logo.png';
import { APP_VERSION, APP_COMMIT_DATE } from '../appRelease';
import { formatReleaseDateDotKo } from '../lib/utils';
import { LOGIN_LOCKDOWN_DURATION_HINT, LOGIN_LOCKDOWN_MESSAGE } from '../constants/loginLockdown';

/** 로그인 차단 기간 안내 — 로그인 폼 없이 공지만 표시 */
export function LoginLockdownScreen() {
  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)' }}
    >
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-indigo-500/8 rounded-full blur-[150px]" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-violet-500/8 rounded-full blur-[150px]" />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-8">
          <div className="relative w-full max-w-lg">
            <div
              className="bg-white/[0.06] backdrop-blur-2xl border border-white/[0.08] rounded-3xl p-8 overflow-hidden"
              style={{ boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)' }}
            >
              <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-amber-400/70 to-transparent" />

              <div className="flex flex-col items-center text-center space-y-6">
                <div
                  className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center overflow-hidden"
                  style={{ boxShadow: '0 8px 30px rgba(15,23,42,0.4)' }}
                >
                  <img src={logo} alt="지엠티 스마트시트 로고" className="w-16 h-16 object-contain" />
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold tracking-widest text-amber-300/90 uppercase">시스템 안내</p>
                  <h1 className="text-2xl font-bold text-white tracking-tight">로그인 일시 중단</h1>
                </div>

                <div className="w-full space-y-3 text-left">
                  <div className="flex items-start gap-3 px-4 py-3.5 rounded-xl bg-white/[0.05] border border-white/[0.08]">
                    <Info className="w-5 h-5 mt-0.5 text-indigo-300 shrink-0" aria-hidden />
                    <p className="text-sm text-slate-200 leading-relaxed">{LOGIN_LOCKDOWN_MESSAGE}</p>
                  </div>
                  <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                    <Clock className="w-4 h-4 mt-0.5 text-amber-300 shrink-0" aria-hidden />
                    <p className="text-sm text-amber-100/90 leading-relaxed">{LOGIN_LOCKDOWN_DURATION_HINT}</p>
                  </div>
                </div>

                <p className="text-xs text-slate-500 leading-relaxed">문의 사항은 운영기술 개발실로 연락해 주세요.</p>
              </div>
            </div>
          </div>
        </div>

        <footer className="shrink-0 border-t border-white/[0.06] bg-slate-950/35 px-4 py-3 text-center safe-bottom">
          <p className="text-[10px] font-medium text-slate-400/95 tabular-nums tracking-tight">
            v{APP_VERSION} ({formatReleaseDateDotKo(APP_COMMIT_DATE)})
          </p>
        </footer>
      </div>
    </div>
  );
}
