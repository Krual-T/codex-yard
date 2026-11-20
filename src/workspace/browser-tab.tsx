import { ArrowLeft, ArrowRight, ExternalLink, RotateCw } from 'lucide-react';
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { BrowserChrome } from '../browser-reuse/browser-bridge.ts';
import type { BrowserTarget, ChromeRequest } from '../browser-reuse/protocol.ts';

export function newTabAddress(value: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^(about|javascript|data|blob|mailto):/i.test(value)) return value;
  if (/\s/.test(value)) return null;
  if (/^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(value)) return 'http://' + value;
  if (/^(?:\[[^\]]+\]|[^/]+:\d+|www\.[^/]+|[^/:]+\.(?:com|net|org|edu|gov|io|ai|dev|app|cn|co|me|uk))(?::\d+)?(?:[/?#]|$)/i.test(value)) return 'https://' + value;
  return null;
}

export function parseBrowserAddress(value: string): URL | undefined {
  try {
    const url = new URL(value);
    if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password &&
        (url.origin !== location.origin || url.pathname === '/api/local-html-preview')) return url;
  } catch { /* Invalid address */ }
}

export interface WorkspaceBrowserView {
  bridge: BrowserChrome;
  target: BrowserTarget;
}

function usePage(view: WorkspaceBrowserView) {
  const { bridge, target } = view;
  const subscribe = useCallback((listener: () => void) => bridge.subscribePage(target, listener), [bridge, target]);
  const read = useCallback(() => bridge.embeddedPage(target), [bridge, target]);
  return useSyncExternalStore(subscribe, read);
}

export function BrowserTabTitle({ view }: { view: WorkspaceBrowserView }) {
  const page = usePage(view);
  return new URL(page.url).hostname || 'New tab';
}

export function BrowserTab({ view, children }: { view: WorkspaceBrowserView; children: ReactNode }) {
  const { bridge, target } = view;
  const page = usePage(view);
  const [address, setAddress] = useState<{ value: string; base: typeof page }>();
  const [error, setError] = useState(false);
  useEffect(() => () => bridge.releaseView(target), [bridge, target]);

  function command(command: NonNullable<ChromeRequest['command']>) {
    setError(false); setAddress(undefined);
    bridge.commandEmbeddedPage(target, command);
  }
  if (page.url === 'about:blank') return children;
  const displayAddress = page.url.replace(/^http:\/\/(?=localhost[:/]|127\.|\[::1\])/i, '');
  const source = page.src ?? page.url;
  const sameOrigin = new URL(source).origin === location.origin;

  return <div className="yard-source-browser" data-codex-character-input-boundary>
    <form className="yard-source-browser-navigation" aria-label="Navigation" role="group" onSubmit={event => {
      event.preventDefault();
      const value = (address?.base === page ? address.value : page.url).trim();
      if (value === 'about:blank') { command({ type: 'navigate', url: value }); return; }
      const url = parseBrowserAddress(newTabAddress(value) ?? value);
      if (url) command({ type: 'navigate', url: url.href });
      else setError(true);
    }}>
      <button type="button" aria-label="Back" title="Back" disabled={page.index === 0} onClick={() => command({ type: 'go-back' })}><ArrowLeft size={16} /></button>
      <button type="button" aria-label="Next" title="Next" disabled={page.index === page.history.length - 1} onClick={() => command({ type: 'go-forward' })}><ArrowRight size={16} /></button>
      <button type="button" aria-label="Reload page" title="Reload page" onClick={() => command({ type: 'reload' })}><RotateCw size={14} /></button>
      <input type="text" aria-label="Search or enter a URL" value={address?.base === page ? address.value : displayAddress} autoComplete="off" spellCheck={false}
        inputMode="url" onChange={event => { setError(false); setAddress({ value: event.target.value, base: page }); }} />
      <a href={page.url} target="_blank" rel="noopener noreferrer" title="Open in external browser" aria-label="Open in external browser"><ExternalLink size={14} /></a>
    </form>
    {(error || page.error) && <p role="alert">{page.error ?? '请输入其他站点的不含账号密码的 HTTP 或 HTTPS 网址'}</p>}
    <section className="yard-source-browser-page" aria-label="浏览器页面">
      {page.loading ? <p role="status">正在连接预览…</p> : !page.error &&
        <iframe key={page.revision} src={source} title="网页内容"
          sandbox={'allow-scripts allow-forms allow-modals allow-downloads' + (sameOrigin ? '' : ' allow-same-origin allow-popups allow-popups-to-escape-sandbox')}
          referrerPolicy="strict-origin-when-cross-origin" />}
    </section>
  </div>;
}
