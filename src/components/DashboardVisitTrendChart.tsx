import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

export type VisitTrendPoint = { visitDate: string; count: number };

function fmtLongKo(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(y, mo - 1, day);
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(d);
}

/** visits 집계 기준 일별 세션 수 — 간단 SVG 막대·축 */
export function DashboardVisitTrendChart({
  points,
  loading,
  title = '최근 30일 일별 접속(세션)',
  subtitle,
  compact = false,
}: {
  points: VisitTrendPoint[];
  loading?: boolean;
  title?: string;
  subtitle?: string;
  /** 모바일 요약: 축 라벨·높이 축소 */
  compact?: boolean;
}) {
  const max = useMemo(() => Math.max(1, ...points.map((p) => p.count)), [points]);
  const yTicks = useMemo(() => {
    const t: number[] = [0];
    const step = max <= 5 ? 1 : Math.ceil(max / 4);
    for (let v = step; v < max; v += step) t.push(v);
    if (t[t.length - 1] !== max) t.push(max);
    return [...new Set(t)].sort((a, b) => a - b);
  }, [max]);

  const chartH = compact ? 100 : 140;
  const padL = compact ? 28 : 34;
  const padR = 6;
  const padT = compact ? 6 : 10;
  const padB = compact ? 22 : 26;
  const chartWrapRef = useRef<HTMLDivElement>(null);
  /** 카드 너비에 맞춤 — 고정 innerW + 낮은 height 제한 시 meet 스케일로 좌우가 비는 문제 방지 */
  const [innerW, setInnerW] = useState(520);
  const innerH = chartH;
  const W = padL + innerW + padR;
  const H = padT + innerH + padB;

  useLayoutEffect(() => {
    const el = chartWrapRef.current;
    if (!el) return;
    const measure = () => {
      const cw = el.getBoundingClientRect().width;
      if (cw < 1) return;
      const next = Math.floor(cw) - padL - padR;
      const clamped = Math.max(compact ? 160 : 220, next);
      setInnerW((prev) => (Math.abs(prev - clamped) < 2 ? prev : clamped));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [compact, padL, padR]);

  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [tipPos, setTipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const tipRaf = useRef<number | null>(null);

  const queueTipPos = useCallback((clientX: number, clientY: number) => {
    if (tipRaf.current != null) cancelAnimationFrame(tipRaf.current);
    tipRaf.current = requestAnimationFrame(() => {
      tipRaf.current = null;
      setTipPos({ x: clientX, y: clientY });
    });
  }, []);

  useLayoutEffect(() => {
    return () => {
      if (tipRaf.current != null) cancelAnimationFrame(tipRaf.current);
    };
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-stone-200 bg-white p-4 md:p-5">
        <div className="text-sm font-bold text-stone-800 mb-1">{title}</div>
        {subtitle && <p className="text-xs text-stone-500 mb-3">{subtitle}</p>}
        <div className="h-[140px] flex items-center justify-center text-sm text-stone-400">불러오는 중…</div>
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div className="rounded-xl border border-stone-200 bg-white p-4 md:p-5">
        <div className="text-sm font-bold text-stone-800 mb-1">{title}</div>
        {subtitle && <p className="text-xs text-stone-500 mb-2">{subtitle}</p>}
        <p className="text-sm text-stone-500 py-6 text-center">표시할 기록이 없거나 DB 함수가 아직 배포되지 않았을 수 있습니다.</p>
      </div>
    );
  }

  const n = points.length;
  const barGap = 0.15;
  const slotW = innerW / n;
  const barW = Math.max(1, slotW * (1 - barGap));

  const fmtShort = (iso: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return iso;
    return `${Number(m[2])}/${Number(m[3])}`;
  };

  const labelEvery = compact ? Math.max(1, Math.ceil(n / 5)) : Math.max(1, Math.ceil(n / 12));

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 md:p-5 overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <div>
          <div className="text-sm font-bold text-stone-800">{title}</div>
          {subtitle && <p className="text-xs text-stone-500 mt-0.5">{subtitle}</p>}
        </div>
        <span className="text-xs text-stone-400 tabular-nums">
          최대 <span className="font-semibold text-sky-700">{max}</span>
        </span>
      </div>

      {hoverIndex !== null && points[hoverIndex] && (
        <div
          className="fixed z-50 pointer-events-none rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 shadow-lg text-left max-w-[min(280px,calc(100vw-24px)))]"
          style={(() => {
            const vw = typeof window !== 'undefined' ? window.innerWidth : 800;
            const vh = typeof window !== 'undefined' ? window.innerHeight : 600;
            const tipW = 220;
            const left = Math.min(Math.max(8, tipPos.x + 12), vw - tipW);
            const top = Math.min(Math.max(8, tipPos.y - 8), vh - 8);
            return { left, top, transform: 'translateY(-100%)' };
          })()}
          role="tooltip"
        >
          <div className="text-[11px] font-semibold text-stone-800 leading-snug">{fmtLongKo(points[hoverIndex].visitDate)}</div>
          <div className="text-[11px] text-stone-600 tabular-nums mt-0.5">
            세션 <span className="font-semibold text-sky-700">{points[hoverIndex].count}</span>건
            <span className="text-stone-400"> · 최대 대비 {max > 0 ? Math.round((points[hoverIndex].count / max) * 100) : 0}%</span>
          </div>
        </div>
      )}

      <div ref={chartWrapRef} className="w-full min-w-0 overflow-x-auto -mx-1 px-1 relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full min-w-[280px] h-auto block max-w-full"
          style={{ aspectRatio: `${W} / ${H}` }}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={title}
        >
          {/* Y grid + labels */}
          {yTicks.map((yv) => {
            const y = padT + innerH * (1 - yv / max);
            return (
              <g key={yv}>
                <line x1={padL} x2={padL + innerW} y1={y} y2={y} stroke="#e7e5e4" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
                <text x={padL - 4} y={y + 3} textAnchor="end" className="fill-stone-400 text-[9px] font-medium tabular-nums">
                  {yv}
                </text>
              </g>
            );
          })}

          {points.map((p, i) => {
            const h = (p.count / max) * innerH;
            const x = padL + i * slotW + (slotW - barW) / 2;
            const y = padT + innerH - h;
            const slotX0 = padL + i * slotW;
            const isHov = hoverIndex === i;
            const fillClass = isHov ? 'fill-sky-600' : 'fill-sky-500/85 hover:fill-sky-600';
            return (
              <g key={p.visitDate}>
                {/* 넓은 히트 영역(막대 사이 간격에서도 툴팁 표시) */}
                <rect
                  x={slotX0}
                  y={padT}
                  width={slotW}
                  height={innerH}
                  fill="transparent"
                  className="cursor-default"
                  onMouseEnter={(e) => {
                    setHoverIndex(i);
                    queueTipPos(e.clientX, e.clientY);
                  }}
                  onMouseMove={(e) => queueTipPos(e.clientX, e.clientY)}
                  onMouseLeave={() => setHoverIndex(null)}
                  aria-label={`${fmtLongKo(p.visitDate)}, 세션 ${p.count}건`}
                />
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={Math.max(h, p.count > 0 ? 1.5 : 0)}
                  rx={1.5}
                  className={`${fillClass} transition-colors pointer-events-none`}
                  aria-hidden
                />
              </g>
            );
          })}

          {points.map((p, i) => {
            if (i % labelEvery !== 0 && i !== n - 1) return null;
            const cx = padL + i * slotW + slotW / 2;
            return (
              <text
                key={`lbl-${p.visitDate}`}
                x={cx}
                y={H - 6}
                textAnchor="middle"
                className="fill-stone-500 text-[8px] font-medium tabular-nums pointer-events-none"
              >
                {fmtShort(p.visitDate)}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
