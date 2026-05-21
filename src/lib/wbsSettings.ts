export interface StatusConfig {
  id: string;
  name: string;
  progress: number;
  color?: string;
}

/** 프로젝트 그룹(폴더) 정의. 1단계 평탄, 한 프로젝트는 한 그룹에 속한다. */
export interface ProjectGroup {
  id: string;
  name: string;
  /** 정렬 순서 (낮은 값이 먼저). 동일 값이면 name 가나다순 */
  sortOrder?: number;
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
  /**
   * true: 시작일·종료일·공수 중 하나를 바꿀 때 나머지 일정 필드를 공수·투입률 기준으로 자동 보정(기존 동작).
   * false(기본): 시작일·종료일·공수는 각각 독립 저장. 간트/선행 재계산 시에도 공수로 종료일을 덮어쓰지 않음.
   */
  linkEffortToSchedule?: boolean;
  tableColumns?: { id: string; visible: boolean }[];
  /** 예전 설정 호환용. 항상 false로 읽히며 UI에서 변경 불가 */
  showCriticalPath?: boolean;
  /** 셀 텍스트 줄바꿈(저장값·기본 false). 설정 UI는 없음 */
  wrapTextInCells?: boolean;
  /** 표 컬럼 너비(px). 사용자가 조절한 값 저장 */
  columnWidths?: Record<string, number>;
  /**
   * true: 표만 뷰 진입·프로젝트/필터 변경 시 암묵적 일괄 자동 맞춤을 하지 않음(컬럼 드래그·헤더 더블클릭으로 너비를 확정한 경우).
   * false/미설정: 표만 뷰에서 암묵적 자동 맞춤 허용. 요약 바「자동 맞춤」으로 false로 되돌릴 수 있음.
   */
  skipImplicitTableColumnAutoFit?: boolean;
  /** 투입율 컬럼 기본 숨김 마이그레이션 완료 여부 */
  allocationHiddenMigrated?: boolean;
  /** 관심(즐겨찾기) 프로젝트 ID 목록. DB 동기화되어 다른 기기에서도 유지 */
  favoriteProjectIds?: string[];
  /** 사용자 정의 프로젝트 그룹 목록. 1단계 평탄. 관리자만 CRUD */
  projectGroups?: ProjectGroup[];
  /** 사용자 정의 표 컬럼 정의 */
  customColumns?: Array<{ id: string; name: string }>;
  /**
   * true: 작업표에서 작업명 컬럼에 표시용 WBS ID를 접두로 붙임(예: "P1 요구사항 정의").
   * WBS ID 컬럼 표기는 그대로이며, 저장되는 작업명(task.name)은 바뀌지 않음.
   */
  prependDisplayWbsToTaskName?: boolean;
}

export const DEFAULT_STATUS_CONFIGS: StatusConfig[] = [
  { id: 'todo', name: '할 일', progress: 0, color: 'bg-stone-100 border-stone-200' },
  { id: 'in-progress', name: '진행 중', progress: 10, color: 'bg-blue-50 border-blue-100' },
  { id: 'blocked', name: '지연됨', progress: 50, color: 'bg-red-50 border-red-100' },
  { id: 'done', name: '완료', progress: 100, color: 'bg-green-50 border-green-100' },
];

export const DEFAULT_SETTINGS: WBSSettings = {
  appTitle: '지엠티 스마트시트',
  level1Prefix: 'W',
  level2Prefix: 'W',
  level3Prefix: 'T',
  maxLevel: 4,
  statusConfigs: DEFAULT_STATUS_CONFIGS,
  linkStatusAndProgress: true,
  linkEffortToSchedule: false,
  tableColumns: [
    { id: 'wbsId', visible: true },
    { id: 'name', visible: true },
    { id: 'startDate', visible: true },
    { id: 'endDate', visible: true },
    { id: 'workEffort', visible: true },
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

/** raw 저장값(문자열 또는 객체)을 WBSSettings로 파싱. 구버전 포맷(statusNames/statusProgress) 호환 포함. */
export function parseSettings(raw: unknown): WBSSettings {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<WBSSettings> & {
      statusNames?: Record<string, string>;
      statusProgress?: Record<string, number>;
    };
    let statusConfigs = parsed.statusConfigs;
    if (!statusConfigs && (parsed.statusNames || parsed.statusProgress)) {
      statusConfigs = (['todo', 'in-progress', 'blocked', 'done'] as const).map((id) => ({
        id,
        name:
          parsed.statusNames?.[id] || (id === 'todo' ? '할 일' : id === 'in-progress' ? '진행 중' : id === 'blocked' ? '지연됨' : '완료'),
        progress:
          parsed.statusProgress?.[id] !== undefined
            ? parsed.statusProgress[id]
            : id === 'todo'
              ? 0
              : id === 'in-progress'
                ? 10
                : id === 'blocked'
                  ? 50
                  : 100,
        color:
          id === 'todo'
            ? 'bg-stone-100 border-stone-200'
            : id === 'in-progress'
              ? 'bg-blue-50 border-blue-100'
              : id === 'blocked'
                ? 'bg-red-50 border-red-100'
                : 'bg-green-50 border-green-100',
      }));
    }
    const base: WBSSettings = {
      ...DEFAULT_SETTINGS,
      ...parsed,
      // 사용자가 직접 변경한 적 없는(=옛 default 그대로) 값은 새 default로 자동 마이그레이션
      appTitle: parsed.appTitle && parsed.appTitle !== '지엠티 프로젝트 매니저' ? parsed.appTitle : DEFAULT_SETTINGS.appTitle,
      statusConfigs: statusConfigs || DEFAULT_STATUS_CONFIGS,
      tableColumns:
        Array.isArray(parsed.tableColumns) && parsed.tableColumns.length > 0
          ? parsed.tableColumns
              .filter((c) => c && typeof c.id === 'string')
              .map((c) => ({ id: String(c.id), visible: c.visible !== false }))
          : DEFAULT_SETTINGS.tableColumns,
      // 크리티컬 패스 강조는 제거됨: 저장값과 무관하게 항상 끔
      showCriticalPath: false,
      wrapTextInCells: parsed.wrapTextInCells === true,
      linkStatusAndProgress: parsed.linkStatusAndProgress === false ? false : true,
      linkEffortToSchedule: parsed.linkEffortToSchedule === true,
      prependDisplayWbsToTaskName: parsed.prependDisplayWbsToTaskName === true,
    };

    // 투입율 컬럼 기본 숨김 마이그레이션 (이전 버전 설정용, 1회만 적용)
    if (!parsed.allocationHiddenMigrated) {
      const cols = Array.isArray(base.tableColumns) ? base.tableColumns : [];
      base.tableColumns = cols.map((c) => (c && c.id === 'allocation' ? { ...c, visible: false } : c));
      base.allocationHiddenMigrated = true;
    }

    // 컬럼 너비 저장은 예전부터 있었으나 암묵적 자동맞춤 플래그는 이번에 추가됨 → 기존 저장이 있으면 덮어쓰지 않도록 기본 잠금
    if (typeof parsed.skipImplicitTableColumnAutoFit === 'boolean') {
      base.skipImplicitTableColumnAutoFit = parsed.skipImplicitTableColumnAutoFit;
    } else {
      const cw = base.columnWidths;
      base.skipImplicitTableColumnAutoFit = !!(cw && typeof cw === 'object' && Object.keys(cw).length > 0);
    }

    return base;
  } catch {
    return DEFAULT_SETTINGS;
  }
}
