import React from 'react';
import { cn } from '../lib/utils';
import { ChevronDown, ChevronUp, Flag, Bug, Clock, X, User, SlidersHorizontal } from 'lucide-react';
import { ProjectNameLabel } from './ProjectNameLabel';
import { formatProjectDisplayName } from '../lib/projectKind';
import { formatAssigneeDisplay } from '../lib/assigneeOptions';
import { format, startOfWeek, endOfWeek, addDays } from 'date-fns';
import type { Project, FilterState } from '../types';
import type { WBSSettings } from '../lib/wbsSettings';
import type { User as SupabaseUser } from '@supabase/supabase-js';

export interface AppFilterBarProps {
  filterOn: boolean;
  isFullscreen: boolean;
  view: string;
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  setFilterOn: (v: boolean | ((prev: boolean) => boolean)) => void;
  wbsSettings: WBSSettings;
  user: SupabaseUser | null;
  profileMap: Record<string, string>;
  allAssignees: (string | number)[];
  assigneeDisplayMetaByName: Record<string, any>;
  setCurrentProjectId: (id: string) => void;
  selectProject: (id: string) => void;
  projectsSortedByName: Project[];
  uniqueProjects: Project[];
  hasActiveFilters: boolean;
  projectFilterDropdownRef: React.RefObject<HTMLDivElement>;
  isProjectFilterDropdownOpen: boolean;
  setIsProjectFilterDropdownOpen: React.Dispatch<React.SetStateAction<boolean>>;
  projectFilterAllCheckboxRef: React.MutableRefObject<HTMLInputElement | null>;
  headerProjectFilterSyncKey: React.MutableRefObject<string>;
}

export function AppFilterBar({
  filterOn,
  isFullscreen,
  view,
  filters,
  setFilters,
  setFilterOn,
  wbsSettings,
  user,
  profileMap,
  allAssignees,
  assigneeDisplayMetaByName,
  setCurrentProjectId,
  selectProject,
  projectsSortedByName,
  uniqueProjects,
  hasActiveFilters,
  projectFilterDropdownRef,
  isProjectFilterDropdownOpen,
  setIsProjectFilterDropdownOpen,
  projectFilterAllCheckboxRef,
  headerProjectFilterSyncKey,
}: AppFilterBarProps) {
  /** 핵심 필터(프로젝트·상태·담당자 전체/내 업무만)만 항상 표시,
   *  나머지(다른 사람 칩들, 마일스톤/이슈, 기간 프리셋, 기한/완료) 는 토글로 펼침. localStorage에 영구. */
  const [showAdvanced, setShowAdvanced] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem('wbs.filter.advanced') === '1';
    } catch {
      return false;
    }
  });
  React.useEffect(() => {
    try {
      if (typeof window !== 'undefined') window.localStorage.setItem('wbs.filter.advanced', showAdvanced ? '1' : '0');
    } catch {
      /* ignore quota */
    }
  }, [showAdvanced]);
  /** 펼침 강제 조건: 사용자가 숨겨진 그룹에서 이미 필터를 선택한 상태면 자동 펼침(숨겨도 적용중인 게 안 보이면 혼란). */
  const advancedActive =
    !!filters.milestoneOnly ||
    !!filters.issueOnly ||
    !!filters.pastDueOnly ||
    !!filters.completedThisWeekOnly ||
    !!filters.notStartedYetOnly ||
    !!filters.startDate ||
    !!filters.endDate ||
    (typeof filters.assignee === 'string' && filters.assignee !== '' && filters.assignee !== user?.id);
  const effectiveShowAdvanced = showAdvanced || advancedActive;

  if (!filterOn || isFullscreen || view === 'projects' || view === 'allocation' || view === 'dashboard') {
    return null;
  }

  return (
    <div
      className="bg-[var(--color-surface)]/80 backdrop-blur-2xl border-b border-[var(--color-line)]/50 px-4 py-2.5 flex flex-wrap items-start gap-2 shrink-0 z-40 transition-colors duration-300"
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      {/* 프로젝트 (다중 선택) */}
      <div
        ref={projectFilterDropdownRef}
        className="relative inline-flex items-center gap-2 px-2 py-1 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)]"
      >
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider" title="프로젝트별로 작업을 필터링합니다.">
          프로젝트
        </span>
        <button
          type="button"
          onClick={() => setIsProjectFilterDropdownOpen((o) => !o)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:bg-[var(--color-bg)] transition-all min-w-[140px] text-left"
          title="프로젝트 다중 선택: 여러 프로젝트 작업을 한 화면에서 볼 수 있습니다."
        >
          <span className="flex-1 break-words">
            {filters.projectIds === 'all'
              ? '전체'
              : filters.projectIds.length === 1
                ? (() => {
                    const sel = uniqueProjects.find((p) => p.id === filters.projectIds[0]);
                    return sel ? formatProjectDisplayName(sel.name, sel.projectKind) : '1개';
                  })()
                : `${filters.projectIds.length}개 프로젝트`}
          </span>
          <ChevronDown size={14} className={cn('shrink-0 opacity-60', isProjectFilterDropdownOpen && 'rotate-180')} />
        </button>
        {isProjectFilterDropdownOpen && (
          <div
            className="absolute left-0 top-full mt-1 z-50 min-w-[280px] max-w-[320px] max-h-[min(70vh,420px)] overflow-y-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] py-2"
            style={{ boxShadow: 'var(--shadow-lg)' }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {(() => {
              const allIds = projectsSortedByName.map((x) => x.id);
              const isAll = filters.projectIds === 'all';
              const isPartial =
                Array.isArray(filters.projectIds) && filters.projectIds.length > 0 && filters.projectIds.length < allIds.length;
              return (
                <>
                  <label className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-bg)] cursor-pointer border-b border-[var(--color-line)]">
                    <input
                      ref={(el) => {
                        projectFilterAllCheckboxRef.current = el;
                        if (el) el.indeterminate = isPartial;
                      }}
                      type="checkbox"
                      checked={isAll}
                      onChange={() => {
                        if (isAll) {
                          setFilters((f) => ({ ...f, projectIds: [] }));
                          headerProjectFilterSyncKey.current = '__none__';
                        } else {
                          selectProject('all');
                          setFilters((f) => ({ ...f, projectIds: 'all' }));
                          headerProjectFilterSyncKey.current = '__all__';
                        }
                      }}
                      className="rounded border-[var(--color-line)] text-[var(--color-accent)]"
                    />
                    전체 (모든 프로젝트)
                  </label>
                  {projectsSortedByName.map((p) => {
                    const checked = isAll || (Array.isArray(filters.projectIds) && filters.projectIds.includes(p.id));
                    return (
                      <label
                        key={p.id}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--color-ink)] hover:bg-[var(--color-bg)] cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            if (filters.projectIds === 'all') {
                              const excluded = allIds.filter((id) => id !== p.id);
                              setFilters((f) => ({ ...f, projectIds: excluded }));
                              headerProjectFilterSyncKey.current = '__partial__';
                            } else {
                              const set = new Set(filters.projectIds);
                              if (set.has(p.id)) {
                                set.delete(p.id);
                                if (set.size === 0) {
                                  selectProject('all');
                                  setFilters((f) => ({ ...f, projectIds: 'all' }));
                                  headerProjectFilterSyncKey.current = '__all__';
                                } else {
                                  const arr = Array.from(set);
                                  if (arr.length === 1) selectProject(arr[0]);
                                  setFilters((f) => ({ ...f, projectIds: arr }));
                                }
                              } else {
                                set.add(p.id);
                                const arr = Array.from(set);
                                if (arr.length === allIds.length) {
                                  selectProject('all');
                                  setFilters((f) => ({ ...f, projectIds: 'all' }));
                                  headerProjectFilterSyncKey.current = '__all__';
                                } else {
                                  setFilters((f) => ({ ...f, projectIds: arr }));
                                }
                              }
                            }
                          }}
                          className="rounded border-[var(--color-line)] text-[var(--color-accent)]"
                        />
                        <ProjectNameLabel project={p} name={p.name} />
                      </label>
                    );
                  })}
                </>
              );
            })()}
          </div>
        )}
      </div>

      {/* 상태 */}
      <div className="inline-flex items-center gap-2 px-2 py-1 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)]">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider" title="상태별로 작업을 필터링합니다.">
          상태
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setFilters((f) => ({ ...f, status: 'all' }))}
            className={cn('filter-chip', filters.status === 'all' ? 'filter-chip-active' : 'filter-chip-inactive')}
            title="모든 상태의 작업 표시"
          >
            전체
          </button>
          {wbsSettings.statusConfigs.map((config) => (
            <button
              key={config.id}
              onClick={() => setFilters((f) => ({ ...f, status: config.id }))}
              className={cn('filter-chip', filters.status === config.id ? 'filter-chip-active' : 'filter-chip-inactive')}
              title={`${config.name} 상태인 작업만 표시`}
            >
              {config.name}
            </button>
          ))}
        </div>
      </div>

      {/* 담당자 */}
      <div className="inline-flex items-center gap-2 px-2 py-1 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)]">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider" title="담당자별로 작업을 필터링합니다.">
          담당자
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setFilters((f) => ({ ...f, assignee: '' }))}
            className={cn('filter-chip', !filters.assignee ? 'filter-chip-active' : 'filter-chip-inactive')}
            title="모든 담당자의 작업 표시"
          >
            전체
          </button>
          {user?.id && profileMap[user.id] && (
            <button
              onClick={() => {
                setFilterOn(true);
                setFilters((f) => ({ ...f, assignee: profileMap[user.id] }));
              }}
              className={cn(
                'filter-chip flex items-center gap-1',
                filters.assignee === profileMap[user.id] ? 'filter-chip-active' : 'filter-chip-inactive',
              )}
              title="내가 담당자인 작업만 표시"
            >
              <User size={10} className="opacity-80" /> 내 업무만
            </button>
          )}
          {/* 다른 사람 담당자 칩들: 기본 숨김, "더 많은 필터" 토글로 펼침 (이미 선택돼 있으면 자동 표시) */}
          {effectiveShowAdvanced &&
            allAssignees.map((a) => (
              <button
                key={String(a)}
                onClick={() => setFilters((f) => ({ ...f, assignee: String(a) }))}
                className={cn('filter-chip', filters.assignee === String(a) ? 'filter-chip-active' : 'filter-chip-inactive')}
                title={`${formatAssigneeDisplay(String(a), assigneeDisplayMetaByName)} 담당 작업만 표시`}
              >
                {formatAssigneeDisplay(String(a), assigneeDisplayMetaByName)}
              </button>
            ))}
          {!effectiveShowAdvanced && allAssignees.length > 0 && (
            <span className="text-[11px] text-[var(--color-ink-muted)] px-1.5">+ {allAssignees.length}명</span>
          )}
        </div>
      </div>

      {/* 마일스톤/이슈 — 고급 필터(접힘) */}
      {effectiveShowAdvanced && (
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)]">
          <span
            className="text-[10px] font-bold text-slate-400 uppercase tracking-wider"
            title="마일스톤/이슈 기준으로 작업을 필터링합니다."
          >
            마일스톤
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() =>
                setFilters((f) => ({
                  ...f,
                  milestoneOnly: false,
                  issueOnly: false,
                }))
              }
              className={cn(
                'filter-chip flex items-center gap-1',
                !filters.milestoneOnly && !filters.issueOnly ? 'filter-chip-active' : 'filter-chip-inactive',
              )}
              title="마일스톤/이슈 구분 없이 모든 작업 표시"
            >
              전체
            </button>
            <button
              onClick={() =>
                setFilters((f) => ({
                  ...f,
                  milestoneOnly: true,
                  issueOnly: false,
                }))
              }
              className={cn(
                'filter-chip flex items-center gap-1',
                filters.milestoneOnly && !filters.issueOnly ? 'filter-chip-active' : 'filter-chip-inactive',
              )}
              title="마일스톤으로 지정된 이정표 작업만 표시"
            >
              <Flag size={12} className="opacity-80" /> 마일스톤만
            </button>
            <button
              onClick={() =>
                setFilters((f) => ({
                  ...f,
                  milestoneOnly: false,
                  issueOnly: true,
                }))
              }
              className={cn(
                'filter-chip flex items-center gap-1',
                !filters.milestoneOnly && filters.issueOnly ? 'filter-chip-active' : 'filter-chip-inactive',
              )}
              title="이슈로 지정된 작업만 표시"
            >
              <Bug size={12} className="opacity-80" /> 이슈만
            </button>
          </div>
        </div>
      )}

      {/* 기간 — 고급 필터(접힘) */}
      {effectiveShowAdvanced && (
        <div className="inline-flex items-center gap-2 px-2 py-1 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)]">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider" title="기간별로 작업을 필터링합니다.">
            기간
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setFilters((f) => ({ ...f, startDate: '', endDate: '' }))}
              className={cn('filter-chip', !filters.startDate && !filters.endDate ? 'filter-chip-active' : 'filter-chip-inactive')}
              title="기간 제한 없이 모든 작업 표시"
            >
              전체
            </button>
            <button
              onClick={() => {
                const today = format(new Date(), 'yyyy-MM-dd');
                setFilters((f) => ({ ...f, startDate: today, endDate: today }));
              }}
              className={cn(
                'filter-chip',
                filters.startDate &&
                  filters.endDate &&
                  filters.startDate === filters.endDate &&
                  filters.startDate === format(new Date(), 'yyyy-MM-dd')
                  ? 'filter-chip-active'
                  : 'filter-chip-inactive',
              )}
              title="오늘과 기간이 겹치는 작업만 표시"
            >
              금일
            </button>
            <button
              onClick={() => {
                const now = new Date();
                const weekStart = startOfWeek(now, { weekStartsOn: 1 });
                const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
                setFilters((f) => ({ ...f, startDate: format(weekStart, 'yyyy-MM-dd'), endDate: format(weekEnd, 'yyyy-MM-dd') }));
              }}
              className={cn(
                'filter-chip',
                filters.startDate &&
                  filters.endDate &&
                  filters.startDate === format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd') &&
                  filters.endDate === format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
                  ? 'filter-chip-active'
                  : 'filter-chip-inactive',
              )}
              title="이번 주(월~일)와 기간이 겹치는 작업만 표시"
            >
              금주
            </button>
            <button
              onClick={() => {
                const now = new Date();
                const nextWeekBase = addDays(now, 7);
                const nextWeekStart = startOfWeek(nextWeekBase, { weekStartsOn: 1 });
                const nextWeekEnd = endOfWeek(nextWeekBase, { weekStartsOn: 1 });
                setFilters((f) => ({ ...f, startDate: format(nextWeekStart, 'yyyy-MM-dd'), endDate: format(nextWeekEnd, 'yyyy-MM-dd') }));
              }}
              className={cn(
                'filter-chip',
                (() => {
                  if (!filters.startDate || !filters.endDate) return 'filter-chip-inactive';
                  const now = new Date();
                  const nextWeekBase = addDays(now, 7);
                  const nextWeekStart = startOfWeek(nextWeekBase, { weekStartsOn: 1 });
                  const nextWeekEnd = endOfWeek(nextWeekBase, { weekStartsOn: 1 });
                  const startMatch = filters.startDate === format(nextWeekStart, 'yyyy-MM-dd');
                  const endMatch = filters.endDate === format(nextWeekEnd, 'yyyy-MM-dd');
                  return startMatch && endMatch ? 'filter-chip-active' : 'filter-chip-inactive';
                })(),
              )}
              title="다음 주(월~일)와 기간이 겹치는 작업만 표시"
            >
              차주
            </button>
          </div>
        </div>
      )}

      {/* 기한/완료 — 고급 필터(접힘) */}
      {effectiveShowAdvanced && (
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)]">
          <span
            className="text-[10px] font-bold text-slate-400 uppercase tracking-wider"
            title="이번 주 완료/기한 초과 상태로 작업을 필터링합니다."
          >
            기한/완료
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() =>
                setFilters((f) => ({
                  ...f,
                  pastDueOnly: false,
                  completedThisWeekOnly: false,
                  notStartedYetOnly: false,
                }))
              }
              className={cn(
                'filter-chip flex items-center gap-1',
                !filters.pastDueOnly && !filters.completedThisWeekOnly && !filters.notStartedYetOnly
                  ? 'filter-chip-active'
                  : 'filter-chip-inactive',
              )}
              title="기한/완료/시작 전 조건 없이 모든 작업 표시"
            >
              전체
            </button>
            <button
              onClick={() =>
                setFilters((f) => ({
                  ...f,
                  completedThisWeekOnly: true,
                  pastDueOnly: false,
                  notStartedYetOnly: false,
                }))
              }
              className={cn(
                'filter-chip flex items-center gap-1',
                filters.completedThisWeekOnly && !filters.pastDueOnly && !filters.notStartedYetOnly
                  ? 'filter-chip-active'
                  : 'filter-chip-inactive',
              )}
              title="이번 주(월~일)에 완료된 항목만 표시 (상태: 완료, 종료일: 이번 주)"
            >
              금주 완료 항목
            </button>
            <button
              onClick={() =>
                setFilters((f) => ({
                  ...f,
                  pastDueOnly: true,
                  completedThisWeekOnly: false,
                  notStartedYetOnly: false,
                }))
              }
              className={cn(
                'filter-chip flex items-center gap-1',
                filters.pastDueOnly && !filters.completedThisWeekOnly && !filters.notStartedYetOnly
                  ? 'filter-chip-active'
                  : 'filter-chip-inactive',
              )}
              title="기한이 지난 미완료 작업만 표시"
            >
              <Clock size={12} className="opacity-80" /> 기한 지난 항목
            </button>
            <button
              onClick={() =>
                setFilters((f) => ({
                  ...f,
                  notStartedYetOnly: true,
                  pastDueOnly: false,
                  completedThisWeekOnly: false,
                }))
              }
              className={cn(
                'filter-chip flex items-center gap-1',
                filters.notStartedYetOnly && !filters.pastDueOnly && !filters.completedThisWeekOnly
                  ? 'filter-chip-active'
                  : 'filter-chip-inactive',
              )}
              title="시작일이 오늘 이후(아직 시작 전)인 작업만 표시 — 시작 예정 작업"
            >
              <Clock size={12} className="opacity-80" /> 시작 전 항목
            </button>
          </div>
        </div>
      )}

      {/* 고급 필터 펼침/접기 토글 — 마일스톤/이슈·기간·기한·다른 사람 담당자 칩의 표시 여부 제어. */}
      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        disabled={advancedActive}
        className={cn(
          'inline-flex items-center gap-1 h-7 px-2 rounded-md border text-[11px] font-medium shrink-0 focus:outline-none focus:ring-2 focus:ring-indigo-500/20',
          effectiveShowAdvanced
            ? 'border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100'
            : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
          advancedActive && 'opacity-70 cursor-not-allowed',
        )}
        title={
          advancedActive
            ? '숨겨진 그룹에서 이미 필터가 적용 중이라 자동으로 펼침 상태입니다. (해당 필터를 해제하면 다시 접을 수 있습니다)'
            : effectiveShowAdvanced
              ? '마일스톤·기간·기한 그룹과 다른 사람 담당자 칩을 접습니다.'
              : '마일스톤·기간·기한 그룹과 다른 사람 담당자 칩을 추가로 표시합니다.'
        }
      >
        <SlidersHorizontal size={12} strokeWidth={2} aria-hidden />
        {effectiveShowAdvanced ? '필터 접기' : '필터 더 보기'}
        {effectiveShowAdvanced ? <ChevronUp size={12} aria-hidden /> : <ChevronDown size={12} aria-hidden />}
      </button>

      {hasActiveFilters && (
        <button
          onClick={() => {
            setCurrentProjectId('all');
            setFilters((f) => ({
              ...f,
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
              searchText: '',
            }));
          }}
          className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-[var(--color-danger)] text-[var(--color-danger)] bg-red-50/50 hover:bg-[var(--color-danger)] hover:text-white transition-all shrink-0 ml-auto active:scale-95"
        >
          <X size={10} /> 초기화
        </button>
      )}
    </div>
  );
}
