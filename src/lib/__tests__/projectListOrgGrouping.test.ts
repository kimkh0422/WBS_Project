import { describe, expect, it } from 'vitest';
import { ORG_MEMBERS, ORG_TREE, type OrgNode } from '../../data/organization';
import type { Project } from '../../types';
import {
  buildOrgChartBranchUnderNode,
  buildOrgChartProjectListBlocks,
  findDeepestOrgNodeForDepartment,
  getDashboardTopLevelDivisions,
  isNodeInSubtree,
  resolveProjectDepartmentForOrgList,
} from '../projectListOrgGrouping';

describe('projectListOrgGrouping', () => {
  it('findDeepestOrgNodeForDepartment는 동일 부서명이 여러 노드에 있을 때 더 깊은 노드를 고른다', () => {
    const tree: OrgNode = {
      id: 'root',
      name: '회사',
      children: [
        {
          id: 'biz',
          name: '사업부',
          departments: ['영업팀'],
          children: [{ id: 'team', name: '영업1팀', departments: ['영업팀'] }],
        },
      ],
    };
    const hit = findDeepestOrgNodeForDepartment(tree, '영업팀');
    expect(hit?.id).toBe('team');
  });

  it('정적 조직 트리에서 운영기술개발실 부서는 해당 노드에 매핑된다', () => {
    const n = findDeepestOrgNodeForDepartment(ORG_TREE, '운영기술개발실');
    expect(n?.id).toBe('op-tech');
  });

  it('buildOrgChartProjectListBlocks는 PM 조직 부서 기준으로 사업부 블록에 넣는다', () => {
    const pm = ORG_MEMBERS.find((m) => m.department === '모빌리티사업1팀');
    expect(pm).toBeTruthy();
    const projects: Project[] = [
      {
        id: 'p1',
        name: '테스트 프로젝트',
        pmName: pm!.name,
      },
    ];
    const { blocks, unmapped } = buildOrgChartProjectListBlocks(projects, ORG_TREE, ORG_MEMBERS, {});
    expect(unmapped).toHaveLength(0);
    const mobility = blocks.find((b) => b.division.id === 'mobility-biz');
    expect(mobility?.totalInBlock).toBe(1);
    const team1 = mobility?.branch.children.find((c) => c.nodeId === 'mobility-1');
    expect(team1?.projects.map((p) => p.id)).toEqual(['p1']);
  });

  it('resolveProjectDepartmentForOrgList는 PM이 없을 때 소유자 프로필 부서를 쓴다', () => {
    const p: Project = { id: 'x', name: 'A', ownerId: 'u1' };
    const dept = resolveProjectDepartmentForOrgList(p, ORG_MEMBERS, { u1: 'AI개발실' });
    expect(dept).toBe('AI개발실');
  });

  it('getDashboardTopLevelDivisions는 gmt-root의 직속 자식 목록을 반환한다', () => {
    const divs = getDashboardTopLevelDivisions(ORG_TREE);
    expect(divs.length).toBeGreaterThan(0);
    expect(divs.some((d) => d.id === 'mobility-biz')).toBe(true);
  });

  it('buildOrgChartBranchUnderNode는 앵커가 일치하는 프로젝트만 해당 노드에 둔다', () => {
    const anchor = new Map<string, string>([
      ['a', 'n1'],
      ['b', 'n2'],
    ]);
    const node: OrgNode = {
      id: 'root',
      name: '루트',
      children: [
        { id: 'n1', name: '팀1', departments: ['D1'] },
        { id: 'n2', name: '팀2', departments: ['D2'] },
      ],
    };
    const projects: Project[] = [
      { id: 'a', name: 'P1' },
      { id: 'b', name: 'P2' },
    ];
    const br = buildOrgChartBranchUnderNode(node, projects, anchor, 0);
    expect(br.projects).toHaveLength(0);
    expect(br.children).toHaveLength(2);
  });

  it('isNodeInSubtree는 자손 탐지에 사용된다', () => {
    const node: OrgNode = { id: 'r', name: 'R', children: [{ id: 'c', name: 'C' }] };
    expect(isNodeInSubtree(node, 'c')).toBe(true);
    expect(isNodeInSubtree(node, 'x')).toBe(false);
  });
});
