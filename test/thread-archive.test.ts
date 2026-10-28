import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';
import { readThreadArchived } from '../src/renderer/app/thread-archive.ts';

test('archive authority follows the actual host through all pages and rejects incomplete cursor cycles', async () => {
  const calls: unknown[] = [];
  let cycle = false;
  const client = { async rpc(method: string, params: Record<string, unknown>, hostId: string) {
    calls.push([method, hostId, params.cursor]);
    return params.cursor === null ? { data: [{ id: 'different' }], nextCursor: 'next' }
      : cycle ? { data: [], nextCursor: 'next' } : { data: [{ id: 'wanted' }], nextCursor: null };
  } } as WorkbenchClient;
  assert.equal(await readThreadArchived(client, { hostId: 'ssh-a', threadId: 'wanted' }), true);
  assert.deepEqual(calls, [['thread/list', 'ssh-a', null], ['thread/list', 'ssh-a', 'next']]);
  assert.equal(await readThreadArchived(client, { hostId: 'ssh-b', threadId: 'absent' }), false);
  cycle = true;
  await assert.rejects(readThreadArchived(client, { hostId: 'ssh-b', threadId: 'wanted' }), /分页游标重复/);
});
