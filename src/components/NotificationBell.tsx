import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Bell, Clock, AlertTriangle, CheckCircle, X, ArrowRight, Handshake } from 'lucide-react';
import { cn } from '../lib/utils';
import type { Task } from '../types';
import type { CooperationRequest } from '../lib/db/cooperationRequests';
import { computeCooperationNotifications, type CooperationNotification } from '../lib/notifications/cooperationNotifications';

interface NotificationBellProps {
  allTasks: Task[];
  currentUserDisplay: string;
  onSelectTask: (taskId: string, projectId: string) => void;
  projectNameMap: Map<string, string>;
  statusNameMap: Map<string, string>;
  doneStatusIds: Set<string>;
  /** 협조 요청 원본 데이터 — 다중 멤버 매칭으로 알림 추가 생성 */
  cooperationRequests?: CooperationRequest[];
  /** 협조 매칭에 사용되는 사용자 평문 이름 (currentUserDisplay 는 부서/직위 포함되어 다를 수 있음) */
  currentUserPlainName?: string;
  /** 협조 알림 클릭 시 대시보드의 협조요청 섹션으로 이동 */
  onSelectCooperation?: (requestId: string) => void;
}

interface NotificationItem {
  id: string;
  taskId: string;
  projectId: string;
  taskName: string;
  projectName: string;
  type: 'overdue' | 'due-soon';
  daysInfo: string;
  endDate: string;
}

const DISMISSED_KEY = 'wbs-dismissed-notifications';

export function NotificationBell({
  allTasks,
  currentUserDisplay,
  onSelectTask,
  projectNameMap,
  statusNameMap,
  doneStatusIds,
  cooperationRequests = [],
  currentUserPlainName,
  onSelectCooperation,
}: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 닫기: 외부 클릭
  useEffect(() => {
    if (!isOpen) return;
    const close = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [isOpen]);

  // 확인한 알림 ID
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(DISMISSED_KEY);
      if (saved) return new Set(JSON.parse(saved) as string[]);
    } catch {
      /* ignore */
    }
    return new Set();
  });

  const dismiss = (id: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const dismissAll = () => {
    const ids = [...notifications.map((n) => n.id), ...cooperationNotifications.map((n) => n.id)];
    setDismissedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      try {
        localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // 알림 목록 계산
  const notifications = useMemo((): NotificationItem[] => {
    if (!currentUserDisplay) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);

    const items: NotificationItem[] = [];

    for (const t of allTasks) {
      // 내 담당 작업만
      if ((t.assignee ?? '').trim() !== currentUserDisplay.trim()) continue;
      // 완료된 작업 제외
      if (doneStatusIds.has(t.status)) continue;
      if (typeof t.progress === 'number' && t.progress >= 100) continue;
      // 종료일 없으면 제외
      if (!t.endDate) continue;
      // 리프 작업만 (자식이 있는 부모 작업 제외)
      const hasChildren = allTasks.some((other) => other.parentId === t.id);
      if (hasChildren) continue;

      const endDate = new Date(t.endDate);
      endDate.setHours(0, 0, 0, 0);
      const diffMs = endDate.getTime() - today.getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays < 0) {
        // 기한 초과
        items.push({
          id: `overdue-${t.id}`,
          taskId: t.id,
          projectId: t.projectId,
          taskName: t.name,
          projectName: projectNameMap.get(t.projectId) ?? '',
          type: 'overdue',
          daysInfo: `${Math.abs(diffDays)}일 초과`,
          endDate: t.endDate,
        });
      } else if (diffDays <= 3) {
        // D-3 이내
        items.push({
          id: `due-${t.id}`,
          taskId: t.id,
          projectId: t.projectId,
          taskName: t.name,
          projectName: projectNameMap.get(t.projectId) ?? '',
          type: 'due-soon',
          daysInfo: diffDays === 0 ? '오늘 마감' : `D-${diffDays}`,
          endDate: t.endDate,
        });
      }
    }

    // 기한 초과 먼저, 그다음 임박 순
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'overdue' ? -1 : 1;
      return a.endDate.localeCompare(b.endDate);
    });

    return items;
  }, [allTasks, currentUserDisplay, doneStatusIds, projectNameMap]);

  // 협조 요청 알림 계산 — 현재 사용자가 멤버에 포함된 미완료 요청만.
  const cooperationNotifications = useMemo<CooperationNotification[]>(() => {
    if (!currentUserPlainName) return [];
    const todayIso = new Date().toISOString().slice(0, 10);
    return computeCooperationNotifications(cooperationRequests, currentUserPlainName, todayIso);
  }, [cooperationRequests, currentUserPlainName]);

  const activeTaskNotifications = notifications.filter((n) => !dismissedIds.has(n.id));
  const activeCooperationNotifications = cooperationNotifications.filter((n) => !dismissedIds.has(n.id));
  const activeNotifications = activeTaskNotifications;
  const count = activeTaskNotifications.length + activeCooperationNotifications.length;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          'relative p-2 rounded-lg transition-colors',
          isOpen
            ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
            : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-line-soft)]',
        )}
        title={count > 0 ? `기한 알림 ${count}건` : '기한 알림 없음'}
        aria-label={`기한 알림 ${count}건`}
      >
        <Bell size={18} />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 leading-none">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 max-h-[60vh] rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          {/* 헤더 */}
          <div className="px-4 py-3 border-b border-[var(--color-line)] flex items-center justify-between">
            <span className="text-sm font-bold text-[var(--color-ink)]">내 알림</span>
            {activeNotifications.length > 0 && (
              <button
                type="button"
                onClick={dismissAll}
                className="text-[10px] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] transition-colors"
              >
                모두 읽음
              </button>
            )}
          </div>

          {/* 목록 */}
          <div className="max-h-[50vh] overflow-y-auto">
            {activeTaskNotifications.length === 0 && activeCooperationNotifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <CheckCircle size={24} className="mx-auto text-emerald-500 mb-2" />
                <p className="text-sm text-[var(--color-ink-muted)]">긴급한 알림이 없습니다</p>
              </div>
            ) : (
              <>
                {activeCooperationNotifications.length > 0 && (
                  <div className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] flex items-center gap-1">
                    <Handshake size={11} /> 업무 협조 요청
                  </div>
                )}
                {activeCooperationNotifications.map((item) => (
                  <div
                    key={item.id}
                    className="px-4 py-2.5 flex items-start gap-3 hover:bg-[var(--color-line-soft)] transition-colors cursor-pointer group"
                    onClick={() => {
                      onSelectCooperation?.(item.requestId);
                      setIsOpen(false);
                    }}
                  >
                    <div
                      className={cn(
                        'w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5',
                        item.type === 'overdue'
                          ? 'bg-red-100 text-red-600'
                          : item.type === 'due-soon'
                            ? 'bg-amber-100 text-amber-600'
                            : 'bg-violet-100 text-violet-600',
                      )}
                    >
                      {item.type === 'overdue' ? <AlertTriangle size={12} /> : <Handshake size={12} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[var(--color-ink)] truncate">{item.title}</div>
                      <div className="text-[11px] text-[var(--color-ink-muted)] break-words truncate">{item.context}</div>
                      <div
                        className={cn(
                          'text-[10px] font-bold mt-0.5',
                          item.type === 'overdue' ? 'text-red-500' : item.type === 'due-soon' ? 'text-amber-600' : 'text-violet-600',
                        )}
                      >
                        {item.daysInfo}
                        {item.dueDate ? ` · 기한 ${item.dueDate}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        dismiss(item.id);
                      }}
                      className="p-1 rounded text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      title="확인 (숨기기)"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}

                {activeTaskNotifications.length > 0 && activeCooperationNotifications.length > 0 && (
                  <div className="border-t border-[var(--color-line)] my-1" />
                )}
                {activeTaskNotifications.length > 0 && (
                  <div className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] flex items-center gap-1">
                    <Clock size={11} /> 작업 기한 알림
                  </div>
                )}
                {activeTaskNotifications.map((item) => (
                  <div
                    key={item.id}
                    className="px-4 py-2.5 flex items-start gap-3 hover:bg-[var(--color-line-soft)] transition-colors cursor-pointer group"
                    onClick={() => {
                      onSelectTask(item.taskId, item.projectId);
                      setIsOpen(false);
                    }}
                  >
                    <div
                      className={cn(
                        'w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5',
                        item.type === 'overdue' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600',
                      )}
                    >
                      {item.type === 'overdue' ? <AlertTriangle size={12} /> : <Clock size={12} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[var(--color-ink)] truncate">{item.taskName}</div>
                      <div className="text-[11px] text-[var(--color-ink-muted)] break-words">{item.projectName}</div>
                      <div className={cn('text-[10px] font-bold mt-0.5', item.type === 'overdue' ? 'text-red-500' : 'text-amber-600')}>
                        {item.daysInfo} · 마감 {item.endDate}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        dismiss(item.id);
                      }}
                      className="p-1 rounded text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      title="확인 (숨기기)"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* 총 건수 */}
          {(notifications.length > 0 || cooperationNotifications.length > 0) && (
            <div className="px-4 py-2 border-t border-[var(--color-line)] text-[10px] text-[var(--color-ink-muted)]">
              전체 {notifications.length + cooperationNotifications.length}건 (확인 {dismissedIds.size}건)
            </div>
          )}
        </div>
      )}
    </div>
  );
}
