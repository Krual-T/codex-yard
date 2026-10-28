/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import type * as ReactRuntime from 'react';
import type { Root } from 'react-dom/client';
import type { BrowserChrome, ChromeWindow } from './browser-bridge.ts';
import type { BrowserTarget, ChromePanelState, ChromeRequest } from './protocol.ts';
import { clientChromePackagePath } from './client-protocol.ts';
import type { ChromeConnections, ConnectionRequest } from './client-protocol.ts';

interface ManagedWebview {
  webview: HTMLElement | null;
  disposed: boolean;
  getConversationId(): string;
  getBrowserTabId(): string;
  getMountGeneration(): number;
  dispose(): void;
}
interface Presentation { isVisible: boolean; shouldPaint?: boolean; shouldBootstrap?: boolean; mountGeneration?: number }
export interface BrowserPages {
  getWebview(conversationId: string, browserTabId: string, initialUrl: string, options?: unknown): ManagedWebview;
  syncElectronWebview(host: ManagedWebview, state: Presentation, ref: unknown, kind?: string): void;
  detachElectronWebview(host: ManagedWebview, ref: unknown, kind?: string, generation?: number): void;
}
export interface BrowserRenderer { NWt(): void; MWt: { pages: BrowserPages } }

export interface ChromeSurfaceProps {
  target: BrowserTarget;
  bridge: BrowserChrome;
  visible: boolean;
  onQuote?(target: BrowserTarget, pageId: number): Promise<string>;
}

export function createChromeSurface(React: typeof ReactRuntime) {
return function ChromeSurface({ target, bridge, visible, onQuote }: ChromeSurfaceProps) {
  const [state, setState] = React.useState<ChromePanelState>();
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [referenceStatus, setReferenceStatus] = React.useState('');
  const [refresh, setRefresh] = React.useState(false);
  const [connections, setConnections] = React.useState<ChromeConnections>();
  const [connection, setConnection] = React.useState(() => bridge.connectionFor(target));
  const [pairing, setPairing] = React.useState<ChromeConnections['pairing']>();
  const [connectionError, setConnectionError] = React.useState('');
  const [connecting, setConnecting] = React.useState(false);
  const inFlight = React.useRef(0);
  const composing = React.useRef(false);
  const action = React.useCallback(async (operation: ChromeRequest['operation'], value: Partial<ChromeRequest> = {}) => {
    if (inFlight.current && ['state', 'capture'].includes(operation)) return false;
    inFlight.current++; setBusy(true);
    try { await bridge.request({ ...value, ...target, operation }); return true; }
    catch { return false; }
    finally { inFlight.current--; setBusy(inFlight.current > 0); }
  }, [bridge, target]);
  React.useEffect(() => bridge.subscribe(target, next => {
    setState(previous => next.error && !next.location ? { ...previous, ...next, location: previous?.location ?? '', pages: previous?.pages ?? [], pageId: previous?.pageId, frame: undefined } : next);
  }), [bridge, target]);
  React.useEffect(() => { if (visible && !bridge.getState(target)) void action('state'); }, [visible, action, bridge, target]);
  React.useEffect(() => {
    if (!visible) return;
    let active = true;
    const load = async () => {
      try {
        const next = await bridge.connections();
        if (active) { setConnections(next); setConnectionError(''); if (next.client.connected) setPairing(undefined); }
      } catch (error) { if (active) setConnectionError((error as Error).message); }
    };
    void load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [bridge, visible]);
  React.useEffect(() => {
    if (visible && connections && connection === 'client') void action('state');
  }, [action, visible, connection, connections?.client.connected]);
  React.useEffect(() => {
    if (!visible || !refresh || !state?.pageId || state.error) return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void action('capture'); }, 2500);
    return () => clearInterval(timer);
  }, [action, visible, refresh, state?.pageId, state?.error]);
  const frame = state?.frame;
  const pairCommand = pairing && pairing.expiresAt > Date.now()
    ? `npx --yes --package '${window.location.origin}${clientChromePackagePath}' codex-yard-chrome --connect '${window.location.origin}' --pair '${pairing.token}'` : '';
  const manageConnection = async (operation: ConnectionRequest['operation']) => {
    setConnecting(true); setConnectionError('');
    try {
      const next = await bridge.connections(operation);
      setConnections(next); setPairing(next.pairing);
      if (operation === 'disconnect') await action('state');
    } catch (error) { setConnectionError((error as Error).message); }
    finally { setConnecting(false); }
  };
  const sendText = async () => { if (text && await action('text', { pageId: state?.pageId, text })) setText(''); };
  // The original renderer's character-input routing excludes this boundary;
  // otherwise typing on a focusable image redirects to the chat composer.
  return <section aria-label="Chrome 网页画面" data-workbench-chrome data-codex-character-input-boundary style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--color-surface, #fff)', color: 'var(--color-text, #222)', font: '12px system-ui' }}>
    <div style={{ display: 'flex', gap: 8, padding: 8, alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid #8884' }}>
      <label>浏览器所在电脑 <select aria-label="浏览器所在电脑" value={connection} disabled={busy || connecting}
        onChange={event => {
          const next = event.target.value as 'client' | 'server';
          setConnection(next); setText(''); setReferenceStatus(''); setBusy(true);
          void bridge.selectConnection(target, next).catch(() => {}).finally(() => setBusy(false));
        }}>
        <option value="client">当前访问电脑{connections?.client.label ? ` · ${connections.client.label}` : ''}</option>
        <option value="server" disabled={!connections?.server.configured}>工作台电脑{connections?.server.label ? ` · ${connections.server.label}` : ''}{connections && !connections.server.configured ? '（未配置）' : ''}</option>
      </select></label>
      {connection === 'client' ? <>
        <span role="status">{connections?.client.connected ? '已配对' : '未连接'}</span>
        <button disabled={connecting || busy} onClick={() => { void manageConnection(connections?.client.connected ? 'disconnect' : 'pair'); }}>
          {connections?.client.connected ? '断开这台电脑' : '连接这台电脑'}
        </button>
      </> : null}
    </div>
    {connectionError ? <p role="alert" style={{ margin: 8 }}>{connectionError}</p> : null}
    {connection === 'client' && pairing ? <div style={{ padding: 8, borderBottom: '1px solid #8884' }}>
      <ol style={{ margin: '0 0 8px', paddingLeft: 20 }}>
        <li>在这台电脑的 Chrome 打开 <code>chrome://inspect/#remote-debugging</code>，开启远程调试。</li>
        <li>在这台电脑的终端运行下方命令（需 Node.js 22.12+），保留终端运行。</li>
        <li>回到面板，选择标签；Chrome 询问连接时点击允许。</li>
      </ol>
      {pairCommand ? <>
        <textarea aria-label="这台电脑的配对命令" value={pairCommand} readOnly rows={4} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace' }} onFocus={event => event.target.select()} />
        <button onClick={() => { void navigator.clipboard.writeText(pairCommand).catch(() => setConnectionError('请选中并复制上方命令')); }}>复制配对命令</button>
        <span> 5 分钟内有效，仅配对当前工作台页面所属的浏览器。</span>
      </> : <p role="status">配对命令已过期，点击“连接这台电脑”重新生成。</p>}
    </div> : null}
    <div style={{ display: 'flex', gap: 8, padding: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span>{state?.location || 'Chrome'}</span>
      <select aria-label="已有 Chrome 标签" value={state?.pageId ?? ''} disabled={busy} style={{ minWidth: 80, maxWidth: '100%', flex: 1 }}
        onChange={event => { setReferenceStatus(''); if (event.target.value) void action('select', { pageId: Number(event.target.value) }); }}>
        <option value="">选择已有标签</option>
        {state?.pages.map(page => <option key={page.id} value={page.id}>{page.id} · {page.url}</option>)}
      </select>
      <button disabled={busy} onClick={() => { void action('state'); }}>刷新</button>
      <button disabled={busy || state?.pageId == null} title="在真实 Chrome 标签按 Ctrl+Shift+C（Mac：⌘+Shift+C）选择元素，再回到这里引用"
        onClick={() => {
          if (state?.pageId == null || inFlight.current) return;
          inFlight.current++; setBusy(true); setReferenceStatus('');
          void (onQuote ? onQuote(target, state.pageId) : bridge.quoteSelectedElement(target, state.pageId)).then(title => setReferenceStatus(`已添加到输入框：${title}`),
            error => setReferenceStatus((error as Error).message)).finally(() => { inFlight.current--; setBusy(inFlight.current > 0); });
        }}>引用所选元素</button>
      <label><input type="checkbox" checked={refresh} onChange={event => setRefresh(event.target.checked)} />自动刷新</label>
    </div>
    <p style={{ margin: '0 8px 6px' }}>在真实 Chrome 按 Ctrl+Shift+C（Mac：⌘+Shift+C）选择元素，再回到这里引用；请保持开发者工具打开。</p>
    {referenceStatus ? <p role="status" style={{ margin: '0 8px 6px' }}>{referenceStatus}</p> : null}
    <div role="status" style={{ padding: '0 8px 6px' }}>{busy ? '正在读取 Chrome…' : state?.error || (frame ? '点击画面后可键入；中文可在下方输入。' : '选择 Chrome 已有标签，或在上方地址栏打开网页。')}</div>
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      {frame ? <img src={frame.image} alt="Chrome 标签的最新画面" tabIndex={0} draggable={false}
        style={{ display: 'block', width: '100%', height: 'auto', cursor: busy ? 'wait' : 'default' }}
        onClick={event => {
          event.currentTarget.focus();
          const rect = event.currentTarget.getBoundingClientRect();
          void action('click', { pageId: frame.pageId, x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height });
        }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') return;
          event.preventDefault(); event.stopPropagation();
          if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1) void action('text', { pageId: frame.pageId, text: event.key });
          else void action('key', { pageId: frame.pageId, key: [event.ctrlKey && 'Control', event.metaKey && 'Meta', event.altKey && 'Alt', event.shiftKey && 'Shift', event.key].filter(Boolean).join('+') });
        }} onPaste={event => { event.preventDefault(); void action('text', { pageId: frame.pageId, text: event.clipboardData.getData('text/plain') }); }} /> : null}
    </div>
    <form style={{ display: 'flex', padding: 8, gap: 8 }} onSubmit={event => { event.preventDefault(); if (!composing.current) void sendText(); }}>
      <input aria-label="向网页输入" placeholder="点击网页输入框后，在此输入中文" value={text} disabled={!state?.pageId}
        style={{ flex: 1, minWidth: 0, border: '1px solid #aaa', borderRadius: 4, padding: 6 }}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={event => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || composing.current)) event.preventDefault(); }}
        onChange={event => setText(event.target.value)} />
      <button disabled={busy || !text || !state?.pageId}>输入</button>
    </form>
  </section>;
};
}

/** Keep the original pages manager, native host object, presentation transitions,
 * tabs and address bar. Only replace the inert Web <webview>'s pixel surface. */
export function installChromeWebviews(react: typeof ReactRuntime, dom: { createRoot(element: Element): Root }, application: BrowserRenderer) {
  const React = react;
  const ChromeSurface = createChromeSurface(react);
  application.NWt();
  const pages = application.MWt.pages;
  const bridge = (window as ChromeWindow).workbenchChrome;
  if (!bridge) throw new Error('Chrome Web 宿主未初始化');
  const mounted = new WeakMap<ManagedWebview, { render(visible: boolean): void; visible: boolean; generation: number }>();
  const getWebview = pages.getWebview.bind(pages);
  pages.getWebview = (...args) => {
    const host = getWebview(...args);
    if (!mounted.has(host) && host.webview) {
      const target = { conversationId: host.getConversationId(), browserTabId: host.getBrowserTabId() };
      host.webview.style.display = 'block';
      const root = dom.createRoot(host.webview);
      const view = { visible: false, generation: -1, render(visible: boolean) {
        queueMicrotask(() => { if (!host.disposed) root.render(<ChromeSurface target={target} bridge={bridge} visible={visible} />); });
      } };
      mounted.set(host, view); view.render(false);
      const dispose = host.dispose.bind(host);
      host.dispose = () => {
        if (!host.disposed) {
          queueMicrotask(() => root.unmount());
          void bridge.request({ ...target, operation: 'release' }).catch(() => {});
        }
        dispose();
      };
    }
    return host;
  };
  const sync = pages.syncElectronWebview.bind(pages);
  pages.syncElectronWebview = (host, state, ref, kind) => {
    sync(host, state, ref, kind);
    const view = mounted.get(host);
    if (!view) return;
    const visible = state.isVisible && state.shouldPaint !== false && !state.shouldBootstrap;
    if (view.visible !== visible) { view.visible = visible; view.render(visible); }
    const generation = state.mountGeneration ?? host.getMountGeneration();
    if (visible && generation !== view.generation) {
      view.generation = generation;
      queueMicrotask(() => { if (!host.disposed) bridge.attached({ conversationId: host.getConversationId(), browserTabId: host.getBrowserTabId() }, generation); });
    }
  };
  const detach = pages.detachElectronWebview.bind(pages);
  pages.detachElectronWebview = (host, ref, kind, generation) => {
    detach(host, ref, kind, generation);
    const view = mounted.get(host);
    if (view && (generation == null || generation === host.getMountGeneration())) { view.visible = false; view.render(false); }
  };
}
