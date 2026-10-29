import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright-core';
import type { ThreadSummary, TurnSummary } from '../lib/codex-protocol.ts';
import { projectMessageOutputPreviews, projectMessageTurnPreviews } from '../src/renderer/messages/message-output-previews.ts';

const citation = (path: string, purpose = 'output') => `:codex-file-citation{path="${path}" purpose="${purpose}"}`;
const liveCitation = (path: string, kind = 'workbook', attrs = '') =>
  `:codex-file-citation{path="${path}" mode="live" artifact_kind="${kind}" ${attrs}}`;
const turn = (status: TurnSummary['status'], texts: string[]): TurnSummary => ({ id: 'turn', status, itemsView: 'full',
  items: texts.map((text, index) => ({ id: `assistant-${index}`, type: 'agentMessage', text })) });
const thread = (value: TurnSummary): ThreadSummary => ({ id:'thread', cwd:'/work', name:null, status:{type:'idle'}, turns:[value] });
const project = (value: TurnSummary, directory?: {status:'none'} | {status:'known';path:string} | {status:'unknown'}) =>
  projectMessageTurnPreviews('host', thread(value), value, directory);

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

test('website eligibility uses the final assistant, original local URL rules, and distinct target count', () => {
  const site = (text: string) => project(turn('completed', [text])).website;
  const expected = {kind:'website',target:{type:'url',url:'http://localhost:19876/path'}};
  assert.deepEqual(site('http://localhost:19876/path, http://LOCALHOST:19876/path.'), expected);
  assert.deepEqual(site('https://demo.localhost:19876/'),
    {kind:'website',target:{type:'url',url:'https://demo.localhost:19876/'}});
  assert.deepEqual(site('http://[::1]:19876/'), {kind:'website',target:{type:'url',url:'http://[::1]:19876/'}});
  assert.deepEqual(site('`http://localhost:19876/path`'), expected);
  for (const text of ['https://example.com:19876/', 'http://localhost/', 'http://localhost:80/',
    'http://localhost:19876/a(b', 'http://name:pass@localhost:19876/',
    'http://localhost:19876/ http://127.0.0.1:19876/']) assert.equal(site(text), null, text);
  assert.equal(project(turn('completed', ['http://localhost:19876/', 'The final message has no website.'])).website, null);
  assert.equal(project(turn('inProgress', ['http://localhost:19876/'])).website, null);
  assert.equal(project(turn('interrupted', ['http://localhost:19876/'])).website, null);
  assert.ok(project(turn('failed', ['http://localhost:19876/'])).website);
  const partial = project({...turn('completed', ['http://localhost:19876/']), itemsView:'summary'});
  assert.equal(partial.website, null);
  assert.equal(partial.incomplete, true);
});

test('website priority respects output files, markdown files, edited HTML and unknown resource facts', () => {
  const url = 'http://localhost:19876/';
  const original = turn('completed', [url]);
  const html: TurnSummary = {...original, items:[{id:'edit', type:'fileChange', status:'completed',
    changes:[{path:'site/index.html', kind:{type:'add'}}]}, ...original.items]};
  assert.deepEqual(project(html).website, {kind:'website',target:{type:'url',url}});
  const htmlOnly = {...html, items:[html.items[0]!, {id:'last',type:'agentMessage',text:'Done.'}]};
  assert.deepEqual(project(htmlOnly).website, {kind:'website',target:{type:'file',path:'/work/site/index.html'}});
  assert.equal(project(htmlOnly, {status:'known',path:'/elsewhere'}).website, null);
  assert.equal(project(htmlOnly, {status:'unknown'}).unavailable, true);
  const twoHtml = {...htmlOnly, items:[{...html.items[0]!,changes:[{path:'site/a.html',kind:{type:'add'}},
    {path:'site/b.html',kind:{type:'add'}}]}, htmlOnly.items[1]!]};
  assert.equal(project(twoHtml).website, null);
  const removedHtml = {...htmlOnly, items:[{...html.items[0]!,changes:[{path:'site/index.html',kind:{type:'delete'}}]}, htmlOnly.items[1]!]};
  assert.deepEqual(project(removedHtml).website, {kind:'website',target:{type:'file',path:'/work/site/index.html'}});
  const file = project(turn('completed', [`${citation('report.md')} ${url}`]));
  assert.equal(file.website, null);
  assert.equal(file.entries[0]?.path, '/work/report.md');
  const linked = project(turn('completed', [`[Report](report.pdf) ${url}`]));
  assert.equal(linked.website, null);
  assert.equal(linked.entries[0]?.path, '/work/report.pdf');
  const appgen = {...original, items:[{id:'app',type:'mcpToolCall',server:'codex_apps',tool:'sites.create',status:'completed'}, ...original.items]};
  assert.equal(project(appgen).website, null);
  assert.equal(project(appgen).resourceUncertain, true);
});

test('Google output follows original markdown, citation, read/write and deduplication gates', () => {
  const doc = 'https://docs.google.com/document/d/yard-fixture/edit';
  const sheet = 'https://docs.google.com/spreadsheets/d/another/edit';
  const link = `[spec](${doc})`;
  assert.deepEqual(project(turn('completed', [link, link])).google,
    [{kind:'google-drive',resourceKind:'document',url:doc,title:'spec'}]);
  assert.equal(project(turn('inProgress', [link])).google.length, 0);
  const partialGoogle = project({...turn('completed', [link]),itemsView:'summary'});
  assert.equal(partialGoogle.google.length, 0);
  assert.equal(partialGoogle.incomplete, true);
  for (const text of [doc, `<${doc}>`, '```\n' + link + '\n```', `[Other](https://example.invalid/file)`]) {
    assert.deepEqual(project(turn('completed', [text])).google, [], text);
  }
  assert.equal(project(turn('completed', ['`' + link + '`'])).google[0]?.title, 'spec');
  assert.equal(project(turn('completed', [`${link} [again](${doc.replace('/edit','/view')})`])).google.length, 1);
  assert.equal(project(turn('completed', [`${citation('source.md', 'source')} ${link}`])).google.length, 0);
  assert.equal(project(turn('completed', [`:codex-file-citation{path="${doc}" purpose="output" label="Original"} ${link}`])).google[0]?.title, 'Original');
  assert.equal(project(turn('completed', [`[external_agent_tool_call] ${link}`])).google.length, 0);
  const incompleteFinal = turn('completed', [link]);
  assert.equal(project({...incompleteFinal,items:[...incompleteFinal.items,{id:'last',type:'agentMessage'}]}).google.length, 0);
  const mixed = project(turn('completed', [`${citation('report.md')} ${link} http://localhost:19876/`]));
  assert.equal(mixed.entries.length, 1);
  assert.equal(mixed.google.length, 0);
  assert.equal(mixed.website, null);
  const linkedFile = project(turn('completed', [`[report](report.pdf) ${link} http://localhost:19876/`]));
  assert.equal(linkedFile.entries.length, 1);
  assert.equal(linkedFile.google.length, 1);
  assert.equal(linkedFile.website, null);
  const googleAndWebsite = project(turn('completed', [`${link} http://localhost:19876/`]));
  assert.equal(googleAndWebsite.google.length, 1);
  assert.ok(googleAndWebsite.website);
  const read = {id:'read',type:'mcpToolCall',server:'google-drive',tool:'get_document',status:'completed',
    result:{structuredContent:{documentUrl:doc,title:'Read title'}}};
  const written = {id:'write',type:'mcpToolCall',server:'google-drive',tool:'batch_update_spreadsheet',status:'completed',
    result:{structuredContent:{spreadsheetUrl:sheet,title:'Saved sheet'}}};
  const value = turn('completed', [`${link} [sheet](${sheet})`]);
  assert.equal(project({...value,items:[read,...value.items]}).google.length, 0);
  assert.deepEqual(project({...value,items:[read,written,...value.items]}).google,
    [{kind:'google-drive',resourceKind:'spreadsheet',url:sheet,title:'Saved sheet'}]);
  assert.deepEqual(project({...value,items:[read,{...written,tool:'get_document',result:{structuredContent:{documentUrl:sheet}}},
    {...written,tool:'unrecognized'},...value.items]}).google, []);
});

test('live artifact projection follows final output citation, page and deduplication gates', () => {
  const first = liveCitation('  ref-sheet  ', 'workbook', 'label=" Quarterly "');
  const slide = liveCitation('ref-slide', 'presentation', 'title="Outline"');
  const page = '12345678-1234-1234-1234-123456789abc';
  const pageFirst = liveCitation('ref-page-a', 'presentation', `page_id=" ${page} "`);
  const text = [first, liveCitation('ref-sheet', 'presentation', 'label="Duplicate"'), slide,
    pageFirst, liveCitation('ref-page-b', 'workbook', `page_id="${page}"`),
    liveCitation('artifact_external_remote'), liveCitation('fallback-slide', 'presentation'),
    liveCitation('source', 'workbook', 'purpose="source"'), liveCitation('other', 'workbook', 'purpose="other"'),
    liveCitation('https://example.invalid/x'), liveCitation('bad-kind', 'document'),
    liveCitation('bad-page', 'workbook', 'page_id="invalid"'), liveCitation('', 'workbook'),
    '`' + liveCitation('inline') + '`', '```\n' + liveCitation('fenced') + '\n```',
    ':codex-file-citation{path="unfinished" mode="live" artifact_kind="workbook"',
    String.raw`:codex-file-citation{path="ref\"quoted" mode="live" artifact_kind="workbook" label="Name\"quoted"}`].join('\n\n');
  const expected = [
    {kind:'artifact-session',resourceKind:'spreadsheet',artifactRef:'ref-sheet',title:'Quarterly'},
    {kind:'artifact-session',resourceKind:'presentation',artifactRef:'ref-slide',title:'Outline'},
    {kind:'artifact-session',resourceKind:'presentation',artifactRef:'ref-page-a',title:'Slide',pageId:page},
    {kind:'artifact-session',resourceKind:'spreadsheet',artifactRef:'artifact_external_remote',title:'Sheet'},
    {kind:'artifact-session',resourceKind:'presentation',artifactRef:'fallback-slide',title:'Slide'},
    {kind:'artifact-session',resourceKind:'spreadsheet',artifactRef:'ref"quoted',title:'Name"quoted'},
  ];
  assert.deepEqual(project(turn('completed', [text])).artifacts, expected);
  assert.deepEqual(project(turn('failed', [text])).artifacts, expected);
  assert.deepEqual(project(turn('inProgress', [text])).artifacts, []);
  assert.deepEqual(project(turn('interrupted', [text])).artifacts, []);
  assert.deepEqual(project(turn('completed', [first, 'Final assistant has no output.'])).artifacts, []);
  assert.deepEqual(project(turn('completed', [`[external_agent_tool_call] ${first}`])).artifacts, []);
  const partial = project({...turn('completed', [first]), itemsView:'summary'});
  assert.deepEqual(partial.artifacts, []);
  assert.equal(partial.incomplete, true);
});

test('live artifact output coexists with file and Google resources and suppresses website fallback', () => {
  const live = liveCitation('ref-sheet', 'workbook', 'label="Sheet title"');
  const google = ':codex-file-citation{path="https://docs.google.com/document/d/yard-fixture/edit" label="Doc"}';
  const value = turn('completed', [`${citation('report.pdf')} ${google} ${live} http://localhost:19876/`]);
  const projection = project(value, {status:'known',path:'/other'});
  assert.equal(projection.entries.length, 0);
  assert.equal(projection.google.length, 1);
  assert.equal(projection.artifacts[0]?.title, 'Sheet title');
  assert.equal(projection.website, null);
  const withFile = project(value);
  assert.equal(withFile.entries[0]?.path, '/work/report.pdf');
  assert.equal(withFile.google.length, 1);
  assert.equal(withFile.artifacts.length, 1);
  assert.equal(withFile.website, null);
});

type Pending = { endpoint: string; params: { hostId: string; paths?: string[]; path?: string }; dispatched: boolean; denied: boolean };
declare global {
  interface Window {
    outputHarness: {
      calls: { pending: Pending[]; opens: unknown[]; browsers: unknown[]; artifacts: unknown[]; forks: string[]; copies: string[] };
      render: (options: { host?: string; threadId?: string; actualThreadId?: string; cwd?: string; status?: string; texts?: string[];
        onOpen?: 'at' | 'plain' | 'throw' | 'none'; authority?: 'sync' | 'thenable'; sourceKey?: string;
        onBrowser?: 'normal' | 'throw' | 'none'; items?: Record<string, unknown>[]; itemsView?: string;
        onArtifact?: 'normal' | 'throw' | 'none'; canOpenArtifactPage?: boolean; isSharedConversation?: boolean;
        directory?: {status:'none'} | {status:'known';path:string} | {status:'unknown'} }) => void;
      renderBasicHtml: (text: string) => void;
      renderStandaloneMarkdown: (text: string) => void;
      dispatch: (index: number) => boolean;
      resolve: (index: number, paths: unknown) => void;
      resolveRead: (index: number, contents: string) => void;
      reject: (index: number, message: string) => void;
      emit: (type: string, hostId?: string) => void;
      setAuthority: (valid: boolean) => void;
      checkFile: (index: number) => string;
      checkArtifact: (index: number) => string;
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
    const calls = {pending:[], opens:[], browsers:[], artifacts:[], forks:[], copies:[]}, fileChecks = [], artifactChecks = [], deferred = [], listeners = new Set();
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
          texts=[':codex-file-citation{path="report.md" purpose="output"}'],onOpen='at',onBrowser='normal',authority,sourceKey='one',directory,
          items,itemsView='full',onArtifact='normal',canOpenArtifactPage,isSharedConversation} = options;
        const thread = {id:actualThreadId,cwd,name:null,status:{type:'idle'},turns:[{id:'turn-one',status,itemsView,
          items:items ?? texts.map((text,i) => ({id:'assistant-'+i,type:'agentMessage',text}))}]};
        const onOpenFileAt = onOpen === 'none' || onOpen === 'plain' ? undefined : location => {
          if (onOpen === 'throw') throw Error('Original file action rejected');
          const {assertCurrent, ...target} = location; fileChecks.push(assertCurrent); calls.opens.push(target);
        };
        const onOpenBrowser = onBrowser === 'none' ? undefined : target => {
          if (onBrowser === 'throw') throw Error('Original browser action rejected'); calls.browsers.push(target);
        };
        const onOpenArtifactSession = onArtifact === 'none' ? undefined : location => {
          if (onArtifact === 'throw') throw Error('Original artifact action rejected');
          const {assertCurrent, ...target} = location; artifactChecks.push(assertCurrent); calls.artifacts.push(target);
        };
        const outputPreviewAuthority = authority ? {sourceKey, outputDirectory:directory, canOpenArtifactPage, isSharedConversation, assertCurrent:() => {
          if (!authorityValid) throw Error('Original page authority revoked');
          if (authority === 'thenable') return Promise.resolve();
        }} : undefined;
        root.render(<StandaloneMessages client={client} hostId={host} threadId={threadId} thread={thread} outputPreviewAuthority={outputPreviewAuthority}
          onOpenFileAt={onOpenFileAt} onOpenFile={onOpen === 'plain' ? path => calls.opens.push(path) : undefined}
          onOpenBrowser={onOpenBrowser} onOpenArtifactSession={onOpenArtifactSession} onFork={id => calls.forks.push(id)} />);
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
      resolveRead(i,contents) {deferred[i].resolve({contents})},
      reject(i,message) {deferred[i].reject(Error(message))},
      emit(type,hostId) {for(const listener of listeners) listener({type,hostId})},
      setAuthority(valid) {authorityValid=valid},
      checkFile(index) {try {if (typeof fileChecks[index] !== 'function') return 'missing'; fileChecks[index](); return 'current';}
        catch(error) {return error.message}},
      checkArtifact(index) {try {if (typeof artifactChecks[index] !== 'function') return 'missing'; artifactChecks[index](); return 'current';}
        catch(error) {return error.message}}
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

test('inline live citations capture the original message and connection authority',
  { skip: !hasChrome && 'Isolated Chrome is unavailable', timeout: 30_000 }, async () => {
    const { page, errors } = await newPage(390);
    try {
      const sheet = liveCitation('sheet-ref', 'workbook', 'purpose="source" label="Sheet source"');
      const slide = liveCitation('slide-ref', 'presentation', 'label="Slide output"');
      const text = `${sheet} ${slide}`;
      await page.evaluate(text => window.outputHarness.render({host:'local',authority:'sync',texts:[text]}), text);
      const body = page.locator('.yard-assistant-message > .yard-markdown');
      const sheetButton = body.getByRole('button', {name:'Sheet source'});
      const slideButton = body.getByRole('button', {name:'Slide output'});
      await sheetButton.click();
      await slideButton.click();
      assert.deepEqual(await page.evaluate(() => window.outputHarness.calls.artifacts), [
        {hostId:'local',threadId:'thread-one',artifactRef:'sheet-ref',kind:'spreadsheet',title:'Sheet source'},
        {hostId:'local',threadId:'thread-one',artifactRef:'slide-ref',kind:'presentation',title:'Slide output'},
      ]);
      assert.equal(await sheetButton.locator('svg').evaluate(element => getComputedStyle(element).color), 'rgb(0, 163, 71)');
      assert.equal(await slideButton.locator('svg').evaluate(element => getComputedStyle(element).color), 'rgb(240, 92, 47)');
      assert.equal(await page.evaluate(() => window.outputHarness.checkArtifact(0)), 'current');
      await page.evaluate(text => window.outputHarness.render({host:'local',authority:'sync',texts:[text + ' changed']}), text);
      await body.getByText('changed').waitFor();
      assert.equal(await page.evaluate(() => window.outputHarness.checkArtifact(0)), 'The original message source changed.');
      await sheetButton.click();
      await page.evaluate(() => window.outputHarness.emit('codex-app-server-connection-changed', 'local'));
      assert.equal(await page.evaluate(() => window.outputHarness.checkArtifact(2)), 'The original message source changed.');
      await page.getByRole('button', {name:'Copy',exact:true}).click();
      assert.deepEqual(await page.evaluate(() => window.outputHarness.calls.copies), [`${text} changed`]);
      await page.evaluate(text => window.outputHarness.render({host:'local',threadId:'next-thread',actualThreadId:'thread-one',texts:[text]}), text);
      await sheetButton.click();
      await page.getByRole('alert').filter({hasText:'The original message source changed.'}).waitFor();
      assert.equal((await page.evaluate(() => window.outputHarness.calls.artifacts)).length, 3);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

test('live artifact rows render original titles and dispatch the scoped parent action',
  { skip: !hasChrome && 'Isolated Chrome is unavailable', timeout: 30_000 }, async () => {
    const { page, errors } = await newPage(390);
    try {
      const text = `${liveCitation('yard_fixture_artifact', 'workbook', 'label="Fixture sheet"')} ` +
        `${liveCitation('yard_fixture_slide', 'presentation', 'label="Fixture slide"')} http://localhost:19876/`;
      await page.evaluate(text => window.outputHarness.render({host:'local',authority:'sync',texts:[text]}), text);
      const rows = page.locator('.yard-output-card--artifact');
      await rows.nth(1).getByRole('button', {name:'Open Fixture slide'}).waitFor();
      assert.equal(await rows.count(), 2);
      assert.match(await rows.nth(0).innerText(), /Fixture sheet\s+Sheet/);
      assert.match(await rows.nth(1).innerText(), /Fixture slide\s+Slide/);
      assert.equal(await page.getByRole('button', {name:'Open Web preview'}).count(), 0);
      assert.equal(await page.locator('.yard-output-card--artifact .yard-output-menu').count(), 0);
      await rows.nth(0).getByRole('button', {name:'Open Fixture sheet'}).click();
      await rows.nth(1).getByRole('button', {name:'Open Fixture slide'}).click();
      assert.deepEqual(await page.evaluate(() => window.outputHarness.calls.artifacts), [
        {hostId:'local',threadId:'thread-one',artifactRef:'yard_fixture_artifact',kind:'spreadsheet',title:'Fixture sheet'},
        {hostId:'local',threadId:'thread-one',artifactRef:'yard_fixture_slide',kind:'presentation',title:'Fixture slide'},
      ]);
      assert.equal(await page.evaluate(() => window.outputHarness.checkArtifact(0)), 'current');
      assert.deepEqual(await page.evaluate(() => [window.outputHarness.calls.pending, window.outputHarness.calls.opens,
        window.outputHarness.calls.browsers]), [[], [], []]);
      await page.evaluate(() => {
        document.documentElement.style.setProperty('--yard-bg', '#1a2321');
        document.documentElement.style.setProperty('--yard-fg', '#f0f5f3');
        document.documentElement.style.setProperty('--yard-border', '#51615a');
        document.documentElement.style.setProperty('--yard-surface', '#2b3934');
        document.documentElement.style.setProperty('--yard-muted', '#acbcb4');
      });
      assert.equal(await rows.first().evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(26, 35, 33)');
      assert.equal(await rows.first().locator('.yard-output-icon').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(43, 57, 52)');
      assert.equal(await rows.first().locator('small').evaluate(element => getComputedStyle(element).color), 'rgb(172, 188, 180)');
      const bounds = await rows.evaluateAll(elements => elements.map(element => ({left:element.getBoundingClientRect().left,
        right:element.getBoundingClientRect().right,viewport:innerWidth})));
      assert.ok(bounds.every(value => value.left >= 0 && value.right <= value.viewport));
      if (process.env.YARD_TEST_ARTIFACTS) await rows.first().screenshot({path:join(process.env.YARD_TEST_ARTIFACTS, 'live-workbook-narrow.png')});
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

test('live artifact action keeps original source and connection guards through handoff',
  { skip: !hasChrome && 'Isolated Chrome is unavailable', timeout: 30_000 }, async () => {
    const { page, errors } = await newPage();
    try {
      const text = liveCitation('ref-sheet', 'workbook', 'label="Sheet title"');
      await page.evaluate(text => window.outputHarness.render({host:'local',authority:'sync',texts:[text]}), text);
      const open = page.locator('.yard-output-card--artifact').getByRole('button', {name:'Open Sheet title'});
      await open.click();
      assert.equal(await page.evaluate(() => window.outputHarness.checkArtifact(0)), 'current');
      await page.evaluate(() => window.outputHarness.setAuthority(false));
      assert.equal(await page.evaluate(() => window.outputHarness.checkArtifact(0)), 'Original page authority revoked');
      await open.click();
      await page.getByRole('alert').filter({hasText:'Original page authority revoked'}).waitFor();
      assert.equal((await page.evaluate(() => window.outputHarness.calls.artifacts)).length, 1);
      await page.evaluate(text => { window.outputHarness.setAuthority(true);
        window.outputHarness.render({host:'local',authority:'sync',sourceKey:'next',texts:[text]}); }, text);
      await page.waitForFunction(() => !document.querySelector('[role=alert]'));
      assert.equal(await page.evaluate(() => window.outputHarness.checkArtifact(0)), 'The original output source changed.');
      await open.click();
      await page.evaluate(() => {
        window.outputHarness.emit('codex-app-server-connection-changed', 'local');
        (document.querySelector('.yard-output-card--artifact [aria-label="Open Sheet title"]') as HTMLButtonElement).click();
      });
      assert.equal((await page.evaluate(() => window.outputHarness.calls.artifacts)).length, 2);
      assert.equal(await page.evaluate(() => window.outputHarness.checkArtifact(1)), 'The original output source changed.');
      const third = liveCitation('ref-sheet', 'workbook', 'label="Third title"');
      await page.evaluate(text => window.outputHarness.render({host:'local',authority:'sync',sourceKey:'third',onArtifact:'throw',texts:[text]}), third);
      await page.locator('.yard-output-card--artifact').getByRole('button', {name:'Open Third title'}).click();
      await page.getByRole('alert').filter({hasText:'Original artifact action rejected'}).waitFor();
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

test('live artifact external and page references retain their distinct availability',
  { skip: !hasChrome && 'Isolated Chrome is unavailable', timeout: 30_000 }, async () => {
    const { page, errors } = await newPage();
    try {
      const pageId = '12345678-1234-1234-1234-123456789abc';
      const external = liveCitation('artifact_external_remote', 'workbook', 'label="External"');
      const linked = liveCitation('page-ref', 'presentation', `page_id="${pageId}" label="Linked page"`);
      const text = `${external} ${linked}`;
      await page.evaluate(text => window.outputHarness.render({host:'local',authority:'sync',texts:[text]}), text);
      const rows = page.locator('.yard-output-card--artifact');
      await rows.nth(1).getByText('Linked page').waitFor();
      assert.equal(await rows.getByRole('button', {name:'Open Linked page'}).count(), 0);
      await rows.getByRole('button', {name:'Open External'}).click();
      assert.deepEqual(await page.evaluate(() => window.outputHarness.calls.artifacts), [
        {hostId:'local',threadId:'thread-one',artifactRef:'artifact_external_remote',kind:'spreadsheet',title:'External'},
      ]);
      await page.evaluate(text => window.outputHarness.render({host:'ssh-one',authority:'sync',sourceKey:'page',
        canOpenArtifactPage:true,texts:[text]}), text);
      await rows.getByRole('button', {name:'Open Linked page'}).click();
      assert.equal(await rows.getByRole('button', {name:'Open External'}).count(), 0);
      assert.deepEqual((await page.evaluate(() => window.outputHarness.calls.artifacts))[1],
        {hostId:'ssh-one',threadId:'thread-one',artifactRef:'page-ref',kind:'presentation',title:'Linked page',pageId});
      await page.evaluate(text => window.outputHarness.render({host:'local',authority:'sync',sourceKey:'shared',
        isSharedConversation:true,texts:[text]}), text);
      await page.waitForFunction(() => document.querySelectorAll('.yard-output-card--artifact').length === 2
        && !document.querySelector('.yard-output-card--artifact [aria-label="Open External"]')
        && !document.querySelector('.yard-output-card--artifact [aria-label="Open Linked page"]'));
      assert.equal(await rows.getByRole('button', {name:'Open Linked page'}).count(), 0);
      assert.deepEqual(await page.evaluate(() => [window.outputHarness.calls.pending,window.outputHarness.calls.opens]), [[], []]);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

test('live artifact rows wait for complete history and do not invent a missing parent action',
  { skip: !hasChrome && 'Isolated Chrome is unavailable', timeout: 30_000 }, async () => {
    const { page, errors } = await newPage();
    try {
      const text = liveCitation('ref-sheet');
      await page.evaluate(text => window.outputHarness.render({host:'local',authority:'sync',itemsView:'summary',texts:[text]}), text);
      await page.getByRole('status').filter({hasText:'turn history is complete'}).waitFor();
      assert.equal(await page.locator('.yard-output-card--artifact').count(), 0);
      await page.evaluate(text => window.outputHarness.render({host:'local',authority:'sync',itemsView:'full',onArtifact:'none',texts:[text]}), text);
      await page.locator('.yard-output-card--artifact').getByRole('button', {name:'Open Sheet'}).click();
      await page.getByRole('alert').filter({hasText:'Artifact session navigation is unavailable for this page.'}).waitFor();
      assert.deepEqual(await page.evaluate(() => window.outputHarness.calls.artifacts), []);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

test('live artifact row survives file existence results without changing file precedence',
  { skip: !hasChrome && 'Isolated Chrome is unavailable', timeout: 30_000 }, async () => {
    const { page, errors } = await newPage();
    try {
      const text = `${citation('report.md')} ${liveCitation('ref-sheet')} http://localhost:19876/`;
      await page.evaluate(text => window.outputHarness.render({host:'local',authority:'sync',texts:[text]}), text);
      const sheet = page.locator('.yard-output-card--artifact').getByRole('button', {name:'Open Sheet'});
      await sheet.waitFor();
      await pending(page, 1);
      assert.deepEqual((await page.evaluate(() => window.outputHarness.calls.pending[0]))?.params.paths, ['/work/report.md']);
      await page.evaluate(() => { window.outputHarness.dispatch(0); window.outputHarness.resolve(0, ['/work/report.md']); });
      await page.getByRole('button', {name:'Open report.md'}).waitFor();
      assert.equal(await sheet.count(), 1);
      assert.equal(await page.getByRole('button', {name:'Open report.md'}).count(), 1);
      assert.equal(await page.getByRole('button', {name:'Open Web preview'}).count(), 0);
      await sheet.click();
      assert.deepEqual((await page.evaluate(() => window.outputHarness.calls.artifacts))[0],
        {hostId:'local',threadId:'thread-one',artifactRef:'ref-sheet',kind:'spreadsheet',title:'Sheet'});
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

test('live artifact resource lists preserve the original collapsed order and scope',
  { skip: !hasChrome && 'Isolated Chrome is unavailable', timeout: 30_000 }, async () => {
    const { page, errors } = await newPage();
    try {
      const text = Array.from({length:5}, (_, index) => liveCitation(`ref-${index}`, 'workbook', `label="Sheet ${index}"`)).join(' ');
      await page.evaluate(text => window.outputHarness.render({host:'local',authority:'sync',texts:[text]}), text);
      const rows = page.locator('.yard-output-card--artifact');
      const expand = page.getByRole('button', {name:'Show 2 more'});
      await expand.waitFor();
      assert.equal(await rows.count(), 3);
      assert.match(await rows.nth(0).innerText(), /Sheet 0/);
      assert.match(await rows.nth(2).innerText(), /Sheet 2/);
      await expand.click();
      assert.equal(await rows.count(), 5);
      await rows.nth(4).getByRole('button', {name:'Open Sheet 4'}).click();
      assert.equal((await page.evaluate(() => window.outputHarness.calls.artifacts)).length, 1);
      await page.evaluate(text => window.outputHarness.render({host:'local',authority:'sync',sourceKey:'next',texts:[text]}), text);
      await expand.waitFor();
      assert.equal(await rows.count(), 3);
      assert.equal(await page.evaluate(() => window.outputHarness.checkArtifact(0)), 'The original output source changed.');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

test('website preview card is visible and opens the original scoped local URL',
  { skip: !hasChrome && 'Isolated Chrome is unavailable', timeout: 30_000 }, async () => {
    const { page, errors } = await newPage();
    try {
      await page.evaluate(() => window.outputHarness.render({ authority:'sync',
        texts:['Before artifact http://127.0.0.1:19876/ After artifact'] }));
      const card = page.locator('.yard-output-card');
      await card.getByRole('button', { name:'Open Web preview' }).waitFor();
      assert.match(await card.innerText(), /Web preview[\s\S]*Website[\s\S]*Open in/);
      if (process.env.YARD_TEST_ARTIFACTS) await card.screenshot({path:join(process.env.YARD_TEST_ARTIFACTS, 'website-light.png')});
      await card.getByRole('button', { name:'Open Web preview' }).click();
      assert.deepEqual(await page.evaluate(() => window.outputHarness.calls.browsers),
        [{ hostId:'ssh-one', threadId:'thread-one', url:'http://127.0.0.1:19876/' }]);
      assert.equal((await page.evaluate(() => window.outputHarness.calls.pending)).length, 0);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

test('original Google document output appears once and opens its scoped URL',
  { skip: !hasChrome && 'Isolated Chrome is unavailable', timeout: 30_000 }, async () => {
    const { page, errors } = await newPage(390);
    try {
      await page.evaluate(() => window.outputHarness.render({authority:'sync',
        texts:['[spec](https://docs.google.com/document/d/yard-fixture/edit)']}));
      const card = page.locator('.yard-output-card');
      await card.getByRole('button', {name:'Open spec'}).waitFor();
      assert.equal(await card.count(), 1);
      assert.match(await card.innerText(), /spec[\s\S]*Google Docs[\s\S]*Open in/);
      const bounds = await card.evaluate(element => ({card:element.getBoundingClientRect().right,
        menu:element.querySelector('.yard-output-menu-trigger')!.getBoundingClientRect().right,viewport:innerWidth}));
      assert.ok(bounds.card <= bounds.viewport && bounds.menu <= bounds.viewport);
      if (process.env.YARD_TEST_ARTIFACTS) await card.screenshot({path:join(process.env.YARD_TEST_ARTIFACTS, 'google-document-narrow.png')});
      await card.getByRole('button', {name:'Open spec'}).click();
      assert.deepEqual(await page.evaluate(() => window.outputHarness.calls.browsers),
        [{hostId:'ssh-one',threadId:'thread-one',url:'https://docs.google.com/document/d/yard-fixture/edit',source:'link'}]);
      await page.evaluate(() => window.outputHarness.setAuthority(false));
      await card.getByRole('button', {name:'Open spec'}).click();
      await page.getByRole('alert').filter({hasText:'Original page authority revoked'}).waitFor();
      assert.equal((await page.evaluate(() => window.outputHarness.calls.browsers)).length, 1);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

test('partial Google output waits for full turn history',
  { skip: !hasChrome && 'Isolated Chrome is unavailable', timeout: 30_000 }, async () => {
    const { page, errors } = await newPage();
    try {
      const text = '[spec](https://docs.google.com/document/d/yard-fixture/edit)';
      await page.evaluate(text => window.outputHarness.render({authority:'sync',itemsView:'summary',texts:[text]}), text);
      await page.getByRole('status').filter({hasText:'turn history is complete'}).waitFor();
      assert.equal(await page.locator('.yard-output-card').count(), 0);
      await page.evaluate(text => window.outputHarness.render({authority:'sync',itemsView:'full',texts:[text]}), text);
      await page.getByRole('button', {name:'Open spec'}).waitFor();
      assert.equal(await page.locator('.yard-output-previews [role=status]').count(), 0);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

test('original edited HTML title uses the captured host file and source',
  { skip: !hasChrome && 'Isolated Chrome is unavailable', timeout: 30_000 }, async () => {
    const { page, errors } = await newPage();
    try {
      const items = [{id:'edit',type:'fileChange',status:'completed',changes:[{path:'site/index.html',kind:{type:'add'}}]},
        {id:'answer',type:'agentMessage',text:'Done.'}];
      await page.evaluate(items => window.outputHarness.render({items,authority:'sync'}), items);
      await pending(page, 1);
      assert.deepEqual(await page.evaluate(() => window.outputHarness.calls.pending[0]),
        {endpoint:'read-file',params:{hostId:'ssh-one',path:'/work/site/index.html'},dispatched:false,denied:false});
      await page.evaluate(() => { window.outputHarness.dispatch(0);
        window.outputHarness.resolveRead(0, '<html><head><title>Original fixture</title></head></html>'); });
      await page.getByRole('button', {name:'Open Original fixture'}).waitFor();
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

test('website activation respects the original page and connection, and reports a rejected action',
  { skip: !hasChrome && 'Isolated Chrome is unavailable', timeout: 30_000 }, async () => {
    const { page, errors } = await newPage();
    try {
      const text = 'http://localhost:19876/';
      await page.evaluate(text => window.outputHarness.render({authority:'sync', texts:[text]}), text);
      const open = page.getByRole('button', {name:'Open Web preview'});
      await open.waitFor();
      await page.evaluate(() => window.outputHarness.setAuthority(false));
      await open.click();
      await page.getByRole('alert').filter({hasText:'Original page authority revoked'}).waitFor();
      assert.deepEqual(await page.evaluate(() => window.outputHarness.calls.browsers), []);
      await page.evaluate(text => { window.outputHarness.setAuthority(true);
        window.outputHarness.render({authority:'sync',sourceKey:'new-page',texts:[text],onBrowser:'throw'}); }, text);
      await open.click();
      await page.getByRole('alert').filter({hasText:'Original browser action rejected'}).waitFor();
      await page.evaluate(text => window.outputHarness.render({authority:'sync',sourceKey:'browser-missing',texts:[text],onBrowser:'none'}), text);
      await open.click();
      await page.getByRole('alert').filter({hasText:'Browser preview is unavailable'}).waitFor();
      await page.evaluate(text => window.outputHarness.render({authority:'sync',sourceKey:'new-page-2',texts:[text]}), text);
      await page.waitForFunction(() => !document.querySelector('[role=alert]'));
      await page.evaluate(() => {
        window.outputHarness.emit('codex-app-server-connection-changed', 'ssh-one');
        (document.querySelector('[aria-label="Open Web preview"]') as HTMLButtonElement).click();
      });
      assert.deepEqual(await page.evaluate(() => window.outputHarness.calls.browsers), []);
      await page.evaluate(text => window.outputHarness.render({authority:'sync',sourceKey:'third-page',host:'ssh-two',
        threadId:'thread-two',cwd:'/other',texts:[text]}), text);
      await open.click();
      assert.deepEqual(await page.evaluate(() => window.outputHarness.calls.browsers),
        [{hostId:'ssh-two',threadId:'thread-two',url:'http://localhost:19876/'}]);
      await page.evaluate(text => window.outputHarness.render({authority:'sync',host:'ssh-two',threadId:'thread-three',
        actualThreadId:'thread-two',texts:[text]}), text);
      await page.waitForFunction(() => !document.querySelector('.yard-output-card'));
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

test('original file action receives the captured synchronous scope check',
  { skip: !hasChrome && 'Isolated Chrome is unavailable', timeout: 30_000 }, async () => {
    const { page, errors } = await newPage();
    try {
      await page.evaluate(() => window.outputHarness.render({authority:'sync'}));
      await pending(page, 1);
      await page.evaluate(() => { window.outputHarness.dispatch(0); window.outputHarness.resolve(0, ['/work/report.md']); });
      await page.getByRole('button', {name:'Open report.md'}).click();
      assert.equal(await page.evaluate(() => window.outputHarness.checkFile(0)), 'current');
      await page.evaluate(() => window.outputHarness.setAuthority(false));
      assert.equal(await page.evaluate(() => window.outputHarness.checkFile(0)), 'Original page authority revoked');
      await page.evaluate(() => { window.outputHarness.setAuthority(true); window.outputHarness.render({authority:'sync',sourceKey:'new-page'}); });
      await pending(page, 2);
      assert.equal(await page.evaluate(() => window.outputHarness.checkFile(0)), 'The original output source changed.');
      await page.evaluate(() => { window.outputHarness.dispatch(1); window.outputHarness.resolve(1, ['/work/report.md']); });
      await page.getByRole('button', {name:'Open report.md'}).click();
      assert.equal(await page.evaluate(() => window.outputHarness.checkFile(1)), 'current');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

test('file precedence does not become a website after a missing file or a late response',
  { skip: !hasChrome && 'Isolated Chrome is unavailable', timeout: 30_000 }, async () => {
    const { page, errors } = await newPage();
    try {
      await page.evaluate(() => window.outputHarness.render({authority:'sync',
        texts:['[Report](report.pdf) http://localhost:19876/']}));
      await pending(page, 1);
      assert.equal(await page.getByRole('button', {name:'Open Web preview'}).count(), 0);
      assert.deepEqual((await page.evaluate(() => window.outputHarness.calls.pending[0]))?.params.paths, ['/work/report.pdf']);
      await page.evaluate(() => { window.outputHarness.dispatch(0); window.outputHarness.resolve(0, []); });
      await page.waitForFunction(() => !document.querySelector('.yard-output-card'));
      assert.equal(await page.getByRole('button', {name:'Open Web preview'}).count(), 0);
      await page.evaluate(text => window.outputHarness.render({authority:'sync',sourceKey:'two',texts:[text]}), citation('old.md'));
      await pending(page, 2);
      await page.evaluate(() => { window.outputHarness.dispatch(1);
        window.outputHarness.render({authority:'sync',sourceKey:'three',texts:['http://localhost:19876/']}); });
      await page.getByRole('button', {name:'Open Web preview'}).waitFor();
      await page.evaluate(() => window.outputHarness.resolve(1, ['/work/old.md']));
      assert.equal(await page.getByRole('button', {name:'Open old.md'}).count(), 0);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

test('edited HTML fallback retains its card and opens through the scoped file action',
  { skip: !hasChrome && 'Isolated Chrome is unavailable', timeout: 30_000 }, async () => {
    const { page, errors } = await newPage(390);
    try {
      const items = [{id:'edit',type:'fileChange',status:'completed',changes:[{path:'site/index.html',kind:{type:'add'}}]},
        {id:'answer',type:'agentMessage',text:'Done.'}];
      await page.evaluate(items => window.outputHarness.render({items,authority:'sync',onOpen:'throw'}), items);
      const card = page.locator('.yard-output-card');
      await card.getByRole('button', {name:'Open Web preview'}).waitFor();
      await pending(page, 1);
      await page.evaluate(() => window.outputHarness.dispatch(0));
      await card.getByRole('button', {name:'Open Web preview'}).click();
      await page.getByRole('alert').filter({hasText:'Original file action rejected'}).waitFor();
      await page.evaluate(items => window.outputHarness.render({items,authority:'sync',sourceKey:'second'}), items);
      await page.waitForFunction(() => !document.querySelector('[role=alert]'));
      await pending(page, 2);
      await page.evaluate(() => window.outputHarness.resolveRead(0, '<title>Old source</title>'));
      assert.equal(await card.getByRole('button', {name:'Open Old source'}).count(), 0);
      await page.evaluate(() => { window.outputHarness.dispatch(1); window.outputHarness.resolveRead(1, '<title>Original &amp; fixture</title>'); });
      await card.getByRole('button', {name:'Open Original & fixture'}).click();
      assert.deepEqual(await page.evaluate(() => window.outputHarness.calls.opens), [{hostId:'ssh-one',cwd:'/work',path:'/work/site/index.html'}]);
      assert.equal(await page.evaluate(() => window.outputHarness.checkFile(0)), 'current');
      assert.deepEqual(await page.evaluate(() => window.outputHarness.calls.browsers), []);
      const bounds = await card.evaluate(element => ({card:element.getBoundingClientRect().right,
        menu:element.querySelector('.yard-output-menu-trigger')!.getBoundingClientRect().right,viewport:innerWidth}));
      assert.ok(bounds.card <= bounds.viewport && bounds.menu <= bounds.viewport);
      await card.getByRole('button', {name:'Open in'}).click();
      assert.match(await card.getByRole('menu', {name:'Open in'}).innerText(), /External app discovery is unavailable/);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

test('HTML title reads reject revoked dispatch and preserve fallback after an actual read failure',
  { skip: !hasChrome && 'Isolated Chrome is unavailable', timeout: 30_000 }, async () => {
    const { page, errors } = await newPage();
    try {
      const items = [{id:'edit',type:'fileChange',status:'completed',changes:[{path:'site/index.html',kind:{type:'add'}}]},
        {id:'answer',type:'agentMessage',text:'Done.'}];
      await page.evaluate(items => window.outputHarness.render({items,authority:'sync'}), items);
      await pending(page, 1);
      assert.equal(await page.evaluate(() => {window.outputHarness.setAuthority(false); return window.outputHarness.dispatch(0);}), false);
      await page.evaluate(items => {window.outputHarness.setAuthority(true);
        window.outputHarness.render({items,authority:'sync',sourceKey:'retry'});}, items);
      await pending(page, 2);
      await page.evaluate(() => {window.outputHarness.dispatch(1); window.outputHarness.reject(1, 'Cannot read HTML');});
      await page.getByRole('button', {name:'Open Web preview'}).waitFor();
      await page.getByRole('button', {name:'Open Web preview'}).click();
      assert.deepEqual(await page.evaluate(() => window.outputHarness.calls.opens), [{hostId:'ssh-one',cwd:'/work',path:'/work/site/index.html'}]);
      assert.equal(await page.evaluate(() => window.outputHarness.checkFile(0)), 'current');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

test('streamed website cards use theme variables and fit the narrow message width',
  { skip: !hasChrome && 'Isolated Chrome is unavailable', timeout: 30_000 }, async () => {
    const { page, errors } = await newPage(390);
    try {
      await page.evaluate(() => window.outputHarness.render({status:'inProgress', texts:['http://localhost:19876/']}));
      await page.waitForSelector('[data-message-id="assistant-0"]');
      assert.equal(await page.locator('.yard-output-card').count(), 0);
      await page.evaluate(() => window.outputHarness.render({status:'completed', texts:['http://localhost:19876/']}));
      const card = page.locator('.yard-output-card');
      await card.getByRole('button', {name:'Open Web preview'}).waitFor();
      await page.evaluate(() => {
        const style = document.documentElement.style;
        style.setProperty('--yard-bg', '#14191b'); style.setProperty('--yard-fg', '#f1f5f3');
        style.setProperty('--yard-surface', '#293335'); style.setProperty('--yard-border', '#556467');
        style.setProperty('--yard-muted', '#ccd2d2'); style.setProperty('--yard-ui-font', 'monospace');
        style.setProperty('--yard-font-size', '16px');
      });
      const layout = await card.evaluate(element => {
        const rect = element.getBoundingClientRect(), title = element.querySelector('.yard-output-title')!.getBoundingClientRect();
        const menu = element.querySelector('.yard-output-menu-trigger')!.getBoundingClientRect();
        return { right:rect.right, titleRight:title.right, menuLeft:menu.left, menuRight:menu.right, viewport:innerWidth,
          background:getComputedStyle(element).backgroundColor,
          font:getComputedStyle(element.querySelector('.yard-output-title')!).fontFamily };
      });
      assert.ok(layout.right <= layout.viewport && layout.menuRight <= layout.viewport && layout.titleRight <= layout.menuLeft);
      assert.equal(layout.background, 'rgb(20, 25, 27)');
      assert.match(layout.font, /monospace/);
      if (process.env.YARD_TEST_ARTIFACTS) await card.screenshot({path:join(process.env.YARD_TEST_ARTIFACTS, 'website-dark-narrow.png')});
      await page.evaluate(() => window.outputHarness.render({status:'completed',itemsView:'summary',texts:['http://localhost:19876/']}));
      await page.waitForFunction(() => !document.querySelector('.yard-output-card'));
      await page.getByRole('status').filter({hasText:'turn history is complete'}).waitFor();
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

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
