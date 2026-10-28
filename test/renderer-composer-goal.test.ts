import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('goal controls use thread authority, preserve edits and ignore stale responses', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import * as React from 'react';
    import {createRoot} from 'react-dom/client';
    import {StandaloneGoal} from './src/renderer/composer/StandaloneGoal.tsx';
    const state={goals:{},calls:[],listeners:new Set(),fail:false,hold:false,held:[]};
    const key=(host,thread)=>host+':'+thread;
    const make=(thread,objective,status='paused')=>({threadId:thread,objective,status,tokenBudget:5000,tokensUsed:1234,timeUsedSeconds:125,createdAt:1,updatedAt:2});
    const client={
      async rpc(method,params,host){
        state.calls.push({method,params:structuredClone(params),host});
        const k=key(host,params.threadId);
        if(method==='thread/goal/get'){
          const value=structuredClone(state.goals[k]??null);
          if(state.hold)return new Promise(resolve=>state.held.push(()=>resolve({goal:value})));
          return {goal:value};
        }
        if(state.fail)throw Error('fixture offline');
        if(method==='thread/goal/set'){
          const old=state.goals[k]??make(params.threadId,params.objective,params.status);
          const goal={...old,...Object.fromEntries(Object.entries(params).filter(([name])=>['objective','status','tokenBudget'].includes(name)))};
          state.goals[k]=goal;return {goal:structuredClone(goal)};
        }
        if(method==='thread/goal/clear'){delete state.goals[k];return {cleared:true};}
        throw Error('unexpected RPC');
      },
      async host(){throw Error('unexpected host call');},
      subscribe(listener){state.listeners.add(listener);return ()=>state.listeners.delete(listener);},
      async reply(){throw Error('unexpected approval');}
    };
    let props={client,hostId:'ssh-a',threadId:'thread-a',readOnly:false};
    const root=createRoot(document.getElementById('root'));
    window.fixture={state,make,render(changes={}){props={...props,...changes};root.render(React.createElement(StandaloneGoal,props));},
      notify(host,thread,goal){for(const listener of state.listeners)listener({type:'mcp-notification',hostId:host,method:'thread/goal/updated',params:{threadId:thread,goal}});},
      resolve(){for(const finish of state.held.splice(0))finish();}};
    window.fixture.render();
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(5_000);
    const failures: string[] = [];
    page.on('pageerror', error => failures.push(error.message));
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }));
    await page.goto('http://localhost/');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.getByRole('button', { name: '新建目标' }).click();
    assert.equal(await page.evaluate(() => (window as any).fixture.state.calls.filter((c: any) => c.method !== 'thread/goal/get').length), 0);
    await page.getByLabel('目标内容').fill('First **goal**');
    await page.getByRole('button', { name: '创建暂停目标' }).click();
    await page.getByText('已暂停').waitFor();
    assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.calls.find((c: any) => c.method === 'thread/goal/set')),
      { method: 'thread/goal/set', params: { threadId: 'thread-a', origin: 'user', objective: 'First **goal**', status: 'paused' }, host: 'ssh-a' });
    await page.getByText(/1,234.*5,000 tokens/).waitFor();
    await page.getByText('耗时 2 分 5 秒').waitFor();
    await page.getByRole('button', { name: '编辑目标' }).click();
    await page.getByLabel('目标内容').fill('Local draft');
    await page.evaluate(() => {
      const f = (window as any).fixture;
      f.notify('other-host', 'thread-a', f.make('thread-a', 'Wrong host'));
      f.notify('ssh-a', 'other-thread', f.make('other-thread', 'Wrong thread'));
    });
    assert.equal(await page.getByLabel('目标内容').inputValue(), 'Local draft');
    await page.evaluate(() => {
      const f = (window as any).fixture;
      f.state.goals['ssh-a:thread-a'] = f.make('thread-a', 'Remote update');
      f.notify('ssh-a', 'thread-a', f.state.goals['ssh-a:thread-a']);
    });
    await page.getByRole('alert').filter({ hasText: '其他位置更改' }).waitFor();
    assert.equal(await page.getByLabel('目标内容').inputValue(), 'Local draft');
    assert.equal(await page.getByRole('button', { name: '保存目标' }).isDisabled(), true);
    await page.getByRole('button', { name: '载入最新目标' }).click();
    await page.getByLabel('目标内容').fill('Edited objective');
    await page.getByRole('button', { name: '保存目标' }).click();
    await page.getByText('Edited objective').waitFor();
    assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.calls.filter((c: any) => c.method === 'thread/goal/set').at(-1).params),
      { threadId: 'thread-a', origin: 'user', objective: 'Edited objective' });
    await page.getByRole('button', { name: '继续目标' }).click();
    await page.getByText('进行中').waitFor();
    await page.getByRole('button', { name: '暂停目标' }).click();
    await page.getByText('已暂停').waitFor();
    await page.getByRole('button', { name: '编辑目标' }).click();
    await page.getByLabel('目标内容').fill('Unsaved failure');
    await page.evaluate(() => { (window as any).fixture.state.fail = true; });
    await page.getByRole('button', { name: '保存目标' }).click();
    await page.getByRole('alert').filter({ hasText: 'fixture offline' }).waitFor();
    assert.equal(await page.getByLabel('目标内容').inputValue(), 'Unsaved failure');
    await page.evaluate(() => { (window as any).fixture.state.fail = false; });
    await page.getByRole('button', { name: '取消编辑' }).click();
    await page.evaluate(() => { (window as any).fixture.state.hold = true; });
    await page.getByRole('button', { name: '刷新' }).click();
    await page.evaluate(() => {
      const f = (window as any).fixture;
      const goal = f.make('thread-a', 'Latest notification', 'active');
      f.state.goals['ssh-a:thread-a'] = goal; f.notify('ssh-a', 'thread-a', goal); f.resolve(); f.state.hold = false;
    });
    await page.getByText('Latest notification').waitFor();
    assert.equal(await page.getByText('Edited objective').count(), 0);
    await page.evaluate(() => (window as any).fixture.render({readOnly:true}));
    await page.waitForFunction(() => !document.querySelector('button[title="编辑目标"]') && ![...document.querySelectorAll('button')].some(button => button.textContent === '编辑目标'));
    assert.equal(await page.getByRole('button', { name: '继续目标' }).count(), 0);
    await page.evaluate(() => (window as any).fixture.render({readOnly:false}));
    await page.getByRole('button', { name: '清除目标' }).click();
    assert.equal(await page.evaluate(() => (window as any).fixture.state.calls.filter((c: any) => c.method === 'thread/goal/clear').length), 0);
    await page.getByRole('button', { name: '确认清除' }).click();
    await page.getByRole('button', { name: '新建目标' }).waitFor();
    assert.deepEqual(await page.evaluate(() => (window as any).fixture.state.calls.find((c: any) => c.method === 'thread/goal/clear').params),
      { threadId: 'thread-a', origin: 'user' });
    await page.evaluate(() => {
      const f = (window as any).fixture; f.state.hold = true; f.render({threadId:'thread-a'});
    });
    await page.getByRole('button', { name: '刷新' }).click();
    await page.evaluate(() => {
      const f = (window as any).fixture;
      f.state.goals['ssh-a:thread-b'] = f.make('thread-b','Other thread');
      f.state.hold = false; f.render({threadId:'thread-b'}); f.resolve();
    });
    await page.getByText('Other thread').waitFor();
    assert.equal(await page.getByText('Latest notification').count(), 0);
    assert.deepEqual(failures, []);
  } finally { await context.close(); await browser.close(); }
});
