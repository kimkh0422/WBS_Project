import React, { useRef, useState, useCallback, useMemo } from 'react';
import type { Task } from '../types';
import { upsertTasks, deleteTasksFromDB } from '../lib/db';

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
  bumpDirty: () => void;
  useLocalOnlyRef: React.MutableRefObject<boolean>;
  handleDbError: (err: unknown, msg: string) => void;
}

export function useWbsHistory({ allTasksRef, setAllTasks, bumpDirty, useLocalOnlyRef, handleDbError }: UseWbsHistoryOptions) {
  const historyRef = useRef<Task[][]>([]);
  const redoRef = useRef<Task[][]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const saveHistory = useCallback(() => {
    bumpDirty();
    historyRef.current = [...historyRef.current.slice(-49), [...allTasksRef.current]];
    redoRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, [bumpDirty, allTasksRef]);

  const undo = useCallback(() => {
    if (historyRef.current.length === 0) return;
    const previous = historyRef.current[historyRef.current.length - 1];
    const current = allTasksRef.current;
    historyRef.current = historyRef.current.slice(0, -1);
    redoRef.current = [...redoRef.current.slice(-49), [...current]];
    setCanUndo(historyRef.current.length > 0);
    setCanRedo(true);
    setAllTasks(previous);
    bumpDirty();
    if (!useLocalOnlyRef.current) {
      syncStateToDb(current, previous).catch((err) => handleDbError(err, '실행 취소 저장에 실패했습니다.'));
    }
  }, [allTasksRef, setAllTasks, bumpDirty, useLocalOnlyRef, handleDbError]);

  const redo = useCallback(() => {
    if (redoRef.current.length === 0) return;
    const next = redoRef.current[redoRef.current.length - 1];
    const current = allTasksRef.current;
    redoRef.current = redoRef.current.slice(0, -1);
    historyRef.current = [...historyRef.current.slice(-49), [...current]];
    setCanRedo(redoRef.current.length > 0);
    setCanUndo(true);
    setAllTasks(next);
    bumpDirty();
    if (!useLocalOnlyRef.current) {
      syncStateToDb(current, next).catch((err) => handleDbError(err, '다시 실행 저장에 실패했습니다.'));
    }
  }, [allTasksRef, setAllTasks, bumpDirty, useLocalOnlyRef, handleDbError]);

  /** 서버로 되돌리기 등으로 로컬 미저장 편집을 버릴 때 — 실행 취소로 폐기된 내용이 되살아나지 않도록 스택을 비운다. */
  const resetHistory = useCallback(() => {
    historyRef.current = [];
    redoRef.current = [];
    setCanUndo(false);
    setCanRedo(false);
  }, []);

  return useMemo(
    () => ({ saveHistory, undo, redo, canUndo, canRedo, resetHistory }),
    [saveHistory, undo, redo, canUndo, canRedo, resetHistory],
  );
}
