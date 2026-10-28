/** One transactional authority for browser UI atoms. CLI state stays on the host. */
const databaseName = 'codex-yard.ui-atoms.v1';
const storeName = 'atoms';
const rootKey = 'native-atoms';
const channelName = 'codex-yard.ui-atoms.changed';
interface AtomRoot { version: 1; legacyRaw: string | null; atoms?: Record<string, unknown>; importError?: string }
let database: Promise<IDBDatabase> | undefined;
let channel: BroadcastChannel | undefined;
const listeners = new Set<(keys: string[]) => void>();
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('浏览器事务存储不可用；未改写偏好。')); return; }
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onerror = () => reject(request.error ?? new Error('无法打开浏览器偏好存储。'));
    request.onblocked = () => reject(new Error('浏览器偏好升级被另一页面阻塞；请关闭旧页面后重试。'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); database = undefined; };
      resolve(db);
    };
  }).catch(error => { database = undefined; throw error; });
  return database;
}
function importLegacy(): AtomRoot {
  // Import once in the transaction establishing the authoritative record.
  // Retain the exact source bytes, including data that cannot be converted.
  const legacyRaw = localStorage.getItem(rootKey);
  try {
    const atoms: unknown = JSON.parse(legacyRaw ?? '{}');
    if (!record(atoms)) throw new Error('invalid root');
    return { version: 1, legacyRaw, atoms };
  } catch {
    return { version: 1, legacyRaw, importError: '旧浏览器偏好无法转换；原始数据已保留，未改写。' };
  }
}
function changed(keys: string[]) {
  for (const listener of listeners) listener(keys);
  if (typeof BroadcastChannel !== 'undefined') {
    const sender = channel ?? new BroadcastChannel(channelName);
    sender.postMessage(keys);
    if (!channel) sender.close();
  }
}
export function subscribeBrowserAtoms(listener: (keys: string[]) => void): () => void {
  listeners.add(listener);
  if (!channel && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(channelName);
    channel.onmessage = event => {
      if (Array.isArray(event.data) && event.data.every(key => typeof key === 'string')) {
        for (const subscriber of listeners) subscriber(event.data as string[]);
      }
    };
  }
  return () => { listeners.delete(listener); if (!listeners.size) { channel?.close(); channel = undefined; } };
}

async function transaction<T>(readOrUpdate: (atoms: Record<string, unknown>) => { value: T; next?: Record<string, unknown>; keys?: string[] }): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    // Readwrite also serializes first import against every renderer's writes.
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName), request = store.get(rootKey);
    let result: T, failure: unknown, changedKeys: string[] | undefined;
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('浏览器偏好事务已中止；未保存。'));
    tx.onerror = () => { /* onabort reports the final outcome. */ };
    tx.oncomplete = () => {
      if (failure) { reject(failure); return; }
      resolve(result);
      if (changedKeys) changed(changedKeys);
    };
    request.onsuccess = () => {
      try {
        const root: unknown = request.result === undefined ? importLegacy() : request.result;
        if (!record(root) || root.version !== 1 || !(root.legacyRaw === null || typeof root.legacyRaw === 'string')) {
          throw new Error('浏览器偏好记录无法识别；原值已保留。');
        }
        if (request.result === undefined) store.put(root, rootKey);
        if (root.importError || !record(root.atoms)) {
          // Commit the original bytes even when conversion is impossible.
          failure = new Error(typeof root.importError === 'string' ? root.importError : '浏览器偏好格式无效；原值已保留。');
          return;
        }
        const outcome = readOrUpdate(root.atoms);
        result = outcome.value;
        if (outcome.next) {
          store.put({ ...root, atoms: outcome.next }, rootKey);
          changedKeys = outcome.keys ?? [];
        }
      } catch (error) { failure = error; tx.abort(); }
    };
  });
}
export function readBrowserAtoms(): Promise<Record<string, unknown>> {
  return transaction(atoms => ({ value: atoms }));
}
export function readBrowserAtom(key: string): Promise<unknown> {
  return transaction(atoms => ({ value: Object.hasOwn(atoms, key) ? atoms[key] : undefined }));
}
export function updateBrowserAtom(key: string, update: (previous: unknown) => unknown): Promise<unknown> {
  return transaction(atoms => {
    const value = update(Object.hasOwn(atoms, key) ? atoms[key] : undefined);
    return { value, next: { ...atoms, [key]: value }, keys: [key] };
  });
}
