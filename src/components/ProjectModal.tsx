import React, { useState, useEffect, useMemo } from 'react';
import { X, Plus, UserPlus, Calendar } from 'lucide-react';
import { Project, ProjectAssignment } from '../types';
import { ALLOCATION_OPTIONS } from '../lib/schedule';
import { eachMonthOfInterval, format, parseISO, addMonths, startOfMonth } from 'date-fns';
import { cn } from '../lib/utils';
import { WORK_EFFORT_UNIT_OPTIONS, normalizeWorkEffortUnit } from '../lib/workEffortUnits';

/** "YYYY-MM-DD ~ YYYY-MM-DD" 또는 "YY.MM ~ YY.MM" 형식 파싱 → [start, end] (YYYY-MM-DD) */
function parseReportTotalPeriod(value: string): [string, string] {
  const trimmed = value.trim();
  if (!trimmed) return ['', ''];
  const parts = trimmed.split(/\s*~\s*/).map((p) => p.trim());
  if (parts.length !== 2) return ['', ''];
  const toDate = (p: string): string => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return p;
    const mm = p.match(/^(\d{2})\.(\d{2})$/);
    if (mm) {
      const y = 2000 + parseInt(mm[1], 10);
      const m = mm[2];
      return `${y}-${m}-01`;
    }
    return '';
  };
  return [toDate(parts[0]), toDate(parts[1])];
}

/** 시작일/종료일을 reportTotalPeriod 문자열로 포맷 */
function formatReportTotalPeriod(start: string, end: string): string {
  if (!start || !end) return '';
  return `${start} ~ ${end}`;
}

interface ProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (
    name: string,
    description: string,
    startDate?: string,
    endDate?: string,
    assignments?: ProjectAssignment[],
    minWorkEffortDays?: number,
    workEffortUnit?: Project['workEffortUnit'],
    reportCategory?: string,
    reportAgency?: string,
    reportBudgetThisYear?: string,
    reportTotalPeriod?: string,
    reportNameShort?: string,
    reportNameFull?: string,
  ) => void;
  project?: Project | null;
  /** 기존 프로젝트 목록(주간보고용 약어/전체과제명 선택 목록) */
  allProjects?: Project[];
}

export function ProjectModal({ isOpen, onClose, onSave, project, allProjects = [] }: ProjectModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [assignments, setAssignments] = useState<ProjectAssignment[]>([]);
  const [minWorkEffortDays, setMinWorkEffortDays] = useState<string>('');
  const [workEffortUnit, setWorkEffortUnit] = useState<Project['workEffortUnit']>('day');
  const [reportCategory, setReportCategory] = useState('');
  const [reportAgency, setReportAgency] = useState('');
  const [reportBudgetThisYear, setReportBudgetThisYear] = useState('');
  /** 전체기간: 달력 선택용 시작일/종료일 (YYYY-MM-DD). reportTotalPeriod와 동기화 */
  const [reportPeriodStart, setReportPeriodStart] = useState('');
  const [reportPeriodEnd, setReportPeriodEnd] = useState('');
  const [reportNameShort, setReportNameShort] = useState('');
  const [reportNameFull, setReportNameFull] = useState('');

  /** 월별 설정 펼친 인원 인덱스 (한 번에 하나만) */
  const [monthlyExpandedIndex, setMonthlyExpandedIndex] = useState<number | null>(null);

  /** 프로젝트 기간 기준 월 목록 (YYYY-MM). 기간 없으면 현재월 포함 12개월 */
  const projectMonths = useMemo(() => {
    const start = startDate ? parseISO(startDate) : new Date();
    const end = endDate ? parseISO(endDate) : addMonths(start, 11);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      const now = new Date();
      return Array.from({ length: 12 }, (_, i) => format(addMonths(startOfMonth(now), i), 'yyyy-MM'));
    }
    const startMonth = startOfMonth(start);
    const endMonth = startOfMonth(end);
    if (endMonth < startMonth) return [format(startMonth, 'yyyy-MM')];
    const months = eachMonthOfInterval({ start: startMonth, end: endMonth });
    return months.map((m) => format(m, 'yyyy-MM'));
  }, [startDate, endDate]);

  useEffect(() => {
    if (isOpen) {
      if (project) {
        setName(project.name);
        setDescription(project.description || '');
        setStartDate(project.startDate || '');
        setEndDate(project.endDate || '');
        setAssignments(project.assignments?.length ? [...project.assignments] : []);
        setMinWorkEffortDays(project.minWorkEffortDays != null ? String(project.minWorkEffortDays) : '');
        setWorkEffortUnit(normalizeWorkEffortUnit(project.workEffortUnit));
        setReportCategory(project.reportCategory || '');
        setReportAgency(project.reportAgency || '');
        setReportBudgetThisYear(project.reportBudgetThisYear || '');
        (() => {
          const [s, e] = parseReportTotalPeriod(project.reportTotalPeriod || '');
          setReportPeriodStart(s);
          setReportPeriodEnd(e);
        })();
        setReportNameShort(project.reportNameShort || '');
        setReportNameFull(project.reportNameFull || '');
      } else {
        setName('');
        setDescription('');
        setStartDate('');
        setEndDate('');
        setAssignments([]);
        setMinWorkEffortDays('');
        setWorkEffortUnit('day');
        setReportCategory('');
        setReportAgency('');
        setReportBudgetThisYear('');
        setReportPeriodStart('');
        setReportPeriodEnd('');
        setReportNameShort('');
        setReportNameFull('');
      }
      setMonthlyExpandedIndex(null);
    }
  }, [isOpen, project]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
          target.blur();
        } else {
          onClose();
        }
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const [formError, setFormError] = useState<string | null>(null);

  // 에러 메시지 자동 해제 (5초)
  useEffect(() => {
    if (!formError) return;
    const t = setTimeout(() => setFormError(null), 5000);
    return () => clearTimeout(t);
  }, [formError]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!name.trim()) return;
    if (startDate && endDate && startDate > endDate) {
      setFormError('종료일은 시작일보다 이후여야 합니다.');
      return;
    }
    const parsedMin = minWorkEffortDays.trim() ? parseFloat(minWorkEffortDays) : undefined;
    if (parsedMin !== undefined && (Number.isNaN(parsedMin) || parsedMin < 0)) {
      setFormError('최소 공수 기준은 0 이상의 숫자를 입력해 주세요.');
      return;
    }
    const totalPeriodStr = formatReportTotalPeriod(reportPeriodStart, reportPeriodEnd);
    onSave(
      name,
      description,
      startDate || undefined,
      endDate || undefined,
      assignments.length > 0 ? assignments : undefined,
      parsedMin,
      normalizeWorkEffortUnit(workEffortUnit),
      reportCategory || undefined,
      reportAgency || undefined,
      reportBudgetThisYear || undefined,
      totalPeriodStr || undefined,
      reportNameShort || undefined,
      reportNameFull || undefined,
    );
    onClose();
  };

  const addAssignment = () => setAssignments((prev) => [...prev, { assignee: '', allocationPercent: 100 }]);
  const removeAssignment = (index: number) => setAssignments((prev) => prev.filter((_, i) => i !== index));
  const updateAssignment = (index: number, field: 'assignee' | 'allocationPercent', value: string | number) => {
    setAssignments((prev) => {
      const next = [...prev];
      if (!next[index]) return prev;
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };
  const updateMonthlyAllocation = (index: number, yearMonth: string, percent: number) => {
    setAssignments((prev) => {
      const next = [...prev];
      if (!next[index]) return prev;
      const base = next[index].allocationPercent;
      const nextMonthly = { ...(next[index].monthlyAllocations || {}), [yearMonth]: percent };
      if (percent === base) {
        delete nextMonthly[yearMonth];
        next[index] = { ...next[index], monthlyAllocations: Object.keys(nextMonthly).length ? nextMonthly : undefined };
      } else {
        next[index] = { ...next[index], monthlyAllocations: nextMonthly };
      }
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="bg-glass-elevated rounded-[20px] shadow-[0_8px_40px_-12px_rgba(0,0,0,0.2)] w-full max-w-3xl overflow-hidden animate-in fade-in zoom-in-95 duration-300 border border-[var(--color-line)] max-h-[calc(100vh-2rem)] flex flex-col">
        <div className="flex justify-between items-center p-6 border-b border-slate-200/50 bg-[var(--color-surface)]/40">
          <h2 className="text-xl font-extrabold tracking-tight text-[var(--color-ink)]">{project ? '프로젝트 수정' : '새 프로젝트'}</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--color-surface)]/60 rounded-full transition-all text-slate-400 hover:text-slate-800 hover:rotate-90 duration-300"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6">
          {/* 필수 */}
          <section className="border border-amber-200/80 rounded-xl p-4 bg-amber-50/50 space-y-4">
            <h3 className="text-xs font-bold text-amber-800 uppercase tracking-wider flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-amber-500 text-white text-[10px]">필수</span>
              필수 입력
            </h3>
            <div>
              <label className="block text-[10px] font-bold text-stone-600 uppercase tracking-wider mb-1.5">
                프로젝트 이름 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input-field w-full max-w-xl"
                placeholder="프로젝트 이름을 입력하세요..."
                autoFocus
              />
            </div>
          </section>

          {/* 선택: 기본 정보 */}
          <section className="border border-stone-200 rounded-xl p-4 bg-slate-50/60 space-y-4">
            <h3 className="text-xs font-bold text-stone-500 uppercase tracking-wider flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-stone-400 text-white text-[10px]">선택</span>
              기본 정보 (선택)
            </h3>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-[10px] font-semibold text-stone-500 mb-1.5">설명</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="input-field min-h-[80px] w-full"
                  placeholder="프로젝트 설명을 입력하세요 (선택 사항)..."
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-semibold text-stone-500 mb-1.5">프로젝트 시작일</label>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input-field w-full" />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-stone-500 mb-1.5">프로젝트 종료일</label>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input-field w-full" />
                </div>
              </div>
              <p className="text-[10px] text-stone-400 -mt-2">WBS 작업은 이 기간 범위를 벗어날 수 없습니다. (선택 사항)</p>
              <div className="max-w-xs">
                <label className="block text-[10px] font-semibold text-stone-500 mb-1.5">작업 최소 공수 기준 (일)</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={minWorkEffortDays}
                  onChange={(e) => setMinWorkEffortDays(e.target.value)}
                  className="input-field w-full"
                  placeholder="예: 0.5, 1, 3 (선택 사항)"
                />
                <p className="text-[10px] text-stone-400 mt-1">WBS 작업 세부 분류에 사용됩니다. 0.5d, 1d, 3d 등 숫자로 입력.</p>
              </div>
              <div className="max-w-xs mt-3">
                <label className="block text-[10px] font-semibold text-stone-500 mb-1.5">작업 공수 단위</label>
                <select
                  value={normalizeWorkEffortUnit(workEffortUnit)}
                  onChange={(e) => setWorkEffortUnit(normalizeWorkEffortUnit(e.target.value))}
                  className="input-field w-full"
                >
                  {WORK_EFFORT_UNIT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-stone-400 mt-1">
                  표·간트의 공수 숫자 해석입니다. 일정은 8시간=1인일, 1주=5영업일로 환산합니다.
                </p>
              </div>
            </div>
          </section>

          {/* 선택: 주간보고용 */}
          <section className="border border-stone-200 rounded-xl p-4 bg-[var(--color-surface)]/60 space-y-3">
            <h3 className="text-xs font-bold text-stone-500 uppercase tracking-wider flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-stone-400 text-white text-[10px]">선택</span>
              주간보고용 프로젝트 정보
            </h3>
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="block text-[10px] font-semibold text-stone-500 mb-1.5">과제명 (약어)</label>
                <input
                  type="text"
                  list="project-report-name-short-list"
                  value={reportNameShort}
                  onChange={(e) => setReportNameShort(e.target.value)}
                  className="input-field w-full"
                  placeholder="예: AI스마트팩토리 연구 (입력 또는 아래 목록에서 선택)"
                />
                <datalist id="project-report-name-short-list">
                  {Array.from(new Set(allProjects.map((p) => p.reportNameShort).filter(Boolean))).map((v) => (
                    <option key={v} value={v!} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-stone-500 mb-1.5">전체과제명</label>
                <input
                  type="text"
                  list="project-report-name-full-list"
                  value={reportNameFull}
                  onChange={(e) => setReportNameFull(e.target.value)}
                  className="input-field w-full"
                  placeholder="예: 고하중 장조장 해저 케이블 생산을 위한 디지털 트윈 AI 팩토리 기술 개발 (입력 또는 선택)"
                />
                <datalist id="project-report-name-full-list">
                  {Array.from(new Set(allProjects.map((p) => p.reportNameFull).filter(Boolean))).map((v) => (
                    <option key={v} value={v!} />
                  ))}
                </datalist>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="block text-[10px] font-semibold text-stone-500 mb-1.5">구분</label>
                <input
                  type="text"
                  list="project-report-category-list"
                  value={reportCategory}
                  onChange={(e) => setReportCategory(e.target.value)}
                  className="input-field"
                  placeholder="예: 국책, 매출, 내부개발 등"
                />
                <datalist id="project-report-category-list">
                  {Array.from(new Set(allProjects.map((p) => p.reportCategory).filter(Boolean))).map((v) => (
                    <option key={v} value={v!} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-stone-500 mb-1.5">주관기관</label>
                <input
                  type="text"
                  list="project-report-agency-list"
                  value={reportAgency}
                  onChange={(e) => setReportAgency(e.target.value)}
                  className="input-field"
                  placeholder="예: KRISO, LS전선"
                />
                <datalist id="project-report-agency-list">
                  {Array.from(new Set(allProjects.map((p) => p.reportAgency).filter(Boolean))).map((v) => (
                    <option key={v} value={v!} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-stone-500 mb-1.5">금년도 정부출연금 / 예산</label>
                <input
                  type="text"
                  list="project-report-budget-list"
                  value={reportBudgetThisYear}
                  onChange={(e) => setReportBudgetThisYear(e.target.value)}
                  className="input-field"
                  placeholder="예: 6.0억, 2.7억(14.3억)"
                />
                <datalist id="project-report-budget-list">
                  {Array.from(new Set(allProjects.map((p) => p.reportBudgetThisYear).filter(Boolean))).map((v) => (
                    <option key={v} value={v!} />
                  ))}
                </datalist>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold text-stone-500 mb-1.5">전체기간 시작일</label>
                  <input
                    type="date"
                    value={reportPeriodStart}
                    onChange={(e) => setReportPeriodStart(e.target.value)}
                    className="input-field w-full"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-stone-500 mb-1.5">전체기간 종료일</label>
                  <input
                    type="date"
                    value={reportPeriodEnd}
                    onChange={(e) => setReportPeriodEnd(e.target.value)}
                    className="input-field w-full"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* 선택: 투입인원 */}
          <section className="border border-stone-200 rounded-xl p-4 bg-slate-50/60 space-y-4">
            <h3 className="text-xs font-bold text-stone-500 uppercase tracking-wider flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-stone-400 text-white text-[10px]">선택</span>
              프로젝트 투입인원 (투입비율)
            </h3>
            <div>
              <p className="text-[10px] text-stone-400 mb-2">
                이 프로젝트에 투입되는 인원과 비율을 설정합니다. 작업별 기간·공수 계산에 적용됩니다. 담당자 이름은 프로젝트 내에서만
                사용되며 필요 시 수정할 수 있습니다.
              </p>
              <div className="space-y-2">
                {assignments.map((a, i) => (
                  <div key={i} className="border border-stone-100 rounded-lg p-2.5 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={a.assignee}
                        onChange={(e) => updateAssignment(i, 'assignee', e.target.value)}
                        className="input-field flex-1 py-2 text-sm"
                        placeholder="담당자 이름"
                      />
                      <select
                        value={a.allocationPercent}
                        onChange={(e) => updateAssignment(i, 'allocationPercent', Number(e.target.value))}
                        className="input-field w-24 py-2 text-sm"
                        title="기본 투입비율 (월별 미설정 시 적용)"
                      >
                        {ALLOCATION_OPTIONS.map((pct) => (
                          <option key={pct} value={pct}>
                            {pct}%
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setMonthlyExpandedIndex(monthlyExpandedIndex === i ? null : i)}
                        className={cn(
                          'p-2 rounded text-stone-500 hover:bg-stone-100 transition-colors',
                          monthlyExpandedIndex === i && 'bg-teal-50 text-teal-600',
                        )}
                        title="기간별 월별 투입비율 설정"
                      >
                        <Calendar size={14} />
                      </button>
                      <button type="button" onClick={() => removeAssignment(i)} className="p-2 text-stone-400 hover:text-red-500 rounded">
                        <X size={14} />
                      </button>
                    </div>
                    {monthlyExpandedIndex === i && (
                      <div className="pt-2 border-t border-stone-100">
                        <p className="text-[10px] font-medium text-stone-500 mb-2">기간별 월별 투입비율 (미설정 시 기본 비율 적용)</p>
                        <div className="flex flex-wrap gap-2">
                          {projectMonths.map((ym) => {
                            const displayVal = a.monthlyAllocations?.[ym] ?? a.allocationPercent;
                            return (
                              <div key={ym} className="flex items-center gap-1">
                                <span className="text-[10px] text-stone-500 w-12">{ym}</span>
                                <select
                                  value={displayVal}
                                  onChange={(e) => updateMonthlyAllocation(i, ym, Number(e.target.value))}
                                  className="input-field py-1.5 text-xs w-16"
                                >
                                  {ALLOCATION_OPTIONS.map((pct) => (
                                    <option key={pct} value={pct}>
                                      {pct}%
                                    </option>
                                  ))}
                                </select>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={addAssignment}
                className="mt-2 text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
              >
                <Plus size={12} /> 인원 추가
              </button>
            </div>
          </section>
        </form>

        {formError && (
          <div className="mx-6 mb-2 px-4 py-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2 animate-in fade-in duration-200">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {formError}
          </div>
        )}
        <div className="flex justify-end gap-3 p-6 border-t border-slate-200/50 bg-[var(--color-surface)]/60 backdrop-blur sticky bottom-0">
          <button type="button" onClick={onClose} className="btn-ghost">
            취소
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              handleSubmit(e as unknown as React.FormEvent);
            }}
            disabled={!name.trim()}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {project ? '저장' : '프로젝트 생성'}
          </button>
        </div>
      </div>
    </div>
  );
}
