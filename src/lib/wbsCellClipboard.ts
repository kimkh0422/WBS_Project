import type { CellTextStyle, Task, WorkEffortUnit } from '../types';
import type { TableColumnId } from '../components/wbsTableTypes';
import { normalizeYmdInput } from './ymdInput';
import { inclusiveCalendarDays, endYmdFromInclusiveDuration } from './durationDays';
import { round1, round2 } from './utils';
import { hasDependencyCycle } from './dependencyPicker';

/** 셀 복사/붙여넣기에서 쓰는 상태 설정 최소 형태 (wbsSettings.statusConfigs 호환) */
export interface WbsStatusConfigLite {
  id: string;
  name: string;
  progress?: number;
}

/**
 * 엑셀식 셀 단위 클립보드 (작업 단위 클립보드와 별개).
 * Ctrl+C로 커서 셀 값을 담아 두고, 커서 이동 후 Ctrl+V로 대상 셀에 기록한다.
 */
export interface WbsCellClipboardData {
  /** 복사한 원본 컬럼 */
  columnId: TableColumnId;
  /** 시스템 클립보드와 동일한 텍스트 표현 — 다른 컬럼·외부 앱 붙여넣기에 사용 */
  text: string;
  /** 상태 셀: 표시명과 별개로 정확히 복원할 상태 id */
  statusId?: string;
  /** 선행 셀: 같은 프로젝트 안에서 정확히 복원할 선행작업 id 목록 */
  depIds?: string[];
  /** 원본 셀 서식 — 있으면 붙여넣기 시 함께 적용(대상 서식을 지우지는 않음) */
  style?: CellTextStyle;
  sourceTaskId: string;
  sourceProjectId: string;
}

/** 마퀴(직사각형)로 복사한 셀 영역 — `grid[r][c]`는 표시 순서(행·열) */
export type WbsCopiedCellRegion = { grid: WbsCellClipboardData[][] };

/** 외부 텍스트(시스템 클립보드)만으로 붙여넣을 때 쓰는 입력 형태 */
export type WbsCellPasteInput = Pick<WbsCellClipboardData, 'text'> & Partial<Omit<WbsCellClipboardData, 'text'>>;

export interface WbsCellPasteContext {
  /** 선행 id 검증·순환 검사용 전체 작업 (대상 프로젝트 작업 포함) */
  tasks: Task[];
  /** 표시 순서 작업 id — 선행작업 텍스트("3, 5")를 행 번호로 해석 */
  visibleTaskIds: string[];
  statusConfigs: WbsStatusConfigLite[];
  /** 대상 작업 프로젝트의 공수 단위 — 공수 반올림 자리수 결정 */
  effortUnit: WorkEffortUnit;
}

/**
 * 셀 단위 복사를 지원하는 컬럼인지.
 * 작업명은 기존 "행(+펼쳐진 하위) 복사" 동작을 유지하고(행 손잡이 역할),
 * 파생·프로젝트 단위(계획율·차이·투입율)와 wbsId는 값 셀이 아니므로 제외.
 */
const NON_CELL_CLIPBOARD_COLUMNS = new Set<string>(['wbsId', 'name', 'plannedProgress', 'progressVariance', 'allocation']);
export function isCellClipboardColumn(columnId: TableColumnId): boolean {
  return !NON_CELL_CLIPBOARD_COLUMNS.has(columnId);
}

/**
 * 마퀴 복사용: 작업명·값 셀은 클립보드 데이터로, 그 외(번호·파생 등)는 빈 텍스트 스텁.
 * 붙여넣기 시 대상 컬럼 규칙에 따라 실패하거나 무시된다.
 */
export function getMarqueeClipboardCellData(
  task: Task,
  columnId: TableColumnId,
  ctx: { statusConfigs: WbsStatusConfigLite[]; visibleTaskIds: string[] },
): WbsCellClipboardData {
  const baseIds = { sourceTaskId: task.id, sourceProjectId: task.projectId };
  if (columnId === 'name') {
    return { columnId: 'name', text: (task.name ?? '').trim(), ...baseIds };
  }
  const v = getWbsCellClipboardData(task, columnId, ctx);
  if (v) return v;
  return { columnId, text: '', ...baseIds };
}

/** 마퀴 앵커~끝 직사각형을 행 우선 순서의 2차원 그리드로 직렬화 */
export function buildMarqueeWbsCellClipboardGrid(
  visibleTasks: Task[],
  visibleColumnIds: TableColumnId[],
  anchor: { taskId: string; columnId: TableColumnId },
  end: { taskId: string; columnId: TableColumnId },
  ctx: { statusConfigs: WbsStatusConfigLite[]; visibleTaskIds: string[] },
): WbsCopiedCellRegion | null {
  const r1 = visibleTasks.findIndex((t) => t.id === anchor.taskId);
  const r2 = visibleTasks.findIndex((t) => t.id === end.taskId);
  if (r1 < 0 || r2 < 0) return null;
  const rowLo = Math.min(r1, r2);
  const rowHi = Math.max(r1, r2);
  const c1 = visibleColumnIds.indexOf(anchor.columnId);
  const c2 = visibleColumnIds.indexOf(end.columnId);
  if (c1 < 0 || c2 < 0) return null;
  const colLo = Math.min(c1, c2);
  const colHi = Math.max(c1, c2);
  const grid: WbsCellClipboardData[][] = [];
  for (let r = rowLo; r <= rowHi; r++) {
    const task = visibleTasks[r]!;
    const row: WbsCellClipboardData[] = [];
    for (let c = colLo; c <= colHi; c++) {
      const colId = visibleColumnIds[c]!;
      row.push(getMarqueeClipboardCellData(task, colId, ctx));
    }
    grid.push(row);
  }
  return grid.length > 0 ? { grid } : null;
}

/** 시스템 클립보드용 TSV (엑셀 호환) */
export function wbsCopiedCellRegionToTsv(region: WbsCopiedCellRegion): string {
  return region.grid.map((row) => row.map((cell) => cell.text.replace(/\r?\n/g, ' ')).join('\t')).join('\n');
}

export function getWbsCellClipboardData(
  task: Task,
  columnId: TableColumnId,
  ctx: { statusConfigs: WbsStatusConfigLite[]; visibleTaskIds: string[] },
): WbsCellClipboardData | null {
  if (!isCellClipboardColumn(columnId)) return null;
  const style = task.cellTextStyles?.[columnId];
  const base = {
    columnId,
    sourceTaskId: task.id,
    sourceProjectId: task.projectId,
    ...(style ? { style: { ...style } } : {}),
  };
  if (columnId === 'startDate') return { ...base, text: (task.startDate ?? '').slice(0, 10) };
  if (columnId === 'endDate') return { ...base, text: (task.endDate ?? '').slice(0, 10) };
  if (columnId === 'duration') {
    const days = inclusiveCalendarDays(task.startDate, task.endDate);
    return { ...base, text: days != null ? String(days) : '' };
  }
  if (columnId === 'workEffort') return { ...base, text: task.workEffort != null ? String(task.workEffort) : '' };
  if (columnId === 'weight') return { ...base, text: task.weight != null ? String(task.weight) : '' };
  if (columnId === 'progress') {
    return { ...base, text: typeof task.progress === 'number' && Number.isFinite(task.progress) ? String(task.progress) : '' };
  }
  if (columnId === 'assignee') return { ...base, text: (task.assignee ?? '').trim() };
  if (columnId === 'status') {
    const cfg = ctx.statusConfigs.find((c) => c.id === task.status);
    return { ...base, text: cfg?.name ?? task.status ?? '', statusId: task.status };
  }
  if (columnId === 'deliverables') return { ...base, text: (task.deliverables ?? '').trim() };
  if (columnId === 'dependencies') {
    const deps = task.dependencies ?? [];
    const seqById = new Map(ctx.visibleTaskIds.map((id, i) => [id, i + 1]));
    const nums = deps
      .map((id) => seqById.get(id))
      .filter((n): n is number => n != null)
      .sort((a, b) => a - b);
    return { ...base, text: nums.join(', '), depIds: [...deps] };
  }
  if (columnId.startsWith('custom:')) return { ...base, text: task.customFields?.[columnId] ?? '' };
  return null;
}

/**
 * 셀 클립보드(또는 외부 텍스트)를 대상 셀에 기록할 updateTask 페이로드를 만든다.
 * 각 셀 인라인 편집기의 커밋 규칙(SortableTaskRow)을 그대로 따른다.
 *
 * @returns updates가 null이고 error가 없으면 "값이 같아 변경 없음"(성공 취급)
 */
export function buildWbsCellPasteUpdate(
  target: Task,
  targetColumnId: TableColumnId,
  cell: WbsCellPasteInput,
  ctx: WbsCellPasteContext,
): { updates: Partial<Task> | null; error?: string } {
  if (target.mirroredFromTaskId) {
    return { updates: null, error: '분기 프로젝트에서 거울로 표시된 작업에는 붙여넣을 수 없습니다.' };
  }
  const valueResult = buildValueUpdate(target, targetColumnId, cell, ctx);
  if (valueResult.error) return valueResult;
  let updates = valueResult.updates;
  // 원본 셀 서식도 함께 적용 (원본에 서식이 있을 때만)
  if (cell.style && Object.keys(cell.style).length > 0) {
    const current = target.cellTextStyles?.[targetColumnId];
    if (JSON.stringify(current ?? null) !== JSON.stringify(cell.style)) {
      updates = {
        ...(updates ?? {}),
        cellTextStyles: { ...(target.cellTextStyles ?? {}), [targetColumnId]: { ...cell.style } },
      };
    }
  }
  return { updates };
}

function buildValueUpdate(
  target: Task,
  targetColumnId: TableColumnId,
  cell: WbsCellPasteInput,
  ctx: WbsCellPasteContext,
): { updates: Partial<Task> | null; error?: string } {
  const rawText = cell.text ?? '';
  const text = rawText.trim();
  const noChange = { updates: null } as const;
  const fail = (error: string) => ({ updates: null, error });

  if (targetColumnId === 'wbsId') return fail('번호 셀에는 붙여넣을 수 없습니다.');
  if (targetColumnId === 'plannedProgress') return fail('계획율은 시작·종료일로 자동 계산됩니다. 날짜 셀에 붙여넣으세요.');
  if (targetColumnId === 'progressVariance') return fail('차이(%p)는 자동 계산됩니다. 진척률 셀에 붙여넣으세요.');
  if (targetColumnId === 'allocation') return fail('투입율 셀에는 붙여넣을 수 없습니다. (프로젝트 투입인원 설정에서 관리)');

  if (targetColumnId === 'name') {
    if (!text) return fail('작업명에는 빈 값을 붙여넣을 수 없습니다.');
    if (text === (target.name ?? '').trim()) return noChange;
    return { updates: { name: text } };
  }
  if (targetColumnId === 'startDate' || targetColumnId === 'endDate') {
    const ymd = normalizeYmdInput(text);
    if (!ymd) return fail(`날짜로 해석할 수 없습니다: "${text || '빈 값'}" (예: 2026-06-15)`);
    const prev = targetColumnId === 'startDate' ? target.startDate : target.endDate;
    if (ymd === (prev?.slice(0, 10) ?? '')) return noChange;
    return { updates: { [targetColumnId]: ymd + (prev?.slice(10) || '') } };
  }
  if (targetColumnId === 'duration') {
    const n = parseInt(text, 10);
    if (!Number.isFinite(n) || n < 1) return fail('기간은 1 이상의 일수여야 합니다.');
    if (!target.startDate) return fail('시작일이 없어 기간으로 종료일을 계산할 수 없습니다.');
    const newYmd = endYmdFromInclusiveDuration(target.startDate, n);
    if (!newYmd) return fail('기간으로 종료일을 계산하지 못했습니다.');
    const newEnd = newYmd + (target.endDate?.slice(10) || '');
    if (newEnd === (target.endDate ?? '')) return noChange;
    return { updates: { endDate: newEnd } };
  }
  if (targetColumnId === 'workEffort') {
    const v = Number.parseFloat(text);
    if (!Number.isFinite(v) || v < 0) return fail('공수는 0 이상의 숫자여야 합니다.');
    const rounded = ctx.effortUnit === 'minute' ? Math.round(v) : Math.round(v * 10) / 10;
    if (rounded === (target.workEffort ?? NaN)) return noChange;
    return { updates: { workEffort: rounded } };
  }
  if (targetColumnId === 'weight') {
    const v = Number.parseFloat(text);
    if (!Number.isFinite(v) || v < 0) return fail('가중치는 0 이상의 숫자여야 합니다.');
    const rounded = round1(v);
    if (rounded === (target.weight ?? NaN)) return noChange;
    return { updates: { weight: rounded } };
  }
  if (targetColumnId === 'progress') {
    const v = Number.parseFloat(text.replace(/[%\s]+$/g, ''));
    if (!Number.isFinite(v) || v < 0 || v > 100) return fail('진척률은 0~100 사이 숫자여야 합니다.');
    const rounded = round2(v);
    if (rounded === (target.progress ?? NaN)) return noChange;
    return { updates: { progress: rounded } };
  }
  if (targetColumnId === 'assignee') {
    if (text === (target.assignee ?? '').trim()) return noChange;
    return { updates: { assignee: text } };
  }
  if (targetColumnId === 'status') {
    let cfg = cell.statusId ? ctx.statusConfigs.find((c) => c.id === cell.statusId) : undefined;
    if (!cfg && text) {
      cfg = ctx.statusConfigs.find((c) => c.name.trim() === text) ?? ctx.statusConfigs.find((c) => c.id === text);
    }
    if (!cfg) return fail(`"${text || '빈 값'}"과 일치하는 상태가 없습니다.`);
    if (cfg.id === target.status) return noChange;
    // 상태 셀 편집기와 동일: 상태에 진척률이 매핑돼 있으면 함께 반영
    const updates: Partial<Task> = { status: cfg.id };
    if (cfg.progress !== undefined) updates.progress = cfg.progress;
    return { updates };
  }
  if (targetColumnId === 'deliverables') {
    if (text === (target.deliverables ?? '').trim()) return noChange;
    return { updates: { deliverables: text || undefined } };
  }
  if (targetColumnId === 'dependencies') {
    let ids: string[];
    if (cell.depIds && cell.sourceProjectId === target.projectId) {
      ids = cell.depIds;
    } else if (!text) {
      ids = [];
    } else {
      // 행 번호 텍스트("3, 5")를 현재 표시 순서 기준으로 해석 (선행 셀 입력기와 동일 규칙)
      const parts = text.split(/[\s,]+/).filter(Boolean);
      const nums = parts.map((p) => Number.parseInt(p, 10));
      if (nums.some((n) => !Number.isFinite(n) || n < 1)) {
        return fail('선행작업에는 행 번호 목록(예: 3, 5)만 붙여넣을 수 있습니다.');
      }
      ids = nums.map((n) => ctx.visibleTaskIds[n - 1]).filter((id): id is string => !!id);
    }
    const projectTasks = ctx.tasks.filter((t) => t.projectId === target.projectId);
    const projectTaskIds = new Set(projectTasks.map((t) => t.id));
    const valid: string[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      if (id === target.id || seen.has(id) || !projectTaskIds.has(id)) continue;
      seen.add(id);
      valid.push(id);
    }
    if (hasDependencyCycle(projectTasks, target.id, valid)) {
      return fail('순환 의존관계가 생겨 붙여넣지 않았습니다.');
    }
    const prev = target.dependencies ?? [];
    if (prev.length === valid.length && prev.every((id, i) => id === valid[i])) return noChange;
    return { updates: { dependencies: valid } };
  }
  if (targetColumnId.startsWith('custom:')) {
    const current = target.customFields?.[targetColumnId] ?? '';
    if (rawText === current) return noChange;
    return { updates: { customFields: { ...(target.customFields ?? {}), [targetColumnId]: rawText } } };
  }
  return fail('이 셀에는 붙여넣을 수 없습니다.');
}
