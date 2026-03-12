import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Task, Project, TaskAssignment, MOCK_TASKS, MOCK_PROJECTS } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { BackupData } from '../lib/export';
import { addDays, differenceInDays, format, isValid, parseISO } from 'date-fns';
import { buildChildrenByParent } from '../lib/taskView';
import { getTopologicalOrder, applyDependencySchedule, computeEndDateFromEffort, computeStartDateFromEndDate } from '../lib/schedule';
import { getHolidaysForTaskDates, differenceInBusinessDaysEx, addBusinessDaysEx } from '../lib/calendar';
import {
  computeWorkloadOverloads,
  fixOverloadByExtending,
  fixOverloadByIncreasingAllocation,
  type WorkloadDay,
} from '../lib/workload';
import {
  upsertProject,
  upsertTask,
  upsertTasks,
  upsertSettings,
  fetchProjects,
  fetchTasks,
  fetchSettings,
  deleteProjectFromDB,
  deleteTasksFromDB,
  deleteAllTasksFromDB,
  deleteAllProjectsFromDB,
  restoreBackupToDB,
} from '../lib/db';
import { loadJsonWithIdbFallback, saveJsonWithIdbFallback, safeLocalGet } from '../lib/persist';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useAuth } from './AuthContext';

export interface StatusConfig {
  id: string;
  name: string;
  progress: number;
  color?: string;
}

export interface WBSSettings {
  appTitle: string;
  level1Prefix: string;
  level2Prefix: string;
  level3Prefix: string;
  maxLevel: number;
  statusConfigs: StatusConfig[];
  tableColumns?: { id: string; visible: boolean }[];
  /** 크리티컬 패스 표시 여부 (간트·표에서 강조) */
  showCriticalPath?: boolean;
  /** 셀 텍스트 줄바꿈 여부. true면 줄바꿈 허용·행 높이 자동 확장 */
  wrapTextInCells?: boolean;
}

interface WBSContextType {
  allTasks: Task[];
  tasks: Task[];
  projects: Project[];
  currentProjectId: string;
  setCurrentProjectId: (id: string) => void;
  selectedTaskIds: string[];
  setSelectedTaskIds: (ids: string[]) => void;
  wbsSettings: WBSSettings;
  updateWbsSettings: (settings: Partial<WBSSettings>) => void;
  treeExpandLevel: number;
  setTreeExpandLevel: (level: number) => void;
  addProject: (name: string, description?: string, startDate?: string, endDate?: string, assignments?: Project['assignments'], minWorkEffortDays?: number) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  /** 프로젝트와 소속 작업을 복사해 새 프로젝트로 만들고 현재 사용자 소유로 설정 */
  copyProject: (sourceProjectId: string) => void;
  addTask: (task: Omit<Task, 'id' | 'projectId'>, insertAfterId?: string) => string;
  addTasks: (tasks: Task[]) => void;
  updateTask: (id: string, updates: Partial<Task>, options?: { skipCascade?: boolean }) => void;
  /** 여러 작업에 동일한 수정 일괄 적용 (일정 변경 없을 때만 사용, 충돌 방지) */
  updateTasksBulk: (taskIds: string[], updates: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  moveTask: (id: string, direction: 'up' | 'down') => void;
  indentTask: (id: string) => void;
  outdentTask: (id: string) => void;
  indentTasks: (ids: string[]) => void;
  outdentTasks: (ids: string[]) => void;
  toggleExpand: (id: string) => void;
  expandToLevel: (level: number) => void;
  reorderTask: (id: string, overId: string) => void;
  importTasks: (tasks: Task[], targetProjectId?: string, newProjectName?: string) => Promise<void>;
  /** 로컬에서 삭제된 작업 id 로그(삭제 반영용). */
  deletedTaskIdsByProject: Record<string, string[]>;
  /** 로컬 데이터를 DB(Supabase)에 수동 반영. */
  syncToDb: (scope: 'current' | 'all') => Promise<void>;
  deleteAllTasks: () => void;
  /** 모든 프로젝트의 작업을 전체 삭제 (현재 프로젝트 무관) */
  deleteAllTasksInAllProjects: () => void;
  /**
   * 전체 초기화: 모든 프로젝트/작업을 제거하고
   * '새 프로젝트' 1개를 생성해 선택 상태로 만듭니다.
   */
  resetAllProjectsToNew: () => Promise<void>;
  wbsMap: Map<string, string>;
  displayWbsMap: Map<string, string>;
  restoreBackup: (data: BackupData) => void;
  mergeBackups: (backups: BackupData[]) => { addedProjects: number; addedTasks: number };
  exportFullBackup: () => BackupData;
  undo: () => void;
  canUndo: boolean;
  redo: () => void;
  canRedo: boolean;
  /** 선택한 작업들의 현재 일정을 베이스라인으로 저장 */
  setBaselineForTasks: (taskIds: string[]) => void;
  /** 현재 프로젝트(또는 전체) 모든 작업의 현재 일정을 베이스라인으로 저장 */
  setBaselineForAllTasks: () => void;
  /** 담당자(투입 인원) 이름을 전체 일괄 변경 */
  renameAssignee: (oldName: string, newName: string) => void;
  /** 선후관계·기간을 반영해 현재 프로젝트 일정을 앞당기도록 재계산 */
  refreshProjectSchedule: () => void;
  /** 과부하 자동 수정: 항목별로 선택한 전략(기간 연장/투입율 증가) 적용 */
  fixOverload: (overloadsToFix: Array<{ overload: WorkloadDay; strategy: 'extend' | 'increaseAllocation' }>) => void;
  isLoading: boolean;
}

const WBSContext = createContext<WBSContextType | undefined>(undefined);

const DEFAULT_STATUS_CONFIGS: StatusConfig[] = [
  { id: 'todo', name: '할 일', progress: 0, color: 'bg-stone-100 border-stone-200' },
  { id: 'in-progress', name: '진행 중', progress: 10, color: 'bg-blue-50 border-blue-100' },
  { id: 'blocked', name: '지연됨', progress: 50, color: 'bg-red-50 border-red-100' },
  { id: 'done', name: '완료', progress: 100, color: 'bg-green-50 border-green-100' },
];

const DEFAULT_SETTINGS: WBSSettings = {
  appTitle: '지엠티 프로젝트 매니저',
  level1Prefix: 'W',
  level2Prefix: 'W',
  level3Prefix: 'T',
  maxLevel: 4,
  statusConfigs: DEFAULT_STATUS_CONFIGS,
  tableColumns: [
    { id: 'wbsId', visible: true },
    { id: 'name', visible: true },
    { id: 'startDate', visible: true },
    { id: 'endDate', visible: true },
    { id: 'workEffort', visible: true },
    { id: 'assignee', visible: true },
    { id: 'allocation', visible: true },
    { id: 'status', visible: true },
    { id: 'progress', visible: true },
    { id: 'deliverables', visible: true },
    { id: 'dependencies', visible: true },
  ],
  showCriticalPath: false,
  wrapTextInCells: false,
};

// ─── 롤업 헬퍼 ────────────────────────────────────────────────────────────────

function syncParentRollups(allTasks: Task[], parentId: string | null): Task[] {
  if (!parentId) return allTasks;
  const children = allTasks.filter(t => t.parentId === parentId);
  if (children.length === 0) return allTasks;

  let minStart = children[0].startDate;
  let maxEnd = children[0].endDate;
  let totalEffort = 0;

  for (const child of children) {
    if (child.startDate && child.startDate < minStart) minStart = child.startDate;
    if (child.endDate && child.endDate > maxEnd) maxEnd = child.endDate;
    const effort = typeof child.workEffort === 'number' && Number.isFinite(child.workEffort) ? child.workEffort : 0;
    totalEffort += effort;
  }

  const parent = allTasks.find(t => t.id === parentId);
  if (!parent) return allTasks;

  const parentEffort = typeof parent.workEffort === 'number' && Number.isFinite(parent.workEffort) ? parent.workEffort : undefined;
  const shouldUpdate = parent.startDate !== minStart || parent.endDate !== maxEnd || parentEffort !== totalEffort;

  const updatedTasks = shouldUpdate
    ? allTasks.map(t => t.id === parentId ? { ...t, startDate: minStart, endDate: maxEnd, workEffort: totalEffort } : t)
    : allTasks;

  return syncParentRollups(updatedTasks, parent.parentId);
}

function recomputeProjectRollups(allTasks: Task[], projectId: string): Task[] {
  if (!projectId || projectId === 'all') return allTasks;
  const projectTasks = allTasks.filter(t => t.projectId === projectId);
  if (projectTasks.length === 0) return allTasks;

  const taskMap = new Map(projectTasks.map(t => [t.id, t] as const));
  const hasChildren = new Set<string>();
  for (const t of projectTasks) {
    if (t.parentId && taskMap.has(t.parentId)) hasChildren.add(t.parentId);
  }
  if (hasChildren.size === 0) return allTasks;

  const depthMemo = new Map<string, number>();
  const getDepth = (id: string): number => {
    const cached = depthMemo.get(id);
    if (cached !== undefined) return cached;
    const t = taskMap.get(id);
    if (!t || !t.parentId || !taskMap.has(t.parentId)) { depthMemo.set(id, 0); return 0; }
    const d = getDepth(t.parentId) + 1;
    depthMemo.set(id, d);
    return d;
  };

  const parentIds = Array.from(hasChildren).sort((a, b) => getDepth(b) - getDepth(a));
  let next = allTasks;
  for (const pid of parentIds) {
    next = syncParentRollups(next, pid);
  }
  return next;
}

/** 모든 프로젝트에 대해 상위 작업의 시작일/종료일/공수를 하위 작업 기준으로 롤업 */
function applyRollupsToTasks(tasks: Task[]): Task[] {
  const projectIds = Array.from(new Set(tasks.map(t => t.projectId))).filter(
    (id): id is string => Boolean(id) && id !== 'all'
  );
  let result = tasks;
  for (const pid of projectIds) result = recomputeProjectRollups(result, pid);
  return result;
}

// ─── WBSSettings 파싱 헬퍼 ────────────────────────────────────────────────────

function parseSettings(raw: any): WBSSettings {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    let statusConfigs = parsed.statusConfigs;
    if (!statusConfigs && (parsed.statusNames || parsed.statusProgress)) {
      statusConfigs = (['todo', 'in-progress', 'blocked', 'done'] as const).map(id => ({
        id,
        name: parsed.statusNames?.[id] || (id === 'todo' ? '할 일' : id === 'in-progress' ? '진행 중' : id === 'blocked' ? '지연됨' : '완료'),
        progress: parsed.statusProgress?.[id] !== undefined ? parsed.statusProgress[id] : (id === 'todo' ? 0 : id === 'in-progress' ? 10 : id === 'blocked' ? 50 : 100),
        color: id === 'todo' ? 'bg-stone-100 border-stone-200' : id === 'in-progress' ? 'bg-blue-50 border-blue-100' : id === 'blocked' ? 'bg-red-50 border-red-100' : 'bg-green-50 border-green-100',
      }));
    }
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      appTitle: parsed.appTitle || DEFAULT_SETTINGS.appTitle,
      statusConfigs: statusConfigs || DEFAULT_STATUS_CONFIGS,
      tableColumns: Array.isArray(parsed.tableColumns) && parsed.tableColumns.length > 0
        ? parsed.tableColumns.filter((c: any) => c && typeof c.id === 'string').map((c: any) => ({ id: String(c.id), visible: c.visible !== false }))
        : DEFAULT_SETTINGS.tableColumns,
      showCriticalPath: parsed.showCriticalPath === true,
      wrapTextInCells: parsed.wrapTextInCells === true,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function WBSProvider({
  children,
  useLocalOnly = false,
  onConcurrentConflict,
  onDbError,
}: {
  children: React.ReactNode;
  /** true면 로컬(IndexedDB/localStorage)만 사용하고 DB는 읽지/쓰지 않음 */
  useLocalOnly?: boolean;
  /** 동시 수정 충돌 시 호출(토스트 등 알림용). Supabase 사용 시에만 의미 있음. */
  onConcurrentConflict?: () => void;
  /** DB 저장 실패 시 호출(토스트 등 알림용). */
  onDbError?: (message: string) => void;
}) {
  const { user } = useAuth();
  const handleDbError = React.useCallback(
    (err: unknown, fallback: string) => {
      if (import.meta.env.DEV) console.warn(fallback, err);
      const msg = err instanceof Error ? err.message : fallback;
      onDbError?.(msg);
    },
    [onDbError]
  );
  const [isLoading, setIsLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string>('');
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [wbsSettings, setWbsSettings] = useState<WBSSettings>(DEFAULT_SETTINGS);
  const [treeExpandLevel, setTreeExpandLevel] = useState<number>(() => Math.min(9, DEFAULT_SETTINGS.maxLevel + 1));
  const [deletedTaskIdsByProject, setDeletedTaskIdsByProject] = useState<Record<string, string[]>>({});

  const historyRef = useRef<Task[][]>([]);
  const redoRef = useRef<Task[][]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const allTasksRef = useRef<Task[]>([]);
  /** 신규 프로젝트 생성 중복 방지 (React StrictMode 등으로 loadData가 여러 번 실행될 때) */
  const initNewProjectPromiseRef = useRef<Promise<Project | null> | null>(null);
  const prevOwnerIdRef = useRef<string | undefined>(undefined);

  // 프로젝트 전환 시 선택 초기화
  useEffect(() => { setSelectedTaskIds([]); }, [currentProjectId]);

  // ─── 초기 데이터 로딩 (Supabase) ────────────────────────────────────────────

  const ownerId = user?.id ?? undefined;

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      try {
        // 모든 사용자: 로컬(IndexedDB/localStorage)에 저장된 데이터를 기본으로 로드
        const [fallbackProjects, fallbackTasks, rawSettings, fallbackDeleted] = await Promise.all([
          loadJsonWithIdbFallback<Project[]>('wbs-projects'),
          loadJsonWithIdbFallback<Task[]>('wbs-tasks'),
          loadJsonWithIdbFallback<any>('wbs-settings'),
          loadJsonWithIdbFallback<Record<string, string[]>>('wbs-deleted-task-ids'),
        ]);
        const parsedSettings = parseSettings(rawSettings);
        setDeletedTaskIdsByProject(fallbackDeleted && typeof fallbackDeleted === 'object' ? fallbackDeleted : {});
        const projectsToUse = Array.isArray(fallbackProjects) ? fallbackProjects : [];
        const tasksToUse = Array.isArray(fallbackTasks) ? fallbackTasks : [];

        if (projectsToUse.length > 0) {
          setProjects(projectsToUse);
          setAllTasks(applyRollupsToTasks(tasksToUse));
          setWbsSettings(parsedSettings);
          const savedCurrent = sessionStorage.getItem('wbs-current-project');
          const validId = projectsToUse.find(p => p.id === savedCurrent)?.id ?? projectsToUse[0]?.id ?? '';
          setCurrentProjectId(validId);
        } else {
          // 첫 실행 등: 로컬에 프로젝트가 없으면 목업(초기 프로젝트) 사용
          setProjects(MOCK_PROJECTS);
          setAllTasks(applyRollupsToTasks(tasksToUse.length > 0 ? tasksToUse : MOCK_TASKS));
          setWbsSettings(parsedSettings);
          setCurrentProjectId(MOCK_PROJECTS[0]?.id ?? '');
        }

        setTreeExpandLevel(Math.min(9, Math.max(1, (parsedSettings?.maxLevel ?? DEFAULT_SETTINGS.maxLevel) + 1)));

        // DB 동기화 모드: 로컬 로드 후 DB로부터 최신 데이터로 덮어쓰기(가능한 경우)
        if (!useLocalOnly && isSupabaseConfigured && supabase && user?.id) {
          try {
            const [dbProjects, dbTasks, dbSettings] = await Promise.all([
              fetchProjects(),
              fetchTasks(),
              fetchSettings(),
            ]);
            if (Array.isArray(dbProjects) && dbProjects.length > 0) {
              setProjects(dbProjects);
              setAllTasks(applyRollupsToTasks(Array.isArray(dbTasks) ? dbTasks : []));
              if (dbSettings) {
                setWbsSettings(prev => ({ ...prev, ...(dbSettings as Partial<WBSSettings>) }));
              }
              const savedCurrent = sessionStorage.getItem('wbs-current-project');
              const validId = dbProjects.find(p => p.id === savedCurrent)?.id ?? dbProjects[0]?.id ?? '';
              setCurrentProjectId(validId);
            }
          } catch (e) {
            handleDbError(e, 'DB에서 프로젝트를 불러오지 못했습니다. 로컬 데이터를 표시합니다.');
          }
        }
      } catch (err) {
        // 폴백: localStorage → 목업 데이터 (파싱 실패 시 목업만 사용)
        try {
          const savedProjects = safeLocalGet('wbs-projects');
          const savedTasks = safeLocalGet('wbs-tasks');
          const savedSettings = safeLocalGet('wbs-settings');
          const fallbackProjects = savedProjects ? JSON.parse(savedProjects) : MOCK_PROJECTS;
          const fallbackTasks = savedTasks ? JSON.parse(savedTasks) : MOCK_TASKS;
          const parsedSettings = parseSettings(savedSettings ? JSON.parse(savedSettings) : null);
          setProjects(Array.isArray(fallbackProjects) && fallbackProjects.length > 0 ? fallbackProjects : MOCK_PROJECTS);
          setAllTasks(applyRollupsToTasks(Array.isArray(fallbackTasks) ? fallbackTasks : MOCK_TASKS));
          setWbsSettings(parsedSettings);
          setCurrentProjectId((Array.isArray(fallbackProjects) && fallbackProjects[0]?.id) ? fallbackProjects[0].id : (MOCK_PROJECTS[0]?.id ?? ''));
        } catch (fallbackErr) {
          if (import.meta.env.DEV) console.warn('[DB] 폴백 데이터 로딩 실패, 목업 사용:', fallbackErr);
          setProjects(MOCK_PROJECTS);
          setAllTasks(applyRollupsToTasks(MOCK_TASKS));
          setWbsSettings(DEFAULT_SETTINGS);
          setCurrentProjectId(MOCK_PROJECTS[0]?.id ?? '');
        }
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, [useLocalOnly, user?.id, handleDbError]);

  // 모든 사용자: 상태 변경 시 로컬(IndexedDB/localStorage)에 저장
  useEffect(() => {
    if (isLoading) return;
    void (async () => {
      await Promise.all([
        saveJsonWithIdbFallback('wbs-projects', projects),
        saveJsonWithIdbFallback('wbs-tasks', allTasks),
        saveJsonWithIdbFallback('wbs-settings', wbsSettings),
        saveJsonWithIdbFallback('wbs-deleted-task-ids', deletedTaskIdsByProject),
      ]);
    })();
  }, [isLoading, projects, allTasks, wbsSettings, deletedTaskIdsByProject]);

  const recordDeletedTaskIds = (projectId: string, ids: string[]) => {
    const pid = String(projectId ?? '');
    const unique = Array.from(new Set(ids.filter(Boolean)));
    if (!pid || unique.length === 0) return;
    setDeletedTaskIdsByProject(prev => {
      const existing = prev[pid] ?? [];
      const merged = Array.from(new Set([...existing, ...unique]));
      if (merged.length === existing.length) return prev;
      return { ...prev, [pid]: merged };
    });
  };

  const syncToDb = async (scope: 'current' | 'all'): Promise<void> => {
    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Supabase 설정이 필요합니다. (DB 반영 불가)');
    }
    const effectiveScope = scope === 'all' ? 'all' : 'current';
    const projectIds =
      effectiveScope === 'all'
        ? projects.map(p => p.id).filter(Boolean)
        : (currentProjectId && currentProjectId !== 'all' ? [currentProjectId] : []);

    const projectIdSet = new Set(projectIds);
    const targetProjects = projects.filter(p => projectIdSet.has(p.id));
    const targetTasks = allTasks.filter(t => t.projectId && projectIdSet.has(t.projectId));

    // 1) Projects upsert (including new projects)
    for (const p of targetProjects) {
      await upsertProject(p);
    }

    // 2) Settings upsert (single row)
    await upsertSettings(wbsSettings);

    // 3) Tasks upsert (ID 기준 병합)
    await upsertTasks(targetTasks);

    // 4) Deletions (tombstones) apply
    const deletions: string[] = [];
    for (const pid of projectIds) {
      const ids = deletedTaskIdsByProject[pid] ?? [];
      deletions.push(...ids);
    }
    const uniqueDeletionIds = Array.from(new Set(deletions.filter(Boolean)));
    if (uniqueDeletionIds.length > 0) {
      const BATCH = 200;
      for (let i = 0; i < uniqueDeletionIds.length; i += BATCH) {
        await deleteTasksFromDB(uniqueDeletionIds.slice(i, i + BATCH));
      }
    }

    // 5) Clear applied tombstones for target projects
    setDeletedTaskIdsByProject(prev => {
      const next = { ...prev };
      for (const pid of projectIds) delete next[pid];
      return next;
    });
  };

  useEffect(() => {
    if (currentProjectId) sessionStorage.setItem('wbs-current-project', currentProjectId);
  }, [currentProjectId]);

  /** 동시 수정 충돌 시 토스트/refetch 중복 방지 (2초 내 재호출 스킵) */
  const lastConflictRef = useRef<number>(0);
  const CONFLICT_DEBOUNCE_MS = 2000;

  // ─── Undo ─────────────────────────────────────────────────────────────────

  allTasksRef.current = allTasks;

  const saveHistory = () => {
    historyRef.current = [...historyRef.current.slice(-49), [...allTasksRef.current]];
    redoRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  };

  const undo = () => {
    if (historyRef.current.length === 0) return;
    const previous = historyRef.current[historyRef.current.length - 1];
    historyRef.current = historyRef.current.slice(0, -1);
    redoRef.current = [...redoRef.current.slice(-49), [...allTasksRef.current]];
    setCanUndo(historyRef.current.length > 0);
    setCanRedo(true);
    setAllTasks(previous);
    if (!useLocalOnly) upsertTasks(previous).catch(err => handleDbError(err, '실행 취소 저장에 실패했습니다.'));
  };

  const redo = () => {
    if (redoRef.current.length === 0) return;
    const next = redoRef.current[redoRef.current.length - 1];
    redoRef.current = redoRef.current.slice(0, -1);
    historyRef.current = [...historyRef.current.slice(-49), [...allTasksRef.current]];
    setCanRedo(redoRef.current.length > 0);
    setCanUndo(true);
    setAllTasks(next);
    if (!useLocalOnly) upsertTasks(next).catch(err => handleDbError(err, '다시 실행 저장에 실패했습니다.'));
  };

  // ─── Derived 상태 ─────────────────────────────────────────────────────────

  const tasks = React.useMemo(
    () => (currentProjectId === 'all' ? allTasks : allTasks.filter(t => t.projectId === currentProjectId)),
    [allTasks, currentProjectId]
  );

  const { wbsMap, displayWbsMap } = React.useMemo(() => {
    const map = new Map<string, string>();
    const displayMap = new Map<string, string>();
    const { level1Prefix, level2Prefix, level3Prefix, maxLevel } = wbsSettings;
    const childrenByParent = buildChildrenByParent(tasks);

    // 선행작업 우선 위상 정렬, 동일하면 시작일 빠른 순(일정 순서에 맞는 WBS 번호)
    const topoOrder = getTopologicalOrder(tasks);
    const topoIndex = new Map<string, number>();
    topoOrder.forEach((id, i) => topoIndex.set(id, i));
    const childrenByParentSorted = new Map<string | null, Task[]>();
    childrenByParent.forEach((children, parentId) => {
      const sorted = [...children].sort((a, b) => {
        const tiA = topoIndex.get(a.id) ?? 1e9;
        const tiB = topoIndex.get(b.id) ?? 1e9;
        if (tiA !== tiB) return tiA - tiB;
        return (a.startDate || '').localeCompare(b.startDate || '');
      });
      childrenByParentSorted.set(parentId, sorted);
    });

    const buildWbs = (parentId: string | null, parentPrefixStr: string, depth: number) => {
      const children = childrenByParentSorted.get(parentId) ?? [];
      children.forEach((child, index) => {
        let wbsId = '';
        if (depth === 1) wbsId = `${level1Prefix}${index + 1}`;
        else if (depth === 2) wbsId = `${parentPrefixStr.replace(level1Prefix, level2Prefix)}.${index + 1}`;
        else if (depth === 3) { const n = parentPrefixStr.replace(level2Prefix, '').replace(level1Prefix, ''); wbsId = `${level3Prefix}${n}.${index + 1}`; }
        else if (depth > 3) wbsId = `${parentPrefixStr}.${index + 1}`;
        map.set(child.id, wbsId);
        displayMap.set(child.id, depth <= maxLevel ? wbsId : '');
        buildWbs(child.id, wbsId, depth + 1);
      });
    };
    buildWbs(null, '', 1);
    return { wbsMap: map, displayWbsMap: displayMap };
  }, [tasks, wbsSettings]);

  // ─── WBS 설정 ─────────────────────────────────────────────────────────────

  const updateWbsSettings = (updates: Partial<WBSSettings>) => {
    const newSettings = { ...wbsSettings, ...updates };
    setWbsSettings(newSettings);
    if (!useLocalOnly) upsertSettings(newSettings).catch(err => handleDbError(err, '설정 저장에 실패했습니다.'));
  };

  // ─── 프로젝트 CRUD ────────────────────────────────────────────────────────

  const addProject = (name: string, description?: string, startDate?: string, endDate?: string, assignments?: Project['assignments'], minWorkEffortDays?: number) => {
    const newProject: Project = { id: uuidv4(), name, description, startDate, endDate, assignments, minWorkEffortDays, ownerId: ownerId };
    setProjects(prev => [...prev, newProject]);
    setCurrentProjectId(newProject.id);
    if (!useLocalOnly) upsertProject(newProject).catch(err => handleDbError(err, '프로젝트 저장에 실패했습니다.'));
  };

  const updateProject = (id: string, updates: Partial<Project>) => {
    setProjects(prev => {
      const project = prev.find(p => p.id === id);
      const newStart = updates.startDate ?? project?.startDate;
      const newEnd = updates.endDate ?? project?.endDate;
      const startChanged = project && updates.startDate !== undefined && updates.startDate !== project.startDate;
      const endChanged = project && updates.endDate !== undefined && updates.endDate !== project.endDate;
      const needsTaskClamp = startChanged || (endChanged && newEnd && (!project?.endDate || newEnd < project.endDate));

      if (project && needsTaskClamp) {
        saveHistory();
        setAllTasks(currentTasks => {
          const projectAssignmentsMap = new Map<string, TaskAssignment[]>(prev.map(p => [p.id, p.assignments ?? []]));
          const holidays = getHolidaysForTaskDates(currentTasks);
          let shifted = currentTasks.map(t => {
            if (t.projectId !== id) return t;
            let taskStart = t.startDate;
            let taskEnd = t.endDate;

            if (newStart && taskStart && taskStart < newStart) {
              const assignments = (t.assignments && t.assignments.length > 0)
                ? t.assignments
                : projectAssignmentsMap.get(t.projectId);
              const start = parseISO(taskStart);
              const end = parseISO(taskEnd);
              let computedEnd: string;
              if (typeof t.workEffort === 'number' && t.workEffort > 0) {
                computedEnd = computeEndDateFromEffort(newStart, t.workEffort, assignments, holidays);
              } else if (isValid(start) && isValid(end)) {
                const durationDays = Math.max(1, differenceInBusinessDaysEx(start, end, holidays));
                computedEnd = format(addBusinessDaysEx(parseISO(newStart), durationDays - 1, holidays), 'yyyy-MM-dd');
              } else {
                computedEnd = newStart;
              }
              taskStart = newStart;
              taskEnd = computedEnd;
            }

            if (newEnd && taskEnd && taskEnd > newEnd) {
              taskEnd = newEnd;
              if (taskStart && taskStart > taskEnd) {
                taskStart = taskEnd;
              }
            }

            if (taskStart !== t.startDate || taskEnd !== t.endDate) {
              return { ...t, startDate: taskStart, endDate: taskEnd };
            }
            return t;
          });

          if (startChanged && newStart) {
            const projectTasksAfterClamp = shifted.filter(t => t.projectId === id && t.startDate && t.startDate >= newStart);
            const earliestAfter = projectTasksAfterClamp.reduce<string | null>(
              (min, t) => (!min || (t.startDate && t.startDate < min) ? (t.startDate || min) : min),
              null
            );
            if (earliestAfter && earliestAfter > newStart) {
              const deltaDays = differenceInDays(parseISO(newStart), parseISO(earliestAfter));
              if (deltaDays !== 0) {
                shifted = shifted.map(t => {
                  if (t.projectId !== id || !t.startDate || t.startDate < newStart) return t;
                  return {
                    ...t,
                    startDate: format(addDays(parseISO(t.startDate), deltaDays), 'yyyy-MM-dd'),
                    endDate: format(addDays(parseISO(t.endDate), deltaDays), 'yyyy-MM-dd'),
                  };
                });
              }
            }
          }

          const projectTasks = shifted.filter(t => t.projectId === id);
          const adjusted = applyDependencySchedule(projectTasks, projectAssignmentsMap);
          const adjustedById = new Map(adjusted.map(t => [t.id, t]));
          shifted = shifted.map(t => t.projectId === id && adjustedById.has(t.id) ? adjustedById.get(t.id)! : t);
          shifted = recomputeProjectRollups(shifted, id);
          if (!useLocalOnly) upsertTasks(shifted).catch(err => handleDbError(err, '날짜 이동 저장에 실패했습니다.'));
          return shifted;
        });
      }
      return prev.map(p => p.id === id ? { ...p, ...updates } : p);
    });
    const updated = projects.find(p => p.id === id);
    if (updated && !useLocalOnly) upsertProject({ ...updated, ...updates }).catch(err => handleDbError(err, '프로젝트 수정 저장에 실패했습니다.'));
  };

  const deleteProject = (id: string) => {
    if (projects.length <= 1) { alert('최소 하나의 프로젝트는 존재해야 합니다.'); return; }
    const idsToDelete = allTasks.filter(t => t.projectId === id).map(t => t.id);
    if (idsToDelete.length > 0) recordDeletedTaskIds(id, idsToDelete);
    setProjects(prev => prev.filter(p => p.id !== id));
    setAllTasks(prev => prev.filter(t => t.projectId !== id));
    if (currentProjectId === id) setCurrentProjectId(projects.find(p => p.id !== id)?.id || '');
    // DB 반영은 수동 버튼에서 처리
  };

  const copyProject = (sourceProjectId: string) => {
    const source = projects.find(p => p.id === sourceProjectId);
    if (!source) return;
    const sourceTasks = allTasks.filter(t => t.projectId === sourceProjectId);
    const newProjectId = uuidv4();
    const newProject: Project = {
      id: newProjectId,
      name: `${source.name} (복사본)`,
      description: source.description,
      startDate: source.startDate,
      endDate: source.endDate,
      assignments: source.assignments?.map(a => ({ ...a })),
      minWorkEffortDays: source.minWorkEffortDays,
      ownerId: ownerId ?? undefined,
    };
    const taskIdMap = new Map<string, string>();
    for (const t of sourceTasks) taskIdMap.set(t.id, uuidv4());
    const newTasks: Task[] = sourceTasks.map(t => {
      const newId = taskIdMap.get(t.id)!;
      const newParentId = t.parentId ? (taskIdMap.get(t.parentId) ?? null) : null;
      const newDeps = (t.dependencies ?? [])
        .map(depId => taskIdMap.get(depId))
        .filter((id): id is string => !!id);
      return {
        ...t,
        id: newId,
        projectId: newProjectId,
        parentId: newParentId,
        dependencies: newDeps,
        updatedAt: undefined,
      };
    });
    saveHistory();
    setProjects(prev => [...prev, newProject]);
    setCurrentProjectId(newProject.id);
    setAllTasks(prev => {
      const combined = [...prev, ...newTasks];
      const rolled = recomputeProjectRollups(combined, newProjectId);
      return rolled;
    });
  };

  // ─── 작업 CRUD ────────────────────────────────────────────────────────────

  const clampTaskToProjectRange = (t: Task, proj?: Project): Task => {
    if (!proj) return t;
    let start = t.startDate;
    let end = t.endDate;
    if (proj.startDate && start && start < proj.startDate) start = proj.startDate;
    if (proj.endDate && end && end > proj.endDate) end = proj.endDate;
    if (start && end && start > end) start = end;
    if (start !== t.startDate || end !== t.endDate) return { ...t, startDate: start, endDate: end };
    return t;
  };

  const addTask = (newTask: Omit<Task, 'id' | 'projectId'>, insertAfterId?: string): string => {
    saveHistory();
    const projectId = currentProjectId === 'all' ? (projects[0]?.id || '') : currentProjectId;
    const project = projects.find(p => p.id === projectId);
    const task: Task = clampTaskToProjectRange(
      { ...newTask, id: uuidv4(), projectId } as Task,
      project
    );
    setAllTasks(prev => {
      let nextTasks: Task[];
      if (insertAfterId) {
        const index = prev.findIndex(t => t.id === insertAfterId);
        if (index !== -1) { const arr = [...prev]; arr.splice(index + 1, 0, task); nextTasks = arr; }
        else nextTasks = [...prev, task];
      } else nextTasks = [...prev, task];
      const result = syncParentRollups(nextTasks, task.parentId);
      const sortOrder = result.indexOf(task);
      return result;
    });
    return task.id;
  };

  const addTasks = (newTasks: Task[]) => {
    saveHistory();
    const effectiveProjectId = currentProjectId === 'all' ? (projects[0]?.id || '') : currentProjectId;
    const project = projects.find(p => p.id === effectiveProjectId);
    const tasksWithProject = newTasks.map(t =>
      clampTaskToProjectRange({ ...t, projectId: effectiveProjectId }, project)
    );
    setAllTasks(prev => {
      const result = recomputeProjectRollups([...prev, ...tasksWithProject], effectiveProjectId);
      return result;
    });
  };

  const updateTask = (id: string, updates: Partial<Task>, options?: { skipCascade?: boolean }) => {
    const skipCascade = options?.skipCascade ?? false;
    saveHistory();
    setAllTasks(prev => {
      const task = prev.find(t => t.id === id);
      if (!task) return prev;
      const hasDateChange = Object.prototype.hasOwnProperty.call(updates, 'startDate') || Object.prototype.hasOwnProperty.call(updates, 'endDate');
      const hasWorkEffortChange = Object.prototype.hasOwnProperty.call(updates, 'workEffort');
      const hasDependencyChange = Object.prototype.hasOwnProperty.call(updates, 'dependencies');
      const hasScheduleChange = hasDateChange || hasWorkEffortChange || hasDependencyChange;

      const taskLockedFields = new Set(task.userLockedFields ?? []);
      const endDateLocked = taskLockedFields.has('endDate');
      let resolvedUpdates = { ...updates };
      const projectAssignmentsMap = new Map<string, TaskAssignment[]>(projects.map(p => [p.id, p.assignments ?? []]));
      const assignments = (task.assignments && task.assignments.length > 0)
        ? task.assignments
        : (task.projectId ? projectAssignmentsMap.get(task.projectId) : undefined);
      const holidays = getHolidaysForTaskDates(prev);

      // 시작일 변경 또는 workEffort 변경 시 새로운 endDate 계산
      // 종료일 변경 시 시작일 역산 및 기간 유지
      if (hasScheduleChange) {
        const newStart = updates.startDate ?? task.startDate;
        const newEnd = updates.endDate ?? task.endDate;
        const workEffort = updates.workEffort !== undefined ? updates.workEffort : task.workEffort;
        const startDateLocked = taskLockedFields.has('startDate');

        if (Object.prototype.hasOwnProperty.call(updates, 'endDate') && !Object.prototype.hasOwnProperty.call(updates, 'startDate') && !startDateLocked) {
          // 종료일만 변경된 경우(시작일 미지정): 기간 유지하여 시작일 역산. 간트 드래그 등으로 둘 다 명시된 경우는 그대로 사용
          const computedStart = computeStartDateFromEndDate(
            newEnd,
            workEffort,
            assignments,
            holidays,
            task.startDate,
            task.endDate
          );
          if (computedStart !== task.startDate) {
            resolvedUpdates.startDate = computedStart;
          }
        }

        if (!endDateLocked && !Object.prototype.hasOwnProperty.call(updates, 'endDate')) {
          // 종료일이 호출자에 의해 명시되지 않은 경우에만 계산 (간트 드래그로 종료일만 늘린 경우 보존)
          if (typeof workEffort === 'number' && workEffort > 0) {
            resolvedUpdates.endDate = computeEndDateFromEffort(
              resolvedUpdates.startDate ?? newStart,
              workEffort,
              assignments,
              holidays
            );
          } else if (updates.startDate) {
            const oldStart = parseISO(task.startDate);
            const oldEnd = parseISO(task.endDate);
            if (isValid(oldStart) && isValid(oldEnd)) {
              const durationDays = differenceInDays(oldEnd, oldStart);
              resolvedUpdates.endDate = format(addDays(parseISO(resolvedUpdates.startDate ?? newStart), durationDays), 'yyyy-MM-dd');
            }
          }
        }
      }

      const lockFields = new Set(task.userLockedFields ?? []);
      if (hasDateChange) {
        if (resolvedUpdates.startDate != null) {
          lockFields.add('startDate');
          lockFields.delete('endDate');
        }
        if (resolvedUpdates.endDate != null) {
          lockFields.add('endDate');
        }
      }

      let updatedTask = { ...task, ...resolvedUpdates, userLockedFields: lockFields.size > 0 ? Array.from(lockFields) : undefined };
      const project = projects.find(p => p.id === task.projectId);
      updatedTask = clampTaskToProjectRange(updatedTask, project);
      let nextTasks = prev.map(t => t.id === id ? updatedTask : t);

      // 시작일/종료일/공수 변경 시: 연관된 업무(후행/하위)만 일정 재계산 (간트 드래그 시 skipCascade로 연쇄 반영 생략)
      if (hasScheduleChange && task.projectId && !skipCascade) {
        const projectTaskList = nextTasks.filter(t => t.projectId === task.projectId);
        const dateLocked = new Set(projectTaskList.filter(t => (t.userLockedFields ?? []).includes('startDate') || (t.userLockedFields ?? []).includes('endDate')).map(t => t.id));

        const getDescendantIds = (rootId: string): Set<string> => {
          const desc = new Set<string>();
          const stack = [rootId];
          while (stack.length) {
            const pid = stack.pop()!;
            for (const t of projectTaskList) {
              if (t.parentId === pid && !dateLocked.has(t.id) && !desc.has(t.id)) {
                desc.add(t.id);
                stack.push(t.id);
              }
            }
          }
          return desc;
        };
        const descendantIds = getDescendantIds(id);

        const sourceAssignee = updatedTask.assignee ?? '';
        const getSuccessorIds = (predId: string): Set<string> => {
          const succ = new Set<string>();
          const stack = [predId];
          while (stack.length) {
            const pid = stack.pop()!;
            for (const t of projectTaskList) {
              if (t.id === id || dateLocked.has(t.id)) continue;
              if (t.dependencies?.includes(pid)) {
                // 담당자가 다르면 연쇄 반영 제외
                if ((t.assignee ?? '') !== sourceAssignee) continue;
                if (!succ.has(t.id)) { succ.add(t.id); stack.push(t.id); }
              }
            }
          }
          return succ;
        };
        const getPredecessorIds = (succId: string): Set<string> => {
          const preds = new Set<string>();
          const stack = [succId];
          const existingIds = new Set(projectTaskList.map(t => t.id));
          while (stack.length) {
            const sid = stack.pop()!;
            const t = projectTaskList.find(x => x.id === sid);
            const deps = (t?.dependencies ?? []).filter(depId => existingIds.has(depId));
            for (const depId of deps) {
              if (!dateLocked.has(depId) && !preds.has(depId)) {
                preds.add(depId);
                stack.push(depId);
              }
            }
          }
          return preds;
        };
        const successorIds = getSuccessorIds(id);
        const predecessorIds = getPredecessorIds(id);
        const affectedIds = new Set<string>([id, ...descendantIds, ...successorIds, ...predecessorIds]);

        const oldStart = parseISO(task.startDate);
        const newStart = parseISO(updatedTask.startDate);
        if (isValid(oldStart) && isValid(newStart)) {
          const deltaDays = Math.round(differenceInDays(newStart, oldStart));
          if (deltaDays !== 0) {
            nextTasks = nextTasks.map(t => {
              if (t.id === id) return t; // 본인은 위에서 반영
              if (t.projectId !== task.projectId || !affectedIds.has(t.id)) return t;
              const start = parseISO(t.startDate);
              const end = parseISO(t.endDate);
              if (!isValid(start) || !isValid(end)) return t;
              return {
                ...t,
                startDate: format(addDays(start, deltaDays), 'yyyy-MM-dd'),
                endDate: format(addDays(end, deltaDays), 'yyyy-MM-dd'),
              };
            });
          }
        }

        const projectTasksForSchedule = nextTasks.filter(t => t.projectId === task.projectId);
        // 선행관계만 변경된 경우: 해당 작업도 재계산. 날짜 직접 변경 시 사용자 선택 보존.
        const excludeFromRecalc = hasDateChange ? new Set([id]) : undefined;
        const adjusted = applyDependencySchedule(projectTasksForSchedule, projectAssignmentsMap, excludeFromRecalc);
        const adjustedById = new Map(adjusted.map(t => [t.id, t]));

        // 대상 작업들(affectedIds)만 최신화 (상관없는 타 담당자 업무/독립업무는 원본 유지)
        nextTasks = nextTasks.map(t => {
          if (t.projectId !== task.projectId) return t;
          if (affectedIds.has(t.id)) {
            return adjustedById.get(t.id) ?? t;
          }
          return t;
        });
      }

      const affectsRollup = ['startDate', 'endDate', 'workEffort', 'dependencies'].some(k => Object.prototype.hasOwnProperty.call(updates, k));
      const result = !affectsRollup ? nextTasks
        : prev.some(t => t.parentId === id && t.projectId === task.projectId)
          ? syncParentRollups(nextTasks, id)
          : syncParentRollups(nextTasks, task.parentId);

      const taskInResult = result.find(t => t.id === id);
      const sortOrder = taskInResult != null ? result.indexOf(taskInResult) : 0;
      if (!useLocalOnly) {
        // DB 반영은 수동 버튼에서 처리
      }
      return result;
    });
  };

  const updateTasksBulk = (taskIds: string[], updates: Partial<Task>) => {
    const hasScheduleChange =
      Object.prototype.hasOwnProperty.call(updates, 'startDate') ||
      Object.prototype.hasOwnProperty.call(updates, 'endDate') ||
      Object.prototype.hasOwnProperty.call(updates, 'workEffort') ||
      Object.prototype.hasOwnProperty.call(updates, 'dependencies');
    if (hasScheduleChange || taskIds.length === 0) return;
    saveHistory();
    const idSet = new Set(taskIds);
    setAllTasks(prev => {
      const next = prev.map(t =>
        idSet.has(t.id) ? { ...t, ...updates } : t
      );
      return next;
    });
  };

  const setBaselineForTasks = (taskIds: string[]) => {
    if (taskIds.length === 0) return;
    saveHistory();
    setAllTasks(prev => {
      const idSet = new Set(taskIds);
      const next = prev.map(t => {
        if (!idSet.has(t.id)) return t;
        return {
          ...t,
          baselineStartDate: t.startDate,
          baselineEndDate: t.endDate,
          baselineWorkEffort: t.workEffort,
        };
      });
      return next;
    });
  };

  const setBaselineForAllTasks = () => {
    const ids = currentProjectId === 'all'
      ? allTasks.map(t => t.id)
      : allTasks.filter(t => t.projectId === currentProjectId).map(t => t.id);
    setBaselineForTasks(ids);
  };

  const renameAssignee = (oldName: string, newName: string) => {
    const from = (oldName ?? '').trim();
    const to = (newName ?? '').trim();
    if (!from || !to || from === to) return;
    saveHistory();

    // 프로젝트의 투입(assignments) 담당자명 변경
    setProjects(prev => {
      const next = prev.map(p => {
        const assignments = p.assignments ?? [];
        const has = assignments.some(a => (a.assignee ?? '').trim() === from);
        if (!has) return p;
        const updated: Project = {
          ...p,
          assignments: assignments.map(a => ((a.assignee ?? '').trim() === from ? { ...a, assignee: to } : a)),
        };
        return updated;
      });
      return next;
    });

    // 작업의 assignee 및 assignments 담당자명 변경
    setAllTasks(prev => {
      const next = prev.map(t => {
        const nextAssignee = ((t.assignee ?? '').trim() === from) ? to : t.assignee;
        const nextAssignments = Array.isArray(t.assignments)
          ? t.assignments.map(a => ((a.assignee ?? '').trim() === from ? { ...a, assignee: to } : a))
          : t.assignments;
        if (nextAssignee === t.assignee && nextAssignments === t.assignments) return t;
        return { ...t, assignee: nextAssignee ?? '', assignments: nextAssignments };
      });
      if (!useLocalOnly) upsertTasks(next).catch(err => handleDbError(err, '투입인원 이름 변경 저장에 실패했습니다.'));
      return next;
    });
  };

  /** 선후관계·기간(공수·투입율)을 반영해 현재 프로젝트(또는 전체) 일정을 앞당기도록 재계산 */
  const refreshProjectSchedule = () => {
    const projectIds = currentProjectId === 'all'
      ? projects.map(p => p.id).filter(Boolean)
      : [currentProjectId].filter(Boolean);
    if (projectIds.length === 0) return;
    saveHistory();
    setAllTasks(prev => {
      const projectAssignmentsByProjectId = new Map<string, TaskAssignment[]>(
        projects.map(p => [p.id, p.assignments ?? []])
      );
      let result = prev;
      for (const effectiveProjectId of projectIds) {
        const projectTasks = result.filter(t => t.projectId === effectiveProjectId);
        if (projectTasks.length === 0) continue;
        const adjusted = applyDependencySchedule(projectTasks, projectAssignmentsByProjectId);
        const adjustedById = new Map(adjusted.map(t => [t.id, t]));
        result = result.map(t => t.projectId === effectiveProjectId ? (adjustedById.get(t.id) ?? t) : t);
        result = recomputeProjectRollups(result, effectiveProjectId);
      }
      return result;
    });
  };

  /** 과부하 자동 수정: 항목별로 선택한 전략(기간 연장/투입율 증가) 적용. */
  const fixOverload = (overloadsToFix: Array<{ overload: WorkloadDay; strategy: 'extend' | 'increaseAllocation' }>) => {
    if (overloadsToFix.length === 0) return;
    saveHistory();
    const extendOverloads = overloadsToFix.filter((x) => x.strategy === 'extend').map((x) => x.overload);
    const allocationOverloads = overloadsToFix.filter((x) => x.strategy === 'increaseAllocation').map((x) => x.overload);
    setAllTasks((prev) => {
      let result = [...prev];
      const allocationTaskIds = new Set(allocationOverloads.flatMap((o) => o.taskIds));
      if (extendOverloads.length > 0) {
        result = fixOverloadByExtending(result, projects, extendOverloads);
      }
      if (allocationOverloads.length > 0) {
        const { overloads: currentOverloads } = computeWorkloadOverloads(result, projects);
        const toAllocate = currentOverloads.filter((o) => o.taskIds.some((tid) => allocationTaskIds.has(tid)));
        if (toAllocate.length > 0) {
          result = fixOverloadByIncreasingAllocation(result, projects, toAllocate);
        }
      }
      const projectIds = Array.from(new Set(result.map((t) => t.projectId))).filter(Boolean) as string[];
      for (const pid of projectIds) {
        result = recomputeProjectRollups(result, pid);
      }
      return result;
    });
  };

  const deleteTask = (id: string) => {
    saveHistory();
    setAllTasks(prev => {
      const taskToDelete = prev.find(t => t.id === id);
      if (!taskToDelete) return prev;
      const getAllDescendantIds = (parentId: string, list: Task[]): string[] => {
        const children = list.filter(t => t.parentId === parentId);
        return [...children.map(c => c.id), ...children.flatMap(c => getAllDescendantIds(c.id, list))];
      };
      const idsToDelete = [id, ...getAllDescendantIds(id, prev)];
      if (taskToDelete.projectId) recordDeletedTaskIds(taskToDelete.projectId, idsToDelete);
      return syncParentRollups(prev.filter(t => !new Set(idsToDelete).has(t.id)), taskToDelete.parentId);
    });
  };

  // ─── 이동 / 재정렬 ────────────────────────────────────────────────────────

  const moveTask = (id: string, direction: 'up' | 'down') => {
    saveHistory();
    setAllTasks(prev => {
      const projectTasks = prev.filter(t => t.projectId === currentProjectId);
      const otherTasks = prev.filter(t => t.projectId !== currentProjectId);
      const task = projectTasks.find(t => t.id === id);
      if (!task) return prev;
      const siblings = projectTasks.filter(t => t.parentId === task.parentId);
      const idx = siblings.findIndex(t => t.id === id);
      let newProjectTasks = [...projectTasks];
      if (direction === 'up' && idx > 0) {
        const iA = projectTasks.findIndex(t => t.id === task.id);
        const iB = projectTasks.findIndex(t => t.id === siblings[idx - 1].id);
        [newProjectTasks[iA], newProjectTasks[iB]] = [newProjectTasks[iB], newProjectTasks[iA]];
      } else if (direction === 'down' && idx < siblings.length - 1) {
        const iA = projectTasks.findIndex(t => t.id === task.id);
        const iB = projectTasks.findIndex(t => t.id === siblings[idx + 1].id);
        [newProjectTasks[iA], newProjectTasks[iB]] = [newProjectTasks[iB], newProjectTasks[iA]];
      } else return prev;
      const result = [...otherTasks, ...newProjectTasks];
      return result;
    });
  };

  const reorderTask = (id: string, overId: string) => {
    saveHistory();
    setAllTasks(prev => {
      const projectTasks = prev.filter(t => t.projectId === currentProjectId);
      const otherTasks = prev.filter(t => t.projectId !== currentProjectId);
      const oldIndex = projectTasks.findIndex(t => t.id === id);
      const newIndex = projectTasks.findIndex(t => t.id === overId);
      if (oldIndex === -1 || newIndex === -1) return prev;
      const arr = [...projectTasks];
      const [moved] = arr.splice(oldIndex, 1);
      arr.splice(newIndex, 0, moved);
      const result = [...otherTasks, ...arr];
      return result;
    });
  };

  // ─── 들여쓰기 ─────────────────────────────────────────────────────────────

  const indentTask = (id: string) => {
    saveHistory();
    setAllTasks(prev => {
      const projectTasks = prev.filter(t => t.projectId === currentProjectId);
      const otherTasks = prev.filter(t => t.projectId !== currentProjectId);
      const task = projectTasks.find(t => t.id === id);
      if (!task) return prev;
      const siblings = projectTasks.filter(t => t.parentId === task.parentId);
      const idx = siblings.findIndex(t => t.id === id);
      if (idx <= 0) return prev;
      const newParent = siblings[idx - 1];
      const updated = projectTasks.map(t => {
        if (t.id === id) return { ...t, parentId: newParent.id };
        if (t.id === newParent.id) return { ...t, expanded: true };
        return t;
      });
      const result = recomputeProjectRollups([...otherTasks, ...updated], currentProjectId);
      return result;
    });
  };

  const outdentTask = (id: string) => {
    saveHistory();
    setAllTasks(prev => {
      const projectTasks = prev.filter(t => t.projectId === currentProjectId);
      const otherTasks = prev.filter(t => t.projectId !== currentProjectId);
      const task = projectTasks.find(t => t.id === id);
      if (!task || !task.parentId) return prev;
      const parent = projectTasks.find(t => t.id === task.parentId);
      if (!parent) return prev;
      const updated = projectTasks.map(t => t.id === id ? { ...t, parentId: parent.parentId } : t);
      const result = recomputeProjectRollups([...otherTasks, ...updated], currentProjectId);
      return result;
    });
  };

  const indentTasks = (ids: string[]) => {
    saveHistory();
    setAllTasks(prev => {
      let projectTasks = prev.filter(t => t.projectId === currentProjectId);
      const otherTasks = prev.filter(t => t.projectId !== currentProjectId);
      const selectedIds = new Set(ids);
      for (const id of ids) {
        const task = projectTasks.find(t => t.id === id);
        if (!task || (task.parentId && selectedIds.has(task.parentId))) continue;
        const siblings = projectTasks.filter(t => t.parentId === task.parentId);
        const idx = siblings.findIndex(t => t.id === id);
        if (idx > 0) {
          const newParent = siblings[idx - 1];
          projectTasks = projectTasks.map(t => {
            if (t.id === id) return { ...t, parentId: newParent.id };
            if (t.id === newParent.id) return { ...t, expanded: true };
            return t;
          });
        }
      }
      const result = recomputeProjectRollups([...otherTasks, ...projectTasks], currentProjectId);
      return result;
    });
  };

  const outdentTasks = (ids: string[]) => {
    saveHistory();
    setAllTasks(prev => {
      let projectTasks = prev.filter(t => t.projectId === currentProjectId);
      const otherTasks = prev.filter(t => t.projectId !== currentProjectId);
      const selectedIds = new Set(ids);
      for (const id of ids) {
        const task = projectTasks.find(t => t.id === id);
        if (!task || !task.parentId || selectedIds.has(task.parentId)) continue;
        const parent = projectTasks.find(t => t.id === task.parentId);
        if (!parent) continue;
        projectTasks = projectTasks.map(t => t.id === id ? { ...t, parentId: parent.parentId } : t);
      }
      const result = recomputeProjectRollups([...otherTasks, ...projectTasks], currentProjectId);
      return result;
    });
  };

  const toggleExpand = (id: string) => {
    setAllTasks(prev => {
      const updated = prev.map(t => t.id === id ? { ...t, expanded: !t.expanded } : t);
      const target = updated.find(t => t.id === id);
      return updated;
    });
  };

  const expandToLevel = (level: number) => {
    const targetLevel = Math.max(1, Math.floor(level || 1));
    setTreeExpandLevel(targetLevel);
    saveHistory();
    setAllTasks(prev => {
      const relevant = currentProjectId === 'all' ? prev : prev.filter(t => t.projectId === currentProjectId);
      const relevantIds = new Set(relevant.map(t => t.id));
      const taskMap = new Map<string, Task>(relevant.map(t => [t.id, t] as const));
      const depthMemo = new Map<string, number>();
      const getDepth = (id: string): number => {
        const cached = depthMemo.get(id);
        if (cached !== undefined) return cached;
        const t = taskMap.get(id);
        if (!t || !t.parentId || !taskMap.has(t.parentId)) { depthMemo.set(id, 0); return 0; }
        const d = getDepth(t.parentId) + 1;
        depthMemo.set(id, d);
        return d;
      };
      const hasChildren = new Set<string>();
      for (const t of relevant) { if (t.parentId && taskMap.has(t.parentId)) hasChildren.add(t.parentId); }
      const result = prev.map(t => {
        if (!relevantIds.has(t.id) || !hasChildren.has(t.id)) return t;
        const shouldExpand = (getDepth(t.id) + 1) < targetLevel;
        if (!!t.expanded === shouldExpand) return t;
        return { ...t, expanded: shouldExpand };
      });
      return result;
    });
  };

  // ─── 가져오기 / 삭제 ──────────────────────────────────────────────────────

  const importTasks = async (newTasks: Task[], targetProjectId?: string, newProjectName?: string): Promise<void> => {
    saveHistory();
    let effectiveProjectId =
      targetProjectId ?? (currentProjectId === 'all' ? (projects[0]?.id || '') : currentProjectId);

    const createNewProject =
      effectiveProjectId === '__new__' && typeof newProjectName === 'string' && newProjectName.trim().length > 0;

    const newProject: Project | null = createNewProject
      ? {
          id: uuidv4(),
          name: newProjectName!.trim() || '가져온 프로젝트',
          ownerId: ownerId ?? undefined,
        }
      : null;

    if (newProject) {
      effectiveProjectId = newProject.id;
    }

    const tasksWithProject = newTasks.map((t) => ({ ...t, projectId: effectiveProjectId }));

    // 로컬이 SSOT: UI 상태를 즉시 반영 (DB 반영은 수동 버튼에서)
    if (newProject) {
      setProjects((prev) => [...prev, newProject]);
      setCurrentProjectId(newProject.id);
    }
    setAllTasks((prev) => {
      const prevProjectTaskIds = prev.filter(t => t.projectId === effectiveProjectId).map(t => t.id);
      const nextProjectTaskIds = tasksWithProject.map(t => t.id);
      const removed = prevProjectTaskIds.filter(id => !new Set(nextProjectTaskIds).has(id));
      if (removed.length > 0) recordDeletedTaskIds(effectiveProjectId, removed);
      return recomputeProjectRollups(
        [...prev.filter((t) => t.projectId !== effectiveProjectId), ...tasksWithProject],
        effectiveProjectId
      );
    });
  };

  const deleteAllTasks = () => {
    saveHistory();
    const effectiveProjectId = currentProjectId === 'all' ? '' : currentProjectId;
    setAllTasks(prev => {
      if (effectiveProjectId) {
        const ids = prev.filter(t => t.projectId === effectiveProjectId).map(t => t.id);
        if (ids.length > 0) recordDeletedTaskIds(effectiveProjectId, ids);
      } else {
        const idsByProject = new Map<string, string[]>();
        prev.forEach(t => {
          if (!t.projectId) return;
          idsByProject.set(t.projectId, [...(idsByProject.get(t.projectId) ?? []), t.id]);
        });
        idsByProject.forEach((ids, pid) => recordDeletedTaskIds(pid, ids));
      }
      const result = effectiveProjectId ? prev.filter(t => t.projectId !== effectiveProjectId) : [];
      return result;
    });
  };

  const deleteAllTasksInAllProjects = () => {
    saveHistory();
    setAllTasks(prev => {
      const idsByProject = new Map<string, string[]>();
      prev.forEach(t => {
        if (!t.projectId) return;
        idsByProject.set(t.projectId, [...(idsByProject.get(t.projectId) ?? []), t.id]);
      });
      idsByProject.forEach((ids, pid) => recordDeletedTaskIds(pid, ids));
      return [];
    });
  };

  const resetAllProjectsToNew = async (): Promise<void> => {
    // 전체 프로젝트를 제거하고 '새 프로젝트'로 리셋 (명시적 사용자 액션)
    const newProject: Project = { id: uuidv4(), name: '새 프로젝트', ownerId: ownerId };
    saveHistory();
    setSelectedTaskIds([]);
    setProjects([newProject]);
    setAllTasks(prev => {
      const idsByProject = new Map<string, string[]>();
      prev.forEach(t => {
        if (!t.projectId) return;
        idsByProject.set(t.projectId, [...(idsByProject.get(t.projectId) ?? []), t.id]);
      });
      idsByProject.forEach((ids, pid) => recordDeletedTaskIds(pid, ids));
      return [];
    });
    setCurrentProjectId(newProject.id);
    try {
      sessionStorage.setItem('wbs-current-project', newProject.id);
    } catch (_) {}

    // DB 반영은 수동 버튼에서 처리
  };

  // ─── 백업 ─────────────────────────────────────────────────────────────────

  const restoreBackup = (data: BackupData) => {
    const projectIds = Array.from(new Set(data.tasks.map(t => t.projectId))).filter(Boolean) as string[];
    let rolled = data.tasks;
    for (const pid of projectIds) rolled = recomputeProjectRollups(rolled, pid);
    setProjects(data.projects);
    setAllTasks(rolled);
    setWbsSettings(parseSettings(data.settings));
    if (data.projects.length > 0) {
      if (!data.projects.find(p => p.id === currentProjectId)) setCurrentProjectId(data.projects[0].id);
    } else setCurrentProjectId('');
    // DB 반영은 수동 버튼에서 처리
  };

  const exportFullBackup = (): BackupData => ({
    version: '1.0', projects, tasks: allTasks, settings: wbsSettings, exportDate: new Date().toISOString(),
  });

  const mergeBackups = (backups: BackupData[]): { addedProjects: number; addedTasks: number } => {
    const newProjects: Project[] = [];
    const newTasks: Task[] = [];
    for (const backup of backups) {
      const projectIdMap = new Map<string, string>();
      for (const project of backup.projects) {
        const newId = uuidv4(); projectIdMap.set(project.id, newId); newProjects.push({ ...project, id: newId, ownerId: ownerId ?? project.ownerId });
      }
      const taskIdMap = new Map<string, string>();
      for (const task of backup.tasks) taskIdMap.set(task.id, uuidv4());
      for (const task of backup.tasks) {
        const newProjectId = projectIdMap.get(task.projectId);
        if (!newProjectId) continue;
        newTasks.push({ ...task, id: taskIdMap.get(task.id)!, projectId: newProjectId, parentId: task.parentId ? (taskIdMap.get(task.parentId) ?? null) : null, dependencies: task.dependencies?.map(depId => taskIdMap.get(depId) ?? depId) ?? [] });
      }
    }
    setProjects(prev => [...prev, ...newProjects]);
    setAllTasks(prev => {
      const rolled = applyRollupsToTasks([...prev, ...newTasks]);
      return rolled;
    });
    if (newProjects.length > 0) setCurrentProjectId(newProjects[0].id);
    return { addedProjects: newProjects.length, addedTasks: newTasks.length };
  };

  return (
    <WBSContext.Provider value={{
      allTasks,
      tasks,
      projects,
      currentProjectId,
      setCurrentProjectId,
      selectedTaskIds,
      setSelectedTaskIds,
      wbsSettings,
      updateWbsSettings,
      treeExpandLevel,
      setTreeExpandLevel,
      addProject,
      updateProject,
      deleteProject,
      copyProject,
      addTask,
      addTasks,
      updateTask,
      updateTasksBulk,
      deleteTask,
      moveTask,
      reorderTask,
      indentTask,
      outdentTask,
      indentTasks,
      outdentTasks,
      toggleExpand,
      expandToLevel,
      importTasks,
      deletedTaskIdsByProject,
      syncToDb,
      deleteAllTasks,
      deleteAllTasksInAllProjects,
      resetAllProjectsToNew,
      wbsMap,
      displayWbsMap,
      restoreBackup,
      mergeBackups,
      exportFullBackup,
      undo,
      canUndo,
      redo,
      canRedo,
      setBaselineForTasks,
      setBaselineForAllTasks,
      renameAssignee,
      refreshProjectSchedule,
      fixOverload,
      isLoading,
    }}>
      {children}
    </WBSContext.Provider>
  );
}

export function useWBS() {
  const context = useContext(WBSContext);
  if (!context) {
    throw new Error(
      'useWBS must be used within a WBSProvider. Ensure main.tsx wraps the app with <WBSProvider> and that WBSContext is not imported from two different paths (e.g. src/ vs src\\)'
    );
  }
  return context;
}
