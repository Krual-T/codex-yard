import { Fragment as ReactFragment, forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Bold, Code2, Italic, Link as LinkIcon, X } from 'lucide-react';
import { toggleMark } from 'prosemirror-commands';
import { closeHistory } from 'prosemirror-history';
import { Fragment, Slice } from 'prosemirror-model';
import type { Mark, Node as ProseMirrorNode } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { ClipboardEvent } from 'react';
import type { ComposerDocument } from '../workbench-contract.ts';
import { useI18n } from '../i18n/index.tsx';
import { composerSchema, readRichDocument, safeRichLinkHref } from './rich-document.ts';
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
  replace(index: number, start: number, end: number, text: string): boolean;
}
export interface StructuredInputEditorProps {
  draft: Draft;
  onEdit(index: number, expectedText: string, text: string, inputType?: string): void;
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

function replaceLink(editor: EditorView, before: LinkOccurrence, label: string, href: string | null): boolean {
  const current = linkOccurrence(editor, before.element);
  if (!current || current.from !== before.from || current.to !== before.to || current.signature !== before.signature
    || current.href !== before.href) return false;
  if (current.node) {
    const replacement = href === null ? composerSchema.text(label, current.node.marks)
      : composerSchema.nodes.richLink!.create({ ...current.node.attrs, displayText: label, href,
        sourceAppId: href === current.href ? current.node.attrs.sourceAppId : '',
        literalMarkdownSource: null, literalMarkdownOccurrenceId: null, markdownSourceStart: null, markdownSourceEnd: null }, null, current.node.marks);
    editor.dispatch(closeHistory(editor.state.tr.replaceWith(current.from, current.to, replacement)));
  } else if (current.mark) {
    const oldCharacters = Array.from(current.label), newCharacters = Array.from(label);
    let prefix = 0, suffix = 0;
    while (prefix < oldCharacters.length && prefix < newCharacters.length && oldCharacters[prefix] === newCharacters[prefix]) prefix++;
    while (suffix < oldCharacters.length - prefix && suffix < newCharacters.length - prefix
      && oldCharacters[oldCharacters.length - 1 - suffix] === newCharacters[newCharacters.length - 1 - suffix]) suffix++;
    const start = oldCharacters.slice(0, prefix).join('').length, end = oldCharacters.slice(oldCharacters.length - suffix).join('').length;
    const middle = newCharacters.slice(prefix, newCharacters.length - suffix).join('');
    let transaction = editor.state.tr;
    if (label !== current.label) transaction = transaction.insertText(middle, current.from + start, current.to - end);
    const to = current.from + label.length;
    transaction = transaction.removeMark(current.from, to, composerSchema.marks.link!);
    if (href !== null) transaction = transaction.addMark(current.from, to, composerSchema.marks.link!.create({ ...current.mark.attrs,
      href, sourceAppId: href === current.href ? current.mark.attrs.sourceAppId : null, isAutolink: false, isGeneratedAutolink: false,
      literalMarkdownSource: null, literalMarkdownOccurrenceId: null }));
    editor.dispatch(closeHistory(transaction));
  } else return false;
  editor.dispatch(closeHistory(editor.state.tr));
  return true;
}

/** Each control corresponds to one original text item; non-text items remain in the draft. */
export const StandaloneStructuredInputEditor = forwardRef<StructuredInputEditorHandle, StructuredInputEditorProps>(
  function StandaloneStructuredInputEditor(props, ref) {
    const { t, locale } = useI18n('zh-CN');
    const controls = useRef(new Map<number, HTMLTextAreaElement>());
    const latest = useRef(props);
    const composition = useRef(0);
    latest.current = props;
    useImperativeHandle(ref, () => ({
      focus: (index, position) => {
        const values = Array.from(controls.current.values());
        const control = (index === undefined ? undefined : controls.current.get(index))
          ?? values.find(element => !element.readOnly) ?? values[0];
        control?.focus();
        if (control && position !== undefined) control.setSelectionRange(position, position);
      },
      replace: (index, start, end, text) => {
        const control = controls.current.get(index);
        if (!control || control.readOnly || !control.isConnected) return false;
        control.focus(); control.setSelectionRange(start, end);
        return text ? document.execCommand('insertText', false, text) : document.execCommand('delete');
      },
    }), []);
    useEffect(() => () => {
      if (composition.current) { composition.current = 0; latest.current.onCompositionChange?.(false); }
    }, []);
    const entries = (props.draft.input ?? []).flatMap((entry, index) => entry.type === 'text' && typeof entry.text === 'string'
      ? [{ entry, index, text: entry.text }] : []);
    return <>{entries.map(({ entry, index, text }, position) => <ReactFragment key={position}>
      {isStructuredAppInput(entry) ? <div role="status">{t('This app input contains retained context and cannot be edited here.')}</div> : null}
      <textarea
        ref={element => { if (element) controls.current.set(index, element); else controls.current.delete(index); }}
        aria-label={(props.ariaLabel ?? t('Work with Codex')) + (entries.length > 1 ? ' ' + new Intl.NumberFormat(locale).format(position + 1) : '')}
        aria-autocomplete="list" aria-controls={props.activeIndex === index ? props.completionListId : undefined}
        aria-activedescendant={props.activeIndex === index ? props.completionSelectedId : undefined}
        placeholder={t('Message')} value={text} readOnly={props.readOnly || isStructuredAppInput(entry)}
        onChange={event => { props.onSelection?.(index, event.currentTarget.selectionStart);
          props.onEdit(index, text, event.currentTarget.value, (event.nativeEvent as InputEvent).inputType); }}
        onFocus={event => props.onSelection?.(index, event.currentTarget.selectionStart)}
        onSelect={event => props.onSelection?.(index, event.currentTarget.selectionStart)}
        onKeyDown={event => { if (!event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) props.onKeyDown(event.nativeEvent); }}
        onPaste={props.onPaste}
        onCompositionStart={() => { composition.current++; props.onCompositionChange?.(true); }}
        onCompositionEnd={event => {
          const active = composition.current;
          const control = event.currentTarget;
          requestAnimationFrame(() => {
            if (active && composition.current === active) {
              composition.current = 0; latest.current.onCompositionChange?.(false);
              if (control.isConnected) latest.current.onSelection?.(index, control.selectionStart);
            }
          });
        }} />
    </ReactFragment>)}</>;
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
    'data-pm-slice', 'data-mention', 'data-composer-attrs', 'data-system-hint-type', 'data-system-hint-label']);
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
      : element.localName === 'pre' ? composerSchema.nodes.code_block?.spec : element.localName === 'a' ? composerSchema.marks.link?.spec : null;
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
    if (!editor || !document || !editor.state.doc.eq(document)
      || (label !== openedLink.label || safe !== openedLink.href) && !replaceLink(editor, openedLink, label, safe)) {
      setLinkError(t('This link changed. Open it again before saving.')); return;
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
        for (const element of parsed.querySelectorAll('[data-mention="rich-link"][data-composer-attrs], a[data-composer-attrs]')) {
          try {
            const attrs: unknown = JSON.parse(element.getAttribute('data-composer-attrs') ?? 'null');
            if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) continue;
            const copied = { ...attrs } as Record<string, unknown>;
            for (const key of ['literalMarkdownSource', 'literalMarkdownOccurrenceId', 'markdownSourceStart', 'markdownSourceEnd', 'isLoading', 'loadingDisplayText']) delete copied[key];
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
          editor.dispatch(editor.state.tr.addMark(from, to, type.create({ href: safe })));
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
