import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Search, FileText, FolderOpen, ArrowRight, Hash } from 'lucide-react';
import { useWBS } from '../context/WBSContext';
import { useAuth } from '../context/AuthContext';
import { cn, formatPercent1 } from '../lib/utils';
import { MODAL_BACKDROP_CLASS, MODAL_PANEL_BASE_CLASS } from '../lib/modalChrome';
import { isComposingKeyEvent } from '../lib/ime';
import { useOrganization } from '../context/OrganizationContext';
import { buildOrgMemberDisplayMetaMap, formatAssigneeDisplay } from '../lib/assigneeOptions';
import { formatProjectDisplayName, isPrivateProjectHiddenFromViewer } from '../lib/projectKind';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTask: (taskId: string, projectId: string) => void;
  onSelectProject: (projectId: string) => void;
}

interface SearchResult {
  type: 'task' | 'project';
  id: string;
  projectId: string;
  title: string;
  subtitle: string;
  wbs?: string;
  progress?: number;
  status?: string;
}

export function SearchModal({ isOpen, onClose, onSelectTask, onSelectProject }: SearchModalProps) {
  const { allTasks, projects, wbsMap, wbsSettings } = useWBS();
  const { user } = useAuth();
  const { orgMembers } = useOrganization();
  const assigneeDisplayMetaByName = useMemo(() => buildOrgMemberDisplayMetaMap(orgMembers), [orgMembers]);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 모달 열릴 때 초기화 + 포커스
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const visibleProjects = useMemo(() => projects.filter((p) => !isPrivateProjectHiddenFromViewer(p, user?.id)), [projects, user?.id]);
  const visibleProjectIdSet = useMemo(() => new Set(visibleProjects.map((p) => p.id)), [visibleProjects]);

  // 프로젝트 이름 맵
  const projectNameMap = useMemo(() => {
    const m = new Map<string, string>();
    visibleProjects.forEach((p) => m.set(p.id, formatProjectDisplayName(p.name, p.projectKind)));
    return m;
  }, [visibleProjects]);

  // 상태 이름 맵
  const statusNameMap = useMemo(() => {
    const m = new Map<string, string>();
    (wbsSettings.statusConfigs ?? []).forEach((c) => m.set(c.id, c.name));
    return m;
  }, [wbsSettings.statusConfigs]);

  // 검색 결과
  const results = useMemo((): SearchResult[] => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const items: SearchResult[] = [];

    // 프로젝트 검색
    for (const p of visibleProjects) {
      const display = formatProjectDisplayName(p.name, p.projectKind);
      if (p.name.toLowerCase().includes(q) || display.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q)) {
        items.push({
          type: 'project',
          id: p.id,
          projectId: p.id,
          title: display,
          subtitle: p.description || '설명 없음',
        });
      }
    }

    // 작업 검색
    for (const t of allTasks) {
      if (!visibleProjectIdSet.has(t.projectId)) continue;
      const nameMatch = t.name.toLowerCase().includes(q);
      const assigneeMatch = (t.assignee ?? '').toLowerCase().includes(q);
      const wbsCode = wbsMap.get(t.id) ?? '';
      const wbsMatch = wbsCode.toLowerCase().includes(q);

      if (nameMatch || assigneeMatch || wbsMatch) {
        items.push({
          type: 'task',
          id: t.id,
          projectId: t.projectId,
          title: t.name,
          subtitle: `${projectNameMap.get(t.projectId) ?? ''} · ${formatAssigneeDisplay(t.assignee, assigneeDisplayMetaByName) || '미배정'}`,
          wbs: wbsCode,
          progress: t.progress,
          status: statusNameMap.get(t.status) ?? t.status,
        });
      }
    }

    return items.slice(0, 50); // 최대 50개
  }, [query, visibleProjects, visibleProjectIdSet, allTasks, wbsMap, projectNameMap, statusNameMap, assigneeDisplayMetaByName]);

  // 선택 인덱스 범위 유지
  useEffect(() => {
    setSelectedIndex(0);
  }, [results.length]);

  // 선택 항목 스크롤
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleSelect = useCallback(
    (item: SearchResult) => {
      if (item.type === 'project') {
        onSelectProject(item.projectId);
      } else {
        onSelectTask(item.id, item.projectId);
      }
      onClose();
    },
    [onSelectTask, onSelectProject, onClose],
  );

  /** 브라우저 기본 툴팁(title): 마우스 오버 시 항목 유형·동작·주요 필드를 한눈에 안내 */
  const resultTooltip = useCallback((item: SearchResult) => {
    if (item.type === 'project') {
      const desc = item.subtitle && item.subtitle !== '설명 없음' ? `프로젝트 설명: ${item.subtitle}` : '등록된 프로젝트 설명이 없습니다.';
      return `프로젝트 — Enter 또는 클릭하면 이 프로젝트를 작업 대상으로 선택합니다. 표시명「${item.title}」. ${desc}`;
    }
    const bits: string[] = [
      '작업 — Enter 또는 클릭하면 이 작업이 있는 프로젝트로 이동합니다.',
      item.wbs ? `WBS 코드 ${item.wbs}.` : '',
      `작업명「${item.title}」.`,
      item.subtitle ? `소속·담당: ${item.subtitle}.` : '',
      item.status ? `상태: ${item.status}.` : '',
      typeof item.progress === 'number' ? `진척도 ${formatPercent1(item.progress)}%.` : '',
    ];
    return bits.filter(Boolean).join(' ');
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isComposingKeyEvent(e.nativeEvent)) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) handleSelect(results[selectedIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className={cn(MODAL_BACKDROP_CLASS, 'z-[70] items-start justify-center pt-[15vh]')} onClick={onClose}>
      <div className={cn(MODAL_PANEL_BASE_CLASS, 'relative max-w-lg overflow-hidden')} onClick={(e) => e.stopPropagation()}>
        {/* 검색 입력 */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-line)]">
          <Search size={18} className="text-[var(--color-ink-muted)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="작업명, 프로젝트, 담당자, WBS 번호로 검색..."
            title="작업명·프로젝트명·프로젝트 설명·담당자 표시명·WBS 코드로 검색합니다. ↑↓로 결과 이동, Enter로 열기, Esc로 닫기."
            className="flex-1 bg-transparent text-[var(--color-ink)] text-sm outline-none placeholder:text-[var(--color-ink-muted)]"
          />
          <kbd className="hidden sm:inline-flex text-[10px] font-mono px-1.5 py-0.5 rounded border border-[var(--color-line)] text-[var(--color-ink-muted)]">
            ESC
          </kbd>
        </div>

        {/* 결과 목록 */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
          {query.trim() === '' ? (
            <div className="px-4 py-8 text-center text-sm text-[var(--color-ink-muted)]">검색어를 입력하세요</div>
          ) : results.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-[var(--color-ink-muted)]">"{query}" 검색 결과가 없습니다</div>
          ) : (
            results.map((item, idx) => (
              <button
                key={`${item.type}-${item.id}`}
                type="button"
                className={cn(
                  'w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors',
                  idx === selectedIndex ? 'bg-[var(--color-accent-soft)]' : 'hover:bg-[var(--color-line-soft)]',
                )}
                title={resultTooltip(item)}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <div
                  className={cn(
                    'w-7 h-7 rounded-lg flex items-center justify-center shrink-0',
                    item.type === 'project' ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-500',
                  )}
                >
                  {item.type === 'project' ? <FolderOpen size={14} /> : <FileText size={14} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {item.wbs && <span className="text-[10px] font-mono text-[var(--color-ink-muted)] shrink-0">{item.wbs}</span>}
                    <span className="text-sm font-medium text-[var(--color-ink)] truncate">{item.title}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-muted)]">
                    <span className="break-words">{item.subtitle}</span>
                    {item.status && (
                      <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--color-line-soft)]">
                        {item.status}
                      </span>
                    )}
                    {typeof item.progress === 'number' && (
                      <span className="shrink-0 text-[10px] font-mono">{formatPercent1(item.progress)}%</span>
                    )}
                  </div>
                </div>
                <ArrowRight
                  size={14}
                  className={cn(
                    'shrink-0 text-[var(--color-ink-muted)] transition-opacity',
                    idx === selectedIndex ? 'opacity-100' : 'opacity-0',
                  )}
                />
              </button>
            ))
          )}
        </div>

        {/* 하단 힌트 */}
        {results.length > 0 && (
          <div className="px-4 py-2 border-t border-[var(--color-line)] flex items-center gap-4 text-[10px] text-[var(--color-ink-muted)]">
            <span>
              <kbd className="font-mono px-1 py-0.5 rounded border border-[var(--color-line)]">↑↓</kbd> 이동
            </span>
            <span>
              <kbd className="font-mono px-1 py-0.5 rounded border border-[var(--color-line)]">Enter</kbd> 선택
            </span>
            <span className="ml-auto">{results.length}개 결과</span>
          </div>
        )}
      </div>
    </div>
  );
}
