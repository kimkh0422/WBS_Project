import { describe, it, expect } from 'vitest';
import {
  isCellClipboardColumn,
  getWbsCellClipboardData,
  buildWbsCellPasteUpdate,
  type WbsCellPasteContext,
  type WbsStatusConfigLite,
} from '../wbsCellClipboard';
import type { Task } from '../../types';

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    projectId: 'p1',
    parentId: null,
    name: 'task',
    startDate: '2026-04-01',
    endDate: '2026-04-10',
    progress: 0,
    assignee: '',
    status: 'todo',
    ...overrides,
  };
}

const STATUS: WbsStatusConfigLite[] = [
  { id: 'todo', name: '예정', progress: 0 },
  { id: 'in-progress', name: '진행중' },
  { id: 'done', name: '완료', progress: 100 },
];

function ctxOf(tasks: Task[], overrides?: Partial<WbsCellPasteContext>): WbsCellPasteContext {
  return { tasks, visibleTaskIds: tasks.map((t) => t.id), statusConfigs: STATUS, effortUnit: 'day', ...overrides };
}

const copyCtx = (tasks: Task[]) => ({ statusConfigs: STATUS, visibleTaskIds: tasks.map((t) => t.id) });

describe('isCellClipboardColumn', () => {
  it('작업명·wbsId·파생(계획율/차이)·투입율은 셀 복사 대상이 아님(행 복사 폴백)', () => {
    for (const col of ['name', 'wbsId', 'plannedProgress', 'progressVariance', 'allocation'] as const) {
      expect(isCellClipboardColumn(col)).toBe(false);
    }
  });
  it('값 셀(날짜·기간·공수·상태·선행·사용자 컬럼 등)은 셀 복사 대상', () => {
    for (const col of [
      'startDate',
      'endDate',
      'duration',
      'workEffort',
      'weight',
      'progress',
      'assignee',
      'status',
      'deliverables',
      'dependencies',
      'custom:memo',
    ] as const) {
      expect(isCellClipboardColumn(col)).toBe(true);
    }
  });
});

describe('getWbsCellClipboardData', () => {
  it('작업명 셀은 null(행 복사 유지)', () => {
    const t = makeTask({ id: 'a' });
    expect(getWbsCellClipboardData(t, 'name', copyCtx([t]))).toBeNull();
  });

  it('날짜 셀은 시간 접미사를 떼고 YYYY-MM-DD 텍스트로', () => {
    const t = makeTask({ id: 'a', startDate: '2026-04-01T09:00:00' });
    expect(getWbsCellClipboardData(t, 'startDate', copyCtx([t]))?.text).toBe('2026-04-01');
  });

  it('기간 셀은 양 끝 포함 달력일 수 텍스트로', () => {
    const t = makeTask({ id: 'a', startDate: '2026-04-01', endDate: '2026-04-10' });
    expect(getWbsCellClipboardData(t, 'duration', copyCtx([t]))?.text).toBe('10');
  });

  it('상태 셀은 표시명 텍스트 + 정확 복원용 statusId', () => {
    const t = makeTask({ id: 'a', status: 'in-progress' });
    const cell = getWbsCellClipboardData(t, 'status', copyCtx([t]));
    expect(cell?.text).toBe('진행중');
    expect(cell?.statusId).toBe('in-progress');
  });

  it('선행 셀은 표시 순서 행 번호 텍스트(정렬) + 원본 id 목록', () => {
    const a = makeTask({ id: 'a' });
    const b = makeTask({ id: 'b' });
    const c = makeTask({ id: 'c', dependencies: ['b', 'a'] });
    const cell = getWbsCellClipboardData(c, 'dependencies', copyCtx([a, b, c]));
    expect(cell?.text).toBe('1, 2');
    expect(cell?.depIds).toEqual(['b', 'a']);
  });

  it('셀 서식(cellTextStyles)이 있으면 함께 복사', () => {
    const t = makeTask({ id: 'a', workEffort: 3, cellTextStyles: { workEffort: { bold: true } } });
    const cell = getWbsCellClipboardData(t, 'workEffort', copyCtx([t]));
    expect(cell?.text).toBe('3');
    expect(cell?.style).toEqual({ bold: true });
  });

  it('값이 비어 있는 셀도 빈 텍스트로 복사됨(엑셀과 동일)', () => {
    const t = makeTask({ id: 'a' });
    expect(getWbsCellClipboardData(t, 'workEffort', copyCtx([t]))?.text).toBe('');
  });
});

describe('buildWbsCellPasteUpdate — 컬럼별 파싱(셀 편집기 커밋 규칙과 동일)', () => {
  it('작업명: 트림해 반영, 빈 값은 거부, 같은 값은 변경 없음', () => {
    const t = makeTask({ id: 'a', name: '설계' });
    expect(buildWbsCellPasteUpdate(t, 'name', { text: ' 새 이름 ' }, ctxOf([t])).updates).toEqual({ name: '새 이름' });
    expect(buildWbsCellPasteUpdate(t, 'name', { text: '  ' }, ctxOf([t])).error).toBeTruthy();
    const same = buildWbsCellPasteUpdate(t, 'name', { text: '설계' }, ctxOf([t]));
    expect(same.updates).toBeNull();
    expect(same.error).toBeUndefined();
  });

  it('날짜: 8자리 등 다양한 표기를 정규화하고 대상의 시간 접미사를 보존', () => {
    const t = makeTask({ id: 'a', startDate: '2026-04-01T00:00:00' });
    const res = buildWbsCellPasteUpdate(t, 'startDate', { text: '20260415' }, ctxOf([t]));
    expect(res.updates).toEqual({ startDate: '2026-04-15T00:00:00' });
    expect(buildWbsCellPasteUpdate(t, 'startDate', { text: 'abcd' }, ctxOf([t])).error).toBeTruthy();
  });

  it('기간: 시작일 기준 양 끝 포함으로 종료일을 역산, 1 미만·시작일 없음은 거부', () => {
    const t = makeTask({ id: 'a', startDate: '2026-04-01', endDate: '2026-04-10' });
    expect(buildWbsCellPasteUpdate(t, 'duration', { text: '5' }, ctxOf([t])).updates).toEqual({ endDate: '2026-04-05' });
    expect(buildWbsCellPasteUpdate(t, 'duration', { text: '0' }, ctxOf([t])).error).toBeTruthy();
    const noStart = makeTask({ id: 'b', startDate: '' });
    expect(buildWbsCellPasteUpdate(noStart, 'duration', { text: '5' }, ctxOf([noStart])).error).toBeTruthy();
  });

  it('공수: 프로젝트 단위에 맞춰 반올림(분=정수, 그 외 소수 1자리), 음수 거부', () => {
    const t = makeTask({ id: 'a' });
    expect(buildWbsCellPasteUpdate(t, 'workEffort', { text: '3.456' }, ctxOf([t])).updates).toEqual({ workEffort: 3.5 });
    expect(buildWbsCellPasteUpdate(t, 'workEffort', { text: '3.456' }, ctxOf([t], { effortUnit: 'minute' })).updates).toEqual({
      workEffort: 3,
    });
    expect(buildWbsCellPasteUpdate(t, 'workEffort', { text: '-1' }, ctxOf([t])).error).toBeTruthy();
  });

  it('진척률: %·공백 접미사 허용, 0~100 밖은 거부', () => {
    const t = makeTask({ id: 'a', progress: 0 });
    expect(buildWbsCellPasteUpdate(t, 'progress', { text: '50%' }, ctxOf([t])).updates).toEqual({ progress: 50 });
    expect(buildWbsCellPasteUpdate(t, 'progress', { text: '33.333' }, ctxOf([t])).updates).toEqual({ progress: 33.33 });
    expect(buildWbsCellPasteUpdate(t, 'progress', { text: '150' }, ctxOf([t])).error).toBeTruthy();
  });

  it('가중치: 소수 1자리 반올림', () => {
    const t = makeTask({ id: 'a' });
    expect(buildWbsCellPasteUpdate(t, 'weight', { text: '2.34' }, ctxOf([t])).updates).toEqual({ weight: 2.3 });
  });

  it('담당: 트림 반영, 빈 값은 배정 해제로 허용', () => {
    const t = makeTask({ id: 'a', assignee: '홍길동' });
    expect(buildWbsCellPasteUpdate(t, 'assignee', { text: ' 김철수 ' }, ctxOf([t])).updates).toEqual({ assignee: '김철수' });
    expect(buildWbsCellPasteUpdate(t, 'assignee', { text: '' }, ctxOf([t])).updates).toEqual({ assignee: '' });
  });

  it('상태: 표시명으로 매칭하고 상태에 매핑된 진척률을 함께 반영, statusId가 있으면 우선', () => {
    const t = makeTask({ id: 'a', status: 'todo', progress: 0 });
    expect(buildWbsCellPasteUpdate(t, 'status', { text: '완료' }, ctxOf([t])).updates).toEqual({ status: 'done', progress: 100 });
    expect(buildWbsCellPasteUpdate(t, 'status', { text: '진행중' }, ctxOf([t])).updates).toEqual({ status: 'in-progress' });
    expect(buildWbsCellPasteUpdate(t, 'status', { text: '엉뚱한이름', statusId: 'done' }, ctxOf([t])).updates).toEqual({
      status: 'done',
      progress: 100,
    });
    expect(buildWbsCellPasteUpdate(t, 'status', { text: '없는상태' }, ctxOf([t])).error).toBeTruthy();
    const same = buildWbsCellPasteUpdate(t, 'status', { text: '예정' }, ctxOf([t]));
    expect(same.updates).toBeNull();
    expect(same.error).toBeUndefined();
  });

  it('산출물: 빈 값 붙여넣기는 비우기(undefined)로 반영', () => {
    const t = makeTask({ id: 'a', deliverables: '보고서' });
    const res = buildWbsCellPasteUpdate(t, 'deliverables', { text: '' }, ctxOf([t]));
    expect(res.error).toBeUndefined();
    expect(res.updates).toHaveProperty('deliverables', undefined);
  });

  it('사용자 컬럼: 원문 그대로(트림 없음) customFields에 병합', () => {
    const t = makeTask({ id: 'a', customFields: { 'custom:memo': 'old', 'custom:etc': 'keep' } });
    const res = buildWbsCellPasteUpdate(t, 'custom:memo', { text: 'new ' }, ctxOf([t]));
    expect(res.updates).toEqual({ customFields: { 'custom:memo': 'new ', 'custom:etc': 'keep' } });
  });
});

describe('buildWbsCellPasteUpdate — 선행작업', () => {
  it('같은 프로젝트면 복사한 id를 복원하되 자기 자신·중복·없는 id는 제외', () => {
    const a = makeTask({ id: 'a' });
    const b = makeTask({ id: 'b' });
    const c = makeTask({ id: 'c' });
    const res = buildWbsCellPasteUpdate(
      c,
      'dependencies',
      { text: '1', depIds: ['a', 'c', 'a', 'ghost'], sourceProjectId: 'p1' },
      ctxOf([a, b, c]),
    );
    expect(res.updates).toEqual({ dependencies: ['a'] });
  });

  it('다른 프로젝트에서 복사했으면 행 번호 텍스트를 현재 표시 순서로 해석', () => {
    const a = makeTask({ id: 'a' });
    const b = makeTask({ id: 'b' });
    const c = makeTask({ id: 'c' });
    const res = buildWbsCellPasteUpdate(c, 'dependencies', { text: '1, 2', depIds: ['x'], sourceProjectId: 'p-other' }, ctxOf([a, b, c]));
    expect(res.updates).toEqual({ dependencies: ['a', 'b'] });
  });

  it('순환 의존관계가 생기면 거부', () => {
    const a = makeTask({ id: 'a' });
    const b = makeTask({ id: 'b', dependencies: ['a'] });
    const res = buildWbsCellPasteUpdate(a, 'dependencies', { text: '2', depIds: ['b'], sourceProjectId: 'p1' }, ctxOf([a, b]));
    expect(res.error).toMatch(/순환/);
  });

  it('빈 값 붙여넣기는 선행 해제, 숫자 아닌 텍스트는 거부', () => {
    const a = makeTask({ id: 'a' });
    const b = makeTask({ id: 'b', dependencies: ['a'] });
    expect(buildWbsCellPasteUpdate(b, 'dependencies', { text: '' }, ctxOf([a, b])).updates).toEqual({ dependencies: [] });
    expect(buildWbsCellPasteUpdate(b, 'dependencies', { text: 'abc' }, ctxOf([a, b])).error).toBeTruthy();
  });
});

describe('buildWbsCellPasteUpdate — 서식·보호 규칙', () => {
  it('원본 셀 서식은 값이 같아도 함께 적용(대상 다른 컬럼 서식은 유지)', () => {
    const t = makeTask({ id: 'a', startDate: '2026-04-01', cellTextStyles: { name: { bold: true } } });
    const res = buildWbsCellPasteUpdate(t, 'startDate', { text: '2026-04-01', style: { backgroundColor: '#fee2e2' } }, ctxOf([t]));
    expect(res.error).toBeUndefined();
    expect(res.updates).toEqual({
      cellTextStyles: { name: { bold: true }, startDate: { backgroundColor: '#fee2e2' } },
    });
  });

  it('값도 서식도 같으면 변경 없음(updates null, error 없음)', () => {
    const t = makeTask({ id: 'a', startDate: '2026-04-01', cellTextStyles: { startDate: { bold: true } } });
    const res = buildWbsCellPasteUpdate(t, 'startDate', { text: '2026-04-01', style: { bold: true } }, ctxOf([t]));
    expect(res.updates).toBeNull();
    expect(res.error).toBeUndefined();
  });

  it('거울(mirrored) 작업과 자동 계산·미지원 셀은 거부', () => {
    const mirrored = makeTask({ id: 'a', mirroredFromTaskId: 'origin' });
    expect(buildWbsCellPasteUpdate(mirrored, 'assignee', { text: '김' }, ctxOf([mirrored])).error).toBeTruthy();
    const t = makeTask({ id: 'b' });
    for (const col of ['wbsId', 'plannedProgress', 'progressVariance', 'allocation'] as const) {
      expect(buildWbsCellPasteUpdate(t, col, { text: '10' }, ctxOf([t])).error).toBeTruthy();
    }
  });
});
