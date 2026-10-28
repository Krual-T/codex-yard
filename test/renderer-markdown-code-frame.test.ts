import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    markdownHarness: {
      render: (options: { content: string; language?: string; open?: boolean; preview?: boolean }) => void;
      reveal: () => void;
      copied?: string;
      copyCount: number;
    };
  }
}

const chromePath = '/usr/bin/google-chrome';
test('code controls preserve copy, wrap, streaming, preview and deferred behavior', {
  skip: !existsSync(chromePath) && 'Google Chrome is unavailable; portable code-block checks still run',
}, async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import * as React from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { createMarkdownCodeBlockComponent } from './src/renderer/markdown/code-block.tsx';
        import { createCodeBlockFrameComponent } from './src/renderer/markdown/code-block-frame.tsx';
        const context = React.createContext(false);
        const styles = Object.fromEntries(['Root','CodeSurface','Surface','WithPreview','FloatingControls','Source',
          'FloatingSource','Preview','PreviewHidden','ActionBar','FloatingActionBar','StickyActionBar'].map(k => [k,k]));
        const Icon = ({className}) => React.createElement('i', {className});
        const Frame = createCodeBlockFrameComponent(React, {
          useIsDark: () => false,
          useIntl: () => ({formatMessage: ({defaultMessage}) => defaultMessage}),
          normalizeLanguage: language => language.toLowerCase(),
          CopyButton: ({ariaLabel, onCopy}) => React.createElement('button', {'aria-label': ariaLabel, onClick: e => void onCopy(e)}),
          Tooltip: ({children}) => children,
          Button: ({children, color, size, uniform, allowShrink, ...props}) => React.createElement('button', props, children),
          FormattedMessage: ({defaultMessage}) => defaultMessage,
          LatexPreview: ({source}) => React.createElement('span', {'data-latex': ''}, source),
          WrapEnabledIcon: Icon, WrapDisabledIcon: Icon, WrappedIcon: Icon, UnwrappedIcon: Icon, CodeIcon: Icon,
          copyToClipboard: content => { window.markdownHarness.copied = content; return Promise.resolve(true); },
          styles, classNames: (...classes) => classes.filter(Boolean).join(' '),
        });
        function Snippet(props) {
          const [wrap, setWrap] = React.useState(false);
          return React.createElement(Frame, {
            source: React.createElement('code', null, props.content), content: props.content,
            language: props.language, allowPreview: props.allowPreview, showCopyButton: props.showCopyButton,
            shouldWrapCode: props.shouldWrapCode || wrap, title: props.title, variant: props.variant,
            onToggleWrapCode: props.codeBlockWordWrap === 'user-controlled' ? () => setWrap(!wrap) : undefined,
            onCopyCode: () => window.markdownHarness.copyCount++,
          });
        }
        const Component = createMarkdownCodeBlockComponent(React, {
          useLanguageLabel: language => language, CodeBlockPreviewContext: context, DefaultCodeSnippet: Snippet,
          MermaidPlaceholder: ({isStreaming}) => React.createElement('span', null, isStreaming ? 'loading stream' : 'loading'),
          isMermaidDiagram: language => language === 'mermaid', isDeferredCodeBlock: content => content === 'deferred',
          styles: {CodeBlock: 'code-block', CodeBlockPlaceholder: 'placeholder'},
        });
        window.IntersectionObserver = class {
          constructor(callback) { this.callback = callback; }
          observe() { window.markdownHarness.reveal = () => this.callback([{isIntersecting:true}]); }
          disconnect() {}
        };
        const root = createRoot(document.getElementById('root'));
        window.markdownHarness = {
          reveal: () => {}, copyCount: 0,
          render(options) { flushSync(() => root.render(React.createElement(context.Provider, {value: !!options.preview},
            React.createElement(Component, {key: options.content, content: options.content, language: options.language,
              isCodeFenceOpen: options.open})))); },
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
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => window.markdownHarness.render({ content: 'const x = 1', language: 'ts' }));
    assert.equal(await page.locator('[data-code-block-source]').textContent(), 'const x = 1');
    assert.equal(await page.locator('[data-code-block-controls]').getAttribute('role'), 'presentation');
    assert.match(await page.locator('[data-code-block-controls]').getAttribute('class') ?? '', /print:hidden/);
    assert.equal(await page.locator('[data-code-block-controls]').locator('..').locator('..').getAttribute('data-markdown-copy'), 'exclude');
    await page.getByRole('button', { name: 'Copy code' }).click();
    assert.deepEqual(await page.evaluate(() => [window.markdownHarness.copied, window.markdownHarness.copyCount]), ['const x = 1', 1]);
    await page.getByRole('button', { name: 'Enable word wrap' }).click();
    assert.equal(await page.getByRole('button', { name: 'Disable word wrap' }).getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('[data-code-block-source]').getAttribute('class') ?? '', /whitespace-pre-wrap/);

    await page.evaluate(() => window.markdownHarness.render({ content: 'partial', open: true }));
    assert.equal(await page.getByRole('button', { name: 'Copy code' }).count(), 0);
    assert.equal(await page.locator('[data-code-block-source]').textContent(), 'partial');

    await page.evaluate(() => window.markdownHarness.render({ content: 'x^2', language: 'latex' }));
    assert.equal(await page.locator('[data-code-block]').getAttribute('data-source-visible'), 'false');
    assert.equal(await page.locator('[data-code-block]').getAttribute('data-markdown-copy-text'), 'x^2');
    assert.equal(await page.locator('[data-code-block-source]').evaluate(element => element.hasAttribute('hidden') && element.hasAttribute('inert')), true);
    assert.equal(await page.locator('[data-code-block-preview]').getAttribute('data-markdown-copy'), 'contents');
    await page.getByRole('button', { name: 'Show source' }).click();
    assert.equal(await page.locator('[data-code-block]').getAttribute('data-source-visible'), 'true');
    assert.equal(await page.locator('[data-code-block-source]').evaluate(element => element.hasAttribute('hidden') || element.hasAttribute('inert')), false);
    assert.equal(await page.locator('[data-code-block-preview]').getAttribute('data-markdown-copy'), 'exclude');
    assert.equal(await page.locator('[data-code-block-preview]').evaluate(element => element.hasAttribute('inert')), true);
    await page.getByRole('button', { name: 'Show preview' }).click();

    await page.evaluate(() => window.markdownHarness.render({ content: 'deferred', language: 'ts' }));
    assert.equal(await page.locator('[data-markdown-copy="code-block"]').getAttribute('data-markdown-copy-text'), 'deferred');
    assert.equal(await page.locator('[data-code-block]').count(), 0);
    await page.evaluate(() => window.markdownHarness.reveal());
    await page.locator('[data-code-block]').waitFor();
    assert.equal(await page.locator('[data-code-block-source]').textContent(), 'deferred');

    await page.evaluate(() => window.markdownHarness.render({ content: 'preview', language: 'ts', preview: true }));
    assert.equal(await page.locator('[data-code-block-source]').getAttribute('tabindex'), '0');
    assert.equal(await page.getByRole('button', { name: 'Enable word wrap' }).count(), 0);
    await page.close();
  } finally {
    await browser.close();
  }
});
