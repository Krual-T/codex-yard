import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openStatsigStorage } from '../src/native/statsig-storage.ts';

function fakeDatabase(entries: Record<string, string> = {}, abortMigration = false) {
  const values = new Map(Object.entries(entries));
  const database = {
    transaction(_store: string, mode: string) {
      const updates = new Map<string, string | undefined>();
      const transaction = {
        error: new Error('transaction aborted'), oncomplete: () => {}, onabort: () => {},
        objectStore: () => ({
          openCursor() {
            const entries = [...values.entries()];
            const request = { result: null as unknown, onsuccess: () => {} };
            const next = () => queueMicrotask(() => {
              const entry = entries.shift();
              request.result = entry ? { key: entry[0], value: entry[1], continue: next } : null;
              request.onsuccess();
              if (!entry) transaction.oncomplete();
            });
            next();
            return request;
          },
          put: (value: string, key: string) => { updates.set(key, value); },
          delete: (key: string) => { updates.set(key, undefined); },
        }),
      };
      if (mode === 'readwrite') queueMicrotask(() => {
        if (abortMigration) transaction.onabort();
        else {
          for (const [key, value] of updates) if (value === undefined) values.delete(key); else values.set(key, value);
          transaction.oncomplete();
        }
      });
      return transaction;
    }, close() {},
  };
  return { values, indexedDB: { open() {
    const request = { result: database, onsuccess: () => {}, onerror: () => {} };
    queueMicrotask(() => request.onsuccess());
    return request;
  } } };
}

test('Statsig migrates stable identity and session once, keeping committed IndexedDB values authoritative', async () => {
  const oldIDB = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const legacy = Object.assign(Object.create(null), {
    'statsig.stable_id.fixture': 'stable-id', 'statsig.session_id.fixture': '{"sessionID":"session"}',
    'statsig.cached.evaluations': 'stale-cache', 'unrelated.preference': 'keep',
  });
  Object.defineProperties(legacy, { getItem: { value: (key: string) => legacy[key] ?? null },
    removeItem: { value: (key: string) => { delete legacy[key]; } } });
  const idb = fakeDatabase({ 'statsig.cached.evaluations': 'current-cache' });
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: idb.indexedDB });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: legacy });
  try {
    const provider = await openStatsigStorage();
    assert.equal(provider.getItem('statsig.stable_id.fixture'), 'stable-id');
    assert.equal(provider.getItem('statsig.session_id.fixture'), '{"sessionID":"session"}');
    assert.equal(provider.getItem('statsig.cached.evaluations'), 'current-cache');
    assert.deepEqual(Object.keys(legacy), ['unrelated.preference']);
    assert.equal(idb.values.get('statsig.stable_id.fixture'), 'stable-id');
    legacy['statsig.stable_id.fixture'] = 'old-page-value';
    assert.equal(provider.getItem('statsig.stable_id.fixture'), 'stable-id');
    assert.equal(provider.getAllKeys().includes('unrelated.preference'), false);
    provider.removeItem('statsig.session_id.fixture');
    await new Promise<void>(resolve => queueMicrotask(resolve));
    assert.equal(idb.values.has('statsig.session_id.fixture'), false);
  } finally {
    if (oldIDB) Object.defineProperty(globalThis, 'indexedDB', oldIDB); else Reflect.deleteProperty(globalThis, 'indexedDB');
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('an aborted Statsig migration never removes the only durable stable identity', async () => {
  const oldIDB = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const legacy = { 'statsig.stable_id.fixture': 'keep-stable-id' } as Record<string, unknown>;
  Object.defineProperties(legacy, { getItem: { value: (key: string) => legacy[key] ?? null },
    removeItem: { value: (key: string) => { delete legacy[key]; } } });
  const idb = fakeDatabase({}, true);
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: idb.indexedDB });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: legacy });
  try {
    await assert.rejects(openStatsigStorage(), /transaction aborted/);
    assert.equal(legacy['statsig.stable_id.fixture'], 'keep-stable-id');
    assert.equal(idb.values.size, 0);
  } finally {
    if (oldIDB) Object.defineProperty(globalThis, 'indexedDB', oldIDB); else Reflect.deleteProperty(globalThis, 'indexedDB');
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
