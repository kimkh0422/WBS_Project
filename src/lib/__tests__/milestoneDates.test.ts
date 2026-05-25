import { describe, expect, it } from 'vitest';
import { applyMilestoneDateInvariant } from '../milestoneDates';
import type { Task } from '../../types';

const base = (over: Partial<Task>): Task =>
  ({
    id: '1',
    projectId: 'p',
    name: 't',
    ...over,
  }) as Task;

describe('applyMilestoneDateInvariant', () => {
  it('비마일스톤은 그대로 둔다', () => {
    const t = base({ isMilestone: false, startDate: '2026-01-01', endDate: '2026-01-05', workEffort: 2 });
    expect(applyMilestoneDateInvariant(t)).toBe(t);
  });

  it('마일스톤은 시작·종료를 같은 날로 맞추고 공수 0', () => {
    const t = base({ isMilestone: true, startDate: '2026-01-01', endDate: '2026-01-10', workEffort: 3 });
    const out = applyMilestoneDateInvariant(t);
    expect(out.startDate).toBe('2026-01-01');
    expect(out.endDate).toBe('2026-01-01');
    expect(out.workEffort).toBe(0);
  });

  it('종료일만 있으면 시작을 종료에 맞춘다', () => {
    const t = base({ isMilestone: true, startDate: undefined, endDate: '2026-02-02', workEffort: 1 });
    const out = applyMilestoneDateInvariant(t);
    expect(out.startDate).toBe('2026-02-02');
    expect(out.endDate).toBe('2026-02-02');
    expect(out.workEffort).toBe(0);
  });

  it('타임존 접미가 있으면 보존한다', () => {
    const t = base({
      isMilestone: true,
      startDate: '2026-03-01T00:00:00.000Z',
      endDate: '2026-03-05',
      workEffort: 2,
    });
    const out = applyMilestoneDateInvariant(t);
    expect(out.startDate).toBe('2026-03-01T00:00:00.000Z');
    expect(out.endDate).toBe('2026-03-01T00:00:00.000Z');
  });
});
