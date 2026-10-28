import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { base64Bytes } from './file-service.ts';
import type { FileContents, TextEdit } from './file-service.ts';
import { PdfViewer } from './PdfViewer.tsx';

interface Location { line: number; column?: number; id: number }
interface Props {
  path: string;
  content: FileContents;
  text: string;
  lineHeight: number;
  findRequest?: number;
  onFindRequestConsumed?(id: number): void;
  location?: Location;
  readOnly: boolean;
  onChange(text: string, edit?: TextEdit): void;
  onSave(): void;
}

function lineOffset(text: string, requestedLine: number, requestedColumn: number): { offset: number; line: number } {
  const line = Math.max(1, Math.floor(requestedLine) || 1);
  let offset = 0, actual = 1;
  while (actual < line) {
    const next = text.indexOf('\n', offset);
    if (next < 0) break;
    offset = next + 1;
    actual++;
  }
  const end = text.indexOf('\n', offset);
  const column = Math.max(1, Math.floor(requestedColumn) || 1);
  return { offset: Math.min(offset + column - 1, end < 0 ? text.length : end), line: actual };
}

function TextViewer({ path, text, lineHeight, findRequest, onFindRequestConsumed, location, readOnly, onChange, onSave }: Omit<Props, 'content'>) {
  const editor = useRef<HTMLTextAreaElement>(null);
  const edit = useRef<TextEdit | undefined>(undefined);
  const search = useRef<HTMLInputElement>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [currentMatch, setCurrentMatch] = useState(0);
  const [viewport, setViewport] = useState({ top: 0, height: 400 });
  const count = useMemo(() => {
    let count = 1;
    for (let index = 0; index < text.length; index++) if (text[index] === '\n') count++;
    return count;
  }, [text]);
  const first = Math.max(0, Math.floor(viewport.top / lineHeight) - 5);
  const last = Math.min(count, first + Math.ceil(viewport.height / lineHeight) + 11);
  const numbers = Array.from({ length: Math.max(0, last - first) }, (_, index) => first + index + 1).join('\n');
  const matches = useMemo(() => {
    if (!query) return [];
    const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
    const positions: number[] = [];
    for (const match of text.matchAll(pattern)) positions.push(match.index);
    return positions;
  }, [query, text]);
  function reveal(index: number) {
    const element = editor.current;
    const position = matches[index];
    if (!element || position === undefined) return;
    element.setSelectionRange(position, position + query.length);
    const line = text.slice(0, position).split('\n').length - 1;
    element.scrollTop = Math.max(0, line * lineHeight - element.clientHeight / 3);
    setViewport(previous => ({ ...previous, top: element.scrollTop }));
  }
  function move(delta: number) {
    if (!matches.length) return;
    const index = (currentMatch + delta + matches.length) % matches.length;
    setCurrentMatch(index);
    reveal(index);
  }
  useEffect(() => { if (findOpen) search.current?.focus(); }, [findOpen]);
  useEffect(() => {
    if (findRequest === undefined) return;
    setFindOpen(true); search.current?.focus(); onFindRequestConsumed?.(findRequest);
  }, [findRequest, onFindRequestConsumed]);
  useEffect(() => {
    setCurrentMatch(0);
    if (findOpen && document.activeElement !== editor.current) reveal(0);
    // A new query or edited text starts a new search; changing selection does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, text]);
  useEffect(() => {
    if (!editor.current) return;
    const element = editor.current;
    const beforeInput = (event: InputEvent) => {
      edit.current = { start: element.selectionStart, end: element.selectionEnd, inputType: event.inputType };
    };
    element.addEventListener('beforeinput', beforeInput);
    const resize = () => setViewport(previous => ({ ...previous, height: element.clientHeight }));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => { observer.disconnect(); element.removeEventListener('beforeinput', beforeInput); };
  }, []);
  useEffect(() => {
    if (!location || !editor.current) return;
    const target = lineOffset(text, location.line, location.column ?? 1);
    editor.current.focus();
    editor.current.setSelectionRange(target.offset, target.offset);
    editor.current.scrollTop = Math.max(0, (target.line - 1) * lineHeight - editor.current.clientHeight / 3);
    setViewport(previous => ({ ...previous, top: editor.current!.scrollTop }));
    // A new location id, rather than subsequent edits, initiates navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location?.id]);
  return <div className="yard-text-viewer" onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); setFindOpen(true); search.current?.focus(); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); onSave(); }
    else if (event.key === 'Escape' && findOpen) { event.preventDefault(); setFindOpen(false); editor.current?.focus(); }
  }}>
    <div className="yard-file-find">
      <button type="button" className="yard-panel-icon" title="Find in file" aria-label="Find in file" onClick={() => { setFindOpen(true); search.current?.focus(); }}><Search /></button>
      {findOpen ? <>
        <input ref={search} type="search" aria-label="Find in file" value={query} onChange={event => setQuery(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); move(event.shiftKey ? -1 : 1); } }} />
        <span role="status" aria-live="polite">{matches.length ? `${currentMatch + 1} / ${matches.length}` : '0 / 0'}</span>
        <button type="button" className="yard-panel-icon" title="Previous match" aria-label="Previous match" disabled={!matches.length} onClick={() => move(-1)}><ChevronUp /></button>
        <button type="button" className="yard-panel-icon" title="Next match" aria-label="Next match" disabled={!matches.length} onClick={() => move(1)}><ChevronDown /></button>
        <button type="button" className="yard-panel-icon" title="Close find" aria-label="Close find" onClick={() => { setFindOpen(false); editor.current?.focus(); }}><X /></button>
      </> : null}
    </div>
    <div className="yard-file-editor">
    <pre className="yard-file-gutter" aria-hidden="true" style={{ width: `${Math.max(3, String(count).length) + 2}ch` }}>
      <span style={{ top: 8 + first * lineHeight - viewport.top }}>{numbers}</span>
    </pre>
    <textarea ref={editor} className="yard-file-text" aria-label={`File: ${path}`} value={text} readOnly={readOnly} spellCheck={false} wrap="off"
      onChange={event => { onChange(event.target.value, edit.current); edit.current = undefined; }} onScroll={event => {
        const top = event.currentTarget.scrollTop;
        setViewport(previous => ({ ...previous, top }));
      }} />
    </div>
  </div>;
}

function hexPreview(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let offset = 0; offset < Math.min(bytes.length, 65536); offset += 16) {
    const row = bytes.subarray(offset, offset + 16);
    const hex = Array.from(row, byte => byte.toString(16).padStart(2, '0')).join(' ').padEnd(47);
    const chars = Array.from(row, byte => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.').join('');
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex}  ${chars}`);
  }
  if (bytes.length > 65536) lines.push(`\nFirst 65536 of ${bytes.length} bytes shown.`);
  return lines.join('\n');
}

function BinaryViewer({ path, content }: { path: string; content: Extract<FileContents, { kind: 'binary' }> }) {
  const bytes = useMemo(() => base64Bytes(content.base64), [content.base64]);
  const [url, setUrl] = useState<string>();
  const [mediaError, setMediaError] = useState(false);
  useEffect(() => {
    setMediaError(false);
    if (content.mimeType === 'application/pdf') { setUrl(undefined); return; }
    const next = URL.createObjectURL(new Blob([bytes], { type: content.mimeType }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [bytes, content.mimeType]);
  if (content.mimeType === 'application/pdf') return <PdfViewer bytes={bytes} />;
  if (!url) return <div className="yard-file-status">Loading preview...</div>;
  if (mediaError) return <div className="yard-file-status" role="alert">Media preview failed. Download the file to open it.</div>;
  if (content.mimeType.startsWith('image/')) return <div className="yard-file-media"><img src={url} alt={path} onError={() => setMediaError(true)} /></div>;
  if (content.mimeType.startsWith('audio/')) return <div className="yard-file-media"><audio controls src={url} aria-label={`Audio: ${path}`} onError={() => setMediaError(true)} /></div>;
  if (content.mimeType.startsWith('video/')) return <div className="yard-file-media"><video controls src={url} aria-label={`Video: ${path}`} onError={() => setMediaError(true)} /></div>;
  return <pre className="yard-file-hex" aria-label={`Binary: ${path}`}>{hexPreview(bytes)}</pre>;
}

export function FileViewer({ content, ...props }: Props) {
  return content.kind === 'text' ? <TextViewer {...props} /> : <BinaryViewer path={props.path} content={content} />;
}
