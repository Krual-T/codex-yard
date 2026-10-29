import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LinkSettings } from '../src/renderer/browser/link-settings.ts';
import type { WorkbenchClient, WorkbenchEvent } from '../src/renderer/workbench-contract.ts';

const web = 'open-link-in-target-preference';
const local = 'open-local-url-in-target-preference';
const legacy = 'desktop-link-default-destination';
type Pending = { endpoint: string; key: string; guard?: () => void; resolve(value: unknown): void; reject(error: Error): void };

class Peer implements WorkbenchClient {
  pending: Pending[] = [];
  calls: string[] = [];
  listeners = new Set<(event: WorkbenchEvent) => void>();
  rpc<T>(): Promise<T> { return Promise.reject(new Error('Unexpected RPC')); }
  reply(): Promise<void> { return Promise.reject(new Error('Unexpected reply')); }
  host<T>(endpoint: string, params: Record<string, unknown> = {}, options?: { assertBeforeSend?: () => void }): Promise<T> {
    const key = String(params.key);
    this.calls.push(`${endpoint}:${key}`);
    return new Promise((resolve, reject) => this.pending.push({ endpoint, key, guard: options?.assertBeforeSend,
      resolve: value => resolve(value as T), reject }));
  }
  subscribe(listener: (event: WorkbenchEvent) => void): () => void {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  event(event: WorkbenchEvent): void { for (const listener of this.listeners) listener(event); }
  take(key: string): Pending {
    const index = this.pending.findIndex(request => request.key === key);
    assert.notEqual(index, -1, `Expected pending read of ${key}`);
    return this.pending.splice(index, 1)[0]!;
  }
}

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const missing = { exists: false };
const value = (saved: unknown) => ({ exists: true, value: saved });

test('read-only link preferences preserve explicit, legacy and proven missing values', async () => {
  const peer = new Peer();
  const links = new LinkSettings(peer, { assertCurrent() {} });
  assert.equal(links.getSnapshot().status, 'idle');
  let changes = 0;
  const unsubscribe = links.subscribe(() => { changes++; });
  links.start();
  assert.deepEqual(peer.calls, [`get-setting:${web}`, `get-setting:${local}`, `get-persisted-atom:${legacy}`]);
  assert.equal(links.getSnapshot().web.status, 'loading');
  assert.equal(links.getSnapshot().forceExternal, true);
  assert.deepEqual(links.resolve('https://example.invalid/a?b=1#c', { browserPaneEnabled: null }),
    { kind: 'open', url: 'https://example.invalid/a?b=1#c', local: false, target: 'external-browser' });
  peer.take(web).resolve(missing); peer.take(local).resolve(missing); peer.take(legacy).resolve(missing);
  await flush();
  assert.deepEqual({ web: links.getSnapshot().web, local: links.getSnapshot().local, legacy: links.getSnapshot().legacy,
    forceExternal: links.getSnapshot().forceExternal, webTarget: links.getSnapshot().webTarget, localTarget: links.getSnapshot().localTarget },
  { web: { status: 'missing' }, local: { status: 'missing' }, legacy: { status: 'missing' }, forceExternal: false,
    webTarget: 'external-browser', localTarget: 'in-app-browser' });
  assert.deepEqual(links.resolve('http://localhost:4311/path', { browserPaneEnabled: null }),
    { kind: 'unavailable', reason: 'browser-capability' });
  assert.deepEqual(links.resolve('http://localhost:4311/path', { browserPaneEnabled: true }),
    { kind: 'open', url: 'http://localhost:4311/path', local: true, target: 'in-app-browser' });
  assert.deepEqual(links.resolve('https://example.invalid/', { browserPaneEnabled: null }),
    { kind: 'open', url: 'https://example.invalid/', local: false, target: 'external-browser' });
  assert.deepEqual(links.resolve('javascript:alert(1)', { browserPaneEnabled: true }), { kind: 'invalid-url' });
  assert.equal(peer.calls.length, 3, 'Click resolution does not perform a new host read');

  peer.event({ type: 'persisted-atom-updated', keys: [legacy] });
  assert.equal(links.getSnapshot().legacy.status, 'loading');
  assert.equal(links.getSnapshot().webTarget, null);
  peer.take(legacy).resolve(value('in-app-browser')); await flush();
  assert.equal(links.getSnapshot().webTarget, 'in-app-browser');
  assert.deepEqual(links.resolve('https://example.invalid/', { browserPaneEnabled: null }),
    { kind: 'unavailable', reason: 'browser-capability' });
  peer.event({ type: 'settings-changed', keys: [web] });
  assert.equal(links.getSnapshot().webTarget, null, 'A settings event synchronously expires its old observation');
  peer.take(web).resolve(value('external-browser')); await flush();
  assert.equal(links.getSnapshot().webTarget, 'external-browser', 'The explicit value overrides legacy');
  assert.equal(links.getSnapshot().localTarget, 'in-app-browser');
  const count = peer.calls.length;
  peer.event({ type: 'settings-changed', keys: ['unrelated'] });
  assert.equal(peer.calls.length, count);
  assert.ok(changes > 0);
  unsubscribe(); links.close();
  assert.equal(peer.listeners.size, 0);
});

test('failed and malformed values remain distinct from absence and can be retried', async () => {
  const peer = new Peer(), links = new LinkSettings(peer, { assertCurrent() {} });
  links.start();
  peer.take(web).resolve(value('in-app-browser')); peer.take(local).reject(new Error('host unavailable'));
  peer.take(legacy).resolve({ exists: 'yes', value: 'in-app-browser' });
  await flush();
  assert.deepEqual(links.getSnapshot().local, { status: 'error', message: 'host unavailable' });
  assert.deepEqual(links.getSnapshot().legacy, { status: 'invalid' });
  assert.equal(links.getSnapshot().forceExternal, false);
  assert.equal(links.getSnapshot().webTarget, 'in-app-browser');
  assert.deepEqual(links.resolve('https://example.invalid/', { browserPaneEnabled: true }),
    { kind: 'open', url: 'https://example.invalid/', local: false, target: 'in-app-browser' });
  assert.deepEqual(links.resolve('http://localhost/', { browserPaneEnabled: true }),
    { kind: 'unavailable', reason: 'preference' });
  assert.deepEqual(links.resolve('https://example.invalid/', { browserPaneEnabled: null, useExternalBrowser: true }),
    { kind: 'open', url: 'https://example.invalid/', local: false, target: 'external-browser' });
  peer.event({ type: 'settings-changed', keys: [local] });
  assert.equal(links.getSnapshot().webTarget, 'in-app-browser', 'Refreshing the local target does not invalidate the web target');
  peer.take(local).resolve(value('invalid-local-target')); await flush();
  assert.equal(links.getSnapshot().local.status, 'invalid');
  assert.equal(links.getSnapshot().webTarget, 'in-app-browser');
  links.retry();
  assert.equal(links.getSnapshot().webTarget, null, 'A retry is not a fresh initial loading gate');
  peer.take(web).resolve(value('bad-target')); peer.take(local).resolve(value('external-browser'));
  peer.take(legacy).resolve(value(null)); await flush();
  assert.deepEqual(links.getSnapshot().web, { status: 'invalid' });
  assert.deepEqual(links.getSnapshot().legacy, { status: 'value', value: null });
  assert.equal(links.getSnapshot().localTarget, 'external-browser');
  assert.deepEqual(links.resolve('http://localhost/', { browserPaneEnabled: null }),
    { kind: 'open', url: 'http://localhost/', local: true, target: 'external-browser' });
  peer.event({ type: 'settings-changed', key: web });
  peer.take(web).resolve({ exists: false, value: 'contradictory' }); await flush();
  assert.equal(links.getSnapshot().web.status, 'invalid');
  peer.event({ type: 'settings-changed', key: web });
  peer.take(web).resolve(missing); await flush();
  assert.equal(links.getSnapshot().webTarget, 'external-browser', 'A known null legacy value falls back to external');
  links.close();
});

test('superseded reads and old owners cannot revive after changes or reconnect', async () => {
  const peer = new Peer();
  let generation = 1;
  const captured = generation;
  const links = new LinkSettings(peer, { assertCurrent() { if (generation !== captured) throw new Error('stale owner'); } });
  links.start();
  const oldWeb = peer.take(web);
  peer.take(local).resolve(missing); peer.take(legacy).resolve(missing);
  peer.event({ type: 'settings-changed', keys: [web] });
  const middle = peer.take(web);
  peer.event({ type: 'settings-changed', keys: [web] });
  const newest = peer.take(web);
  newest.resolve(value('external-browser')); await flush();
  oldWeb.resolve(value('in-app-browser')); middle.resolve(value('in-app-browser')); await flush();
  assert.equal(links.getSnapshot().webTarget, 'external-browser');

  peer.event({ type: 'settings-changed', keys: [web] });
  const delayed = peer.take(web);
  generation++;
  assert.throws(() => delayed.guard?.(), /stale owner/);
  peer.event({ type: 'connection-state', state: 'disconnected' });
  assert.equal(links.getSnapshot().status, 'revoked');
  delayed.resolve(value('in-app-browser')); await flush();
  peer.event({ type: 'connection-state', state: 'connected' });
  assert.deepEqual(links.resolve('https://example.invalid/', { browserPaneEnabled: false, useExternalBrowser: true }),
    { kind: 'unavailable', reason: 'authority' });
  links.retry();
  assert.equal(peer.pending.length, 0);
  const fresh = new LinkSettings(peer, { assertCurrent() { if (generation !== 2) throw new Error('stale new owner'); } });
  fresh.start();
  peer.take(web).resolve(missing); peer.take(local).resolve(missing); peer.take(legacy).resolve(missing); await flush();
  assert.equal(fresh.getSnapshot().webTarget, 'external-browser');
  assert.equal(links.getSnapshot().status, 'revoked');
  fresh.close();
});

test('a synchronous scope failure revokes the snapshot before any click, even without an event', async () => {
  const peer = new Peer(); let active = true;
  const links = new LinkSettings(peer, { assertCurrent() { if (!active) throw new Error('scope changed'); } });
  links.start();
  peer.take(web).resolve(value('in-app-browser')); peer.take(local).resolve(missing); peer.take(legacy).resolve(missing); await flush();
  active = false;
  assert.deepEqual(links.resolve('https://example.invalid/', { browserPaneEnabled: true }), { kind: 'unavailable', reason: 'authority' });
  active = true;
  assert.equal(links.getSnapshot().status, 'revoked');
  assert.equal(peer.listeners.size, 0);
});
