import React from 'react';
import { Loader2 } from 'lucide-react';

interface AppSkeletonProps {
  isSupabaseConfigured: boolean;
}

export function AppSkeleton({ isSupabaseConfigured }: AppSkeletonProps) {
  // 스켈레톤 로딩: 실제 테이블 레이아웃을 모방
  const skeletonPulse = 'animate-pulse bg-[var(--color-line)] rounded';

  return (
    <div className="h-full flex flex-col bg-[var(--color-bg)] font-sans text-[var(--color-ink)]">
      {/* 헤더 스켈레톤 */}
      <div className="px-4 md:px-6 py-3 border-b border-[var(--color-line)] flex items-center gap-4">
        <div className={`w-12 h-12 rounded-xl ${skeletonPulse}`} />
        <div className="flex-1 space-y-2">
          <div className={`h-4 w-48 ${skeletonPulse}`} />
          <div className={`h-3 w-32 ${skeletonPulse}`} />
        </div>
        <div className="hidden md:flex gap-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className={`h-8 w-16 rounded-lg ${skeletonPulse}`} />
          ))}
        </div>
      </div>

      {/* 요약 바 스켈레톤 */}
      <div className="px-4 py-2 border-b border-[var(--color-line)] flex items-center gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={`h-5 w-24 rounded ${skeletonPulse}`} />
        ))}
      </div>

      {/* 테이블 헤더 스켈레톤 */}
      <div className="px-2 py-2 border-b border-[var(--color-line)] flex items-center gap-3">
        <div className={`h-4 w-8 ${skeletonPulse}`} />
        <div className={`h-4 w-12 ${skeletonPulse}`} />
        {[60, 200, 70, 70, 50, 60, 60, 60].map((w, i) => (
          <div key={i} className={`h-4 rounded ${skeletonPulse}`} style={{ width: w }} />
        ))}
      </div>

      {/* 테이블 행 스켈레톤 */}
      <div className="flex-1 overflow-hidden">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="px-2 py-3 border-b border-[var(--color-line-soft)] flex items-center gap-3"
            style={{ opacity: 1 - i * 0.06 }}
          >
            <div className={`h-4 w-4 rounded ${skeletonPulse}`} />
            <div className={`h-4 w-8 rounded ${skeletonPulse}`} />
            <div className={`h-4 w-12 rounded ${skeletonPulse}`} />
            <div className={`h-4 rounded ${skeletonPulse}`} style={{ width: 140 + (i % 3) * 40 }} />
            {[65, 65, 45, 55, 55, 55].map((w, j) => (
              <div key={j} className={`h-4 rounded ${skeletonPulse}`} style={{ width: w }} />
            ))}
          </div>
        ))}
      </div>

      {/* 하단 로딩 표시 */}
      <div className="py-3 text-center">
        <p className="text-xs text-[var(--color-ink-muted)] flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          {isSupabaseConfigured ? '서버에서 데이터를 불러오는 중...' : '로딩 중...'}
        </p>
      </div>
    </div>
  );
}
