import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MousePointerClick, X } from 'lucide-react';
import type { GuidedTourStep } from '../lib/guidedTourSteps';

interface GuidedTourProps {
  steps: GuidedTourStep[];
  /** 툴팁 상단 배지 옆에 표시할 투어 이름(선택) */
  tourName?: string;
  /** 현재 단계 인덱스(App.tsx의 투어 상태 머신이 관리) */
  stepIndex: number;
  /** 안내형(next) 단계의 「다음」 버튼 */
  onNext: () => void;
  /** 마지막 단계의 「완료」 */
  onFinish: () => void;
  /** X·Esc — 이번만 닫기 */
  onSkip: () => void;
  /** 「다시 보지 않기」(선택 — Excel 투어 등 수동 전용 투어는 생략 가능) */
  onNeverShow?: () => void;
}

/** 스포트라이트가 대상 요소 둘레에 두는 여백(px) */
const SPOT_PAD = 6;
/** 툴팁과 대상·화면 가장자리 사이 간격(px) */
const TIP_GAP = 12;

/**
 * 초보자 따라하기 투어 오버레이.
 * 외부 라이브러리 없이 box-shadow 딤 + 고정 툴팁으로 구현 — React 19 호환·번들 영향 최소.
 * 스포트라이트는 pointer-events를 막지 않아 사용자가 강조된 요소를 그대로 조작할 수 있다.
 * 대상 추적은 선택자 기반 주기 재측정이라 모달 전환·표 스크롤에도 대상이 보이면 따라간다.
 */
export function GuidedTour({ steps, tourName, stepIndex, onNext, onFinish, onSkip, onNeverShow }: GuidedTourProps) {
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const isLast = stepIndex >= steps.length - 1;
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [tipPos, setTipPos] = useState<{ top: number; left: number } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  /** 단계마다 한 번만 대상으로 스크롤 */
  const scrolledStepRef = useRef(-1);

  // 대상 요소 위치 추적: 단계 전환·스크롤·리사이즈 + 300ms 폴링(레이아웃 변화 대비)
  useEffect(() => {
    let raf = 0;
    const measure = () => {
      const el = document.querySelector<HTMLElement>(step.target);
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      if (r.width < 1 && r.height < 1) {
        setRect(null);
        return;
      }
      if (scrolledStepRef.current !== stepIndex) {
        scrolledStepRef.current = stepIndex;
        if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      setRect((prev) =>
        prev &&
        Math.abs(prev.top - r.top) < 1 &&
        Math.abs(prev.left - r.left) < 1 &&
        Math.abs(prev.width - r.width) < 1 &&
        Math.abs(prev.height - r.height) < 1
          ? prev
          : { top: r.top, left: r.left, width: r.width, height: r.height },
      );
    };
    measure();
    const onMove = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    const iv = window.setInterval(measure, 300);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
      window.clearInterval(iv);
      cancelAnimationFrame(raf);
    };
  }, [step.target, stepIndex]);

  // 툴팁 위치: 대상 아래 우선, 화면 아래를 벗어나면 위로. 대상이 없으면 화면 중앙.
  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!tip) return;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    if (!rect) {
      setTipPos({ top: Math.max(TIP_GAP, window.innerHeight / 2 - h / 2), left: Math.max(TIP_GAP, window.innerWidth / 2 - w / 2) });
      return;
    }
    let top = rect.top + rect.height + SPOT_PAD + TIP_GAP;
    if (top + h > window.innerHeight - TIP_GAP) top = Math.max(TIP_GAP, rect.top - SPOT_PAD - TIP_GAP - h);
    const left = Math.min(Math.max(TIP_GAP, rect.left + rect.width / 2 - w / 2), Math.max(TIP_GAP, window.innerWidth - w - TIP_GAP));
    setTipPos({ top, left });
  }, [rect, stepIndex]);

  // Esc — 투어 종료
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSkip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSkip]);

  return (
    <>
      {rect ? (
        <div
          className="fixed z-[120] pointer-events-none rounded-xl transition-all duration-300 ease-out"
          style={{
            top: rect.top - SPOT_PAD,
            left: rect.left - SPOT_PAD,
            width: rect.width + SPOT_PAD * 2,
            height: rect.height + SPOT_PAD * 2,
            boxShadow: '0 0 0 2px var(--color-accent), 0 0 0 9999px rgba(2, 6, 23, 0.55)',
          }}
          aria-hidden
        />
      ) : (
        <div className="fixed inset-0 z-[120] pointer-events-none bg-slate-950/45" aria-hidden />
      )}
      <div
        ref={tipRef}
        role="dialog"
        aria-label={step.title}
        className={
          'fixed z-[121] w-[320px] max-w-[calc(100vw-24px)] rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow-2xl' +
          (tipPos ? ' transition-all duration-300 ease-out' : '')
        }
        style={tipPos ? { top: tipPos.top, left: tipPos.left } : { top: 8, left: 8, visibility: 'hidden' }}
      >
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-[11px] font-bold text-[var(--color-accent)] bg-indigo-500/10 rounded-full px-2 py-0.5">
            {tourName ? `${tourName} · ` : ''}
            {Math.min(stepIndex, steps.length - 1) + 1} / {steps.length}
          </span>
          <button
            type="button"
            onClick={onSkip}
            className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-black/5 transition-colors"
            title="이번만 닫기 (Esc) — 다음 접속 때 다시 안내합니다"
            aria-label="투어 이번만 닫기"
          >
            <X size={14} />
          </button>
        </div>
        <h3 className="text-sm font-bold text-[var(--color-ink)] mb-1.5">{step.title}</h3>
        <p className="text-[13px] leading-relaxed text-[var(--color-ink-subdued)] whitespace-pre-line">{step.body}</p>
        {!rect && (
          <p className="mt-2 text-xs leading-relaxed text-amber-600">
            안내할 화면 요소가 지금 보이지 않습니다. 이전 화면으로 돌아가거나, 투어를 닫고 ⋮ 메뉴에서 다시 시작해 주세요.
          </p>
        )}
        <div className="flex items-center justify-between gap-2 mt-3.5">
          {onNeverShow ? (
            <button
              type="button"
              onClick={onNeverShow}
              className="text-xs text-slate-400 hover:text-slate-600 hover:underline"
              title="다음 접속부터 투어를 자동으로 띄우지 않습니다. ⋮ 메뉴 → 「따라하기 투어」로는 언제든 다시 볼 수 있어요."
            >
              다시 보지 않기
            </button>
          ) : (
            <span />
          )}
          {step.mode === 'next' ? (
            <button type="button" onClick={isLast ? onFinish : onNext} className="btn-primary !px-4 !py-1.5 !text-xs">
              {isLast ? '완료' : '다음'}
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-accent)]">
              <MousePointerClick size={14} className="shrink-0" />
              강조된 곳을 직접 조작해 보세요
            </span>
          )}
        </div>
      </div>
    </>
  );
}
