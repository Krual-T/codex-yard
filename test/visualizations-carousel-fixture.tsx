import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { StandaloneVisualization, type StandaloneVisualizationProps, type VisualizationInteraction } from '../src/renderer/visualizations/index.tsx';
import type { ComposerDraft, WorkbenchClient } from '../src/renderer/workbench-contract.ts';

const root = createRoot(document.getElementById('root')!);
const drafts: ComposerDraft[] = [];
const interactions: VisualizationInteraction[] = [];
const navigation: ('previous' | 'next')[] = [];
let html = '';
let props: StandaloneVisualizationProps | null = null;
const client: WorkbenchClient = {
  async host<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    if (endpoint === 'visualization-read') return { path: params?.path, contents: html } as T;
    throw new Error(`Unexpected host request: ${endpoint}`);
  },
  async rpc<T>(): Promise<T> { throw new Error('Unexpected RPC'); },
  subscribe() { return () => {}; },
};
function render() { flushSync(() => root.render(props ? createElement(StandaloneVisualization, props) : null)); }
const harness = {
  drafts, interactions, navigation,
  mount(documentHtml: string, hostId = 'local') {
    html = documentHtml;
    props = { client, hostId, threadId: 'thread', path: '/chart.html', initialWidgetState: null,
      onPrefill: draft => drafts.push(draft), onClose: () => { props = null; render(); },
      onInteraction: event => interactions.push(event), onPreviewNavigate: direction => navigation.push(direction) };
    render();
  },
  clear() { interactions.length = 0; navigation.length = 0; },
  unmount() { props = null; render(); },
};
(window as unknown as { carouselHarness: typeof harness }).carouselHarness = harness;
