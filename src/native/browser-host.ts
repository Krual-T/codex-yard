import { record, updatedAtom } from './protocol.ts';
import type { HostMessage, ObjectValue, SidebarBootstrap } from './protocol.ts';
import { BrowserHttpFetch } from './browser-http-fetch.ts';
import { BrowserFiles } from './browser-files.ts';
import { BrowserClipboard, writeClipboardText } from './browser-clipboard.ts';
import type { ClipboardImage } from './browser-clipboard.ts';
import { BrowserTerminal, registerTerminalShortcut, terminalRpcService } from './browser-terminal.ts';
import type { TerminalEvent, TerminalOperation } from './terminal-protocol.ts';
import { rendererAssets } from './renderer-assets.ts';
import { createMiniHost, isMiniWindow } from './mini-host.ts';
import { openClientBrowser } from './client-browser.ts';
import type { HttpRequest } from './http-fetch.ts';
import type { AssignmentRequest, MembershipRequest, ProjectAssignment, ProjectlessRequest, ProjectlessThreadUpdate, ThreadProjectOperation } from './thread-projects.ts';
import { BrowserChrome, chromeRpcService } from '../browser-reuse/browser-bridge.ts';
import { visualizationService } from './visualizations.ts';
import { HistoryStartup, initialWorkspaceRoute, parseWorkspaceThreadRoute, sourceWorkspaceRoute, usesPinnedToolRenderer } from './history-startup.ts';
import { readWorkspaceHistory } from './browser-workspace-rpc.ts';
import { BrowserThreadReadState } from './browser-thread-read-state.ts';
import { BrowserStateConvergence } from './browser-state-convergence.ts';
import { BrowserSidebarSections, sectionAtom, type ProjectSectionDestination } from './browser-sidebar-sections.ts';
import { BrowserSidebarOrders } from './browser-sidebar-orders.ts';
import { BrowserSidechatThreads } from './browser-sidechat-threads.ts';
import { projectService } from './browser-projects.ts';

const version = '26.1013.40934';
const sourceWorkspaceDocument = document.querySelector('meta[name="yard-source-workspace"]') !== null;
const pinnedToolDocument = document.querySelector('meta[name="yard-pinned-tool"]') !== null && !isMiniWindow;
const pinnedReturn = pinnedToolDocument ? new URLSearchParams(location.search).get('workspaceReturn') : null;
const initialRoute = sourceWorkspaceDocument ? sourceWorkspaceRoute(location) : initialWorkspaceRoute(
  document.querySelector<HTMLMetaElement>('meta[name="initial-route"]')?.content, location.search, location.pathname);
const historyStartup = new HistoryStartup(initialRoute, 15_000, !isMiniWindow);
window.addEventListener('yard-workspace-ready', () => historyStartup.workspaceReady(), { once: true });
window.addEventListener('yard-conversation-history-ready', () => {
  requestAnimationFrame(() => requestAnimationFrame(() => historyStartup.release()));
}, { once: true });
const startupInteraction = (event: Event) => historyStartup.interact(event.target instanceof Element &&
  event.target.closest('#app-shell-sidebar, [data-yard-startup-thread-row]') !== null);
window.addEventListener('pointerdown', startupInteraction, { capture: true });
window.addEventListener('keydown', startupInteraction, { capture: true });
window.addEventListener('wheel', startupInteraction, { capture: true, passive: true });
const pending = new Map<string, HostMessage>();
const connectedHosts = new Set<string>(['local']);
const nativeSidebarHosts = new Set<string>(['local']);
Object.assign(window, { workbenchSidebarSupportsHost: (hostId: string) => nativeSidebarHosts.has(hostId) });
let sidebarBootstrap: SidebarBootstrap | null = null;
const rpcKey = (hostId: unknown, id: unknown) => 'rpc:' + String(hostId ?? 'local') + ':' + String(id);
const workerKey = (workerId: unknown, id: unknown) => 'worker:' + String(workerId) + ':' + String(id);
const hostRequests = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
const threadReadState = new BrowserThreadReadState((hostId, params) => requestHost('thread-read-state', { hostId, ...params }));
Object.assign(window, { workbenchThreadReadState: threadReadState });
const stateConvergence = new BrowserStateConvergence(localStorage);
Object.assign(window, { workbenchStateConvergence: stateConvergence });
const sidebarSections = new BrowserSidebarSections(localStorage, params => requestHost('sidebar-sections', params), () => [...nativeSidebarHosts]);
const sidebarOrders = new BrowserSidebarOrders(localStorage, params => requestHost('sidebar-orders', params));
const sidechatThreads = new BrowserSidechatThreads();
Object.assign(window, { workbenchSidechatThreads: sidechatThreads });
const files = new BrowserFiles(requestHost);
Object.assign(window, { workbenchStageFiles: (selected: File[]) => files.stageFiles(selected) });
Object.assign(window, { workbenchUploadLocalFileAttachments: (hostId: string, attachments: ObjectValue[]) => requestHost('upload-local-file-attachments', { hostId, attachments }) });
const terminal = new BrowserTerminal((operation, args) => requestHost('terminal', { operation, args }));
const publish = (message: HostMessage) => {
  if (message.type === 'yard-model-providers-changed') {
    window.dispatchEvent(new CustomEvent('yard-model-providers-changed', { detail: { hostId: message.hostId } })); return;
  }
  mini.receive(message);
  if (message.type === 'terminal-event') { terminal.receive(message.event as TerminalEvent); return; }
  const request = message.type === 'fetch-response' && message.requestId ? hostRequests.get(message.requestId) : undefined;
  if (request) {
    hostRequests.delete(message.requestId!);
    if (message.responseType === 'error') request.reject(new Error(String(message.error)));
    else request.resolve(message.body);
  } else window.postMessage(message, location.origin);
};
const openConversationLink = (message: HostMessage) => {
  if (['open-in-browser', 'open-url'].includes(message.type) && typeof message.conversationId === 'string' && typeof message.hostId === 'string') chrome.setConversationHost(message.conversationId, message.hostId);
  return openClientBrowser(message, publish);
};
Object.assign(window, { workbenchOpenConversationLink: openConversationLink });
let lastSidebarRefresh = 0;
async function refreshSidebar() {
  if (Date.now() - lastSidebarRefresh < 1000) return;
  lastSidebarRefresh = Date.now();
  sidechatThreads.refresh();
  // The source workspace fetches its own bounded sidebar per host. It does
  // not consume the pinned renderer's persisted sections or order atoms.
  if (sourceWorkspaceDocument) return;
  try {
    await requestHost('sidebar-refresh', {});
    for (const [key, value] of Object.entries(await sidebarOrders.load())) publish({ type: 'persisted-atom-updated', key, value });
    publish({ type: 'persisted-atom-updated', key: sectionAtom, value: await sidebarSections.load() });
  } catch (error) { console.warn('侧栏后端状态刷新失败，重连后重试', error); }
}
const publishFocus = () => {
  const isFocused = document.visibilityState === 'visible' && document.hasFocus();
  publish({ type: 'electron-window-focus-changed', isFocused, occurredAtMs: Date.now() });
  if (isFocused && socket?.readyState === WebSocket.OPEN) void refreshSidebar();
};
window.addEventListener('focus', publishFocus);
window.addEventListener('blur', publishFocus);
document.addEventListener('visibilitychange', publishFocus);
registerTerminalShortcut(window, () => publish({ type: 'toggle-terminal' }));
const mini = createMiniHost(publish);
const chrome = new BrowserChrome(requestHost, publish);
Object.assign(window, { workbenchChrome: chrome });
Object.assign(window, { workbenchResolveAutomation: (id: string) => requestHost('automation-run-resolve', { id, confirmed: true }) });
Object.assign(window, { workbenchPortForwarding: (params: unknown) => requestHost('port-forwarding', params) });
Object.assign(window, { workbenchModelProviders: (params: unknown) => requestHost('model-providers', params) });
Object.assign(window, { workbenchComposerPermissions: (params: unknown) => requestHost('source-workspace-permissions', params) });
let socket: WebSocket;
let opened: Promise<void>;
let disposed = false;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let ownerRoute: string | null = null;
let pendingNotificationRoute: string | null = null;
function flushNotificationRoute() {
  if (ownerRoute == null || pendingNotificationRoute == null) return;
  const path = pendingNotificationRoute;
  pendingNotificationRoute = null;
  publish({ type: 'navigate-to-route', path });
}
if (!isMiniWindow && window.navigator && 'serviceWorker' in window.navigator) {
  window.navigator.serviceWorker.addEventListener('message', event => {
    const message = record(event.data);
    if (event.origin !== location.origin || message.type !== 'yard-notification-navigate' || typeof message.url !== 'string') return;
    let target: URL;
    try { target = new URL(message.url, location.origin); } catch { return; }
    if (target.origin !== location.origin || target.pathname !== '/') return;
    const path = target.searchParams.get('initialRoute') || '/';
    if (!path.startsWith('/') || new URL(path, location.origin).origin !== location.origin) return;
    pendingNotificationRoute = path;
    // The host loads before React; queue clicks until its first route is mounted.
    flushNotificationRoute();
    event.ports[0]?.postMessage(true);
  });
}
function currentOwnerRoute() {
  if (ownerRoute == null) return null;
  let route = ownerRoute;
  const bindings = record(record(JSON.parse(localStorage.getItem('native-atoms') || '{}'))['client-thread-bindings-v1']);
  const alias = route.startsWith('/local/') ? decodeURIComponent(route.slice('/local/'.length)) : null;
  if (alias && typeof bindings[alias] === 'string') route = '/local/' + bindings[alias];
  return route;
}
function syncRoute() {
  const route = currentOwnerRoute();
  if (route == null) return;
  const url = new URL(pinnedToolDocument ? '/' : location.href, location.href);
  const returning = pinnedToolDocument && !usesPinnedToolRenderer(route) && (route === '/' || parseWorkspaceThreadRoute(route));
  const target = returning && route === '/' && pinnedReturn && parseWorkspaceThreadRoute(pinnedReturn) ? pinnedReturn : route;
  if (target === '/') url.searchParams.delete('initialRoute'); else url.searchParams.set('initialRoute', target);
  if (returning) {
    location.replace(url);
    return;
  }
  if (pinnedReturn) url.searchParams.set('workspaceReturn', pinnedReturn);
  history.replaceState(null, '', url);
}

function connect() {
  socket = new WebSocket(location.origin.replace(/^http/, 'ws') + '/native-host');
  opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('无法连接工作台宿主')), { once: true });
    socket.addEventListener('close', () => reject(new Error('宿主连接已断开')), { once: true });
  });
  // The renderer asks for data during module initialization.
  opened.catch(() => {});
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.type === 'yard-sidebar-bootstrap') {
      sidebarBootstrap = message.value;
      performance.mark('workbench-sidebar-bootstrap');
      return;
    }
    if (sidebarBootstrap && (message.type === 'global-state-updated' || message.type === 'pinned-threads-updated')) {
      const keys = message.type === 'pinned-threads-updated' ? ['pinned-thread-ids'] : message.keys;
      // A concurrent edit before React initializes must use the current host
      // read rather than seed an older value from this connection's snapshot.
      sidebarBootstrap.globalStateEntries = sidebarBootstrap.globalStateEntries.filter(entry => !keys.includes(entry.key));
    }
    if (message.type === 'codex-app-server-connection-changed' && message.hostId) {
      if (message.state === 'connected' && !connectedHosts.has(message.hostId)) {
        connectedHosts.add(message.hostId);
        if (socket.readyState === WebSocket.OPEN) void refreshSidebar();
      } else if (message.state !== 'connected' && message.hostId !== 'local') {
        connectedHosts.delete(message.hostId); nativeSidebarHosts.delete(message.hostId);
      }
    }
    if (message.type === 'codex-app-server-initialized' && message.hostId) {
      if (message.yardSidebarStateAvailable) nativeSidebarHosts.add(message.hostId);
      else nativeSidebarHosts.delete(message.hostId);
      if (socket.readyState === WebSocket.OPEN) void refreshSidebar();
    }
    if (message.type === 'shared-object-updated' && message.key === 'remote_ssh_connections' && Array.isArray(message.value)) {
      const registered = ['local', ...message.value.map((host: ObjectValue) => host.hostId).filter((id: unknown): id is string => typeof id === 'string')];
      for (const id of connectedHosts) if (!registered.includes(id)) connectedHosts.delete(id);
      for (const id of nativeSidebarHosts) if (!registered.includes(id)) nativeSidebarHosts.delete(id);
      void sidebarSections.retainHosts(registered).then(value => publish({ type: 'persisted-atom-updated', key: sectionAtom, value }))
        .catch(error => console.warn('主机分组刷新失败，重连后重试', error));
    }
    if (message.type === 'mcp-response') {
      const key = rpcKey(message.hostId, message.message.id);
      threadReadState.observe(message, pending.get(key));
      sidechatThreads.observe(message, pending.get(key));
      pending.delete(key);
    } else { threadReadState.observe(message); sidechatThreads.observe(message); }
    if (message.type === 'worker-response') pending.delete(workerKey(message.workerId, message.response.id));
    if (message.type === 'fetch-response') pending.delete('fetch:' + message.requestId);
    if (!chrome.acceptsHostSnapshot(message)) return;
    publish(message);
  });
  socket.addEventListener('close', () => {
    if (disposed) return;
    terminal.disconnected();
    for (const hostId of connectedHosts) publish({ type: 'codex-app-server-connection-changed', hostId, transport: 'websocket', state: 'disconnected' });
    connectedHosts.clear(); connectedHosts.add('local');
    nativeSidebarHosts.clear(); nativeSidebarHosts.add('local');
    for (const message of pending.values()) {
      if (message.type === 'worker-request' && message.request) publish({ type: 'worker-response', workerId: message.workerId, response: {
        id: message.request.id, method: message.request.method, result: { type: 'error', error: { message: '宿主连接已断开' } },
      } });
      else if (message.request) publish({ type: 'mcp-response', hostId: message.hostId ?? 'local', message: {
        id: message.request.id, error: { code: -32000, message: '连接已断开，请重新读取对话核对操作结果。', data: { uncertain: true } },
      } });
      else publish({ type: 'fetch-response', requestId: message.requestId, responseType: 'error', status: 503, error: '宿主连接已断开' });
    }
    pending.clear();
    reconnectTimer = setTimeout(() => { connect(); void send({ type: 'ready' }).then(refreshSidebar).catch(() => {}); }, 2000);
  });
}
connect();
if (isMiniWindow) window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  disposed = true;
  clearTimeout(reconnectTimer);
  socket.close();
  pending.clear();
  hostRequests.clear();
});
async function send(message: HostMessage) {
  if (message.type === 'electron-window-focus-request') { publishFocus(); return; }
  if (mini.handle(message)) return;
  if (chrome.intercept(message)) return;
  if (openConversationLink(message)) return;
  if (message.type === 'log-message') return;
  if (message.type === 'fetch' && message.url?.endsWith('/automation-create') && typeof message.body === 'string') {
    const body = record(JSON.parse(message.body));
    message = { ...message, body: JSON.stringify({ ...body, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }) };
  }
  if (files.intercept(message, publish)) return;
  // The Web host does not consume desktop shared objects or runtime config
  // notifications. Avoid serializing the multi-megabyte Statsig snapshot.
  if (message.type === 'shared-object-set' || message.type === 'codex-runtimes-config-changed') return;
  if (message.type === 'persisted-atom-sync-request') {
    localStorage.removeItem('codex:persisted-atom:unread-thread-ids-by-host-v1');
    const saved = record(JSON.parse(localStorage.getItem('native-atoms') || '{}'));
    if ('unread-thread-ids-by-host-v1' in saved) {
      delete saved['unread-thread-ids-by-host-v1'];
      localStorage.setItem('native-atoms', JSON.stringify(saved));
    }
    try { saved[sectionAtom] = await sidebarSections.load(); }
    catch (error) { console.warn('旧分组迁移暂未完成，已保留原始记录', error); saved[sectionAtom] = sidebarSections.value(); }
    try { Object.assign(saved, await sidebarOrders.load()); }
    catch (error) { console.warn('侧栏顺序迁移暂未完成，已保留原始记录', error); }
    publish({ type: 'persisted-atom-sync', state: { 'electron:onboarding-projectless-completed': true, ...saved }, canWritePrimaryWindowTabPersistence: true });
    return;
  }
  if (message.type === 'persisted-atom-update') {
    if (message.key === 'unread-thread-ids-by-host-v1') return;
    if (stateConvergence.isDerivedAtom(String(message.key))) return;
    if (sidebarOrders.owns(String(message.key))) {
      const key = String(message.key);
      const value = await sidebarOrders.update(key, message.deleted ? [] : updatedAtom(sidebarOrders.value(key), message));
      publish({ type: 'persisted-atom-updated', key, value }); return;
    }
    if (message.key === sectionAtom) {
      try {
        const value = await sidebarSections.replace(message.deleted ? {} : updatedAtom(sidebarSections.value(), message));
        publish({ type: 'persisted-atom-updated', key: sectionAtom, value });
      } catch (error) {
        console.error('分组保存失败', error);
        publish({ type: 'persisted-atom-updated', key: sectionAtom, value: await sidebarSections.load().catch(() => sidebarSections.value()) });
      }
      return;
    }
    const saved = record(JSON.parse(localStorage.getItem('native-atoms') || '{}'));
    if (message.deleted) delete saved[String(message.key)];
    else saved[String(message.key)] = updatedAtom(saved[String(message.key)] ?? saved[String(record(message.recordUpdate).legacyStorageKey)], message);
    localStorage.setItem('native-atoms', JSON.stringify(saved));
    publish({ type: 'persisted-atom-updated', key: message.key, value: saved[String(message.key)], deleted: message.deleted });
    if (message.key === 'client-thread-bindings-v1') syncRoute();
    return;
  }
  if (message.type === 'browser-sidebar-owner-sync' && typeof message.ownerRoutePath === 'string') {
    ownerRoute = message.ownerRoutePath; syncRoute(); flushNotificationRoute();
    window.dispatchEvent(new Event('yard-workspace-route')); return;
  }
  await historyStartup.wait(message);
  await opened;
  // A resolved opening promise belongs to the socket's previous connection.
  // WebSocket.send silently discards messages after close; fail before tracking
  // or sending so a foreground read cannot block subsequent reconnect recovery.
  if (socket.readyState !== WebSocket.OPEN) throw new Error('宿主连接已断开，请等待重连后重新读取。');
  if (message.type === 'worker-request' && message.request) pending.set(workerKey(message.workerId, message.request.id), message);
  else if (message.request) {
    threadReadState.begin(message);
    pending.set(rpcKey(message.hostId, message.request.id), message);
  }
  if (message.type === 'worker-request-cancel') pending.delete(workerKey(message.workerId, message.id));
  if (message.type === 'fetch') pending.set('fetch:' + message.requestId, message);
  socket.send(JSON.stringify(message));
}

function requestHost(endpoint: string, body: unknown) {
  const requestId = crypto.randomUUID();
  return new Promise<unknown>((resolve, reject) => {
    hostRequests.set(requestId, { resolve, reject });
    void send({ type: 'fetch', requestId, url: 'vscode://codex/' + endpoint, body: JSON.stringify(body) })
      .catch(error => { hostRequests.delete(requestId); pending.delete('fetch:' + requestId); reject(error); });
  });
}
function requestThreadProjects(operation: ThreadProjectOperation, value?: unknown) { return requestHost('thread-projects', { operation, value }); }

const requestStartupSidebar = (hostId: string, searchTerm?: string, cursor?: string) => requestHost('startup-sidebar', { hostId, searchTerm, cursor });
// The first bounded read can overlap the source workspace's JS and CSS. Only
// the first local consumer takes it; reloads and explicit refreshes read again.
let initialSidebar = sourceWorkspaceDocument
  ? requestStartupSidebar('local').then(value => {
    performance.mark('workbench-source-sidebar-arrived');
    return value;
  }) : undefined;
void initialSidebar?.catch(() => {});
const initialThread = sourceWorkspaceDocument && parseWorkspaceThreadRoute(initialRoute);
let initialHistory: ReturnType<typeof readWorkspaceHistory> | undefined;
if (initialThread) {
  performance.mark('workbench-source-history-requested');
  initialHistory = readWorkspaceHistory(send, initialThread.threadId, null, initialThread.hostId).then(result => {
    performance.mark('workbench-source-history-arrived');
    return result;
  });
}
void initialHistory?.catch(() => {});

Object.assign(window, {
  workbenchTakeSourceHistory: (threadId: string, hostId: string) => {
    const first = initialHistory;
    initialHistory = undefined;
    if (first && initialThread && initialThread.threadId === threadId && initialThread.hostId === hostId) {
      performance.mark('workbench-source-history-consumed');
      return first;
    }
  },
  workbenchProjectlessThreadCwd: () => requestHost('projectless-thread-cwd', {}),
  workbenchReadWorkspaceDirectory: (workspaceRoot: string, directoryPath: string, hostId = 'local') =>
    requestHost('workspace-directory-entries', { workspaceRoot, directoryPath, hostId }),
  workbenchSelectLocalProject: (projectId?: string) => requestHost('set-global-state', {
    key: 'selected-project', value: projectId ? { type: 'local', projectId } : null,
  }),
  workbenchSidebarProject: (hostId: string, projectId: string, fields: Record<string, unknown>) =>
    requestHost('source-sidebar-project', { ...fields, hostId, projectId }),
  workbenchFollowUpMode: (value?: 'queue' | 'steer') => requestHost(value ? 'set-setting' : 'get-setting', { key: 'followUpQueueMode', value }),
  workbenchProjectSections: {
    snapshot: () => sidebarSections.projectSections(),
    load: () => sidebarSections.load().then(() => sidebarSections.projectSections()),
    move: (id: string, destination: ProjectSectionDestination) => sidebarSections.moveProject(id, destination),
  },
  workbenchBrowseProjectFolders: (hostId: string, directoryPath?: string) =>
    requestHost('remote-workspace-directory-entries', { hostId, directoryPath, directoriesOnly: true }),
  workbenchTerminal: {
    watch: terminal.watch.bind(terminal),
    call: (operation: TerminalOperation, args: unknown[]) => {
      if (socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('The terminal connection is closed.'));
      return terminal.call(operation, args);
    },
  },
  workbenchSetThreadPinned: (threadId: string, pinned: boolean, hostId = 'local') => requestHost('set-thread-pinned', { hostId, threadId, pinned }),
  workbenchRespondToServerRequest: (id: string | number, result: unknown, hostId = 'local') => {
    // Replies belong to the current daemon connection. Never queue them until reconnect.
    if (socket.readyState !== WebSocket.OPEN || !connectedHosts.has(hostId)) {
      throw new Error('The connection closed. Reopen the conversation to check the request.');
    }
    const message: HostMessage = { type: 'mcp-response', hostId, response: { id, result } };
    socket.send(JSON.stringify(message));
  },
  workbenchStartupSidebar: {
    load: (hostId = 'local', searchTerm?: string, cursor?: string) => {
      if (searchTerm || cursor !== undefined || hostId !== 'local' || !initialSidebar) return requestStartupSidebar(hostId, searchTerm, cursor);
      const first = initialSidebar;
      initialSidebar = undefined;
      return first.catch(() => requestStartupSidebar(hostId));
    },
    hosts: () => requestHost('source-workspace-hosts', {}),
    route: currentOwnerRoute,
    navigate: (route: string) => {
      pendingNotificationRoute = route;
      const url = new URL(location.href);
      if (route === '/') url.searchParams.delete('initialRoute'); else url.searchParams.set('initialRoute', route);
      history.replaceState(null, '', url);
      flushNotificationRoute();
    },
  },
  codexWindowType: 'electron',
  electronBridge: {
    windowType: 'electron', getPreloadStartedAtMs: () => performance.timeOrigin,
    getSystemThemeVariant: () => matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    subscribeToSystemThemeVariant: (callback: (theme: string) => void) => {
      const media = matchMedia('(prefers-color-scheme: dark)');
      const listener = () => callback(media.matches ? 'dark' : 'light');
      media.addEventListener('change', listener); return () => media.removeEventListener('change', listener);
    },
    getBuildFlavor: () => 'prod', getDesktopUserAgent: () => `Codex Desktop/${version} (X11; Linux; x64)`,
    getAppSessionId: () => 'agents-workbench-web', isDeviceCheckSupported: () => false, isIntelMacBuild: () => false,
    getSentryInitOptions: () => ({ appVersion: version, environment: 'local', codexAppSessionId: 'agents-workbench-web', dsn: '' }),
    getInitialSidebarBootstrap: () => sidebarBootstrap,
    getSharedObjectSnapshotValue: (key: string) => key === 'host_config' ? { id: 'local', kind: 'local' } : key === 'diff_comments' ? chrome.getCommentDrafts() : undefined,
    sendMessageFromView: send,
    sendWorkerMessageFromView: (workerId: string, message: HostMessage) => send({ ...message, workerId }),
    subscribeToWorkerMessages: (workerId: string, callback: (message: HostMessage) => void) => {
      const listener = (event: MessageEvent<HostMessage>) => {
        if (event.source === window && event.origin === location.origin && event.data?.workerId === workerId &&
          (event.data.type === 'worker-response' || event.data.type === 'worker-event')) callback(event.data);
      };
      window.addEventListener('message', listener);
      return () => window.removeEventListener('message', listener);
    },
    acknowledgeChunkedMessage: () => {}, getPathForFile: (file: File) => files.getPathForFile(file), startFileDrag: () => false, startLinkDrag: () => {},
    // Omit showContextMenu so the official helper uses its React menu fallback.
    getFastModeRolloutMetrics: async () => null, triggerSentryTestError: async () => {},
  },
});

window.addEventListener('message', async event => {
  if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'connect-app-host') return;
  const modulePath = rendererAssets.shared;
  const original = await import(modulePath) as {
    Eot: new () => object;
    kot(port: MessagePort, target: object): void;
    sot(): { warning(message: string, options: { id: string; description: string }): void };
  };
  class AppInfo extends original.Eot {
    get() { return { version, buildFlavor: 'prod', systemName: 'Linux', systemVersion: 'Web' }; }
  }
  class ThreadProjects extends original.Eot {
    setAssignment(value: AssignmentRequest) { return requestThreadProjects('setAssignment', value); }
    setProjectless(value: ProjectlessRequest) { return requestThreadProjects('setProjectless', value); }
    setMembership(value: MembershipRequest) { return requestThreadProjects('setMembership', value); }
    restoreMemberships(value: MembershipRequest[]) { return requestThreadProjects('restoreMemberships', value); }
    assignIfUnassigned(value: MembershipRequest[]) { return requestThreadProjects('assignIfUnassigned', value); }
    moveLocalProjectThreadsToProjectless(value: string) { return requestThreadProjects('moveLocalProjectThreadsToProjectless', value); }
    reset() { return requestThreadProjects('reset'); }
    flush() { return requestThreadProjects('flush'); }
    getThreadStartProjectId(value: ProjectAssignment) { return requestThreadProjects('getThreadStartProjectId', value); }
    updateProjectlessThread(value: ProjectlessThreadUpdate) { return requestThreadProjects('updateProjectlessThread', value); }
  }
  class PinnedThreads extends original.Eot {
    list(value?: unknown) { return requestHost('list-pinned-threads', value ?? {}); }
    set(value: unknown) { return requestHost('set-thread-pinned', value); }
    setOrder(value: unknown) { return requestHost('set-pinned-threads-order', value); }
    listSections(value?: ObjectValue) { return requestHost('pinned-thread-sections', { ...value, operation: 'list' }); }
    listSectionThreadIds(value: ObjectValue) { return requestHost('pinned-thread-sections', { ...value, operation: 'members' }); }
    createSection(value: ObjectValue) { return requestHost('pinned-thread-sections', { ...value, operation: 'create' }); }
    updateSection(value: ObjectValue) { return requestHost('pinned-thread-sections', { ...value, operation: 'update' }); }
    deleteSection(value: ObjectValue) { return requestHost('pinned-thread-sections', { ...value, operation: 'delete' }); }
    setThreadSection(value: ObjectValue) { return requestHost('pinned-thread-sections', { ...value, operation: 'move' }); }
  }
  class HttpFetch extends original.Eot {
    private readonly transport = new BrowserHttpFetch();
    fetch(id: string, request: HttpRequest) { return this.transport.fetch(id, request); }
    cancel(id: string) { this.transport.cancel(id); }
  }
  class WorkspaceFiles extends original.Eot {
    read(value: Parameters<BrowserFiles['read']>[0]) { return files.read(value); }
    getMetadata(value: Parameters<BrowserFiles['getMetadata']>[0]) { return files.getMetadata(value); }
    saveCopy(value: Parameters<BrowserFiles['saveCopy']>[0]) { return files.saveCopy(value); }
    downloadCopy(value: Parameters<BrowserFiles['downloadCopy']>[0]) { return files.downloadCopy(value); }
    getDownloadsFolderIcon() { return files.getDownloadsFolderIcon(); }
  }
  const clipboard = new BrowserClipboard((selected, directory) => files.importFiles(selected, directory), error => {
    original.sot().warning('图片暂存失败', { id: 'workbench-clipboard-persist', description: error.message });
  });
  class FileAttachments extends original.Eot {
    persistImageFileToTemp(value: ClipboardImage) { return clipboard.persistImageFileToTemp(value); }
  }
  class Clipboard extends original.Eot {
    writeText(text: string) { return writeClipboardText(text); }
  }
  class OpenIn extends original.Eot {
    open(value: Parameters<BrowserFiles['open']>[0]) { return files.open(value); }
  }
  class CustomAvatars extends original.Eot {
    load() { return requestHost('custom-avatars', {}); }
    loadAvatar(avatarId: string) { return requestHost('custom-avatars', { avatarId }); }
  }
  const terminalService = terminalRpcService(original.Eot, terminal);
  const browserService = chromeRpcService(original.Eot);
  const visualizations = visualizationService(original.Eot, requestHost);
  const projects = projectService(original.Eot, requestHost);
  class AppHost extends original.Eot {
    get services() { return { ...(isMiniWindow ? { avatarOverlay: mini.service(original.Eot), settings: mini.settings(original.Eot, requestHost) } : {}), appInfo: new AppInfo(), projects, httpFetch: new HttpFetch(), workspaceFiles: new WorkspaceFiles(), fileAttachments: new FileAttachments(), clipboard: new Clipboard(), openIn: new OpenIn(), threadProjectAssignments: new ThreadProjects(), pinnedThreads: new PinnedThreads(), customAvatars: new CustomAvatars(), terminal: terminalService, browserHost: browserService, visualizations, requestUserInputAutoResolution: {} }; }
    onRpcBroken() {}
  }
  original.kot(event.data.port, new AppHost());
});
