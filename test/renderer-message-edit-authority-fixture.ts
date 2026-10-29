import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { ThreadSummary } from '../lib/codex-protocol.ts';
import { MessageEditRecoveryStore, messageEditChanged, messageEditsAtom } from '../src/renderer/app/message-edit-recovery.ts';
import type { EditRecoveryStorage } from '../src/renderer/app/message-edit-recovery.ts';
import { StandaloneMessages } from '../src/renderer/messages/StandaloneMessages.tsx';
import { editSourceSignature } from '../src/renderer/messages/message-edit.ts';
import type { MessageEditNavigationController, MessageEditNavigationLease, MessageEditRecovery } from '../src/renderer/messages/use-message-editing.ts';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';
import { readBrowserAtom, updateBrowserAtom } from '../src/renderer/storage/ui-atoms.ts';

const item = { id: 'user', type: 'userMessage', content: [{ type: 'text', text: 'original' }] };
const thread: ThreadSummary = { id: 'thread', name: null, cwd: '/fixture', status: { type: 'idle' }, turns: [
  { id: 'turn', status: 'completed', itemsView: 'full', items: [item] },
] };
const origin = { hostId: 'fixture-host', threadId: 'thread', turnId: 'turn', itemId: 'user' };
const draft = { text: 'original', input: [{ type: 'text', text: 'original' }], images: [], files: [] };
const initial: MessageEditRecovery = { origin, draft, editor: { sessionId: 'shared-session', revision: 0, baseDraft: draft,
  edits: [{ index: 0, text: 'original' }], addedText: '', sourceSignature: editSourceSignature(item), snapshot: item, turnIndex: 0, itemIndex: 0 } };
let failNextSave = false, captured: (() => void) | undefined, targetValid = true, hostCalls = 0;
let holdNextSubmit = false, gate: Promise<void> | undefined, releaseGate: (() => void) | undefined, waiting = false;
let holdNextPrepare = false, parentCalls = 0, connectionGeneration = 0, completedClears = 0;
let writtenText = '';
let holdNextRead = false, readWaiting = false, releaseRead: (() => void) | undefined;
let holdBeforeWrite = false, beforeWriteWaiting = false, releaseBeforeWrite: (() => void) | undefined, lastWriteError = '';
const client: WorkbenchClient = {
  rpc: async () => { throw new Error('unexpected RPC'); }, subscribe: () => () => {}, reply: async () => {},
  host: async () => { hostCalls++; throw new Error('fixture connection lost after dispatch'); },
};
const storage: EditRecoveryStorage = {
  read: async () => {
    const result = await readBrowserAtom(messageEditsAtom);
    if (holdNextRead) {
      holdNextRead = false;
      readWaiting = true;
      await new Promise<void>(resolve => { releaseRead = resolve; });
    }
    return result;
  },
  update: async change => {
    const fail = failNextSave;
    failNextSave = false;
    if (holdBeforeWrite) {
      holdBeforeWrite = false;
      beforeWriteWaiting = true;
      await new Promise<void>(resolve => { releaseBeforeWrite = resolve; });
    }
    const result = await updateBrowserAtom(messageEditsAtom, value => {
      if (fail) throw new Error('fixture IDB failure');
      return change(value);
    });
    if (gate) { const held = gate; gate = undefined; waiting = true; await held; }
    return result;
  },
  changed: () => window.dispatchEvent(new Event(messageEditChanged)),
};
const store = new MessageEditRecoveryStore(client, storage);
const access = { one: store.createAccess(), two: store.createAccess() };
let authorityFailures = 0;
for (const value of Object.values(access)) {
  const capture = value.capture;
  value.capture = origin => {
    const assertion = capture(origin);
    return () => { try { assertion(); } catch (reason) { authorityFailures++; throw reason; } };
  };
}
const controllers: Partial<Record<'one' | 'two', MessageEditNavigationController>> = {};
const leases: Partial<Record<'one' | 'two', MessageEditNavigationLease>> = {};
const root = createRoot(document.getElementById('root')!);
const visible = { one: true, two: true };
const editable = { one: true, two: true };
let suppliedRecovery: MessageEditRecovery | null = null;

function render() {
  const view = (name: 'one' | 'two') => visible[name] ? createElement('section', { 'data-view': name, key: name },
    createElement(StandaloneMessages, { client, hostId: origin.hostId, thread, editEnabled: editable[name], editRecovery: suppliedRecovery, editAccess: access[name],
      editHistory: { order: 'ascending', tailComplete: true },
      onEditNavigationController: value => { if (value) controllers[name] = value; else delete controllers[name]; },
      onEditDraftChange: async (value, target, version, authority) => {
        try { await store.save(value, target, version, authority); }
        catch (reason) { lastWriteError = reason instanceof Error ? reason.message : String(reason); throw reason; }
        if (!value) completedClears++;
        else writtenText = value.editor?.edits[0]?.text ?? '';
      },
      onEdit: async (_draft, target, prepare) => {
        parentCalls++;
        const assertAuthority = access[name].capture(target), connection = connectionGeneration;
        if (holdNextPrepare) {
          holdNextPrepare = false;
          gate = new Promise<void>(resolve => { releaseGate = resolve; });
        }
        await prepare();
        if (holdNextSubmit) {
          holdNextSubmit = false;
          gate = new Promise<void>(resolve => { releaseGate = resolve; });
        }
        await store.submit(target, ['turn'], {}, () => {
          assertAuthority();
          if (connection !== connectionGeneration) throw new Error('fixture connection changed before dispatch');
          if (!targetValid) throw new Error('fixture target changed before dispatch');
        });
      },
    })) : null;
  root.render(createElement('div', null, view('one'), view('two')));
}

async function initialize() {
  if (!await store.read(origin.hostId, origin.threadId)) await store.save(initial, origin, { sessionId: 'shared-session', revision: 0 });
  const recovered = (await store.read(origin.hostId, origin.threadId))!.recovery;
  suppliedRecovery = new URLSearchParams(location.search).has('unread') ? null : recovered;
  render();
}

Object.assign(window, { editAuthorityHarness: {
  ready: () => Boolean(controllers.one && controllers.two),
  saved: () => store.read(origin.hostId, origin.threadId),
  restore: async () => { suppliedRecovery = (await store.read(origin.hostId, origin.threadId))!.recovery; flushSync(render); },
  owner: (name: 'one' | 'two') => access[name].owns(origin),
  revoke: (name: 'one' | 'two') => { access[name].release(origin); },
  failNextSave: () => { failNextSave = true; },
  holdNextPrepare: () => { holdNextPrepare = true; waiting = false; },
  holdNextWrite: () => { waiting = false; gate = new Promise<void>(resolve => { releaseGate = resolve; }); },
  holdBeforeWrite: () => { holdBeforeWrite = true; beforeWriteWaiting = false; lastWriteError = ''; },
  beforeWriteWaiting: () => beforeWriteWaiting,
  releaseBeforeWrite: () => { releaseBeforeWrite?.(); releaseBeforeWrite = undefined; beforeWriteWaiting = false; },
  lastWriteError: () => lastWriteError,
  holdNextSubmit: () => { holdNextSubmit = true; waiting = false; },
  parentCalls: () => parentCalls,
  completedClears: () => completedClears,
  authorityFailures: () => authorityFailures,
  writtenText: () => writtenText,
  changeConnection: () => { connectionGeneration++; },
  holdNextRead: () => { holdNextRead = true; readWaiting = false; },
  readWaiting: () => readWaiting,
  releaseRead: () => { releaseRead?.(); releaseRead = undefined; readWaiting = false; },
  show: (name: 'one' | 'two', value: boolean) => { visible[name] = value; render(); },
  setEditable: (name: 'one' | 'two', value: boolean) => { editable[name] = value; flushSync(render); },
  acquire: (name: 'one' | 'two') => access[name].acquire(origin),
  waiting: () => waiting,
  targetValid: (value: boolean) => { targetValid = value; },
  releaseGate: () => { releaseGate?.(); releaseGate = undefined; waiting = false; },
  hostCalls: () => hostCalls,
  freeze: (name: 'one' | 'two') => {
    const lease = controllers[name]?.freeze();
    if (!lease) throw new Error('No editor to freeze.');
    leases[name] = lease;
    return lease.version;
  },
  flush: async (name: 'one' | 'two') => { await leases[name]!.flush(); },
  handoff: (name: 'one' | 'two') => { leases[name]!.handoff(); },
  release: (name: 'one' | 'two') => { leases[name]!.release(); },
  capture: (name: 'one' | 'two') => { captured = access[name].capture(origin); },
  capturedValid: () => { try { captured?.(); return true; } catch { return false; } },
} });
void initialize();
