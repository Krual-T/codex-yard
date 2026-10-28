import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Bold, Code2, Italic, Link as LinkIcon } from 'lucide-react';
import { toggleMark } from 'prosemirror-commands';
import { Fragment, Slice } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { ComposerDocument } from '../workbench-contract.ts';
import { useI18n } from '../i18n/index.tsx';
import { composerSchema, readRichDocument } from './rich-document.ts';
import { insertRichCompletion, richCompletionContext, richEditorPlugins, syncRichSelection } from './rich-editor-actions.ts';
import type { RichCompletionContext, RichCompletionQuery } from './rich-editor-actions.ts';
import type { Completion } from './standalone-completions.tsx';

export interface RichEditorHandle {
  focus(): void;
  insertCompletion(context: RichCompletionContext, query: RichCompletionQuery, item: Completion, cwd: string): boolean;
}
interface RichEditorProps {
  document: ComposerDocument;
  currentDocument(): ComposerDocument | undefined;
  onChange(document: ComposerDocument): void;
  onKeyDown(event: KeyboardEvent): boolean;
  onImages(files: File[]): void;
  onInvalid(message?: string): void;
  onCompletionContext(context: RichCompletionContext | null): void;
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
  const attributes = new Set(['class', 'dir', 'href', 'title', 'start', 'contenteditable', 'spellcheck',
    'data-pm-slice', 'data-mention', 'data-composer-attrs']);
  if (document.querySelector('style, link, script')) return false;
  return Array.from(document.body.querySelectorAll('*')).every(element => {
    if (!tags.has(element.localName) || !Array.from(element.attributes).every(attribute => attributes.has(attribute.name))) return false;
    const mention = element.getAttribute('data-mention');
    if (mention !== null && !allowMentions) return false;
    if (mention !== null && (element.localName !== 'span' || mention !== 'file' && mention !== 'skill')) return false;
    if (!element.hasAttribute('data-composer-attrs')) return mention === null;
    const spec = mention === 'file' ? composerSchema.nodes.atMention?.spec : mention === 'skill' ? composerSchema.nodes.skillMention?.spec
      : element.localName === 'pre' ? composerSchema.nodes.code_block?.spec : element.localName === 'a' ? composerSchema.marks.link?.spec : null;
    if (!spec) return false;
    try {
      const value: unknown = JSON.parse(element.getAttribute('data-composer-attrs') ?? 'null');
      return !!value && typeof value === 'object' && !Array.isArray(value)
        && Object.keys(value).every(key => Object.hasOwn(spec.attrs ?? {}, key));
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
        compositionstart: () => { composing.current = true; latest.current.onCompletionContext(null); return false; },
        compositionend: editor => {
          requestAnimationFrame(() => {
            composing.current = false;
            applyMode.current?.();
            if (view.current === editor && editor.hasFocus()) latest.current.onCompletionContext(richCompletionContext(editor));
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
    });
    view.current = editor;
    let plain = !!latest.current.plainTextMode;
    applyMode.current = () => {
      const next = !!latest.current.plainTextMode;
      if (plain === next || composing.current || editor.composing || editor.isDestroyed) return;
      plain = next;
      editor.updateState(editor.state.reconfigure({ plugins: plain ? plugins.plain : plugins.rich }));
    };
    return () => { applyMode.current = null; view.current = null; editor.destroy(); };
  }, []);

  useLayoutEffect(() => { applyMode.current?.(); }, [props.plainTextMode]);

  useEffect(() => {
    if (props.currentDocument() !== props.document) return;
    const editor = view.current, doc = readRichDocument(props.document);
    if (!editor || !doc || editor.state.doc.eq(doc)) return;
    editor.updateState(EditorState.create({ doc, plugins: editor.state.plugins }));
  }, [props.document, props.currentDocument]);

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
    {!props.plainTextMode && <div className="standalone-composer__rich-toolbar" role="toolbar" aria-label={t('Text formatting')}>
      <button type="button" title={t('Bold')} aria-label={t('Bold')} disabled={props.readOnly} onMouseDown={event => event.preventDefault()} onClick={() => mark('strong')}><Bold size={16} /></button>
      <button type="button" title={t('Italic')} aria-label={t('Italic')} disabled={props.readOnly} onMouseDown={event => event.preventDefault()} onClick={() => mark('em')}><Italic size={16} /></button>
      <button type="button" title={t('Inline code')} aria-label={t('Inline code')} disabled={props.readOnly} onMouseDown={event => event.preventDefault()} onClick={() => mark('code')}><Code2 size={16} /></button>
      <button type="button" title={t('Link')} aria-label={t('Link')} disabled={props.readOnly} onMouseDown={event => { event.preventDefault(); if (view.current) syncRichSelection(view.current); }} onClick={() => setLinkOpen(open => !open)}><LinkIcon size={16} /></button>
      {linkOpen ? <form onSubmit={event => {
        event.preventDefault();
        const editor = view.current, type = composerSchema.marks.link;
        if (editor && type && !props.readOnly && href.trim() && !editor.state.selection.empty) {
          const { from, to } = editor.state.selection;
          editor.dispatch(editor.state.tr.addMark(from, to, type.create({ href: href.trim() })));
          setLinkOpen(false); setHref(''); editor.focus();
        }
      }}><input aria-label={t('Link address')} value={href} disabled={props.readOnly} onChange={event => setHref(event.target.value)} /><button type="submit" disabled={props.readOnly}>{t('Apply')}</button></form> : null}
    </div>}
    <div ref={host} className="standalone-composer__rich" />
  </>;
});
