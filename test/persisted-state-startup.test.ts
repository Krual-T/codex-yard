import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { PersistedStateStartup } from '../src/native/persisted-state-startup.ts';
import type { HydrationOptions } from '../src/native/persisted-state-startup.ts';
import { adaptStartupModule } from '../src/native/startup-renderer.ts';

test('the original provider commits restored children with the matching permission context', async () => {
  const content = await readFile(new URL('../vendor/codex-app/26.1013.40934/webview/assets/app-initial-a68277f60b93.js', import.meta.url));
  const source = adaptStartupModule('/assets/app-initial-a68277f60b93.js', content).toString();
  const start = source.indexOf('function dEu('), end = source.indexOf('var fEu,pEu,mEu,hEu;', start);
  assert.ok(start >= 0 && end > start);
  for (const ready of [false, true]) for (const canWrite of [false, true]) for (const mode of ['host', 'timeout']) for (const excludedKeys of [undefined, ['excluded']]) {
    const startup = new PersistedStateStartup();
    let hydrate!: HydrationOptions, permission = false;
    startup.prepare(options => { hydrate = options; return () => {}; }, value => { permission = value; });
    if (ready) hydrate.onHydrated(canWrite);
    // Execute the adapted original component before its passive effect. This
    // catches a child layout effect observing an extra pending commit.
    const node = runInNewContext(source.slice(start, end) + '\ndEu({children:"restored",excludedKeys})', {
      fEu: { c: () => Array(10).fill(Symbol.for('react.memo_cache_sentinel')) },
      pEu: { useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, () => {}], useEffect() {} },
      mEu: { jsx: (type: string, props: object) => ({ type, props }) },
      hEu: false, pTt: () => mode, Ky: () => permission, N8: 'loading', qy: 'context',
      iEu: () => () => () => {}, window: { workbenchPersistedStateStartup: startup }, excludedKeys,
    }) as { type: string; props: { value?: string; children?: string } };
    assert.equal(node.type, ready && !excludedKeys ? 'context' : 'loading');
    if (node.type === 'context') {
      assert.equal(node.props.value, mode === 'host' ? canWrite ? 'enabled' : 'disabled' : 'pending');
      assert.equal(node.props.children, 'restored');
    }
    startup.dispose();
  }
});

for (const early of [false, true]) test(`original hydration transfers one subscription (completed early: ${early})`, () => {
  const startup = new PersistedStateStartup();
  let current: HydrationOptions | undefined, starts = 0, stops = 0;
  const permissions: boolean[] = [], updates: boolean[] = [];
  startup.prepare(options => { starts++; current = options; return () => { stops++; }; }, value => permissions.push(value));
  if (early) current!.onHydrated(true);
  assert.equal(startup.isHydrated(), early);
  assert.equal(startup.isHydrated(['excluded']), false);
  assert.equal(startup.get(['excluded']), undefined);
  const hydrate = startup.get()!;
  assert.equal(startup.get(), hydrate, 'render replay reads the same function without transferring ownership');
  const stop = hydrate({ onHydrated: value => updates.push(value) });
  assert.equal(startup.get(), undefined);
  assert.equal(starts, 1);
  assert.deepEqual(updates, early ? [true] : []);
  current!.onHydrated(false);
  assert.deepEqual(updates, early ? [true, false] : [false]);
  assert.deepEqual(permissions, early ? [true, false] : [false]);
  startup.dispose();
  assert.equal(stops, 0, 'provider owns the adopted subscription');
  stop();
  assert.equal(stops, 1);
  const replayStop = hydrate({ onHydrated: value => updates.push(value) });
  assert.equal(starts, 2, 'effect replay reuses the original hydrator');
  current!.onHydrated(true);
  assert.equal(updates.at(-1), true);
  replayStop();
  assert.equal(stops, 2);
});

test('closing before adoption cleans up the original restoration', () => {
  const startup = new PersistedStateStartup();
  let stopped = false;
  startup.prepare(() => () => { stopped = true; }, () => {});
  startup.get(); // A render which never commits must leave page cleanup intact.
  startup.dispose();
  assert.equal(stopped, true);
  assert.equal(startup.get(), undefined);
});

test('a failed setup leaves the original provider path available', () => {
  const startup = new PersistedStateStartup();
  assert.throws(() => startup.prepare(() => { throw new Error('hydrate failed'); }, () => {}), /hydrate failed/);
  assert.equal(startup.get(), undefined);
  assert.equal(startup.isHydrated(), false);
});
