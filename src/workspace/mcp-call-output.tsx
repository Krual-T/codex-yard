import { CodeXml, LoaderCircle, X } from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';
import type { ThreadItemSummary } from '../../lib/codex-protocol.ts';
import { record } from '../native/protocol.ts';
import { MessageCopy } from './message-copy.tsx';

function rawResult(item: ThreadItemSummary) {
  const raw = item.result;
  const result = record(raw);
  if (item.error != null) return { type: 'error', kind: 'protocol', error: record(item.error).message,
    rawError: item.error, raw: raw ?? undefined };
  if (raw == null) return null;
  const content = Array.isArray(result.content) ? result.content : [];
  if (item.status === 'failed') {
    const error = content.map(record).flatMap(part => part.type === 'text' && typeof part.text === 'string' ? [part.text] : []).join('\n');
    return { type: 'error', kind: 'tool', error: error || JSON.stringify(result.structuredContent ?? content), raw };
  }
  return { type: 'success', content, structuredContent: result.structuredContent, raw };
}

function JsonCode({ text }: { text: string }) {
  if (text.length > 64_000) return <code>{text}</code>;
  const body: ReactNode[] = [];
  let offset = 0;
  // The input is JSON.stringify output; quoted property names are followed by ':'.
  for (const match of text.matchAll(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g)) {
    const index = match.index, value = match[0];
    body.push(text.slice(offset, index));
    offset = index + value.length;
    const kind = value[0] === '"' ? (text[offset] === ':' ? 'property' : 'string') : /^[\d-]/.test(value) ? 'number' : 'literal';
    body.push(<span key={index} data-json-token={kind}>{value}</span>);
  }
  body.push(text.slice(offset));
  return <code>{body}</code>;
}

export function McpRawOutput({ item }: { item: ThreadItemSummary }) {
  const modal = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [rawOpen, setRawOpen] = useState(false);
  const callName = [item.server, item.tool].filter(value => typeof value === 'string' && value).join('.');
  const raw = rawOpen ? JSON.stringify({ callId: item.id, invocation: { server: item.server, tool: item.tool, arguments: item.arguments },
    durationMs: item.durationMs, result: rawResult(item) }, null, 2) : '';
  return <>
    <button className="yard-source-mcp-raw" type="button" title="Show raw tool call output"
      aria-label="Show raw tool call output" aria-haspopup="dialog" onClick={() => { setRawOpen(true); modal.current?.showModal(); }}>
      <CodeXml size={14} aria-hidden="true" /></button>
    <dialog className="yard-source-mcp-dialog" ref={modal} aria-labelledby={title} onClose={() => setRawOpen(false)}
      onClick={event => { if (event.target === event.currentTarget) modal.current?.close(); }}>
      <div>
        <header><h2 id={title}>Raw {callName ? callName + ' ' : ''}tool call output</h2>
          <button type="button" aria-label="Close dialog" title="Close" onClick={() => modal.current?.close()}><X size={12} aria-hidden="true" /></button>
        </header>
        {rawOpen && <figure className="yard-source-mcp-json">
          <figcaption><CodeXml size={14} aria-hidden="true" /><span>json</span><MessageCopy label="Copy code" text={raw} /></figcaption>
          <pre dir="ltr" tabIndex={0}><JsonCode text={raw} /></pre>
        </figure>}
      </div>
    </dialog>
  </>;
}

export function McpCallOutput({ item, preferStructured = false }: { item: ThreadItemSummary; preferStructured?: boolean }) {
  const result = record(item.result), error = record(item.error);
  const content = Array.isArray(result.content) ? result.content.map(record) : [];
  const structured = result.structuredContent != null;
  const structuredText = structured ? JSON.stringify(result.structuredContent, null, 2) : '';
  const structuredInline = structured ? JSON.stringify(result.structuredContent) : '';
  const textBlocks = structured && preferStructured ? [] : content.filter(part => part.type === 'text' && typeof part.text === 'string' &&
    (!structured || part.text !== structuredText && part.text !== structuredInline));
  const images = content.filter(part => part.type === 'image' && typeof part.data === 'string' &&
    typeof part.mimeType === 'string' && /^image\/(png|jpeg|gif|webp)$/.test(part.mimeType));
  const running = item.status === 'inProgress';
  const progress = typeof item.activityProgress === 'string' ? item.activityProgress : '';
  const failed = typeof error.message === 'string' ? error.message : item.status === 'failed' ? 'Tool call failed' : '';
  return <div className="yard-source-mcp-output" data-status={item.status}>
    {running && <div className="yard-source-mcp-progress" role="status"><LoaderCircle size={14} aria-hidden="true" />
      <span>{progress || 'Running tool'}</span></div>}
    {failed && <p role="alert">{failed}</p>}
    {structured && <figure className="yard-source-mcp-json"><figcaption><CodeXml size={14} aria-hidden="true" /> json</figcaption>
      <pre><JsonCode text={structuredText} /></pre></figure>}
    {textBlocks.map((part, index) =>
      <figure className="yard-source-mcp-text" key={index}><figcaption>plaintext</figcaption><pre>{String(part.text)}</pre></figure>)}
    {images.map((part, index) => <img key={index} alt="Tool output" src={'data:' + part.mimeType + ';base64,' + part.data} />)}
    {(item.result != null || item.error != null || item.arguments != null || !running) && <McpRawOutput item={item} />}
  </div>;
}
