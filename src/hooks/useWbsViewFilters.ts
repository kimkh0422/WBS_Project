import { useEffect, useRef, useState } from 'react';
import type { Task, FilterState, SortConfig } from '../types';

interface UseWbsViewFiltersParams {
  tasks: Task[];
  currentProjectId: string;
}

/**
 * 작업 보기 필터·정렬 상태와 파생값 — 필터 바·표/간트/칸반/마인드맵에서 공유.
 * filterOn이 꺼져 있으면 effectiveFilters가 조건을 무시(값은 유지). WBSApp god 컴포넌트에서 분리 — 동작 동일.
 */
export function useWbsViewFilters({ tasks, currentProjectId }: UseWbsViewFiltersParams) {
  const [filters, setFilters] = useState<FilterState>({
    projectIds: 'all',
    status: 'all',
    assignee: '',
    startDate: '',
    endDate: '',
    milestoneOnly: false,
    issueOnly: false,
    level: 'all',
    pastDueOnly: false,
    completedThisWeekOnly: false,
    notStartedYetOnly: false,
  });

  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'wbs', direction: 'asc' });

  // Filter on/off (when on, filter bar and filters apply)
  const [filterOn, setFilterOn] = useState(false);
  const [isProjectFilterDropdownOpen, setIsProjectFilterDropdownOpen] = useState(false);
  const projectFilterDropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isProjectFilterDropdownOpen) return;
    const close = (e: MouseEvent) => {
      if (projectFilterDropdownRef.current && !projectFilterDropdownRef.current.contains(e.target as Node)) {
        setIsProjectFilterDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [isProjectFilterDropdownOpen]);

  /** 헤더 프로젝트가 바뀔 때만 필터 동기화 (필터에서 다중 선택한 뒤 헤더는 그대로일 때는 유지) */
  const headerProjectFilterSyncKey = useRef<string | null>(null);
  const projectFilterAllCheckboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = !currentProjectId || currentProjectId === 'all' ? '__all__' : currentProjectId;
    if (headerProjectFilterSyncKey.current === key) return;
    headerProjectFilterSyncKey.current = key;
    setFilters((prev) => ({
      ...prev,
      projectIds: key === '__all__' ? 'all' : [currentProjectId],
    }));
  }, [currentProjectId]);

  const hasActiveFilters =
    filterOn &&
    (filters.projectIds !== 'all' ||
      filters.status !== 'all' ||
      filters.assignee ||
      filters.startDate ||
      filters.endDate ||
      !!filters.milestoneOnly ||
      !!filters.issueOnly ||
      typeof filters.level === 'number' ||
      !!filters.pastDueOnly ||
      !!filters.completedThisWeekOnly ||
      !!filters.searchText);
  const allAssignees = Array.from(new Set(tasks.map((t) => t.assignee).filter(Boolean))) as string[];
  const effectiveFilters: FilterState = filterOn
    ? filters
    : {
        ...filters,
        status: 'all',
        assignee: '',
        startDate: '',
        endDate: '',
        milestoneOnly: false,
        issueOnly: false,
        level: 'all',
        pastDueOnly: false,
        completedThisWeekOnly: false,
        notStartedYetOnly: false,
      };

  return {
    filters,
    setFilters,
    sortConfig,
    setSortConfig,
    filterOn,
    setFilterOn,
    isProjectFilterDropdownOpen,
    setIsProjectFilterDropdownOpen,
    projectFilterDropdownRef,
    projectFilterAllCheckboxRef,
    headerProjectFilterSyncKey,
    hasActiveFilters,
    allAssignees,
    effectiveFilters,
  };
}
