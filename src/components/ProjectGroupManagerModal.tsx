import React, { useState } from 'react';
import { Plus, Trash2, FolderOpen, ChevronUp, ChevronDown } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { BaseModal } from './Base/Modal';
import { useWBS } from '../context/WBSContext';
import type { ProjectGroup } from '../lib/wbsSettings';

interface ProjectGroupManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function sortGroups(groups: ProjectGroup[]): ProjectGroup[] {
  return [...groups].sort((a, b) => {
    const ao = a.sortOrder ?? 0;
    const bo = b.sortOrder ?? 0;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name, 'ko');
  });
}

export function ProjectGroupManagerModal({ isOpen, onClose }: ProjectGroupManagerModalProps) {
  const { wbsSettings, updateWbsSettings, projects, updateProject } = useWBS();
  const groups = sortGroups(wbsSettings.projectGroups ?? []);

  const [newGroupName, setNewGroupName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const persist = (next: ProjectGroup[]) => {
    updateWbsSettings({ projectGroups: next });
  };

  const handleAdd = () => {
    const name = newGroupName.trim();
    if (!name) return;
    const next = [...groups, { id: uuidv4(), name, sortOrder: groups.length }];
    persist(next);
    setNewGroupName('');
  };

  const handleStartEdit = (g: ProjectGroup) => {
    setEditingId(g.id);
    setEditingName(g.name);
  };

  const handleCommitEdit = () => {
    if (!editingId) return;
    const name = editingName.trim();
    if (!name) {
      setEditingId(null);
      setEditingName('');
      return;
    }
    const next = groups.map((g) => (g.id === editingId ? { ...g, name } : g));
    persist(next);
    setEditingId(null);
    setEditingName('');
  };

  const handleDelete = (id: string) => {
    const memberProjects = projects.filter((p) => p.groupId === id);
    const ok = window.confirm(
      memberProjects.length > 0
        ? `이 그룹에 속한 ${memberProjects.length}개 프로젝트가 "그룹 미지정"으로 이동합니다. 삭제할까요?`
        : '그룹을 삭제할까요?',
    );
    if (!ok) return;
    // 그룹 자체 제거
    persist(groups.filter((g) => g.id !== id));
    // 소속 프로젝트의 groupId 비우기
    memberProjects.forEach((p) => updateProject(p.id, { groupId: undefined }));
  };

  const handleMove = (id: string, dir: -1 | 1) => {
    const idx = groups.findIndex((g) => g.id === id);
    if (idx < 0) return;
    const next = [...groups];
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= next.length) return;
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    // sortOrder 재할당
    const reordered = next.map((g, i) => ({ ...g, sortOrder: i }));
    persist(reordered);
  };

  const projectCountByGroup = projects.reduce<Record<string, number>>((acc, p) => {
    if (p.groupId) acc[p.groupId] = (acc[p.groupId] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      size="md"
      title={
        <span className="flex items-center gap-2">
          <FolderOpen size={18} className="text-amber-500" />
          프로젝트 그룹 관리
        </span>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleAdd();
              }
            }}
            placeholder="새 그룹 이름"
            className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!newGroupName.trim()}
            className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            <Plus size={14} /> 추가
          </button>
        </div>

        {groups.length === 0 ? (
          <div className="text-center py-8 text-sm text-slate-400 bg-slate-50/60 rounded-lg border border-dashed border-slate-200">
            아직 그룹이 없습니다. 위에서 새 그룹을 만들어 주세요.
          </div>
        ) : (
          <ul className="space-y-1">
            {groups.map((g, idx) => (
              <li key={g.id} className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg">
                <FolderOpen size={14} className="text-amber-500 shrink-0" />
                {editingId === g.id ? (
                  <input
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        handleCommitEdit();
                      } else if (e.key === 'Escape') {
                        setEditingId(null);
                        setEditingName('');
                      }
                    }}
                    onBlur={handleCommitEdit}
                    autoFocus
                    className="flex-1 px-2 py-1 text-sm border border-indigo-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => handleStartEdit(g)}
                    className="flex-1 text-left text-sm text-slate-800 hover:text-indigo-600 truncate"
                    title="클릭해서 이름 변경"
                  >
                    {g.name}
                  </button>
                )}
                <span className="text-xs text-slate-400 shrink-0">{projectCountByGroup[g.id] ?? 0}개</span>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleMove(g.id, -1)}
                    disabled={idx === 0}
                    className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent rounded"
                    title="위로"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMove(g.id, 1)}
                    disabled={idx === groups.length - 1}
                    className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent rounded"
                    title="아래로"
                  >
                    <ChevronDown size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(g.id)}
                    className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
                    title="삭제"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[11px] text-slate-400 leading-relaxed">
          이름을 클릭하면 변경할 수 있고, 화살표로 순서를 바꿀 수 있습니다. 그룹을 삭제해도 소속 프로젝트는 사라지지 않으며 "그룹
          미지정"으로 이동합니다.
        </p>
      </div>
    </BaseModal>
  );
}
