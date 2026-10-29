import { Fragment as ReactFragment, forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Bold, Code2, FileText, Italic, Link as LinkIcon, MessageSquare, X } from 'lucide-react';
import { toggleMark } from 'prosemirror-commands';
import { closeHistory, history, redo, undo } from 'prosemirror-history';
import { DOMSerializer, Fragment, Mark, Schema, Slice } from 'prosemirror-model';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { EditorState, Plugin, TextSelection } from 'prosemirror-state';
import type { Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { ComposerDocument } from '../workbench-contract.ts';
import { useI18n } from '../i18n/index.tsx';
import { documentChanges } from '../messages/message-edit.ts';
import { composerSchema, httpAutolinkHref, linkOccurrenceAllocator, parseAgentThreadPath, readRichDocument, safeRichLinkHref } from './rich-document.ts';
import { agentMentionAttributes, captureAgentMentionTarget, insertAgentMention, insertRichCompletion, richCompletionContext, richEditorPlugins, syncRichSelection } from './rich-editor-actions.ts';
import type { AgentMentionChoice, AgentMentionCurrent, AgentMentionTarget, RichCompletionContext, RichCompletionQuery } from './rich-editor-actions.ts';
import type { Completion } from './standalone-completions.tsx';
import { isStructuredAppInput } from './standalone-draft.ts';
import type { Draft } from './standalone-draft.ts';
import { projectTextAgentDocument, updateTextAgentDocument } from './text-agent-document.ts';
import type { TextAgentSpan } from './text-agent-document.ts';

export interface RichEditorHandle {
  focus(): void;
  matchesDocument(document: ComposerDocument): boolean;
  insertCompletion(context: RichCompletionContext, query: RichCompletionQuery, item: Completion, cwd: string): boolean;
  captureAgentMentionTarget(readCurrent: () => AgentMentionCurrent | null, query?: RichCompletionQuery): AgentMentionTarget | null;
  insertAgentMention(target: AgentMentionTarget, choice: AgentMentionChoice): boolean;
}
export type { AgentMentionChoice, AgentMentionCurrent, AgentMentionTarget } from './rich-editor-actions.ts';
export interface StructuredInputEditorHandle {
  focus(index?: number, position?: number): void;
  matchesDocument(document: ComposerDocument): boolean;
  activateFormatting(document: ComposerDocument, commit?: () => boolean): boolean;
  visibleText(): string;
  insertRichCompletion(query: RichCompletionQuery, item: Completion, cwd: string): boolean;
  replace(index: number, start: number, end: number, text: string, skill?: TextCompletionSkill): boolean;
  removeSkill(name: string, path: string): void;
  skills(): TextCompletionSkill[];
  captureAgentMentionTarget(index: number, readCurrent: () => AgentMentionCurrent | null, query?: RichCompletionQuery): TextAgentTarget | null;
  insertAgentMention(target: TextAgentTarget, choice: AgentMentionChoice): boolean;
}
export interface TextCompletionSkill { name: string; path: string; managed: boolean }
export interface TextSkillChange { before: TextCompletionSkill[]; after: TextCompletionSkill[] }
export interface TextAgentSegment { index: number; text: string; agents: TextAgentSpan[] }
export interface TextAgentChange { before: TextAgentSegment[]; after: TextAgentSegment[]; document?: ComposerDocument }
export interface TextMarkSpan { start: number; end: number; marks: { type: string; attrs?: Record<string, unknown> }[] }
export interface StructuredInputEditorProps {
  draft: Draft;
  onEdit(index: number, expectedText: string, text: string, inputType?: string, skills?: TextSkillChange, agents?: TextAgentChange): boolean;
  agentMentions?(index: number): readonly TextAgentSpan[];
  sourceMarks?(index: number): readonly TextMarkSpan[];
  onSelection?(index: number, cursor: number, text?: string): void;
  onKeyDown(event: KeyboardEvent): boolean;
  onCompositionChange?(composing: boolean): void;
  onInvalid?(message?: string): void;
  onPaste?(event: TextPasteEvent): void;
  readOnly?: boolean;
  ariaLabel?: string;
  placeholder?: string;
  activeIndex?: number;
  completionListId?: string;
  completionSelectedId?: string;
}

// The draft remains authoritative; this editor history joins each skill marker to its text replacement.
const textHistorySchema = new Schema({ nodes: composerSchema.spec.nodes.update('paragraph', {
  ...composerSchema.nodes.paragraph!.spec, whitespace: 'pre', parseDOM: [{ tag: 'p', preserveWhitespace: 'full' }],
}).addToEnd('skill', { inline: true, group: 'inline', atom: true, selectable: false, attrs: { name: {}, path: {}, managed: {} },
    toDOM: node => ['span', { 'data-text-skill': JSON.stringify(node.attrs), contenteditable: 'false', hidden: 'true' }],
    parseDOM: [{ tag: 'span[data-text-skill]', getAttrs: dom => {
      try { return JSON.parse((dom as HTMLElement).getAttribute('data-text-skill') ?? 'null'); } catch { return false; }
    } }] }), marks: composerSchema.spec.marks });
function textHistoryState(text: string, agents: readonly TextAgentSpan[] = []): EditorState {
  const children: ProseMirrorNode[] = [];
  let offset = 0;
  for (const agent of agents) {
    if (agent.start < offset || agent.end > text.length || text.slice(agent.start, agent.end) !== (agent.attrs.displayName || agent.attrs.name)) {
      throw new Error('The saved chat references cannot be mapped to this input.');
    }
    if (agent.start > offset) children.push(textHistorySchema.text(text.slice(offset, agent.start)));
    children.push(textHistorySchema.nodes.agentMention!.create(agent.attrs));
    offset = agent.end;
  }
  if (offset < text.length) children.push(textHistorySchema.text(text.slice(offset)));
  const paragraph = textHistorySchema.nodes.paragraph!.create(null, children);
  return EditorState.create({ doc: textHistorySchema.nodes.doc!.create(null, paragraph), plugins: [history()] });
}
const agentLabel = (node: ProseMirrorNode): string => node.attrs.displayName || node.attrs.name;
interface HistoryToken { start: number; end: number; from: number; to: number; node?: ProseMirrorNode }
function historyProjection(state: EditorState): { text: string; tokens: HistoryToken[]; agents: TextAgentSpan[]; firstPosition: number } {
  let text = '', previousEnd: number | undefined, firstPosition: number | undefined;
  const tokens: HistoryToken[] = [], agents: TextAgentSpan[] = [];
  state.doc.descendants((block, position) => {
    if (!block.isTextblock) return;
    firstPosition ??= position + 1;
    if (previousEnd !== undefined) {
      tokens.push({ start: text.length, end: text.length + 1, from: previousEnd, to: position + 1 });
      text += '\n';
    }
    block.forEach((node, offset) => {
      const from = position + 1 + offset;
      let value = '';
      if (node.isText) value = node.text ?? '';
      else if (node.type.name === 'agentMention') value = agentLabel(node);
      else if (node.type.name === 'hard_break') value = '\n';
      else if (node.type.name !== 'skill') value = '\ufffc';
      if (!value) return;
      const start = text.length;
      text += value;
      tokens.push({ start, end: text.length, from, to: from + node.nodeSize, node });
      if (node.type.name === 'agentMention') agents.push({ start, end: text.length,
        attrs: { name: node.attrs.name, displayName: node.attrs.displayName, conversationId: node.attrs.conversationId, path: node.attrs.path } });
    });
    previousEnd = position + block.nodeSize - 1;
    return false;
  });
  return { text, tokens, agents, firstPosition: firstPosition ?? 1 };
}
function simpleHistory(state: EditorState): boolean {
  const block = state.doc.firstChild;
  if (state.doc.childCount !== 1 || block?.type.name !== 'paragraph') return false;
  let simple = true;
  block.forEach(node => { if (!node.isText && node.type.name !== 'agentMention' && node.type.name !== 'skill') simple = false; });
  return simple;
}
function historyText(state: EditorState): string {
  return simpleHistory(state)
    ? state.doc.textBetween(0, state.doc.content.size, '', node => node.type.name === 'agentMention' ? agentLabel(node) : '')
    : historyProjection(state).text;
}
function historyAgents(state: EditorState): TextAgentSpan[] {
  if (!simpleHistory(state)) return historyProjection(state).agents;
  const agents: TextAgentSpan[] = [];
  let offset = 0;
  state.doc.descendants(node => {
    if (node.isText) offset += node.text?.length ?? 0;
    else if (node.type.name === 'agentMention') {
      const label = agentLabel(node), start = offset;
      offset += label.length;
      agents.push({ start, end: offset, attrs: { name: node.attrs.name, displayName: node.attrs.displayName,
        conversationId: node.attrs.conversationId, path: node.attrs.path } });
    }
  });
  return agents;
}
function historyDocument(state: EditorState, source: ComposerDocument): ComposerDocument | null {
  const original = readRichDocument(source), before = original && projectTextAgentDocument(original);
  if (!before) return null;
  const updated = updateTextAgentDocument(source, before.text, historyText(state), historyAgents(state));
  const document = updated && readRichDocument(updated), projection = document && projectTextAgentDocument(document);
  if (!document || !projection) return null;
  const ranges: { start: number; end: number; marks: readonly Mark[] }[] = [];
  let offset = 0;
  state.doc.firstChild?.forEach(node => {
    const length = node.isText ? node.text?.length ?? 0 : node.type.name === 'agentMention' ? agentLabel(node).length : 0;
    if (length) ranges.push({ start: offset, end: offset + length, marks: node.marks });
    offset += length;
  });
  let transaction = EditorState.create({ doc: document }).tr;
  let firstRange = 0;
  for (const token of projection.tokens) {
    if (!token.node || token.node.type.name === 'hard_break') continue;
    while (firstRange < ranges.length && ranges[firstRange]!.end <= token.start) firstRange++;
    for (let index = firstRange; index < ranges.length && ranges[index]!.start < token.end; index++) {
      const range = ranges[index]!;
      const start = Math.max(token.start, range.start), end = Math.min(token.end, range.end);
      if (start >= end) continue;
      const from = token.node.isText ? token.from + start - token.start : token.from;
      const to = token.node.isText ? token.from + end - token.start : token.to;
      transaction = transaction.removeMark(from, to);
      for (const mark of range.marks) {
        const type = composerSchema.marks[mark.type.name];
        if (!type) return null;
        transaction = transaction.addMark(from, to, type.create(mark.attrs));
      }
    }
  }
  const result = transaction.doc.toJSON() as ComposerDocument;
  return readRichDocument(result) ? result : null;
}
function copiedWithoutSkillMarkers(slice: Slice): Slice {
  const filter = (fragment: Fragment): Fragment => {
    const nodes: ProseMirrorNode[] = [];
    fragment.forEach(node => {
      if (node.type.name !== 'skill') nodes.push(node.isLeaf ? node : node.copy(filter(node.content)));
    });
    return Fragment.fromArray(nodes);
  };
  return new Slice(filter(slice.content), slice.openStart, slice.openEnd);
}
function fullHistoryDocument(state: EditorState): ComposerDocument | null {
  const content = copiedWithoutSkillMarkers(new Slice(state.doc.content, 0, 0)).content;
  const result = state.doc.copy(content).toJSON() as ComposerDocument;
  return readRichDocument(result) ? result : null;
}
function activateRichHistory(state: EditorState, source: ComposerDocument, editable: () => boolean): EditorState | null {
  const original = readRichDocument(source), projection = original && projectTextAgentDocument(original);
  const current = historyDocument(state, source), reconstructed = current && readRichDocument(current);
  if (!original || !projection || !reconstructed || !original.eq(reconstructed)) return null;
  let transaction = state.tr;
  try {
    for (const token of [...projection.tokens].reverse()) {
      if (token.node && token.node.type.name !== 'hard_break') continue;
      const from = historyPosition(state, token.start), to = historyPosition(state, token.end);
      let onlyText = true;
      state.doc.nodesBetween(from, to, node => { if (node.isInline && !node.isText) onlyText = false; });
      if (!onlyText || state.doc.textBetween(from, to) !== '\n') return null;
      transaction = transaction.delete(from, to);
      if (token.node) transaction = transaction.insert(from, textHistorySchema.nodeFromJSON(token.node.toJSON()));
      else transaction = transaction.split(from);
    }
    const next = state.apply(closeHistory(transaction.setMeta('addToHistory', false)));
    const actual = fullHistoryDocument(next), document = actual && readRichDocument(actual);
    if (!document || !document.eq(original)) return null;
    const plugins = richEditorPlugins(textHistorySchema, state.plugins[0]).rich;
    plugins.unshift(richAutolinkPlugin(editable));
    return next.reconfigure({ plugins });
  } catch { return null; }
}
function applySourceMarks(state: EditorState, spans: readonly TextMarkSpan[]): EditorState {
  let transaction = state.tr, offset = 0, firstSpan = 0;
  state.doc.firstChild?.forEach((node, position) => {
    const length = node.isText ? node.text?.length ?? 0 : node.type.name === 'agentMention' ? agentLabel(node).length : 0;
    if (!length) return;
    const from = position + 1, end = offset + length;
    transaction = transaction.removeMark(from, from + node.nodeSize);
    while (firstSpan < spans.length && spans[firstSpan]!.end <= offset) firstSpan++;
    for (let index = firstSpan; index < spans.length && spans[index]!.start < end; index++) {
      const span = spans[index]!, start = Math.max(offset, span.start), stop = Math.min(end, span.end);
      if (start >= stop || !node.isText && (start !== offset || stop !== end)) continue;
      const left = node.isText ? from + start - offset : from, right = node.isText ? from + stop - offset : from + node.nodeSize;
      for (const mark of span.marks) {
        const type = textHistorySchema.marks[mark.type];
        if (type) transaction = transaction.addMark(left, right, type.create(mark.attrs));
      }
    }
    offset = end;
  });
  return transaction.doc.eq(state.doc) ? state : state.apply(transaction.setMeta('addToHistory', false));
}
function historySkills(state: EditorState): TextCompletionSkill[] {
  const result: TextCompletionSkill[] = [];
  state.doc.descendants(node => {
    if (node.type.name === 'skill') result.push({ name: node.attrs.name, path: node.attrs.path, managed: node.attrs.managed });
  });
  return result;
}
function textOffset(state: EditorState, position: number): number {
  if (!simpleHistory(state)) {
    let offset = 0;
    for (const token of historyProjection(state).tokens) {
      if (position <= token.from) break;
      offset = token.node?.isText ? token.start + Math.min(token.end - token.start, position - token.from)
        : position >= token.to ? token.end : token.start;
    }
    return offset;
  }
  let offset = 0;
  state.doc.descendants((node, pos) => {
    if (node.isText && pos < position) offset += Math.min(node.nodeSize, position - pos);
    else if (node.type.name === 'agentMention' && pos < position) offset += agentLabel(node).length;
  });
  return offset;
}
function historyPosition(state: EditorState, offset: number): number {
  if (!simpleHistory(state)) {
    const projection = historyProjection(state);
    let previous = projection.firstPosition;
    for (const token of projection.tokens) {
      if (offset < token.start) return previous;
      if (offset === token.start) return token.from;
      if (offset < token.end) return token.node?.isText ? token.from + offset - token.start
        : offset - token.start < (token.end - token.start) / 2 ? token.from : token.to;
      previous = token.to;
    }
    return previous;
  }
  let seen = 0, position = 1;
  state.doc.firstChild!.forEach(node => {
    if (node.isText) {
      position += Math.max(0, Math.min(offset - seen, node.nodeSize));
      seen += node.nodeSize;
    } else if (node.type.name === 'agentMention') {
      const length = agentLabel(node).length;
      if (offset >= seen + length || offset > seen && offset - seen >= length / 2) position += node.nodeSize;
      seen += length;
    } else if (seen <= offset) position += node.nodeSize;
  });
  return position;
}
function replaceHistoryText(state: EditorState, start: number, end: number, inserted: string): Transaction {
  if (!simpleHistory(state)) {
    const from = historyPosition(state, start), to = historyPosition(state, end);
    if (!state.doc.resolve(from).sameParent(state.doc.resolve(to))) throw new Error('The selection crosses text blocks.');
    return state.tr.insertText(inserted, from, to);
  }
  // Expand only touched agent atoms so edits inside a visible label become ordinary text.
  let transaction = state.tr, offset = 0;
  const expanded: { position: number; label: string }[] = [];
  state.doc.descendants((node, position) => {
    if (node.isText) offset += node.text?.length ?? 0;
    else if (node.type.name === 'agentMention') {
      const label = agentLabel(node), from = offset, to = from + label.length;
      if (start < to && end > from || start === end && start > from && start < to) expanded.push({ position, label });
      offset = to;
    }
  });
  for (const item of expanded.reverse()) transaction = transaction.replaceWith(item.position, item.position + 1, textHistorySchema.text(item.label));
  const working = transaction.docChanged ? state.apply(transaction) : state;
  const ranges: { from: number; to: number }[] = [];
  offset = 0;
  working.doc.descendants((node, pos) => {
    if (node.isText) {
      const from = Math.max(start, offset), to = Math.min(end, offset + node.nodeSize);
      if (from < to) ranges.push({ from: pos + from - offset, to: pos + to - offset });
      offset += node.nodeSize;
    } else if (node.type.name === 'agentMention') offset += agentLabel(node).length;
  });
  let edit = working.tr;
  for (const range of ranges.reverse()) edit = edit.delete(range.from, range.to);
  const position = edit.mapping.map(historyPosition(working, start), 1);
  if (inserted) edit = edit.insertText(inserted, position);
  for (const step of edit.steps) transaction = transaction.step(step);
  return transaction;
}
function textChange(state: EditorState, before: string, after: string): Transaction {
  const oldChars = Array.from(before), newChars = Array.from(after);
  let prefix = 0, suffix = 0;
  while (prefix < oldChars.length && prefix < newChars.length && oldChars[prefix] === newChars[prefix]) prefix++;
  while (suffix < oldChars.length - prefix && suffix < newChars.length - prefix
    && oldChars[oldChars.length - 1 - suffix] === newChars[newChars.length - 1 - suffix]) suffix++;
  const start = oldChars.slice(0, prefix).join('').length;
  const end = before.length - oldChars.slice(oldChars.length - suffix).join('').length;
  const inserted = newChars.slice(prefix, newChars.length - suffix).join('');
  return replaceHistoryText(state, start, end, inserted);
}

interface TextControlModel {
  state: EditorState; element: HTMLTextAreaElement | null; index: number;
  view: EditorView | null; activateView(): void;
  historyPlugin: Plugin; composing: boolean; rich: boolean; plainMode: boolean; applyMode(): void; canEdit(): boolean;
  apply(transaction: Transaction, inputType?: string): boolean;
}
export interface TextAgentTarget {
  control: TextControlModel; doc: ProseMirrorNode; selectionStart: number; selectionEnd: number;
  view: EditorView | null; selection: EditorState['selection']; marks: readonly Mark[] | null;
  current: AgentMentionCurrent; readCurrent(): AgentMentionCurrent | null; from: number; to: number; used: boolean;
}
export type TextPasteEvent = { clipboardData: DataTransfer; preventDefault(): void };
interface TextControlProps {
  index: number; text: string; readOnly: boolean; label: string; placeholder: string;
  controls: Map<number, TextControlModel>;
  onEdit(index: number, expected: string, text: string, inputType?: string, skills?: TextSkillChange, agents?: TextAgentChange): boolean;
  agentMentions?: readonly TextAgentSpan[];
  sourceMarks?: readonly TextMarkSpan[];
  onSelection?(index: number, cursor: number, text?: string): void;
  onKeyDown(event: KeyboardEvent): boolean;
  onPaste?(event: TextPasteEvent): void;
  onCompositionChange?(composing: boolean): void;
  formatting?: boolean;
  plainTextMode?: boolean;
  document?: ComposerDocument;
  currentDocument?(): ComposerDocument | undefined;
  onPendingLinkChange?(pending: boolean): void;
  onInvalid?(message?: string): void;
  canEdit?(): boolean;
  completionListId?: string; completionSelectedId?: string;
}
function TextControl(props: TextControlProps) {
  const { t } = useI18n('zh-CN');
  const model = useRef<TextControlModel | null>(null);
  if (!model.current) {
    const state = textHistoryState(props.text, props.agentMentions);
    model.current = { state, element: null, index: props.index, historyPlugin: state.plugins[0]!,
      view: null, activateView: () => {}, composing: false, rich: false, plainMode: false,
      applyMode: () => {}, canEdit: () => false, apply: () => false };
  }
  const control = model.current;
  const [showView, setShowView] = useState(() => !!props.agentMentions?.length);
  const [linkOpen, setLinkOpen] = useState(false), [href, setHref] = useState(''), [linkError, setLinkError] = useState('');
  const [openedLink, setOpenedLink] = useState<LinkOccurrence | null>(null);
  const [linkEdit, setLinkEdit] = useState<'text' | 'url' | null>(null), [linkValue, setLinkValue] = useState('');
  const host = useRef<HTMLDivElement>(null), icon = useRef<SVGSVGElement>(null), pageIcon = useRef<SVGSVGElement>(null);
  const linkIcon = useRef<SVGSVGElement>(null), focusView = useRef(false);
  const latest = useRef(props); latest.current = props;
  const composing = useRef(false);
  const compositionGeneration = useRef(0);
  control.activateView = () => { focusView.current = true; setShowView(true); };
  control.canEdit = () => !latest.current.readOnly && latest.current.canEdit?.() !== false && !composing.current;
  control.applyMode = () => {
    const plain = !!latest.current.plainTextMode;
    if (!control.rich || composing.current || control.view?.composing || control.plainMode === plain) return;
    const modes = richEditorPlugins(textHistorySchema, control.historyPlugin);
    const plugins = plain ? modes.plain : modes.rich;
    plugins.unshift(richAutolinkPlugin(() => control.canEdit()));
    control.state = control.state.reconfigure({ plugins });
    control.plainMode = plain;
    control.view?.updateState(control.state);
  };
  const publish = (transaction: Transaction, inputType?: string): boolean => {
    const previous = control.state, next = previous.apply(transaction);
    if (latest.current.formatting && transaction.docChanged) {
      const saved = latest.current.currentDocument?.(), projected = saved && (control.rich ? fullHistoryDocument(previous) : historyDocument(previous, saved));
      const source = saved && readRichDocument(saved), current = projected && readRichDocument(projected);
      if (!source || !current || !source.eq(current)) { latest.current.onInvalid?.(); return false; }
    }
    const beforeText = historyText(previous), afterText = historyText(next);
    const all = Array.from(latest.current.controls.values());
    const before = all.flatMap(item => historySkills(item.state));
    const after = all.flatMap(item => historySkills(item === control ? next : item.state));
    const segment = (item: TextControlModel, state: EditorState): TextAgentSegment => ({ index: item.index, text: historyText(state), agents: historyAgents(state) });
    const source = latest.current.currentDocument?.();
    const document = latest.current.formatting && transaction.docChanged && source
      ? control.rich ? fullHistoryDocument(next) : historyDocument(next, source) : undefined;
    if (document === null) { latest.current.onInvalid?.(); return false; }
    const agents: TextAgentChange = { before: all.map(item => segment(item, item.state)),
      after: all.map(item => segment(item, item === control ? next : item.state)), ...(document ? { document } : {}) };
    if (transaction.docChanged && latest.current.onEdit(control.index, beforeText, afterText, inputType, { before, after }, agents) === false) return false;
    control.state = next;
    if (control.view && !control.view.isDestroyed) control.view.updateState(next);
    return true;
  };
  control.apply = publish;
  const runHistory = (direction: 'undo' | 'redo') => {
    if (latest.current.readOnly || latest.current.canEdit?.() === false || composing.current) return false;
    let applied = false;
    (direction === 'undo' ? undo : redo)(control.state, transaction => { applied = publish(transaction, direction === 'undo' ? 'historyUndo' : 'historyRedo'); });
    if (applied && control.element) {
      control.element.value = historyText(control.state);
      const start = textOffset(control.state, control.state.selection.from), end = textOffset(control.state, control.state.selection.to);
      control.element.setSelectionRange(start, end);
      latest.current.onSelection?.(control.index, end);
    }
    if (applied && control.view) latest.current.onSelection?.(control.index, textOffset(control.state, control.state.selection.head), historyText(control.state));
    return applied;
  };
  const syncSelection = (element: HTMLTextAreaElement) => {
    if (historyText(control.state) === element.value) {
      const start = historyPosition(control.state, element.selectionStart), end = historyPosition(control.state, element.selectionEnd);
      const anchor = element.selectionDirection === 'backward' ? end : start;
      const head = element.selectionDirection === 'backward' ? start : end;
      control.state = control.state.apply(control.state.tr.setSelection(TextSelection.create(control.state.doc, anchor, head)));
    }
    latest.current.onSelection?.(control.index, element.selectionStart, historyText(control.state));
  };
  useLayoutEffect(() => {
    control.index = props.index;
    props.controls.set(props.index, control);
    return () => { if (props.controls.get(props.index) === control) props.controls.delete(props.index); };
  }, [control, props.controls, props.index]);
  useLayoutEffect(() => {
    if (composing.current || control.view?.composing) return;
    if (control.rich && props.formatting && props.document && props.currentDocument?.() === props.document) {
      const source = readRichDocument(props.document), projected = fullHistoryDocument(control.state);
      const displayed = projected && readRichDocument(projected);
      if (source && displayed && !source.eq(displayed)) {
        const doc = textHistorySchema.nodeFromJSON(source.toJSON());
        const historyPlugin = history(), modes = richEditorPlugins(textHistorySchema, historyPlugin);
        const plugins = props.plainTextMode ? modes.plain : modes.rich;
        plugins.unshift(richAutolinkPlugin(() => control.canEdit()));
        control.state = EditorState.create({ doc, plugins });
        control.historyPlugin = historyPlugin;
        control.plainMode = !!props.plainTextMode;
        control.view?.updateState(control.state);
      }
      return;
    }
    if (control.rich && !props.formatting) {
      control.rich = false;
      control.state = textHistoryState(props.text, props.agentMentions);
      control.historyPlugin = control.state.plugins[0]!;
      control.plainMode = false;
      control.view?.updateState(control.state);
      return;
    }
    if (!control.rich && (historyText(control.state) !== props.text || JSON.stringify(historyAgents(control.state)) !== JSON.stringify(props.agentMentions ?? []))) {
      control.state = textHistoryState(props.text, props.agentMentions);
      control.historyPlugin = control.state.plugins[0]!;
      control.view?.updateState(control.state);
    }
  }, [control, props.text, props.agentMentions, props.formatting, props.document, props.currentDocument, props.plainTextMode]);
  useLayoutEffect(() => { control.applyMode(); }, [control, props.formatting, props.plainTextMode]);
  useLayoutEffect(() => {
    if (!showView || props.formatting || !props.sourceMarks) return;
    const next = applySourceMarks(control.state, props.sourceMarks);
    if (next !== control.state) { control.state = next; control.view?.updateState(next); }
  }, [control, props.sourceMarks, props.formatting, showView]);
  useLayoutEffect(() => {
    const element = control.element;
    const beforeInput = (event: InputEvent) => {
      if (!event.cancelable || event.inputType !== 'historyUndo' && event.inputType !== 'historyRedo') return;
      event.preventDefault();
      runHistory(event.inputType === 'historyUndo' ? 'undo' : 'redo');
    };
    const nativeInput = (event: Event) => {
      // Chrome can emit only input(historyUndo) when the native text happens to be unchanged.
      const inputType = (event as InputEvent).inputType;
      if (inputType !== 'historyUndo' && inputType !== 'historyRedo') return;
      event.stopPropagation();
      if (!runHistory(inputType === 'historyUndo' ? 'undo' : 'redo') && element) element.value = historyText(control.state);
    };
    element?.addEventListener('beforeinput', beforeInput);
    element?.addEventListener('input', nativeInput);
    return () => { element?.removeEventListener('beforeinput', beforeInput); element?.removeEventListener('input', nativeInput); };
  }, [control, showView]);
  useLayoutEffect(() => {
    if (!showView || !host.current) return;
    const editor = new EditorView(host.current, {
      state: control.state,
      nodeViews: { agentMention: node => {
        const dom = DOMSerializer.fromSchema(textHistorySchema).serializeNode(node) as HTMLElement;
        if (parseAgentThreadPath(node.attrs.path) && icon.current) dom.prepend(icon.current.cloneNode(true));
        return { dom };
      }, pageReferenceMention: node => {
        const dom = DOMSerializer.fromSchema(textHistorySchema).serializeNode(node) as HTMLElement;
        if (pageIcon.current) dom.prepend(pageIcon.current.cloneNode(true));
        return { dom };
      }, richLink: node => {
        const dom = DOMSerializer.fromSchema(textHistorySchema).serializeNode(node) as HTMLElement;
        if (linkIcon.current) dom.prepend(linkIcon.current.cloneNode(true));
        return { dom };
      } },
      editable: () => !latest.current.readOnly && latest.current.canEdit?.() !== false,
      attributes: { role: 'textbox', 'aria-label': latest.current.label, 'aria-multiline': 'true',
        'data-composer-input-index': String(control.index), 'data-placeholder': latest.current.placeholder,
        'aria-placeholder': latest.current.placeholder, 'aria-autocomplete': 'list' },
      handleDOMEvents: {
        focus: view => { latest.current.onSelection?.(control.index, textOffset(view.state, view.state.selection.head), historyText(view.state)); return false; },
        compositionstart: () => {
          compositionGeneration.current++;
          if (!composing.current) { control.composing = true; composing.current = true; latest.current.onCompositionChange?.(true); }
          return false;
        },
        compositionend: view => {
          const generation = compositionGeneration.current;
          requestAnimationFrame(() => {
            if (control.view !== view || view.isDestroyed || generation !== compositionGeneration.current) return;
            control.composing = false; composing.current = false; latest.current.onCompositionChange?.(false);
            control.applyMode();
            if (view.hasFocus()) latest.current.onSelection?.(control.index, textOffset(view.state, view.state.selection.head), historyText(view.state));
          });
          return false;
        },
      },
      dispatchTransaction(transaction) {
        if (!publish(transaction)) { editor.updateState(control.state); return; }
        if (editor.hasFocus() && !composing.current) latest.current.onSelection?.(control.index, textOffset(control.state, control.state.selection.head), historyText(control.state));
      },
      handleKeyDown: (view, event) => {
        if (view.composing || composing.current || event.isComposing || event.keyCode === 229) return false;
        if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')) {
          event.preventDefault(); return runHistory(event.key.toLowerCase() === 'y' || event.shiftKey ? 'redo' : 'undo');
        }
        if (latest.current.onKeyDown(event)) return true;
        if (control.rich) return false;
        if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault(); view.dispatch(view.state.tr.insertText('\n').scrollIntoView()); return true;
        }
        return false;
      },
      handlePaste: (view, event) => {
        const data = event.clipboardData;
        if (!data) return false;
        latest.current.onPaste?.({ clipboardData: data, preventDefault: () => event.preventDefault() });
        if (event.defaultPrevented) return true;
        if (control.rich && latest.current.plainTextMode) {
          const text = data.getData('text/plain').replace(/\r\n?/g, '\n');
          if (text) {
            if (view.state.selection.$from.parent.type.spec.code) view.dispatch(view.state.tr.insertText(text).scrollIntoView());
            else {
              const paragraph = view.state.schema.nodes.paragraph!;
              const nodes = text.split('\n').map(line => paragraph.create(null, line ? view.state.schema.text(line) : undefined));
              view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.fromArray(nodes), 1, 1)).scrollIntoView());
            }
          }
          return true;
        }
        const html = data.getData('text/html');
        const containsAgent = /data-mention\s*=\s*["']agent["']|agent-mention-name\s*=/i.test(html);
        if (html && (latest.current.formatting || containsAgent)) {
          const supported = control.rich ? supportedClipboardHTML(html, true) : supportedTextHistoryClipboard(html, !!latest.current.formatting);
          if (!supported) { latest.current.onInvalid?.(); return true; }
          return false;
        }
        const text = data.getData('text/plain').replace(/\r\n?/g, '\n');
        if (text) view.dispatch(view.state.tr.insertText(text).scrollIntoView());
        return true;
      },
      transformCopied: copiedWithoutSkillMarkers,
      transformPastedHTML: html => remapClipboardLinkOccurrences(html, control.state.doc),
    });
    control.view = editor;
    if (focusView.current) { focusView.current = false; editor.focus(); }
    return () => { if (control.view === editor) control.view = null; editor.destroy(); };
  }, [control, showView]);
  useLayoutEffect(() => {
    control.view?.setProps({ editable: () => !latest.current.readOnly && latest.current.canEdit?.() !== false,
      attributes: { role: 'textbox', 'aria-label': props.label, 'aria-multiline': 'true',
        'data-composer-input-index': String(props.index), 'data-placeholder': props.placeholder, 'aria-placeholder': props.placeholder,
        'aria-autocomplete': 'list', ...(props.completionListId ? { 'aria-controls': props.completionListId } : {}),
        ...(props.completionSelectedId ? { 'aria-activedescendant': props.completionSelectedId } : {}) } });
  }, [control, props.label, props.index, props.placeholder, props.readOnly, props.completionListId, props.completionSelectedId, showView]);
  useEffect(() => () => {
    compositionGeneration.current++;
    if (composing.current) { control.composing = false; composing.current = false; latest.current.onCompositionChange?.(false); }
    latest.current.onPendingLinkChange?.(false);
  }, []);
  useEffect(() => {
    if (openedLink && !openedLink.element.isConnected && !linkEdit) setOpenedLink(null);
    else openedLink?.element.setAttribute('aria-expanded', 'true');
    return () => { openedLink?.element.setAttribute('aria-expanded', 'false'); };
  }, [props.text, openedLink, linkEdit]);
  const mark = (name: 'strong' | 'em' | 'code') => {
    const view = control.view, type = textHistorySchema.marks[name];
    if (!view || !type || !control.canEdit() || view.composing) return;
    syncRichSelection(view);
    toggleMark(type)(view.state, transaction => { control.apply(closeHistory(transaction)); }, view);
    view.focus();
  };
  const openLink = (target: EventTarget | null): boolean => {
    if (!props.formatting || !(target instanceof Element)) return false;
    const element = target.closest<HTMLElement>('[data-mention="rich-link"][role="button"], a[data-composer-attrs]');
    if (!element || !host.current?.contains(element)) return false;
    if (openedLink?.element === element) { closeLink(); return true; }
    const link = element && control.view && linkOccurrence(control.view, element);
    if (!link || linkEdit || linkOpen) return true;
    setOpenedLink(link); setLinkEdit(null); setLinkError('');
    return true;
  };
  const closeLink = () => { if (linkEdit) props.onPendingLinkChange?.(false); setOpenedLink(null); setLinkEdit(null); setLinkError(''); };
  if (showView) return <><span hidden aria-hidden="true"><MessageSquare ref={icon} size={14} aria-hidden="true" focusable="false" />
    <FileText ref={pageIcon} size={14} aria-hidden="true" focusable="false" /><LinkIcon ref={linkIcon} size={14} aria-hidden="true" focusable="false" /></span>
    {props.formatting && (!props.plainTextMode || linkOpen) ? <div className="standalone-composer__rich-toolbar" role="toolbar" aria-label={t('Text formatting')}>
      {!props.plainTextMode ? <>
      <button type="button" title={t('Bold')} aria-label={t('Bold')} disabled={props.readOnly} onMouseDown={event => event.preventDefault()} onClick={() => mark('strong')}><Bold size={16} /></button>
      <button type="button" title={t('Italic')} aria-label={t('Italic')} disabled={props.readOnly} onMouseDown={event => event.preventDefault()} onClick={() => mark('em')}><Italic size={16} /></button>
      <button type="button" title={t('Inline code')} aria-label={t('Inline code')} disabled={props.readOnly} onMouseDown={event => event.preventDefault()} onClick={() => mark('code')}><Code2 size={16} /></button>
      </> : null}
      <button type="button" title={t('Link')} aria-label={t('Link')} disabled={props.readOnly} onMouseDown={event => {
        event.preventDefault(); if (control.view) syncRichSelection(control.view);
      }} onClick={() => {
        if (!control.canEdit()) return;
        setOpenedLink(null); setLinkEdit(null); props.onPendingLinkChange?.(!linkOpen); setLinkOpen(!linkOpen); setLinkError('');
      }}><LinkIcon size={16} /></button>
      {linkOpen ? <form onSubmit={event => {
        event.preventDefault();
        const view = control.view, safe = safeRichLinkHref(href), type = textHistorySchema.marks.link;
        if (!safe) { setLinkError(t('Enter an HTTP, HTTPS, or mailto link.')); return; }
        if (!view || !type || !control.canEdit() || view.state.selection.empty) return;
        const { from, to } = view.state.selection;
        const transaction = view.state.tr.addMark(from, to, type.create({ href: safe, literalMarkdownOccurrenceId: linkOccurrenceAllocator(view.state.doc)() }));
        if (!control.apply(closeHistory(transaction))) return;
        control.state = control.state.apply(closeHistory(control.state.tr)); view.updateState(control.state);
        props.onPendingLinkChange?.(false); setLinkOpen(false); setHref(''); setLinkError(''); view.focus();
      }}><input aria-label={t('Link address')} aria-invalid={!!linkError} value={href} disabled={props.readOnly}
        onChange={event => { setHref(event.target.value); setLinkError(''); }} /><button type="submit" disabled={props.readOnly}>{t('Apply')}</button>
        {linkError ? <span role="alert">{linkError}</span> : null}</form> : null}
    </div> : null}
    <div ref={host} className="standalone-composer__rich" onClickCapture={event => {
      if (openLink(event.target)) { event.preventDefault(); event.stopPropagation(); }
    }} onKeyDownCapture={event => {
      if ((event.key === 'Enter' || event.key === ' ') && openLink(event.target)) { event.preventDefault(); event.stopPropagation(); }
    }} />
    {openedLink ? <div role="dialog" aria-label={t('Link')}>
      {linkEdit ? <form onSubmit={event => {
        event.preventDefault();
        if (!control.canEdit() || !control.view) return;
        const label = linkEdit === 'text' ? linkValue : openedLink.label;
        const address = linkEdit === 'url' ? linkValue : openedLink.href, safe = address.trim() ? safeRichLinkHref(address) : null;
        if (!label) { setLinkError(t('Link text cannot be empty.')); return; }
        if (address.trim() && !safe) { setLinkError(t('Enter an HTTP, HTTPS, or mailto link.')); return; }
        if (label !== openedLink.label || safe !== openedLink.href) {
          const before = control.view.state.doc, result = replaceLink(control.view, openedLink, label, safe);
          if (result !== 'saved' || control.view.state.doc.eq(before)) {
            setLinkError(t(result === 'unmappable' ? 'This link edit cannot safely preserve formatting.' : 'This link changed. Open it again before saving.')); return;
          }
        }
        closeLink(); control.view.focus();
      }}><input autoFocus aria-label={linkEdit === 'text' ? t('Link text') : t('Link address')} aria-invalid={!!linkError}
        value={linkValue} onChange={event => { setLinkValue(event.target.value); setLinkError(''); }} />
        <button type="submit">{linkEdit === 'text' ? t('Save link text') : linkValue.trim() ? t('Save link URL') : t('Remove link')}</button>
        {linkError ? <span role="alert">{linkError}</span> : null}</form> : <>
        <span>{openedLink.label}</span>{' '}{safeRichLinkHref(openedLink.href)
          ? <a href={safeRichLinkHref(openedLink.href)!} target="_blank" rel="noopener noreferrer">{openedLink.href}</a> : <span>{openedLink.href}</span>}
        <button type="button" disabled={props.readOnly} onClick={() => { props.onPendingLinkChange?.(true); setLinkEdit('text'); setLinkValue(openedLink.label); }}>{t('Edit link text')}</button>
        <button type="button" disabled={props.readOnly} onClick={() => { props.onPendingLinkChange?.(true); setLinkEdit('url'); setLinkValue(openedLink.href); }}>{t('Edit link URL')}</button>
      </>}
      <button type="button" title={t('Close')} aria-label={t('Close')} onClick={closeLink}><X size={16} /></button>
    </div> : null}</>;
  return <textarea ref={element => { control.element = element; }} data-composer-input-index={props.index}
    aria-label={props.label} aria-autocomplete="list" aria-controls={props.completionListId}
    aria-activedescendant={props.completionSelectedId} placeholder={props.placeholder} value={props.text} readOnly={props.readOnly}
    onChange={event => {
      const element = event.currentTarget, before = historyText(control.state), after = element.value;
      const inputType = (event.nativeEvent as InputEvent).inputType;
      if (inputType === 'historyUndo' || inputType === 'historyRedo') {
        if (!runHistory(inputType === 'historyUndo' ? 'undo' : 'redo')) element.value = before;
        return;
      }
      const transaction = textChange(control.state, before, after);
      if (composing.current) transaction.setMeta('composition', compositionGeneration.current);
      const provisional = control.state.apply(transaction), position = historyPosition(provisional, element.selectionStart);
      transaction.setSelection(TextSelection.create(transaction.doc, position));
      if (!publish(transaction, inputType)) {
        element.value = before; element.setSelectionRange(Math.min(before.length, element.selectionStart), Math.min(before.length, element.selectionStart));
      }
      latest.current.onSelection?.(control.index, element.selectionStart, historyText(control.state));
    }}
    onFocus={event => syncSelection(event.currentTarget)}
    onSelect={event => syncSelection(event.currentTarget)}
    onKeyDown={event => {
      if (!event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
        if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')) {
          event.preventDefault(); runHistory(event.key.toLowerCase() === 'y' || event.shiftKey ? 'redo' : 'undo');
        } else latest.current.onKeyDown(event.nativeEvent);
      }
    }} onPaste={props.onPaste}
    onCompositionStart={() => {
      compositionGeneration.current++;
      if (!composing.current) {
        control.state = control.state.apply(closeHistory(control.state.tr));
        control.composing = true; composing.current = true; latest.current.onCompositionChange?.(true);
      }
    }}
    onCompositionEnd={event => {
      const element = event.currentTarget, generation = compositionGeneration.current;
      requestAnimationFrame(() => {
        if (!composing.current || generation !== compositionGeneration.current) return;
        control.state = control.state.apply(closeHistory(control.state.tr));
        control.composing = false; composing.current = false; latest.current.onCompositionChange?.(false);
        const index = Number(element.dataset.composerInputIndex);
        if (element.isConnected && element.ownerDocument.activeElement === element && Number.isSafeInteger(index)
          && latest.current.controls.get(index) === control) latest.current.onSelection?.(index, element.selectionStart, historyText(control.state));
      });
    }} />;
}

interface LinkOccurrence {
  element: HTMLElement;
  from: number;
  to: number;
  label: string;
  href: string;
  sourceAppId: string | null;
  signature: string;
  node?: ProseMirrorNode;
  mark?: Mark;
}

/** Resolve the clicked DOM back to one actual node or contiguous mark run. */
function linkOccurrence(editor: EditorView, element: HTMLElement): LinkOccurrence | null {
  if (!element.isConnected || !editor.dom.contains(element)) return null;
  try {
    const fromDOM = editor.posAtDOM(element, 0), node = editor.state.doc.nodeAt(fromDOM);
    if (element.dataset.mention === 'rich-link') {
      if (!node || node.type.name !== 'richLink'
        || element.getAttribute('data-composer-attrs') !== JSON.stringify(node.attrs)) return null;
      return { element, from: fromDOM, to: fromDOM + node.nodeSize, label: node.attrs.displayText,
        href: node.attrs.href, sourceAppId: node.attrs.sourceAppId, signature: JSON.stringify(node.toJSON()), node };
    }
    const position = editor.state.doc.resolve(fromDOM), parent = position.parent;
    const child = parent.childAfter(position.parentOffset), mark = child.node?.marks.find(item => item.type.name === 'link');
    if (!child.node?.isText || !mark || element.getAttribute('data-composer-attrs') !== JSON.stringify(mark.attrs)) return null;
    let first = child.index, last = child.index;
    const sameMark = (candidate: ProseMirrorNode) => candidate.isText && candidate.marks.some(item => mark.eq(item));
    while (first > 0 && sameMark(parent.child(first - 1))) first--;
    while (last + 1 < parent.childCount && sameMark(parent.child(last + 1))) last++;
    let offset = 0;
    for (let index = 0; index < first; index++) offset += parent.child(index).nodeSize;
    const from = position.start() + offset;
    for (let index = first; index <= last; index++) offset += parent.child(index).nodeSize;
    const to = position.start() + offset;
    return { element, from, to, label: parent.textBetween(from - position.start(), to - position.start()),
      href: mark.attrs.href, sourceAppId: mark.attrs.sourceAppId, signature: JSON.stringify(editor.state.doc.slice(from, to).toJSON()), mark };
  } catch { return null; }
}

function replaceLink(editor: EditorView, before: LinkOccurrence, label: string, href: string | null): 'saved' | 'stale' | 'unmappable' {
  const current = linkOccurrence(editor, before.element);
  if (!current || current.from !== before.from || current.to !== before.to || current.signature !== before.signature
    || current.href !== before.href) return 'stale';
  if (current.node) {
    const replacement = href === null ? editor.state.schema.text(label, current.node.marks)
      : editor.state.schema.nodes.richLink!.create({ ...current.node.attrs, displayText: label, href,
        sourceAppId: href === current.href ? current.node.attrs.sourceAppId : '',
        literalMarkdownSource: null, literalMarkdownOccurrenceId: current.node.attrs.literalMarkdownOccurrenceId ?? linkOccurrenceAllocator(editor.state.doc)(),
        markdownSourceStart: null, markdownSourceEnd: null }, null, current.node.marks);
    editor.dispatch(closeHistory(editor.state.tr.replaceWith(current.from, current.to, replacement)));
  } else if (current.mark) {
    const styles: string[] = [];
    editor.state.doc.nodesBetween(current.from, current.to, (node, position) => {
      if (!node.isText) return;
      const text = (node.text ?? '').slice(Math.max(0, current.from - position), Math.min(node.nodeSize, current.to - position));
      const style = JSON.stringify(node.marks.filter(mark => mark.type.name !== 'link').map(mark => mark.toJSON()));
      for (const _character of text) styles.push(style);
    });
    const changes = documentChanges(current.label, label, styles);
    if (!changes) return 'unmappable';
    let transaction = editor.state.tr;
    for (const change of changes.reverse()) transaction = transaction.insertText(change.replacement, current.from + change.start, current.from + change.oldEnd);
    const to = current.from + label.length;
    transaction = transaction.removeMark(current.from, to, editor.state.schema.marks.link!);
    if (href !== null) transaction = transaction.addMark(current.from, to, editor.state.schema.marks.link!.create({ ...current.mark.attrs,
      href, sourceAppId: href === current.href ? current.mark.attrs.sourceAppId : null, isAutolink: false, isGeneratedAutolink: false,
      literalMarkdownSource: null, literalMarkdownOccurrenceId: current.mark.attrs.literalMarkdownOccurrenceId ?? linkOccurrenceAllocator(editor.state.doc)() }));
    editor.dispatch(closeHistory(transaction));
  } else return 'stale';
  editor.dispatch(closeHistory(editor.state.tr));
  return 'saved';
}

function textEditorHandle(controls: Map<number, TextControlModel>): StructuredInputEditorHandle {
  return {
    focus(index, position) {
      const values = Array.from(controls.values());
      const control = (index === undefined ? undefined : controls.get(index))
        ?? values.find(item => item.canEdit()) ?? values[0];
      const view = control?.view, element = control?.element;
      if (view && !view.isDestroyed) {
        if (position !== undefined) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, historyPosition(view.state, position))));
        view.focus(); return;
      }
      element?.focus();
      if (element && position !== undefined) element.setSelectionRange(position, position);
    },
    matchesDocument(document) {
      const control = controls.get(-1), actual = control && (control.rich ? fullHistoryDocument(control.state) : historyDocument(control.state, document));
      const source = readRichDocument(document), current = actual && readRichDocument(actual);
      return !!source && !!current && source.eq(current);
    },
    activateFormatting(document, commit) {
      const control = controls.get(-1);
      if (!control || !control.canEdit() || control.composing || control.rich) return false;
      const next = activateRichHistory(control.state, document, () => control.canEdit());
      if (!next || commit?.() === false) return false;
      control.state = next;
      control.rich = true;
      control.view?.updateState(next);
      if (!control.view) control.activateView();
      return true;
    },
    visibleText() { const control = controls.get(-1); return control ? historyText(control.state) : ''; },
    insertRichCompletion(query, item, cwd) {
      const control = controls.get(-1), view = control?.view;
      if (!control?.rich || !control.canEdit() || !view || view.isDestroyed || view.composing) return false;
      syncRichSelection(view);
      const context = richCompletionContext(view);
      if (!context) return false;
      const from = historyPosition(view.state, query.start), to = historyPosition(view.state, query.end);
      if (to !== context.blockStart + context.cursor || from < context.blockStart || from > to) return false;
      const before = view.state.doc;
      return insertRichCompletion(view, context, { start: from - context.blockStart, end: to - context.blockStart, token: query.token }, item, cwd)
        && !view.state.doc.eq(before);
    },
    replace(index, start, end, text, skill) {
      const control = controls.get(index), element = control?.element, view = control?.view;
      if (!control || !control.canEdit() || !(view && !view.isDestroyed && view.dom.isConnected || element && !element.readOnly && element.isConnected)
        || start < 0 || end < start
        || end > historyText(control.state).length) return false;
      const left = control.state.doc.resolve(historyPosition(control.state, start));
      const right = control.state.doc.resolve(historyPosition(control.state, end));
      if (!left.sameParent(right) || !left.parent.isTextblock || left.parent.type.spec.code) return false;
      const selection = TextSelection.create(control.state.doc, historyPosition(control.state, start), historyPosition(control.state, end));
      control.state = control.state.apply(control.state.tr.setSelection(selection));
      let transaction = replaceHistoryText(control.state, start, end, text);
      if (skill) {
        const interim = control.state.apply(transaction), position = historyPosition(interim, start + text.length);
        transaction = transaction.insert(position, textHistorySchema.nodes.skill!.create(skill));
      }
      const interim = control.state.apply(transaction), caret = historyPosition(interim, start + text.length);
      transaction.setSelection(TextSelection.create(transaction.doc, caret));
      if (!control.apply(closeHistory(transaction), 'insertReplacementText')) return false;
      control.state = control.state.apply(closeHistory(control.state.tr));
      if (view) view.focus();
      else if (element) { element.value = historyText(control.state); element.focus(); element.setSelectionRange(start + text.length, start + text.length); }
      return true;
    },
    removeSkill(name, path) {
      for (const control of controls.values()) {
        const ranges: number[] = [];
        control.state.doc.descendants((node, position) => {
          if (node.type.name === 'skill' && node.attrs.name === name && node.attrs.path === path) ranges.push(position);
        });
        if (!ranges.length) continue;
        let transaction = control.state.tr;
        for (const position of ranges.reverse()) transaction = transaction.delete(position, position + 1);
        if (control.apply(closeHistory(transaction), 'deleteContent')) control.state = control.state.apply(closeHistory(control.state.tr));
      }
    },
    skills() { return Array.from(controls.values()).flatMap(control => historySkills(control.state)); },
    captureAgentMentionTarget(index, readCurrent, query) {
      const control = controls.get(index), element = control?.element, view = control?.view, current = readCurrent();
      if (!control || !control.canEdit() || control.composing || !current?.revision || !current.owner.draftId) return null;
      if (view) {
        if (view.isDestroyed || !view.dom.isConnected || !view.hasFocus() || view.composing) return null;
        syncRichSelection(view);
      } else if (!element || !element.isConnected || element.ownerDocument.activeElement !== element
        || element.value !== historyText(control.state)) return null;
      const selectionStart = view ? textOffset(control.state, control.state.selection.from) : element!.selectionStart;
      const selectionEnd = view ? textOffset(control.state, control.state.selection.to) : element!.selectionEnd;
      const text = historyText(control.state);
      let from = selectionStart, to = selectionEnd;
      if (query) {
        if (selectionStart !== selectionEnd || query.end !== selectionStart || !query.token.startsWith('@')
          || !Number.isSafeInteger(query.start) || !Number.isSafeInteger(query.end)
          || query.start < 0 || query.start > query.end || text.slice(query.start, query.end) !== query.token) return null;
        from = query.start;
        to = query.end + (text.slice(query.end).match(/^[^\s@$\ufffc]*/)?.[0].length ?? 0);
      }
      return { control, doc: control.state.doc, selectionStart, selectionEnd, view: view ?? null, selection: control.state.selection, marks: control.state.storedMarks,
        current: { owner: { ...current.owner }, revision: current.revision }, readCurrent, from, to, used: false };
    },
    insertAgentMention(target, choice) {
      const control = target?.control, element = control?.element, view = control?.view, current = target?.readCurrent(), attrs = agentMentionAttributes(choice);
      if (!control || !attrs || target.used || controls.get(control.index) !== control || (view ?? null) !== target.view
        || !(view && !view.isDestroyed && view.dom.isConnected || element && element.isConnected)
        || !control.canEdit() || control.composing || control.state.doc !== target.doc
        || view && (!control.state.selection.eq(target.selection) || view.composing)
        || (control.state.storedMarks === null) !== (target.marks === null)
        || !Mark.sameSet(control.state.storedMarks ?? [], target.marks ?? [])
        || element && (element.value !== historyText(control.state) || element.selectionStart !== target.selectionStart
          || element.selectionEnd !== target.selectionEnd) || !current || current.revision !== target.current.revision
        || current.owner.hostId !== target.current.owner.hostId || current.owner.threadId !== target.current.owner.threadId
        || current.owner.draftId !== target.current.owner.draftId) return false;
      const before = historyText(control.state), { selection, storedMarks } = control.state;
      const left = control.state.doc.resolve(historyPosition(control.state, target.from));
      const right = control.state.doc.resolve(historyPosition(control.state, target.to));
      if (!left.sameParent(right) || !left.parent.isTextblock || left.parent.type.spec.code) return false;
      const marks = storedMarks ?? (selection.empty ? selection.$from.marks() : selection.$from.marksAcross(selection.$to) ?? []);
      if (marks.some(mark => mark.type.name === 'code' || mark.type.name === 'link')) return false;
      let transaction = replaceHistoryText(control.state, target.from, target.to, '');
      const interim = control.state.apply(transaction), position = historyPosition(interim, target.from);
      transaction = transaction.insert(position, textHistorySchema.nodes.agentMention!.create(attrs, null, marks));
      const space = !/^\s/u.test(before.slice(target.to));
      if (space) transaction = transaction.insertText(' ', position + 1);
      transaction = transaction.setSelection(TextSelection.create(transaction.doc, position + 1 + (space ? 1 : 0)));
      if (!control.apply(closeHistory(transaction), 'insertReplacementText')) return false;
      target.used = true;
      control.state = control.state.apply(closeHistory(control.state.tr));
      if (view) { view.updateState(control.state); view.focus(); }
      else if (element) { element.value = historyText(control.state); control.activateView(); }
      return true;
    },
  };
}

/** Each control corresponds to one original text item; non-text items remain in the draft. */
export const StandaloneStructuredInputEditor = forwardRef<StructuredInputEditorHandle, StructuredInputEditorProps>(
  function StandaloneStructuredInputEditor(props, ref) {
    const { t, locale } = useI18n('zh-CN');
    const controls = useRef(new Map<number, TextControlModel>());
    const compositions = useRef(new Set<number>());
    useImperativeHandle(ref, () => textEditorHandle(controls.current), []);
    const entries = (props.draft.input ?? []).flatMap((entry, index) => entry.type === 'text' && typeof entry.text === 'string'
      ? [{ entry, index, text: entry.text }] : []);
    return <>{entries.map(({ entry, index, text }, position) => <ReactFragment key={position}>
      {isStructuredAppInput(entry) ? <div role="status">{t('This app input contains retained context and cannot be edited here.')}</div> : null}
      <TextControl index={index} text={text} agentMentions={props.agentMentions?.(index)} sourceMarks={props.sourceMarks?.(index)} controls={controls.current} onEdit={props.onEdit} onSelection={props.onSelection}
        label={(props.ariaLabel ?? t('Work with Codex')) + (entries.length > 1 ? ' ' + new Intl.NumberFormat(locale).format(position + 1) : '')}
        placeholder={props.placeholder ?? t('Message')} readOnly={!!props.readOnly || isStructuredAppInput(entry)} onKeyDown={props.onKeyDown}
        onPaste={props.onPaste} onInvalid={props.onInvalid} onCompositionChange={value => {
          if (value) compositions.current.add(position); else compositions.current.delete(position);
          props.onCompositionChange?.(compositions.current.size > 0);
        }}
        completionListId={props.activeIndex === index ? props.completionListId : undefined}
        completionSelectedId={props.activeIndex === index ? props.completionSelectedId : undefined} />
    </ReactFragment>)}</>;
  },
);

export const StandalonePlainInputEditor = forwardRef<StructuredInputEditorHandle, Omit<TextControlProps, 'index' | 'controls'>>(
  function StandalonePlainInputEditor(props, ref) {
    const controls = useRef(new Map<number, TextControlModel>());
    useImperativeHandle(ref, () => textEditorHandle(controls.current), []);
    return <TextControl {...props} index={-1} controls={controls.current} />;
  },
);

interface RichEditorProps {
  document: ComposerDocument;
  currentDocument(): ComposerDocument | undefined;
  onChange(document: ComposerDocument): void;
  onKeyDown(event: KeyboardEvent): boolean;
  onImages(files: File[]): void;
  onInvalid(message?: string): void;
  onCompletionContext(context: RichCompletionContext | null): void;
  onCompositionChange?(composing: boolean): void;
  onPendingLinkChange?(pending: boolean): void;
  completionListId?: string;
  completionSelectedId?: string;
  ariaLabel?: string;
  placeholder?: string;
  readOnly?: boolean;
  canEdit?(): boolean;
  allowMentions?: boolean;
  enableCompletions?: boolean;
  plainTextMode?: boolean;
}

function supportedClipboardHTML(html: string, allowMentions: boolean): boolean {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const tags = new Set(['div', 'span', 'p', 'br', 'strong', 'b', 'em', 'i', 'code', 'pre', 'blockquote',
    'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a']);
  const attributes = new Set(['class', 'dir', 'href', 'title', 'start', 'contenteditable', 'spellcheck', 'role', 'tabindex',
    'aria-busy', 'aria-expanded', 'aria-haspopup',
    'data-pm-slice', 'data-mention', 'data-composer-attrs', 'data-composer-autolink', 'data-system-hint-type', 'data-system-hint-label', 'data-saved-loading',
    'page-reference-mention-path', 'page-reference-mention-project-id', 'page-reference-mention-space-id', 'page-reference-mention-title',
    'agent-mention-name', 'agent-mention-display-name', 'agent-mention-conversation-id', 'agent-mention-path', 'data-interactive', 'aria-label']);
  const originalMentionPresentation = new Set(['data-appearance', 'data-layout', 'data-font-weight', 'data-tone', 'data-underline-on-hover']);
  if (document.querySelector('style, link, script')) return false;
  return Array.from(document.body.querySelectorAll('*')).every(element => {
    const icon = element.localName === 'svg' ? element : element.closest('svg');
    if (icon) {
      const mention = icon.closest('span[data-mention="page-reference"], span[data-mention="rich-link"], span[data-mention="agent"], span[page-reference-mention-path][page-reference-mention-title], span[agent-mention-name][agent-mention-path]');
      const allowed = element.localName === 'svg'
        ? new Set(['xmlns', 'width', 'height', 'viewbox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'class', 'aria-hidden', 'focusable'])
        : new Set(['d', 'class', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'clip-rule', 'transform']);
      return !!mention && (element === icon || element.localName === 'path' || element.localName === 'g')
        && !element.textContent && Array.from(element.attributes).every(attribute => allowed.has(attribute.name.toLowerCase()));
    }
    const originalAgent = element.closest('span[agent-mention-name][agent-mention-path]');
    if (!tags.has(element.localName) || !Array.from(element.attributes).every(attribute => attributes.has(attribute.name)
      || !!originalAgent && originalMentionPresentation.has(attribute.name))) return false;
    const mention = element.getAttribute('data-mention');
    if (mention !== null && !allowMentions) return false;
    if (mention !== null && (element.localName !== 'span' || mention !== 'file' && mention !== 'skill'
      && mention !== 'rich-link' && mention !== 'page-reference' && mention !== 'agent')) return false;
    if (element.hasAttribute('agent-mention-name') || element.hasAttribute('agent-mention-path')
      || element.hasAttribute('agent-mention-display-name') || element.hasAttribute('agent-mention-conversation-id')) {
      if (!allowMentions || element.localName !== 'span' || mention !== null && mention !== 'agent'
        || !element.hasAttribute('agent-mention-name') || !element.hasAttribute('agent-mention-path')) return false;
      const name = element.getAttribute('agent-mention-name'), path = element.getAttribute('agent-mention-path');
      const displayName = element.getAttribute('agent-mention-display-name') ?? name;
      const conversationId = element.getAttribute('agent-mention-conversation-id');
      if (!readRichDocument({ type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'agentMention', attrs: { name, path, displayName, conversationId } },
      ] }] })) return false;
      if (!element.hasAttribute('data-composer-attrs')) return mention === null;
      try {
        const value: unknown = JSON.parse(element.getAttribute('data-composer-attrs') ?? 'null');
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        const attrs = value as Record<string, unknown>;
        if (attrs.name !== name || attrs.path !== path || (attrs.displayName || attrs.name) !== displayName
          || (attrs.conversationId ?? null) !== conversationId) return false;
      } catch { return false; }
    }
    if (element.hasAttribute('page-reference-mention-path')) {
      if (!allowMentions || element.localName !== 'span' || mention !== null) return false;
      return !!readRichDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'pageReferenceMention', attrs: {
        path: element.getAttribute('page-reference-mention-path'), title: element.getAttribute('page-reference-mention-title'),
        projectId: element.getAttribute('page-reference-mention-project-id') ?? '', spaceId: element.getAttribute('page-reference-mention-space-id') ?? '',
      } }] }] });
    }
    const systemHint = element.getAttribute('data-system-hint-type');
    const hintLabel = element.getAttribute('data-system-hint-label');
    if (systemHint === null && hintLabel !== null) return false;
    if (systemHint !== null && (!allowMentions || mention !== null || element.localName !== 'span'
      || hintLabel === null || hintLabel !== element.textContent)) return false;
    if (systemHint !== null && !readRichDocument({ type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'chatGptSystemHint', attrs: { label: hintLabel, systemHint } },
    ] }] })) return false;
    if (!element.hasAttribute('data-composer-attrs')) return mention === null;
    const spec = mention === 'file' ? composerSchema.nodes.atMention?.spec : mention === 'skill' ? composerSchema.nodes.skillMention?.spec
      : mention === 'agent' ? composerSchema.nodes.agentMention?.spec
      : mention === 'rich-link' ? composerSchema.nodes.richLink?.spec : mention === 'page-reference' ? composerSchema.nodes.pageReferenceMention?.spec
      : element.localName === 'pre' ? composerSchema.nodes.code_block?.spec
      : element.localName === 'a' || element.hasAttribute('data-composer-autolink') ? composerSchema.marks.link?.spec : null;
    if (!spec) return false;
    try {
      const value: unknown = JSON.parse(element.getAttribute('data-composer-attrs') ?? 'null');
      return !!value && typeof value === 'object' && !Array.isArray(value)
        && Object.keys(value).every(key => Object.hasOwn(spec.attrs ?? {}, key))
        && (mention !== 'rich-link' && mention !== 'page-reference' && mention !== 'agent' || !!readRichDocument({ type: 'doc', content: [{ type: 'paragraph', content: [
          { type: mention === 'rich-link' ? 'richLink' : mention === 'agent' ? 'agentMention' : 'pageReferenceMention', attrs: value as Record<string, unknown> },
        ] }] }));
    } catch { return false; }
  });
}

function supportedTextHistoryClipboard(html: string, formatting: boolean): boolean {
  if (!supportedClipboardHTML(html, true)) return false;
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  if (body.querySelectorAll('p, div').length > 1 || body.querySelector('br, pre, blockquote, ul, ol, li, h1, h2, h3, h4, h5, h6')) return false;
  if (body.querySelector('[data-mention]:not([data-mention="agent"]), [page-reference-mention-path], [data-system-hint-type]')) return false;
  return formatting || !body.querySelector('strong, b, em, i, code, a, [data-composer-autolink]');
}

function remapClipboardLinkOccurrences(html: string, document: ProseMirrorNode): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const allocate = linkOccurrenceAllocator(document), occurrences = new Map<string, number>();
  for (const element of parsed.querySelectorAll('[data-mention="rich-link"][data-composer-attrs], a[href], a[data-composer-attrs], span[data-composer-autolink][data-composer-attrs]')) {
    try {
      const attrs: unknown = element.hasAttribute('data-composer-attrs')
        ? JSON.parse(element.getAttribute('data-composer-attrs') ?? 'null')
        : { href: element.getAttribute('href'), title: element.getAttribute('title') };
      if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) continue;
      const copied = { ...attrs } as Record<string, unknown>;
      const previous = copied.literalMarkdownOccurrenceId;
      const key = element.matches('[data-mention="rich-link"]') || !Number.isSafeInteger(previous) || Number(previous) < 0
        ? null : JSON.stringify(copied);
      const occurrence = key === null ? allocate() : occurrences.get(key) ?? allocate();
      if (key !== null) occurrences.set(key, occurrence);
      for (const key of ['literalMarkdownSource', 'literalMarkdownOccurrenceId', 'markdownSourceStart', 'markdownSourceEnd', 'isLoading', 'loadingDisplayText']) delete copied[key];
      copied.literalMarkdownOccurrenceId = occurrence;
      element.setAttribute('data-composer-attrs', JSON.stringify(copied));
    } catch { /* Invalid clipboard data is rejected by handlePaste. */ }
  }
  return parsed.body.innerHTML;
}

function richAutolinkPlugin(editable: () => boolean): Plugin {
  const insertAutolink = (editor: EditorView, from: number, to: number) => {
    if (from !== to || editor.composing || !editable()) return false;
    const position = editor.state.doc.resolve(from), before = position.nodeBefore;
    if (position.parent.type.spec.code || !before?.isText || before.marks.some(mark => mark.type.name === 'link')) return false;
    const contents = before.text ?? '', candidate = contents.slice(contents.lastIndexOf(' ') + 1);
    if (!httpAutolinkHref(candidate)) return false;
    const mark = editor.state.schema.marks.link!.create({ href: null, sourceAppId: '', literalMarkdownOccurrenceId: linkOccurrenceAllocator(editor.state.doc)() });
    editor.dispatch(editor.state.tr.addMark(from - candidate.length, from, mark).insertText(' ', from));
    return true;
  };
  return new Plugin({ props: {
    handleKeyDown(editor, event) {
      return event.key === ' ' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing && event.keyCode !== 229
        && insertAutolink(editor, editor.state.selection.from, editor.state.selection.to);
    },
    handleTextInput(editor, from, to, text) { return text === ' ' && insertAutolink(editor, from, to); },
  } });
}

export const StandaloneRichEditor = forwardRef<RichEditorHandle, RichEditorProps>(function StandaloneRichEditor(props, ref) {
  const { t } = useI18n('zh-CN');
  const host = useRef<HTMLDivElement>(null);
  const pageIcon = useRef<SVGSVGElement>(null);
  const linkIcon = useRef<SVGSVGElement>(null);
  const agentIcon = useRef<SVGSVGElement>(null);
  const view = useRef<EditorView | null>(null);
  const composing = useRef(false);
  const latest = useRef(props);
  latest.current = props;
  const latestTranslation = useRef(t);
  latestTranslation.current = t;
  const applyMode = useRef<(() => void) | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState('');
  const [openedLink, setOpenedLink] = useState<LinkOccurrence | null>(null);
  const [linkEdit, setLinkEdit] = useState<'text' | 'url' | null>(null);
  const [linkValue, setLinkValue] = useState('');
  const [linkError, setLinkError] = useState('');
  const editable = () => !latest.current.readOnly && latest.current.canEdit?.() !== false;
  const closeRichLink = (focus = true) => {
    if (!openedLink) return;
    if (linkEdit) props.onPendingLinkChange?.(false);
    openedLink.element.setAttribute('aria-expanded', 'false');
    if (focus && openedLink.element.isConnected) openedLink.element.focus();
    setOpenedLink(null); setLinkEdit(null); setLinkError('');
  };
  const openRichLink = (target: EventTarget | null): boolean => {
    const element = target instanceof Element ? target.closest<HTMLElement>('[data-mention="rich-link"][role="button"], a[data-composer-attrs]') : null;
    if (!element || !host.current?.contains(element)) return false;
    if (openedLink?.element === element) { closeRichLink(); return true; }
    const editor = view.current, occurrence = editor && linkOccurrence(editor, element);
    // Never let an editor anchor navigate directly, even if its document changed.
    if (!occurrence || linkEdit || linkOpen) return true;
    openedLink?.element.setAttribute('aria-expanded', 'false');
    element.setAttribute('aria-expanded', 'true');
    setOpenedLink(occurrence); setLinkError('');
    return true;
  };
  const beginLinkEdit = (mode: 'text' | 'url') => {
    if (!openedLink || !editable() || composing.current) return;
    props.onPendingLinkChange?.(true);
    setLinkValue(mode === 'text' ? openedLink.label : openedLink.href);
    setLinkError(''); setLinkEdit(mode);
  };
  const saveLinkEdit = () => {
    if (!openedLink || !linkEdit || !editable() || composing.current) return;
    const label = linkEdit === 'text' ? linkValue.trim() : openedLink.label;
    const address = linkEdit === 'url' ? linkValue : openedLink.href;
    const safe = address.trim() ? safeRichLinkHref(address) : null;
    if (!label) { setLinkError(t('Link text cannot be empty.')); return; }
    if (address.trim() && !safe) { setLinkError(t('Enter an HTTP, HTTPS, or mailto link.')); return; }
    const editor = view.current, source = latest.current.currentDocument();
    const document = source && readRichDocument(source);
    if (!editor || !document || !editor.state.doc.eq(document)) {
      setLinkError(t('This link changed. Open it again before saving.')); return;
    }
    if (label !== openedLink.label || safe !== openedLink.href) {
      const result = replaceLink(editor, openedLink, label, safe);
      if (result !== 'saved') {
        setLinkError(t(result === 'unmappable' ? 'This link edit cannot safely preserve formatting.' : 'This link changed. Open it again before saving.'));
        return;
      }
    }
    closeRichLink(false); editor.focus();
  };
  const recoverLoadingLink = () => {
    if (!openedLink?.node?.attrs.isLoading || !editable() || composing.current) return;
    const editor = view.current, source = latest.current.currentDocument();
    const document = source && readRichDocument(source);
    const current = editor && linkOccurrence(editor, openedLink.element);
    if (!editor || !document || !editor.state.doc.eq(document) || !current || current.signature !== openedLink.signature) {
      setLinkError(t('This link changed. Open it again before saving.')); return;
    }
    editor.dispatch(closeHistory(editor.state.tr.setNodeMarkup(current.from, undefined,
      { ...current.node!.attrs, isLoading: false, loadingDisplayText: null })));
    editor.dispatch(closeHistory(editor.state.tr));
    closeRichLink(false); editor.focus();
  };
  useImperativeHandle(ref, () => ({
    focus: () => view.current?.focus(),
    matchesDocument: document => {
      const source = readRichDocument(document), editor = view.current;
      return !!source && !!editor && source.eq(editor.state.doc);
    },
    insertCompletion: (context, query, item, cwd) => {
      const editor = view.current;
      if (editor && !composing.current) syncRichSelection(editor);
      return !!editor && !composing.current && insertRichCompletion(editor, context, query, item, cwd);
    },
    captureAgentMentionTarget: (readCurrent, query) => {
      const editor = view.current;
      return editor && !composing.current && editable() && latest.current.allowMentions !== false
        ? captureAgentMentionTarget(editor, latest.current.currentDocument(), readCurrent, query) : null;
    },
    insertAgentMention: (target, choice) => {
      const editor = view.current;
      return !!editor && !composing.current && editable() && latest.current.allowMentions !== false
        && insertAgentMention(editor, target, choice, () => latest.current.currentDocument());
    },
  }), []);

  useLayoutEffect(() => {
    const doc = readRichDocument(latest.current.document);
    if (!host.current || !doc) return;
    const plugins = richEditorPlugins();
    const autolink = richAutolinkPlugin(() => !composing.current && editable());
    plugins.rich.unshift(autolink); plugins.plain.unshift(autolink);
    const inlineNode = (icon: SVGSVGElement | null) => (node: ProseMirrorNode) => {
      const dom = DOMSerializer.fromSchema(composerSchema).serializeNode(node) as HTMLElement;
      if (icon) dom.prepend(icon.cloneNode(true));
      return { dom };
    };
    const editor = new EditorView(host.current, {
      state: EditorState.create({ doc, plugins: latest.current.plainTextMode ? plugins.plain : plugins.rich }),
      nodeViews: { pageReferenceMention: inlineNode(pageIcon.current), richLink: inlineNode(linkIcon.current),
        agentMention: node => inlineNode(parseAgentThreadPath(node.attrs.path) ? agentIcon.current : null)(node) },
      editable: () => !latest.current.readOnly,
      attributes: { role: 'textbox', 'aria-label': latest.current.ariaLabel ?? latestTranslation.current('Work with Codex'), 'aria-multiline': 'true',
        ...(latest.current.placeholder ? { 'data-placeholder': latest.current.placeholder, 'aria-placeholder': latest.current.placeholder } : {}),
        ...(latest.current.enableCompletions === false ? {} : { 'aria-autocomplete': 'list' }) },
      handleDOMEvents: {
        keydown: (editor, event) => {
          if (editor.composing || composing.current || event.isComposing || event.keyCode === 229) return true;
          syncRichSelection(editor);
          return false;
        },
        paste: editor => { if (!composing.current) syncRichSelection(editor); return false; },
        focus: editor => { latest.current.onCompletionContext(composing.current ? null : richCompletionContext(editor)); return false; },
        blur: () => { latest.current.onCompletionContext(null); return false; },
        compositionstart: () => { composing.current = true; latest.current.onCompositionChange?.(true); latest.current.onCompletionContext(null); return false; },
        compositionend: editor => {
          requestAnimationFrame(() => {
            if (view.current !== editor || editor.isDestroyed) return;
            composing.current = false;
            applyMode.current?.();
            latest.current.onCompositionChange?.(false);
            if (editor.hasFocus()) latest.current.onCompletionContext(richCompletionContext(editor));
          });
          return false;
        },
      },
      dispatchTransaction(transaction) {
        const next = editor.state.apply(transaction);
        const document = next.doc.toJSON() as ComposerDocument;
        if (transaction.docChanged && !readRichDocument(document)) {
          editor.updateState(editor.state);
          latest.current.onInvalid();
          return;
        }
        editor.updateState(next);
        if (transaction.docChanged) latest.current.onChange(document);
        if (editor.hasFocus()) latest.current.onCompletionContext(composing.current ? null : richCompletionContext(editor));
      },
      handleKeyDown: (editor, event) => editor.composing || composing.current || event.isComposing || event.keyCode === 229 ? false : latest.current.onKeyDown(event),
      handlePaste: (editor, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter(file => file.type.startsWith('image/'));
        if (files.length && !event.clipboardData?.getData('text/plain')) {
          latest.current.onImages(files);
          return true;
        }
        if (files.length) { latest.current.onInvalid(latestTranslation.current('Text and images cannot be pasted together.')); return true; }
        if (latest.current.plainTextMode) {
          const text = event.clipboardData?.getData('text/plain')?.replace(/\r\n?/g, '\n');
          if (text) {
            if (editor.state.selection.$from.parent.type.spec.code) editor.dispatch(editor.state.tr.insertText(text).scrollIntoView());
            else {
              const paragraph = editor.state.schema.nodes.paragraph!;
              const nodes = text.split('\n').map(line => paragraph.create(null, line ? editor.state.schema.text(line) : undefined));
              editor.dispatch(editor.state.tr.replaceSelection(new Slice(Fragment.fromArray(nodes), 1, 1)).scrollIntoView());
            }
          }
          return true;
        }
        const html = event.clipboardData?.getData('text/html');
        if (html && !supportedClipboardHTML(html, latest.current.allowMentions !== false)) { latest.current.onInvalid(); return true; }
        return false;
      },
      transformPastedHTML: (html): string => remapClipboardLinkOccurrences(html, editor.state.doc),
    });
    view.current = editor;
    let plain = !!latest.current.plainTextMode;
    applyMode.current = () => {
      const next = !!latest.current.plainTextMode;
      if (plain === next || composing.current || editor.composing || editor.isDestroyed) return;
      plain = next;
      editor.updateState(editor.state.reconfigure({ plugins: plain ? plugins.plain : plugins.rich }));
    };
    return () => {
      applyMode.current = null; view.current = null; editor.destroy();
      latest.current.onCompositionChange?.(false); latest.current.onPendingLinkChange?.(false);
    };
  }, []);

  useLayoutEffect(() => { applyMode.current?.(); }, [props.plainTextMode]);

  useLayoutEffect(() => {
    if (props.currentDocument() !== props.document) return;
    const editor = view.current, doc = readRichDocument(props.document);
    if (!editor || !doc || editor.state.doc.eq(doc)) return;
    editor.updateState(EditorState.create({ doc, plugins: editor.state.plugins }));
  }, [props.document, props.currentDocument]);

  useEffect(() => {
    if (openedLink && !openedLink.element.isConnected && !linkEdit) setOpenedLink(null);
    else openedLink?.element.setAttribute('aria-expanded', 'true');
    return () => { openedLink?.element.setAttribute('aria-expanded', 'false'); };
  }, [props.document, openedLink, linkEdit]);

  useLayoutEffect(() => {
    view.current?.setProps({ attributes: {
      role: 'textbox', 'aria-label': props.ariaLabel ?? t('Work with Codex'), 'aria-multiline': 'true',
      ...(props.placeholder ? { 'data-placeholder': props.placeholder, 'aria-placeholder': props.placeholder } : {}),
      ...(props.enableCompletions === false ? {} : { 'aria-autocomplete': 'list' }),
      ...(props.completionListId ? { 'aria-controls': props.completionListId } : {}),
      ...(props.completionSelectedId ? { 'aria-activedescendant': props.completionSelectedId } : {}),
    }, editable: () => !props.readOnly });
  }, [props.ariaLabel, props.placeholder, props.readOnly, props.enableCompletions, props.completionListId, props.completionSelectedId, t]);

  const mark = (name: 'strong' | 'em' | 'code') => {
    const editor = view.current, type = composerSchema.marks[name];
    if (editor && type && editable()) { syncRichSelection(editor); toggleMark(type)(editor.state, editor.dispatch, editor); editor.focus(); }
  };
  return <>
    <span hidden aria-hidden="true"><FileText ref={pageIcon} size={14} aria-hidden="true" focusable="false" />
      <MessageSquare ref={agentIcon} size={14} aria-hidden="true" focusable="false" />
      <LinkIcon ref={linkIcon} size={14} aria-hidden="true" focusable="false" /></span>
    {(!props.plainTextMode || linkOpen) && <div className="standalone-composer__rich-toolbar" role="toolbar" aria-label={t('Text formatting')}>
      {!props.plainTextMode && <>
        <button type="button" title={t('Bold')} aria-label={t('Bold')} disabled={props.readOnly} onMouseDown={event => event.preventDefault()} onClick={() => mark('strong')}><Bold size={16} /></button>
        <button type="button" title={t('Italic')} aria-label={t('Italic')} disabled={props.readOnly} onMouseDown={event => event.preventDefault()} onClick={() => mark('em')}><Italic size={16} /></button>
        <button type="button" title={t('Inline code')} aria-label={t('Inline code')} disabled={props.readOnly} onMouseDown={event => event.preventDefault()} onClick={() => mark('code')}><Code2 size={16} /></button>
      </>}
      <button type="button" title={t('Link')} aria-label={t('Link')} disabled={props.readOnly} onMouseDown={event => { event.preventDefault(); if (view.current) syncRichSelection(view.current); }} onClick={() => {
        if (!editable() || composing.current) return;
        closeRichLink(false); setLinkError('');
        props.onPendingLinkChange?.(!linkOpen); setLinkOpen(!linkOpen);
      }}><LinkIcon size={16} /></button>
      {linkOpen ? <form onSubmit={event => {
        event.preventDefault();
        const editor = view.current, type = composerSchema.marks.link;
        const safe = safeRichLinkHref(href);
        if (!safe) { setLinkError(t('Enter an HTTP, HTTPS, or mailto link.')); return; }
        if (editor && type && editable() && !editor.state.selection.empty) {
          const { from, to } = editor.state.selection;
          editor.dispatch(closeHistory(editor.state.tr.addMark(from, to, type.create({ href: safe, literalMarkdownOccurrenceId: linkOccurrenceAllocator(editor.state.doc)() }))));
          editor.dispatch(closeHistory(editor.state.tr));
          props.onPendingLinkChange?.(false); setLinkOpen(false); setHref(''); setLinkError(''); editor.focus();
        }
      }}><input aria-label={t('Link address')} aria-invalid={!!linkError} value={href} disabled={props.readOnly}
        onChange={event => { setHref(event.target.value); setLinkError(''); }} /><button type="submit" disabled={props.readOnly}>{t('Apply')}</button>
        {linkError ? <span role="alert">{linkError}</span> : null}</form> : null}
    </div>}
    <div ref={host} className="standalone-composer__rich" onClickCapture={event => {
      if (openRichLink(event.target)) { event.preventDefault(); event.stopPropagation(); }
    }} onKeyDownCapture={event => {
      if ((event.key === 'Enter' || event.key === ' ') && openRichLink(event.target)) { event.preventDefault(); event.stopPropagation(); }
    }} />
    {openedLink ? <div role="dialog" aria-label={t('Link')}>
      {linkEdit ? <form onSubmit={event => { event.preventDefault(); saveLinkEdit(); }}>
        <input autoFocus aria-label={linkEdit === 'text' ? t('Link text') : t('Link address')} aria-invalid={!!linkError}
          value={linkValue} onChange={event => { setLinkValue(event.target.value); setLinkError(''); }} />
        <button type="submit">{linkEdit === 'text' ? t('Save link text') : linkValue.trim() ? t('Save link URL') : t('Remove link')}</button>
        {linkError ? <span role="alert">{linkError}</span> : null}
      </form> : <>
        <span>{openedLink.label}</span>{' '}{safeRichLinkHref(openedLink.href)
          ? <a href={safeRichLinkHref(openedLink.href)!} target="_blank" rel="noopener noreferrer">{openedLink.href}</a> : <span>{openedLink.href}</span>}
        {openedLink.sourceAppId ? <span> {t('Source')}: {openedLink.sourceAppId}</span> : null}
        {openedLink.node?.attrs.isLoading ? <>
          <p>{t('The saved Page lookup is no longer running. The original link is retained.')}</p>
          <button type="button" disabled={props.readOnly} onClick={recoverLoadingLink}>{t('Use saved link')}</button>
          {linkError ? <span role="alert">{linkError}</span> : null}
        </> : <>
          <button type="button" disabled={props.readOnly} onClick={() => beginLinkEdit('text')}>{t('Edit link text')}</button>
          <button type="button" disabled={props.readOnly} onClick={() => beginLinkEdit('url')}>{t('Edit link URL')}</button>
        </>}
      </>}
      <button type="button" title={t('Close')} aria-label={t('Close')} onClick={() => closeRichLink()}><X size={16} /></button>
    </div> : null}
  </>;
});
