import { record, updatedAtom } from './protocol.ts';
import type { HostMessage, ObjectValue, SidebarBootstrap } from './protocol.ts';
import { BrowserHttpFetch } from './browser-http-fetch.ts';
import { BrowserFiles } from './browser-files.ts';
import { BrowserClipboard, writeClipboardText } from './browser-clipboard.ts';
import type { ClipboardImage } from './browser-clipboard.ts';
import { BrowserTerminal, registerTerminalShortcut, terminalRpcService } from './browser-terminal.ts';
import type { TerminalEvent } from './terminal-protocol.ts';
import { rendererAssets } from './renderer-assets.ts';
import { createMiniHost, isMiniWindow } from './mini-host.ts';
import { openClientBrowser } from './client-browser.ts';
import type { HttpRequest } from './http-fetch.ts';
import type { AssignmentRequest, MembershipRequest, ProjectAssignment, ProjectlessRequest, ProjectlessThreadUpdate, ThreadProjectOperation } from './thread-projects.ts';
import { BrowserChrome, chromeRpcService } from '../browser-reuse/browser-bridge.ts';
import { visualizationService } from './visualizations.ts';
import { HistoryStartup } from './history-startup.ts';

const version = '26.1013.40934';
const historyStartup = new HistoryStartup(new URLSearchParams(location.search).get('initialRoute'));
window.addEventListener('yard-conversation-history-ready', () => {
  requestAnimationFrame(() => requestAnimationFrame(() => historyStartup.release()));
}, { once: true });
window.addEventListener('pointerdown', () => historyStartup.release(), { once: true, capture: true });
window.addEventListener('keydown', () => historyStartup.release(), { once: true, capture: true });
const pending = new Map<string, HostMessage>();
const connectedHosts = new Set<string>(['local']);
let sidebarBootstrap: SidebarBootstrap | null = null;
const rpcKey = (hostId: unknown, id: unknown) => 'rpc:' + String(hostId ?? 'local') + ':' + String(id);
const workerKey = (workerId: unknown, id: unknown) => 'worker:' + String(workerId) + ':' + String(id);
const hostRequests = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
const files = new BrowserFiles(requestHost);
Object.assign(window, { workbenchStageFiles: (selected: File[]) => files.stageFiles(selected) });
Object.assign(window, { workbenchUploadLocalFileAttachments: (hostId: string, attachments: ObjectValue[]) => requestHost('upload-local-file-attachments', { hostId, attachments }) });
const terminal = new BrowserTerminal((operation, args) => requestHost('terminal', { operation, args }));
const publish = (message: HostMessage) => {
  mini.receive(message);
  if (message.type === 'terminal-event') { terminal.receive(message.event as TerminalEvent); return; }
  const request = message.type === 'fetch-response' && message.requestId ? hostRequests.get(message.requestId) : undefined;
  if (request) {
    hostRequests.delete(message.requestId!);
    if (message.responseType === 'error') request.reject(new Error(String(message.error)));
    else request.resolve(message.body);
  } else window.postMessage(message, location.origin);
};
registerTerminalShortcut(window, () => publish({ type: 'toggle-terminal' }));
const mini = createMiniHost(publish);
const chrome = new BrowserChrome(requestHost, publish);
Object.assign(window, { workbenchChrome: chrome });
Object.assign(window, { workbenchResolveAutomation: (id: string) => requestHost('automation-run-resolve', { id, confirmed: true }) });
Object.assign(window, { workbenchPortForwarding: (params: unknown) => requestHost('port-forwarding', params) });
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
  const url = new URL(location.href);
  if (route === '/') url.searchParams.delete('initialRoute'); else url.searchParams.set('initialRoute', route);
  history.replaceState(null, '', url);
}

function connect() {
  socket = new WebSocket(location.origin.replace(/^http/, 'ws') + '/native-host');
  opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('无法连接工作台宿主')), { once: true });
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
    if (message.hostId) connectedHosts.add(message.hostId);
    if (message.type === 'mcp-response') pending.delete(rpcKey(message.hostId, message.message.id));
    if (message.type === 'worker-response') pending.delete(workerKey(message.workerId, message.response.id));
    if (message.type === 'fetch-response') pending.delete('fetch:' + message.requestId);
    if (!chrome.acceptsHostSnapshot(message)) return;
    publish(message);
  });
  socket.addEventListener('close', () => {
    if (disposed) return;
    terminal.disconnected();
    for (const hostId of connectedHosts) publish({ type: 'codex-app-server-connection-changed', hostId, transport: 'websocket', state: 'disconnected' });
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
    reconnectTimer = setTimeout(() => { connect(); void send({ type: 'ready' }).catch(() => {}); }, 2000);
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
  if (mini.handle(message)) return;
  if (chrome.intercept(message)) return;
  if (openClientBrowser(message)) return;
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
    const saved = record(JSON.parse(localStorage.getItem('native-atoms') || '{}'));
    publish({ type: 'persisted-atom-sync', state: { 'electron:onboarding-projectless-completed': true, ...saved }, canWritePrimaryWindowTabPersistence: true });
    return;
  }
  if (message.type === 'persisted-atom-update') {
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
  if (message.type === 'worker-request' && message.request) pending.set(workerKey(message.workerId, message.request.id), message);
  else if (message.request) pending.set(rpcKey(message.hostId, message.request.id), message);
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

Object.assign(window, {
  workbenchStartupSidebar: {
    load: () => requestHost('startup-sidebar', {}),
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
  class AppHost extends original.Eot {
    get services() { return { ...(isMiniWindow ? { avatarOverlay: mini.service(original.Eot), settings: mini.settings(original.Eot, requestHost) } : {}), appInfo: new AppInfo(), httpFetch: new HttpFetch(), workspaceFiles: new WorkspaceFiles(), fileAttachments: new FileAttachments(), clipboard: new Clipboard(), openIn: new OpenIn(), threadProjectAssignments: new ThreadProjects(), pinnedThreads: new PinnedThreads(), customAvatars: new CustomAvatars(), terminal: terminalService, browserHost: browserService, visualizations, requestUserInputAutoResolution: {} }; }
    onRpcBroken() {}
  }
  original.kot(event.data.port, new AppHost());
});
