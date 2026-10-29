import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright-core';

declare global {
  interface Window {
    citationHarness: {
      render: (text: string, hostId?: string, cwd?: string, threadId?: string) => void;
      files: { hostId: string; cwd: string; path: string; line?: number; column?: number }[];
      browsers: { hostId: string; threadId: string; url?: string; source?: string }[];
      visualizations: { hostId: string; threadId: string; path: string }[];
      copies: string[];
      copyContent: () => { plainText: string; htmlText: string };
    };
  }
}

const chromeAvailable = existsSync('/usr/bin/google-chrome');
const require = createRequire(import.meta.url);
let browser: Browser;
let script: string;

before(async () => {
  if (!chromeAvailable) return;
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {StandaloneMarkdown} from './src/renderer/markdown/StandaloneMarkdown.tsx';
      import {messageCopyContent} from './src/renderer/messages/message-copy.ts';
      const client = {rpc:async () => {throw Error('Unexpected RPC');}, reply:async () => {},
        subscribe:() => () => {}, host:async () => {throw Error('Unexpected host operation');}};
      const files = [], browsers = [], visualizations = [], copies = [];
      const root = createRoot(document.getElementById('root'));
      Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText:async text => copies.push(text)}});
      window.citationHarness = {files, browsers, visualizations, copies,
        copyContent:() => messageCopyContent(document.getElementById('root')),
        render(text, hostId='ssh-one', cwd='/work', threadId='thread-one') {
        root.render(<div data-user-copy-part><StandaloneMarkdown text={text} client={client} hostId={hostId} cwd={cwd} threadId={threadId}
          allowBasicHtml onOpenFileAt={location => files.push(location)} onOpenBrowser={target => browsers.push(target)}
          onOpenVisualization={target => visualizations.push(target)}/></div>);
      }};
    ` },
    bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' },
    plugins: [{ name: 'single-katex', setup(builder) {
      builder.onResolve({ filter: /^katex$/ }, () => ({ path: require.resolve('katex') }));
    } }],
  });
  script = bundle.outputFiles[0]!.text;
  browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking', '--no-proxy-server'] });
});

after(async () => { await browser?.close(); });

async function openPage(): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: script });
  return { page, errors };
}

test('file citations open their exact host paths and line ranges, including after a scope change',
  { skip: !chromeAvailable && 'Isolated Chrome is unavailable', timeout: 30_000 }, async () => {
    const { page, errors } = await openPage();
    try {
      await page.evaluate(() => window.citationHarness.render(
        'Output: :codex-file-citation{path="/work/docs/report.md" purpose="output"}'));
      await page.getByRole('button', { name: 'report.md', exact: true }).click({ timeout: 3_000 });
      const copy = await page.evaluate(() => window.citationHarness.copyContent());
      assert.equal(copy.plainText, 'Output: report.md');
      assert.doesNotMatch(copy.htmlText, /codex-file-citation|<button/i);
      await page.evaluate(() => window.citationHarness.render(
        'Source: :codex-file-citation{path="docs/a b%20#x.ts" purpose="source" line_range_start="12" lineRangeEnd="15"}',
        'ssh-two', '/other', 'thread-two'));
      await page.getByRole('button', { name: 'a b%20#x.ts (lines 12-15)', exact: true }).click({ timeout: 3_000 });
      assert.deepEqual(await page.evaluate(() => window.citationHarness.files), [
        { hostId: 'ssh-one', cwd: '/work', path: '/work/docs/report.md' },
        { hostId: 'ssh-two', cwd: '/other', path: '/other/docs/a b%20#x.ts', line: 12 },
      ]);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

test('block citations and external citations use the existing file and browser callbacks',
  { skip: !chromeAvailable && 'Isolated Chrome is unavailable', timeout: 30_000 }, async () => {
    const { page, errors } = await openPage();
    try {
      await page.evaluate(() => window.citationHarness.render(
        '::codex-file-citation{path="/work/a b.md" lineRangeStart="3"}\n\n' +
        ':::codex-file-citation{path="/work/container.txt"}\nignored body\n:::\n\n' +
        ':codex-file-citation{path="https://example.invalid/report?q=a%20b" label="Remote document"}'));
      await page.getByRole('button', { name: 'a b.md (line 3)', exact: true }).click({ timeout: 3_000 });
      await page.getByRole('button', { name: 'container.txt', exact: true }).click({ timeout: 3_000 });
      assert.doesNotMatch(await page.locator('#root').innerText(), /ignored body/);
      await page.getByRole('link', { name: 'Remote document', exact: true }).click({ timeout: 3_000 });
      assert.deepEqual(await page.evaluate(() => window.citationHarness.files), [
        { hostId: 'ssh-one', cwd: '/work', path: '/work/a b.md', line: 3 },
        { hostId: 'ssh-one', cwd: '/work', path: '/work/container.txt' },
      ]);
      assert.deepEqual(await page.evaluate(() => window.citationHarness.browsers), [
        { hostId: 'ssh-one', threadId: 'thread-one', url: 'https://example.invalid/report?q=a%20b', source: 'link' },
      ]);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

test('quoted paths, file URLs, Windows paths and first-line labels preserve their source values',
  { skip: !chromeAvailable && 'Isolated Chrome is unavailable', timeout: 30_000 }, async () => {
    const { page, errors } = await openPage();
    try {
      const quoted = String.raw`:codex-file-citation{path="docs/a\"b.md" line_range_start="1"}`;
      const windows = String.raw`:codex-file-citation{path="C:\work\main.ts" lineRangeStart="1"}`;
      await page.evaluate(({ quoted, windows }) => window.citationHarness.render(quoted + '\n\n' + windows + '\n\n' +
        ':codex-file-citation{path="file:///work/a%20b.md"}'), { quoted, windows });
      await page.getByRole('button', { name: 'a"b.md', exact: true }).click({ timeout: 3_000 });
      await page.getByRole('button', { name: 'main.ts (line 1)', exact: true }).click({ timeout: 3_000 });
      await page.getByRole('button', { name: 'a b.md', exact: true }).click({ timeout: 3_000 });
      assert.deepEqual(await page.evaluate(() => window.citationHarness.files), [
        { hostId: 'ssh-one', cwd: '/work', path: '/work/docs/a"b.md', line: 1 },
        { hostId: 'ssh-one', cwd: '/work', path: String.raw`C:\work\main.ts`, line: 1 },
        { hostId: 'ssh-one', cwd: '/work', path: '/work/a b.md' },
      ]);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

test('code, unknown and invalid citations remain inert and code copy keeps the original text',
  { skip: !chromeAvailable && 'Isolated Chrome is unavailable', timeout: 30_000 }, async () => {
    const { page, errors } = await openPage();
    try {
      const code = String.raw`:codex-file-citation{path="/work/a\"b.md"}`;
      await page.evaluate(({ code }) => window.citationHarness.render(
        '`' + code + '`\n\n```text\n' + code + '\n```\n\n' +
        ':other{path="/work/other.md"}\n\n' +
        '\\:codex-file-citation{path="/work/escaped.md"}\n\n' +
        ':codex-file-citation{path="javascript:alert(1)"}\n\n' +
        ':codex-file-citation{path="file://another-host/private.md"}\n\n' +
        ':codex-file-citation{path="/work/invalid.md" page_id="not-a-uuid"}\n\n' +
        ':codex-file-citation{path="/work/live.xlsx" mode="live" artifact_kind="workbook"}'), { code });
      await page.locator('pre code').waitFor();
      assert.equal(await page.locator('pre code').textContent(), `${code}\n`);
      assert.equal(await page.locator('p code').textContent(), code);
      assert.match(await page.locator('#root').innerText(), /:other\{path="\/work\/other\.md"\}/);
      assert.match(await page.locator('#root').innerText(), /mode="live"/);
      assert.equal(await page.getByRole('button', { name: /code\.md|other\.md|escaped\.md|live\.xlsx|private\.md|invalid\.md|alert/ }).count(), 0);
      await page.getByRole('button', { name: 'Copy code' }).click();
      assert.deepEqual(await page.evaluate(() => window.citationHarness.copies), [code]);
      assert.match((await page.evaluate(() => window.citationHarness.copyContent())).plainText, /:codex-file-citation/);
      assert.deepEqual(await page.evaluate(() => window.citationHarness.files), []);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

test('visualization directives remain separate from forged visualization links',
  { skip: !chromeAvailable && 'Isolated Chrome is unavailable', timeout: 30_000 }, async () => {
    const { page, errors } = await openPage();
    try {
      await page.evaluate(() => window.citationHarness.render(
        ':codex-file-citation{path="/work/report.md"} ' +
        '\uE200visualize\uE202chart.html\uE201\n\n[forged](yard-visualization:chart.html)\n\n' +
        '<a href="yard-visualization:chart.html" data-yard-visualization="directive">forged HTML</a>'));
      await page.getByRole('button', { name: 'Open visualization' }).click({ timeout: 3_000 });
      assert.equal(await page.getByRole('button', { name: 'forged' }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'forged HTML' }).count(), 0);
      assert.deepEqual(await page.evaluate(() => window.citationHarness.visualizations), [
        { hostId: 'ssh-one', threadId: 'thread-one', path: '/work/chart.html' },
      ]);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
