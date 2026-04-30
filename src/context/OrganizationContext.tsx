import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { fetchOrgNodes, fetchOrgMembers, type OrgNodeRow, type OrgMemberRow } from '../lib/db/organization';
import { isSupabaseConfigured } from '../lib/supabase';
import { ORG_TREE as STATIC_ORG_TREE, ORG_MEMBERS as STATIC_ORG_MEMBERS, type OrgNode, type OrgMember } from '../data/organization';
import { useAuth } from './AuthContext';

interface OrganizationContextValue {
  /** 트리 루트(최상위 1개 가정). DB 조회 전에는 정적 JSON 폴백을 그대로 반환한다. */
  orgTree: OrgNode;
  /** 인원 평탄 목록. 정렬은 sort_order. */
  orgMembers: OrgMember[];
  /** DB 로드 진행 중 여부. true → 폴백 데이터 표시 중일 수 있음. */
  isLoading: boolean;
  /** DB 로드 한 번이라도 성공했는지. false면 정적 JSON 폴백 사용 중. */
  isHydratedFromDb: boolean;
  /** 마지막 로드 에러 메시지 (디버깅용). */
  error: string | null;
  /** 강제 재조회 (관리자 편집 후 호출 등) */
  reload: () => Promise<void>;
}

const OrganizationContext = createContext<OrganizationContextValue | undefined>(undefined);

/** DB 행들을 OrgNode 트리로 조립 */
function buildTreeFromRows(nodeRows: OrgNodeRow[], memberRows: OrgMemberRow[]): { tree: OrgNode; members: OrgMember[] } {
  const sortedNodes = [...nodeRows].sort((a, b) => a.sort_order - b.sort_order);
  const byId = new Map<string, OrgNode>();
  for (const r of sortedNodes) {
    byId.set(r.id, {
      id: r.id,
      name: r.name,
      departments: r.department_aliases ?? [],
      children: [],
    });
  }
  let root: OrgNode | null = null;
  for (const r of sortedNodes) {
    const node = byId.get(r.id)!;
    if (r.parent_id) {
      const parent = byId.get(r.parent_id);
      if (parent) {
        parent.children = parent.children ?? [];
        parent.children.push(node);
      }
    } else if (!root) {
      root = node;
    }
  }
  // 빈 children 배열 정리 — 정적 트리와 동일 형태(자식 없는 노드는 children 미정의)
  for (const node of byId.values()) {
    if (node.children && node.children.length === 0) delete node.children;
  }

  const members: OrgMember[] = memberRows
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((m) => ({
      name: m.name,
      department: m.department,
      position: m.position,
      gender: m.gender,
    }));

  return { tree: root ?? STATIC_ORG_TREE, members };
}

export function OrganizationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [orgTree, setOrgTree] = useState<OrgNode>(STATIC_ORG_TREE);
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>(STATIC_ORG_MEMBERS);
  const [isLoading, setIsLoading] = useState(false);
  const [isHydratedFromDb, setIsHydratedFromDb] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const load = React.useCallback(async () => {
    if (!isSupabaseConfigured) return;
    if (!user?.id) return; // RLS: 로그인 사용자만 조회 가능
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setIsLoading(true);
    setError(null);
    try {
      const [nodeRows, memberRows] = await Promise.all([fetchOrgNodes(), fetchOrgMembers()]);
      if (nodeRows.length === 0) {
        // DB에 시드가 적용되지 않은 환경 — 정적 JSON 유지
        if (import.meta.env.DEV) console.warn('[Organization] DB에 org_nodes 데이터 없음 — 정적 JSON 사용');
        return;
      }
      const { tree, members } = buildTreeFromRows(nodeRows, memberRows);
      setOrgTree(tree);
      setOrgMembers(members);
      setIsHydratedFromDb(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '조직 데이터를 불러오지 못했습니다.';
      setError(msg);
      if (import.meta.env.DEV) console.warn('[Organization] DB 조회 실패, 정적 JSON 폴백 사용:', e);
    } finally {
      setIsLoading(false);
      inFlightRef.current = false;
    }
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const value = useMemo<OrganizationContextValue>(
    () => ({ orgTree, orgMembers, isLoading, isHydratedFromDb, error, reload: load }),
    [orgTree, orgMembers, isLoading, isHydratedFromDb, error, load],
  );

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}

export function useOrganization(): OrganizationContextValue {
  const ctx = useContext(OrganizationContext);
  if (!ctx) {
    throw new Error('useOrganization must be used within an <OrganizationProvider>');
  }
  return ctx;
}

/** 노드 직속 인원만 반환 (자식 노드 제외) */
export function getDirectMembersFromTree(node: OrgNode, members: OrgMember[]): OrgMember[] {
  if (!node.departments || node.departments.length === 0) return [];
  const set = new Set(node.departments);
  return members.filter((m) => set.has(m.department));
}

/** 노드 + 모든 하위 노드 인원 합계 */
export function countMembersDeepFromTree(node: OrgNode, members: OrgMember[]): number {
  let total = getDirectMembersFromTree(node, members).length;
  for (const child of node.children ?? []) total += countMembersDeepFromTree(child, members);
  return total;
}
