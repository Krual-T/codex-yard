import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

type OpenCall = { surface: string; hostId: string; threadId: string; url: string };
type ClickRecord = { text: string; type: string; prevented: boolean };
declare global {
  interface Window {
    messageLinkFixture: {
      calls: OpenCall[];
      clicks: ClickRecord[];
      files: unknown[];
      copies: string[];
      unexpected: string[];
      blockNext(): void;
      changeMain(hostId: string, threadId: string): void;
    };
  }
}

const require = createRequire(import.meta.url);
test('message and side-chat Markdown preserve native link behavior and original callback identity', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Isolated Chrome is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { StandaloneMessages } from './src/renderer/messages/StandaloneMessages.tsx';
    import { StandaloneMarkdown } from './src/renderer/markdown/StandaloneMarkdown.tsx';
    import { SideChatController } from './src/renderer/side-chat/controller.ts';
    import { SideChatPanel } from './src/renderer/side-chat/SideChatPanel.tsx';
    const calls=[], clicks=[], files=[], copies=[], unexpected=[];
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text => copies.push(text)}});
    document.execCommand=()=>false;
    const client={rpc:async method=>{unexpected.push('rpc:'+method);throw Error('Unexpected RPC');},
      host:async endpoint=>{unexpected.push('host:'+endpoint);throw Error('Unexpected host operation');},
      subscribe:()=>()=>{},reply:async()=>{unexpected.push('reply');throw Error('Unexpected approval');}};
    const wireText='Respond to the user input in the context of our conversation.';
    const app={version:1,message:{source:'visualization',sourceId:'fixture-app',text:'[App link](https://example.invalid/app?q=1#app)'}};
    const wire={type:'text',text:wireText,text_elements:[{byteRange:{start:0,end:new TextEncoder().encode(wireText).length},
      placeholder:'codex-untrusted-app-input:'+JSON.stringify(app)}]};
    const gif='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
    const mainItems=[
      {id:'user',type:'userMessage',content:[{type:'text',text:'[User **link**](https://example.invalid/user?q=one%20two&n=2#frag) [file](./source.ts#L3) [hash](#target) [mail](mailto:fixture@example.invalid) [credential](https://fixture@example.invalid/private)'},
        {type:'image',url:gif}]},
      {id:'app',type:'userMessage',content:[wire]},
      {id:'assistant',type:'agentMessage',text:'[Assistant link](http://localhost:5123/path?q=1#local)'},
      {id:'plan',type:'plan',text:'[Plan link](https://example.invalid/plan)'},
      {id:'reasoning',type:'reasoning',summary:['Thinking'],content:['[Reasoning link](https://example.invalid/reason)']},
      {id:'hook',type:'hookPrompt',fragments:[{text:'[Hook link](https://example.invalid/hook)',hookRunId:'fixture'}]},
      {id:'search',type:'webSearch',query:'fixture',action:{type:'openPage',url:'https://example.invalid/tool'}}
    ];
    const turn=items=>({id:'turn-a',status:'completed',itemsView:'full',items});
    let hostId='ssh-same', mainThread={id:'parent-thread',cwd:'/work',name:null,status:{type:'idle'},turns:[turn(mainItems)]};
    const childThread={id:'child-thread',cwd:'/work',name:null,status:{type:'idle'},turns:[turn([
      {id:'child-message',type:'agentMessage',text:'[Child link](https://example.invalid/child?x=1#child)'}])]};
    const view={operationId:'fixture-operation',parent:{hostId:'ssh-same',threadId:'parent-thread',cwd:'/work'},childId:'child-thread',
      child:{thread:structuredClone(childThread),options:{}},fork:{status:'received',error:null},inject:{status:'waiting',error:null},
      close:{requested:false,status:'idle',error:null},recoveryError:null};
    const port={subscribe:()=>()=>{}};
    const controller=new SideChatController({hostId:'ssh-same',parentThreadId:'parent-thread',draftId:'child-draft',restored:view,
      port,canDispatch:()=>false,onPrepared:async()=>{throw Error('Unexpected side-chat prepare');}});
    const history={hostId:'ssh-same',threadId:'child-thread',thread:childThread,options:{},loading:false,historyComplete:true,
      streamGap:false,error:null,canSubmit:false,canInterrupt:false,retry(){}};
    const root=createRoot(document.getElementById('root'));
    let blocked=false;
    document.addEventListener('click',event=>{if(blocked){blocked=false;event.preventDefault();}},true);
    function record(event){const a=event.target instanceof Element ? event.target.closest('a') : null;if(!a)return;
      clicks.push({text:a.textContent,type:event.type,prevented:event.defaultPrevented});
      if(!a.getAttribute('href')?.startsWith('#'))event.preventDefault();}
    document.addEventListener('click',record);document.addEventListener('auxclick',record);
    function render(){root.render(<>
      <div id="main"><StandaloneMessages client={client} hostId={hostId} thread={mainThread}
        onOpenBrowser={value=>calls.push({surface:'main',...value})} onOpenFileAt={value=>files.push(value)}/></div>
      <div id="child"><SideChatPanel client={client} controller={controller} open history={history}
        onClose={()=>{}} onBeforeClose={async()=>{}} onSubmit={async()=>{unexpected.push('submit');}} onInterrupt={async()=>{unexpected.push('interrupt');}}
        messages={{onOpenBrowser:value=>calls.push({surface:'child',...value})}}/></div>
      <div id="no-callback"><StandaloneMarkdown client={client} hostId="fixture" threadId="thread" cwd="/work"
        text="[No callback](https://example.invalid/fallback)"/></div>
      <div id="no-thread"><StandaloneMarkdown client={client} hostId="fixture" cwd="/work"
        onOpenBrowser={value=>calls.push({surface:'standalone',...value})} text="[No thread](https://example.invalid/fallback)"/></div>
      <div id="blank-thread"><StandaloneMarkdown client={client} hostId="fixture" threadId=" " cwd="/work"
        onOpenBrowser={value=>calls.push({surface:'standalone',...value})} text="[Blank thread](https://example.invalid/fallback)"/></div>
      <div id="target">Anchor target</div>
    </>);}
    window.messageLinkFixture={calls,clicks,files,copies,unexpected,blockNext(){blocked=true;},
      changeMain(nextHost,nextThread){hostId=nextHost;mainThread={...mainThread,id:nextThread};render();}};
    render();
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' },
  plugins: [{ name: 'single-katex', setup(builder) {
    builder.onResolve({ filter: /^katex$/ }, () => ({ path: require.resolve('katex') }));
  } }] });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking', '--no-proxy-server'] });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [], externalRequests: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (!request.url().startsWith('https://fixture.invalid/')) externalRequests.push(request.url()); });
    await page.route('**/*', route => route.request().url() === 'https://fixture.invalid/'
      ? route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }) : route.abort());
    await page.goto('https://fixture.invalid/');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const user = page.locator('#main [data-message-id="user"]');
    const userLink = user.getByRole('link', { name: 'User link' });
    await userLink.waitFor();
    assert.equal(await userLink.getAttribute('href'), 'https://example.invalid/user?q=one%20two&n=2#frag');
    assert.equal(await userLink.getAttribute('target'), '_blank');
    assert.equal(await userLink.getAttribute('rel'), 'noreferrer noopener');
    await userLink.locator('strong').click();
    await page.locator('#main [data-message-id="app"]').getByRole('link', { name: 'App link' }).click();
    await page.locator('#main [data-message-id="assistant"]').getByRole('link', { name: 'Assistant link' }).click();
    await page.locator('#main [data-message-id="plan"]').getByRole('link', { name: 'Plan link' }).click();
    await page.locator('#main [data-message-id="hook"]').getByRole('link', { name: 'Hook link' }).click();
    await page.locator('#main [data-message-id="reasoning"] summary').click();
    await page.locator('#main [data-message-id="reasoning"]').getByRole('link', { name: 'Reasoning link' }).click();
    await page.locator('#child').getByRole('link', { name: 'Child link' }).click();
    assert.deepEqual(await page.evaluate(() => window.messageLinkFixture.calls), [
      { surface: 'main', hostId: 'ssh-same', threadId: 'parent-thread', url: 'https://example.invalid/user?q=one%20two&n=2#frag' },
      { surface: 'main', hostId: 'ssh-same', threadId: 'parent-thread', url: 'https://example.invalid/app?q=1#app' },
      { surface: 'main', hostId: 'ssh-same', threadId: 'parent-thread', url: 'http://localhost:5123/path?q=1#local' },
      { surface: 'main', hostId: 'ssh-same', threadId: 'parent-thread', url: 'https://example.invalid/plan' },
      { surface: 'main', hostId: 'ssh-same', threadId: 'parent-thread', url: 'https://example.invalid/hook' },
      { surface: 'main', hostId: 'ssh-same', threadId: 'parent-thread', url: 'https://example.invalid/reason' },
      { surface: 'child', hostId: 'ssh-same', threadId: 'child-thread', url: 'https://example.invalid/child?x=1#child' },
    ]);
    assert.ok((await page.evaluate(() => window.messageLinkFixture.clicks)).slice(0, 7).every(event => event.prevented));

    for (const modifier of ['Control', 'Meta', 'Shift', 'Alt'] as const) await userLink.click({ modifiers: [modifier] });
    await userLink.click({ button: 'middle' });
    await page.getByRole('link', { name: 'No callback' }).click();
    await page.getByRole('link', { name: 'No thread' }).click();
    await page.getByRole('link', { name: 'Blank thread' }).click();
    await user.getByRole('link', { name: 'mail' }).click();
    await user.getByRole('link', { name: 'credential' }).click();
    const defaultClicks = (await page.evaluate(() => window.messageLinkFixture.clicks)).slice(7);
    assert.equal(defaultClicks.length, 10);
    assert.ok(defaultClicks.every(event => !event.prevented));
    assert.equal(defaultClicks[4]?.type, 'auxclick');
    assert.equal((await page.evaluate(() => window.messageLinkFixture.calls)).length, 7);
    await user.getByRole('link', { name: 'hash' }).click();
    await page.waitForFunction(() => location.hash === '#target');
    assert.equal((await page.evaluate(() => window.messageLinkFixture.calls)).length, 7);
    await page.evaluate(() => window.messageLinkFixture.blockNext());
    await userLink.click();
    assert.equal((await page.evaluate(() => window.messageLinkFixture.calls)).length, 7);

    await user.getByRole('button', { name: 'file' }).click();
    assert.deepEqual(await page.evaluate(() => window.messageLinkFixture.files),
      [{ hostId: 'ssh-same', cwd: '/work', path: '/work/./source.ts', line: 3 }]);
    await user.getByRole('button', { name: 'Copy message' }).click();
    assert.match((await page.evaluate(() => window.messageLinkFixture.copies)).at(-1) ?? '', /User link/);
    await user.getByRole('button', { name: 'Open Image' }).click();
    await page.getByRole('dialog', { name: 'Image preview' }).waitFor();
    await page.getByRole('button', { name: 'Close image preview' }).click();
    await page.locator('#main [data-message-id="search"] summary').click();
    await page.locator('#main [data-message-id="search"]').getByRole('button', { name: 'https://example.invalid/tool' }).click();
    assert.deepEqual((await page.evaluate(() => window.messageLinkFixture.calls)).at(-1),
      { surface: 'main', hostId: 'ssh-same', threadId: 'parent-thread', url: 'https://example.invalid/tool' });

    await page.evaluate(() => window.messageLinkFixture.changeMain('ssh-other', 'parent-thread'));
    const assistantLink = page.locator('#main [data-message-id="assistant"]').getByRole('link', { name: 'Assistant link' });
    await assistantLink.focus();
    await page.keyboard.press('Enter');
    assert.deepEqual((await page.evaluate(() => window.messageLinkFixture.calls)).at(-1),
      { surface: 'main', hostId: 'ssh-other', threadId: 'parent-thread', url: 'http://localhost:5123/path?q=1#local' });
    await page.evaluate(() => window.messageLinkFixture.changeMain('ssh-other', 'other-thread'));
    await page.locator('#main [data-message-id="assistant"]').getByRole('link', { name: 'Assistant link' }).click();
    assert.deepEqual((await page.evaluate(() => window.messageLinkFixture.calls)).at(-1),
      { surface: 'main', hostId: 'ssh-other', threadId: 'other-thread', url: 'http://localhost:5123/path?q=1#local' });
    assert.deepEqual(await page.evaluate(() => window.messageLinkFixture.unexpected), []);
    assert.deepEqual(externalRequests, []);
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
});
