import React from 'react';
import { cn } from '../lib/utils';
import { Loader2 } from 'lucide-react';
import { AppSkeleton } from './AppSkeleton';

interface AppLayoutProps {
  isLoading: boolean;
  isSupabaseConfigured: boolean;
  isFullscreen: boolean;
  lockMobileToDashboard: boolean;
  children: React.ReactNode;
  header: React.ReactNode;
  filterBar?: React.ReactNode;
  dashboardToolbar?: React.ReactNode;
  modals?: React.ReactNode;
  mobileNav?: React.ReactNode;
}

export function AppLayout({
  isLoading,
  isSupabaseConfigured,
  isFullscreen,
  lockMobileToDashboard,
  children,
  header,
  filterBar,
  dashboardToolbar,
  modals,
  mobileNav,
}: AppLayoutProps) {
  if (isLoading) {
    return <AppSkeleton isSupabaseConfigured={isSupabaseConfigured} />;
  }

  return (
    <div
      className={cn(
        'flex flex-col bg-[var(--color-bg)] font-sans text-[var(--color-ink)] selection:bg-indigo-200 selection:text-indigo-900 overflow-hidden h-screen',
        isFullscreen && 'fixed inset-0 z-50',
      )}
    >
      {!isFullscreen && header}

      {dashboardToolbar}
      {filterBar}

      {isFullscreen && (
        <div className="absolute top-3 right-3 z-[60] flex items-center gap-2">
          {/* 전체화면 해제 버튼은 children이나 AppHeader 등에서 제어하도록 넘겨줄 수 있으나,
              현재는 App.tsx에서 직접 렌더링 중이므로 App.tsx에 두거나 Layout으로 넘김 */}
        </div>
      )}

      <main
        className={cn(
          'min-h-0 overflow-hidden flex flex-row relative flex-1',
          lockMobileToDashboard ? 'pb-0' : 'pb-[72px] md:pb-0',
          isFullscreen && 'fixed inset-0 z-50 bg-[var(--color-surface)]',
        )}
      >
        <React.Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="animate-spin text-slate-400" size={28} />
            </div>
          }
        >
          <div className="flex flex-1 min-h-0 min-w-0 flex-row overflow-hidden">
            <div className="flex-1 min-h-0 min-w-0 h-full flex flex-col overflow-hidden relative bg-white">{children}</div>
          </div>
        </React.Suspense>
      </main>

      {mobileNav}
      {modals}
    </div>
  );
}
