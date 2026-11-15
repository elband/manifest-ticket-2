"use client";

/**
 * IndexedDB wrapper untuk foto wajah hasil capture saat scan boarding pass.
 * Disimpan terpisah dari localStorage (yang menyimpan ScanEvent) supaya
 * blob besar tidak membengkak quota localStorage.
 *
 * Skema: DB `afvs-face-photos` v1, object store `photos` (key = scanEvent.id).
 *
 * API didesain agar bisa di-swap ke backend (POST /api/face-photos) tanpa
 * mengubah call-site — semua method async return Promise.
 */

const DB_NAME = "afvs-face-photos";
const DB_VERSION = 1;
const STORE = "photos";

function isBrowser() {
  return typeof window !== "undefined" && "indexedDB" in window;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!isBrowser()) {
    return Promise.reject(new Error("IndexedDB tidak tersedia"));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Gagal membuka IndexedDB"));
  });
  return dbPromise;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | IDBRequest<unknown>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB error"));
  });
}

export const facePhotoStore = {
  async save(id: string, blob: Blob): Promise<void> {
    if (!isBrowser()) return;
    await withStore("readwrite", (s) => s.put(blob, id));
  },

  async get(id: string): Promise<Blob | null> {
    if (!isBrowser()) return null;
    try {
      const v = await withStore<Blob | undefined>("readonly", (s) => s.get(id));
      return v ?? null;
    } catch {
      return null;
    }
  },

  async getObjectUrl(id: string): Promise<string | null> {
    const blob = await this.get(id);
    if (!blob) return null;
    return URL.createObjectURL(blob);
  },

  async delete(id: string): Promise<void> {
    if (!isBrowser()) return;
    await withStore("readwrite", (s) => s.delete(id));
  },

  /** Semua id foto yang tersimpan (= id scan). */
  async keys(): Promise<string[]> {
    if (!isBrowser()) return [];
    try {
      const keys = await withStore<IDBValidKey[]>("readonly", (s) => s.getAllKeys());
      return keys.map(String);
    } catch {
      return [];
    }
  },

  async clearAll(): Promise<void> {
    if (!isBrowser()) return;
    await withStore("readwrite", (s) => s.clear());
  },

  async estimateUsage(): Promise<{ count: number; bytes: number }> {
    if (!isBrowser()) return { count: 0, bytes: 0 };
    try {
      const db = await openDb();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE, "readonly");
        const store = tx.objectStore(STORE);
        let count = 0;
        let bytes = 0;
        const req = store.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            const v = cursor.value as Blob | undefined;
            if (v) {
              count += 1;
              bytes += v.size;
            }
            cursor.continue();
          } else {
            resolve({ count, bytes });
          }
        };
        req.onerror = () => resolve({ count, bytes });
      });
    } catch {
      return { count: 0, bytes: 0 };
    }
  },
};
