import { describe, it, expect } from 'vitest';
import { parseSettings, DEFAULT_SETTINGS } from '../wbsSettings';

describe('parseSettings — 공수 컬럼 강제 재숨김 마이그레이션', () => {
  it('기본 설정에서 공수 컬럼은 숨김이다', () => {
    const we = DEFAULT_SETTINGS.tableColumns?.find((c) => c.id === 'workEffort');
    expect(we?.visible).toBe(false);
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

  it('재숨김 마이그레이션이 1회 적용된 뒤에는 사용자가 다시 켠 공수 컬럼을 유지한다', () => {
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
    expect(s.tableColumns?.find((c) => c.id === 'workEffort')?.visible).toBe(true);
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
  it('표준 표시 집합으로 1회 정규화한다 (WBS 표시, 가중치 숨김 등)', () => {
    const raw = {
      tableColumns: [
        { id: 'wbsId', visible: false }, // 사용자가 끔 → 표준화로 다시 표시
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
    expect(vis('wbsId')).toBe(true);
    expect(vis('weight')).toBe(false);
    expect(vis('status')).toBe(false);
    expect(vis('custom:abc')).toBe(true); // 사용자 정의 컬럼 보존
    expect(s.standardVisibleColumnsMigrated).toBe(true);
  });

  it('표준화가 1회 적용된 뒤에는 사용자가 다시 켠 컬럼(가중치 등)을 유지한다', () => {
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
    expect(s.tableColumns?.find((c) => c.id === 'weight')?.visible).toBe(true);
  });
});
