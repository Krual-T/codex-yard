import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transform } from 'esbuild';
import * as React from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AdaptiveStreamSnapshot, AdaptiveStreamStore, AdaptiveStreamingMarkdownDependencies } from '../src/renderer/markdown/adaptive-streaming.tsx';
import type { MarkdownRootDependencies, MarkdownRootDomain, MarkdownRootProps } from '../src/renderer/markdown/markdown-root.tsx';

async function load(path: string) {
  const { code } = await transform(await readFile(new URL(path, import.meta.url), 'utf8'), { loader: 'tsx', format: 'esm', jsx: 'transform' });
  assert.doesNotMatch(code, /react\/jsx-runtime/);
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
const { createAdaptiveStreamingMarkdownComponent } = await load('../src/renderer/markdown/adaptive-streaming.tsx') as typeof import('../src/renderer/markdown/adaptive-streaming.tsx');
const { createMarkdownRootComponent } = await load('../src/renderer/markdown/markdown-root.tsx') as typeof import('../src/renderer/markdown/markdown-root.tsx');
const vendor = await readFile(new URL('../vendor/codex-app/26.1013.40934/webview/assets/app-initial-a68277f60b93.js', import.meta.url), 'utf8');
const runtime = { jsx, jsxs, Fragment: React.Fragment };
const cache = { c: (size: number) => Array(size).fill(Symbol.for('react.memo_cache_sentinel')) };
const classes = (...values: (string | false | null | undefined)[]) => values.filter(Boolean).join(' ');
function original(start: string, end: string, bindings: Record<string, unknown>) {
  assert.equal(vendor.split(start).length, 2);
  assert.equal(vendor.split(end).length, 2);
  const begin = vendor.indexOf(start);
  const finish = vendor.indexOf(end, begin) + end.length;
  assert.ok(finish > begin);
  return new Function(...Object.keys(bindings), `return (${vendor.slice(begin, finish)})`)(...Object.values(bindings)) as React.ComponentType<never>;
}

type StreamProps = { children: string; isStreaming?: boolean; animate?: boolean; fadeSegmentDelayMs?: number; fadeSegmentMaxDelayMs?: number; marker?: string };
test('adaptive Markdown matches the original prefix, stream identity and reduced-motion decisions', () => {
  let snapshot: AdaptiveStreamSnapshot = { streamId: 's1', source: 'abc', text: 'ab' };
  let reduced = false;
  const client = {};
  const Markdown: AdaptiveStreamingMarkdownDependencies<StreamProps, object>['Markdown'] = props => React.createElement('p', {
    'data-adaptive': String(props.adaptiveStreaming), 'data-animate': String(props.animate), 'data-delay': props.fadeSegmentDelayMs,
    'data-max-delay': props.fadeSegmentMaxDelayMs, 'data-marker': props.marker,
  }, props.children);
  class Store implements AdaptiveStreamStore {
    subscribe = () => () => {};
    getSnapshot = () => snapshot;
    update = () => {};
    destroy = () => {};
  }
  const deps: AdaptiveStreamingMarkdownDependencies<StreamProps, object> = {
    useClient: () => client, useReducedMotion: () => reduced, createStore: () => new Store(),
    isSlowStreamingEnabled: () => false, Markdown,
  };
  const New = createAdaptiveStreamingMarkdownComponent(React, deps);
  const Old = original('function Jdd(e){let t=(0,Xdd.c)(29),', 't[22]=o,t[23]=n,t[24]=_,t[25]=v,t[26]=y,t[27]=g,t[28]=b):b=t[28],b}', {
    Xdd: cache, Zdd: React, Qdd: runtime, uy: deps.useClient, to: deps.useReducedMotion,
    vdd: Store, py: () => ({ get: () => false }), $dd: Markdown,
  }) as React.ComponentType<StreamProps & { streamId: string }>;
  const props = { streamId: 's1', children: 'abcdef', isStreaming: true, marker: 'original', fadeSegmentDelayMs: 5, fadeSegmentMaxDelayMs: 20 };
  const compare = () => assert.equal(renderToStaticMarkup(React.createElement(New, props)), renderToStaticMarkup(React.createElement(Old, props)));
  compare();
  assert.match(renderToStaticMarkup(React.createElement(New, props)), />ab<\/p>/);
  snapshot = { streamId: 'other', source: 'abc', text: 'stale' }; compare();
  assert.match(renderToStaticMarkup(React.createElement(New, props)), />abcdef<\/p>/);
  snapshot = { streamId: 's1', source: 'not-a-prefix', text: 'stale' }; compare();
  reduced = true; compare();
  assert.match(renderToStaticMarkup(React.createElement(New, props)), /data-adaptive="false" data-animate="false"/);
  reduced = false;
  const withoutStreaming = { ...props, isStreaming: undefined };
  assert.equal(renderToStaticMarkup(React.createElement(New, withoutStreaming)), renderToStaticMarkup(React.createElement(Old, withoutStreaming)));
});

type Domain = MarkdownRootDomain & {
  tokens: string[]; components: { paragraph?: string; link?: string }; directives: { custom: boolean };
  listItemDecoration: string; openCodeFenceToken: string; renderRoot: string; renderText: string; streamingTokenKeys: string[];
  mediaCacheKey: string[]; mediaPreviewKey: string; mediaPreview: string;
};
test('Markdown root matches original wrapper, token options and inherited resource restrictions', () => {
  const policy = React.createContext<'allow' | 'restricted'>('allow');
  const observed: { options?: Parameters<MarkdownRootDependencies<Domain>['renderTokens']>[1] } = {};
  const deps: MarkdownRootDependencies<Domain> = {
    ExternalResourcePolicyContext: policy, defaultHostId: 'local', markdownRootClassName: 'markdown-root',
    markdownIdAttribute: 'data-markdown-id', classNames: classes, onCopy: () => {},
    renderTokens: (tokens, options) => { observed.options = options; return React.createElement('p', null, tokens.join('|')); },
  };
  const New = createMarkdownRootComponent(React, deps);
  const Old = original('function Nod(e){let t=(0,Pod.c)(55),', 't[52]=ie,t[53]=be,t[54]=xe):xe=t[54],xe}', {
    Pod: cache, Fod: React, Iod: runtime, t5u: policy, ol: deps.defaultHostId, Wc: classes,
    z7: { MarkdownRoot: 'markdown-root' }, G4l: 'data-markdown-id', Xba: deps.onCopy, xLo: deps.renderTokens,
  }) as React.ComponentType<MarkdownRootProps<Domain>>;
  let seenPolicy = '';
  const props: MarkdownRootProps<Domain> = { tokens: ['one', 'two'], className: 'custom', direction: 'rtl', hostId: 'ssh',
    animateMarkdown: true, externalResourcePolicy: 'allow', textStyle: { kind: 'assistant-message', tone: 'user-message', linkColor: 'red' },
    components: { link: 'override' }, directives: { custom: true }, trailingContent: React.createElement('b', null, 'tail'),
    getDefaultComponents: options => { seenPolicy = options.externalResourcePolicy; return { paragraph: 'default', link: 'default' }; } };
  const render = (Component: React.ComponentType<MarkdownRootProps<Domain>>) => renderToStaticMarkup(React.createElement(policy.Provider, { value: 'restricted' }, React.createElement(Component, props)));
  const actual = render(New);
  const actualOptions = observed.options;
  const expected = render(Old);
  assert.equal(actual, expected);
  assert.equal(seenPolicy, 'restricted');
  assert.deepEqual(actualOptions?.components, { paragraph: 'default', link: 'override' });
  assert.deepEqual(actualOptions, observed.options);
  assert.match(actual, /data-markdown-animated=""/);
  assert.match(actual, /data-markdown-text-tone="user-message"/);
});
