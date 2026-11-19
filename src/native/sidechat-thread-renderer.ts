/** Bridge the pinned UI to persistent app-server attachments. Upstream files
 * stay byte-for-byte intact; application behavior lives in TypeScript/React. */
export function adaptSidechatThreads(path: string, content: Buffer): Buffer {
  const edits: [string, string][] = [];
  if (path === '/assets/app-initial-a68277f60b93.js') {
    edits.push(
      ['collaborationMode:a,ephemeral:!0,addForkedSyntheticItem:!1,developerInstructions:',
        'collaborationMode:a,ephemeral:!1,attachToSource:!0,addForkedSyntheticItem:!1,developerInstructions:'],
      ['...t.ephemeral?{ephemeral:!0}:{}},d;if(n.isLocalExecutionHost',
        '...t.ephemeral?{ephemeral:!0}:{},...t.attachToSource?{attachToSource:!0,ephemeral:!1}:{}},d;if(n.isLocalExecutionHost'],
      ['Scheduled updates can’t run in temporary side chats. If the user asks for a recurring monitor here, explain that they should open the main chat or start a new chat, then set up the schedule there. Do not claim scheduled updates were set up in this side chat. Scheduling for another chat or a standalone task remains available.',
        'This side chat is saved under its parent chat. Closing its panel preserves its history and any running task. You may rename this side conversation with the available set_thread_title tool. Use a title the user specifies; otherwise, once this side conversation\'s topic is clear, choose a concise title following the user\'s naming conventions. Omit threadId so the tool targets this side conversation. Update an automatically chosen title when the topic materially changes.'],
      // Live reads/resumes must not reinsert a child into the flat root list.
      ['!this.isConversationSuppressed(e.id)&&e.ephemeral!==!0&&e.sideConversation!==!0',
        '!this.isConversationSuppressed(e.id)&&!window.workbenchSidechatThreads.isAttached(this.params.hostId,e.id)&&e.ephemeral!==!0&&e.sideConversation!==!0'],
      ['!this.isConversationSuppressed(e.conversationId)&&this.conversations.get(e.conversationId)?.sideConversation!==!0',
        '!this.isConversationSuppressed(e.conversationId)&&!window.workbenchSidechatThreads.isAttached(this.params.hostId,e.conversationId)&&this.conversations.get(e.conversationId)?.sideConversation!==!0'],
      // Cache eviction also interrupts a running conversation. A saved side
      // panel only closes its tab; the backend continues to own the work.
      ['async function vbl(e,t,n,{forgetHistoryFirst:r=!1}={}){try{',
        'async function vbl(e,t,n,{forgetHistoryFirst:r=!1}={}){if(window.workbenchSidechatThreads.isAttached(t,n))return!0;try{'],
      ['onBeforeClose:e=>Zyl(e,b,h,r.durable==null&&l&&(e.get(wor,s)??0)>0)',
        'onBeforeClose:e=>Zyl(e,b,h,r.durable==null&&!window.workbenchSidechatThreads.isAttached(u,s)&&l&&(e.get(wor,s)??0)>0)'],
      // Reopen a saved attachment with the original side-panel lifecycle.
      ['target:_=`right`,durable:v,insertPosition:y}){if(!e.get(gR))',
        'target:_=`right`,durable:v,insertPosition:y,existingConversationId:yardExisting}){if(!e.get(gR))'],
      ['C=v==null&&m==null&&(s===`local`||s===`durable`)?eu():void 0',
        'C=yardExisting==null&&v==null&&m==null&&(s===`local`||s===`durable`)?eu():void 0'],
      ['A=async()=>Uyl({scope:e,sourceConversationId:i',
        'A=async()=>{if(yardExisting!=null){let client=qh(e,s);await client.loadRecentConversationIds([yardExisting]);let result=await client.resumeConversation({conversationId:yardExisting,model:null,serviceTier:null,reasoningEffort:null,workspaceRoots:await FAn(e,yardExisting,{allowProjectSourceRoots:!0}),preserveServerConfiguration:!0,sideConversation:{parentNavigationPath:`${e.value.pathname}${e.value.search??``}`},showThreadGoalResumeConfirmation:!1},{readResumeInputs:GC(e,s)});if(result.status!==`ready`)throw Error(`Could not open this side chat`);return{conversationId:yardExisting,hostId:s}}return Uyl({scope:e,sourceConversationId:i'],
      ['parentNavigationPath:`${e.value.pathname}${e.value.search??``}`}),j=',
        'parentNavigationPath:`${e.value.pathname}${e.value.search??``}`});},j='],
    );
  } else if (path === '/assets/local-conversation-thread-a5549d2fbc3c.js') {
    edits.push([
      'description:(0,yA.jsx)(W,{id:`localConversation.sideChat.empty.description`,defaultMessage:`Side chats are temporary and disappear when you close the app.`,description:`Explains that ephemeral side chats disappear when the app is closed`})',
      'description:window.workbenchSidechatThreads.isAttached(r,t)?(0,yA.jsx)(W,{id:`yard.sideChat.saved.description`,defaultMessage:`This side chat is saved with its parent. Closing this panel keeps its history and running tasks.`}):(0,yA.jsx)(W,{id:`localConversation.sideChat.empty.description`,defaultMessage:`Side chats are temporary and disappear when you close the app.`,description:`Explains that ephemeral side chats disappear when the app is closed`})',
    ], [
      'function Kw(){let e=(0,qw.c)(11),t=ue(ml),n=J(Yw);',
      'function Kw(){let e=(0,qw.c)(11),t=ue(ml),yardLive=J(Yw),yardVisible=Bh(),yardIntl=ve(),yardId=t.value.routeKind===`local-thread`?t.value.conversationId:null,yardHost=R($i,yardId)??`local`,n=window.workbenchUseSidechats({hostId:yardHost,conversationId:yardId,isVisible:yardVisible,sideChats:yardLive,list:params=>Fs(t,yardHost).sendRequest(`thread/list`,params).catch(error=>{t.get(en).danger(yardIntl.formatMessage({id:`yard.sideChat.loadFailed`,defaultMessage:`Could not load side chats. Try refreshing the page.`}),{errorAnalytics:{toastId:`yard.sideChat.loadFailed`}});throw error}),fallbackTitle:index=>yardIntl.formatMessage(index===1?{id:`localConversation.sideChat.title`,defaultMessage:`Side chat`}:{id:`localConversation.sideChat.numberedTitle`,defaultMessage:`Side chat {index}`},{index})});',
    ], [
      'let a;e[3]===t?a=e[4]:(a=e=>{Wf(t,`right`,e.tabId)},e[3]=t,e[4]=a);',
      'let a=e=>{if(jc(t,e.tabId)!=null){Wf(t,`right`,e.tabId);return}Al(t,BA,{sourceConversationId:yardId,hostId:yardHost,existingConversationId:e.conversationId,displayTitle:e.title,intl:yardIntl}).catch(error=>t.get(en).danger(String(error),{errorAnalytics:{toastId:`yard.sideChat.openFailed`}}))};',
    ], [
      '(0,Vw.jsxs)(Z.ItemButton,{onClick:()=>r(e),children:',
      '(0,Vw.jsxs)(Z.ItemButton,{"data-yard-sidechat-id":e.conversationId,onClick:()=>r(e),children:',
    ]);
  } else return content;
  let source = content.toString('utf8');
  for (const [before, after] of edits) {
    if (source.split(before).length !== 2) throw new Error('侧边对话适配与固定界面版本不匹配：' + path);
    source = source.replace(before, after);
  }
  return Buffer.from(source);
}
