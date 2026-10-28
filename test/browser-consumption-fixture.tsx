import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { StandaloneBrowser } from '../src/renderer/browser/index.tsx';
import { addBrowserComment, browserCommentsAtomKey, browserOwnerKey,
  readBrowserCommentsSnapshot } from '../src/renderer/browser/comments.ts';
import type { BrowserOwner, BrowserReference } from '../src/renderer/browser/comments.ts';
import { acknowledgeSubmittedBrowserReferences, browserDraftOwner, removeBrowserDraftReference,
  watchBrowserDraftDeletions } from '../src/renderer/app/browser-draft.ts';
import { SendRecoveryStore } from '../src/renderer/app/send-recovery.ts';
import type { SendIntent } from '../src/renderer/app/send-recovery.ts';
import { StandaloneComposer } from '../src/renderer/composer/StandaloneComposer.tsx';
import type { ComposerDraftController, ComposerDraftSnapshot } from '../src/renderer/composer/StandaloneComposer.tsx';
import { bindComposerDraftToThread, clearComposerDraftRevision, readComposerDraftVersions,
  retainComposerDraftVersion } from '../src/renderer/composer/composer-draft-store.ts';
import { normalizeDraft } from '../src/renderer/composer/standalone-draft.ts';
import { readBrowserAtom, updateBrowserAtom } from '../src/renderer/storage/ui-atoms.ts';
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
const anchor = { kind: 'element' as const, pageUrl: 'https://fixture.invalid/page', framePath: [], title: 'Fixture element',
  immediateText: 'Example', role: 'button', name: 'Example', selector: '#fixture', elementPath: '#fixture', nearbyText: 'Example',
  rect: { x: 1, y: 2, width: 20, height: 10 }, elementMetadata: { tag: 'button', future: 'kept' } };

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
      mount(value) { setSnapshot(null); setOwner(value); void recovery.read().then(state => setBindings(state.bindings)); },
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
    };
  });
  const browserOwner = browserDraftOwner(owner, bindings);
  const apply = React.useCallback(async (value: BrowserOwner, update: Parameters<ComposerDraftController['update']>[1]) => {
    const current = controller.current, initial = current?.snapshot();
    const matches = () => JSON.stringify(browserDraftOwner(ownerRef.current, bindings)) === JSON.stringify(value);
    if (!current || !initial || !matches() || !await current.flush(initial.owner)) throw new Error('Fixture owner changed');
    const ready = current.snapshot();
    if (!ready || !matches() || !await current.update(ready.owner, update)) throw new Error('Fixture owner changed');
  }, [bindings]);
  const receiveController = React.useCallback((value: ComposerDraftController | null) => {
    controller.current = value; setControllerReady(value !== null);
  }, []);
  const browserKey = JSON.stringify(browserOwner);
  React.useEffect(() => {
    if (!controllerReady) return;
    return watchBrowserDraftDeletions(browserOwner, update => apply(browserOwner, update), () => {});
  }, [browserKey, controllerReady, apply, snapshot?.revision]);
  const empty = { text: '', images: [], files: [], references: [] };
  return <>
    <StandaloneComposer client={client} context={{ ...owner, cwd: '/fixture' }} busy={false}
      onDraftController={receiveController} onDraftChange={setSnapshot}
      onRemoveReference={(draftOwner, reference) => removeBrowserDraftReference(browserDraftOwner(draftOwner, bindings), reference)}
      onSubmit={async () => { throw new Error('Fixture does not perform inference'); }} onInterrupt={async () => {}} />
    {browserVisible ? <StandaloneBrowser client={client} {...browserOwner} browserTabId="fixture" draft={snapshot?.draft ?? empty}
      visible allowNavigation={false} onClose={() => {}} onDraftChange={apply} /> : null}
  </>;
}
createRoot(document.getElementById('root')!).render(<App />);
