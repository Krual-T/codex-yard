/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import type * as ReactRuntime from 'react';
import type { Root } from 'react-dom/client';
import type { BrowserChrome, ChromeWindow } from './browser-bridge.ts';
import type { BrowserTarget } from './protocol.ts';

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
let React: typeof ReactRuntime;

function BrowserSurface({ target, bridge, initialUrl }: { target: BrowserTarget; bridge: BrowserChrome; initialUrl: string }) {
  const subscribe = React.useCallback((listener: () => void) => bridge.subscribePage(target, listener), [bridge, target]);
  const snapshot = React.useCallback(() => bridge.embeddedPage(target, initialUrl), [bridge, target, initialUrl]);
  const page = React.useSyncExternalStore(subscribe, snapshot);
  return <section aria-label="浏览器页面" data-codex-character-input-boundary style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
    {page.error ? <div role="alert" style={{ padding: 16 }}><p>{page.error}</p><button onClick={() => bridge.retryEmbeddedPage(target)}>重试</button></div>
      : page.loading ? <p role="status" style={{ padding: 16 }}>正在连接预览…</p> : <iframe key={page.revision} src={page.src ?? page.url} title="网页内容"
      sandbox="allow-scripts allow-forms allow-same-origin allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads allow-storage-access-by-user-activation"
      referrerPolicy="strict-origin-when-cross-origin" allowFullScreen
      style={{ border: 0, flex: 1, minHeight: 0, width: '100%', background: '#fff' }} />}
  </section>;
}

/** Keep the original page lifecycle, tabs and address bar. Websites render on
 * the visiting device. */
export function installChromeWebviews(react: typeof ReactRuntime, dom: { createRoot(element: Element): Root }, application: BrowserRenderer) {
  React = react;
  application.NWt();
  const pages = application.MWt.pages;
  const bridge = (window as ChromeWindow).workbenchChrome;
  if (!bridge) throw new Error('Chrome Web 宿主未初始化');
  bridge.enableEmbeddedPages();
  const mounted = new WeakMap<ManagedWebview, { render(visible: boolean): void; visible: boolean; generation: number }>();
  const getWebview = pages.getWebview.bind(pages);
  pages.getWebview = (...args) => {
    const host = getWebview(...args);
    if (!mounted.has(host) && host.webview) {
      const target = { conversationId: host.getConversationId(), browserTabId: host.getBrowserTabId() };
      host.webview.style.display = 'block';
      const root = dom.createRoot(host.webview);
      const view = { visible: false, generation: -1, render(visible: boolean) {
        queueMicrotask(() => { if (!host.disposed) root.render(<BrowserSurface target={target} bridge={bridge} initialUrl={args[2]} />); });
      } };
      mounted.set(host, view); view.render(false);
      const dispose = host.dispose.bind(host);
      host.dispose = () => {
        if (!host.disposed) {
          queueMicrotask(() => root.unmount());
          bridge.releaseView(target);
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
