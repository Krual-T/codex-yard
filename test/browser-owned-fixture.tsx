import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { acknowledgeBrowserReferences, adoptLegacyBrowserComments, browserOwnerKey, browserReferences,
  readBrowserComments, readLegacyBrowserComments, StandaloneBrowser, subscribeBrowserComments } from '../src/renderer/browser/index.tsx';
import { readBrowserAtom } from '../src/renderer/storage/ui-atoms.ts';
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
    const response = await fetch('/host', { method: 'POST', headers: { 'content-type': 'application/json', 'x-fixture-session': pageSession },
      body: JSON.stringify({ endpoint, params }) });
    const result = await response.json() as { value?: T; error?: string };
    if (!response.ok) throw new Error(result.error);
    return result.value as T;
  },
  async rpc<T>(): Promise<T> { throw new Error('Unexpected daemon call'); },
  subscribe() { return () => {}; },
};

function App() {
  const [identity, setIdentity] = React.useState<Identity | null>(null);
  const [shown, setShown] = React.useState(true);
  const [drafts, setDrafts] = React.useState<Record<string, ComposerDraft>>({});
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
  const draft = drafts[key] ?? { text: '', images: [], files: [], references: [] };
  const latestDraft = React.useRef(draft);
  React.useLayoutEffect(() => { latestDraft.current = draft; }, [draft]);
  React.useLayoutEffect(() => {
    window.browserHarness = {
      mount(value) { setIdentity(value); setShown(true); },
      unmount() { setIdentity(null); },
      visible(value) { setShown(value); },
      identity() { return identity; },
      draft() { return draft; },
      setText(value) { if (key) setDrafts(previous => ({ ...previous, [key]: { ...(previous[key] ?? draft), text: value } })); },
      async adopt(legacyOwner) {
        if (!identity) throw new Error('No owner');
        const legacy = await readLegacyBrowserComments(legacyOwner);
        if (!legacy) throw new Error('No legacy comments');
        await adoptLegacyBrowserComments(identity, legacyOwner, legacy);
      },
      async acknowledge(references) {
        if (!identity) throw new Error('No owner');
        await acknowledgeBrowserReferences(identity, references, reference => active.current !== null && browserOwnerKey(active.current) === browserOwnerKey(identity)
          && (latestDraft.current.references ?? []).some(item => JSON.stringify(item) === JSON.stringify(reference)));
      },
      references() { return snapshot.key === key ? snapshot.references : []; },
      async readReferences() { return identity ? browserReferences(identity, await readBrowserComments(identity)) : []; },
      async commentStore() { return await readBrowserAtom('codex-yard.browser-comments.v1') as { legacyRaw: string | null; entries: Record<string, unknown> }; },
    };
  });
  return identity ? <StandaloneBrowser client={client} {...identity} draft={draft} visible={shown} allowNavigation
    onClose={() => setIdentity(null)} onDraftChange={(owner, update) => {
      if (!active.current || browserOwnerKey(active.current) !== browserOwnerKey(owner)) return;
      const ownerKey = browserOwnerKey(owner);
      setDrafts(previous => ({ ...previous, [ownerKey]: update(previous[ownerKey] ?? { text: '', images: [], files: [], references: [] }) }));
    }} /> : null;
}

createRoot(document.getElementById('root')!).render(<App />);
