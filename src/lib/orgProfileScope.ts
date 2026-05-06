import type { OrgNode } from '../data/organization';

export function findOrgNodeById(root: OrgNode | null | undefined, id: string): OrgNode | null {
  if (!root) return null;
  if (root.id === id) return root;
  for (const c of root.children ?? []) {
    const f = findOrgNodeById(c, id);
    if (f) return f;
  }
  return null;
}

/** 노드 및 하위 노드의 모든 부서 매핑 문자열(departments 배열과 동일). */
export function collectDepartmentAliasesUnderNode(root: OrgNode | null | undefined): Set<string> {
  const s = new Set<string>();
  if (!root) return s;
  const walk = (n: OrgNode) => {
    for (const d of n.departments ?? []) {
      const t = d.trim();
      if (t) s.add(d);
    }
    for (const c of n.children ?? []) walk(c);
  };
  walk(root);
  return s;
}

export function departmentInManagedSubtree(
  memberDepartment: string | null | undefined,
  managedOrgNodeId: string | null | undefined,
  orgTree: OrgNode,
): boolean {
  const raw = memberDepartment?.trim();
  if (!raw || !managedOrgNodeId?.trim()) return false;
  const node = findOrgNodeById(orgTree, managedOrgNodeId.trim());
  if (!node) return false;
  const allowed = collectDepartmentAliasesUnderNode(node);
  for (const a of allowed) {
    if (a.trim() === raw) return true;
  }
  return false;
}

export interface FlatOrgNodeChoice {
  id: string;
  label: string;
}

export function flattenOrgNodesWithDepth(tree: OrgNode): FlatOrgNodeChoice[] {
  const out: FlatOrgNodeChoice[] = [];
  const walk = (n: OrgNode, depth: number) => {
    const pad = depth > 0 ? `${'  '.repeat(depth)}` : '';
    out.push({ id: n.id, label: `${pad}${n.name}` });
    for (const c of n.children ?? []) walk(c, depth + 1);
  };
  walk(tree, 0);
  return out;
}
