import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transform } from 'esbuild';
import * as React from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReasoningMessageDependencies, ReasoningMessageProps } from '../src/renderer/messages/reasoning-message.tsx';
import type { AssistantMessageOverflowDependencies, AssistantMessageOverflowProps } from '../src/renderer/messages/assistant-message-overflow.tsx';

async function load(path: string) {
  const { code } = await transform(await readFile(new URL(path, import.meta.url), 'utf8'), { loader: 'tsx', format: 'esm', jsx: 'transform' });
  assert.doesNotMatch(code, /react\/jsx-runtime/);
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
const { createReasoningMessageComponent } = await load('../src/renderer/messages/reasoning-message.tsx') as typeof import('../src/renderer/messages/reasoning-message.tsx');
const { createAssistantMessageOverflowComponent } = await load('../src/renderer/messages/assistant-message-overflow.tsx') as typeof import('../src/renderer/messages/assistant-message-overflow.tsx');
const vendor = await readFile(new URL('../vendor/codex-app/26.1013.40934/webview/assets/sites-end-resource-b11586198b69.js', import.meta.url), 'utf8');
const runtime = { jsx, jsxs, Fragment: React.Fragment };
const cache = { c: (size: number) => Array(size).fill(Symbol.for('react.memo_cache_sentinel')) };
const classes = (...values: (string | false | null | undefined)[]) => values.filter(Boolean).join(' ');

function extract(start: string, end: string, includeEnd = true) {
  assert.equal(vendor.split(start).length, 2, start);
  assert.equal(vendor.split(end).length, 2, end);
  const begin = vendor.indexOf(start), finish = vendor.indexOf(end, begin);
  assert.ok(finish > begin);
  return vendor.slice(begin, finish + (includeEnd ? end.length : 0));
}
function evaluate(source: string, bindings: Record<string, unknown>) {
  return new Function(...Object.keys(bindings), `return (${source})`)(...Object.values(bindings));
}

test('reasoning content matches the original for streaming, suspended and completed states', () => {
  let state: string | null = null;
  const deps: ReasoningMessageDependencies = {
    useReasoningState: () => state, getCompletedContent: value => value.replace(/^\*\*[^\n]*?\*\*\s*/, ''),
    formatElapsed: value => `${value}ms`, useMeasurement: () => ({ elementHeightPx: 42, elementRef: null }),
    FormattedMessage: ({ defaultMessage, values }) => React.createElement(React.Fragment, null, defaultMessage.replace('{elapsed}', values?.elapsed ?? '')),
    Markdown: ({ children, components, isStreaming, cwd, hostId, hideCodeBlocks }) => React.createElement('article', {
      'data-streaming': String(isStreaming), 'data-cwd': cwd, 'data-host': hostId, 'data-hide': String(hideCodeBlocks),
    }, children, React.createElement(components.ol, { start: 99 }, [
      React.createElement(components.li, { key: 'one' }, 'one'), 'ignored', React.createElement(components.li, { key: 'two' }, 'two'),
    ])),
    ActivityLabel: ({ children, active, className }) => React.createElement('span', { className, 'data-active': String(active) }, children),
    Header: ({ children, disclosure }) => React.createElement('header', { 'data-disclosure': String(disclosure != null) }, children),
    Scrollable: ({ items, autoScrollToBottom }) => React.createElement('section', { 'data-scroll': String(autoScrollToBottom) }, items.map(item => React.createElement(React.Fragment, { key: item.key }, item.node))),
    Surface: ({ children }) => React.createElement('div', null, children),
    MotionDiv: ({ children, animate, className, style }) => React.createElement('div', { className, style, 'data-height': animate.height, 'data-opacity': animate.opacity }, children),
    Layout: ({ header, body }) => React.createElement('main', null, header, body),
    transition: {}, styles: { heading: 'heading', paragraph: 'paragraph', list: 'list', content: 'content' }, classNames: classes,
  };
  const New = createReasoningMessageComponent(React, deps);
  const helperBindings = { xE: runtime, G: deps.FormattedMessage, J: classes, dE: deps.styles, aE: React };
  const helperSource = extract('function rE(e){', 'var aE;', false) + extract('function hE(e){', 'function vE(e){', false);
  const helpers = new Function(...Object.keys(helperBindings), `${helperSource};return {iE,hE,gE,_E}`)(...Object.values(helperBindings));
  const Old = evaluate(extract('function pE(e){let t=(0,yE.c)(49),', 't[46]=j,t[47]=z,t[48]=B):B=t[48],B}'), {
    yE: cache, bE: React, xE: runtime, V: deps.useReasoningState, js: null, vE: () => null, Bd: deps.getCompletedContent,
    gE: helpers.gE, _E: helpers._E, iE: helpers.iE, hE: helpers.hE, mE: (value: boolean) => !value,
    ig: deps.useMeasurement, J: classes, dE: deps.styles, qu: deps.Markdown, id: deps.ActivityLabel,
    pp: deps.Header, QT: deps.Scrollable, sg: deps.Surface, Tn: { div: deps.MotionDiv }, rr: deps.transition, tp: deps.Layout,
  }) as React.ComponentType<ReasoningMessageProps>;
  const cases = [
    { completed: false, content: '**Title**\n\nBody' }, { completed: false, content: '**unfinished title' },
    { completed: false, content: '  Plain body' }, { completed: true, content: '**Title**\n\nBody' },
    { completed: true, content: '**Title**' },
  ];
  for (const current of [null, 'resumed', 'suspended']) for (const item of cases) {
    state = current;
    const props: ReasoningMessageProps = { item: { ...item, type: 'reasoning' }, conversationId: 'thread', cwd: '/repo', hostId: 'ssh', hideCodeBlocks: true };
    assert.equal(renderToStaticMarkup(React.createElement(New, props)), renderToStaticMarkup(React.createElement(Old, props)));
  }
});

type Stats = { rejectedCount: number };
type Hooks = { count: number };
type Citation = { path: string; lineStart: number; lineEnd: number; note: string };
type OverflowProps = AssistantMessageOverflowProps<Stats, Hooks, Citation>;

test('assistant overflow matches original menu availability, controls and dialog setup', () => {
  const deps: AssistantMessageOverflowDependencies<Stats, Hooks, string> = {
    useIntl: () => ({ formatMessage: ({ defaultMessage }) => defaultMessage }),
    MenuButton: ({ label }) => React.createElement('button', { 'aria-label': label }, 'menu'),
    Menu: ({ triggerButton, children, open }) => React.createElement('div', { 'data-open': String(open) }, triggerButton, children),
    MenuItem: ({ children, disabled, 'aria-label': label, 'aria-busy': busy }) => React.createElement('button', { disabled, 'aria-label': label, 'aria-busy': busy }, children),
    BranchIcon: () => null, ReviewIcon: () => null, hookAsset: 'hook', memoryAsset: 'memory', skillAsset: 'skill',
    FormattedMessage: ({ defaultMessage }) => React.createElement(React.Fragment, null, defaultMessage),
    Modal: ({ children, open, size }) => React.createElement('div', { 'data-modal': String(open), 'data-size': size }, children),
    AutoReviewDetails: () => null, HookDetails: () => null, DialogContainer: ({ children }) => React.createElement('section', null, children),
    DialogSection: ({ children }) => React.createElement('div', null, children), DialogHeader: ({ title }) => React.createElement('header', null, title),
    DialogTitle: ({ children }) => React.createElement('h2', null, children),
  };
  const New = createAssistantMessageOverflowComponent<Stats, Hooks, Citation, string>(React, deps);
  const Old = evaluate(extract('function Ax(e){let t=(0,Mx.c)(50),', 't[47]=P,t[48]=E,t[49]=ee):ee=t[49],ee}'), {
    Mx: cache, Nx: React, Px: runtime, Me: deps.useIntl, Ae: deps.MenuButton, m: deps.Menu, qe: { Item: deps.MenuItem },
    F: deps.BranchIcon, be: deps.ReviewIcon, kt: deps.hookAsset, Kn: deps.memoryAsset, De: deps.skillAsset,
    G: deps.FormattedMessage, bn: deps.Modal, Xy: deps.AutoReviewDetails, Ug: deps.HookDetails,
    Fn: deps.DialogContainer, _n: deps.DialogSection, Ht: deps.DialogHeader, At: deps.DialogTitle, jx: () => null,
  }) as React.ComponentType<OverflowProps>;
  const base: OverflowProps = { memoryCitationEntries: [], forkDisabled: false, forkLabel: 'Fork chat', isForking: false, open: false, onOpenChange: () => {} };
  const cases: OverflowProps[] = [base, { ...base, onFork: () => {}, isForking: true },
    { ...base, autoReviewStats: { rejectedCount: 0 }, hookStats: { count: 2 }, open: true },
    { ...base, autoReviewStats: { rejectedCount: 1 } },
    { ...base, memoryCitationEntries: [{ path: '/notes', lineStart: 1, lineEnd: 2, note: 'note' }], renderUsedSkillsDetails: () => 'skill' }];
  for (const props of cases) assert.equal(renderToStaticMarkup(React.createElement(New, props)), renderToStaticMarkup(React.createElement(Old, props)));
});
