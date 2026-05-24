import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Briefcase, ChevronDown, ChevronRight, ExternalLink, Info, LayoutGrid, Table2 } from 'lucide-react';
import type { DashboardSectionLayoutMode } from '../lib/dashboardSectionLayout';
import { useWBS } from '../context/WBSContext';
import { useOrganization } from '../context/OrganizationContext';
import { cn } from '../lib/utils';
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
  computeProjectAllocations,
  splitUnassignedPersonWorkEffortByInferredDivision,
  type PersonWorkEffortAllocation,
} from '../lib/personAllocations';
import { buildOrgMemberLabelMap, buildOrgMemberDisplayMetaMap, type PersonDisplayMeta } from '../lib/assigneeOptions';
import { compareAssigneeByPositionThenName } from '../lib/orgMemberSort';
import { formatProjectDisplayName, resolveProjectKindOrDefault } from '../lib/projectKind';
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
      'WBS 작업에 담당으로 배정되고 투입공수(workEffort)가 0보다 큰 작업만 합산합니다. 프로젝트별·인원별 합계는 M/M(맨먼스)로 표시합니다.',
      '프로젝트 설정의「투입 인원」비율과는 별개이며, 작업에 적힌 공수 기준으로 표시합니다.',
      '이름을 누르면 투입·작업 상세를, 프로젝트를 누르면 해당 프로젝트 작업 표로 이동합니다.',
    ];
    if (allocationDivisionInfer && assigneeTopDivisionIdByName?.size) {
      lines.splice(
        1,
        0,
        '담당이 비어 있는 작업은 프로젝트 PM·PO 또는 소유자 프로필 부서를 기준으로 사업부를 자동 추정해 각 사업부 블록에 나누어 보여 줍니다(WBS 담당 필드는 바꾸지 않습니다).',
      );
    }
    if (assigneeTopDivisionIdByName?.size) {
      lines.push('「사업부·부서별 현황」에서 이 블록으로 내려오면, 선택한 사업부 소속 인원만 보도록 필터가 걸릴 수 있습니다.');
    }
    if (onOpenAllocationOverview) {
      lines.push('메뉴「투입현황」화면에서는 프로젝트별 투입과「투입 인원」비율 편집까지 할 수 있습니다.');
    }
    const tail = filterHintSuffix.trim();
    return tail ? [...lines, tail] : lines;
  }, [assigneeTopDivisionIdByName, allocationDivisionInfer, filterHintSuffix, onOpenAllocationOverview]);

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
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h2 className="text-xl font-bold text-[var(--color-ink)] flex items-center gap-2 flex-wrap m-0">
              <Briefcase className="text-[var(--color-accent)] shrink-0" size={24} aria-hidden />
              인원·사업부별 작업 투입공수
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
          <p className="text-sm text-stone-500 mb-3 m-0 leading-relaxed max-w-3xl">
            WBS 작업에 배정된 공수(M/M)를 인원·사업부 단위로 묶어 보여 줍니다. 이름을 누르면 상세를, 프로젝트를 누르면 작업 표로 이동합니다.
          </p>
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
            <span className="font-semibold">사업부 범위</span>
            <span className="text-teal-900/90">
              {' '}
              · {personAllocationQuickFilter.label?.trim() || '선택한 사업부'} 소속으로 매핑된 인원만 표시합니다. (대시보드「사업부·부서별
              현황」과 동일한 기준)
            </span>
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

      <details className="group mb-4 rounded-xl border border-stone-200 bg-white px-4 py-3 shadow-sm">
        <summary className="cursor-pointer list-none text-sm font-semibold text-stone-800 [&::-webkit-details-marker]:hidden flex items-center gap-2.5 select-none">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-stone-50 ring-1 ring-stone-200/80">
            <Info className="h-4 w-4 text-indigo-600 shrink-0" aria-hidden />
          </span>
          표 읽는 법<span className="text-xs font-medium text-stone-400 group-open:hidden">(펼치기)</span>
        </summary>
        <ul className="mt-3 space-y-2 pl-1 sm:pl-11 text-sm text-stone-600 leading-relaxed border-t border-stone-100 pt-3 list-none">
          {helpBullets.map((line, idx) => (
            <li
              key={`allocation-help-${idx}`}
              className="relative pl-4 before:absolute before:left-0 before:top-[0.55em] before:h-1.5 before:w-1.5 before:rounded-full before:bg-indigo-400/90"
            >
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
                  <span className="shrink-0 text-xs font-semibold text-stone-500 tabular-nums">{block.rows.length}명</span>
                </button>
                {!collapsed && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[640px]">
                      <thead className="bg-stone-50 border-b border-stone-200">
                        <tr className="text-xs text-stone-500">
                          <th className="text-left font-medium px-3 py-2">인원</th>
                          <th className="text-right font-medium px-3 py-2 w-28 whitespace-nowrap">투입 합</th>
                          <th className="text-left font-medium px-3 py-2 min-w-[12rem]">프로젝트·공수</th>
                        </tr>
                      </thead>
                      <tbody>
                        {block.rows.map(({ person, items, totalMd }) => {
                          const personDisplay = formatPersonWorkEffortRowDisplay(
                            person,
                            allocationDisplayMetaByName,
                            divisionNameById.size > 0 ? divisionNameById : undefined,
                          );
                          const totalEffortLabel = formatEffortFromManDays(totalMd, EFFORT_DISPLAY_UNIT);
                          return (
                            <tr key={person} className="border-t border-stone-100 hover:bg-stone-50/60">
                              <td className="px-3 py-2 align-top">
                                <button
                                  type="button"
                                  onClick={() => setSelectedPerson((p) => (p === person ? null : person))}
                                  className={cn(
                                    'text-left font-medium text-stone-900 break-words [overflow-wrap:anywhere] rounded-md -m-0.5 p-0.5 transition-colors',
                                    'hover:text-indigo-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-400',
                                    selectedPerson === person && 'text-indigo-800',
                                  )}
                                >
                                  {personDisplay}
                                </button>
                                <div className="text-[11px] text-stone-400 mt-0.5">클릭 · 상세</div>
                              </td>
                              <td className="px-3 py-2 text-right align-top tabular-nums font-semibold text-indigo-700 whitespace-nowrap">
                                {totalEffortLabel}
                              </td>
                              <td className="px-3 py-2 align-top min-w-0">
                                <ul className="space-y-1.5 m-0 p-0 list-none">
                                  {items.map(({ project, workEffortMd }) => {
                                    const effortLabel = formatEffortFromManDays(workEffortMd, EFFORT_DISPLAY_UNIT);
                                    const name = formatProjectDisplayName(project.name, project.projectKind);
                                    return (
                                      <li
                                        key={project.id}
                                        className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 min-w-0"
                                      >
                                        {onNavigateToWork ? (
                                          <button
                                            type="button"
                                            onClick={() => onNavigateToWork(project.id)}
                                            className="min-w-0 flex-1 text-left text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline break-words [overflow-wrap:anywhere]"
                                            title={`${name} — 작업 표로 이동`}
                                          >
                                            {name}
                                          </button>
                                        ) : (
                                          <span className="min-w-0 flex-1 text-xs font-medium text-stone-800 break-words [overflow-wrap:anywhere]">
                                            {name}
                                          </span>
                                        )}
                                        <span className="shrink-0 text-xs tabular-nums text-stone-500">{effortLabel}</span>
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
                  <span className="shrink-0 rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-stone-600 tabular-nums ring-1 ring-stone-200/80">
                    {block.rows.length}명
                  </span>
                </button>
                {!collapsed && (
                  <ul className="flex flex-col gap-2.5 p-3 sm:p-4 bg-[var(--color-surface)]/40">
                    {block.rows.map(({ person, items, totalMd }) => {
                      const personDisplay = formatPersonWorkEffortRowDisplay(
                        person,
                        allocationDisplayMetaByName,
                        divisionNameById.size > 0 ? divisionNameById : undefined,
                      );
                      const totalEffortLabel = formatEffortFromManDays(totalMd, EFFORT_DISPLAY_UNIT);
                      return (
                        <li key={person}>
                          <div
                            className={cn(
                              'rounded-xl border bg-white p-3.5 sm:p-4 shadow-sm transition-shadow',
                              selectedPerson === person
                                ? 'border-indigo-300 ring-2 ring-indigo-200/70 shadow-md'
                                : 'border-stone-200 hover:border-stone-300 hover:shadow-md',
                            )}
                          >
                            <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_min(11rem,max-content)] lg:gap-x-6 lg:items-start">
                              <div className="min-w-0 space-y-3">
                                <button
                                  type="button"
                                  onClick={() => setSelectedPerson((p) => (p === person ? null : person))}
                                  className={cn(
                                    'group/person flex w-full min-w-0 gap-3 rounded-lg text-left transition-colors sm:gap-4',
                                    'hover:bg-stone-50/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400',
                                  )}
                                >
                                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-base font-bold text-indigo-800 ring-2 ring-white ring-offset-1 ring-offset-stone-100">
                                    {person.substring(0, 1)}
                                  </div>
                                  <div className="min-w-0 flex-1 pt-0.5">
                                    <span className="block text-base font-semibold leading-snug text-stone-900 break-words [overflow-wrap:anywhere] group-hover/person:text-indigo-950">
                                      {personDisplay}
                                    </span>
                                    <span className="mt-1 block text-xs font-medium text-stone-500 lg:hidden">
                                      작업 공수 합 <span className="font-bold text-indigo-700 tabular-nums">{totalEffortLabel}</span>
                                    </span>
                                    <span className="mt-0.5 block text-[11px] text-stone-400">이름 클릭 · 투입·작업 상세</span>
                                  </div>
                                </button>
                                <div className="min-w-0 lg:pl-[3.75rem]">
                                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-stone-400">프로젝트별 공수</p>
                                  <div className="grid grid-cols-1 min-[480px]:grid-cols-2 xl:grid-cols-3 gap-2">
                                    {items.map(({ project, workEffortMd }) => {
                                      const kind = resolveProjectKindOrDefault(project);
                                      const effortLabel = formatEffortFromManDays(workEffortMd, EFFORT_DISPLAY_UNIT);
                                      return (
                                        <button
                                          key={`${person}:${project.id}`}
                                          type="button"
                                          disabled={!onNavigateToWork}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            onNavigateToWork?.(project.id);
                                          }}
                                          className={cn(
                                            'flex min-h-[4.25rem] min-w-0 flex-col items-stretch gap-1 rounded-xl border px-3 py-2.5 text-left transition-all [overflow-wrap:anywhere]',
                                            onNavigateToWork
                                              ? 'border-stone-200 bg-white shadow-sm hover:border-indigo-200 hover:bg-indigo-50/50 hover:shadow-md active:scale-[0.99]'
                                              : 'cursor-default border-stone-100 bg-stone-50 text-stone-500',
                                          )}
                                          title={
                                            onNavigateToWork
                                              ? `${formatProjectDisplayName(project.name, project.projectKind)} (${effortLabel}) 작업 보기`
                                              : effortLabel
                                          }
                                        >
                                          <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700/90">{kind}</span>
                                          <span className="text-sm font-semibold leading-snug text-stone-800 break-words [overflow-wrap:anywhere]">
                                            {formatProjectDisplayName(project.name, project.projectKind)}
                                          </span>
                                          <span className="mt-auto pt-1 text-xs font-bold tabular-nums text-indigo-800">{effortLabel}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                              <div className="hidden min-w-0 shrink-0 flex-col items-stretch justify-center rounded-xl border border-indigo-100 bg-indigo-50/70 px-4 py-3 text-center lg:flex">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-800/80">작업 공수 합</span>
                                <span className="mt-1.5 text-xl font-bold leading-none text-indigo-950 tabular-nums sm:text-2xl">
                                  {totalEffortLabel}
                                </span>
                              </div>
                            </div>
                          </div>
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
