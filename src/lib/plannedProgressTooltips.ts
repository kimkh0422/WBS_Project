/**
 * 계획율·진척차이 — 네이티브 title·헤더 도움말용 문구 (한 곳에서 관리)
 */

/** 표 헤더·컬럼 설정 등: 계획(%) 열 */
export const PLANNED_PROGRESS_COLUMN_HELP_TEXT = [
  '계획율(%) = 기준일(기본 오늘)에 일정만 적용했을 때 기대되는 진척률입니다.',
  '※ 표에서 직접 입력하는 값이 아닙니다 — 시작일·종료일을 수정하면 자동으로 다시 계산됩니다. (특정 행만 수동 지정: 작업 편집의 「계획율 수동(%)」)',
  '말단 작업: 시작일 0%, 종료일 100%, 그 사이는 영업일(주말·등록 휴일 제외)에서 선형 보간합니다.',
  '리프 보간: (시작~기준일 영업일 수−1) ÷ (시작~종료 영업일 수−1) × 100. 첫 영업일 0%, 마지막 영업일 100%에 맞춥니다.',
  '마일스톤: 기준일이 시점 이후면 100%, 아니면 0%.',
  '베이스라인이 있으면 베이스라인 시작·종료 일정 기준입니다.',
  '요약(하위 있음) 행은 직속 자식 계획율을 진척률과 같은 가중(가중치→없으면 공수)으로 평균합니다.',
].join('\n');

/** 계획율 셀을 편집하려 할 때(더블클릭 등) 띄우는 안내 토스트 */
export const PLANNED_NOT_EDITABLE_TOAST =
  '계획율은 직접 입력하는 값이 아닙니다. 시작일·종료일을 수정하면 자동으로 다시 계산됩니다. (특정 행만 수동 지정은 작업 편집 창의 「계획율 수동(%)」)';

/** 표 헤더·컬럼 설정 등: 차이(%p) 열 */
export const PROGRESS_VARIANCE_COLUMN_HELP_TEXT = [
  '진척차이(%p) = 실제 진척률(%) − 계획율(%). 단위는 퍼센트 포인트(%p)입니다.',
  '양수(+) 계획보다 앞섬, 음수(−) 계획 대비 지연, 0은 일정 대비 일치.',
  '차이가 나는 흔한 이유: 실제 작업 속도가 일정상 균등 진행 가정과 다름, 진척만 바꾸고 일정은 그대로, 베이스라인과 현재 일정의 괴리 등.',
  '요약 행은 계획율과 동일한 영업일·베이스라인·가중 롤업 기준으로 집계합니다.',
].join('\n');

/** 표 데이터 셀 — 계획율 (값 포함) */
export function plannedProgressDataCellTitle(formattedPlanned: string): string {
  return [
    `이 행 계획율 ${formattedPlanned}%.`,
    '오늘(기준일)이 일정 막대상 어디쯤인지(영업일·휴일·베이스라인 반영)를 %로 나타냅니다.',
    '입력한 진척률과는 별도로 일정에서만 계산됩니다. 직접 입력값이 아니며, 시작일·종료일을 수정하면 자동으로 다시 계산됩니다.',
    '대비는 「차이(%p)」열을 보세요.',
  ].join(' ');
}

/** 표 데이터 셀 — 진척차이 (값·부호·라벨 포함) */
export function progressVarianceDataCellTitle(
  signAndVariance: string,
  formattedActual: string,
  formattedPlanned: string,
  situationLabel: string,
): string {
  return [
    `진척차이 ${signAndVariance}%p — ${situationLabel}.`,
    `식: 실제 ${formattedActual}% − 계획 ${formattedPlanned}%.`,
    '%p는 두 비율의 뺄셈(퍼센트 포인트)입니다.',
  ].join(' ');
}

/** 요약 바 — 전체 계획율 칩 */
export const SUMMARY_BAR_PLANNED_HINT =
  '전체 계획율: 오늘 일정만 보면 기대되는 가중 평균 진척률입니다. 영업일·휴일·베이스라인을 반영하고, 「전체 진척율」과 동일한 집계 대상·가중(가중치→공수)을 씁니다. 말단은 (시작~오늘 영업일−1)/(시작~종료 영업일−1)×100에 가깝게 선형 보간됩니다.';

/** 요약 바 — 계획대비 칩 (숫자 삽입은 호출부에서) */
export function summaryBarVarianceHint(
  formattedProgress: string,
  formattedPlanned: string,
  signAndVariance: string,
  situationLabel: string,
): string {
  return [
    `전체 진척 ${formattedProgress}% − 전체 계획 ${formattedPlanned}% = ${signAndVariance}%p (${situationLabel}).`,
    '진척은 입력·롤업 값, 계획율은 날짜 기준이라 둘이 어긋날 수 있습니다.',
  ].join(' ');
}

/** 대시보드 프로젝트 카드 — 계획·차이 한 줄 */
export function dashboardPlannedVarianceRowTitle(
  formattedProgress: string,
  formattedPlanned: string,
  signAndVariance: string,
  situationLabel: string,
): string {
  return [
    `진척 ${formattedProgress}% · 계획 ${formattedPlanned}% · 차이 ${signAndVariance}%p (${situationLabel}).`,
    '계획율은 WBS 1레벨(없으면 말단) 가중 평균으로, 오늘 일정상 기대 진척입니다.',
    '차이(%p)=진척−계획. 실제 속도·진척만 수정·베이스라인 일정 등으로 어긋날 수 있습니다.',
  ].join(' ');
}
