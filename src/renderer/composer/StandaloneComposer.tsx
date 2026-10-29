import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ClipboardEvent } from 'react';
import type { ComposerDraft, StandaloneComposerProps, SubmitAction, SubmitOptions, WorkbenchClient } from '../workbench-contract.ts';
import { translateKnown, useI18n } from '../i18n/index.tsx';
import { activatePending, canEditStructuredDraft, createId, documentFromText, draftToInput, editStructuredDraftText, hasContent, isStructuredAppInput, mergePrefill, recoverLegacyDraft, removeStructuredImage, removeStructuredSkill, richEditIssue, structuredEditIssue, textEditIssue, updateDraftText, updateRichDraft } from './standalone-draft.ts';
import { localizeDraftIssue } from './standalone-draft-issues.ts';
import { useComposerDraft } from './use-composer-draft.ts';
import type { ComposerDraftController, ComposerDraftExternalOperation, ComposerDraftLease } from './use-composer-draft.ts';
import type { ComposerDraftOwner, ComposerDraftSnapshot, ComposerSubmissionDescription } from './composer-draft-store.ts';
import { importAttachments } from './standalone-files.ts';
import { useCompletions } from './standalone-completions.tsx';
import type { Completion } from './standalone-completions.tsx';
import { StandaloneOptions } from './standalone-options.tsx';
import { StandaloneQueue } from './standalone-queue.tsx';
import { useEnterSetting } from './standalone-enter-setting.ts';
import { useFollowUpSetting } from './standalone-follow-up.ts';
import { usePlainTextSetting } from './standalone-plain-text-setting.ts';
import type { FollowUpAction } from './standalone-follow-up.ts';
import { StandaloneTarget } from './standalone-target.tsx';
import type { ComposerHost, ComposerTarget } from './standalone-target.tsx';
import { StandalonePlainInputEditor, StandaloneRichEditor, StandaloneStructuredInputEditor } from './StandaloneRichEditor.tsx';
import type { RichEditorHandle, StructuredInputEditorHandle, TextSkillChange } from './StandaloneRichEditor.tsx';
import type { RichCompletionContext } from './rich-editor-actions.ts';
import { FilePenLine } from 'lucide-react';
import './standalone-composer.css';

export { draftToInput } from './standalone-draft.ts';
export { bindComposerDraftToThread, clearComposerDraftRevision, readComposerDraft } from './composer-draft-store.ts';
export type { DraftInputOptions, DraftSkill } from './standalone-draft.ts';
export type { ComposerDraftOwner, ComposerDraftSnapshot, ComposerSubmissionDescription } from './composer-draft-store.ts';
export type { ComposerDraftController, ComposerDraftExternalOperation, ComposerDraftLease } from './use-composer-draft.ts';
export type ComposerReference = NonNullable<ComposerDraft['references']>[number];
export type StandaloneComposerRuntimeProps = Omit<StandaloneComposerProps, 'onSubmit'> & {
  onSubmit(draft: ComposerDraft, options: SubmitOptions, action: SubmitAction, description?: ComposerSubmissionDescription): Promise<void>;
  /** The app's authoritative active turn, used as the steer precondition. */
  activeTurnId?: string | null;
  initialOptions?: SubmitOptions;
  hosts?: ComposerHost[];
  /** Reuse the borrowed lease in navigation guards; resolve after committing the requested owner. */
  onTargetChange?: (target: ComposerTarget, lease: ComposerDraftLease) => Promise<void>;
  onPrefillConsumed?: (id: string) => void;
  onDraftController?: (controller: ComposerDraftController | null) => void;
  onDraftChange?: (snapshot: ComposerDraftSnapshot) => void;
  onRemoveReference?: (owner: ComposerDraftOwner, reference: ComposerReference, operation: ComposerDraftExternalOperation) => Promise<'handled' | void>;
};

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function completionEnd(text: string, end: number, token: string): number {
  const suffix = text.slice(end).match(token.startsWith('@') ? /^[^\s@$\ufffc]*/ : /^[^\s@$\/\ufffc]*/)?.[0] ?? '';
  return end + suffix.length;
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

function ComposerSession({ client, context, busy, onSubmit, onInterrupt, onStartQueued, prefill, activeTurnId, initialOptions, hosts, onTargetChange, onPrefillConsumed, onDraftController, onDraftChange, onRemoveReference }: StandaloneComposerRuntimeProps) {
  const { t, locale } = useI18n('zh-CN');
  const inputRoot = useRef<HTMLDivElement>(null);
  const freezeGuard = useRef<(afterDrain: boolean) => boolean>(() => false);
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
    retain, clear, selectVersion, conflicts, storageError, saving, loaded, unresolved, saveUnresolved, retry, lastWrite }
    = useComposerDraft(context, onDraftController, onDraftChange, freezeGuard, setInputFrozen);
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
  const enterSetting = useEnterSetting(client);
  const followUpSetting = useFollowUpSetting(client);
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
  };
  const pendingLink = useRef(false);
  const queueEditState = useRef({ editing: false, pending: false });
  const defaultPendingRef = useRef(false);
  const notifyDefaultPending = useCallback((value: boolean) => { defaultPendingRef.current = value; setDefaultPending(value); }, []);
  const editor = useRef<StructuredInputEditorHandle>(null);
  const richEditor = useRef<RichEditorHandle>(null);
  const structuredEditor = useRef<StructuredInputEditorHandle>(null);
  const picker = useRef<HTMLInputElement>(null);
  const modelPicker = useRef<HTMLSelectElement>(null);
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
  const richActive = !!draft.document && !editIssue && !segmented;
  const structuredInput = draft.input !== undefined;
  const selectedSegment = segmentSelection && draft.input?.[segmentSelection.index];
  const segmentText = selectedSegment?.type === 'text' && typeof selectedSegment.text === 'string' && !isStructuredAppInput(selectedSegment)
    ? selectedSegment.text : '';
  const completions = useCompletions(client, context.hostId, context.cwd,
    richActive ? richContext?.text ?? '' : segmented ? segmentText : editIssue ? '' : draft.text,
    richActive ? richContext?.cursor ?? 0 : segmented ? segmentSelection?.cursor ?? 0 : cursor,
    busy, richActive ? 'rich:' + richContext?.blockStart : segmented ? 'segment:' + segmentSelection?.index : 'plain');
  const onRichContext = useCallback((next: RichCompletionContext | null) => setRichContext(previous =>
    previous?.text === next?.text && previous?.cursor === next?.cursor && previous?.blockStart === next?.blockStart ? previous : next), []);
  useEffect(() => {
    if (!appliedOptions) return;
    const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
    const baseline = appliedOptions.baseline, next = { ...appliedOptions.changes };
    const sandboxChanged = !same(initialOptions?.sandboxMode, baseline.sandboxMode)
      || !same(initialOptions?.permissionProfileId, baseline.permissionProfileId);
    const cleared: (keyof SubmitOptions)[] = [];
    let changed = false;
    for (const field of Object.keys(next) as (keyof SubmitOptions)[]) {
      const local = Object.hasOwn(overrides, field) && same(overrides[field], next[field]);
      const authoritativeChanged = field === 'sandboxMode' || field === 'permissionProfileId'
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
  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    if (editIssue || event.clipboardData.getData('text/plain')) {
      setError(t('The content cannot be pasted together with images.')); return;
    }
    void addFiles(files);
  };
  const submit = async (followUp: FollowUpAction = followUpSetting.value) => {
    if (submitInFlight.current || uploadsInFlight.current || failedUploads.current.length || unresolved || !hasContent(current.current.draft)) return;
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
    const documentPlainTextMode = readyPlainTextMode ?? plainTextSetting.value;
    try { draftToInput(current.current.draft, context.hostId, { plainTextMode: documentPlainTextMode }); }
    catch (reason) { setError(message(reason)); return; }
    const captured = structuredClone(current.current);
    const submittedOptions = structuredClone(options), submittedOverrides = structuredClone(overrides);
    const finishPreparation = beginOperation();
    if (!finishPreparation) return;
    submitInFlight.current = true; setSending(true); setError('');
    let confirmed = false;
    try {
      const submitted: ComposerDraft = captured.draft;
      let retained = false;
      try { retained = await retain(captured); } finally { finishPreparation(retained); }
      if (!retained) throw new Error(t('Could not persist the submitted version.'));
      if (activeController.current !== controller) return;
      await onSubmit(submitted, submittedOptions, action, { owner: structuredClone(owner), revision: captured.revision,
        overrides: submittedOverrides, ...(submitted.document ? { documentPlainTextMode } : {}) });
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
        setError(t(confirmed ? 'Sent, but draft cleanup failed:' : 'Send unconfirmed; draft retained:') + message(reason));
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
  const editSegment = (index: number, expected: string, text: string, inputType?: string, skills?: TextSkillChange) => {
    if (frozenRef.current) return false;
    if (expected !== text || inputType === 'historyUndo' || inputType === 'historyRedo') completions.show();
    const before = current.current.draft, result = editStructuredDraftText(before, index, expected, text);
    if (!result.draft) { setError(translateKnown(t, result.error)); return false; }
    const next = projectCompletionSkills(result.draft, skills);
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
      requestAnimationFrame(() => { if (item.kind === 'command') modelPicker.current?.focus(); else richEditor.current?.focus(); });
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
      const result = editStructuredDraftText(before, index, entry.text,
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
      if (item.kind === 'command') modelPicker.current?.focus(); else structuredEditor.current?.focus(index, caret);
      return;
    }
    const before = current.current.draft;
    if (before.text.slice(query.start, query.end) !== query.token) { completions.dismiss(); return; }
    const end = completionEnd(before.text, query.end, query.token);
    const after = before.text.slice(0, query.start) + replacement + before.text.slice(end);
    const control = editor.current;
    if (!control || updateDraftText(before, after).text !== after) { completions.dismiss(); return; }
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
    if (item.kind === 'command') modelPicker.current?.focus();
    else editor.current?.focus(-1, caret);
  };
  const keyDown = (event: globalThis.KeyboardEvent): boolean => {
    if (frozenRef.current) { event.preventDefault(); return true; }
    if (compositions.current.has('editor') || event.isComposing || event.keyCode === 229) return false;
    if (completions.query) {
      if (event.key === 'Escape') { event.preventDefault(); completions.dismiss(); return true; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (completions.items.length) { event.preventDefault(); completions.move(event.key === 'ArrowDown' ? 1 : -1); return true; }
        return false;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const selected = completions.items[completions.selected];
        if (selected) { event.preventDefault(); chooseCompletion(selected); return true; }
        if (event.key === 'Enter' && completions.loading) { event.preventDefault(); return true; }
      }
    }
    if (event.key !== 'Enter' || event.altKey || event.repeat || enterSetting.pending || enterSetting.error) return false;
    const modifier = event.ctrlKey || event.metaKey;
    if (busy && modifier && (enterSetting.value === 'enter' ? !event.shiftKey : event.shiftKey)) {
      if (followUpSetting.pending || followUpSetting.error) return false;
      event.preventDefault(); void submit(followUpSetting.value === 'queue' ? 'steer' : 'queue'); return true;
    }
    if (event.shiftKey || busy && (followUpSetting.pending || followUpSetting.error)) return false;
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
  return <div className="standalone-composer">
    <div ref={inputRoot} inert={frozen} aria-busy={frozen || undefined}>
    {context.threadId ? <StandaloneQueue key={JSON.stringify([context.hostId, context.threadId])} client={client} hostId={context.hostId} threadId={context.threadId} busy={busy} refreshVersion={queueVersion} onStartQueued={onStartQueued} frozen={frozen}
      beginOperation={beginOperation} onEditStateChange={(editing, pending) => { queueEditState.current = { editing, pending }; }}
      onCompositionChange={value => setComposition('queue', value)} /> : null}
    <div className="standalone-composer__editor" inert={switchingTarget} aria-busy={switchingTarget || undefined}>
      {conflicts.length ? <div role="status">{t('Other pages or legacy data contain {count} independent drafts.').replace('{count}', new Intl.NumberFormat(locale).format(conflicts.length))}<details><summary>{t('Select draft version')}</summary>
        {conflicts.map(version => <button type="button" disabled={unresolved} key={version.revision} onClick={() => void selectVersion(version.revision)
          .catch(reason => setError(t('Could not switch drafts:') + message(reason)))}>{version.draft.text.slice(0, 80) || t('Draft with attachments or retained data')}</button>)}
      </details></div> : null}
      {draft.pendingDrafts?.length ? <div role="status">{new Intl.NumberFormat(locale).format(draft.pendingDrafts.length)} {t('Contents were retained separately to preserve formatting.')} <button type="button" onClick={() => changeDraft(value => activatePending(value, true))}>{t('Switch draft')}</button></div> : null}
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
        <details><summary>{t('View retained content')}</summary><pre>{JSON.stringify({ document: draft.document, input: draft.input, hints: draft.hints, preserved: draft.preserved, pending: draft.pendingDrafts }, null, 2)}</pre></details></div> : null}
      {plainTextSetting.value && richActive && textEditIssue(draft) ? <div role="status">{t('Existing formatting is retained while plain text mode is on.')}
        {!draft.input ? ' ' + (locale.toLowerCase().startsWith('zh') ? '发送时使用纯文本，不包含粗体等格式。' : 'Sending uses plain text without bold and similar formatting.') : null}</div> : null}
      {richActive && draft.document ? <StandaloneRichEditor ref={richEditor} document={draft.document} currentDocument={() => current.current.draft.document}
        plainTextMode={plainTextSetting.value} canEdit={() => !frozenRef.current}
        onChange={document => changeDraftFromOperation(value => updateRichDraft(value, document))} onKeyDown={keyDown}
        onCompositionChange={value => setComposition('editor', value)}
        onPendingLinkChange={value => { pendingLink.current = value; }}
        onCompletionContext={onRichContext} completionListId={completions.query ? completions.listId : undefined}
        completionSelectedId={completions.selected >= 0 ? completions.listId + '-' + completions.selected : undefined}
        onImages={files => { void addFiles(files); }}
        onInvalid={message => setError(message ?? t('Unsupported document changes were not saved.'))} /> :
      segmented ? <>
        <StandaloneStructuredInputEditor ref={structuredEditor} draft={draft} onEdit={editSegment}
          activeIndex={segmentSelection?.index} completionListId={completions.query ? completions.listId : undefined}
          completionSelectedId={completions.selected >= 0 ? completions.listId + '-' + completions.selected : undefined}
          onSelection={(index, position) => setSegmentSelection({ index, cursor: position })}
          onKeyDown={keyDown} onPaste={paste} onCompositionChange={value => {
            setComposition('editor', value); if (value) setSegmentSelection(null);
          }} />
        <details className="standalone-composer__retained"><summary>{t('View retained content')}</summary>
          <pre>{JSON.stringify({ input: draft.input, document: draft.document, hints: draft.hints, preserved: draft.preserved }, null, 2)}</pre></details>
      </> :
      <StandalonePlainInputEditor ref={editor} label={t('Work with Codex')} placeholder={t('Message')} text={draft.text} readOnly={!!editIssue}
        canEdit={() => !frozenRef.current} completionListId={completions.query ? completions.listId : undefined}
        completionSelectedId={completions.selected >= 0 ? completions.listId + '-' + completions.selected : undefined}
        onEdit={(_index, expected, text, inputType, skills) => {
          if (frozenRef.current) return false;
          if (expected !== text || inputType === 'historyUndo' || inputType === 'historyRedo') completions.show();
          const before = current.current.draft;
          if (before.text !== expected) return false;
          const next = updateDraftText(before, text);
          if (next.text !== text) return false;
          const projected = projectCompletionSkills(next, skills);
          void changeDraft(value => value === before ? projected : value);
          return current.current.draft === projected;
        }} onSelection={(_index, position) => setCursor(position)} onKeyDown={keyDown} onPaste={paste}
        onCompositionChange={value => setComposition('editor', value)} />}
      {completions.query ? <div className="standalone-composer__completions" id={completions.listId} role="listbox" aria-label={t(completions.query.kind === 'file' ? 'Workspace files' : 'Skill')}>
        {completions.items.map((item, index) => <button type="button" role="option" id={completions.listId + '-' + index} key={item.kind + ':' + (item.kind === 'command' ? item.name : item.path)}
          aria-selected={index === completions.selected} onMouseDown={event => event.preventDefault()} onClick={() => chooseCompletion(item)}>
          <span>{item.kind === 'command' ? '/' : ''}{item.name}{item.kind === 'directory' ? '/' : ''}</span><small>{item.kind === 'command' ? t('Select model') : item.kind === 'skill' ? item.description : item.path}</small>
        </button>)}
        {completions.loading ? <div role="status">{t('Loading suggestions...')}</div> : null}
        {completions.error ? <div role="alert">{t('Could not load suggestions:')}{completions.error}</div> : null}
        {!completions.loading && !completions.error && !completions.items.length ? <div>{t('No matches')}</div> : null}
      </div> : null}
      <div className="standalone-composer__footer">
        <input ref={picker} type="file" multiple hidden onChange={event => {
          pickerOpen.current = false; const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; void addFiles(files);
        }} />
        <button type="button" aria-label={t('Add attachment')} title={t('Add attachment')} disabled={uploading || !!editIssue} onClick={() => {
          if (!picker.current || frozenRef.current) return;
          pickerOpen.current = true;
          try { picker.current.click(); } catch (reason) { pickerOpen.current = false; setError(t('Image upload failed:') + message(reason)); }
        }}>＋</button>
        {!draft.document && !plainTextSetting.value ? <button type="button" aria-label={t('Rich text editor')} title={t('Rich text editor')} disabled={!!editIssue || structuredInput}
          onClick={() => { changeDraft(value => ({ ...value, document: documentFromText(value.text) }));
            requestAnimationFrame(() => richEditor.current?.focus()); }}><FilePenLine size={16} /></button> : null}
        {onTargetChange ? <StandaloneTarget client={client} context={context} hosts={hosts} disabled={busy || sending || uploading || !!removing || switchingTarget}
          onTargetChange={async target => {
            const lease = controller.freeze(owner);
            if (!lease) throw new Error('Draft input is not ready to switch.');
            setSwitchingTarget(true);
            try {
              if (!await lease.flush()) throw new Error('Draft input could not be saved.');
              await onTargetChange(target, lease);
            } finally { lease.release(); if (mounted.current) setSwitchingTarget(false); }
          }} /> : null}
        <StandaloneOptions client={client} hostId={context.hostId} cwd={context.cwd} threadId={context.threadId} busy={busy} modelRef={modelPicker} value={options}
          onDefaultPendingChange={notifyDefaultPending}
          onChange={patch => setOverrides(previous => ({ ...previous, ...patch }))} />
        <label className="standalone-composer__enter">{t('Send method')} <select aria-label={t('Send method')} value={enterSetting.value} disabled={enterSetting.pending} onChange={event => {
          const value = event.target.value;
          if (value === 'enter' || value === 'cmdIfMultiline' || value === 'cmdAlways') void enterSetting.update(value);
        }}><option value="enter">Enter</option><option value="cmdIfMultiline">{t('Ctrl/Command + Enter for multiline')}</option><option value="cmdAlways">Ctrl/⌘ + Enter</option></select></label>
        {busy ? <button type="button" onClick={() => void interrupt()} disabled={interrupting} title={t('Stop current task')}>{t('Stop')}</button> : null}
        {busy ? <button type="button" onClick={() => void submit(followUpSetting.value === 'queue' ? 'steer' : 'queue')}
          title={followUpSetting.value === 'queue' && !activeTurnId ? t('Current task has no confirmed turn ID') : undefined}
          disabled={sending || uploading || !!failedUploadView.length || unresolved || !hasContent(draft) || plainModeUnavailable || followUpSetting.value === 'queue' && !activeTurnId}>
          {t(followUpSetting.value === 'queue' ? 'Send to current task' : 'Queue message')}</button> : null}
        <button className="standalone-composer__submit" type="button" onClick={() => void submit()}
          title={busy && followUpSetting.value === 'steer' && !activeTurnId ? t('Current task has no confirmed turn ID') : undefined}
          disabled={sending || uploading || !!failedUploadView.length || unresolved || defaultPending || !hasContent(draft) || plainModeUnavailable
            || busy && (followUpSetting.pending || followUpSetting.value === 'steer' && !activeTurnId)}>
          {t(sending ? 'Sending...' : busy ? followUpSetting.value === 'queue' ? 'Queue message' : 'Send to current task' : 'Send')}</button>
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
    {busy && followUpSetting.error ? <div role="alert">{followUpSetting.error}</div> : null}
    {error ? <div role="alert">{error}</div> : null}
  </div>;
}

export function StandaloneComposer(props: StandaloneComposerRuntimeProps) {
  return <ComposerSession key={JSON.stringify([props.context.hostId, props.context.threadId, props.context.draftId])} {...props} />;
}
