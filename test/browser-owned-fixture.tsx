import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { browserOwnerKey, browserReferences,
  readBrowserComments, readLegacyBrowserComments, StandaloneBrowser, subscribeBrowserComments } from '../src/renderer/browser/index.tsx';
import { adoptLegacyBrowserComments } from './browser-comment-fixture.ts';
import { readBrowserAtom } from '../src/renderer/storage/ui-atoms.ts';
import { acknowledgeSubmittedBrowserReferences } from '../src/renderer/app/browser-draft.ts';
import { SendRecoveryStore } from '../src/renderer/app/send-recovery.ts';
import { StandaloneComposer } from '../src/renderer/composer/StandaloneComposer.tsx';
import type { ComposerDraftController, ComposerDraftSnapshot } from '../src/renderer/composer/StandaloneComposer.tsx';
import type { BrowserOwner, BrowserReference } from '../src/renderer/browser/index.tsx';
import type { ComposerDraft, WorkbenchClient } from '../src/renderer/workbench-contract.ts';

interface Identity extends BrowserOwner { browserTabId: string }
interface Harness {
  mount(identity: Identity): void;
  unmount(): void;
  visible(value: boolean): void;
  identity(): Identity | null;
  draft(): ComposerDraft;
  setText(value: string): void;
  adopt(legacyOwner: string): Promise<void>;
  acknowledge(references: BrowserReference[]): Promise<void>;
  references(): BrowserReference[];
  readReferences(): Promise<BrowserReference[]>;
  commentStore(): Promise<{ legacyRaw: string | null; entries: Record<string, unknown> }>;
}
declare global { interface Window { browserHarness: Harness } }

const pageSession = crypto.randomUUID();
const client: WorkbenchClient = {
  async reply() { throw new Error('Unexpected server response'); },
  async host<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    if (endpoint === 'get-setting') return { value: params?.key === 'composerEnterBehavior' ? 'cmdAlways' : 'queue' } as T;
    const response = await fetch('/host', { method: 'POST', headers: { 'content-type': 'application/json', 'x-fixture-session': pageSession },
      body: JSON.stringify({ endpoint, params }) });
    const result = await response.json() as { value?: T; error?: string };
    if (!response.ok) throw new Error(result.error);
    return result.value as T;
  },
  async rpc<T>(method: string): Promise<T> {
    if (method === 'model/list' || method === 'thread/queue/list') return { data: [], nextCursor: null } as T;
    if (method === 'config/read') return { config: {} } as T;
    throw new Error('Unexpected daemon call: ' + method);
  },
  subscribe() { return () => {}; },
};

function App() {
  const [identity, setIdentity] = React.useState<Identity | null>(null);
  const [shown, setShown] = React.useState(true);
  const [draftSnapshot, setDraftSnapshot] = React.useState<ComposerDraftSnapshot | null>(null);
  const controller = React.useRef<ComposerDraftController | null>(null);
  const receiveController = React.useCallback((value: ComposerDraftController | null) => { controller.current = value; }, []);
  const [snapshot, setSnapshot] = React.useState<{ key: string; references: BrowserReference[] }>({ key: '', references: [] });
  const active = React.useRef<Identity | null>(null);
  React.useLayoutEffect(() => { active.current = identity; }, [identity]);
  const key = identity ? browserOwnerKey(identity) : '';
  React.useEffect(() => {
    if (!identity) return;
    let live = true, generation = 0;
    const refresh = () => {
      const current = ++generation;
      void readBrowserComments(identity).then(comments => {
        if (live && current === generation) setSnapshot({ key, references: browserReferences(identity, comments) });
      }).catch(() => {});
    };
    const unsubscribe = subscribeBrowserComments(refresh);
    refresh();
    return () => { live = false; unsubscribe(); };
  }, [key]);
  const draft = draftSnapshot && identity && browserOwnerKey(draftSnapshot.owner) === key
    ? draftSnapshot.draft : { text: '', images: [], files: [], references: [] };
  const latestDraft = React.useRef(draft);
  React.useLayoutEffect(() => { latestDraft.current = draft; }, [draft]);
  React.useLayoutEffect(() => {
    window.browserHarness = {
      mount(value) { setIdentity(value); setShown(true); },
      unmount() { setIdentity(null); },
      visible(value) { setShown(value); },
      identity() { return identity; },
      draft() { return draft; },
      setText(value) {
        const current = controller.current, snapshot = current?.snapshot();
        if (current && snapshot) void current.update(snapshot.owner, draft => ({ ...draft, text: value }));
      },
      async adopt(legacyOwner) {
        if (!identity) throw new Error('No owner');
        const legacy = await readLegacyBrowserComments(legacyOwner);
        if (!legacy) throw new Error('No legacy comments');
        await adoptLegacyBrowserComments(identity, legacyOwner, legacy);
      },
      async acknowledge(references) {
        if (!identity) throw new Error('No owner');
        const owner = { hostId: identity.hostId, threadId: identity.threadId, draftId: identity.draftId };
        const recovery = new SendRecoveryStore(client);
        const intent = await recovery.prepare({ owner, revision: crypto.randomUUID() }, '/fixture',
          { ...latestDraft.current, references }, {}, {});
        await recovery.sending(intent.id, intent.attemptId);
        const confirmed = await recovery.confirmed(intent.id, 'fixture-turn', intent.attemptId);
        await acknowledgeSubmittedBrowserReferences(confirmed, null, (await recovery.read()).bindings);
        await recovery.dismiss(intent.id, confirmed);
      },
      references() { return snapshot.key === key ? snapshot.references : []; },
      async readReferences() { return identity ? browserReferences(identity, await readBrowserComments(identity)) : []; },
      async commentStore() { return await readBrowserAtom('codex-yard.browser-comments.v1') as { legacyRaw: string | null; entries: Record<string, unknown> }; },
    };
  });
  const getSnapshot = async (owner: BrowserOwner) => {
    const current = controller.current, before = current?.snapshot();
    const matches = () => active.current && browserOwnerKey(active.current) === browserOwnerKey(owner);
    if (!current || !before || !matches() || !await current.flush(before.owner)) throw new Error('Fixture owner changed');
    const ready = current.snapshot();
    if (!ready || controller.current !== current || !matches()) throw new Error('Fixture owner changed');
    return ready;
  };
  return identity ? <>
    <div style={{ display: 'none' }}><StandaloneComposer client={client} context={{ ...identity, cwd: '/fixture' }} busy={false}
      onDraftController={receiveController} onDraftChange={setDraftSnapshot}
      onSubmit={async () => { throw new Error('Fixture does not perform inference'); }} onInterrupt={async () => {}} /></div>
    <StandaloneBrowser client={client} {...identity} draft={draft} visible={shown} allowNavigation
      onClose={() => setIdentity(null)} getDraftSnapshot={getSnapshot}
      onDraftVersionCommitted={async (before, after) => {
        return await controller.current?.acceptCommittedVersion(before, after) ?? false;
      }} />
  </> : null;
}

createRoot(document.getElementById('root')!).render(<App />);
