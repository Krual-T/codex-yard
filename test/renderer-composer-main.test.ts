import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsxRuntime from 'react/jsx-runtime';
import type { MainComposerViewDependencies, MainComposerViewProps } from '../src/renderer/composer/composer-types.ts';
import { createComposerControllerFixture } from './renderer-composer-fixture.ts';

const source = readFileSync(new URL(
  '../vendor/codex-app/26.1013.40934/webview/assets/app-initial-a68277f60b93.js', import.meta.url,
), 'utf8');

function originalFunction(start: string, next: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(next, from);
  assert.ok(from >= 0 && to > from && source.lastIndexOf(start) === from);
  return source.slice(from, to);
}

async function loadViewFactory(): Promise<typeof import('../src/renderer/composer/main-composer.tsx').createMainComposerViewComponent> {
  const result = await build({
    entryPoints: ['src/renderer/composer/main-composer.tsx'], bundle: true, packages: 'external',
    write: false, format: 'esm', jsx: 'transform', metafile: true,
  });
  assert.deepEqual(Object.keys(result.metafile.inputs), ['src/renderer/composer/main-composer.tsx']);
  const url = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0]!.contents).toString('base64')}`;
  return (await import(url) as typeof import('../src/renderer/composer/main-composer.tsx')).createMainComposerViewComponent;
}

test('main composer preserves the original view composition and editor callbacks', async () => {
  const createView = await loadViewFactory();
  const seen: Array<Record<string, unknown>> = [];
  const part = (name: string) => (props: { children?: React.ReactNode; layout?: string; hidden?: boolean; spacing?: string }) =>
    React.createElement('div', { 'data-part': name, 'data-layout': props.layout, 'data-hidden': String(props.hidden), 'data-spacing': props.spacing }, props.children);
  const parts = {
    Input: part('input'), Attachments: part('attachments'), ReplyContext: part('reply'), Body: part('body'),
    FooterInlineControls: part('leading'), FooterControls: part('footer-controls'),
    FooterExpandingControls: part('expanding'), FooterAction: part('action'), FooterActions: part('actions'),
    AdaptiveFooter: (props: { input: React.ReactNode; leadingControls: React.ReactNode; trailingControls: React.ReactNode; dictation?: { controls: React.ReactNode } }) =>
      React.createElement('div', { 'data-part': 'adaptive-footer' }, props.input, props.leadingControls, props.trailingControls, props.dictation?.controls),
  };
  const Editor = (props: Record<string, unknown>) => {
    seen.push(props);
    return React.createElement('div', { 'data-editor': String(props.placeholder), 'data-class': props.className as string });
  };
  const Surface = (props: { children?: React.ReactNode; layout: string; renderOwnSurface: boolean; surfaceVariant?: string; density: string }) =>
    React.createElement('section', { 'data-layout': props.layout, 'data-own-surface': String(props.renderOwnSurface), 'data-variant': props.surfaceVariant, 'data-density': props.density }, props.children);
  const MotionContext = React.createContext('default');
  const PresentationContext = React.createContext({ quickChatComposerPresentation: null });
  const classNames = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ');
  const mergeRefs = () => () => {};
  const deps = {
    MotionContext, PresentationContext, Parts: parts, Editor, Surface,
    LegacyDictation: part('legacy'), RealtimeVoice: part('realtime'), DictationControls: part('dictation'),
    classNames, mergeRefs,
  } as unknown as MainComposerViewDependencies;
  const original = runInNewContext(`(${originalFunction('function y_d(', 'var b_d,x_d,M9,S_d;function C_d()')})`, {
    b_d: { c: () => Array(101).fill(Symbol.for('react.memo_cache_sentinel')) },
    x_d: React, S_d: React, M9: jsxRuntime, Xsr: MotionContext, Lk: PresentationContext,
    Uk: parts, n_d: Editor, Qgd: Surface, O4u: deps.LegacyDictation, Bgd: deps.RealtimeVoice,
    h_d: deps.DictationControls, Bc: mergeRefs, Wc: classNames,
  }) as React.ComponentType<MainComposerViewProps>;
  const migrated = createView(React, deps);
  const controller = createComposerControllerFixture();
  const submit = () => {};
  const mention = () => {};
  const suggestion = () => {};
  const composition = () => {};
  const base: MainComposerViewProps = {
    surfacePlacement: { kind: 'thread' },
    layoutState: { layout: 'single-line', setComposerWidthMeasureRef: () => {}, onCompositionStateChange: composition },
    editor: { composerController: controller, placeholder: 'Work with Codex', ariaLabel: 'Work with Codex', onSubmit: submit, onMentionActivate: mention, onSuggestionHandler: suggestion, focusRequestNonce: 3, submitReady: true },
    hasVisibleAttachments: false,
    leadingActions: 'Add', modelControl: 'Model', secondaryActions: 'Mode', primaryAction: 'Send',
  };
  const cases: MainComposerViewProps[] = [
    base,
    { ...base, surfacePlacement: { kind: 'home', chromeMode: 'hosted' }, hasVisibleAttachments: true, attachments: 'fixture.txt', header: 'Header', isInteractionBlocked: true },
    { ...base, surfacePlacement: { kind: 'hotkey' }, layoutState: { ...base.layoutState, layout: 'multiline' }, voice: { recording: 'Recording' } },
    { ...base, surfacePlacement: { kind: 'comment', surfaceVariant: 'inline' }, editor: { ...base.editor, readOnlyContent: 'Read only', accessibleStatus: 'Working' }, replyContext: 'Reply' },
  ];
  for (const props of cases) {
    seen.length = 0;
    const expected = renderToStaticMarkup(React.createElement(original, props));
    const originalEditor = seen[0];
    seen.length = 0;
    const actual = renderToStaticMarkup(React.createElement(migrated, props));
    assert.equal(actual, expected);
    if (originalEditor != null) {
      assert.equal(seen[0]?.composerController, controller);
      assert.equal(seen[0]?.onSubmit, submit);
      assert.equal(seen[0]?.onMentionActivate, mention);
      assert.equal(seen[0]?.onSuggestionHandler, suggestion);
      assert.equal(seen[0]?.onCompositionStateChange, composition);
      assert.equal(seen[0]?.submitReady, originalEditor.submitReady);
    } else assert.equal(seen.length, 0);
  }
});

const chromePath = '/usr/bin/google-chrome';
test('pending input transfers text, IME, focus and selection without taking ownership of an external controller', {
  skip: !existsSync(chromePath) && 'Google Chrome is unavailable',
}, async () => {
  const original = originalFunction('function BSd(', 'var VSd,U9,HSd,USd;function WSd()');
  const bundle = await build({
    stdin: {
      contents: `
        import * as React from 'react';
        import * as jsxRuntime from 'react/jsx-runtime';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { createComposerControllerProvider } from './src/renderer/composer/composer-controller.ts';
        const originalSource = ${JSON.stringify(original)};
        window.runControllerFixture = async (original, scenario = 'pending') => {
          const trace = [];
          const settings = { enter: 'enter', plain: false };
          const context = React.createContext(null);
          const doc = text => ({ text, content: { size: text.length }, textBetween: () => text });
          const makeController = (name, initialText) => {
            const state = { doc: doc(initialText), schema: {} };
            Object.defineProperty(state, 'tr', { get() {
              return {
                doc: state.doc,
                replaceWith(_from, _to, content) { this.doc = doc(content.text); return this; },
                setSelection(selection) { this.selection = selection; return this; },
              };
            } });
            return {
              name, view: { dom: document.createElement('div'), isDestroyed: false, state,
                dispatch(tr) { state.doc = tr.doc; trace.push(['selection', name, tr.selection]); } },
              consumeLocationPromptPrefill(key) { trace.push(['consume', name, key]); },
              setEnterBehavior(value) { trace.push(['enter', name, value]); },
              setPlainTextMode(value) { trace.push(['plain', name, value]); },
              destroy() { trace.push(['destroy', name]); this.view.isDestroyed = true; },
            };
          };
          const dependencies = {
            ControllerContext: context,
            useEnterBehavior: () => settings.enter,
            usePlainTextMode: () => settings.plain,
            useIsHydrating: () => false,
            flushSync,
            createController(text, options) {
              trace.push(['create', text, options.defaultTextKind, options.plainTextMode]);
              trace.push(['initial-document', options.initialDocument?.text ?? null]);
              return makeController('created', text || '');
            },
            documentFromText: ({text}) => ({content: {text}}),
            createTextSelection: (_document, anchor, head) => [anchor, head],
          };
          const Provider = original
            ? new Function('VSd','U9','HSd','USd','oa','Ua','ie','ncr','lq','$s','xUu', 'return (' + originalSource + ')')(
              {c: () => Array(45).fill(Symbol.for('react.memo_cache_sentinel'))}, React, {flushSync}, jsxRuntime,
              key => key === 'enter' ? settings.enter : settings.plain,
              {composerEnterBehavior:'enter', composerPlainTextMode:'plain'}, () => false, context,
              dependencies.documentFromText, {create: dependencies.createTextSelection}, dependencies.createController)
            : createComposerControllerProvider(React, dependencies);
          if (scenario === 'draft') {
            const container = document.createElement('div'); document.body.appendChild(container);
            const root = createRoot(container);
            const initialDocument = doc('saved rich document');
            let active = null;
            flushSync(() => root.render(React.createElement(Provider, {
              defaultText:'saved draft', initialDocument,
              onDocumentChange: (document, mode) => trace.push(['change', document.text, mode]),
              onDocumentDispose: (document, mode) => trace.push(['dispose', document.text, mode]),
            }, controller => { active = controller; return React.createElement('span', null, controller?.name); })));
            trace.push(['active', active?.name]);
            flushSync(() => root.unmount());
            await new Promise(resolve => setTimeout(resolve, 20));
            container.remove();
            return trace;
          }
          const input = document.createElement('textarea');
          input.dataset.edited = 'true'; input.dataset.composition = 'true'; input.value = 'ab\\ncd';
          document.body.appendChild(input); input.focus(); input.setSelectionRange(1, 4, 'backward');
          const container = document.createElement('div'); document.body.appendChild(container);
          const root = createRoot(container);
          const external = makeController('external', 'external draft');
          const getInitialInput = () => ({element: input, locationKey:'fixture-key'});
          const options = {};
          let active = null;
          const child = controller => { active = controller; return React.createElement('span', {id:'controller'}, controller?.name || 'pending'); };
          const change = (document, mode) => trace.push(['change', document.text, mode]);
          const dispose = (document, mode) => trace.push(['dispose', document.text, mode]);
          const render = controller => flushSync(() => root.render(React.createElement(Provider, {
            composerController: controller, controllerOptions: options, getInitialInput,
            getInitialContent: () => ({defaultText:'initial', defaultTextKind:'prompt'}),
            onDocumentChange: change, onDocumentDispose: dispose, renderWhilePending:true,
          }, child)));
          render(null); trace.push(['pending', active === null]);
          flushSync(() => input.dispatchEvent(new CompositionEvent('compositionstart', {bubbles:true})));
          delete input.dataset.composition;
          input.dispatchEvent(new Event('pending-input-ready'));
          trace.push(['focus', active?.initialInputFocused === true]);
          input.value = 'new text'; input.setSelectionRange(2, 5, 'forward');
          flushSync(() => input.dispatchEvent(new Event('input', {bubbles:true})));
          trace.push(['draft', active?.view.state.doc.text]);
          settings.enter = 'cmdAlways'; settings.plain = true; render(null);
          render(external); trace.push(['external-identity', active === external]);
          flushSync(() => root.unmount());
          await new Promise(resolve => setTimeout(resolve, 20));
          container.remove(); input.remove();
          return trace;
        };
      `,
      resolveDir: process.cwd(), loader: 'jsx',
    },
    bundle: true, write: false, format: 'iife', jsx: 'transform',
  });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.route('**/*', route => route.abort());
      await page.setContent('<main></main>');
      await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
      const run = (original: boolean, scenario = 'pending') => page.evaluate(({ flag, scenario }) =>
        (window as unknown as { runControllerFixture: (original: boolean, scenario: string) => Promise<unknown[]> }).runControllerFixture(flag, scenario), { flag: original, scenario });
      const expected = await run(true);
      const actual = await run(false);
      assert.deepEqual(actual, expected);
      assert.ok(actual.some(event => JSON.stringify(event) === JSON.stringify(['create', 'ab\ncd', 'literal', false])));
      assert.ok(actual.some(event => JSON.stringify(event) === JSON.stringify(['selection', 'created', [6, 2]])));
      assert.ok(actual.some(event => JSON.stringify(event) === JSON.stringify(['focus', true])));
      assert.ok(actual.some(event => JSON.stringify(event) === JSON.stringify(['draft', 'new text'])));
      assert.ok(actual.some(event => JSON.stringify(event) === JSON.stringify(['external-identity', true])));
      assert.equal(actual.filter(event => JSON.stringify(event) === JSON.stringify(['destroy', 'created'])).length, 1);
      assert.ok(!actual.some(event => JSON.stringify(event) === JSON.stringify(['destroy', 'external'])));
      const initialDraft = await run(false, 'draft');
      assert.deepEqual(initialDraft, await run(true, 'draft'));
      assert.ok(initialDraft.some(event => JSON.stringify(event) === JSON.stringify(['create', 'saved draft', 'plain', false])));
      assert.ok(initialDraft.some(event => JSON.stringify(event) === JSON.stringify(['initial-document', 'saved rich document'])));
      assert.ok(initialDraft.some(event => JSON.stringify(event) === JSON.stringify(['active', 'created'])));
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
});
