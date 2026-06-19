export type PersistKey = 'wbs-projects' | 'wbs-tasks' | 'wbs-settings' | 'wbs-deleted-task-ids' | 'wbs-deleted-project-ids';

/** 로컬 캐시가 어떤 사용자·시점 데이터인지 기록(재방문 시 서버 전체 fetch 생략 판단용). */
export const WBS_CACHE_META_KEY = 'wbs-cache-meta';

export type WbsCacheMeta = {
  userId: string;
  savedAt: number;
  projectCount: number;
  taskCount: number;
};

export function readWbsCacheMeta(): WbsCacheMeta | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(WBS_CACHE_META_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<WbsCacheMeta>;
    if (typeof parsed.userId !== 'string' || !parsed.userId) return null;
    if (typeof parsed.savedAt !== 'number' || !Number.isFinite(parsed.savedAt)) return null;
    return {
      userId: parsed.userId,
      savedAt: parsed.savedAt,
      projectCount: typeof parsed.projectCount === 'number' ? parsed.projectCount : 0,
      taskCount: typeof parsed.taskCount === 'number' ? parsed.taskCount : 0,
    };
  } catch {
    return null;
  }
}

export function writeWbsCacheMeta(meta: WbsCacheMeta): void {
  try {
    localStorage.setItem(WBS_CACHE_META_KEY, JSON.stringify(meta));
  } catch {
    /* ignore quota */
  }
}

const DB_NAME = 'wbs_mg';
const DB_VERSION = 1;
const STORE = 'kv';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
  });
}

async function idbGet<T>(key: PersistKey): Promise<T | null> {
  const db = await openDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.get(key);
    req.onsuccess = () => resolve((req.result ?? null) as T | null);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB get failed'));
  });
}

async function idbSet<T>(key: PersistKey, value: T): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.put(value as unknown, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('IndexedDB put failed'));
  });
}

async function idbRemove(key: PersistKey): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('IndexedDB delete failed'));
  });
}

export function safeLocalGet(key: PersistKey): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeLocalSet(key: PersistKey, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function safeLocalRemove(key: PersistKey): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export async function loadJsonWithIdbFallback<T>(key: PersistKey): Promise<T | null> {
  const raw = safeLocalGet(key);
  if (raw) {
    try {
      return JSON.parse(raw) as T;
    } catch {
      // fall through
    }
  }
  try {
    return await idbGet<T>(key);
  } catch {
    return null;
  }
}

export async function saveJsonWithIdbFallback<T>(key: PersistKey, value: T): Promise<{ used: 'localStorage' | 'indexedDB' | 'none' }> {
  const json = JSON.stringify(value);
  if (safeLocalSet(key, json)) return { used: 'localStorage' };
  try {
    await idbSet(key, value);
    return { used: 'indexedDB' };
  } catch {
    return { used: 'none' };
  }
}

export async function removePersistedEverywhere(key: PersistKey): Promise<void> {
  safeLocalRemove(key);
  try {
    await idbRemove(key);
  } catch {
    // ignore
  }
}

const PERSIST_KEYS: PersistKey[] = ['wbs-projects', 'wbs-tasks', 'wbs-settings', 'wbs-deleted-task-ids', 'wbs-deleted-project-ids'];

/** 로컬 초기화 직후: DB 자동 로드를 건너뛰고 빈 상태 유지. DB 동기화 성공 시 제거됨. */
export const WBS_INIT_BLANK_SESSION_KEY = 'wbs-init-blank-session';

export function clearInitBlankSessionFlag(): void {
  try {
    localStorage.removeItem(WBS_INIT_BLANK_SESSION_KEY);
  } catch {
    // ignore
  }
}

/** 로컬 데이터·설정 전체 초기화. localStorage, sessionStorage, IndexedDB의 WBS 관련 항목을 모두 제거. */
export async function clearAllLocalData(): Promise<void> {
  for (const key of PERSIST_KEYS) {
    await removePersistedEverywhere(key);
  }

  const localKeys = [
    WBS_CACHE_META_KEY,
    'wbs.lastExportPrefs',
    'wbs.split.wbsTableWidth',
    'wbs:gantt:sidebarWidth',
    'wbs-task-clipboard-v1',
    'wbs-level-colors',
    'wbs-hide-table-auto-format',
    'wbs-current-project',
  ];
  for (const key of localKeys) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }

  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('wbs.toast.tipSeen.') || k.startsWith('wbs-kanban-order-v1-'))) {
        toRemove.push(k);
      }
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore
  }

  const sessionKeys = [
    'wbs-admin-override',
    'wbs-local-save-banner-dismissed',
    'wbs-backup-banner-dismissed',
    'wbs-current-project',
    'wbs-visit-session-id',
  ];
  // 'wbs-current-project'는 localStorage로 이전됐지만, 구버전 잔존 데이터를 위해 sessionStorage에서도 함께 제거.
  for (const key of sessionKeys) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // ignore
    }
  }

  try {
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith('wbs.rpc.disabled.')) {
        toRemove.push(k);
      }
    }
    toRemove.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // ignore
  }

  try {
    if (typeof indexedDB !== 'undefined') {
      indexedDB.deleteDatabase(DB_NAME);
    }
  } catch {
    // ignore
  }

  try {
    localStorage.setItem(WBS_INIT_BLANK_SESSION_KEY, '1');
  } catch {
    // ignore
  }
}
