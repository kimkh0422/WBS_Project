import React, { useMemo } from 'react';
import { ListOrdered } from 'lucide-react';
import { BaseModal } from './Base/Modal';
import type { WbsImprovementGuideStep } from '../lib/wbsImprovementGuide';

const SEVERITY_STYLE: Record<WbsImprovementGuideStep['severity'], { dot: string; badge: string }> = {
  critical: { dot: 'bg-red-500', badge: 'text-red-700 bg-red-50 border-red-200' },
  high: { dot: 'bg-amber-500', badge: 'text-amber-800 bg-amber-50 border-amber-200' },
  medium: { dot: 'bg-sky-500', badge: 'text-sky-800 bg-sky-50 border-sky-200' },
  low: { dot: 'bg-slate-400', badge: 'text-slate-600 bg-slate-50 border-slate-200' },
};

const SEVERITY_LABEL: Record<WbsImprovementGuideStep['severity'], string> = {
  critical: '긴급',
  high: '높음',
  medium: '보통',
  low: '낮음',
};

export function WbsImprovementGuideModal({
  isOpen,
  onClose,
  steps,
  onJumpToTask,
}: {
  isOpen: boolean;
  onClose: () => void;
  steps: WbsImprovementGuideStep[];
  /** 표에서 해당 행으로 스크롤·강조 */
  onJumpToTask?: (taskId: string) => void;
}) {
  const ordered = useMemo(() => steps.map((s, i) => ({ ...s, stepNo: i + 1 })), [steps]);

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <span className="inline-flex items-center gap-2">
          <ListOrdered size={18} className="text-indigo-600 shrink-0" aria-hidden />
          WBS 보완 가이드
        </span>
      }
      size="lg"
      bodyClassName="max-h-[min(70vh,32rem)] overflow-y-auto"
    >
      <p className="text-sm text-slate-600 m-0 mb-4">
        등록된 작업·프로젝트를 기준으로 <strong className="text-slate-800">우선순위가 높은 항목</strong>부터 정리했습니다. 위에서부터
        순서대로 처리하면 일정·담당·산출물 품질을 빠르게 끌어올릴 수 있습니다.
      </p>
      <ol className="list-none m-0 p-0 space-y-4">
        {ordered.map((step) => (
          <li key={step.stepNo} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-start gap-3">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white"
                aria-hidden
              >
                {step.stepNo}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span
                    className={`h-2 w-2 rounded-full shrink-0 ${SEVERITY_STYLE[step.severity].dot}`}
                    title={SEVERITY_LABEL[step.severity]}
                  />
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${SEVERITY_STYLE[step.severity].badge}`}
                  >
                    {SEVERITY_LABEL[step.severity]}
                  </span>
                  <h3 className="text-sm font-semibold text-slate-900 m-0">{step.title}</h3>
                </div>
                <p className="text-sm text-slate-600 m-0 mb-2 leading-relaxed">{step.instruction}</p>
                {step.affectedCount > 0 && (
                  <p className="text-xs font-medium text-slate-500 m-0 mb-2">해당 작업 수: {step.affectedCount.toLocaleString()}건</p>
                )}
                {step.sampleLabels.length > 0 && (
                  <div className="text-xs text-slate-500 space-y-1">
                    <span className="font-semibold text-slate-600">예시:</span>
                    <ul className="m-0 pl-4 list-disc space-y-0.5">
                      {step.sampleLabels.map((line, idx) => (
                        <li key={idx} className="break-words">
                          {line}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {onJumpToTask && step.sampleTaskIds.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1.5">
                    {step.sampleTaskIds.map((id, idx) => {
                      const raw = step.sampleLabels[idx] ?? id;
                      const short = raw.length > 36 ? `${raw.slice(0, 36)}…` : raw;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => {
                            onJumpToTask(id);
                            onClose();
                          }}
                          className="text-left text-[11px] font-medium px-2 py-1.5 rounded-md border border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-400/30 break-words"
                          title={raw}
                        >
                          표에서 보기: {short}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </BaseModal>
  );
}
