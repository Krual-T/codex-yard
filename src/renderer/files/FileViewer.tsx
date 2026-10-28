import { useEffect, useMemo, useState } from 'react';
import { Code2, Copy, Eye, WrapText } from 'lucide-react';
import { writeClipboardText } from '../../native/browser-clipboard.ts';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { StandaloneMarkdown } from '../markdown/StandaloneMarkdown.tsx';
import { base64Bytes } from './file-service.ts';
import { errorMessage } from './file-service.ts';
import { panelError, usePanelText } from '../panels/panel-i18n.ts';
import type { PanelText } from '../panels/panel-i18n.ts';
import type { FileContents } from './file-service.ts';
import { CodeEditor } from './CodeEditor.tsx';
import { PdfViewer } from './PdfViewer.tsx';

interface Props {
  client: WorkbenchClient;
  hostId: string;
  cwd: string;
  threadId?: string;
  onOpenFile?(path: string, line?: number, column?: number): void;
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

function hexPreview(bytes: Uint8Array, t: PanelText): string {
  const lines: string[] = [];
  for (let offset = 0; offset < Math.min(bytes.length, 65536); offset += 16) {
    const row = bytes.subarray(offset, offset + 16);
    const hex = Array.from(row, byte => byte.toString(16).padStart(2, '0')).join(' ').padEnd(47);
    const chars = Array.from(row, byte => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.').join('');
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex}  ${chars}`);
  }
  if (bytes.length > 65536) lines.push(`\n${t('First {shown} of {total} bytes shown.', { shown: 65536, total: bytes.length })}`);
  return lines.join('\n');
}

function BinaryViewer({ path, content }: { path: string; content: Extract<FileContents, { kind: 'binary' }> }) {
  const t = usePanelText();
  const bytes = useMemo(() => base64Bytes(content.base64), [content.base64]);
  const media = /^(?:image|audio|video)\//.test(content.mimeType);
  const [url, setUrl] = useState<string>();
  const [mediaError, setMediaError] = useState(false);
  useEffect(() => {
    setMediaError(false);
    if (!media) { setUrl(undefined); return; }
    const next = URL.createObjectURL(new Blob([bytes], { type: content.mimeType }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [bytes, content.mimeType, media]);
  if (content.mimeType === 'application/pdf') return <PdfViewer bytes={bytes} />;
  if (!media) return <pre className="yard-file-hex" aria-label={t('Binary: {path}', {path})}>{hexPreview(bytes, t)}</pre>;
  if (!url) return <div className="yard-file-status">{t('Loading preview...')}</div>;
  if (mediaError) return <div className="yard-file-status" role="alert">{t('Media preview failed. Download the file to open it.')}</div>;
  if (content.mimeType.startsWith('image/')) return <div className="yard-file-media"><img src={url} alt={path} onError={() => setMediaError(true)} /></div>;
  if (content.mimeType.startsWith('audio/')) return <div className="yard-file-media"><audio controls src={url} aria-label={t('Audio: {path}', {path})} onError={() => setMediaError(true)} /></div>;
  if (content.mimeType.startsWith('video/')) return <div className="yard-file-media"><video controls src={url} aria-label={t('Video: {path}', {path})} onError={() => setMediaError(true)} /></div>;
  return null;
}

export function FileViewer({ content, ...props }: Props) {
  const t = usePanelText();
  const [preview, setPreview] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [copyError, setCopyError] = useState<string>();
  const markdown = /\.(?:md|markdown|mdown|mkd)$/i.test(props.path);
  useEffect(() => {
    if (props.findRequest !== undefined || props.location) setPreview(false);
  }, [props.findRequest, props.location?.id]);
  if (content.kind !== 'text') return <BinaryViewer path={props.path} content={content} />;
  const directory = props.path.slice(0, props.path.lastIndexOf('/')) || props.cwd;
  return <div className="yard-text-file">
    <div className="yard-file-options">
      {markdown ? <button type="button" className="yard-panel-icon" title={t(preview ? 'View source' : 'View preview')}
        aria-label={t(preview ? 'View source' : 'View preview')} onClick={() => setPreview(value => !value)}>
        {preview ? <Code2 /> : <Eye />}</button> : null}
      <button type="button" className="yard-panel-icon" title={t(wrap ? 'Disable word wrap' : 'Enable word wrap')}
        aria-label={t(wrap ? 'Disable word wrap' : 'Enable word wrap')} aria-pressed={wrap} onClick={() => setWrap(value => !value)}><WrapText /></button>
      <button type="button" className="yard-panel-icon" title={t('Copy file contents')} aria-label={t('Copy file contents')}
        onClick={() => void writeClipboardText(props.text).then(() => setCopyError(undefined), error => setCopyError(errorMessage(error)))}><Copy /></button>
    </div>
    {copyError ? <div className="yard-file-error" role="alert">{panelError(t, copyError)}</div> : null}
    <div className="yard-file-source" hidden={preview}>
      <CodeEditor {...props} wrap={wrap} visible={props.visible && !preview} />
    </div>
    {preview && props.visible ? <div className="yard-markdown-preview">
      <StandaloneMarkdown text={props.text} client={props.client} hostId={props.hostId} threadId={props.threadId}
        cwd={directory} onOpenFileAt={props.onOpenFile ? location => props.onOpenFile?.(location.path, location.line, location.column) : undefined} />
    </div> : null}
  </div>;
}
