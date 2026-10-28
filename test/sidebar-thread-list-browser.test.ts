import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    sidebarListHarness: {
      calls: { method: string; params: Record<string, unknown>; hostId: string }[];
      configure(value: Record<string, unknown>): void;
      resolve(index: number, value: unknown): void;
      reject(index: number, message: string): void;
      emit(event: Record<string, unknown>): void;
      listenerCount(): number;
      moreTwice(): boolean;
      refresh(): void;
      unmount(): void;
    };
  }
}

test('thread list isolates delayed scopes and live statuses, retries, searches all pages, and detects cursor loops', {
  skip: !existsSync('/usr/bin/google-chrome') && 'An isolated headless browser is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {useThreadList} from './src/renderer/sidebar/use-thread-list.ts';
      const calls=[], waiting=[], listeners=new Set();
      const client={rpc:(method,params,hostId)=>{calls.push({method,params,hostId});return new Promise((resolve,reject)=>waiting.push({resolve,reject}));},
        subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);}};
      let current, configure;
      function App(){
        const [options,setOptions]=useState({hostId:'local',archived:false,search:'',refreshKey:0});
        configure=value=>setOptions(old=>({...old,...value}));
        current=useThreadList(client,options);
        return React.createElement('pre',{id:'state'},JSON.stringify({rows:current.rows,nextCursor:current.nextCursor,loading:current.loading,error:current.error}));
      }
      const root=createRoot(document.getElementById('root'));
      window.sidebarListHarness={calls,configure:value=>configure(value),resolve:(index,value)=>waiting[index].resolve(value),
        reject:(index,message)=>waiting[index].reject(Error(message)),
        emit:event=>listeners.forEach(listener=>listener(event)),listenerCount:()=>listeners.size,
        moreTwice:()=>{const a=current.loadMore(),b=current.loadMore();return a===b;},
        refresh:()=>{void current.refresh();},unmount:()=>root.unmount()};
      root.render(React.createElement(App));
    ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic',
  });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const count = async () => page.evaluate(() => window.sidebarListHarness.calls.length);
    const waitCalls = async (total: number) => page.waitForFunction(n => window.sidebarListHarness.calls.length >= n, total);
    const resolve = async (index: number, rows: unknown[], nextCursor: string | null) => page.evaluate(
      ({ index, rows, nextCursor }) => window.sidebarListHarness.resolve(index, { data: rows, nextCursor }), { index, rows, nextCursor });
    const state = async () => JSON.parse(await page.locator('#state').innerText()) as {
      rows: { id: string; hostId: string; archived: boolean }[]; nextCursor: string | null;
      loading: boolean; error: { message: string; retry: string } | null;
    };
    const waitState = async (predicate: string) => page.waitForFunction(expression => {
      const value = JSON.parse(document.getElementById('state')!.textContent!);
      return Function('value', 'return ' + expression)(value);
    }, predicate);
    const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, preview: '', cwd: '/work',
      status: { type: 'idle' }, turns: [], ...extra });

    await waitCalls(1);
    await page.evaluate(() => window.sidebarListHarness.configure({ hostId: 'ssh-a' }));
    await waitCalls(2);
    await resolve(1, [row('remote')], 'next');
    await waitState("value.rows[0]?.id === 'remote' && !value.loading");
    await resolve(0, [row('late-local')], null);
    await page.waitForTimeout(50);
    assert.deepEqual((await state()).rows.map(item => [item.id, item.hostId, item.archived]), [['remote', 'ssh-a', false]]);

    await page.evaluate(() => window.sidebarListHarness.configure({ archived: true }));
    await waitCalls(3);
    await page.evaluate(() => window.sidebarListHarness.configure({ archived: false }));
    await waitCalls(4);
    await resolve(3, [row('active')], 'page-2');
    await waitState("value.rows[0]?.id === 'active' && !value.loading");
    await resolve(2, [row('late-archived')], null);
    await page.waitForTimeout(50);
    assert.deepEqual((await state()).rows.map(item => [item.id, item.archived]), [['active', false]]);

    assert.equal(await page.evaluate(() => window.sidebarListHarness.moreTwice()), true);
    await waitCalls(5);
    assert.equal(await count(), 5);
    await page.evaluate(() => window.sidebarListHarness.configure({ refreshKey: 1 }));
    await waitCalls(6);
    await resolve(5, [row('refreshed')], 'page-2');
    await waitState("value.rows[0]?.id === 'refreshed' && !value.loading");
    await resolve(4, [row('late-page')], null);
    await page.waitForTimeout(50);
    assert.deepEqual((await state()).rows.map(item => item.id), ['refreshed']);

    assert.equal(await page.evaluate(() => window.sidebarListHarness.moreTwice()), true);
    await waitCalls(7);
    await page.evaluate(() => window.sidebarListHarness.reject(6, 'page unavailable'));
    await waitState("value.error?.message === 'page unavailable'");
    assert.deepEqual(await state(), { rows: (await state()).rows, nextCursor: 'page-2', loading: false,
      error: { message: 'page unavailable', retry: 'loadMore' } });
    assert.deepEqual((await state()).rows.map(item => item.id), ['refreshed']);
    await page.evaluate(() => window.sidebarListHarness.moreTwice());
    await waitCalls(8);
    await resolve(7, [row('refreshed'), row('second')], null);
    await waitState("value.rows.length === 2 && !value.loading");
    assert.deepEqual((await state()).rows.map(item => item.id), ['refreshed', 'second']);

    await page.evaluate(() => window.sidebarListHarness.refresh());
    await waitCalls(9);
    await page.evaluate(() => window.sidebarListHarness.reject(8, 'refresh unavailable'));
    await waitState("value.error?.message === 'refresh unavailable'");
    assert.equal((await state()).error?.retry, 'refresh');
    assert.deepEqual((await state()).rows.map(item => item.id), ['refreshed', 'second']);
    await page.evaluate(() => window.sidebarListHarness.configure({ refreshKey: 2 }));
    await waitCalls(10);
    await page.evaluate(() => window.sidebarListHarness.reject(9, 'event refresh unavailable'));
    await waitState("value.error?.message === 'event refresh unavailable'");
    assert.deepEqual((await state()).rows.map(item => item.id), ['refreshed', 'second']);

    await page.evaluate(() => window.sidebarListHarness.configure({ search: 'needle' }));
    await waitCalls(11);
    await resolve(10, [row('unrelated')], 'search-2');
    await waitCalls(12);
    assert.equal((await state()).loading, true);
    assert.deepEqual((await state()).rows, []);
    await resolve(11, [row('preview-hit', { preview: 'Needle in preview' })], 'search-3');
    await waitCalls(13);
    await waitState("value.rows[0]?.id === 'preview-hit' && value.loading");
    await resolve(12, [row('cwd-hit', { cwd: '/NEEDLE/project' }), row('name-hit', { name: 'the Needle' })], null);
    await waitState('value.rows.length === 3 && !value.loading');
    assert.deepEqual((await state()).rows.map(item => item.id), ['preview-hit', 'cwd-hit', 'name-hit']);
    const calls = await page.evaluate(() => window.sidebarListHarness.calls);
    assert.ok(calls.every(call => call.method === 'thread/list' && !Object.hasOwn(call.params, 'searchTerm')));
    assert.deepEqual(calls.slice(10).map(call => call.params.cursor), [null, 'search-2', 'search-3']);

    await page.evaluate(() => window.sidebarListHarness.refresh());
    await waitCalls(14);
    await resolve(13, [row('new-match', { name: 'A needle' })], 'search-refresh-2');
    await waitCalls(15);
    await page.evaluate(() => window.sidebarListHarness.reject(14, 'search refresh unavailable'));
    await waitState("value.error?.message === 'search refresh unavailable'");
    assert.deepEqual((await state()).rows.map(item => item.id), ['new-match', 'preview-hit', 'cwd-hit', 'name-hit']);
    assert.equal((await state()).error?.retry, 'loadMore');
    await page.evaluate(() => window.sidebarListHarness.moreTwice());
    await waitCalls(16);
    await resolve(15, [row('replacement', { cwd: '/needle/new' })], null);
    await waitState('value.rows.length === 2 && !value.loading');
    assert.deepEqual((await state()).rows.map(item => item.id), ['new-match', 'replacement']);

    await page.evaluate(() => window.sidebarListHarness.configure({ search: '' }));
    await waitCalls(17);
    await resolve(16, [row('first')], 'loop');
    await waitState("value.nextCursor === 'loop' && !value.loading");
    await page.evaluate(() => window.sidebarListHarness.moreTwice());
    await waitCalls(18);
    await resolve(17, [row('second')], 'loop');
    await waitState("value.error?.message === 'Conversation list cursor loop detected'");
    assert.deepEqual((await state()).rows.map(item => item.id), ['first', 'second']);
    assert.equal((await state()).nextCursor, null);
    assert.equal((await state()).error?.retry, 'refresh');

    await page.evaluate(() => window.sidebarListHarness.configure({ hostId: 'local' }));
    await waitCalls(19);
    await resolve(18, [row('live', { status: { type: 'active', activeFlags: [] } })], null);
    await waitState("value.rows[0]?.status.type === 'active' && !value.loading");
    const notify = (hostId: string, type: string) => page.evaluate(({ hostId, type }) => window.sidebarListHarness.emit({
      type: 'mcp-notification', hostId, method: 'thread/status/changed', params: { threadId: 'live', status: { type } },
    }), { hostId, type });
    await notify('ssh-a', 'idle');
    await page.waitForTimeout(50); assert.equal(await count(), 19);
    await notify('local', 'active'); await waitCalls(20);
    await notify('local', 'idle'); await waitCalls(21);
    await resolve(20, [row('live')], null);
    await waitState("value.rows[0]?.status.type === 'idle' && !value.loading");
    await resolve(19, [row('live', { status: { type: 'active', activeFlags: [] } })], null);
    await page.waitForTimeout(50);
    await waitState("value.rows[0]?.status.type === 'idle' && !value.loading");
    await page.evaluate(() => window.sidebarListHarness.configure({ hostId: 'ssh-b' }));
    await waitCalls(22);
    await notify('local', 'active');
    await page.waitForTimeout(50); assert.equal(await count(), 22);
    await resolve(21, [row('remote-live')], null);
    await waitState("value.rows[0]?.id === 'remote-live' && !value.loading");
    await page.evaluate(() => window.sidebarListHarness.unmount());
    assert.equal(await page.evaluate(() => window.sidebarListHarness.listenerCount()), 0);
    await notify('ssh-b', 'active');
    await page.waitForTimeout(50); assert.equal(await count(), 22);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
