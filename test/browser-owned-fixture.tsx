import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { acknowledgeBrowserReferences, adoptLegacyBrowserComments, browserOwnerKey, browserReferences,
  readBrowserComments, StandaloneBrowser } from '../src/renderer/browser/index.tsx';
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
}
declare global { interface Window { browserHarness: Harness } }

const pageSession = crypto.randomUUID();
const client: WorkbenchClient = {
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
  const active = React.useRef<Identity | null>(null);
  React.useLayoutEffect(() => { active.current = identity; }, [identity]);
  const key = identity ? browserOwnerKey(identity) : '';
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
        const map = JSON.parse(localStorage.getItem('workbench.browser-comments.v1') ?? '{}') as Record<string, unknown[]>;
        await adoptLegacyBrowserComments(identity, legacyOwner, map[legacyOwner]!);
      },
      async acknowledge(references) {
        if (!identity) throw new Error('No owner');
        await acknowledgeBrowserReferences(identity, references, reference => active.current !== null && browserOwnerKey(active.current) === browserOwnerKey(identity)
          && (latestDraft.current.references ?? []).some(item => JSON.stringify(item) === JSON.stringify(reference)));
      },
      references() { return identity ? browserReferences(identity, readBrowserComments(identity)) : []; },
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
