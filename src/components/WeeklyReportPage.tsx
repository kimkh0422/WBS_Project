import { useEffect, useMemo, useRef } from 'react';
import { buildWeeklyReportSrcDoc } from '../data/weeklyReportSrcDoc';

/**
 * 주간업무보고 통합 대시보드.
 * 원본이 독립 HTML(바닐라 JS·인라인 스타일)이라 React로 재작성하지 않고 iframe(srcDoc)으로
 * 그대로 임베드한다 → 스크립트 실행·CSS 격리(앱 Tailwind와 충돌 없음)·100% 동일 표시.
 * 주차·제목·푸터 표기는 `weeklyReportMeta.ts`, 본문 데이터는 `weeklyReport.html`의 `REPORTS`만 갱신한다.
 * srcDoc은 동일 출처이므로 onload 후 내용 높이를 측정해 iframe 높이를 자동 맞춘다(내부 스크롤 없음).
 */
export function WeeklyReportPage() {
  const ref = useRef<HTMLIFrameElement>(null);
  const srcDoc = useMemo(() => buildWeeklyReportSrcDoc(), []);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    let ro: ResizeObserver | null = null;
    const timers: number[] = [];

    const resize = () => {
      try {
        const doc = iframe.contentDocument;
        const h = doc?.documentElement?.scrollHeight || doc?.body?.scrollHeight || 0;
        if (h) iframe.style.height = `${h + 8}px`;
      } catch {
        /* same-origin srcDoc — 준비 전이면 무시 */
      }
    };

    const onLoad = () => {
      resize();
      // 차트/표가 DOMContentLoaded 이후 그려질 수 있어 여러 번 재측정
      timers.push(window.setTimeout(resize, 150), window.setTimeout(resize, 600), window.setTimeout(resize, 1500));
      try {
        const body = iframe.contentDocument?.body;
        if (body && typeof ResizeObserver !== 'undefined') {
          ro = new ResizeObserver(() => resize());
          ro.observe(body);
        }
      } catch {
        /* ignore */
      }
    };

    iframe.addEventListener('load', onLoad);
    const onWinResize = () => resize();
    window.addEventListener('resize', onWinResize);
    return () => {
      iframe.removeEventListener('load', onLoad);
      window.removeEventListener('resize', onWinResize);
      timers.forEach((t) => clearTimeout(t));
      ro?.disconnect();
    };
  }, []);

  return (
    <iframe
      ref={ref}
      title="지엠티 주간업무보고"
      srcDoc={srcDoc}
      className="block w-full border-0 bg-[#eef2f7]"
      style={{ minHeight: 'calc(100vh - 120px)' }}
    />
  );
}
