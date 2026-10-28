import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { StandaloneVisualization, type StandaloneVisualizationProps } from '../src/renderer/visualizations/index.tsx';
import type { ComposerDraft, WorkbenchClient, WorkbenchEvent } from '../src/renderer/workbench-contract.ts';

const root = createRoot(document.getElementById('root')!);
const drafts: ComposerDraft[] = [];
const requests: string[] = [];
let html = '';
let failWrites = false;
let delayedWrite: (() => void) | undefined;
let delayWrites = false;
const listeners = new Set<(event: WorkbenchEvent) => void>();
function notify(key: string) { for (const listener of listeners) listener({ type: 'persisted-atom-updated', keys: [key] }); }
const client: WorkbenchClient = {
  async reply() { throw new Error('Unexpected server response'); },
  async host<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    requests.push(endpoint);
    if (endpoint === 'visualization-read') return { path: params?.path, contents: html } as T;
    if (endpoint === 'get-persisted-atom') return { value: JSON.parse(localStorage.getItem('native-atoms') ?? '{}')[String(params?.key)] } as T;
    if (endpoint === 'set-persisted-atom') {
      if (delayWrites) await new Promise<void>(resolve => { delayedWrite = resolve; });
      if (failWrites) throw new Error('Fixture storage failed');
      const atoms = JSON.parse(localStorage.getItem('native-atoms') ?? '{}');
      const key = String(params?.key);
      const previous = atoms[key];
      if (previous !== undefined && (!previous || typeof previous !== 'object' || Array.isArray(previous))) throw new Error('Invalid atom');
      const map = { ...previous };
      const update = params?.recordUpdate as { entries: Record<string, { value: unknown; expectedValue?: unknown; createOnly?: boolean }> };
      for (const [path, operation] of Object.entries(update.entries)) {
        if (operation.createOnly && Object.hasOwn(map, path)) continue;
        if (operation.expectedValue !== undefined && JSON.stringify(map[path]) !== JSON.stringify(operation.expectedValue)) continue;
        map[path] = operation.value;
      }
      atoms[key] = map;
      localStorage.setItem('native-atoms', JSON.stringify(atoms));
      notify(String(params?.key));
      return { success: true } as T;
    }
    throw new Error(`Unexpected host request: ${endpoint}`);
  },
  async rpc<T>(): Promise<T> { throw new Error('Unexpected RPC'); },
  subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
};
let props: StandaloneVisualizationProps | null = null;
function render() { flushSync(() => root.render(props ? createElement(StandaloneVisualization, props) : null)); }
const harness = {
  drafts, requests,
  configure(value: string, atoms: Record<string, unknown>) { html = value; localStorage.setItem('native-atoms', JSON.stringify(atoms)); },
  atoms() { return JSON.parse(localStorage.getItem('native-atoms') ?? '{}') as Record<string, unknown>; },
  mount(hostId = 'local', threadId = 'thread', path = '/chart.html') {
    props = { client, hostId, threadId, path, theme: 'light', themeVariables: { '--viz-accent': '#112233' }, locale: 'en-GB',
      onPrefill(draft) { drafts.push(draft); (document.getElementById('draft') as HTMLTextAreaElement).value = draft.text; }, onClose() { props = null; render(); } };
    render();
  },
  theme() { if (props) { props = { ...props, theme: 'dark', themeVariables: { '--viz-accent': '#aabbcc' }, locale: 'fr-FR' }; render(); } },
  unmount() { props = null; render(); },
  fail(value: boolean) { failWrites = value; },
  delay(value: boolean) { delayWrites = value; },
  release() { delayedWrite?.(); delayedWrite = undefined; },
  replaceAtom(key: string, value: unknown) {
    const atoms = JSON.parse(localStorage.getItem('native-atoms') ?? '{}');
    atoms[key] = value;
    localStorage.setItem('native-atoms', JSON.stringify(atoms));
    notify(key);
  },
};
(window as unknown as { structuredHarness: typeof harness }).structuredHarness = harness;
