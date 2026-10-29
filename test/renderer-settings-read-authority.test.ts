import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';
import type { SettingsConfigOperations } from '../src/renderer/settings/config-operations.ts';
import { HookSettings } from '../src/renderer/settings/hooks.ts';
import { SkillSettings } from '../src/renderer/settings/skills.ts';

for (const Controller of [HookSettings, SkillSettings]) {
  test(`${Controller.name} keeps the original page authority across the browser-operation lookup`, async () => {
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const reading = new Promise<void>(resolve => { entered = resolve; });
    const operations = { async find() { entered(); await gate; return null; } } as unknown as SettingsConfigOperations;
    const dispatches: string[] = [];
    const client = {
      async rpc<T>(method: string, _params: unknown, _host: unknown, options?: Parameters<WorkbenchClient['rpc']>[3]): Promise<T> {
        options?.assertBeforeSend?.();
        dispatches.push(method);
        throw new Error('A stale settings page dispatched a request.');
      },
    } as unknown as WorkbenchClient;
    let current = true, captures = 0;
    const settings = new Controller(client, 'local', ['/fixture'], operations, () => {
      captures++;
      return () => { if (!current) throw new Error('Original settings page changed'); };
    });
    const pending = settings.load();
    await reading;
    current = false; release();
    await pending;
    assert.equal(captures, 1);
    assert.deepEqual(dispatches, []);
    assert.match(settings.getSnapshot().error ?? '', /Original settings page changed/);
    assert.equal(settings.getSnapshot().loading, false);
  });
}
