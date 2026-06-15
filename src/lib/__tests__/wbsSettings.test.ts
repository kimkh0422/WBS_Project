import { describe, it, expect } from 'vitest';
import { parseSettings, DEFAULT_SETTINGS, resolveStoredTableColumnVisible } from '../wbsSettings';

describe('resolveStoredTableColumnVisible', () => {
  it('visible 생략 시 공수·가중치는 기본 숨김', () => {
    expect(resolveStoredTableColumnVisible('workEffort', undefined)).toBe(false);
    expect(resolveStoredTableColumnVisible('weight', undefined)).toBe(false);
  });
  it('저장이 true여도 공수·가중치 컬럼은 항상 숨김', () => {
    expect(resolveStoredTableColumnVisible('workEffort', true)).toBe(false);
    expect(resolveStoredTableColumnVisible('weight', true)).toBe(false);
  });
  it('visible 생략 시 작업명 등은 DEFAULT_SETTINGS를 따른다', () => {
    expect(resolveStoredTableColumnVisible('name', undefined)).toBe(true);
    expect(resolveStoredTableColumnVisible('status', undefined)).toBe(false);
  });
  it('custom 컬럼은 visible 생략 시 표시로 간주', () => {
    expect(resolveStoredTableColumnVisible('custom:1', undefined)).toBe(true);
  });
});

describe('parseSettings — 공수 컬럼 강제 재숨김 마이그레이션', () => {
  it('기본 설정에서 공수 컬럼은 숨김이다', () => {
    const we = DEFAULT_SETTINGS.tableColumns?.find((c) => c.id === 'workEffort');
    expect(we?.visible).toBe(false);
  });

  it('기본 설정에서 진척차이(%p) 컬럼은 숨김이다', () => {
    const pv = DEFAULT_SETTINGS.tableColumns?.find((c) => c.id === 'progressVariance');
    expect(pv?.visible).toBe(false);
  });

  it('공수→기간 마이그레이션이 끝난 뒤 사용자가 다시 켜 둔 공수 컬럼도 재숨김한다', () => {
    const raw = {
      tableColumns: [
        { id: 'name', visible: true },
        { id: 'endDate', visible: true },
        { id: 'duration', visible: true },
        { id: 'workEffort', visible: true }, // 사용자가 켜 둔 상태
      ],
      // 기존 공수→기간 마이그레이션은 이미 끝남 → 그 블록은 재실행되지 않음.
      workEffortToDurationMigrated: true,
      // 새 재숨김 마이그레이션 플래그는 없음 → 새 마이그레이션만 동작해야 한다.
    };
    const s = parseSettings(raw);
    expect(s.tableColumns?.find((c) => c.id === 'workEffort')?.visible).toBe(false);
    expect(s.workEffortReHiddenMigrated).toBe(true);
  });

  it('재숨김 마이그레이션이 1회 적용된 뒤에도 공수 컬럼은 항상 비표시로 해석된다', () => {
    const raw = {
      tableColumns: [
        { id: 'name', visible: true },
        { id: 'workEffort', visible: true }, // 마이그레이션 후 사용자가 재활성화
      ],
      // 모든 컬럼 숨김 계열 마이그레이션이 이미 끝난 상태로 둬서 재실행되지 않게 한다.
      allocationHiddenMigrated: true,
      deliverablesHiddenMigrated: true,
      dependenciesHiddenMigrated: true,
      actionsHiddenMigrated: true,
      statusHiddenMigrated: true,
      wbsIdHiddenMigrated: true,
      workEffortToDurationMigrated: true,
      tableProgressLayoutMigrated: true,
      workEffortReHiddenMigrated: true,
      workEffortReHiddenMigratedV2: true,
      allocationReHiddenMigrated: true,
      standardVisibleColumnsMigrated: true,
    };
    const s = parseSettings(raw);
    expect(s.tableColumns?.find((c) => c.id === 'workEffort')?.visible).toBe(false);
  });

  it('2차 재숨김: 1차 재숨김 후 다시 켜 둔 공수도 한 번 더 숨김한다', () => {
    const raw = {
      tableColumns: [
        { id: 'name', visible: true },
        { id: 'workEffort', visible: true }, // 1차 재숨김 후 사용자가 다시 켬
      ],
      // 1차 재숨김·표준화 등은 이미 끝난 상태로 둬서 2차 재숨김만 동작하게 한다.
      allocationHiddenMigrated: true,
      deliverablesHiddenMigrated: true,
      dependenciesHiddenMigrated: true,
      actionsHiddenMigrated: true,
      statusHiddenMigrated: true,
      wbsIdHiddenMigrated: true,
      workEffortToDurationMigrated: true,
      tableProgressLayoutMigrated: true,
      workEffortReHiddenMigrated: true,
      allocationReHiddenMigrated: true,
      standardVisibleColumnsMigrated: true,
      // workEffortReHiddenMigratedV2 없음 → 2차 재숨김만 동작해야 한다.
    };
    const s = parseSettings(raw);
    expect(s.tableColumns?.find((c) => c.id === 'workEffort')?.visible).toBe(false);
    expect(s.workEffortReHiddenMigratedV2).toBe(true);
  });
});

describe('parseSettings — 표 기본 표시 컬럼 표준화 마이그레이션', () => {
  it('표준 표시 집합으로 1회 정규화한다 (접두어 WBS ID 숨김·가중치 숨김 등)', () => {
    const raw = {
      tableColumns: [
        { id: 'wbsId', visible: false }, // 사용자가 끔 → 표준화 후에도 접두어 ID 칸은 숨김 유지
        { id: 'name', visible: true },
        { id: 'startDate', visible: true },
        { id: 'endDate', visible: true },
        { id: 'duration', visible: true },
        { id: 'assignee', visible: true },
        { id: 'weight', visible: true }, // 사용자가 켬 → 표준화로 숨김
        { id: 'status', visible: true }, // 사용자가 켬 → 표준화로 숨김
        { id: 'plannedProgress', visible: true },
        { id: 'progress', visible: true },
        { id: 'progressVariance', visible: true },
        { id: 'custom:abc', visible: true }, // 사용자 정의 컬럼은 유지
      ],
      // 표준화 외 다른 마이그레이션은 끝난 상태로 둬 간섭 방지
      allocationHiddenMigrated: true,
      deliverablesHiddenMigrated: true,
      dependenciesHiddenMigrated: true,
      actionsHiddenMigrated: true,
      statusHiddenMigrated: true,
      wbsIdHiddenMigrated: true,
      workEffortToDurationMigrated: true,
      tableProgressLayoutMigrated: true,
      workEffortReHiddenMigrated: true,
      allocationReHiddenMigrated: true,
    };
    const s = parseSettings(raw);
    const vis = (id: string) => s.tableColumns?.find((c) => c.id === id)?.visible;
    expect(vis('wbsId')).toBe(false);
    expect(vis('weight')).toBe(false);
    expect(vis('status')).toBe(false);
    expect(vis('custom:abc')).toBe(true); // 사용자 정의 컬럼 보존
    expect(vis('progressVariance')).toBe(false); // 별도 마이그레이션으로 진척차이 열 기본 숨김
    expect(s.standardVisibleColumnsMigrated).toBe(true);
    expect(s.progressVarianceHiddenMigrated).toBe(true);
  });

  it('표준화가 1회 적용된 뒤에도 가중치 컬럼은 항상 비표시로 해석된다', () => {
    const raw = {
      tableColumns: [
        { id: 'name', visible: true },
        { id: 'weight', visible: true }, // 표준화 후 사용자가 재활성화
      ],
      allocationHiddenMigrated: true,
      deliverablesHiddenMigrated: true,
      dependenciesHiddenMigrated: true,
      actionsHiddenMigrated: true,
      statusHiddenMigrated: true,
      wbsIdHiddenMigrated: true,
      workEffortToDurationMigrated: true,
      tableProgressLayoutMigrated: true,
      workEffortReHiddenMigrated: true,
      allocationReHiddenMigrated: true,
      standardVisibleColumnsMigrated: true,
    };
    const s = parseSettings(raw);
    expect(s.tableColumns?.find((c) => c.id === 'weight')?.visible).toBe(false);
  });

  it('이미 표준화된 저장값에서도 접두어 WBS ID 컬럼은 1회 숨김으로 정리된다', () => {
    const raw = {
      tableColumns: [
        { id: 'wbsId', visible: true },
        { id: 'name', visible: true },
      ],
      allocationHiddenMigrated: true,
      deliverablesHiddenMigrated: true,
      dependenciesHiddenMigrated: true,
      actionsHiddenMigrated: true,
      statusHiddenMigrated: true,
      wbsIdHiddenMigrated: true,
      workEffortToDurationMigrated: true,
      tableProgressLayoutMigrated: true,
      workEffortReHiddenMigrated: true,
      workEffortReHiddenMigratedV2: true,
      allocationReHiddenMigrated: true,
      standardVisibleColumnsMigrated: true,
    };
    const s = parseSettings(raw);
    expect(s.tableColumns?.find((c) => c.id === 'wbsId')?.visible).toBe(false);
    expect(s.wbsIdPrefixColumnRetiredMigrated).toBe(true);
  });
});
