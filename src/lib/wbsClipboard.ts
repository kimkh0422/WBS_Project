import type { Task } from '../types';
import { v4 as uuidv4 } from 'uuid';

export interface PasteClipboardContext {
  /** 붙여넣을 작업 배열(복사 시점의 Task 스냅샷) */
  clipboard: Task[];
  /** 붙여넣기 기준 행 — 이 행의 형제로, 이 행 바로 아래에 첫 루트부터 삽입. null이면 표 끝에 추가 */
  targetId: string | null;
  /** 표시 순서의 작업 id 목록(기준 행이 없을 때 마지막 행 뒤에 삽입용) */
  visibleTaskIds: string[];
  /** 현재 프로젝트 전체 작업(기준 행의 parentId 조회용) */
  tasks: Task[];
  /** 한 번에 삽입 — 연속 addTask 시 DB upsert 경쟁으로 행이 누락되는 것을 방지 */
  insertPastedTasksInOrder: (
    rows: Array<{ id: string; draft: Omit<Task, 'id' | 'projectId'>; insertAfterId?: string }>,
    projectIdOverride?: string,
  ) => string[];
  updateTask: (id: string, updates: Partial<Task>) => void;
}

/**
 * 내부 작업 클립보드(복사된 Task 배열)를 트리 구조·선행관계를 보존하며 붙여넣는다.
 *
 * insertPastedTasksInOrder()가 id를 미리 받아 한 번에 삽입하므로, OLD→NEW id 매핑을 만들어
 * 자식이 고아가 되어 렌더링되지 않는다. 따라서 OLD→NEW id 매핑을 만들어
 * 부모가 자식보다 먼저 생성되도록 위상 정렬로 추가한 뒤 선행관계를 재연결한다.
 *
 * @returns 새로 추가된 작업들의 id (표시 순서)
 */
export function pasteClipboardTasks(ctx: PasteClipboardContext): string[] {
  const { clipboard, targetId, visibleTaskIds, tasks, insertPastedTasksInOrder, updateTask } = ctx;
  if (clipboard.length === 0) return [];

  // 기준 행이 있으면 그 행 바로 뒤에, 없으면 표 끝에 추가.
  const fallbackInsertAfterId = visibleTaskIds.length > 0 ? visibleTaskIds[visibleTaskIds.length - 1] : undefined;
  const baseInsertAfterId: string | undefined = targetId ?? fallbackInsertAfterId;

  // 기준 행이 있으면 그 행의 형제로(같은 부모 아래), 없으면 루트로 붙여넣는다.
  const selectedTask = targetId ? tasks.find((t) => t.id === targetId) : undefined;
  const pasteParentId: string | null = selectedTask?.parentId ?? null;

  const clipboardIdSet = new Set(clipboard.map((t) => t.id));
  const idToNewId = new Map<string, string>();

  let insertAfterId: string | undefined = baseInsertAfterId;
  const insertRows: Array<{ id: string; draft: Omit<Task, 'id' | 'projectId'>; insertAfterId?: string }> = [];

  // 부모가 자식보다 먼저 생성되도록 추가(복사 집합 내부 부모가 이미 만들어진 항목 우선).
  const pending = [...clipboard];
  let safety = 0;
  while (pending.length > 0 && safety < clipboard.length * 4) {
    const idx = pending.findIndex((t) => !t.parentId || !clipboardIdSet.has(t.parentId) || idToNewId.has(t.parentId));
    const t = idx === -1 ? pending[0] : pending[idx];
    pending.splice(idx === -1 ? 0 : idx, 1);

    const isRootOfCopy = !(t.parentId && clipboardIdSet.has(t.parentId));
    const newParentId = isRootOfCopy ? pasteParentId : (idToNewId.get(t.parentId!) ?? pasteParentId);

    const newId = uuidv4();
    // 복사하면 안 되는/계산 필드 제거. 선행관계 재연결은 모든 id가 생긴 뒤로 미룸.
    const { id: _id, projectId: _pid, depth: _depth, dependencies: _deps, ...rest } = t as Task & { depth?: number };
    insertRows.push({
      id: newId,
      draft: {
        ...rest,
        parentId: newParentId,
        expanded: true,
        dependencies: undefined,
      } as Omit<Task, 'id' | 'projectId'>,
      insertAfterId: isRootOfCopy ? insertAfterId : undefined,
    });

    if (isRootOfCopy) insertAfterId = newId;
    idToNewId.set(t.id, newId);
    safety += 1;
  }

  insertPastedTasksInOrder(insertRows);

  const addedIds = insertRows.map((r) => r.id);
  // 모든 새 id가 만들어진 뒤 복사 집합 내부의 선행관계를 재연결.
  for (const t of clipboard) {
    const newId = idToNewId.get(t.id);
    if (!newId) continue;
    const mappedDeps = (t.dependencies ?? [])
      .filter((depId) => clipboardIdSet.has(depId))
      .map((depId) => idToNewId.get(depId))
      .filter(Boolean) as string[];
    if (mappedDeps.length > 0) {
      updateTask(newId, { dependencies: mappedDeps });
    }
  }

  return addedIds;
}
