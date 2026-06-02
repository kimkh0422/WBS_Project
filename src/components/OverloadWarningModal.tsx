import React, { useState, useMemo, useEffect } from 'react';
import { X, AlertTriangle, Calendar, TrendingUp, Check } from 'lucide-react';
import { cn, formatPercent1 } from '../lib/utils';
import { MODAL_BACKDROP_CLASS, MODAL_PANEL_BASE_CLASS } from '../lib/modalChrome';
import type { WorkloadDay } from '../lib/workload';
import type { Task } from '../types';
import { useOrganization } from '../context/OrganizationContext';
import { buildOrgMemberDisplayMetaMap, formatAssigneeDisplay } from '../lib/assigneeOptions';

export type OverloadFixStrategy = 'extend' | 'increaseAllocation' | 'skip';

export function getOverloadKey(o: WorkloadDay): string {
  return `${o.assignee}-${o.date}`;
}

interface OverloadWarningModalProps {
  isOpen: boolean;
  onClose: () => void;
  overloads: WorkloadDay[];
  tasksById: Map<string, Task>;
  wbsMap: Map<string, string>;
  onFix: (overloadsToFix: Array<{ overload: WorkloadDay; strategy: 'extend' | 'increaseAllocation' }>) => void;
}

export function OverloadWarningModal({ isOpen, onClose, overloads, tasksById, wbsMap, onFix }: OverloadWarningModalProps) {
  const { orgMembers } = useOrganization();
  const assigneeDisplayMetaByName = useMemo(() => buildOrgMemberDisplayMetaMap(orgMembers), [orgMembers]);
  const [strategies, setStrategies] = useState<Record<string, OverloadFixStrategy>>({});

  useEffect(() => {
    if (isOpen) setStrategies({});
  }, [isOpen]);

  const strategiesByKey = useMemo(() => {
    const next: Record<string, OverloadFixStrategy> = {};
    overloads.forEach((o) => {
      const key = getOverloadKey(o);
      next[key] = strategies[key] ?? 'skip';
    });
    return next;
  }, [overloads, strategies]);

  const selectedCount = useMemo(() => {
    return Object.values(strategiesByKey).filter((s) => s !== 'skip').length;
  }, [strategiesByKey]);

  const handleApply = () => {
    const overloadsToFix: Array<{ overload: WorkloadDay; strategy: 'extend' | 'increaseAllocation' }> = [];
    overloads.forEach((o) => {
      const s = strategiesByKey[getOverloadKey(o)];
      if (s === 'extend' || s === 'increaseAllocation') {
        overloadsToFix.push({ overload: o, strategy: s });
      }
    });
    if (overloadsToFix.length === 0) {
      onClose();
      return;
    }
    onFix(overloadsToFix);
    onClose();
  };

  const setStrategy = (key: string, strategy: OverloadFixStrategy) => {
    setStrategies((prev) => ({ ...prev, [key]: strategy }));
  };

  if (!isOpen) return null;

  return (
    <div className={MODAL_BACKDROP_CLASS}>
      <div className={cn(MODAL_PANEL_BASE_CLASS, 'max-w-2xl max-h-[85vh] flex flex-col overflow-hidden')}>
        <div className="flex justify-between items-center p-5 border-b border-slate-100 bg-amber-50/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
              <AlertTriangle className="text-amber-600" size={22} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[var(--color-ink)]">과부하 경고</h2>
              <p className="text-xs text-amber-700 mt-0.5">
                같은 날 100% 초과 투입된 인원·일자가 {overloads.length}건 있습니다. 각 항목별로 조정 방식을 선택하세요.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-amber-100 rounded-full transition-colors text-amber-700 hover:text-amber-900">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <ul className="space-y-3">
            {overloads.map((o, idx) => {
              const key = getOverloadKey(o);
              const strategy = strategiesByKey[key];
              return (
                <li key={key} className="flex flex-col gap-3 p-4 rounded-xl border border-amber-100 bg-amber-50/50">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-[var(--color-ink)]">
                      {formatAssigneeDisplay(o.assignee, assigneeDisplayMetaByName)}
                    </span>
                    <span className="text-sm font-bold text-amber-700 shrink-0">
                      {o.date} · {formatPercent1(o.totalPercent)}%
                    </span>
                  </div>
                  <div className="text-xs text-slate-600 space-y-1">
                    {o.taskIds.map((tid) => {
                      const t = tasksById.get(tid);
                      const wbs = (wbsMap.get(tid) ?? t?.name) || tid;
                      return (
                        <div key={tid} className="flex items-center gap-2">
                          <span className="font-mono text-amber-600">{wbs}</span>
                          {t?.name && <span className="truncate">{t.name}</span>}
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setStrategy(key, 'extend')}
                      className={cn(
                        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors',
                        strategy === 'extend'
                          ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
                      )}
                      title="겹치는 작업을 순차 배치"
                    >
                      {strategy === 'extend' && <Check size={12} />}
                      <Calendar size={12} />
                      기간 연장
                    </button>
                    <button
                      type="button"
                      onClick={() => setStrategy(key, 'increaseAllocation')}
                      className={cn(
                        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors',
                        strategy === 'increaseAllocation'
                          ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
                      )}
                      title="50% → 100%로 조정 후 종료일 재계산"
                    >
                      {strategy === 'increaseAllocation' && <Check size={12} />}
                      <TrendingUp size={12} />
                      투입율 증가
                    </button>
                    <button
                      type="button"
                      onClick={() => setStrategy(key, 'skip')}
                      className={cn(
                        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors',
                        strategy === 'skip'
                          ? 'border-slate-300 bg-slate-100 text-slate-600'
                          : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50',
                      )}
                    >
                      {strategy === 'skip' && <Check size={12} />}
                      조정 안함
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="p-5 border-t border-slate-100 bg-slate-50/50 space-y-3">
          <p className="text-xs font-medium text-slate-600">
            {selectedCount > 0 ? (
              <span>
                <strong>{selectedCount}건</strong>에 대해 조정을 적용합니다.
              </span>
            ) : (
              <span>각 항목에서 조정 방식을 선택한 뒤 적용 버튼을 누르세요.</span>
            )}
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-ghost">
              닫기
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={selectedCount === 0}
              className={cn('btn-primary', selectedCount === 0 && 'opacity-50 cursor-not-allowed')}
            >
              적용 ({selectedCount})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
