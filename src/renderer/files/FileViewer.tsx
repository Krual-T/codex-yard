import { useEffect, useMemo, useRef, useState } from 'react';
import { base64Bytes } from './file-service.ts';
import type { FileContents } from './file-service.ts';
import { PdfViewer } from './PdfViewer.tsx';

interface Location { line: number; column?: number; id: number }
interface Props {
  path: string;
  content: FileContents;
  text: string;
  location?: Location;
  onChange(text: string): void;
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

function TextViewer({ path, text, location, onChange, onSave }: Omit<Props, 'content'>) {
  const editor = useRef<HTMLTextAreaElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 400 });
  const count = useMemo(() => {
    let count = 1;
    for (let index = 0; index < text.length; index++) if (text[index] === '\n') count++;
    return count;
  }, [text]);
  const first = Math.max(0, Math.floor(viewport.top / 20) - 5);
  const last = Math.min(count, first + Math.ceil(viewport.height / 20) + 11);
  const numbers = Array.from({ length: Math.max(0, last - first) }, (_, index) => first + index + 1).join('\n');
  useEffect(() => {
    if (!editor.current) return;
    const element = editor.current;
    const resize = () => setViewport(previous => ({ ...previous, height: element.clientHeight }));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!location || !editor.current) return;
    const target = lineOffset(text, location.line, location.column ?? 1);
    editor.current.focus();
    editor.current.setSelectionRange(target.offset, target.offset);
    editor.current.scrollTop = Math.max(0, (target.line - 1) * 20 - editor.current.clientHeight / 3);
    setViewport(previous => ({ ...previous, top: editor.current!.scrollTop }));
    // A new location id, rather than subsequent edits, initiates navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location?.id]);
  return <div className="yard-file-editor">
    <pre className="yard-file-gutter" aria-hidden="true" style={{ width: `${Math.max(3, String(count).length) + 2}ch` }}>
      <span style={{ top: 8 + first * 20 - viewport.top }}>{numbers}</span>
    </pre>
    <textarea ref={editor} className="yard-file-text" aria-label={`File: ${path}`} value={text} spellCheck={false} wrap="off"
      onChange={event => onChange(event.target.value)} onScroll={event => {
        const top = event.currentTarget.scrollTop;
        setViewport(previous => ({ ...previous, top }));
      }}
      onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); onSave(); } }} />
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
  useEffect(() => {
    if (content.mimeType === 'application/pdf') { setUrl(undefined); return; }
    const next = URL.createObjectURL(new Blob([bytes], { type: content.mimeType }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [bytes, content.mimeType]);
  if (content.mimeType === 'application/pdf') return <PdfViewer bytes={bytes} />;
  if (!url) return <div className="yard-file-status">Loading preview...</div>;
  if (content.mimeType.startsWith('image/')) return <div className="yard-file-media"><img src={url} alt={path} /></div>;
  if (content.mimeType.startsWith('audio/')) return <div className="yard-file-media"><audio controls src={url} /></div>;
  if (content.mimeType.startsWith('video/')) return <div className="yard-file-media"><video controls src={url} /></div>;
  return <pre className="yard-file-hex" aria-label={`Binary: ${path}`}>{hexPreview(bytes)}</pre>;
}

export function FileViewer({ content, ...props }: Props) {
  return content.kind === 'text' ? <TextViewer {...props} /> : <BinaryViewer path={props.path} content={content} />;
}
