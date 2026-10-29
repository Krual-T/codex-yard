import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { StandaloneBrowser, browserOwnerKey } from '../src/renderer/browser/index.tsx';
import { browserCommentsAtomKey, browserReferences, recordSubmittedBrowserComments } from '../src/renderer/browser/comments.ts';
import { StandaloneComposer } from '../src/renderer/composer/StandaloneComposer.tsx';
import type { ComposerDraftController, ComposerDraftSnapshot } from '../src/renderer/composer/StandaloneComposer.tsx';
import { readComposerDraftVersions } from '../src/renderer/composer/composer-draft-store.ts';
import { readBrowserAtom, updateBrowserAtom } from '../src/renderer/storage/ui-atoms.ts';
import { Preferences } from '../src/renderer/settings/preferences.ts';
import type { ComposerDraft, WorkbenchClient, WorkbenchDispatchOptions, WorkbenchEvent } from '../src/renderer/workbench-contract.ts';

type Identity = { hostId: string; threadId: string | null; draftId: string; browserTabId: string };
type SettingKey = 'browser-show-full-url' | 'browser-annotation-screenshots-mode';
const emptyDraft: ComposerDraft = { text: '', images: [], files: [], references: [] };
const listeners = new Set<(event: WorkbenchEvent) => void>();
const calls: { operation: unknown; command: unknown }[] = [];
const settingsKey = 'fixture.browser-settings';
const initialUrl = 'https://www.example.invalid/path?q=1#frag';
let history = [initialUrl], historyIndex = 0;
let holdNext = false, pending = false, release: (() => void) | undefined;
let failRead = false, settingWriteCount = 0;

function settings(): Record<string, unknown> { return JSON.parse(localStorage.getItem(settingsKey) ?? '{}') as Record<string, unknown>; }
function setRaw(key: SettingKey, value: unknown, notify: boolean) {
  localStorage.setItem(settingsKey, JSON.stringify({ ...settings(), [key]: value }));
  if (notify) for (const listener of listeners) listener({ type: 'settings-changed', keys: [key] });
}

const client: WorkbenchClient = {
  async reply() { throw new Error('Unexpected approval'); },
  async rpc<T>(method: string): Promise<T> {
    if (method === 'model/list' || method === 'thread/queue/list') return { data: [], nextCursor: null } as T;
    if (method === 'config/read') return { config: {} } as T;
    throw new Error('Unexpected daemon call: ' + method);
  },
  subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  async host<T>(endpoint: string, params?: Record<string, unknown>, options?: Pick<WorkbenchDispatchOptions, 'assertBeforeSend'>): Promise<T> {
    if (endpoint === 'get-settings') return { values: settings() } as T;
    if (endpoint === 'get-setting') {
      const key = String(params?.key), values = settings();
      if (key === 'browser-show-full-url' && failRead) { failRead = false; throw new Error('Fixture setting read disconnected'); }
      const result = { exists: Object.hasOwn(values, key), value: values[key] };
      if (key === 'browser-show-full-url' && holdNext) {
        holdNext = false; pending = true;
        await new Promise<void>(resolve => { release = resolve; });
        pending = false;
      }
      return result as T;
    }
    if (endpoint === 'set-setting') {
      options?.assertBeforeSend?.();
      settingWriteCount++;
      const key = String(params?.key), values = settings();
      const current = Object.hasOwn(values, key) ? { exists: true, value: values[key] } : { exists: false };
      if (JSON.stringify(current) !== JSON.stringify(params?.expected)) throw new Error('Fixture preference conflict');
      setRaw(key as SettingKey, params?.value, true);
      return { success: true } as T;
    }
    if (endpoint === 'chrome-connections') return { client: { connected: true }, server: { configured: false, label: 'Fixture' } } as T;
    if (endpoint !== 'chrome-browser') throw new Error('Unexpected host operation: ' + endpoint);
    const command = params?.command as { type?: string; url?: string } | undefined;
    calls.push({ operation: params?.operation, command: structuredClone(command) });
    if (command?.type === 'navigate' && command.url) { history = [...history.slice(0, historyIndex + 1), command.url]; historyIndex++; }
    if (command?.type === 'go-back' && historyIndex > 0) historyIndex--;
    if (command?.type === 'go-forward' && historyIndex < history.length - 1) historyIndex++;
    const url = history[historyIndex]!;
    const state = { location: 'Fixture Chrome', configured: true, pageId: 1, pages: [{ id: 1, url, selected: true }],
      frame: { pageId: 1, url, title: 'Fixture', image: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=',
        width: 640, height: 480, capturedAt: 'fixture', canGoBack: historyIndex > 0, canGoForward: historyIndex < history.length - 1 },
      ...(params?.operation === 'element-context' ? { elementContext: { kind: 'element', pageUrl: url, framePath: [], title: 'Fixture element',
        immediateText: 'Selected', role: 'button', name: 'Choose', selector: '#fixture', elementPath: 'main > button', nearbyText: 'Nearby',
        rect: { x: 1, y: 2, width: 3, height: 4 }, elementMetadata: { fixture: 'preserve' } } } : {}) };
    return state as T;
  },
};

interface Harness {
  mount(identity: Identity): void;
  setRaw(key: SettingKey, value: unknown, notify?: boolean): void;
  save(key: SettingKey, value: boolean | 'always' | 'necessary'): Promise<boolean>;
  holdNext(): void;
  pending(): boolean;
  release(): void;
  failNextRead(): void;
  emit(event: WorkbenchEvent): void;
  settingWrites(): number;
  calls(): { operation: unknown; command: unknown }[];
  draft(): ComposerDraft;
  ready(): Promise<boolean>;
  recordConsumed(): Promise<void>;
  store(): Promise<unknown>;
}
declare global { interface Window { browserPreferenceFixture: Harness } }

function App() {
  const [identity, setIdentity] = React.useState<Identity | null>(null);
  const [snapshot, setSnapshot] = React.useState<ComposerDraftSnapshot | null>(null);
  const controller = React.useRef<ComposerDraftController | null>(null);
  const current = React.useRef(identity);
  React.useLayoutEffect(() => { current.current = identity; }, [identity]);
  const key = identity ? browserOwnerKey(identity) : '';
  const draft = snapshot && browserOwnerKey(snapshot.owner) === key ? snapshot.draft : emptyDraft;
  React.useLayoutEffect(() => {
    window.browserPreferenceFixture = {
      mount: setIdentity,
      setRaw(key, value, notify = false) { setRaw(key, value, notify); },
      async save(key, value) {
        const preferences = new Preferences(client);
        await preferences.reload(key);
        if (key === 'browser-show-full-url' && typeof value === 'boolean') preferences.edit(key, value);
        else if (key === 'browser-annotation-screenshots-mode' && (value === 'always' || value === 'necessary')) preferences.edit(key, value);
        else throw new Error('Invalid fixture setting');
        return preferences.saveOne(key);
      },
      holdNext() { holdNext = true; },
      pending: () => pending,
      release() { release?.(); release = undefined; },
      failNextRead() { failRead = true; },
      emit(event) { for (const listener of listeners) listener(event); },
      settingWrites: () => settingWriteCount,
      calls: () => calls,
      draft: () => draft,
      async ready() {
        const active = controller.current?.snapshot();
        if (!active || !current.current || browserOwnerKey(active.owner) !== browserOwnerKey(current.current)) return false;
        return (await readComposerDraftVersions(active.owner)).versions.some(version => version.revision === active.revision);
      },
      async recordConsumed() {
        const owner = current.current, reference = draft.references?.[0];
        if (!owner || !reference) throw new Error('Missing fixture reference');
        const actual = browserReferences(owner, [reference.original])[0];
        if (!actual) throw new Error('Invalid fixture reference');
        await updateBrowserAtom(browserCommentsAtomKey, store => recordSubmittedBrowserComments(store, owner,
          { intentId: 'fixture-intent', owner, revision: 'fixture-revision', references: [actual] }));
      },
      store: () => readBrowserAtom('codex-yard.browser-comments.v1'),
    };
  });
  if (!identity) return null;
  return <>
    <div style={{ display: 'none' }}><StandaloneComposer client={client} context={{ ...identity, cwd: '/fixture' }} busy={false}
      onDraftController={value => { controller.current = value; }} onDraftChange={setSnapshot}
      onSubmit={async () => { throw new Error('Unexpected inference'); }} onInterrupt={async () => {}} /></div>
    <StandaloneBrowser client={client} {...identity} draft={draft} visible allowNavigation onClose={() => setIdentity(null)}
      beginDraftOperation={owner => {
        const active = controller.current?.snapshot();
        return active && current.current && browserOwnerKey(owner) === browserOwnerKey(current.current)
          && browserOwnerKey(owner) === browserOwnerKey(active.owner) ? controller.current!.beginExternalOperation(active.owner) : null;
      }} onDraftVersionCommitted={async (before, after) => controller.current?.acceptCommittedVersion(before, after) ?? false} />
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
