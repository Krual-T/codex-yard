import { baseKeymap } from 'prosemirror-commands';
import { closeHistory, history, redo, undo } from 'prosemirror-history';
import { inputRules, textblockTypeInputRule, undoInputRule, wrappingInputRule } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import { Fragment, Mark } from 'prosemirror-model';
import type { Node as ProseMirrorNode, Schema } from 'prosemirror-model';
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';
import { TextSelection } from 'prosemirror-state';
import type { Command, Plugin, Selection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { ComposerDocument } from '../workbench-contract.ts';
import type { ComposerDraftOwner } from './composer-draft-store.ts';
import type { Completion } from './standalone-completions.tsx';
import { composerSchema, parseAgentThreadPath, readRichDocument } from './rich-document.ts';

export interface RichCompletionContext { text: string; cursor: number; blockStart: number }
export interface RichCompletionQuery { start: number; end: number; token: string }
export interface AgentMentionChoice { threadId: string; hostId: string; title: string }
export interface AgentMentionCurrent { owner: ComposerDraftOwner; revision: string }
export function agentMentionAttributes(choice: AgentMentionChoice): { name: string; displayName: string; conversationId: null; path: string } | null {
  const threadId = choice.threadId.trim(), hostId = choice.hostId;
  if (typeof hostId !== 'string' || !/^[A-Za-z0-9._:-]+$/.test(hostId)) return null;
  const path = 'thread://' + threadId + '?hostId=' + encodeURIComponent(hostId);
  if (!parseAgentThreadPath(path)) return null;
  const name = choice.title.trim() || threadId;
  return { name, displayName: name, conversationId: null, path };
}
const agentMentionTarget = Symbol('agentMentionTarget');
export interface AgentMentionTarget {
  readonly [agentMentionTarget]: {
    editor: EditorView;
    source: ComposerDocument;
    document: ProseMirrorNode;
    selection: Selection;
    marks: readonly Mark[] | null;
    current: AgentMentionCurrent;
    readCurrent: () => AgentMentionCurrent | null;
    from: number;
    to: number;
    used: boolean;
  };
}

function sameAgentMentionCurrent(a: AgentMentionCurrent | null, b: AgentMentionCurrent): boolean {
  return !!a && a.revision === b.revision && a.owner.hostId === b.owner.hostId
    && a.owner.threadId === b.owner.threadId && a.owner.draftId === b.owner.draftId;
}

/** Capture before opening the picker; the callback must read the live draft controller. */
export function captureAgentMentionTarget(editor: EditorView, source: ComposerDocument | undefined,
  readCurrent: () => AgentMentionCurrent | null, query?: RichCompletionQuery): AgentMentionTarget | null {
  if (editor.isDestroyed || editor.composing || !editor.editable || !editor.hasFocus() || !source) return null;
  syncRichSelection(editor);
  const current = readCurrent(), { selection, doc, storedMarks } = editor.state;
  if (!current || !current.revision || !current.owner.draftId || !readRichDocument(source)?.eq(doc)
    || !(selection instanceof TextSelection) || selection.$from.parent !== selection.$to.parent
    || !selection.$from.parent.isTextblock || selection.$from.parent.type.spec.code) return null;
  let { from, to } = selection;
  if (query) {
    const context = richCompletionContext(editor);
    if (!context || !query.token.startsWith('@') || !Number.isSafeInteger(query.start) || !Number.isSafeInteger(query.end)
      || query.end !== context.cursor || query.start < 0 || query.start > query.end
      || context.text.slice(query.start, query.end) !== query.token) return null;
    const suffix = context.text.slice(query.end).match(/^[^\s@$\ufffc]*/)?.[0] ?? '';
    from = context.blockStart + query.start;
    to = context.blockStart + query.end + suffix.length;
  }
  return { [agentMentionTarget]: { editor, source, document: doc, selection, marks: storedMarks,
    current: { owner: { ...current.owner }, revision: current.revision }, readCurrent, from, to, used: false } };
}

/** Insert the selected thread only into the still-current editor, draft and selection. */
export function insertAgentMention(editor: EditorView, target: AgentMentionTarget, choice: AgentMentionChoice,
  readDocument: () => ComposerDocument | undefined): boolean {
  const captured = target?.[agentMentionTarget];
  if (!captured || captured.used || captured.editor !== editor || editor.isDestroyed || editor.composing || !editor.editable) return false;
  syncRichSelection(editor);
  const current = captured.readCurrent();
  if (!sameAgentMentionCurrent(current, captured.current) || readDocument() !== captured.source
    || !readRichDocument(captured.source)?.eq(captured.document) || editor.state.doc !== captured.document
    || !editor.state.selection.eq(captured.selection)
    || (editor.state.storedMarks === null) !== (captured.marks === null)
    || !Mark.sameSet(editor.state.storedMarks ?? [], captured.marks ?? [])) return false;
  const attrs = agentMentionAttributes(choice);
  if (!attrs) return false;
  const { selection, storedMarks } = editor.state;
  const marks = storedMarks ?? (selection.empty ? selection.$from.marks() : selection.$from.marksAcross(selection.$to) ?? []);
  if (marks.some(mark => mark.type.name === 'code' || mark.type.name === 'link')) return false;
  const node = composerSchema.nodes.agentMention!.create(attrs, null, marks);
  let transaction = editor.state.tr.replaceWith(captured.from, captured.to, node);
  const after = captured.from + node.nodeSize;
  const next = transaction.doc.resolve(after).nodeAfter;
  const needsSpace = !next?.isText || !/^\s/u.test(next.text ?? '');
  if (needsSpace) transaction = transaction.insertText(' ', after);
  transaction = transaction.setSelection(TextSelection.create(transaction.doc, after + (needsSpace ? 1 : 0))).scrollIntoView();
  captured.used = true;
  editor.dispatch(closeHistory(transaction));
  editor.dispatch(closeHistory(editor.state.tr));
  editor.focus();
  return true;
}

export function syncRichSelection(editor: EditorView): void {
  if (!editor.hasFocus() || editor.composing) return;
  const document = editor.dom.ownerDocument, selection = document.getSelection(), window = document.defaultView;
  if (!window || !selection?.anchorNode || !selection.focusNode
    || !editor.dom.contains(selection.anchorNode) || !editor.dom.contains(selection.focusNode)) return;
  // Let ProseMirror reconcile pending DOM selection and mutations before a command.
  document.dispatchEvent(new window.Event('selectionchange'));
}

export function richCompletionContext(editor: EditorView): RichCompletionContext | null {
  const { selection } = editor.state;
  if (editor.composing || !selection.empty || !selection.$from.parent.isTextblock || selection.$from.parent.type.spec.code) return null;
  const position = selection.$from;
  return {
    text: position.parent.textBetween(0, position.parent.content.size, undefined, node => node.type.name === 'hard_break' ? '\n' : '\ufffc'),
    cursor: position.parentOffset,
    blockStart: position.start(),
  };
}

/** Apply a result only while the originating textblock, token and caret still match. */
export function insertRichCompletion(editor: EditorView, expected: RichCompletionContext, query: RichCompletionQuery, item: Completion, cwd: string): boolean {
  const current = richCompletionContext(editor);
  if (!current || current.blockStart !== expected.blockStart || current.cursor !== expected.cursor || current.text !== expected.text
    || query.end !== current.cursor || query.start < 0 || current.text.slice(query.start, query.end) !== query.token) return false;
  const suffix = current.text.slice(query.end).match(query.token.startsWith('@') ? /^[^\s@$\ufffc]*/ : /^[^\s@$\/\ufffc]*/)?.[0] ?? '';
  const from = current.blockStart + query.start, to = current.blockStart + query.end + suffix.length;
  let transaction = editor.state.tr;
  let caret = from;
  if (item.kind === 'directory') {
    const text = '@' + item.path + '/';
    transaction = transaction.insertText(text, from, to);
    caret += text.length;
  } else if (item.kind === 'command') {
    transaction = transaction.delete(from, to);
  } else {
    const schema = editor.state.schema;
    const node = item.kind === 'skill'
      ? schema.nodes.skillMention!.create({ name: item.name, path: item.path, description: item.description,
        displayName: item.name, promptLinkLabel: '$' + item.name })
      : schema.nodes.atMention!.create({ label: '@' + item.path, path: cwd.replace(/\/$/, '') + '/' + item.path,
        fsPath: cwd.replace(/\/$/, '') + '/' + item.path });
    transaction = transaction.replaceWith(from, to, Fragment.fromArray([node, schema.text(' ')]));
    caret += 2;
  }
  transaction = transaction.setSelection(TextSelection.create(transaction.doc, caret)).scrollIntoView();
  editor.dispatch(closeHistory(transaction));
  editor.dispatch(closeHistory(editor.state.tr));
  return true;
}

function separateHistory(command: Command): Command {
  return (state, dispatch, view) => command(state, dispatch ? transaction => {
    dispatch(closeHistory(transaction));
    if (view) dispatch(closeHistory(view.state.tr));
  } : undefined, view);
}

export function richEditorPlugins(schema: Schema = composerSchema, previousHistory?: Plugin) {
  const nodes = schema.nodes;
  const listItem = nodes.regular_list_item!;
  const historyPlugin = previousHistory ?? history();
  const markdownRules = inputRules({ rules: [
    wrappingInputRule(/^\s*([-+*])\s$/, nodes.list!),
    wrappingInputRule(/^([1-9]\d{0,8})\.\s$/, nodes.ordered_list!, match => ({ startingNumber: Number(match[1]) }),
      (match, node) => node.attrs.startingNumber + node.childCount === Number(match[1])),
    wrappingInputRule(/^\s*>\s$/, nodes.blockquote!),
    textblockTypeInputRule(/^(#{1,6})\s$/, nodes.heading!, match => ({ level: match[1]!.length })),
    textblockTypeInputRule(/^```([\w+-]*)\s$/, nodes.code_block!, match => ({ autoDetectLanguage: !match[1], language: match[1] || null })),
  ] });
  const keys = keymap({
    'Mod-z': undo, 'Mod-Shift-z': redo, 'Mod-y': redo, Backspace: undoInputRule,
    Enter: separateHistory(splitListItem(listItem)), Tab: separateHistory(sinkListItem(listItem)), 'Shift-Tab': separateHistory(liftListItem(listItem)),
    'Shift-Enter': (state, dispatch) => {
      const br = state.schema.nodes.hard_break;
      if (!br || state.selection.$from.parent.type.spec.code) return false;
      if (dispatch) dispatch(state.tr.replaceSelectionWith(br.create()).scrollIntoView());
      return true;
    },
  });
  const baseKeys = keymap(baseKeymap);
  return { rich: [historyPlugin, markdownRules, keys, baseKeys], plain: [historyPlugin, keys, baseKeys] };
}
