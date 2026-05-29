import type { TaskRow } from '../supabase';
import { fetchTaskRows, fetchTaskRowsUpdatedSince, fetchTaskIdManifest, fetchTaskRowsByIds } from './tasks';
import { canUseIncrementalTaskPull, incrementalPullSinceIso, shouldRunTaskManifestThisPull } from './pullState';
import { deletedTaskIdsFromManifest } from './sync';
import type { Task } from '../../types';

export type TaskPullMode = 'full' | 'incremental';

export type TaskPullFromServerResult = {
  mode: TaskPullMode;
  /** full: 전체 행, incremental: 변경분만 */
  rows: TaskRow[];
  deletedIds: Set<string>;
};

/**
 * 백그라운드·탭 복귀 pull용. 가능하면 updated_at 증분 + 주기적 id 매니페스트로 I/O 절감.
 */
export async function pullTaskRowsFromServer(
  lastPullAt: string | null,
  localTasks: Task[],
  serverProjectIds: Set<string>,
  opts?: { forceFull?: boolean },
): Promise<TaskPullFromServerResult> {
  if (opts?.forceFull || !canUseIncrementalTaskPull(lastPullAt)) {
    const rows = await fetchTaskRows();
    return { mode: 'full', rows, deletedIds: new Set() };
  }

  try {
    const sinceIso = incrementalPullSinceIso(lastPullAt!);
    const changed = await fetchTaskRowsUpdatedSince(sinceIso);

    let deletedIds = new Set<string>();
    if (shouldRunTaskManifestThisPull()) {
      const manifest = await fetchTaskIdManifest();
      deletedIds = deletedTaskIdsFromManifest(localTasks, manifest, serverProjectIds);
    }

    return { mode: 'incremental', rows: changed, deletedIds };
  } catch {
    const rows = await fetchTaskRows();
    return { mode: 'full', rows, deletedIds: new Set() };
  }
}

/** 동기화 pullAfter: 동기 시작 시각 이후 변경분 + 매니페스트(삭제·로컬에 없는 서버 작업) */
export async function pullTaskRowsAfterSync(
  syncStartedAtIso: string,
  localTasks: Task[],
  serverProjectIds: Set<string>,
): Promise<TaskPullFromServerResult> {
  try {
    const sinceIso = incrementalPullSinceIso(syncStartedAtIso);
    const [changed, manifest] = await Promise.all([fetchTaskRowsUpdatedSince(sinceIso), fetchTaskIdManifest()]);
    const deletedIds = deletedTaskIdsFromManifest(localTasks, manifest, serverProjectIds);
    const localIds = new Set(localTasks.map((t) => t.id));
    const missingIds = manifest.filter((m) => serverProjectIds.has(m.project_id) && !localIds.has(m.id)).map((m) => m.id);
    const missingRows = missingIds.length > 0 ? await fetchTaskRowsByIds(missingIds) : [];
    const rows = [...changed, ...missingRows];
    return { mode: 'incremental', rows, deletedIds };
  } catch {
    const rows = await fetchTaskRows();
    return { mode: 'full', rows, deletedIds: new Set() };
  }
}
