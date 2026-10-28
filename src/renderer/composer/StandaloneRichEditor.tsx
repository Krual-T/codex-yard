import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Bold, Code2, Italic, Link as LinkIcon } from 'lucide-react';
import { toggleMark } from 'prosemirror-commands';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { ComposerDocument } from '../workbench-contract.ts';
import { composerSchema, readRichDocument } from './rich-document.ts';
import { insertRichCompletion, richCompletionContext, richEditorPlugins } from './rich-editor-actions.ts';
import type { RichCompletionContext, RichCompletionQuery } from './rich-editor-actions.ts';
import type { Completion } from './standalone-completions.tsx';

export interface RichEditorHandle {
  focus(): void;
  insertCompletion(context: RichCompletionContext, query: RichCompletionQuery, item: Completion, cwd: string): boolean;
}
interface RichEditorProps {
  document: ComposerDocument;
  onChange(document: ComposerDocument): void;
  onKeyDown(event: KeyboardEvent): boolean;
  onImages(files: File[]): void;
  onInvalid(message?: string): void;
  onCompletionContext(context: RichCompletionContext | null): void;
  completionListId?: string;
  completionSelectedId?: string;
}

function supportedClipboardHTML(html: string): boolean {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const tags = new Set(['div', 'span', 'p', 'br', 'strong', 'b', 'em', 'i', 'code', 'pre', 'blockquote',
    'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a']);
  const attributes = new Set(['class', 'dir', 'href', 'title', 'start', 'contenteditable', 'spellcheck',
    'data-pm-slice', 'data-mention', 'data-composer-attrs']);
  if (document.querySelector('style, link, script')) return false;
  return Array.from(document.body.querySelectorAll('*')).every(element => {
    if (!tags.has(element.localName) || !Array.from(element.attributes).every(attribute => attributes.has(attribute.name))) return false;
    const mention = element.getAttribute('data-mention');
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
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const composing = useRef(false);
  const latest = useRef(props);
  latest.current = props;
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState('');
  useImperativeHandle(ref, () => ({
    focus: () => view.current?.focus(),
    insertCompletion: (context, query, item, cwd) => {
      const editor = view.current;
      return !!editor && !composing.current && insertRichCompletion(editor, context, query, item, cwd);
    },
  }), []);

  useLayoutEffect(() => {
    const doc = readRichDocument(latest.current.document);
    if (!host.current || !doc) return;
    const editor = new EditorView(host.current, {
      state: EditorState.create({ doc, plugins: richEditorPlugins() }),
      attributes: { role: 'textbox', 'aria-label': '和 Codex 一起工作', 'aria-multiline': 'true', 'aria-autocomplete': 'list' },
      handleDOMEvents: {
        keydown: (editor, event) => editor.composing || composing.current || event.isComposing || event.keyCode === 229,
        focus: editor => { latest.current.onCompletionContext(composing.current ? null : richCompletionContext(editor)); return false; },
        blur: () => { latest.current.onCompletionContext(null); return false; },
        compositionstart: () => { composing.current = true; latest.current.onCompletionContext(null); return false; },
        compositionend: editor => {
          requestAnimationFrame(() => {
            composing.current = false;
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
      handlePaste: (_editor, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter(file => file.type.startsWith('image/'));
        if (files.length && !event.clipboardData?.getData('text/plain')) {
          latest.current.onImages(files);
          return true;
        }
        if (files.length) { latest.current.onInvalid('无法同时粘贴文字和图片，请分别输入文本并添加图片。'); return true; }
        const html = event.clipboardData?.getData('text/html');
        if (html && !supportedClipboardHTML(html)) { latest.current.onInvalid(); return true; }
        return false;
      },
    });
    view.current = editor;
    return () => { view.current = null; editor.destroy(); };
  }, []);

  useEffect(() => {
    const editor = view.current, doc = readRichDocument(props.document);
    if (!editor || !doc || editor.state.doc.eq(doc)) return;
    editor.updateState(EditorState.create({ doc, plugins: editor.state.plugins }));
  }, [props.document]);

  useEffect(() => {
    view.current?.setProps({ attributes: {
      role: 'textbox', 'aria-label': '和 Codex 一起工作', 'aria-multiline': 'true', 'aria-autocomplete': 'list',
      ...(props.completionListId ? { 'aria-controls': props.completionListId } : {}),
      ...(props.completionSelectedId ? { 'aria-activedescendant': props.completionSelectedId } : {}),
    } });
  }, [props.completionListId, props.completionSelectedId]);

  const mark = (name: 'strong' | 'em' | 'code') => {
    const editor = view.current, type = composerSchema.marks[name];
    if (editor && type) { toggleMark(type)(editor.state, editor.dispatch, editor); editor.focus(); }
  };
  return <>
    <div className="standalone-composer__rich-toolbar" role="toolbar" aria-label="文本格式">
      <button type="button" title="粗体" aria-label="粗体" onMouseDown={event => event.preventDefault()} onClick={() => mark('strong')}><Bold size={16} /></button>
      <button type="button" title="斜体" aria-label="斜体" onMouseDown={event => event.preventDefault()} onClick={() => mark('em')}><Italic size={16} /></button>
      <button type="button" title="行内代码" aria-label="行内代码" onMouseDown={event => event.preventDefault()} onClick={() => mark('code')}><Code2 size={16} /></button>
      <button type="button" title="链接" aria-label="链接" onMouseDown={event => event.preventDefault()} onClick={() => setLinkOpen(open => !open)}><LinkIcon size={16} /></button>
      {linkOpen ? <form onSubmit={event => {
        event.preventDefault();
        const editor = view.current, type = composerSchema.marks.link;
        if (editor && type && href.trim() && !editor.state.selection.empty) {
          const { from, to } = editor.state.selection;
          editor.dispatch(editor.state.tr.addMark(from, to, type.create({ href: href.trim() })));
          setLinkOpen(false); setHref(''); editor.focus();
        }
      }}><input aria-label="链接地址" value={href} onChange={event => setHref(event.target.value)} /><button type="submit">应用</button></form> : null}
    </div>
    <div ref={host} className="standalone-composer__rich" />
  </>;
});
