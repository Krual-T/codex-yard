import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    approvalConsumersHarness: {
      mode(value: 'main' | 'mini'): void;
      form(): void;
      disconnected(): void;
      release(): void;
      miniAnswer(value: string): void;
      staleStop(): void;
      request(): void;
      replies: unknown[];
      interrupts: unknown[];
    };
  }
}

test('real approval dialog and Mini projection retain one state across unmount and connection loss', {
  skip: !existsSync('/usr/bin/google-chrome') && 'An isolated headless browser is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React, {useSyncExternalStore} from 'react';
    import {createRoot} from 'react-dom/client';
    import {ApprovalDialog} from './src/renderer/app/ApprovalDialog.tsx';
    import {ApprovalRequestsController} from './src/renderer/app/approval-requests.ts';
    import {projectMiniApproval,respondFromMini,updateMiniApprovalDraft} from './src/renderer/mini/approval-projection.ts';
    const listeners=new Set(), replies=[], interrupts=[];
    let finish, current={hostId:'host-a',id:1,generation:'one'}, mode='main';
    const client={subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},
      async reply(ref,response){replies.push({ref:structuredClone(ref),response:structuredClone(response)});await new Promise(resolve=>finish=resolve)},
      async rpc(){throw Error('unexpected rpc')},async host(){throw Error('unexpected host')}};
    const controller=new ApprovalRequestsController(client);
    const emit=event=>{for(const fn of listeners)fn(event)};
    const add=(method,params)=>emit({type:'mcp-request',hostId:current.hostId,requestRef:current,
      request:{id:current.id,method,params:{threadId:'thread-a',turnId:'turn-a',...params}}});
    function Shell({target,view}) {
      const entries=useSyncExternalStore(controller.subscribe,controller.getSnapshot);
      const entry=entries.find(value=>value.request.ref.generation===target.generation&&value.request.id===target.id);
      if(!entry)return <p>No request</p>;
      if(view==='main')return <ApprovalDialog {...controller.dialog(target)} onInputEscape={async origin=>interrupts.push(origin)}/>;
      const projected=projectMiniApproval(entry);
      if(projected.kind==='open')return <section><strong>Open original request</strong><small>{projected.request.outcome}</small></section>;
      if(projected.kind!=='question')return <p>Unexpected projection</p>;
      return <section aria-label="Mini request">{projected.request.questions.map(question=><div key={question.id}>
        <span>{question.question}</span>{question.options.map(option=><button key={option.label}
          aria-pressed={(projected.request.inputDraft[question.id]?.selected??question.options[0].label)===option.label}
          disabled={entry.outcome!=='ready'} onClick={()=>updateMiniApprovalDraft(controller,target,
            {...projected.request.inputDraft,[question.id]:{selected:option.label,other:''}})}>{option.label}</button>)}
      </div>)}<button disabled={entry.outcome!=='ready'} onClick={()=>{
        const answers=Object.fromEntries(projected.request.questions.map(q=>[q.id,{answers:[projected.request.inputDraft[q.id]?.selected??q.options[0].label]}]));
        void respondFromMini(controller,target,{answers}).catch(()=>{});
      }}>Send from Mini</button><small>{entry.outcome}</small></section>;
    }
    const root=createRoot(document.getElementById('root'));
    const render=()=>root.render(<Shell target={current} view={mode}/>);
    const question=()=>add('item/tool/requestUserInput',{isBlocking:false,questions:[{id:'q',question:'Select answer',
      options:[{label:'First'},{label:'Second'}]}]});
    question();render();
    window.approvalConsumersHarness={replies,interrupts,mode(value){mode=value;render()},
      form(){current={hostId:'host-a',id:2,generation:'form'};add('mcpServer/elicitation/request',{mode:'form',serverName:'fixture',
        requestedSchema:{type:'object',properties:{note:{type:'string',title:'Note',default:'Preset'}},required:['note']}});mode='main';render()},
      disconnected(){emit({type:'connection-state',state:'disconnected'})},release(){finish?.()},
      miniAnswer(value){updateMiniApprovalDraft(controller,current,{q:{selected:value,other:''}})},
      request(){emit({type:'connection-state',state:'connected'});current={hostId:'host-a',id:3,generation:'fresh'};question();mode='main';render()},
      staleStop(){emit({type:'connection-state',state:'disconnected'});document.querySelector('button[data-stop-test]')?.click()}};
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    await page.route('**/*', route => route.abort());
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const main = page.getByRole('dialog');
    await main.getByLabel('Second').check();
    await page.evaluate(() => window.approvalConsumersHarness.mode('mini'));
    const mini = page.getByRole('region', { name: 'Mini request' });
    await mini.waitFor();
    assert.equal(await mini.getByRole('button', { name: 'Second' }).getAttribute('aria-pressed'), 'true');
    await mini.getByRole('button', { name: 'First' }).click();
    await page.evaluate(() => window.approvalConsumersHarness.mode('main'));
    assert.equal(await main.getByLabel('First').isChecked(), true);
    await page.evaluate(() => window.approvalConsumersHarness.miniAnswer('Second'));
    assert.equal(await main.getByLabel('Second').isChecked(), true);
    await page.evaluate(() => window.approvalConsumersHarness.mode('mini'));
    await mini.getByRole('button', { name: 'Send from Mini' }).click();
    await mini.getByText('sending', { exact: true }).waitFor();
    await page.evaluate(() => window.approvalConsumersHarness.mode('main'));
    assert.equal(await main.getByRole('button', { name: 'Submit', exact: true }).isDisabled(), true);
    await page.evaluate(() => { window.approvalConsumersHarness.disconnected(); window.approvalConsumersHarness.release(); });
    await main.getByText(/Response could not be confirmed/).waitFor();
    assert.equal(await main.getByRole('button', { name: 'Submit', exact: true }).isDisabled(), true);
    assert.equal((await page.evaluate(() => window.approvalConsumersHarness.replies)).length, 1);

    await page.evaluate(() => window.approvalConsumersHarness.request());
    const stop = main.getByRole('button', { name: 'Stop turn' });
    await stop.waitFor();
    await stop.evaluate(element => element.setAttribute('data-stop-test', ''));
    await page.evaluate(() => window.approvalConsumersHarness.staleStop());
    assert.equal((await page.evaluate(() => window.approvalConsumersHarness.interrupts)).length, 0);

    await page.evaluate(() => window.approvalConsumersHarness.request());
    await page.evaluate(() => window.approvalConsumersHarness.form());
    assert.equal(await main.getByLabel('Note').inputValue(), 'Preset');
    await main.getByLabel('Note').fill('Keep this form answer');
    await page.evaluate(() => window.approvalConsumersHarness.mode('mini'));
    await page.getByText('Open original request').waitFor();
    await page.evaluate(() => window.approvalConsumersHarness.mode('main'));
    assert.equal(await main.getByLabel('Note').inputValue(), 'Keep this form answer');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
