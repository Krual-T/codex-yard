import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { isRecord } from '../lib/codex-protocol.ts';
import { createFakeCodex, fixtureThread, NO_REPLY } from './fake-codex.ts';

const run = promisify(execFile);
const helper = fileURLToPath(new URL('../scripts/set-thread-title.ts', import.meta.url));

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "agents-host' tools-"));
  const fake = await createFakeCodex(root);
  t.after(async () => { await fake.close(); await rm(root, { recursive: true, force: true }); });
  const thread = fixtureThread('existing-thread', root, { source: 'cli', name: 'Original title' });
  fake.threads.set(thread.id, thread);
  return { root, fake, thread,
    run(...extra: string[]) { return run(process.execPath, [helper, '--socket', fake.socketPath, '--thread-id', thread.id, ...extra],
      { cwd: root, timeout: 5_000 }); },
  };
}

function assertNoExecution(fake: Awaited<ReturnType<typeof createFakeCodex>>) {
  for (const method of ['thread/start', 'thread/resume', 'turn/start', 'turn/steer', 'turn/interrupt']) {
    assert.equal(fake.calls(method).length, 0, method);
  }
}

test('the title helper trims a literal title and changes only the requested Codex thread', async t => {
  const h = await fixture(t);
  const other = fixtureThread('another-existing-thread', h.root, { name: 'Keep this title' });
  h.fake.threads.set(other.id, other);
  const title = "🛠️ AGENTS · 保留 '引号' 与 $(literal)";
  const { stdout, stderr } = await h.run('--title', `  ${title}  `);
  assert.equal(stderr, '');
  assert.deepEqual(JSON.parse(stdout), { success: true, threadId: h.thread.id, title });
  assert.equal(h.fake.threads.get(h.thread.id)!.name, title);
  assert.equal(h.fake.threads.get(other.id)!.name, 'Keep this title');
  assert.equal(h.fake.calls('thread/name/set').length, 1);
  assertNoExecution(h.fake);
});

for (const failure of ['rejection', 'disconnect']) {
  test(`the title helper exits unsuccessfully after RPC ${failure} and never prints success`, async t => {
    const h = await fixture(t);
    h.fake.handlers.set('thread/name/set', (params, { socket }) => {
      if (failure === 'disconnect') {
        h.fake.defaultResult('thread/name/set', params);
        socket.terminate();
        return NO_REPLY;
      }
      throw Object.assign(new Error('Fixture title write rejected'), { code: -32010 });
    });
    await assert.rejects(h.run('--title', 'Attempted title'), (cause: unknown) => {
      assert.ok(isRecord(cause));
      assert.equal(cause.code, 1);
      assert.equal(cause.stdout, '');
      assert.equal(typeof cause.stderr, 'string');
      const result = JSON.parse(String(cause.stderr));
      assert.equal(result.success, false);
      assert.equal(result.uncertain, failure === 'disconnect');
      if (failure === 'rejection') assert.equal(result.message, 'Fixture title write rejected');
      else assert.match(result.message, /断开/);
      return true;
    });
    assert.equal(h.fake.threads.get(h.thread.id)!.name, failure === 'disconnect' ? 'Attempted title' : 'Original title');
    assert.equal(h.fake.calls('thread/name/set').length, 1);
    assert.equal(h.fake.calls('initialize').length, 1, 'the helper never reconnects or retries a write');
    assertNoExecution(h.fake);
  });
}

test('the title helper rejects a missing or multiline title without renaming the existing thread', async t => {
  const h = await fixture(t);
  for (const args of [[], ['--title', 'first line\nsecond line']]) {
    await assert.rejects(h.run(...args), (cause: unknown) => {
      assert.ok(isRecord(cause));
      assert.equal(cause.code, 1);
      assert.equal(cause.stdout, '');
      assert.equal(typeof cause.stderr, 'string');
      const result = JSON.parse(String(cause.stderr));
      assert.equal(result.success, false);
      assert.equal(result.uncertain, false);
      assert.match(result.message, args.length ? /标题/ : /--title/);
      return true;
    });
  }
  assert.equal(h.fake.threads.get(h.thread.id)!.name, 'Original title');
  assert.equal(h.fake.calls('thread/name/set').length, 0);
  assertNoExecution(h.fake);
});
