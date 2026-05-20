import * as XLSX from 'xlsx';
import { differenceInBusinessDays, parseISO, isValid } from 'date-fns';
import { Task, TaskStatus, Project } from '../types';
import { randomUUID, round2 } from './utils';
import { formatAssigneeDisplay, type PersonDisplayMeta } from './assigneeOptions';
import { formatProjectDisplayName } from './projectKind';

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

const scoreHeaderRow = (headers: string[]) => {
  const nameIdx = guessColumnIndex(headers, ['작업명', '작업*', '작업', '업무', 'task', 'taskname', 'name', '제목', 'title']);
  const wbsIdx = guessColumnIndex(headers, ['wbs번호', 'wbs', 'wbsid', 'wbs코드', 'wbs code', 'WBS']);
  const startIdx = guessColumnIndex(headers, ['시작일', '시작일*', '시작', 'start', 'startdate', 'from']);
  const endIdx = guessColumnIndex(headers, ['종료일', '완료일', '완료일*', '종료', 'end', 'enddate', 'to', 'finish', 'finishdate']);
  const assigneeIdx = guessColumnIndex(headers, ['담당자', '담당', 'assignee', 'owner', '담당부서', '부서']);
  const progressIdx = guessColumnIndex(headers, [
    '실적*',
    '실적',
    '실적진척률',
    '%workcomplete',
    '진행률',
    '진행',
    '진척률',
    '진척율',
    'progress',
    'percent',
    '%',
  ]);
  const statusIdx = guessColumnIndex(headers, ['상태', 'status', '진행상태', 'state']);
  const effortIdx = guessColumnIndex(headers, [
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
  ]);
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

export const parseExcelWithMeta = async (file: File): Promise<ExcelImportParseResult> => {
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
      },
    };
  }

  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: '' }) as unknown[][];
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
      },
    };
  }

  const headerRowIndex = Math.max(0, Math.min(picked.headerRowIndex, rawRows.length - 1));
  const headerRowRaw = (rawRows[headerRowIndex] ?? []).map((h) => String(h ?? '').trim());
  const headerRow = fillMergedHeaders(headerRowRaw);

  // Detect whether this is our exported format (Korean headers).
  // NOTE: Some templates (e.g. XLGantt) contain a subset of these headers (like "산출물") but are NOT our format.
  // So we require either core headers or a minimum number of matches.
  const knownHeaderHits = headerRow.reduce((acc, h) => (REVERSE_HEADER_MAP[h] !== undefined ? acc + 1 : acc), 0);
  const hasCoreKnownHeaders =
    headerRow.includes(HEADER_MAP.name) && (headerRow.includes(HEADER_MAP.startDate) || headerRow.includes(HEADER_MAP.endDate));
  const hasKnownHeader = hasCoreKnownHeaders || knownHeaderHits >= 4;
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
      },
    };
  }

  // Smart parsing for arbitrary Excel structures (including .xlsm templates where header isn't first row)
  const body = rawRows.slice(headerRowIndex + 1);
  const headers = headerRow;

  const nameIdx = guessColumnIndex(headers, ['작업명', '작업*', '작업', '업무', 'task', 'taskname', 'name', '제목', 'title']);
  const wbsIdx = guessColumnIndex(headers, ['wbs번호', 'wbs', 'wbsid', 'wbs코드', 'wbs code', 'WBS']);
  const levelIdx = guessColumnIndex(headers, ['레벨', 'level', 'lvl', '단계', 'lv']);
  const startIdx = guessColumnIndex(headers, ['시작일', '시작일*', '시작', 'start', 'startdate', 'from']);
  const endIdx = guessColumnIndex(headers, ['종료일', '완료일', '완료일*', '종료', 'end', 'enddate', 'to', 'finish', 'finishdate']);
  const assigneeIdx = guessColumnIndex(headers, ['담당자', '담당', 'assignee', 'owner', '담당부서', '부서']);
  const progressIdx = guessColumnIndex(headers, [
    '실적*',
    '실적',
    '실적진척률',
    '%workcomplete',
    '진행률',
    '진행',
    '진척률',
    '진척율',
    'progress',
    'percent',
    '%',
  ]);
  const statusIdx = guessColumnIndex(headers, ['상태', 'status', '진행상태', 'state']);
  const effortIdx = guessColumnIndex(headers, [
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
  ]);
  const deliverablesIdx = guessColumnIndex(headers, ['산출물', 'deliverable', 'deliverables', 'output', '결과물']);
  const descriptionIdx = guessColumnIndex(headers, ['비고', '설명', 'note', 'notes', 'comment', 'remarks', 'remark']);

  // Some templates (notably XLGantt) represent task name across multiple columns with the same header (e.g. repeated "작업*").
  // In that case, a single column mapping will only capture a subset (often higher levels).
  const nameColsByHeader = findAllColumnIndices(headers, ['작업*', '작업명', '작업', '업무', 'task', 'taskname', 'name', '제목', 'title']);

  const nameCol = adjustIndexForMergedHeader(body, headers, nameIdx);
  const wbsCol = adjustIndexForMergedHeader(body, headers, wbsIdx);
  const levelCol = adjustIndexForMergedHeader(body, headers, levelIdx);
  const startCol = adjustIndexForMergedHeader(body, headers, startIdx);
  const endCol = adjustIndexForMergedHeader(body, headers, endIdx);
  const assigneeCol = adjustIndexForMergedHeader(body, headers, assigneeIdx);
  const progressCol = adjustIndexForMergedHeader(body, headers, progressIdx);
  const statusCol = adjustIndexForMergedHeader(body, headers, statusIdx);
  const effortCol = adjustIndexForMergedHeader(body, headers, effortIdx);
  const deliverablesCol = adjustIndexForMergedHeader(body, headers, deliverablesIdx);
  const descriptionCol = adjustIndexForMergedHeader(body, headers, descriptionIdx);

  const mapped: ExcelImportMappingItem[] = [
    {
      fieldId: 'wbsKey',
      fieldLabel: FIELD_LABELS.wbsKey,
      header: headers[wbsCol] ?? '',
      columnIndex: wbsCol,
      note: wbsCol !== wbsIdx && wbsIdx >= 0 ? '병합헤더 보정' : undefined,
    },
    {
      fieldId: 'level',
      fieldLabel: FIELD_LABELS.level,
      header: headers[levelCol] ?? '',
      columnIndex: levelCol,
      note: levelCol !== levelIdx && levelIdx >= 0 ? '병합헤더 보정' : undefined,
    },
    {
      fieldId: 'name',
      fieldLabel: FIELD_LABELS.name,
      header: headers[nameCol] ?? '',
      columnIndex: nameCol,
      columnIndices: nameColsByHeader.length > 1 ? nameColsByHeader : undefined,
      note: nameColsByHeader.length > 1 ? '레벨별 다중컬럼' : nameCol !== nameIdx && nameIdx >= 0 ? '병합헤더 보정' : undefined,
    },
    {
      fieldId: 'startDate',
      fieldLabel: FIELD_LABELS.startDate,
      header: headers[startCol] ?? '',
      columnIndex: startCol,
      note: startCol !== startIdx && startIdx >= 0 ? '병합헤더 보정' : undefined,
    },
    {
      fieldId: 'endDate',
      fieldLabel: FIELD_LABELS.endDate,
      header: headers[endCol] ?? '',
      columnIndex: endCol,
      note: endCol !== endIdx && endIdx >= 0 ? '병합헤더 보정' : undefined,
    },
    {
      fieldId: 'assignee',
      fieldLabel: FIELD_LABELS.assignee,
      header: headers[assigneeCol] ?? '',
      columnIndex: assigneeCol,
      note: assigneeCol !== assigneeIdx && assigneeIdx >= 0 ? '병합헤더 보정' : undefined,
    },
    {
      fieldId: 'progress',
      fieldLabel: FIELD_LABELS.progress,
      header: headers[progressCol] ?? '',
      columnIndex: progressCol,
      note: progressCol !== progressIdx && progressIdx >= 0 ? '병합헤더 보정' : undefined,
    },
    {
      fieldId: 'status',
      fieldLabel: FIELD_LABELS.status,
      header: headers[statusCol] ?? '',
      columnIndex: statusCol,
      note: statusCol !== statusIdx && statusIdx >= 0 ? '병합헤더 보정' : undefined,
    },
    {
      fieldId: 'workEffort',
      fieldLabel: FIELD_LABELS.workEffort,
      header: headers[effortCol] ?? '',
      columnIndex: effortCol,
      note: effortCol < 0 ? '미입력시 자동산정(기간)' : effortCol !== effortIdx && effortIdx >= 0 ? '병합헤더 보정' : undefined,
    },
    {
      fieldId: 'deliverables',
      fieldLabel: FIELD_LABELS.deliverables,
      header: headers[deliverablesCol] ?? '',
      columnIndex: deliverablesCol,
      note: deliverablesCol !== deliverablesIdx && deliverablesIdx >= 0 ? '병합헤더 보정' : undefined,
    },
    {
      fieldId: 'description',
      fieldLabel: FIELD_LABELS.description,
      header: headers[descriptionCol] ?? '',
      columnIndex: descriptionCol,
      note: descriptionCol !== descriptionIdx && descriptionIdx >= 0 ? '병합헤더 보정' : undefined,
    },
  ];

  // Reuse existing smart parsing to build tasks (kept identical to parseExcel() behavior)
  const wbsToTaskId = new Map<string, string>();
  const pendingParentByWbs = new Map<string, string>(); // childId -> parentWbsKey
  const levelsByTaskId = new Map<string, LevelValue>();
  const tasks: Task[] = [];
  const today = new Date().toISOString().split('T')[0];

  for (const row of body) {
    const cells = Array.isArray(row) ? row : [];
    const nameFromLevelColumns = nameColsByHeader.length > 1 ? firstNonEmptyInColumns(cells, nameColsByHeader) : '';
    const name = nameFromLevelColumns || (nameCol >= 0 ? String(cells[nameCol] ?? '').trim() : '');
    const wbsKey = wbsCol >= 0 ? normalizeWbsKey(cells[wbsCol]) : '';
    const explicitLevel = levelCol >= 0 ? clampLevel(cells[levelCol]) : undefined;
    const inferredLevelFromNameCols = (() => {
      if (nameColsByHeader.length <= 1) return undefined;
      const cols = [...nameColsByHeader].filter((n) => n >= 0).sort((a, b) => a - b);
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

  const useLevelHierarchy = levelCol >= 0 || nameColsByHeader.length > 1;
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
  const match = current ? assignments.find((a) => (a.assignee || '').trim() === current) : assignments[0];
  return match ? `${match.allocationPercent}%` : '';
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

export const exportToExcel = (
  tasks: Task[],
  wbsMap: Map<string, string>,
  fileName: string = 'wbs_export.xlsx',
  projects: Project[] = [],
  projectNameMap?: ProjectNameMap,
  assigneeDisplayMetaByName?: Map<string, PersonDisplayMeta>,
) => {
  const projectAssignmentsByProjectId = new Map(projects.map((p) => [p.id, p.assignments ?? []]));
  const nameMap = projectNameMap ?? new Map(projects.map((p) => [p.id, formatProjectDisplayName(p.name, p.projectKind)]));

  // 프로젝트별로 작업 그룹화 (projects 순서 유지)
  const tasksByProject = new Map<string, Task[]>();
  for (const p of projects) {
    tasksByProject.set(
      p.id,
      tasks.filter((t) => t.projectId === p.id),
    );
  }

  const workbook = XLSX.utils.book_new();
  const usedSheetNames = new Set<string>();

  for (const project of projects) {
    const projectTasks = tasksByProject.get(project.id) ?? [];
    if (projectTasks.length === 0 && projects.length > 1) continue; // 빈 프로젝트 시트 생략

    // 해당 프로젝트 작업만으로 WBS 맵 생성
    const exportWbsMap = new Map<string, string>();
    const orderedTasks: Task[] = [];
    const fillWbs = (parentId: string | null) => {
      const children = projectTasks.filter((t) => t.parentId === parentId);
      children.forEach((child, index) => {
        const contextVal = wbsMap.get(child.id);
        if (contextVal) {
          exportWbsMap.set(child.id, contextVal);
        } else {
          const parentWbs = parentId ? exportWbsMap.get(parentId) || '' : '';
          exportWbsMap.set(child.id, parentWbs ? `${parentWbs}.${index + 1}` : `${index + 1}`);
        }
        orderedTasks.push(child);
        fillWbs(child.id);
      });
    };
    fillWbs(null);

    const data = orderedTasks.map((task) => {
      const wbsCode = exportWbsMap.get(task.id) || '';
      const level = wbsCode ? wbsCode.split('.').filter(Boolean).length : 1;
      const allocationRate = getAllocationRateString(task, projectAssignmentsByProjectId);
      return {
        [HEADER_MAP.wbsId]: wbsCode,
        [HEADER_MAP.level]: level,
        [HEADER_MAP.name]: task.name,
        [HEADER_MAP.startDate]: task.startDate,
        [HEADER_MAP.endDate]: task.endDate,
        [HEADER_MAP.progress]: task.progress,
        [HEADER_MAP.assignee]: formatAssigneeDisplay(task.assignee, assigneeDisplayMetaByName),
        투입율: allocationRate,
        [HEADER_MAP.status]: task.status,
        [HEADER_MAP.dependencies]: task.dependencies ? task.dependencies.join(',') : '',
        [HEADER_MAP.workEffort]: task.workEffort || 0,
        [HEADER_MAP.deliverables]: task.deliverables || '',
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    // WBS번호·레벨 열을 텍스트로 고정해 엑셀에서 숫자로 변환되지 않도록 함 (1.2.1 → 1.21 방지)
    const firstKeys = data.length > 0 ? Object.keys(data[0]) : [];
    const wbsColIndex = firstKeys.indexOf(HEADER_MAP.wbsId);
    const levelColIndex = firstKeys.indexOf(HEADER_MAP.level);
    for (let r = 0; r < data.length; r++) {
      const rowIndex = r + 1; // row 0 = 헤더
      if (wbsColIndex >= 0) {
        const ref = XLSX.utils.encode_cell({ c: wbsColIndex, r: rowIndex });
        const cell = worksheet[ref];
        if (cell) {
          cell.t = 's';
          cell.v = String((data[r] as Record<string, unknown>)[HEADER_MAP.wbsId] ?? '');
        }
      }
      if (levelColIndex >= 0) {
        const ref = XLSX.utils.encode_cell({ c: levelColIndex, r: rowIndex });
        const cell = worksheet[ref];
        if (cell) {
          cell.t = 's';
          cell.v = String((data[r] as Record<string, unknown>)[HEADER_MAP.level] ?? '');
        }
      }
    }
    const sheetName = toSheetName(nameMap.get(project.id) ?? project.name, usedSheetNames);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  }

  XLSX.writeFile(workbook, fileName);
};

export const parseExcel = (file: File): Promise<Task[]> => {
  return parseExcelWithMeta(file).then((r) => r.tasks);
};
