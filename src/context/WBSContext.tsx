import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { Task, Project, ProjectAssignment } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { BackupData } from '../lib/export';
import { format, isValid, parseISO } from 'date-fns';
import { buildChildrenByParent } from '../lib/taskView';
import { getTopologicalOrder } from '../lib/schedule';
import { getHolidaysForTaskDates } from '../lib/calendar';
import {
  upsertProject,
  upsertTask,
  upsertTasks,
  upsertSettings,
  fetchProjects,
  fetchTasks,
  fetchSettings,
  fetchSettingsRow,
  fetchTaskRows,
  fromTaskRow,
  fromProjectRow,
  fromSettingsRow,
  projectNeedsDbUpload,
  collectTasksNeedingUpload,
  settingsNeedDbUpload,
  serverTaskRowMatchesLocalTask,
  mergeProjectsDelta,
  mergeTasksDelta,
  deleteProjectFromDB,
  deleteTasksFromDB,
  restoreBackupToDB,
} from '../lib/db';
import {
  type PersistKey,
  loadJsonWithIdbFallback,
  saveJsonWithIdbFallback,
  safeLocalGet,
  WBS_INIT_BLANK_SESSION_KEY,
  clearInitBlankSessionFlag,
} from '../lib/persist';
import { supabase, isSupabaseConfigured, type TaskRow, type ProjectRow, type SettingsRow } from '../lib/supabase';
import { isRealtimeMinimized } from '../lib/realtimePolicy';
import { useAuth } from './AuthContext';
import { useWbsHistory } from '../hooks/useWbsHistory';
import { StatusConfig, WBSSettings, DEFAULT_STATUS_CONFIGS, DEFAULT_SETTINGS, parseSettings } from '../lib/wbsSettings';
import { syncParentRollups, recomputeProjectRollups, applyRollupsToTasks, mirrorForkedProjectsAndRollUp } from '../lib/rollups';
import { getPlannedOverrideLocal } from '../lib/plannedOverrideLocalCache';
import { onProgressRollupOptionChange } from '../lib/rollupOptions';
import { isDevAuthBypass } from '../lib/devAuthBypass';
import { buildDevSeed } from '../lib/devSeed';
import { type RealtimeChangePayload, type DbSyncSummaryByProject, type DbSyncSummary, type WBSContextType } from './wbsContextTypes';
import { formatProjectDisplayName, DEFAULT_NEW_PROJECT_KIND } from '../lib/projectKind';

/** 로컬 설정 위에 DB 설정을 올린 뒤 parseSettings로 마이그레이션·정규화(표 컬럼 등)를 한 번에 적용 */
function mergeWbsSettingsWithDbPatch(local: WBSSettings, db: Partial<WBSSettings> | null | undefined): WBSSettings {
  if (!db) return local;
  const keys = Object.keys(db) as Array<keyof WBSSettings>;
  if (keys.length === 0) return local;
  return parseSettings({ ...local, ...db });
}

// Extracted hooks
import { useProjectOps } from './hooks/useProjectOps';
import { useTaskOps } from './hooks/useTaskOps';
import { useTaskMovement } from './hooks/useTaskMovement';
import { useBackupOps } from './hooks/useBackupOps';

// Re-exports for backward compatibility
export type { StatusConfig, WBSSettings, DbSyncSummaryByProject, DbSyncSummary };

const WBSContext = createContext<WBSContextType | undefined>(undefined);
const INITIAL_DB_LOAD_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

// ─── Provider ─────────────────────────────────────────────────────────────────

/** `clientProjectAllowlist`: 외주 등 — `project_members`에 포함된 ID만 유지(RLS 누락·로컬 캐시 시에도 UI·상태 일치). 미전달 시 필터 없음 */
export function WBSProvider({
  children,
  useLocalOnly = false,
  onConcurrentConflict,
  onDbError,
  editableProjectIds,
  isAdmin = false,
  clientProjectAllowlist,
}: {
  children: React.ReactNode;
  useLocalOnly?: boolean;
  onConcurrentConflict?: () => void;
  onDbError?: (message: string) => void;
  editableProjectIds?: string[];
  isAdmin?: boolean;
  clientProjectAllowlist?: string[];
}) {
  const { user } = useAuth();
  const handleDbError = React.useCallback(
    (err: unknown, fallback: string) => {
      if (import.meta.env.DEV) console.warn(fallback, err);
      let msg = err instanceof Error ? err.message : fallback;
      if (err && typeof err === 'object') {
        const anyE = err as { code?: string; message?: string };
        const code = String(anyE.code ?? '').trim();
        const rawMsg = String(anyE.message ?? '').trim();
        if (code === '42501' || /row-level security|row level security/i.test(rawMsg)) {
          msg = '이 프로젝트에 대한 편집 권한이 없습니다. 보기 권한만 있거나 멤버가 아닌 프로젝트에는 작업을 추가·수정할 수 없습니다.';
        }
      }
      onDbError?.(msg);
    },
    [onDbError],
  );

  // ─── Core State ─────────────────────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string>('');
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  /** 표↔간트 시각 강조 동기화용 단일 활성 행. 체크박스(selectedTaskIds)와는 별개로 관리한다. */
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [wbsSettings, setWbsSettings] = useState<WBSSettings>(DEFAULT_SETTINGS);
  const [treeExpandLevel, setTreeExpandLevel] = useState<number>(() => Math.min(9, DEFAULT_SETTINGS.maxLevel + 1));
  const [deletedTaskIdsByProject, setDeletedTaskIdsByProject] = useState<Record<string, string[]>>({});
  const [deletedProjectIds, setDeletedProjectIds] = useState<string[]>([]);

  const persistDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hasLocalChangesSinceSync, setHasLocalChangesSinceSync] = useState(false);
  const dirtyEpochRef = useRef(0);
  const [collabPushNonce, setCollabPushNonce] = useState(0);
  const bumpDirty = useCallback(() => {
    dirtyEpochRef.current += 1;
    setCollabPushNonce((n) => n + 1);
    setHasLocalChangesSinceSync(true);
  }, []);

  // ─── Refs (latest-value access for closures) ───────────────────────────────
  const hasLocalChangesSinceSyncRef = useRef(false);
  hasLocalChangesSinceSyncRef.current = hasLocalChangesSinceSync;
  const projectsRef = useRef<Project[]>([]);
  projectsRef.current = projects;
  const currentProjectIdRef = useRef(currentProjectId);
  currentProjectIdRef.current = currentProjectId;
  const wbsSettingsRef = useRef<WBSSettings>(DEFAULT_SETTINGS);
  wbsSettingsRef.current = wbsSettings;
  const useLocalOnlyRef = useRef(useLocalOnly);
  useLocalOnlyRef.current = useLocalOnly;
  const onConcurrentConflictRef = useRef(onConcurrentConflict);
  onConcurrentConflictRef.current = onConcurrentConflict;
  const handleDbErrorRef = useRef(handleDbError);
  handleDbErrorRef.current = handleDbError;
  const serverPullFromDbRef = useRef<() => Promise<void>>(async () => {});
  const allTasksRef = useRef<Task[]>([]);
  const deletedTaskIdsByProjectRef = useRef<Record<string, string[]>>({});
  deletedTaskIdsByProjectRef.current = deletedTaskIdsByProject;
  const lastConflictRef = useRef<number>(0);
  const CONFLICT_DEBOUNCE_MS = 2000;
  const initNewProjectPromiseRef = useRef<Promise<Project | null> | null>(null);

  const ownerId = user?.id ?? undefined;
  const ownerIdRef = useRef<string | undefined>(undefined);
  ownerIdRef.current = ownerId;

  /** 외주 계정: 멤버십 ID가 확정된 뒤·DB 목록이 갱신될 때마다 상태를 한 번 더 좁힘 */
  useEffect(() => {
    if (clientProjectAllowlist === undefined) return;
    const allow = new Set(clientProjectAllowlist);
    setProjects((prev) => {
      const next = prev.filter((p) => allow.has(p.id));
      if (next.length === prev.length) {
        let same = true;
        for (let i = 0; i < next.length; i++) {
          if (prev[i]?.id !== next[i]?.id) {
            same = false;
            break;
          }
        }
        if (same) return prev;
      }
      return next;
    });
    setAllTasks((prev) => {
      const next = prev.filter((t) => allow.has(t.projectId));
      if (next.length === prev.length) {
        let same = true;
        for (let i = 0; i < next.length; i++) {
          if (prev[i]?.id !== next[i]?.id) {
            same = false;
            break;
          }
        }
        if (same) return prev;
      }
      return next;
    });
    setCurrentProjectId((cur) => {
      if (allow.size === 0) {
        if (cur === 'all' || cur === '') return cur;
        return '';
      }
      if (cur === 'all') return cur;
      if (!cur) return allow.size === 1 ? [...allow][0]! : 'all';
      if (allow.has(cur)) return cur;
      return allow.size === 1 ? [...allow][0]! : 'all';
    });
  }, [clientProjectAllowlist, projects.length, allTasks.length]);

  const creatorDisplayNameRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!user) {
      creatorDisplayNameRef.current = undefined;
      return;
    }
    const meta = user.user_metadata as { full_name?: string } | undefined;
    const fromMeta = (meta?.full_name && String(meta.full_name).trim()) || '';
    creatorDisplayNameRef.current = fromMeta || (user.email && String(user.email).trim()) || undefined;
  }, [user]);

  const { saveHistory, undo, redo, canUndo, canRedo } = useWbsHistory({
    allTasksRef,
    setAllTasks,
    bumpDirty,
    useLocalOnlyRef,
    handleDbError,
  });

  const preserveLocalExpanded = useCallback((incoming: Task[]): Task[] => {
    const localMap = new Map<string, boolean>(allTasksRef.current.map((t) => [t.id, t.expanded]));
    if (localMap.size === 0) return incoming;
    return incoming.map((t) => {
      const localExp = localMap.get(t.id);
      return localExp !== undefined ? { ...t, expanded: localExp } : t;
    });
  }, []);

  const recordDeletedTaskIds = useCallback((projectId: string, ids: string[]) => {
    const pid = String(projectId ?? '');
    const unique = Array.from(new Set(ids.filter(Boolean)));
    if (!pid || unique.length === 0) return;
    setDeletedTaskIdsByProject((prev) => {
      const existing = prev[pid] ?? [];
      const merged = Array.from(new Set([...existing, ...unique]));
      if (merged.length === existing.length) return prev;
      return { ...prev, [pid]: merged };
    });
  }, []);

  // 프로젝트 전환 시 선택 초기화
  useEffect(() => {
    setSelectedTaskIds([]);
  }, [currentProjectId]);

  // ─── Extracted Hooks ────────────────────────────────────────────────────────

  const projectOps = useProjectOps({
    saveHistory,
    bumpDirty,
    handleDbError,
    ownerIdRef,
    creatorDisplayNameRef,
    projectsRef,
    allTasksRef,
    currentProjectIdRef,
    useLocalOnlyRef,
    setProjects,
    setAllTasks,
    setCurrentProjectId,
    recordDeletedTaskIds,
  });

  const taskOps = useTaskOps({
    saveHistory,
    handleDbError,
    projectsRef,
    currentProjectIdRef,
    wbsSettingsRef,
    useLocalOnlyRef,
    allTasksRef,
    setAllTasks,
    setProjects,
    recordDeletedTaskIds,
    bumpDirty,
  });

  const taskMovement = useTaskMovement({
    saveHistory,
    setAllTasks,
    currentProjectIdRef,
    allTasksRef,
    setTreeExpandLevel,
    bumpDirty,
  });

  const backupOps = useBackupOps({
    saveHistory,
    bumpDirty,
    recordDeletedTaskIds,
    ownerIdRef,
    creatorDisplayNameRef,
    currentProjectIdRef,
    projectsRef,
    allTasksRef,
    wbsSettingsRef,
    setProjects,
    setAllTasks,
    setCurrentProjectId,
    setWbsSettings,
    setSelectedTaskIds,
    setDeletedProjectIds,
  });

  // ─── 초기 데이터 로딩 (Supabase) ────────────────────────────────────────────

  useEffect(() => {
    // 이미 한 번 로드된 적이 있으면(=화면에 표시 중인 데이터가 있으면) 스켈레톤을 띄우지 않고
    // 백그라운드 갱신으로 처리한다. 포커스 복귀로 effect가 재실행되더라도 사용자에게 깜빡임이 보이지 않게.
    const isInitialLoad = projectsRef.current.length === 0 && allTasksRef.current.length === 0;
    const loadData = async () => {
      if (isInitialLoad) setIsLoading(true);
      const skipDbUntilSync = (() => {
        try {
          return localStorage.getItem(WBS_INIT_BLANK_SESSION_KEY) === '1';
        } catch {
          return false;
        }
      })();
      const emptyStarterProject = (): Project => ({
        id: uuidv4(),
        name: '새 프로젝트',
        ownerId,
        _autoGenerated: true,
        projectKind: DEFAULT_NEW_PROJECT_KIND,
        includeInDashboard: false,
      });

      const loadFromLocalOnly = async () => {
        const [fallbackProjects, fallbackTasks, rawSettings, fallbackDeleted, fallbackDeletedProjects] = await Promise.all([
          loadJsonWithIdbFallback<Project[]>('wbs-projects'),
          loadJsonWithIdbFallback<Task[]>('wbs-tasks'),
          loadJsonWithIdbFallback<unknown>('wbs-settings'),
          loadJsonWithIdbFallback<Record<string, string[]>>('wbs-deleted-task-ids'),
          loadJsonWithIdbFallback<string[]>('wbs-deleted-project-ids'),
        ]);
        const parsedSettings = parseSettings(rawSettings);
        setDeletedTaskIdsByProject(fallbackDeleted && typeof fallbackDeleted === 'object' ? fallbackDeleted : {});
        setDeletedProjectIds(Array.isArray(fallbackDeletedProjects) ? fallbackDeletedProjects.filter(Boolean) : []);
        const projectsToUse = Array.isArray(fallbackProjects) ? fallbackProjects : [];
        const tasksToUse = Array.isArray(fallbackTasks) ? fallbackTasks : [];
        if (projectsToUse.length > 0) {
          setProjects(projectsToUse);
          setAllTasks(applyRollupsToTasks(tasksToUse, parsedSettings.statusConfigs));
          setWbsSettings(parsedSettings);
          const savedCurrent = localStorage.getItem('wbs-current-project') ?? sessionStorage.getItem('wbs-current-project');
          const validId = projectsToUse.find((p) => p.id === savedCurrent)?.id ?? projectsToUse[0]?.id ?? '';
          setCurrentProjectId(validId);
        } else if (isDevAuthBypass()) {
          // 로그인 우회(미리보기) 모드 + 로컬 데이터 없음 → 검증용 샘플 데이터 시드
          const seed = buildDevSeed(ownerId);
          setProjects(seed.projects);
          setAllTasks(applyRollupsToTasks(seed.tasks, DEFAULT_SETTINGS.statusConfigs));
          setWbsSettings(DEFAULT_SETTINGS);
          setCurrentProjectId(seed.projects[0]!.id);
        } else {
          const p = emptyStarterProject();
          setProjects([p]);
          setAllTasks(applyRollupsToTasks(tasksToUse, DEFAULT_SETTINGS.statusConfigs));
          setWbsSettings(DEFAULT_SETTINGS);
          setCurrentProjectId(p.id);
          try {
            localStorage.setItem('wbs-current-project', p.id);
          } catch {
            /* ignore */
          }
        }
        setTreeExpandLevel(Math.min(9, Math.max(1, (parsedSettings?.maxLevel ?? DEFAULT_SETTINGS.maxLevel) + 1)));
      };

      try {
        if (!skipDbUntilSync && !useLocalOnly && isSupabaseConfigured && supabase && user?.id) {
          try {
            // 로컬에 저장된 설정을 기본값으로 읽어둠 (favoriteProjectIds 등 DB에 없는 필드 보존)
            const localSettingsRaw = await loadJsonWithIdbFallback<unknown>('wbs-settings');
            const localSettings = parseSettings(localSettingsRaw);
            // 새로고침 시 아직 DB에 반영 안 된 삭제 목록을 IDB에서 읽어 복원 방지
            const [savedDeleted, savedDeletedProjIds] = await Promise.all([
              loadJsonWithIdbFallback<Record<string, string[]>>('wbs-deleted-task-ids'),
              loadJsonWithIdbFallback<string[]>('wbs-deleted-project-ids'),
            ]);
            const pendingDeletedTasks = savedDeleted && typeof savedDeleted === 'object' ? (savedDeleted as Record<string, string[]>) : {};
            const pendingDeletedProjIdSet = new Set(Array.isArray(savedDeletedProjIds) ? savedDeletedProjIds : []);
            const pendingDeletedTaskIdSet = new Set(Object.values(pendingDeletedTasks).flat());

            const [dbProjects, dbTasks, dbSettings] = await withTimeout(
              Promise.all([fetchProjects(), fetchTasks(), fetchSettings()]),
              INITIAL_DB_LOAD_TIMEOUT_MS,
              'Initial DB load',
            );
            setDeletedTaskIdsByProject(pendingDeletedTasks);
            setDeletedProjectIds(Array.from(pendingDeletedProjIdSet));
            if (!Array.isArray(dbProjects)) throw new Error('Invalid projects response');
            const filteredDbProjects = dbProjects.filter((p) => !pendingDeletedProjIdSet.has(p.id));
            if (dbProjects.length > 0) {
              setProjects(filteredDbProjects);
              const effectiveSettings = mergeWbsSettingsWithDbPatch(localSettings, dbSettings);
              setAllTasks(
                applyRollupsToTasks(
                  (Array.isArray(dbTasks) ? dbTasks : []).filter((t) => !pendingDeletedTaskIdSet.has(t.id)),
                  effectiveSettings.statusConfigs,
                ),
              );
              if (dbSettings) {
                setWbsSettings((prev) => parseSettings({ ...localSettings, ...prev, ...dbSettings }));
              } else {
                setWbsSettings(localSettings);
              }
              const savedCurrent = localStorage.getItem('wbs-current-project') ?? sessionStorage.getItem('wbs-current-project');
              const validId = filteredDbProjects.find((p) => p.id === savedCurrent)?.id ?? filteredDbProjects[0]?.id ?? '';
              if (validId) setCurrentProjectId(validId);
              const ml = effectiveSettings.maxLevel;
              setTreeExpandLevel(Math.min(9, Math.max(1, ml + 1)));
            } else {
              const p = emptyStarterProject();
              setProjects([p]);
              setAllTasks([]);
              if (dbSettings) {
                setWbsSettings((prev) => parseSettings({ ...prev, ...dbSettings }));
              } else {
                setWbsSettings(DEFAULT_SETTINGS);
              }
              setCurrentProjectId(p.id);
              try {
                localStorage.setItem('wbs-current-project', p.id);
              } catch {
                /* ignore */
              }
              setTreeExpandLevel(Math.min(9, DEFAULT_SETTINGS.maxLevel + 1));
            }
          } catch (e) {
            handleDbErrorRef.current(e, 'DB에서 불러오지 못했습니다. 이 기기에 저장된 데이터를 표시합니다.');
            await loadFromLocalOnly();
          }
        } else {
          await loadFromLocalOnly();
        }
      } catch (err) {
        try {
          const savedProjects = safeLocalGet('wbs-projects');
          const savedTasks = safeLocalGet('wbs-tasks');
          const savedSettings = safeLocalGet('wbs-settings');
          const p = emptyStarterProject();
          let fallbackProjects: Project[] = [];
          let fallbackTasks: Task[] = [];
          if (savedProjects) {
            try {
              const parsed = JSON.parse(savedProjects) as Project[];
              if (Array.isArray(parsed) && parsed.length > 0) fallbackProjects = parsed;
            } catch {
              /* ignore */
            }
          }
          if (savedTasks) {
            try {
              const parsed = JSON.parse(savedTasks) as Task[];
              if (Array.isArray(parsed)) fallbackTasks = parsed;
            } catch {
              /* ignore */
            }
          }
          const parsedSettings = parseSettings(savedSettings ? JSON.parse(savedSettings) : null);
          if (fallbackProjects.length > 0) {
            setProjects(fallbackProjects);
            setAllTasks(applyRollupsToTasks(fallbackTasks, parsedSettings.statusConfigs));
            setWbsSettings(parsedSettings);
            setCurrentProjectId(fallbackProjects[0]!.id);
          } else {
            setProjects([p]);
            setAllTasks(applyRollupsToTasks(fallbackTasks, DEFAULT_SETTINGS.statusConfigs));
            setWbsSettings(DEFAULT_SETTINGS);
            setCurrentProjectId(p.id);
          }
        } catch (fallbackErr) {
          if (import.meta.env.DEV) console.warn('[DB] 폴백 데이터 로딩 실패:', fallbackErr);
          const p = emptyStarterProject();
          setProjects([p]);
          setAllTasks([]);
          setWbsSettings(DEFAULT_SETTINGS);
          setCurrentProjectId(p.id);
        }
      } finally {
        if (isInitialLoad) setIsLoading(false);
      }
    };
    loadData();
  }, [useLocalOnly, user?.id]);

  // ─── 로컬 저장 (IndexedDB/localStorage) ────────────────────────────────────
  useEffect(() => {
    if (isLoading) return;
    if (persistDebounceRef.current) clearTimeout(persistDebounceRef.current);
    persistDebounceRef.current = setTimeout(() => {
      void (async () => {
        const results = await Promise.allSettled([
          saveJsonWithIdbFallback('wbs-projects', projects),
          saveJsonWithIdbFallback('wbs-tasks', allTasks),
          saveJsonWithIdbFallback('wbs-settings', wbsSettings),
          saveJsonWithIdbFallback('wbs-deleted-task-ids', deletedTaskIdsByProject),
          saveJsonWithIdbFallback('wbs-deleted-project-ids', deletedProjectIds),
        ]);
        const keys: PersistKey[] = ['wbs-projects', 'wbs-tasks', 'wbs-settings', 'wbs-deleted-task-ids', 'wbs-deleted-project-ids'];
        results.forEach((r, i) => {
          if (r.status === 'rejected') {
            if (import.meta.env.DEV) console.warn('[persist] 로컬 저장 실패:', keys[i], r.reason);
          } else if (r.value.used === 'none') {
            if (import.meta.env.DEV) console.warn('[persist] 로컬 저장 공간 부족:', keys[i]);
          }
        });
      })();
    }, 1000);
    return () => {
      if (persistDebounceRef.current) clearTimeout(persistDebounceRef.current);
    };
  }, [isLoading, projects, allTasks, wbsSettings, deletedTaskIdsByProject, deletedProjectIds]);

  // ─── Realtime: DB 변경사항 자동 반영 ───────────────────────────────────────
  // 협업(Realtime 자동 동기화) 기능 토글.
  // false면 다른 사용자/기기에서 일어난 DB 변경이 즉시 반영되지 않고,
  // 새로고침 또는 명시적 동기화 시에만 가져온다. 자기 변경의 자동 저장은 영향 없음.
  // 다시 켜려면 true로 변경.
  const ENABLE_REALTIME_DB_SYNC = false;
  useEffect(() => {
    if (!ENABLE_REALTIME_DB_SYNC) return;
    if (isRealtimeMinimized()) return;
    if (useLocalOnly) return;
    if (!isSupabaseConfigured || !supabase) return;
    if (!user?.id) return;
    if (!currentProjectId) return;

    const channelName = `wbs-db-${currentProjectId}`;
    const channel = supabase.channel(channelName);

    const notifyConflictLater = (entity: 'task' | 'project' | 'settings') => {
      if (!hasLocalChangesSinceSyncRef.current) return;
      const now = Date.now();
      if (now - lastConflictRef.current < CONFLICT_DEBOUNCE_MS) return;
      lastConflictRef.current = now;
      if (import.meta.env.DEV) console.warn('[Realtime] concurrent update detected:', entity);
      window.setTimeout(() => {
        try {
          onConcurrentConflictRef.current?.();
        } catch {
          /* ignore */
        }
      }, 0);
    };

    const insertTaskBySortOrder = (list: Task[], incoming: Task, sortOrderRaw: unknown) => {
      const sortOrder = typeof sortOrderRaw === 'number' && Number.isFinite(sortOrderRaw) ? sortOrderRaw : null;
      if (sortOrder == null) return [...list, incoming];
      const sameProject = list.filter((t) => t.projectId === incoming.projectId);
      const others = list.filter((t) => t.projectId !== incoming.projectId);
      const existingIdx = sameProject.findIndex((t) => t.id === incoming.id);
      const base = existingIdx >= 0 ? [...sameProject.slice(0, existingIdx), ...sameProject.slice(existingIdx + 1)] : [...sameProject];
      const insertAt = Math.min(Math.max(0, Math.round(sortOrder)), base.length);
      const nextSame = [...base.slice(0, insertAt), incoming, ...base.slice(insertAt)];
      return [...others, ...nextSame];
    };

    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'tasks',
        ...(currentProjectId !== 'all' ? { filter: `project_id=eq.${currentProjectId}` } : {}),
      },
      (payload: RealtimeChangePayload) => {
        queueMicrotask(() => {
          const ev = String(payload?.eventType ?? payload?.event ?? '').toUpperCase();
          if (ev === 'DELETE') {
            const oldId = String(payload?.old?.id ?? '').trim();
            if (!oldId) return;
            setAllTasks((prev) => prev.filter((t) => t.id !== oldId));
            return;
          }
          const row = payload?.new;
          if (!row || !row.id) return;
          const serverTask = fromTaskRow(row as unknown as TaskRow);
          const before = allTasksRef.current;
          const existingBefore = before.find((t) => t.id === serverTask.id);
          const rowTyped = row as unknown as TaskRow;
          const contentMatches = !!existingBefore && serverTaskRowMatchesLocalTask(existingBefore, rowTyped);

          if (hasLocalChangesSinceSyncRef.current && existingBefore && !contentMatches) {
            return;
          }

          if (
            existingBefore &&
            existingBefore.updatedAt &&
            serverTask.updatedAt &&
            existingBefore.updatedAt !== serverTask.updatedAt &&
            !contentMatches &&
            !hasLocalChangesSinceSyncRef.current
          ) {
            notifyConflictLater('task');
          }
          setAllTasks((prev) => {
            const localMatch = prev.find((t) => t.id === serverTask.id);
            let merged = localMatch ? { ...serverTask, expanded: localMatch.expanded } : serverTask;
            // 계획율 수동값(plannedProgressOverride)은 이 기기의 로컬 입력이 우선이다.
            // 실시간 서버 반영이 override 없는 값으로 덮어써 입력이 사라지지 않도록 로컬 캐시값으로 복원.
            const cachedPlannedOverride = getPlannedOverrideLocal(merged.id);
            if (cachedPlannedOverride !== undefined && cachedPlannedOverride !== merged.plannedProgressOverride) {
              merged = { ...merged, plannedProgressOverride: cachedPlannedOverride };
            }
            const next = prev.map((t) => (t.id === merged.id ? merged : t));
            if (localMatch) return next;
            return insertTaskBySortOrder(next, merged, row.sort_order);
          });
        });
      },
    );

    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, (payload: RealtimeChangePayload) => {
      queueMicrotask(() => {
        const ev = String(payload?.eventType ?? payload?.event ?? '').toUpperCase();
        if (ev === 'DELETE') {
          const oldId = String(payload?.old?.id ?? '').trim();
          if (!oldId) return;
          setProjects((prev) => prev.filter((p) => p.id !== oldId));
          return;
        }
        const row = payload?.new;
        if (!row || !row.id) return;
        const serverProject = fromProjectRow(row as unknown as ProjectRow);
        const before = projectsRef.current;
        const existingBefore = before.find((p) => p.id === serverProject.id);
        if (
          existingBefore &&
          !hasLocalChangesSinceSyncRef.current &&
          projectNeedsDbUpload(existingBefore, new Map([[serverProject.id, serverProject]]))
        ) {
          notifyConflictLater('project');
        }
        setProjects((prev) => {
          if (prev.some((p) => p.id === serverProject.id)) return prev.map((p) => (p.id === serverProject.id ? serverProject : p));
          return [...prev, serverProject];
        });
      });
    });

    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'wbs_settings', filter: 'id=eq.default' },
      (payload: RealtimeChangePayload) => {
        queueMicrotask(() => {
          const row = payload?.new;
          if (!row) return;
          const partial = fromSettingsRow(row as unknown as SettingsRow);
          // 자기 변경 에코일 가능성: 로컬 변경이 있을 때는 충돌 알림 생략
          if (!hasLocalChangesSinceSyncRef.current) {
            setWbsSettings((prev) => parseSettings({ ...prev, ...partial }));
          }
        });
      },
    );

    let cleanedUp = false;

    channel.subscribe((status: string) => {
      if (import.meta.env.DEV) {
        if (import.meta.env.DEV) {
          if (status === 'SUBSCRIBED') {
            console.debug('[Realtime] 구독됨', channelName, 'tasks/projects/wbs_settings 변경 수신');
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('[Realtime] 채널 문제:', status, channelName);
          }
        }
      }
    });

    return () => {
      if (cleanedUp) return;
      cleanedUp = true;
      queueMicrotask(() => {
        try {
          supabase!.removeChannel(channel);
        } catch {
          /* ignore */
        }
      });
    };
  }, [useLocalOnly, user?.id, currentProjectId]);

  // ─── 서버 풀 ──────────────────────────────────────────────────────────────
  // 변경분만 적용(delta): 서버와 동일한 객체는 reference를 그대로 유지하여 큰 리렌더를 방지.
  // 5분 폴링·탭 복귀 풀에서 데이터가 안 바뀌었으면 setProjects/setAllTasks/setWbsSettings 자체를 호출하지 않는다.
  serverPullFromDbRef.current = async () => {
    if (useLocalOnly || !isSupabaseConfigured || !supabase || !user?.id) return;
    if (hasLocalChangesSinceSyncRef.current) return;
    // 사용자가 표/모달에서 셀을 편집 중(입력 포커스)이면 이번 풀의 화면 교체를 건너뛴다.
    // 5분 폴링·탭 복귀 풀이 편집 도중 setAllTasks로 행을 교체하면 입력 포커스가 끊겨 작업이 멈추는 문제 방지(다음 주기 재시도).
    const _activeEl = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    if (
      _activeEl &&
      (_activeEl.tagName === 'INPUT' || _activeEl.tagName === 'TEXTAREA' || _activeEl.tagName === 'SELECT' || _activeEl.isContentEditable)
    ) {
      return;
    }
    try {
      const [dbProjects, dbTaskRows, dbSettings] = await Promise.all([fetchProjects(), fetchTaskRows(), fetchSettings()]);
      if (hasLocalChangesSinceSyncRef.current) return;
      if (!Array.isArray(dbProjects)) return;

      // Projects: 변경분만 교체. 순서/개수/내용 모두 같으면 setProjects 호출하지 않음.
      const prevProjects = projectsRef.current;
      const { merged: mergedProjects, replacedFromServer: pReplaced } = mergeProjectsDelta(prevProjects, dbProjects);
      const projectsOrderChanged =
        prevProjects.length !== mergedProjects.length || prevProjects.some((p, i) => p.id !== mergedProjects[i]?.id);
      if (pReplaced > 0 || projectsOrderChanged) {
        setProjects(mergedProjects);
      }

      // Tasks: 변경분만 교체. 동일하면 setAllTasks 스킵.
      const effectiveSettings = dbSettings ? mergeWbsSettingsWithDbPatch(wbsSettings, dbSettings) : wbsSettings;
      const prevTasks = allTasksRef.current;
      const serverPidSet = new Set((dbProjects ?? []).map((p) => p.id));
      const rows = Array.isArray(dbTaskRows) ? dbTaskRows : [];
      const { merged: mergedTasks, replacedFromServer: tReplaced } = mergeTasksDelta(prevTasks, rows, serverPidSet);
      // 아직 DB에 반영 안 된 삭제 목록을 풀 결과에서도 제외 (미완료 삭제가 풀로 되살아나지 않도록)
      const pendingDelIdSet = new Set(Object.values(deletedTaskIdsByProjectRef.current).flat());
      const finalMergedTasks = pendingDelIdSet.size > 0 ? mergedTasks.filter((t) => !pendingDelIdSet.has(t.id)) : mergedTasks;
      const tasksOrderChanged = prevTasks.length !== finalMergedTasks.length || prevTasks.some((t, i) => t.id !== finalMergedTasks[i]?.id);
      if (tReplaced > 0 || tasksOrderChanged) {
        setAllTasks(preserveLocalExpanded(applyRollupsToTasks(finalMergedTasks, effectiveSettings.statusConfigs)));
      }

      // Settings: 들어온 부분 키만 비교. 값이 다 같으면 setWbsSettings 스킵.
      if (dbSettings) {
        const partial = dbSettings as Partial<WBSSettings>;
        let settingsChanged = false;
        for (const k of Object.keys(partial) as Array<keyof WBSSettings>) {
          const a = (wbsSettings as Record<string, unknown>)[k as string];
          const b = (partial as Record<string, unknown>)[k as string];
          if (a === b) continue;
          if (JSON.stringify(a) !== JSON.stringify(b)) {
            settingsChanged = true;
            break;
          }
        }
        if (settingsChanged) {
          setWbsSettings((prev) => parseSettings({ ...prev, ...partial }));
        }
      }

      if (dbProjects.length > 0) {
        const saved = localStorage.getItem('wbs-current-project') ?? sessionStorage.getItem('wbs-current-project');
        const valid = dbProjects.find((p) => p.id === saved)?.id ?? dbProjects[0]!.id ?? '';
        if (valid) setCurrentProjectId(valid);
      }
    } catch {
      /* 다음 주기 재시도 */
    }
  };

  const lastServerPullAtRef = useRef(0);
  const appReadyAtRef = useRef(0);
  useEffect(() => {
    if (!isLoading) appReadyAtRef.current = Date.now();
  }, [isLoading]);

  // 주기적 서버 풀: Realtime이 변경사항을 실시간 전파하므로 폴링은 백업용으로만 사용
  // egress 절약: 25초 → 5분, 탭 복귀 시에만 추가 풀
  useEffect(() => {
    if (isLoading || useLocalOnly || !isSupabaseConfigured || !user?.id) return;
    const MIN_GAP_MS = 60000; // 최소 풀 간격 60초 (기존 12초)
    const INTERVAL_MS = 300000; // 주기적 풀 5분 (기존 25초)
    const run = () => {
      if (hasLocalChangesSinceSyncRef.current) return;
      const now = Date.now();
      if (now - lastServerPullAtRef.current < MIN_GAP_MS) return;
      lastServerPullAtRef.current = now;
      void serverPullFromDbRef.current();
    };
    const iv = window.setInterval(run, INTERVAL_MS);
    let visTimer: number | undefined;
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - appReadyAtRef.current < 5000) return;
      clearTimeout(visTimer);
      visTimer = window.setTimeout(() => {
        if (hasLocalChangesSinceSyncRef.current) return;
        const now = Date.now();
        if (now - lastServerPullAtRef.current < MIN_GAP_MS) return;
        lastServerPullAtRef.current = now;
        void serverPullFromDbRef.current();
      }, 2000);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(iv);
      clearTimeout(visTimer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [isLoading, useLocalOnly, user?.id]);

  // 프로젝트 전환 시 풀 제거 — Realtime이 이미 처리하므로 불필요한 egress 방지

  // ─── DB 동기화 ─────────────────────────────────────────────────────────────
  const syncWithDb = async (
    scope: 'current' | 'all',
    onProgress?: (percent: number, message: string) => void,
    opts?: { pullAfter?: boolean; skipAutoPrune?: boolean },
  ): Promise<{ projects: Project[]; allTasks: Task[]; summary: DbSyncSummary }> => {
    const pullAfter = opts?.pullAfter !== false;
    const skipAutoPrune = opts?.skipAutoPrune === true;
    const syncEpochStart = dirtyEpochRef.current;
    const report = (pct: number, message: string) => {
      try {
        onProgress?.(Math.min(99, Math.max(0, Math.round(pct))), message);
      } catch {
        /* ignore */
      }
    };
    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Supabase 설정이 필요합니다. (DB 동기화 불가)');
    }
    const toUserFacingDbError = (e: unknown): Error => {
      if (e && typeof e === 'object') {
        const anyE = e as { code?: string; message?: string };
        const code = String(anyE.code ?? '').trim();
        const msg = String(anyE.message ?? '').trim();
        if (code === '42501' || /row-level security|row level security/i.test(msg)) {
          return new Error(
            '이 프로젝트에 대한 편집 권한이 없습니다. 보기 권한만 있거나 멤버가 아닌 프로젝트에는 작업을 추가·수정할 수 없습니다.',
          );
        }
      }
      if (e instanceof Error) return e;
      if (e && typeof e === 'object') {
        const anyE = e as Record<string, unknown>;
        const msg = String(anyE.message ?? anyE.error_description ?? anyE.details ?? anyE.hint ?? '').trim();
        const code = String(anyE.code ?? anyE.status ?? '').trim();
        const composed = [code ? `[${code}]` : '', msg].filter(Boolean).join(' ');
        if (composed) return new Error(composed);
      }
      return new Error('DB 동기화에 실패했습니다.');
    };
    const effectiveScope = scope === 'all' ? 'all' : 'current';
    const projectIds =
      effectiveScope === 'all'
        ? projects.map((p) => p.id).filter(Boolean)
        : currentProjectId && currentProjectId !== 'all'
          ? [currentProjectId]
          : [];

    const projectIdSet = new Set(projectIds);
    const targetProjects = projects.filter((p) => projectIdSet.has(p.id));
    const targetTasks = allTasks.filter((t) => t.projectId && projectIdSet.has(t.projectId));
    const targetDeletedProjectIdsFromState = effectiveScope === 'all' ? Array.from(new Set(deletedProjectIds.filter(Boolean))) : [];

    const taskCountByProject = (() => {
      const m = new Map<string, number>();
      for (const p of projects) m.set(p.id, 0);
      for (const t of allTasks) {
        if (!t?.projectId) continue;
        if (!m.has(t.projectId)) continue;
        m.set(t.projectId, (m.get(t.projectId) ?? 0) + 1);
      }
      return m;
    })();
    const ownedProjectsInScope = targetProjects.filter((p) => (p.ownerId ?? undefined) === ownerId);
    const autoDeletedProjectIds = ownedProjectsInScope
      .filter((p) => p._autoGenerated && (taskCountByProject.get(p.id) ?? 0) === 0)
      .map((p) => p.id);

    const targetDeletedProjectIds =
      effectiveScope === 'all' ? Array.from(new Set([...targetDeletedProjectIdsFromState, ...autoDeletedProjectIds].filter(Boolean))) : [];
    const deletionProjectIdSet = new Set(targetDeletedProjectIds);
    const targetProjectIdSetAfterAutoDelete = new Set(projectIds.filter((id) => !deletionProjectIdSet.has(id)));
    const targetProjectsAfterAutoDelete = targetProjects.filter((p) => targetProjectIdSetAfterAutoDelete.has(p.id));
    const targetTasksAfterAutoDelete = targetTasks.filter((t) => t.projectId && targetProjectIdSetAfterAutoDelete.has(t.projectId));

    let workingProjects = projects;
    let workingTasks = allTasks;
    try {
      report(1, '동기화 준비 중…');
      if (effectiveScope === 'all' && !skipAutoPrune && autoDeletedProjectIds.length > 0) {
        setDeletedProjectIds((prev) => Array.from(new Set([...prev, ...autoDeletedProjectIds])));
        workingProjects = projects.filter((p) => !autoDeletedProjectIds.includes(p.id));
        workingTasks = allTasks.filter((t) => !t.projectId || !autoDeletedProjectIds.includes(t.projectId));
        setProjects(workingProjects);
        setAllTasks(workingTasks);
        if (autoDeletedProjectIds.includes(currentProjectId)) {
          const nextId = projects.find((p) => !autoDeletedProjectIds.includes(p.id))?.id ?? '';
          setCurrentProjectId(nextId);
        }
      }

      report(3, '서버와 비교하는 중…');
      const [preProjects, preTaskRows, preSettingsRow] = await Promise.all([fetchProjects(), fetchTaskRows(), fetchSettingsRow()]);
      const serverProjectById = new Map(preProjects.map((p) => [p.id, p]));

      let uploadError: unknown = null;
      const taskProjectIdSet = new Set<string>(targetProjectsAfterAutoDelete.map((p) => p.id));
      const deletionPids = Array.from(new Set([...projectIds, ...targetDeletedProjectIds].filter(Boolean)));
      let nProj = targetProjectsAfterAutoDelete.length;
      let nProjUp = 0;
      let needSettingsUpload = false;
      let nTaskUp = 0;
      let taskRows = targetTasksAfterAutoDelete.length;
      let uniqueDeletionIds: string[] = [];
      let nDelProj = targetDeletedProjectIds.length;
      const uploadedTasksByProject: Record<string, number> = {};
      let uploadedProjectIds: string[] = [];
      let replacedProjectIds: string[] = [];
      let replacedByProject: Record<string, number> = {};

      try {
        const projectsToUpload = targetProjectsAfterAutoDelete.filter((p) => projectNeedsDbUpload(p, serverProjectById));
        nProj = targetProjectsAfterAutoDelete.length;
        nProjUp = projectsToUpload.length;
        uploadedProjectIds = projectsToUpload.map((p) => p.id);
        if (nProj === 0) {
          report(18, '업로드할 프로젝트 없음');
        } else if (nProjUp === 0) {
          report(18, `프로젝트 ${nProj}개 서버와 동일 — 업로드 생략`);
        } else {
          for (let i = 0; i < nProjUp; i++) {
            await upsertProject(projectsToUpload[i]!);
            report(5 + ((i + 1) / Math.max(nProjUp, 1)) * 14, `프로젝트 업로드 ${i + 1}/${nProjUp} (변경분)`);
          }
        }

        needSettingsUpload = settingsNeedDbUpload(wbsSettings, preSettingsRow);
        if (needSettingsUpload) {
          report(20, '표·상태 설정 업로드 중…');
          await upsertSettings(wbsSettings);
        } else {
          report(20, '표·상태 설정 서버와 동일 — 업로드 생략');
        }

        const serverTaskById = new Map(preTaskRows.map((r) => [r.id, r]));
        const taskSortOrders = new Map<string, number>();
        targetTasksAfterAutoDelete.forEach((t, idx) => {
          if (t.id) taskSortOrders.set(t.id, idx);
        });
        const tasksToUpload = collectTasksNeedingUpload(targetTasksAfterAutoDelete, serverTaskById, taskProjectIdSet, taskSortOrders);
        taskRows = targetTasksAfterAutoDelete.length;
        nTaskUp = tasksToUpload.length;
        for (const t of tasksToUpload) {
          const pid = t.projectId ?? '';
          uploadedTasksByProject[pid] = (uploadedTasksByProject[pid] ?? 0) + 1;
        }
        if (taskRows === 0) {
          report(62, '업로드할 작업 없음');
        } else if (nTaskUp === 0) {
          report(62, `작업 ${taskRows}건 서버와 동일 — 업로드 생략`);
        } else {
          report(22, `작업 변경분 업로드… (${nTaskUp}/${taskRows}건)`);
          await upsertTasks(
            tasksToUpload,
            (done, total) => {
              report(22 + (done / Math.max(total, 1)) * 42, `작업 업로드 ${done}/${total}건`);
            },
            taskSortOrders,
          );
        }

        const deletions: string[] = [];
        for (const pid of deletionPids) {
          const ids = deletedTaskIdsByProject[pid] ?? [];
          deletions.push(...ids);
        }
        uniqueDeletionIds = Array.from(new Set(deletions.filter(Boolean)));
        if (uniqueDeletionIds.length > 0) {
          const BATCH = 200;
          const nDel = uniqueDeletionIds.length;
          for (let i = 0; i < uniqueDeletionIds.length; i += BATCH) {
            await deleteTasksFromDB(uniqueDeletionIds.slice(i, i + BATCH));
            const done = Math.min(i + BATCH, nDel);
            report(64 + (done / nDel) * 8, `DB에서 삭제된 작업 반영 ${done}/${nDel}건`);
          }
        } else {
          report(72, '삭제할 작업 없음');
        }

        nDelProj = targetDeletedProjectIds.length;
        if (nDelProj === 0) {
          report(80, '삭제할 프로젝트 없음');
        } else {
          let j = 0;
          for (const pid of targetDeletedProjectIds) {
            await deleteProjectFromDB(pid);
            j += 1;
            report(72 + (j / nDelProj) * 10, `프로젝트 삭제 반영 ${j}/${nDelProj}`);
          }
        }

        setDeletedTaskIdsByProject((prev) => {
          const next = { ...prev };
          for (const pid of deletionPids) delete next[pid];
          return next;
        });
        if (targetDeletedProjectIds.length > 0) {
          setDeletedProjectIds((prev) => prev.filter((id) => !deletionProjectIdSet.has(id)));
        }
      } catch (e) {
        uploadError = e;
        report(72, '업로드 중 권한 또는 오류 — 서버 데이터만 로컬에 반영합니다.');
      }

      if (uploadError && !pullAfter) {
        throw toUserFacingDbError(uploadError);
      }

      if (!pullAfter) {
        report(96, '서버에 반영됨');
        clearInitBlankSessionFlag();
        if (dirtyEpochRef.current === syncEpochStart) setHasLocalChangesSinceSync(false);
        const persistDeletedTasks: Record<string, string[]> = { ...deletedTaskIdsByProject };
        for (const pid of deletionPids) delete persistDeletedTasks[pid];
        const persistDeletedProjects = deletedProjectIds.filter((id) => !deletionProjectIdSet.has(id));
        await Promise.allSettled([
          saveJsonWithIdbFallback('wbs-projects', workingProjects),
          saveJsonWithIdbFallback('wbs-tasks', workingTasks),
          saveJsonWithIdbFallback('wbs-settings', wbsSettings),
          saveJsonWithIdbFallback('wbs-deleted-task-ids', persistDeletedTasks),
          saveJsonWithIdbFallback('wbs-deleted-project-ids', persistDeletedProjects),
        ]);
        const byProject: Record<string, DbSyncSummaryByProject> = {};
        for (const pid of taskProjectIdSet) {
          const proj = workingProjects.find((p) => p.id === pid);
          const projectName = proj ? formatProjectDisplayName(proj.name, proj.projectKind) : pid;
          byProject[pid] = {
            projectName,
            uploadedTasks: uploadedTasksByProject[pid] ?? 0,
            uploadedProjects: uploadedProjectIds.includes(pid) ? 1 : 0,
            appliedTasks: 0,
            appliedProjects: 0,
          };
        }
        const summary: DbSyncSummary = {
          uploadedProjects: nProjUp,
          skippedUploadProjects: Math.max(0, nProj - nProjUp),
          uploadedTasks: nTaskUp,
          skippedUploadTasks: Math.max(0, taskRows - nTaskUp),
          uploadedSettings: needSettingsUpload,
          skippedUploadSettings: !needSettingsUpload,
          uploadedTaskDeletions: uniqueDeletionIds.length,
          uploadedProjectDeletions: nDelProj,
          downloadedProjects: 0,
          downloadedTasks: 0,
          downloadedSettings: false,
          appliedProjectsFromServer: 0,
          appliedTasksFromServer: 0,
          byProject,
        };
        window.setTimeout(() => {
          if (hasLocalChangesSinceSyncRef.current) return;
          lastServerPullAtRef.current = Date.now();
          void serverPullFromDbRef.current();
        }, 500);
        return { projects: workingProjects, allTasks: workingTasks, summary };
      }

      if (uploadError) {
        report(72, '업로드 중 권한 또는 오류 — 서버 데이터만 로컬에 반영합니다.');
      }

      report(84, '서버에서 최신 데이터 받는 중…');
      const [dbProjects, dbTaskRows, dbSettings] = await Promise.all([fetchProjects(), fetchTaskRows(), fetchSettings()]);
      let appliedP = 0;
      let appliedT = 0;
      report(93, 'DB 데이터 로컬에 반영 중…');
      let snapshotProjects: Project[];
      let snapshotTasks: Task[];
      const finalDeletedTasks: Record<string, string[]> =
        effectiveScope === 'all'
          ? {}
          : (() => {
              const serverPidSet = new Set((dbProjects ?? []).map((p) => p.id));
              const n = { ...deletedTaskIdsByProject };
              for (const pid of serverPidSet) delete n[String(pid)];
              return n;
            })();
      const finalDeletedProjects: string[] = effectiveScope === 'all' ? [] : deletedProjectIds;

      if (Array.isArray(dbProjects) && dbProjects.length > 0) {
        snapshotProjects = dbProjects;
        const effectiveSettings = dbSettings ? mergeWbsSettingsWithDbPatch(wbsSettings, dbSettings) : wbsSettings;
        snapshotTasks = applyRollupsToTasks((dbTaskRows ?? []).map(fromTaskRow), effectiveSettings.statusConfigs);
        appliedP = snapshotProjects.length;
        appliedT = snapshotTasks.length;
        replacedProjectIds = snapshotProjects.map((p) => p.id);
        replacedByProject = snapshotTasks.reduce<Record<string, number>>((acc, t) => {
          const pid = t.projectId ?? '';
          acc[pid] = (acc[pid] ?? 0) + 1;
          return acc;
        }, {});

        setProjects(snapshotProjects);
        setAllTasks(preserveLocalExpanded(snapshotTasks));
        if (dbSettings) setWbsSettings((prev) => parseSettings({ ...prev, ...dbSettings }));
        setDeletedTaskIdsByProject(finalDeletedTasks);
        setDeletedProjectIds(finalDeletedProjects);

        const savedCurrent = localStorage.getItem('wbs-current-project') ?? sessionStorage.getItem('wbs-current-project');
        const validId = snapshotProjects.find((p) => p.id === savedCurrent)?.id ?? snapshotProjects[0]?.id ?? '';
        if (validId) setCurrentProjectId(validId);
      } else {
        snapshotProjects = workingProjects;
        snapshotTasks = workingTasks;
      }

      const finalSettings =
        Array.isArray(dbProjects) && dbProjects.length > 0 && dbSettings
          ? mergeWbsSettingsWithDbPatch(wbsSettings, dbSettings)
          : wbsSettings;
      const finalDeletedTasksForPersist = Array.isArray(dbProjects) && dbProjects.length > 0 ? finalDeletedTasks : deletedTaskIdsByProject;
      const finalDeletedProjectsForPersist = Array.isArray(dbProjects) && dbProjects.length > 0 ? finalDeletedProjects : deletedProjectIds;
      await Promise.allSettled([
        saveJsonWithIdbFallback('wbs-projects', snapshotProjects),
        saveJsonWithIdbFallback('wbs-tasks', snapshotTasks),
        saveJsonWithIdbFallback('wbs-settings', finalSettings),
        saveJsonWithIdbFallback('wbs-deleted-task-ids', finalDeletedTasksForPersist),
        saveJsonWithIdbFallback('wbs-deleted-project-ids', finalDeletedProjectsForPersist),
      ]);

      const projectIdsForSummary = new Set<string>([...taskProjectIdSet, ...replacedProjectIds, ...Object.keys(replacedByProject)]);
      const byProject: Record<string, DbSyncSummaryByProject> = {};
      for (const pid of projectIdsForSummary) {
        const proj = snapshotProjects?.find((p) => p.id === pid);
        const projectName = proj ? formatProjectDisplayName(proj.name, proj.projectKind) : pid;
        const uploadedTasks = uploadedTasksByProject[pid] ?? 0;
        const uploadedProjects = uploadedProjectIds.includes(pid) ? 1 : 0;
        const appliedTasks = replacedByProject[pid] ?? 0;
        const appliedProjects = replacedProjectIds.includes(pid) ? 1 : 0;
        byProject[pid] = { projectName, uploadedTasks, uploadedProjects, appliedTasks, appliedProjects };
      }
      const summary: DbSyncSummary = {
        uploadedProjects: nProjUp,
        skippedUploadProjects: Math.max(0, nProj - nProjUp),
        uploadedTasks: nTaskUp,
        skippedUploadTasks: Math.max(0, taskRows - nTaskUp),
        uploadedSettings: needSettingsUpload,
        skippedUploadSettings: !needSettingsUpload,
        uploadedTaskDeletions: uniqueDeletionIds.length,
        uploadedProjectDeletions: nDelProj,
        downloadedProjects: dbProjects?.length ?? 0,
        downloadedTasks: dbTaskRows.length,
        downloadedSettings: dbSettings != null,
        appliedProjectsFromServer: appliedP,
        appliedTasksFromServer: appliedT,
        byProject,
      };
      report(
        99,
        `완료 ↑올림 프로젝트 ${summary.uploadedProjects}(생략 ${summary.skippedUploadProjects})·작업 ${summary.uploadedTasks}(생략 ${summary.skippedUploadTasks})·설정${summary.uploadedSettings ? ' 반영' : ' 생략'} · ↓내려받아 반영 프로젝트 ${summary.appliedProjectsFromServer}·작업 ${summary.appliedTasksFromServer}건`,
      );
      if (uploadError) {
        handleDbError(uploadError, '동기화 중 오류가 났습니다. 서버 데이터는 로컬에 반영했습니다.');
      }
      clearInitBlankSessionFlag();
      if (dirtyEpochRef.current === syncEpochStart) setHasLocalChangesSinceSync(false);
      return { projects: snapshotProjects!, allTasks: snapshotTasks!, summary };
    } catch (e) {
      throw toUserFacingDbError(e);
    }
  };

  const syncWithDbRef = useRef(syncWithDb);
  syncWithDbRef.current = syncWithDb;

  const stableSyncWithDb = useCallback((...args: Parameters<typeof syncWithDb>) => syncWithDbRef.current(...args), []);

  const pushChangesToDb = useCallback(
    (scope: 'current' | 'all') => syncWithDbRef.current(scope, undefined, { pullAfter: false, skipAutoPrune: true }),
    [],
  );

  useEffect(() => {
    if (currentProjectId) {
      try {
        localStorage.setItem('wbs-current-project', currentProjectId);
      } catch {
        /* ignore quota errors */
      }
    }
  }, [currentProjectId]);

  // 가중치 진척 롤업 옵션이 바뀌면 모든 부모 작업의 progress·계획율을 즉시 재계산.
  // - 자식이 있는 부모(요약 행)의 progress를 NaN으로 일시 마킹 → syncParentRollups의 동일성 비교를
  //   확실히 통과시켜 가중평균 ↔ 단순평균 결과가 같을 때도 새 배열·새 객체로 갱신되도록 강제.
  // - 동시에 모든 task를 새 객체로 복사해 React.memo된 행이 확실히 리렌더되게 한다.
  useEffect(() => {
    const off = onProgressRollupOptionChange(() => {
      setAllTasks((prev) => {
        const parentIds = new Set<string>();
        for (const t of prev) {
          if (t.parentId) parentIds.add(t.parentId);
        }
        const stamped = prev.map((t) => (parentIds.has(t.id) ? { ...t, progress: Number.NaN as unknown as number } : { ...t }));
        return applyRollupsToTasks(stamped, wbsSettingsRef.current.statusConfigs);
      });
    });
    return off;
  }, []);

  // ─── Undo ref ──────────────────────────────────────────────────────────────
  allTasksRef.current = allTasks;

  // ─── Derived 상태 ──────────────────────────────────────────────────────────
  // 분기된 자식 프로젝트의 전체 진척률·일정·공수를 부모 task에 mirror한 view 전용 사본.
  // raw `allTasks` state는 그대로 두고(편집·DB 저장 로직 영향 없음), 표시·집계 경로에만 mirror 적용.
  const mirroredAllTasks = React.useMemo(() => {
    if (!projects.some((p) => p.sourceTaskId)) return allTasks;
    const doneStatusIds = new Set((wbsSettings.statusConfigs ?? []).filter((c) => c.progress === 100).map((c) => c.id));
    return mirrorForkedProjectsAndRollUp(allTasks, projects, doneStatusIds);
  }, [allTasks, projects, wbsSettings.statusConfigs]);

  const tasks = React.useMemo(
    () => (currentProjectId === 'all' ? mirroredAllTasks : mirroredAllTasks.filter((t) => t.projectId === currentProjectId)),
    [mirroredAllTasks, currentProjectId],
  );

  const { wbsMap, displayWbsMap } = React.useMemo(() => {
    const map = new Map<string, string>();
    const displayMap = new Map<string, string>();
    const { level1Prefix, level2Prefix, level3Prefix, maxLevel } = wbsSettings;
    const childrenByParent = buildChildrenByParent(tasks);

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
        else if (depth === 3) {
          const n = parentPrefixStr.replace(level2Prefix, '').replace(level1Prefix, '');
          wbsId = `${level3Prefix}${n}.${index + 1}`;
        } else if (depth > 3) wbsId = `${parentPrefixStr}.${index + 1}`;
        map.set(child.id, wbsId);
        displayMap.set(child.id, depth <= maxLevel ? wbsId : '');
        buildWbs(child.id, wbsId, depth + 1);
      });
    };
    buildWbs(null, '', 1);
    return { wbsMap: map, displayWbsMap: displayMap };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, wbsSettings.level1Prefix, wbsSettings.level2Prefix, wbsSettings.level3Prefix, wbsSettings.maxLevel]);

  // ─── 환경설정 (WBSSettings) ──────────────────────────────────────────────
  const updateWbsSettings = useCallback(
    (updates: Partial<WBSSettings>) => {
      const newSettings = { ...wbsSettingsRef.current, ...updates };
      // 다음 렌더 전에도 ref가 최신이어야 하는 동기 로직을 위해 ref를 즉시 갱신.
      wbsSettingsRef.current = newSettings;
      setWbsSettings(newSettings);
      // 로컬에 즉시 저장 (디바운스 전 새로고침 시에도 유지)
      saveJsonWithIdbFallback('wbs-settings', newSettings).catch(() => {});
      if (!useLocalOnlyRef.current) upsertSettings(newSettings).catch((err) => handleDbError(err, '설정 저장에 실패했습니다.'));
    },
    [handleDbError],
  );

  // ─── canEdit ───────────────────────────────────────────────────────────────
  // 권한 모델: 다음 중 하나면 편집 가능 — (1) 시스템 관리자, (2) 프로젝트 소유자,
  // (3) RPC `get_user_editable_project_ids()`에 포함된 프로젝트(멤버 viewer 포함·사내 승인 시 전사).
  // DB RLS는 `get_user_editable_project_ids`와 `can_browse_all_company_projects()` 등으로 동일하게 시행됨.
  const currentProjectObj = projects.find((p) => p.id === currentProjectId);
  const canEditCurrentProject = (() => {
    if (!currentProjectId) return false;
    // 전체 프로젝트 보기: 단일 프로젝트가 아니어도, 편집 가능한 프로젝트가 하나라도 있으면
    // 신규 작업·칸반 카드 추가 등 편집 UI를 켠다(addTask는 이 경우 첫 프로젝트 등으로 배정).
    if (currentProjectId === 'all') {
      if (isAdmin) return true;
      if ((editableProjectIds?.length ?? 0) > 0) return true;
      if (ownerId && projects.some((p) => p.ownerId === ownerId)) return true;
      return false;
    }
    if (isAdmin) return true;
    if (currentProjectObj?.ownerId === ownerId) return true;
    // editor 권한으로 공유받은 프로젝트
    if (editableProjectIds?.includes(currentProjectId)) return true;
    return false;
  })();

  // ─── Context Value ─────────────────────────────────────────────────────────
  const contextValue = React.useMemo(
    () => ({
      allTasks: mirroredAllTasks,
      tasks,
      projects,
      editableProjectIds,
      isAdmin,
      canEditCurrentProject,
      currentProjectId,
      setCurrentProjectId,
      selectedTaskIds,
      setSelectedTaskIds,
      activeTaskId,
      setActiveTaskId,
      wbsSettings,
      updateWbsSettings,
      treeExpandLevel,
      setTreeExpandLevel,
      // Project ops
      addProject: projectOps.addProject,
      updateProject: projectOps.updateProject,
      deleteProject: projectOps.deleteProject,
      copyProject: projectOps.copyProject,
      forkTaskToProject: projectOps.forkTaskToProject,
      // Task ops
      addTask: taskOps.addTask,
      addTasks: taskOps.addTasks,
      updateTask: taskOps.updateTask,
      updateTasksBulk: taskOps.updateTasksBulk,
      linkSequentialPredecessors: taskOps.linkSequentialPredecessors,
      deleteTask: taskOps.deleteTask,
      flushProjectTaskRollups: taskOps.flushProjectTaskRollups,
      setBaselineForTasks: taskOps.setBaselineForTasks,
      setBaselineForAllTasks: taskOps.setBaselineForAllTasks,
      renameAssignee: taskOps.renameAssignee,
      refreshProjectSchedule: taskOps.refreshProjectSchedule,
      distributeChildrenSchedule: taskOps.distributeChildrenSchedule,
      rollupTaskSchedule: taskOps.rollupTaskSchedule,
      // Task movement
      moveTask: taskMovement.moveTask,
      reorderTask: taskMovement.reorderTask,
      reparentTaskRootsUnder: taskMovement.reparentTaskRootsUnder,
      moveTaskRootsSibling: taskMovement.moveTaskRootsSibling,
      indentTask: taskMovement.indentTask,
      outdentTask: taskMovement.outdentTask,
      indentTasks: taskMovement.indentTasks,
      outdentTasks: taskMovement.outdentTasks,
      toggleExpand: taskMovement.toggleExpand,
      expandToLevel: taskMovement.expandToLevel,
      // Backup ops
      importTasks: backupOps.importTasks,
      deleteAllTasks: backupOps.deleteAllTasks,
      deleteAllTasksInAllProjects: backupOps.deleteAllTasksInAllProjects,
      resetAllProjectsToNew: backupOps.resetAllProjectsToNew,
      restoreBackup: backupOps.restoreBackup,
      exportFullBackup: backupOps.exportFullBackup,
      mergeBackups: backupOps.mergeBackups,
      // Sync
      deletedTaskIdsByProject,
      hasLocalChangesSinceSync,
      syncWithDb: stableSyncWithDb,
      pushChangesToDb,
      collabPushNonce,
      wbsMap,
      displayWbsMap,
      undo,
      canUndo,
      redo,
      canRedo,
      isLoading,
    }),
    [
      mirroredAllTasks,
      tasks,
      projects,
      editableProjectIds,
      isAdmin,
      canEditCurrentProject,
      currentProjectId,
      setCurrentProjectId,
      selectedTaskIds,
      setSelectedTaskIds,
      activeTaskId,
      setActiveTaskId,
      wbsSettings,
      updateWbsSettings,
      treeExpandLevel,
      setTreeExpandLevel,
      projectOps,
      taskOps,
      taskMovement,
      backupOps,
      deletedTaskIdsByProject,
      hasLocalChangesSinceSync,
      stableSyncWithDb,
      pushChangesToDb,
      collabPushNonce,
      wbsMap,
      displayWbsMap,
      undo,
      canUndo,
      redo,
      canRedo,
      isLoading,
    ],
  );

  return <WBSContext.Provider value={contextValue}>{children}</WBSContext.Provider>;
}

export function useWBS() {
  const context = useContext(WBSContext);
  if (!context) {
    throw new Error(
      'useWBS must be used within a WBSProvider. Ensure main.tsx wraps the app with <WBSProvider> and that WBSContext is not imported from two different paths (e.g. src/ vs src\\)',
    );
  }
  return context;
}
