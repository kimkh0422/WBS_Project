import React from 'react';

/**
 * React.lazy + 청크 로드 실패 자동 복구.
 *
 * 배포 직후 사용자 탭에 남아 있는 옛 index.js가 사라진 옛 해시 청크(예: ExportModal-OLD.js)를 dynamic import 하면
 * Vercel/정적 호스트가 SPA fallback HTML을 돌려줘 "Failed to fetch dynamically imported module" /
 * "Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of text/html"이 난다.
 *
 * 동작:
 *   1) 첫 실패 → sessionStorage 플래그를 세우고 페이지를 강제 새로고침해 새 index.js와 새 해시 청크를 받는다.
 *   2) 새로고침 후에도 실패 → 무한 reload 루프를 막기 위해 원본 에러를 그대로 throw(상위 ErrorBoundary가 처리).
 */
const RELOAD_FLAG_KEY = 'wbs.lazyWithRetry.reloaded';

function isChunkLoadError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const msg = String((err as { message?: unknown }).message ?? '');
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Loading chunk \d+ failed/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /Expected a JavaScript-or-Wasm module script/i.test(msg)
  );
}

export function lazyWithRetry<T extends React.ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return React.lazy(async () => {
    try {
      const mod = await factory();
      window.sessionStorage.removeItem(RELOAD_FLAG_KEY);
      return mod;
    } catch (err) {
      const alreadyReloaded = window.sessionStorage.getItem(RELOAD_FLAG_KEY) === '1';
      if (isChunkLoadError(err) && !alreadyReloaded) {
        window.sessionStorage.setItem(RELOAD_FLAG_KEY, '1');
        window.location.reload();
        return new Promise<{ default: T }>(() => {});
      }
      throw err;
    }
  });
}
