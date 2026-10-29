import { Fragment as ReactFragment, forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Bold, Code2, Italic, Link as LinkIcon, X } from 'lucide-react';
import { toggleMark } from 'prosemirror-commands';
import { closeHistory, history, redo, undo } from 'prosemirror-history';
import { Fragment, Schema, Slice } from 'prosemirror-model';
import type { Mark, Node as ProseMirrorNode } from 'prosemirror-model';
import { EditorState, Plugin, TextSelection } from 'prosemirror-state';
import type { Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { ClipboardEvent } from 'react';
import type { ComposerDocument } from '../workbench-contract.ts';
import { useI18n } from '../i18n/index.tsx';
import { documentChanges } from '../messages/message-edit.ts';
import { composerSchema, httpAutolinkHref, linkOccurrenceAllocator, readRichDocument, safeRichLinkHref } from './rich-document.ts';
import { insertRichCompletion, richCompletionContext, richEditorPlugins, syncRichSelection } from './rich-editor-actions.ts';
import type { RichCompletionContext, RichCompletionQuery } from './rich-editor-actions.ts';
import type { Completion } from './standalone-completions.tsx';
import { isStructuredAppInput } from './standalone-draft.ts';
import type { Draft } from './standalone-draft.ts';

export interface RichEditorHandle {
  focus(): void;
  insertCompletion(context: RichCompletionContext, query: RichCompletionQuery, item: Completion, cwd: string): boolean;
}
export interface StructuredInputEditorHandle {
  focus(index?: number, position?: number): void;
  replace(index: number, start: number, end: number, text: string, skill?: TextCompletionSkill): boolean;
  removeSkill(name: string, path: string): void;
  skills(): TextCompletionSkill[];
}
export interface TextCompletionSkill { name: string; path: string; managed: boolean }
export interface TextSkillChange { before: TextCompletionSkill[]; after: TextCompletionSkill[] }
export interface StructuredInputEditorProps {
  draft: Draft;
  onEdit(index: number, expectedText: string, text: string, inputType?: string, skills?: TextSkillChange): boolean;
  onSelection?(index: number, cursor: number): void;
  onKeyDown(event: KeyboardEvent): boolean;
  onCompositionChange?(composing: boolean): void;
  onPaste?(event: ClipboardEvent<HTMLTextAreaElement>): void;
  readOnly?: boolean;
  ariaLabel?: string;
  activeIndex?: number;
  completionListId?: string;
  completionSelectedId?: string;
}

// The draft remains authoritative; this editor history joins each skill marker to its text replacement.
const textHistorySchema = new Schema({ nodes: {
  doc: { content: 'paragraph' }, paragraph: { content: 'inline*' },
  text: { group: 'inline' }, skill: { inline: true, group: 'inline', atom: true, attrs: { name: {}, path: {}, managed: {} } },
} });
function textHistoryState(text: string): EditorState {
  const paragraph = textHistorySchema.nodes.paragraph!.create(null, text ? textHistorySchema.text(text) : undefined);
  return EditorState.create({ doc: textHistorySchema.nodes.doc!.create(null, paragraph), plugins: [history()] });
}
function historyText(state: EditorState): string {
  return state.doc.textBetween(0, state.doc.content.size, '', () => '');
}
function historySkills(state: EditorState): TextCompletionSkill[] {
  const result: TextCompletionSkill[] = [];
  state.doc.descendants(node => {
    if (node.type.name === 'skill') result.push({ name: node.attrs.name, path: node.attrs.path, managed: node.attrs.managed });
  });
  return result;
}
function textOffset(state: EditorState, position: number): number {
  let offset = 0;
  state.doc.descendants((node, pos) => {
    if (node.isText && pos < position) offset += Math.min(node.nodeSize, position - pos);
  });
  return offset;
}
function historyPosition(state: EditorState, offset: number): number {
  let seen = 0, position = 1;
  state.doc.firstChild!.forEach(node => {
    if (node.isText) {
      position += Math.max(0, Math.min(offset - seen, node.nodeSize));
      seen += node.nodeSize;
    } else if (seen <= offset) position += node.nodeSize;
  });
  return position;
}
function replaceHistoryText(state: EditorState, start: number, end: number, inserted: string): Transaction {
  // Textarea offsets exclude skill atoms, which must survive unrelated text edits.
  const ranges: { from: number; to: number }[] = [];
  let offset = 0;
  state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const from = Math.max(start, offset), to = Math.min(end, offset + node.nodeSize);
    if (from < to) ranges.push({ from: pos + from - offset, to: pos + to - offset });
    offset += node.nodeSize;
  });
  let transaction = state.tr;
  for (const range of ranges.reverse()) transaction = transaction.delete(range.from, range.to);
  const position = transaction.mapping.map(historyPosition(state, start), 1);
  if (inserted) transaction = transaction.insertText(inserted, position);
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
  apply(transaction: Transaction, inputType?: string): boolean;
}
interface TextControlProps {
  index: number; text: string; readOnly: boolean; label: string; placeholder: string;
  controls: Map<number, TextControlModel>;
  onEdit(index: number, expected: string, text: string, inputType?: string, skills?: TextSkillChange): boolean;
  onSelection?(index: number, cursor: number): void;
  onKeyDown(event: KeyboardEvent): boolean;
  onPaste?(event: ClipboardEvent<HTMLTextAreaElement>): void;
  onCompositionChange?(composing: boolean): void;
  canEdit?(): boolean;
  completionListId?: string; completionSelectedId?: string;
}
function TextControl(props: TextControlProps) {
  const model = useRef<TextControlModel | null>(null);
  if (!model.current) model.current = { state: textHistoryState(props.text), element: null, index: props.index, apply: () => false };
  const control = model.current;
  const latest = useRef(props); latest.current = props;
  const composing = useRef(false);
  const compositionGeneration = useRef(0);
  const publish = (transaction: Transaction, inputType?: string): boolean => {
    const previous = control.state, next = previous.apply(transaction);
    const beforeText = historyText(previous), afterText = historyText(next);
    const all = Array.from(latest.current.controls.values());
    const before = all.flatMap(item => historySkills(item.state));
    const after = all.flatMap(item => historySkills(item === control ? next : item.state));
    if (transaction.docChanged && latest.current.onEdit(control.index, beforeText, afterText, inputType, { before, after }) === false) return false;
    control.state = next;
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
    return applied;
  };
  const syncSelection = (element: HTMLTextAreaElement) => {
    if (historyText(control.state) === element.value) {
      const start = historyPosition(control.state, element.selectionStart), end = historyPosition(control.state, element.selectionEnd);
      const anchor = element.selectionDirection === 'backward' ? end : start;
      const head = element.selectionDirection === 'backward' ? start : end;
      control.state = control.state.apply(control.state.tr.setSelection(TextSelection.create(control.state.doc, anchor, head)));
    }
    latest.current.onSelection?.(control.index, element.selectionStart);
  };
  useLayoutEffect(() => {
    control.index = props.index;
    props.controls.set(props.index, control);
    return () => { if (props.controls.get(props.index) === control) props.controls.delete(props.index); };
  }, [control, props.controls, props.index]);
  useLayoutEffect(() => {
    if (historyText(control.state) !== props.text) control.state = textHistoryState(props.text);
  }, [control, props.text]);
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
  }, [control]);
  useEffect(() => () => {
    compositionGeneration.current++;
    if (composing.current) { composing.current = false; latest.current.onCompositionChange?.(false); }
  }, []);
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
      const provisional = control.state.apply(transaction), position = historyPosition(provisional, element.selectionStart);
      transaction.setSelection(TextSelection.create(transaction.doc, position));
      if (!publish(transaction, inputType)) {
        element.value = before; element.setSelectionRange(Math.min(before.length, element.selectionStart), Math.min(before.length, element.selectionStart));
      }
      latest.current.onSelection?.(control.index, element.selectionStart);
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
      if (!composing.current) { composing.current = true; latest.current.onCompositionChange?.(true); }
    }}
    onCompositionEnd={event => {
      const element = event.currentTarget, generation = compositionGeneration.current;
      requestAnimationFrame(() => {
        if (!composing.current || generation !== compositionGeneration.current) return;
        composing.current = false; latest.current.onCompositionChange?.(false);
        const index = Number(element.dataset.composerInputIndex);
        if (element.isConnected && element.ownerDocument.activeElement === element && Number.isSafeInteger(index)
          && latest.current.controls.get(index) === control) latest.current.onSelection?.(index, element.selectionStart);
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
      if (!node || node.type.name !== 'richLink' || node.attrs.isLoading
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
    const replacement = href === null ? composerSchema.text(label, current.node.marks)
      : composerSchema.nodes.richLink!.create({ ...current.node.attrs, displayText: label, href,
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
    transaction = transaction.removeMark(current.from, to, composerSchema.marks.link!);
    if (href !== null) transaction = transaction.addMark(current.from, to, composerSchema.marks.link!.create({ ...current.mark.attrs,
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
      const element = (index === undefined ? undefined : controls.get(index)?.element)
        ?? values.find(item => !item.element?.readOnly)?.element ?? values[0]?.element;
      element?.focus();
      if (element && position !== undefined) element.setSelectionRange(position, position);
    },
    replace(index, start, end, text, skill) {
      const control = controls.get(index), element = control?.element;
      if (!control || !element || element.readOnly || !element.isConnected || start < 0 || end < start
        || end > historyText(control.state).length) return false;
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
      element.value = historyText(control.state);
      element.focus(); element.setSelectionRange(start + text.length, start + text.length);
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
      <TextControl index={index} text={text} controls={controls.current} onEdit={props.onEdit} onSelection={props.onSelection}
        label={(props.ariaLabel ?? t('Work with Codex')) + (entries.length > 1 ? ' ' + new Intl.NumberFormat(locale).format(position + 1) : '')}
        placeholder={t('Message')} readOnly={!!props.readOnly || isStructuredAppInput(entry)} onKeyDown={props.onKeyDown}
        onPaste={props.onPaste} onCompositionChange={value => {
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
    'data-pm-slice', 'data-mention', 'data-composer-attrs', 'data-composer-autolink', 'data-system-hint-type', 'data-system-hint-label']);
  if (document.querySelector('style, link, script')) return false;
  return Array.from(document.body.querySelectorAll('*')).every(element => {
    if (!tags.has(element.localName) || !Array.from(element.attributes).every(attribute => attributes.has(attribute.name))) return false;
    const mention = element.getAttribute('data-mention');
    if (mention !== null && !allowMentions) return false;
    if (mention !== null && (element.localName !== 'span' || mention !== 'file' && mention !== 'skill' && mention !== 'rich-link')) return false;
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
      : mention === 'rich-link' ? composerSchema.nodes.richLink?.spec
      : element.localName === 'pre' ? composerSchema.nodes.code_block?.spec
      : element.localName === 'a' || element.hasAttribute('data-composer-autolink') ? composerSchema.marks.link?.spec : null;
    if (!spec) return false;
    try {
      const value: unknown = JSON.parse(element.getAttribute('data-composer-attrs') ?? 'null');
      return !!value && typeof value === 'object' && !Array.isArray(value)
        && Object.keys(value).every(key => Object.hasOwn(spec.attrs ?? {}, key))
        && (mention !== 'rich-link' || !!readRichDocument({ type: 'doc', content: [{ type: 'paragraph', content: [
          { type: 'richLink', attrs: value as Record<string, unknown> },
        ] }] }));
    } catch { return false; }
  });
}

export const StandaloneRichEditor = forwardRef<RichEditorHandle, RichEditorProps>(function StandaloneRichEditor(props, ref) {
  const { t } = useI18n('zh-CN');
  const host = useRef<HTMLDivElement>(null);
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
  useImperativeHandle(ref, () => ({
    focus: () => view.current?.focus(),
    insertCompletion: (context, query, item, cwd) => {
      const editor = view.current;
      if (editor && !composing.current) syncRichSelection(editor);
      return !!editor && !composing.current && insertRichCompletion(editor, context, query, item, cwd);
    },
  }), []);

  useLayoutEffect(() => {
    const doc = readRichDocument(latest.current.document);
    if (!host.current || !doc) return;
    const plugins = richEditorPlugins();
    const insertAutolink = (editor: EditorView, from: number, to: number) => {
      if (from !== to || composing.current || editor.composing || !editable()) return false;
      const position = editor.state.doc.resolve(from), before = position.nodeBefore;
      if (position.parent.type.spec.code || !before?.isText || before.marks.some(mark => mark.type.name === 'link')) return false;
      const contents = before.text ?? '', candidate = contents.slice(contents.lastIndexOf(' ') + 1);
      if (!httpAutolinkHref(candidate)) return false;
      const mark = composerSchema.marks.link!.create({ href: null, sourceAppId: '', literalMarkdownOccurrenceId: linkOccurrenceAllocator(editor.state.doc)() });
      editor.dispatch(editor.state.tr.addMark(from - candidate.length, from, mark).insertText(' ', from));
      return true;
    };
    const autolink = new Plugin({ props: {
      handleKeyDown(editor, event) {
        return event.key === ' ' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing && event.keyCode !== 229
          && insertAutolink(editor, editor.state.selection.from, editor.state.selection.to);
      },
      handleTextInput(editor, from, to, text) { return text === ' ' && insertAutolink(editor, from, to); },
    } });
    plugins.rich.unshift(autolink); plugins.plain.unshift(autolink);
    const editor = new EditorView(host.current, {
      state: EditorState.create({ doc, plugins: latest.current.plainTextMode ? plugins.plain : plugins.rich }),
      editable: () => !latest.current.readOnly,
      attributes: { role: 'textbox', 'aria-label': latest.current.ariaLabel ?? latestTranslation.current('Work with Codex'), 'aria-multiline': 'true',
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
      transformPastedHTML: html => {
        const parsed = new DOMParser().parseFromString(html, 'text/html');
        const allocate = linkOccurrenceAllocator(editor.state.doc), occurrences = new Map<string, number>();
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
      },
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

  useEffect(() => {
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
      ...(props.enableCompletions === false ? {} : { 'aria-autocomplete': 'list' }),
      ...(props.completionListId ? { 'aria-controls': props.completionListId } : {}),
      ...(props.completionSelectedId ? { 'aria-activedescendant': props.completionSelectedId } : {}),
    }, editable: () => !props.readOnly });
  }, [props.ariaLabel, props.readOnly, props.enableCompletions, props.completionListId, props.completionSelectedId, t]);

  const mark = (name: 'strong' | 'em' | 'code') => {
    const editor = view.current, type = composerSchema.marks[name];
    if (editor && type && editable()) { syncRichSelection(editor); toggleMark(type)(editor.state, editor.dispatch, editor); editor.focus(); }
  };
  return <>
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
        <button type="button" disabled={props.readOnly} onClick={() => beginLinkEdit('text')}>{t('Edit link text')}</button>
        <button type="button" disabled={props.readOnly} onClick={() => beginLinkEdit('url')}>{t('Edit link URL')}</button>
      </>}
      <button type="button" title={t('Close')} aria-label={t('Close')} onClick={() => closeRichLink()}><X size={16} /></button>
    </div> : null}
  </>;
});
