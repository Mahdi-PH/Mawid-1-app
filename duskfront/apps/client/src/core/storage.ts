/**
 * تخزين محلي: IndexedDB لحفظ الحملة دون اتصال، وlocalStorage للجلسة والإعدادات.
 * Offline-first storage. Campaign saves are written to IndexedDB first and synced to
 * the server when the connection returns; version conflicts are surfaced, not guessed.
 */
import type { CampaignSaveDto } from '@duskfront/shared';
import type { AuthTokens } from './api.js';

const DB_NAME = 'duskfront';
const DB_VERSION = 1;
const SAVE_STORE = 'campaign_saves';
const PENDING_STORE = 'pending_sync';
const TOKEN_KEY = 'duskfront.tokens';
const SETTINGS_KEY = 'duskfront.settings';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SAVE_STORE)) db.createObjectStore(SAVE_STORE, { keyPath: 'slot' });
      if (!db.objectStoreNames.contains(PENDING_STORE)) db.createObjectStore(PENDING_STORE, { keyPath: 'slot' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  return dbPromise;
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const transaction = db.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

export const LocalSaves = {
  async put(save: CampaignSaveDto): Promise<void> {
    await withStore(SAVE_STORE, 'readwrite', (store) => store.put(save));
  },
  async get(slot: number): Promise<CampaignSaveDto | null> {
    const value = await withStore<CampaignSaveDto>(SAVE_STORE, 'readonly', (store) => store.get(slot));
    return value ?? null;
  },
  async list(): Promise<CampaignSaveDto[]> {
    const value = await withStore<CampaignSaveDto[]>(SAVE_STORE, 'readonly', (store) => store.getAll());
    return value ?? [];
  },
  async remove(slot: number): Promise<void> {
    await withStore(SAVE_STORE, 'readwrite', (store) => store.delete(slot));
  },
  /** يضع الحفظ في طابور المزامنة عند انقطاع الاتصال. */
  async markPending(save: CampaignSaveDto): Promise<void> {
    await withStore(PENDING_STORE, 'readwrite', (store) => store.put(save));
  },
  async listPending(): Promise<CampaignSaveDto[]> {
    const value = await withStore<CampaignSaveDto[]>(PENDING_STORE, 'readonly', (store) => store.getAll());
    return value ?? [];
  },
  async clearPending(slot: number): Promise<void> {
    await withStore(PENDING_STORE, 'readwrite', (store) => store.delete(slot));
  },
};

export const LocalAuth = {
  load(): AuthTokens | null {
    try {
      const raw = localStorage.getItem(TOKEN_KEY);
      return raw ? (JSON.parse(raw) as AuthTokens) : null;
    } catch {
      return null;
    }
  },
  save(tokens: AuthTokens | null): void {
    try {
      if (tokens) localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* private mode */
    }
  },
};

export const LocalSettings = {
  load<T>(): T | null {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  save(settings: unknown): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* private mode */
    }
  },
};
