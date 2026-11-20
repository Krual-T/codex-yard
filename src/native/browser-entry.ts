import type { ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import * as StartupReact from 'react';
import { createRoot as createStartupRoot } from 'react-dom/client';
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
import { installMobileInput } from './mobile-input.ts';
import { installAutomationRecovery } from './browser-automation-recovery.ts';
import { installPortForwarding } from './port-forwarding-view.tsx';
import { installFilePreviews } from './file-preview-view.tsx';
import { installNewTab } from './new-tab-view.tsx';
import { installBrowserNotifications } from './notification-view.tsx';
import { installConversationHistory } from './conversation-history.ts';
import { installTurnProgress } from './turn-progress.ts';
import { installModelProviders } from './model-provider-view.tsx';
import { mountStartupSidebar } from './startup-sidebar-view.tsx';
import type { StartupSidebarBridge } from './startup-sidebar-view.tsx';
import { PersistedStateStartup } from './persisted-state-startup.ts';
import { installSidebarMotion } from './sidebar-motion.ts';
import { installSidechatThreads } from './sidechat-thread-view.ts';

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
  sot(): {
    warning(title: string, options: {
      id: string; description: string; duration: number;
      primaryAction: { label: string; onClick(): void };
    }): void;
  };
}
interface RendererApplication {
  fwr(route: { pathname: string; search: string; routeTemplate: string }): unknown;
  gwr(route: unknown): string | null;
  jPr(): StatsigStartupCore & { Storage: { _setProvider(provider: StatsigStorageProvider): void } };
  rDr(): { StatsigClient: StatsigStartupConstructor };
  Ag(): void | Promise<void>; // Registers routes, lifecycle, theme and startup measurements.
  jg(): Promise<ReactNode>; // Waits for host services and returns the React tree.
}

performance.mark('workbench-entry');
installConversationHistory();
const transferComposerFocus = installMobileInput();
installSidebarMotion();
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
if (!isMiniWindow) {
  const persistedStateStartup = new PersistedStateStartup();
  Object.assign(window, { workbenchPersistedStateStartup: persistedStateStartup });
  window.addEventListener('pagehide', () => persistedStateStartup.dispose(), { once: true });
  const startupBridge = (window as Window & { workbenchStartupSidebar?: StartupSidebarBridge }).workbenchStartupSidebar;
  // This independent root needs only React and recent metadata. Keep its
  // dispatcher separate from the original application's component tree.
  if (startupBridge) await mountStartupSidebar(StartupReact, { createRoot: createStartupRoot }, startupBridge, transferComposerFocus);
}
const workspaceStyles = Promise.all([...document.querySelectorAll<HTMLLinkElement>('link[data-yard-workspace-style]')].map(link =>
  new Promise<void>((resolve, reject) => {
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => reject(new Error('工作区样式加载失败')), { once: true });
    link.rel = 'stylesheet';
    if (link.sheet) resolve();
  })));
void workspaceStyles.catch(() => {});
const [client, runtime] = await Promise.all([
  import(assets.client) as Promise<{ n(): void; t(): void }>,
  import(assets.shared) as Promise<RendererRuntime>,
]);
client.n();
client.t();
runtime.fPt();
runtime.uPt();
// A tab left open across an update can still request a removed lazy chunk.
// Keep the draft on screen and let the user choose when to reload.
window.addEventListener('vite:preloadError', () => {
  runtime.sot().warning('页面组件加载失败', {
    id: 'yard-component-load-error',
    description: '刷新页面后重试。',
    duration: 0,
    primaryAction: { label: '刷新页面', onClick: () => window.location.reload() },
  });
});
await import(assets.rpc);
performance.mark('workbench-rpc-ready');
// Start the local snapshot download while the application initializes. Parse
// it only when the SDK requests it; its existing profile checks still apply.
const configurationResponse = fetch('/api/configuration/bootstrap');
// The SDK consumes this rejection later, after synchronous initialization.
void configurationResponse.catch(() => {});
const application = await runtime.lPt(() => import(assets.application) as Promise<RendererApplication>,
  [assets.applicationStyle], import.meta.url);
performance.mark('workbench-application-imported');
application.jPr().Storage._setProvider(await configurationStorage);
installStatsigStartup(application.rDr().StatsigClient, application.jPr(), async () => {
  const response = await configurationResponse;
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Local configuration snapshot returned HTTP ${response.status}`);
  return await response.json() as StatsigConfigurationSnapshot;
});
installAutomationRecovery(runtime.gzt());
installTurnProgress(runtime.gzt());
installModelProviders(runtime.gzt());
installFilePreviews(runtime.gzt());
installNewTab(runtime.gzt());
installSidechatThreads(runtime.gzt());
const react = runtime.hMt();
installBrowserNotifications(runtime.gzt());
if (!isMiniWindow) {
  installPortForwarding(runtime.gzt(), react);
}
await application.Ag();
performance.mark('workbench-application-initialized');
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
performance.mark('workbench-renderer-services-ready');
const container = document.getElementById('root');
if (!container) throw new Error('Root container not found');
const rendererWindow = window as Window & { __codexRoot?: Root; electronBridge?: { sendMessageFromView(message: HostMessage): Promise<void> } };
const root = rendererWindow.__codexRoot ??= react.createRoot(container);
const tree = await application.jg();
await workspaceStyles;
performance.mark('workbench-initial-tree-ready');
root.render(tree);
const bridge = rendererWindow.electronBridge;
if (!bridge) throw new Error('Browser host bridge not found');
if (!isMiniWindow) mountBrowserPet(runtime.gzt(), react, message => bridge.sendMessageFromView(message));
performance.mark('workbench-render-requested');
