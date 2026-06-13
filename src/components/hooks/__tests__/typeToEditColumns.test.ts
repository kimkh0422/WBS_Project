import { describe, it, expect } from 'vitest';
import { canTypeToEditColumn } from '../useWbsTableKeyboard';
import type { TableColumnId } from '../../wbsTableTypes';

describe('canTypeToEditColumn — 타이핑 즉시 편집 대상 컬럼', () => {
  it('uncontrolled 텍스트/숫자 셀(leaf)은 허용', () => {
    for (const col of [
      'name',
      'startDate',
      'endDate',
      'duration',
      'workEffort',
      'weight',
      'progress',
      'assignee',
      'deliverables',
      'allocation',
      'dependencies',
    ] as const) {
      expect(canTypeToEditColumn(col, false)).toBe(true);
    }
  });

  it('사용자 정의 컬럼(custom:*)도 허용', () => {
    expect(canTypeToEditColumn('custom:memo' as TableColumnId, false)).toBe(true);
  });

  it('select·파생 셀은 제외(첫 글자 주입이 맞지 않음) — allocation·dependencies는 시드 전달로 허용', () => {
    for (const col of ['status', 'plannedProgress', 'progressVariance', 'wbsId'] as TableColumnId[]) {
      expect(canTypeToEditColumn(col, false)).toBe(false);
    }
  });

  it('요약(자식 있는) 행에서도 일정·진척·공수·투입 등은 타이핑 즉시 편집 허용', () => {
    for (const col of ['startDate', 'endDate', 'duration', 'workEffort', 'progress'] as const) {
      expect(canTypeToEditColumn(col, true)).toBe(true);
    }
  });

  it('작업명·가중치·담당·산출물·사용자 컬럼은 자식이 있어도 직접 입력 허용(롤업 대상 아님)', () => {
    for (const col of ['name', 'weight', 'assignee', 'deliverables', 'custom:memo'] as TableColumnId[]) {
      expect(canTypeToEditColumn(col, true)).toBe(true);
    }
  });
});
