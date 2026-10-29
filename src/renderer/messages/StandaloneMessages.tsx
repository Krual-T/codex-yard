import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDown, ChevronDown, ChevronLeft, ChevronRight, GitFork, Pencil, Search, Undo2, X } from 'lucide-react';
import type { ThreadItemSummary, TurnSummary } from '../../../lib/codex-protocol.ts';
import type { StandaloneMessagesProps, WorkbenchClient } from '../workbench-contract.ts';
import { StandaloneMarkdown } from '../markdown/StandaloneMarkdown.tsx';
import { ToolItem } from '../tools/ToolItem.tsx';
import { CopyButton } from './CopyButton.tsx';
import { messageCopyContent } from './message-copy.ts';
import { ImageViewer, MessageImage } from './MessageImage.tsx';
import { asArray, asRecord, asString, displayJson, editableDraft, parseUserContent, resolveToolFileLocation, serializedMessageContext } from './message-data.ts';
import type { ImageSource, SerializedMessageContext } from './message-data.ts';
import { canRemoveImageAttachment, editSourceSignature, latestEditTarget } from './message-edit.ts';
import type { MessageEditHistory, RemovedMessageAttachment } from './message-edit.ts';
import { useMessageEditing } from './use-message-editing.ts';
import type { EditingSession, StandaloneMessagesRecoveryProps, StartEdit, UpdateEdit } from './use-message-editing.ts';
import './standalone-messages.css';

export type { MessageEditAccess, MessageEditNavigationController, MessageEditNavigationLease, MessageEditRebaseCandidate, MessageEditRebaseMarker, MessageEditRecovery, MessageEditRecoveryVersion, StandaloneMessagesRecoveryProps } from './use-message-editing.ts';
export type { MessageEditHistory } from './message-edit.ts';

type RenderItemProps = {
  item: ThreadItemSummary;
  turnId: string;
  threadId: string;
  client: WorkbenchClient;
  hostId: string;
  cwd: string;
  onEdit: StandaloneMessagesProps['onEdit'];
  onFork: StandaloneMessagesProps['onFork'];
  onOpenFile: StandaloneMessagesProps['onOpenFile'];
  onOpenFileAt: StandaloneMessagesProps['onOpenFileAt'];
  onOpenVisualization: StandaloneMessagesProps['onOpenVisualization'];
  onOpenBrowser: StandaloneMessagesProps['onOpenBrowser'];
  onOpenImages: (images: ImageSource[], index: number) => void;
  editRestriction: string | null;
  editing: EditingSession | null;
  identity: string;
  turnIndex: number;
  itemIndex: number;
  onStartEdit: (session: StartEdit) => void;
  onUpdateEdit: UpdateEdit;
  onEndEdit: (id: number) => void;
  onSubmitEdit: (id: number, onEdit: NonNullable<StandaloneMessagesProps['onEdit']>) => void;
  rebaseRequired: boolean;
  canRebase: boolean;
  onStartRebase: (id: number) => void;
  onCancelRebase: (id: number) => void;
  recoveryNote: string | null;
  searchMatch: boolean;
};

type UserMessageEditorProps = {
  item: ThreadItemSummary;
  editing: EditingSession;
  restriction: string | null;
  onEdit: NonNullable<StandaloneMessagesProps['onEdit']>;
  onUpdateEdit: UpdateEdit;
  onCancel: () => void;
  onSubmitEdit: RenderItemProps['onSubmitEdit'];
  rebaseRequired: boolean;
  canRebase: boolean;
  onStartRebase: RenderItemProps['onStartRebase'];
  onCancelRebase: RenderItemProps['onCancelRebase'];
  recoveryNote: string | null;
  renderPart: (index: number) => ReactNode;
  renderContext: (context: SerializedMessageContext, controls?: {
    isRemoved: (fileIndex: number) => boolean;
    toggle: (fileIndex: number) => void;
    disabled: boolean;
  }) => ReactNode;
};

const unavailableEdit: NonNullable<StandaloneMessagesProps['onEdit']> = async () => {
  throw new Error('Message editing is unavailable.');
};

function UserMessageEditor({ item, editing, restriction, onEdit, onUpdateEdit, onCancel, onSubmitEdit, recoveryNote, renderPart, renderContext,
  rebaseRequired, canRebase, onStartRebase, onCancelRebase }: UserMessageEditorProps) {
  const { id, draft, signature, edits, addedText, removedAttachments, error, saveError, pending, sent, navigationFrozen, rebaseChecking, rebaseCommitting } = editing;
  const composing = useRef(false);
  const currentSignature = useMemo(() => editSourceSignature(item), [item]);
  const changedSource = signature !== currentSignature
    || (editing.requiresCurrentSource && item.clientId !== editing.snapshot.clientId);
  const blocked = restriction ?? (changedSource ? 'This message changed while editing. Cancel and reopen the editor.' : null)
    ?? (editing.attachmentRecoveryInvalid ? 'The saved attachment changes are unrecognized. The original edit has been preserved.' : null);
  const rows = new Map(edits.map((edit, position) => [edit.index, { edit, position }]));
  const sameAttachment = (left: RemovedMessageAttachment, right: RemovedMessageAttachment) => left.kind === right.kind
    && left.inputIndex === right.inputIndex && (left.kind !== 'file' || (right.kind === 'file' && left.fileIndex === right.fileIndex));
  const isRemoved = (attachment: RemovedMessageAttachment) => removedAttachments.some((value) => sameAttachment(value, attachment));
  const toggleAttachment = (attachment: RemovedMessageAttachment) => onUpdateEdit(id, (current) => ({ ...current, error: '',
    removedAttachments: current.removedAttachments.some((value) => sameAttachment(value, attachment))
      ? current.removedAttachments.filter((value) => !sameAttachment(value, attachment)) : [...current.removedAttachments, attachment] }));
  const textarea = (value: string, onChange: (value: string) => void, label: string, autoFocus: boolean) =>
    <label className="yard-edit-text"><span className="yard-screen-reader">{label}</span>
      <textarea aria-label={label} autoFocus={autoFocus} rows={Math.max(3, Math.min(12, value.split('\n').length + 1))}
        value={value} disabled={pending || sent || navigationFrozen || editing.attachmentRecoveryInvalid} onChange={(event) => { onChange(event.target.value); }} />
      <span className="yard-edit-print-text" aria-hidden="true">{value}</span></label>;
  return <form className="yard-message-edit" onCompositionStart={() => { composing.current = true; }}
    onCompositionEnd={() => { composing.current = false; }} onKeyDown={(event) => {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.keyCode !== 229 && !composing.current && !pending && !sent && !navigationFrozen && !rebaseChecking) {
      event.preventDefault(); onCancel();
    }
  }} onSubmit={(event) => {
    event.preventDefault();
    if (pending || sent || navigationFrozen || rebaseChecking || rebaseRequired || blocked) return;
    onSubmitEdit(id, onEdit);
  }}>
    {!edits.length && textarea(addedText, (text) => onUpdateEdit(id, (current) => ({ ...current, addedText: text, error: '' })), 'Edit message text', true)}
    {draft.input?.map((_, index) => {
      const row = rows.get(index);
      const part = parseUserContent({ ...item, content: [_] })[0];
      if (!row) {
        if (part?.kind !== 'image') return <div key={index}>{renderPart(index)}</div>;
        const attachment = { kind: 'image', inputIndex: index } as const;
        const removed = isRemoved(attachment);
        const canRemove = canRemoveImageAttachment(draft, index);
        const label = `${removed ? 'Restore' : 'Remove'} image ${index + 1}`;
        return <div className="yard-edit-attachment" key={index}>
          {removed ? <span className="yard-attachment-removed">Image removed</span> : renderPart(index)}
          <button type="button" className="yard-icon-button" title={canRemove ? label : 'Image cannot be safely removed'}
            aria-label={label} disabled={pending || sent || navigationFrozen || editing.attachmentRecoveryInvalid || !canRemove} onClick={() => toggleAttachment(attachment)}>
            {removed ? <Undo2 size={16} /> : <X size={16} />}</button>
        </div>;
      }
      if (part?.kind === 'appMessage' || part?.kind === 'unsupported') return <div key={index}>{renderPart(index)}</div>;
      const original = draft.input?.[index]?.text;
      const context = typeof original === 'string' ? serializedMessageContext(original) : null;
      const value = context?.prefix && row.edit.text.startsWith(context.prefix) ? row.edit.text.slice(context.prefix.length) : row.edit.text;
      return <div key={index}>{context?.prefix && renderContext(context, {
        isRemoved: (fileIndex) => isRemoved({ kind: 'file', inputIndex: index, fileIndex }),
        toggle: (fileIndex) => toggleAttachment({ kind: 'file', inputIndex: index, fileIndex }), disabled: pending || sent || navigationFrozen || editing.attachmentRecoveryInvalid,
      })}
        {textarea(value, (text) => onUpdateEdit(id, (current) => ({ ...current, error: '',
        edits: current.edits.map((edit) => edit.index === index ? { ...edit, text: (context?.prefix ?? '') + text } : edit) })),
        edits.length === 1 ? 'Edit message text' : `Edit message text ${row.position + 1} of ${edits.length}`, row.position === 0)}</div>;
    })}
    {recoveryNote && <div className="yard-edit-recovery-note" role="status">{recoveryNote}</div>}
    {rebaseRequired && <div className="yard-edit-recovery-note" role="status">An earlier version was sent. Your newer edit has not been sent.
      {rebaseChecking ? <> Checking the sent message. <button type="button" onClick={() => onCancelRebase(id)}>Cancel check</button></>
        : canRebase ? <> <button type="button" disabled={pending || navigationFrozen} onClick={() => onStartRebase(id)}>Continue editing from the sent message</button></>
          : ' Reopening this edit requires the recovery service.'}</div>}
    {blocked && !sent && <div className="yard-action-error" role="alert">{blocked}</div>}
    {saveError && <div className="yard-action-error" role="alert">{saveError}</div>}
    {error && <div className="yard-action-error" role="alert">{error}</div>}
    <div className="yard-edit-controls"><button type="button" onClick={onCancel} disabled={pending || navigationFrozen || rebaseChecking}>{sent ? 'Clear recovery' : 'Cancel'}</button>
      {!sent && <button type="submit" disabled={pending || navigationFrozen || rebaseChecking || rebaseRequired || Boolean(blocked)}>{rebaseCommitting ? 'Saving...' : pending ? 'Sending...' : 'Send'}</button>}</div>
  </form>;
}

function UserMessage({ item, turnId, threadId, client, hostId, cwd, onEdit, onFork, onOpenFile, onOpenFileAt, onOpenImages,
  editRestriction, editing, identity, turnIndex, itemIndex, onStartEdit, onUpdateEdit, onEndEdit, onSubmitEdit, recoveryNote, searchMatch,
  rebaseRequired, canRebase, onStartRebase, onCancelRebase }: RenderItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [actionError, setActionError] = useState('');
  const editButton = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  const parts = useMemo(() => parseUserContent(editing ? { ...item, content: editing.draft.input } : item), [item, editing]);
  const openSingleImage = useCallback((image: ImageSource) => onOpenImages([image], 0), [onOpenImages]);
  const imageRemoved = (index: number) => editing?.removedAttachments.some((attachment) => attachment.kind === 'image' && attachment.inputIndex === index) ?? false;
  const images = parts.flatMap((part, index) => part.kind === 'image' ? (imageRemoved(index) ? [] : [part.image]) : part.kind === 'appMessage' ? part.images : []);
  const draft = useMemo(() => onEdit && !editRestriction ? editableDraft(item) : null, [item, onEdit, editRestriction]);
  const text = parts.flatMap((part) => part.kind === 'text' || part.kind === 'appMessage' ? [part.text] : []).join('\n');
  const long = text.length > 1200;
  const editNote = onEdit && editRestriction !== 'Only the latest user message can be edited.'
    ? editRestriction ?? (draft ? null : 'This message cannot be edited without losing content.') : null;
  useLayoutEffect(() => {
    if (!editing && restoreFocus.current) { editButton.current?.focus(); restoreFocus.current = false; }
  }, [editing]);
  let imageIndex = 0;
  const renderContext: UserMessageEditorProps['renderContext'] = (context, controls) => <div className="yard-reference">
    {context.files.map((file, index) => <div className="yard-edit-attachment" key={`${file.path}-${index}`}>
      <span className={controls?.isRemoved(index) ? 'yard-attachment-removed' : undefined}>
      {onOpenFileAt || onOpenFile ? <button type="button" className="yard-file-link" onClick={() => {
        const location = resolveToolFileLocation(file.path, cwd, hostId);
        if (onOpenFileAt) onOpenFileAt({ ...location, ...(file.startLine !== undefined ? { line: file.startLine, column: 1 } : {}) });
        else onOpenFile?.(location.path);
      }}>{file.name}</button> : <strong>{file.name}</strong>} <span>{file.path}</span>
      {file.startLine !== undefined && <span> ({file.endLine !== file.startLine ? `lines ${file.startLine}-${file.endLine}` : `line ${file.startLine}`})</span>}
      </span>
      {controls && <button type="button" className="yard-icon-button"
        title={context.fileSpans[index]?.removable ? `${controls.isRemoved(index) ? 'Restore' : 'Remove'} ${file.name}` : 'File context cannot be safely removed'}
        aria-label={`${controls.isRemoved(index) ? 'Restore' : 'Remove'} ${file.name}`}
        disabled={controls.disabled || !context.fileSpans[index]?.removable} onClick={() => controls.toggle(index)}>
        {controls.isRemoved(index) ? <Undo2 size={16} /> : <X size={16} />}</button>}
    </div>)}
    <details><summary>Message context</summary><pre>{context.prefix}</pre></details>
  </div>;
  const renderedParts = parts.map((part, index) => {
    if (part.kind === 'text') return <div key={index}>{part.context && renderContext(part.context)}
      <div data-user-copy-part className={long && !expanded && !searchMatch ? 'yard-user-text is-collapsed' : 'yard-user-text'}>
        <StandaloneMarkdown text={part.text} client={client} hostId={hostId} threadId={threadId} cwd={cwd} onOpenFile={onOpenFile} onOpenFileAt={onOpenFileAt} onOpenImage={openSingleImage} /></div>
      {part.hasElements && <details className="yard-unsupported-input"><summary>Message references</summary><pre>{displayJson(part.textElements)}</pre></details>}
    </div>;
    if (part.kind === 'appMessage') {
      const first = imageIndex;
      imageIndex += part.images.length;
      return <div key={index}>
        <div data-user-copy-part><StandaloneMarkdown text={part.text} client={client} hostId={hostId} threadId={threadId} cwd={cwd} onOpenFile={onOpenFile} onOpenFileAt={onOpenFileAt} onOpenImage={openSingleImage} /></div>
        {part.images.map((image, offset) => <MessageImage key={offset} source={image} client={client} hostId={hostId} cwd={cwd}
          onOpen={() => onOpenImages(images, first + offset)} />)}
        <details className="yard-unsupported-input"><summary>App message data</summary><pre>{displayJson(part.original)}</pre></details>
      </div>;
    }
    if (part.kind === 'image') {
      const current = imageIndex;
      if (!imageRemoved(index)) imageIndex++;
      return <MessageImage key={index} source={part.image} client={client} hostId={hostId} cwd={cwd} onOpen={() => onOpenImages(images, current)} />;
    }
    if (part.kind === 'reference') return <div className="yard-reference" data-reference-type={part.referenceType} key={index}>{part.referenceType}: {part.name} <span>{part.path}</span></div>;
    return <details className="yard-unsupported-input" key={index}><summary>Unsupported message content</summary><pre>{displayJson(part.value)}</pre></details>;
  });
  return <div className="yard-user-message"><div className="yard-message-label">You</div>
    <div className="yard-user-bubble">{editing ? <UserMessageEditor item={item} editing={editing} onUpdateEdit={onUpdateEdit}
      restriction={onEdit ? editRestriction : 'Message editing is unavailable.'} onEdit={onEdit ?? unavailableEdit}
      onCancel={() => { restoreFocus.current = true; onEndEdit(editing.id); }} onSubmitEdit={onSubmitEdit}
      recoveryNote={recoveryNote} renderPart={(index) => renderedParts[index]} renderContext={renderContext}
      rebaseRequired={rebaseRequired} canRebase={canRebase} onStartRebase={onStartRebase} onCancelRebase={onCancelRebase} /> : <>
      <div ref={body} className="yard-user-body">{renderedParts}</div>{long && !searchMatch && <button className="yard-expand" type="button" onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}>{expanded ? 'Show less' : 'Show more'} <ChevronDown size={15} /></button>}</>}</div>
    {!editing && <div className="yard-message-actions">{text.trim() && <CopyButton text={text} label="Copy message" content={() => body.current ? messageCopyContent(body.current) : { plainText: text, htmlText: '' }} />}
      {onEdit && <button ref={editButton} type="button" className="yard-icon-button" title={editRestriction ?? (draft ? 'Edit message' : 'This message cannot be edited without losing content')}
        aria-label="Edit message" disabled={!draft || Boolean(editRestriction)} onClick={() => {
          if (!draft || editRestriction) return;
          setActionError('');
          onStartEdit({ identity, turnId, itemId: item.id, turnIndex, itemIndex, draft, signature: editSourceSignature(item),
            snapshot: { ...item, content: draft.input, document: draft.document ?? item.document, hints: draft.hints ?? item.hints },
            origin: { hostId, threadId, turnId, itemId: item.id,
              ...(typeof item.format === 'string' ? { format: item.format } : {}),
              ...(draft.hints !== undefined ? { hints: structuredClone(draft.hints) } : {}) } });
        }}><Pencil size={16} /></button>}
      {onFork && <button type="button" className="yard-icon-button" title="Fork from this turn" aria-label="Fork from this turn" onClick={() => {
        setActionError('');
        void Promise.resolve().then(() => onFork(turnId)).catch((reason: unknown) => setActionError(reason instanceof Error ? reason.message : 'Fork failed.'));
      }}><GitFork size={16} /></button>}
    </div>}
    {!editing && editNote && <div className="yard-edit-note" role="status">{editNote}</div>}
    {actionError && <div className="yard-action-error" role="alert">{actionError}</div>}
  </div>;
}

function MessageItem(props: RenderItemProps) {
  const { item, turnId, threadId, client, hostId, cwd, onOpenFile, onOpenFileAt, onOpenVisualization, onOpenBrowser, onOpenImages, onFork } = props;
  const [actionError, setActionError] = useState('');
  const openSingleImage = useCallback((image: ImageSource) => onOpenImages([image], 0), [onOpenImages]);
  const markdownProps = { client, hostId, threadId, cwd, onOpenFile, onOpenFileAt, onOpenVisualization, onOpenImage: openSingleImage };
  if (item.type === 'userMessage') return <UserMessage {...props} />;
  if (item.type === 'agentMessage' || item.type === 'plan') {
    const text = asString(item.text);
    return <div className="yard-assistant-message"><div className="yard-message-label">{item.type === 'plan' ? 'Plan' : 'Codex'}</div>
      <StandaloneMarkdown text={text} {...markdownProps} />
      {asArray(item.questions).map((value, index) => {
        const question = asRecord(value);
        return <section className="yard-question" key={index}><strong>{asString(question.title) || 'Question'}</strong>
          <ul>{asArray(question.options).map((option, optionIndex) => <li key={optionIndex}>{displayJson(option)}</li>)}</ul></section>;
      })}
      {item.memoryCitation != null && <details className="yard-citation"><summary>Memory citations</summary><pre>{displayJson(item.memoryCitation)}</pre></details>}
      <div className="yard-message-actions"><CopyButton text={text} label="Copy message" />
        {onFork && <button type="button" className="yard-icon-button" title="Fork from this turn" aria-label="Fork from this turn" onClick={() => {
          setActionError('');
          void Promise.resolve().then(() => onFork(turnId)).catch((reason: unknown) => setActionError(reason instanceof Error ? reason.message : 'Fork failed.'));
        }}><GitFork size={16} /></button>}</div>
      {actionError && <div className="yard-action-error" role="alert">{actionError}</div>}
    </div>;
  }
  if (item.type === 'reasoning') {
    const summary = asArray(item.summary).filter((value): value is string => typeof value === 'string');
    const content = asArray(item.content).filter((value): value is string => typeof value === 'string');
    return <details className="yard-reasoning"><summary>{summary[0] || 'Thinking'}</summary>
      {summary.slice(1).map((text, index) => <StandaloneMarkdown key={`summary-${index}`} text={text} {...markdownProps} />)}
      {content.map((text, index) => <StandaloneMarkdown key={`content-${index}`} text={text} {...markdownProps} />)}
    </details>;
  }
  if (item.type === 'hookPrompt') return <div className="yard-hook-prompt"><div className="yard-message-label">Hook feedback</div>
    {asArray(item.fragments).map((fragment, index) => {
      const value = asRecord(fragment);
      return <div key={index}><StandaloneMarkdown text={asString(value.text)} {...markdownProps} />
        {asString(value.hookRunId) && <span className="yard-hook-id">{asString(value.hookRunId)}</span>}</div>;
    })}</div>;
  return <ToolItem item={item} client={client} hostId={hostId} threadId={threadId} cwd={cwd} onOpenFile={onOpenFile} onOpenFileAt={onOpenFileAt}
    onOpenBrowser={onOpenBrowser} onOpenImage={markdownProps.onOpenImage} />;
}

const MemoMessageItem = memo(MessageItem);

function TurnStatus({ turn }: { turn: TurnSummary }) {
  if (turn.status === 'completed') return null;
  return <div className={`yard-turn-status is-${turn.status}`} role={turn.status === 'failed' ? 'alert' : 'status'}>
    {turn.status === 'inProgress' ? 'In progress' : turn.status === 'interrupted' ? 'Interrupted' : 'Failed'}
    {turn.error?.message && <span>: {turn.error.message}</span>}
    {turn.error?.additionalDetails && <div>{turn.error.additionalDetails}</div>}
  </div>;
}

type SearchHit = { key: string; text: string };
type ViewerState = { images: ImageSource[]; index: number };
const itemKey = (turnId: string, itemId: string | null) => JSON.stringify([turnId, itemId]);

function searchText(value: unknown): string {
  if (typeof value === 'string') return /^data:(?:image|audio)\//i.test(value) ? '' : value;
  if (Array.isArray(value)) return value.map(searchText).join('\n');
  if (value !== null && typeof value === 'object') {
    const record = asRecord(value);
    return Object.entries(record).filter(([key, entry]) => !(record.type === 'image' && key === 'data')
      && !(record.type === 'imageGeneration' && key === 'result' && typeof entry === 'string' && /^[a-z\d+/=\s]+$/i.test(entry)))
      .map(([, entry]) => searchText(entry)).join('\n');
  }
  return typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}

export function StandaloneMessages({ client, hostId, thread, onEdit, onFork, onOpenFile, onOpenFileAt, onOpenVisualization, onOpenBrowser,
  editRecovery, editAccess, onEditDraftChange, onEditNavigationController, editRebase, onPrepareEditRebase, onCommitEditRebase,
  editHistory }: StandaloneMessagesProps & StandaloneMessagesRecoveryProps & { editHistory?: MessageEditHistory }) {
  const [query, setQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(-1);
  const [following, setFollowing] = useState(true);
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const searchOpened = useRef(new Set<HTMLDetailsElement>());
  const followRef = useRef(true);
  const threadIdentity = JSON.stringify([hostId, thread?.id]);
  const { editingHere, recoveryAvailable, rebaseRequired, canRebase, startRebase, cancelRebase, startEdit, updateEdit, endEdit, submitEdit, accessRestricted, accessError } = useMessageEditing({
    hostId, thread, threadIdentity, editRecovery, editAccess, onEditDraftChange, onEditNavigationController, editRebase, onPrepareEditRebase, onCommitEditRebase,
  });
  const currentThread = useRef(threadIdentity);
  const openImages = useCallback((images: ImageSource[], index: number) => setViewer({ images, index }), []);
  const closeViewer = useCallback(() => setViewer(null), []);
  const setViewerIndex = useCallback((index: number) => setViewer((current) => current ? { ...current, index } : null), []);
  const editTarget = useMemo(() => thread ? latestEditTarget(thread, editHistory) : null, [thread, editHistory]);
  let displayTurns = thread?.turns ?? [];
  let sourceMissing = false;
  if (thread && editingHere) {
    const turnIndex = thread.turns.findIndex((turn) => turn.id === editingHere.turnId);
    const itemIndex = turnIndex < 0 ? -1 : thread.turns[turnIndex]!.items.findIndex((item) => item.id === editingHere.itemId && item.type === 'userMessage');
    sourceMissing = itemIndex < 0;
    if (sourceMissing) {
      displayTurns = [...thread.turns];
      if (turnIndex < 0) {
        displayTurns.splice(Math.min(editingHere.turnIndex, displayTurns.length), 0,
          { id: editingHere.turnId, status: 'completed', itemsView: 'summary', items: [editingHere.snapshot] });
      } else {
        const turn = displayTurns[turnIndex]!;
        const items = [...turn.items];
        items.splice(Math.min(editingHere.itemIndex, items.length), 0, editingHere.snapshot);
        displayTurns[turnIndex] = { ...turn, items };
      }
    }
  }
  const hasQuery = Boolean(query.trim());
  const searchable = useMemo<SearchHit[]>(() => !hasQuery ? [] : thread?.turns.flatMap((turn) => [
    ...turn.items.map((item) => ({ key: itemKey(turn.id, item.id), text: searchText(item).toLocaleLowerCase() })),
    ...(turn.status !== 'completed' ? [{ key: itemKey(turn.id, null), text: searchText([turn.status, turn.error]).toLocaleLowerCase() }] : []),
  ]) ?? [], [hasQuery, thread]);
  const hits = useMemo<SearchHit[]>(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? searchable.filter((hit) => hit.text.includes(needle)) : [];
  }, [query, searchable]);
  const hitKeys = useMemo(() => new Set(hits.map((hit) => hit.key)), [hits]);
  const selected = matchIndex < 0 ? undefined : hits[Math.min(matchIndex, hits.length - 1)];
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (currentThread.current !== threadIdentity) {
      currentThread.current = threadIdentity;
      followRef.current = true;
      setFollowing(true);
      setViewer(null);
    }
    if (followRef.current) element.scrollTop = element.scrollHeight;
  });
  useEffect(() => {
    let states: { element: HTMLDetailsElement; open: boolean }[] = [];
    function beforePrint() {
      states = Array.from(scroller.current?.querySelectorAll('details') ?? [], (element) => ({ element, open: element.open }));
      for (const state of states) state.element.open = true;
    }
    function afterPrint() {
      for (const state of states) if (state.element.isConnected) state.element.open = state.open;
      states = [];
    }
    window.addEventListener('beforeprint', beforePrint);
    window.addEventListener('afterprint', afterPrint);
    return () => { window.removeEventListener('beforeprint', beforePrint); window.removeEventListener('afterprint', afterPrint); };
  }, []);
  function restoreSearchDetails() {
    for (const details of searchOpened.current) if (details.isConnected) details.open = false;
    searchOpened.current.clear();
  }
  function scrollToMatch(index: number) {
    if (!hits.length) return;
    const next = ((index % hits.length) + hits.length) % hits.length;
    setMatchIndex(next);
    followRef.current = false;
    setFollowing(false);
    const node = nodes.current.get(hits[next]?.key ?? '');
    node?.querySelectorAll('details').forEach((details) => {
      if (!details.open) { searchOpened.current.add(details); details.open = true; }
    });
    node?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function followLatest() {
    followRef.current = true;
    setFollowing(true);
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }
  function onScroll() {
    const element = scroller.current;
    if (!element) return;
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    if (nearBottom !== followRef.current) { followRef.current = nearBottom; setFollowing(nearBottom); }
  }
  return <div className="yard-messages-root">
    {accessError && <p role="alert">{accessError}</p>}
    <div className="yard-message-search"><Search size={16} aria-hidden="true" /><input aria-label="Search messages" value={query}
      placeholder="Search messages" onChange={(event) => { restoreSearchDetails(); setQuery(event.target.value); setMatchIndex(-1); }}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); scrollToMatch(event.shiftKey && matchIndex < 0 ? hits.length - 1 : matchIndex + (event.shiftKey ? -1 : 1)); } }} />
      {query && <><span aria-live="polite">{hits.length ? `${matchIndex < 0 ? 0 : Math.min(matchIndex, hits.length - 1) + 1} / ${hits.length}` : '0 results'}</span>
        <button type="button" className="yard-icon-button" title="Previous result" aria-label="Previous result" disabled={!hits.length} onClick={() => scrollToMatch(matchIndex < 0 ? hits.length - 1 : matchIndex - 1)}><ChevronLeft size={16} /></button>
        <button type="button" className="yard-icon-button" title="Next result" aria-label="Next result" disabled={!hits.length} onClick={() => scrollToMatch(matchIndex + 1)}><ChevronRight size={16} /></button>
        <button type="button" className="yard-icon-button" title="Clear search" aria-label="Clear search" onClick={() => { restoreSearchDetails(); setQuery(''); setMatchIndex(-1); }}><X size={16} /></button></>}
    </div>
    <div className="yard-message-scroll" ref={scroller} onScroll={onScroll} onClickCapture={(event) => {
      const target = event.target;
      if (target instanceof Element) {
        const summary = target.closest('summary');
        if (summary?.parentElement instanceof HTMLDetailsElement) searchOpened.current.delete(summary.parentElement);
      }
    }} data-thread-find-target="conversation">
      {!thread ? <div className="yard-message-empty">Select a conversation</div> : displayTurns.length === 0 ? <div className="yard-message-empty">No messages yet</div> :
        <div className="yard-message-list">{displayTurns.map((turn, turnIndex) => <section className="yard-turn" key={JSON.stringify([hostId, thread.id, turn.id])} data-turn-id={turn.id}>
          {turn.items.map((item, itemIndex) => {
            const syntheticDraft = sourceMissing && item === editingHere?.snapshot;
            const duplicateId = syntheticDraft && turn.items.some((entry) => entry !== item && entry.id === item.id);
            const key = duplicateId ? JSON.stringify([turn.id, item.id, 'edit-draft']) : itemKey(turn.id, item.id);
            const searchMatch = hitKeys.has(key);
            const itemEditing = editingHere?.turnId === turn.id && editingHere.itemId === item.id
              && (!sourceMissing || syntheticDraft) ? editingHere : null;
            const isTarget = editTarget?.turnId === turn.id && editTarget.itemId === item.id;
            const editRestriction = accessRestricted ? 'This message is being edited in another view.' : itemEditing && sourceMissing ? (itemEditing.requiresCurrentSource
              ? 'Reload the complete conversation before sending this recovered edit.'
              : recoveryAvailable ? null : 'The original message is no longer available. The edited draft is retained.')
              : !isTarget ? 'Only the latest user message can be edited.'
              : editTarget.restriction ?? (editingHere && !itemEditing ? 'Finish the current message edit first.' : null);
            const recoveryNote = itemEditing && sourceMissing && recoveryAvailable
              ? 'The original message is no longer available. The recovered edit will be checked before sending.' : null;
            return <article className="yard-message-item" key={duplicateId ? `${item.id}:edit-draft` : item.id} data-message-id={item.id} data-search-current={selected?.key === key || undefined}
              ref={(node) => { if (node) nodes.current.set(key, node); else nodes.current.delete(key); }}>
              <MemoMessageItem item={item} turnId={turn.id} threadId={thread.id} client={client} hostId={hostId} cwd={thread.cwd} onEdit={onEdit} onFork={onFork}
                onOpenFile={onOpenFile} onOpenFileAt={onOpenFileAt} onOpenVisualization={onOpenVisualization} onOpenBrowser={onOpenBrowser}
                onOpenImages={openImages} editRestriction={editRestriction} editing={itemEditing} identity={threadIdentity}
                turnIndex={turnIndex} itemIndex={itemIndex} onStartEdit={startEdit} onUpdateEdit={updateEdit} onEndEdit={endEdit}
                onSubmitEdit={submitEdit} recoveryNote={recoveryNote} rebaseRequired={Boolean(itemEditing && rebaseRequired)}
                canRebase={Boolean(itemEditing && canRebase && onEdit)} onStartRebase={startRebase} onCancelRebase={cancelRebase}
                searchMatch={searchMatch} /></article>;
          })}{turn.status !== 'completed' && <div data-search-current={selected?.key === itemKey(turn.id, null) || undefined}
            ref={(node) => { const key = itemKey(turn.id, null); if (node) nodes.current.set(key, node); else nodes.current.delete(key); }}><TurnStatus turn={turn} /></div>}
        </section>)}</div>}
    </div>
    {!following && thread && <button type="button" className="yard-jump-latest" onClick={followLatest}><ArrowDown size={16} /> Latest</button>}
    {viewer && thread && <ImageViewer images={viewer.images} index={viewer.index} client={client} hostId={hostId} cwd={thread.cwd}
      onIndexChange={setViewerIndex} onClose={closeViewer} />}
  </div>;
}
