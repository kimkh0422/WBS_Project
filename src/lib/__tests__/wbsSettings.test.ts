import { describe, it, expect } from 'vitest';
import { parseSettings, DEFAULT_SETTINGS, resolveStoredTableColumnVisible } from '../wbsSettings';

describe('resolveStoredTableColumnVisible', () => {
  it('visible 생략 시 가중치는 기본 숨김', () => {
    expect(resolveStoredTableColumnVisible('weight', undefined)).toBe(false);
  });
  it('저장이 true여도 가중치 컬럼은 항상 숨김', () => {
    expect(resolveStoredTableColumnVisible('weight', true)).toBe(false);
  });
  it('공수(workEffort)는 저장값·기본값을 따른다', () => {
    expect(resolveStoredTableColumnVisible('workEffort', undefined)).toBe(true);
    expect(resolveStoredTableColumnVisible('workEffort', false)).toBe(false);
    expect(resolveStoredTableColumnVisible('workEffort', true)).toBe(true);
  });
  it('visible 생략 시 작업명 등은 DEFAULT_SETTINGS를 따른다', () => {
    expect(resolveStoredTableColumnVisible('name', undefined)).toBe(true);
    expect(resolveStoredTableColumnVisible('status', undefined)).toBe(false);
  });
  it('custom 컬럼은 visible 생략 시 표시로 간주', () => {
    expect(resolveStoredTableColumnVisible('custom:1', undefined)).toBe(true);
  });
});

describe('parseSettings — 기본 컬럼', () => {
  it('기본 설정에서 투입 공수·업무 구성비 컬럼은 표시', () => {
    const we = DEFAULT_SETTINGS.tableColumns?.find((c) => c.id === 'workEffort');
    const wc = DEFAULT_SETTINGS.tableColumns?.find((c) => c.id === 'workComposition');
    expect(we?.visible).toBe(true);
    expect(wc?.visible).toBe(true);
  });

  it('기본 설정에서 진척차이(%p) 컬럼은 숨김이다', () => {
    const pv = DEFAULT_SETTINGS.tableColumns?.find((c) => c.id === 'progressVariance');
    expect(pv?.visible).toBe(false);
  });

  it('공수·구성비 기본 표시 마이그레이션: 공수 켜고 구성비 열이 없으면 삽입', () => {
    const raw = {
      tableColumns: [
        { id: 'name', visible: true },
        { id: 'workEffort', visible: false },
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
      wbsIdPrefixColumnRetiredMigrated: true,
      progressVarianceHiddenMigrated: true,
    };
    const s = parseSettings(raw);
    expect(s.workEffortCompositionDefaultsMigrated).toBe(true);
    expect(s.tableColumns?.find((c) => c.id === 'workEffort')?.visible).toBe(true);
    expect(s.tableColumns?.find((c) => c.id === 'workComposition')?.visible).toBe(true);
  });
});

describe('parseSettings — 표 기본 표시 컬럼 표준화 마이그레이션', () => {
  it('표준 표시 집합으로 1회 정규화한다 (접두어 WBS ID 숨김·가중치 숨김 등)', () => {
    const raw = {
      tableColumns: [
        { id: 'wbsId', visible: false },
        { id: 'name', visible: true },
        { id: 'startDate', visible: true },
        { id: 'endDate', visible: true },
        { id: 'duration', visible: true },
        { id: 'assignee', visible: true },
        { id: 'weight', visible: true },
        { id: 'status', visible: true },
        { id: 'plannedProgress', visible: true },
        { id: 'progress', visible: true },
        { id: 'progressVariance', visible: true },
        { id: 'custom:abc', visible: true },
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
    };
    const s = parseSettings(raw);
    const vis = (id: string) => s.tableColumns?.find((c) => c.id === id)?.visible;
    expect(vis('wbsId')).toBe(false);
    expect(vis('weight')).toBe(false);
    expect(vis('status')).toBe(false);
    expect(vis('custom:abc')).toBe(true);
    expect(vis('progressVariance')).toBe(false);
    expect(s.standardVisibleColumnsMigrated).toBe(true);
    expect(s.progressVarianceHiddenMigrated).toBe(true);
  });

  it('표준화가 1회 적용된 뒤에도 가중치 컬럼은 항상 비표시로 해석된다', () => {
    const raw = {
      tableColumns: [
        { id: 'name', visible: true },
        { id: 'weight', visible: true },
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
