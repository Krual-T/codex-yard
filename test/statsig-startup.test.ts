import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installStatsigStartup } from '../src/native/statsig-startup.ts';
import type { StatsigStartupResult, StatsigStartupUser, StatsigConfigurationSnapshot } from '../src/native/statsig-startup.ts';

const user = { userID: 'user-a', customIDs: { stableID: 'browser-a', account_id: 'account-a' }, custom: { plan_type: 'plus' } };
const hashUser = (value: StatsigStartupUser) => JSON.stringify(value);
const cached = () => ({ data: JSON.stringify({ has_updates: true, feature_gates: { enabled: true } }), fullUserHash: hashUser(user), receivedAt: 1_700_000_000_000 });
const success = (source: string): StatsigStartupResult => ({ success: true, source });

function fixture(loadSnapshot?: () => Promise<StatsigConfigurationSnapshot | null>) {
  let resolve!: (result: StatsigStartupResult) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<StatsigStartupResult>((yes, no) => { resolve = yes; reject = no; });
  const remote = { promise, resolve, reject };
  const errors: unknown[][] = [];
  const calls = { async: [] as unknown[], sync: [] as unknown[], refresh: 0, reads: 0, bootstrap: [] as unknown[] };
  const storage = { name: 'IndexedDB' };
  class Client {
    loadingStatus = 'Uninitialized';
    currentUser: StatsigStartupUser = user;
    options = { disableStorage: false };
    cache: ReturnType<typeof cached> | null = cached();
    cacheSource = 'Cache';
    values = 'uninitialized';
    updates = 0;
    dataAdapter = {
      getDataSync: (_user: StatsigStartupUser) => { calls.reads++; return this.cache; },
      setDataLegacy: (data: string, user: StatsigStartupUser) => {
        calls.bootstrap.push({ data, user });
        this.cache = { data, fullUserHash: hashUser(user), receivedAt: 1_700_000_000_000 };
        this.cacheSource = 'Bootstrap';
      },
    };
    getContext() { return { user: this.currentUser, options: this.options }; }
    initializeAsync(options?: unknown) {
      calls.async.push(options);
      this.loadingStatus = 'Loading';
      return remote.promise.then(result => { this.values = result.source; this.loadingStatus = 'Ready'; return result; });
    }
    initializeSync(options: { disableBackgroundCacheRefresh: boolean }) {
      calls.sync.push(options);
      this.values = this.cacheSource;
      this.loadingStatus = 'Ready';
      return success(this.cacheSource);
    }
    refreshValuesAsync() {
      calls.refresh++;
      return remote.promise.then(result => {
        if (result.success) { this.values = result.source; this.updates++; }
        return result;
      });
    }
  }
  installStatsigStartup(Client, { Storage: { getProviderName: () => storage.name }, _getFullUserHash: hashUser,
    Log: { error: (...values) => { errors.push(values); } } }, loadSnapshot);
  return { client: new Client(), remote, errors, calls, storage };
}

test('matching cached evaluations make the client ready while real refresh is pending, then apply the update', async () => {
  const h = fixture(), originalCache = { ...h.client.cache! };
  const initialized = await h.client.initializeAsync();
  assert.deepEqual(initialized, success('Cache'));
  assert.equal(h.client.loadingStatus, 'Ready');
  assert.equal(h.client.values, 'Cache');
  assert.deepEqual(h.client.cache, originalCache);
  assert.deepEqual(h.calls.sync, [{ disableBackgroundCacheRefresh: true }]);
  assert.equal(h.calls.async.length, 0);
  assert.equal(h.calls.refresh, 1);
  assert.deepEqual(await h.client.initializeAsync(), initialized);
  assert.equal(h.calls.refresh, 1);

  h.remote.resolve(success('Network'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.client.values, 'Network');
  assert.equal(h.client.updates, 1);
  assert.deepEqual(h.errors, []);
});

test('first startup without a cache keeps the SDK network initialization and its options', async () => {
  const h = fixture();
  h.client.cache = null;
  const options = { timeoutMs: 10_000 };
  const initialized = h.client.initializeAsync(options);
  assert.equal(h.client.loadingStatus, 'Loading');
  assert.deepEqual(h.calls.async, [options]);
  assert.equal(h.calls.sync.length, 0);
  h.remote.resolve(success('Network'));
  assert.deepEqual(await initialized, success('Network'));
});

test('another account or changed targeting attributes require fresh evaluations', async t => {
  for (const changed of [
    { ...user, userID: 'user-b' },
    { ...user, customIDs: { ...user.customIDs, account_id: 'account-b' } },
    { ...user, customIDs: { ...user.customIDs, stableID: 'browser-b' } },
    { ...user, custom: { plan_type: 'free' } },
  ]) await t.test(JSON.stringify(changed), async () => {
    const h = fixture();
    h.client.currentUser = changed;
    const initialized = h.client.initializeAsync();
    assert.equal(h.client.values, 'uninitialized');
    assert.equal(h.calls.sync.length, 0);
    assert.equal(h.calls.refresh, 0);
    h.remote.resolve(success('Network'));
    await initialized;
  });
});

test('disabled storage is respected before reading any persisted evaluations', async t => {
  for (const disabledBy of ['client option', 'global storage provider']) await t.test(disabledBy, async () => {
    const h = fixture();
    if (disabledBy === 'client option') h.client.options.disableStorage = true; else h.storage.name = 'InMemory';
    const initialized = h.client.initializeAsync();
    assert.equal(h.calls.reads, 0);
    assert.equal(h.calls.sync.length, 0);
    h.remote.resolve(success('Network'));
    await initialized;
  });
});

test('invalid or incomplete saved responses cannot make the client ready', async t => {
  for (const data of ['broken JSON', '{"has_updates":false}', '{}']) await t.test(data, async () => {
    const h = fixture();
    h.client.cache!.data = data;
    const initialized = h.client.initializeAsync();
    assert.equal(h.client.loadingStatus, 'Loading');
    assert.equal(h.calls.sync.length, 0);
    h.remote.resolve(success('Network'));
    await initialized;
  });
});

test('a failed background update preserves the cached client and reports the SDK failure', async () => {
  const h = fixture();
  assert.deepEqual(await h.client.initializeAsync(), success('Cache'));
  const error = new Error('ECONNRESET');
  h.remote.resolve({ success: false, source: 'Cache', error });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.client.loadingStatus, 'Ready');
  assert.equal(h.client.values, 'Cache');
  assert.equal(h.client.updates, 0);
  assert.equal(h.errors.length, 1);
  assert.equal(h.errors[0]![1], error);
});

test('a rejected background update is reported without rejecting cached initialization', async () => {
  const h = fixture(), error = new Error('transport failed');
  assert.deepEqual(await h.client.initializeAsync(), success('Cache'));
  h.remote.reject(error);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.client.values, 'Cache');
  assert.equal(h.errors.length, 1);
  assert.equal(h.errors[0]![1], error);
});

const anonymousUser = { locale: 'en-US', customIDs: { stableID: 'capture-browser', source_surface_stable_id: 'capture-browser' },
  appVersion: '26.1013.40934', custom: { auth_status: 'logged_out', brand_name: 'chatgpt' } };
const snapshot = (): StatsigConfigurationSnapshot => ({ rendererVersion: anonymousUser.appVersion,
  capturedAt: '2026-10-26T08:22:03.255Z', user: anonymousUser, data: cached().data });

test('a first visit bootstraps the matching anonymous profile, preserving its identity until its real refresh', async () => {
  let loads = 0;
  const data = snapshot();
  const h = fixture(async () => { loads++; return data; });
  h.client.cache = null;
  const currentUser = { ...anonymousUser, customIDs: { stableID: 'new-browser', source_surface_stable_id: 'new-browser' } };
  h.client.currentUser = currentUser;
  const first = h.client.initializeAsync(), second = h.client.initializeAsync();
  assert.equal(first, second);
  assert.deepEqual(await first, success('Bootstrap'));
  assert.equal(loads, 1);
  assert.equal(h.client.loadingStatus, 'Ready');
  assert.equal(h.client.currentUser, currentUser);
  assert.equal(h.calls.async.length, 0);
  assert.deepEqual(h.calls.bootstrap, [{ data: data.data, user: currentUser }]);
  assert.equal(h.calls.refresh, 1);

  h.remote.resolve(success('Network'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.client.values, 'Network');
  assert.equal(h.client.updates, 1);
});

test('a matching personal cache takes precedence without downloading the shared snapshot', async () => {
  const h = fixture(async () => { throw new Error('Snapshot should not be downloaded'); });
  assert.deepEqual(await h.client.initializeAsync(), success('Cache'));
  assert.deepEqual(h.errors, []);
  assert.deepEqual(h.calls.bootstrap, []);
  h.remote.resolve(success('Network'));
});

test('anonymous bootstrap does not cross account, targeting attributes or renderer versions', async t => {
  for (const changed of [
    { ...anonymousUser, userID: 'signed-in-user' },
    { ...anonymousUser, customIDs: { ...anonymousUser.customIDs, account_id: 'signed-in-account' } },
    { ...anonymousUser, custom: { ...anonymousUser.custom, plan_type: 'plus' } },
    { ...anonymousUser, custom: { ...anonymousUser.custom, auth_status: 'logged_in' } },
    { ...anonymousUser, locale: 'zh-CN' },
    { ...anonymousUser, appVersion: 'another-version' },
  ]) await t.test(JSON.stringify(changed), async () => {
    const h = fixture(async () => snapshot());
    h.client.cache = null;
    h.client.currentUser = changed;
    const initialized = h.client.initializeAsync();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.client.loadingStatus, 'Loading');
    assert.deepEqual(h.calls.bootstrap, []);
    h.remote.resolve(success('Network'));
    assert.deepEqual(await initialized, success('Network'));
  });
});

test('an unavailable refresh keeps the anonymous baseline usable', async () => {
  const h = fixture(async () => snapshot());
  h.client.cache = null;
  h.client.currentUser = anonymousUser;
  assert.deepEqual(await h.client.initializeAsync(), success('Bootstrap'));
  h.remote.resolve({ success: false, source: 'Bootstrap', error: new Error('offline') });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.client.values, 'Bootstrap');
  assert.equal(h.errors.length, 1);
});

test('an account change while the local snapshot is downloading skips the anonymous baseline', async () => {
  let downloaded!: (value: StatsigConfigurationSnapshot) => void;
  const h = fixture(() => new Promise(resolve => { downloaded = resolve; }));
  h.client.cache = null;
  h.client.currentUser = anonymousUser;
  const initialized = h.client.initializeAsync();
  h.client.currentUser = { ...anonymousUser, userID: 'newly-signed-in' };
  downloaded(snapshot());
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.calls.bootstrap, []);
  assert.equal(h.client.loadingStatus, 'Loading');
  h.remote.resolve(success('Network'));
  assert.deepEqual(await initialized, success('Network'));
});
