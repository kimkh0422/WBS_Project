export type TaskStatus = 'todo' | 'in-progress' | 'done' | 'blocked';

export type SortConfig = {
  key: keyof Task;
  direction: 'asc' | 'desc';
} | null;

export interface Project {
  id: string;
  name: string;
  description?: string;
  startDate?: string; // ISO string (YYYY-MM-DD)
}

export interface Task {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  startDate: string; // ISO string
  endDate: string; // ISO string
  progress: number; // 0-100
  assignee: string;
  status: TaskStatus;
  expanded?: boolean; // UI state for tree view
  dependencies?: string[]; // Array of predecessor task IDs
  workEffort?: number; // Man-days
  description?: string;
  checklist?: { id: string; text: string; completed: boolean }[];
  deliverables?: string;
}

export interface FilterState {
  status: TaskStatus | 'all';
  assignee: string;
  startDate: string;
  endDate: string;
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
