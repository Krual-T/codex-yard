import { createElement, startTransition, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { StandaloneVisualization, type StandaloneVisualizationProps, type VisualizationFollowUp } from '../src/renderer/visualizations/index.tsx';
import type { ComposerDraft, WorkbenchClient } from '../src/renderer/workbench-contract.ts';

const root = createRoot(document.getElementById('root')!);
const reads: Record<string, unknown>[] = [];
const rpc: string[] = [];
const drafts: ComposerDraft[] = [];
const draftHosts: string[] = [];
const sent: VisualizationFollowUp[] = [];
const signals: AbortSignal[] = [];
const states: unknown[] = [];
const html: Record<string, string> = {};
let resolveSlow: ((value: { path: string; contents: string }) => void) | undefined;
let missingAvailable = false;
let closes = 0;
let suspended = false;
let suspensions = 0;
let finishSuspension: (() => void) | undefined;
let suspension = Promise.resolve();
let releaseSend: (() => void) | undefined;
let sendWaiting = false;
const client: WorkbenchClient = {
  async reply() { throw new Error('Visualization fixture never approves server requests'); },
  async host<T>(endpoint: string, params?: Record<string, unknown>) {
    reads.push({ endpoint, ...params });
    const path = String(params?.path);
    if (path === '/missing.html' && !missingAvailable) throw new Error('Fixture read failed');
    if (path === '/slow.html') return await new Promise<{ path: string; contents: string }>(resolve => { resolveSlow = resolve; }) as T;
    return { path, contents: html[path] ?? html['/chart.html'] } as T;
  },
  async rpc<T>(method: string): Promise<T> { rpc.push(method); throw new Error('Unexpected RPC'); },
  subscribe() { return () => {}; },
};
let current: StandaloneVisualizationProps | null = null;
function Suspend() { if (suspended) { suspensions++; throw suspension; } return null; }
function tree(value: StandaloneVisualizationProps | null) {
  return value ? createElement(Suspense, { fallback: 'Suspended' }, createElement(StandaloneVisualization, value), createElement(Suspend)) : null;
}
function render() { flushSync(() => root.render(tree(current))); }
const harness = {
  reads, rpc, drafts, draftHosts, sent, signals, states, html,
  get closes() { return closes; },
  get suspensions() { return suspensions; },
  get sendWaiting() { return sendWaiting; },
  releaseSend() { releaseSend?.(); },
  mount(options: { path?: string; hostId?: string; threadId?: string; theme?: 'light' | 'dark'; saveState?: boolean; send?: boolean; delaySend?: boolean; failSend?: boolean } = {}) {
    current = {
      client, path: options.path ?? '/chart.html', hostId: options.hostId ?? 'ssh-host', threadId: options.threadId ?? 'thread-a',
      theme: options.theme ?? 'light', initialWidgetState: { count: 1 },
      onWidgetStateChange: options.saveState ? state => { states.push(state); } : undefined,
      onPrefill(draft) {
        drafts.push(draft);
        draftHosts.push(options.hostId ?? 'ssh-host');
        const composer = document.getElementById('composer') as HTMLTextAreaElement;
        composer.value = [composer.value, draft.text].filter(Boolean).join('\n');
      },
      onFollowUp: options.send === false ? undefined : async (request, signal) => {
        signals.push(signal);
        if (options.delaySend) {
          sendWaiting = true;
          await new Promise<void>(resolve => { releaseSend = resolve; });
          sendWaiting = false;
        }
        if (signal.aborted) throw new Error('Visualization source changed');
        if (options.failSend) throw new Error('Synthetic send failure');
        sent.push(request);
      },
      onClose() { closes++; current = null; render(); },
    };
    render();
  },
  unmount() { current = null; render(); },
  theme(theme: 'light' | 'dark') { if (current) { current = { ...current, theme }; render(); } },
  allowMissing() { missingAvailable = true; },
  finishSlow() { resolveSlow?.({ path: '/slow.html', contents: html['/slow.html'] }); },
  suspendHostChange() {
    if (!current) throw new Error('No current visualization');
    suspended = true;
    suspension = new Promise(resolve => { finishSuspension = resolve; });
    const next = { ...current, hostId: 'uncommitted-host', onPrefill(draft: ComposerDraft) { drafts.push(draft); draftHosts.push('uncommitted-host'); } };
    startTransition(() => root.render(tree(next)));
  },
  cancelHostChange() { suspended = false; finishSuspension?.(); render(); },
};
(window as unknown as { visualizationHarness: typeof harness }).visualizationHarness = harness;
