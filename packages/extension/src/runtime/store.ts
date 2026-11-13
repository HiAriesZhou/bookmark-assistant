import type { TaskRecord, TaskStore } from './types';

const DATABASE_NAME = 'bookmark-assistant-tasks-v1';
const STORE_NAME = 'tasks';

/** Native IndexedDB transactions fence cancellation against late worker replies. */
export function createIndexedDbTaskStore(): TaskStore {
  let connection: Promise<IDBDatabase> | undefined;
  const open = () => {
    if (!connection) {
      connection = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DATABASE_NAME, 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
        request.onerror = () => {
          connection = undefined;
          reject(new Error('task_storage_unavailable'));
        };
        request.onblocked = () => {
          connection = undefined;
          reject(new Error('task_storage_unavailable'));
        };
        request.onsuccess = () => {
          request.result.onversionchange = () => {
            request.result.close();
            connection = undefined;
          };
          resolve(request.result);
        };
      });
    }
    return connection;
  };
  async function transact<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore, result: (value: T) => void) => void
  ): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onerror = tx.onabort = () => reject(new Error('task_storage_unavailable'));
      operation(tx.objectStore(STORE_NAME), (result) => {
        value = result;
      });
    });
  }
  return {
    get: (id) =>
      transact('readonly', (store, done) => {
        const request = store.get(id);
        request.onsuccess = () => done(request.result);
      }),
    list: () =>
      transact('readonly', (store, done) => {
        const request = store.getAll();
        request.onsuccess = () => done(request.result);
      }),
    update: (id, change) =>
      transact('readwrite', (store, done) => {
        const request = store.get(id);
        request.onsuccess = () => {
          try {
            const next = change(request.result as TaskRecord | undefined);
            if (next) store.put(next);
            done(next);
          } catch {
            store.transaction.abort();
          }
        };
      }),
  };
}
