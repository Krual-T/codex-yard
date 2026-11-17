// This runs inside the pinned turn component. Its aliases refer to the native
// React hooks, activity disclosure, host client and persisted collapse state.
// Keep the native expansion preferences; use its paginator for ownership,
// in-flight deduplication, cache updates and replacing summary item IDs.
const lazyActivity = `
let yardSummary = !ut && _?.itemsPagination?.summaryItemIds != null;
let yardIncomplete = !ut && _?.itemsPagination?.hasLoadedOldest === false;
let [yardCollapsed, yardSetCollapsed] = (0, ml.useState)();
let yardRecentAttempt = (0, ml.useRef)();
let yardSetActivityCollapsed = collapsed => { yardSetCollapsed(collapsed); ae?.(collapsed); };
let yardExpanded = n !== "all" || ze || c != null || Ne
  || !Ut && !K && lt !== "off" && (U || M != null && N != null && M >= N - 1)
  || !(re ?? yardCollapsed ?? !(K || st || lr));
let yardLoad = (complete = true) => Xt(Ve, u).loadOlderConversationTurnsPage(l, {
  turnId: _.turnId, yardExpandActivity: true, yardRecentActivity: !complete,
}).catch(error => {
  yardSetActivityCollapsed(true);
  ie.error("Unable to load conversation activity", { error });
});
// An active summary can omit every completed progress message. Recover just
// its recent page first; explicit expansion can then finish that turn's pages.
// The native paginator preserves events received while the snapshot is read.
(0, ml.useEffect)(() => {
  if (!yardIncomplete) return;
  if (yardExpanded && (!K || re === false || yardCollapsed === false)) yardLoad();
  else if (K && yardSummary && yardRecentAttempt.current !== _.turnId) {
    yardRecentAttempt.current = _.turnId;
    yardLoad(false);
  }
}, [yardIncomplete, yardSummary, yardExpanded, K, re, yardCollapsed, Ve, u, l, _?.turnId]);
if (yardSummary && n === "all") X("agent-activity", (0, $.jsx)(yardActivityDisclosure, {
  isCollapsed: !yardExpanded,
  onSetCollapsed: yardSetActivityCollapsed,
  toggleProps: {
    collapsedMessageCount: 0, workedDurationMs: Ce, workedForItem: Xi,
    previousTurnNumber: M, totalTurnCount: N,
  },
}), { canOwnLatestTurnFollowContent: false });
else if(Qi){let e=Wa(Ma,`;

/** Versioned boundary for the pinned renderer. Keep its history store, merge
 * policy, cursors, stream ownership and activity UI; only change when and how
 * much history is read. The original upstream snapshot stays untouched. */
export function adaptConversationHistory(path: string, content: Buffer): Buffer {
  const edits: [string, string][] = path === '/assets/app-initial-a68277f60b93.js' ? [
    // Native conversations can use the same bounded history topology as cloud
    // conversations. Neither restoring a runtime nor reading settings is a
    // prerequisite for showing persisted messages.
    ['R=E&&L&&(a.useBoundedCloudHistory===!0||x.threadAccess!==`shared`),z=a.useBoundedCloudHistory?1:5',
      'R=L&&(E?(a.useBoundedCloudHistory===!0||x.threadAccess!==`shared`):e.supportsPaginatedThreadHistory()),z=E?(a.useBoundedCloudHistory?1:5):2'],
    // Sidebar metadata contains a placeholder turn with no turnId. It must not
    // suppress the early history read. Preserve optimistic/in-progress turns.
    ['re=!E&&L&&e.supportsPaginatedThreadHistory()&&px(M).length===0',
      're=!E&&L&&e.supportsPaginatedThreadHistory()&&!px(M).some(e=>e.turnId!=null||e.status===`inProgress`)'],
    ['re&&ie.then(async t=>{t?.thread.historyMode===`paginated`&&c()&&await y9t(e,{conversationId:f,initialPage:!0,isCurrentResumeAttempt:()=>!ne&&c()&&e.getStreamRole(f)?.role!==`follower`,mapThreadTurns:o.mapThreadTurns,requestOptions:te,thread:t.thread,turnMergePolicy:o.turnMergePolicy,workspaceRoots:g})})',
      'let yardEarlyHistory;re&&ie.then(t=>{if(t&&c()){e.updateConversationState(f,e=>{e.boundedCloudHistory=!0});return yardEarlyHistory=A4t(e,{conversationId:f,cwd:t.thread.cwd,isCurrent:()=>c()&&e.getStreamRole(f)?.role!==`follower`,mapThreadTurns:o.mapThreadTurns,options:{limit:2,itemsView:`summary`,requestOptions:te},permissions:Xr(g),reasoningEffort:h,threadStartKind:x?.threadStartKind,turnMergePolicy:o.turnMergePolicy})}})'],
    ['let Te=we?A4t(', 'let Te=yardEarlyHistory??(we?A4t('],
    ['turnMergePolicy:o.turnMergePolicy}):null;Te?.then(', 'turnMergePolicy:o.turnMergePolicy}):null);Te?.then('],
    ['async readThreadTurnsPage(e,t){let n=Qr(e)',
      'async readThreadTurnsPage(e,t){if(t.itemsView===`summary`&&!this.client.isCloudHost&&this.client.supportsPaginatedThreadHistory())return window.workbenchReadConversationPage(this.client.sendRequest.bind(this.client),e,t);let n=Qr(e)'],
    // Explicit full-history consumers (export, search, follow-up context) keep
    // their full reads. Resuming an ordinary chat never drains old tool logs.
    ['drainRemainingHistory:!0,completeRequest:e=>e', 'drainRemainingHistory:!1,completeRequest:e=>e'],
    // An explicit expansion completes just that turn, including turns with
    // multiple item pages. It can proceed during an older-turn page read.
    ['async loadOlderConversationTurnsPage(e,t={}){let n=this.client.getConversation(e);',
      'async loadOlderConversationTurnsPage(e,t={}){if(t.turnId!=null&&t.yardExpandActivity)return this.itemPagination.loadTurnItems(e,t.turnId,!t.yardRecentActivity,{priority:`interactive`},!0);let n=this.client.getConversation(e);'],
    ['if(t.turnId!=null)return this.itemPagination.loadTurnItems(e,t.turnId,!1);if((this.client.isCloudHost',
      'if(t.turnId!=null)return this.itemPagination.loadTurnItems(e,t.turnId,!1);if(!this.client.isCloudHost&&n?.boundedCloudHistory===!0)return this.loadConversationTurns(e,!1,`summary`);if((this.client.isCloudHost'],
  ] : path === '/assets/local-conversation-thread-a5549d2fbc3c.js' ? [
    // A saved virtual-row anchor can refer to the first summary on reentry.
    // Native chats always enter at the latest content; subsequent user scrolls
    // and explicit search/navigation still use the original list controller.
    ['ce=C===void 0||C,le=w===void 0||w', 'ce=(C===void 0||C)&&l===`durable`,le=w===void 0||w'],
    // The virtualized list already distinguishes layout from user scrolling.
    // Apply its existing user-scroll guard to local and SSH chats as well.
    ['c=aO({requireUserScroll:n,fetchBoundary:', 'c=aO({requireUserScroll:!0,fetchBoundary:'],
    // The outer scroll container can also request a page to fill a short
    // viewport. Keep that automatic fill for cloud threads only.
    ['autoLoadHistory:Mt,loadPastHiddenHistoryPages:', 'autoLoadHistory:l===`durable`&&Mt,loadPastHiddenHistoryPages:'],
  ] : path === '/assets/local-conversation-turn-981410324fed.js' ? [
    ['thinkingFallbackMessage:c===`active`||na?Ci:void 0};',
      'thinkingFallbackMessage:c===`active`||na?Ci:void 0};if(!ut&&K&&U&&_?.turnId)X(`yard-turn-progress`,window.workbenchTurnProgress({hostId:u,threadId:l,turnId:_.turnId,working:!!(Sr||Di||Oi||Ni||Pi),interrupt:()=>Xt(Ve,u).interruptConversation(l,`user-stop`),read:()=>Xt(Ve,u).sendRequest(`thread/turns/list`,{threadId:l,limit:5,sortDirection:`desc`,itemsView:`summary`})}),{canOwnLatestTurnFollowContent:false});'],
    // Use the very same native disclosure while only messages/timing are
    // available. Once hydrated, its existing activity renderer takes over.
    ['function Fc(e){', 'import{_ as yardActivityDisclosure}from"./sites-end-resource-b11586198b69.js";function Fc(e){'],
    ['if(Qi){let e=Wa(Ma,', lazyActivity],
    ['allowCollapseBeforeFinal:Ut,units:t', 'allowCollapseBeforeFinal:Ut||!ut&&K,units:t'],
    ['persistedCollapsed:re,onSetCollapsed:ae,forceExpanded:ze||!Ut&&lt',
      'persistedCollapsed:ut?re:re??yardCollapsed,onSetCollapsed:ut?ae:yardSetActivityCollapsed,forceExpanded:ze||!Ut&&(ut||!K)&&lt'],
    ['preventAutoCollapse:Ut&&K||st||lr', 'preventAutoCollapse:(Ut||!ut)&&K||st||lr'],
  ] : [];
  if (!edits.length) return content;
  let source = content.toString('utf8');
  for (const [before, after] of edits) {
    if (source.split(before).length !== 2) throw new Error('会话历史适配与固定界面版本不匹配：' + path);
    source = source.replace(before, after);
  }
  return Buffer.from(source);
}
