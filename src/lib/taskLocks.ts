import type { Task } from '../types';

export type UserLockedField = NonNullable<Task['userLockedFields']>[number];

/** 특정 필드 잠금만 제거한 `userLockedFields` 값(없으면 undefined). */
export function userLockedFieldsAfterRemove(
  current: Task['userLockedFields'] | undefined,
  field: UserLockedField,
): Task['userLockedFields'] {
  const arr = current ?? [];
  const next = arr.filter((f) => f !== field);
  return next.length > 0 ? next : undefined;
}

export const USER_LOCKED_FIELD_LABELS: Record<UserLockedField, string> = {
  startDate: '시작일',
  endDate: '종료일',
  workEffort: '공수',
  dependencies: '선행작업',
  progress: '진척률',
};
