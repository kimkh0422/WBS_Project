import type { OrgMember, OrgNode } from '../data/organization';
import type { Project } from '../types';

/** 헤더·프로젝트 관리 화면에서 동일 키로 목록 묶음 방식을 공유한다. */
export const PROJECT_LIST_LAYOUT_LS_KEY = 'wbs-header-projects-list-layout';

export type ProjectListLayoutMode = 'kind' | 'group' | 'org';

/** 대시보드와 동일: 조직 트리에서 최상위 사업부·본부 등 나열용 자식 노드 */
export function getDashboardTopLevelDivisions(orgTree: OrgNode): OrgNode[] {
  return orgTree.children?.[0]?.children ?? [];
}

/** `root` 서브트리 안에서 `targetId` 노드가 존재하는지(자기 자신 포함) */
export function isNodeInSubtree(root: OrgNode, targetId: string): boolean {
  if (root.id === targetId) return true;
  for (const c of root.children ?? []) {
    if (isNodeInSubtree(c, targetId)) return true;
  }
  return false;
}

/**
 * 조직 노드의 `departments`에 포함되는 부서명에 대해, 트리에서 가장 깊은(가장 구체적인) 노드를 찾는다.
 */
export function findDeepestOrgNodeForDepartment(root: OrgNode, department: string): OrgNode | null {
  const d = department.trim();
  if (!d) return null;
  let best: { node: OrgNode; depth: number } | null = null;
  const walk = (node: OrgNode, depth: number) => {
    const match = (node.departments ?? []).some((x) => String(x).trim() === d);
    if (match && (!best || depth > best.depth)) best = { node, depth };
    for (const c of node.children ?? []) walk(c, depth + 1);
  };
  walk(root, 0);
  return best?.node ?? null;
}

/**
 * PM 이름이 조직 인원과 일치하면 그 부서, 아니면 소유자 프로필 부서(있을 때)를 반환.
 */
export function resolveProjectDepartmentForOrgList(
  project: Project,
  orgMembers: OrgMember[],
  ownerDepartmentByUserId?: Record<string, string | null | undefined>,
): string | null {
  const pm = (project.pmName ?? '').trim();
  if (pm) {
    const m = orgMembers.find((x) => x.name.trim() === pm);
    const od = (m?.department ?? '').trim();
    if (od) return od;
  }
  const oid = project.ownerId;
  if (oid && ownerDepartmentByUserId) {
    const raw = ownerDepartmentByUserId[oid];
    const od = raw != null ? String(raw).trim() : '';
    if (od) return od;
  }
  return null;
}

export type OrgChartGroupBranch = {
  nodeId: string;
  title: string;
  depth: number;
  projects: Project[];
  children: OrgChartGroupBranch[];
};

function sortProjectsByNameKo(a: Project, b: Project): number {
  const na = a.name ?? '';
  const nb = b.name ?? '';
  const c = na.localeCompare(nb, 'ko');
  if (c !== 0) return c;
  return (a.id ?? '').localeCompare(b.id ?? '', 'ko');
}

/**
 * 한 사업부(division) 루트 아래에서, 앵커가 해당 서브트리에 속한 프로젝트만으로 재귀 브랜치를 만든다.
 */
export function buildOrgChartBranchUnderNode(
  node: OrgNode,
  divisionProjects: Project[],
  anchorIdByProjectId: Map<string, string>,
  depth: number,
): OrgChartGroupBranch {
  const projectsHere = divisionProjects.filter((p) => anchorIdByProjectId.get(p.id) === node.id).sort(sortProjectsByNameKo);
  const childBranches = (node.children ?? [])
    .map((ch) => buildOrgChartBranchUnderNode(ch, divisionProjects, anchorIdByProjectId, depth + 1))
    .filter((b) => b.projects.length > 0 || b.children.length > 0);
  return {
    nodeId: node.id,
    title: node.name,
    depth,
    projects: projectsHere,
    children: childBranches,
  };
}

export function countProjectsInOrgBranch(branch: OrgChartGroupBranch): number {
  return branch.projects.length + branch.children.reduce((acc, c) => acc + countProjectsInOrgBranch(c), 0);
}

export type OrgChartListBlock = {
  division: OrgNode;
  branch: OrgChartGroupBranch;
  totalInBlock: number;
};

/** 드롭다운 열 때 조직도 섹션을 한꺼번에 펼치기 위한 키 목록 */
export function collectOrgExpandKeysForBlocks(blocks: OrgChartListBlock[]): string[] {
  const keys: string[] = [];
  const walk = (divId: string, br: OrgChartGroupBranch) => {
    if (countProjectsInOrgBranch(br) === 0) return;
    keys.push(`org:${divId}:${br.nodeId}`);
    for (const c of br.children) walk(divId, c);
  };
  for (const b of blocks) {
    if (b.totalInBlock === 0) continue;
    walk(b.division.id, b.branch);
  }
  return keys;
}

export function flattenOrgChartProjectsForMobile(blocks: OrgChartListBlock[], unmapped: Project[]): { project: Project; path: string }[] {
  const out: { project: Project; path: string }[] = [];
  const walk = (br: OrgChartGroupBranch, parts: string[]) => {
    const segs = [...parts, br.title];
    for (const c of br.children) walk(c, segs);
    const breadcrumb = segs.join(' > ');
    for (const p of br.projects) out.push({ project: p, path: breadcrumb });
  };
  for (const b of blocks) {
    if (b.totalInBlock === 0) continue;
    walk(b.branch, []);
  }
  for (const p of unmapped) out.push({ project: p, path: '조직 미매칭' });
  return out;
}

/**
 * 헤더·프로젝트 관리 목록용: 조직도 최상위 구역별로 프로젝트를 트리에 매핑하고, 매칭 실패분을 분리한다.
 */
export function buildOrgChartProjectListBlocks(
  projects: Project[],
  orgTree: OrgNode,
  orgMembers: OrgMember[],
  ownerDepartmentByUserId?: Record<string, string | null | undefined>,
): { blocks: OrgChartListBlock[]; unmapped: Project[] } {
  const divisions = getDashboardTopLevelDivisions(orgTree);
  const unmapped: Project[] = [];
  if (divisions.length === 0) {
    return { blocks: [], unmapped: [...projects].sort(sortProjectsByNameKo) };
  }

  const anchorIdByProjectId = new Map<string, string>();
  for (const p of projects) {
    const dept = resolveProjectDepartmentForOrgList(p, orgMembers, ownerDepartmentByUserId);
    const anchor = dept ? findDeepestOrgNodeForDepartment(orgTree, dept) : null;
    if (!anchor) {
      unmapped.push(p);
      continue;
    }
    const owningDivision = divisions.find((d) => isNodeInSubtree(d, anchor.id));
    if (!owningDivision) {
      unmapped.push(p);
      continue;
    }
    anchorIdByProjectId.set(p.id, anchor.id);
  }

  unmapped.sort(sortProjectsByNameKo);

  const blocks: OrgChartListBlock[] = divisions.map((division) => {
    const inDiv = projects.filter((proj) => {
      const aid = anchorIdByProjectId.get(proj.id);
      if (!aid) return false;
      return isNodeInSubtree(division, aid);
    });
    const branch = buildOrgChartBranchUnderNode(division, inDiv, anchorIdByProjectId, 0);
    const totalInBlock = countProjectsInOrgBranch(branch);
    return { division, branch, totalInBlock };
  });

  return { blocks, unmapped };
}
