import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderOpen, Users } from 'lucide-react';
import { BaseModal } from './Base/Modal';
import type { OrgNode, OrgMember } from '../data/organization';
import { useOrganization, getDirectMembersFromTree, countMembersDeepFromTree } from '../context/OrganizationContext';
import { cn } from '../lib/utils';

interface OrganizationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TreeNodeProps {
  node: OrgNode;
  depth: number;
  expanded: Set<string>;
  toggle: (id: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  members: OrgMember[];
}

const TreeNodeView: React.FC<TreeNodeProps> = ({ node, depth, expanded, toggle, selectedId, onSelect, members }) => {
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isOpen = expanded.has(node.id);
  const isSelected = selectedId === node.id;
  const total = countMembersDeepFromTree(node, members);

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1.5 py-1 pr-2 rounded-md cursor-pointer text-sm select-none',
          isSelected ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-slate-50 text-slate-700',
        )}
        style={{ paddingLeft: 6 + depth * 16 }}
        onClick={() => onSelect(node.id)}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggle(node.id);
            }}
            className="text-slate-400 hover:text-slate-700 shrink-0"
            aria-label={isOpen ? '접기' : '펼치기'}
          >
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="w-[14px] shrink-0" />
        )}
        {hasChildren ? (
          isOpen ? (
            <FolderOpen size={14} className="text-amber-500 shrink-0" />
          ) : (
            <Folder size={14} className="text-amber-500 shrink-0" />
          )
        ) : (
          <Folder size={14} className="text-emerald-500 shrink-0" />
        )}
        <span className="truncate">{node.name}</span>
        <span className="ml-auto text-xs text-slate-400 shrink-0">({total})</span>
      </div>
      {hasChildren && isOpen && (
        <div>
          {node.children!.map((c) => (
            <TreeNodeView
              key={c.id}
              node={c}
              depth={depth + 1}
              expanded={expanded}
              toggle={toggle}
              selectedId={selectedId}
              onSelect={onSelect}
              members={members}
            />
          ))}
        </div>
      )}
    </div>
  );
};

function findNodeById(node: OrgNode, id: string): OrgNode | null {
  if (node.id === id) return node;
  for (const c of node.children ?? []) {
    const f = findNodeById(c, id);
    if (f) return f;
  }
  return null;
}

function collectAllIds(node: OrgNode, into: string[] = []): string[] {
  into.push(node.id);
  for (const c of node.children ?? []) collectAllIds(c, into);
  return into;
}

const POSITION_ORDER = ['대표이사', '고문', '전무', '상무', '이사', '수석', '책임', '선임', '전임', '연구원', '사원'];

function sortMembers(members: OrgMember[]): OrgMember[] {
  return [...members].sort((a, b) => {
    const pa = POSITION_ORDER.indexOf(a.position);
    const pb = POSITION_ORDER.indexOf(b.position);
    const ia = pa === -1 ? POSITION_ORDER.length : pa;
    const ib = pb === -1 ? POSITION_ORDER.length : pb;
    if (ia !== ib) return ia - ib;
    return a.name.localeCompare(b.name, 'ko');
  });
}

export function OrganizationModal({ isOpen, onClose }: OrganizationModalProps) {
  const { orgTree, orgMembers, isLoading, isHydratedFromDb } = useOrganization();

  const initialExpanded = useMemo(() => {
    // 기본: 최상위 2단계만 펼침
    const set = new Set<string>();
    set.add(orgTree.id);
    for (const c of orgTree.children ?? []) set.add(c.id);
    return set;
  }, [orgTree]);
  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded);
  const [selectedId, setSelectedId] = useState<string | null>('gmt-root');

  // 트리가 바뀌면(DB 로드 완료) 펼침 상태 재초기화
  React.useEffect(() => {
    setExpanded(initialExpanded);
  }, [initialExpanded]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(collectAllIds(orgTree)));
  const collapseAll = () => setExpanded(new Set([orgTree.id]));

  const selectedNode = selectedId ? findNodeById(orgTree, selectedId) : null;

  // 선택 노드의 직속 인원 + 자식 노드별 그룹화하여 표시
  const groupedMembers = useMemo(() => {
    if (!selectedNode) return [] as { label: string; members: OrgMember[] }[];
    const groups: { label: string; members: OrgMember[] }[] = [];
    const direct = getDirectMembersFromTree(selectedNode, orgMembers);
    if (direct.length > 0) {
      groups.push({ label: `${selectedNode.name} 직속`, members: sortMembers(direct) });
    }
    const walkChild = (node: OrgNode) => {
      const directOfChild = getDirectMembersFromTree(node, orgMembers);
      if (directOfChild.length > 0) {
        groups.push({ label: node.name, members: sortMembers(directOfChild) });
      }
      for (const c of node.children ?? []) walkChild(c);
    };
    for (const c of selectedNode.children ?? []) walkChild(c);
    return groups;
  }, [selectedNode, orgMembers]);

  const totalSelected = selectedNode ? countMembersDeepFromTree(selectedNode, orgMembers) : 0;

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      title={
        <span className="flex items-center gap-2">
          <Users size={18} className="text-indigo-500" />
          조직 현황
          <span className="text-xs font-normal text-slate-400">
            총 {countMembersDeepFromTree(orgTree, orgMembers)}명
            {isLoading && !isHydratedFromDb && <span className="ml-2 text-slate-300">(로드 중…)</span>}
          </span>
        </span>
      }
      bodyClassName="p-0"
    >
      <div className="flex flex-col md:flex-row" style={{ height: 'min(72vh, 640px)' }}>
        <aside className="w-full md:w-72 border-b md:border-b-0 md:border-r border-slate-200 flex flex-col">
          <div className="flex items-center justify-end gap-1 px-2 py-1.5 border-b border-slate-100 text-xs">
            <button type="button" onClick={expandAll} className="px-2 py-1 rounded text-slate-500 hover:bg-slate-100">
              모두 펼치기
            </button>
            <button type="button" onClick={collapseAll} className="px-2 py-1 rounded text-slate-500 hover:bg-slate-100">
              모두 접기
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            <TreeNodeView
              node={orgTree}
              depth={0}
              expanded={expanded}
              toggle={toggle}
              selectedId={selectedId}
              onSelect={setSelectedId}
              members={orgMembers}
            />
          </div>
        </aside>
        <section className="flex-1 overflow-y-auto p-4 bg-slate-50/40">
          {selectedNode ? (
            <div className="space-y-4">
              <header className="flex items-baseline gap-2">
                <h3 className="text-base font-semibold text-slate-800">{selectedNode.name}</h3>
                <span className="text-xs text-slate-500">{totalSelected}명</span>
              </header>
              {groupedMembers.length === 0 ? (
                <div className="text-sm text-slate-500">소속 인원이 없습니다.</div>
              ) : (
                groupedMembers.map((g) => (
                  <div key={g.label} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                    <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 flex items-center gap-2">
                      <span>{g.label}</span>
                      <span className="text-slate-400 font-normal">{g.members.length}명</span>
                    </div>
                    <table className="w-full text-sm">
                      <tbody>
                        {g.members.map((m, idx) => (
                          <tr key={`${m.name}-${idx}`} className="border-t border-slate-100 first:border-t-0">
                            <td className="px-3 py-1.5 text-slate-400 text-xs w-12">{idx + 1}</td>
                            <td className="px-3 py-1.5 text-slate-800">{m.name}</td>
                            <td className="px-3 py-1.5 text-slate-600 w-24">{m.position}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="text-sm text-slate-500">노드를 선택해 주세요.</div>
          )}
        </section>
      </div>
    </BaseModal>
  );
}
