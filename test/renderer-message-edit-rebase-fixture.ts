import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { ThreadSummary } from '../lib/codex-protocol.ts';
import { MessageEditRecoveryStore, messageEditRebaseMarker } from '../src/renderer/app/message-edit-recovery.ts';
import type { EditRecoveryStorage, StoredMessageEdit } from '../src/renderer/app/message-edit-recovery.ts';
import { draftToInput } from '../src/renderer/composer/standalone-draft.ts';
import { StandaloneMessages } from '../src/renderer/messages/StandaloneMessages.tsx';
import { editSourceSignature } from '../src/renderer/messages/message-edit.ts';
import type { MessageEditNavigationController } from '../src/renderer/messages/use-message-editing.ts';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';

const source = { id: 'user-original', type: 'userMessage', content: [
  { type: 'text', text: 'Original @item', text_elements: [{ byteRange: { start: 9, end: 14 }, placeholder: '@item', context: { browser: 'synthetic' } }] },
  { type: 'image', fileId: 'fixture-file', detail: 'high' }, { type: 'mention', name: 'workspace', path: '/work' },
] };
const initial: ThreadSummary = { id: 'thread-a', name: null, cwd: '/work', status: { type: 'idle' }, turns: [
  { id: 'before', status: 'completed', itemsView: 'full', items: [] },
  { id: 'source', status: 'completed', itemsView: 'full', items: [source] },
] };
let backend = structuredClone(initial), projection = structuredClone(initial), host = 'host-a', visible = true;
let unchangedBackend: ThreadSummary | null = null;
let saved: unknown, state: StoredMessageEdit | null = null, controller: MessageEditNavigationController | null = null;
let gate: Promise<void> | null = null, releaseGate: (() => void) | null = null, entered = false;
let submits = 0, commits = 0, completedChecks = 0, rejectFirstStart = false, rejectNextSave = false;
const calls: Record<string, unknown>[] = [];
const storage: EditRecoveryStorage = { read: () => structuredClone(saved), update: async change => {
  if (rejectNextSave) { rejectNextSave = false; throw new Error('Synthetic recovery write failed'); }
  saved = structuredClone(change(structuredClone(saved))); return saved;
}, changed: () => { void sync(); } };
const client: WorkbenchClient = {
  rpc: async <T>(method: string, params: Record<string, unknown> = {}, hostId?: string) => {
    if (hostId !== 'host-a' || params.threadId !== 'thread-a') throw new Error('unexpected history scope');
    if (method === 'thread/read') return { thread: { ...backend, turns: [] } } as T;
    if (method === 'thread/turns/list') {
      if (gate) { const waiting = gate; gate = null; entered = true; await waiting; }
      return { data: backend.turns, nextCursor: null } as T;
    }
    throw new Error(`unexpected read ${method}`);
  },
  host: async <T>(endpoint: string, params: Record<string, unknown> = {}) => {
    if (endpoint !== 'message-edit') throw new Error(`unexpected host ${endpoint}`);
    calls.push(structuredClone(params));
    if (params.operation === 'submit' && ++submits === 1) {
      if (rejectFirstStart) {
        backend = { ...backend, turns: [backend.turns[0]!] };
        return { stage: 'reverted', error: 'Synthetic start rejected' } as T;
      }
      const turnParams = params.turnParams as { input: Record<string, unknown>[] };
      backend = { ...backend, turns: [backend.turns[0]!, { id: 'sent-a', status: 'completed', itemsView: 'full', items: [
        { id: 'user-a', type: 'userMessage', clientId: params.clientUserMessageId, content: structuredClone(turnParams.input) },
      ] }] };
      throw new Error('Synthetic response lost after A started');
    }
    if (params.operation === 'submit') {
      const item = backend.turns.find(turn => turn.id === (params.origin as { turnId: string }).turnId)?.items
        .find(value => value.id === (params.origin as { itemId: string }).itemId);
      const expected = { clientUserMessageId: item?.clientId, signature: item && editSourceSignature(item) };
      if (!item || JSON.stringify(params.expectedSource) !== JSON.stringify(expected)) throw new Error('synthetic host source guard failed');
    }
    return { stage: 'started', turn: { id: params.operation === 'check' ? 'sent-a' : 'sent-b', status: 'completed', items: [] } } as T;
  },
  subscribe: () => () => {}, reply: async () => {},
};
const store = new MessageEditRecoveryStore(client, storage, { hostChecksRebasedSourceBeforeRevert: true });
const root = createRoot(document.getElementById('root')!);
async function sync() { state = await store.read('host-a', 'thread-a'); render(); }
function render() {
  root.render(visible ? createElement(StandaloneMessages, { client, hostId: host, thread: projection,
    editHistory: { order: 'ascending', tailComplete: true }, editRecovery: state?.recovery ?? null,
    editRebase: messageEditRebaseMarker(state), onEditNavigationController: (value: MessageEditNavigationController | null) => { controller = value; },
    onEditDraftChange: (value, origin, version) => store.save(value, origin, version),
    onEdit: async (draft, origin, prepare) => { await prepare(); await store.submit(origin, projection.turns.map(turn => turn.id), { input: draftToInput(draft, host) }); },
    onPrepareEditRebase: async (origin, version) => {
      try { return await store.prepareRebase(origin, version); }
      finally { completedChecks++; }
    },
    onCommitEditRebase: async candidate => { commits++; return store.commitRebase(candidate); },
  }) : null);
}
Object.assign(window, { editRebaseHarness: {
  calls, commits: () => commits, checks: () => completedChecks, saved: () => structuredClone(state), entered: () => entered,
  rejectStart: () => { rejectFirstStart = true; },
  rejectSave: () => { rejectNextSave = true; },
  refresh: () => { projection = structuredClone(backend); render(); },
  hideSource: () => { projection = { ...projection, turns: projection.turns.slice(0, 1) }; render(); },
  hide: () => { visible = false; render(); }, show: () => { visible = true; void sync(); },
  host: (value: string) => { host = value; render(); },
  thread: (value: string) => { projection = { ...projection, id: value }; render(); },
  hold: () => { entered = false; gate = new Promise<void>(resolve => { releaseGate = resolve; }); },
  release: () => { releaseGate?.(); releaseGate = null; },
  alterHistory: (kind: 'new-user' | 'new-turn' | 'running' | 'attachment' | 'restore') => {
    if (kind === 'restore') {
      if (!unchangedBackend) throw new Error('No synthetic history to restore.');
      backend = unchangedBackend;
      unchangedBackend = null;
      return;
    }
    if (unchangedBackend) throw new Error('Restore the previous synthetic history first.');
    unchangedBackend = structuredClone(backend);
    if (kind === 'new-user') backend.turns.push({ id: 'later', status: 'completed', itemsView: 'full',
      items: [{ id: 'later-user', type: 'userMessage', content: [{ type: 'text', text: 'later' }] }] });
    if (kind === 'new-turn') backend.turns.push({ id: 'later', status: 'completed', itemsView: 'full',
      items: [{ id: 'later-info', type: 'agentMessage', text: 'later output' }] });
    if (kind === 'running') backend.turns[1]!.status = 'inProgress';
    if (kind === 'attachment') {
      const content = backend.turns[1]!.items[0]!.content as Record<string, unknown>[];
      content[1]!.detail = 'low';
    }
  },
  leave: async () => {
    if (!controller) throw new Error('Navigation controller is missing.');
    const lease = controller.freeze();
    if (!lease) throw new Error('Expected an active editor to freeze.');
    await lease.flush();
    visible = false;
    render();
  },
} });
render();
