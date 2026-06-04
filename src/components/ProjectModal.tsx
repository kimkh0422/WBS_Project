import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, Plus, Calendar } from 'lucide-react';
import { Project, ProjectAssignment, type ProjectKind } from '../types';
import { DEFAULT_NEW_PROJECT_KIND, DEFAULT_PROJECT_KIND, PROJECT_KINDS, isPrivateProjectKind } from '../lib/projectKind';
import { ALLOCATION_OPTIONS } from '../lib/schedule';
import { clampAllocationPercentInt } from '../lib/personAllocations';
import { eachMonthOfInterval, format, parseISO, addMonths, startOfMonth } from 'date-fns';
import { cn } from '../lib/utils';
import { MODAL_BACKDROP_CLASS, MODAL_PANEL_BASE_CLASS } from '../lib/modalChrome';
import { normalizeWorkEffortUnit } from '../lib/workEffortUnits';
import { useOrganization } from '../context/OrganizationContext';
import { buildAssigneeCandidates, buildOrgMemberLabelMap } from '../lib/assigneeOptions';

interface ProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (
    name: string,
    description: string,
    /** 프로젝트 PM 표시 이름(조직 회원 이름 권장). 필수 — 공백 불가 */
    pmName: string,
    /** 프로젝트 PO 표시 이름(선택). 조직 회원 이름 권장 */
    poName: string,
    startDate?: string,
    endDate?: string,
    assignments?: ProjectAssignment[],
    minWorkEffortDays?: number,
    workEffortUnit?: Project['workEffortUnit'],
    projectKind?: ProjectKind,
    reportCategory?: string,
    reportAgency?: string,
    reportBudgetThisYear?: string,
    reportTotalPeriod?: string,
    reportNameShort?: string,
    reportNameFull?: string,
    /** false면 대시보드 집계·카드에 포함하지 않음(기본 true) */
    includeInDashboard?: boolean,
  ) => void;
  project?: Project | null;
  /** 기존 프로젝트 목록(담당자·PM 자동완성 후보) */
  allProjects?: Project[];
  /** 새 프로젝트일 때 PM 입력란 초기값(보통 생성자 표시명). 저장 전까지 수정 가능 */
  defaultPmNameForNewProject?: string;
  /** 로그인 사용자 id. 소유자가 아닐 때「연습」「개인」항목은 선택 목록에서 제외 */
  currentUserId?: string;
}

export function ProjectModal({
  isOpen,
  onClose,
  onSave,
  project,
  allProjects = [],
  defaultPmNameForNewProject = '',
  currentUserId,
}: ProjectModalProps) {
  const { orgMembers } = useOrganization();
  const [name, setName] = useState('');
  const [projectKind, setProjectKind] = useState<ProjectKind>(DEFAULT_NEW_PROJECT_KIND);
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [assignments, setAssignments] = useState<ProjectAssignment[]>([]);
  /** 투입비율 입력란: 저장 전까지 문자열로 두어 빈 칸·소수 입력이 막히지 않게 함 */
  const [allocPctInputs, setAllocPctInputs] = useState<string[]>([]);
  const [pmName, setPmName] = useState('');
  const [poName, setPoName] = useState('');
  /** 대시보드 집계·카드 포함 여부 — 신규는 기본 false(구분 필터·「대시보드에 반영」으로 포함) */
  const [includeInDashboard, setIncludeInDashboard] = useState(false);

  /** 월별 설정 펼친 인원 인덱스 (한 번에 하나만) */
  const [monthlyExpandedIndex, setMonthlyExpandedIndex] = useState<number | null>(null);

  /** 담당자 입력 DOM 참조 — Enter로 다음 행 자동 추가/포커스 */
  const assigneeInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  /** 담당자 추가 직후 포커스 잡을 인덱스 (effect로 처리) */
  const [pendingAssigneeFocusIndex, setPendingAssigneeFocusIndex] = useState<number | null>(null);

  /** 담당자 자동완성 후보: 조직 회원 + 다른 프로젝트 등록 인원 + 현재 입력 값들 */
  const assigneeCandidates = useMemo(
    () =>
      buildAssigneeCandidates({
        orgMembers,
        projects: allProjects,
        extra: [...assignments.map((a) => a.assignee).filter(Boolean), pmName.trim(), poName.trim()].filter(Boolean),
      }),
    [orgMembers, allProjects, assignments, pmName, poName],
  );
  const orgMemberLabelByName = useMemo(() => buildOrgMemberLabelMap(orgMembers), [orgMembers]);

  const projectKindOptions = useMemo(() => {
    const isNew = !project;
    const canPickPrivate = isNew || !project.ownerId || (!!currentUserId && project.ownerId === currentUserId);
    if (canPickPrivate) return PROJECT_KINDS;
    return PROJECT_KINDS.filter((k) => !isPrivateProjectKind(k));
  }, [project, currentUserId]);

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
        setProjectKind(project.projectKind ?? DEFAULT_PROJECT_KIND);
        setDescription(project.description || '');
        // type="date" 는 yyyy-MM-dd 만 허용. DB·ISO 문자열이면 잘려 보이지 않거나 변경이 반영되지 않는 것처럼 보일 수 있음
        setStartDate(project.startDate ? project.startDate.slice(0, 10) : '');
        setEndDate(project.endDate ? project.endDate.slice(0, 10) : '');
        const list = project.assignments?.length ? [...project.assignments] : [];
        setAssignments(list);
        setAllocPctInputs(list.map((a) => String(Number(a.allocationPercent ?? 100))));
        /** DB에 pm_name이 없는 구 프로젝트는 PM란이 비어 저장 버튼이 막힘 → 신규와 동일하게 표시명 기본값 사용 */
        setPmName(project.pmName?.trim() || defaultPmNameForNewProject.trim() || '');
        setPoName(project.poName?.trim() || '');
        setIncludeInDashboard(project.includeInDashboard !== false);
      } else {
        setName('');
        setProjectKind(DEFAULT_NEW_PROJECT_KIND);
        setDescription('');
        setStartDate('');
        setEndDate('');
        setAssignments([]);
        setAllocPctInputs([]);
        setPmName(defaultPmNameForNewProject.trim());
        setPoName('');
        setIncludeInDashboard(false);
      }
      setMonthlyExpandedIndex(null);
    }
  }, [isOpen, project, defaultPmNameForNewProject]);

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

  // 담당자 행 추가 직후 새 입력으로 포커스
  useEffect(() => {
    if (pendingAssigneeFocusIndex === null) return;
    const el = assigneeInputRefs.current[pendingAssigneeFocusIndex];
    if (el) el.focus();
    setPendingAssigneeFocusIndex(null);
  }, [pendingAssigneeFocusIndex, assignments.length]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!name.trim()) return;
    if (!pmName.trim()) {
      setFormError('프로젝트 PM을 입력해 주세요.');
      return;
    }
    if (startDate && endDate && startDate > endDate) {
      setFormError('종료일은 시작일보다 이후여야 합니다.');
      return;
    }
    for (let i = 0; i < assignments.length; i++) {
      const assignee = assignments[i].assignee.trim();
      const raw = (allocPctInputs[i] ?? '').trim();
      if (!assignee && raw !== '') {
        setFormError('담당자를 입력하지 않은 행에 투입비율이 있습니다. 담당자를 입력하거나 해당 행을 삭제해 주세요.');
        return;
      }
      if (assignee && raw === '') {
        setFormError(`「${assignee}」 담당자의 투입비율(%)을 입력해 주세요.`);
        return;
      }
    }
    const finalAssignments = assignments
      .map((a, i) => {
        const assignee = a.assignee.trim();
        if (!assignee) return null;
        const raw = (allocPctInputs[i] ?? String(a.allocationPercent ?? 100)).trim();
        const parsed = parseFloat(raw);
        const pct = !Number.isFinite(parsed) ? Number(a.allocationPercent ?? 100) : clampAllocationPercentInt(parsed);
        return { ...a, assignee, allocationPercent: pct };
      })
      .filter((a): a is ProjectAssignment => a != null);
    /** 모달에서 더 이상 편집하지 않음: 수정 시 기존 값 유지, 신규는 기본(최소공수 없음·일 단위) */
    const minDaysToSave = project?.minWorkEffortDays;
    const effortUnitToSave = normalizeWorkEffortUnit(project ? project.workEffortUnit : 'day');
    onSave(
      name,
      description,
      pmName.trim(),
      poName.trim(),
      startDate || undefined,
      endDate || undefined,
      finalAssignments.length > 0 ? finalAssignments : undefined,
      minDaysToSave,
      effortUnitToSave,
      projectKind,
      project?.reportCategory || undefined,
      project?.reportAgency || undefined,
      project?.reportBudgetThisYear || undefined,
      project?.reportTotalPeriod || undefined,
      project?.reportNameShort || undefined,
      project?.reportNameFull || undefined,
      includeInDashboard,
    );
    onClose();
  };

  const addAssignment = () => {
    setAssignments((prev) => [...prev, { assignee: '', allocationPercent: 0 }]);
    setAllocPctInputs((prev) => [...prev, '']);
  };
  /** 담당자 추가 후 새로 생긴 행의 입력으로 포커스 이동 */
  const addAssignmentAndFocus = () => {
    setAssignments((prev) => {
      setPendingAssigneeFocusIndex(prev.length);
      return [...prev, { assignee: '', allocationPercent: 0 }];
    });
    setAllocPctInputs((prev) => [...prev, '']);
  };
  const removeAssignment = (index: number) => {
    setAssignments((prev) => prev.filter((_, i) => i !== index));
    setAllocPctInputs((prev) => prev.filter((_, i) => i !== index));
  };
  const updateAssignment = (index: number, field: 'assignee' | 'allocationPercent', value: string | number) => {
    setAssignments((prev) => {
      const next = [...prev];
      if (!next[index]) return prev;
      next[index] = { ...next[index], [field]: value };
      return next;
    });
    if (field === 'assignee' && typeof value === 'string' && !value.trim()) {
      setAllocPctInputs((prev) => {
        const nextArr = [...prev];
        while (nextArr.length < assignments.length) nextArr.push('');
        nextArr[index] = '';
        return nextArr;
      });
    }
  };
  const updateMonthlyAllocation = (index: number, yearMonth: string, percent: number) => {
    const rounded = clampAllocationPercentInt(percent);
    setAssignments((prev) => {
      const next = [...prev];
      if (!next[index]) return prev;
      const base = next[index].allocationPercent;
      const nextMonthly = { ...(next[index].monthlyAllocations || {}), [yearMonth]: rounded };
      if (rounded === base) {
        delete nextMonthly[yearMonth];
        next[index] = { ...next[index], monthlyAllocations: Object.keys(nextMonthly).length ? nextMonthly : undefined };
      } else {
        next[index] = { ...next[index], monthlyAllocations: nextMonthly };
      }
      return next;
    });
  };

  return (
    <div className={MODAL_BACKDROP_CLASS}>
      <div
        className={cn(
          MODAL_PANEL_BASE_CLASS,
          'bg-glass-elevated rounded-[20px] max-w-3xl overflow-hidden max-h-[calc(100vh-2rem)] flex flex-col border-[var(--color-line)]',
        )}
      >
        <div className="flex justify-between items-center p-6 border-b border-[var(--color-line)] bg-[var(--color-surface)]/80 backdrop-blur-md">
          <h2 className="text-xl font-extrabold tracking-tight text-[var(--color-ink)]">{project ? '프로젝트 수정' : '새 프로젝트'}</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--color-bg)] rounded-full transition-all text-slate-400 hover:text-[var(--color-ink)] hover:rotate-90 duration-300"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5">
          {/* 필수 */}
          <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-bg)] p-5 shadow-sm space-y-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink)]">
              <span className="inline-flex h-6 min-w-[1.75rem] items-center justify-center rounded-md bg-[var(--color-accent)] px-1.5 text-[11px] font-bold text-white shadow-sm">
                필수
              </span>
              필수 입력
            </h3>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-x-5">
              <div className="min-w-0 flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[var(--color-ink-subdued)]" htmlFor="project-modal-project-kind">
                  항목 <span className="font-normal text-[var(--color-danger)]">*</span>
                </label>
                <select
                  id="project-modal-project-kind"
                  value={projectKind}
                  onChange={(e) => setProjectKind(e.target.value as ProjectKind)}
                  disabled={!includeInDashboard}
                  required={includeInDashboard}
                  title={includeInDashboard ? undefined : '대시보드에 반영을 켜면 프로젝트 종류(항목)를 선택할 수 있습니다.'}
                  className={cn('input-field w-full', !includeInDashboard && 'cursor-not-allowed bg-slate-100/90 opacity-70')}
                >
                  {projectKindOptions.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                {!includeInDashboard && (
                  <p className="text-xs leading-relaxed text-[var(--color-ink-subdued)]">
                    항목을 바꾸려면 아래「대시보드에 반영」을 켜 주세요.
                  </p>
                )}
              </div>
              <div className="min-w-0 flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[var(--color-ink-subdued)]" htmlFor="project-modal-name">
                  프로젝트 이름 <span className="font-normal text-[var(--color-danger)]">*</span>
                </label>
                <input
                  id="project-modal-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input-field w-full"
                  placeholder="프로젝트 이름을 입력하세요..."
                  autoFocus
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-5 border-t border-[var(--color-line)] pt-5 sm:grid-cols-2 sm:gap-x-5">
              <div className="min-w-0 flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[var(--color-ink-subdued)]" htmlFor="project-modal-pm">
                  프로젝트 PM <span className="font-normal text-[var(--color-danger)]">*</span>
                </label>
                <input
                  id="project-modal-pm"
                  type="text"
                  list="project-modal-pm-po-assignees"
                  required
                  value={pmName}
                  onChange={(e) => setPmName(e.target.value)}
                  className="input-field w-full"
                  placeholder="이름 입력 또는 조직 회원에서 선택"
                  title="조직도에 등록된 이름과 같으면 대시보드에 직급이 함께 표시됩니다."
                />
                <p className="text-xs leading-relaxed text-[var(--color-ink-subdued)] max-w-prose">
                  과제·WBS 책임(PM). 작업「담당자」와는 별개입니다. 신규 프로젝트는 기본으로 생성자 이름이 들어갑니다.
                </p>
              </div>
              <div className="min-w-0 flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[var(--color-ink-subdued)]" htmlFor="project-modal-po">
                  프로젝트 PO <span className="font-normal opacity-60">(선택)</span>
                </label>
                <input
                  id="project-modal-po"
                  type="text"
                  list="project-modal-pm-po-assignees"
                  value={poName}
                  onChange={(e) => setPoName(e.target.value)}
                  className="input-field w-full"
                  placeholder="예: 제품 책임자 이름"
                  title="PO(예: Product Owner). 비워 두면 대시보드·목록에는 비어 있음으로 표시됩니다."
                />
                <p className="text-xs leading-relaxed text-[var(--color-ink-subdued)] max-w-prose">
                  요구·백로그·우선순위 등을 맡는 역할로 쓸 수 있습니다. 비워 두어도 됩니다.
                </p>
              </div>
            </div>
            <datalist id="project-modal-pm-po-assignees">
              {assigneeCandidates.map((name) => {
                const label = orgMemberLabelByName.get(name);
                return label ? <option key={name} value={name} label={label} /> : <option key={name} value={name} />;
              })}
            </datalist>
          </section>

          {/* 선택: 기본 정보 */}
          <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-bg)] p-5 shadow-sm space-y-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink)]">
              <span className="inline-flex h-6 min-w-[1.75rem] items-center justify-center rounded-md bg-slate-500 px-1.5 text-[11px] font-bold text-white shadow-sm">
                선택
              </span>
              기본 정보 (선택)
            </h3>
            <div className="grid grid-cols-1 gap-5">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[var(--color-ink-subdued)]" htmlFor="project-modal-description">
                  설명
                </label>
                <textarea
                  id="project-modal-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="input-field min-h-[88px] w-full"
                  placeholder="프로젝트 설명을 입력하세요 (선택 사항)..."
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="min-w-0 flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-[var(--color-ink-subdued)]" htmlFor="project-modal-start">
                    프로젝트 시작일
                  </label>
                  <input
                    id="project-modal-start"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="input-field w-full"
                  />
                </div>
                <div className="min-w-0 flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-[var(--color-ink-subdued)]" htmlFor="project-modal-end">
                    프로젝트 종료일
                  </label>
                  <input
                    id="project-modal-end"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="input-field w-full"
                  />
                </div>
              </div>
              <p className="text-xs leading-relaxed text-[var(--color-ink-subdued)] -mt-1">
                프로젝트 기간은 참고·요약·투입 집계 등에 쓰이며, 작업 일정은 이 범위와 달라도 입력한 대로 저장됩니다. (미입력 시 기간 제한
                없음)
              </p>
              <div className="flex gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3.5">
                <input
                  id="project-modal-include-dashboard"
                  type="checkbox"
                  checked={includeInDashboard}
                  onChange={(e) => setIncludeInDashboard(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
                />
                <div className="min-w-0 flex-1">
                  <label htmlFor="project-modal-include-dashboard" className="cursor-pointer text-sm font-semibold text-[var(--color-ink)]">
                    대시보드에 반영
                  </label>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--color-ink-subdued)]">
                    켜면 요약·집계·프로젝트 카드에 포함될 수 있습니다. 끄면 대시보드에서는 숨기고, WBS·간트 등 작업 화면에는 그대로
                    표시됩니다.
                  </p>
                  <details className="mt-2 group">
                    <summary className="cursor-pointer list-none text-xs font-medium text-[var(--color-accent)] hover:opacity-80 [&::-webkit-details-marker]:hidden">
                      <span className="underline-offset-2 group-open:underline">구분 필터와 항목 선택 안내</span>
                    </summary>
                    <p className="mt-2 border-l-2 border-[var(--color-line)] pl-3 text-xs leading-relaxed text-[var(--color-ink-subdued)]">
                      대시보드 상단「구분」에서 해당 구분이 켜져 있어야 집계에 포함됩니다. 항목(종류) 드롭다운은 이 옵션을 켠 뒤에만 변경할
                      수 있습니다.
                    </p>
                  </details>
                </div>
              </div>
            </div>
          </section>

          {/* 선택: 투입인원 */}
          <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-bg)] p-5 shadow-sm space-y-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink)]">
              <span className="inline-flex h-6 min-w-[1.75rem] items-center justify-center rounded-md bg-slate-500 px-1.5 text-[11px] font-bold text-white shadow-sm">
                선택
              </span>
              프로젝트 투입인원 (투입비율)
            </h3>
            <div>
              <p className="mb-3 text-xs leading-relaxed text-[var(--color-ink-subdued)] max-w-prose">
                투입 인원과 비율은 작업별 기간·공수 계산에 반영됩니다. 담당자 이름은 이 프로젝트 안에서만 쓰이며 필요 시 바꿀 수 있습니다.
              </p>
              <div className="space-y-2">
                {assignments.map((a, i) => (
                  <div key={i} className="border border-[var(--color-line)] rounded-lg p-2.5 space-y-2 bg-[var(--color-surface)]">
                    <div className="flex items-center gap-2">
                      <input
                        ref={(el) => {
                          assigneeInputRefs.current[i] = el;
                        }}
                        type="text"
                        list="project-modal-assignees"
                        value={a.assignee}
                        onChange={(e) => {
                          updateAssignment(i, 'assignee', e.target.value);
                        }}
                        onKeyDown={(e) => {
                          // Enter: 다음 인원 입력으로 이동(없으면 새 행 추가). 한글 조합 중에는 무시.
                          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            if (i < assignments.length - 1) {
                              assigneeInputRefs.current[i + 1]?.focus();
                            } else {
                              addAssignmentAndFocus();
                            }
                          }
                        }}
                        className="input-field flex-1 py-2 text-sm"
                        placeholder="담당자 이름 (조직 회원에서 검색 또는 직접 입력)"
                        title="조직 회원 목록에서 선택하거나 직접 입력. Enter로 다음 인원 추가."
                      />
                      <input
                        type="text"
                        inputMode="numeric"
                        disabled={!a.assignee.trim()}
                        className={cn('input-field w-20 py-2 text-sm', !a.assignee.trim() && 'opacity-50 cursor-not-allowed bg-slate-50')}
                        value={allocPctInputs[i] ?? (a.assignee.trim() ? String(Number(a.allocationPercent ?? 100)) : '')}
                        placeholder="%"
                        onChange={(e) => {
                          if (!a.assignee.trim()) return;
                          const next = e.target.value;
                          if (next !== '' && !/^\d*$/.test(next)) return;
                          setAllocPctInputs((prev) => {
                            const nextArr = [...prev];
                            while (nextArr.length < assignments.length) {
                              const row = assignments[nextArr.length];
                              nextArr.push(row?.assignee.trim() ? String(Number(row.allocationPercent ?? 100)) : '');
                            }
                            nextArr[i] = next;
                            return nextArr;
                          });
                        }}
                        onBlur={() => {
                          if (!a.assignee.trim()) {
                            setAllocPctInputs((prev) => {
                              const nextArr = [...prev];
                              while (nextArr.length < assignments.length) nextArr.push('');
                              nextArr[i] = '';
                              return nextArr;
                            });
                            return;
                          }
                          const raw = (allocPctInputs[i] ?? String(a.allocationPercent ?? 100)).trim();
                          if (raw === '') return;
                          const parsed = parseFloat(raw);
                          const safe = !Number.isFinite(parsed) ? Number(a.allocationPercent ?? 100) : clampAllocationPercentInt(parsed);
                          updateAssignment(i, 'allocationPercent', safe);
                          setAllocPctInputs((prev) => {
                            const nextArr = [...prev];
                            while (nextArr.length < assignments.length) nextArr.push('');
                            nextArr[i] = String(safe);
                            return nextArr;
                          });
                        }}
                        title={
                          a.assignee.trim()
                            ? '기본 투입비율 (0~100% 정수. 월별 미설정 시 적용)'
                            : '담당자를 먼저 입력한 뒤 투입비율을 입력하세요'
                        }
                      />
                      <button
                        type="button"
                        onClick={() => setMonthlyExpandedIndex(monthlyExpandedIndex === i ? null : i)}
                        className={cn(
                          'p-2 rounded hover:bg-[var(--color-bg)] transition-colors',
                          monthlyExpandedIndex === i ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'text-slate-500',
                        )}
                        title="기간별 월별 투입비율 설정"
                      >
                        <Calendar size={14} />
                      </button>
                      <button type="button" onClick={() => removeAssignment(i)} className="p-2 text-slate-400 hover:text-red-500 rounded">
                        <X size={14} />
                      </button>
                    </div>
                    {monthlyExpandedIndex === i && (
                      <div className="pt-2 border-t border-slate-100">
                        <p className="mb-2 text-xs font-medium text-slate-600">기간별 월별 투입비율 (미설정 시 기본 비율 적용)</p>
                        <div className="flex flex-wrap gap-2">
                          {projectMonths.map((ym) => {
                            const displayVal = a.monthlyAllocations?.[ym] ?? a.allocationPercent;
                            const displayNum = clampAllocationPercentInt(
                              typeof displayVal === 'number' && Number.isFinite(displayVal) ? displayVal : 100,
                            );
                            return (
                              <div key={ym} className="flex items-center gap-1">
                                <span className="text-[10px] text-slate-500 w-12">{ym}</span>
                                <select
                                  value={displayNum}
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
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-[var(--color-accent)] hover:bg-[var(--color-bg)] transition-colors"
              >
                <Plus size={14} strokeWidth={2.25} aria-hidden /> 인원 추가
              </button>
              {/* 모든 인원 입력이 공유하는 자동완성 후보 */}
              <datalist id="project-modal-assignees">
                {assigneeCandidates.map((name) => {
                  const label = orgMemberLabelByName.get(name);
                  return label ? <option key={name} value={name} label={label} /> : <option key={name} value={name} />;
                })}
              </datalist>
            </div>
          </section>
        </form>

        {formError && (
          <div className="mx-6 mb-2 px-4 py-2.5 rounded-lg bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/20 text-[var(--color-danger)] text-sm flex items-center gap-2 animate-in fade-in duration-200">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {formError}
          </div>
        )}
        <div className="flex justify-end gap-3 p-6 border-t border-[var(--color-line)] bg-[var(--color-surface)]/80 backdrop-blur sticky bottom-0">
          <button type="button" onClick={onClose} className="btn-ghost">
            취소
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              handleSubmit(e as unknown as React.FormEvent);
            }}
            disabled={!name.trim() || !pmName.trim()}
            title={
              !name.trim()
                ? '프로젝트 이름을 입력하면 저장할 수 있습니다.'
                : !pmName.trim()
                  ? '프로젝트 PM을 입력하면 저장할 수 있습니다. (대시보드 반영만으로는 저장이 켜지지 않습니다.)'
                  : undefined
            }
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {project ? '저장' : '프로젝트 생성'}
          </button>
        </div>
      </div>
    </div>
  );
}
