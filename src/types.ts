export type TaskStatus = string;

export type SortConfig = {
  key: keyof Task | 'wbs';
  direction: 'asc' | 'desc';
} | null;

/** 프로젝트별 투입인원·투입비율. 작업의 기간/공수 계산에 사용 */
export interface ProjectAssignment {
  assignee: string;
  allocationPercent: number;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  startDate?: string; // ISO string (YYYY-MM-DD)
  /** 프로젝트별 투입인원·투입비율. 이 프로젝트 소속 작업의 기간·공수 계산에 적용 */
  assignments?: ProjectAssignment[];
}

/** 투입인원 1명: 담당자 + 투입비율(0~100%) */
export interface TaskAssignment {
  assignee: string;
  allocationPercent: number; // 10, 20, 30, ... 100
}

export interface Task {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  startDate: string; // ISO string
  endDate: string; // ISO string
  progress: number; // 0-100
  assignee: string; // 단일 담당자(하위호환) 또는 대표 표시용
  status: TaskStatus;
  expanded?: boolean; // UI state for tree view
  dependencies?: string[]; // Array of predecessor task IDs
  workEffort?: number; // Man-days (작업 공수)
  /** 투입인원별 담당자·투입비율. 있으면 이 값으로 투입공수·기간 계산에 사용 */
  assignments?: TaskAssignment[];
  description?: string;
  checklist?: { id: string; text: string; completed: boolean }[];
  deliverables?: string;
  /** 서버 갱신 시각(ISO). 동시 수정 감지(낙관적 잠금)용 */
  updatedAt?: string;
  /** 마일스톤 여부. true면 일정 상 하나의 시점(이정표)으로 표시 */
  isMilestone?: boolean;
  /** 베이스라인 시작일. 설정 시 해당 작업의 기준 일정으로 사용 */
  baselineStartDate?: string;
  /** 베이스라인 종료일 */
  baselineEndDate?: string;
  /** 베이스라인 공수(일) */
  baselineWorkEffort?: number;
  /** 사용자가 수동 수정한 항목. AI 업데이트 시 이 필드들은 덮어쓰지 않음 */
  userLockedFields?: ('dependencies' | 'startDate' | 'endDate' | 'workEffort')[];
}

export interface FilterState {
  projectId: string; // 'all' or specific project id
  status: TaskStatus | 'all';
  assignee: string;
  startDate: string;
  endDate: string;
  /** true면 마일스톤 작업만 표시 */
  milestoneOnly?: boolean;
}

export const MOCK_PROJECTS: Project[] = [
  {
    id: 'p1',
    name: '알파 프로토콜',
    description: '차세대 위성 항법 시스템 개발 프로젝트',
    startDate: '2026-03-01'
  }
];

export const MOCK_TASKS: Task[] = [
  {
    id: '1',
    projectId: 'p1',
    parentId: null,
    name: '프로젝트 알파',
    startDate: '2026-03-01',
    endDate: '2026-05-31',
    progress: 45,
    assignee: '관리자',
    status: 'in-progress',
    expanded: true,
    workEffort: 60,
  },
  {
    id: '1-1',
    projectId: 'p1',
    parentId: '1',
    name: '1단계: 기획',
    startDate: '2026-03-01',
    endDate: '2026-03-15',
    progress: 100,
    assignee: '팀장',
    status: 'done',
    expanded: true,
    workEffort: 10,
  },
  {
    id: '1-1-1',
    projectId: 'p1',
    parentId: '1-1',
    name: '요구사항 수집',
    startDate: '2026-03-01',
    endDate: '2026-03-07',
    progress: 100,
    assignee: '김철수',
    status: 'done',
    workEffort: 5,
  },
  {
    id: '1-1-2',
    projectId: 'p1',
    parentId: '1-1',
    name: '타당성 조사',
    startDate: '2026-03-08',
    endDate: '2026-03-15',
    progress: 100,
    assignee: '이영희',
    status: 'done',
    dependencies: ['1-1-1'],
    workEffort: 5,
  },
  {
    id: '1-2',
    projectId: 'p1',
    parentId: '1',
    name: '2단계: 개발',
    startDate: '2026-03-16',
    endDate: '2026-05-15',
    progress: 30,
    assignee: '개발팀',
    status: 'in-progress',
    expanded: true,
    dependencies: ['1-1'],
    workEffort: 40,
  },
  {
    id: '1-2-1',
    projectId: 'p1',
    parentId: '1-2',
    name: '백엔드 API 설정',
    startDate: '2026-03-16',
    endDate: '2026-04-15',
    progress: 60,
    assignee: '박민수',
    status: 'in-progress',
    workEffort: 20,
  },
  {
    id: '1-2-2',
    projectId: 'p1',
    parentId: '1-2',
    name: '프론트엔드 UI 구현',
    startDate: '2026-04-01',
    endDate: '2026-05-15',
    progress: 10,
    assignee: '최지우',
    status: 'todo',
    dependencies: ['1-2-1'],
    workEffort: 20,
  },
];
