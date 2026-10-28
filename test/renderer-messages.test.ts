import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { build, transform } from 'esbuild';
import { chromium } from 'playwright-core';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  CollapsibleUserMessageContentDependencies,
  CollapsibleUserMessageContentProps,
} from '../src/renderer/messages/collapsible-user-message-content.tsx';

declare global {
  interface Window {
    messageHarness: {
      render: (options: { text: string; mode?: 'text' | 'dom'; printing?: boolean; key?: string }) => void;
      unmount: () => void;
    };
    testTarget: { text: string; isTruncated: boolean; reveal?: () => void };
    testMeasurement: { forceCollapsible: boolean };
  }
}

const sourcePath = new URL('../src/renderer/messages/collapsible-user-message-content.tsx', import.meta.url);
const { code } = await transform(await readFile(sourcePath, 'utf8'), { loader: 'tsx', format: 'esm', jsx: 'transform' });
assert.doesNotMatch(code, /react\/jsx-runtime/);
const { createCollapsibleUserMessageContentComponent } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
) as typeof import('../src/renderer/messages/collapsible-user-message-content.tsx');

function renderMessage(
  state: 'uncollapsible' | 'collapsed' | 'expanded',
  printing: boolean,
  props: CollapsibleUserMessageContentProps,
) {
  const previewContext = React.createContext(false);
  let measurement: Parameters<CollapsibleUserMessageContentDependencies['useTextContentMeasurement']>[0] | undefined;
  const dependencies: CollapsibleUserMessageContentDependencies = {
    useIsPrinting: () => printing,
    useTextContentMeasurement: options => {
      measurement = options;
      return { collapseState: state, setTextContentMeasurementRef: () => {}, handleToggleExpansion: () => {} };
    },
    registerThreadFindTarget: () => () => {},
    CodeBlockPreviewContext: previewContext,
    Button: ({ children, color, size, ...rest }) => React.createElement('button', { ...rest, 'data-color': color, 'data-size': size }, children),
    FormattedMessage: ({ defaultMessage }) => React.createElement(React.Fragment, null, defaultMessage),
    ChevronDown: ({ className }) => React.createElement('i', { className }),
    classNames: (...classes) => classes.filter(Boolean).join(' '),
  };
  const Component = createCollapsibleUserMessageContentComponent(React, dependencies);
  const markup = renderToStaticMarkup(React.createElement(Component, props));
  return { markup, measurement, previewContext };
}

test('renders official collapse, fade, expansion and printing states with the injected React', () => {
  const limit = 3 * 512;
  const text = 'a'.repeat(limit) + 'END';
  let visible = '';
  const children = (value: string) => { visible = value; return value; };
  const collapsed = renderMessage('collapsed', false, { text, children, collapsedLineCount: 3 });
  assert.equal(visible, text.slice(0, limit));
  assert.deepEqual(collapsed.measurement, { text, collapsedLineCount: 3, fallbackFontSizePx: 13, forceCollapsible: true });
  assert.match(collapsed.markup, /max-height:2lh/);
  assert.match(collapsed.markup, /aria-hidden="true" class="block">…/);
  assert.match(collapsed.markup, /aria-expanded="false"/);
  assert.match(collapsed.markup, /data-thread-find-skip="true"/);
  assert.match(collapsed.markup, /data-markdown-copy="exclude"/);
  assert.match(collapsed.markup, /data-color="disclosure"/);
  assert.match(collapsed.markup, /Show more/);

  const expanded = renderMessage('expanded', false, { text, children, collapsedLineCount: 3, isAeonFormatted: true });
  assert.equal(visible, text);
  assert.match(expanded.markup, /aria-expanded="true"/);
  assert.match(expanded.markup, /data-color="ghostUserMessage"/);
  assert.match(expanded.markup, /Show less/);
  assert.match(expanded.markup, /icon-2xs rotate-180/);
  assert.doesNotMatch(expanded.markup, /max-height|aria-hidden="true" class="block"/);

  const printed = renderMessage('collapsed', true, { text, children, collapsedLineCount: 3 });
  assert.equal(visible, text);
  assert.equal(printed.measurement?.forceCollapsible, false);
  assert.doesNotMatch(printed.markup, /max-height|Show more|aria-hidden="true" class="block"/);

  const faded = renderMessage('collapsed', false, { text, children: text, collapsedLineCount: 3, collapseIndicator: 'fade' });
  assert.equal(faded.measurement?.forceCollapsible, false);
  assert.match(faded.markup, /max-height:3lh/);
  assert.match(faded.markup, /mask-b-from-80% mask-b-to-100%/);
  assert.doesNotMatch(faded.markup, /aria-hidden="true" class="block"/);

  const short = renderMessage('uncollapsible', false, { text: 'short', children: 'short' });
  assert.equal(short.measurement?.collapsedLineCount, 20);
  assert.doesNotMatch(short.markup, /Show more|overflow-hidden/);

  const twoLines = renderMessage('collapsed', false, { text, children, collapsedLineCount: 2 });
  assert.match(twoLines.markup, /max-height:2lh/);
  assert.doesNotMatch(twoLines.markup, /aria-hidden="true" class="block"/);
});

const chromePath = '/usr/bin/google-chrome';
test('keeps search, code block clipping and focusability in sync across collapse and print', {
  skip: !existsSync(chromePath) && 'Google Chrome is unavailable; portable render checks still run',
}, async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import * as React from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { createCollapsibleUserMessageContentComponent } from './src/renderer/messages/collapsible-user-message-content.tsx';
        const context = React.createContext(false);
        const dependencies = {
          useIsPrinting: () => window.testPrinting,
          useTextContentMeasurement: options => {
            window.testMeasurement = options;
            const [expanded, setExpanded] = React.useState(false);
            return { collapseState: expanded ? 'expanded' : 'collapsed',
              setTextContentMeasurementRef: element => { if (element) element.dataset.measured = 'true'; },
              handleToggleExpansion: () => setExpanded(previous => !previous) };
          },
          registerThreadFindTarget: (element, target) => {
            window.testTarget = target;
            element.dataset.findTarget = 'true';
            return () => { delete element.dataset.findTarget; };
          },
          CodeBlockPreviewContext: context,
          Button: ({children, color, size, ...props}) => React.createElement('button', {...props, 'data-disclosure': color}, children),
          FormattedMessage: ({defaultMessage}) => defaultMessage,
          ChevronDown: ({className}) => React.createElement('i', {className}),
          classNames: (...classes) => classes.filter(Boolean).join(' '),
        };
        const Component = createCollapsibleUserMessageContentComponent(React, dependencies);
        function Body({value, mode}) {
          const preview = React.useContext(context);
          return React.createElement('div', {'data-preview': String(preview), style: {position: 'relative'}}, mode === 'text'
            ? React.createElement('span', {id: 'text'}, value)
            : React.createElement(React.Fragment, null,
                React.createElement('button', {id: 'visible', style: {display: 'block', height: 20}}, 'visible'),
                React.createElement('div', {style: {height: 10}}),
                React.createElement('div', {'data-markdown-copy': 'code-block', style: {height: 45}}, 'code'),
                React.createElement('button', {id: 'hidden', 'aria-hidden': 'false', style: {display: 'block', height: 20}}, 'hidden'),
                React.createElement('button', {id: 'preinert', inert: true}, 'pre-inert'),
                React.createElement('a', {id: 'partial-link', href: '#', style: {position: 'absolute', top: 65, height: 20, width: 50}}, 'link'),
                React.createElement('button', {id: 'partial-button', style: {position: 'absolute', top: 65, height: 20}}, 'partial')));
        }
        let root = createRoot(document.getElementById('root'));
        window.messageHarness = {
          render({text, mode = 'text', printing = false, key = 'default'}) {
            window.testPrinting = printing;
            flushSync(() => root.render(React.createElement(Component, {key, text, collapsedLineCount: 3,
              children: value => React.createElement(Body, {value, mode})})));
          },
          unmount() { flushSync(() => root.unmount()); },
        };
      `,
      resolveDir: process.cwd(),
      loader: 'jsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'transform',
  });
  const shortDirectory = await mkdtemp('/tmp/yard-message-browser-');
  try {
    const chromeTemp = join(shortDirectory, 'tmp');
    await symlink(tmpdir(), chromeTemp, 'dir');
    const browser = await chromium.launch({
      executablePath: chromePath,
      headless: true,
      args: ['--no-sandbox'],
      env: { ...process.env, TMPDIR: chromeTemp },
    });
    try {
      const page = await browser.newPage();
      await page.setContent('<style>body{margin:0}.leading-relaxed{line-height:20px;width:240px;font-size:13px}.overflow-hidden{overflow:hidden}.block{display:block}</style><div id="root"></div>');
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const text = 'a'.repeat(3 * 512) + 'END';
      await page.evaluate(value => window.messageHarness.render({ text: value }), text);
      assert.equal(await page.locator('#text').textContent(), text.slice(0, 3 * 512));
      assert.equal(await page.locator('[data-preview]').getAttribute('data-preview'), 'true');
      assert.deepEqual(await page.evaluate(() => ({
        truncated: window.testTarget.isTruncated,
        text: window.testTarget.text,
        canReveal: typeof window.testTarget.reveal === 'function',
        measured: !!document.querySelector('[data-measured]'),
      })), { truncated: true, text, canReveal: true, measured: false });
      await page.evaluate(() => window.testTarget.reveal?.());
      await page.getByRole('button', { name: 'Show less' }).waitFor();
      assert.equal(await page.locator('#text').textContent(), text);
      assert.equal(await page.evaluate(() => window.testTarget.isTruncated), false);
      await page.getByRole('button', { name: 'Show less' }).click();
      await page.evaluate(value => window.messageHarness.render({ text: value, printing: true }), text);
      assert.equal(await page.locator('#text').textContent(), text);
      assert.equal(await page.locator('[data-preview]').getAttribute('data-preview'), 'false');
      assert.equal(await page.locator('[data-disclosure]').count(), 0);
      assert.equal(await page.evaluate(() => window.testMeasurement.forceCollapsible), false);
      await page.evaluate(value => window.messageHarness.render({ text: value }), text);
      assert.equal(await page.locator('#text').textContent(), text.slice(0, 3 * 512));
      assert.equal(await page.getByRole('button', { name: 'Show more' }).count(), 1);

      await page.evaluate(() => window.messageHarness.render({ text: 'short', mode: 'dom', key: 'dom' }));
      await page.waitForFunction(() => document.querySelector('[data-find-target]')?.getAttribute('style')?.includes('75px'));
      await page.waitForFunction(() => document.querySelector('#hidden')?.hasAttribute('inert'));
      await page.waitForFunction(() => !document.querySelector('#partial-link')?.hasAttribute('inert'));
      assert.equal(await page.locator('#visible').evaluate(element => element.hasAttribute('inert')), false);
      assert.equal(await page.locator('#partial-button').evaluate(element => element.hasAttribute('inert')), true);
      assert.equal(await page.locator('#hidden').getAttribute('aria-hidden'), 'true');
      assert.equal(await page.locator('#preinert').evaluate(element => element.hasAttribute('inert')), true);
      await page.evaluate(() => {
        const button = document.createElement('button');
        button.id = 'inserted';
        document.querySelector('[data-preview]')?.append(button);
      });
      await page.waitForFunction(() => document.querySelector('#inserted')?.hasAttribute('inert'));
      await page.locator('[data-markdown-copy="code-block"]').evaluate(element => {
        (element as HTMLElement).style.height = '65px';
      });
      await page.waitForFunction(() => document.querySelector('[data-find-target]')?.getAttribute('style')?.includes('95px'));
      await page.evaluate(() => window.messageHarness.render({ text: 'short', mode: 'dom', key: 'dom', printing: true }));
      assert.equal(await page.locator('#hidden').evaluate(element => element.hasAttribute('inert')), false);
      assert.equal(await page.locator('#hidden').getAttribute('aria-hidden'), 'false');
      assert.equal(await page.locator('#preinert').evaluate(element => element.hasAttribute('inert')), true);
      await page.evaluate(() => window.messageHarness.render({ text: 'short', mode: 'dom', key: 'dom' }));
      await page.waitForFunction(() => document.querySelector('#hidden')?.hasAttribute('inert'));
      await page.getByRole('button', { name: 'Show more' }).click();
      assert.equal(await page.locator('#hidden').evaluate(element => element.hasAttribute('inert')), false);
      assert.equal(await page.locator('#hidden').getAttribute('aria-hidden'), 'false');
      assert.equal(await page.locator('#inserted').evaluate(element => element.hasAttribute('inert')), false);
      assert.equal(await page.locator('#preinert').evaluate(element => element.hasAttribute('inert')), true);

      await page.evaluate(() => {
        Reflect.deleteProperty(window, 'IntersectionObserver');
        window.messageHarness.render({ text: 'short', mode: 'dom', key: 'fallback' });
      });
      assert.equal(await page.locator('#partial-link').evaluate(element => element.hasAttribute('inert')), false);
      assert.equal(await page.locator('#partial-button').evaluate(element => element.hasAttribute('inert')), true);
      await page.getByRole('button', { name: 'Show more' }).click();
      assert.equal(await page.locator('#hidden').getAttribute('aria-hidden'), 'false');
      await page.evaluate(() => window.messageHarness.unmount());
      await page.close();
    } finally {
      await browser.close();
    }
  } finally {
    await rm(shortDirectory, { recursive: true, force: true });
  }
});
