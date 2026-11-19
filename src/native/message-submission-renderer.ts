// Show the composer's preparation phase with the native user-message component.
// Transport, configuration deferral, queue admission and error recovery remain
// owned by the pinned renderer. Capture its composer before clearing the input.
const preparationState = `
var yardPreparingMessages, yardVisiblePreparingMessages;
function yardPreparingState() {
  return yardPreparingMessages ??= Dc(q, () => []);
}
function yardPreparingViewState() {
  return yardVisiblePreparingMessages ??= H(q, (key, { get }) => {
    const messages = get(yardPreparingState(), key), confirmed = get(nAa, key);
    return messages.filter(message => !confirmed.includes(message.id));
  }, { autoDispose: true });
}
function yardPrepareUserMessage(scope, key, text, cwd) {
  const message = ZHo({ context: { ...scope.get(nJ), prompt: text }, cwd, text });
  scope.set(yardPreparingState(), key, messages => [...messages, message]);
  return { id: message.id, deferred: false,
    update(text) {
      this.deferred = false;
      scope.set(yardPreparingState(), key, messages => messages.map(item => item.id === message.id
        ? { ...item, text, context: { ...item.context, prompt: text } } : item));
    },
    release() {
      scope.set(yardPreparingState(), key, messages => messages.filter(item => item.id !== message.id));
    },
  };
}
export { yardPrepareUserMessage, yardPreparingViewState };
`;

const preparingView = `
import { yardPreparingViewState } from "./app-initial-a68277f60b93.js";
function yardPreparingUserMessage({ conversationId, hostId, message }) {
  const end = (0, NA.useRef)(null);
  (0, NA.useLayoutEffect)(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [message.id]);
  return (0, PA.jsxs)("div", {
    ref: end, className: "py-4", "data-yard-preparing-message": message.id,
    children: [(0, PA.jsx)(Jv, { speaker: "user" }), (0, PA.jsx)(sy, {
      message: message.text, cwd: message.cwd, threadId: conversationId, hostId,
      hideActions: true, sentAtMs: null,
    })],
  });
}
function yardWithPreparingEntries(entries, messages, conversationId, hostId) {
  if (!messages.length) return entries;
  const index = entries.findIndex(entry => entry.turn?.status === "inProgress" || entry.turnStatus === "inProgress");
  const at = index < 0 ? entries.length : index;
  return [...entries.slice(0, at), ...messages.map(message => ({
    type: "yard-preparing-user", turnKey: "yard-preparing:" + message.id,
    conversationId, hostId, message,
  })), ...entries.slice(at)];
}
`;

const beginPreparation = `
let yardSubmission = u.yardPreparingSubmission, yardDeferred = false;
let yardThreadId = WC(s), yardText = u.promptRawOverride ?? yardSubmission?.composer?.getText() ?? l.getText();
yardSubmission?.update(yardText);
if (yardSubmission == null && o.type === "local" && s.get(jT)?.type === "local"
    && !a.isResponseInProgress && a.submitButtonMode !== "stop"
    && u.followUpSubmitAction !== "queue"
    && yardThreadId != null && !u.aeonInitialization && u.navigation !== "background"
    && _ == null && e.editingQueuedMessagePosition == null && yardText.trim()
    && !yardText.trimStart().startsWith("/")) {
  yardSubmission = yardPrepareUserMessage(s, {
    hostId: s.get(g_, yardThreadId), threadId: yardThreadId,
  }, yardText, o.cwd);
  yardPreparing.current = yardSubmission;
  u = { ...u, yardPreparingSubmission: yardSubmission };
  if (u.clear !== false && u.promptRawOverride == null && u.persistedPromptRawOverride == null)
    yardClearSubmittedComposer(yardSubmission, l, e);
}
try {
if((d||a.submitBlockReason==="loading-local-config")`;

const composerPreparation = `
function yardComposerDraft(controller) {
  return { text: controller.getPersistedText(), document: controller.dictation?.document,
    plainTextMode: controller.persistedTextFormat !== "markdown" };
}
function yardClearSubmittedComposer(submission, controller, callbacks) {
  const draft = yardComposerDraft(controller), document = draft.document;
  const snapshot = { persistedTextFormat: controller.persistedTextFormat, dictation: { document } };
  for (const name of ["getText", "getPersistedText", "getPlainText", "getMentionedComputerUseApps",
    "getMentionedBrowserFamilies", "getComputerUseAppMentions", "getMentionedThreadReferences"]) {
    if (typeof controller[name] === "function") {
      const value = controller[name]();
      snapshot[name] = () => value;
    }
  }
  let retained = callbacks.retainComposerPrompt({ clearSavedDraft: false });
  function settle(accepted, restoreEditor = false) {
    if (retained == null) return false;
    const release = retained;
    retained = null;
    const canRestore = release(accepted);
    if (!accepted && restoreEditor && canRestore && !controller.view.isDestroyed && !controller.getText())
      controller.restoreDraft(draft.text, draft.document == null ? undefined : draft);
    return canRestore;
  }
  submission.composer = snapshot;
  submission.retainComposerPrompt = () => accepted => settle(accepted);
  const release = submission.release;
  submission.release = (restoreEditor = true) => { release.call(submission); settle(false, restoreEditor); };
  controller.setText("");
}
`;

/** Adapter for the checked-in UI version; never edit the upstream snapshot. */
export function adaptMessageSubmission(path: string, content: Buffer): Buffer {
  const edits: [string, string][] = path === '/assets/app-initial-a68277f60b93.js' ? [
    // Include preparations in the same client-message-ID reconciliation as
    // admitted messages, so a streamed/optimistic turn replaces its placeholder.
    ['nAa=H(q,(e,{get:t})=>{let n=t(qq,e);',
      'nAa=H(q,(e,{get:t})=>{let n=[...t(qq,e)??[],...t(yardPreparingState(),e)];'],
  ] : path === '/assets/app-primary-f5ea123a0407.js' ? [
    // The pinned UI mirrors accepted messages in a read-only composer until
    // their streamed turn arrives. Yard already displays that same message in
    // the conversation during preparation; keep its actual editor visible.
    ['Ie=q(g_,Fe),Le=Y(_D),Re;',
      'Ie=q(g_,Fe),yardPendingMessage=Y(_D),yardPreparingMessages=q(yardPreparingViewState(),Fe==null?null:{hostId:Ie,threadId:Fe}),Le=yardPreparingMessages?.some(message=>message.id===yardPendingMessage?.id)?null:yardPendingMessage,Re;'],
    ['m=(0,qX.useRef)(null);(0,qX.useEffect)(()=>{let e=s.get(Um)',
      'm=(0,qX.useRef)(null);let yardPreparing=(0,qX.useRef)(null);(0,qX.useEffect)(()=>()=>{yardPreparing.current?.release(false);yardPreparing.current=null},[s,f]);(0,qX.useEffect)(()=>{let e=s.get(Um)'],
    ['if((d||a.submitBlockReason===`loading-local-config`)', beginPreparation],
    ['clientThreadId:S,composerController:l,conversationId:c',
      'clientThreadId:S,composerController:yardSubmission?.composer??l,conversationId:c'],
    ['mentionedThreadReferences:qct(l),readThreadToolAvailable:',
      'mentionedThreadReferences:qct(yardSubmission?.composer??l),readThreadToolAvailable:'],
    ['retainComposerPrompt:e.retainComposerPrompt,editingQueuedMessagePosition:',
      'retainComposerPrompt:yardSubmission?.retainComposerPrompt??e.retainComposerPrompt,editingQueuedMessagePosition:'],
    ['clearComposerUi:t=>{if(C)return;let n=',
      'clearComposerUi:t=>{if(C)return;let yardNextDraft=yardSubmission?.composer&&l.getText()?yardComposerDraft(l):null;let n='],
    ['submittedContext:t}),r.length>0&&Lx',
      'submittedContext:t}),yardNextDraft!=null&&l.restoreDraft(yardNextDraft.text,yardNextDraft.document==null?undefined:yardNextDraft),r.length>0&&Lx'],
    ['let Be=le;Be==null&&Re',
      'let Be=le;if(te.yardPreparingSubmission?.composer&&Be===`empty-message`)Be=null;Be==null&&Re'],
    ['&&b({type:`composer`,options:u})){u.onDeferred?.();return}',
      '&&b({type:`composer`,options:u})){yardDeferred=true;if(yardSubmission)yardSubmission.deferred=true;u.onDeferred?.();return}'],
    ['if(y(u,a.submitBlockReason===`file-uploads`||a.submitBlockReason===`image-uploads`)){u.onDeferred?.();return}',
      'if(y(u,a.submitBlockReason===`file-uploads`||a.submitBlockReason===`image-uploads`)){yardDeferred=true;if(yardSubmission)yardSubmission.deferred=true;u.onDeferred?.();return}'],
    ['?(T=!0,u.onDeferred?.(),!0):!1},prompts:s.get(rIe)',
      '?(T=yardDeferred=true,yardSubmission&&(yardSubmission.deferred=true),u.onDeferred?.(),!0):!1},prompts:s.get(rIe)'],
    ['return(0,qX.useEffect)(()=>{oKe(s,r,()=>l.getText()',
      'return(0,qX.useEffect)(()=>{if(!v&&yardPreparing.current?.deferred){yardPreparing.current.release();yardPreparing.current=null}},[v]),(0,qX.useEffect)(()=>{oKe(s,r,()=>l.getText()'],
    ['m.current===v&&(m.current=null)),k()})}),g=!a.disabled',
      'm.current===v&&(m.current=null)),k()})}finally{if(!yardDeferred){yardSubmission?.release();if(yardPreparing.current===yardSubmission)yardPreparing.current=null}}}),g=!a.disabled'],
    ['ct=Ae!=null&&p!=null?p.slice(Qo.length):xh()',
      'ct=Ae!=null&&p!=null?p.slice(Qo.length):te.yardPreparingSubmission?.id??xh()'],
    ['ct??=void 0;let pt;', 'ct??=te.yardPreparingSubmission?.id;let pt;'],
  ] : path === '/assets/local-conversation-thread-a5549d2fbc3c.js' ? [
    ['let S=ue(ml),C=Rf(`2138468235`)',
      'let yardPreparing=R(yardPreparingViewState(),{threadId:t,hostId:r});let S=ue(ml),C=Rf(`2138468235`)'],
    ['bt.current=Kt;let Yt=',
      'bt.current=Kt;Kt=yardWithPreparingEntries(Kt,yardPreparing,t,r);let Yt='],
    ['{entry:n,latestTurnFooter:r,latestTurnFollowContentRef:i}=e;if(n.liveVoiceSource!=null)',
      '{entry:n,latestTurnFooter:r,latestTurnFollowContentRef:i}=e;if(n.type==="yard-preparing-user")return(0,Tk.jsx)(yardPreparingUserMessage,n);if(n.liveVoiceSource!=null)'],
  ] : path === '/assets/local-conversation-thread-turn-entries-4f0c5b536dd7.js' ? [
    ['return!y(e)&&!(`type`in e&&(',
      'return!y(e)&&!(`type`in e&&(e.type===`yard-preparing-user`||'],
  ] : [];
  if (!edits.length) return content;
  let source = content.toString('utf8');
  for (const [before, after] of edits) {
    if (source.split(before).length !== 2) throw new Error('发送消息适配与固定界面版本不匹配：' + path);
    source = source.replace(before, after);
  }
  source += path.includes('/app-initial-') ? preparationState
    : path.includes('/app-primary-') ? '\nimport { yardPrepareUserMessage, yardPreparingViewState } from "./app-initial-a68277f60b93.js";' + composerPreparation
    : path.includes('/local-conversation-thread-turn-entries-') ? '' : preparingView;
  return Buffer.from(source);
}
