import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ComposerDocument, ComposerDraft, StandaloneComposerProps, SubmitAction, SubmitOptions, WorkbenchClient } from '../workbench-contract.ts';
import { translateKnown, useI18n } from '../i18n/index.tsx';
import { activatePending, canEditStructuredDraft, createId, documentFromText, draftToInput, editStructuredDraftText, hasContent, isStructuredAppInput, mergePrefill, normalizeDraft, prepareDraftInput, recoverLegacyDraft, removeStructuredImage, removeStructuredSkill, richEditIssue, structuredEditIssue, textEditIssue, updateDraftText, updateRichDraft } from './standalone-draft.ts';
import { localizeDraftIssue } from './standalone-draft-issues.ts';
import { useComposerDraft } from './use-composer-draft.ts';
import type { ComposerDraftController, ComposerDraftExternalOperation, ComposerDraftLease } from './use-composer-draft.ts';
import type { ComposerDraftOwner, ComposerDraftSnapshot, ComposerSubmissionDescription } from './composer-draft-store.ts';
import { composerDraftAtomKey, updateComposerDraftVersionInRoot } from './composer-draft-store.ts';
import { updateBrowserAtoms } from '../storage/ui-atoms.ts';
import { importAttachments } from './standalone-files.ts';
import { useCompletions } from './standalone-completions.tsx';
import type { Completion } from './standalone-completions.tsx';
import { ChatThreadResults } from './standalone-chat-lookup.tsx';
import type { ChatChoice, ChatLookupSnapshot } from './standalone-chat-lookup.tsx';
import { StandaloneOptions } from './standalone-options.tsx';
import { positionComposerMenu } from './composer-menu-position.ts';
import { StandaloneQueue } from './standalone-queue.tsx';
import type { DispatchQueueMutation } from './standalone-queue.tsx';
import type { QueueEditEntry } from './standalone-queue-storage.ts';
import { useEnterSetting } from './standalone-enter-setting.ts';
import { useFollowUpSetting } from './standalone-follow-up.ts';
import { usePlainTextSetting } from './standalone-plain-text-setting.ts';
import type { FollowUpAction } from './standalone-follow-up.ts';
import { StandaloneTarget } from './standalone-target.tsx';
import type { ComposerHost, ComposerProjectChoice, ComposerProjectDisplay, ComposerTarget } from './standalone-target.tsx';
import { StandalonePlainInputEditor, StandaloneRichEditor, StandaloneStructuredInputEditor } from './StandaloneRichEditor.tsx';
import type { PreparedPromptAppend, RichEditorHandle, StructuredInputEditorHandle, TextAgentChange, TextAgentSegment, TextMarkSpan, TextPasteEvent, TextSkillChange } from './StandaloneRichEditor.tsx';
import type { RichCompletionContext } from './rich-editor-actions.ts';
import { readRichDocument, serializePlainDocument, serializeRichDocument } from './rich-document.ts';
import { applyTextAgentMarks, isPlainTextAgentDocument, projectTextAgentDocument, textAgentSegments, updateTextAgentDocument } from './text-agent-document.ts';
import type { TextAgentSpan } from './text-agent-document.ts';
import { ArrowUp, FilePenLine, Lightbulb, MessageSquare, Mic, Paperclip, Plus } from 'lucide-react';
import './standalone-composer.css';

export { draftToInput } from './standalone-draft.ts';
export { bindComposerDraftToThread, clearComposerDraftRevision, readComposerDraft } from './composer-draft-store.ts';
export type { DraftInputOptions, DraftSkill } from './standalone-draft.ts';
export type { ComposerDraftOwner, ComposerDraftSnapshot, ComposerSubmissionDescription } from './composer-draft-store.ts';
export type { ComposerDraftController, ComposerDraftExternalOperation, ComposerDraftLease } from './use-composer-draft.ts';
export type { QueueEditEntry } from './standalone-queue-storage.ts';
export type { DispatchQueueMutation, QueueMutationMethod } from './standalone-queue.tsx';
export type { ComposerProjectChoice } from './standalone-target.tsx';
export type ComposerReference = NonNullable<ComposerDraft['references']>[number];
export interface ComposerPromptAppendPort {
  begin(owner: ComposerDraftOwner, assertOriginal: () => void): {
    append(document: ComposerDocument, prefillId?: string): Promise<{ status: 'accepted' | 'committed-unaccepted' }>;
    cancel(): void;
  } | null;
}
interface ChatSelection {
  controller: ComposerDraftController; isCurrentEditor(): boolean; insert(choice: ChatChoice): boolean;
  owner: ComposerDraftOwner; revision: string; cwd: string;
}
interface ChatLookup {
  id: number; selection: ChatSelection; client: WorkbenchClient; hostId: string; search: string; assertOwner(): void; assertOriginal(): void;
}
interface PromptAppendRuntime {
  controller: ComposerDraftController;
  owner: ComposerDraftOwner;
  cwd: string;
  enabled: boolean;
  editor(): RichEditorHandle | StructuredInputEditorHandle | null;
  prepare(before: ComposerDraft, addition: ComposerDocument, editor: RichEditorHandle | StructuredInputEditorHandle): {
    draft: ComposerDraft; stage: PreparedPromptAppend; textControl: boolean; index?: number;
  } | null;
}
export type StandaloneComposerRuntimeProps = Omit<StandaloneComposerProps, 'onSubmit'> & {
  /** An archived conversation keeps its draft without reading a mutable CLI queue. */
  readOnly?: boolean;
  onSubmit(draft: ComposerDraft, options: SubmitOptions, action: SubmitAction, description?: ComposerSubmissionDescription,
    assertAuthority?: () => void): Promise<void>;
  /** Capture the original owner, connection and navigation authority before any submission wait. */
  captureSubmissionAuthority?: (owner: ComposerDraftOwner) => () => void;
  /** Remove after the host/thread Yard write queue compares the original complete entry. */
  removeQueuedOriginal?: (entry: QueueEditEntry, originalAuthority: () => void,
    assertBeforeSend: () => void) => Promise<'deleted' | 'changed'>;
  /** Dispatch only through the original host connection and the supplied final guard. */
  dispatchQueueMutation?: DispatchQueueMutation;
  /** The app's authoritative active turn, used as the steer precondition. */
  activeTurnId?: string | null;
  initialOptions?: SubmitOptions;
  hosts?: ComposerHost[];
  /** Display only a project confirmed for this composer host and cwd. */
  projectDisplay?: ComposerProjectDisplay | null;
  projectChoices?: readonly ComposerProjectChoice[];
  selectedProjectId?: string | null;
  onProjectChange?: (project: ComposerProjectChoice | null, lease: ComposerDraftLease) => Promise<void>;
  onOpenGoal?: () => void;
  fullAccessVisible?: boolean;
  onEffectiveOptionsChange?: (owner: ComposerDraftOwner, options: SubmitOptions) => void;
  /** Reuse the borrowed lease in navigation guards; resolve after committing the requested owner. */
  onTargetChange?: (target: ComposerTarget, lease: ComposerDraftLease) => Promise<void>;
  onPrefillConsumed?: (id: string) => void;
  onDraftController?: (controller: ComposerDraftController | null) => void;
  onDraftChange?: (snapshot: ComposerDraftSnapshot) => void;
  onPromptAppendPort?: (port: ComposerPromptAppendPort | null) => void;
  onRemoveReference?: (owner: ComposerDraftOwner, reference: ComposerReference, operation: ComposerDraftExternalOperation) => Promise<'handled' | void>;
};

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function sandboxKey(policy: SubmitOptions['sandboxPolicy']): string | undefined {
  return JSON.stringify(policy, (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value);
}
function completionEnd(text: string, end: number, token: string): number {
  const suffix = text.slice(end).match(token.startsWith('@') ? /^[^\s@$\ufffc]*/ : /^[^\s@$\/\ufffc]*/)?.[0] ?? '';
  return end + suffix.length;
}
function unchangedHistoryPrefix(before: TextAgentSegment, after: TextAgentSegment): boolean {
  if (before.index !== after.index || !before.text.startsWith(after.text)) return false;
  const limit = after.text.length;
  const atoms = (value: TextAgentSegment) => {
    const retained = value.agents.filter(agent => agent.start < limit);
    return retained.some(agent => agent.end > limit) ? null : JSON.stringify(retained);
  };
  const marks = (value: TextAgentSegment) => {
    const result: { start: number; end: number; marks: string }[] = [];
    for (const span of value.marks) {
      if (span.start >= limit) break;
      const end = Math.min(span.end, limit), serialized = JSON.stringify(span.marks), last = result.at(-1);
      if (last && last.end === span.start && last.marks === serialized) last.end = end;
      else result.push({ start: span.start, end, marks: serialized });
    }
    return JSON.stringify(result);
  };
  const oldAtoms = atoms(before), newAtoms = atoms(after);
  return oldAtoms !== null && oldAtoms === newAtoms && marks(before) === marks(after);
}
function referenceLabel(reference: ComposerReference): string {
  const browser = reference.context?.localBrowserContext;
  if (reference.kind === 'browser' && browser && typeof browser === 'object' && !Array.isArray(browser)) {
    const description = (browser as Record<string, unknown>).targetDescription;
    if (typeof description === 'string' && description.trim()) return description.trim();
  }
  return reference.text.split(/\r?\n/, 1)[0] || reference.text;
}
function FilePreview({ client, hostId, path, name }: { client: WorkbenchClient; hostId: string; path: string; name: string }) {
  const { t } = useI18n('zh-CN');
  const [preview, setPreview] = useState<string | null>(null);
  return <details onToggle={event => {
    if (!event.currentTarget.open || preview != null) return;
    void client.host<{ text?: string; blob?: string }>('workspace-files', { operation: 'read', hostId, path, representation: 'auto' })
      .then(result => setPreview(result.text ?? t('File is binary and cannot be previewed as text.')))
      .catch(error => setPreview(t('Could not preview:') + message(error)));
  }}><summary>{name}</summary>{preview == null ? t('Reading...') : <pre>{preview}</pre>}</details>;
}

function ComposerSession({ client, context, busy, readOnly = false, onSubmit, onInterrupt, onStartQueued, captureSubmissionAuthority, removeQueuedOriginal, dispatchQueueMutation, prefill, activeTurnId, initialOptions, hosts, projectDisplay, projectChoices, selectedProjectId, onProjectChange, onOpenGoal, fullAccessVisible, onEffectiveOptionsChange, onTargetChange, onPrefillConsumed, onDraftController, onDraftChange, onPromptAppendPort, onRemoveReference }: StandaloneComposerRuntimeProps) {
  const { t, locale } = useI18n('zh-CN');
  const inputRoot = useRef<HTMLDivElement>(null);
  const projectSource = useRef({ context, projectChoices, selectedProjectId, onProjectChange });
  projectSource.current = { context, projectChoices, selectedProjectId, onProjectChange };
  const freezeGuard = useRef<(afterDrain: boolean) => boolean>(() => false);
  const pendingLink = useRef(false);
  const pendingComposition = useRef(false);
  const frozenRef = useRef(false);
  const thawWaiters = useRef(new Set<() => void>());
  const [frozen, setFrozen] = useState(false);
  const setInputFrozen = useCallback((value: boolean) => {
    frozenRef.current = value;
    if (inputRoot.current) inputRoot.current.inert = value;
    setFrozen(value);
    if (!value) { for (const resolve of thawWaiters.current) resolve(); thawWaiters.current.clear(); }
  }, []);
  const { owner, controller, current, stored, changeDraft, changeDraftFromOperation, updateDraftFromOperation, beginOperation,
    retain, clear, selectVersion, conflicts, storageError, saving, loaded, unresolved, saveUnresolved, retry, lastWrite, recheckProjection }
    = useComposerDraft(context, onDraftController, onDraftChange, freezeGuard, setInputFrozen, pendingLink, pendingComposition);
  const optionsListener = useRef(onEffectiveOptionsChange);
  optionsListener.current = onEffectiveOptionsChange;
  const lastOptionsProjection = useRef('');
  if (!onEffectiveOptionsChange) lastOptionsProjection.current = '';
  const notifyEffectiveOptions = useCallback((effective: SubmitOptions) => {
    const listener = optionsListener.current;
    if (!listener) return;
    const value = (item: unknown) => item === undefined ? ['absent'] : ['value', item];
    const policy = effective.approvalPolicy;
    const normalizedPolicy = typeof policy === 'object' ? [policy.granular.sandbox_approval, policy.granular.rules,
      policy.granular.skill_approval, policy.granular.request_permissions, policy.granular.mcp_elicitations] : policy;
    const signature = JSON.stringify([owner.hostId, owner.threadId, owner.draftId, value(effective.model), value(effective.effort),
      value(normalizedPolicy), value(effective.sandboxMode), value(sandboxKey(effective.sandboxPolicy)), value(effective.approvalsReviewer), value(effective.permissionProfileId),
      value(effective.serviceTier), value(effective.mode)]);
    if (signature === lastOptionsProjection.current) return;
    lastOptionsProjection.current = signature;
    listener(structuredClone(owner), structuredClone(effective));
  }, [owner.hostId, owner.threadId, owner.draftId]);
  const draft = stored.draft;
  const [overrides, setOverrides] = useState<Partial<SubmitOptions>>({});
  const [appliedOptions, setAppliedOptions] = useState<{ changes: Partial<SubmitOptions>; baseline: SubmitOptions } | null>(null);
  const options = { ...initialOptions, ...overrides };
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [interrupting, setInterrupting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [switchingTarget, setSwitchingTarget] = useState(false);
  const [defaultPending, setDefaultPending] = useState(false);
  const [queueVersion, setQueueVersion] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [segmentSelection, setSegmentSelection] = useState<{ index: number; cursor: number } | null>(null);
  const [richContext, setRichContext] = useState<RichCompletionContext | null>(null);
  const lastRichContext = useRef<RichCompletionContext | null>(null);
  const [fileLookup, setFileLookup] = useState<{ text: string; draft: ComposerDraft; revision: string;
    hostId: string; cwd: string; cursor: number; segment: { index: number; cursor: number } | null; rich: RichCompletionContext | null } | null>(null);
  const [chatLookup, setChatLookup] = useState<ChatLookup | null>(null);
  const [chatCompletion, setChatCompletion] = useState<ChatLookup | null>(null);
  const [chatSnapshot, setChatSnapshot] = useState<ChatLookupSnapshot | null>(null);
  const [chatIndex, setChatIndex] = useState(-1);
  const [chatError, setChatError] = useState('');
  const chatSequence = useRef(0);
  const lastChatSelection = useRef<ChatSelection | null>(null);
  const enterSetting = useEnterSetting(client);
  const followUpSetting = useFollowUpSetting(client);
  const queueAvailable = !readOnly && context.placement !== 'side-chat';
  const preferredFollowUp = queueAvailable ? followUpSetting.value : 'steer';
  const plainTextSetting = usePlainTextSetting(client);
  const mounted = useRef(false);
  const activeController = useRef<ComposerDraftController | null>(null);
  const pendingReferences = useRef(new Map<string, ComposerDraftController>());
  const [removing, setRemoving] = useState<{ controller: ComposerDraftController; ids: Set<string> } | null>(null);
  const submitInFlight = useRef(false);
  const interruptInFlight = useRef(false);
  const uploadsInFlight = useRef(0);
  const uploadQueue = useRef<Promise<void>>(Promise.resolve());
  const failedUploads = useRef<{ id: string; files: File[] }[]>([]);
  const [failedUploadView, setFailedUploadView] = useState<{ id: string; files: File[] }[]>([]);
  const updateFailedUploads = (next: { id: string; files: File[] }[]) => { failedUploads.current = next; setFailedUploadView(next); };
  const pickerOpen = useRef(false);
  const compositions = useRef(new Set<'editor' | 'queue'>());
  const setComposition = (source: 'editor' | 'queue', value: boolean) => {
    if (value) compositions.current.add(source); else compositions.current.delete(source);
    const wasPending = pendingComposition.current;
    pendingComposition.current = compositions.current.size > 0;
    if (wasPending && !pendingComposition.current) recheckProjection();
  };
  const queueEditState = useRef({ editing: false, pending: false });
  const defaultPendingRef = useRef(false);
  const notifyDefaultPending = useCallback((value: boolean) => { defaultPendingRef.current = value; setDefaultPending(value); }, []);
  const editor = useRef<StructuredInputEditorHandle>(null);
  const richEditor = useRef<RichEditorHandle>(null);
  const structuredEditor = useRef<StructuredInputEditorHandle>(null);
  const promptAppendRuntime = useRef<PromptAppendRuntime | null>(null);
  const promptAppendPort = useRef<ComposerPromptAppendPort | null>(null);
  // Keep the original text control and its history after its first agent insertion.
  const composerOwnerKey = JSON.stringify([owner.hostId, owner.threadId, owner.draftId]);
  const textAgentView = useRef<string | null>(null);
  const [textFormattingOwner, setTextFormattingOwner] = useState<string | null>(null);
  const textFormatting = textFormattingOwner === composerOwnerKey && !!draft.document;
  const [textFormatValue, setTextFormatValue] = useState('');
  useLayoutEffect(() => {
    if (textFormattingOwner && (textFormattingOwner !== composerOwnerKey || !draft.document)) setTextFormattingOwner(null);
  }, [draft.document, textFormattingOwner, composerOwnerKey]);
  const picker = useRef<HTMLInputElement>(null);
  const modelPicker = useRef<HTMLButtonElement>(null);
  const focusModelPicker = () => {
    const picker = modelPicker.current;
    const menu = picker?.closest<HTMLDetailsElement>('.standalone-composer__model');
    if (!picker || !menu) return;
    inputRoot.current?.querySelectorAll<HTMLDetailsElement>('.standalone-composer__menu[open]').forEach(other => {
      if (other !== menu) other.open = false;
    });
    menu.open = true;
    const choices = picker.closest<HTMLDetailsElement>('.standalone-composer__model-choices');
    if (choices) choices.open = true;
    positionComposerMenu(menu);
    requestAnimationFrame(() => picker.focus());
  };
  useEffect(() => {
    const closeOtherMenus = (event: MouseEvent) => {
      const root = inputRoot.current;
      if (!root || !(event.target instanceof Node)) return;
      root.querySelectorAll<HTMLDetailsElement>('.standalone-composer__menu[open]').forEach(menu => {
        if (!menu.contains(event.target as Node)) menu.open = false;
      });
    };
    const reposition = () => inputRoot.current?.querySelectorAll<HTMLDetailsElement>('.standalone-composer__menu[open]')
      .forEach(positionComposerMenu);
    document.addEventListener('click', closeOtherMenus, true);
    document.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('click', closeOtherMenus, true);
      document.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, []);
  freezeGuard.current = afterDrain => {
    const reason = !loaded || prefill && !current.current.prefills.includes(prefill.id) ? 'loading'
      : compositions.current.size ? 'composition' : pickerOpen.current ? 'picker'
      : pendingLink.current ? 'link'
      : queueEditState.current.editing && (!queueEditState.current.pending || afterDrain) ? 'queue'
      : failedUploads.current.length ? 'attachment'
      : interruptInFlight.current || defaultPendingRef.current ? 'pending' : '';
    if (!reason) return true;
    const explanation = locale.toLowerCase().startsWith('zh')
      ? { loading: '请等待草稿和预填恢复。', composition: '请先完成输入法输入。', picker: '请先完成或取消文件选择。', link: '请先应用或关闭链接编辑。', queue: '请先保存或取消队列编辑。', attachment: '请先重试或放弃未上传的附件。', pending: '请先完成当前停止或设置操作。' }[reason]
      : { loading: 'Wait for the draft and prefill to load.', composition: 'Finish text composition first.', picker: 'Finish or cancel file selection first.', link: 'Apply or close the link editor first.', queue: 'Save or cancel the queued message edit first.', attachment: 'Retry or discard the pending attachments first.', pending: 'Finish the current stop or settings operation first.' }[reason];
    setError(t('Could not switch drafts:') + explanation);
    return false;
  };
  const originalEditIssue = draft.document ? richEditIssue(draft) : textEditIssue(draft);
  const segmented = originalEditIssue === structuredEditIssue && canEditStructuredDraft(draft);
  const editIssue = segmented ? null : originalEditIssue;
  const recoverableLegacy = editIssue && recoverLegacyDraft(draft);
  const plainModeUnavailable = !!draft.document
    && (plainTextSetting.loading || !plainTextSetting.available || !!plainTextSetting.error);
  const textViewDocument = textAgentView.current === composerOwnerKey && draft.document ? readRichDocument(draft.document) : null;
  const textViewProjection = textViewDocument && projectTextAgentDocument(textViewDocument);
  const matchesSavedText = (document: NonNullable<typeof textViewDocument>, text: string) =>
    serializeRichDocument(document) === text || serializePlainDocument(document, true) === text;
  const retainTextHistory = !!textViewDocument && (textViewProjection?.text === draft.text
    || textFormatting && matchesSavedText(textViewDocument, draft.text));
  const textViewValue = retainTextHistory ? textViewProjection?.text ?? draft.text : draft.text;
  const richActive = !!draft.document && !editIssue && !segmented && !retainTextHistory;
  const structuredInput = draft.input !== undefined;
  const selectedSegment = segmentSelection && draft.input?.[segmentSelection.index];
  const segmentText = selectedSegment?.type === 'text' && typeof selectedSegment.text === 'string' && !isStructuredAppInput(selectedSegment)
    ? selectedSegment.text : '';
  const completions = useCompletions(client, context.hostId, context.cwd,
    richActive ? richContext?.text ?? '' : segmented ? segmentText : editIssue ? '' : textFormatting ? textFormatValue : textViewValue,
    richActive ? richContext?.cursor ?? 0 : segmented ? segmentSelection?.cursor ?? 0 : cursor,
    busy, richActive ? 'rich:' + richContext?.blockStart : segmented ? 'segment:' + segmentSelection?.index : 'plain');
  const lookupText = fileLookup ? '@' + fileLookup.text : '';
  const fileResults = useCompletions(client, context.hostId, context.cwd, lookupText, lookupText.length, busy, 'menu-file-lookup');
  const chatHosts = [{ hostId: context.hostId, displayName: hosts?.find(host => host.hostId === context.hostId)?.displayName ?? context.hostId },
    ...(hosts ?? []).filter(host => host.hostId !== context.hostId)]
    .filter((host, index, all) => all.findIndex(item => item.hostId === host.hostId) === index);
  const captureChatSelection = (query?: { start: number; end: number; token: string }, selectedIndex?: number): ChatSelection | null => {
    const originalController = controller, snapshot = originalController.snapshot();
    if (!snapshot || frozenRef.current || pendingLink.current || compositions.current.size) return null;
    const common = { controller: originalController, owner: snapshot.owner, revision: snapshot.revision, cwd: context.cwd };
    if (richActive) {
      const source = richEditor.current;
      const target = source?.captureAgentMentionTarget(() => originalController.snapshot(), query);
      return source && target ? { ...common, isCurrentEditor: () => richEditor.current === source,
        insert: choice => source.insertAgentMention(target, choice) } : null;
    }
    const source = segmented ? structuredEditor.current : editor.current;
    const index = segmented ? selectedIndex ?? segmentSelection?.index : -1;
    if (!source || index === undefined) return null;
    const target = source.captureAgentMentionTarget(index, () => originalController.snapshot(), query);
    return target ? { ...common, isCurrentEditor: () => (segmented ? structuredEditor.current : editor.current) === source,
      insert: choice => source.insertAgentMention(target, choice) } : null;
  };
  const captureDefaultChatSelection = (): ChatSelection | null => {
    if (frozenRef.current || pendingLink.current || compositions.current.size) return null;
    if (richActive) richEditor.current?.focus();
    else {
      const index = segmented ? segmentSelection?.index ?? draft.input?.findIndex(entry => entry.type === 'text' && !isStructuredAppInput(entry)) : -1;
      (segmented ? structuredEditor.current : editor.current)?.focus(index);
      return captureChatSelection(undefined, index);
    }
    return captureChatSelection();
  };
  const makeChatLookup = (selection: ChatSelection, hostId: string, search: string, originalAuthority?: () => void): ChatLookup => {
    if (!originalAuthority && !captureSubmissionAuthority) throw new Error('Chat lookup requires the original conversation authority.');
    const authority = originalAuthority ?? captureSubmissionAuthority!(structuredClone(selection.owner));
    const transport = client as WorkbenchClient & { captureDaemonConnection?: (hostId: string) => { generation: string; assertOriginal(): void } };
    if (typeof transport.captureDaemonConnection !== 'function') throw new Error('Chat lookup requires a confirmed host connection.');
    const connection = transport.captureDaemonConnection(hostId);
    const assertOriginal = () => {
      authority(); connection.assertOriginal();
      const snapshot = selection.controller.snapshot(), source = projectSource.current.context;
      if (activeController.current !== selection.controller || !selection.isCurrentEditor() || !snapshot
        || snapshot.revision !== selection.revision || snapshot.owner.hostId !== selection.owner.hostId
        || snapshot.owner.threadId !== selection.owner.threadId || snapshot.owner.draftId !== selection.owner.draftId
        || source.hostId !== selection.owner.hostId || source.cwd !== selection.cwd
        || frozenRef.current || pendingLink.current || compositions.current.size) {
        throw new Error('The original draft or selection changed; search for the chat again.');
      }
    };
    assertOriginal();
    const lookupClient: WorkbenchClient = {
      rpc<T = unknown>(method: string, params?: Record<string, unknown>, requestedHost?: string, options?: Parameters<WorkbenchClient['rpc']>[3]) {
        if (requestedHost !== hostId) return Promise.reject(new Error('The chat host changed.'));
        try { assertOriginal(); } catch (cause) { return Promise.reject(cause); }
        return client.rpc<T>(method, params, requestedHost, { ...options, daemonConnectionGeneration: connection.generation,
          assertBeforeSend: () => { assertOriginal(); options?.assertBeforeSend?.(); } });
      },
      host: client.host.bind(client), subscribe: client.subscribe.bind(client), reply: client.reply.bind(client),
    };
    return { id: ++chatSequence.current, selection, client: lookupClient, hostId, search, assertOwner: authority, assertOriginal };
  };
  const reportChatSnapshot = useCallback((snapshot: ChatLookupSnapshot) => setChatSnapshot(snapshot), []);
  const chatQuery = completions.query?.kind === 'file' && !completions.query.directory ? completions.query : null;
  useLayoutEffect(() => {
    setChatIndex(-1); setChatError('');
    if (!chatQuery) { setChatCompletion(null); return; }
    const selection = captureChatSelection(chatQuery);
    if (!selection) { setChatCompletion(null); return; }
    try { setChatCompletion(makeChatLookup(selection, context.hostId, chatQuery.term)); }
    catch (cause) { setChatCompletion(null); setChatError(message(cause)); }
  }, [client, controller, captureSubmissionAuthority, context.hostId, context.cwd,
    chatQuery?.start, chatQuery?.end, chatQuery?.token, richContext?.text, richContext?.blockStart, richActive, segmented, segmentSelection?.index]);
  useLayoutEffect(() => {
    const menu = inputRoot.current?.querySelector<HTMLDetailsElement>('.standalone-composer__add[open]');
    if (menu) positionComposerMenu(menu);
  }, [fileLookup, fileResults.items, fileResults.loading, fileResults.error, chatLookup]);
  const onRichContext = useCallback((next: RichCompletionContext | null) => {
    if (next) lastRichContext.current = next;
    const editor = richEditor.current, snapshot = controller.snapshot();
    if (editor && snapshot && !frozenRef.current && !pendingLink.current && !compositions.current.size) {
      const originalController = controller, target = editor.captureAgentMentionTarget(() => originalController.snapshot());
      if (target) lastChatSelection.current = { controller: originalController, isCurrentEditor: () => richEditor.current === editor,
        insert: choice => editor.insertAgentMention(target, choice), owner: snapshot.owner,
        revision: snapshot.revision, cwd: projectSource.current.context.cwd };
    }
    setRichContext(previous => previous?.text === next?.text && previous?.cursor === next?.cursor && previous?.blockStart === next?.blockStart ? previous : next);
  }, [controller]);
  useEffect(() => {
    if (!appliedOptions) return;
    const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
    const baseline = appliedOptions.baseline, next = { ...appliedOptions.changes };
    const sandboxChanged = !same(initialOptions?.sandboxMode, baseline.sandboxMode)
      || sandboxKey(initialOptions?.sandboxPolicy) !== sandboxKey(baseline.sandboxPolicy)
      || !same(initialOptions?.permissionProfileId, baseline.permissionProfileId);
    const cleared: (keyof SubmitOptions)[] = [];
    let changed = false;
    for (const field of Object.keys(next) as (keyof SubmitOptions)[]) {
      const local = Object.hasOwn(overrides, field) && same(overrides[field], next[field]);
      const authoritativeChanged = field === 'sandboxMode' || field === 'sandboxPolicy' || field === 'permissionProfileId'
        ? sandboxChanged : !same(initialOptions?.[field], baseline[field]);
      if (!local || authoritativeChanged) {
        if (local) cleared.push(field);
        delete next[field]; changed = true;
      }
    }
    if (!changed) return;
    if (cleared.length) setOverrides(previous => {
      const result = { ...previous };
      for (const field of cleared) if (same(result[field], appliedOptions.changes[field])) delete result[field];
      return result;
    });
    setAppliedOptions(Object.keys(next).length ? { ...appliedOptions, changes: next } : null);
  }, [appliedOptions, initialOptions, overrides]);

  useLayoutEffect(() => {
    mounted.current = true;
    activeController.current = controller;
    return () => {
      if (activeController.current === controller) activeController.current = null;
      mounted.current = false;
      for (const resolve of thawWaiters.current) resolve();
      thawWaiters.current.clear();
    };
  }, [controller]);
  useLayoutEffect(() => {
    const input = picker.current;
    const cancel = () => { pickerOpen.current = false; };
    input?.addEventListener('cancel', cancel);
    return () => input?.removeEventListener('cancel', cancel);
  }, []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (uploadsInFlight.current || failedUploads.current.length) event.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  const removeReference = async (reference: ComposerReference) => {
    if (pendingReferences.current.get(reference.id) === controller) return;
    const externalOperation = onRemoveReference ? controller.beginExternalOperation(owner) : null;
    const finish = onRemoveReference ? null : beginOperation();
    if (!externalOperation && !finish) return;
    let success = false;
    pendingReferences.current.set(reference.id, controller);
    setRemoving(previous => ({ controller, ids: new Set([...(previous?.controller === controller ? previous.ids : []), reference.id]) }));
    setError('');
    try {
      const result = externalOperation ? await onRemoveReference?.(structuredClone(owner), structuredClone(reference), externalOperation) : undefined;
      if (result !== 'handled' && !await updateDraftFromOperation(owner, value => ({ ...value, references: (value.references ?? []).filter(item =>
        item.id !== reference.id || JSON.stringify(item) !== JSON.stringify(reference)) }))) throw new Error('Draft owner changed');
      success = true;
    } catch (reason) {
      if (activeController.current === controller) setError(t('Could not remove reference; draft retained:') + message(reason));
    } finally {
      if (pendingReferences.current.get(reference.id) === controller) pendingReferences.current.delete(reference.id);
      if (activeController.current === controller) setRemoving(previous => {
        if (previous?.controller !== controller) return previous;
        const ids = new Set(previous.ids); ids.delete(reference.id);
        return ids.size ? { controller, ids } : null;
      });
      if (externalOperation) externalOperation.finish(success); else finish?.(success);
    }
  };
  useEffect(() => {
    if (!prefill || !loaded || frozen) return;
    if (current.current.prefills.includes(prefill.id)) {
      void lastWrite.current.then(saved => { if (saved && activeController.current === controller) onPrefillConsumed?.(prefill.id); });
      return;
    }
    void changeDraft(value => mergePrefill(value, prefill.draft), prefill.id)
      .then(saved => { if (saved && activeController.current === controller) onPrefillConsumed?.(prefill.id); });
    requestAnimationFrame(() => { if (richEditor.current) richEditor.current.focus(); else if (structuredEditor.current) structuredEditor.current.focus(); else editor.current?.focus(); });
  }, [prefill, changeDraft, onPrefillConsumed, storageError, controller, current, lastWrite, loaded, frozen]);

  const addFiles = (files: File[], retainIfBlocked = true): boolean => {
    if (!files.length || editIssue) return false;
    const finish = beginOperation();
    if (!finish) {
      if (retainIfBlocked && activeController.current === controller) {
        updateFailedUploads([...failedUploads.current, { id: createId(), files }]);
        setError(locale.toLowerCase().startsWith('zh') ? '附件等待当前操作结束后重试。' : 'Retry the attachment after the current operation.');
      }
      return false;
    }
    uploadsInFlight.current++; setUploading(true); setError('');
    const run = async () => {
      let success = false, index = 0;
      try {
        for (; index < files.length; index++) {
          const added = await importAttachments(client, context.hostId, [files[index]!]);
          if (activeController.current !== controller) return;
          const saved = await changeDraftFromOperation(previous => ({ ...previous, images: [...previous.images, ...added.images], files: [...previous.files, ...added.files] }));
          if (!saved) { index++; throw new Error('Draft could not be saved'); }
        }
        success = true;
      } catch (reason) {
        if (activeController.current === controller) {
          const remaining = files.slice(index);
          if (remaining.length) updateFailedUploads([...failedUploads.current, { id: createId(), files: remaining }]);
          setError(t('Image upload failed:') + message(reason));
        }
      } finally {
        uploadsInFlight.current--;
        if (mounted.current) setUploading(uploadsInFlight.current > 0);
        finish(success);
      }
    };
    uploadQueue.current = uploadQueue.current.then(run, run);
    return true;
  };
  const paste = (event: TextPasteEvent) => {
    const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    if (editIssue || event.clipboardData.getData('text/plain')) {
      setError(t('The content cannot be pasted together with images.')); return;
    }
    void addFiles(files);
  };
  const submit = async (followUp: FollowUpAction = preferredFollowUp) => {
    if (readOnly || submitInFlight.current || uploadsInFlight.current || failedUploads.current.length || unresolved || !hasContent(current.current.draft)) return;
    if (busy && followUp === 'queue' && !queueAvailable) return;
    if (pendingLink.current) { setError(t('Apply or close the link editor first.')); return; }
    if (pendingComposition.current) { setError(locale.toLowerCase().startsWith('zh') ? '请先完成输入法输入。' : 'Finish text composition first.'); return; }
    const shownDocument = current.current.draft.document;
    if (shownDocument && (textFormatting && !editor.current?.matchesDocument(shownDocument)
      || richActive && !richEditor.current?.matchesDocument(shownDocument))) {
      setError(locale.toLowerCase().startsWith('zh') ? '草稿视图正在更新，请核对后发送。' : 'The draft view is updating. Review it before sending.'); return;
    }
    if (defaultPending) { setError(t('Resolve the default model change before sending.')); return; }
    const currentIssue = current.current.draft.document && richEditIssue(current.current.draft);
    if (current.current.draft.blocked || currentIssue && !(currentIssue === structuredEditIssue
      && canEditStructuredDraft(current.current.draft))) {
      setError(t('This draft cannot be sent without losing content.')); return;
    }
    const readyPlainTextMode = plainTextSetting.readyValue();
    if (current.current.draft.document && readyPlainTextMode === undefined) {
      setError(t('Could not read plain text preference:') + (plainTextSetting.error ?? t('Loading...'))); return;
    }
    if (busy && followUp === 'queue' && (current.current.draft.hints?.length || current.current.draft.references.some(reference => reference.context !== undefined || reference.original !== undefined))) {
      setError(t('The queue cannot retain this draft context.')); return;
    }
    if (busy && !context.threadId) { setError(t('The conversation has not been created yet.')); return; }
    let action: SubmitAction;
    if (!busy) action = { type: 'send' };
    else if (followUp === 'queue') action = { type: 'queue' };
    else {
      if (!activeTurnId) { setError(t('Current task has no confirmed turn ID')); return; }
      action = { type: 'steer', turnId: activeTurnId };
    }
    const sourceDocument = current.current.draft.document && readRichDocument(current.current.draft.document);
    const plainAgentSource = !!sourceDocument && isPlainTextAgentDocument(sourceDocument, current.current.draft.text);
    const documentPlainTextMode = plainAgentSource || (readyPlainTextMode ?? plainTextSetting.value);
    try {
      // This ID only validates the payload; the parent owns the durable call ID.
      const prepared = prepareDraftInput(current.current.draft, context.hostId,
        { plainTextMode: documentPlainTextMode, callId: 'composer-preflight' });
      if (action.type !== 'send') {
        if (prepared.responseItems.length) throw new Error('此 app 上下文须在会话空闲时发送，不能排队或追加当前任务。');
        draftToInput(current.current.draft, context.hostId, { plainTextMode: documentPlainTextMode });
      }
    }
    catch (reason) { setError(message(reason)); return; }
    let assertAuthority: (() => void) | undefined;
    try { assertAuthority = captureSubmissionAuthority?.(structuredClone(owner)); }
    catch (reason) { setError(t('Could not send; draft retained:') + message(reason)); return; }
    const captured = structuredClone(current.current);
    const submittedOptions = structuredClone(options), submittedOverrides = structuredClone(overrides);
    const finishPreparation = beginOperation();
    if (!finishPreparation) return;
    submitInFlight.current = true; setSending(true); setError('');
    let confirmed = false, submittedToParent = false;
    try {
      const submitted: ComposerDraft = captured.draft;
      let retained = false;
      try { retained = await retain(captured); } finally { finishPreparation(retained); }
      if (!retained) throw new Error(t('Could not persist the submitted version.'));
      if (activeController.current !== controller) return;
      if (pendingLink.current) { setError(t('Apply or close the link editor first.')); return; }
      try { assertAuthority?.(); }
      catch (reason) { setError(t('Could not send; draft retained:') + message(reason)); return; }
      submittedToParent = true;
      await onSubmit(submitted, submittedOptions, action, { owner: structuredClone(owner), revision: captured.revision,
        overrides: submittedOverrides, ...(submitted.document ? { documentPlainTextMode } : {}) }, assertAuthority);
      confirmed = true;
      while (frozenRef.current && activeController.current === controller) {
        await new Promise<void>(resolve => thawWaiters.current.add(resolve));
      }
      if (activeController.current !== controller) return;
      if (mounted.current && action.type === 'send' && Object.keys(submittedOverrides).length) {
        setAppliedOptions({ changes: submittedOverrides, baseline: { ...initialOptions } });
      }
      if (busy && followUp === 'queue' && mounted.current) setQueueVersion(value => value + 1);
      const finishCleanup = beginOperation();
      if (!finishCleanup) return;
      let cleaned = false;
      try { await clear(captured.revision); cleaned = true; }
      finally { finishCleanup(cleaned); }
      if (mounted.current) requestAnimationFrame(() => { if (richEditor.current) richEditor.current.focus(); else if (structuredEditor.current) structuredEditor.current.focus(); else editor.current?.focus(); });
    } catch (reason) {
      if (activeController.current === controller) {
        if (busy && context.threadId) setQueueVersion(value => value + 1);
        setError(t(confirmed ? 'Sent, but draft cleanup failed:' : submittedToParent ? 'Send result:' : 'Send unconfirmed; draft retained:') + message(reason));
      }
    } finally { submitInFlight.current = false; if (mounted.current) setSending(false); }
  };
  const projectCompletionSkills = (next: typeof draft, change?: TextSkillChange) => {
    if (!change) return next;
    const identity = (skill: { name: string; path: string }) => JSON.stringify([skill.name, skill.path]);
    const managed = new Set([...change.before, ...change.after].filter(skill => skill.managed).map(identity));
    const skills = next.skills.filter(skill => !managed.has(identity(skill)) || change.after.some(item => item.managed && identity(item) === identity(skill)));
    for (const skill of change.after) if (skill.managed && !skills.some(item => identity(item) === identity(skill))) {
      skills.push({ name: skill.name, path: skill.path });
    }
    return { ...next, skills };
  };
  const agentsForDraft = (value: typeof draft): Map<number, TextAgentSpan[]> => {
    const document = value.document && readRichDocument(value.document), projection = document && projectTextAgentDocument(document);
    const result = new Map<number, TextAgentSpan[]>();
    if (!document || !projection?.agents.length || projection.text !== value.text
      && !(textFormatting && matchesSavedText(document, value.text))) return result;
    const entries = segmented && value.input ? value.input.flatMap((entry, index) => entry.type === 'text' && typeof entry.text === 'string'
      ? [{ index, text: entry.text }] : []) : [{ index: -1, text: projection.text }];
    const spans = textAgentSegments(document, entries.map(entry => entry.text));
    if (spans) entries.forEach((entry, index) => result.set(entry.index, spans[index]!));
    return result;
  };
  const agentSegments = richActive ? new Map<number, TextAgentSpan[]>() : agentsForDraft(draft);
  const marksForDraft = (value: typeof draft): Map<number, TextMarkSpan[]> => {
    const document = value.document && readRichDocument(value.document), projection = document && projectTextAgentDocument(document);
    const result = new Map<number, TextMarkSpan[]>();
    if (!document || !projection || projection.text !== value.text
      && !(textFormatting && matchesSavedText(document, value.text))) return result;
    const entries = segmented && value.input ? value.input.flatMap((entry, index) => entry.type === 'text' && typeof entry.text === 'string'
      ? [{ index, text: entry.text }] : []) : [{ index: -1, text: projection.text }];
    let offset = 0;
    for (const entry of entries) {
      const start = offset, end = start + entry.text.length;
      result.set(entry.index, projection.tokens.flatMap(token => {
        const left = Math.max(start, token.start), right = Math.min(end, token.end);
        return left < right ? [{ start: left - start, end: right - start, marks: token.node?.marks.map(mark => mark.toJSON()) ?? [] }] : [];
      }));
      offset = end + 1;
    }
    return result;
  };
  const markSegments = richActive ? new Map<number, TextMarkSpan[]>() : marksForDraft(draft);
  const projectAgentEdit = (before: typeof draft, next: typeof draft, agents?: TextAgentChange, inputType?: string): typeof draft | null => {
    if (!agents || ![...agents.before, ...agents.after].some(segment => segment.agents.length)) return next;
    const entries = segmented && next.input ? next.input.flatMap((entry, index) => entry.type === 'text' && typeof entry.text === 'string'
      ? [{ index, text: entry.text }] : []) : [{ index: -1, text: next.text }];
    let offset = 0;
    const spans: TextAgentSpan[] = [], marks: TextMarkSpan[] = [];
    for (const entry of entries) {
      const segment = agents.after.find(value => value.index === entry.index);
      if (!segment || segment.text !== entry.text) return null;
      const original = segmented ? next.input?.[entry.index] : undefined;
      if (original && segment.agents.length && original.text_elements !== undefined) {
        if (!Array.isArray(original.text_elements)) return null;
        const encoder = new TextEncoder();
        const ranges = segment.agents.map(agent => ({ start: encoder.encode(entry.text.slice(0, agent.start)).length,
          end: encoder.encode(entry.text.slice(0, agent.end)).length }));
        if (original.text_elements.some(element => {
          if (!element || typeof element !== 'object' || Array.isArray(element)) return true;
          const range = (element as { byteRange?: unknown }).byteRange;
          if (!range || typeof range !== 'object' || Array.isArray(range)) return true;
          const { start, end } = range as { start?: unknown; end?: unknown };
          return typeof start !== 'number' || typeof end !== 'number' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
            || start < 0 || end < start || end > encoder.encode(entry.text).length
            || ranges.some(agent => start < agent.end && end > agent.start || start === end && start > agent.start && start < agent.end);
        })) return null;
      }
      spans.push(...segment.agents.map(agent => ({ ...agent, start: agent.start + offset, end: agent.end + offset })));
      marks.push(...segment.marks.map(mark => ({ ...mark, start: mark.start + offset, end: mark.end + offset })));
      offset += entry.text.length + 1;
    }
    const originalAgents = agentsForDraft(before), originalMarks = marksForDraft(before);
    const verifiedSuffixDeletion = inputType === 'historyUndo' && !!before.document && before.text.startsWith(next.text)
      && before.text.length > next.text.length && agents.before.length === agents.after.length && agents.after.every(after => {
        const previous = agents.before.find(segment => segment.index === after.index);
        const item = segmented ? before.input?.[after.index] : undefined;
        const originalText = segmented ? item?.type === 'text' && typeof item.text === 'string' ? item.text : null : before.text;
        const marks = originalMarks.get(after.index);
        return !!previous && originalText !== null && !!marks && unchangedHistoryPrefix(previous, after)
          && unchangedHistoryPrefix(previous, { index: after.index, text: originalText,
            agents: originalAgents.get(after.index) ?? [], marks });
      });
    const document = updateTextAgentDocument(before.document, before.text, next.text, spans, verifiedSuffixDeletion);
    const marked = document && applyTextAgentMarks(document, marks);
    return marked ? { ...next, document: marked } : null;
  };
  promptAppendRuntime.current = {
    controller, owner, cwd: context.cwd, enabled: !readOnly && loaded && !editIssue && !unresolved,
    editor: () => richActive ? richEditor.current : segmented ? structuredEditor.current : editor.current,
    prepare(beforeValue, addition, originalEditor) {
      const before = normalizeDraft(beforeValue), source = before.document ?? documentFromText(before.text);
      if (segmented) {
        if (!canEditStructuredDraft(before) || !('visibleText' in originalEditor)) return null;
        const entries = before.input?.flatMap((entry, index) => entry.type === 'text' && typeof entry.text === 'string'
          ? [{ index, text: entry.text }] : []) ?? [];
        const last = entries.at(-1);
        if (!last) return null;
        const stage = originalEditor.preparePromptAppend(source, addition, last.index);
        if (!stage?.agents) return null;
        const expectedAgents = agentsForDraft(before), expectedMarks = marksForDraft(before);
        for (const entry of entries) {
          const displayed = stage.agents.before.find(segment => segment.index === entry.index);
          if (!displayed || displayed.text !== entry.text
            || JSON.stringify(displayed.agents) !== JSON.stringify(expectedAgents.get(entry.index) ?? [])) return null;
          const marks = expectedMarks.get(entry.index);
          if (marks ? JSON.stringify(displayed.marks) !== JSON.stringify(marks)
            : displayed.marks.some(mark => mark.marks.length)) return null;
        }
        const { document: _document, ...withoutDocument } = before;
        const hasAgents = [...stage.agents.before, ...stage.agents.after].some(segment => segment.agents.length);
        const edited = editStructuredDraftText(hasAgents ? withoutDocument : before, last.index, last.text, stage.text);
        const projected = edited.draft && projectAgentEdit(before, edited.draft, stage.agents);
        return projected ? { draft: projected, stage, textControl: false, index: last.index } : null;
      }
      if (before.document ? richEditIssue(before) : textEditIssue(before)) return null;
      const stage = originalEditor.preparePromptAppend(source, addition);
      if (!stage?.document) return null;
      const updated = updateRichDraft(before.document ? before : { ...before, document: source }, stage.document);
      if (updated.document !== stage.document) return null;
      return { draft: updated, stage, textControl: 'visibleText' in originalEditor };
    },
  };
  if (!promptAppendPort.current) {
    promptAppendPort.current = { begin(requestedOwner, assertOriginal) {
      const runtime = promptAppendRuntime.current;
      if (!runtime?.enabled || frozenRef.current || activeController.current !== runtime.controller
        || requestedOwner.hostId !== runtime.owner.hostId || requestedOwner.threadId !== runtime.owner.threadId
        || requestedOwner.draftId !== runtime.owner.draftId) return null;
      const source = runtime.editor();
      if (!source) return null;
      assertOriginal();
      const capturedOwner = structuredClone(runtime.owner), capturedCwd = runtime.cwd;
      const operation = runtime.controller.beginExternalOperation(capturedOwner);
      if (!operation) return null;
      let ended = false, running = false, used = false, cancelled = false;
      const verify = () => {
        assertOriginal();
        const next = promptAppendRuntime.current, location = projectSource.current.context;
        if (cancelled || !next?.enabled || next.controller !== runtime.controller || next.editor() !== source
          || activeController.current !== runtime.controller || location.hostId !== capturedOwner.hostId || location.cwd !== capturedCwd
          || next.owner.threadId !== capturedOwner.threadId || next.owner.draftId !== capturedOwner.draftId) {
          throw new Error('The original composer or its authority changed.');
        }
      };
      return {
        async append(addition, prefillId) {
          if (ended || used) throw new Error('This prompt append has already ended.');
          used = true; running = true;
          let accepted = false;
          try {
            const captured = structuredClone(addition);
            let prepared: ReturnType<PromptAppendRuntime['prepare']> = null, duplicate = false;
            const receipt = await operation.transaction(async (before, isCurrent) => {
              verify();
              if (!isCurrent()) throw new Error('The original draft changed before the append.');
              const outcome = await updateBrowserAtoms(atoms => {
                verify();
                if (!isCurrent()) throw new Error('The original draft changed before it was saved.');
                const result = updateComposerDraftVersionInRoot(atoms[composerDraftAtomKey], before, draft => {
                  prepared = runtime.prepare(draft, captured, source);
                  if (!prepared) throw new Error('This prompt cannot be appended without changing the original draft.');
                  return prepared.draft;
                }, createId(), prefillId);
                if (result.duplicate) return { value: { after: result.after, duplicate: true } };
                if (!result.changed) throw new Error('The prompt append did not change the draft.');
                return { value: { after: result.after, duplicate: false }, updates: { [composerDraftAtomKey]: result.root } };
              });
              duplicate = outcome.duplicate;
              return { after: outcome.after, value: duplicate };
            }, () => {
              verify();
              if (duplicate) return true;
              if (!prepared || !prepared.stage.apply()) return false;
              if (prepared.textControl) {
                textAgentView.current = composerOwnerKey;
                setTextFormattingOwner(composerOwnerKey);
                setTextFormatValue(prepared.stage.text);
              }
              return true;
            });
            accepted = receipt.accepted;
            if (accepted && !receipt.value) requestAnimationFrame(() => {
              if (activeController.current !== runtime.controller || promptAppendRuntime.current?.editor() !== source) return;
              if ('visibleText' in source) source.focus(prepared?.index); else source.focus();
            });
            return { status: accepted ? 'accepted' as const : 'committed-unaccepted' as const };
          } catch (reason) {
            if (activeController.current === runtime.controller) setError(t('Could not switch drafts:') + message(reason));
            throw reason;
          } finally {
            running = false;
            if (!ended) { ended = true; operation.finish(accepted); }
          }
        },
        cancel() {
          cancelled = true;
          if (!running && !ended) { ended = true; operation.finish(false); }
        },
      };
    } };
  }
  useLayoutEffect(() => {
    const port = promptAppendPort.current;
    if (port) onPromptAppendPort?.(port);
    return () => onPromptAppendPort?.(null);
  }, [onPromptAppendPort]);
  const editSegment = (index: number, expected: string, text: string, inputType?: string, skills?: TextSkillChange, agents?: TextAgentChange) => {
    if (frozenRef.current) return false;
    if (expected !== text || inputType === 'historyUndo' || inputType === 'historyRedo') completions.show();
    const before = current.current.draft;
    const hasAgents = agents && [...agents.before, ...agents.after].some(segment => segment.agents.length);
    const { document: _document, ...withoutDocument } = before;
    const result = editStructuredDraftText(hasAgents ? withoutDocument : before, index, expected, text);
    if (!result.draft) { setError(translateKnown(t, result.error)); return false; }
    const next = projectAgentEdit(before, projectCompletionSkills(result.draft, skills), agents, inputType);
    if (!next) { setError('The chat reference cannot be inserted without changing retained formatting or input.'); return false; }
    setError('');
    void changeDraft(value => value === before ? next : value);
    return current.current.draft === next;
  };
  const removeImage = (id: string) => {
    const before = current.current.draft;
    const result = before.input ? removeStructuredImage(before, id)
      : { draft: { ...before, images: before.images.filter(image => image.id !== id) } };
    if (!result.draft) { setError(translateKnown(t, result.error)); return; }
    setError(''); setSegmentSelection(null); void changeDraft(value => value === before ? result.draft : value);
  };
  const removeSkill = (name: string, path: string) => {
    if (frozenRef.current) return;
    const original = current.current.draft;
    const checked = original.input ? removeStructuredSkill(original, name, path) : { draft: original };
    if (!checked.draft) { setError(translateKnown(t, checked.error)); return; }
    structuredEditor.current?.removeSkill(name, path);
    editor.current?.removeSkill(name, path);
    const before = current.current.draft;
    const next = { ...checked.draft, skills: before.skills.filter(skill => skill.name !== name || skill.path !== path) };
    setError(''); setSegmentSelection(null); void changeDraft(value => value === before ? next : value);
  };
  const chooseCompletion = (item: Completion) => {
    const query = completions.query;
    if (!query) return;
    if (richActive) {
      if (!richContext || !richEditor.current?.insertCompletion(richContext, query, item, context.cwd)) {
        completions.dismiss(); return;
      }
      if (item.kind === 'directory') completions.show(); else completions.dismiss();
      requestAnimationFrame(() => { if (item.kind === 'command') focusModelPicker(); else richEditor.current?.focus(); });
      return;
    }
    if (textFormatting) {
      if (!editor.current?.insertRichCompletion(query, item, context.cwd)) { completions.dismiss(); return; }
      if (item.kind === 'directory') completions.show(); else completions.dismiss();
      requestAnimationFrame(() => { if (item.kind === 'command') focusModelPicker(); else editor.current?.focus(); });
      return;
    }
    let replacement = '';
    if (item.kind === 'directory') replacement = '@' + item.path + '/';
    else if (item.kind === 'file') {
      const path = context.cwd.replace(/\/$/, '') + '/' + item.path;
      const longest = Math.max(0, ...Array.from(path.matchAll(/`+/g), match => match[0].length));
      const fence = '`'.repeat(longest + 1);
      replacement = fence + path + fence + ' ';
    }
    const caret = query.start + replacement.length;
    if (segmented) {
      const index = segmentSelection?.index, before = current.current.draft;
      const entry = index === undefined ? undefined : before.input?.[index];
      if (index === undefined || entry?.type !== 'text' || typeof entry.text !== 'string'
        || entry.text.slice(query.start, query.end) !== query.token) { completions.dismiss(); return; }
      const end = completionEnd(entry.text, query.end, query.token);
      const { document: _document, ...withoutDocument } = before;
      const result = editStructuredDraftText(agentSegments.size ? withoutDocument : before, index, entry.text,
        entry.text.slice(0, query.start) + replacement + entry.text.slice(end));
      if (!result.draft) { setError(translateKnown(t, result.error)); completions.dismiss(); return; }
      const after = entry.text.slice(0, query.start) + replacement + entry.text.slice(end);
      const existing = structuredEditor.current?.skills() ?? [];
      const skill = item.kind === 'skill' ? { name: item.name, path: item.path,
        managed: existing.some(value => value.managed && value.name === item.name && value.path === item.path)
          || !before.skills.some(value => value.name === item.name && value.path === item.path)
          && !before.input?.some(value => value.type === 'skill' && value.name === item.name && value.path === item.path) } : undefined;
      if (!structuredEditor.current?.replace(index, query.start, end, replacement, skill)
        || current.current.draft.input?.[index]?.text !== after) {
        setError(t('Could not insert completion.')); completions.dismiss(); return;
      }
      setSegmentSelection({ index, cursor: caret });
      if (item.kind === 'directory') completions.show(); else completions.dismiss();
      if (item.kind === 'command') focusModelPicker(); else structuredEditor.current?.focus(index, caret);
      return;
    }
    const before = current.current.draft;
    if (before.text.slice(query.start, query.end) !== query.token) { completions.dismiss(); return; }
    const end = completionEnd(before.text, query.end, query.token);
    const after = before.text.slice(0, query.start) + replacement + before.text.slice(end);
    const control = editor.current;
    const { document: _document, ...withoutDocument } = before;
    if (!control || updateDraftText(agentSegments.size ? withoutDocument : before, after).text !== after) { completions.dismiss(); return; }
    const existing = control.skills();
    const skill = item.kind === 'skill' ? { name: item.name, path: item.path,
      managed: existing.some(value => value.managed && value.name === item.name && value.path === item.path)
        || !before.skills.some(value => value.name === item.name && value.path === item.path)
        && !before.input?.some(value => value.type === 'skill' && value.name === item.name && value.path === item.path) } : undefined;
    if (!control.replace(-1, query.start, end, replacement, skill) || current.current.draft.text !== after) {
      setError(t('Could not insert completion.')); completions.dismiss(); return;
    }
    setCursor(caret);
    if (item.kind === 'directory') completions.show(); else completions.dismiss();
    if (item.kind === 'command') focusModelPicker();
    else editor.current?.focus(-1, caret);
  };
  const chooseLookupFile = (item: Completion) => {
    const lookup = fileLookup;
    if (!lookup || item.kind !== 'file' && item.kind !== 'directory') return;
    if (!item.path || item.path.startsWith('/') || item.path.includes('\\') || item.path.split('/').some(part => !part || part === '.' || part === '..')) {
      setError(locale.toLowerCase().startsWith('zh') ? '文件路径无效。' : 'The file path is invalid.'); return;
    }
    if (item.kind === 'directory') { setFileLookup({ ...lookup, text: item.path + '/' }); return; }
    const source = projectSource.current.context;
    if (source.hostId !== lookup.hostId || source.cwd !== lookup.cwd || activeController.current !== controller
      || current.current.revision !== lookup.revision || JSON.stringify(current.current.draft) !== JSON.stringify(lookup.draft)
      || frozenRef.current || pendingLink.current || compositions.current.size || editIssue) {
      setError(locale.toLowerCase().startsWith('zh') ? '输入内容已改变，请重新查找文件。' : 'The draft changed; search for the file again.'); return;
    }
    if (richActive) {
      const rich = lookup.rich;
      if (!rich || /^[^\s@$\/\ufffc]/.test(rich.text.slice(rich.cursor))
        || !richEditor.current?.insertCompletion(rich, { start: rich.cursor, end: rich.cursor, token: '' }, item, lookup.cwd)) {
        setError(locale.toLowerCase().startsWith('zh') ? '请在可安全插入的位置重新查找文件。' : 'Search again from a safe insertion point.'); return;
      }
      setFileLookup(null);
      const menu = inputRoot.current?.querySelector<HTMLDetailsElement>('.standalone-composer__add');
      if (menu) menu.open = false;
      requestAnimationFrame(() => richEditor.current?.focus()); return;
    }
    if (textFormatting) {
      const control = editor.current, position = lookup.cursor;
      if (!control || /^[^\s@$\/\ufffc]/.test(control.visibleText().slice(position))
        || !control.insertRichCompletion({ start: position, end: position, token: '' }, item, lookup.cwd)) {
        setError(locale.toLowerCase().startsWith('zh') ? '请在可安全插入的位置重新查找文件。' : 'Search again from a safe insertion point.'); return;
      }
      setFileLookup(null);
      const menu = inputRoot.current?.querySelector<HTMLDetailsElement>('.standalone-composer__add');
      if (menu) menu.open = false;
      requestAnimationFrame(() => control.focus()); return;
    }
    const path = lookup.cwd.replace(/\/$/, '') + '/' + item.path;
    const fence = '`'.repeat(Math.max(0, ...Array.from(path.matchAll(/`+/g), match => match[0].length)) + 1);
    const replacement = fence + path + fence + ' ';
    const control = segmented ? structuredEditor.current : editor.current;
    const index = segmented ? lookup.segment?.index : -1;
    const position = segmented ? lookup.segment?.cursor : lookup.cursor;
    if (index === undefined || position === undefined || !control?.replace(index, position, position, replacement)) {
      setError(t('Could not insert completion.')); return;
    }
    setFileLookup(null);
    const menu = inputRoot.current?.querySelector<HTMLDetailsElement>('.standalone-composer__add');
    if (menu) menu.open = false;
    requestAnimationFrame(() => control.focus(index, position + replacement.length));
  };
  const chooseChat = (lookup: ChatLookup, choice: ChatChoice, fromMenu: boolean) => {
    try {
      setError('');
      lookup.assertOriginal();
      if (choice.hostId !== lookup.hostId || !lookup.selection.insert(choice)) {
        throw new Error('The original draft or selection changed; search for the chat again.');
      }
      setError(''); setChatError(''); lastChatSelection.current = null;
      if (fromMenu) {
        setChatLookup(null);
        const menu = inputRoot.current?.querySelector<HTMLDetailsElement>('.standalone-composer__add');
        if (menu) menu.open = false;
      } else { completions.dismiss(); setChatCompletion(null); }
    } catch (cause) { setError(previous => previous || message(cause)); }
  };
  const completionChats = chatCompletion && chatSnapshot?.key === String(chatCompletion.id) ? chatSnapshot.items : [];
  const effectiveChatIndex = chatIndex >= 0 && chatIndex < completionChats.length ? chatIndex
    : !completions.items.length && completionChats.length ? 0 : -1;
  const selectedCompletion = effectiveChatIndex >= 0 ? completions.items.length + effectiveChatIndex : completions.selected;
  const keyDown = (event: globalThis.KeyboardEvent): boolean => {
    if (frozenRef.current) { event.preventDefault(); return true; }
    if (compositions.current.has('editor') || event.isComposing || event.keyCode === 229) return false;
    if (completions.query) {
      if (event.key === 'Escape') { event.preventDefault(); completions.dismiss(); return true; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const total = completions.items.length + completionChats.length;
        if (total) {
          event.preventDefault();
          const next = (Math.max(0, selectedCompletion) + (event.key === 'ArrowDown' ? 1 : -1) + total) % total;
          if (next < completions.items.length) { setChatIndex(-1); completions.select(next); }
          else setChatIndex(next - completions.items.length);
          return true;
        }
        return false;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (effectiveChatIndex >= 0 && completionChats[effectiveChatIndex] && chatCompletion) {
          event.preventDefault(); chooseChat(chatCompletion, completionChats[effectiveChatIndex]!, false); return true;
        }
        const selected = completions.items[completions.selected];
        if (selected) { event.preventDefault(); chooseCompletion(selected); return true; }
        if (event.key === 'Enter' && (completions.loading || !!chatCompletion && chatSnapshot?.key !== String(chatCompletion.id)
          || chatSnapshot?.key === String(chatCompletion?.id) && chatSnapshot.loading)) { event.preventDefault(); return true; }
      }
    }
    if (event.key !== 'Enter' || event.altKey || event.repeat || enterSetting.pending || enterSetting.error) return false;
    const modifier = event.ctrlKey || event.metaKey;
    if (busy && modifier && (enterSetting.value === 'enter' ? !event.shiftKey : event.shiftKey)) {
      if (!queueAvailable || followUpSetting.pending || followUpSetting.error) return false;
      event.preventDefault(); void submit(followUpSetting.value === 'queue' ? 'steer' : 'queue'); return true;
    }
    if (event.shiftKey || busy && queueAvailable && (followUpSetting.pending || followUpSetting.error)) return false;
    const needsModifier = enterSetting.value === 'cmdAlways' || enterSetting.value === 'cmdIfMultiline' && draft.text.includes('\n');
    if (needsModifier ? modifier : !modifier) { event.preventDefault(); void submit(); return true; }
    return false;
  };
  const interrupt = async () => {
    if (interruptInFlight.current) return;
    interruptInFlight.current = true; setInterrupting(true); setError('');
    try { await onInterrupt(); }
    catch (reason) { if (activeController.current === controller) setError(t('Could not stop:') + message(reason)); }
    finally { interruptInFlight.current = false; if (mounted.current) setInterrupting(false); }
  };
  const completionSelectedId = effectiveChatIndex >= 0 ? completions.listId + '-chat-' + effectiveChatIndex
    : completions.selected >= 0 ? completions.listId + '-' + completions.selected : undefined;
  return <div className="standalone-composer">
    <div ref={inputRoot} inert={frozen} aria-busy={frozen || undefined} onKeyDown={event => {
      if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      const menu = (event.target as Element).closest<HTMLDetailsElement>('.standalone-composer__menu[open]');
      if (!menu) return;
      event.preventDefault(); event.stopPropagation(); menu.open = false;
      menu.querySelector<HTMLElement>('summary')?.focus();
    }}>
    {context.threadId && queueAvailable ? <StandaloneQueue key={JSON.stringify([context.hostId, context.threadId])} client={client} hostId={context.hostId} threadId={context.threadId} busy={busy} refreshVersion={queueVersion} onStartQueued={onStartQueued} frozen={frozen}
      captureAuthority={captureSubmissionAuthority ? () => captureSubmissionAuthority(structuredClone(owner)) : undefined}
      dispatchQueueMutation={dispatchQueueMutation}
      beginQueueEdit={removeQueuedOriginal && captureSubmissionAuthority ? () => {
        const capturedOwner = structuredClone(owner);
        const originalAuthority = captureSubmissionAuthority(capturedOwner);
        const operation = controller.beginExternalOperation(capturedOwner);
        if (!operation) return null;
        return { owner: capturedOwner, operation, assertAuthority: originalAuthority,
          removeQueuedOriginal: (entry, assertBeforeSend) => removeQueuedOriginal(entry, originalAuthority, assertBeforeSend) };
      } : undefined}
      onQueueDraftCommitted={(before, after) => controller.acceptCommittedVersion(before, after)}
      beginOperation={beginOperation} onEditStateChange={(editing, pending) => { queueEditState.current = { editing, pending }; }}
      onCompositionChange={value => setComposition('queue', value)} /> : null}
    {onTargetChange || onProjectChange && projectChoices ? <StandaloneTarget client={client} context={context} hosts={hosts} projectDisplay={projectDisplay}
      projectChoices={projectChoices} selectedProjectId={selectedProjectId} disabled={busy || sending || uploading || !!removing || switchingTarget}
      onTargetChange={onTargetChange ? async target => {
        const lease = controller.freeze(owner);
        if (!lease) throw new Error('Draft input is not ready to switch.');
        setSwitchingTarget(true);
        try {
          if (!await lease.flush()) throw new Error('Draft input could not be saved.');
          await onTargetChange(target, lease);
        } finally { lease.release(); if (mounted.current) setSwitchingTarget(false); }
      } : undefined}
      onProjectChange={onProjectChange ? async project => {
        const source = projectSource.current;
        const lease = controller.freeze(owner);
        if (!lease) throw new Error('Draft input is not ready to switch.');
        setSwitchingTarget(true);
        try {
          if (!await lease.flush()) throw new Error('Draft input could not be saved.');
          const next = projectSource.current;
          if (activeController.current !== controller || next.context.hostId !== source.context.hostId || next.context.cwd !== source.context.cwd
            || next.context.threadId !== source.context.threadId || next.context.draftId !== source.context.draftId
            || !next.onProjectChange || next.selectedProjectId !== source.selectedProjectId
            || project && !next.projectChoices?.some(choice => choice.projectId === project.projectId && choice.hostId === project.hostId
              && choice.cwd === project.cwd && choice.name === project.name)) throw new Error('The project selection changed; review it again.');
          await next.onProjectChange(project, lease);
        } finally { lease.release(); if (mounted.current) setSwitchingTarget(false); }
      } : undefined} /> : null}
    <div className="standalone-composer__editor" inert={switchingTarget} aria-busy={switchingTarget || undefined}>
      {conflicts.length ? <div role="status">{t('Other pages or legacy data contain {count} independent drafts.').replace('{count}', new Intl.NumberFormat(locale).format(conflicts.length))}<details><summary>{t('Select draft version')}</summary>
        {conflicts.map(version => <button type="button" disabled={unresolved} key={version.revision} onClick={() => void selectVersion(version.revision)
          .catch(reason => setError(t('Could not switch drafts:') + message(reason)))}>{version.draft.text.slice(0, 80) || t('Draft with attachments or retained data')}</button>)}
      </details></div> : null}
      {draft.pendingDrafts?.length ? <div role="status">{new Intl.NumberFormat(locale).format(draft.pendingDrafts.length)} {t('Contents were retained separately to preserve formatting.')} <button type="button" onClick={() => {
        if (pendingComposition.current) setError(locale.toLowerCase().startsWith('zh') ? '请先完成输入法输入。' : 'Finish text composition first.');
        else if (pendingLink.current) setError(t('Apply or close the link editor first.'));
        else void changeDraft(value => activatePending(value, true));
      }}>{t('Switch draft')}</button></div> : null}
      {draft.images.length || draft.files.length || draft.references.length || draft.skills.length ? <div className="standalone-composer__attachments">
        {draft.images.map(image => <div className="standalone-composer__image" key={image.id}>
          {image.previewSrc ? <img src={image.previewSrc} alt={image.name ?? t('Image attachment')} /> : <span>{t('Image preview unavailable')}</span>}
          <button type="button" title={t('Remove image')} aria-label={t('Remove image') + ' ' + (image.name ?? '')} disabled={!!editIssue} onClick={() => removeImage(image.id)}>×</button>
        </div>)}
        {draft.files.map(file => <div className="standalone-composer__file" key={file.path}>
          <FilePreview client={client} hostId={context.hostId} path={file.path} name={file.name} />
          <button type="button" title={t('Remove file')} aria-label={t('Remove file') + ' ' + file.name} disabled={!!editIssue} onClick={() => changeDraft(value => ({ ...value, files: value.files.filter(item => item.path !== file.path) }))}>×</button>
        </div>)}
        {draft.references.map(reference => <div className="standalone-composer__reference" key={reference.id}>
          {referenceLabel(reference) === reference.text ? <span>{reference.text}</span> :
            <details><summary>{referenceLabel(reference)}</summary><pre>{reference.text}</pre></details>}
          <button type="button" title={t('Remove reference')} aria-label={t('Remove reference')} disabled={!!editIssue || removing?.controller === controller && removing.ids.has(reference.id)} onClick={() => void removeReference(reference)}>×</button>
        </div>)}
        {draft.skills.map(skill => <div className="standalone-composer__reference" key={skill.path}>
          <span>{t('Skill')}：{skill.name}</span><button type="button" title={t('Remove skill')} aria-label={t('Remove skill') + ' ' + skill.name} disabled={!!editIssue} onClick={() => removeSkill(skill.name, skill.path)}>×</button>
        </div>)}
      </div> : null}
      {editIssue ? <div className="standalone-composer__retained" role="status">{localizeDraftIssue(editIssue, t)}
        {recoverableLegacy ? <button type="button" disabled={frozen || !loaded} onClick={() => void changeDraft(value => recoverLegacyDraft(value) ?? value)}>{t('Restore')}</button> : null}
        <details open={!draft.text && !!draft.document || undefined}><summary>{t('View retained content')}</summary><pre>{JSON.stringify({ document: draft.document, input: draft.input, hints: draft.hints, preserved: draft.preserved, pending: draft.pendingDrafts }, null, 2)}</pre></details></div> : null}
      {plainTextSetting.value && richActive && textEditIssue(draft) ? <div role="status">{t('Existing formatting is retained while plain text mode is on.')}
        {!draft.input ? ' ' + (locale.toLowerCase().startsWith('zh') ? '发送时使用纯文本，不包含粗体等格式。' : 'Sending uses plain text without bold and similar formatting.') : null}</div> : null}
      {richActive && draft.document ? <StandaloneRichEditor ref={richEditor} document={draft.document} currentDocument={() => current.current.draft.document}
        placeholder={context.threadId ? t('Work with Codex') : locale.toLowerCase().startsWith('en') ? 'Do anything' : t('Message')}
        plainTextMode={plainTextSetting.value} canEdit={() => !frozenRef.current}
        onChange={document => changeDraftFromOperation(value => updateRichDraft(value, document))} onKeyDown={keyDown}
        onCompositionChange={value => setComposition('editor', value)}
        onPendingLinkChange={value => { const wasPending = pendingLink.current; pendingLink.current = value; if (wasPending && !value) recheckProjection(); }}
        onCompletionContext={onRichContext} completionListId={completions.query ? completions.listId : undefined}
        completionSelectedId={completionSelectedId}
        onImages={files => { void addFiles(files); }}
        onInvalid={message => setError(message ?? t('Unsupported document changes were not saved.'))} /> :
      segmented ? <>
        <StandaloneStructuredInputEditor key={composerOwnerKey} ref={structuredEditor} draft={draft} onEdit={editSegment} agentMentions={index => agentSegments.get(index) ?? []}
          sourceMarks={index => markSegments.get(index) ?? []}
          placeholder={context.threadId ? t('Work with Codex') : locale.toLowerCase().startsWith('en') ? 'Do anything' : t('Message')}
          activeIndex={segmentSelection?.index} completionListId={completions.query ? completions.listId : undefined}
          completionSelectedId={completionSelectedId}
          onSelection={(index, position) => {
            setSegmentSelection({ index, cursor: position });
            lastChatSelection.current = null;
          }}
          onKeyDown={keyDown} onPaste={paste} onInvalid={message => setError(message ?? t('Unsupported document changes were not saved.'))} onCompositionChange={value => {
            setComposition('editor', value); if (value) setSegmentSelection(null);
          }} />
        <details className="standalone-composer__retained"><summary>{t('View retained content')}</summary>
          <pre>{JSON.stringify({ input: draft.input, document: draft.document, hints: draft.hints, preserved: draft.preserved }, null, 2)}</pre></details>
      </> :
      <StandalonePlainInputEditor key={composerOwnerKey} ref={editor} label={t('Work with Codex')}
        placeholder={context.threadId ? t('Work with Codex') : locale.toLowerCase().startsWith('en') ? 'Do anything' : t('Message')}
        text={textViewValue} agentMentions={agentSegments.get(-1) ?? []} sourceMarks={markSegments.get(-1)} readOnly={!!editIssue}
        formatting={textFormatting} plainTextMode={plainTextSetting.value} document={draft.document} currentDocument={() => current.current.draft.document}
        onInvalid={message => setError(message ?? t('Unsupported document changes were not saved.'))}
        onPendingLinkChange={value => { const wasPending = pendingLink.current; pendingLink.current = value; if (wasPending && !value) recheckProjection(); }}
        canEdit={() => !frozenRef.current} completionListId={completions.query ? completions.listId : undefined}
        completionSelectedId={completionSelectedId}
        onEdit={(_index, expected, text, inputType, skills, agents) => {
          if (frozenRef.current) return false;
          if (expected !== text || inputType === 'historyUndo' || inputType === 'historyRedo') completions.show();
          const before = current.current.draft;
          if (textFormatting) {
            const source = before.document && readRichDocument(before.document), result = agents?.document && readRichDocument(agents.document);
            if (!source || !result || !agents?.document) return false;
            const updated = updateRichDraft(before, agents.document);
            if (updated.document !== agents.document) return false;
            const next = projectCompletionSkills(updated, skills);
            void changeDraft(value => value === before ? next : value);
            return current.current.draft === next;
          }
          if (before.text !== expected) return false;
          const hasAgents = agents && [...agents.before, ...agents.after].some(segment => segment.agents.length);
          const { document: _document, ...withoutDocument } = before;
          const next = updateDraftText(hasAgents ? withoutDocument : before, text);
          if (next.text !== text) return false;
          const projected = projectAgentEdit(before, projectCompletionSkills(next, skills), agents, inputType);
          if (!projected) { setError('The chat reference cannot be inserted without changing retained formatting or input.'); return false; }
          const previousView = textAgentView.current;
          if (hasAgents) textAgentView.current = composerOwnerKey;
          void changeDraft(value => value === before ? projected : value);
          const applied = current.current.draft === projected;
          if (!applied) textAgentView.current = previousView;
          return applied;
        }} onSelection={(_index, position, visibleText) => {
          setCursor(position);
          if (visibleText !== undefined) setTextFormatValue(visibleText);
          lastChatSelection.current = null;
        }} onKeyDown={keyDown} onPaste={paste}
        onCompositionChange={value => setComposition('editor', value)} />}
      {completions.query ? <div className="standalone-composer__completions" id={completions.listId} role="listbox" aria-label={t(completions.query.kind === 'file' ? 'Workspace files' : 'Skill')}>
        {completions.items.map((item, index) => <button type="button" role="option" id={completions.listId + '-' + index} key={item.kind + ':' + (item.kind === 'command' ? item.name : item.path)}
          aria-selected={effectiveChatIndex < 0 && index === completions.selected} onMouseDown={event => event.preventDefault()} onClick={() => chooseCompletion(item)}>
          <span>{item.kind === 'command' ? '/' : ''}{item.name}{item.kind === 'directory' ? '/' : ''}</span><small>{item.kind === 'command' ? t('Select model') : item.kind === 'skill' ? item.description : item.path}</small>
        </button>)}
        {chatCompletion ? <ChatThreadResults key={chatCompletion.id} client={chatCompletion.client} hostId={chatCompletion.hostId}
          hostName={chatHosts.find(host => host.hostId === chatCompletion.hostId)?.displayName ?? chatCompletion.hostId}
          search={chatCompletion.search} resultKey={String(chatCompletion.id)} listId={completions.listId} offset={completions.items.length}
          selected={selectedCompletion} preserveFocus chinese={locale.toLowerCase().startsWith('zh')}
          onSnapshot={reportChatSnapshot} onChoose={choice => chooseChat(chatCompletion, choice, false)} /> : null}
        {chatError ? <div role="alert">{chatError}</div> : null}
        {completions.loading ? <div role="status">{t('Loading suggestions...')}</div> : null}
        {completions.error ? <div role="alert">{t('Could not load suggestions:')}{completions.error}</div> : null}
        {!completions.loading && !completions.error && !completions.items.length && !completionChats.length
          && (!chatCompletion || chatSnapshot?.key === String(chatCompletion.id) && !chatSnapshot.loading) ? <div>{t('No matches')}</div> : null}
      </div> : null}
      <div className="standalone-composer__footer">
        <input ref={picker} type="file" multiple hidden onChange={event => {
          pickerOpen.current = false; const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; void addFiles(files);
        }} />
        <details className="standalone-composer__menu standalone-composer__add" onToggle={event => {
          positionComposerMenu(event.currentTarget);
          if (!event.currentTarget.open) { setFileLookup(null); setChatLookup(null); }
        }}>
          <summary aria-label={locale.toLowerCase().startsWith('en') ? 'Add files and more' : t('Add attachment')}
            title={locale.toLowerCase().startsWith('en') ? 'Add files and more' : t('Add attachment')}
            onMouseDown={() => {
              let selection = captureChatSelection();
              if (!selection && !lastChatSelection.current) selection = captureDefaultChatSelection();
              if (selection) lastChatSelection.current = selection;
            }}><Plus size={18} aria-hidden="true" /></summary>
          <div className="standalone-composer__menu-panel standalone-composer__add-panel">
            <button type="button" disabled={uploading || !!editIssue} onClick={event => {
              if (!picker.current || frozenRef.current) return;
              event.currentTarget.closest('details')?.removeAttribute('open');
              pickerOpen.current = true;
              try { picker.current.click(); } catch (reason) { pickerOpen.current = false; setError(t('Image upload failed:') + message(reason)); }
            }}><Paperclip size={16} aria-hidden="true" />{t('Add attachment')}</button>
            {onOpenGoal ? <button type="button" onClick={event => {
              event.currentTarget.closest('details')?.removeAttribute('open'); onOpenGoal();
            }}><Lightbulb size={16} aria-hidden="true" />{t('Goal')}</button> : null}
            {!chatLookup ? <button type="button" disabled={!!editIssue} onClick={() => {
              const selection = lastChatSelection.current ?? captureDefaultChatSelection();
              if (!selection) { setError('Select an insertion point in the editor and try again.'); return; }
              try { setFileLookup(null); setError(''); setChatLookup(makeChatLookup(selection, context.hostId, '')); }
              catch (cause) { setError(message(cause)); }
            }}><MessageSquare size={16} aria-hidden="true" />{locale.toLowerCase().startsWith('zh') ? '添加会话' : 'Add chat'}</button> :
              <div className="standalone-composer__lookup standalone-composer__chat-lookup">
                <input autoFocus aria-label={locale.toLowerCase().startsWith('zh') ? '查找会话' : 'Find chats'} value={chatLookup.search}
                  onChange={event => setChatLookup({ ...chatLookup, search: event.currentTarget.value })} />
                {chatHosts.length > 1 ? <label>{locale.toLowerCase().startsWith('zh') ? '主机' : 'Host'}
                  <select aria-label={locale.toLowerCase().startsWith('zh') ? '会话主机' : 'Chat host'} value={chatLookup.hostId}
                    onChange={event => {
                      try { setError(''); setChatLookup(makeChatLookup(chatLookup.selection, event.currentTarget.value, chatLookup.search, chatLookup.assertOwner)); }
                      catch (cause) { setError(message(cause)); }
                    }}>{chatHosts.map(host => <option value={host.hostId} key={host.hostId}>{host.displayName}</option>)}</select></label> : null}
                <ChatThreadResults key={chatLookup.id} client={chatLookup.client} hostId={chatLookup.hostId}
                  hostName={chatHosts.find(host => host.hostId === chatLookup.hostId)?.displayName ?? chatLookup.hostId}
                  search={chatLookup.search} resultKey={String(chatLookup.id)} chinese={locale.toLowerCase().startsWith('zh')}
                  onChoose={choice => chooseChat(chatLookup, choice, true)} />
              </div>}
            {!fileLookup ? <button type="button" disabled={!!editIssue} onClick={() => {
              const source = current.current;
              setChatLookup(null);
              setFileLookup({ text: '', draft: structuredClone(source.draft), revision: source.revision,
                hostId: context.hostId, cwd: context.cwd, cursor, segment: segmentSelection, rich: lastRichContext.current });
            }}>{locale.toLowerCase().startsWith('zh') ? '查找文件' : 'Find files'}</button> : <div className="standalone-composer__lookup">
              <input autoFocus aria-label={locale.toLowerCase().startsWith('zh') ? '查找文件' : 'Find files'} value={fileLookup.text}
                onChange={event => setFileLookup({ ...fileLookup, text: event.currentTarget.value })} />
              {fileResults.items.map(item => <button type="button" key={item.kind + ':' + (item.kind === 'command' ? item.name : item.path)}
                onClick={() => chooseLookupFile(item)}>{item.name}{item.kind === 'directory' ? '/' : ''}</button>)}
              {fileResults.loading ? <span role="status">{t('Loading')}</span> : null}
              {fileResults.error ? <span role="alert">{fileResults.error}</span> : null}
            </div>}
            <button type="button" aria-pressed={options.mode === 'plan'} disabled={busy} onClick={event => {
              setOverrides(previous => ({ ...previous, mode: options.mode === 'plan' ? 'default' : 'plan' }));
              event.currentTarget.closest('details')?.removeAttribute('open');
            }}><Lightbulb size={16} aria-hidden="true" />{locale.toLowerCase().startsWith('en') ? 'Plan mode' : t('Plan')}</button>
            {(!draft.document || retainTextHistory && !textFormatting) && !plainTextSetting.value ? <button type="button" className="standalone-composer__rich-action" disabled={!!editIssue || structuredInput}
              onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open');
                if (retainTextHistory && draft.document) {
                  if (!editor.current?.matchesDocument(draft.document) || !editor.current.activateFormatting(draft.document)) {
                    setError(t('Unsupported document changes were not saved.')); return;
                  }
                  setTextFormattingOwner(composerOwnerKey); requestAnimationFrame(() => editor.current?.focus());
                }
                else {
                  const before = current.current.draft, document = documentFromText(before.text);
                  const control = editor.current;
                  if (!control?.matchesDocument(document) || !control.activateFormatting(document, () => {
                    const previousView = textAgentView.current, next = { ...before, document };
                    textAgentView.current = composerOwnerKey;
                    void changeDraft(value => value === before ? next : value);
                    if (current.current.draft === next) return true;
                    textAgentView.current = previousView;
                    return false;
                  })) { setError(t('Unsupported document changes were not saved.')); return; }
                  setTextFormattingOwner(composerOwnerKey); requestAnimationFrame(() => control.focus());
                } }}><FilePenLine size={16} aria-hidden="true" />{t('Rich text editor')}</button> : null}
            <label className="standalone-composer__enter">{t('Send method')} <select aria-label={t('Send method')} value={enterSetting.value} disabled={enterSetting.pending} onChange={event => {
              const value = event.target.value;
              if (value === 'enter' || value === 'cmdIfMultiline' || value === 'cmdAlways') void enterSetting.update(value);
            }}><option value="enter">Enter</option><option value="cmdIfMultiline">{t('Ctrl/Command + Enter for multiline')}</option><option value="cmdAlways">Ctrl/⌘ + Enter</option></select></label>
          </div>
        </details>
        <StandaloneOptions client={client} hostId={context.hostId} cwd={context.cwd} threadId={context.threadId} projectless={selectedProjectId === null} busy={busy} modelRef={modelPicker} value={options} inherited={initialOptions} fullAccessVisible={fullAccessVisible}
          onDefaultPendingChange={notifyDefaultPending}
          onEffectiveOptionsChange={onEffectiveOptionsChange ? notifyEffectiveOptions : undefined}
          onChange={patch => setOverrides(previous => ({ ...previous, ...patch }))} />
        <button type="button" className="standalone-composer__dictation" aria-label={t('Dictation')}
          title={t('Voice chat and dictation are not available for this connection. A microphone preference can be saved for when they become available.')} disabled>
          <Mic size={16} aria-hidden="true" />
        </button>
        {busy ? <button type="button" onClick={() => void interrupt()} disabled={interrupting} title={t('Stop current task')}>{t('Stop')}</button> : null}
        {busy && queueAvailable ? <button type="button" onClick={() => void submit(followUpSetting.value === 'queue' ? 'steer' : 'queue')}
          title={followUpSetting.value === 'queue' && !activeTurnId ? t('Current task has no confirmed turn ID') : undefined}
          disabled={sending || uploading || !!failedUploadView.length || unresolved || !hasContent(draft) || plainModeUnavailable || followUpSetting.value === 'queue' && !activeTurnId}>
          {t(followUpSetting.value === 'queue' ? 'Send to current task' : 'Queue message')}</button> : null}
        <button className="standalone-composer__submit" type="button" onClick={() => void submit()}
          title={busy && preferredFollowUp === 'steer' && !activeTurnId ? t('Current task has no confirmed turn ID') : undefined}
          disabled={sending || uploading || !!failedUploadView.length || unresolved || defaultPending || !hasContent(draft) || plainModeUnavailable
            || busy && (queueAvailable && followUpSetting.pending || preferredFollowUp === 'steer' && !activeTurnId)}>
          <ArrowUp size={18} aria-hidden="true" /><span className="standalone-composer__sr-only">{t(sending ? 'Sending...' : busy ? preferredFollowUp === 'queue' ? 'Queue message' : 'Send to current task' : 'Send')}</span></button>
      </div>
    </div>
    </div>
    {uploading ? <div role="status">{t('Uploading attachments...')}</div> : null}
    {failedUploadView.map(batch => <div role="alert" key={batch.id}>
      {locale.toLowerCase().startsWith('zh') ? '未上传的附件：' : 'Attachments not uploaded: '}{batch.files.map(file => file.name).join(', ')}
      <button type="button" disabled={frozen} onClick={() => { if (addFiles(batch.files, false)) updateFailedUploads(failedUploads.current.filter(item => item.id !== batch.id)); }}>{t('Retry')}</button>
      <button type="button" disabled={frozen} onClick={() => updateFailedUploads(failedUploads.current.filter(item => item.id !== batch.id))}>{locale.toLowerCase().startsWith('zh') ? '放弃这些附件' : 'Discard these attachments'}</button>
    </div>)}
    {unresolved ? <div role="alert">{locale.toLowerCase().startsWith('zh') ? '当前内容仅保留在此页面。请保存为独立草稿后再切换或刷新。' : 'This content is retained only in this page. Save it as a separate draft before switching or refreshing.'}
      <button type="button" disabled={frozen || saving} onClick={() => void saveUnresolved()}>{locale.toLowerCase().startsWith('zh') ? '保存为独立草稿' : 'Save as a separate draft'}</button>
      <details><summary>{t('View retained content')}</summary><pre>{JSON.stringify(draft, null, 2)}</pre></details>
    </div> : null}
    {plainTextSetting.error ? <div role="status">{t('Could not read plain text preference:')} {plainTextSetting.error}
      <button type="button" onClick={() => void plainTextSetting.reload()}>{t('Retry reading')}</button></div> : null}
    {saving ? <div role="status">{t('Saving draft...')}</div> : null}
    {storageError ? <div role="alert">{storageError} {!unresolved ? <button type="button" disabled={frozen} onClick={retry}>{t('Retry saving')}</button> : null}</div> : null}
    {enterSetting.error ? <div role="alert">{enterSetting.error}</div> : null}
    {busy && queueAvailable && followUpSetting.error ? <div role="alert">{followUpSetting.error}</div> : null}
    {error ? <div role="alert">{error}</div> : null}
  </div>;
}

export function StandaloneComposer(props: StandaloneComposerRuntimeProps) {
  return <ComposerSession key={JSON.stringify([props.context.hostId, props.context.threadId, props.context.draftId])} {...props} />;
}
