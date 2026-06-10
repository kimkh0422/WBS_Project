/**
 * 초보자 「따라하기 투어」 단계 정의 — 신규 프로젝트 생성 → 첫 작업 입력 순서.
 *
 * target: 화면 요소를 가리키는 CSS 선택자(data-tourid 앵커).
 * mode:
 *  - 'next'   설명을 읽고 툴팁의 「다음」 버튼으로 진행하는 안내 단계
 *  - 'action' 사용자가 강조된 요소를 실제로 조작해야 하는 단계 —
 *             App.tsx의 투어 상태 머신이 모달 열림·프로젝트 생성·작업 추가를 감지해 자동 진행
 */
export interface GuidedTourStep {
  id: 'intro' | 'newProject' | 'fillName' | 'createProject' | 'addTask' | 'taskTips' | 'finish';
  target: string;
  title: string;
  body: string;
  mode: 'next' | 'action';
}

export const GUIDED_TOUR_STEPS: GuidedTourStep[] = [
  {
    id: 'intro',
    target: '[data-tourid="tour-project"]',
    title: '환영합니다 — 화면 따라하기 투어',
    body: '신규 프로젝트를 만들고 첫 작업을 입력하는 순서를 실제 화면에서 안내합니다.\n여기는 프로젝트 메뉴 — 지금 어떤 프로젝트에서 작업 중인지 보여 주고, 클릭하면 다른 프로젝트로 바꿀 수 있습니다.',
    mode: 'next',
  },
  {
    id: 'newProject',
    target: '[data-tourid="tour-new-project"]',
    title: '새 프로젝트 만들기',
    body: '강조된 「새 프로젝트」 버튼을 직접 클릭해 보세요. 프로젝트 입력 창이 열립니다.',
    mode: 'action',
  },
  {
    id: 'fillName',
    target: '[data-tourid="tour-project-name"]',
    title: '프로젝트 이름 입력',
    body: '가칭(짧은 이름)을 입력하세요. 예: 위성항법\nPM 칸에는 내 이름이 자동으로 들어가 있고, 기간·인원 등 나머지는 나중에 채워도 됩니다.',
    mode: 'next',
  },
  {
    id: 'createProject',
    target: '[data-tourid="tour-project-save"]',
    title: '프로젝트 생성',
    body: '「프로젝트 생성」 버튼을 클릭하세요.\n만들어지면 작업표(표+간트) 화면으로 자동 이동합니다.',
    mode: 'action',
  },
  {
    id: 'addTask',
    target: '[data-tourid="tour-quick-add"]',
    title: '첫 작업 입력',
    body: '표 맨 아래 강조된 입력란을 클릭해 작업명을 쓰고 Enter를 누르세요.\n예: 요구사항 분석',
    mode: 'action',
  },
  {
    id: 'taskTips',
    target: '[data-tourid="tour-quick-add"]',
    title: '작업을 빠르게 늘리는 요령',
    body: '행을 선택한 상태에서:\n· Enter — 아래에 새 작업 추가\n· Tab / Shift+Tab — 하위 / 상위 레벨로 이동 (1.1처럼 번호 자동 부여)\n· 더블클릭 또는 F2 — 기간·담당자·진척률 등 상세 편집',
    mode: 'next',
  },
  {
    id: 'finish',
    target: '[data-tourid="tour-more"]',
    title: '잘 하셨어요!',
    body: '이 ⋮(더보기) 메뉴에 사용 설명서·가져오기/보내기·환경설정이 모여 있습니다.\n투어는 ⋮ → 「따라하기 투어」로 언제든 다시 볼 수 있어요.',
    mode: 'next',
  },
];

/** 단계 id → 인덱스. App.tsx 상태 머신에서 단계 비교에 사용 */
export const TOUR_INDEX = GUIDED_TOUR_STEPS.reduce(
  (acc, s, i) => {
    acc[s.id] = i;
    return acc;
  },
  {} as Record<GuidedTourStep['id'], number>,
);
