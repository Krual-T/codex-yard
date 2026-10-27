/** Statsig requires synchronous reads; preload IndexedDB before creating its client. */
export interface StatsigStorageProvider {
  isReady(): boolean;
  isReadyResolver(): Promise<void> | null;
  getProviderName(): string;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  getAllKeys(): string[];
}

export async function openStatsigStorage(): Promise<StatsigStorageProvider> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('workbench-statsig', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('values');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  database.onversionchange = () => database.close();
  const values = new Map<string, string>();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('values', 'readonly');
    const cursor = transaction.objectStore('values').openCursor();
    cursor.onsuccess = () => {
      if (!cursor.result) return;
      values.set(String(cursor.result.key), String(cursor.result.value));
      cursor.result.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
  function update(key: string, value?: string) {
    const transaction = database.transaction('values', 'readwrite');
    const store = transaction.objectStore('values');
    if (value === undefined) store.delete(key); else store.put(value, key);
    transaction.onabort = () => console.warn('功能配置缓存写入失败', transaction.error?.name);
  }
  return {
    isReady: () => true,
    isReadyResolver: () => null,
    getProviderName: () => 'IndexedDB',
    // Preserve the SDK's existing stable ID and session metadata on first use.
    getItem: key => values.get(key) ?? localStorage.getItem(key),
    setItem(key, value) { update(key, value); values.set(key, value); },
    removeItem(key) { update(key); values.delete(key); localStorage.removeItem(key); },
    getAllKeys: () => [...new Set([...values.keys(), ...Object.keys(localStorage).filter(key => key.startsWith('statsig.'))])],
  };
}
