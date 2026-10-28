import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transform } from 'esbuild';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { rendererRoot } from '../lib/app-resources.ts';
import type { HomeComposerLayoutDependencies, HomeComposerLayoutProps, HomeComposerLocation } from '../src/renderer/composer/home-composer-layout.tsx';

const source = await readFile(new URL('../src/renderer/composer/home-composer-layout.tsx', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'tsx', format: 'esm', jsx: 'transform' });
const { createHomeComposerLayoutComponent } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
) as typeof import('../src/renderer/composer/home-composer-layout.tsx');
const pinned = await readFile(rendererRoot + '/assets/app-primary-f5ea123a0407.js', 'utf8');
const start = pinned.indexOf('function RBt(e){');
const end = 't[17]=T,t[18]=O,t[19]=k):k=t[19],k}';
const original = pinned.slice(start, pinned.indexOf(end, start) + end.length);

test('home layout preserves pending-workflow gates, upstream scope and controller identity', () => {
  let blurCount = 0, temporaryToggleCount = 0;
  const controller = { view: { dom: { blur: () => { blurCount++; } } as HTMLElement }, getText: () => 'upstream draft' };
  const selectedModes: string[] = [];
  const selected = (mode: string) => { selectedModes.push(mode); };
  const scope = {};
  const location: HomeComposerLocation = { pathname: '/', search: '', state: null };
  const flags = new Set(['3480058756']);
  let voiceRequest: unknown;
  let observed: Record<string, unknown> = {};
  const mediaQueries: string[] = [], flagQueries: (string | false)[] = [];
  const deps: HomeComposerLayoutDependencies = {
    useSidebarOpen: () => true, useSidebarWidth: () => 330,
    useMediaQuery: query => { mediaQueries.push(query); return true; }, sidebarBreakpoint: '(min-width: 1024px)',
    useLocation: () => location, useIsWorkMode: () => true, useVoiceRequest: () => voiceRequest,
    matchMissionControl: pathname => pathname === '/mission-control' ? {} : null,
    isTemporaryChat: search => search.includes('temporary'),
    useFeatureFlag: key => { flagQueries.push(key); return key !== false && flags.has(key); },
    ModelPickerScope: scope,
    ScopeProvider: ({ children, scope: receivedScope, value }) => {
      assert.equal(receivedScope, scope); observed.enabled = value.enabled;
      return React.createElement('section', null, children);
    },
    KeyboardShortcuts: () => React.createElement('span', null, 'shortcuts'),
    LegacyLayout: ({ children }) => React.createElement('main', { 'data-layout': 'legacy' }, children),
    ModeToggleWrapper: ({ children }) => React.createElement('header', null, children),
    WorkHomePage: props => { observed.work = props; return React.createElement('article', null, 'suggestions'); },
    StandardLayout: props => { observed.standard = props; return React.createElement('main', { 'data-layout': props.lighthouse ? 'lighthouse' : 'standard' }); },
    prepareTaskSuggestionDestination: async () => {},
  };
  // Execute the small pinned function with exactly the same React and services.
  // This checks the recovered presentation boundary without initializing App state.
  const bindings: Record<string, unknown> = {
    W9: { c: (size: number) => Array(size).fill(Symbol.for('react.memo_cache_sentinel')) },
    G9: React, K9: jsxRuntime, Y: (atom: string) => ({ sidebar: true, width: 330, voice: voiceRequest })[atom],
    ape: 'sidebar', xLe: 'width', nle: 'voice', $l: deps.useMediaQuery, tMe: deps.sidebarBreakpoint,
    Sf: deps.useLocation, Rv: () => 'work', $h: 'work', hc: (_path: string, pathname: string) => deps.matchMissionControl(pathname),
    te: deps.isTemporaryChat, bS: deps.useFeatureFlag, Jf: deps.ScopeProvider, bV: scope, cRt: deps.KeyboardShortcuts,
    MBt: deps.LegacyLayout, yj: deps.ModeToggleWrapper, GBt: deps.WorkHomePage, BBt: deps.StandardLayout,
    zBt: deps.prepareTaskSuggestionDestination,
  };
  const PinnedHome = new Function(...Object.keys(bindings), `return (${original})`)(...Object.values(bindings)) as React.ComponentType<HomeComposerLayoutProps>;
  const Home = createHomeComposerLayoutComponent(React, deps);
  const render = (Component: React.ComponentType<HomeComposerLayoutProps>, props: HomeComposerLayoutProps) => {
    mediaQueries.length = 0; flagQueries.length = 0; observed = {};
    const html = renderToStaticMarkup(React.createElement(Component, props));
    return { html, mediaQueries: [...mediaQueries], flagQueries: [...flagQueries], observed };
  };
  const props: HomeComposerLayoutProps = { homeComposerMode: 'work', homeComposerController: controller,
    homeComposerModeToggle: React.createElement('button', null, 'mode'), onChatGptTaskSuggestionSelected: selected,
    onTemporaryChatToggle: () => { temporaryToggleCount++; } };
  const compare = (input = props) => {
    const recovered = render(Home, input);
    assert.deepEqual(recovered, render(PinnedHome, input));
    assert.deepEqual(recovered.mediaQueries, ['(min-width: 1024px)', '(min-width: 1002px)']);
    return recovered;
  };
  assert.match(compare().html, /data-layout="legacy"/);
  assert.equal((observed.work as { onTaskSuggestionSelected: unknown }).onTaskSuggestionSelected, selected);
  (observed.work as { onTaskSuggestionSelected: (mode: 'work') => void }).onTaskSuggestionSelected('work');
  assert.deepEqual(selectedModes, ['work']);
  assert.doesNotMatch(compare({ ...props, homeComposerController: null }).html, /suggestions/);
  assert.match(compare({ ...props, unifiedModelPickerEnabled: true }).html, /data-layout="standard"/);
  assert.equal((observed.standard as { homeComposerController: unknown }).homeComposerController, controller);
  const forwarded = observed.standard as HomeComposerLayoutProps;
  assert.equal(forwarded.homeComposerController?.getText(), 'upstream draft');
  forwarded.homeComposerController?.view.dom.blur();
  forwarded.onTemporaryChatToggle?.();
  assert.equal(blurCount, 1);
  assert.equal(temporaryToggleCount, 1);
  for (const field of ['aeonDraft', 'sharedSnapshotId', 'prefillPriorConversation', 'pendingViewAction', 'sidebarOnboardingChecklistCompletionOnSubmit'] as const) {
    location.state = { [field]: {} };
    assert.deepEqual(compare().flagQueries, [false, false]);
  }
  location.state = null; voiceRequest = {};
  assert.deepEqual(compare().flagQueries, [false, false]);
  voiceRequest = null; location.search = '?temporary=1';
  assert.deepEqual(compare().flagQueries, [false, false]);
  location.search = ''; location.pathname = '/mission-control'; flags.add('3226853936');
  assert.match(compare().html, /data-layout="lighthouse"/);
  assert.deepEqual(compare().flagQueries, ['3226853936', false]);
  location.pathname = '/';
  assert.match(compare().html, /data-layout="standard"/);
});
