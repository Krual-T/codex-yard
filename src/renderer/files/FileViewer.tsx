import { useEffect, useMemo, useState } from 'react';
import { base64Bytes } from './file-service.ts';
import type { FileContents } from './file-service.ts';
import { CodeEditor } from './CodeEditor.tsx';
import { PdfViewer } from './PdfViewer.tsx';

interface Props {
  path: string;
  content: FileContents;
  text: string;
  theme: 'light' | 'dark';
  visible: boolean;
  findRequest?: number;
  onFindRequestConsumed?(id: number): void;
  location?: { line: number; column?: number; id: number };
  readOnly: boolean;
  onChange(text: string): void;
  onSave(): void;
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
  return content.kind === 'text' ? <CodeEditor {...props} /> : <BinaryViewer path={props.path} content={content} />;
}
