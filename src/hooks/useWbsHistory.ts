import React, { useRef, useState, useCallback } from 'react';
import type { Task } from '../types';
import { upsertTasks } from '../lib/db';

interface UseWbsHistoryOptions {
  allTasksRef: React.MutableRefObject<Task[]>;
  setAllTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  bumpDirty: () => void;
  useLocalOnlyRef: React.MutableRefObject<boolean>;
  handleDbError: (err: unknown, msg: string) => void;
}

export function useWbsHistory({
  allTasksRef,
  setAllTasks,
  bumpDirty,
  useLocalOnlyRef,
  handleDbError,
}: UseWbsHistoryOptions) {
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
    historyRef.current = historyRef.current.slice(0, -1);
    redoRef.current = [...redoRef.current.slice(-49), [...allTasksRef.current]];
    setCanUndo(historyRef.current.length > 0);
    setCanRedo(true);
    setAllTasks(previous);
    bumpDirty();
    if (!useLocalOnlyRef.current) upsertTasks(previous).catch(err => handleDbError(err, '실행 취소 저장에 실패했습니다.'));
  }, [allTasksRef, setAllTasks, bumpDirty, useLocalOnlyRef, handleDbError]);

  const redo = useCallback(() => {
    if (redoRef.current.length === 0) return;
    const next = redoRef.current[redoRef.current.length - 1];
    redoRef.current = redoRef.current.slice(0, -1);
    historyRef.current = [...historyRef.current.slice(-49), [...allTasksRef.current]];
    setCanRedo(redoRef.current.length > 0);
    setCanUndo(true);
    setAllTasks(next);
    bumpDirty();
    if (!useLocalOnlyRef.current) upsertTasks(next).catch(err => handleDbError(err, '다시 실행 저장에 실패했습니다.'));
  }, [allTasksRef, setAllTasks, bumpDirty, useLocalOnlyRef, handleDbError]);

  return { saveHistory, undo, redo, canUndo, canRedo };
}
