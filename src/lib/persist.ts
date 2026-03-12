type PersistKey =
  | 'wbs-projects'
  | 'wbs-tasks'
  | 'wbs-settings'
  | 'wbs-deleted-task-ids';

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
    const req = store.put(value as any, key);
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

