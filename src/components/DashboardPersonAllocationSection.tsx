import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Briefcase, ChevronDown, ChevronRight, ExternalLink, Info, LayoutGrid, Table2 } from 'lucide-react';
import type { DashboardSectionLayoutMode } from '../lib/dashboardSectionLayout';
import { useWBS } from '../context/WBSContext';
import { useOrganization } from '../context/OrganizationContext';
import { cn, formatPercent1 } from '../lib/utils';
import { formatEffortFromManDays } from '../lib/workEffortUnits';
import {
  formatPersonWorkEffortRowDisplay,
  isUnassignedDivisionSplitPersonKey,
  parseDivisionIdFromUnassignedSplitKey,
  type AllocationDivisionInferInput,
} from '../lib/allocationDivisionInfer';
import {
  computePersonAllocations,
  computePersonProjectWorkEffort,
  computePersonWorkEffortAllocationsFromTasks,
  computePersonWorkEffortWeightedProgressPct,
  computeProjectAllocations,
  splitUnassignedPersonWorkEffortByInferredDivision,
  type PersonWorkEffortAllocation,
} from '../lib/personAllocations';
import { buildOrgMemberLabelMap, buildOrgMemberDisplayMetaMap, type PersonDisplayMeta } from '../lib/assigneeOptions';
import { compareAssigneeByPositionThenName } from '../lib/orgMemberSort';
import { formatProjectDisplayName } from '../lib/projectKind';
import { PersonAllocationDetailPanel } from './PersonAllocationDetailPanel';
import { BaseModal } from './Base/Modal';
import type { Project, Task } from '../types';

const EFFORT_DISPLAY_UNIT: 'mm' | 'md' = 'mm';

type PersonAllocationQuickFilter = { mode: 'all' } | { mode: 'division_scope'; divisionId: string; label?: string };

interface DivisionBriefBlock {
  key: string;
  title: string;
  rows: PersonWorkEffortAllocation[];
}

function sortAllocationRowsByPositionThenName<T extends { person: string }>(
  rows: T[],
  displayMetaByName: Map<string, PersonDisplayMeta>,
): T[] {
  return [...rows].sort((a, b) => compareAssigneeByPositionThenName(a.person, b.person, (name) => displayMetaByName.get(name)?.position));
}

function buildDivisionBriefBlocks(
  allocations: PersonWorkEffortAllocation[],
  topLevelDivisions: Array<{ id: string; name: string }> | undefined,
  assigneeTopDivisionIdByName: Map<string, string> | undefined,
  departmentByPerson: Map<string, string>,
  displayMetaByName: Map<string, PersonDisplayMeta>,
): DivisionBriefBlock[] {
  const alloc = [...allocations];

  const useOrgDivisions = (topLevelDivisions?.length ?? 0) > 0 && assigneeTopDivisionIdByName && assigneeTopDivisionIdByName.size > 0;

  if (useOrgDivisions && topLevelDivisions && assigneeTopDivisionIdByName) {
    const bucket = new Map<string, typeof alloc>();
    for (const d of topLevelDivisions) bucket.set(d.id, []);
    const unmapped: typeof alloc = [];

    for (const row of alloc) {
      const divId = assigneeTopDivisionIdByName.get(row.person);
      const list = divId != null ? bucket.get(divId) : undefined;
      if (list) list.push(row);
      else unmapped.push(row);
    }

    const blocks: DivisionBriefBlock[] = [];
    for (const d of topLevelDivisions) {
      const rows = sortAllocationRowsByPositionThenName(bucket.get(d.id) ?? [], displayMetaByName);
      if (rows.length > 0) blocks.push({ key: d.id, title: d.name, rows });
    }
    if (unmapped.length > 0) {
      blocks.push({
        key: '__unmapped__',
        title: '사업부 미매핑',
        rows: sortAllocationRowsByPositionThenName(unmapped, displayMetaByName),
      });
    }
    return blocks;
  }

  const deptMap = new Map<string, typeof alloc>();
  for (const row of alloc) {
    const raw = (departmentByPerson.get(row.person) ?? '').trim();
    const label = raw.length > 0 ? raw : '소속 미등록';
    if (!deptMap.has(label)) deptMap.set(label, []);
    deptMap.get(label)!.push(row);
  }
  const labels = [...deptMap.keys()].sort((a, b) => a.localeCompare(b, 'ko'));
  return labels.map((label) => ({
    key: `dept:${label}`,
    title: label,
    rows: sortAllocationRowsByPositionThenName(deptMap.get(label)!, displayMetaByName),
  }));
}

/** 카드 보기: 섹션 제목(사업부·부서)과 동일한 접두어는 한 줄에서 생략해 중복을 줄입니다. */
function shortenPersonRowLabelForSection(fullLabel: string, sectionTitle: string): string {
  const t = sectionTitle.trim();
  if (!t) return fullLabel;
  const prefixed = `${t} `;
  if (fullLabel.startsWith(prefixed)) {
    const rest = fullLabel.slice(prefixed.length).trim();
    return rest.length > 0 ? rest : fullLabel;
  }
  return fullLabel;
}

interface DashboardPersonAllocationSectionProps {
  projects: Project[];
  allTasks: Task[];
  profileMap?: Record<string, string>;
  /** 호환용(대시보드에서 전달). 이 섹션에서는 사용하지 않습니다. */
  registeredMemberDisplayNames?: Set<string>;
  showFilterHint?: boolean;
  assigneeTopDivisionIdByName?: Map<string, string>;
  /** 조직도 최상위 사업부 — 있으면 이 순서로 묶습니다. */
  topLevelDivisions?: Array<{ id: string; name: string }>;
  allocationFocusDivisionId?: string | null;
  allocationFocusDivisionLabel?: string | null;
  onNavigateToWork?: (projectId: string) => void;
  /** 제공 시 상단에서「투입현황」전용 화면(프로젝트별·비율 편집)으로 이동 */
  onOpenAllocationOverview?: () => void;
  /** PM·PO·소유자 부서로 담당 미지정 공수를 사업부별로 자동 나눔(조직도·부서 맵이 있을 때만) */
  allocationDivisionInfer?: AllocationDivisionInferInput;
  narrowScreenLayout?: boolean;
  /** 대시보드 본문 표시 방식(설정과 동기). 상세 모달 등에서는 생략·embedded 권장 */
  sectionLayout?: DashboardSectionLayoutMode;
  onSectionLayoutChange?: (mode: DashboardSectionLayoutMode) => void;
  showSectionLayoutToggle?: boolean;
  /** 상세 페이지/모달 안: 큰 제목·표시 전환 숨김 */
  variant?: 'dashboard' | 'embedded';
}

export function DashboardPersonAllocationSection({
  projects,
  allTasks,
  profileMap,
  showFilterHint,
  assigneeTopDivisionIdByName,
  topLevelDivisions,
  allocationFocusDivisionId,
  allocationFocusDivisionLabel,
  onNavigateToWork,
  onOpenAllocationOverview,
  allocationDivisionInfer,
  narrowScreenLayout = false,
  sectionLayout = 'card',
  onSectionLayoutChange,
  showSectionLayoutToggle,
  variant = 'dashboard',
}: DashboardPersonAllocationSectionProps) {
  const { wbsSettings } = useWBS();
  const { orgMembers } = useOrganization();
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  const [personAllocationQuickFilter, setPersonAllocationQuickFilter] = useState<PersonAllocationQuickFilter>({
    mode: 'all',
  });
  const appliedAllocationFocusFromUrlRef = useRef<string | null>(null);

  const [collapsedBlockKeys, setCollapsedBlockKeys] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!allocationFocusDivisionId?.trim() || !assigneeTopDivisionIdByName?.size) {
      appliedAllocationFocusFromUrlRef.current = null;
      return;
    }
    if (appliedAllocationFocusFromUrlRef.current === allocationFocusDivisionId) return;
    appliedAllocationFocusFromUrlRef.current = allocationFocusDivisionId;
    setPersonAllocationQuickFilter({
      mode: 'division_scope',
      divisionId: allocationFocusDivisionId.trim(),
      label: allocationFocusDivisionLabel?.trim() || undefined,
    });
  }, [allocationFocusDivisionId, allocationFocusDivisionLabel, assigneeTopDivisionIdByName]);

  const projectAllocations = useMemo(() => computeProjectAllocations(projects), [projects]);
  const personAllocations = useMemo(() => computePersonAllocations(projectAllocations), [projectAllocations]);
  const personProjectWorkEffort = useMemo(() => computePersonProjectWorkEffort(allTasks), [allTasks]);
  const personWorkEffortAllocations = useMemo(() => computePersonWorkEffortAllocationsFromTasks(projects, allTasks), [projects, allTasks]);

  const divisionNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of topLevelDivisions ?? []) {
      if (d.id) m.set(d.id, d.name);
    }
    return m;
  }, [topLevelDivisions]);

  const allocationOrgLabelByName = useMemo(() => buildOrgMemberLabelMap(orgMembers), [orgMembers]);
  const allocationDisplayMetaByName = useMemo(() => buildOrgMemberDisplayMetaMap(orgMembers), [orgMembers]);

  const departmentByPerson = useMemo(() => {
    const m = new Map<string, string>();
    for (const [name, meta] of allocationDisplayMetaByName) {
      m.set(name, (meta.department ?? '').trim());
    }
    return m;
  }, [allocationDisplayMetaByName]);

  const personWorkEffortWithInferSplit = useMemo(() => {
    if (!assigneeTopDivisionIdByName?.size || !allocationDivisionInfer) return personWorkEffortAllocations;
    return splitUnassignedPersonWorkEffortByInferredDivision(personWorkEffortAllocations, allocationDivisionInfer);
  }, [personWorkEffortAllocations, assigneeTopDivisionIdByName, allocationDivisionInfer]);

  const personWorkEffortForDisplay = useMemo(() => {
    if (personAllocationQuickFilter.mode !== 'division_scope' || !assigneeTopDivisionIdByName?.size) {
      return personWorkEffortWithInferSplit;
    }
    const id = personAllocationQuickFilter.divisionId;
    return personWorkEffortWithInferSplit.filter((r) => {
      const mapped = assigneeTopDivisionIdByName.get(r.person);
      if (mapped === id) return true;
      if (isUnassignedDivisionSplitPersonKey(r.person) && parseDivisionIdFromUnassignedSplitKey(r.person) === id) return true;
      return false;
    });
  }, [personWorkEffortWithInferSplit, personAllocationQuickFilter, assigneeTopDivisionIdByName]);

  const divisionBlocks = useMemo(
    () =>
      buildDivisionBriefBlocks(
        personWorkEffortForDisplay,
        topLevelDivisions,
        assigneeTopDivisionIdByName,
        departmentByPerson,
        allocationDisplayMetaByName,
      ),
    [personWorkEffortForDisplay, topLevelDivisions, assigneeTopDivisionIdByName, departmentByPerson, allocationDisplayMetaByName],
  );

  useEffect(() => {
    if (!selectedPerson) return;
    if (!personWorkEffortForDisplay.some((r) => r.person === selectedPerson)) setSelectedPerson(null);
  }, [selectedPerson, personWorkEffortForDisplay]);

  const filterHintSuffix = showFilterHint ? ' · 상단 필터에 맞춘 프로젝트만 집계합니다.' : '';

  const helpBullets = useMemo(() => {
    const lines = [
      '담당·공수(workEffort>0)가 있는 WBS만 M/M로 합산합니다. 이름은 상세, 프로젝트는 작업 표로 이동합니다.',
      '진척률은 공수 가중 평균(Σ공수×진척%÷Σ공수)입니다. 프로젝트「투입 인원」비율과는 별개입니다.',
    ];
    if (allocationDivisionInfer && assigneeTopDivisionIdByName?.size) {
      lines.push('담당 미지정 공수는 PM·PO·소유자 부서로 사업부만 추정 분할합니다(담당 필드는 그대로).');
    }
    const tail = filterHintSuffix.trim();
    return tail ? [...lines, tail] : lines;
  }, [assigneeTopDivisionIdByName, allocationDivisionInfer, filterHintSuffix]);

  const toggleBlockCollapsed = (key: string) => {
    setCollapsedBlockKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const totalPeople = personWorkEffortForDisplay.length;

  const allocationItemsForDetail = useMemo(() => {
    if (!selectedPerson) return [];
    if (isUnassignedDivisionSplitPersonKey(selectedPerson)) {
      const ids = new Set(personWorkEffortForDisplay.find((r) => r.person === selectedPerson)?.items.map((i) => i.project.id) ?? []);
      return personAllocations.find((r) => r.person === '(미지정)')?.items.filter((i) => ids.has(i.project.id)) ?? [];
    }
    return personAllocations.find((r) => r.person === selectedPerson)?.items ?? [];
  }, [selectedPerson, personWorkEffortForDisplay, personAllocations]);

  const allocationProjectIdFilterForDetail = useMemo(() => {
    if (!selectedPerson || !isUnassignedDivisionSplitPersonKey(selectedPerson)) return undefined;
    const row = personWorkEffortForDisplay.find((r) => r.person === selectedPerson);
    return new Set(row?.items.map((i) => i.project.id) ?? []);
  }, [selectedPerson, personWorkEffortForDisplay]);

  const canShowLayoutToggle = variant === 'dashboard' && Boolean(onSectionLayoutChange) && showSectionLayoutToggle !== false;

  return (
    <div className="dashboard-person-allocation">
      {variant === 'dashboard' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h2 className="text-lg md:text-xl font-bold text-[var(--color-ink)] flex items-center gap-2 flex-wrap m-0">
              <Briefcase className="text-[var(--color-accent)] shrink-0" size={20} aria-hidden />
              인원·사업부 투입공수
              <span className="text-sm font-normal text-stone-500 ml-1 tabular-nums">({totalPeople}명)</span>
            </h2>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {canShowLayoutToggle && (
                <div
                  className="inline-flex gap-0.5 rounded-lg border border-stone-200 bg-white p-0.5 shrink-0"
                  role="group"
                  aria-label="투입공수 표 또는 카드 보기"
                >
                  <button
                    type="button"
                    onClick={() => onSectionLayoutChange?.('table')}
                    className={cn(
                      'px-2 py-1 text-[11px] font-semibold rounded-md transition-colors inline-flex items-center gap-1',
                      sectionLayout === 'table' ? 'bg-slate-700 text-white' : 'text-stone-600 hover:bg-stone-50',
                    )}
                    title="표로 보기"
                  >
                    <Table2 size={12} aria-hidden />표
                  </button>
                  <button
                    type="button"
                    onClick={() => onSectionLayoutChange?.('card')}
                    className={cn(
                      'px-2 py-1 text-[11px] font-semibold rounded-md transition-colors inline-flex items-center gap-1',
                      sectionLayout === 'card' ? 'bg-slate-700 text-white' : 'text-stone-600 hover:bg-stone-50',
                    )}
                    title="카드로 보기"
                  >
                    <LayoutGrid size={12} aria-hidden />
                    카드
                  </button>
                </div>
              )}
              {onOpenAllocationOverview ? (
                <button
                  type="button"
                  onClick={onOpenAllocationOverview}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-stone-700 hover:bg-stone-50 transition-colors"
                  title="프로젝트별·인원별 투입 비율을 편집하고 한눈에 보려면"
                >
                  <ExternalLink size={12} className="shrink-0 opacity-80" aria-hidden />
                  투입현황
                </button>
              ) : null}
            </div>
          </div>
        </>
      )}
      {variant === 'embedded' && onOpenAllocationOverview ? (
        <div className="flex justify-end mb-2">
          <button
            type="button"
            onClick={onOpenAllocationOverview}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-stone-700 hover:bg-stone-50 transition-colors"
            title="투입현황 화면으로 이동"
          >
            <ExternalLink size={12} aria-hidden />
            투입현황
          </button>
        </div>
      ) : null}

      {personAllocationQuickFilter.mode === 'division_scope' && (
        <div
          className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-teal-200 bg-teal-50/85 px-3 py-2.5 text-sm text-teal-950"
          role="status"
        >
          <p className="m-0 min-w-0 leading-snug">
            <span className="font-semibold">{personAllocationQuickFilter.label?.trim() || '선택 사업부'}</span>
            <span className="text-teal-900/90"> 소속 인원만 · 「사업부별 등록 프로젝트·업무 현황」과 동일 매핑</span>
          </p>
          <button
            type="button"
            onClick={() => setPersonAllocationQuickFilter({ mode: 'all' })}
            className="shrink-0 rounded-lg border border-teal-300/90 bg-white px-2.5 py-1 text-[11px] font-semibold text-teal-900 hover:bg-teal-50"
          >
            필터 해제
          </button>
        </div>
      )}

      <details className="group mb-3 rounded-lg border border-stone-200/80 bg-stone-50/50 px-3 py-2 text-[13px]">
        <summary className="cursor-pointer list-none text-stone-700 [&::-webkit-details-marker]:hidden flex items-center gap-2 select-none font-medium">
          <Info className="h-3.5 w-3.5 text-indigo-500 shrink-0" aria-hidden />
          집계 안내
          <span className="text-[10px] font-semibold text-stone-400 group-open:hidden">▼</span>
        </summary>
        <ul className="mt-2 space-y-1 pl-5 text-stone-600 leading-snug border-t border-stone-200/60 pt-2 list-disc text-[12px] marker:text-indigo-400">
          {helpBullets.map((line, idx) => (
            <li key={`allocation-help-${idx}`} className="pl-0.5">
              {line}
            </li>
          ))}
        </ul>
      </details>

      {personWorkEffortAllocations.length === 0 ? (
        <div className="text-sm text-stone-400 bg-white border border-stone-200 rounded-xl p-6 text-center">
          {projects.length === 0
            ? '표시할 프로젝트가 없습니다.'
            : '표시 중인 프로젝트 작업에 투입공수(workEffort)가 입력된 담당 배정이 없습니다.'}
        </div>
      ) : divisionBlocks.length === 0 ? (
        <div className="text-sm text-stone-500 bg-white border border-stone-200 rounded-xl p-6 text-center">
          이 범위에 해당하는 인원이 없습니다.
        </div>
      ) : sectionLayout === 'table' ? (
        <div className={cn('space-y-4', narrowScreenLayout && 'max-w-full')}>
          {divisionBlocks.map((block) => {
            const collapsed = collapsedBlockKeys.has(block.key);
            const blockTotalMd = block.rows.reduce((s, r) => s + r.totalMd, 0);
            const blockTotalLabel = formatEffortFromManDays(blockTotalMd, EFFORT_DISPLAY_UNIT);
            return (
              <div key={block.key} className="card-elevated overflow-hidden">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 border-b border-stone-200 bg-stone-50 px-3 py-2.5 text-left hover:bg-stone-100/80 transition-colors"
                  aria-expanded={!collapsed}
                  onClick={() => toggleBlockCollapsed(block.key)}
                >
                  {collapsed ? (
                    <ChevronRight className="shrink-0 text-stone-500" size={18} aria-hidden />
                  ) : (
                    <ChevronDown className="shrink-0 text-stone-500" size={18} aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 text-sm font-semibold text-stone-900 break-words">{block.title}</span>
                  <span className="shrink-0 text-xs font-bold tabular-nums text-indigo-700" title="이 사업부(또는 부서) 블록 공수 합">
                    {blockTotalLabel}
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-stone-500 tabular-nums">{block.rows.length}명</span>
                </button>
                {!collapsed && (
                  <div className="overflow-x-auto">
                    <table className="w-full table-fixed text-sm min-w-[36rem] border-collapse">
                      <colgroup>
                        <col className="min-w-0" />
                        <col className="w-[6.5rem]" />
                        <col className="w-[4.25rem]" />
                        <col className="min-w-[11rem]" />
                      </colgroup>
                      <thead className="border-b border-stone-200 bg-stone-100/95">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-stone-700">인원</th>
                          <th className="border-l border-stone-200/90 px-3 py-2 text-right text-xs font-semibold text-stone-700 whitespace-nowrap">
                            합
                          </th>
                          <th
                            className="border-l border-stone-200/90 px-2 py-2 text-right text-xs font-semibold text-stone-700 whitespace-nowrap"
                            title="공수 가중 평균 진척률"
                          >
                            진척
                          </th>
                          <th className="border-l border-stone-200/90 px-3 py-2 text-left text-xs font-semibold text-stone-700">
                            프로젝트
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {block.rows.map(({ person, items, totalMd, totalEarnedMd }, rowIdx) => {
                          const personDisplay = formatPersonWorkEffortRowDisplay(
                            person,
                            allocationDisplayMetaByName,
                            divisionNameById.size > 0 ? divisionNameById : undefined,
                          );
                          const totalEffortLabel = formatEffortFromManDays(totalMd, EFFORT_DISPLAY_UNIT);
                          const progressPct = computePersonWorkEffortWeightedProgressPct({ totalMd, totalEarnedMd });
                          return (
                            <tr
                              key={person}
                              className={cn('transition-colors hover:bg-indigo-50/35', rowIdx % 2 === 1 && 'bg-stone-50/50')}
                            >
                              <td className="px-3 py-2.5 align-top">
                                <button
                                  type="button"
                                  onClick={() => setSelectedPerson((p) => (p === person ? null : person))}
                                  title="투입·작업 상세"
                                  aria-label={`${personDisplay}, 투입·작업 상세 열기`}
                                  className={cn(
                                    'block w-full text-left font-medium leading-snug text-stone-900 break-words [overflow-wrap:anywhere] rounded-lg px-1 py-0.5 -mx-1 transition-colors',
                                    'hover:bg-white/80 hover:text-indigo-900 hover:ring-1 hover:ring-stone-200/90',
                                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-400',
                                    selectedPerson === person && 'text-indigo-900 ring-1 ring-indigo-200/90 bg-indigo-50/40',
                                  )}
                                >
                                  {personDisplay}
                                </button>
                              </td>
                              <td className="border-l border-stone-100 px-3 py-2.5 text-right align-top tabular-nums text-sm font-semibold leading-snug text-indigo-700 whitespace-nowrap">
                                {totalEffortLabel}
                              </td>
                              <td className="border-l border-stone-100 px-2 py-2.5 text-right align-top tabular-nums text-xs font-bold leading-snug text-indigo-900 whitespace-nowrap">
                                {formatPercent1(progressPct)}%
                              </td>
                              <td className="border-l border-stone-100 px-3 py-2 align-top min-w-0">
                                <ul className="m-0 flex flex-col gap-0.5 p-0 list-none">
                                  {items.map(({ project, workEffortMd, earnedEffortMd }) => {
                                    const effortLabel = formatEffortFromManDays(workEffortMd, EFFORT_DISPLAY_UNIT);
                                    const projectProgressPct = computePersonWorkEffortWeightedProgressPct({
                                      totalMd: workEffortMd,
                                      totalEarnedMd: earnedEffortMd,
                                    });
                                    const projectTitle =
                                      (project.name ?? '').trim() || formatProjectDisplayName(project.name, project.projectKind);
                                    const fullLabel = formatProjectDisplayName(project.name, project.projectKind);
                                    const rowTitle = `${fullLabel} · ${effortLabel} (진척 ${formatPercent1(projectProgressPct)}%)`;
                                    return (
                                      <li
                                        key={project.id}
                                        className="flex min-w-0 items-center justify-between gap-2 rounded border border-transparent px-1 py-0.5 hover:border-stone-200/80 hover:bg-stone-50/80"
                                      >
                                        {onNavigateToWork ? (
                                          <button
                                            type="button"
                                            onClick={() => onNavigateToWork(project.id)}
                                            className="min-w-0 flex-1 truncate text-left text-xs font-medium text-stone-800 hover:text-indigo-800 hover:underline"
                                            title={`${rowTitle} · 작업 표`}
                                          >
                                            {projectTitle}
                                          </button>
                                        ) : (
                                          <span className="min-w-0 flex-1 truncate text-xs font-medium text-stone-700" title={rowTitle}>
                                            {projectTitle}
                                          </span>
                                        )}
                                        <span className="shrink-0 tabular-nums text-xs font-bold text-indigo-700">{effortLabel}</span>
                                      </li>
                                    );
                                  })}
                                </ul>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className={cn('space-y-4', narrowScreenLayout && 'max-w-full')}>
          {divisionBlocks.map((block) => {
            const collapsed = collapsedBlockKeys.has(block.key);
            const blockTotalMd = block.rows.reduce((s, r) => s + r.totalMd, 0);
            const blockTotalLabel = formatEffortFromManDays(blockTotalMd, EFFORT_DISPLAY_UNIT);
            return (
              <div key={block.key} className="card-elevated overflow-hidden">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 border-b border-stone-200 bg-stone-50 px-3 py-2.5 text-left hover:bg-stone-100/80 transition-colors"
                  aria-expanded={!collapsed}
                  onClick={() => toggleBlockCollapsed(block.key)}
                >
                  {collapsed ? (
                    <ChevronRight className="shrink-0 text-stone-500" size={18} aria-hidden />
                  ) : (
                    <ChevronDown className="shrink-0 text-stone-500" size={18} aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 text-sm font-semibold text-stone-900 break-words">{block.title}</span>
                  <span className="shrink-0 text-xs font-bold tabular-nums text-indigo-700" title="블록 공수 합">
                    {blockTotalLabel}
                  </span>
                  <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-stone-600 tabular-nums ring-1 ring-stone-200/80">
                    {block.rows.length}명
                  </span>
                </button>
                {!collapsed && (
                  <ul className="m-0 list-none divide-y divide-stone-200/75 border-t border-stone-200/60 bg-[var(--color-surface)]/30 p-0">
                    {block.rows.map(({ person, items, totalMd, totalEarnedMd }) => {
                      const personDisplayFull = formatPersonWorkEffortRowDisplay(
                        person,
                        allocationDisplayMetaByName,
                        divisionNameById.size > 0 ? divisionNameById : undefined,
                      );
                      const personDisplay = shortenPersonRowLabelForSection(personDisplayFull, block.title);
                      const totalEffortLabel = formatEffortFromManDays(totalMd, EFFORT_DISPLAY_UNIT);
                      const progressPct = computePersonWorkEffortWeightedProgressPct({ totalMd, totalEarnedMd });
                      return (
                        <li
                          key={person}
                          className={cn(
                            'px-3 py-2 sm:px-4 transition-colors',
                            selectedPerson === person ? 'bg-violet-50/50' : 'hover:bg-stone-50/70',
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedPerson((p) => (p === person ? null : person))}
                            title="투입·작업 상세"
                            aria-label={`${personDisplayFull}, 투입·작업 상세`}
                            className={cn(
                              'group/person flex w-full min-w-0 items-start gap-2 rounded-md text-left sm:gap-2.5',
                              '-mx-0.5 px-0.5 py-0.5 transition-colors',
                              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet-500',
                            )}
                          >
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-stone-100 to-stone-200/90 text-[11px] font-bold text-stone-700 shadow-sm ring-1 ring-stone-300/50">
                              {person.substring(0, 1)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
                                <span className="text-sm font-medium leading-snug text-stone-900 break-words [overflow-wrap:anywhere] group-hover/person:text-violet-950">
                                  {personDisplay}
                                </span>
                                <div className="flex flex-wrap items-center justify-end gap-x-1 shrink-0">
                                  <span className="rounded bg-violet-100/95 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-violet-900 ring-1 ring-violet-200/70">
                                    {totalEffortLabel}
                                  </span>
                                  <span
                                    className="rounded bg-indigo-50 px-1 py-0.5 text-[10px] font-bold tabular-nums text-indigo-900 ring-1 ring-indigo-200/80"
                                    title="진척률(공수 가중)"
                                  >
                                    {formatPercent1(progressPct)}%
                                  </span>
                                </div>
                              </div>
                            </div>
                          </button>
                          {items.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1 pl-0 sm:pl-9">
                              {items.map(({ project, workEffortMd, earnedEffortMd }) => {
                                const effortLabel = formatEffortFromManDays(workEffortMd, EFFORT_DISPLAY_UNIT);
                                const projectProgressPct = computePersonWorkEffortWeightedProgressPct({
                                  totalMd: workEffortMd,
                                  totalEarnedMd: earnedEffortMd,
                                });
                                const projectTitle =
                                  (project.name ?? '').trim() || formatProjectDisplayName(project.name, project.projectKind);
                                const fullLabel = formatProjectDisplayName(project.name, project.projectKind);
                                const chipClassName = cn(
                                  'inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] leading-tight transition-colors',
                                  onNavigateToWork
                                    ? 'cursor-pointer border-stone-200/90 bg-white text-stone-800 hover:border-violet-300 hover:bg-violet-50/60'
                                    : 'cursor-default border-stone-200/70 bg-stone-50/90 text-stone-600',
                                );
                                const inner = (
                                  <>
                                    <span className="min-w-0 truncate font-medium">{projectTitle}</span>
                                    <span className="shrink-0 tabular-nums font-bold text-indigo-700">{effortLabel}</span>
                                  </>
                                );
                                const tip = `${fullLabel} · ${effortLabel} (진척 ${formatPercent1(projectProgressPct)}%) · 작업 표`;
                                return onNavigateToWork ? (
                                  <button
                                    key={`${person}:${project.id}`}
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onNavigateToWork(project.id);
                                    }}
                                    className={chipClassName}
                                    title={tip}
                                  >
                                    {inner}
                                  </button>
                                ) : (
                                  <span key={`${person}:${project.id}`} className={chipClassName} title={tip}>
                                    {inner}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      <BaseModal
        isOpen={Boolean(selectedPerson)}
        onClose={() => setSelectedPerson(null)}
        showCloseButton={false}
        size="xl"
        bodyClassName="p-0"
      >
        {selectedPerson && (
          <PersonAllocationDetailPanel
            person={selectedPerson}
            projects={projects}
            allocationItems={allocationItemsForDetail}
            personProjectWorkEffort={personProjectWorkEffort}
            allTasks={allTasks}
            effortDisplayUnit={EFFORT_DISPLAY_UNIT}
            orgMemberLabelByName={allocationOrgLabelByName}
            displayMetaByName={allocationDisplayMetaByName}
            statusConfigs={wbsSettings.statusConfigs}
            onClose={() => setSelectedPerson(null)}
            onNavigateToWork={onNavigateToWork}
            profileMap={profileMap}
            allocationProjectIdFilter={allocationProjectIdFilterForDetail}
            divisionNameById={divisionNameById.size > 0 ? divisionNameById : undefined}
          />
        )}
      </BaseModal>
    </div>
  );
}
