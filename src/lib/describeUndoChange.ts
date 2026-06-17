import type { Task } from '../types';

const FIELD_LABELS: Record<string, string> = {
  name: '작업명',
  startDate: '시작일',
  endDate: '종료일',
  progress: '진척률',
  assignee: '담당자',
  status: '상태',
  workEffort: '공수',
  description: '설명',
  parentId: '상위 작업',
  dependencies: '선행 작업',
  weight: '가중치',
  isMilestone: '마일스톤',
  isIssue: '이슈',
  isActionItem: '액션 항목',
  plannedProgressOverride: '계획율',
  customFields: '사용자 정의',
  checklist: '체크리스트',
  deliverables: '산출물',
  baselineStartDate: '베이스라인 시작일',
  baselineEndDate: '베이스라인 종료일',
  baselineWorkEffort: '베이스라인 공수',
};

const COMPARE_KEYS = Object.keys(FIELD_LABELS) as (keyof Task)[];

function summarizeFieldNames(fields: string[]): string {
  const set = new Set(fields);
  const onlySchedule = set.size > 0 && [...set].every((f) => f === 'startDate' || f === 'endDate' || f === 'dependencies');
  if (onlySchedule && (set.has('startDate') || set.has('endDate'))) return '일정';
  if (fields.length === 1) return FIELD_LABELS[fields[0]!] ?? '내용';
  if (fields.length <= 3) return fields.map((f) => FIELD_LABELS[f] ?? f).join('·');
  return '여러 항목';
}

function diffTaskFields(before: Task, after: Task): string[] {
  const changed: string[] = [];
  for (const key of COMPARE_KEYS) {
    const a = before[key];
    const b = after[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) changed.push(key);
  }
  return changed;
}

function formatWithLabel(label: string, kind: 'undo' | 'redo'): string {
  return kind === 'undo' ? `「${label}」 되돌림` : `「${label}」 다시 실행`;
}

/** 실행 취소·다시 실행 토스트용 — current에서 target 상태로 바뀐 내용을 요약한다. */
export function describeUndoChange(current: Task[], target: Task[], kind: 'undo' | 'redo', actionLabel?: string): string {
  if (actionLabel?.trim()) return formatWithLabel(actionLabel.trim(), kind);

  const currentIds = new Set(current.map((t) => t.id));
  const targetIds = new Set(target.map((t) => t.id));
  const added = current.filter((t) => !targetIds.has(t.id));
  const removed = target.filter((t) => !currentIds.has(t.id));
  if (added.length > 0 && removed.length === 0) {
    if (added.length === 1) return `「${added[0]!.name}」 추가 되돌림`;
    return `작업 ${added.length}개 추가 되돌림`;
  }
  if (removed.length > 0 && added.length === 0) {
    if (removed.length === 1) return `「${removed[0]!.name}」 삭제 되돌림`;
    return `작업 ${removed.length}개 복원`;
  }
  if (added.length > 0 && removed.length > 0) {
    return kind === 'undo' ? '구조 변경 되돌림' : '구조 변경 다시 실행';
  }

  const targetById = new Map(target.map((t) => [t.id, t]));
  const modified: { task: Task; fields: string[] }[] = [];
  for (const t of current) {
    const prev = targetById.get(t.id);
    if (!prev) continue;
    const fields = diffTaskFields(prev, t);
    if (fields.length > 0) modified.push({ task: t, fields });
  }

  if (modified.length === 0) {
    return kind === 'undo' ? '변경 되돌림' : '변경 다시 실행';
  }
  if (modified.length === 1) {
    const { task, fields } = modified[0]!;
    const fieldLabel = summarizeFieldNames(fields);
    const suffix = kind === 'undo' ? '되돌림' : '다시 실행';
    return `「${task.name}」 ${fieldLabel} ${suffix}`;
  }
  const suffix = kind === 'undo' ? '변경 되돌림' : '변경 다시 실행';
  return `작업 ${modified.length}개 ${suffix}`;
}
