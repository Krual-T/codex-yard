import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    reasoningHarness: {
      render: (options: { content: string; completed: boolean; state: string | null; now: number }) => void;
      mountOverflow: (forking?: boolean) => void;
      menuFocusPrevented: (side: 'old' | 'new') => boolean;
      forks: string[];
    };
  }
}

const chromePath = '/usr/bin/google-chrome';
test('reasoning transitions and overflow dialogs behave like the original in an isolated browser', {
  skip: !existsSync(chromePath) && 'Google Chrome is unavailable; portable reasoning checks still run',
}, async () => {
  const vendor = await readFile(new URL('../vendor/codex-app/26.1013.40934/webview/assets/sites-end-resource-b11586198b69.js', import.meta.url), 'utf8');
  function extract(start: string, end: string, includeEnd = true) {
    assert.equal(vendor.split(start).length, 2, start);
    assert.equal(vendor.split(end).length, 2, end);
    const begin = vendor.indexOf(start), finish = vendor.indexOf(end, begin);
    assert.ok(finish > begin);
    return vendor.slice(begin, finish + (includeEnd ? end.length : 0));
  }
  const original = {
    reasoning: extract('function pE(e){let t=(0,yE.c)(49),', 't[46]=j,t[47]=z,t[48]=B):B=t[48],B}'),
    helpers: extract('function rE(e){', 'var aE;', false) + extract('function hE(e){', 'var yE,bE,xE,SE;', false),
    overflow: extract('function Ax(e){let t=(0,Mx.c)(50),', 't[47]=P,t[48]=E,t[49]=ee):ee=t[49],ee}'),
    citation: extract('function jx(e,t){', 'var Mx,Nx,Px;', false),
  };
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
      import * as React from 'react';
      import {jsx,jsxs,Fragment} from 'react/jsx-runtime';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {createReasoningMessageComponent} from './src/renderer/messages/reasoning-message.tsx';
      import {createAssistantMessageOverflowComponent} from './src/renderer/messages/assistant-message-overflow.tsx';
      const source=${JSON.stringify(original)},h=React.createElement,runtime={jsx,jsxs,Fragment},
        cache={c:n=>Array(n).fill(Symbol.for('react.memo_cache_sentinel'))},cls=(...v)=>v.filter(Boolean).join(' ');
      let now=1000,state=null;Date.now=()=>now;
      const reasoningDeps={
        useReasoningState:()=>state,getCompletedContent:value=>value.replace(/^\\*\\*[^\\n]*?\\*\\*\\s*/,''),
        formatElapsed:value=>value+'ms',useMeasurement:()=>({elementHeightPx:80,elementRef:React.useRef(null)}),
        FormattedMessage:({id,defaultMessage,values})=>h(React.Fragment,null,id==='assistantMessage.memoryCitations.summary'?'Memory citations':defaultMessage.replace('{elapsed}',values?.elapsed??'')),
        Markdown:({children})=>h('article',null,children),
        ActivityLabel:({active,className,children})=>h('span',{className,'data-active':String(active)},children),
        Header:({disclosure,children})=>h('header',null,disclosure?h('button',{'aria-expanded':disclosure.expanded,onClick:disclosure.onToggle},children):children),
        Scrollable:({items,autoScrollToBottom})=>h('section',{'data-scroll':String(autoScrollToBottom)},items.map(x=>h(React.Fragment,{key:x.key},x.node))),
        Surface:({children,ref})=>h('div',{ref},children),
        MotionDiv:({children,animate,className,style})=>h('div',{className,style,'data-height':animate.height,'data-opacity':animate.opacity},children),
        Layout:({header,body})=>h('main',null,header,body),transition:{},
        styles:{heading:'heading',paragraph:'paragraph',list:'list',content:'content'},classNames:cls,
      };
      const hb={xE:runtime,G:reasoningDeps.FormattedMessage,J:cls,dE:reasoningDeps.styles,aE:React,yE:cache,bE:React,SE:reasoningDeps.formatElapsed};
      const helpers=new Function(...Object.keys(hb),source.helpers+';return {iE,hE,gE,_E,vE}')( ...Object.values(hb));
      const rb={yE:cache,bE:React,xE:runtime,V:reasoningDeps.useReasoningState,js:null,vE:helpers.vE,Bd:reasoningDeps.getCompletedContent,
        gE:helpers.gE,_E:helpers._E,iE:helpers.iE,hE:helpers.hE,mE:value=>!value,ig:reasoningDeps.useMeasurement,J:cls,
        dE:reasoningDeps.styles,qu:reasoningDeps.Markdown,id:reasoningDeps.ActivityLabel,pp:reasoningDeps.Header,
        QT:reasoningDeps.Scrollable,sg:reasoningDeps.Surface,Tn:{div:reasoningDeps.MotionDiv},rr:reasoningDeps.transition,tp:reasoningDeps.Layout};
      const OldReasoning=new Function(...Object.keys(rb),'return ('+source.reasoning+')')(...Object.values(rb));
      const NewReasoning=createReasoningMessageComponent(React,reasoningDeps);
      const menus={};
      function makeOverflow(side) {
        const deps={
          useIntl:()=>({formatMessage:({defaultMessage})=>defaultMessage}),
          MenuButton:({ref,label,onClick})=>h('button',{ref,'aria-label':label,onClick},'menu'),
          Menu:({open,onOpenChange,onCloseAutoFocus,triggerButton,children})=>{
            menus[side]=onCloseAutoFocus;
            return h('div',null,React.cloneElement(triggerButton,{onClick:()=>onOpenChange(!open)}),
              open?h('nav',null,React.Children.map(children,child=>child&&React.cloneElement(child,{closeMenu:()=>onOpenChange(false)}))):null);
          },
          MenuItem:({children,disabled,'aria-label':label,'aria-busy':busy,onSelect,closeMenu})=>h('button',{
            disabled,'aria-label':label,'aria-busy':busy,onClick:()=>{onSelect();closeMenu()}},children),
          BranchIcon:()=>null,ReviewIcon:()=>null,hookAsset:'hook',memoryAsset:'memory',skillAsset:'skill',
          FormattedMessage:reasoningDeps.FormattedMessage,
          Modal:({children,open,size,onOpenChange,contentProps})=>open?h('div',{role:'dialog','data-size':size},children,
            h('button',{onClick:()=>{onOpenChange(false);contentProps.onCloseAutoFocus({preventDefault(){}})}},'Close')):null,
          AutoReviewDetails:({stats})=>h('p',null,'reviews:'+stats.rejectedCount),HookDetails:({stats})=>h('p',null,'hooks:'+stats.count),
          DialogContainer:({className,children})=>h('section',{className},children),DialogSection:({children})=>h('div',null,children),
          DialogHeader:({title})=>h('header',null,title),DialogTitle:({children,className})=>h('h2',{className},children),
        };
        const jx=new Function('Px','return ('+source.citation+')')(runtime);
        const ob={Mx:cache,Nx:React,Px:runtime,Me:deps.useIntl,Ae:deps.MenuButton,m:deps.Menu,qe:{Item:deps.MenuItem},
          F:deps.BranchIcon,be:deps.ReviewIcon,kt:deps.hookAsset,Kn:deps.memoryAsset,De:deps.skillAsset,G:deps.FormattedMessage,
          bn:deps.Modal,Xy:deps.AutoReviewDetails,Ug:deps.HookDetails,Fn:deps.DialogContainer,_n:deps.DialogSection,
          Ht:deps.DialogHeader,At:deps.DialogTitle,jx};
        return {Old:new Function(...Object.keys(ob),'return ('+source.overflow+')')(...Object.values(ob)),
          New:createAssistantMessageOverflowComponent(React,deps)};
      }
      const reasonRoots={old:createRoot(document.getElementById('old-reason')),new:createRoot(document.getElementById('new-reason'))};
      const overflowRoots={old:createRoot(document.getElementById('old-menu')),new:createRoot(document.getElementById('new-menu'))};
      const overflow={old:makeOverflow('old').Old,new:makeOverflow('new').New};
      function OverflowController({side,forking}){
        const [open,setOpen]=React.useState(false);
        return h(overflow[side],{open,onOpenChange:setOpen,forkDisabled:false,forkLabel:'Fork chat',isForking:forking,
          onFork:()=>window.reasoningHarness.forks.push(side),autoReviewStats:{rejectedCount:0},hookStats:{count:2},
          memoryCitationEntries:[{path:'/memory',lineStart:3,lineEnd:5,note:'remembered detail'}],
          renderUsedSkillsDetails:close=>h('button',{onClick:close},'Close skills')});
      }
      window.reasoningHarness={forks:[],
        render({content,completed,state:nextState,now:nextNow}){state=nextState;now=nextNow;
          const props={item:{type:'reasoning',content,completed},conversationId:'thread'};
          flushSync(()=>{reasonRoots.old.render(h(OldReasoning,props));reasonRoots.new.render(h(NewReasoning,props))})},
        mountOverflow(forking=false){flushSync(()=>{for(const side of ['old','new'])overflowRoots[side].render(h(OverflowController,{side,forking}))})},
        menuFocusPrevented(side){let prevented=false;menus[side]({preventDefault(){prevented=true}});return prevented},
      };
    ` }, bundle: true, write: false, format: 'iife', jsx: 'transform',
  });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  try {
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    await page.setContent('<div id="old-reason"></div><div id="new-reason"></div><div id="old-menu"></div><div id="new-menu"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const compare = async (suffix: string) => assert.equal(await page.locator(`#new-${suffix}`).innerHTML(), await page.locator(`#old-${suffix}`).innerHTML());
    await page.evaluate(() => window.reasoningHarness.render({ content: '**Unfinished', completed: false, state: null, now: 1000 }));
    await compare('reason');
    assert.equal(await page.locator('#new-reason article').count(), 0);
    await page.evaluate(() => window.reasoningHarness.render({ content: '**Title**\n\nBody', completed: false, state: 'suspended', now: 1050 }));
    await compare('reason');
    assert.equal(await page.locator('#new-reason article').count(), 0);
    await page.evaluate(() => window.reasoningHarness.render({ content: '**Title**\n\nBody', completed: false, state: 'resumed', now: 1100 }));
    await compare('reason');
    assert.equal(await page.locator('#new-reason article').textContent(), 'Body');
    await page.evaluate(() => window.reasoningHarness.render({ content: '**Title**\n\nBody', completed: true, state: null, now: 1250 }));
    await page.waitForFunction(() => ['old', 'new'].every(side =>
      document.querySelector(`#${side}-reason header`)?.textContent === 'Thought for 250ms'));
    await compare('reason');
    assert.equal(await page.locator('#new-reason button').textContent(), 'Thought for 250ms');
    for (const side of ['old', 'new']) await page.locator(`#${side}-reason button`).click();
    await compare('reason');
    assert.equal(await page.locator('#new-reason article').textContent(), 'Body');
    for (const side of ['old', 'new']) await page.locator(`#${side}-reason button`).click();
    await compare('reason');
    assert.equal(await page.locator('#new-reason article').count(), 0);

    await page.evaluate(() => window.reasoningHarness.mountOverflow(true));
    for (const side of ['old', 'new']) await page.locator(`#${side}-menu`).getByRole('button', { name: 'More actions' }).click();
    await compare('menu');
    assert.equal(await page.locator('#new-menu').getByRole('button', { name: 'Fork chat' }).isDisabled(), true);
    await page.evaluate(() => window.reasoningHarness.mountOverflow(false));
    for (const side of ['old', 'new']) await page.locator(`#${side}-menu`).getByRole('button', { name: 'Fork chat' }).click();
    assert.deepEqual(await page.evaluate(() => window.reasoningHarness.forks), ['old', 'new']);
    for (const [name, body, size] of [['Auto-review stats', 'reviews:0', 'xwideTall'], ['Hook stats', 'hooks:2', 'xwideTall'],
      ['Memory citations', 'remembered detail', 'wide'], ['Skills', 'Close skills', 'wide']] as const) {
      for (const side of ['old', 'new']) {
        await page.locator(`#${side}-menu`).getByRole('button', { name: 'More actions' }).click();
        await page.locator(`#${side}-menu`).getByRole('button', { name, exact: true }).click();
      }
      await compare('menu');
      assert.equal(await page.locator('#new-menu [role=dialog]').getAttribute('data-size'), size);
      assert.match(await page.locator('#new-menu [role=dialog]').textContent() ?? '', new RegExp(body));
      assert.equal(await page.evaluate(() => window.reasoningHarness.menuFocusPrevented('old')), true);
      assert.equal(await page.evaluate(() => window.reasoningHarness.menuFocusPrevented('new')), true);
      for (const side of ['old', 'new']) {
        await page.locator(`#${side}-menu [role=dialog]`).getByRole('button', { name: 'Close', exact: true }).click();
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'More actions');
      }
      await compare('menu');
    }
  } finally {
    await context.close();
    await browser.close();
  }
});
