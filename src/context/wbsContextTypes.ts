import { Task, Project } from '../types';
import { BackupData } from '../lib/export';
import { WBSSettings } from '../lib/wbsSettings';
import { type WorkloadDay } from '../lib/workload';

/** Supabase Realtime postgres_changes 콜백 페이로드 */
export interface RealtimeChangePayload {
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
  uploadedProjects: number;
  skippedUploadProjects: number;
  uploadedTasks: number;
  skippedUploadTasks: number;
  uploadedSettings: boolean;
  skippedUploadSettings: boolean;
  uploadedTaskDeletions: number;
  uploadedProjectDeletions: number;
  downloadedProjects: number;
  downloadedTasks: number;
  downloadedSettings: boolean;
  appliedProjectsFromServer: number;
  appliedTasksFromServer: number;
  byProject: Record<string, DbSyncSummaryByProject>;
};

export interface WBSContextType {
  allTasks: Task[];
  tasks: Task[];
  projects: Project[];
  /** 편집 가능한 프로젝트 ID 목록. 없으면 모두 편집 가능(기존 동작). 보기 전용일 때 이 목록에 없음 */
  editableProjectIds?: string[];
  /** 시스템 관리자 여부 (관리자 비밀번호 임시 진입 포함) */
  isAdmin: boolean;
  /** 현재 선택된 프로젝트에 편집 권한이 있는지. 본인이 만든 프로젝트(소유자)이거나 관리자일 때만 true */
  canEditCurrentProject: boolean;
  currentProjectId: string;
  setCurrentProjectId: (id: string) => void;
  selectedTaskIds: string[];
  setSelectedTaskIds: (ids: string[]) => void;
  /** 표↔간트 시각 강조 동기화용 단일 활성 행. 체크박스(selectedTaskIds)와는 별도. */
  activeTaskId: string | null;
  setActiveTaskId: (id: string | null) => void;
  wbsSettings: WBSSettings;
  updateWbsSettings: (settings: Partial<WBSSettings>) => void;
  /** 상태 명칭·진척도 설정을 기준으로 작업 진척도를 일괄 동기화 */
  syncProgressFromStatusConfigs: (scope: 'current' | 'all') => void;
  treeExpandLevel: number;
  setTreeExpandLevel: (level: number) => void;
  addProject: (
    name: string,
    description?: string,
    startDate?: string,
    endDate?: string,
    assignments?: Project['assignments'],
    minWorkEffortDays?: number,
    reportExtras?: Partial<
      Pick<Project, 'reportCategory' | 'reportAgency' | 'reportBudgetThisYear' | 'reportTotalPeriod' | 'reportNameShort' | 'reportNameFull'>
    >,
  ) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  /** 프로젝트와 소속 작업을 복사해 새 프로젝트로 만들고 현재 사용자 소유로 설정 */
  copyProject: (sourceProjectId: string) => void;
  addTask: (task: Omit<Task, 'id' | 'projectId'>, insertAfterId?: string, projectIdOverride?: string) => string;
  addTasks: (tasks: Task[]) => void;
  updateTask: (id: string, updates: Partial<Task>, options?: { skipCascade?: boolean }) => void;
  /** 여러 작업에 동일한 수정 일괄 적용 (일정 변경 없을 때만 사용, 충돌 방지) */
  updateTasksBulk: (taskIds: string[], updates: Partial<Task>) => void;
  /** 화면 순서대로 선행작업 체인 연결 (각 작업의 선행은 목록에서 바로 위 작업만) */
  linkSequentialPredecessors: (orderedTaskIds: string[]) => void;
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
  /** 로컬에서 삭제된 작업 id 로그(삭제 반영용) */
  deletedTaskIdsByProject: Record<string, string[]>;
  /** 사용자가 WBS(프로젝트/작업)를 수정한 뒤 아직 동기화하지 않은 상태. 동기화 성공 시 false로 초기화. */
  hasLocalChangesSinceSync: boolean;
  /** 로컬 ↔ DB(Supabase) 동기화: 업로드 후 서버 최신을 다시 불러와 로컬과 맞춤. onProgress로 0–99% 진행 알림. */
  syncWithDb: (
    scope: 'current' | 'all',
    onProgress?: (percent: number, message: string) => void,
    opts?: { pullAfter?: boolean },
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
