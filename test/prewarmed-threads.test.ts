import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PrewarmedThreads } from '../src/native/prewarmed-threads.ts';

test('prewarm identity controls visibility across hosts, content and both notification orders', t => {
  const published: string[] = [];
  const tracker = new PrewarmedThreads({ publish: (host, thread) => published.push(host + ':' + thread.id),
    expire: async () => {}, onError: error => { throw error; } });
  t.after(() => tracker.close());
  tracker.track('local', { id: 'same', name: 'Already titled' });
  tracker.track('remote', { id: 'same' });
  const list = { data: [{ id: 'same' }, { id: 'ordinary-empty' }], nextCursor: 'next' };
  assert.deepEqual(tracker.filterList('local', list), { data: [{ id: 'ordinary-empty' }], nextCursor: 'next' });
  assert.equal(tracker.suppressStarted('local', { id: 'same' }), true);
  assert.equal(tracker.suppressStarted('local', { id: 'ordinary-empty' }), false);
  tracker.publish('local', 'same'); tracker.publish('local', 'same');
  assert.deepEqual(published, ['local:same']);
  assert.equal(tracker.isHidden('local', 'same'), false);
  assert.equal(tracker.isHidden('remote', 'same'), true);
  // Another connection can deliver the original notification after publication.
  assert.equal(tracker.suppressStarted('local', { id: 'same' }), true);
  tracker.publish('remote', 'same');
  assert.equal(tracker.suppressStarted('remote', { id: 'same' }), true);
  assert.deepEqual(published, ['local:same', 'remote:same']);
  assert.deepEqual(list.data, [{ id: 'same' }, { id: 'ordinary-empty' }]);
});

test('expiry cleans only unused prewarms and a closed host releases its timers', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const expired: string[] = [], errors: unknown[] = [];
  const tracker = new PrewarmedThreads({ publish: () => {}, expire: async (_host, id) => { expired.push(id); },
    onError: error => errors.push(error) });
  tracker.track('local', { id: 'unused' }); tracker.track('local', { id: 'used' });
  tracker.publish('local', 'used');
  t.mock.timers.tick(600_000);
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(expired, ['unused']);
  assert.equal(tracker.isHidden('local', 'unused'), false);
  tracker.track('local', { id: 'closed' }); tracker.close();
  t.mock.timers.tick(600_000);
  assert.deepEqual(expired, ['unused']); assert.deepEqual(errors, []);
});

test('a failed prewarm releases unrelated creation notifications', async t => {
  const delivered: string[] = [];
  const tracker = new PrewarmedThreads({ publish: () => {}, expire: async () => {}, onError: error => { throw error; } });
  t.after(() => tracker.close());
  let fail: (error: Error) => void = () => {};
  const pending = tracker.start('local', () => new Promise((_resolve, reject) => { fail = reject; }));
  tracker.started('local', { id: 'ordinary' }, () => { delivered.push('ordinary'); });
  assert.deepEqual(delivered, []);
  fail(new Error('Prewarm rejected'));
  await assert.rejects(pending, /Prewarm rejected/);
  assert.deepEqual(delivered, ['ordinary']);
});
