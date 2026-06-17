import React, { useRef, useState, useCallback, useMemo, startTransition } from 'react';
import type { Task } from '../types';
import { upsertTasks, deleteTasksFromDB } from '../lib/db';
import { describeUndoChange } from '../lib/describeUndoChange';

type HistoryEntry = { tasks: Task[]; label?: string };

/** undo 스택에 넣을 때 태스크 객체를 깊은 복사해 이후 편집이 스냅샷을 오염시키지 않게 한다. */
function cloneTasksForHistory(tasks: Task[]): Task[] {
  return tasks.map((t) => structuredClone(t));
}

function diffRemovedIds(from: Task[], to: Task[]): string[] {
  const toIds = new Set(to.map((t) => t.id));
  const removed: string[] = [];
  for (const t of from) {
    if (!toIds.has(t.id)) removed.push(t.id);
  }
  return removed;
}

async function syncStateToDb(current: Task[], target: Task[]): Promise<void> {
  const removedIds = diffRemovedIds(current, target);
  if (removedIds.length > 0) await deleteTasksFromDB(removedIds);
  await upsertTasks(target);
}

interface UseWbsHistoryOptions {
  allTasksRef: React.MutableRefObject<Task[]>;
  setAllTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  bumpDirty: (...projectIds: string[]) => void;
  useLocalOnlyRef: React.MutableRefObject<boolean>;
  handleDbError: (err: unknown, msg: string) => void;
  /** 원격 모드: undo/redo 직후 upsert로 DB에 반영되면 플로팅 저장 버튼을 끈다. */
  onAfterUndoRedoPersistedToDb?: () => void;
  /** 실행 취소·다시 실행 시 토스트 알림 */
  onUndoRedoToast?: (message: string) => void;
}

export function useWbsHistory({
  allTasksRef,
  setAllTasks,
  bumpDirty,
  useLocalOnlyRef,
  handleDbError,
  onAfterUndoRedoPersistedToDb,
  onUndoRedoToast,
}: UseWbsHistoryOptions) {
  const historyRef = useRef<HistoryEntry[]>([]);
  const redoRef = useRef<HistoryEntry[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const saveHistory = useCallback(
    (label?: string) => {
      const entry: HistoryEntry = { tasks: cloneTasksForHistory(allTasksRef.current), label: label?.trim() || undefined };
      historyRef.current = [...historyRef.current.slice(-49), entry];
      redoRef.current = [];
      setCanUndo(true);
      setCanRedo(false);
    },
    [allTasksRef],
  );

  /**
   * 삭제 등: 이미 적용된 이전 스냅샷을 스택에 넣는다.
   * `saveHistory()`와 달리 전체 배열을 다시 복사하지 않으므로 대형 WBS에서 메인 스레드 블로킹을 줄인다.
   * `previousTasks`는 React가 넘겨준 이전 `prev` 배열 참조여야 한다(직접 mutate 금지).
   */
  const pushUndoSnapshot = useCallback((previousTasks: Task[], label?: string) => {
    const entry: HistoryEntry = { tasks: cloneTasksForHistory(previousTasks), label: label?.trim() || undefined };
    historyRef.current = [...historyRef.current.slice(-49), entry];
    redoRef.current = [];
    startTransition(() => {
      setCanUndo(true);
      setCanRedo(false);
    });
  }, []);

  const undo = useCallback(() => {
    if (historyRef.current.length === 0) return;
    const entry = historyRef.current[historyRef.current.length - 1]!;
    const previous = entry.tasks;
    const current = allTasksRef.current;
    historyRef.current = historyRef.current.slice(0, -1);
    redoRef.current = [...redoRef.current.slice(-49), { tasks: cloneTasksForHistory(current), label: entry.label }];
    setCanUndo(historyRef.current.length > 0);
    setCanRedo(true);
    onUndoRedoToast?.(describeUndoChange(current, previous, 'undo', entry.label));
    setAllTasks(previous);
    if (!useLocalOnlyRef.current) {
      syncStateToDb(current, previous)
        .then(() => {
          onAfterUndoRedoPersistedToDb?.();
        })
        .catch((err) => {
          bumpDirty();
          handleDbError(err, '실행 취소 저장에 실패했습니다.');
        });
    } else {
      bumpDirty();
    }
  }, [allTasksRef, setAllTasks, bumpDirty, useLocalOnlyRef, handleDbError, onAfterUndoRedoPersistedToDb, onUndoRedoToast]);

  const redo = useCallback(() => {
    if (redoRef.current.length === 0) return;
    const entry = redoRef.current[redoRef.current.length - 1]!;
    const next = entry.tasks;
    const current = allTasksRef.current;
    redoRef.current = redoRef.current.slice(0, -1);
    historyRef.current = [...historyRef.current.slice(-49), { tasks: cloneTasksForHistory(current), label: entry.label }];
    setCanRedo(redoRef.current.length > 0);
    setCanUndo(true);
    onUndoRedoToast?.(describeUndoChange(current, next, 'redo', entry.label));
    setAllTasks(next);
    if (!useLocalOnlyRef.current) {
      syncStateToDb(current, next)
        .then(() => {
          onAfterUndoRedoPersistedToDb?.();
        })
        .catch((err) => {
          bumpDirty();
          handleDbError(err, '다시 실행 저장에 실패했습니다.');
        });
    } else {
      bumpDirty();
    }
  }, [allTasksRef, setAllTasks, bumpDirty, useLocalOnlyRef, handleDbError, onAfterUndoRedoPersistedToDb, onUndoRedoToast]);

  /** 서버로 되돌리기 등으로 로컬 미저장 편집을 버릴 때 — 실행 취소로 폐기된 내용이 되살아나지 않도록 스택을 비운다. */
  const resetHistory = useCallback(() => {
    historyRef.current = [];
    redoRef.current = [];
    setCanUndo(false);
    setCanRedo(false);
  }, []);

  return useMemo(
    () => ({ saveHistory, pushUndoSnapshot, undo, redo, canUndo, canRedo, resetHistory }),
    [saveHistory, pushUndoSnapshot, undo, redo, canUndo, canRedo, resetHistory],
  );
}
