import type { HistoryEntry, HistoryPage } from './protocol';

const DATABASE = 'ai-translator-history-v1';
export const HISTORY_MAX_ENTRIES = 1000;
export const HISTORY_MAX_BYTES = 25 * 1024 * 1024;
interface StoredEntry extends HistoryEntry { key: string; scope: string; bytes: number }
let database: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  return database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const entries = request.result.createObjectStore('entries', { keyPath: 'key' });
      entries.createIndex('scope', 'scope');
      request.result.createObjectStore('preferences', { keyPath: 'scope' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
}
function finish(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('History storage is unavailable.'));
  });
}
function value<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
export async function listHistory(scope: string, limit: number): Promise<HistoryPage> {
  const db = await open(); const tx = db.transaction(['entries', 'preferences']);
  const [records, preference] = await Promise.all([
    value(tx.objectStore('entries').index('scope').getAll(scope)) as Promise<StoredEntry[]>,
    value(tx.objectStore('preferences').get(scope)),
  ]);
  const allowed = Math.min(HISTORY_MAX_ENTRIES, Math.max(0, limit));
  const entries = records.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)).slice(0, allowed)
    .map(({ key: _key, scope: _scope, bytes: _bytes, ...entry }) => entry);
  return { entries, total: records.length, recording: preference?.recording !== false, limit: allowed };
}
export async function saveHistory(scope: string, entry: HistoryEntry): Promise<void> {
  const db = await open(); const tx = db.transaction(['entries', 'preferences'], 'readwrite');
  const completed = finish(tx);
  const store = tx.objectStore('entries');
  const [records, preference] = await Promise.all([
    value(store.index('scope').getAll(scope)) as Promise<StoredEntry[]>,
    value(tx.objectStore('preferences').get(scope)),
  ]);
  // The job ID is the stable local identity: repeated polling never duplicates history.
  if (preference?.recording !== false && !records.some(record => record.id === entry.id)) {
    const record: StoredEntry = { ...entry, scope, key: JSON.stringify([scope, entry.id]), bytes: new TextEncoder().encode(JSON.stringify(entry)).byteLength };
    if (record.bytes <= HISTORY_MAX_BYTES) {
      store.put(record); records.push(record);
      records.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      let bytes = records.reduce((total, item) => total + item.bytes, 0);
      while (records.length > HISTORY_MAX_ENTRIES || bytes > HISTORY_MAX_BYTES) {
        const oldest = records.shift()!; store.delete(oldest.key); bytes -= oldest.bytes;
      }
    }
  }
  await completed;
}
export async function deleteHistory(scope: string, id?: string): Promise<void> {
  const db = await open(); const tx = db.transaction('entries', 'readwrite'); const completed = finish(tx);
  const store = tx.objectStore('entries');
  if (id !== undefined) store.delete(JSON.stringify([scope, id]));
  else for (const key of await value(store.index('scope').getAllKeys(scope))) store.delete(key);
  await completed;
}
export async function setHistoryRecording(scope: string, recording: boolean): Promise<void> {
  const db = await open(); const tx = db.transaction('preferences', 'readwrite'); const completed = finish(tx);
  tx.objectStore('preferences').put({ scope, recording }); await completed;
}
