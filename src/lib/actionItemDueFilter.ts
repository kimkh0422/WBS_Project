import { endOfWeek, format, isValid, parseISO, startOfWeek } from 'date-fns';
import type { Task } from '../types';

/** 대시보드 액션 항목 마감일(종료일) 구간 필터 */
export type ActionDueDateFilter = 'today' | 'thisWeek' | 'overdue';

/** 종료일 문자열에서 달력일(YYYY-MM-DD)만 추출·검증. 유효하지 않으면 null */
export function parseTaskDueDay(endDate: string | undefined): string | null {
  const raw = (endDate || '').trim();
  if (!raw) return null;
  const day = raw.length >= 10 ? raw.slice(0, 10) : raw;
  const d = parseISO(day);
  return isValid(d) ? format(d, 'yyyy-MM-dd') : null;
}

/** 액션 항목이면서 마감일(종료일)이 지정·파싱 가능한 작업만 */
export function getActionTasksWithDueDate(tasks: Task[]): Task[] {
  return tasks.filter((t) => t.isActionItem && parseTaskDueDay(t.endDate));
}

export function filterActionTasksByDuePeriod(
  tasks: Task[],
  filter: ActionDueDateFilter,
  now: Date,
  isCompleted: (t: Task) => boolean,
): Task[] {
  const todayStr = format(now, 'yyyy-MM-dd');
  const weekStartStr = format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const weekEndStr = format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd');

  return tasks.filter((t) => {
    const end = parseTaskDueDay(t.endDate);
    if (!end) return false;
    if (filter === 'today') return end === todayStr;
    if (filter === 'thisWeek') return end >= weekStartStr && end <= weekEndStr;
    return end < todayStr && !isCompleted(t);
  });
}

export function sortActionTasksByEndDate(a: Task, b: Task): number {
  const ea = parseTaskDueDay(a.endDate) ?? '';
  const eb = parseTaskDueDay(b.endDate) ?? '';
  const c = ea.localeCompare(eb);
  return c !== 0 ? c : (a.name || '').localeCompare(b.name || '', 'ko');
}
