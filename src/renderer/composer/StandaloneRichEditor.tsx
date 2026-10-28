import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Bold, Code2, Italic, Link as LinkIcon } from 'lucide-react';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { ComposerDocument } from '../workbench-contract.ts';
import { composerSchema, readRichDocument } from './rich-document.ts';

export interface RichEditorHandle { focus(): void }
interface RichEditorProps {
  document: ComposerDocument;
  onChange(document: ComposerDocument): void;
  onKeyDown(event: KeyboardEvent): boolean;
  onImages(files: File[]): void;
  onInvalid(message?: string): void;
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
  const latest = useRef(props);
  latest.current = props;
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState('');
  useImperativeHandle(ref, () => ({ focus: () => view.current?.focus() }), []);

  useLayoutEffect(() => {
    const doc = readRichDocument(latest.current.document);
    if (!host.current || !doc) return;
    const editor = new EditorView(host.current, {
      state: EditorState.create({ doc, plugins: [history(), keymap({ 'Mod-z': undo, 'Mod-Shift-z': redo, 'Mod-y': redo,
        'Shift-Enter': (state, dispatch) => {
          const br = state.schema.nodes.hard_break;
          if (!br || state.selection.$from.parent.type.spec.code) return false;
          if (dispatch) dispatch(state.tr.replaceSelectionWith(br.create()).scrollIntoView());
          return true;
        } }), keymap(baseKeymap)] }),
      attributes: { role: 'textbox', 'aria-label': '和 Codex 一起工作', 'aria-multiline': 'true' },
      handleDOMEvents: { keydown: (editor, event) => editor.composing || event.isComposing || event.keyCode === 229 },
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
      },
      handleKeyDown: (editor, event) => editor.composing || event.isComposing || event.keyCode === 229 ? false : latest.current.onKeyDown(event),
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
