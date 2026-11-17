import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { RendererCache } from '../src/native/renderer-cache.ts';

test('concurrent immutable-asset requests share adaptation and compression without changing bytes', async () => {
  const cache = new RendererCache();
  const source = Buffer.from('export const greeting = "你好";\n'.repeat(100));
  let reads = 0;
  const read = async () => { reads++; return source; };
  const [a, b] = await Promise.all([cache.load('module', read, true), cache.load('module', read, true)]);
  assert.equal(reads, 1);
  assert.equal(a, b);
  assert.deepEqual(a.content, source);
  assert.deepEqual(gunzipSync(a.compressed!), source);
  await cache.load('module', read, true);
  assert.equal(reads, 1);
});

test('renderer cache stays bounded and a failed load can be retried', async () => {
  const cache = new RendererCache(8);
  const loads: string[] = [];
  const load = (key: string) => cache.load(key, async () => { loads.push(key); return Buffer.from('1234'); }, false);
  await load('a'); await load('b'); await load('a'); await load('c'); await load('b');
  assert.deepEqual(loads, ['a', 'b', 'c', 'b']);
  await assert.rejects(cache.load('missing', async () => { throw new Error('missing asset'); }, false), /missing asset/);
  assert.equal((await cache.load('missing', async () => Buffer.from('ok'), false)).content.toString(), 'ok');
});
