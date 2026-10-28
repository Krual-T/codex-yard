import { Fragment as ReactFragment, forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Bold, Code2, Italic, Link as LinkIcon, X } from 'lucide-react';
import { toggleMark } from 'prosemirror-commands';
import { Fragment, Slice } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { ClipboardEvent } from 'react';
import type { ComposerDocument } from '../workbench-contract.ts';
import { useI18n } from '../i18n/index.tsx';
import { composerSchema, readRichDocument } from './rich-document.ts';
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
  const [openedLink, setOpenedLink] = useState<{ element: HTMLElement; href: string; label: string } | null>(null);
  const closeRichLink = (focus = true) => {
    if (!openedLink) return;
    openedLink.element.setAttribute('aria-expanded', 'false');
    if (focus && openedLink.element.isConnected) openedLink.element.focus();
    setOpenedLink(null);
  };
  const openRichLink = (target: EventTarget | null): boolean => {
    const element = target instanceof Element ? target.closest<HTMLElement>('[data-mention="rich-link"][role="button"]') : null;
    if (!element || !host.current?.contains(element)) return false;
    if (openedLink?.element === element) { closeRichLink(); return true; }
    try {
      const attrs: unknown = JSON.parse(element.getAttribute('data-composer-attrs') ?? 'null');
      if (!attrs || typeof attrs !== 'object' || !('href' in attrs) || typeof attrs.href !== 'string'
        || !('displayText' in attrs) || typeof attrs.displayText !== 'string') return false;
      openedLink?.element.setAttribute('aria-expanded', 'false');
      element.setAttribute('aria-expanded', 'true');
      setOpenedLink({ element, href: attrs.href, label: attrs.displayText });
      return true;
    } catch { return false; }
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
        for (const element of parsed.querySelectorAll('[data-mention="rich-link"][data-composer-attrs]')) {
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
    if (openedLink && !openedLink.element.isConnected) setOpenedLink(null);
    else openedLink?.element.setAttribute('aria-expanded', 'true');
    return () => { openedLink?.element.setAttribute('aria-expanded', 'false'); };
  }, [props.document, openedLink]);

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
    if (editor && type && !props.readOnly) { syncRichSelection(editor); toggleMark(type)(editor.state, editor.dispatch, editor); editor.focus(); }
  };
  return <>
    {(!props.plainTextMode || linkOpen) && <div className="standalone-composer__rich-toolbar" role="toolbar" aria-label={t('Text formatting')}>
      {!props.plainTextMode && <>
        <button type="button" title={t('Bold')} aria-label={t('Bold')} disabled={props.readOnly} onMouseDown={event => event.preventDefault()} onClick={() => mark('strong')}><Bold size={16} /></button>
        <button type="button" title={t('Italic')} aria-label={t('Italic')} disabled={props.readOnly} onMouseDown={event => event.preventDefault()} onClick={() => mark('em')}><Italic size={16} /></button>
        <button type="button" title={t('Inline code')} aria-label={t('Inline code')} disabled={props.readOnly} onMouseDown={event => event.preventDefault()} onClick={() => mark('code')}><Code2 size={16} /></button>
      </>}
      <button type="button" title={t('Link')} aria-label={t('Link')} disabled={props.readOnly} onMouseDown={event => { event.preventDefault(); if (view.current) syncRichSelection(view.current); }} onClick={() => {
        props.onPendingLinkChange?.(!linkOpen); setLinkOpen(!linkOpen);
      }}><LinkIcon size={16} /></button>
      {linkOpen ? <form onSubmit={event => {
        event.preventDefault();
        const editor = view.current, type = composerSchema.marks.link;
        if (editor && type && !props.readOnly && href.trim() && !editor.state.selection.empty) {
          const { from, to } = editor.state.selection;
          editor.dispatch(editor.state.tr.addMark(from, to, type.create({ href: href.trim() })));
          props.onPendingLinkChange?.(false); setLinkOpen(false); setHref(''); editor.focus();
        }
      }}><input aria-label={t('Link address')} value={href} disabled={props.readOnly} onChange={event => setHref(event.target.value)} /><button type="submit" disabled={props.readOnly}>{t('Apply')}</button></form> : null}
    </div>}
    <div ref={host} className="standalone-composer__rich" onClickCapture={event => {
      if (openRichLink(event.target)) { event.preventDefault(); event.stopPropagation(); }
    }} onKeyDownCapture={event => {
      if ((event.key === 'Enter' || event.key === ' ') && openRichLink(event.target)) { event.preventDefault(); event.stopPropagation(); }
    }} />
    {openedLink ? <div role="dialog" aria-label={t('Link')}>
      <span>{openedLink.label}</span>{' '}{/^https?:\/\//i.test(openedLink.href)
        ? <a href={openedLink.href} target="_blank" rel="noopener noreferrer">{openedLink.href}</a> : <span>{openedLink.href}</span>}
      <button type="button" title={t('Close')} aria-label={t('Close')} onClick={() => closeRichLink()}><X size={16} /></button>
    </div> : null}
  </>;
});
