import type { ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import { openStatsigStorage } from './statsig-storage.ts';
import type { StatsigStorageProvider } from './statsig-storage.ts';
import { installStatsigStartup } from './statsig-startup.ts';
import type { StatsigStartupConstructor, StatsigStartupCore, StatsigConfigurationSnapshot } from './statsig-startup.ts';
import { rendererAssets as assets } from './renderer-assets.ts';
import { mountBrowserPet } from './browser-pet.ts';
import { isMiniWindow } from './mini-host.ts';
import type { HostMessage } from './protocol.ts';
import { installChromeWebviews } from '../browser-reuse/webview.tsx';
import type { BrowserRenderer } from '../browser-reuse/webview.tsx';
import type { ChromeElementComment } from '../browser-reuse/protocol.ts';
import type { ChromeWindow } from '../browser-reuse/browser-bridge.ts';

// This is the version boundary for the React modules that have not yet moved to
// TypeScript. Use their React runtime so the existing tree keeps one dispatcher.
interface RendererRuntime {
  fPt(): void; // Shared runtime initialization.
  uPt(): void; // Renderer environment initialization.
  gzt(): typeof import('react'); // The original React dispatcher.
  hMt(): { createRoot(container: Element): Root };
  vMt(): void; // State runtime initialization.
  yPt(): void; // Renderer services initialization.
  lPt<T>(load: () => Promise<T>, dependencies: string[], from: string): Promise<T>;
  jmt(): void; // Original browser comment conversion initialization.
  Amt(comment: ChromeElementComment, line: number): unknown;
}
interface RendererApplication {
  fwr(route: { pathname: string; search: string; routeTemplate: string }): unknown;
  gwr(route: unknown): string | null;
  jPr(): StatsigStartupCore & { Storage: { _setProvider(provider: StatsigStorageProvider): void } };
  rDr(): { StatsigClient: StatsigStartupConstructor };
  Ag(): void; // Registers routes, lifecycle, theme and startup measurements.
  jg(): Promise<ReactNode>; // Waits for host services and returns the React tree.
}

performance.mark('workbench-entry');
// Sidebar row drags capture touch pointers before native scrolling can start.
// Keep touch taps (click) and the rows' actual buttons, while leaving mouse and
// keyboard drag behavior with the original renderer.
document.addEventListener('pointerdown', event => {
  if (event.pointerType !== 'touch' || !(event.target instanceof Element)) return;
  const target = event.target;
  if (target.closest('button, a, input, textarea, select, [contenteditable="true"]')) return;
  if (target.closest('#app-shell-sidebar [data-app-action-sidebar-thread-row], #app-shell-sidebar [class~="group/folder-row"]')) {
    event.stopPropagation();
  }
}, { capture: true });
const configurationStorage = openStatsigStorage();
const [client, runtime] = await Promise.all([
  import(assets.client) as Promise<{ n(): void; t(): void }>,
  import(assets.shared) as Promise<RendererRuntime>,
]);
client.n();
client.t();
runtime.fPt();
runtime.uPt();
await import(assets.rpc);
performance.mark('workbench-rpc-ready');
const application = await runtime.lPt(() => import(assets.application) as Promise<RendererApplication>,
  [assets.applicationStyle], import.meta.url);
application.jPr().Storage._setProvider(await configurationStorage);
installStatsigStartup(application.rDr().StatsigClient, application.jPr(), async () => {
  const response = await fetch('/api/configuration/bootstrap');
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Local configuration snapshot returned HTTP ${response.status}`);
  return await response.json() as StatsigConfigurationSnapshot;
});
runtime.gzt();
const react = runtime.hMt();
application.Ag();
runtime.jmt();
// External Chrome references are detached from native overlays. Omitting the
// browserTabId lets the original composer edit/remove the saved reference.
(window as ChromeWindow).workbenchChrome?.setCommentConverter((comment, line) => runtime.Amt(comment, line));
(window as ChromeWindow).workbenchChrome?.setCommentRouteResolver(ownerRoute => {
  const url = new URL(ownerRoute, window.location.origin);
  return application.gwr(application.fwr({ pathname: url.pathname, search: url.search, routeTemplate: url.pathname }));
});
installChromeWebviews(runtime.gzt(), react, application as RendererApplication & BrowserRenderer);
runtime.yPt();
runtime.vMt();
const container = document.getElementById('root');
if (!container) throw new Error('Root container not found');
const rendererWindow = window as Window & { __codexRoot?: Root; electronBridge?: { sendMessageFromView(message: HostMessage): Promise<void> } };
const root = rendererWindow.__codexRoot ??= react.createRoot(container);
root.render(await application.jg());
const bridge = rendererWindow.electronBridge;
if (!bridge) throw new Error('Browser host bridge not found');
if (!isMiniWindow) mountBrowserPet(runtime.gzt(), react, message => bridge.sendMessageFromView(message));
performance.mark('workbench-render-requested');
