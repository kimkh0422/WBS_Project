import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { Task, Project, ProjectAssignment } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { BackupData } from '../lib/export';
import { addDays, differenceInDays, format, isValid, parseISO } from 'date-fns';
import { buildChildrenByParent } from '../lib/taskView';
import { round2 } from '../lib/utils';
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
  fetchSettingsRow,
  fetchTaskRows,
  fromTaskRow,
  fromProjectRow,
  fromSettingsRow,
  projectNeedsDbUpload,
  collectTasksNeedingUpload,
  settingsNeedDbUpload,
  mergeProjectsDelta,
  mergeTasksDelta,
  serverTaskRowMatchesLocalTask,
  deleteProjectFromDB,
  deleteTasksFromDB,
  deleteAllTasksFromDB,
  deleteAllProjectsFromDB,
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
import { useAuth } from './AuthContext';
import { useWbsHistory } from '../hooks/useWbsHistory';

/** Supabase Realtime postgres_changes 콜백 페이로드 */
interface RealtimeChangePayload {
  eventType?: string;
  event?: string;
  new?: Record<string, unknown>;
  old?: Record<string, unknown>;
}

/** 프로젝트별 동기화 건수 (토스트·상세 표시용) */
export type DbSyncSummaryByProject = {
  projectName: string;
  /** 올린 작업 수 */
  uploadedTasks: number;
  /** 올린 프로젝트 메타 (1: 반영, 0: 생략) */
  uploadedProjects: number;
  /** 서버에서 내려받아 반영한 작업 수 */
  appliedTasks: number;
  /** 서버에서 내려받아 반영한 프로젝트 메타 (1: 반영, 0: 생략) */
  appliedProjects: number;
};

/** DB 동기화 1회 요약 (토스트·로그용) */
export type DbSyncSummary = {
  /** 업로드(upsert)한 프로젝트 수 */
  uploadedProjects: number;
  /** 서버와 같아 업로드 생략한 프로젝트 수 */
  skippedUploadProjects: number;
  /** 업로드한 작업 수 */
  uploadedTasks: number;
  /** 서버와 같아 업로드 생략한 작업 수 */
  skippedUploadTasks: number;
  /** 표·상태 설정 upsert 여부 */
  uploadedSettings: boolean;
  skippedUploadSettings: boolean;
  /** DB에서 삭제 반영한 작업 id 수 */
  uploadedTaskDeletions: number;
  /** DB에서 삭제한 프로젝트 수 */
  uploadedProjectDeletions: number;
  /** fetch로 받은 프로젝트 수 */
  downloadedProjects: number;
  /** fetch로 받은 작업 수 */
  downloadedTasks: number;
  /** 서버에 설정 행 존재 여부 */
  downloadedSettings: boolean;
  /** 서버와 달라 로컬에 반영한 프로젝트 수 */
  appliedProjectsFromServer: number;
  /** 서버와 달라 로컬에 반영한 작업 수 */
  appliedTasksFromServer: number;
  /** 프로젝트별 올림/내려받기 건수 (동기화 범위에 해당하는 프로젝트만) */
  byProject: Record<string, DbSyncSummaryByProject>;
};

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
  /** true: 상태별 진척도를 사용해 상태 ↔ 진척률을 연동. false: 상태는 표시만, 진척률은 수동 입력 기준 */
  linkStatusAndProgress?: boolean;
  tableColumns?: { id: string; visible: boolean }[];
  /** 크리티컬 패스 표시 여부 (간트·표에서 강조) */
  showCriticalPath?: boolean;
  /** 셀 텍스트 줄바꿈 여부. true면 줄바꿈 허용·행 높이 자동 확장 */
  wrapTextInCells?: boolean;
  /** 표 컬럼 너비(px). 사용자가 조절한 값 저장 */
  columnWidths?: Record<string, number>;
  /** 투입율 컬럼 기본 숨김 마이그레이션 완료 여부 */
  allocationHiddenMigrated?: boolean;
}

interface WBSContextType {
  allTasks: Task[];
  tasks: Task[];
  projects: Project[];
  /** 편집 가능한 프로젝트 ID 목록. 없으면 모두 편집 가능(기존 동작). 보기 전용일 때 이 목록에 없음 */
  editableProjectIds?: string[];
  /** 현재 선택된 프로젝트에 편집 권한이 있는지. 보기 전용 프로젝트면 false */
  canEditCurrentProject: boolean;
  currentProjectId: string;
  setCurrentProjectId: (id: string) => void;
  selectedTaskIds: string[];
  setSelectedTaskIds: (ids: string[]) => void;
  wbsSettings: WBSSettings;
  updateWbsSettings: (settings: Partial<WBSSettings>) => void;
  /** 상태 명칭·진척도 설정을 기준으로 작업 진척도를 일괄 동기화 */
  syncProgressFromStatusConfigs: (scope: 'current' | 'all') => void;
  treeExpandLevel: number;
  setTreeExpandLevel: (level: number) => void;
  addProject: (name: string, description?: string, startDate?: string, endDate?: string, assignments?: Project['assignments'], minWorkEffortDays?: number, reportExtras?: Partial<Pick<Project, 'reportCategory' | 'reportAgency' | 'reportBudgetThisYear' | 'reportTotalPeriod' | 'reportNameShort' | 'reportNameFull'>>) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  /** 프로젝트와 소속 작업을 복사해 새 프로젝트로 만들고 현재 사용자 소유로 설정 */
  copyProject: (sourceProjectId: string) => void;
  addTask: (task: Omit<Task, 'id' | 'projectId'>, insertAfterId?: string, projectIdOverride?: string) => string;
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
  /** 사용자가 WBS(프로젝트/작업)를 수정한 뒤 아직 동기화하지 않은 상태. 동기화 성공 시 false로 초기화. */
  hasLocalChangesSinceSync: boolean;
  /** 로컬 ↔ DB(Supabase) 동기화: 업로드 후 서버 최신을 다시 불러와 로컬과 맞춤. onProgress로 0–99% 진행 알림. */
  syncWithDb: (
    scope: 'current' | 'all',
    onProgress?: (percent: number, message: string) => void,
    opts?: { pullAfter?: boolean }
  ) => Promise<{ projects: Project[]; allTasks: Task[]; summary: DbSyncSummary }>;
  /** 업로드만 수행(전체 재조회 없음). 실시간 협업·백그라운드 저장용. */
  pushChangesToDb: (scope: 'current' | 'all') => Promise<{ projects: Project[]; allTasks: Task[]; summary: DbSyncSummary }>;
  /** 편집 시마다 증가 — 자동 저장 디바운스 리셋용 */
  collabPushNonce: number;
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
  linkStatusAndProgress: true,
  tableColumns: [
    { id: 'wbsId', visible: true },
    { id: 'name', visible: true },
    { id: 'startDate', visible: true },
    { id: 'endDate', visible: true },
    { id: 'workEffort', visible: true },
    // 가중치는 기본적으로도 표시
    { id: 'weight', visible: true },
    { id: 'assignee', visible: true },
    { id: 'allocation', visible: false },
    { id: 'status', visible: true },
    { id: 'progress', visible: true },
    { id: 'deliverables', visible: true },
    { id: 'dependencies', visible: true },
  ],
  showCriticalPath: false,
  wrapTextInCells: false,
};

// ─── 롤업 헬퍼 ────────────────────────────────────────────────────────────────

/**
 * @param forceProgress true: 자식 변경 전파 시 progressLocked 무시하고 항상 롤업
 *                      false(기본): DB 싱크/전체 재계산 시 progressLocked 존중
 */
function syncParentRollups(allTasks: Task[], parentId: string | null, doneStatusIds?: Set<string>, forceProgress = false): Task[] {
  if (!parentId) return allTasks;
  const children = allTasks.filter(t => t.parentId === parentId);
  if (children.length === 0) return allTasks;

  let minStart = children[0].startDate;
  let maxEnd = children[0].endDate;
  let totalWeight = 0;
  let weightedProgressSum = 0;
  let simpleProgressSum = 0;

  for (const child of children) {
    if (child.startDate && child.startDate < minStart) minStart = child.startDate;
    if (child.endDate && child.endDate > maxEnd) maxEnd = child.endDate;
    // 공수(workEffort)는 부모에서 사용자가 직접 입력한 값을 유지하므로 롤업하지 않는다.
    // 대신 진행률 가중 평균 계산에 필요한 weight fallback으로만 effort를 사용한다.
    const effort = typeof child.workEffort === 'number' && Number.isFinite(child.workEffort) ? child.workEffort : 0;
    const weight =
      typeof child.weight === 'number' && Number.isFinite(child.weight)
        ? child.weight
        : effort;
    totalWeight += weight;
    const progress = typeof child.progress === 'number' && Number.isFinite(child.progress) ? child.progress : 0;
    weightedProgressSum += progress * weight;
    simpleProgressSum += progress;
  }

  const parent = allTasks.find(t => t.id === parentId);
  if (!parent) return allTasks;

  let parentProgress: number | undefined;
  // 완료 상태인 경우 자식 롤업으로 덮어쓰지 않고 100% 유지
  if (doneStatusIds && parent.status && doneStatusIds.has(parent.status)) {
    parentProgress = 100;
  } else if (totalWeight > 0) {
    parentProgress = Math.round(weightedProgressSum / totalWeight);
  } else if (children.length > 0) {
    parentProgress = Math.round(simpleProgressSum / children.length);
  }

  const lockedFields = new Set(parent.userLockedFields ?? []);
  const startDateLocked = lockedFields.has('startDate');
  const endDateLocked = lockedFields.has('endDate');
  // forceProgress=true(자식 변경 전파): 잠금 무시하고 항상 롤업
  // forceProgress=false(DB싱크/전체 재계산): progressLocked 존중하여 수동 편집값 유지
  const progressLocked = !forceProgress && lockedFields.has('progress');
  const shouldUpdate =
    (!startDateLocked && parent.startDate !== minStart) ||
    (!endDateLocked && parent.endDate !== maxEnd) ||
    (!progressLocked && parentProgress !== undefined && parent.progress !== parentProgress);

  const updatedTasks = shouldUpdate
    ? allTasks.map(t =>
      t.id === parentId
        ? {
          ...t,
          ...(!startDateLocked ? { startDate: minStart } : {}),
          ...(!endDateLocked ? { endDate: maxEnd } : {}),
          ...(!progressLocked && parentProgress !== undefined ? { progress: parentProgress } : {}),
        }
        : t
    )
    : allTasks;

  return syncParentRollups(updatedTasks, parent.parentId, doneStatusIds, forceProgress);
}

/**
 * 상위 작업 진척률을 수동 변경 시, 모든 하위 레벨을 비율 유지하여 재귀적으로 배분.
 * - 현재 자식들의 가중평균이 targetProgress가 되도록 각 자식 진척률을 비례 조정.
 * - 현재 평균이 0이면 모든 자식을 targetProgress로 설정.
 * - 각 자식의 하위에도 같은 방식으로 재귀 적용.
 */
function distributeProgressDown(allTasks: Task[], parentId: string, targetProgress: number): Task[] {
  const children = allTasks.filter(t => t.parentId === parentId);
  if (children.length === 0) return allTasks;

  let totalWeight = 0;
  let weightedSum = 0;
  for (const child of children) {
    const effort = typeof child.workEffort === 'number' && Number.isFinite(child.workEffort) ? child.workEffort : 0;
    const weight = typeof child.weight === 'number' && Number.isFinite(child.weight) ? child.weight : effort;
    totalWeight += weight;
    const progress = typeof child.progress === 'number' && Number.isFinite(child.progress) ? child.progress : 0;
    weightedSum += progress * weight;
  }

  const currentAvg = totalWeight > 0
    ? weightedSum / totalWeight
    : children.reduce((s, c) => s + (typeof c.progress === 'number' ? c.progress : 0), 0) / children.length;

  let result = allTasks;
  for (const child of children) {
    let newChildProgress: number;
    if (currentAvg <= 0) {
      newChildProgress = targetProgress;
    } else {
      const childProgress = typeof child.progress === 'number' ? child.progress : 0;
      newChildProgress = Math.min(100, Math.max(0, Math.round(childProgress * targetProgress / currentAvg)));
    }
    result = result.map(t => t.id === child.id ? { ...t, progress: newChildProgress } : t);
    result = distributeProgressDown(result, child.id, newChildProgress);
  }

  return result;
}

/**
 * 상위 작업 가중치 변경 시, 해당 노드의 모든 하위 레벨을 비율 유지하여 재귀적으로 재분배.
 * - 직계 자식: (기존 가중치 또는 공수 비율) × 상위 가중치. 합 = 상위 가중치.
 * - 자식이 자신의 자식을 가지면, 그 자식에게 부여된 새 가중치로 다시 재분배.
 */
function redistributeWeightsDown(tasks: Task[], parentId: string, parentWeight: number): Task[] {
  const children = tasks.filter(t => t.parentId === parentId);
  if (children.length === 0) return tasks;

  const raw = (c: Task) =>
    typeof c.weight === 'number' && Number.isFinite(c.weight) ? c.weight : (typeof c.workEffort === 'number' && Number.isFinite(c.workEffort) ? c.workEffort : 0);
  const rawSum = children.reduce((s, c) => s + raw(c), 0);

  const orderIdx = new Map(children.map((c, i) => [c.id, i]));
  const sortedChildren = [...children].sort((a, b) => (orderIdx.get(a.id) ?? 0) - (orderIdx.get(b.id) ?? 0));
  let assigned = 0;
  const newWeights: Record<string, number> = {};

  for (let i = 0; i < sortedChildren.length; i++) {
    const c = sortedChildren[i]!;
    const r = raw(c);
    let w: number;
    if (rawSum > 0) {
      w = i < sortedChildren.length - 1 ? round2((r / rawSum) * parentWeight) : round2(parentWeight - assigned);
      assigned += i < sortedChildren.length - 1 ? w : 0;
    } else {
      w = i < sortedChildren.length - 1 ? round2(parentWeight / children.length) : round2(parentWeight - assigned);
      assigned += i < sortedChildren.length - 1 ? w : 0;
    }
    newWeights[c.id] = w;
  }

  let nextTasks = tasks.map(t => {
    const nw = newWeights[t.id];
    return nw !== undefined ? { ...t, weight: nw } : t;
  });

  for (const c of sortedChildren) {
    const hasGrandchildren = nextTasks.some(t => t.parentId === c.id);
    if (hasGrandchildren) nextTasks = redistributeWeightsDown(nextTasks, c.id, newWeights[c.id] ?? 0);
  }

  return nextTasks;
}

function recomputeProjectRollups(allTasks: Task[], projectId: string, doneStatusIds?: Set<string>): Task[] {
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
    next = syncParentRollups(next, pid, doneStatusIds);
  }
  return next;
}

/** 모든 프로젝트에 대해 상위 작업의 시작일/종료일/공수를 하위 작업 기준으로 롤업 */
function applyRollupsToTasks(tasks: Task[], statusConfigs?: Array<{ id: string; progress?: number }>): Task[] {
  const doneStatusIds = statusConfigs
    ? new Set(statusConfigs.filter(c => c.progress === 100).map(c => c.id))
    : undefined;
  const projectIds = Array.from(new Set(tasks.map(t => t.projectId))).filter(
    (id): id is string => Boolean(id) && id !== 'all'
  );
  let result = tasks;
  for (const pid of projectIds) result = recomputeProjectRollups(result, pid, doneStatusIds);
  return result;
}

// ─── WBSSettings 파싱 헬퍼 ────────────────────────────────────────────────────

function parseSettings(raw: unknown): WBSSettings {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as
      Partial<WBSSettings> & { statusNames?: Record<string, string>; statusProgress?: Record<string, number> };
    let statusConfigs = parsed.statusConfigs;
    if (!statusConfigs && (parsed.statusNames || parsed.statusProgress)) {
      statusConfigs = (['todo', 'in-progress', 'blocked', 'done'] as const).map(id => ({
        id,
        name: parsed.statusNames?.[id] || (id === 'todo' ? '할 일' : id === 'in-progress' ? '진행 중' : id === 'blocked' ? '지연됨' : '완료'),
        progress: parsed.statusProgress?.[id] !== undefined ? parsed.statusProgress[id] : (id === 'todo' ? 0 : id === 'in-progress' ? 10 : id === 'blocked' ? 50 : 100),
        color: id === 'todo' ? 'bg-stone-100 border-stone-200' : id === 'in-progress' ? 'bg-blue-50 border-blue-100' : id === 'blocked' ? 'bg-red-50 border-red-100' : 'bg-green-50 border-green-100',
      }));
    }
    const base: WBSSettings = {
      ...DEFAULT_SETTINGS,
      ...parsed,
      appTitle: parsed.appTitle || DEFAULT_SETTINGS.appTitle,
      statusConfigs: statusConfigs || DEFAULT_STATUS_CONFIGS,
      tableColumns: Array.isArray(parsed.tableColumns) && parsed.tableColumns.length > 0
        ? parsed.tableColumns
            .filter((c) => c && typeof c.id === 'string')
            .map((c) => ({ id: String(c.id), visible: c.visible !== false }))
        : DEFAULT_SETTINGS.tableColumns,
      showCriticalPath: parsed.showCriticalPath === true,
      wrapTextInCells: parsed.wrapTextInCells === true,
      linkStatusAndProgress:
        parsed.linkStatusAndProgress === false ? false : true,
    };

    // 투입율 컬럼 기본 숨김 마이그레이션 (이전 버전 설정용, 1회만 적용)
    if (!parsed.allocationHiddenMigrated) {
      const cols = Array.isArray(base.tableColumns) ? base.tableColumns : [];
      base.tableColumns = cols.map(c =>
        c && c.id === 'allocation' ? { ...c, visible: false } : c
      );
      base.allocationHiddenMigrated = true;
    }

    return base;
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
  editableProjectIds,
}: {
  children: React.ReactNode;
  /** true면 로컬(IndexedDB/localStorage)만 사용하고 DB는 읽지/쓰지 않음 */
  useLocalOnly?: boolean;
  /** 동시 수정 충돌 시 호출(토스트 등 알림용). Supabase 사용 시에만 의미 있음. */
  onConcurrentConflict?: () => void;
  /** DB 저장 실패 시 호출(토스트 등 알림용). */
  onDbError?: (message: string) => void;
  /** 편집 가능한 프로젝트 ID 목록. 보기 권한만 있는 프로젝트는 제외. 없으면 모두 편집 가능으로 간주 */
  editableProjectIds?: string[];
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
  const [deletedProjectIds, setDeletedProjectIds] = useState<string[]>([]);

  /** 로컬 저장 디바운스 타이머 */
  const persistDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 사용자가 프로젝트/작업을 수정했을 때만 true. 동기화 성공 시 false. */
  const [hasLocalChangesSinceSync, setHasLocalChangesSinceSync] = useState(false);
  /** 푸시 완료 시점에 편집이 있었는지 판별 (동시 편집 중 오탐 클리어 방지) */
  const dirtyEpochRef = useRef(0);
  const [collabPushNonce, setCollabPushNonce] = useState(0);
  const bumpDirty = useCallback(() => {
    dirtyEpochRef.current += 1;
    setCollabPushNonce(n => n + 1);
    setHasLocalChangesSinceSync(true);
  }, []);

  /** Realtime 콜백에서 최신값 참조(의존성에 넣으면 구독이 끊겼다 붙어 이벤트 누락됨) */
  const hasLocalChangesSinceSyncRef = useRef(false);
  hasLocalChangesSinceSyncRef.current = hasLocalChangesSinceSync;
  /** Realtime 콜백에서 최신 프로젝트 목록 참조 */
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
  /** 서버 스냅샷으로 화면 맞춤(다른 계정·Realtime 누락 시 일치용) */
  const serverPullFromDbRef = useRef<() => Promise<void>>(async () => {});
  const allTasksRef = useRef<Task[]>([]);

  const { saveHistory, undo, redo, canUndo, canRedo } = useWbsHistory({
    allTasksRef,
    setAllTasks,
    bumpDirty,
    useLocalOnlyRef,
    handleDbError,
  });

  const preserveLocalExpanded = useCallback((incoming: Task[]): Task[] => {
    const localMap = new Map<string, boolean>(allTasksRef.current.map(t => [t.id, t.expanded]));
    if (localMap.size === 0) return incoming;
    return incoming.map(t => {
      const localExp = localMap.get(t.id);
      return localExp !== undefined ? { ...t, expanded: localExp } : t;
    });
  }, []);
  /** 동시 수정 충돌 시 토스트/refetch 중복 방지 (2초 내 재호출 스킵) */
  const lastConflictRef = useRef<number>(0);
  const CONFLICT_DEBOUNCE_MS = 2000;
  /** 신규 프로젝트 생성 중복 방지 (React StrictMode 등으로 loadData가 여러 번 실행될 때) */
  const initNewProjectPromiseRef = useRef<Promise<Project | null> | null>(null);
  const prevOwnerIdRef = useRef<string | undefined>(undefined);

  // 프로젝트 전환 시 선택 초기화
  useEffect(() => { setSelectedTaskIds([]); }, [currentProjectId]);

  // ─── 초기 데이터 로딩 (Supabase) ────────────────────────────────────────────

  const ownerId = user?.id ?? undefined;
  const ownerIdRef = useRef<string | undefined>(undefined);
  ownerIdRef.current = ownerId;

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
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
      });

      /** 로컬(IndexedDB)만 사용 — 미승인·오프라인 폴백 */
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
          const savedCurrent = sessionStorage.getItem('wbs-current-project');
          const validId = projectsToUse.find(p => p.id === savedCurrent)?.id ?? projectsToUse[0]?.id ?? '';
          setCurrentProjectId(validId);
        } else {
          const p = emptyStarterProject();
          setProjects([p]);
          setAllTasks(applyRollupsToTasks(tasksToUse, DEFAULT_SETTINGS.statusConfigs));
          setWbsSettings(DEFAULT_SETTINGS);
          setCurrentProjectId(p.id);
          try {
            sessionStorage.setItem('wbs-current-project', p.id);
          } catch {
            /* ignore */
          }
        }
        setTreeExpandLevel(Math.min(9, Math.max(1, (parsedSettings?.maxLevel ?? DEFAULT_SETTINGS.maxLevel) + 1)));
      };

      try {
        // 서버 우선: 같은 프로젝트를 보더라도 PC마다 다른 로컬 사본을 먼저 뿌리지 않음 (권한·역할과 무관하게 DB가 단일 소스)
        if (!skipDbUntilSync && !useLocalOnly && isSupabaseConfigured && supabase && user?.id) {
          try {
            const [dbProjects, dbTasks, dbSettings] = await Promise.all([
              fetchProjects(),
              fetchTasks(),
              fetchSettings(),
            ]);
            setDeletedTaskIdsByProject({});
            setDeletedProjectIds([]);
            if (!Array.isArray(dbProjects)) throw new Error('Invalid projects response');
            if (dbProjects.length > 0) {
              setProjects(dbProjects);
              const effectiveSettings593 = dbSettings ? { ...wbsSettings, ...(dbSettings as Partial<WBSSettings>) } : wbsSettings;
              setAllTasks(applyRollupsToTasks(Array.isArray(dbTasks) ? dbTasks : [], effectiveSettings593.statusConfigs));
              if (dbSettings) {
                setWbsSettings(prev => ({ ...prev, ...(dbSettings as Partial<WBSSettings>) }));
              }
              const savedCurrent = sessionStorage.getItem('wbs-current-project');
              const validId =
                dbProjects.find(p => p.id === savedCurrent)?.id ?? dbProjects[0]?.id ?? '';
              if (validId) setCurrentProjectId(validId);
              const ml =
                dbSettings && typeof (dbSettings as Partial<WBSSettings>).maxLevel === 'number'
                  ? (dbSettings as Partial<WBSSettings>).maxLevel!
                  : DEFAULT_SETTINGS.maxLevel;
              setTreeExpandLevel(Math.min(9, Math.max(1, ml + 1)));
            } else {
              const p = emptyStarterProject();
              setProjects([p]);
              setAllTasks([]);
              if (dbSettings) {
                setWbsSettings(prev => ({ ...prev, ...(dbSettings as Partial<WBSSettings>) }));
              } else {
                setWbsSettings(DEFAULT_SETTINGS);
              }
              setCurrentProjectId(p.id);
              try {
                sessionStorage.setItem('wbs-current-project', p.id);
              } catch {
                /* ignore */
              }
              setTreeExpandLevel(Math.min(9, DEFAULT_SETTINGS.maxLevel + 1));
            }
          } catch (e) {
            handleDbError(e, 'DB에서 불러오지 못했습니다. 이 기기에 저장된 데이터를 표시합니다.');
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
        setIsLoading(false);
      }
    };
    loadData();
  }, [useLocalOnly, user?.id, handleDbError]);

  // 모든 사용자: 상태 변경 시 로컬(IndexedDB/localStorage)에 저장 (1초 디바운스)
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
        // 저장 실패 항목 감지 (용량 초과 등)
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

  // ─── Realtime: DB 변경사항 자동 반영 (저장 단위 공동편집) ────────────────────
  useEffect(() => {
    if (useLocalOnly) return;
    if (!isSupabaseConfigured || !supabase) return;
    if (!user?.id) return;
    if (!currentProjectId) return;

    const channelName = `wbs-db-${currentProjectId}`;
    const channel = supabase.channel(channelName);

    // NOTE: React state updater(setX(prev=>...)) 안에서 토스트/콜백(setState)을 호출하면
    // "Cannot update a component while rendering a different component" 경고가 날 수 있어
    // 반드시 다음 tick으로 지연시켜 호출한다.
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
      const sameProject = list.filter(t => t.projectId === incoming.projectId);
      const others = list.filter(t => t.projectId !== incoming.projectId);
      const existingIdx = sameProject.findIndex(t => t.id === incoming.id);
      const base = existingIdx >= 0
        ? [...sameProject.slice(0, existingIdx), ...sameProject.slice(existingIdx + 1)]
        : [...sameProject];
      let insertAt = base.length;
      // sort_order는 0..N 연속이 아닐 수 있으므로 "정렬 후 위치" 기준으로 삽입
      const baseWithOrder = base.map((t, i) => ({ t, i }));
      // 기존 순서 보존: 실제 row.sort_order를 로컬에서 저장하지 않으므로,
      // 같은 프로젝트 내에서는 "기존 배열 순서"를 기본으로 두고, 새 row만 적당히 끼워 넣는다.
      // (정확한 정렬은 DB 동기화에서 전체 내려받기로 보정됨)
      insertAt = Math.min(Math.max(0, Math.round(sortOrder)), base.length);
      const nextSame = [...base.slice(0, insertAt), incoming, ...base.slice(insertAt)];
      return [...others, ...nextSame];
    };

    // tasks: 현재 프로젝트(또는 all이면 전체) 변경 반영
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
            setAllTasks(prev => prev.filter(t => t.id !== oldId));
            return;
          }
          const row = payload?.new;
          if (!row || !row.id) return;
          const serverTask = fromTaskRow(row as unknown as TaskRow);
          const before = allTasksRef.current;
          const existingBefore = before.find(t => t.id === serverTask.id);
          const rowTyped = row as unknown as TaskRow;
          const contentMatches =
            !!existingBefore && serverTaskRowMatchesLocalTask(existingBefore, rowTyped);

          // 미저장 로컬 편집이 있는데 서버 스냅샷이 내용상 다르면 → 옛 DB 행으로 덮어써 레벨 등이 원복되는 것을 막음
          if (
            hasLocalChangesSinceSyncRef.current &&
            existingBefore &&
            !contentMatches
          ) {
            return;
          }

          // 실제로 원격(또는 다른 탭)에서 내용이 바뀐 경우에만 충돌 안내. 본인 저장 에코는 내용 동일이라 제외
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
          setAllTasks(prev => {
            const localMatch = prev.find(t => t.id === serverTask.id);
            const merged = localMatch
              ? { ...serverTask, expanded: localMatch.expanded }
              : serverTask;
            const next = prev.map(t => (t.id === merged.id ? merged : t));
            if (localMatch) return next;
            return insertTaskBySortOrder(next, merged, row.sort_order);
          });
        });
      }
    );

    // projects: 메타 변경 반영
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'projects' },
      (payload: RealtimeChangePayload) => {
        queueMicrotask(() => {
          const ev = String(payload?.eventType ?? payload?.event ?? '').toUpperCase();
          if (ev === 'DELETE') {
            const oldId = String(payload?.old?.id ?? '').trim();
            if (!oldId) return;
            setProjects(prev => prev.filter(p => p.id !== oldId));
            return;
          }
          const row = payload?.new;
          if (!row || !row.id) return;
          const serverProject = fromProjectRow(row as unknown as ProjectRow);
          // conflict check을 updater 밖에서 수행 (updater 안에서 토스트 호출 금지)
          const before = projectsRef.current;
          const existingBefore = before.find(p => p.id === serverProject.id);
          if (existingBefore && projectNeedsDbUpload(existingBefore, new Map([[serverProject.id, serverProject]]))) {
            notifyConflictLater('project');
          }
          setProjects(prev => {
            if (prev.some(p => p.id === serverProject.id)) return prev.map(p => (p.id === serverProject.id ? serverProject : p));
            return [...prev, serverProject];
          });
        });
      }
    );

    // settings: default row 변경 반영
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'wbs_settings', filter: 'id=eq.default' },
      (payload: RealtimeChangePayload) => {
        queueMicrotask(() => {
          const row = payload?.new;
          if (!row) return;
          const partial = fromSettingsRow(row as unknown as SettingsRow);
          setWbsSettings(prev => ({ ...prev, ...partial }));
          notifyConflictLater('settings');
        });
      }
    );

    let cleanedUp = false;

    channel.subscribe((status: string) => {
      if (import.meta.env.DEV) {
        if (status === 'SUBSCRIBED') {
          console.debug('[Realtime] 구독됨', channelName, 'tasks/projects/wbs_settings 변경 수신');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[Realtime] 채널 문제:', status, channelName);
        }
      }
      // CLOSED/ERROR 상태에서 unsubscribe 재호출 시 re-entrancy → call stack 오버플로우 방지
      // cleanup은 useEffect return에서만 수행
    });

    return () => {
      if (cleanedUp) return;
      cleanedUp = true;
      // removeChannel을 써야 Supabase 내부 채널 목록에서도 제거됨
      // unsubscribe만 하면 채널이 메모리에 누적되어 Maximum call stack size exceeded 발생
      queueMicrotask(() => {
        try {
          supabase!.removeChannel(channel);
        } catch {
          /* ignore */
        }
      });
    };
    // hasLocalChangesSinceSync / onConcurrentConflict 는 ref로 읽음 — 넣으면 저장할 때마다 구독이 끊김
  }, [useLocalOnly, user?.id, currentProjectId]);

  serverPullFromDbRef.current = async () => {
    if (useLocalOnly || !isSupabaseConfigured || !supabase || !user?.id) return;
    if (hasLocalChangesSinceSyncRef.current) return;
    try {
      const [dbProjects, dbTasks, dbSettings] = await Promise.all([
        fetchProjects(),
        fetchTasks(),
        fetchSettings(),
      ]);
      // fetch 완료 후 다시 확인: fetch 중 로컬 편집이 발생했으면 덮어쓰지 않는다
      if (hasLocalChangesSinceSyncRef.current) return;
      if (!Array.isArray(dbProjects)) return;
      setProjects(dbProjects);
      const effectiveSettings887 = dbSettings ? { ...wbsSettings, ...(dbSettings as Partial<WBSSettings>) } : wbsSettings;
      setAllTasks(preserveLocalExpanded(applyRollupsToTasks(Array.isArray(dbTasks) ? dbTasks : [], effectiveSettings887.statusConfigs)));
      if (dbSettings) {
        setWbsSettings(prev => ({ ...prev, ...(dbSettings as Partial<WBSSettings>) }));
      }
      if (dbProjects.length > 0) {
        const saved = sessionStorage.getItem('wbs-current-project');
        const valid =
          dbProjects.find(p => p.id === saved)?.id ?? dbProjects[0]!.id ?? '';
        if (valid) setCurrentProjectId(valid);
      }
    } catch {
      /* 다음 주기 재시도 */
    }
  };

  // 주기·탭 복귀 시 서버와 재맞춤 (Realtime 누락·다른 계정 수정 반영)
  const lastServerPullAtRef = useRef(0);
  const appReadyAtRef = useRef(0);
  useEffect(() => {
    if (!isLoading) appReadyAtRef.current = Date.now();
  }, [isLoading]);

  useEffect(() => {
    if (isLoading || useLocalOnly || !isSupabaseConfigured || !user?.id) return;
    const MIN_GAP_MS = 12000;
    const INTERVAL_MS = 25000;
    const run = () => {
      if (hasLocalChangesSinceSyncRef.current) return;
      const now = Date.now();
      if (now - lastServerPullAtRef.current < MIN_GAP_MS) return;
      lastServerPullAtRef.current = now;
      void serverPullFromDbRef.current();
    };
    const iv = window.setInterval(run, INTERVAL_MS);
    const once = window.setTimeout(() => {
      if (Date.now() - appReadyAtRef.current < 4000) return;
      if (hasLocalChangesSinceSyncRef.current) return;
      lastServerPullAtRef.current = Date.now();
      void serverPullFromDbRef.current();
    }, 16000);
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
      }, 1600);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(iv);
      clearTimeout(once);
      clearTimeout(visTimer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [isLoading, useLocalOnly, user?.id]);

  useEffect(() => {
    if (isLoading || useLocalOnly || !user?.id || !isSupabaseConfigured) return;
    if (!currentProjectId || currentProjectId === 'all') return;
    if (Date.now() - appReadyAtRef.current < 8000) return;
    const t = window.setTimeout(() => {
      if (hasLocalChangesSinceSyncRef.current) return;
      const now = Date.now();
      if (now - lastServerPullAtRef.current < 10000) return;
      lastServerPullAtRef.current = now;
      void serverPullFromDbRef.current();
    }, 900);
    return () => clearTimeout(t);
  }, [currentProjectId, isLoading, useLocalOnly, user?.id]);

  const recordDeletedTaskIds = useCallback((projectId: string, ids: string[]) => {
    const pid = String(projectId ?? '');
    const unique = Array.from(new Set(ids.filter(Boolean)));
    if (!pid || unique.length === 0) return;
    setDeletedTaskIdsByProject(prev => {
      const existing = prev[pid] ?? [];
      const merged = Array.from(new Set([...existing, ...unique]));
      if (merged.length === existing.length) return prev;
      return { ...prev, [pid]: merged };
    });
  }, []);

  const syncWithDb = async (
    scope: 'current' | 'all',
    onProgress?: (percent: number, message: string) => void,
    opts?: { pullAfter?: boolean; skipAutoPrune?: boolean }
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
        // RLS 정책 위반: 편집 권한 없는 프로젝트에 작업 추가/수정 시도
        if (code === '42501' || /row-level security|row level security/i.test(msg)) {
          return new Error('이 프로젝트에 대한 편집 권한이 없습니다. 보기 권한만 있거나 멤버가 아닌 프로젝트에는 작업을 추가·수정할 수 없습니다.');
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
        ? projects.map(p => p.id).filter(Boolean)
        : (currentProjectId && currentProjectId !== 'all' ? [currentProjectId] : []);

    const projectIdSet = new Set(projectIds);
    const targetProjects = projects.filter(p => projectIdSet.has(p.id));
    const targetTasks = allTasks.filter(t => t.projectId && projectIdSet.has(t.projectId));
    const targetDeletedProjectIdsFromState = effectiveScope === 'all'
      ? Array.from(new Set(deletedProjectIds.filter(Boolean)))
      : [];

    // Auto-prune: 작업 0개인 프로젝트는 로컬/DB에서 제거 (소유자 본인 프로젝트만)
    // - 안전장치: 최소 1개 프로젝트는 남김
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
    const ownedProjectsInScope = targetProjects.filter(p => (p.ownerId ?? undefined) === ownerId);
    // auto-prune 대상: 자동 생성된 임시 프로젝트(_autoGenerated)이면서 작업이 없는 것만
    const autoDeletedProjectIds = ownedProjectsInScope
      .filter(p => p._autoGenerated && (taskCountByProject.get(p.id) ?? 0) === 0)
      .map(p => p.id);

    // Merge deletions (state + auto)
    const targetDeletedProjectIds = effectiveScope === 'all'
      ? Array.from(new Set([...targetDeletedProjectIdsFromState, ...autoDeletedProjectIds].filter(Boolean)))
      : [];
    const deletionProjectIdSet = new Set(targetDeletedProjectIds);
    const targetProjectIdSetAfterAutoDelete = new Set(projectIds.filter(id => !deletionProjectIdSet.has(id)));
    const targetProjectsAfterAutoDelete = targetProjects.filter(p => targetProjectIdSetAfterAutoDelete.has(p.id));
    const targetTasksAfterAutoDelete = targetTasks.filter(t => t.projectId && targetProjectIdSetAfterAutoDelete.has(t.projectId));

    let workingProjects = projects;
    let workingTasks = allTasks;
    try {
      report(1, '동기화 준비 중…');
      // Apply auto-prune locally (scope=all, 수동 전체 동기화 시에만 실행)
      if (effectiveScope === 'all' && !skipAutoPrune && autoDeletedProjectIds.length > 0) {
        setDeletedProjectIds(prev => Array.from(new Set([...prev, ...autoDeletedProjectIds])));
        workingProjects = projects.filter(p => !autoDeletedProjectIds.includes(p.id));
        workingTasks = allTasks.filter(t => !t.projectId || !autoDeletedProjectIds.includes(t.projectId));
        setProjects(workingProjects);
        setAllTasks(workingTasks);
        if (autoDeletedProjectIds.includes(currentProjectId)) {
          const nextId = projects.find(p => !autoDeletedProjectIds.includes(p.id))?.id ?? '';
          setCurrentProjectId(nextId);
        }
      }

      report(3, '서버와 비교하는 중…');
      const [preProjects, preTaskRows, preSettingsRow] = await Promise.all([
        fetchProjects(),
        fetchTaskRows(),
        fetchSettingsRow(),
      ]);
      const serverProjectById = new Map(preProjects.map(p => [p.id, p]));

      let uploadError: unknown = null;
      const taskProjectIdSet = new Set<string>(targetProjectsAfterAutoDelete.map(p => p.id));
      const deletionPids = Array.from(new Set([...projectIds, ...targetDeletedProjectIds].filter(Boolean)));
      let nProj = targetProjectsAfterAutoDelete.length;
      let nProjUp = 0;
      let needSettingsUpload = false;
      let nTaskUp = 0;
      let taskRows = targetTasksAfterAutoDelete.length;
      let uniqueDeletionIds: string[] = [];
      let nDelProj = targetDeletedProjectIds.length;
      /** 프로젝트별 업로드한 작업 수 (동기화 요약 byProject용) */
      const uploadedTasksByProject: Record<string, number> = {};
      /** 업로드한 프로젝트 id 목록 (동기화 요약 byProject용) */
      let uploadedProjectIds: string[] = [];
      let replacedProjectIds: string[] = [];
      let replacedByProject: Record<string, number> = {};

      try {
        // 1) 프로젝트: 서버와 다른 것만 업로드
        const projectsToUpload = targetProjectsAfterAutoDelete.filter(p =>
          projectNeedsDbUpload(p, serverProjectById)
        );
        nProj = targetProjectsAfterAutoDelete.length;
        nProjUp = projectsToUpload.length;
        uploadedProjectIds = projectsToUpload.map(p => p.id);
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

        // 2) 설정: 다를 때만 업로드
        needSettingsUpload = settingsNeedDbUpload(wbsSettings, preSettingsRow);
        if (needSettingsUpload) {
          report(20, '표·상태 설정 업로드 중…');
          await upsertSettings(wbsSettings);
        } else {
          report(20, '표·상태 설정 서버와 동일 — 업로드 생략');
        }

        // 3) 작업: 순서·내용이 서버와 다른 것만 업로드
        const serverTaskById = new Map(preTaskRows.map(r => [r.id, r]));
        // 전체 작업 목록 기준 sort_order 계산 (부분 업로드 시 인덱스를 배치 내 순번이 아닌 전체 순번으로 유지)
        const taskSortOrders = new Map<string, number>();
        targetTasksAfterAutoDelete.forEach((t, idx) => { if (t.id) taskSortOrders.set(t.id, idx); });
        const tasksToUpload = collectTasksNeedingUpload(
          targetTasksAfterAutoDelete,
          serverTaskById,
          taskProjectIdSet,
          taskSortOrders
        );
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
          await upsertTasks(tasksToUpload, (done, total) => {
            report(22 + (done / Math.max(total, 1)) * 42, `작업 업로드 ${done}/${total}건`);
          }, taskSortOrders);
        }

        // 4) Deletions (tombstones) apply
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

        // 5) Delete projects removed locally (scope=all only)
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

        // 6) Clear applied tombstones for target projects (and deleted projects in scope)
        setDeletedTaskIdsByProject(prev => {
          const next = { ...prev };
          for (const pid of deletionPids) delete next[pid];
          return next;
        });
        if (targetDeletedProjectIds.length > 0) {
          setDeletedProjectIds(prev => prev.filter(id => !deletionProjectIdSet.has(id)));
        }
      } catch (e) {
        uploadError = e;
        report(72, '업로드 중 권한 또는 오류 — 서버 데이터만 로컬에 반영합니다.');
      }

      if (uploadError && !pullAfter) {
        // 토스트는 호출측(App: 자동 저장·Ctrl+S 등)에서 한 번만 표시 — handleDbError까지 호출하면 동일 메시지가 2번 뜸
        throw toUserFacingDbError(uploadError);
      }

      if (!pullAfter) {
        report(96, '서버에 반영됨');
        clearInitBlankSessionFlag();
        if (dirtyEpochRef.current === syncEpochStart) setHasLocalChangesSinceSync(false);
        const persistDeletedTasks: Record<string, string[]> = { ...deletedTaskIdsByProject };
        for (const pid of deletionPids) delete persistDeletedTasks[pid];
        const persistDeletedProjects = deletedProjectIds.filter(id => !deletionProjectIdSet.has(id));
        await Promise.allSettled([
          saveJsonWithIdbFallback('wbs-projects', workingProjects),
          saveJsonWithIdbFallback('wbs-tasks', workingTasks),
          saveJsonWithIdbFallback('wbs-settings', wbsSettings),
          saveJsonWithIdbFallback('wbs-deleted-task-ids', persistDeletedTasks),
          saveJsonWithIdbFallback('wbs-deleted-project-ids', persistDeletedProjects),
        ]);
        const byProject: Record<string, DbSyncSummaryByProject> = {};
        for (const pid of taskProjectIdSet) {
          const projectName = workingProjects.find(p => p.id === pid)?.name ?? pid;
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

      // 7) DB 전체 조회 후 로컬에 반영 — 동기화 시 모든 DB 데이터를 내려받아 로컬에 저장 (DB = 단일 소스)
      report(84, '서버에서 최신 데이터 받는 중…');
      const [dbProjects, dbTaskRows, dbSettings] = await Promise.all([
        fetchProjects(),
        fetchTaskRows(),
        fetchSettings(),
      ]);
      let appliedP = 0;
      let appliedT = 0;
      report(93, 'DB 데이터 로컬에 반영 중…');
      let snapshotProjects: Project[];
      let snapshotTasks: Task[];
      const finalDeletedTasks: Record<string, string[]> = effectiveScope === 'all' ? {} : (() => {
        const serverPidSet = new Set((dbProjects ?? []).map(p => p.id));
        const n = { ...deletedTaskIdsByProject };
        for (const pid of serverPidSet) delete n[String(pid)];
        return n;
      })();
      const finalDeletedProjects: string[] = effectiveScope === 'all' ? [] : deletedProjectIds;

      if (Array.isArray(dbProjects) && dbProjects.length > 0) {
        // DB 전체를 내려받아 로컬 스냅샷으로 사용 (merge 없이 덮어쓰기)
        snapshotProjects = dbProjects;
        const effectiveSettings1280 = dbSettings ? { ...wbsSettings, ...(dbSettings as Partial<WBSSettings>) } : wbsSettings;
        snapshotTasks = applyRollupsToTasks((dbTaskRows ?? []).map(fromTaskRow), effectiveSettings1280.statusConfigs);
        appliedP = snapshotProjects.length;
        appliedT = snapshotTasks.length;
        replacedProjectIds = snapshotProjects.map(p => p.id);
        replacedByProject = snapshotTasks.reduce<Record<string, number>>((acc, t) => {
          const pid = t.projectId ?? '';
          acc[pid] = (acc[pid] ?? 0) + 1;
          return acc;
        }, {});

        setProjects(snapshotProjects);
        setAllTasks(preserveLocalExpanded(snapshotTasks));
        if (dbSettings) setWbsSettings(prev => ({ ...prev, ...dbSettings }));
        setDeletedTaskIdsByProject(finalDeletedTasks);
        setDeletedProjectIds(finalDeletedProjects);

        const savedCurrent = sessionStorage.getItem('wbs-current-project');
        const validId =
          snapshotProjects.find(p => p.id === savedCurrent)?.id ?? snapshotProjects[0]?.id ?? '';
        if (validId) setCurrentProjectId(validId);
      } else {
        snapshotProjects = workingProjects;
        snapshotTasks = workingTasks;
      }

      // 동기화 시 내려받은 DB 데이터를 로컬에 즉시 저장 (IndexedDB/localStorage)
      const finalSettings =
        Array.isArray(dbProjects) && dbProjects.length > 0 && dbSettings
          ? { ...wbsSettings, ...dbSettings }
          : wbsSettings;
      const finalDeletedTasksForPersist =
        Array.isArray(dbProjects) && dbProjects.length > 0 ? finalDeletedTasks : deletedTaskIdsByProject;
      const finalDeletedProjectsForPersist =
        Array.isArray(dbProjects) && dbProjects.length > 0 ? finalDeletedProjects : deletedProjectIds;
      await Promise.allSettled([
        saveJsonWithIdbFallback('wbs-projects', snapshotProjects),
        saveJsonWithIdbFallback('wbs-tasks', snapshotTasks),
        saveJsonWithIdbFallback('wbs-settings', finalSettings),
        saveJsonWithIdbFallback('wbs-deleted-task-ids', finalDeletedTasksForPersist),
        saveJsonWithIdbFallback('wbs-deleted-project-ids', finalDeletedProjectsForPersist),
      ]);

      const projectIdsForSummary = new Set<string>([
        ...taskProjectIdSet,
        ...replacedProjectIds,
        ...Object.keys(replacedByProject),
      ]);
      const byProject: Record<string, DbSyncSummaryByProject> = {};
      for (const pid of projectIdsForSummary) {
        const projectName = snapshotProjects?.find(p => p.id === pid)?.name ?? pid;
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
        `완료 ↑올림 프로젝트 ${summary.uploadedProjects}(생략 ${summary.skippedUploadProjects})·작업 ${summary.uploadedTasks}(생략 ${summary.skippedUploadTasks})·설정${summary.uploadedSettings ? ' 반영' : ' 생략'} · ↓내려받아 반영 프로젝트 ${summary.appliedProjectsFromServer}·작업 ${summary.appliedTasksFromServer}건`
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

  const stableSyncWithDb = useCallback(
    (...args: Parameters<typeof syncWithDb>) => syncWithDbRef.current(...args),
    []
  );

  const pushChangesToDb = useCallback(
    (scope: 'current' | 'all') => syncWithDbRef.current(scope, undefined, { pullAfter: false, skipAutoPrune: true }),
    []
  );

  useEffect(() => {
    if (currentProjectId) sessionStorage.setItem('wbs-current-project', currentProjectId);
  }, [currentProjectId]);

  // ─── Undo ─────────────────────────────────────────────────────────────────

  allTasksRef.current = allTasks;

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
  // wbsSettings 전체가 아닌 WBS 번호 생성에 실제 사용되는 필드만 의존
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, wbsSettings.level1Prefix, wbsSettings.level2Prefix, wbsSettings.level3Prefix, wbsSettings.maxLevel]);

  // ─── WBS 설정 ─────────────────────────────────────────────────────────────

  const updateWbsSettings = useCallback((updates: Partial<WBSSettings>) => {
    const newSettings = { ...wbsSettingsRef.current, ...updates };
    setWbsSettings(newSettings);
    if (!useLocalOnlyRef.current) upsertSettings(newSettings).catch(err => handleDbError(err, '설정 저장에 실패했습니다.'));
  }, [handleDbError]);

  const syncProgressFromStatusConfigs = useCallback((scope: 'current' | 'all') => {
    // 상태-진척도 연동을 끈 경우에는 상태 기반 일괄 동기화를 수행하지 않는다.
    if (wbsSettingsRef.current.linkStatusAndProgress === false) return;
    const configs = wbsSettingsRef.current.statusConfigs ?? [];
    if (!configs || configs.length === 0) return;
    const configMap = new Map<string, StatusConfig>(configs.map(c => [c.id, c]));
    setAllTasks(prev => {
      const cpi = currentProjectIdRef.current;
      const targetProjectIds =
        scope === 'all'
          ? Array.from(new Set(prev.map(t => t.projectId))).filter(Boolean) as string[]
          : (cpi && cpi !== 'all' ? [cpi] : []);
      if (targetProjectIds.length === 0) return prev;
      const targetSet = new Set(targetProjectIds);
      let changed = false;
      let next = prev.map(t => {
        if (!targetSet.has(t.projectId)) return t;
        // 사용자가 진척률을 수동 입력(잠금)한 경우 상태 설정으로 덮어쓰지 않음
        if ((t.userLockedFields ?? []).includes('progress')) return t;
        const config = configMap.get(t.status);
        if (!config || config.progress === undefined || config.progress === t.progress) return t;
        changed = true;
        return { ...t, progress: config.progress };
      });
      if (!changed) return prev;

      // 상태 기반으로 하위(또는 개별) 작업 진척률을 바꾼 뒤에는
      // 상위 작업의 진척·공수·기간을 다시 롤업해 부모 진척률도 함께 맞춰 준다.
      // - scope='current': 현재 프로젝트만
      // - scope='all': 모든 프로젝트
      const projectIdsToRollup =
        scope === 'all'
          ? Array.from(new Set(next.map(t => t.projectId))).filter(Boolean) as string[]
          : targetProjectIds;
      const doneStatusIds1492 = new Set((configs as StatusConfig[]).filter(c => c.progress === 100).map(c => c.id));
      for (const pid of projectIdsToRollup) {
        next = recomputeProjectRollups(next, pid, doneStatusIds1492);
      }
      return next;
    });
  }, []);

  // ─── 프로젝트 CRUD ────────────────────────────────────────────────────────

  const addProject = useCallback((name: string, description?: string, startDate?: string, endDate?: string, assignments?: Project['assignments'], minWorkEffortDays?: number, reportExtras?: Partial<Pick<Project, 'reportCategory' | 'reportAgency' | 'reportBudgetThisYear' | 'reportTotalPeriod' | 'reportNameShort' | 'reportNameFull'>>) => {
    bumpDirty();
    const newProject: Project = {
      id: uuidv4(),
      name,
      description,
      startDate,
      endDate,
      assignments,
      minWorkEffortDays,
      ownerId: ownerIdRef.current,
      ...reportExtras,
    };
    setProjects(prev => [...prev, newProject]);
    setCurrentProjectId(newProject.id);
    if (!useLocalOnlyRef.current) upsertProject(newProject).catch(err => handleDbError(err, '프로젝트 저장에 실패했습니다.'));
  }, [bumpDirty, handleDbError]);

  const updateProject = useCallback((id: string, updates: Partial<Project>) => {
    bumpDirty();
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
          const projectAssignmentsMap = new Map<string, ProjectAssignment[]>(prev.map(p => [p.id, p.assignments ?? []]));
          const holidays = getHolidaysForTaskDates(currentTasks);
          let shifted: Task[] = currentTasks.map(t => {
            if (t.projectId !== id) return t;
            let taskStart = t.startDate;
            let taskEnd = t.endDate;

            if (newStart && taskStart && taskStart < newStart) {
              const assignments = projectAssignmentsMap.get(t.projectId);
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
          const adjustedById = new Map<string, Task>(adjusted.map(t => [t.id, t]));
          shifted = shifted.map(t => t.projectId === id && adjustedById.has(t.id) ? adjustedById.get(t.id)! : t);
          shifted = recomputeProjectRollups(shifted, id);
          if (!useLocalOnlyRef.current) upsertTasks(shifted).catch(err => handleDbError(err, '날짜 이동 저장에 실패했습니다.'));
          return shifted;
        });
      }
      return prev.map(p => p.id === id ? { ...p, ...updates } : p);
    });
    const updated = projectsRef.current.find(p => p.id === id);
    if (updated && !useLocalOnlyRef.current) upsertProject({ ...updated, ...updates }).catch(err => handleDbError(err, '프로젝트 수정 저장에 실패했습니다.'));
  }, [bumpDirty, saveHistory, handleDbError]);

  const deleteProject = useCallback((id: string) => {
    if (projectsRef.current.length <= 1) { alert('최소 하나의 프로젝트는 존재해야 합니다.'); return; }
    bumpDirty();
    const idsToDelete = allTasksRef.current.filter(t => t.projectId === id).map(t => t.id);
    if (idsToDelete.length > 0) recordDeletedTaskIds(id, idsToDelete);
    setDeletedProjectIds(prev => {
      if (!id) return prev;
      return prev.includes(id) ? prev : [...prev, id];
    });
    setProjects(prev => prev.filter(p => p.id !== id));
    setAllTasks(prev => prev.filter(t => t.projectId !== id));
    if (currentProjectIdRef.current === id) setCurrentProjectId(projectsRef.current.find(p => p.id !== id)?.id || '');
  }, [bumpDirty, recordDeletedTaskIds]);

  const copyProject = useCallback((sourceProjectId: string) => {
    const projs = projectsRef.current;
    const tasks = allTasksRef.current;
    const source = projs.find(p => p.id === sourceProjectId);
    if (!source) return;
    const sourceTasks = tasks.filter(t => t.projectId === sourceProjectId);
    const newProjectId = uuidv4();
    const newProject: Project = {
      id: newProjectId,
      name: `${source.name} (복사본)`,
      description: source.description,
      startDate: source.startDate,
      endDate: source.endDate,
      assignments: source.assignments?.map(a => ({ ...a })),
      minWorkEffortDays: source.minWorkEffortDays,
      ownerId: ownerIdRef.current ?? undefined,
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
  }, [saveHistory]);

  // ─── 작업 CRUD ────────────────────────────────────────────────────────────

  const clampTaskToProjectRange = useCallback((t: Task, proj?: Project): Task => {
    if (!proj) return t;
    let start = t.startDate;
    let end = t.endDate;
    if (proj.startDate && start && start < proj.startDate) start = proj.startDate;
    if (proj.endDate && end && end > proj.endDate) end = proj.endDate;
    if (start && end && start > end) start = end;
    if (start !== t.startDate || end !== t.endDate) return { ...t, startDate: start, endDate: end };
    return t;
  }, []);

  const addTask = useCallback((newTask: Omit<Task, 'id' | 'projectId'>, insertAfterId?: string, projectIdOverride?: string): string => {
    saveHistory();
    const cpi = currentProjectIdRef.current;
    const projs = projectsRef.current;
    const projectId = projectIdOverride ?? (cpi === 'all' ? (projs[0]?.id || '') : cpi);
    const project = projs.find(p => p.id === projectId);
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
      const result = syncParentRollups(nextTasks, task.parentId, new Set<string>(((wbsSettingsRef.current.statusConfigs ?? []) as StatusConfig[]).filter(c => c.progress === 100).map(c => c.id)));
      return result;
    });
    return task.id;
  }, [saveHistory]);

  const addTasks = useCallback((newTasks: Task[]) => {
    saveHistory();
    const cpi = currentProjectIdRef.current;
    const projs = projectsRef.current;
    const effectiveProjectId = cpi === 'all' ? (projs[0]?.id || '') : cpi;
    const project = projs.find(p => p.id === effectiveProjectId);
    const tasksWithProject = newTasks.map(t =>
      clampTaskToProjectRange({ ...t, projectId: effectiveProjectId }, project)
    );
    setAllTasks(prev => {
      const result = recomputeProjectRollups([...prev, ...tasksWithProject], effectiveProjectId);
      return result;
    });
  }, [saveHistory]);

  const updateTask = useCallback((id: string, updates: Partial<Task>, options?: { skipCascade?: boolean }) => {
    const skipCascade = options?.skipCascade ?? false;
    saveHistory();
    setAllTasks(prev => {
      const wSettings = wbsSettingsRef.current;
      const projs = projectsRef.current;
      const task = prev.find(t => t.id === id);
      if (!task) return prev;
      const hasDateChange = Object.prototype.hasOwnProperty.call(updates, 'startDate') || Object.prototype.hasOwnProperty.call(updates, 'endDate');
      const hasWorkEffortChange = Object.prototype.hasOwnProperty.call(updates, 'workEffort');
      const hasDependencyChange = Object.prototype.hasOwnProperty.call(updates, 'dependencies');
      const hasScheduleChange = hasDateChange || hasWorkEffortChange || hasDependencyChange;

      const taskLockedFields = new Set(task.userLockedFields ?? []);
      const endDateLocked = taskLockedFields.has('endDate');
      let resolvedUpdates = { ...updates };
      if (typeof resolvedUpdates.weight === 'number' && Number.isFinite(resolvedUpdates.weight)) {
        resolvedUpdates = { ...resolvedUpdates, weight: round2(resolvedUpdates.weight) };
      }
      if (typeof resolvedUpdates.progress === 'number' && Number.isFinite(resolvedUpdates.progress)) {
        resolvedUpdates = { ...resolvedUpdates, progress: round2(resolvedUpdates.progress) };
      }
      // 상태를 완료(progress=100인 상태)로 변경하는 경우 진척률을 100으로 자동 설정
      if (
        typeof resolvedUpdates.status === 'string' &&
        wSettings.linkStatusAndProgress !== false &&
        !Object.prototype.hasOwnProperty.call(updates, 'progress')
      ) {
        const newStatusCfg = wSettings.statusConfigs?.find(c => c.id === resolvedUpdates.status);
        if (newStatusCfg && newStatusCfg.progress === 100) {
          resolvedUpdates = { ...resolvedUpdates, progress: 100 };
        }
      }
      const projectAssignmentsMap = new Map<string, ProjectAssignment[]>(projs.map(p => [p.id, p.assignments ?? []]));
      const assignments = task.projectId ? projectAssignmentsMap.get(task.projectId) : undefined;
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
        // 사용자가 직접 startDate를 전달한 경우에만 잠금 (자동 역산된 경우 잠금하지 않음)
        if (Object.prototype.hasOwnProperty.call(updates, 'startDate') && resolvedUpdates.startDate != null) {
          lockFields.add('startDate');
          lockFields.delete('endDate');
        }
        if (resolvedUpdates.endDate != null) {
          lockFields.add('endDate');
        }
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'progress') && typeof resolvedUpdates.progress === 'number' && Number.isFinite(resolvedUpdates.progress)) {
        lockFields.add('progress');
      }

      let updatedTask = { ...task, ...resolvedUpdates, userLockedFields: lockFields.size > 0 ? Array.from(lockFields) : undefined };
      const project = projs.find(p => p.id === task.projectId);
      updatedTask = clampTaskToProjectRange(updatedTask, project);
      let nextTasks = prev.map(t => t.id === id ? updatedTask : t);

      // 상태 변경 시 모든 하위 작업에 캐스케이드
      if (typeof resolvedUpdates.status === 'string' && wSettings.linkStatusAndProgress !== false) {
        const newStatusCfg = ((wSettings.statusConfigs ?? []) as StatusConfig[]).find(c => c.id === resolvedUpdates.status);
        const oldStatusCfg = ((wSettings.statusConfigs ?? []) as StatusConfig[]).find(c => c.id === task.status);
        const getAllDescendantIds = (rootId: string): string[] => {
          const result: string[] = [];
          const stack = [rootId];
          while (stack.length) {
            const pid = stack.pop()!;
            for (const t of nextTasks) {
              if (t.parentId === pid) {
                result.push(t.id);
                stack.push(t.id);
              }
            }
          }
          return result;
        };
        const descendantIds = new Set(getAllDescendantIds(id));
        if (descendantIds.size > 0) {
          if (newStatusCfg && newStatusCfg.progress === 100) {
            // 완료 상태로 변경: 모든 하위 작업을 완료로 캐스케이드
            nextTasks = nextTasks.map(t =>
              descendantIds.has(t.id)
                ? { ...t, status: newStatusCfg.id, progress: 100 }
                : t
            );
          } else if (oldStatusCfg && oldStatusCfg.progress === 100 && newStatusCfg && newStatusCfg.progress !== 100) {
            // 완료 → 비완료로 변경: 완료 상태인 하위 작업을 새 상태로 되돌림
            const doneStatusIds = new Set(((wSettings.statusConfigs ?? []) as StatusConfig[]).filter(c => c.progress === 100).map(c => c.id));
            nextTasks = nextTasks.map(t =>
              descendantIds.has(t.id) && doneStatusIds.has(t.status)
                ? { ...t, status: newStatusCfg.id, progress: newStatusCfg.progress ?? 0 }
                : t
            );
          }
        }
      }

      // 상위 작업 가중치를 수동 입력한 경우: 모든 하위 레벨을 비율 유지하여 재귀 재분배 (각 레벨 합 = 해당 상위 가중치)
      if (Object.prototype.hasOwnProperty.call(updates, 'weight') && typeof updates.weight === 'number' && Number.isFinite(updates.weight)) {
        const parentWeight = updatedTask.weight ?? 0;
        nextTasks = redistributeWeightsDown(nextTasks, id, parentWeight);
      }

      // 진척률을 직접 변경한 경우: 하위 작업에는 영향 주지 않고 상위 롤업만 반영
      // (distributeProgressDown 제거 — 진척률 변경이 자식에게 전파되지 않도록)

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

      const affectsRollup = ['startDate', 'endDate', 'workEffort', 'weight', 'dependencies', 'progress'].some(k =>
        Object.prototype.hasOwnProperty.call(resolvedUpdates, k)
      );
      const doneStatusIds: Set<string> = new Set(((wSettings.statusConfigs ?? []) as StatusConfig[]).filter(c => c.progress === 100).map(c => c.id));
      const parentIdChanged = Object.prototype.hasOwnProperty.call(updates, 'parentId') && updates.parentId !== task.parentId;
      let result = nextTasks;
      if (affectsRollup) {
        const hasChildTasks = prev.some(t => t.parentId === id && t.projectId === task.projectId);
        const isDirectProgressEdit = Object.prototype.hasOwnProperty.call(updates, 'progress');
        if (hasChildTasks && !hasDateChange && !isDirectProgressEdit) {
          // weight/workEffort 등 비날짜 변경: 자식 가중치 기준으로 자신부터 롤업 (forceProgress=true: 잠금 무시)
          result = syncParentRollups(result, id, doneStatusIds, true);
        } else {
          // 진척률 직접 편집이거나 리프 작업 변경: task 자신은 그대로 두고 조상만 롤업 (forceProgress=true: 잠금 무시)
          result = syncParentRollups(result, task.parentId, doneStatusIds, true);
        }
      }
      // 부모 변경 시 기존 부모·신규 부모 모두 롤업 재계산
      if (parentIdChanged) {
        if (task.parentId) result = syncParentRollups(result, task.parentId, doneStatusIds);
        if (updates.parentId) result = syncParentRollups(result, updates.parentId, doneStatusIds);
      }

      const taskInResult = result.find(t => t.id === id);
      return result;
    });
  }, [saveHistory]);

  const updateTasksBulk = useCallback((taskIds: string[], updates: Partial<Task>) => {
    const hasScheduleChange =
      Object.prototype.hasOwnProperty.call(updates, 'startDate') ||
      Object.prototype.hasOwnProperty.call(updates, 'endDate') ||
      Object.prototype.hasOwnProperty.call(updates, 'workEffort') ||
      Object.prototype.hasOwnProperty.call(updates, 'dependencies');
    if (hasScheduleChange || taskIds.length === 0) return;
    saveHistory();
    const idSet = new Set(taskIds);
    setAllTasks(prev => {
      const shouldLockProgress =
        Object.prototype.hasOwnProperty.call(updates, 'progress') &&
        typeof updates.progress === 'number' &&
        Number.isFinite(updates.progress);
      const next = prev.map(t => {
        if (!idSet.has(t.id)) return t;
        if (!shouldLockProgress) return { ...t, ...updates };
        const lockFields = new Set(t.userLockedFields ?? []);
        lockFields.add('progress');
        return {
          ...t,
          ...updates,
          userLockedFields: lockFields.size > 0 ? Array.from(lockFields) : undefined,
        };
      });
      return next;
    });
  }, [saveHistory]);

  const setBaselineForTasks = useCallback((taskIds: string[]) => {
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
  }, [saveHistory]);

  const setBaselineForAllTasks = useCallback(() => {
    const cpi = currentProjectIdRef.current;
    const ids = cpi === 'all'
      ? allTasksRef.current.map(t => t.id)
      : allTasksRef.current.filter(t => t.projectId === cpi).map(t => t.id);
    setBaselineForTasks(ids);
  }, [setBaselineForTasks]);

  const renameAssignee = useCallback((oldName: string, newName: string) => {
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

    // 작업의 assignee 담당자명 변경
    setAllTasks(prev => {
      const next = prev.map(t => {
        const nextAssignee = ((t.assignee ?? '').trim() === from) ? to : t.assignee;
        if (nextAssignee === t.assignee) return t;
        return { ...t, assignee: nextAssignee ?? '' };
      });
      if (!useLocalOnlyRef.current) upsertTasks(next).catch(err => handleDbError(err, '투입인원 이름 변경 저장에 실패했습니다.'));
      return next;
    });
  }, [saveHistory, handleDbError]);

  /** 선후관계·기간(공수·투입율)을 반영해 현재 프로젝트(또는 전체) 일정을 앞당기도록 재계산 */
  const refreshProjectSchedule = useCallback(() => {
    const cpi = currentProjectIdRef.current;
    const projs = projectsRef.current;
    const projectIds = cpi === 'all'
      ? projs.map(p => p.id).filter(Boolean)
      : [cpi].filter(Boolean);
    if (projectIds.length === 0) return;
    saveHistory();
    setAllTasks(prev => {
      const projectAssignmentsByProjectId = new Map<string, ProjectAssignment[]>(
        projectsRef.current.map(p => [p.id, p.assignments ?? []])
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
  }, [saveHistory]);

  /** 과부하 자동 수정: 항목별로 선택한 전략(기간 연장/투입율 증가) 적용. */
  const fixOverload = useCallback((overloadsToFix: Array<{ overload: WorkloadDay; strategy: 'extend' | 'increaseAllocation' }>) => {
    if (overloadsToFix.length === 0) return;
    saveHistory();
    const extendOverloads = overloadsToFix.filter((x) => x.strategy === 'extend').map((x) => x.overload);
    const allocationOverloads = overloadsToFix.filter((x) => x.strategy === 'increaseAllocation').map((x) => x.overload);
    setAllTasks((prev) => {
      const projs = projectsRef.current;
      const settings = wbsSettingsRef.current;
      let result = [...prev];
      const allocationTaskIds = new Set(allocationOverloads.flatMap((o) => o.taskIds));
      if (extendOverloads.length > 0) {
        result = fixOverloadByExtending(result, projs, extendOverloads);
      }
      if (allocationOverloads.length > 0) {
        const { overloads: currentOverloads } = computeWorkloadOverloads(result, projs);
        const toAllocate = currentOverloads.filter((o) => o.taskIds.some((tid) => allocationTaskIds.has(tid)));
        if (toAllocate.length > 0) {
          result = fixOverloadByIncreasingAllocation(result, projs, toAllocate);
        }
      }
      const projectIds = Array.from(new Set(result.map((t) => t.projectId))).filter(Boolean) as string[];
      const doneStatusIds2070: Set<string> = new Set(((settings.statusConfigs ?? []) as StatusConfig[]).filter(c => c.progress === 100).map(c => c.id));
      for (const pid of projectIds) {
        result = recomputeProjectRollups(result, pid, doneStatusIds2070);
      }
      return result;
    });
  }, [saveHistory]);

  const deleteTask = useCallback((id: string) => {
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
  }, [saveHistory, recordDeletedTaskIds]);

  // ─── 이동 / 재정렬 ────────────────────────────────────────────────────────

  const moveTask = useCallback((id: string, direction: 'up' | 'down') => {
    saveHistory();
    setAllTasks(prev => {
      const cpi = currentProjectIdRef.current;
      const projectTasks = prev.filter(t => t.projectId === cpi);
      const otherTasks = prev.filter(t => t.projectId !== cpi);
      const task = projectTasks.find(t => t.id === id);
      if (!task) return prev;
      const siblings = projectTasks.filter(t => t.parentId === task.parentId);
      const idx = siblings.findIndex(t => t.id === id);
      const newProjectTasks = [...projectTasks];
      if (direction === 'up' && idx > 0) {
        const iA = projectTasks.findIndex(t => t.id === task.id);
        const iB = projectTasks.findIndex(t => t.id === siblings[idx - 1].id);
        [newProjectTasks[iA], newProjectTasks[iB]] = [newProjectTasks[iB], newProjectTasks[iA]];
      } else if (direction === 'down' && idx < siblings.length - 1) {
        const iA = projectTasks.findIndex(t => t.id === task.id);
        const iB = projectTasks.findIndex(t => t.id === siblings[idx + 1].id);
        [newProjectTasks[iA], newProjectTasks[iB]] = [newProjectTasks[iB], newProjectTasks[iA]];
      } else return prev;
      return [...otherTasks, ...newProjectTasks];
    });
  }, [saveHistory]);

  const reorderTask = useCallback((id: string, overId: string) => {
    saveHistory();
    setAllTasks(prev => {
      const cpi = currentProjectIdRef.current;
      const projectTasks = prev.filter(t => t.projectId === cpi);
      const otherTasks = prev.filter(t => t.projectId !== cpi);
      const oldIndex = projectTasks.findIndex(t => t.id === id);
      const newIndex = projectTasks.findIndex(t => t.id === overId);
      if (oldIndex === -1 || newIndex === -1) return prev;
      const arr = [...projectTasks];
      const [moved] = arr.splice(oldIndex, 1);
      arr.splice(newIndex, 0, moved);
      return [...otherTasks, ...arr];
    });
  }, [saveHistory]);

  // ─── 들여쓰기 ─────────────────────────────────────────────────────────────

  const indentTask = useCallback((id: string) => {
    saveHistory();
    setAllTasks(prev => {
      const cpi = currentProjectIdRef.current;
      const projectTasks = prev.filter(t => t.projectId === cpi);
      const otherTasks = prev.filter(t => t.projectId !== cpi);
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
      return recomputeProjectRollups([...otherTasks, ...updated], cpi);
    });
  }, [saveHistory]);

  const outdentTask = useCallback((id: string) => {
    saveHistory();
    setAllTasks(prev => {
      const cpi = currentProjectIdRef.current;
      const projectTasks = prev.filter(t => t.projectId === cpi);
      const otherTasks = prev.filter(t => t.projectId !== cpi);
      const task = projectTasks.find(t => t.id === id);
      if (!task || !task.parentId) return prev;
      const parent = projectTasks.find(t => t.id === task.parentId);
      if (!parent) return prev;
      const updated = projectTasks.map(t => t.id === id ? { ...t, parentId: parent.parentId } : t);
      return recomputeProjectRollups([...otherTasks, ...updated], cpi);
    });
  }, [saveHistory]);

  const indentTasks = useCallback((ids: string[]) => {
    saveHistory();
    setAllTasks(prev => {
      const cpi = currentProjectIdRef.current;
      let projectTasks = prev.filter(t => t.projectId === cpi);
      const otherTasks = prev.filter(t => t.projectId !== cpi);
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
      return recomputeProjectRollups([...otherTasks, ...projectTasks], cpi);
    });
  }, [saveHistory]);

  const outdentTasks = useCallback((ids: string[]) => {
    saveHistory();
    setAllTasks(prev => {
      const cpi = currentProjectIdRef.current;
      let projectTasks = prev.filter(t => t.projectId === cpi);
      const otherTasks = prev.filter(t => t.projectId !== cpi);
      const selectedIds = new Set(ids);
      for (const id of ids) {
        const task = projectTasks.find(t => t.id === id);
        if (!task || !task.parentId || selectedIds.has(task.parentId)) continue;
        const parent = projectTasks.find(t => t.id === task.parentId);
        if (!parent) continue;
        projectTasks = projectTasks.map(t => t.id === id ? { ...t, parentId: parent.parentId } : t);
      }
      return recomputeProjectRollups([...otherTasks, ...projectTasks], cpi);
    });
  }, [saveHistory]);

  const toggleExpand = useCallback((id: string) => {
    setAllTasks(prev => prev.map(t => t.id === id ? { ...t, expanded: !t.expanded } : t));
  }, []);

  const expandToLevel = useCallback((level: number) => {
    const targetLevel = Math.max(1, Math.floor(level || 1));
    setTreeExpandLevel(targetLevel);
    saveHistory();
    setAllTasks(prev => {
      const cpi = currentProjectIdRef.current;
      const relevant = cpi === 'all' ? prev : prev.filter(t => t.projectId === cpi);
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
  }, [saveHistory]);

  // ─── 가져오기 / 삭제 ──────────────────────────────────────────────────────

  const importTasks = useCallback(async (newTasks: Task[], targetProjectId?: string, newProjectName?: string): Promise<void> => {
    saveHistory();
    const cpi = currentProjectIdRef.current;
    const projs = projectsRef.current;
    let effectiveProjectId =
      targetProjectId ?? (cpi === 'all' ? (projs[0]?.id || '') : cpi);

    const createNewProject =
      effectiveProjectId === '__new__' && typeof newProjectName === 'string' && newProjectName.trim().length > 0;

    const newProject: Project | null = createNewProject
      ? {
          id: uuidv4(),
          name: newProjectName!.trim() || '가져온 프로젝트',
          ownerId: ownerIdRef.current ?? undefined,
        }
      : null;

    if (newProject) {
      effectiveProjectId = newProject.id;
    }

    const tasksWithProject = newTasks.map((t) => ({ ...t, projectId: effectiveProjectId }));

    // 로컬이 SSOT: UI 상태를 즉시 반영 (DB 동기화는 수동 버튼에서)
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
  }, [saveHistory, recordDeletedTaskIds]);

  const deleteAllTasks = useCallback(() => {
    saveHistory();
    const effectiveProjectId = currentProjectIdRef.current === 'all' ? '' : currentProjectIdRef.current;
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
      return effectiveProjectId ? prev.filter(t => t.projectId !== effectiveProjectId) : [];
    });
  }, [saveHistory, recordDeletedTaskIds]);

  const deleteAllTasksInAllProjects = useCallback(() => {
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
  }, [saveHistory, recordDeletedTaskIds]);

  const resetAllProjectsToNew = useCallback(async (): Promise<void> => {
    // 전체 프로젝트를 제거하고 '새 프로젝트'로 리셋 (명시적 사용자 액션)
    const newProject: Project = { id: uuidv4(), name: '새 프로젝트', ownerId: ownerIdRef.current };
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

    // DB 동기화는 수동 버튼에서 처리
  }, [saveHistory, recordDeletedTaskIds]);

  // ─── 백업 ─────────────────────────────────────────────────────────────────

  const restoreBackup = useCallback((data: BackupData) => {
    bumpDirty();
    const projectIds = Array.from(new Set(data.tasks.map(t => t.projectId))).filter(Boolean) as string[];
    let rolled = data.tasks;
    for (const pid of projectIds) rolled = recomputeProjectRollups(rolled, pid);
    setProjects(data.projects);
    setAllTasks(rolled);
    setWbsSettings(parseSettings(data.settings));
    if (data.projects.length > 0) {
      if (!data.projects.find(p => p.id === currentProjectIdRef.current)) setCurrentProjectId(data.projects[0].id);
    } else setCurrentProjectId('');
    // DB 동기화는 수동 버튼에서 처리
  }, [bumpDirty]);

  const exportFullBackup = useCallback((): BackupData => ({
    version: '1.0', projects: projectsRef.current, tasks: allTasksRef.current, settings: wbsSettingsRef.current, exportDate: new Date().toISOString(),
  }), []);

  const mergeBackups = useCallback((backups: BackupData[]): { addedProjects: number; addedTasks: number } => {
    bumpDirty();
    const newProjects: Project[] = [];
    const newTasks: Task[] = [];
    const currentOwnerId = ownerIdRef.current;
    const statusConfigs = wbsSettingsRef.current.statusConfigs;
    for (const backup of backups) {
      const projectIdMap = new Map<string, string>();
      for (const project of backup.projects) {
        const newId = uuidv4(); projectIdMap.set(project.id, newId); newProjects.push({ ...project, id: newId, ownerId: currentOwnerId ?? project.ownerId });
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
      const rolled = applyRollupsToTasks([...prev, ...newTasks], statusConfigs);
      return rolled;
    });
    if (newProjects.length > 0) setCurrentProjectId(newProjects[0].id);
    return { addedProjects: newProjects.length, addedTasks: newTasks.length };
  }, [bumpDirty]);

  const canEditCurrentProject =
    editableProjectIds === undefined ||
    !currentProjectId ||
    currentProjectId === 'all' ||
    editableProjectIds.includes(currentProjectId);

  const contextValue = React.useMemo(() => ({
    allTasks,
    tasks,
    projects,
    editableProjectIds,
    canEditCurrentProject,
    currentProjectId,
    setCurrentProjectId,
    selectedTaskIds,
    setSelectedTaskIds,
    wbsSettings,
    updateWbsSettings,
    syncProgressFromStatusConfigs,
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
    hasLocalChangesSinceSync,
    syncWithDb: stableSyncWithDb,
    pushChangesToDb,
    collabPushNonce,
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
  }), [
    allTasks, tasks, projects, editableProjectIds, canEditCurrentProject,
    currentProjectId, setCurrentProjectId, selectedTaskIds, setSelectedTaskIds,
    wbsSettings, updateWbsSettings, syncProgressFromStatusConfigs,
    treeExpandLevel, setTreeExpandLevel,
    addProject, updateProject, deleteProject, copyProject,
    addTask, addTasks, updateTask, updateTasksBulk,
    deleteTask, moveTask, reorderTask, indentTask, outdentTask, indentTasks, outdentTasks,
    toggleExpand, expandToLevel, importTasks,
    deletedTaskIdsByProject, hasLocalChangesSinceSync, stableSyncWithDb, pushChangesToDb, collabPushNonce,
    deleteAllTasks, deleteAllTasksInAllProjects, resetAllProjectsToNew,
    wbsMap, displayWbsMap, restoreBackup, mergeBackups, exportFullBackup,
    undo, canUndo, redo, canRedo,
    setBaselineForTasks, setBaselineForAllTasks, renameAssignee, refreshProjectSchedule, fixOverload,
    isLoading,
  ]);

  return (
    <WBSContext.Provider value={contextValue}>
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
