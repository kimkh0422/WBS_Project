import * as XLSX from 'xlsx';
import type { Cell as ExcelCell, Font as ExcelFont } from 'exceljs';
import { differenceInBusinessDays, parseISO, isValid } from 'date-fns';
import { Task, TaskStatus, Project, type CellTextStyle } from '../types';
import { randomUUID, round2, formatPercent1, formatNum1 } from './utils';
import { formatAssigneeDisplay, type PersonDisplayMeta } from './assigneeOptions';
import { formatProjectDisplayName } from './projectKind';
import { computePlannedProgressMap } from './plannedProgress';

// Map internal keys to Korean headers
const HEADER_MAP: Record<string, string> = {
  wbsId: 'WBS번호',
  level: '레벨',
  id: '시스템ID',
  parentId: '상위작업ID',
  name: '작업명',
  startDate: '시작일',
  endDate: '종료일',
  progress: '진행률',
  assignee: '담당자',
  status: '상태',
  dependencies: '선행작업',
  workEffort: '작업공수',
  deliverables: '산출물',
};

type HeaderToKey = keyof Task | 'wbsId' | 'level';
const REVERSE_HEADER_MAP: Record<string, HeaderToKey> = Object.entries(HEADER_MAP).reduce(
  (acc, [key, value]) => ({ ...acc, [value]: key as HeaderToKey }),
  {} as Record<string, HeaderToKey>,
);
// WBS/레벨 컬럼의 다른 표기 인식 (정규 포맷에서 미매칭 방지)
const WBS_HEADER_ALIASES = ['WBS번호', 'WBS', 'WBS코드', 'WBS ID', 'WBS code', 'WBS Code'];
const LEVEL_HEADER_ALIASES = ['레벨', 'Level', 'Lvl', '단계', 'LV'];
[
  ['WBS', 'wbsId'],
  ['WBS코드', 'wbsId'],
  ['WBS ID', 'wbsId'],
  ['WBS code', 'wbsId'],
  ['WBS Code', 'wbsId'],
  ['Level', 'level'],
  ['Lvl', 'level'],
  ['단계', 'level'],
  ['LV', 'level'],
].forEach(([h, k]) => {
  if (!REVERSE_HEADER_MAP[h as string]) REVERSE_HEADER_MAP[h as string] = k as HeaderToKey;
});

const normalizeHeader = (s: unknown) =>
  String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()【】\[\]{}]/g, '')
    .replace(/[*·:]/g, '');

const toIsoDate = (val: unknown): string | '' => {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') {
    const s = val.trim();
    // Already ISO-ish
    const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (iso) {
      const y = iso[1];
      const m = iso[2].padStart(2, '0');
      const d = iso[3].padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return '';
  }
  if (typeof val === 'number' && Number.isFinite(val)) {
    // Excel date serial
    const ssf = (XLSX as unknown as { SSF?: { parse_date_code?: (v: number) => { y: number; m: number; d: number } | null } }).SSF;
    if (ssf?.parse_date_code) {
      const parsed = ssf.parse_date_code(val);
      if (!parsed) return '';
      const y = String(parsed.y).padStart(4, '0');
      const m = String(parsed.m).padStart(2, '0');
      const d = String(parsed.d).padStart(2, '0');
      if (parsed.y && parsed.m && parsed.d) return `${y}-${m}-${d}`;
      return '';
    }

    // Fallback: convert using Excel serial day count (1900 date system, with the 1900 leap-year bug baked in).
    // 25569 = days between 1899-12-30 and 1970-01-01.
    const ms = Math.round((val - 25569) * 86400 * 1000);
    const dt = new Date(ms);
    if (!Number.isFinite(dt.getTime())) return '';
    const y = String(dt.getUTCFullYear()).padStart(4, '0');
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return '';
};

const toNumber = (val: unknown): number | undefined => {
  if (val === null || val === undefined) return undefined;
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  const s = String(val).trim();
  if (!s) return undefined;
  // "80%" -> 80
  const pct = s.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (pct) return Number(pct[1]);
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
};

const estimateWorkEffortFromDates = (startIso: string, endIso: string): number | undefined => {
  const s = String(startIso ?? '').trim();
  const e = String(endIso ?? '').trim();
  if (!s || !e) return undefined;
  const sd = parseISO(s);
  const ed = parseISO(e);
  if (!isValid(sd) || !isValid(ed)) return undefined;

  const start = sd <= ed ? sd : ed;
  const end = sd <= ed ? ed : sd;

  // 불러오기 시 내용 변경 없이: 주말만 제외(공휴일 미반영), 원본 기간 기준 공수 추정
  const days = differenceInBusinessDays(end, start) + 1;
  if (!Number.isFinite(days) || days <= 0) return 1;
  return Math.max(0.5, Math.round(days * 10) / 10);
};

const parseStatus = (val: unknown): TaskStatus | '' => {
  const s = normalizeHeader(val);
  if (!s) return '';
  if (['todo', '할일', '할일', '대기', '미착수', 'notstarted', 'open'].includes(s)) return 'todo';
  if (['in-progress', 'inprogress', '진행', '진행중', '진행중', 'doing', 'wip'].includes(s)) return 'in-progress';
  if (['done', '완료', '종료', 'closed', 'finish', 'finished'].includes(s)) return 'done';
  if (['blocked', '지연', '지연됨', '중단', '막힘', 'hold'].includes(s)) return 'blocked';
  return '';
};

const inferStatusFromProgress = (p: number): TaskStatus => {
  if (!Number.isFinite(p) || p <= 0) return 'todo';
  if (p >= 99.5) return 'done';
  return 'in-progress';
};

const normalizeWbsKey = (val: unknown): string => {
  if (val === null || val === undefined) return '';
  // 숫자로 읽힌 경우(예: 1.21) 복원 불가하므로 문자열로만 처리. 점(.) 보존
  const raw = String(val).trim();
  if (!raw) return '';
  // keep dots for hierarchy, remove spaces
  const s = raw.replace(/\s+/g, '');
  // common formats: "1.2.3", "W1.2", "T1.1.3", "1-2-3"
  return s.replace(/-/g, '.');
};

const guessColumnIndex = (headers: string[], candidates: string[]) => {
  const normalized = headers.map(normalizeHeader);
  const normCandidates = candidates.map(normalizeHeader).filter(Boolean);

  // 1) Exact match
  for (const c of normCandidates) {
    const idx = normalized.indexOf(c);
    if (idx !== -1) return idx;
  }

  // 2) Fuzzy match (contains)
  for (const c of normCandidates) {
    if (c.length < 2) continue;
    for (let i = 0; i < normalized.length; i++) {
      const h = normalized[i];
      if (!h) continue;
      if (h.includes(c) || c.includes(h)) return i;
    }
  }

  return -1;
};

const fillMergedHeaders = (headers: string[]) => {
  const out = [...headers];
  for (let i = 1; i < out.length; i++) {
    if (!String(out[i] ?? '').trim() && String(out[i - 1] ?? '').trim()) {
      out[i] = out[i - 1];
    }
  }
  return out;
};

const adjustIndexForMergedHeader = (rows: unknown[][], headers: string[], idx: number) => {
  if (idx < 0) return idx;
  const target = normalizeHeader(headers[idx]);
  if (!target) return idx;

  const sample = rows.slice(0, Math.min(60, rows.length));
  const nonEmptyCount = (col: number) => {
    if (col < 0) return 0;
    let c = 0;
    for (const r of sample) {
      const v = Array.isArray(r) ? r[col] : undefined;
      if (String(v ?? '').trim()) c += 1;
    }
    return c;
  };

  const here = nonEmptyCount(idx);
  const right = idx + 1 < headers.length && normalizeHeader(headers[idx + 1]) === target ? nonEmptyCount(idx + 1) : -1;
  const left = idx - 1 >= 0 && normalizeHeader(headers[idx - 1]) === target ? nonEmptyCount(idx - 1) : -1;

  // If adjacent column under the same (merged) header has far more values, use it.
  if (right >= 0 && right > here * 2) return idx + 1;
  if (left >= 0 && left > here * 2) return idx - 1;
  return idx;
};

// 단일 컬럼 매칭(점수 채점·smart parse 공용) — 일반 단어는 fuzzy 오매칭 위험이 있어 보수적으로 유지
const NAME_CANDIDATES = [
  '작업명',
  '작업*',
  '작업',
  '업무',
  'task',
  'taskname',
  'name',
  '제목',
  'title',
  '활동명',
  'wbs활동명',
  '업무명',
  '프로그램명',
];
const WBS_CANDIDATES = ['wbs번호', 'wbs', 'wbsid', 'wbs코드', 'wbs code', 'WBS'];
const LEVEL_CANDIDATES = ['레벨', 'level', 'lvl', '단계', 'lv'];
const START_CANDIDATES = ['시작일', '시작일*', '시작', 'start', 'startdate', 'from', '계획시작일', '실제시작일'];
const END_CANDIDATES = ['종료일', '완료일', '완료일*', '종료', 'end', 'enddate', 'to', 'finish', 'finishdate', '계획종료일', '실제종료일'];
const ASSIGNEE_CANDIDATES = ['담당자', '담당', 'assignee', 'owner', '담당부서', '부서', '담당기관', '자원', '개발자'];
// 진척률: '실적진척률'을 가장 먼저(가장 구체적). 단어 '실적'만 있는 컬럼이 가중치/누적 계산용으로 따로
// 존재하는 템플릿(eNav 등)에서 우측 가짜 '실적' 컬럼을 잡지 않도록 '실적*'/'실적'은 뒤로 보낸다.
// '계획진척률'은 실적 미매칭 시 폴백.
const PROGRESS_CANDIDATES = [
  '실적진척률',
  '%workcomplete',
  '진행률',
  '진행',
  '진척률',
  '진척율',
  'progress',
  'percent',
  '%',
  '실적*',
  '실적',
  '계획진척률',
];
const STATUS_CANDIDATES = ['상태', 'status', '진행상태', 'state'];
const EFFORT_CANDIDATES = [
  '작업공수',
  '공수',
  'effort',
  '총작업량',
  '작업량',
  'man/day',
  'man-day',
  'man day',
  'manday',
  'md',
  'duration',
  '기간',
];
const DELIVERABLES_CANDIDATES = ['산출물', 'deliverable', 'deliverables', 'output', '결과물'];
const DESCRIPTION_CANDIDATES = ['비고', '설명', 'note', 'notes', 'comment', 'remarks', 'remark'];

// 트리(레벨별 다중 컬럼) 인식용 추가 후보 — 단계/Activity/Leaf Task 등은 단독 매칭으로는 위험해 트리 인식에서만 사용
const NAME_CANDIDATES_FOR_TREE = [...NAME_CANDIDATES, '단계', 'activity', 'leaftask', 'leaf task'];

const scoreHeaderRow = (headers: string[]) => {
  const nameIdx = guessColumnIndex(headers, NAME_CANDIDATES);
  const wbsIdx = guessColumnIndex(headers, WBS_CANDIDATES);
  const startIdx = guessColumnIndex(headers, START_CANDIDATES);
  const endIdx = guessColumnIndex(headers, END_CANDIDATES);
  const assigneeIdx = guessColumnIndex(headers, ASSIGNEE_CANDIDATES);
  const progressIdx = guessColumnIndex(headers, PROGRESS_CANDIDATES);
  const statusIdx = guessColumnIndex(headers, STATUS_CANDIDATES);
  const effortIdx = guessColumnIndex(headers, EFFORT_CANDIDATES);
  let score = 0;
  if (nameIdx >= 0) score += 6;
  if (wbsIdx >= 0) score += 3;
  if (startIdx >= 0) score += 3;
  if (endIdx >= 0) score += 3;
  if (assigneeIdx >= 0) score += 1;
  if (progressIdx >= 0) score += 1;
  if (statusIdx >= 0) score += 1;
  if (effortIdx >= 0) score += 1;
  return score;
};

// 다중 후보 컬럼 중에서 '실제 텍스트 작업명 컬럼'만 골라낸다.
// - 비어 있거나 숫자만 있는 컬럼(가중치 등) 제거
// - 단일 값(예: ○ 마커만 반복)인 컬럼 제거
const filterTextColumns = (rows: unknown[][], cols: number[]): number[] => {
  if (cols.length <= 1) return cols;
  const sample = rows.slice(0, Math.min(120, rows.length));
  return cols.filter((c) => {
    if (c < 0) return false;
    let textCount = 0;
    let nonEmpty = 0;
    const unique = new Set<string>();
    for (const r of sample) {
      if (!Array.isArray(r)) continue;
      const s = String(r[c] ?? '').trim();
      if (!s) continue;
      nonEmpty += 1;
      unique.add(s);
      if (!Number.isFinite(Number(s))) textCount += 1;
    }
    if (nonEmpty === 0) return false;
    if (unique.size < 2) return false;
    return textCount >= Math.max(1, Math.floor(nonEmpty * 0.5));
  });
};

const pickBestSheetAndHeader = (workbook: XLSX.WorkBook) => {
  let best: { sheetName: string; headerRowIndex: number; score: number; approxRows: number } | null = null;

  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' }) as unknown[][];
    if (!rows || rows.length === 0) continue;

    const scanLimit = Math.min(80, rows.length);
    let sheetBest = { headerRowIndex: 0, score: -1 };
    for (let i = 0; i < scanLimit; i++) {
      const header = (rows[i] ?? []).map((h) => String(h ?? '').trim());
      const s = scoreHeaderRow(header);
      if (s > sheetBest.score) sheetBest = { headerRowIndex: i, score: s };
    }

    const approxRows = rows.length;
    if (!best) {
      best = { sheetName, headerRowIndex: sheetBest.headerRowIndex, score: sheetBest.score, approxRows };
      continue;
    }

    // Prefer higher score; break ties by larger sheet (likely the schedule)
    if (sheetBest.score > best.score || (sheetBest.score === best.score && approxRows > best.approxRows)) {
      best = { sheetName, headerRowIndex: sheetBest.headerRowIndex, score: sheetBest.score, approxRows };
    }
  }

  // Fallback: first sheet
  return best ?? { sheetName: workbook.SheetNames[0], headerRowIndex: 0, score: 0, approxRows: 0 };
};

export type ExcelImportFieldId =
  | 'wbsKey'
  | 'level'
  | 'name'
  | 'startDate'
  | 'endDate'
  | 'assignee'
  | 'progress'
  | 'status'
  | 'workEffort'
  | 'deliverables'
  | 'description';

// 사용자가 미리보기 모달에서 직접 매핑한 결과. number = 컬럼 인덱스, -1 = 매핑 안 함.
export type ExcelImportFieldOverride = Partial<Record<ExcelImportFieldId, number>>;

// 사용자가 미리보기 모달에서 미사용 컬럼을 "사용자 정의 컬럼"으로 추가하기로 한 항목.
// id는 모달이 미리 생성(`custom:<uuid>`), columnIndex는 엑셀 헤더 행의 컬럼 인덱스.
// parseExcelWithMeta는 각 task의 customFields[id]에 해당 셀 값을 채워준다.
export type ExcelImportCustomColumnInput = { id: string; columnIndex: number };

export type ExcelImportMappingItem = {
  fieldId: ExcelImportFieldId;
  fieldLabel: string;
  header: string;
  columnIndex: number; // 0-based
  columnIndices?: number[]; // for multi-column templates (e.g. XLGantt task name)
  note?: string;
};

export type ExcelImportMeta = {
  sheetName: string;
  headerRowIndex: number; // 0-based
  headerRow: string[];
  mode: 'known' | 'smart';
  mapped: ExcelImportMappingItem[];
  unmappedHeaders: { header: string; columnIndex: number }[];
  /**
   * 컬럼(columnIndex 기준)별 대표 예시 값들 — 미리보기에서 "이 컬럼이 맞나?"를 데이터로 확인하기 위함.
   * 표시 서식(raw:false)이 적용된 값을 중복 없이 컬럼당 최대 3개까지 담는다. 비어있는 컬럼은 빈 배열.
   */
  samplesByColumn: string[][];
};

export type ExcelImportParseResult = {
  tasks: Task[];
  meta: ExcelImportMeta;
};

type LevelValue = number | undefined;

const clampLevel = (n: unknown): LevelValue => {
  const v = toNumber(n);
  if (v === undefined) return undefined;
  const lv = Math.floor(v);
  if (!Number.isFinite(lv) || lv < 1) return undefined;
  return lv;
};

const applyLevelHierarchyInOrder = (tasksInOrder: Task[], levelsByTaskId: Map<string, LevelValue>) => {
  // 레벨 기반 계층: 엑셀 행 순서대로 "가장 최근의 상위 레벨"을 parent로 연결
  const lastIdAtLevel = new Map<number, string>();
  for (const t of tasksInOrder) {
    const level = levelsByTaskId.get(t.id);
    if (!level) continue;

    // Find nearest existing parent level (level-1 down to 1)
    let parentId: string | null = null;
    for (let p = level - 1; p >= 1; p--) {
      const pid = lastIdAtLevel.get(p);
      if (pid) {
        parentId = pid;
        break;
      }
    }
    t.parentId = parentId;

    // Update stack and clear deeper levels
    lastIdAtLevel.set(level, t.id);
    const toDelete: number[] = [];
    for (const k of lastIdAtLevel.keys()) {
      if (k > level) toDelete.push(k);
    }
    for (const k of toDelete) lastIdAtLevel.delete(k);
  }
};

const FIELD_LABELS: Record<ExcelImportFieldId, string> = {
  wbsKey: 'WBS',
  level: '레벨',
  name: '작업명',
  startDate: '시작일',
  endDate: '완료일/종료일',
  assignee: '담당자',
  progress: '진척/실적(%)',
  status: '상태',
  workEffort: '공수/작업량',
  deliverables: '산출물',
  description: '비고/설명',
};

const buildUnmappedHeaders = (headerRow: string[], mappedCols: number[]) => {
  const mapped = new Set(mappedCols.filter((n) => n >= 0));
  const out: { header: string; columnIndex: number }[] = [];
  for (let i = 0; i < headerRow.length; i++) {
    const h = String(headerRow[i] ?? '').trim();
    if (!h) continue;
    if (mapped.has(i)) continue;
    out.push({ header: h, columnIndex: i });
  }
  return out;
};

const findAllColumnIndices = (headers: string[], candidates: string[]) => {
  const normalized = headers.map(normalizeHeader);
  const normCandidates = new Set(candidates.map(normalizeHeader).filter(Boolean));
  const out: number[] = [];
  for (let i = 0; i < normalized.length; i++) {
    if (!normalized[i]) continue;
    if (normCandidates.has(normalized[i])) out.push(i);
  }
  return out;
};

const firstNonEmptyInColumns = (cells: unknown[], cols: number[]) => {
  for (const c of cols) {
    const v = cells?.[c];
    const s = String(v ?? '').trim();
    if (s) return s;
  }
  return '';
};

// 컬럼별 대표 예시 값 수집 — 미리보기에서 매칭 검증용.
// displayRows(표시 서식 적용)를 우선 사용하고 비면 rawRows로 폴백. 컬럼당 중복 없이 maxPerColumn개,
// 너무 긴 값은 잘라서 보관. 데이터 행(headerRowIndex 다음 행)부터 최대 300행까지 스캔.
const collectColumnSamples = (
  displayRows: unknown[][],
  rawRows: unknown[][],
  headerRowIndex: number,
  colCount: number,
  maxPerColumn = 3,
  maxLen = 40,
): string[][] => {
  const samples: string[][] = Array.from({ length: Math.max(0, colCount) }, () => []);
  if (colCount <= 0) return samples;
  const start = headerRowIndex + 1;
  const end = Math.min(start + 300, Math.max(displayRows.length, rawRows.length));
  for (let r = start; r < end; r++) {
    const dRow = Array.isArray(displayRows[r]) ? (displayRows[r] as unknown[]) : [];
    const rRow = Array.isArray(rawRows[r]) ? (rawRows[r] as unknown[]) : [];
    for (let c = 0; c < colCount; c++) {
      if (samples[c].length >= maxPerColumn) continue;
      const dv = dRow[c];
      const raw = dv !== undefined && dv !== null && dv !== '' ? dv : rRow[c];
      let v = String(raw ?? '').trim();
      if (!v) continue;
      if (v.length > maxLen) v = `${v.slice(0, maxLen - 1)}…`;
      if (samples[c].includes(v)) continue; // 고유값만 — 종류를 한눈에
      samples[c].push(v);
    }
    if (samples.every((s) => s.length >= maxPerColumn)) break;
  }
  return samples;
};

export const parseExcelWithMeta = async (
  file: File,
  options?: { overrides?: ExcelImportFieldOverride; customColumns?: ExcelImportCustomColumnInput[] },
): Promise<ExcelImportParseResult> => {
  const overrides = options?.overrides;
  const hasOverrides = !!overrides && Object.keys(overrides).length > 0;
  const customColumnsOpt = (options?.customColumns ?? []).filter((c) => c && c.id && c.columnIndex >= 0);
  const buf = await file.arrayBuffer();
  const workbook = XLSX.read(buf, { type: 'array' });
  const picked = pickBestSheetAndHeader(workbook);
  const worksheet = workbook.Sheets[picked.sheetName];
  if (!worksheet) {
    return {
      tasks: [],
      meta: {
        sheetName: picked.sheetName,
        headerRowIndex: picked.headerRowIndex,
        headerRow: [],
        mode: 'smart',
        mapped: [],
        unmappedHeaders: [],
        samplesByColumn: [],
      },
    };
  }

  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: '' }) as unknown[][];
  // 사용자 정의 컬럼 채우기 전용 표시값(셀의 number_format이 그대로 적용됨 — "0%"·"yyyy-mm-dd" 등).
  // 매핑된 시작일/종료일/진척률 등은 기존 raw 기반 변환 로직이 정확하므로 raw는 그대로 사용.
  const displayRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: '', raw: false }) as unknown[][];
  if (!rawRows || rawRows.length === 0) {
    return {
      tasks: [],
      meta: {
        sheetName: picked.sheetName,
        headerRowIndex: picked.headerRowIndex,
        headerRow: [],
        mode: 'smart',
        mapped: [],
        unmappedHeaders: [],
        samplesByColumn: [],
      },
    };
  }

  const headerRowIndex = Math.max(0, Math.min(picked.headerRowIndex, rawRows.length - 1));
  const headerRowRaw = (rawRows[headerRowIndex] ?? []).map((h) => String(h ?? '').trim());
  const headerRow = fillMergedHeaders(headerRowRaw);
  // 컬럼별 예시 값(표시 서식 적용) — known/smart 양 분기의 meta에 함께 실어 미리보기에서 데이터로 매칭 검증.
  const samplesByColumn = collectColumnSamples(displayRows, rawRows, headerRowIndex, headerRow.length);

  // Detect whether this is our exported format (Korean headers).
  // 우리 내보내기 포맷은 정확히 '작업명' 헤더를 포함하므로 그것을 필수로 요구. 변형 헤더(WBS 활동명/진척률 등)는
  // smart 분기에서 fuzzy 매칭하는 편이 더 정확. 사용자가 매핑 override를 줬으면 강제로 smart 분기로.
  const hasCoreKnownHeaders =
    headerRow.includes(HEADER_MAP.name) && (headerRow.includes(HEADER_MAP.startDate) || headerRow.includes(HEADER_MAP.endDate));
  const hasKnownHeader = !hasOverrides && customColumnsOpt.length === 0 && hasCoreKnownHeaders;
  if (hasKnownHeader) {
    const tasks: Task[] = [];
    const levelsByTaskId = new Map<string, LevelValue>();
    const today = new Date().toISOString().split('T')[0];
    for (const row of rawRows.slice(headerRowIndex + 1)) {
      const cells = Array.isArray(row) ? row : [];
      const rowObj: Record<string, unknown> = {};
      for (let i = 0; i < headerRow.length; i++) {
        const key = headerRow[i];
        if (!key) continue;
        rowObj[key] = cells[i];
      }

      const task: Record<string, unknown> = {};
      let parsedLevel: LevelValue = undefined;
      Object.keys(rowObj).forEach((header) => {
        const key = REVERSE_HEADER_MAP[header];
        if (!key) return;
        if (key === 'level') {
          parsedLevel = clampLevel(rowObj[header]);
          return;
        }
        const v = rowObj[header];
        if (key === 'dependencies') {
          task[key] = v
            ? String(v)
                .split(',')
                .map((s: string) => s.trim())
            : [];
        } else if (key === 'parentId') {
          task[key] = v ? String(v) : null;
        } else if (key === 'id') {
          task[key] = String(v);
        } else if (key === 'wbsId') {
          // 엑셀에서 숫자로 읽히지 않도록 항상 문자열로 저장·복원
          task[key] = v != null ? String(v).trim() : '';
        } else if (key === 'progress') {
          task[key] = toNumber(v) ?? 0;
        } else if (key === 'workEffort') {
          const n = toNumber(v);
          if (n !== undefined) task[key] = n;
        } else if (key === 'startDate' || key === 'endDate') {
          task[key] = toIsoDate(v);
        } else {
          task[key] = v;
        }
      });

      if (!task.name) continue;
      if (!task.id) task.id = randomUUID();
      if (!task.status) task.status = 'todo';
      if (task.progress === undefined || task.progress === null) task.progress = 0;
      if (!task.startDate) task.startDate = today;
      if (!task.endDate) task.endDate = task.startDate;
      if (task.workEffort === undefined) {
        const est = estimateWorkEffortFromDates(task.startDate as string, task.endDate as string);
        if (est !== undefined) task.workEffort = est;
      }
      if (!task.expanded) task.expanded = true;
      if (task.parentId === undefined) task.parentId = null;
      if (!task.dependencies) task.dependencies = [];
      tasks.push(task as unknown as Task);
      if (parsedLevel) levelsByTaskId.set(task.id as string, parsedLevel);
    }

    // 1) WBS번호 기반 계층 복원 (가능하면 우선)
    const wbsToTaskId = new Map<string, string>();
    const pendingParentByWbs = new Map<string, string>();
    for (const t of tasks) {
      const wbsKey = normalizeWbsKey((t as Task & { wbsId?: string }).wbsId);
      if (!wbsKey) continue;
      wbsToTaskId.set(wbsKey, t.id);
      const parts = wbsKey.split('.').filter(Boolean);
      if (parts.length > 1) {
        const parentWbs = parts.slice(0, -1).join('.');
        pendingParentByWbs.set(t.id, parentWbs);
      }
    }
    const hasAnyWbs = wbsToTaskId.size > 0;
    // 임포트 시 "레벨" 컬럼이 있다면 그것을 최우선으로 계층 복원
    // (WBS 접두어 규칙/사용자 수정 등으로 WBS만으로는 부모를 못 찾는 케이스가 있음)
    if (levelsByTaskId.size > 0) {
      applyLevelHierarchyInOrder(tasks, levelsByTaskId);
    } else if (hasAnyWbs) {
      // 레벨이 없을 때만 WBS 기반 계층 복원
      for (const t of tasks) {
        if (t.parentId != null) continue;
        const parentWbs = pendingParentByWbs.get(t.id);
        if (!parentWbs) continue;
        const pid = wbsToTaskId.get(parentWbs);
        if (pid) t.parentId = pid;
      }
    }
    for (const t of tasks) delete (t as Task & { wbsId?: string }).wbsId;

    const findColumnByAliases = (aliases: string[]): { index: number; header: string } => {
      for (const a of aliases) {
        const idx = headerRow.indexOf(a);
        if (idx >= 0) return { index: idx, header: a };
      }
      return { index: -1, header: '' };
    };
    const mapped: ExcelImportMappingItem[] = [];
    const add = (fieldId: ExcelImportFieldId, headerName: string, note?: string, override?: { index: number; header: string }) => {
      const col = override ? override.index : headerRow.indexOf(headerName);
      const header = override ? override.header : (col >= 0 ? headerRow[col] : '') || headerName;
      mapped.push({
        fieldId,
        fieldLabel: FIELD_LABELS[fieldId],
        header: col >= 0 ? header : '',
        columnIndex: col,
        note,
      });
    };
    const wbsFallback = findColumnByAliases(WBS_HEADER_ALIASES);
    const levelFallback = findColumnByAliases(LEVEL_HEADER_ALIASES);
    const wbsOverride = headerRow.indexOf(HEADER_MAP.wbsId) >= 0 ? undefined : wbsFallback.index >= 0 ? wbsFallback : undefined;
    add('wbsKey', HEADER_MAP.wbsId, undefined, wbsOverride);

    // 레벨 컬럼이 없더라도 WBS(예: 1.2.3.4)로 레벨/계층을 복원할 수 있음.
    // 미리보기에서 '레벨 미매칭'으로 보이는 혼란을 줄이기 위해, WBS 컬럼을 레벨(추정)로 표시한다.
    const explicitLevelOverride =
      headerRow.indexOf(HEADER_MAP.level) >= 0 ? undefined : levelFallback.index >= 0 ? levelFallback : undefined;
    const effectiveWbsIndex = wbsOverride?.index ?? headerRow.indexOf(HEADER_MAP.wbsId);
    const canInferLevelFromWbs = !explicitLevelOverride && effectiveWbsIndex >= 0;
    add(
      'level',
      HEADER_MAP.level,
      canInferLevelFromWbs ? 'WBS로 추정' : undefined,
      canInferLevelFromWbs ? { index: effectiveWbsIndex, header: headerRow[effectiveWbsIndex] ?? HEADER_MAP.wbsId } : explicitLevelOverride,
    );
    add('name', HEADER_MAP.name);
    add('startDate', HEADER_MAP.startDate);
    add('endDate', HEADER_MAP.endDate);
    add('progress', HEADER_MAP.progress);
    add('assignee', HEADER_MAP.assignee);
    add('status', HEADER_MAP.status);
    {
      const col = headerRow.indexOf(HEADER_MAP.workEffort);
      add('workEffort', HEADER_MAP.workEffort, col < 0 ? '미입력시 자동산정(기간)' : undefined);
    }
    add('deliverables', HEADER_MAP.deliverables);

    return {
      tasks,
      meta: {
        sheetName: picked.sheetName,
        headerRowIndex,
        headerRow,
        mode: 'known',
        mapped,
        unmappedHeaders: buildUnmappedHeaders(
          headerRow,
          mapped.map((m) => m.columnIndex),
        ),
        samplesByColumn,
      },
    };
  }

  // Smart parsing for arbitrary Excel structures (including .xlsm templates where header isn't first row)
  const body = rawRows.slice(headerRowIndex + 1);
  const headers = headerRow;

  const nameIdx = guessColumnIndex(headers, NAME_CANDIDATES);
  const wbsIdx = guessColumnIndex(headers, WBS_CANDIDATES);
  const levelIdx = guessColumnIndex(headers, LEVEL_CANDIDATES);
  const startIdx = guessColumnIndex(headers, START_CANDIDATES);
  const endIdx = guessColumnIndex(headers, END_CANDIDATES);
  const assigneeIdx = guessColumnIndex(headers, ASSIGNEE_CANDIDATES);
  const progressIdx = guessColumnIndex(headers, PROGRESS_CANDIDATES);
  const statusIdx = guessColumnIndex(headers, STATUS_CANDIDATES);
  const effortIdx = guessColumnIndex(headers, EFFORT_CANDIDATES);
  const deliverablesIdx = guessColumnIndex(headers, DELIVERABLES_CANDIDATES);
  const descriptionIdx = guessColumnIndex(headers, DESCRIPTION_CANDIDATES);

  // 일부 템플릿(XLGantt 등)은 작업명을 레벨별로 여러 컬럼에 분할 — 같은 헤더 반복(예: 작업*) 또는
  // 단계/Activity/Task/Leaf Task처럼 헤더 이름이 모두 다른 경우 둘 다 인식.
  // 가짜 후보(헤더만 같고 가중치 숫자만 있는 우측 컬럼, ○만 반복되는 마커 컬럼)는 텍스트 비율·고유값 필터로 제거.
  const nameColsByHeader = filterTextColumns(body, findAllColumnIndices(headers, NAME_CANDIDATES_FOR_TREE));

  // 사용자가 모달에서 컬럼을 직접 지정했으면(override) 자동 매칭 대신 그 값을 우선 사용한다.
  const ovr = overrides ?? {};
  const pickCol = (fieldId: ExcelImportFieldId, autoIdx: number) => {
    if (Object.prototype.hasOwnProperty.call(ovr, fieldId)) return ovr[fieldId]!;
    return adjustIndexForMergedHeader(body, headers, autoIdx);
  };
  const isOverridden = (fieldId: ExcelImportFieldId) => Object.prototype.hasOwnProperty.call(ovr, fieldId);

  const nameCol = pickCol('name', nameIdx);
  const wbsCol = pickCol('wbsKey', wbsIdx);
  const levelCol = pickCol('level', levelIdx);
  const startCol = pickCol('startDate', startIdx);
  const endCol = pickCol('endDate', endIdx);
  const assigneeCol = pickCol('assignee', assigneeIdx);
  const progressCol = pickCol('progress', progressIdx);
  const statusCol = pickCol('status', statusIdx);
  const effortCol = pickCol('workEffort', effortIdx);
  const deliverablesCol = pickCol('deliverables', deliverablesIdx);
  const descriptionCol = pickCol('description', descriptionIdx);

  // 사용자가 작업명을 직접 단일 컬럼으로 지정했으면 다중 컬럼(트리) 모드 해제
  const effectiveNameCols = isOverridden('name') ? [] : nameColsByHeader;

  const noteFor = (fieldId: ExcelImportFieldId, autoNote: string | undefined): string | undefined =>
    isOverridden(fieldId) ? '사용자 매핑' : autoNote;

  const mapped: ExcelImportMappingItem[] = [
    {
      fieldId: 'wbsKey',
      fieldLabel: FIELD_LABELS.wbsKey,
      header: headers[wbsCol] ?? '',
      columnIndex: wbsCol,
      note: noteFor('wbsKey', wbsCol !== wbsIdx && wbsIdx >= 0 ? '병합헤더 보정' : undefined),
    },
    {
      fieldId: 'level',
      fieldLabel: FIELD_LABELS.level,
      header: headers[levelCol] ?? '',
      columnIndex: levelCol,
      note: noteFor('level', levelCol !== levelIdx && levelIdx >= 0 ? '병합헤더 보정' : undefined),
    },
    {
      fieldId: 'name',
      fieldLabel: FIELD_LABELS.name,
      header: headers[nameCol] ?? '',
      columnIndex: nameCol,
      columnIndices: effectiveNameCols.length > 1 ? effectiveNameCols : undefined,
      note: noteFor(
        'name',
        effectiveNameCols.length > 1 ? '레벨별 다중컬럼' : nameCol !== nameIdx && nameIdx >= 0 ? '병합헤더 보정' : undefined,
      ),
    },
    {
      fieldId: 'startDate',
      fieldLabel: FIELD_LABELS.startDate,
      header: headers[startCol] ?? '',
      columnIndex: startCol,
      note: noteFor('startDate', startCol !== startIdx && startIdx >= 0 ? '병합헤더 보정' : undefined),
    },
    {
      fieldId: 'endDate',
      fieldLabel: FIELD_LABELS.endDate,
      header: headers[endCol] ?? '',
      columnIndex: endCol,
      note: noteFor('endDate', endCol !== endIdx && endIdx >= 0 ? '병합헤더 보정' : undefined),
    },
    {
      fieldId: 'assignee',
      fieldLabel: FIELD_LABELS.assignee,
      header: headers[assigneeCol] ?? '',
      columnIndex: assigneeCol,
      note: noteFor('assignee', assigneeCol !== assigneeIdx && assigneeIdx >= 0 ? '병합헤더 보정' : undefined),
    },
    {
      fieldId: 'progress',
      fieldLabel: FIELD_LABELS.progress,
      header: headers[progressCol] ?? '',
      columnIndex: progressCol,
      note: noteFor('progress', progressCol !== progressIdx && progressIdx >= 0 ? '병합헤더 보정' : undefined),
    },
    {
      fieldId: 'status',
      fieldLabel: FIELD_LABELS.status,
      header: headers[statusCol] ?? '',
      columnIndex: statusCol,
      note: noteFor('status', statusCol !== statusIdx && statusIdx >= 0 ? '병합헤더 보정' : undefined),
    },
    {
      fieldId: 'workEffort',
      fieldLabel: FIELD_LABELS.workEffort,
      header: headers[effortCol] ?? '',
      columnIndex: effortCol,
      note: noteFor(
        'workEffort',
        effortCol < 0 ? '미입력시 자동산정(기간)' : effortCol !== effortIdx && effortIdx >= 0 ? '병합헤더 보정' : undefined,
      ),
    },
    {
      fieldId: 'deliverables',
      fieldLabel: FIELD_LABELS.deliverables,
      header: headers[deliverablesCol] ?? '',
      columnIndex: deliverablesCol,
      note: noteFor('deliverables', deliverablesCol !== deliverablesIdx && deliverablesIdx >= 0 ? '병합헤더 보정' : undefined),
    },
    {
      fieldId: 'description',
      fieldLabel: FIELD_LABELS.description,
      header: headers[descriptionCol] ?? '',
      columnIndex: descriptionCol,
      note: noteFor('description', descriptionCol !== descriptionIdx && descriptionIdx >= 0 ? '병합헤더 보정' : undefined),
    },
  ];

  // Reuse existing smart parsing to build tasks (kept identical to parseExcel() behavior)
  const wbsToTaskId = new Map<string, string>();
  const pendingParentByWbs = new Map<string, string>(); // childId -> parentWbsKey
  const levelsByTaskId = new Map<string, LevelValue>();
  const tasks: Task[] = [];
  const today = new Date().toISOString().split('T')[0];
  const displayBody = displayRows.slice(headerRowIndex + 1);

  for (let rowIdx = 0; rowIdx < body.length; rowIdx++) {
    const row = body[rowIdx];
    const cells = Array.isArray(row) ? row : [];
    const displayCells: unknown[] = Array.isArray(displayBody[rowIdx]) ? (displayBody[rowIdx] as unknown[]) : [];
    const nameFromLevelColumns = effectiveNameCols.length > 1 ? firstNonEmptyInColumns(cells, effectiveNameCols) : '';
    const name = nameFromLevelColumns || (nameCol >= 0 ? String(cells[nameCol] ?? '').trim() : '');
    const wbsKey = wbsCol >= 0 ? normalizeWbsKey(cells[wbsCol]) : '';
    const explicitLevel = levelCol >= 0 ? clampLevel(cells[levelCol]) : undefined;
    const inferredLevelFromNameCols = (() => {
      if (effectiveNameCols.length <= 1) return undefined;
      const cols = [...effectiveNameCols].filter((n) => n >= 0).sort((a, b) => a - b);
      for (let i = 0; i < cols.length; i++) {
        const s = String(cells?.[cols[i]] ?? '').trim();
        if (s) return i + 1;
      }
      return undefined;
    })();
    const effectiveLevel: LevelValue =
      explicitLevel ?? inferredLevelFromNameCols ?? (wbsKey ? wbsKey.split('.').filter(Boolean).length : undefined);

    const hasAny = name || wbsKey || String(cells.join('')).trim();
    if (!hasAny) continue;
    if (!name) continue;

    const startDate = startCol >= 0 ? toIsoDate(cells[startCol]) : '';
    const endDate = endCol >= 0 ? toIsoDate(cells[endCol]) : '';
    const assignee = assigneeCol >= 0 ? String(cells[assigneeCol] ?? '').trim() : '';
    const deliverables = deliverablesCol >= 0 ? String(cells[deliverablesCol] ?? '').trim() : '';
    const description = descriptionCol >= 0 ? String(cells[descriptionCol] ?? '').trim() : '';

    let progress = progressCol >= 0 ? (toNumber(cells[progressCol]) ?? 0) : 0;
    if (progress > 0 && progress <= 1) progress = progress * 100;
    const parsedStatus = statusCol >= 0 ? parseStatus(cells[statusCol]) : '';
    const status = parsedStatus || inferStatusFromProgress(progress);
    const workEffort = effortCol >= 0 ? (toNumber(cells[effortCol]) ?? undefined) : undefined;

    const id = randomUUID();
    const customFields: Record<string, string> = {};
    for (const cc of customColumnsOpt) {
      // 셀의 number_format이 적용된 표시값을 우선 사용("0%" → "18%", 날짜 시리얼 → "2024-10-01" 등).
      // displayCells가 비어있거나 해당 컬럼이 없으면 raw cells로 폴백.
      const displayV = displayCells[cc.columnIndex];
      const v = String((displayV !== undefined && displayV !== null && displayV !== '' ? displayV : cells[cc.columnIndex]) ?? '').trim();
      if (v) customFields[cc.id] = v;
    }
    const task: Task = {
      id,
      projectId: '', // set by import pipeline
      parentId: null,
      name,
      startDate: startDate || today,
      endDate: endDate || startDate || today,
      progress: Math.max(0, Math.min(100, round2(progress))),
      assignee,
      status,
      expanded: true,
      dependencies: [],
      ...(() => {
        const baseStart = startDate || today;
        const baseEnd = endDate || startDate || today;
        const est = estimateWorkEffortFromDates(baseStart, baseEnd);
        const roundEffort = (n: number) => Math.round(n * 10) / 10;
        if (workEffort !== undefined) return { workEffort: roundEffort(workEffort) };
        if (est !== undefined) return { workEffort: roundEffort(est) };
        return {};
      })(),
      ...(deliverables ? { deliverables } : {}),
      ...(description ? { description } : {}),
      ...(Object.keys(customFields).length > 0 ? { customFields } : {}),
    };

    if (wbsKey) {
      wbsToTaskId.set(wbsKey, id);
      const parts = wbsKey.split('.').filter(Boolean);
      if (parts.length > 1) {
        const parentWbs = parts.slice(0, -1).join('.');
        pendingParentByWbs.set(id, parentWbs);
      }
    }
    if (effectiveLevel) levelsByTaskId.set(id, effectiveLevel);

    tasks.push(task);
  }

  const useLevelHierarchy = levelCol >= 0 || effectiveNameCols.length > 1;
  if (useLevelHierarchy && levelsByTaskId.size > 0) {
    applyLevelHierarchyInOrder(tasks, levelsByTaskId);
  } else if (pendingParentByWbs.size > 0) {
    for (const t of tasks) {
      const parentWbs = pendingParentByWbs.get(t.id);
      if (!parentWbs) continue;
      const pid = wbsToTaskId.get(parentWbs);
      if (pid) t.parentId = pid;
    }
  }

  return {
    tasks,
    meta: {
      sheetName: picked.sheetName,
      headerRowIndex,
      headerRow,
      mode: 'smart',
      mapped,
      unmappedHeaders: buildUnmappedHeaders(
        headerRow,
        mapped.flatMap((m) => (Array.isArray(m.columnIndices) && m.columnIndices.length > 0 ? m.columnIndices : [m.columnIndex])),
      ),
      samplesByColumn,
    },
  };
};

/** 작업별 투입율만 반환 (예: "50%"). 프로젝트 설정값 사용 */
function getAllocationRateString(
  task: Task,
  projectAssignmentsByProjectId: Map<string, Array<{ assignee: string; allocationPercent: number }>>,
): string {
  const assignments = task.projectId ? (projectAssignmentsByProjectId.get(task.projectId) ?? []) : [];
  const current = (task.assignee || '').trim();
  // 미배정(담당자 없음)이면 첫 배분값으로 대체하지 않는다 — 화면과 동일하게 '—' 표시.
  const match = current ? assignments.find((a) => (a.assignee || '').trim() === current) : undefined;
  return match ? `${formatPercent1(match.allocationPercent)}%` : '—';
}

/** Excel 시트명: 31자 제한, \ / ? * [ ] : 문자 불가 */
function toSheetName(name: string, used: Set<string>): string {
  let s = String(name || 'Sheet')
    .replace(/[\\/?*[\]:]/g, '')
    .trim()
    .slice(0, 31);
  if (!s) s = 'Sheet';
  const base = s;
  let n = 1;
  while (used.has(s)) {
    s = `${base.slice(0, 28)}_${n}`.slice(0, 31);
    n++;
  }
  used.add(s);
  return s;
}

/** 프로젝트 ID → 프로젝트명 맵. 여러 프로젝트 내보낼 때 시트명용 */
export type ProjectNameMap = Map<string, string>;

/** "2026-05-15" → "2026년 5월 15일" (화면 표기와 동일). 형식이 다르면 원문 유지 */
function koreanDate(iso?: string): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일` : iso;
}

/** #rrggbb → ExcelJS ARGB("FFRRGGBB") */
function hexToArgb(hex?: string): string | undefined {
  if (!hex) return undefined;
  let h = hex.replace('#', '').trim();
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  return /^[0-9a-fA-F]{6}$/.test(h) ? `FF${h.toUpperCase()}` : undefined;
}

/** 화면 셀 서식(cellTextStyles)을 엑셀 셀 글꼴/배경으로 반영 */
function applyCellStyle(cell: ExcelCell, style?: CellTextStyle): void {
  if (!style) return;
  const font: Partial<ExcelFont> = { ...(cell.font ?? {}) };
  let touched = false;
  if (style.fontFamily) {
    font.name = style.fontFamily;
    touched = true;
  }
  if (typeof style.fontSize === 'number' && style.fontSize > 0) {
    // 화면 px → 엑셀 pt(≈ ×0.75)로 환산해 시각 크기를 맞춤
    font.size = Math.max(6, Math.round(style.fontSize * 0.75));
    touched = true;
  }
  const color = hexToArgb(style.color);
  if (color) {
    font.color = { argb: color };
    touched = true;
  }
  if (style.bold) {
    font.bold = true;
    touched = true;
  }
  if (style.italic) {
    font.italic = true;
    touched = true;
  }
  if (style.underline) {
    font.underline = true;
    touched = true;
  }
  if (style.strikethrough) {
    font.strike = true;
    touched = true;
  }
  if (touched) cell.font = font;
  const bg = hexToArgb(style.backgroundColor);
  if (bg) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
}

type ExportColumn = { id: string; header: string; width: number; align?: 'left' | 'center' | 'right' };
const EXPORT_COLUMNS: ExportColumn[] = [
  { id: 'seq', header: '#', width: 5, align: 'center' },
  { id: 'wbsId', header: 'WBS', width: 11 },
  { id: 'name', header: '작업명', width: 40 },
  { id: 'startDate', header: '시작일', width: 15 },
  { id: 'endDate', header: '종료일', width: 15 },
  { id: 'workEffort', header: '공수(일)', width: 9, align: 'right' },
  { id: 'assignee', header: '담당자', width: 20 },
  { id: 'allocation', header: '투입율', width: 9, align: 'right' },
  { id: 'weight', header: '가중치', width: 8, align: 'right' },
  { id: 'status', header: '상태', width: 9, align: 'center' },
  { id: 'progress', header: '진척(%)', width: 9, align: 'right' },
  { id: 'deliverables', header: '산출물', width: 18 },
  { id: 'dependencies', header: '선행작업', width: 12 },
  { id: 'planned', header: '계획(%)', width: 9, align: 'right' },
  { id: 'variance', header: '차이(%P)', width: 10, align: 'right' },
];

/**
 * 화면(웹)과 동일하게 내보내기.
 * - SheetJS는 셀 서식을 저장하지 못하므로 ExcelJS로 작성(글꼴·색·크기·배경 보존).
 * - 컬럼·값(한국어 날짜, 상태 이름, 선행=순번, 계획%/차이, 가중치, # 순번)을 표 화면과 맞춤.
 * - 프로젝트별 시트(현재 프로젝트만 내보내면 1개 시트).
 */
export const exportToExcel = async (
  tasks: Task[],
  wbsMap: Map<string, string>,
  fileName: string = 'wbs_export.xlsx',
  projects: Project[] = [],
  projectNameMap?: ProjectNameMap,
  assigneeDisplayMetaByName?: Map<string, PersonDisplayMeta>,
  statusConfigs?: Array<{ id: string; name: string }>,
): Promise<void> => {
  const ExcelJSMod = await import('exceljs');
  const ExcelJS = (ExcelJSMod as unknown as { default?: typeof ExcelJSMod }).default ?? ExcelJSMod;

  const projectAssignmentsByProjectId = new Map(projects.map((p) => [p.id, p.assignments ?? []]));
  const nameMap = projectNameMap ?? new Map(projects.map((p) => [p.id, formatProjectDisplayName(p.name, p.projectKind)]));
  const statusName = (id?: string) => statusConfigs?.find((c) => c.id === id)?.name ?? id ?? '';

  const tasksByProject = new Map<string, Task[]>();
  for (const p of projects)
    tasksByProject.set(
      p.id,
      tasks.filter((t) => t.projectId === p.id),
    );

  const wb = new ExcelJS.Workbook();
  const usedSheetNames = new Set<string>();

  for (const project of projects) {
    const projectTasks = tasksByProject.get(project.id) ?? [];

    // WBS 코드 + 표시 순서(트리 펼침 순)
    const exportWbsMap = new Map<string, string>();
    const orderedTasks: Task[] = [];
    const fillWbs = (parentId: string | null) => {
      const children = projectTasks.filter((t) => t.parentId === parentId);
      children.forEach((child, index) => {
        const contextVal = wbsMap.get(child.id);
        if (contextVal) exportWbsMap.set(child.id, contextVal);
        else {
          const parentWbs = parentId ? exportWbsMap.get(parentId) || '' : '';
          exportWbsMap.set(child.id, parentWbs ? `${parentWbs}.${index + 1}` : `${index + 1}`);
        }
        orderedTasks.push(child);
        // 화면과 동일하게: 접힌(펼치지 않은) 작업의 하위는 내보내지 않는다(task.expanded 반영).
        if (child.expanded) fillWbs(child.id);
      });
    };
    fillWbs(null);

    const seqOf = new Map<string, number>();
    orderedTasks.forEach((t, i) => seqOf.set(t.id, i + 1));
    const plannedMap = computePlannedProgressMap(projectTasks);
    const depSeqs = (t: Task) =>
      (t.dependencies ?? [])
        .map((id) => seqOf.get(id))
        .filter((n): n is number => typeof n === 'number')
        .sort((a, b) => a - b)
        .join(', ');

    const valueOf = (t: Task, colId: string): string | number => {
      switch (colId) {
        case 'seq':
          return seqOf.get(t.id) ?? '';
        case 'wbsId':
          return exportWbsMap.get(t.id) || '';
        case 'name':
          return t.name ?? '';
        case 'startDate':
          return koreanDate(t.startDate);
        case 'endDate':
          return koreanDate(t.endDate);
        case 'workEffort':
          return t.workEffort ?? 0;
        case 'assignee':
          return formatAssigneeDisplay(t.assignee, assigneeDisplayMetaByName);
        case 'allocation':
          return getAllocationRateString(t, projectAssignmentsByProjectId);
        case 'weight':
          return t.weight != null ? formatNum1(t.weight) : '-';
        case 'status':
          return statusName(t.status);
        case 'progress':
          return `${formatPercent1(Number(t.progress ?? 0))}%`;
        case 'deliverables':
          return t.deliverables || '';
        case 'dependencies':
          return depSeqs(t);
        case 'planned': {
          const p = plannedMap.get(t.id);
          return p == null ? '' : `${formatPercent1(p)}%`;
        }
        case 'variance': {
          const p = plannedMap.get(t.id);
          if (p == null) return '—';
          const v = Number(t.progress ?? 0) - p;
          return `${v > 0 ? '+' : ''}${formatPercent1(v)}%p`;
        }
        default:
          return '';
      }
    };

    const ws = wb.addWorksheet(toSheetName(nameMap.get(project.id) ?? project.name, usedSheetNames), {
      // 헤더행 + 좌측 #·WBS·작업명 고정(웹 표와 유사)
      views: [{ state: 'frozen', xSplit: 3, ySplit: 1 }],
    });
    ws.columns = EXPORT_COLUMNS.map((c) => ({ width: c.width }));

    // 헤더
    const headerRow = ws.addRow(EXPORT_COLUMNS.map((c) => c.header));
    headerRow.height = 22;
    headerRow.eachCell({ includeEmpty: true }, (cell, ci) => {
      cell.font = { bold: true, size: 10, color: { argb: 'FF334155' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      cell.alignment = { vertical: 'middle', horizontal: EXPORT_COLUMNS[ci - 1]?.align ?? 'left' };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
    });

    if (orderedTasks.length === 0) {
      const r = ws.addRow(EXPORT_COLUMNS.map((c) => (c.id === 'name' ? '(작업 없음)' : '')));
      r.getCell(3).font = { italic: true, color: { argb: 'FF94A3B8' } };
    } else {
      for (const task of orderedTasks) {
        const row = ws.addRow(EXPORT_COLUMNS.map((c) => valueOf(task, c.id)));
        row.eachCell({ includeEmpty: true }, (cell, ci) => {
          const col = EXPORT_COLUMNS[ci - 1];
          if (!col) return;
          cell.alignment = { vertical: 'middle', horizontal: col.align ?? 'left' };
          applyCellStyle(cell, task.cellTextStyles?.[col.id]);
        });
      }
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
};

export const parseExcel = (file: File): Promise<Task[]> => {
  return parseExcelWithMeta(file).then((r) => r.tasks);
};
