import type { Project, Task } from '../types';

/**
 * 로그인 우회(미리보기) 모드에서 로컬에 데이터가 없을 때 채워 넣는 샘플 데이터.
 * 표(트리·계획/진척/차이·가중치)와 대시보드(카드·전체현황)를 한눈에 검증할 수 있게 구성.
 * 결정적(고정 id·날짜)이라 새로고침해도 동일하게 재현된다.
 */
export function buildDevSeed(ownerId: string): { projects: Project[]; tasks: Task[] } {
  const pidA = 'dev-proj-a';
  const pidB = 'dev-proj-b';

  const projects: Project[] = [
    {
      id: pidA,
      name: '샘플 프로젝트 A',
      projectKind: '내부',
      ownerId,
      includeInDashboard: true,
      pmName: '홍길동',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      assignments: [
        { assignee: '홍길동', allocationPercent: 100 },
        { assignee: '김철수', allocationPercent: 50 },
      ],
    },
    {
      id: pidB,
      name: '샘플 프로젝트 B',
      projectKind: '연구',
      ownerId,
      includeInDashboard: true,
      pmName: '이영희',
      startDate: '2026-03-01',
      endDate: '2026-09-30',
    },
  ];

  const mk = (o: Partial<Task> & Pick<Task, 'id' | 'parentId' | 'name'>): Task => ({
    projectId: pidA,
    startDate: '2026-04-01',
    endDate: '2026-04-30',
    progress: 0,
    assignee: '홍길동',
    status: 'todo',
    expanded: true,
    ...o,
  });

  const tasks: Task[] = [
    // 프로젝트 A — 2단계 트리(트리 가이드선·인라인 펼침 검증)
    mk({ id: 'a-w1', parentId: null, name: '요구사항 분석', workEffort: 5 }),
    mk({
      id: 'a-w1-1',
      parentId: 'a-w1',
      name: '사용자 인터뷰',
      progress: 100,
      status: 'done',
      startDate: '2026-04-01',
      endDate: '2026-04-05',
      workEffort: 2,
    }),
    mk({
      id: 'a-w1-2',
      parentId: 'a-w1',
      name: '요구사항 문서화',
      startDate: '2026-04-06',
      endDate: '2026-04-14',
      workEffort: 3,
      assignee: '김철수',
    }),
    // 손자 — 계획율 수동지정(계획 80 vs 진척 50 → 차이 -30%p)
    mk({
      id: 'a-w1-2-1',
      parentId: 'a-w1-2',
      name: '초안 작성',
      progress: 50,
      status: 'in-progress',
      startDate: '2026-04-06',
      endDate: '2026-04-10',
      workEffort: 1,
      plannedProgressOverride: 80,
      assignee: '김철수',
    }),
    // 가중치 지정 작업(가중치 ON/OFF 토글 시 상위 평균 변동 검증)
    mk({
      id: 'a-w2',
      parentId: null,
      name: '설계',
      progress: 30,
      status: 'in-progress',
      startDate: '2026-05-01',
      endDate: '2026-05-25',
      workEffort: 8,
      weight: 3,
    }),
    mk({
      id: 'a-w3',
      parentId: null,
      name: '개발',
      progress: 0,
      status: 'todo',
      startDate: '2026-06-01',
      endDate: '2026-08-31',
      workEffort: 20,
      assignee: '이영희',
    }),

    // 프로젝트 B — 대시보드 카드/전체현황 다양화
    mk({
      id: 'b-w1',
      parentId: null,
      projectId: pidB,
      name: '문헌 조사',
      progress: 70,
      status: 'in-progress',
      startDate: '2026-03-01',
      endDate: '2026-04-30',
      workEffort: 6,
      assignee: '이영희',
    }),
    mk({
      id: 'b-w2',
      parentId: null,
      projectId: pidB,
      name: '실험 설계',
      progress: 20,
      status: 'in-progress',
      startDate: '2026-05-01',
      endDate: '2026-06-30',
      workEffort: 10,
      assignee: '홍길동',
    }),
  ];

  return { projects, tasks };
}
