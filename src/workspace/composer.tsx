import { ArrowUp, Check, FolderClosed, Mic, Square, X } from 'lucide-react';
import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type Ref } from 'react';
import { baseKeymap, splitBlock } from 'prosemirror-commands';
import { preference } from './preferences.ts';
import { closeHistory, history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { Fragment, Schema, type Node } from 'prosemirror-model';
import { EditorState, Plugin, Selection } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView, type DirectEditorProps } from 'prosemirror-view';
import type { TurnSummary } from '../../lib/codex-protocol.ts';
import type { StartupProject } from '../native/startup-sidebar.ts';
import { record } from '../native/protocol.ts';
import { browserAtoms, deleteQueuedSubmission, enqueueMessage, interruptTurn, reorderQueuedSubmissions, startQueuedSubmission, steerTurn,
  stageComposerFile, WorkspaceRequestError, writeAtom, type QueuedSubmission, type SubmissionOptions } from './host.ts';
import { ComposerToolbar, FullAccessNotice, useComposerOptions } from './composer-options.tsx';
import { AttachmentCard, AttachmentPicker, useComposerAttachments } from './composer-attachments.tsx';
import { composerInput, type PromptAttachment } from './composer-input.ts';
import { pluginMentionMarkup, pluginMentionPath, pluginMentionSegments, validPluginId, type OutputType, type PluginMention } from './output-types.ts';
import { mergeLiveTurns, type TurnStream } from './turn-stream.ts';
import { AsyncQuestionPanel, useAsyncQuestionOpen } from './async-questions.tsx';
import { ComposerChanges, type OpenTurnChanges } from './turn-changes-view.tsx';
import { editForRequest, isBlockingRequest, TurnRequestCard, useTurnRequest } from './turn-requests.tsx';
import { QueuedMessages, queuedPrompt, useQueuedMessages } from './queued-messages.tsx';
import { ProjectMarker } from './project-marker.tsx';
import { pendingMessages, usePendingMessages } from './pending-messages.ts';
import { ConversationGoal, useConversationGoal } from './conversation-goal.tsx';
import { useConversationUsage } from './conversation-usage.tsx';
import { imageCommentPrompt, imageEditPrompt, type EditableImage, type ImageCommentGroup, type ImageEditAction } from './image-edit-model.ts';
import './image-edit-composer.css';

const draftKey = 'composer-prompt-drafts-v1';
const draftFilesKey = 'yard-recovered-composer-files-v1';
const promptHistoryKey = 'prompt-history';
const globalHistory = 'global';
const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'inline*', parseDOM: [{ tag: 'p' }], toDOM: () => ['p', 0] },
    text: { group: 'inline' },
    pluginMention: {
      inline: true, group: 'inline', atom: true, attrs: { plugin: {}, label: {} },
      leafText: node => pluginMentionMarkup(mentionFromNode(node)),
      toDOM: node => {
        const mention = mentionFromNode(node);
        return ['span', { class: '_Mention_a4hbb_2 yard-source-output-mention', 'plugin-mention-path': pluginMentionPath(mention),
          'plugin-mention-name': mention.label, 'data-appearance': 'inline-mention', 'data-layout': 'inline-flow',
          'data-font-weight': 'medium', 'data-tone': 'accent', contenteditable: 'false' },
        ['span', { 'aria-hidden': 'true' }], mention.label];
      },
      parseDOM: [{ tag: 'span[plugin-mention-path]', getAttrs: (element: HTMLElement) => {
        const path = element.getAttribute('plugin-mention-path');
        const label = element.getAttribute('plugin-mention-name');
        const plugin = path?.startsWith('plugin://') ? path.slice(9) : '';
        return validPluginId(plugin) && label && !/[\]\r\n]/.test(label) ? { plugin, label } : false;
      } }],
    },
  },
});

function drafts() {
  const value = browserAtoms()[draftKey];
  return (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
}
function draftFiles(scope: string): PromptAttachment[] {
  const files = record(browserAtoms()[draftFilesKey])[scope];
  if (!Array.isArray(files)) return [];
  return files.flatMap(value => {
    const { name, path, image, generatedImage } = record(value);
    const generated = record(generatedImage);
    return typeof name === 'string' && typeof path === 'string' && path.startsWith('/') && typeof image === 'boolean'
      ? [{ name, path, image, ...(image && typeof generated.id === 'string' && typeof generated.label === 'string'
        && Array.isArray(generated.comments) ? { generatedImage: { id: generated.id, label: generated.label,
          comments: generated.comments.flatMap(value => {
            const comment = record(value);
            return typeof comment.id === 'string' && typeof comment.text === 'string' &&
              typeof comment.x === 'number' && typeof comment.y === 'number' ? [{ id: comment.id, text: comment.text,
                x: Math.max(0, Math.min(1, comment.x)), y: Math.max(0, Math.min(1, comment.y)) }] : [];
          }) } } : {}) }] : [];
  });
}
async function saveDraftFiles(scope: string, files: readonly PromptAttachment[]) {
  const map = { ...record(browserAtoms()[draftFilesKey]) };
  if (!files.length && !(scope in map)) return;
  if (files.length) map[scope] = files;
  else delete map[scope];
  await writeAtom(draftFilesKey, map);
}
export async function recoverQueuedDraft(scope: string, item: QueuedSubmission) {
  const prompt = queuedPrompt(item);
  const saved = drafts();
  saved[scope] = [saved[scope], prompt.text].filter(part => typeof part === 'string' && part).join('\n\n');
  await writeAtom(draftKey, saved);
  const before = draftFiles(scope);
  await saveDraftFiles(scope, [...before, ...prompt.attachments.filter(file => !before.some(row => row.path === file.path))]);
}

function mentionFromNode(node: Node): PluginMention {
  return { label: node.attrs.label, plugin: node.attrs.plugin };
}

function pluginMention(mention: PluginMention) {
  return schema.node('pluginMention', { plugin: mention.plugin, label: mention.label });
}

function content(text: string) {
  return schema.node('doc', null, text.split('\n').map(line => schema.node('paragraph', null,
    line ? pluginMentionSegments(line).map(segment => typeof segment === 'string' ? schema.text(segment) : pluginMention(segment)) : undefined)));
}

function promptText(doc: Node) { return doc.textBetween(0, doc.content.size, '\n'); }

function promptHistory(): Record<string, unknown> {
  const saved = browserAtoms()[promptHistoryKey];
  return Array.isArray(saved) ? { [globalHistory]: saved } : { ...record(saved) };
}

function promptEntries(history: Record<string, unknown>, scope: string): unknown[] {
  const value = history[scope];
  return Array.isArray(value) ? value : [];
}

function historyText(entry: unknown) {
  const { markdown, plain } = record(entry);
  return typeof entry === 'string' ? entry : typeof markdown === 'string' ? markdown : typeof plain === 'string' ? plain : '';
}

function rememberPrompt(scope: string, doc: Node) {
  const plain = promptText(doc);
  if (!plain.trim()) return;
  const history = promptHistory();
  const entries = promptEntries(history, scope);
  // Match the pinned editor's 20 prompts per scope and 100 thread scopes.
  delete history[scope];
  history[scope] = [...entries, { plain, document: doc.toJSON() }].slice(-20);
  for (const key of Object.keys(history).filter(key => key !== globalHistory && key !== 'chatgpt-global').slice(0, -100)) delete history[key];
  void writeAtom(promptHistoryKey, history).catch(console.error);
}

function placeholder(label: string) {
  return new Plugin({
    props: {
      decorations({ doc }) {
        if (doc.childCount !== 1 || doc.firstChild?.content.size) return DecorationSet.empty;
        return DecorationSet.create(doc, [Decoration.node(0, doc.content.size, {
          class: 'placeholder', 'data-empty-paragraph': 'true', 'data-placeholder': label,
        })]);
      },
    },
  });
}

export function mountPromptEditor(mount: HTMLElement, text: string, label: string, onChange: (text: string) => void,
  attributes: NonNullable<DirectEditorProps['attributes']> = {}, historyScope?: string, onEnter?: (event: KeyboardEvent) => boolean) {
  let selection: { index: number; text: string } | undefined;
  const editor = new EditorView(mount, {
    state: EditorState.create({ doc: content(text), schema,
      plugins: [placeholder(label), history(), keymap({
        'Mod-z': undo, 'Shift-Mod-z': redo, 'Mod-y': redo, 'Shift-Enter': splitBlock,
      }), keymap(baseKeymap)] }),
    attributes: { enterkeyhint: 'send', ...attributes, 'aria-label': label, 'aria-multiline': 'true',
      'aria-placeholder': label, role: 'textbox', tabindex: '0', dir: 'auto' },
    handleDOMEvents: {
      keydown(view, event) {
        if (event.key !== 'Enter' || !(event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) ||
            event.isComposing || event.keyCode === 229 || view.composing) return false;
        // Android's synthesized Enter omits modifiers. Handle explicit physical
        // keyboard shortcuts before that conversion, while leaving IME Enter to
        // ProseMirror's composition-aware DOM processing.
        if (!event.shiftKey && !event.altKey && onEnter?.(event)) {
          event.preventDefault(); event.stopPropagation(); return true;
        }
        if (event.shiftKey || event.altKey) {
          event.preventDefault(); return splitBlock(view.state, view.dispatch);
        }
        return false;
      },
    },
    handleKeyDown(view, event) {
      const { key } = event;
      // ProseMirror routes Android/iOS DOM-based Enter through this handler too.
      // React's DOM keydown listener never sees those synthesized editor events.
      if (key === 'Enter' && !event.shiftKey && !event.altKey && !event.isComposing && event.keyCode !== 229 &&
          !view.composing && onEnter?.(event)) {
        event.stopPropagation();
        return true;
      }
      if (!historyScope || key !== 'ArrowUp' && key !== 'ArrowDown' || event.altKey || event.ctrlKey ||
          event.shiftKey || event.metaKey || event.isComposing || event.keyCode === 229 || view.composing) return false;
      const { state } = view;
      if (!state.selection.empty || !state.selection.eq(Selection.atEnd(state.doc))) return false;
      const entries = promptEntries(promptHistory(), historyScope);
      if (!entries.length || !selection && (key === 'ArrowDown' || !!promptText(state.doc).trim())) return false;
      const index = selection ? (selection.index + (key === 'ArrowUp' ? -1 : 1) + entries.length) % entries.length
        : entries.length - 1;
      const end = key === 'ArrowDown' && selection?.index === entries.length - 1;
      const entry = end ? undefined : entries[index];
      const text = historyText(entry);
      let restored = content(text);
      const json = record(entry).document;
      if (json != null) {
        try {
          const saved = state.schema.nodeFromJSON(json);
          saved.check();
          if (saved.type === state.schema.topNodeType && promptText(saved) === text) restored = saved;
        } catch { /* Older editors may use a different rich-text schema. */ }
      }
      selection = end ? undefined : { index, text };
      const transaction = state.tr.replaceWith(0, state.doc.content.size, restored.content);
      view.dispatch(transaction.setSelection(Selection.atEnd(transaction.doc)));
      view.focus();
      event.stopPropagation();
      return true;
    },
    dispatchTransaction(transaction) {
      const next = editor.state.apply(transaction);
      editor.updateState(next);
      if (transaction.docChanged) {
        const text = promptText(next.doc);
        if (selection?.text !== text) selection = undefined;
        onChange(text);
      }
    },
  });
  return editor;
}

type ProjectPicker = { menuId: string; options: StartupProject[]; selected?: StartupProject; select(id?: string): void };

function ProjectRail({ menuId, options, selected, select }: ProjectPicker) {
  const menu = useRef<HTMLDivElement>(null);
  const label = selected?.label ?? 'Choose project';
  return <div className="yard-source-project-rail">
    <div data-composer-utility-rail="" className="yard-source-project-rail-surface">
      <button type="button" aria-label={selected ? 'Change project: ' + label : label} className="yard-source-project-trigger hover:bg-primary-ghost-hover"
        popoverTarget={menuId} data-composer-navigation-target="workspace-project" data-selected={selected ? '' : undefined}>
        {selected?.appearance ? <ProjectMarker appearance={selected.appearance} /> : <FolderClosed size={16} aria-hidden="true" />}<span>{label}</span>
      </button>
      {selected && <button type="button" className="yard-source-project-clear"
        onClick={() => select()} title="Don't work in a project" aria-label="Don't work in a project">
        <X size={12} aria-hidden="true" />
      </button>}
    </div>
    <div id={menuId} ref={menu} popover="auto" aria-label="Workspace projects" className="yard-source-project-menu">
      <button type="button" onClick={() => { select(); menu.current?.hidePopover(); }}>
        {!selected && <Check size={14} aria-hidden="true" />}<span>No project</span>
      </button>
      {options.map(option => <button type="button" key={option.id}
        onClick={() => { select(option.id); menu.current?.hidePopover(); }}>
        {selected?.id === option.id ? <Check size={14} aria-hidden="true" /> : option.appearance
          ? <ProjectMarker appearance={option.appearance} size={14} /> : <FolderClosed size={14} aria-hidden />}
        <span>{option.label}</span>
      </button>)}
    </div>
  </div>;
}

const noStream = () => () => {};

export type RunMessageEdit = (run: (stillSelected: () => boolean) => Promise<void>) => Promise<void>;
export type ImageComposerPlacement = { left: number; bottom: number; width: number };
export type ComposerImageAttachments = { images: readonly string[]; comments: readonly ImageCommentGroup[]; pendingEditId?: string };
const emptyImageAttachments: ComposerImageAttachments = { images: [], comments: [] };
export type ComposerHandle = { appendOutput(type: OutputType): void; insertPlugin(mention: PluginMention): void;
  openAttachmentPicker(): void; focus(): void; stop(turnId: string): Promise<void>;
  imageEdit(action: ImageEditAction): Promise<void>;
  element(): HTMLFormElement | null;
  placeImageEditor(placement?: ImageComposerPlacement): void;
  imageAttachments(): ComposerImageAttachments;
  subscribeImageAttachments(listener: () => void): () => void;
  runMessageEdit: RunMessageEdit };

export function Composer({ ref, scope, label, projectId, projects, stream, historyTurns, onSend, openQueuedSidechat, openGoal, openChanges, destinationKnown = true }: {
  ref?: Ref<ComposerHandle>;
  scope: string; label: string;
  projectId?: string;
  destinationKnown?: boolean;
  projects?: ProjectPicker;
  stream?: TurnStream;
  historyTurns?: TurnSummary[];
  onSend?: (text: string, permissionChoice: string | undefined, attachments: readonly PromptAttachment[], clientUserMessageId: string,
    options?: SubmissionOptions) => Promise<void | (() => void)>;
  openQueuedSidechat?(item: QueuedSubmission): Promise<void>;
  openChanges?: OpenTurnChanges;
  openGoal?(threadId: string, hostId: string): void;
}) {
  const hostId = stream?.hostId ?? 'local';
  const questionOpen = useAsyncQuestionOpen();
  const historyScope = scope === 'new-conversation' ? globalHistory : scope;
  const options = useComposerOptions(stream?.threadId, projectId, hostId, destinationKnown);
  const goal = useConversationGoal(stream?.threadId, hostId);
  const usage = useConversationUsage(stream?.threadId, hostId);
  const attachments = useComposerAttachments(JSON.stringify([scope, projectId]), hostId);
  const [imagePlacement, setImagePlacement] = useState<ImageComposerPlacement>();
  const [pendingImageEdit, setPendingImageEdit] = useState<string>();
  const form = useRef<HTMLFormElement>(null);
  useLayoutEffect(() => {
    const wrapper = form.current?.parentElement;
    if (!wrapper || !imagePlacement) return;
    // Keep the original editor mounted, including selection and undo history.
    // The wrapper is the named query container; positioning the form inside it
    // would make that container the form's fixed-position containing block.
    const placement = { position: 'absolute', left: imagePlacement.left + 'px', right: 'auto',
      bottom: imagePlacement.bottom + 'px', width: imagePlacement.width + 'px',
      'z-index': '60', visibility: 'visible', margin: '0' };
    const previous = Object.keys(placement).map(key => [key, wrapper.style.getPropertyValue(key), wrapper.style.getPropertyPriority(key)]);
    for (const [key, value] of Object.entries(placement)) wrapper.style.setProperty(key, value);
    return () => { for (const [key, value, priority] of previous) {
      if (value) wrapper.style.setProperty(key!, value, priority); else wrapper.style.removeProperty(key!);
    } };
  }, [imagePlacement]);
  const compact = (questionOpen || !!imagePlacement) && !attachments.items.length;
  const imageListeners = useRef(new Set<() => void>());
  const imageSnapshot = useMemo<ComposerImageAttachments>(() => ({
    ...(pendingImageEdit ? { pendingEditId: pendingImageEdit } : {}),
    images: attachments.items.flatMap(row => row.file?.generatedImage ? [row.file.generatedImage.id] : []),
    comments: attachments.items.flatMap(row => {
      const file = row.file, image = file?.generatedImage;
      return file && image ? [{ image: { id: image.id, label: image.label, image: { path: file.path, name: file.name } }, comments: image.comments }] : [];
    }),
  }), [attachments.items, pendingImageEdit]);
  const imageSnapshotRef = useRef(emptyImageAttachments);
  const stagedImages = useRef(new Map<string, Promise<PromptAttachment>>());
  useLayoutEffect(() => {
    imageSnapshotRef.current = imageSnapshot;
    for (const listener of imageListeners.current) listener();
  }, [imageSnapshot]);
  const layout = compact ? 'single-line' : 'multiline';
  const mount = useRef<HTMLDivElement>(null);
  const attachmentPicker = useRef<HTMLInputElement>(null);
  const view = useRef<EditorView | null>(null);
  const recoveredFiles = useRef<PromptAttachment[]>([]);
  const preparing = useRef<{ id: string; doc: Node; text: string; files: readonly PromptAttachment[] } | undefined>(undefined);
  const preparations = usePendingMessages(scope);
  const busy = useRef(false);
  const queueBusy = useRef(false);
  const stopRequested = useRef<string | undefined>(undefined);
  const [stopping, setStopping] = useState<string>();
  const request = useTurnRequest(stream?.threadId, hostId);
  const blocked = request && isBlockingRequest(request);
  const subscribe = stream?.subscribe ?? noStream;
  const requestedEdit = useSyncExternalStore(subscribe, () => request?.kind === 'file' && stream
    ? editForRequest(request, mergeLiveTurns(historyTurns, stream.read())) : undefined);
  const latestStatus = useSyncExternalStore(subscribe, () => stream && mergeLiveTurns(historyTurns, stream.read()).at(-1)?.status);
  const activeTurn = useSyncExternalStore(subscribe, () => {
    const latest = stream && mergeLiveTurns(historyTurns, stream.read()).at(-1);
    return latest?.status === 'inProgress' ? latest.id : null;
  });
  const queue = useQueuedMessages(stream?.threadId, hostId);
  const [queuePending, setQueuePending] = useState(false);
  const [editingQueued, setEditingQueued] = useState(false);
  const [populated, setPopulated] = useState(() => typeof drafts()[scope] === 'string' && !!String(drafts()[scope]).trim());
  const [status, setStatus] = useState<'idle' | 'sending' | 'uncertain'>('idle');
  const [failure, setFailure] = useState<string>();
  function persistDraft(text: string) {
    const current = drafts();
    // Keep the submitted draft recoverable until delivery is known, while
    // allowing the user to type their next message in the cleared editor.
    const saved = [preparing.current?.text, text].filter(Boolean).join('\n\n');
    if (saved) current[scope] = saved; else delete current[scope];
    void writeAtom(draftKey, current).catch(console.error);
  }
  function releasePreparation(id: string) {
    const held = preparing.current;
    if (held?.id !== id) return;
    preparing.current = undefined;
    setPendingImageEdit(current => current === id ? undefined : current);
    if (view.current) persistDraft(promptText(view.current.state.doc));
    else {
      const saved = String(drafts()[scope] ?? '');
      persistDraft(saved === held.text ? '' : saved.startsWith(held.text + '\n\n') ? saved.slice(held.text.length + 2) : saved);
    }
    removeAttachments([], held.files.map(file => file.path));
  }
  useEffect(() => {
    const held = preparing.current;
    if (status === 'uncertain' && held && !preparations.some(message => message.id === held.id)) {
      releasePreparation(held.id);
      busy.current = false; setStatus('idle'); setFailure(undefined);
    }
  }, [preparations, status]);
  const stop = useCallback(async (turnId: string) => {
    if (!stream || activeTurn !== turnId || stopRequested.current === turnId) return;
    stopRequested.current = turnId;
    setStopping(turnId);
    setFailure(undefined);
    try { await interruptTurn(stream.threadId, turnId, stream.hostId); }
    catch (error) {
      if (stopRequested.current !== turnId) return;
      stopRequested.current = undefined;
      setStopping(undefined);
      throw error;
    }
  }, [activeTurn, stream]);
  useImperativeHandle(ref, () => ({
    focus() { view.current?.focus(); },
    imageEdit,
    element: () => form.current,
    placeImageEditor(placement) { setImagePlacement(before => before?.left === placement?.left &&
      before?.bottom === placement?.bottom && before?.width === placement?.width ? before : placement); },
    imageAttachments: () => imageSnapshotRef.current,
    subscribeImageAttachments(listener) { imageListeners.current.add(listener); return () => { imageListeners.current.delete(listener); }; },
    openAttachmentPicker() { if (status === 'idle') attachmentPicker.current?.click(); },
    insertPlugin(mention) {
      const editor = view.current;
      if (status !== 'idle' || !editor || editor.composing) return;
      const { state } = editor;
      const before = state.selection.$from.nodeBefore;
      const prefix = before && (!before.isText || !/\s$/.test(before.textContent)) ? [schema.text(' ')] : [];
      const fragment = Fragment.fromArray([...prefix, pluginMention(mention), schema.text(' ')]);
      const from = state.selection.from;
      const transaction = closeHistory(state.tr).replaceWith(from, state.selection.to, fragment);
      editor.dispatch(transaction.setSelection(Selection.near(transaction.doc.resolve(from + fragment.size))));
      editor.focus();
    },
    stop,
    async runMessageEdit(run) {
      const editor = view.current;
      if (!editor || busy.current || queueBusy.current || options.pending || blocked) {
        throw new Error('Wait for the current message operation to finish.');
      }
      busy.current = true;
      setStatus('sending');
      try { await run(() => view.current === editor); }
      finally { busy.current = false; setStatus('idle'); }
    },
    appendOutput(type) {
      const editor = view.current;
      if (!editor || editor.composing) return;
      const { state } = editor;
      const transaction = closeHistory(state.tr).setSelection(Selection.atEnd(state.doc));
      const prefix = state.doc.lastChild?.content.size && !/\s$/.test(state.doc.lastChild.textContent) ? ' ' : '';
      const prompt = Fragment.fromArray([schema.text(prefix + 'Create a new ' + type.kind + ' with '), pluginMention(type),
        schema.text('. Start by asking me what it should be about.')]);
      editor.dispatch(transaction.replaceWith(transaction.selection.from, transaction.selection.to, prompt));
      editor.dispatch(closeHistory(editor.state.tr));
    },
  }), [stop, status, options.pending, options.draftPermission?.id, blocked, attachments.items, attachments.pending,
    onSend, queue.mode, activeTurn, historyTurns]);
  const enterKey = useRef<(event: KeyboardEvent) => boolean>(() => false);
  useLayoutEffect(() => {
    enterKey.current = event => {
      const mode = preference<string>('composerEnterBehavior', 'enter');
      const commandToSend = mode === 'cmdAlways' || mode === 'cmdIfMultiline' && !!view.current?.state.doc.textBetween(0, view.current.state.doc.content.size, '\n').includes('\n');
      if (commandToSend && !event.metaKey && !event.ctrlKey) return false;
      const reverseFollowUp = (event.metaKey || event.ctrlKey) && !commandToSend;
      if (reverseFollowUp && !activeTurn) return false;
      if (!event.repeat) void submit(reverseFollowUp);
      return true;
    };
  });
  useLayoutEffect(() => {
    const saved = drafts()[scope];
    recoveredFiles.current = draftFiles(scope);
    const editor = mountPromptEditor(mount.current!, typeof saved === 'string' ? saved : '', label, text => {
      setPopulated(!!text.trim());
      persistDraft(text);
    }, { 'data-codex-composer': 'true', 'data-composer-markdown': '' }, historyScope, event => enterKey.current(event));
    view.current = editor;
    stagedImages.current.clear();
    if (recoveredFiles.current.length) attachments.restore(recoveredFiles.current);
    return () => { view.current = null; editor.destroy(); };
  }, [scope, label, historyScope]);

  function removeAttachments(ids: readonly string[], sentPaths?: readonly string[]) {
    const paths = sentPaths ?? attachments.items.filter(item => ids.includes(item.id)).map(item => item.file?.path);
    const next = recoveredFiles.current.filter(file => !paths.includes(file.path));
    if (next.length !== recoveredFiles.current.length) {
      recoveredFiles.current = next;
      void saveDraftFiles(scope, next).catch(console.error);
    }
    attachments.remove(ids);
  }

  function prepareGeneratedImage(image: EditableImage): Promise<PromptAttachment> {
    const key = JSON.stringify([image.id, image.image]);
    let file = stagedImages.current.get(key);
    if (!file) {
      file = (async () => {
        const name = image.label + '.png';
        const source = image.image;
        const attachment = source.path !== undefined ? { name, path: source.path, image: true } : await (async () => {
          let blob: Blob;
          const data = /^data:(image\/[a-z0-9.+-]+)(;base64)?,([\s\S]*)$/i.exec(source.url!);
          if (data) {
            const bytes = data[2] ? Uint8Array.from(atob(data[3]!), character => character.charCodeAt(0))
              : new TextEncoder().encode(decodeURIComponent(data[3]!));
            blob = new Blob([bytes], { type: data[1] });
          } else {
            const response = await fetch(source.url!, { credentials: 'omit', referrerPolicy: 'no-referrer' });
            if (!response.ok) throw new Error('Could not prepare image attachment.');
            blob = await response.blob();
          }
          if (!blob.type.startsWith('image/')) throw new Error('Could not prepare image attachment.');
          return stageComposerFile(new File([blob], name, { type: blob.type }), hostId);
        })();
        return { ...attachment, image: true, generatedImage: { id: image.id, label: image.label, comments: [] } };
      })();
      stagedImages.current.set(key, file);
      void file.catch(() => { if (stagedImages.current.get(key) === file) stagedImages.current.delete(key); });
    }
    return file;
  }

  async function imageEdit(action: ImageEditAction) {
    const editor = view.current;
    if (!editor || busy.current || queueBusy.current || blocked || attachments.pending) {
      throw new Error('Wait for the current message operation to finish.');
    }
    if (action.kind === 'edit') {
      if (!onSend || options.pending) throw new Error('The conversation is not ready to send an image edit.');
      busy.current = true; setStatus('sending'); setFailure(undefined);
      const id = crypto.randomUUID();
      const queued = !!stream && !!activeTurn && queue.mode === 'queue';
      try {
        const original = await prepareGeneratedImage(action.image);
        const files: PromptAttachment[] = [original];
        if (action.operation === 'remove') {
          if (!action.mask) throw new Error('Brush over what you want to remove.');
          const mask = await stageComposerFile(new File([action.mask], 'selection-mask.png', { type: 'image/png' }), hostId);
          files.push({ ...mask, generatedImage: { id: action.image.id + ':mask', label: 'Selection mask', comments: [] } });
        }
        if (view.current !== editor) throw new Error('The conversation changed before the image edit was sent.');
        const text = imageEditPrompt(action);
        if (!queued) {
          setPendingImageEdit(id);
          const latest = stream && mergeLiveTurns(historyTurns, stream.read()).at(-1);
          preparing.current = { id, doc: editor.state.doc, text: '', files: [] };
          pendingMessages.add(scope, { id, input: composerInput(text, files), startedAt: Date.now() / 1000,
            ...(activeTurn ? { turnId: activeTurn, after: latest?.items.at(-1)?.id } : { afterTurnId: latest?.id }) });
        }
        if (stream && activeTurn) {
          if (queued) await enqueueMessage(stream.threadId, text, files, hostId);
          else await steerTurn(stream.threadId, activeTurn, composerInput(text, files), hostId, id);
          queue.refresh();
        } else { const accepted = await onSend(text, options.draftPermission?.id, files, id, { turnTrigger: 'image_edit' }); accepted?.(); }
        releasePreparation(id);
        setStatus('idle'); busy.current = false;
      } catch (error) {
        if (error instanceof WorkspaceRequestError && error.uncertain) {
          setStatus('uncertain'); setFailure('Delivery is unknown. Check the conversation before trying again.');
        } else {
          pendingMessages.remove(scope, id);
          if (preparing.current?.id === id) preparing.current = undefined;
          setPendingImageEdit(current => current === id ? undefined : current);
          setStatus('idle'); busy.current = false;
          setFailure(error instanceof Error ? error.message : String(error));
        }
        throw error;
      }
      return;
    }
    busy.current = true; setStatus('sending');
    try {
      const groups = action.kind === 'comments' ? action.groups : action.images.map(image => ({ image, comments: [] }));
      const files = await Promise.all(groups.map(async group => ({ ...await prepareGeneratedImage(group.image),
        generatedImage: { id: group.image.id, label: group.image.label, comments: group.comments } })));
      if (view.current !== editor) throw new Error('The conversation changed before the image was attached.');
      attachments.replaceGenerated(files);
      recoveredFiles.current = [...attachments.items.flatMap(row => row.file && !row.file.generatedImage ? [row.file] : []), ...files];
      await saveDraftFiles(scope, recoveredFiles.current);
    } finally { busy.current = false; setStatus('idle'); }
    if (action.kind === 'comments' && action.submit && !await submit(false, recoveredFiles.current)) {
      throw new Error('The image comments were not confirmed. Review the conversation before trying again.');
    }
  }

  async function submit(reverseFollowUp = false, preparedFiles?: readonly PromptAttachment[]) {
    const editor = view.current;
    if (!editor || !onSend || busy.current || queueBusy.current || blocked || options.pending || attachments.pending) return false;
    const doc = editor.state.doc;
    const text = promptText(doc);
    if ((!text.trim() && !attachments.items.length && !preparedFiles?.length) || editor.composing) return false;
    busy.current = true;
    setStatus('sending'); setFailure(undefined);
    const sent = attachments.items;
    const files = preparedFiles ?? sent.flatMap(row => row.file ? [row.file] : []);
    const sentIds = [...sent.map(row => row.id), ...(preparedFiles?.flatMap(file =>
      file.generatedImage ? ['image-playground:' + file.generatedImage.id] : []) ?? [])];
    let imageNumber = 0;
    const commentGroups = files.flatMap(file => {
      if (!file.image) return [];
      imageNumber++;
      return file.generatedImage ? [{ image: { id: file.generatedImage.id, label: file.generatedImage.label,
        image: { path: file.path, name: file.name } }, comments: file.generatedImage.comments, imageNumber }] : [];
    });
    const submittedText = imageCommentPrompt(commentGroups, text);
    const submissionOptions: SubmissionOptions | undefined = files.some(file => file.generatedImage) ? { turnTrigger: 'image_edit' } : undefined;
    const clientUserMessageId = crypto.randomUUID();
    const mode = reverseFollowUp ? queue.mode === 'queue' ? 'steer' : 'queue' : queue.mode;
    const queued = !!stream && (!!activeTurn || editingQueued) && (editingQueued || mode === 'queue');
    if (!queued) {
      if (submissionOptions) setPendingImageEdit(clientUserMessageId);
      const latest = stream && mergeLiveTurns(historyTurns, stream.read()).at(-1);
      preparing.current = { id: clientUserMessageId, doc, text, files };
      pendingMessages.add(scope, { id: clientUserMessageId, input: composerInput(submittedText, files), startedAt: Date.now() / 1000,
        ...(activeTurn ? { turnId: activeTurn, after: latest?.items.at(-1)?.id } : { afterTurnId: latest?.id }) });
      recoveredFiles.current = [...recoveredFiles.current, ...files.filter(file => !recoveredFiles.current.some(row => row.path === file.path))];
      void saveDraftFiles(scope, recoveredFiles.current).catch(console.error);
      editor.dispatch(closeHistory(editor.state.tr).delete(0, doc.content.size));
      attachments.remove(sentIds);
    }
    try {
      let accepted: void | (() => void) = undefined;
      if (stream && (activeTurn || editingQueued)) {
        if (queued) await enqueueMessage(stream.threadId, submittedText, files, hostId);
        else await steerTurn(stream.threadId, activeTurn!, composerInput(submittedText, files), hostId, clientUserMessageId);
        queue.refresh();
        setEditingQueued(false);
      } else accepted = await onSend(submittedText, options.draftPermission?.id, files, clientUserMessageId, submissionOptions);
      rememberPrompt(historyScope, doc);
      // A later edit or a different workspace must not be cleared by this reply.
      if (queued && view.current === editor && editor.state.doc.eq(doc)) editor.dispatch(editor.state.tr.delete(0, doc.content.size));
      removeAttachments(sentIds, files.map(file => file.path));
      releasePreparation(clientUserMessageId);
      if (!stream) pendingMessages.remove(scope, clientUserMessageId);
      setStatus('idle'); busy.current = false;
      accepted?.();
      return true;
    } catch (error) {
      if (error instanceof WorkspaceRequestError && error.uncertain) {
        setStatus('uncertain');
        setFailure('Delivery is unknown. Check the conversation before trying again.');
      } else {
        if (!queued) {
          pendingMessages.remove(scope, clientUserMessageId);
          preparing.current = undefined;
          setPendingImageEdit(current => current === clientUserMessageId ? undefined : current);
          if (view.current === editor) {
            const current = editor.state.doc;
            const recovered = promptText(current).trim() ? schema.node('doc', null, doc.content.append(current.content)) : doc;
            const transaction = closeHistory(editor.state.tr).replaceWith(0, current.content.size, recovered.content);
            editor.dispatch(transaction.setSelection(Selection.atEnd(transaction.doc)));
            attachments.restore(files);
          }
        }
        setFailure(error instanceof Error ? error.message : String(error));
        setStatus('idle'); busy.current = false;
      }
      return false;
    }
  }

  async function runQueue(run: (current: () => boolean) => Promise<void>) {
    const editor = view.current;
    if (!editor || busy.current || queueBusy.current) return;
    queueBusy.current = true;
    setQueuePending(true);
    setFailure(undefined);
    try { await run(() => view.current === editor); }
    catch (error) {
      setFailure(error instanceof WorkspaceRequestError && error.uncertain
        ? 'The host may have applied the queue change. Review the current queue before trying again.'
        : error instanceof Error ? error.message : String(error));
    } finally {
      queueBusy.current = false;
      setQueuePending(false);
      queue.refresh();
    }
  }

  async function editQueued(item: QueuedSubmission, current: () => boolean) {
    if (!stream) return;
    const prompt = queuedPrompt(item);
    if (!prompt.editable) return;
    const { deleted } = await deleteQueuedSubmission(stream.threadId, item.id, hostId);
    if (!deleted) throw new Error('This message is no longer queued.');
    const editor = current() ? view.current : null;
    if (!editor) {
      // A native deletion may commit after this workspace has been closed.
      // Preserve the recovered prompt (including attached paths) for reopening.
      await recoverQueuedDraft(scope, item);
      return;
    }
    const { state } = editor;
    const previous = state.doc.textBetween(0, state.doc.content.size, '\n');
    const next = content([previous, prompt.text].filter(Boolean).join('\n\n'));
    const transaction = closeHistory(state.tr).replaceWith(0, state.doc.content.size, next.content);
    editor.dispatch(transaction.setSelection(Selection.atEnd(transaction.doc)));
    editor.dispatch(closeHistory(editor.state.tr));
    attachments.restore(prompt.attachments);
    recoveredFiles.current = [...recoveredFiles.current, ...prompt.attachments.filter(file => !recoveredFiles.current.some(row => row.path === file.path))];
    await saveDraftFiles(scope, recoveredFiles.current);
    setEditingQueued(true);
    editor.focus();
  }

  const home = scope === 'new-conversation';
  const hasInput = populated || attachments.items.length > 0;
  const followUp = stream && (activeTurn || editingQueued) ? editingQueued || queue.mode === 'queue' ? 'Queue' : 'Steer' : 'Send message';
  return <form ref={form} className="min-w-0 w-full" data-codex-composer-root="" data-composer-placement={home ? 'home' : 'thread'}
    data-image-preview-composer={imagePlacement ? '' : undefined} data-image-preview-compact={imagePlacement && compact ? '' : undefined}
    data-async-question-open={compact || undefined}
    onSubmit={event => { event.preventDefault(); void submit(); }}
    onPasteCapture={event => {
      if (blocked) return;
      const files = Array.from(event.clipboardData.files);
      if (!files.length || event.clipboardData.getData('text/plain').trim()) return;
      event.preventDefault();
      attachments.add(files);
    }}
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
    onDropCapture={event => {
      if (blocked) return;
      const files = Array.from(event.dataTransfer.files);
      if (!files.length) return;
      event.preventDefault();
      attachments.add(files);
    }}>
    {(failure || options.failure || attachments.error || queue.items.length > 0 && queue.error) &&
      <p className="yard-source-composer-error" role="alert">{failure ?? options.failure ?? attachments.error ?? queue.error}</p>}
    {!home && <ComposerChanges stream={stream} activeTurn={activeTurn} history={historyTurns}
      open={openChanges} fallback={<FullAccessNotice options={options} />} />}
    {projects && <ProjectRail {...projects} />}
    {stream && !blocked && <QueuedMessages items={queue.items} mode={queue.mode} active={!!activeTurn}
      paused={latestStatus === 'interrupted'} disabled={queuePending || status !== 'idle' || !!queue.error}
      setMode={mode => void runQueue(() => queue.setMode(mode))}
      edit={item => void runQueue(current => editQueued(item, current))}
      discard={item => void runQueue(async () => { await deleteQueuedSubmission(stream.threadId, item.id, hostId); })}
      reorder={ids => void runQueue(async () => { await reorderQueuedSubmissions(stream.threadId, ids, hostId); })}
      openSidechat={openQueuedSidechat && (item => void runQueue(() => openQueuedSidechat(item)))}
      send={item => void runQueue(async current => {
        if (activeTurn) {
          await steerTurn(stream.threadId, activeTurn, item.input, hostId, item.clientUserMessageId, item.responsesapiClientMetadata);
          const { deleted } = await deleteQueuedSubmission(stream.threadId, item.id, hostId).catch(() => ({ deleted: false }));
          if (!deleted) throw new Error('The follow-up was sent. Check whether it still appears in the queue.');
        } else {
          const { turn } = await startQueuedSubmission(stream.threadId, item.id, hostId, current);
          if (current()) stream.acknowledge(turn);
        }
      })} />}
    {!blocked && goal.goal && goal.goal.status !== 'complete' && openGoal && stream &&
      <ConversationGoal controller={goal} onEdit={() => openGoal(stream.threadId, hostId)} />}
    {request && <TurnRequestCard key={JSON.stringify([request.hostId, request.threadId, request.id])}
      request={request} edit={requestedEdit} interrupt={turnId => {
        void stop(turnId).catch(error => setFailure(error instanceof Error ? error.message : String(error)));
      }} />}
    <AsyncQuestionPanel hidden={!!blocked} />
    <div hidden={!!blocked} className="_ComposerLayoutRoot_5est5_2 gap-2" data-composer-layout={layout} data-composer-padding-variant="none"
      data-composer-radius-variant="default" data-composer-density="default" data-composer-surface-overflow="visible"
      data-composer-surface-variant="default" data-composer-utility-bar-variant={home ? 'home' : undefined}>
      <div className="_ComposerLayoutBody_5est5_2" data-composer-layout={layout} data-composer-body="">
        {!!attachments.items.length && <div className="yard-source-attachment-row" data-composer-attachments="" data-composer-spacing="default" data-visible-attachments="">
          {attachments.items.map(row => <AttachmentCard key={row.id} name={row.name} file={row.file} hostId={hostId}
            remove={() => removeAttachments([row.id])} />)}
        </div>}
        <div className="_ComposerLayoutInput_5est5_2 flex-grow overflow-y-auto" data-composer-layout={layout} data-composer-spacing="default"
          data-composer-input-variant="default" data-composer-input="">
          <div ref={mount} className="text-size-chat leading-[var(--composer-editor-line-height,1.35)] min-h-[var(--composer-editor-min-height,2.5rem)] _RichTextInput_1ev2o_1 _composer_ilwj8_1"
            data-rich-text-layout={layout} data-composer-input-layout={layout} />
        </div>
        <div className="yard-source-composer-footer">
          <AttachmentPicker key={projectId ?? scope} add={attachments.add} disabled={status !== 'idle'} picker={attachmentPicker} />
          <ComposerToolbar key={stream?.threadId ?? projectId ?? 'new'} options={options} usage={usage} disabled={status !== 'idle'} />
          <button type="button" aria-label="Dictate" className="yard-source-dictate" disabled>
            <Mic size={16} aria-hidden="true" />
          </button>
          {activeTurn && !hasInput ? <button type="button" title="Stop generating" aria-label="Stop generating" className="yard-source-send"
            disabled={stopping === activeTurn} onClick={() => void stop(activeTurn).catch(error =>
              setFailure(error instanceof Error ? error.message : String(error)))}>
            <Square size={10} fill="currentColor" aria-hidden="true" />
          </button> : <button type="submit" title={followUp} aria-label={followUp} className="yard-source-send"
            disabled={!onSend || !hasInput || queuePending || status !== 'idle' || options.pending || attachments.pending}
            aria-busy={status === 'sending'}>
            <ArrowUp size={16} aria-hidden="true" />
          </button>}
        </div>
      </div>
    </div>
  </form>;
}
