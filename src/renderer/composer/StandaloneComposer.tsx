import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ClipboardEvent } from 'react';
import type { ComposerDraft, StandaloneComposerProps, SubmitAction, SubmitOptions, WorkbenchClient } from '../workbench-contract.ts';
import { useI18n } from '../i18n/index.tsx';
import { activatePending, documentFromText, draftToInput, hasContent, mergePrefill, recoverLegacyDraft, richEditIssue, textEditIssue, updateDraftText, updateRichDraft } from './standalone-draft.ts';
import { localizeDraftIssue } from './standalone-draft-issues.ts';
import { useComposerDraft } from './use-composer-draft.ts';
import type { ComposerDraftController, ComposerDraftLease } from './use-composer-draft.ts';
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
import { StandaloneRichEditor } from './StandaloneRichEditor.tsx';
import type { RichEditorHandle } from './StandaloneRichEditor.tsx';
import type { RichCompletionContext } from './rich-editor-actions.ts';
import { FilePenLine } from 'lucide-react';
import './standalone-composer.css';

export { draftToInput } from './standalone-draft.ts';
export { bindComposerDraftToThread, clearComposerDraftRevision, readComposerDraft } from './composer-draft-store.ts';
export type { DraftInputOptions, DraftSkill } from './standalone-draft.ts';
export type { ComposerDraftOwner, ComposerDraftSnapshot, ComposerSubmissionDescription } from './composer-draft-store.ts';
export type { ComposerDraftController, ComposerDraftLease } from './use-composer-draft.ts';
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
  onRemoveReference?: (owner: ComposerDraftOwner, reference: ComposerReference) => Promise<'handled' | void>;
};

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
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
    retain, clear, selectVersion, conflicts, storageError, saving, loaded, retry, lastWrite }
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
  const uploadInFlight = useRef(false);
  const pickerOpen = useRef(false);
  const compositions = useRef(new Set<'editor' | 'queue'>());
  const setComposition = (source: 'editor' | 'queue', value: boolean) => {
    if (value) compositions.current.add(source); else compositions.current.delete(source);
  };
  const pendingLink = useRef(false);
  const queueEditState = useRef({ editing: false, pending: false });
  const defaultPendingRef = useRef(false);
  const notifyDefaultPending = useCallback((value: boolean) => { defaultPendingRef.current = value; setDefaultPending(value); }, []);
  const editor = useRef<HTMLTextAreaElement>(null);
  const richEditor = useRef<RichEditorHandle>(null);
  const picker = useRef<HTMLInputElement>(null);
  const modelPicker = useRef<HTMLSelectElement>(null);
  freezeGuard.current = afterDrain => {
    const reason = !loaded || prefill && !current.current.prefills.includes(prefill.id) ? 'loading'
      : compositions.current.size ? 'composition' : pickerOpen.current ? 'picker'
      : pendingLink.current ? 'link'
      : queueEditState.current.editing && (!queueEditState.current.pending || afterDrain) ? 'queue'
      : interruptInFlight.current || defaultPendingRef.current ? 'pending' : '';
    if (!reason) return true;
    const explanation = locale.toLowerCase().startsWith('zh')
      ? { loading: '请等待草稿和预填恢复。', composition: '请先完成输入法输入。', picker: '请先完成或取消文件选择。', link: '请先应用或关闭链接编辑。', queue: '请先保存或取消队列编辑。', pending: '请先完成当前停止或设置操作。' }[reason]
      : { loading: 'Wait for the draft and prefill to load.', composition: 'Finish text composition first.', picker: 'Finish or cancel file selection first.', link: 'Apply or close the link editor first.', queue: 'Save or cancel the queued message edit first.', pending: 'Finish the current stop or settings operation first.' }[reason];
    setError(t('Could not switch drafts:') + explanation);
    return false;
  };
  const editIssue = draft.document ? richEditIssue(draft) : textEditIssue(draft);
  const recoverableLegacy = editIssue && recoverLegacyDraft(draft);
  const plainModeUnavailable = !!draft.document && !draft.input
    && (plainTextSetting.loading || !plainTextSetting.available || !!plainTextSetting.error);
  const richActive = !!draft.document && !editIssue;
  const structuredInput = draft.input !== undefined;
  const completions = useCompletions(client, context.hostId, context.cwd,
    richActive ? richContext?.text ?? '' : editIssue || structuredInput ? '' : draft.text,
    richActive ? richContext?.cursor ?? 0 : cursor, busy, richActive ? 'rich:' + richContext?.blockStart : 'plain');
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

  const removeReference = async (reference: ComposerReference) => {
    if (pendingReferences.current.get(reference.id) === controller) return;
    const finish = beginOperation();
    if (!finish) return;
    let success = false;
    pendingReferences.current.set(reference.id, controller);
    setRemoving(previous => ({ controller, ids: new Set([...(previous?.controller === controller ? previous.ids : []), reference.id]) }));
    setError('');
    try {
      const result = await onRemoveReference?.(structuredClone(owner), structuredClone(reference));
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
      finish(success);
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
    requestAnimationFrame(() => { if (richEditor.current) richEditor.current.focus(); else editor.current?.focus(); });
  }, [prefill, changeDraft, onPrefillConsumed, storageError, controller, current, lastWrite, loaded, frozen]);

  const addFiles = async (files: File[]) => {
    if (!files.length || uploadInFlight.current || editIssue || structuredInput) return;
    const finish = beginOperation();
    if (!finish) return;
    let success = false;
    uploadInFlight.current = true; setUploading(true); setError('');
    try {
      for (const file of files) {
        const added = await importAttachments(client, context.hostId, [file]);
        if (activeController.current !== controller) return;
        if (!await changeDraftFromOperation(previous => ({ ...previous, images: [...previous.images, ...added.images], files: [...previous.files, ...added.files] }))) {
          throw new Error('Draft could not be saved');
        }
      }
      success = true;
    } catch (reason) { if (activeController.current === controller) setError(t('Image upload failed:') + message(reason)); }
    finally { uploadInFlight.current = false; if (mounted.current) setUploading(false); finish(success); }
  };
  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    if (editIssue || structuredInput || event.clipboardData.getData('text/plain')) {
      setError(t('The content cannot be pasted together with images.')); return;
    }
    void addFiles(files);
  };
  const submit = async (followUp: FollowUpAction = followUpSetting.value) => {
    if (submitInFlight.current || uploadInFlight.current || !hasContent(current.current.draft)) return;
    if (defaultPending) { setError(t('Resolve the default model change before sending.')); return; }
    if (current.current.draft.blocked
      || current.current.draft.document && richEditIssue(current.current.draft)) {
      setError(t('This draft cannot be sent without losing content.')); return;
    }
    const readyPlainTextMode = plainTextSetting.readyValue();
    if (current.current.draft.document && !current.current.draft.input && readyPlainTextMode === undefined) {
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
      if (mounted.current) requestAnimationFrame(() => { if (richEditor.current) richEditor.current.focus(); else editor.current?.focus(); });
    } catch (reason) {
      if (activeController.current === controller) {
        if (busy && context.threadId) setQueueVersion(value => value + 1);
        setError(t(confirmed ? 'Sent, but draft cleanup failed:' : 'Send unconfirmed; draft retained:') + message(reason));
      }
    } finally { submitInFlight.current = false; if (mounted.current) setSending(false); }
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
    changeDraft(value => ({ ...value, text: value.text.slice(0, query.start) + replacement + value.text.slice(query.end),
      skills: item.kind === 'skill' && !value.skills.some(skill => skill.path === item.path)
        ? [...value.skills, { name: item.name, path: item.path }] : value.skills }));
    setCursor(caret);
    if (item.kind === 'directory') completions.show(); else completions.dismiss();
    requestAnimationFrame(() => {
      if (item.kind === 'command') modelPicker.current?.focus();
      else { editor.current?.focus(); editor.current?.setSelectionRange(caret, caret); }
    });
  };
  const keyDown = (event: globalThis.KeyboardEvent): boolean => {
    if (frozenRef.current) { event.preventDefault(); return true; }
    if (event.isComposing || event.keyCode === 229) return false;
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
        {conflicts.map(version => <button type="button" key={version.revision} onClick={() => void selectVersion(version.revision)
          .catch(reason => setError(t('Could not switch drafts:') + message(reason)))}>{version.draft.text.slice(0, 80) || t('Draft with attachments or retained data')}</button>)}
      </details></div> : null}
      {draft.pendingDrafts?.length ? <div role="status">{new Intl.NumberFormat(locale).format(draft.pendingDrafts.length)} {t('Contents were retained separately to preserve formatting.')} <button type="button" onClick={() => changeDraft(value => activatePending(value, true))}>{t('Switch draft')}</button></div> : null}
      {draft.images.length || draft.files.length || draft.references.length || draft.skills.length ? <div className="standalone-composer__attachments">
        {draft.images.map(image => <div className="standalone-composer__image" key={image.id}>
          {image.previewSrc ? <img src={image.previewSrc} alt={image.name ?? t('Image attachment')} /> : <span>{t('Image preview unavailable')}</span>}
          <button type="button" title={t('Remove image')} aria-label={t('Remove image') + ' ' + (image.name ?? '')} disabled={!!editIssue || structuredInput} onClick={() => changeDraft(value => ({ ...value, images: value.images.filter(item => item.id !== image.id) }))}>×</button>
        </div>)}
        {draft.files.map(file => <div className="standalone-composer__file" key={file.path}>
          <FilePreview client={client} hostId={context.hostId} path={file.path} name={file.name} />
          <button type="button" title={t('Remove file')} aria-label={t('Remove file') + ' ' + file.name} disabled={!!editIssue || structuredInput} onClick={() => changeDraft(value => ({ ...value, files: value.files.filter(item => item.path !== file.path) }))}>×</button>
        </div>)}
        {draft.references.map(reference => <div className="standalone-composer__reference" key={reference.id}>
          {referenceLabel(reference) === reference.text ? <span>{reference.text}</span> :
            <details><summary>{referenceLabel(reference)}</summary><pre>{reference.text}</pre></details>}
          <button type="button" title={t('Remove reference')} aria-label={t('Remove reference')} disabled={!!editIssue || structuredInput || removing?.controller === controller && removing.ids.has(reference.id)} onClick={() => void removeReference(reference)}>×</button>
        </div>)}
        {draft.skills.map(skill => <div className="standalone-composer__reference" key={skill.path}>
          <span>{t('Skill')}：{skill.name}</span><button type="button" title={t('Remove skill')} aria-label={t('Remove skill') + ' ' + skill.name} disabled={!!editIssue || structuredInput} onClick={() => changeDraft(value => ({ ...value, skills: value.skills.filter(item => item.path !== skill.path) }))}>×</button>
        </div>)}
      </div> : null}
      {editIssue ? <div className="standalone-composer__retained" role="status">{localizeDraftIssue(editIssue, t)}
        {recoverableLegacy ? <button type="button" disabled={frozen || !loaded} onClick={() => void changeDraft(value => recoverLegacyDraft(value) ?? value)}>{t('Restore')}</button> : null}
        <details><summary>{t('View retained content')}</summary><pre>{JSON.stringify({ document: draft.document, input: draft.input, hints: draft.hints, preserved: draft.preserved, pending: draft.pendingDrafts }, null, 2)}</pre></details></div> : null}
      {plainTextSetting.value && richActive && textEditIssue(draft) ? <div role="status">{t('Existing formatting is retained while plain text mode is on.')}
        {!draft.input ? ' ' + (locale.toLowerCase().startsWith('zh') ? '发送时使用纯文本，不包含粗体等格式。' : 'Sending uses plain text without bold and similar formatting.') : null}</div> : null}
      {richActive && draft.document ? <StandaloneRichEditor ref={richEditor} document={draft.document} currentDocument={() => current.current.draft.document}
        plainTextMode={plainTextSetting.value}
        onChange={document => changeDraftFromOperation(value => updateRichDraft(value, document))} onKeyDown={keyDown}
        onCompositionChange={value => setComposition('editor', value)}
        onPendingLinkChange={value => { pendingLink.current = value; }}
        onCompletionContext={onRichContext} completionListId={completions.query ? completions.listId : undefined}
        completionSelectedId={completions.selected >= 0 ? completions.listId + '-' + completions.selected : undefined}
        onImages={files => { if (structuredInput) setError(t('Images are not supported for this structured draft.')); else void addFiles(files); }}
        onInvalid={message => setError(message ?? t('Unsupported document changes were not saved.'))} /> :
      <textarea ref={editor} aria-label={t('Work with Codex')} placeholder={t('Message')} value={draft.text} readOnly={!!editIssue}
        aria-autocomplete="list" aria-controls={completions.query ? completions.listId : undefined}
        aria-activedescendant={completions.selected >= 0 ? completions.listId + '-' + completions.selected : undefined}
        onChange={event => { const text = event.target.value; setCursor(event.target.selectionStart); changeDraft(value => updateDraftText(value, text)); }}
        onCompositionStart={() => setComposition('editor', true)}
        onCompositionEnd={() => { requestAnimationFrame(() => { if (mounted.current) setComposition('editor', false); }); }}
        onSelect={event => setCursor(event.currentTarget.selectionStart)} onKeyDown={event => { keyDown(event.nativeEvent); }} onPaste={paste} />}
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
        <button type="button" aria-label={t('Add attachment')} title={t('Add attachment')} disabled={uploading || !!editIssue || structuredInput} onClick={() => {
          if (!picker.current || frozenRef.current) return;
          pickerOpen.current = true;
          try { picker.current.click(); } catch (reason) { pickerOpen.current = false; setError(t('Image upload failed:') + message(reason)); }
        }}>＋</button>
        {!draft.document && !plainTextSetting.value ? <button type="button" aria-label={t('Rich text editor')} title={t('Rich text editor')} disabled={!!editIssue}
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
          disabled={sending || uploading || !hasContent(draft) || plainModeUnavailable || followUpSetting.value === 'queue' && !activeTurnId}>
          {t(followUpSetting.value === 'queue' ? 'Send to current task' : 'Queue message')}</button> : null}
        <button className="standalone-composer__submit" type="button" onClick={() => void submit()}
          title={busy && followUpSetting.value === 'steer' && !activeTurnId ? t('Current task has no confirmed turn ID') : undefined}
          disabled={sending || uploading || defaultPending || !hasContent(draft) || plainModeUnavailable
            || busy && (followUpSetting.pending || followUpSetting.value === 'steer' && !activeTurnId)}>
          {t(sending ? 'Sending...' : busy ? followUpSetting.value === 'queue' ? 'Queue message' : 'Send to current task' : 'Send')}</button>
      </div>
    </div>
    </div>
    {uploading ? <div role="status">{t('Uploading attachments...')}</div> : null}
    {plainTextSetting.error ? <div role="status">{t('Could not read plain text preference:')} {plainTextSetting.error}
      <button type="button" onClick={() => void plainTextSetting.reload()}>{t('Retry reading')}</button></div> : null}
    {saving ? <div role="status">{t('Saving draft...')}</div> : null}
    {storageError ? <div role="alert">{storageError} <button type="button" disabled={frozen} onClick={retry}>{t('Retry saving')}</button></div> : null}
    {enterSetting.error ? <div role="alert">{enterSetting.error}</div> : null}
    {busy && followUpSetting.error ? <div role="alert">{followUpSetting.error}</div> : null}
    {error ? <div role="alert">{error}</div> : null}
  </div>;
}

export function StandaloneComposer(props: StandaloneComposerRuntimeProps) {
  return <ComposerSession key={JSON.stringify([props.context.hostId, props.context.threadId, props.context.draftId])} {...props} />;
}
