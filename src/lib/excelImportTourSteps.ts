import type { GuidedTourStep } from './guidedTourSteps';

/** Excel 샘플 양식 다운로드 → 작성 → 가져오기 따라하기 투어 */
export const EXCEL_IMPORT_TOUR_STEPS: GuidedTourStep[] = [
  {
    id: 'intro',
    target: '[data-tourid="tour-more"]',
    title: 'Excel로 WBS 가져오기',
    body: '엑셀 샘플 양식을 받아 작성한 뒤, 앱으로 가져오는 순서를 따라 해 봅니다.\n기존 일정표를 Excel로 정리해 두었다면 같은 방식으로 불러올 수 있어요.',
    mode: 'next',
  },
  {
    id: 'openMenu',
    target: '[data-tourid="tour-more"]',
    title: '더보기(⋮) 메뉴 열기',
    body: '강조된 ⋮ 버튼을 클릭해 메뉴를 여세요.',
    mode: 'action',
  },
  {
    id: 'downloadSample',
    target: '[data-tourid="tour-sample-wbs"]',
    title: '샘플 WBS 양식 다운로드',
    body: '「샘플 WBS 양식」을 클릭하면 wbs_sample_template.xlsx가 저장됩니다.\n노란 헤더(＊)는 WBS·작업명·시작일·종료일·공수·담당자·상태 등 필수 항목이고, 회색 헤더는 선택 입력입니다.',
    mode: 'action',
  },
  {
    id: 'fillExcel',
    target: '[data-tourid="tour-more"]',
    title: '엑셀에서 작성하기',
    body: '다운로드한 파일을 Excel에서 열고 예시 행을 참고해 작업을 입력하세요.\n· WBS: 1, 1.1, 1.2.1처럼 계층 번호\n· 날짜: 2026-01-06 또는 2026년 1월 6일\n· 공수: 1인 1일(MD) 기준\n· 상태: 미완료 / 완료\n작성이 끝나면 「다음」을 눌러 주세요.',
    mode: 'next',
  },
  {
    id: 'openMenuImport',
    target: '[data-tourid="tour-more"]',
    title: '다시 메뉴 열기',
    body: '작성을 마쳤다면 ⋮ 버튼을 다시 클릭해 메뉴를 여세요.',
    mode: 'action',
  },
  {
    id: 'importClick',
    target: '[data-tourid="tour-import"]',
    title: '가져오기 실행',
    body: '「가져오기」를 클릭한 뒤, 작성한 .xlsx 파일을 선택하세요.\n파일 선택 창이 열리면 투어 안내는 잠시 가려질 수 있습니다.',
    mode: 'action',
  },
  {
    id: 'importPreview',
    target: '[data-tourid="tour-import-confirm"]',
    title: '미리보기 확인 후 가져오기',
    body: '엑셀 열이 앱 필드에 잘 매칭되었는지 확인하세요.\n새 프로젝트 이름을 정한 뒤 하단의 「가져오기」를 누르면 작업표가 생성됩니다.',
    mode: 'next',
  },
  {
    id: 'saveDb',
    target: '[data-tourid="tour-save"]',
    title: '서버에 저장',
    body: '가져온 내용은 우선 이 브라우저에만 있습니다.\n우측 하단 「저장」 또는 Ctrl+S로 서버(DB)에 반영하면 팀원도 볼 수 있어요.',
    mode: 'next',
  },
  {
    id: 'finish',
    target: '[data-tourid="tour-more"]',
    title: '잘 하셨어요!',
    body: 'Excel 샘플 → 작성 → 가져오기 흐름을 마쳤습니다.\n⋮ → 「Excel 가져오기 따라하기」로 언제든 다시 볼 수 있어요.',
    mode: 'next',
  },
];

export const EXCEL_IMPORT_TOUR_INDEX = EXCEL_IMPORT_TOUR_STEPS.reduce(
  (acc, s, i) => {
    acc[s.id] = i;
    return acc;
  },
  {} as Record<string, number>,
);
