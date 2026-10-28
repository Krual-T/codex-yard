import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentInstructionsLimit, createAgentInstructions } from '../src/native/agent-instructions.ts';
import type { AgentInstructionsAccess, AgentInstructionsSave } from '../src/native/agent-instructions.ts';

function fixture() {
  const files = new Map<string, string>();
  const writes: { host: string; path: string; contents: string }[] = [];
  const access: AgentInstructionsAccess = {
    async resolveHome(host) { return host === 'windows' ? 'C:\\fixture\\codex' : '/fixture/codex'; },
    async readText(_host, path, maxBytes) {
      assert.equal(maxBytes, agentInstructionsLimit);
      return files.get(path) ?? null;
    },
    async writeBytes(host, path, bytes) {
      const contents = Buffer.from(bytes).toString('utf8');
      writes.push({ host, path, contents }); files.set(path, contents);
    },
  };
  return { files, writes, access, service: createAgentInstructions(access) };
}
const request = (contents: string, expectedContents: string | null = null): AgentInstructionsSave => ({
  hostId: 'ssh:fixture', fileName: 'AGENTS.md', contents, expectedContents,
});

test('instructions save targets only a selected host home and preserves missing-file semantics', async () => {
  const f = fixture();
  assert.deepEqual(await f.service.save(request('first\n')), { saved: true });
  await f.service.save({ hostId: 'windows', fileName: 'AGENTS.override.md', contents: 'override', expectedContents: null });
  assert.deepEqual(f.writes, [
    { host: 'ssh:fixture', path: '/fixture/codex/AGENTS.md', contents: 'first\n' },
    { host: 'windows', path: 'C:\\fixture\\codex\\AGENTS.override.md', contents: 'override' },
  ]);
  await assert.rejects(f.service.save(request('second', null)), /changed on the host/);
  await f.service.save(request('second', 'first\n'));
  assert.equal(f.files.get('/fixture/codex/AGENTS.md'), 'second');
});

test('instructions reject untrusted targets, invalid text and oversized edits before writing', async () => {
  const f = fixture();
  await assert.rejects(f.service.save({ ...request('x'), fileName: '../other' as AgentInstructionsSave['fileName'] }), /Invalid instructions/);
  await assert.rejects(f.service.save({ ...request('x'), hostId: '' }), /Invalid instructions/);
  await assert.rejects(f.service.save(request('x'.repeat(agentInstructionsLimit + 1))), /10 MiB/);
  await assert.rejects(f.service.save(request('x', 'x'.repeat(agentInstructionsLimit + 1))), /10 MiB/);
  await assert.rejects(f.service.save(request('\ud800')), /Invalid instructions/);
  const badHome = createAgentInstructions({ ...f.access, async resolveHome() { return 'relative/home'; } });
  await assert.rejects(badHome.save(request('x')), /absolute Codex home/);
  assert.equal(f.writes.length, 0);
});

test('overlapping Yard writes serialize across aliases and do not overwrite a stale baseline', async () => {
  const f = fixture();
  let release: () => void = () => {};
  let entered: () => void = () => {};
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const originalWrite = f.access.writeBytes;
  f.access.writeBytes = async (...args) => { entered(); await waiting; await originalWrite(...args); };
  const first = f.service.save(request('first'));
  await started;
  const second = f.service.save({ ...request('second'), hostId: 'another-alias' });
  release();
  assert.deepEqual(await first, { saved: true });
  await assert.rejects(second, /changed on the host/);
  assert.equal(f.files.get('/fixture/codex/AGENTS.md'), 'first');
  assert.equal(f.writes.length, 1);
});

test('uncertain, readonly and unreadable saves never report success or replay writes', async () => {
  for (const scenario of ['readonly', 'lost-reply', 'readback'] as const) {
    const f = fixture(), originalWrite = f.access.writeBytes, originalRead = f.access.readText;
    let reads = 0;
    f.access.writeBytes = async (...args) => {
      if (scenario === 'readonly') throw new Error('read only');
      await originalWrite(...args);
      if (scenario === 'lost-reply') throw new Error('connection closed');
    };
    f.access.readText = async (...args) => {
      if (++reads === 2 && scenario === 'readback') throw new Error('connection closed');
      return originalRead(...args);
    };
    await assert.rejects(f.service.save(request('draft')), /Could not confirm/);
    assert.equal(f.writes.length, scenario === 'readonly' ? 0 : 1);
    if (scenario !== 'readonly') await assert.rejects(f.service.save(request('draft')), /changed on the host/);
    assert.equal(f.writes.length, scenario === 'readonly' ? 0 : 1);
  }
});
