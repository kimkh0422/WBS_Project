import type { Task } from '../types';

/** 작업명 인라인 input DOM 값만 커밋한다. blur/onBlur에 의존하지 않는다. */
export function commitWbsInlineNameEditFromDom(
  taskId: string,
  tasks: Task[],
  updateTask: (id: string, updates: Partial<Task>) => void,
  canEdit: boolean,
) {
  if (!canEdit) return;
  const input = document.getElementById(`wbs-edit-${taskId}-name`) as HTMLInputElement | null;
  const t = tasks.find((x) => x.id === taskId);
  if (!input || !t) return;
  const trimmed = input.value.trim();
  if (trimmed && trimmed !== t.name) updateTask(taskId, { name: trimmed });
}
