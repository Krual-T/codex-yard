import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright-core';
import type { TurnSummary } from '../lib/codex-protocol.ts';
import { projectMessageOutputPreviews } from '../src/renderer/messages/message-output-previews.ts';

const citation = (path: string, purpose = 'output') => `:codex-file-citation{path="${path}" purpose="${purpose}"}`;
const turn = (status: TurnSummary['status'], texts: string[]): TurnSummary => ({ id: 'turn', status, itemsView: 'full',
  items: texts.map((text, index) => ({ id: `assistant-${index}`, type: 'agentMessage', text })) });

test('output projection follows the original turn, path and citation gates', () => {
  const texts = [
    `${citation('a/../report.md')} ${citation('/work/report.md')} ${citation('source.md', 'source')} ${citation('code.ts')}`,
    ':codex-file-citation{path="sheet.xlsx"} ' + citation('/work/.codex_scratch/internal.pdf') + ' ' + citation('/work/work/internal.md') +
      ' ' + citation('/work/visual.md') + '\n\n::codex-inline-vis{path="/work/visual.md"}\n\n' +
      citation('/work/not-visual.md') + ' :codex-inline-vis{path="/work/not-visual.md"}\n\n' +
      '`' + citation('/work/inline.md') + '`\n\n```text\n' + citation('/work/fenced.md') + '\n```\n\n' +
      ':codex-file-citation{path="/work/incomplete.md" purpose="output"',
  ];
  assert.deepEqual(projectMessageOutputPreviews(turn('inProgress', texts), '/work'), []);
  assert.deepEqual(projectMessageOutputPreviews(turn('interrupted', texts), '/work'), []);
  const expected = [
    { path: '/work/report.md', name: 'report.md', kind: 'document' },
    { path: '/work/sheet.xlsx', name: 'sheet.xlsx', kind: 'spreadsheet' },
    { path: '/work/not-visual.md', name: 'not-visual.md', kind: 'document' },
  ];
  assert.deepEqual(projectMessageOutputPreviews(turn('completed', texts), '/work'), expected);
  assert.deepEqual(projectMessageOutputPreviews(turn('failed', texts), '/work'), expected);
  assert.deepEqual(projectMessageOutputPreviews(turn('completed', [citation('C:\\work\\a.md')]), '/work'), []);
  assert.deepEqual(projectMessageOutputPreviews(turn('completed', [String.raw`:codex-file-citation{path="docs/a\"b.md"} ` +
    citation('file:///work/a%20b.md') + ' ' + citation('https://example.invalid/a.md')]), '/work'), [
    { path: '/work/docs/a"b.md', name: 'a"b.md', kind: 'document' },
    { path: '/work/a b.md', name: 'a b.md', kind: 'document' },
  ]);
});

type Pending = { endpoint: string; params: { hostId: string; paths: string[] }; dispatched: boolean; denied: boolean };
declare global {
  interface Window {
    outputHarness: {
      calls: { pending: Pending[]; opens: unknown[]; forks: string[]; copies: string[] };
      render: (options: { host?: string; threadId?: string; actualThreadId?: string; cwd?: string; status?: string; texts?: string[];
        onOpen?: 'at' | 'plain' | 'throw' | 'none'; authority?: 'sync' | 'thenable'; sourceKey?: string;
        directory?: {status:'none'} | {status:'known';path:string} | {status:'unknown'} }) => void;
      renderBasicHtml: (text: string) => void;
      renderStandaloneMarkdown: (text: string) => void;
      dispatch: (index: number) => boolean;
      resolve: (index: number, paths: unknown) => void;
      reject: (index: number, message: string) => void;
      emit: (type: string, hostId?: string) => void;
      setAuthority: (valid: boolean) => void;
    };
  }
}

const chrome = process.env.YARD_VALIDATION_CHROME_BIN || '/usr/bin/google-chrome';
const hasChrome = existsSync(chrome);
const require = createRequire(import.meta.url);
let browser: Browser, bundle: string;
before(async () => {
  if (!hasChrome) return;
  const built = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {StandaloneMessages} from './src/renderer/messages/StandaloneMessages.tsx';
    import {StandaloneMarkdown} from './src/renderer/markdown/StandaloneMarkdown.tsx';
    const calls = {pending:[], opens:[], forks:[], copies:[]}, deferred = [], listeners = new Set();
    Object.defineProperty(navigator, 'clipboard', {configurable:true,value:{writeText:async text => calls.copies.push(text)}});
    const client = {rpc:async () => {throw Error('unexpected rpc')}, reply:async () => {throw Error('unexpected reply')},
      subscribe:fn => {listeners.add(fn); return () => listeners.delete(fn)},
      host:(endpoint,params,options) => new Promise((resolve,reject) => {
        const info = {endpoint,params,dispatched:false,denied:false}; calls.pending.push(info);
        deferred.push({info, options, resolve, reject});
      })};
    const root = createRoot(document.getElementById('root')); let authorityValid = true;
    window.outputHarness = {calls,
      render(options={}) {
        const {host='ssh-one',threadId='thread-one',actualThreadId=threadId,cwd='/work',status='completed',
          texts=[':codex-file-citation{path="report.md" purpose="output"}'],onOpen='at',authority,sourceKey='one',directory} = options;
        const thread = {id:actualThreadId,cwd,name:null,status:{type:'idle'},turns:[{id:'turn-one',status,itemsView:'full',
          items:texts.map((text,i) => ({id:'assistant-'+i,type:'agentMessage',text}))}]};
        const onOpenFileAt = onOpen === 'none' || onOpen === 'plain' ? undefined : location => {
          if (onOpen === 'throw') throw Error('Original file action rejected'); calls.opens.push(location);
        };
        const outputPreviewAuthority = authority ? {sourceKey, outputDirectory:directory, assertCurrent:() => {
          if (!authorityValid) throw Error('Original page authority revoked');
          if (authority === 'thenable') return Promise.resolve();
        }} : undefined;
        root.render(<StandaloneMessages client={client} hostId={host} threadId={threadId} thread={thread} outputPreviewAuthority={outputPreviewAuthority}
          onOpenFileAt={onOpenFileAt} onOpenFile={onOpen === 'plain' ? path => calls.opens.push(path) : undefined}
          onFork={id => calls.forks.push(id)} />);
      },
      renderBasicHtml(text) {
        root.render(<StandaloneMarkdown text={text} client={client} hostId="ssh-one" cwd="/work" allowBasicHtml
          onOpenFileAt={location => calls.opens.push(location)} />);
      },
      renderStandaloneMarkdown(text) {
        root.render(<StandaloneMarkdown text={text} client={client} hostId="ssh-one" cwd="/work"
          onOpenFileAt={location => calls.opens.push(location)} />);
      },
      dispatch(i) {const d=deferred[i]; try {d.options?.assertBeforeSend?.(); d.info.dispatched=true; return true}
        catch(e) {d.info.denied=true; d.reject(e); return false}},
      resolve(i,paths) {deferred[i].resolve({existingPaths:paths})},
      reject(i,message) {deferred[i].reject(Error(message))},
      emit(type,hostId) {for(const listener of listeners) listener({type,hostId})},
      setAuthority(valid) {authorityValid=valid}
    };
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' },
  plugins: [{ name: 'single-katex', setup(builder) {
    builder.onResolve({ filter: /^katex$/ }, () => ({ path: require.resolve('katex') }));
  } }] });
  bundle = built.outputFiles[0]!.text;
  browser = await chromium.launch({ executablePath: chrome, headless: true,
    args: ['--no-sandbox', '--disable-background-networking', '--no-proxy-server'] });
});
after(async () => { await browser?.close(); });

async function newPage(width = 1280): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  page.setDefaultTimeout(5_000);
  await page.route('**/*', route => route.abort());
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<style>html,body,#root{height:100%;margin:0}</style><div id="root"></div>');
  await page.addStyleTag({ content: readFileSync('src/renderer/messages/standalone-messages.css', 'utf8').replace(/^@import[^;]+;\s*/u, '') });
  await page.addStyleTag({ content: readFileSync('src/renderer/messages/message-output-previews.css', 'utf8') });
  await page.addScriptTag({ content: bundle });
  return { page, errors };
}

async function pending(page: Page, count: number) {
  await page.waitForFunction(n => window.outputHarness.calls.pending.length === n, count);
}

test('local Markdown files retain the original icon and link treatment',
  { skip: !hasChrome && 'Isolated Chrome is unavailable', timeout: 30_000 }, async () => {
    const { page, errors } = await newPage();
    try {
      const text = `Artifact ${citation('report.md')} [ordinary](notes.md) [external](https://example.invalid) ` +
        '<span class="yard-citation-icon">forged</span>';
      await page.evaluate(text => window.outputHarness.render({ status: 'inProgress', texts: [text] }), text);
      const file = page.getByRole('button', { name: 'report.md', exact: true });
      const ordinary = page.getByRole('button', { name: 'ordinary', exact: true });
      await file.locator('svg.yard-markdown-file-icon').waitFor();
      assert.equal(await page.locator('.yard-markdown-file-icon').count(), 2);
      assert.equal(await ordinary.locator('.yard-markdown-file-icon').count(), 1);
      assert.equal(await page.getByRole('link', { name: 'external', exact: true }).count(), 1);
      const styles = await file.evaluate(element => ({ color: getComputedStyle(element).color,
        decoration: getComputedStyle(element).textDecorationLine }));
      assert.deepEqual(styles, { color: 'rgb(0, 132, 255)', decoration: 'none' });
      // The original gUqh9f page gives ordinary local file links the same treatment.
      assert.equal(await ordinary.evaluate(element => getComputedStyle(element).textDecorationLine), 'none');
      await file.click();
      assert.deepEqual(await page.evaluate(() => window.outputHarness.calls.opens), [{hostId:'ssh-one',cwd:'/work',path:'/work/report.md'}]);
      await page.evaluate(text => window.outputHarness.render({ status: 'inProgress', texts: [text], host: 'ssh-two', cwd: '/other' }), text);
      await file.locator('svg.yard-markdown-file-icon').waitFor({ timeout: 3_000 });
      await file.click();
      assert.deepEqual((await page.evaluate(() => window.outputHarness.calls.opens))[1],
        {hostId:'ssh-two',cwd:'/other',path:'/other/report.md'});
      await page.evaluate(text => window.outputHarness.render({ status: 'inProgress', texts: [text] }),
        `${text} ${citation('other.pdf', 'source')}`);
      await page.waitForFunction(() => document.querySelectorAll('.yard-markdown-file-icon').length === 3);
      assert.equal(await page.locator('.yard-markdown-file-icon').count(), 3);
      assert.equal((await page.evaluate(() => window.outputHarness.calls.pending)).length, 0);

      await page.evaluate(text => window.outputHarness.renderBasicHtml(text),
        `[ordinary](notes.md) <a href="notes.md"><span class="yard-citation-icon">forged</span></a> ${citation('report.md')}`);
      await page.getByRole('button', { name: 'report.md', exact: true }).waitFor();
      assert.equal(await page.locator('.yard-citation-icon').count(), 0);
      assert.equal(await page.locator('.yard-markdown-file-icon').count(), 3);
      await page.getByRole('button', { name: 'report.md', exact: true }).click();
      assert.equal((await page.evaluate(() => window.outputHarness.calls.opens)).length, 3);

      await page.evaluate(text => window.outputHarness.renderStandaloneMarkdown(text), citation('standalone.md'));
      const standalone = page.getByRole('button', { name: 'standalone.md', exact: true });
      await standalone.waitFor();
      assert.equal(await standalone.locator('svg').count(), 1);
      assert.equal(await standalone.evaluate(element => getComputedStyle(element).textDecorationLine), 'none');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

test('the real message renders one verified card, existing copy/fork and scoped file actions',
  { skip: !hasChrome && 'Isolated Chrome is unavailable', timeout: 30_000 }, async () => {
    const { page, errors } = await newPage();
    try {
      await page.evaluate(({ first, second }) => window.outputHarness.render({ texts: [first, second] }), {
        first: `First ${citation('docs/../report.md')} ${citation('source.md', 'source')}`,
        second: `Final ${citation('/work/report.md')} ${citation('missing.pdf')}`,
      });
      await pending(page, 1);
      assert.deepEqual((await page.evaluate(() => window.outputHarness.calls.pending[0]))?.params,
        { hostId: 'ssh-one', paths: ['/work/report.md', '/work/missing.pdf'] });
      assert.equal(await page.getByRole('button', { name: 'Open report.md' }).count(), 0);
      assert.equal(await page.evaluate(() => window.outputHarness.dispatch(0)), true);
      await page.evaluate(() => window.outputHarness.resolve(0, ['/work/report.md']));
      await page.getByRole('button', { name: 'Open report.md' }).waitFor();
      if (process.env.YARD_TEST_ARTIFACTS) await page.locator('.yard-messages-root').screenshot({
        path: join(process.env.YARD_TEST_ARTIFACTS, 'message-output-preview.png'),
      });
      await page.getByRole('button', { name: 'Open report.md' }).click();
      assert.equal(await page.getByRole('button', { name: 'Open missing.pdf' }).count(), 0);
      assert.deepEqual(await page.evaluate(() => window.outputHarness.calls.opens), [{ hostId: 'ssh-one', cwd: '/work', path: '/work/report.md' }]);
      const last = page.locator('[data-message-id="assistant-1"]');
      assert.match(await last.innerText(), /report\.md[\s\S]*Document/);
      await last.getByRole('button', { name: 'Open in' }).click();
      assert.match(await last.getByRole('menu', { name: 'Open in' }).innerText(), /External app discovery is unavailable/);
      assert.equal(await last.getByRole('menuitem', { name: 'Open preview' }).count(), 0);
      await page.keyboard.press('Escape');
      assert.equal(await last.getByRole('button', { name: 'Open in' }).evaluate(element => document.activeElement === element), true);
      assert.equal((await page.evaluate(() => window.outputHarness.calls.opens)).length, 1);
      await last.getByRole('button', { name: 'Copy', exact: true }).click();
      assert.deepEqual(await page.evaluate(() => window.outputHarness.calls.copies), [`Final ${citation('/work/report.md')} ${citation('missing.pdf')}`]);
      await last.getByRole('button', { name: 'More actions' }).click();
      const fork = last.getByRole('menuitem', { name: 'Fork chat from here' });
      assert.equal(await fork.innerText(), 'Branch in new chat');
      await fork.click();
      assert.deepEqual(await page.evaluate(() => window.outputHarness.calls.forks), ['turn-one']);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

test('failed existence read retains candidates and retries without guessing missing files',
  { skip: !hasChrome && 'Isolated Chrome is unavailable', timeout: 30_000 }, async () => {
    const { page, errors } = await newPage();
    try {
      await page.evaluate(text => window.outputHarness.render({ texts: [text], onOpen: 'plain' }), citation('report.md'));
      await pending(page, 1);
      await page.evaluate(() => { window.outputHarness.dispatch(0); window.outputHarness.reject(0, 'peer unavailable'); });
      await page.getByRole('alert').filter({ hasText: 'peer unavailable' }).waitFor();
      await page.getByRole('button', { name: 'Open report.md' }).click();
      assert.deepEqual(await page.evaluate(() => window.outputHarness.calls.opens), ['/work/report.md']);
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await pending(page, 2);
      assert.equal(await page.getByRole('button', { name: 'Open report.md' }).count(), 0);
      await page.evaluate(() => { window.outputHarness.dispatch(1); window.outputHarness.resolve(1, []); });
      await page.waitForFunction(() => !document.querySelector('.yard-output-error'));
      assert.equal(await page.getByRole('button', { name: 'Open report.md' }).count(), 0);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

test('late responses and delayed dispatch cannot cross the original thread, host or connection',
  { skip: !hasChrome && 'Isolated Chrome is unavailable', timeout: 30_000 }, async () => {
    const { page, errors } = await newPage();
    try {
      await page.evaluate(() => window.outputHarness.render({}));
      await pending(page, 1);
      await page.evaluate(() => window.outputHarness.render({host:'ssh-two',threadId:'thread-two',cwd:'/other'}));
      await pending(page, 2);
      assert.equal(await page.evaluate(() => window.outputHarness.dispatch(0)), false);
      assert.equal(await page.evaluate(() => window.outputHarness.dispatch(1)), true);
      await page.evaluate(() => window.outputHarness.emit('codex-app-server-connection-changed', 'ssh-two'));
      await pending(page, 3);
      await page.evaluate(() => window.outputHarness.resolve(1, ['/other/report.md']));
      assert.equal(await page.getByRole('button', { name: 'Open report.md' }).count(), 0);
      assert.equal(await page.evaluate(() => window.outputHarness.dispatch(2)), true);
      await page.evaluate(() => window.outputHarness.resolve(2, ['/other/report.md']));
      await page.getByRole('button', { name: 'Open report.md' }).click();
      assert.deepEqual(await page.evaluate(() => window.outputHarness.calls.opens), [{ hostId: 'ssh-two', cwd: '/other', path: '/other/report.md' }]);
      await page.evaluate(() => window.outputHarness.render({host:'ssh-two',threadId:'thread-three',actualThreadId:'thread-two',cwd:'/other'}));
      await page.waitForFunction(() => !document.querySelector('.yard-output-card'));
      assert.equal((await page.evaluate(() => window.outputHarness.calls.pending)).length, 3);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

test('the captured parent authority fences dispatch and file actions before a React scope change',
  { skip: !hasChrome && 'Isolated Chrome is unavailable', timeout: 30_000 }, async () => {
    const { page, errors } = await newPage();
    try {
      await page.evaluate(() => window.outputHarness.render({authority:'sync'}));
      await pending(page, 1);
      await page.evaluate(() => window.outputHarness.setAuthority(false));
      assert.equal(await page.evaluate(() => window.outputHarness.dispatch(0)), false);
      assert.equal(await page.getByRole('button', {name:'Open report.md'}).count(), 0);
      await page.evaluate(() => { window.outputHarness.setAuthority(true); window.outputHarness.render({authority:'sync',sourceKey:'two'}); });
      await pending(page, 2);
      await page.evaluate(() => { window.outputHarness.dispatch(1); window.outputHarness.resolve(1, ['/work/report.md']); });
      await page.getByRole('button', {name:'Open report.md'}).waitFor();
      await page.evaluate(() => window.outputHarness.setAuthority(false));
      await page.getByRole('button', {name:'Open report.md'}).click();
      await page.getByRole('alert').filter({hasText:'Original page authority revoked'}).waitFor();
      assert.deepEqual(await page.evaluate(() => window.outputHarness.calls.opens), []);
      await page.evaluate(() => { window.outputHarness.setAuthority(true); window.outputHarness.render({authority:'sync',sourceKey:'three'}); });
      await pending(page, 3);
      await page.evaluate(() => { window.outputHarness.dispatch(2); window.outputHarness.setAuthority(false);
        window.outputHarness.resolve(2, ['/work/report.md']); });
      await page.waitForFunction(() => !document.querySelector('.yard-output-card'));
      await page.evaluate(() => { window.outputHarness.setAuthority(true); window.outputHarness.render({authority:'thenable',sourceKey:'four'}); });
      await page.waitForFunction(() => !document.querySelector('.yard-output-card'));
      assert.equal((await page.evaluate(() => window.outputHarness.calls.pending)).length, 3);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

test('the parent projectless directory fact limits output without treating unknown as none',
  { skip: !hasChrome && 'Isolated Chrome is unavailable', timeout: 30_000 }, async () => {
    const { page, errors } = await newPage();
    try {
      const texts = [citation('/work/out/report.md') + ' ' + citation('/work/elsewhere.md')];
      await page.evaluate(texts => window.outputHarness.render({texts, authority:'sync', directory:{status:'unknown'}}), texts);
      await page.getByRole('status').filter({hasText:'Could not verify the output directory'}).waitFor();
      assert.equal((await page.evaluate(() => window.outputHarness.calls.pending)).length, 0);
      await page.evaluate(texts => window.outputHarness.render({texts, authority:'sync', sourceKey:'invalid',
        directory:{status:'known',path:''}}), texts);
      await page.getByRole('status').filter({hasText:'Could not verify the output directory'}).waitFor();
      assert.equal((await page.evaluate(() => window.outputHarness.calls.pending)).length, 0);
      await page.evaluate(texts => window.outputHarness.render({texts, authority:'sync', sourceKey:'known',
        directory:{status:'known',path:'out'}}), texts);
      await pending(page, 1);
      assert.deepEqual((await page.evaluate(() => window.outputHarness.calls.pending[0]))?.params.paths, ['/work/out/report.md']);
      await page.evaluate(() => { window.outputHarness.dispatch(0); window.outputHarness.resolve(0, ['/work/out/report.md']); });
      await page.getByRole('button', {name:'Open report.md'}).click();
      assert.deepEqual(await page.evaluate(() => window.outputHarness.calls.opens), [{hostId:'ssh-one', cwd:'/work', path:'/work/out/report.md'}]);
      await page.evaluate(texts => window.outputHarness.render({texts, authority:'sync', sourceKey:'unrestricted', directory:{status:'none'}}), texts);
      await pending(page, 2);
      assert.equal(await page.evaluate(() => window.outputHarness.dispatch(1)), true);
      await page.evaluate(texts => window.outputHarness.render({texts, authority:'sync', sourceKey:'unknown-again', directory:{status:'unknown'}}), texts);
      await page.getByRole('status').filter({hasText:'Could not verify the output directory'}).waitFor();
      await page.evaluate(() => window.outputHarness.resolve(1, ['/work/out/report.md', '/work/elsewhere.md']));
      assert.equal(await page.getByRole('button', {name:'Open elsewhere.md'}).count(), 0);
      assert.equal(await page.getByRole('button', {name:'Open report.md'}).count(), 0);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

test('streaming, malformed responses, action failures and narrow layout retain real state',
  { skip: !hasChrome && 'Isolated Chrome is unavailable', timeout: 30_000 }, async () => {
    const { page, errors } = await newPage(390);
    try {
      await page.evaluate(() => window.outputHarness.render({ status:'inProgress' }));
      await page.waitForSelector('[data-message-id="assistant-0"]');
      assert.equal((await page.evaluate(() => window.outputHarness.calls.pending)).length, 0);
      await page.evaluate(() => window.outputHarness.render({ status:'failed', onOpen:'throw',
        texts:[':codex-file-citation{path="a-very-long-output-document-name-for-a-narrow-window.md" purpose="output"}'] }));
      await pending(page, 1);
      await page.evaluate(() => { window.outputHarness.dispatch(0); window.outputHarness.resolve(0, ['/wrong/path']); });
      await page.getByRole('alert').filter({hasText:'Invalid paths-exist response'}).waitFor();
      const card = page.locator('.yard-output-card');
      await card.getByRole('button', {name:/Open a-very-long/}).click();
      await page.getByRole('alert').filter({hasText:'Original file action rejected'}).waitFor();
      const boxes = await card.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const trigger = element.querySelector('.yard-output-menu-trigger')!.getBoundingClientRect();
        return {width:bounds.width, viewport:innerWidth, right:trigger.right, left:trigger.left};
      });
      assert.ok(boxes.width <= boxes.viewport && boxes.right <= boxes.viewport && boxes.left >= 0);
      await card.getByRole('button', {name:'Open in'}).click();
      await page.keyboard.press('Escape');
      assert.equal(await card.getByRole('menu').count(), 0);
      assert.equal(await card.getByRole('button', {name:'Open in'}).evaluate(element => element === document.activeElement), true);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
