import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClipboardEvent } from 'react';
import type { ComposerDraft, StandaloneComposerProps, SubmitAction, SubmitOptions, WorkbenchClient } from '../workbench-contract.ts';
import { activatePending, createId, documentFromText, draftKey, draftToInput, hasContent, loadDraft, mergePrefill, readDraft, richEditIssue, textEditIssue, updateDraftText, updateRichDraft, writeDraft } from './standalone-draft.ts';
import type { Draft } from './standalone-draft.ts';
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
import { FilePenLine } from 'lucide-react';
import './standalone-composer.css';

export { draftToInput } from './standalone-draft.ts';
export type { DraftSkill } from './standalone-draft.ts';
export type StandaloneComposerRuntimeProps = StandaloneComposerProps & {
  /** The app's authoritative active turn, used as the steer precondition. */
  activeTurnId?: string | null;
  initialOptions?: SubmitOptions;
  hosts?: ComposerHost[];
  onTargetChange?: (target: ComposerTarget) => void | Promise<void>;
  onPrefillConsumed?: (id: string) => void;
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

function ComposerSession({ client, context, busy, onSubmit, onInterrupt, onStartQueued, prefill, activeTurnId, initialOptions, hosts, onTargetChange, onPrefillConsumed }: StandaloneComposerRuntimeProps) {
  const key = draftKey(context);
  const [initial] = useState(() => loadDraft(context));
  const current = useRef(initial);
  const [draft, setDraft] = useState<Draft>(initial.draft);
  const [overrides, setOverrides] = useState<Partial<SubmitOptions>>({});
  const [appliedOptions, setAppliedOptions] = useState<{ changes: Partial<SubmitOptions>; baseline: SubmitOptions } | null>(null);
  const options = { ...initialOptions, ...overrides };
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState(false);
  const [sending, setSending] = useState(false);
  const [interrupting, setInterrupting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [queueVersion, setQueueVersion] = useState(0);
  const [cursor, setCursor] = useState(0);
  const enterSetting = useEnterSetting(client);
  const followUpSetting = useFollowUpSetting(client);
  const mounted = useRef(true);
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
  const completions = useCompletions(client, context.hostId, context.cwd, editIssue || structuredInput || richActive ? '' : draft.text, cursor, busy);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
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

  const changeDraft = useCallback((update: (draft: Draft) => Draft, prefillId?: string) => {
    const previous = mounted.current ? current.current : readDraft(key) ?? current.current;
    const next = { revision: createId(), draft: update(previous.draft),
      prefills: prefillId ? [...previous.prefills, prefillId] : previous.prefills };
    current.current = next;
    const saved = writeDraft(key, next);
    if (mounted.current) { setDraft(next.draft); setStorageError(!saved); }
    return saved;
  }, [key]);
  useEffect(() => {
    if (!prefill) return;
    if (current.current.prefills.includes(prefill.id)) {
      if (readDraft(key)?.prefills.includes(prefill.id)) onPrefillConsumed?.(prefill.id);
      return;
    }
    const saved = changeDraft(value => mergePrefill(value, prefill.draft), prefill.id);
    if (saved) onPrefillConsumed?.(prefill.id);
    requestAnimationFrame(() => { if (richEditor.current) richEditor.current.focus(); else editor.current?.focus(); });
  }, [prefill, changeDraft, onPrefillConsumed, key, storageError]);

  const addFiles = async (files: File[]) => {
    if (!files.length || uploadInFlight.current || editIssue || structuredInput) return;
    uploadInFlight.current = true; setUploading(true); setError('');
    try {
      for (const file of files) {
        const added = await importAttachments(client, context.hostId, [file]);
        changeDraft(previous => ({ ...previous, images: [...previous.images, ...added.images], files: [...previous.files, ...added.files] }));
      }
    } catch (reason) { if (mounted.current) setError('附件上传失败：' + message(reason)); }
    finally { uploadInFlight.current = false; if (mounted.current) setUploading(false); }
  };
  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'));
    if (!files.length || event.clipboardData.getData('text/plain')) return;
    event.preventDefault();
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
    const captured = current.current;
    submitInFlight.current = true; setSending(true); setError('');
    try {
      const submitted: ComposerDraft = captured.draft;
      await onSubmit(submitted, options, action);
      if (mounted.current && action.type === 'send' && Object.keys(overrides).length) {
        setAppliedOptions({ changes: { ...overrides }, baseline: { ...initialOptions } });
      }
      if (busy && followUp === 'queue' && mounted.current) setQueueVersion(value => value + 1);
      const persisted = readDraft(key);
      if (current.current.revision === captured.revision && (!persisted || persisted.revision === captured.revision)) {
        changeDraft(value => activatePending(value, false));
      } else if (current.current.revision === captured.revision && mounted.current) {
        setError('发送已确认，但草稿已在其他页面修改，已保留。');
      }
      if (mounted.current) requestAnimationFrame(() => { if (richEditor.current) richEditor.current.focus(); else editor.current?.focus(); });
    } catch (reason) {
      if (mounted.current) {
        if (busy && context.threadId) setQueueVersion(value => value + 1);
        setError('发送未确认，草稿已保留。请检查会话后再重试：' + message(reason));
      }
    } finally { submitInFlight.current = false; if (mounted.current) setSending(false); }
  };
  const chooseCompletion = (item: Completion) => {
    const query = completions.query;
    if (!query) return;
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
    if (!richActive && completions.query) {
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
    catch (reason) { setError('停止失败：' + message(reason)); }
    finally { interruptInFlight.current = false; if (mounted.current) setInterrupting(false); }
  };
  return <div className="standalone-composer">
    {context.threadId ? <StandaloneQueue key={JSON.stringify([context.hostId, context.threadId])} client={client} hostId={context.hostId} threadId={context.threadId} busy={busy} refreshVersion={queueVersion} onStartQueued={onStartQueued} /> : null}
    <div className="standalone-composer__editor">
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
          <span>{reference.text}</span><button type="button" title="移除引用" aria-label="移除引用" disabled={!!editIssue || structuredInput} onClick={() => changeDraft(value => ({ ...value, references: value.references.filter(item => item.id !== reference.id) }))}>×</button>
        </div>)}
        {draft.skills.map(skill => <div className="standalone-composer__reference" key={skill.path}>
          <span>技能：{skill.name}</span><button type="button" title="移除技能" aria-label={'移除技能 ' + skill.name} disabled={!!editIssue || structuredInput} onClick={() => changeDraft(value => ({ ...value, skills: value.skills.filter(item => item.path !== skill.path) }))}>×</button>
        </div>)}
      </div> : null}
      {editIssue ? <div className="standalone-composer__retained" role="status">{editIssue}<details><summary>查看保留的内容</summary><pre>{JSON.stringify({ document: draft.document, input: draft.input, hints: draft.hints, preserved: draft.preserved, pending: draft.pendingDrafts }, null, 2)}</pre></details></div> : null}
      {richActive && draft.document ? <StandaloneRichEditor ref={richEditor} document={draft.document}
        onChange={document => changeDraft(value => updateRichDraft(value, document))} onKeyDown={keyDown} onImages={files => void addFiles(files)}
        onInvalid={() => setError('编辑内容包含不支持的文档结构，已保留上一次草稿。')} /> :
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
        {onTargetChange ? <StandaloneTarget client={client} context={context} hosts={hosts} disabled={busy || sending || uploading} onTargetChange={onTargetChange} /> : null}
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
    {storageError ? <div role="alert">草稿未能保存到浏览器，刷新前请检查浏览器存储空间。</div> : null}
    {enterSetting.error ? <div role="alert">{enterSetting.error}</div> : null}
    {busy && followUpSetting.error ? <div role="alert">{followUpSetting.error}</div> : null}
    {error ? <div role="alert">{error}</div> : null}
  </div>;
}

export function StandaloneComposer(props: StandaloneComposerRuntimeProps) {
  return <ComposerSession key={draftKey(props.context)} {...props} />;
}
