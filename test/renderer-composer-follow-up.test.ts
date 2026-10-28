import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('follow-up setting and alternate shortcut dispatch queue and steer to the current turn', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import * as React from 'react';
    import { createRoot } from 'react-dom/client';
    import { StandaloneComposer } from './src/renderer/composer/StandaloneComposer.tsx';
    const state={settings:{composerEnterBehavior:'enter',followUpQueueMode:'queue'},subscribers:new Set(),actions:[],calls:[],setTurn:null,blockFollow:false,release:null};
    const client={
      async host(endpoint,params={}){state.calls.push({endpoint,params});if(endpoint==='get-setting'){if(params.key==='followUpQueueMode'&&state.blockFollow)return new Promise(resolve=>{state.release=()=>resolve({value:state.settings[params.key]});});return {value:state.settings[params.key]};}throw Error('unexpected host');},
      async rpc(method){if(method==='model/list')return {data:[],nextCursor:null};if(method==='config/read')return {config:{}};if(method==='thread/queue/list')return {data:[],nextCursor:null};throw Error('unexpected RPC');},
      subscribe(listener){state.subscribers.add(listener);return ()=>state.subscribers.delete(listener);},
      async reply(){throw Error('unexpected approval in composer fixture');}
    };
    function App(){
      const [turn,setTurn]=React.useState('turn-1');state.setTurn=setTurn;
      return React.createElement(StandaloneComposer,{client,context:{hostId:'local',threadId:'thread',cwd:'/fixture',draftId:'draft'},busy:true,activeTurnId:turn,
        async onSubmit(draft,options,action){state.actions.push({text:draft.text,action});},async onInterrupt(){}});
    }
    state.setting=(key,value)=>{state.settings[key]=value;for(const listener of state.subscribers)listener({type:'settings-changed',keys:[key]});};
    window.fixture=state;createRoot(document.getElementById('root')).render(React.createElement(App));
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(5_000);
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }));
    await page.goto('http://localhost/');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const editor = page.getByRole('textbox', { name: '和 Codex 一起工作' });
    const send = async (text: string, key: string, count: number) => {
      await editor.fill(text); await editor.press(key);
      await page.waitForFunction(expected => (window as any).fixture.actions.length === expected, count);
      await page.waitForFunction(() => (document.querySelector('textarea[aria-label="和 Codex 一起工作"]') as HTMLTextAreaElement)?.value === '');
    };
    await page.waitForFunction(() => document.querySelector('.standalone-composer__submit')?.textContent === '排队');
    await send('queue first', 'Enter', 1);
    await send('steer alternate', 'Control+Enter', 2);
    await page.evaluate(() => (window as any).fixture.setting('followUpQueueMode', 'steer'));
    await page.waitForFunction(() => document.querySelector('.standalone-composer__submit')?.textContent === '发送到当前任务');
    await send('steer first', 'Enter', 3);
    await send('queue alternate', 'Control+Enter', 4);
    await page.evaluate(() => (window as any).fixture.setting('composerEnterBehavior', 'cmdAlways'));
    await page.waitForFunction(() => (document.querySelector('select[aria-label="发送方式"]') as HTMLSelectElement)?.value === 'cmdAlways');
    await send('modified steer', 'Control+Enter', 5);
    await send('modified alternate', 'Control+Shift+Enter', 6);
    await page.evaluate(() => (window as any).fixture.setting('followUpQueueMode', 'interrupt'));
    await page.waitForFunction(() => document.querySelector('.standalone-composer__submit')?.textContent === '发送到当前任务');
    await send('legacy mode', 'Control+Enter', 7);
    const actions = await page.evaluate(() => (window as any).fixture.actions);
    assert.deepEqual(actions.map((item: any) => item.action), [{ type: 'queue' }, { type: 'steer', turnId: 'turn-1' },
      { type: 'steer', turnId: 'turn-1' }, { type: 'queue' }, { type: 'steer', turnId: 'turn-1' },
      { type: 'queue' }, { type: 'steer', turnId: 'turn-1' }]);
    assert.equal(await page.evaluate(() => (window as any).fixture.calls.some((call: any) => call.endpoint === 'set-setting')), false);
    await page.evaluate(() => { const fixture = (window as any).fixture; fixture.blockFollow = true; fixture.setting('followUpQueueMode', 'queue'); });
    await page.waitForFunction(() => typeof (window as any).fixture.release === 'function');
    await editor.fill('held during refresh');
    await editor.press('Control+Enter');
    assert.equal(await page.evaluate(() => (window as any).fixture.actions.length), 7);
    await page.evaluate(() => { const fixture = (window as any).fixture; fixture.blockFollow = false; fixture.release(); });
    await page.waitForFunction(() => document.querySelector('.standalone-composer__submit')?.textContent === '排队');
    await editor.press('Control+Enter');
    await page.waitForFunction(() => (window as any).fixture.actions.length === 8);
    assert.deepEqual(await page.evaluate(() => (window as any).fixture.actions[7].action), { type: 'queue' });
    await page.evaluate(() => (window as any).fixture.setTurn(null));
    await editor.fill('retained without active turn');
    assert.equal(await page.getByRole('button', { name: '发送到当前任务' }).isDisabled(), true);
    await page.getByRole('button', { name: '排队', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.actions.length === 9);
    assert.deepEqual(await page.evaluate(() => (window as any).fixture.actions[8].action), { type: 'queue' });
  } finally { await context.close(); await browser.close(); }
});
