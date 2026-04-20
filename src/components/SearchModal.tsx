import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Search, FileText, FolderOpen, ArrowRight, Hash } from 'lucide-react';
import { useWBS } from '../context/WBSContext';
import { cn } from '../lib/utils';
import { isComposingKeyEvent } from '../lib/ime';

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

  // 프로젝트 이름 맵
  const projectNameMap = useMemo(() => {
    const m = new Map<string, string>();
    projects.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [projects]);

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
    for (const p of projects) {
      if (p.name.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q)) {
        items.push({
          type: 'project',
          id: p.id,
          projectId: p.id,
          title: p.name,
          subtitle: p.description || '설명 없음',
        });
      }
    }

    // 작업 검색
    for (const t of allTasks) {
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
          subtitle: `${projectNameMap.get(t.projectId) ?? ''} · ${t.assignee || '미배정'}`,
          wbs: wbsCode,
          progress: t.progress,
          status: statusNameMap.get(t.status) ?? t.status,
        });
      }
    }

    return items.slice(0, 50); // 최대 50개
  }, [query, projects, allTasks, wbsMap, projectNameMap, statusNameMap]);

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
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[15vh] p-4" onClick={onClose}>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg bg-[var(--color-surface)] border border-[var(--color-line)] rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
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
                  <div className="flex items-center gap-2 text-xs text-[var(--color-ink-muted)] truncate">
                    <span className="truncate">{item.subtitle}</span>
                    {item.status && (
                      <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--color-line-soft)]">
                        {item.status}
                      </span>
                    )}
                    {typeof item.progress === 'number' && <span className="shrink-0 text-[10px] font-mono">{item.progress}%</span>}
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
