import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    assistantHarness: {
      renderMessage: (options: { completed: boolean; allowCopy?: boolean }) => void;
      renderStream: (options: { text: string; streamId: string; reduced?: boolean; active?: boolean }) => void;
      emit: (snapshot: { streamId: string; source: string; text: string }) => void;
      removeStream: () => void;
      renderMarkdown: () => void;
      removeMarkdown: () => void;
      copies: unknown[];
      analytics: unknown[];
      success: string[];
      updates: unknown[];
      destroyed: number;
      copyEvents: number;
      policies: string[];
      directiveStable: boolean[];
    };
  }
}

const chromePath = '/usr/bin/google-chrome';
test('assistant copying, action visibility, adaptive streaming and Markdown copy lifecycle', {
  skip: !existsSync(chromePath) && 'Google Chrome is unavailable; portable assistant checks still run',
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
      import * as React from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {createAssistantMessageComponent} from './src/renderer/messages/assistant-message.tsx';
      import {createAssistantMessageActionsComponent} from './src/renderer/messages/assistant-message-actions.tsx';
      import {createAdaptiveStreamingMarkdownComponent} from './src/renderer/markdown/adaptive-streaming.tsx';
      import {createMarkdownRootComponent} from './src/renderer/markdown/markdown-root.tsx';
      const h=React.createElement, cls=(...v)=>v.filter(Boolean).join(' '), intl={formatMessage:({defaultMessage})=>defaultMessage};
      const scope={value:{routeKind:'local-thread',conversationId:'thread',routeTemplate:'/thread/:conversationId'}};
      const Analytics={submitCodexAnalyticsEvent:e=>window.assistantHarness.analytics.push(e)};
      const Actions=createAssistantMessageActionsComponent(React,{
        useIntl:()=>intl,useAnalytics:()=>Analytics,useFeedbackEnabled:()=>false,toPlainText:t=>t,
        copyToClipboard:async content=>{window.assistantHarness.copies.push(content);return true},
        CopyButton:({buttonText,onCopy})=>h('button',{'aria-label':buttonText,onClick:e=>void onCopy(e)},'Copy'),
        Feedback:()=>null,RejectedReview:()=>null,
        OverflowMenu:({open,onOpenChange})=>h('button',{'aria-label':'More actions',onClick:()=>onOpenChange(!open)},'menu'),
        CompletedGoal:()=>null,Timestamp:()=>null,classNames:cls,
      });
      let previousDirectives;
      const Message=createAssistantMessageComponent(React,{
        useScope:()=>scope,useIntl:()=>intl,useBrowserEnabled:()=>true,useIsAeon:()=>false,useAeonFormatting:()=>false,
        useAeonReveal:()=>null,useNativeMessageEnabled:()=>false,useNativeMessageFeature:()=>false,getDeliveryAction:()=>null,
        describeDelivery:t=>t,deliveryActionText:()=>'',prepareCopyText:t=>t,formatDisplayContent:t=>t,
        hasAutomationCitationMarker:()=>false,formatAutomationCitation:()=>'',extractCompletedResults:()=>[],
        createFileDirectives:()=>({}),shouldRenderOutputPath:()=>true,createFollowupDirectives:()=>({}),createAnnotationDirectives:()=>({}),
        resolveAutomationCitation:()=>null,directiveNames:{comment:'comment',writing:'writing',automation:'automation',other:'other'},
        writingDirective:null,otherDirective:null,CommentDirective:()=>null,AutomationCitation:()=>null,formatMarkdown:t=>t,
        attachOutputLinks:t=>t,getSelectionContent:()=>({plainText:'selected text',htmlText:'<b>selected text</b>'}),
        shouldOfferAnnotation:()=>false,AnnotationAction:()=>null,ShareAction:()=>null,markdownComponentsForAeon:{},savedContentBackend:'backend',
        isDurableHost:()=>false,renderCompactRoot:c=>c,
        Markdown:({children,directives})=>{
          if(previousDirectives) window.assistantHarness.directiveStable.push(previousDirectives===directives);
          previousDirectives=directives;
          return h('article',{'data-selected-text-overlay-target':''},children);
        },
        StreamingProvider:({children})=>children,DeliveryAction:()=>null,DeliveredMessage:()=>null,NativeMessage:()=>null,
        Reveal:({children})=>children,getAnnouncementContent:t=>t,trimStreamingAnnouncement:t=>t,mergeRefs:r=>r,shimmerRef:null,
        annotationDataAttributes:{conversationId:'data-conversation',messageId:'data-message'},formatTimestampTitle:()=>'',
        Speaker:()=>null,ExternalDeliveryStatus:()=>null,LiveRegion:()=>null,Spinner:()=>null,Timestamp:()=>null,
        ComputerHandoff:()=>null,CompletedResults:()=>null,Actions,
        styles:{activeCommentary:'shimmer',compactMessageBody:'compact-body',compactMessageBubble:'compact',compactMessageBubbleWithAttachment:'with-attachment'},classNames:cls,
      });
      let store,reduced=false;
      class Store {
        constructor(content,id){this.snapshot={streamId:id,source:content,text:content.slice(0,2)};this.listeners=new Set();store=this}
        subscribe=fn=>{this.listeners.add(fn);return()=>this.listeners.delete(fn)};
        getSnapshot=()=>this.snapshot;
        update=(text,id,active,rate)=>window.assistantHarness.updates.push({text,id,active,rate});
        destroy=()=>{window.assistantHarness.destroyed++};
        emit(snapshot){this.snapshot=snapshot;this.listeners.forEach(fn=>fn())}
      }
      const client={};
      const Streaming=createAdaptiveStreamingMarkdownComponent(React,{
        useClient:()=>client,useReducedMotion:()=>reduced,createStore:(...args)=>new Store(...args),isSlowStreamingEnabled:()=>true,
        Markdown:({children,adaptiveStreaming,animate,fadeSegmentDelayMs,fadeSegmentMaxDelayMs})=>h('p',{
          id:'stream-text','data-adaptive':String(adaptiveStreaming),'data-animate':String(animate),
          'data-delay':fadeSegmentDelayMs,'data-max-delay':fadeSegmentMaxDelayMs},children),
      });
      const Policy=React.createContext('allow');
      const Root=createMarkdownRootComponent(React,{
        ExternalResourcePolicyContext:Policy,defaultHostId:'local',markdownRootClassName:'markdown-root',
        markdownIdAttribute:'data-markdown-id',classNames:cls,onCopy:()=>window.assistantHarness.copyEvents++,
        renderTokens:tokens=>h('p',null,tokens.join('')),
      });
      const getDefaultComponents=options=>{window.assistantHarness.policies.push(options.externalResourcePolicy);return {}};
      const messageRoot=createRoot(document.getElementById('message')),streamRoot=createRoot(document.getElementById('stream')),
        markdownRoot=createRoot(document.getElementById('markdown'));
      window.assistantHarness={copies:[],analytics:[],success:[],updates:[],destroyed:0,copyEvents:0,policies:[],directiveStable:[],
        renderMessage({completed,allowCopy=false}){flushSync(()=>messageRoot.render(h(Message,{conversationId:'thread',turnId:'turn',
          assistantCopyText:'full response',allowCopyWhileStreaming:allowCopy,item:{type:'assistant-message',content:'full response',completed,searchItemId:'item'}})))},
        renderStream({text,streamId,reduced:motion=false,active=true}){reduced=motion;flushSync(()=>streamRoot.render(h(Streaming,
          {streamId,children:text,isStreaming:active,fadeSegmentDelayMs:5,fadeSegmentMaxDelayMs:20})))},
        emit(snapshot){flushSync(()=>store.emit(snapshot))},removeStream(){flushSync(()=>streamRoot.render(null))},
        renderMarkdown(){flushSync(()=>markdownRoot.render(h(Policy.Provider,{value:'restricted'},h(Root,
          {tokens:['markdown'],getDefaultComponents,externalResourcePolicy:'allow'}))))},removeMarkdown(){flushSync(()=>markdownRoot.render(null))},
      };
    ` }, bundle: true, write: false, format: 'iife', jsx: 'transform',
  });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  try {
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    await page.setContent('<div id="message"></div><div id="stream"></div><div id="markdown"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => window.assistantHarness.renderMessage({ completed: false }));
    assert.equal(await page.getByRole('button', { name: 'Copy response' }).count(), 0);
    await page.evaluate(() => window.assistantHarness.renderMessage({ completed: false, allowCopy: true }));
    assert.deepEqual(await page.evaluate(() => window.assistantHarness.directiveStable), [true]);
    await page.getByRole('button', { name: 'Copy response' }).click();
    assert.deepEqual(await page.evaluate(() => window.assistantHarness.copies), [{ 'text/plain': 'full response', 'text/html': '<b>selected text</b>' }]);
    assert.deepEqual(await page.evaluate(() => window.assistantHarness.analytics), [{ action: 'copy', eventKind: 'action', metadata: { surface: 'assistant_message' }, threadId: 'thread', turnId: 'turn' }]);
    const actionGroup = page.locator('.turn-action-controls > div').first();
    assert.match(await actionGroup.getAttribute('class') ?? '', /opacity-0/);
    await page.getByRole('button', { name: 'More actions' }).click();
    assert.doesNotMatch(await actionGroup.getAttribute('class') ?? '', /opacity-0/);
    await page.getByRole('button', { name: 'More actions' }).click();
    assert.match(await actionGroup.getAttribute('class') ?? '', /opacity-0/);
    await page.evaluate(() => window.assistantHarness.renderStream({ text: 'abcdef', streamId: 'a' }));
    assert.equal(await page.locator('#stream-text').textContent(), 'ab');
    assert.equal(await page.locator('#stream-text').getAttribute('data-delay'), '0');
    await page.evaluate(() => window.assistantHarness.emit({ streamId: 'a', source: 'abc', text: 'abc' }));
    assert.equal(await page.locator('#stream-text').textContent(), 'abc');
    await page.evaluate(() => window.assistantHarness.renderStream({ text: 'new stream', streamId: 'b' }));
    assert.equal(await page.locator('#stream-text').textContent(), 'new stream');
    await page.evaluate(() => window.assistantHarness.renderStream({ text: 'new stream', streamId: 'b', reduced: true }));
    assert.equal(await page.locator('#stream-text').getAttribute('data-adaptive'), 'false');
    assert.equal(await page.locator('#stream-text').getAttribute('data-max-delay'), '20');
    assert.deepEqual(await page.evaluate(() => window.assistantHarness.updates), [
      { text: 'abcdef', id: 'a', active: true, rate: 0.01 },
      { text: 'new stream', id: 'b', active: true, rate: 0.01 },
      { text: 'new stream', id: 'b', active: false, rate: 10 },
    ]);
    await page.evaluate(() => window.assistantHarness.removeStream());
    assert.equal(await page.evaluate(() => window.assistantHarness.destroyed), 1);
    await page.evaluate(() => window.assistantHarness.renderMarkdown());
    assert.deepEqual(await page.evaluate(() => window.assistantHarness.policies), ['restricted']);
    await page.locator('#markdown p').dispatchEvent('copy');
    assert.equal(await page.evaluate(() => window.assistantHarness.copyEvents), 1);
    await page.evaluate(() => window.assistantHarness.removeMarkdown());
    await page.locator('#message article').dispatchEvent('copy');
    assert.equal(await page.evaluate(() => window.assistantHarness.copyEvents), 1);
  } finally {
    await context.close();
    await browser.close();
  }
});
