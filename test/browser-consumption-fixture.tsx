import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { StandaloneBrowser } from '../src/renderer/browser/index.tsx';
import { attachBrowserComment, browserCommentsAtomKey, browserOwnerKey, changeBrowserComment, claimLegacyBrowserComment,
  claimProvenLegacyBrowserComments,
  pruneBrowserDraftDeletions, readBrowserCommentsSnapshot, removeBrowserReferenceFromDraft } from '../src/renderer/browser/comments.ts';
import { addBrowserComment } from './browser-comment-fixture.ts';
import type { BrowserOwner, BrowserReference } from '../src/renderer/browser/comments.ts';
import { sameBrowserValue } from '../src/renderer/browser/draft-transaction.ts';
import { acknowledgeSubmittedBrowserReferences, browserDraftOwner } from '../src/renderer/app/browser-draft.ts';
import { SendRecoveryStore } from '../src/renderer/app/send-recovery.ts';
import type { SendIntent } from '../src/renderer/app/send-recovery.ts';
import { StandaloneComposer } from '../src/renderer/composer/StandaloneComposer.tsx';
import type { ComposerDraftController, ComposerDraftExternalOperation, ComposerDraftSnapshot } from '../src/renderer/composer/StandaloneComposer.tsx';
import { bindComposerDraftToThread, clearComposerDraftRevision, composerDraftAtomKey, readComposerDraftVersions,
  retainComposerDraftVersion, writeComposerDraftVersion } from '../src/renderer/composer/composer-draft-store.ts';
import { draftToInput, normalizeDraft } from '../src/renderer/composer/standalone-draft.ts';
import { readBrowserAtom, subscribeBrowserAtoms, updateBrowserAtom } from '../src/renderer/storage/ui-atoms.ts';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';

export interface Fixture {
  mount(owner: BrowserOwner): void;
  showBrowser(value: boolean): void;
  snapshot(): ComposerDraftSnapshot | null;
  addComment(owner: BrowserOwner): Promise<BrowserReference>;
  seedComment(owner: BrowserOwner, comment: Record<string, unknown>): Promise<void>;
  comments(owner: BrowserOwner): ReturnType<typeof readBrowserCommentsSnapshot>;
  prepare(createdThread?: string): Promise<SendIntent>;
  confirm(id: string): Promise<SendIntent>;
  finish(id: string): Promise<void>;
  acknowledge(intent: SendIntent): Promise<void>;
  recovery(): ReturnType<SendRecoveryStore['read']>;
  versions(owner: BrowserOwner): ReturnType<typeof readComposerDraftVersions>;
  reserveVersion(owner: BrowserOwner, revision: string): Promise<SendIntent>;
  atom(key: string): Promise<unknown>;
  preserveUnknown(): Promise<void>;
  attempts(): number;
  change(owner: BrowserOwner, original: Record<string, unknown>, text: string | null, snapshot: ComposerDraftSnapshot): Promise<ComposerDraftSnapshot>;
  claim(owner: BrowserOwner, legacyOwner: string, expected: unknown[], index: number, keepBoth: boolean): Promise<void>;
  removeReference(owner: BrowserOwner, reference: BrowserReference, snapshot: ComposerDraftSnapshot): Promise<ComposerDraftSnapshot>;
  attach(owner: BrowserOwner, reference: BrowserReference, snapshot: ComposerDraftSnapshot): Promise<ComposerDraftSnapshot>;
  claimProven(owner: BrowserOwner, key: string): Promise<void>;
  holdSnapshot(): void;
  snapshotBlocked(): boolean;
  releaseSnapshot(): void;
  rejectNextCommit(): void;
  rejectNextBegin(): void;
  holdNextCommit(): void;
  commitBlocked(): boolean;
  releaseCommit(): void;
  forkVersion(owner: BrowserOwner, revision: string, text: string): Promise<void>;
  replaceVersion(snapshot: ComposerDraftSnapshot, revision: string, text: string): Promise<void>;
  dirty(): boolean;
  canLeave(): Promise<boolean>;
  closes(): number;
  setLegacyEvidence(key: string, owner: BrowserOwner): Promise<void>;
  input(): Record<string, unknown>[];
  injectReference(reference: { id: string; text: string; kind?: string }): Promise<boolean>;
  deletionReceipt(): ComposerDraftSnapshot | null;
  deletionCalls(): number;
  settle(): Promise<boolean>;
  setBinding(hostId: string, threadId: string, draftId: string): Promise<void>;
}
declare global { interface Window { browserConsumption: Fixture } }

const initialOwner: BrowserOwner = { hostId: 'local', threadId: 'thread-a', draftId: 'draft-a' };
const client: WorkbenchClient = {
  async rpc<T>(method: string): Promise<T> {
    if (method === 'model/list' || method === 'thread/queue/list') return { data: [], nextCursor: null } as T;
    if (method === 'config/read') return { config: {} } as T;
    throw new Error('Unexpected fixture RPC: ' + method);
  },
  async host<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (method === 'get-setting') return { value: params?.key === 'composerEnterBehavior' ? 'cmdAlways' : 'queue' } as T;
    if (method === 'chrome-connections') return { client: { connected: false }, server: { configured: false } } as T;
    return { configured: false, location: 'Fixture', pages: [] } as T;
  },
  subscribe() { return () => {}; },
  async reply() { throw new Error('Unexpected fixture approval'); },
};
const recovery = new SendRecoveryStore(client);
let attemptCount = 0;
let snapshotGate: Promise<void> | undefined, releaseGate: (() => void) | undefined, snapshotBlocked = false;
let rejectCommit = false, rejectBegin = false, dirty = false, closeCount = 0, recoveryBarrier: (() => Promise<void>) | null = null;
let commitGate: Promise<void> | undefined, releaseCommitGate: (() => void) | undefined, commitBlocked = false;
let deletionReceipt: ComposerDraftSnapshot | null = null, deletionCalls = 0;
const watcherReceipts = new Map<string, ComposerDraftSnapshot>();
const anchor = { kind: 'element' as const, pageUrl: 'https://fixture.invalid/page', framePath: [], title: 'Fixture element',
  immediateText: 'Example', role: 'button', name: 'Example', selector: '#fixture', elementPath: '#fixture', nearbyText: 'Example',
  rect: { x: 1, y: 2, width: 20, height: 10 }, elementMetadata: { tag: 'button', future: 'kept' } };
const resolveLegacyOwner = (atoms: Readonly<Record<string, unknown>>, key: string): BrowserOwner | null => {
  const evidence = atoms['fixture.legacy-identity'];
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
  const owner = (evidence as Record<string, unknown>)[key];
  if (!owner || typeof owner !== 'object' || Array.isArray(owner)) return null;
  const value = owner as Record<string, unknown>;
  return typeof value.hostId === 'string' && (value.threadId === null || typeof value.threadId === 'string')
    && typeof value.draftId === 'string' ? { hostId: value.hostId, threadId: value.threadId, draftId: value.draftId } : null;
};

function App() {
  const [owner, setOwner] = React.useState(initialOwner);
  const [bindings, setBindings] = React.useState<Record<string, string>>({});
  const [snapshot, setSnapshot] = React.useState<ComposerDraftSnapshot | null>(null);
  const [controllerReady, setControllerReady] = React.useState(false);
  const [browserVisible, setBrowserVisible] = React.useState(true);
  const controller = React.useRef<ComposerDraftController | null>(null);
  const ownerRef = React.useRef(owner);
  React.useLayoutEffect(() => { ownerRef.current = owner; }, [owner]);
  React.useLayoutEffect(() => {
    window.browserConsumption = {
      mount(value) {
        const current = controller.current?.snapshot();
        setSnapshot(current && JSON.stringify(current.owner) === JSON.stringify(value) ? current : null);
        setOwner(value); void recovery.read().then(state => setBindings(state.bindings));
      },
      showBrowser(value) { setBrowserVisible(value); },
      snapshot() { return controller.current?.snapshot() ?? null; },
      addComment(value) { return addBrowserComment(value, anchor); },
      async seedComment(value, comment) {
        await updateBrowserAtom(browserCommentsAtomKey, previous => {
          if (!previous || typeof previous !== 'object' || Array.isArray(previous)) throw new Error('Fixture comment store missing');
          const store = previous as Record<string, unknown>, entries = store.entries as Record<string, unknown>;
          return { ...store, entries: { ...entries, [browserOwnerKey(value)]: [comment] } };
        });
      },
      comments: readBrowserCommentsSnapshot,
      async prepare(createdThread) {
        const current = controller.current, value = current?.snapshot();
        if (!current || !value || !await current.flush(value.owner)) throw new Error('Fixture draft is not ready');
        const captured = current.snapshot();
        if (!captured) throw new Error('Fixture draft disappeared');
        await retainComposerDraftVersion(captured.owner, { revision: captured.revision, draft: normalizeDraft(captured.draft), prefills: [] });
        const intent = await recovery.prepare(captured, '/fixture', captured.draft, {}, {});
        if (createdThread) {
          await recovery.creating(intent.id, intent.attemptId);
          await recovery.created(intent.id, createdThread, undefined, intent.attemptId);
          await bindComposerDraftToThread(intent.owner, createdThread);
          setBindings((await recovery.read()).bindings);
        }
        await recovery.sending(intent.id, intent.attemptId); attemptCount += 1;
        return (await recovery.read()).requests[intent.id]!;
      },
      async confirm(id) {
        const intent = (await recovery.read()).requests[id];
        if (!intent) throw new Error('Fixture intent missing');
        return recovery.confirmed(id, 'fixture-turn', intent.attemptId);
      },
      async finish(id) {
        const state = await recovery.read(), intent = state.requests[id];
        if (!intent) throw new Error('Fixture intent missing');
        await acknowledgeSubmittedBrowserReferences(intent, null, state.bindings);
        await clearComposerDraftRevision(intent.owner, intent.revision);
        await recovery.dismiss(intent.id, intent);
      },
      async acknowledge(intent) { await acknowledgeSubmittedBrowserReferences(intent, null, {}); },
      recovery: () => recovery.read(),
      versions: readComposerDraftVersions,
      async reserveVersion(value, revision) {
        const versions = await readComposerDraftVersions(value), version = versions.versions.find(item => item.revision === revision);
        if (!version) throw new Error('Fixture version missing');
        return recovery.prepare({ owner: value, revision }, '/fixture', version.draft, {}, {});
      },
      atom: readBrowserAtom,
      async preserveUnknown() {
        await updateBrowserAtom('codex-yard.browser-comments.v1', previous => {
          if (!previous || typeof previous !== 'object' || Array.isArray(previous)) throw new Error('Fixture comment store missing');
          const store = previous as Record<string, unknown>, entries = store.entries as Record<string, unknown>;
          return { ...store, futureField: { preserved: true }, entries: { ...entries, 'legacy-unknown': [{ future: 1 }] } };
        });
      },
      attempts: () => attemptCount,
      change: changeBrowserComment,
      claim: claimLegacyBrowserComment,
      removeReference: removeBrowserReferenceFromDraft,
      attach: attachBrowserComment,
      claimProven(value, key) { return claimProvenLegacyBrowserComments(value, (_atoms, legacyKey) => legacyKey === key ? value : null); },
      holdSnapshot() { snapshotBlocked = false; snapshotGate = new Promise(resolve => { releaseGate = resolve; }); },
      snapshotBlocked: () => snapshotBlocked,
      releaseSnapshot() { releaseGate?.(); snapshotGate = undefined; releaseGate = undefined; },
      rejectNextCommit() { rejectCommit = true; },
      rejectNextBegin() { rejectBegin = true; },
      holdNextCommit() { commitBlocked = false; commitGate = new Promise(resolve => { releaseCommitGate = resolve; }); },
      commitBlocked: () => commitBlocked,
      releaseCommit() { releaseCommitGate?.(); releaseCommitGate = undefined; },
      async forkVersion(value, revision, text) {
        const snapshot = controller.current?.snapshot();
        if (!snapshot) throw new Error('Fixture draft missing');
        await writeComposerDraftVersion(value, 'fixture-no-such-revision', { revision, draft: normalizeDraft({ ...snapshot.draft, text }), prefills: [] });
      },
      async replaceVersion(snapshot, revision, text) {
        await writeComposerDraftVersion(snapshot.owner, snapshot.revision, { revision, draft: normalizeDraft({ ...snapshot.draft, text }), prefills: [] });
      },
      dirty: () => dirty,
      async canLeave() { try { await recoveryBarrier?.(); return true; } catch { return false; } },
      closes: () => closeCount,
      async setLegacyEvidence(key, value) {
        await updateBrowserAtom('fixture.legacy-identity', previous => ({ ...(previous && typeof previous === 'object' ? previous : {}), [key]: value }));
      },
      input() { const value = controller.current?.snapshot(); return value ? draftToInput(value.draft, value.owner.hostId) : []; },
      async injectReference(reference) {
        const current = controller.current, value = current?.snapshot();
        if (!current || !value) throw new Error('Fixture draft missing');
        return current.update(value.owner, draft => ({ ...draft, references: [...(draft.references ?? []), reference] }));
      },
      deletionReceipt: () => deletionReceipt,
      deletionCalls: () => deletionCalls,
      async settle() {
        const current = controller.current, value = current?.snapshot();
        if (!current || !value) return false;
        const lease = current.freeze(value.owner);
        if (!lease) return false;
        try { return await lease.flush(); } finally { lease.release(); }
      },
      async setBinding(hostId, threadId, draftId) {
        await updateBrowserAtom('codex-yard.send-recovery.v1', previous => {
          const state = previous ?? { requests: {}, bindings: {}, creations: {} };
          if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Fixture recovery state is invalid');
          const value = state as Record<string, unknown>, bindings = value.bindings;
          if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) throw new Error('Fixture bindings are invalid');
          return { ...value, bindings: { ...bindings, [JSON.stringify([hostId, threadId])]: draftId } };
        });
      },
    };
  });
  const browserOwner = browserDraftOwner(owner, bindings);
  const acceptCommitted = React.useCallback(async (before: ComposerDraftSnapshot, after: ComposerDraftSnapshot) => {
    return await controller.current?.acceptCommittedVersion(before, after) ?? false;
  }, []);
  const beginDraftOperation = React.useCallback((value: BrowserOwner): ComposerDraftExternalOperation | null => {
    if (rejectBegin) { rejectBegin = false; return null; }
    const current = controller.current, initial = current?.snapshot();
    const matches = () => JSON.stringify(browserDraftOwner(ownerRef.current, bindings)) === JSON.stringify(value);
    if (!current || !initial || !matches() || watcherReceipts.has(browserOwnerKey(value))
      || JSON.stringify(browserDraftOwner(initial.owner, bindings)) !== JSON.stringify(value)) return null;
    const operation = current.beginExternalOperation(initial.owner);
    if (!operation) return null;
    return {
      async transaction<T>(work: (before: ComposerDraftSnapshot, isCurrent: () => boolean) => Promise<{ after: ComposerDraftSnapshot; value: T }>) {
        if (snapshotGate) { snapshotBlocked = true; await snapshotGate; }
        const result = await operation.transaction(async (before, isCurrent) => {
          const response = await work(before, () => current === controller.current && matches() && isCurrent());
          const gate = commitGate;
          if (gate) { commitGate = undefined; commitBlocked = true; await gate; }
          return response;
        });
        if (rejectCommit) { rejectCommit = false; return { ...result, accepted: false }; }
        return result;
      },
      applyPrefill: prefill => operation.applyPrefill(prefill),
      finish: success => operation.finish(success),
    };
  }, [bindings]);
  const receiveController = React.useCallback((value: ComposerDraftController | null) => {
    controller.current = value; setControllerReady(value !== null);
  }, []);
  const browserKey = JSON.stringify(browserOwner);
  React.useEffect(() => {
    if (!controllerReady) return;
    let live = true, running = false, pending = false;
    const refresh = () => {
      pending = true;
      if (running) return;
      running = true;
      void (async () => {
        while (live && pending) {
          pending = false;
          const current = controller.current, initial = current?.snapshot();
          if (!current || !initial || watcherReceipts.has(browserOwnerKey(browserOwner))
            || JSON.stringify(browserDraftOwner(initial.owner, bindings)) !== browserKey) continue;
          const observed = await readBrowserCommentsSnapshot(browserOwner);
          if (!live || current !== controller.current || !observed.deleted.some(deleted =>
            (current.snapshot()?.draft.references ?? []).some(reference => sameBrowserValue(reference, deleted)))) continue;
          const operation = current.beginExternalOperation(initial.owner);
          if (!operation) continue;
          let success = false;
          try {
            const receipt = await operation.transaction(async (before, isCurrent) => {
              const after = await pruneBrowserDraftDeletions(browserOwner, before, () => live && current === controller.current && isCurrent());
              if (after.revision !== before.revision) watcherReceipts.set(browserOwnerKey(browserOwner), structuredClone(after));
              return { after, value: undefined };
            });
            if (receipt.accepted) { watcherReceipts.delete(browserOwnerKey(browserOwner)); success = true; }
          } finally { operation.finish(success); }
        }
      })().catch(() => {}).finally(() => { running = false; if (live && pending) refresh(); });
    };
    const unsubscribe = subscribeBrowserAtoms(keys => {
      if (keys.includes(browserCommentsAtomKey) || keys.includes(composerDraftAtomKey)) refresh();
    });
    refresh();
    return () => { live = false; unsubscribe(); };
  }, [browserKey, bindings, controllerReady, snapshot?.revision]);
  const onDirtyChange = React.useCallback((value: boolean) => { dirty = value; }, []);
  const onRecoveryBarrier = React.useCallback((value: (() => Promise<void>) | null) => { recoveryBarrier = value; }, []);
  const empty = { text: '', images: [], files: [], references: [] };
  return <>
    <StandaloneComposer client={client} context={{ ...owner, cwd: '/fixture' }} busy={false}
      onDraftController={receiveController} onDraftChange={setSnapshot}
      onRemoveReference={async (draftOwner, reference, operation) => {
        if (reference.kind !== 'browser') return;
        const target = browserDraftOwner(draftOwner, bindings);
        deletionCalls += 1;
        const receipt = await operation.transaction(async (before, isCurrent) => {
          const after = await removeBrowserReferenceFromDraft(target, reference as BrowserReference, before, isCurrent);
          deletionReceipt = structuredClone(after);
          return { after, value: undefined };
        });
        if (receipt.accepted) deletionReceipt = null;
        return 'handled';
      }}
      onSubmit={async () => { throw new Error('Fixture does not perform inference'); }} onInterrupt={async () => {}} />
    <StandaloneBrowser client={client} {...browserOwner} browserTabId="fixture" draft={snapshot?.draft ?? empty}
      visible={browserVisible} allowNavigation={false} onClose={() => { closeCount += 1; }} beginDraftOperation={beginDraftOperation}
      onDirtyChange={onDirtyChange} onRecoveryBarrier={onRecoveryBarrier}
      onDraftVersionCommitted={acceptCommitted} resolveLegacyOwner={resolveLegacyOwner} />
  </>;
}
createRoot(document.getElementById('root')!).render(<App />);
