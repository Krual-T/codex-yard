import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { ComposerDraft, WorkbenchClient } from '../workbench-contract.ts';

export interface StandaloneVisualizationProps {
  client: WorkbenchClient;
  hostId: string;
  threadId: string;
  path: string;
  onPrefill(draft: ComposerDraft): void;
  onClose(): void;
  theme?: 'light' | 'dark';
  initialWidgetState?: unknown;
  onWidgetStateChange?(state: unknown): void | Promise<void>;
}

type Value = Record<string, unknown>;
type Download = { blob: Blob; name: string };
const object = (value: unknown): Value => value != null && typeof value === 'object' && !Array.isArray(value) ? value as Value : {};
const buttonStyle: CSSProperties = { border: '1px solid #b8c0c7', borderRadius: 4, padding: '6px 9px', background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit' };
const filename = (value: string) => value.split(/[\\/]/).at(-1)?.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 180) || 'visualization';

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename(name);
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** A host-scoped preview. Authored HTML receives only the limited visualization port. */
export function StandaloneVisualization(props: StandaloneVisualizationProps) {
  const { client, hostId, threadId, path, theme = 'light' } = props;
  const frameRef = useRef<HTMLIFrameElement>(null);
  const portRef = useRef<MessagePort | null>(null);
  const propsRef = useRef(props);
  useLayoutEffect(() => { propsRef.current = props; });
  const sourceRef = useRef<{ path: string; contents: string } | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [height, setHeight] = useState(320);
  const [expanded, setExpanded] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const [excerpt, setExcerpt] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [pendingDownload, setPendingDownload] = useState<Download | null>(null);
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let active = true;
    let port: MessagePort | null = null;
    let timer: number | undefined;
    let accepted = false;
    const requests = new Set<number>();
    const initId = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    const frameUrl = new URL('/', window.location.origin);
    frameUrl.searchParams.set('app', 'skybridge');
    frameUrl.searchParams.set('yard_viz_init', initId);
    setStatus('loading'); setError(''); setHeight(320); setExpanded(false);
    setAnnotating(false); setExcerpt(null); setComment(''); setPendingDownload(null); setPendingLink(null);
    sourceRef.current = null;
    const currentIdentity = () => active && propsRef.current.client === client && propsRef.current.hostId === hostId &&
      propsRef.current.threadId === threadId && propsRef.current.path === path;

    function fail(message: string) {
      if (!currentIdentity()) return;
      active = false;
      setError(message);
      setStatus('error');
      window.removeEventListener('message', onMessage);
      if (timer !== undefined) clearTimeout(timer);
      port?.close();
      if (portRef.current === port) portRef.current = null;
    }
    async function handleRequest(message: Value) {
      if (!currentIdentity() || typeof message.id !== 'number' || !Number.isSafeInteger(message.id) || message.id < 1 || requests.has(message.id) || requests.size >= 32) return;
      const id = message.id;
      requests.add(id);
      const input = object(message.payload);
      try {
        let value: unknown;
        if (message.method === 'follow-up') {
          if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 20_000) throw new Error('Invalid follow-up');
          propsRef.current.onPrefill({ text: input.prompt, images: [], files: [] });
        } else if (message.method === 'display-mode') {
          if (input.mode !== 'inline' && input.mode !== 'fullscreen') throw new Error('Invalid display mode');
          setExpanded(input.mode === 'fullscreen');
          port?.postMessage({ type: 'display-mode', mode: input.mode });
          value = { mode: input.mode };
        } else if (message.method === 'download') {
          if (!(input.blob instanceof Blob) || input.blob.size > 10_000_000 || typeof input.name !== 'string') throw new Error('Invalid download');
          setPendingDownload({ blob: input.blob, name: filename(input.name) });
          value = { queued: true };
        } else if (message.method === 'open-external') {
          if (typeof input.href !== 'string' || input.href.length > 4_096) throw new Error('Invalid link');
          const url = new URL(input.href);
          if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Invalid link');
          setPendingLink(url.href);
          value = { queued: true };
        } else if (message.method === 'widget-state') {
          const serialized = JSON.stringify(message.payload);
          if (serialized === undefined || serialized.length > 100_000) throw new Error('Invalid widget state');
          const update = propsRef.current.onWidgetStateChange;
          if (!update) throw new Error('Widget state persistence is unavailable');
          await update(JSON.parse(serialized) as unknown);
        } else throw new Error('Visualization operation is not available');
        if (currentIdentity()) port?.postMessage({ type: 'response', id, ok: true, value });
      } catch (reason) {
        if (currentIdentity()) port?.postMessage({ type: 'response', id, ok: false, error: reason instanceof Error ? reason.message : 'Visualization operation failed' });
      } finally { requests.delete(id); }
    }
    function onMessage(event: MessageEvent) {
      const message = object(event.data);
      if (!currentIdentity() || accepted || event.source !== frame?.contentWindow || event.origin !== 'null' || message.type !== 'yard-visualization:init' || message.initId !== initId || event.ports.length !== 1 || frame.src !== frameUrl.href) return;
      accepted = true;
      window.removeEventListener('message', onMessage);
      port = event.ports[0];
      portRef.current = port;
      port.onmessage = event => {
        if (!currentIdentity()) return;
        const value = object(event.data);
        if (value.type === 'ready') {
          if (timer !== undefined) clearTimeout(timer);
          setStatus('ready');
        } else if (value.type === 'height' && typeof value.height === 'number' && Number.isFinite(value.height)) {
          setHeight(Math.max(120, Math.min(10_000, Math.ceil(value.height))));
        } else if (value.type === 'error') {
          setError(typeof value.message === 'string' ? value.message.slice(0, 1000) : 'Visualization error');
        } else if (value.type === 'annotation-target') {
          setAnnotating(false);
          setExcerpt(typeof value.excerpt === 'string' ? value.excerpt.slice(0, 500) : '');
        } else if (value.type === 'leaving') fail('Visualization frame navigated away');
        else if (value.type === 'request') void handleRequest(value);
      };
      port.start();
      port.postMessage({ type: 'render', html: sourceRef.current?.contents, theme: propsRef.current.theme ?? 'light', widgetState: propsRef.current.initialWidgetState });
    }
    void client.host<{ path: string; contents: string }>('visualization-read', { hostId, threadId, path }).then(result => {
      if (!currentIdentity()) return;
      if (typeof result?.path !== 'string' || typeof result.contents !== 'string') throw new Error('Invalid visualization response');
      sourceRef.current = result;
      window.addEventListener('message', onMessage);
      timer = window.setTimeout(() => fail('Visualization did not become ready'), 15_000);
      frame.src = frameUrl.href;
    }).catch(reason => fail(reason instanceof Error ? reason.message : 'Could not read visualization'));
    return () => {
      active = false;
      window.removeEventListener('message', onMessage);
      if (timer !== undefined) clearTimeout(timer);
      try { port?.postMessage({ type: 'dispose' }); } catch { /* already closed */ }
      port?.close();
      if (portRef.current === port) portRef.current = null;
      frame.src = 'about:blank';
    };
  }, [client, hostId, threadId, path, attempt]);

  useEffect(() => { portRef.current?.postMessage({ type: 'theme', theme }); }, [theme]);
  function changeMode(next: boolean) {
    setExpanded(next);
    portRef.current?.postMessage({ type: 'display-mode', mode: next ? 'fullscreen' : 'inline' });
  }
  function startAnnotation() {
    const next = !annotating;
    setAnnotating(next);
    setExcerpt(null);
    portRef.current?.postMessage({ type: 'annotate', enabled: next });
  }
  function prefillAnnotation() {
    if (!comment.trim() || excerpt === null) return;
    propsRef.current.onPrefill({ text: `Visualization: ${sourceRef.current?.path ?? path}\nSelection: ${excerpt}\nFeedback: ${comment.trim()}`, images: [], files: [] });
    setExcerpt(null); setComment('');
  }

  return <section aria-label="Visualization" style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'auto', color: theme === 'dark' ? '#f2f4f4' : '#1c252a', background: theme === 'dark' ? '#20272a' : '#fff', ...(expanded ? { position: 'fixed', inset: 12, zIndex: 1000, boxShadow: '0 8px 32px #0005' } : {}) }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', padding: 8, borderBottom: '1px solid #9ca9ad' }}>
      <strong style={{ flex: '1 1 120px', overflowWrap: 'anywhere' }}>{filename(sourceRef.current?.path ?? path)}</strong>
      <button style={buttonStyle} disabled={status !== 'ready'} onClick={startAnnotation}>{annotating ? 'Cancel annotation' : 'Annotate'}</button>
      <button style={buttonStyle} disabled={!sourceRef.current} onClick={() => { if (sourceRef.current) download(new Blob([sourceRef.current.contents], { type: 'text/html' }), filename(sourceRef.current.path)); }}>Download HTML</button>
      <button style={buttonStyle} disabled={status !== 'ready'} onClick={() => changeMode(!expanded)}>{expanded ? 'Exit expanded view' : 'Expand'}</button>
      <button style={buttonStyle} onClick={props.onClose}>Close</button>
    </div>
    {status === 'loading' && <div role="status" style={{ padding: 8 }}>Loading visualization...</div>}
    {error && <div role="alert" style={{ padding: 8, color: theme === 'dark' ? '#ffd5c9' : '#9f2418' }}>{error}{status === 'error' && <> <button style={buttonStyle} onClick={() => setAttempt(value => value + 1)}>Retry</button></>}</div>}
    {annotating && <div role="status" style={{ padding: 8 }}>Select an element in the visualization.</div>}
    {excerpt !== null && <div style={{ display: 'grid', gap: 6, padding: 8, borderBottom: '1px solid #9ca9ad' }}>
      <div style={{ overflowWrap: 'anywhere' }}>{excerpt || 'Selected element'}</div>
      <label>Feedback <textarea aria-label="Annotation feedback" value={comment} onChange={event => setComment(event.target.value)} style={{ display: 'block', width: '100%', boxSizing: 'border-box', minHeight: 64, font: 'inherit' }} /></label>
      <div><button style={buttonStyle} disabled={!comment.trim()} onClick={prefillAnnotation}>Add to draft</button> <button style={buttonStyle} onClick={() => { setExcerpt(null); setComment(''); }}>Cancel</button></div>
    </div>}
    {pendingDownload && <div style={{ padding: 8 }}>Download {pendingDownload.name}? <button style={buttonStyle} onClick={() => { download(pendingDownload.blob, pendingDownload.name); setPendingDownload(null); }}>Download file</button> <button style={buttonStyle} onClick={() => setPendingDownload(null)}>Dismiss download</button></div>}
    {pendingLink && <div style={{ padding: 8, overflowWrap: 'anywhere' }}>Open {pendingLink}? <a href={pendingLink} target="_blank" rel="noopener noreferrer" onClick={() => setPendingLink(null)}>Open link</a> <button style={buttonStyle} onClick={() => setPendingLink(null)}>Dismiss link</button></div>}
    <iframe ref={frameRef} title="Visualization content" sandbox="allow-scripts" referrerPolicy="no-referrer" style={{ display: status === 'error' ? 'none' : 'block', border: 0, width: '100%', height: expanded ? '100%' : height, minHeight: expanded ? 160 : undefined, flex: expanded ? '1 1 auto' : undefined, background: 'transparent' }} />
  </section>;
}
