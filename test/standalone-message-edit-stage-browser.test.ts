import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';

interface SavedEdit {
  recovery: { draft: { text: string }; editor: { sessionId: string; revision: number } };
  submission?: { stage: string; operationId: string; request: { clientUserMessageId: string; expectedTurnIds: string[] } };
}
interface Call { operation: string; clientUserMessageId: string; expectedTurnIds: string[]; turnParams: { input: { text: string }[] } }
declare global {
  interface Window { messageStageHarness: {
    accept(): Promise<void>;
    save(text: string, revision: number): Promise<void>;
    cancel(revision: number): Promise<void>;
    read(): Promise<SavedEdit | null>;
    submit(text: string): number;
    called(index: number): boolean;
    call(index: number): Call;
    reply(index: number, value: unknown): void;
    done(index: number): boolean;
    outcome(index: number): { error?: string; turn?: string };
  } }
}

const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
  import {MessageEditRecoveryStore} from './src/renderer/app/message-edit-recovery.ts';
  const origin = {hostId:'fixture-host',threadId:'thread',turnId:'source',itemId:'user'};
  const client = {rpc:async () => {throw Error('unexpected RPC')}, subscribe:() => () => {}, reply:async () => {},
    host:async (_endpoint,value) => { const index = calls.length; calls.push(structuredClone(value));
      return new Promise(resolve => { replies[index] = resolve; }); }};
  const store = new MessageEditRecoveryStore(client), access = store.createAccess();
  const calls = [], replies = [], outcomes = [];
  const version = revision => ({sessionId:'editor',revision});
  const recovery = (text,revision) => ({origin,draft:{text,input:[{type:'text',text}],images:[],files:[]},
    editor:{...version(revision),baseDraft:{text:'original',images:[],files:[]},edits:[],addedText:text,
      sourceSignature:'source',snapshot:{id:'user',type:'userMessage'},turnIndex:0,itemIndex:0}});
  window.messageStageHarness = {
    async accept() { if (!access.acquire(origin)) throw Error('cannot acquire'); (await access.read(origin)).accept(); },
    save:(text,revision) => store.save(recovery(text,revision),origin,version(revision)),
    cancel:revision => store.save(null,origin,version(revision)),
    read:() => store.read(origin.hostId,origin.threadId),
    submit(text) { const index = outcomes.length; outcomes.push(null);
      void store.submit(origin,['before','source'],{input:[{type:'text',text}]}).then(
        value => {outcomes[index]={turn:value.turn?.id}}, error => {outcomes[index]={error:String(error.message)}});
      return index; },
    called:index => !!calls[index], call:index => calls[index], reply:(index,value) => replies[index](value),
    done:index => outcomes[index] !== null, outcome:index => outcomes[index],
  };
` }, bundle: true, write: false, format: 'iife' });

async function pages(browser: Browser) {
  const context = await browser.newContext();
  await context.route('**/*', route => route.request().url() === 'http://127.0.0.1:18949/'
    ? route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>fixture</title>' }) : route.abort());
  async function open() {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:18949/');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    return page;
  }
  return { context, first: await open(), second: await open() };
}
async function start(page: Page, text: string) {
  const index = await page.evaluate(value => window.messageStageHarness.submit(value), text);
  await page.waitForFunction(value => window.messageStageHarness.called(value) || window.messageStageHarness.done(value), index);
  if (await page.evaluate(value => window.messageStageHarness.done(value), index)) {
    assert.fail(`Submit stopped before the fixture host: ${JSON.stringify(await page.evaluate(value => window.messageStageHarness.outcome(value), index))}`);
  }
  return index;
}
async function reply(page: Page, index: number, value: unknown) {
  await page.evaluate(({ index, value }) => window.messageStageHarness.reply(index, value), { index, value });
  await page.waitForFunction(value => window.messageStageHarness.done(value), index);
  return page.evaluate(value => window.messageStageHarness.outcome(value), index);
}

test('browser edit receipts settle only their original operation and preserve a concurrent newer draft', {
  skip: !existsSync('/usr/bin/google-chrome') && 'An isolated headless browser is unavailable', timeout: 90_000,
}, async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    {
      const { context, first, second } = await pages(browser);
      await first.evaluate(async () => { await window.messageStageHarness.accept(); await window.messageStageHarness.save('A', 1); });
      const operation = await start(first, 'A');
      const pending = (await first.evaluate(() => window.messageStageHarness.read()))!;
      assert.equal(pending.submission?.stage, 'revertUnknown');
      await second.evaluate(async () => { await window.messageStageHarness.accept(); await window.messageStageHarness.save('B', 2); });
      assert.match((await reply(first, operation, { stage: 'prepared', error: 'history read failed' })).error!, /history read failed/);
      const durable = (await second.evaluate(() => window.messageStageHarness.read()))!;
      assert.equal(durable.recovery.draft.text, 'B'); assert.equal(durable.recovery.editor.revision, 2);
      assert.equal(durable.submission?.operationId, pending.submission?.operationId); assert.equal(durable.submission?.stage, 'prepared');
      await assert.rejects(first.evaluate(() => window.messageStageHarness.cancel(1)), /另一页面/);
      await second.evaluate(async () => { await window.messageStageHarness.accept(); await window.messageStageHarness.cancel(2); });
      assert.equal(await second.evaluate(() => window.messageStageHarness.read()), null);
      await context.close();
    }
    {
      const { context, first, second } = await pages(browser);
      await first.evaluate(async () => { await window.messageStageHarness.accept(); await window.messageStageHarness.save('A', 1); });
      const operation = await start(first, 'A');
      const original = await first.evaluate(value => window.messageStageHarness.call(value), operation);
      await second.evaluate(async () => { await window.messageStageHarness.accept(); await window.messageStageHarness.save('B', 2); });
      assert.match((await reply(first, operation, { stage: 'reverted', error: 'start not sent' })).error!, /start not sent/);
      const durable = (await second.evaluate(() => window.messageStageHarness.read()))!;
      assert.equal(durable.recovery.draft.text, 'B'); assert.equal(durable.submission?.stage, 'reverted');
      await second.evaluate(() => window.messageStageHarness.accept());
      await assert.rejects(second.evaluate(() => window.messageStageHarness.cancel(2)), /草稿已保留/);
      const retry = await start(second, 'B');
      const retried = await second.evaluate(value => window.messageStageHarness.call(value), retry);
      assert.equal(retried.operation, 'retry-start'); assert.notEqual(retried.clientUserMessageId, original.clientUserMessageId);
      assert.deepEqual(retried.expectedTurnIds, original.expectedTurnIds); assert.equal(retried.turnParams.input[0]?.text, 'B');
      assert.equal((await reply(second, retry, { stage: 'started', turn: { id: 'new', status: 'inProgress', items: [] } })).turn, 'new');
      await second.evaluate(() => window.messageStageHarness.cancel(2));
      assert.equal(await second.evaluate(() => window.messageStageHarness.read()), null);
      await context.close();
    }
    {
      const { context, first, second } = await pages(browser);
      await first.evaluate(async () => { await window.messageStageHarness.accept(); await window.messageStageHarness.save('A', 1); });
      const operation = await start(first, 'A');
      await second.evaluate(async () => { await window.messageStageHarness.accept(); await window.messageStageHarness.save('B', 2); });
      const check = await start(second, 'B');
      const checking = (await second.evaluate(() => window.messageStageHarness.read()))!;
      const checkedRequest = await second.evaluate(value => window.messageStageHarness.call(value), check);
      assert.equal(checkedRequest.operation, 'check');
      assert.match((await reply(first, operation, { stage: 'prepared', error: 'old reply' })).error!, /结果已过期/);
      const stillChecking = (await second.evaluate(() => window.messageStageHarness.read()))!;
      assert.equal(stillChecking.submission?.operationId, checking.submission?.operationId);
      assert.equal(stillChecking.submission?.stage, 'revertUnknown'); assert.equal(stillChecking.recovery.draft.text, 'B');
      assert.match((await reply(second, check, { stage: 'prepared' })).error!, /尚未确认/);
      const durable = (await second.evaluate(() => window.messageStageHarness.read()))!;
      assert.equal(durable.submission?.operationId, checking.submission?.operationId);
      assert.equal(durable.submission?.stage, 'revertUnknown'); assert.equal(durable.recovery.draft.text, 'B');
      assert.equal(checkedRequest.clientUserMessageId, (await first.evaluate(value => window.messageStageHarness.call(value), operation)).clientUserMessageId);
      await context.close();
    }
  } finally { await browser.close(); }
});
