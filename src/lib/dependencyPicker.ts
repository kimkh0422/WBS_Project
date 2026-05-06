import type { Task } from '../types';

/** 쉼표 뒤(또는 전체 문자열)에서 현재 입력 중인 토큰 */
export function getActiveDependencyToken(raw: string): string {
  const i = Math.max(raw.lastIndexOf(','), raw.lastIndexOf('，'));
  const tail = i >= 0 ? raw.slice(i + 1) : raw;
  return tail.trim();
}

export function filterTasksForDependencyPicker(
  candidates: Task[],
  token: string,
  displayWbsMap: Map<string, string>,
  opts: { tableRowById?: Map<string, number>; modalIndexById?: Map<string, number> },
  maxResults = 12,
): Task[] {
  const q = token.trim().toLowerCase();
  // 토큰 없음(F2/포커스 직후, 또는 쉼표만 입력한 직후): 전체 후보를 maxResults까지 노출.
  // 사용자는 빈 입력 상태에서도 목록을 보고 곧바로 선택 가능.
  if (!q) return candidates.slice(0, maxResults);

  const matches = (t: Task): boolean => {
    const name = (t.name || '').toLowerCase();
    if (name.includes(q)) return true;
    const wbs = (displayWbsMap.get(t.id) || '').replace(/^#/, '').toLowerCase();
    if (wbs && wbs.includes(q)) return true;
    const tr = opts.tableRowById?.get(t.id);
    const mi = opts.modalIndexById?.get(t.id);
    if (/^\d+$/.test(q)) {
      if (tr != null && (String(tr) === q || String(tr).startsWith(q))) return true;
      if (mi != null && (String(mi) === q || String(mi).startsWith(q))) return true;
    }
    return false;
  };

  const out: Task[] = [];
  for (const t of candidates) {
    if (matches(t)) {
      out.push(t);
      if (out.length >= maxResults) break;
    }
  }
  return out;
}

export function hasDependencyCycle(tasks: Task[], taskId: string, newDeps: string[]): boolean {
  const depsMap = new Map<string, string[]>();
  for (const t of tasks) {
    if (t.id !== taskId) depsMap.set(t.id, t.dependencies ?? []);
  }
  depsMap.set(taskId, newDeps);
  const visited = new Set<string>();
  const stack = new Set<string>();
  const dfs = (id: string): boolean => {
    if (stack.has(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    stack.add(id);
    for (const dep of depsMap.get(id) ?? []) {
      if (dfs(dep)) return true;
    }
    stack.delete(id);
    return false;
  };
  return dfs(taskId);
}
