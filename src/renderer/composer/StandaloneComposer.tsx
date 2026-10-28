import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ClipboardEvent } from 'react';
import type { ComposerDraft, StandaloneComposerProps, SubmitAction, SubmitOptions, WorkbenchClient } from '../workbench-contract.ts';
import { activatePending, documentFromText, draftToInput, hasContent, mergePrefill, richEditIssue, textEditIssue, updateDraftText, updateRichDraft } from './standalone-draft.ts';
import { useComposerDraft } from './use-composer-draft.ts';
import type { ComposerDraftController } from './use-composer-draft.ts';
import type { ComposerDraftOwner, ComposerDraftSnapshot, ComposerSubmissionDescription } from './composer-draft-store.ts';
import { importAttachments } from './standalone-files.ts';
import { useCompletions } from './standalone-completions.tsx';
import type { Completion } from './standalone-completions.tsx';
import { StandaloneOptions } from './standalone-options.tsx';
import { StandaloneQueue } from './standalone-queue.tsx';
import { useEnterSetting } from './standalone-enter-setting.ts';
import { useFollowUpSetting } from './standalone-follow-up.ts';
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
export type { DraftSkill } from './standalone-draft.ts';
export type { ComposerDraftOwner, ComposerDraftSnapshot, ComposerSubmissionDescription } from './composer-draft-store.ts';
export type { ComposerDraftController } from './use-composer-draft.ts';
export type ComposerReference = NonNullable<ComposerDraft['references']>[number];
export type StandaloneComposerRuntimeProps = Omit<StandaloneComposerProps, 'onSubmit'> & {
  onSubmit(draft: ComposerDraft, options: SubmitOptions, action: SubmitAction, description?: ComposerSubmissionDescription): Promise<void>;
  /** The app's authoritative active turn, used as the steer precondition. */
  activeTurnId?: string | null;
  initialOptions?: SubmitOptions;
  hosts?: ComposerHost[];
  onTargetChange?: (target: ComposerTarget) => void | Promise<void>;
  onPrefillConsumed?: (id: string) => void;
  onDraftController?: (controller: ComposerDraftController | null) => void;
  onDraftChange?: (snapshot: ComposerDraftSnapshot) => void;
  onRemoveReference?: (owner: ComposerDraftOwner, reference: ComposerReference) => Promise<void>;
};

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function FilePreview({ client, hostId, path, name }: { client: WorkbenchClient; hostId: string; path: string; name: string }) {
  const [preview, setPreview] = useState<string | null>(null);
  return <details onToggle={event => {
    if (!event.currentTarget.open || preview != null) return;
    void client.host<{ text?: string; blob?: string }>('workspace-files', { operation: 'read', hostId, path, representation: 'auto' })
      .then(result => setPreview(result.text ?? '此文件是二进制文件，无法以文本预览。'))
      .catch(error => setPreview('无法预览：' + message(error)));
  }}><summary>{name}</summary>{preview == null ? '正在读取…' : <pre>{preview}</pre>}</details>;
}

function ComposerSession({ client, context, busy, onSubmit, onInterrupt, onStartQueued, prefill, activeTurnId, initialOptions, hosts, onTargetChange, onPrefillConsumed, onDraftController, onDraftChange, onRemoveReference }: StandaloneComposerRuntimeProps) {
  const { owner, controller, current, stored, changeDraft, retain, clear, selectVersion, conflicts, storageError, saving, loaded, retry, lastWrite }
    = useComposerDraft(context, onDraftController, onDraftChange);
  const draft = stored.draft;
  const [overrides, setOverrides] = useState<Partial<SubmitOptions>>({});
  const [appliedOptions, setAppliedOptions] = useState<{ changes: Partial<SubmitOptions>; baseline: SubmitOptions } | null>(null);
  const options = { ...initialOptions, ...overrides };
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [interrupting, setInterrupting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [switchingTarget, setSwitchingTarget] = useState(false);
  const [queueVersion, setQueueVersion] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [richContext, setRichContext] = useState<RichCompletionContext | null>(null);
  const enterSetting = useEnterSetting(client);
  const followUpSetting = useFollowUpSetting(client);
  const mounted = useRef(false);
  const activeController = useRef<ComposerDraftController | null>(null);
  const pendingReferences = useRef(new Map<string, ComposerDraftController>());
  const [removing, setRemoving] = useState<{ controller: ComposerDraftController; ids: Set<string> } | null>(null);
  const submitInFlight = useRef(false);
  const interruptInFlight = useRef(false);
  const uploadInFlight = useRef(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const richEditor = useRef<RichEditorHandle>(null);
  const picker = useRef<HTMLInputElement>(null);
  const modelPicker = useRef<HTMLSelectElement>(null);
  const editIssue = draft.document ? richEditIssue(draft) : textEditIssue(draft);
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
    return () => { if (activeController.current === controller) activeController.current = null; mounted.current = false; };
  }, [controller]);

  const removeReference = async (reference: ComposerReference) => {
    if (pendingReferences.current.get(reference.id) === controller) return;
    pendingReferences.current.set(reference.id, controller);
    setRemoving(previous => ({ controller, ids: new Set([...(previous?.controller === controller ? previous.ids : []), reference.id]) }));
    setError('');
    try {
      await onRemoveReference?.(structuredClone(owner), structuredClone(reference));
      await controller.update(owner, value => ({ ...value, references: (value.references ?? []).filter(item =>
        item.id !== reference.id || JSON.stringify(item) !== JSON.stringify(reference)) }));
    } catch (reason) {
      if (activeController.current === controller) setError('移除引用失败，草稿已保留：' + message(reason));
    } finally {
      if (pendingReferences.current.get(reference.id) === controller) pendingReferences.current.delete(reference.id);
      if (activeController.current === controller) setRemoving(previous => {
        if (previous?.controller !== controller) return previous;
        const ids = new Set(previous.ids); ids.delete(reference.id);
        return ids.size ? { controller, ids } : null;
      });
    }
  };
  useEffect(() => {
    if (!prefill || !loaded) return;
    if (current.current.prefills.includes(prefill.id)) {
      void lastWrite.current.then(saved => { if (saved && activeController.current === controller) onPrefillConsumed?.(prefill.id); });
      return;
    }
    void changeDraft(value => mergePrefill(value, prefill.draft), prefill.id)
      .then(saved => { if (saved && activeController.current === controller) onPrefillConsumed?.(prefill.id); });
    requestAnimationFrame(() => { if (richEditor.current) richEditor.current.focus(); else editor.current?.focus(); });
  }, [prefill, changeDraft, onPrefillConsumed, storageError, controller, current, lastWrite, loaded]);

  const addFiles = async (files: File[]) => {
    if (!files.length || uploadInFlight.current || editIssue || structuredInput) return;
    uploadInFlight.current = true; setUploading(true); setError('');
    try {
      for (const file of files) {
        const added = await importAttachments(client, context.hostId, [file]);
        if (activeController.current !== controller) return;
        changeDraft(previous => ({ ...previous, images: [...previous.images, ...added.images], files: [...previous.files, ...added.files] }));
      }
    } catch (reason) { if (activeController.current === controller) setError('附件上传失败：' + message(reason)); }
    finally { uploadInFlight.current = false; if (mounted.current) setUploading(false); }
  };
  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    if (editIssue || structuredInput || event.clipboardData.getData('text/plain')) {
      setError('此内容不能直接粘贴，请分别输入文本并添加图片。'); return;
    }
    void addFiles(files);
  };
  const submit = async (followUp: FollowUpAction = followUpSetting.value) => {
    if (submitInFlight.current || uploadInFlight.current || !hasContent(current.current.draft)) return;
    if (current.current.draft.blocked
      || current.current.draft.document && richEditIssue(current.current.draft)) {
      setError('当前内容无法无损发送，已保留原始草稿。'); return;
    }
    if (busy && followUp === 'queue' && (current.current.draft.hints?.length || current.current.draft.references.some(reference => reference.context !== undefined || reference.original !== undefined))) {
      setError('此草稿包含队列协议无法保存的上下文，已保留草稿。'); return;
    }
    if (busy && !context.threadId) { setError('会话尚未创建，请稍后再排队。'); return; }
    let action: SubmitAction;
    if (!busy) action = { type: 'send' };
    else if (followUp === 'queue') action = { type: 'queue' };
    else {
      if (!activeTurnId) { setError('当前任务尚无可确认的 turn ID。'); return; }
      action = { type: 'steer', turnId: activeTurnId };
    }
    try { draftToInput(current.current.draft, context.hostId); }
    catch (reason) { setError(message(reason)); return; }
    const captured = structuredClone(current.current);
    const submittedOptions = structuredClone(options), submittedOverrides = structuredClone(overrides);
    submitInFlight.current = true; setSending(true); setError('');
    let confirmed = false;
    try {
      const submitted: ComposerDraft = captured.draft;
      if (!await retain(captured)) throw new Error('提交版本未能持久化。');
      if (activeController.current !== controller) return;
      await onSubmit(submitted, submittedOptions, action, { owner: structuredClone(owner), revision: captured.revision, overrides: submittedOverrides });
      confirmed = true;
      if (activeController.current !== controller) return;
      if (mounted.current && action.type === 'send' && Object.keys(submittedOverrides).length) {
        setAppliedOptions({ changes: submittedOverrides, baseline: { ...initialOptions } });
      }
      if (busy && followUp === 'queue' && mounted.current) setQueueVersion(value => value + 1);
      await clear(captured.revision);
      if (mounted.current) requestAnimationFrame(() => { if (richEditor.current) richEditor.current.focus(); else editor.current?.focus(); });
    } catch (reason) {
      if (activeController.current === controller) {
        if (busy && context.threadId) setQueueVersion(value => value + 1);
        setError((confirmed ? '发送已确认，但草稿清理失败，原内容已保留：' : '发送未确认，草稿已保留。请检查会话后再重试：') + message(reason));
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
    catch (reason) { if (activeController.current === controller) setError('停止失败：' + message(reason)); }
    finally { interruptInFlight.current = false; if (mounted.current) setInterrupting(false); }
  };
  return <div className="standalone-composer">
    {context.threadId ? <StandaloneQueue key={JSON.stringify([context.hostId, context.threadId])} client={client} hostId={context.hostId} threadId={context.threadId} busy={busy} refreshVersion={queueVersion} onStartQueued={onStartQueued} /> : null}
    <div className="standalone-composer__editor" inert={switchingTarget} aria-busy={switchingTarget || undefined}>
      {conflicts.length ? <div role="status">其他页面或旧数据中有 {conflicts.length} 份独立草稿。<details><summary>选择草稿版本</summary>
        {conflicts.map(version => <button type="button" key={version.revision} onClick={() => void selectVersion(version.revision)
          .catch(reason => setError('无法切换草稿：' + message(reason)))}>{version.draft.text.slice(0, 80) || '包含附件或保留数据的草稿'}</button>)}
      </details></div> : null}
      {draft.pendingDrafts?.length ? <div role="status">{draft.pendingDrafts.length} 份内容已单独保留，避免合并时丢失格式。 <button type="button" onClick={() => changeDraft(value => activatePending(value, true))}>切换草稿</button></div> : null}
      {draft.images.length || draft.files.length || draft.references.length || draft.skills.length ? <div className="standalone-composer__attachments">
        {draft.images.map(image => <div className="standalone-composer__image" key={image.id}>
          {image.previewSrc ? <img src={image.previewSrc} alt={image.name ?? '图片附件'} /> : <span>图片预览不可用</span>}
          <button type="button" title="移除图片" aria-label={'移除图片 ' + (image.name ?? '')} disabled={!!editIssue || structuredInput} onClick={() => changeDraft(value => ({ ...value, images: value.images.filter(item => item.id !== image.id) }))}>×</button>
        </div>)}
        {draft.files.map(file => <div className="standalone-composer__file" key={file.path}>
          <FilePreview client={client} hostId={context.hostId} path={file.path} name={file.name} />
          <button type="button" title="移除文件" aria-label={'移除文件 ' + file.name} disabled={!!editIssue || structuredInput} onClick={() => changeDraft(value => ({ ...value, files: value.files.filter(item => item.path !== file.path) }))}>×</button>
        </div>)}
        {draft.references.map(reference => <div className="standalone-composer__reference" key={reference.id}>
          <span>{reference.text}</span><button type="button" title="移除引用" aria-label="移除引用" disabled={!!editIssue || structuredInput || removing?.controller === controller && removing.ids.has(reference.id)} onClick={() => void removeReference(reference)}>×</button>
        </div>)}
        {draft.skills.map(skill => <div className="standalone-composer__reference" key={skill.path}>
          <span>技能：{skill.name}</span><button type="button" title="移除技能" aria-label={'移除技能 ' + skill.name} disabled={!!editIssue || structuredInput} onClick={() => changeDraft(value => ({ ...value, skills: value.skills.filter(item => item.path !== skill.path) }))}>×</button>
        </div>)}
      </div> : null}
      {editIssue ? <div className="standalone-composer__retained" role="status">{editIssue}<details><summary>查看保留的内容</summary><pre>{JSON.stringify({ document: draft.document, input: draft.input, hints: draft.hints, preserved: draft.preserved, pending: draft.pendingDrafts }, null, 2)}</pre></details></div> : null}
      {richActive && draft.document ? <StandaloneRichEditor ref={richEditor} document={draft.document} currentDocument={() => current.current.draft.document}
        onChange={document => changeDraft(value => updateRichDraft(value, document))} onKeyDown={keyDown}
        onCompletionContext={onRichContext} completionListId={completions.query ? completions.listId : undefined}
        completionSelectedId={completions.selected >= 0 ? completions.listId + '-' + completions.selected : undefined}
        onImages={files => { if (structuredInput) setError('此结构化草稿暂不支持添加图片。'); else void addFiles(files); }}
        onInvalid={message => setError(message ?? '编辑内容包含不支持的文档结构，已保留上一次草稿。')} /> :
      <textarea ref={editor} aria-label="和 Codex 一起工作" placeholder="输入消息" value={draft.text} readOnly={!!editIssue}
        aria-autocomplete="list" aria-controls={completions.query ? completions.listId : undefined}
        aria-activedescendant={completions.selected >= 0 ? completions.listId + '-' + completions.selected : undefined}
        onChange={event => { const text = event.target.value; setCursor(event.target.selectionStart); changeDraft(value => updateDraftText(value, text)); }}
        onSelect={event => setCursor(event.currentTarget.selectionStart)} onKeyDown={event => { keyDown(event.nativeEvent); }} onPaste={paste} />}
      {completions.query ? <div className="standalone-composer__completions" id={completions.listId} role="listbox" aria-label={completions.query.kind === 'file' ? '工作区文件' : '技能'}>
        {completions.items.map((item, index) => <button type="button" role="option" id={completions.listId + '-' + index} key={item.kind + ':' + (item.kind === 'command' ? item.name : item.path)}
          aria-selected={index === completions.selected} onMouseDown={event => event.preventDefault()} onClick={() => chooseCompletion(item)}>
          <span>{item.kind === 'command' ? '/' : ''}{item.name}{item.kind === 'directory' ? '/' : ''}</span><small>{item.kind === 'skill' || item.kind === 'command' ? item.description : item.path}</small>
        </button>)}
        {completions.loading ? <div role="status">加载中…</div> : null}
        {completions.error ? <div role="alert">无法读取建议：{completions.error}</div> : null}
        {!completions.loading && !completions.error && !completions.items.length ? <div>无匹配结果</div> : null}
      </div> : null}
      <div className="standalone-composer__footer">
        <input ref={picker} type="file" multiple hidden onChange={event => {
          const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; void addFiles(files);
        }} />
        <button type="button" aria-label="添加附件" title="添加附件" disabled={uploading || !!editIssue || structuredInput} onClick={() => picker.current?.click()}>＋</button>
        {!draft.document ? <button type="button" aria-label="富文本编辑" title="富文本编辑" disabled={!!editIssue}
          onClick={() => { changeDraft(value => ({ ...value, document: documentFromText(value.text) }));
            requestAnimationFrame(() => richEditor.current?.focus()); }}><FilePenLine size={16} /></button> : null}
        {onTargetChange ? <StandaloneTarget client={client} context={context} hosts={hosts} disabled={busy || sending || uploading || !!removing || switchingTarget}
          onTargetChange={async target => {
            setSwitchingTarget(true);
            try { if (await controller.flush(owner)) await onTargetChange(target); }
            finally { if (mounted.current) setSwitchingTarget(false); }
          }} /> : null}
        <StandaloneOptions client={client} hostId={context.hostId} cwd={context.cwd} threadId={context.threadId} busy={busy} modelRef={modelPicker} value={options}
          onChange={patch => setOverrides(previous => ({ ...previous, ...patch }))} />
        <label className="standalone-composer__enter">发送方式 <select aria-label="发送方式" value={enterSetting.value} disabled={enterSetting.pending} onChange={event => {
          const value = event.target.value;
          if (value === 'enter' || value === 'cmdIfMultiline' || value === 'cmdAlways') void enterSetting.update(value);
        }}><option value="enter">Enter</option><option value="cmdIfMultiline">多行时 Ctrl/⌘ + Enter</option><option value="cmdAlways">Ctrl/⌘ + Enter</option></select></label>
        {busy ? <button type="button" onClick={() => void interrupt()} disabled={interrupting} title="停止当前任务">停止</button> : null}
        {busy ? <button type="button" onClick={() => void submit(followUpSetting.value === 'queue' ? 'steer' : 'queue')}
          title={followUpSetting.value === 'queue' && !activeTurnId ? '当前任务尚无可确认的 turn ID' : undefined}
          disabled={sending || uploading || !hasContent(draft) || followUpSetting.value === 'queue' && !activeTurnId}>
          {followUpSetting.value === 'queue' ? '发送到当前任务' : '排队'}</button> : null}
        <button className="standalone-composer__submit" type="button" onClick={() => void submit()}
          title={busy && followUpSetting.value === 'steer' && !activeTurnId ? '当前任务尚无可确认的 turn ID' : undefined}
          disabled={sending || uploading || !hasContent(draft) || busy && (followUpSetting.pending || followUpSetting.value === 'steer' && !activeTurnId)}>
          {sending ? '发送中' : busy ? followUpSetting.value === 'queue' ? '排队' : '发送到当前任务' : '发送'}</button>
      </div>
    </div>
    {uploading ? <div role="status">正在上传附件…</div> : null}
    {saving ? <div role="status">正在保存草稿…</div> : null}
    {storageError ? <div role="alert">{storageError} <button type="button" onClick={retry}>重试保存</button></div> : null}
    {enterSetting.error ? <div role="alert">{enterSetting.error}</div> : null}
    {busy && followUpSetting.error ? <div role="alert">{followUpSetting.error}</div> : null}
    {error ? <div role="alert">{error}</div> : null}
  </div>;
}

export function StandaloneComposer(props: StandaloneComposerRuntimeProps) {
  return <ComposerSession key={JSON.stringify([props.context.hostId, props.context.threadId, props.context.draftId])} {...props} />;
}
