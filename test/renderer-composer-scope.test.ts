import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  ComposerDraftDocument,
  ComposerDraftScope,
  ComposerDraftScopeDependencies,
  ComposerDraftScopeProps,
} from '../src/renderer/composer/composer-draft-scope.tsx';
import type { ComposerControllerProviderProps, ComposerDocument } from '../src/renderer/composer/composer-types.ts';
import {
  createComposerControllerFixture,
  createComposerDocumentFixture,
  createComposerScopeFixture,
  createComposerScopeSignal,
} from './renderer-composer-fixture.ts';

async function loadFactory(): Promise<typeof import('../src/renderer/composer/composer-draft-scope.tsx').createComposerDraftScopeComponent> {
  const result = await build({
    entryPoints: ['src/renderer/composer/composer-draft-scope.tsx'], bundle: true, packages: 'external',
    write: false, format: 'esm', jsx: 'transform', metafile: true,
  });
  assert.deepEqual(Object.keys(result.metafile.inputs), ['src/renderer/composer/composer-draft-scope.tsx']);
  const url = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0]!.contents).toString('base64')}`;
  return (await import(url) as typeof import('../src/renderer/composer/composer-draft-scope.tsx')).createComposerDraftScopeComponent;
}

test('the fixed Mpt draft and rendering boundaries can be replaced without breaking its remaining function', () => {
  const resource = readFileSync(new URL(
    '../vendor/codex-app/26.1013.40934/webview/assets/app-primary-f5ea123a0407.js', import.meta.url,
  ), 'utf8');
  const start = 'function Mpt(e){let t=(0,wZ.c)(251),';
  const next = 'function Npt(e){';
  const from = resource.indexOf(start);
  const to = resource.indexOf(next, from);
  assert.ok(from >= 0 && to > from && resource.lastIndexOf(start) === from);
  let source = resource.slice(from, to);
  function replaceSection(begin: string, end: string, replacement: string): void {
    const first = source.indexOf(begin);
    const last = source.indexOf(end, first);
    assert.ok(first >= 0 && last > first && source.lastIndexOf(begin) === first && source.lastIndexOf(end) === last);
    source = source.slice(0, first) + replacement + source.slice(last + end.length);
  }
  replaceSection('let ct=st,lt;', 'let pt=ft,mt;', 'let ct=st,mt;');
  replaceSection('let Mn=ct??void 0,Nn;', 'let Wn;', 'let Wn;');
  replaceSection('let er;t[233]!==le', 't[249]=er,t[250]=J):J=t[250],J}',
    'return(0,EZ.jsx)(__yardDraftScopeComponent,{scope:He,draftKey:ot,conversationId:ct,isWorkspaceStarter:nt,rootClassName:jn,surfacePlacement:Ne,showSurface:je,plainTextMode:it,defaultPrompt:he,composerController:le,onPlainTextChange:G,aboveComposerContent:o,aboveComposerContentLayout:Se,hotkeyWindowHomeFooterControls:fe,workSettingsQuery:tn,composer:$n})}');
  assert.doesNotThrow(() => new Function(`return (${source})`));
  assert.match(source, /gt=He\.value\.kind===`local`\?DZ:hpt/);
  assert.doesNotMatch(source, /fh\(He\)|oNe\(He|Iae\(He/);
});

test('draft scope preserves saved documents, callbacks, and the local portal', async () => {
  const create = await loadFactory();
  const document: ComposerDocument = createComposerDocumentFixture('draft');
  const controller = createComposerControllerFixture();
  const calls: Array<unknown[]> = [];
  const savedText = createComposerScopeSignal('draft');
  const protectedDraft = createComposerScopeSignal(false);
  const retainedDocument = createComposerScopeSignal<ComposerDraftDocument | undefined>(undefined);
  let directDocument: ComposerDraftDocument | undefined;
  let documentReads = 0;
  let providerProps: ComposerControllerProviderProps | undefined;
  const Provider = (props: ComposerControllerProviderProps) => {
    providerProps = props;
    return React.createElement('section', null, props.children as React.ReactNode);
  };
  const dependencies: ComposerDraftScopeDependencies = {
    ComposerProvider: Provider,
    EnvironmentSetup: ({ threadId }) => React.createElement('i', { 'data-thread-id': threadId }),
    WorkspaceBanner: () => React.createElement('b', null, 'workspace'),
    WorkspaceFooter: () => React.createElement('b', null, 'footer'),
    SettingsError: ({ onReload }) => React.createElement('button', { onClick: onReload }, 'reload'),
    isClientThreadId: id => id === 'client-thread',
    hasProtectedDraft: scope => scope.get(protectedDraft),
    getSnapshot: () => ({ prompt: 'draft', document, plainTextMode: false }),
    getDocument: () => { documentReads++; return directDocument; },
    getPersistedText: scope => scope.get(savedText),
    serializeDocument: (_document, options) => { calls.push(['serialize', options]); return { content: 'serialized' }; },
    isPrompt: text => text.startsWith('prompt:'),
    writeDocument: (scope, next, mode) => calls.push(['write', scope, next.toJSON(), mode]),
    preserveDocument: (scope, next) => { scope.set(retainedDocument, next); calls.push(['preserve', scope, next]); },
  };
  const Component = create(React, dependencies);
  const scope: ComposerDraftScope = createComposerScopeFixture({ kind: 'local', placement: 'main', conversationId: null, clientThreadId: 'client-thread' });
  const base: ComposerDraftScopeProps = {
    scope, draftKey: 'client-thread', conversationId: null, isWorkspaceStarter: true,
    rootClassName: 'min-w-0 fixture', surfacePlacement: { kind: 'thread' }, showSurface: true,
    plainTextMode: false, composerController: controller, onPlainTextChange: text => calls.push(['text', text]),
    aboveComposerContent: 'above', aboveComposerContentLayout: 'floating', composer: 'editor',
  };
  const render = (props: ComposerDraftScopeProps) => {
    providerProps = undefined;
    const markup = renderToStaticMarkup(React.createElement(Component, props));
    assert.ok(providerProps != null);
    return { markup, provider: providerProps as ComposerControllerProviderProps };
  };

  let { markup, provider } = render(base);
  assert.match(markup, /data-codex-composer-root="" data-composer-placement="thread"/);
  assert.match(markup, /data-thread-id="client-thread"/);
  assert.match(markup, /workspace.*footer.*above.*editor/);
  assert.equal(provider.composerController, controller);
  assert.equal(provider.defaultText, 'draft');
  assert.equal(provider.defaultTextKind, 'plain');
  assert.equal(provider.initialDocument, document);
  assert.equal(provider.initialDocument.type.schema, document.type.schema);
  provider.onDocumentChange?.(document, false);
  provider.onDocumentDispose?.(document, false);
  assert.deepEqual(calls, [
    ['write', scope, { type: 'doc', content: [{ type: 'text', text: 'draft' }] }, false],
    ['serialize', { preserveTextLinkMarks: true }],
    ['text', 'serialized'],
    ['preserve', scope, { document, plainTextMode: false }],
  ]);
  assert.equal(scope.get(retainedDocument)?.document, document);

  calls.length = 0;
  ({ provider } = render({ ...base, plainTextMode: true }));
  assert.equal(provider.defaultText, 'serialized');
  assert.equal(provider.initialDocument, undefined);
  assert.deepEqual(calls, [['serialize', { preserveTextLinkMarks: true, preserveUnresolvedSkillMentions: true }]]);

  calls.length = 0;
  scope.set(savedText, 'changed');
  ({ provider } = render({ ...base, showSurface: false }));
  assert.equal(provider.defaultText, 'changed');
  assert.equal(provider.initialDocument, undefined);
  provider.onDocumentChange?.(document, false);
  provider.onDocumentDispose?.(document, false);
  assert.deepEqual(calls, []);

  directDocument = { document, plainTextMode: false };
  ({ provider } = render(base));
  assert.equal(provider.defaultText, 'changed');
  assert.equal(provider.initialDocument, document);
  directDocument = undefined;
  scope.set(savedText, '');
  ({ provider } = render(base));
  provider.onDocumentDispose?.(document, false);
  assert.deepEqual(calls, []);

  scope.set(savedText, 'draft');
  scope.set(protectedDraft, true);
  ({ provider } = render(base));
  assert.equal(provider.initialDocument, undefined);
  const previousDocumentReads = documentReads;
  ({ markup, provider } = render({
    ...base, defaultPrompt: 'prompt:example', aboveComposerContentLayout: 'header',
    scope: createComposerScopeFixture({ kind: 'new' }), workSettingsQuery: { isError: true, refetch() {} },
  }));
  assert.equal(provider.defaultText, 'prompt:example');
  assert.equal(provider.defaultTextKind, 'prompt');
  assert.equal(provider.initialDocument, undefined);
  assert.equal(documentReads, previousDocumentReads);
  assert.doesNotMatch(markup, /data-thread-id|>above</);
  assert.match(markup, /reload/);
});

const chromePath = '/usr/bin/google-chrome';
test('changing the upstream draft key remounts the provider and retains the external controller', {
  skip: !existsSync(chromePath) && 'Google Chrome is unavailable',
}, async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import * as React from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { createComposerDraftScopeComponent } from './src/renderer/composer/composer-draft-scope.tsx';
        window.runScopeFixture = () => {
          const trace = [], external = {id:'external'};
          const first = {value:{kind:'new'}, text:'first', get: () => {}, set: () => {}};
          const second = {value:{kind:'new'}, text:'second', get: () => {}, set: () => {}};
          let nextInstance = 0;
          function Provider(props) {
            const [instance] = React.useState(() => ++nextInstance);
            React.useLayoutEffect(() => {trace.push(['mount', instance]); return () => trace.push(['unmount', instance]);}, []);
            trace.push(['render', instance, props.defaultText, props.composerController === external]);
            return React.createElement('div', null, props.children);
          }
          const Null = () => null;
          const Component = createComposerDraftScopeComponent(React, {
            ComposerProvider:Provider, EnvironmentSetup:Null, WorkspaceBanner:Null, WorkspaceFooter:Null, SettingsError:Null,
            isClientThreadId:() => false, hasProtectedDraft:() => false, getSnapshot:() => undefined,
            getDocument:() => undefined, getPersistedText:scope => scope.text,
            serializeDocument:() => ({content:''}), isPrompt:() => false, writeDocument:() => {}, preserveDocument:() => {},
          });
          const container = document.createElement('div'); document.body.append(container);
          const root = createRoot(container);
          const render = (scope,key) => flushSync(() => root.render(React.createElement(Component, {
            scope, draftKey:key, conversationId:null, isWorkspaceStarter:false, rootClassName:'min-w-0',
            surfacePlacement:{kind:'home'}, showSurface:true, plainTextMode:false,
            composerController:external, aboveComposerContentLayout:'floating', composer:'editor',
          })));
          render(first,'first'); render(first,'first'); render(second,'second');
          flushSync(() => root.unmount()); container.remove(); return trace;
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
      const trace = await page.evaluate(() => (window as unknown as { runScopeFixture(): unknown[] }).runScopeFixture());
      assert.deepEqual(trace, [
        ['render', 1, 'first', true], ['mount', 1], ['render', 1, 'first', true],
        ['render', 2, 'second', true], ['unmount', 1], ['mount', 2], ['unmount', 2],
      ]);
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
});
