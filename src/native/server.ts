import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, mkdtemp, rename, realpath, chmod } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { CodexConnection, RpcError } from '../../lib/codex.ts';
import type { RpcMessage } from '../../lib/codex.ts';
import { permissionStart, publicPermissions } from '../../lib/permissions.ts';
import { createAppTools } from '../../lib/app-tools.ts';
import { computerConfig } from '../../lib/computer.ts';
import { createHostToolHandler } from '../../lib/host-tools.ts';
import { createNativeAppToolHost } from '../../lib/native-app-tools.ts';
import type { NativeProject } from '../../lib/native-app-tools.ts';
import { projectRoot, rendererRoot, rendererVersion } from '../../lib/app-resources.ts';
import { record, readMethods, writeMethods } from './protocol.ts';
import type { HostMessage, ObjectValue } from './protocol.ts';
import { createThreadProjects } from './thread-projects.ts';
import { createThreadPins } from './thread-pins.ts';
import { createBackendSidebarState } from './backend-sidebar-state.ts';
import { PrewarmedThreads } from './prewarmed-threads.ts';
import type { ThreadProjectOperation } from './thread-projects.ts';
import { configurationRequest, httpFailure } from './http-fetch.ts';
import type { HttpWireRequest } from './http-fetch.ts';
import { rendererAssets as assets, startupApplicationFile } from './renderer-assets.ts';
import { RendererCache } from './renderer-cache.ts';
import { initialWorkspaceRoute, usesPinnedToolRenderer } from './history-startup.ts';
import { loadConfigurationSnapshot } from './configuration-snapshot.ts';
import { discoverSshAliases, loadHostCatalog, publicHost, savedSshHosts } from './hosts.ts';
import type { HostCatalog } from './hosts.ts';
import { createSshProxyStream } from './ssh.ts';
import type { HostPaths } from './ssh.ts';
import { createQueuedSendLocks } from './queued-send-locks.ts';
import { createFiles, fileEndpoints, fileMethods } from './files.ts';
import type { RemoteFileCommand } from './files.ts';
import { createPetOverlay } from './pet-overlay.ts';
import { createPetAssets } from './pet-assets.ts';
import { withVisualFeedback, webManifest, brandAssets } from './visual-feedback.ts';
import { TerminalHost } from './terminal.ts';
import type { TerminalOperation } from './terminal-protocol.ts';
import { chromeConnectionFromEnv } from '../browser-reuse/panel-host.ts';
import { ChromePanelRouter } from '../browser-reuse/panel-router.ts';
import { ClientChromeBroker } from '../browser-reuse/client-broker.ts';
import { clientChromePath, clientChromePackagePath } from '../browser-reuse/client-protocol.ts';
import type { ConnectionRequest } from '../browser-reuse/client-protocol.ts';
import type { ChromeConnection } from '../browser-reuse/chrome-mcp.ts';
import type { ChromeRequest } from '../browser-reuse/protocol.ts';
import { adaptVisualizationModule, visualizationSandboxPolicy, webRendererPrefix } from './visualizations.ts';
import { mcpAppSandboxHtml, mcpAppSandboxPath, mcpAppSandboxPolicy } from './mcp-app-sandbox.ts';
import { adaptThreadArchiveModule } from './thread-archives.ts';
import { automationEndpoints, createAutomations } from './automations.ts';
import { adaptAutomationModule } from './automation-renderer.ts';
import { PortForwarding } from './port-forwarding.ts';
import { DevelopmentPreviews } from './development-previews.ts';
import { adaptYardMenu } from './app-menu-renderer.ts';
import { adaptNotificationSettings } from './notification-renderer.ts';
import { adaptFilePreviewModule } from './file-preview-renderer.ts';
import { adaptFileAttachmentModule } from './file-attachment-renderer.ts';
import { localHtmlPreview } from './local-html-preview.ts';
import { adaptNewTabModule } from './new-tab-renderer.ts';
import { adaptConversationHistory } from './conversation-history-renderer.ts';
import { adaptStartupModule } from './startup-renderer.ts';
import { adaptMessageSubmission } from './message-submission-renderer.ts';
import { sidebarProjectRoots, sidebarThreadProject, startupProjectSelection, startupSidebar } from './startup-sidebar.ts';
import type { SidebarProjectDetails } from './startup-sidebar.ts';
import { readProjectAppearance } from './project-appearance.ts';
import { adaptThreadReadState } from './thread-read-state-renderer.ts';
import { adaptStateConvergence } from './state-convergence-renderer.ts';
import { adaptSidebarState } from './sidebar-state-renderer.ts';
import { adaptSidebarLayout } from './sidebar-layout-renderer.ts';
import { adaptSidechatThreads } from './sidechat-thread-renderer.ts';
import { supportsAttachedThreads } from '../../lib/codex-protocol.ts';
import type { ThreadListResponse } from '../../lib/codex-protocol.ts';
import { createBrowserNotifications, notificationRoute } from './notifications.ts';
import { ModelProviders } from './model-providers.ts';
import { modelSelection } from './model-selection.ts';
import { ProviderRouting } from './provider-routing.ts';
import { deepseekCatalog, isDeepseekProvider } from './deepseek-models.ts';
import { adaptModelProviders } from './model-provider-renderer.ts';

interface Options { port?: number; socketPath?: string; codexHome?: string; dataDir?: string; workspace?: string; renderer?: string; sourceWorkspace?: boolean; adapterPath?: string; publicOrigin?: string; embeddingOrigins?: string[]; httpFetch?: typeof fetch; notificationFetch?: typeof fetch; notificationIntervalMs?: number; hostCatalog?: HostCatalog; sshConfigPath?: string; sshStream?: typeof createSshProxyStream; remoteFileCommand?: RemoteFileCommand; chromeConnection?: ChromeConnection }
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.wasm': 'application/wasm', '.json': 'application/json', '.mp3': 'audio/mpeg',
};
const compress = promisify(gzip);
const defaultAppLocale = 'zh-CN';
function workspaceLocale(override: unknown) {
  if (typeof override === 'string') {
    try { return Intl.getCanonicalLocales(override.trim().replaceAll('_', '-'))[0] ?? defaultAppLocale; }
    catch { /* Use the same default as locale-info. */ }
  }
  return defaultAppLocale;
}
function serverVersion(connection: CodexConnection) {
  return connection.server?.userAgent.match(/^[^/]+\/(\S+)/)?.[1] ?? null;
}
function encodingQuality(value: string | undefined, coding: 'gzip' | 'br') {
  for (const encoding of value?.split(',') ?? []) {
    const [name, ...parameters] = encoding.split(';');
    if (name?.trim().toLowerCase() !== coding) continue;
    const quality = parameters.find(parameter => /^\s*q\s*=/i.test(parameter));
    const q = quality === undefined ? 1 : Number(quality.split('=')[1]?.trim());
    return q > 0 && q <= 1 ? q : 0;
  }
  return 0;
}
const acceptsGzip = (value?: string) => encodingQuality(value, 'gzip') > 0;
const brotliStartupBundles = new Set<string>([assets.shared, assets.application, assets.primary, assets.locale]);

async function readRendererAsset(file: string, path: string, webRenderer: boolean) {
  let content: Buffer = await readFile(file);
  if (webRenderer && path.endsWith('.js')) {
    content = adaptVisualizationModule(path, content);
    content = adaptThreadArchiveModule(path, content);
    content = adaptAutomationModule(path, content);
    content = adaptYardMenu(path, content);
    content = adaptNotificationSettings(path, content);
    content = adaptModelProviders(path, content);
    content = adaptFilePreviewModule(path, content);
    content = adaptFileAttachmentModule(path, content);
    content = adaptNewTabModule(path, content);
    content = adaptConversationHistory(path, content);
    content = adaptThreadReadState(path, content);
    content = adaptStateConvergence(path, content);
    content = adaptSidebarState(path, content);
    content = adaptSidechatThreads(path, content);
    content = adaptSidebarLayout(path, content);
    content = adaptStartupModule(path, content);
    content = adaptMessageSubmission(path, content);
  }
  return content;
}

export async function createNativeWorkbench(options: Options = {}) {
  const computer = computerConfig();
  const port = options.port ?? Number(process.env.PORT || 8765);
  const codexHome = options.codexHome || process.env.CODEX_HOME || join(homedir(), '.codex');
  const workspace = await realpath(options.workspace || process.env.AGENTS_WORKSPACE || homedir());
  const socketPath = options.socketPath || process.env.AGENTS_CODEX_SOCKET || join(codexHome, 'app-server-control', 'app-server-control.sock');
  const dataDir = options.dataDir || process.env.AGENTS_DATA_DIR || join(projectRoot, '.local');
  const renderer = options.renderer || rendererRoot;
  function loadWebResource(file: string, path: string, webRenderer: boolean) {
    const staged = !options.renderer && webRenderer && path === '/assets/' + startupApplicationFile;
    return readRendererAsset(staged ? join(projectRoot, '.local', startupApplicationFile) : file, path, webRenderer);
  }
  const publicOrigin = options.publicOrigin ?? process.env.AGENTS_PUBLIC_ORIGIN ?? '';
  const developmentPreviews = new DevelopmentPreviews({ publicOrigin, localOrigin: () => {
    const address = server.address() as import('node:net').AddressInfo;
    return 'http://127.0.0.1:' + address.port;
  } });
  const embeddingOrigins = options.embeddingOrigins ?? (process.env.AGENTS_EMBEDDING_ORIGINS ?? '').split(/\s+/).filter(Boolean);
  for (const origin of embeddingOrigins) {
    let url: URL;
    try { url = new URL(origin); } catch { throw new Error('AGENTS_EMBEDDING_ORIGINS 必须是精确 HTTP 或 HTTPS 来源，以空格分隔'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin || url.username || url.password || url.hostname.includes('*')) {
      throw new Error('AGENTS_EMBEDDING_ORIGINS 必须是精确 HTTP 或 HTTPS 来源，以空格分隔');
    }
  }
  const chromeConnection = options.chromeConnection ?? chromeConnectionFromEnv();
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
  if (publicOrigin) {
    const url = new URL(publicOrigin);
    if (url.protocol !== 'https:' || url.origin !== publicOrigin || url.username || url.password || url.hostname.includes('*')) {
      throw new Error('AGENTS_PUBLIC_ORIGIN 必须是精确 HTTPS 来源');
    }
  }
  const metadata = JSON.parse(await readFile(join(renderer, 'renderer.json'), 'utf8'));
  if (metadata.version !== rendererVersion) throw new Error('仓库内的 App 资源版本不匹配，请核对 vendor/codex-app 与当前代码版本');
  const browserHost = await readFile(join(projectRoot, '.local', 'native-host.js'));
  const browserEntry = await readFile(join(projectRoot, '.local', options.sourceWorkspace ? 'source-workspace.js' : 'workbench-entry.js'));
  const sourceStyle = options.sourceWorkspace ? await readFile(join(projectRoot, '.local', 'source-workspace.css')) : null;
  const [compressedBrowserHost, compressedBrowserEntry, compressedSourceStyle] = await Promise.all([
    compress(browserHost, { level: 6 }), compress(browserEntry, { level: 6 }),
    sourceStyle ? compress(sourceStyle, { level: 6 }) : null,
  ]);
  const notificationWorker = await readFile(join(projectRoot, '.local', 'notification-worker.js'));
  const sandboxScript = await readFile(join(projectRoot, '.local', 'visualization-sandbox.js'), 'utf8');
  const sandboxHtml = '<!doctype html><html><head><meta charset="utf-8"><title>Visualization</title></head><body><script>' +
    sandboxScript.replaceAll('</script', '<\\/script') + '</script></body></html>';
  const configurationSnapshot = await loadConfigurationSnapshot(join(dataDir, 'configuration-snapshot'), rendererVersion);
  const snapshotBody = configurationSnapshot ? Buffer.from(JSON.stringify(configurationSnapshot)) : null;
  // The snapshot is fixed for this process. Revalidation avoids transferring
  // megabytes on each reload while a changed capture gets a different tag.
  const snapshotTag = snapshotBody ? 'W/"' + createHash('sha256').update(snapshotBody).digest('base64url') + '"' : null;
  const compressedSnapshot = snapshotBody ? await compress(snapshotBody, { level: 1 }) : null;
  const rendererCache = new RendererCache();
  // Adapt and compress the first modules once, before accepting page loads.
  // Custom test renderers may intentionally contain no application modules.
  if (!options.renderer && !options.sourceWorkspace) await Promise.all([
    assets.client, assets.shared, assets.rpc, assets.application, assets.primary,
    assets.locale, assets.applicationStyle, assets.userMessageStyle,
  ].map(url => {
    const path = url.slice(webRendererPrefix.length), file = resolve(renderer, '.' + path);
    return rendererCache.load('web:' + file, () => loadWebResource(file, path, true), true, brotliStartupBundles.has(url));
  }));
  const sourceHtml = options.sourceWorkspace ? withVisualFeedback([
    '<!doctype html><html lang="' + defaultAppLocale + '"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Codex Yard</title>',
    '<meta name="yard-source-workspace" content="true">',
    // Start the independent host connection while the browser fetches CSS.
    '<script src="/native-host.js"></script>',
    '<style>@layer theme, base, components, utilities;</style>',
    ...[assets.sharedStyle, assets.applicationStyle, assets.userMessageStyle, '/source-workspace.css']
      .map(path => '<link rel="stylesheet" href="' + path + '">'),
    '<script type="module" src="/workbench-entry.js"></script>',
    '</head><body><div id="root"></div></body></html>',
  ].join('')) : null;
  const pinnedHtml = withVisualFeedback((await readFile(join(renderer, 'index.html'), 'utf8'))
    // Both the desktop document policy and our response policy apply to frames.
    .replace('frame-src &#39;self&#39; blob:', 'frame-src &#39;self&#39; blob: http: https:')
    .replace('./assets/index-acf264e41d60.js', options.sourceWorkspace ? '/workbench-pinned-entry.js' : '/workbench-entry.js')
    .replaceAll('./assets/', webRendererPrefix + '/assets/')
    .replace('</head>', [assets.application, assets.rpc, assets.primary, assets.locale]
      .map(path => `<link rel="modulepreload" crossorigin href="${path}">`).join('') +
      // Bubble padding, radius and width are CSS-module variables. Load them
      // before the first user message, including optimistic/new conversations.
      [assets.applicationStyle, assets.userMessageStyle]
        .map(path => `<link rel="stylesheet" crossorigin href="${path}">`).join('') + '</head>')
    // The initial view owns its CSS. Download workspace styles without blocking
    // that view; the browser entry enables and awaits them before root.render.
    .replaceAll('<link rel="stylesheet"', '<link rel="preload" as="style" data-yard-workspace-style')
    .replace('<script type="module"', '<script src="/native-host.js"></script><script type="module"'));
  const pinnedToolHtml = options.sourceWorkspace
    ? pinnedHtml.replace('<head>', '<head><meta name="yard-pinned-tool" content="true">') : pinnedHtml;
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await chmod(dataDir, 0o700);
  async function load(name: string, fallback: unknown) {
    try { return JSON.parse(await readFile(join(dataDir, name), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw error; }
  }
  const state = record(await load('native-state.json', {}));
  const globals = record(state.globals), settings = record(state.settings);
  // Full workspace view presents the official chat/content tab strip.
  settings['default-workspace-full-view'] ??= true;
  const catalog = options.hostCatalog ?? await loadHostCatalog(codexHome);
  const sshHosts = new Map(catalog.hosts.map(host => [host.hostId, host]));
  if (Object.hasOwn(globals, 'codex-managed-remote-connections')) {
    catalog.hosts = savedSshHosts(globals['codex-managed-remote-connections'], sshHosts);
    sshHosts.clear();
    for (const host of catalog.hosts) sshHosts.set(host.hostId, host);
  }
  const hostPaths = new Map<string, HostPaths>([['local', { homeDirectory: homedir(), codexHome }]]);
  const fileConnections = new Map<string, CodexConnection>();
  const files = createFiles({ dataDir, workspace, hosts: sshHosts, remoteCommand: options.remoteFileCommand,
    async request(hostId, method, params, mutating = false) {
      validHost(hostId);
      let connection = hostId === 'local' ? control : fileConnections.get(hostId);
      if (!connection) {
        connection = new CodexConnection('', { createConnection: () => (options.sshStream ?? createSshProxyStream)(sshHosts.get(hostId)!, paths => hostPaths.set(hostId, paths)), connectTimeout: 20_000 });
        connection.on('message', message => observeBackend(hostId, message));
        fileConnections.set(hostId, connection);
      }
      await connection.connect();
      return connection.request(method, params, { mutating });
    },
  });
  function validHost(hostId: string) { if (hostId !== 'local' && !sshHosts.has(hostId)) throw new Error('未登记的执行主机：' + hostId); }
  // The desktop catalog and old projects file are migration input once. A
  // later backend deletion must survive a restart of Yard.
  if (globals['yard-legacy-catalog-imported'] !== true) {
    globals['remote-projects'] ??= catalog.projects;
    globals['thread-project-assignments'] = { ...catalog.assignments, ...record(globals['thread-project-assignments']) };
    const projects = await load('projects.json', []) as { path: string; name: string }[];
    globals['local-projects'] ??= Object.fromEntries(projects.map(project => [project.path, {
      id: project.path, name: project.name, rootPaths: [project.path], createdAt: Date.now(), updatedAt: Date.now(),
    }]));
    globals['yard-legacy-catalog-imported'] = true;
  }
  const clients = new Map<WebSocket, Map<string, CodexConnection>>();
  const terminals = new Map<WebSocket, TerminalHost>();
  const browsers = new Map<WebSocket, ChromePanelRouter>();
  const chromeClients = new ClientChromeBroker({ configured: !!chromeConnection, label:
    chromeConnection && 'autoConnect' in chromeConnection && chromeConnection.windowsSsh
      ? chromeConnection.windowsSsh.host : hostname() });
  const queuedSendLocks = createQueuedSendLocks();
  const prewarmedThreads = new PrewarmedThreads({
    publish(hostId, thread) {
      const message = { method: 'thread/started', params: { thread } };
      observeVisibleBackend(hostId, message);
      for (const [client, connections] of clients) if (connections.has(hostId)) {
        send(client, { type: 'mcp-notification', hostId, ...message });
      }
    },
    async expire(hostId, threadId) {
      const connection = await toolConnection(hostId);
      await guardPrewarmDelete(hostId, threadId, connection);
      await connection.request('thread/delete', { threadId }, { mutating: true });
      prewarmedThreads.forget(hostId, threadId);
    },
    onError: error => console.error('Prewarm cleanup:', error instanceof Error ? error.message : error),
  });
  const unsupported = new Set<string>();
  const httpRequests = new Set<AbortController>();
  const control = new CodexConnection(socketPath, { cwd: workspace });
  let persistQueue = Promise.resolve();
  function persist() {
    const snapshot = JSON.stringify({ globals: sidebar.persistenceGlobals(), settings }, null, 2) + '\n';
    persistQueue = persistQueue.catch(() => {}).then(async () => {
      await writeFile(join(dataDir, 'native-state.json.tmp'), snapshot, { mode: 0o600 });
      await rename(join(dataDir, 'native-state.json.tmp'), join(dataDir, 'native-state.json'));
    });
    return persistQueue;
  }
  function send(client: WebSocket, message: unknown) {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message));
  }
  function broadcast(message: unknown) { for (const client of clients.keys()) send(client, message); }
  function observeBackend(hostId: string, message: Pick<RpcMessage, 'method' | 'params' | 'id'>, forward?: () => void) {
    const params = record(message.params);
    const deliver = () => { observeVisibleBackend(hostId, message); forward?.(); };
    if (message.method === 'thread/started') { prewarmedThreads.started(hostId, params.thread, deliver); return; }
    if (message.method === 'turn/started' && typeof params.threadId === 'string') prewarmedThreads.publish(hostId, params.threadId);
    if (message.method === 'thread/deleted' && typeof params.threadId === 'string') prewarmedThreads.forget(hostId, params.threadId);
    deliver();
  }
  function observeVisibleBackend(hostId: string, message: Pick<RpcMessage, 'method' | 'params' | 'id'>) {
    notifications.observe(hostId, message);
    automations.observe(hostId, message);
    void sidebar.observeBackend(hostId, message).catch(error => console.error('Sidebar refresh:', error.message));
    if (message.method === 'thread/readState/changed' || message.method === 'thread/status/changed') {
      for (const [client, connections] of clients) if (connections.has(hostId)) {
        send(client, { type: 'mcp-notification', hostId, method: message.method, params: message.params });
      }
    }
  }
  const modelProviders = new ModelProviders({ globals, persist });
  const writtenCatalogs = new Set<string>();
  const providerRouting = new ProviderRouting({
    providers: modelProviders,
    connections: hostId => [...(hostId === 'local' ? [control] : fileConnections.has(hostId) ? [fileConnections.get(hostId)!] : []), ...[...clients.values()].flatMap(connections => {
      const connection = connections.get(hostId); return connection ? [connection] : [];
    })],
    async sessionConfig(hostId, provider, connection) {
      const config = hostId === 'local' ? { ...hostTools.config } : {};
      const catalog = await modelProviders.catalogPath(hostId, connection, provider);
      if (catalog) return { ...config, model_catalog_json: catalog };
      if (!isDeepseekProvider(await modelProviders.definition(hostId, connection, provider))) return config;
      const path = hostId === 'local' ? join(dataDir, 'deepseek-models.json') : join(hostPaths.get(hostId)!.codexHome, 'yard-deepseek-models.json');
      if (!writtenCatalogs.has(hostId)) {
        if (hostId === 'local') await writeFile(path, deepseekCatalog, { mode: 0o600 });
        else await connection.request('fs/writeFile', { path, dataBase64: Buffer.from(deepseekCatalog).toString('base64') }, { mutating: true });
        writtenCatalogs.add(hostId);
      }
      return { ...config, model_catalog_json: path };
    },
  });
  const portForwarding = new PortForwarding({ hosts: sshHosts, rules: globals['port-forwarding-rules'], async save(rules) {
    const previous = globals['port-forwarding-rules'];
    globals['port-forwarding-rules'] = rules;
    try { await persist(); }
    catch (error) { globals['port-forwarding-rules'] = previous; throw error; }
  } });
  const sidebar = createBackendSidebarState({ globals, persist, publish: broadcast, validHost,
    isThreadVisible: (hostId, threadId) => !prewarmedThreads.isHidden(hostId, threadId),
    supportsHost(hostId) {
      const connection = hostId === 'local' ? control : [...clients.values()].map(connections => connections.get(hostId))
        .find(connection => connection?.connected) ?? fileConnections.get(hostId) ?? [...clients.values()].map(connections => connections.get(hostId))
        .find(connection => connection?.server);
      const [major, minor] = (connection ? serverVersion(connection) ?? '' : '').split('.').map(Number);
      return major! > 0 || major === 0 && minor! >= 156;
    },
    knownHostIds: () => ['local', ...sshHosts.keys()],
    hostIds: () => [...new Set(['local', ...[...fileConnections].filter(([, connection]) => connection.connected).map(([id]) => id),
      ...[...clients.values()].flatMap(connections => [...connections].filter(([, connection]) => connection.connected).map(([id]) => id))])],
    async request(hostId, method, params, mutating) {
      const page = [...clients.values()].map(connections => connections.get(hostId)).find(connection => connection?.connected);
      const result = await (page ?? await toolConnection(hostId)).request(method, params, { mutating });
      return method === 'thread/list' ? prewarmedThreads.filterList(hostId, result) : result;
    } });
  const threadProjects = createThreadProjects(globals, persist, broadcast, validHost, sidebar);
  const threadPins = createThreadPins(globals, persist, broadcast, sidebar);
  const petOverlay = createPetOverlay(globals, settings, persist, broadcast);
  const petAssets = createPetAssets(codexHome);
  function remoteProfiles() {
    const preferences = record(globals['remote-connection-auto-connect-by-host-id']);
    return catalog.hosts.map(host => ({ ...publicHost(host), autoConnect: preferences[host.hostId] === true }));
  }
  function projectRoots(hostId = 'local') {
    if (sidebar.supportsHost(hostId)) return sidebar.projects(hostId).flatMap(project => project.roots.map(root => root.path));
    if (hostId === 'local') return Object.values(record(globals['local-projects'])).flatMap(value => {
      const paths = record(value).rootPaths; return Array.isArray(paths) ? paths.filter((path): path is string => typeof path === 'string') : [];
    });
    return (Array.isArray(globals['remote-projects']) ? globals['remote-projects'] as ObjectValue[] : [])
      .filter(project => project.hostId === hostId && typeof project.remotePath === 'string').map(project => String(project.remotePath));
  }
  function sharedObject(key: string) {
    if (key === 'host_config') return { id: 'local', kind: 'local' };
    if (key === 'remote_ssh_connections') return remoteProfiles();
    if (key === 'remote_wsl_connections' || key === 'remote_control_connections') return [];
    return undefined;
  }
  const callHostTool = createHostToolHandler({
    connection: control,
    knownThread: async (id: string) => control.request('thread/read', { threadId: id, includeTurns: false }),
    listProjects: async () => ({ projects: (await listNativeProjects()).map(project => ({ path: project.path, name: project.label })), workspace }),
    listThreads: async params => control.request('thread/list', { ...params, archived: false }),
    readThread: async params => control.request('thread/read', { threadId: params.threadId, includeTurns: true }),
  });
  async function toolConnection(hostId: string) {
    validHost(hostId);
    let connection = hostId === 'local' ? control : fileConnections.get(hostId);
    if (!connection) {
      connection = new CodexConnection('', { createConnection: () => (options.sshStream ?? createSshProxyStream)(sshHosts.get(hostId)!, paths => hostPaths.set(hostId, paths)), connectTimeout: 20_000 });
      connection.on('message', message => observeBackend(hostId, message));
      fileConnections.set(hostId, connection);
    }
    await connection.connect();
    return connection;
  }
  async function guardPrewarmDelete(hostId: string, threadId: string, connection: CodexConnection) {
    const assertUnused = () => {
      if (!prewarmedThreads.isHidden(hostId, threadId)) throw new Error('仅清理本次宿主创建且未使用的空预热对话');
    };
    assertUnused();
    const { thread } = await connection.request('thread/read', { threadId, includeTurns: false });
    let hasTurns: boolean;
    if (record(thread).historyMode === 'paginated') {
      try {
        const history = record(await connection.request('thread/turns/list', { threadId, limit: 1, itemsView: 'notLoaded' }));
        if (!Array.isArray(history.data)) throw new Error('无法核对预热对话历史，保留当前数据');
        hasTurns = history.data.length > 0;
      } catch (error) {
        // The CLI keeps unused prewarms in memory and explicitly reports that
        // history is unavailable until the first user message materializes it.
        if (!(error instanceof RpcError && error.code === -32600 && error.message ===
            `thread ${threadId} is not materialized yet; thread/turns/list is unavailable before first user message`)) throw error;
        hasTurns = false;
      }
    } else hasTurns = (await connection.request('thread/read', { threadId, includeTurns: true })).thread.turns.length > 0;
    if (hasTurns || thread.status.type !== 'idle') {
      prewarmedThreads.publish(hostId, threadId);
      throw new Error('对话已有内容或正在运行，保留当前数据');
    }
    assertUnused();
    await automations.beforeThreadDelete(hostId, threadId);
    assertUnused();
  }
  async function listNativeProjects() {
      await sidebar.ensureHost('local');
      const local: NativeProject[] = Object.entries(record(globals['local-projects'])).flatMap(([id, value]) => {
        const project = record(value), roots = Array.isArray(project.rootPaths) ? project.rootPaths : [];
        const path = typeof roots[0] === 'string' ? roots[0] : id;
        return [{ projectId: id, projectKind: 'local', label: typeof project.name === 'string' ? project.name : basename(path),
          path, hostId: 'local', hostDisplayName: null, isGitRepository: false }];
      });
      const remote: NativeProject[] = (Array.isArray(globals['remote-projects']) ? globals['remote-projects'] : []).flatMap(value => {
        const project = record(value), host = typeof project.hostId === 'string' ? sshHosts.get(project.hostId) : undefined;
        if (!host || typeof project.id !== 'string' || typeof project.remotePath !== 'string') return [];
        return [{ projectId: project.id, projectKind: 'remote', label: typeof project.label === 'string' ? project.label : basename(project.remotePath),
          path: project.remotePath, hostId: host.hostId, hostDisplayName: host.displayName, isGitRepository: false }];
      });
      await Promise.all(local.map(async project => {
        try { await promisify(execFile)('git', ['-C', project.path, 'rev-parse', '--is-inside-work-tree'], { timeout: 5000 }); project.isGitRepository = true; }
        catch { /* A saved folder may be unavailable or outside Git. */ }
      }));
      return [...local, ...remote];
  }
  async function setNativeMembership(threadId: string, hostId: string, project: NativeProject | null, cwd: string, startedThread?: import('../../lib/codex-protocol.ts').ThreadSummary) {
    if (startedThread) await sidebar.observeResponse(hostId, 'thread/start', { thread: startedThread });
    await threadProjects('setMembership', { threadId, hostId, projectless: project === null, assignment: project === null ? null :
      project.projectKind === 'remote' ? { projectKind: 'remote', projectId: project.projectId, hostId } : { projectKind: 'local', projectId: project.projectId } });
    if (!project) await threadProjects('updateProjectlessThread', { threadId, hostId, outputDirectory: cwd, workspaceRoot: join(dataDir, 'workspaces') });
  }
  const taskHost = { connectionFor: toolConnection, listProjects: listNativeProjects,
    supportsSidebarState: sidebar.supportsHost,
    projectIdForStart: async (project: NativeProject, hostId: string) => await threadProjects('getThreadStartProjectId', {
      projectKind: project.projectKind, projectId: project.projectId, ...(project.projectKind === 'remote' ? { hostId } : {}) }) as string | null,
    projectlessRoot: join(dataDir, 'workspaces'), configFor: (hostId: string) => hostId === 'local' ? hostTools.config : {},
    setMembership: setNativeMembership };
  // Acquire scheduler ownership before opening the shared tools socket.
  const automations = createAutomations({ ...taskHost, dataDir, changed: () => broadcast({ type: 'automation-runs-updated' }),
    runChanged(run) {
      if (run.threadId && run.turnId) notifications.watch(run.hostId, run.threadId, run.turnId);
      else if (run.status === 'failed') void notifications.publish({ id: 'automation-failed:' + run.id, kind: 'failed',
        title: 'Yard · 定时任务启动失败', body: run.automationName.slice(0, 160),
        url: run.threadId ? notificationRoute(run.hostId, run.threadId) : '/?initialRoute=%2Fautomations' }).catch(() => {});
    },
  });
  const nativeTools = createNativeAppToolHost({ ...taskHost, hostIds: () => ['local', ...sshHosts.keys()], globals, pins: sidebar.pins });
  const hostTools = await createAppTools({ adapterPath: options.adapterPath, socketPath: join(dataDir, 'app-tools.sock'),
    tools: nativeTools.tools, callTool: nativeTools.callTool,
  }).catch(async error => { await automations.close(); throw error; });
  Object.assign(hostTools.config, computer);
  const notifications = await createBrowserNotifications({ dataDir, connectionFor: toolConnection,
    hostIds: () => ['local', ...remoteProfiles().filter(host => host.autoConnect).map(host => host.hostId)],
    fetch: options.notificationFetch, intervalMs: options.notificationIntervalMs, subject: process.env.YARD_WEB_PUSH_SUBJECT })
    .catch(async error => { await automations.close(); await hostTools.close(); await nativeTools.close(); throw error; });
  control.on('message', message => observeBackend('local', message));
  // A daemon request is broadcast to every page subscribed to its thread.
  // Retain each result through the turn so another page or a replay only replies.
  const legacyTitleCalls = new Map<string, Map<string, ReturnType<typeof callHostTool>>>();
  const reconnectControl = setInterval(() => {
    if (!control.connected) void control.connect().catch(() => {});
  }, 2000);
  reconnectControl.unref();

  function sandboxPolicy(request: import('node:http').IncomingMessage) {
    // Use the configured HTTPS parent explicitly for opaque-origin frames.
    // Loopback pages retain their existing same-origin framing policy.
    const policy = publicOrigin && request.headers.host === new URL(publicOrigin).host
      ? visualizationSandboxPolicy.replace("frame-ancestors 'self'", 'frame-ancestors ' + publicOrigin)
      : visualizationSandboxPolicy;
    return policy + (embeddingOrigins.length ? ' ' + embeddingOrigins.join(' ') : '');
  }
  function allowed(request: import('node:http').IncomingMessage, requireOrigin = false, pageRoute = false) {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    const localOrigins = [`http://127.0.0.1:${actualPort}`, `http://localhost:${actualPort}`];
    const allowedOrigins = [...localOrigins, ...(publicOrigin ? [publicOrigin] : [])];
    const hosts = allowedOrigins.map(origin => new URL(origin).host);
    const documentNavigation = pageRoute && !requireOrigin && request.method === 'GET' &&
      request.headers['sec-fetch-mode'] === 'navigate' && request.headers['sec-fetch-dest'] === 'document';
    let embeddedNavigation = false;
    if (pageRoute && !requireOrigin && request.method === 'GET' && request.headers['sec-fetch-mode'] === 'navigate'
      && request.headers['sec-fetch-dest'] === 'iframe' && request.headers.referer) {
      try { embeddedNavigation = embeddingOrigins.includes(new URL(request.headers.referer).origin); } catch {}
    }
    return hosts.includes(request.headers.host || '') &&
      (request.headers['sec-fetch-site'] !== 'cross-site' || documentNavigation || embeddedNavigation) &&
      (!request.headers.origin ? !requireOrigin : allowedOrigins.includes(request.headers.origin)
        || embeddedNavigation && embeddingOrigins.includes(request.headers.origin));
  }
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self' blob:; img-src 'self' data: blob:; media-src 'self' data: blob:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; worker-src 'self' blob:; frame-src 'self' blob: http: https:; frame-ancestors 'self'" + (embeddingOrigins.length ? ' ' + embeddingOrigins.join(' ') : ''));
    try {
      const url = new URL(request.url!, 'http://local');
      let path = decodeURIComponent(url.pathname);
      const pageRoute = path !== '/api' && !path.startsWith('/api/') && !extname(path);
      if (!allowed(request, false, pageRoute)) { response.writeHead(403); response.end(); return; }
      if (path === '/' && url.searchParams.get('app') === 'skybridge') {
        if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
        response.setHeader('Content-Security-Policy', sandboxPolicy(request));
        response.setHeader('Referrer-Policy', 'no-referrer');
        response.writeHead(200, { 'Content-Type': mime['.html'] }); response.end(sandboxHtml);
        return;
      }
      if (path === mcpAppSandboxPath) {
        if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
        response.setHeader('Content-Security-Policy', mcpAppSandboxPolicy);
        response.setHeader('Referrer-Policy', 'no-referrer');
        response.writeHead(200, { 'Content-Type': mime['.html'] }); response.end(mcpAppSandboxHtml);
        return;
      }
      if (path === '/api/notifications') {
        if (request.method !== 'POST' || !allowed(request, true) || !request.headers['content-type']?.startsWith('application/json')) {
          response.writeHead(403); response.end(); return;
        }
        try {
          let body = '';
          for await (const chunk of request) {
            body += chunk;
            if (Buffer.byteLength(body) > 16384) throw new Error('通知设置请求过大。');
          }
          const result = await notifications.request(JSON.parse(body));
          response.writeHead(200, { 'Content-Type': mime['.json'] }); response.end(JSON.stringify(result));
        } catch (error) {
          response.writeHead(400, { 'Content-Type': mime['.json'] }); response.end(JSON.stringify({ error: (error as Error).message }));
        }
        return;
      }
      if (path === '/api/local-html-preview') {
        await localHtmlPreview(request, response, url.searchParams, sandboxPolicy(request)); return;
      }
      if (path.startsWith('/api/files/')) {
        if (request.method !== 'GET' && request.method !== 'HEAD' && !allowed(request, true)) { response.writeHead(403); response.end(); return; }
        try {
          if (await files.http(request, response, new URL(request.url!, 'http://local'), sandboxPolicy(request))) return;
        } catch (error) {
          response.writeHead(400, { 'Content-Type': mime['.json'] });
          response.end(JSON.stringify({ error: (error as Error).message })); return;
        }
        response.writeHead(404); response.end(); return;
      }
      if (path === '/api/http-fetch') {
        if (request.method !== 'POST' || !allowed(request, true)) { response.writeHead(403); response.end(); return; }
        const controller = new AbortController();
        httpRequests.add(controller);
        request.once('aborted', () => controller.abort());
        response.once('close', () => { if (!response.writableEnded) controller.abort(); });
        try {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of request) {
            size += chunk.length;
            if (size > 16 * 1024 * 1024) throw new Error('HTTP 请求正文过大');
            chunks.push(chunk);
          }
          const { url, init } = configurationRequest(JSON.parse(Buffer.concat(chunks).toString()) as HttpWireRequest);
          const upstream = await (options.httpFetch ?? fetch)(url, { ...init, signal: controller.signal });
          for (const name of ['content-type', 'retry-after', 'x-request-id']) {
            const value = upstream.headers.get(name);
            if (value) response.setHeader(name, value);
          }
          response.writeHead(upstream.status, upstream.statusText);
          if (upstream.body) await pipeline(Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream), response, { signal: controller.signal });
          else response.end();
        } catch (error) {
          if (!response.headersSent && !controller.signal.aborted) {
            response.writeHead(502, { 'Content-Type': mime['.json'], 'X-Workbench-Fetch-Error': '1' });
            response.end(JSON.stringify(httpFailure(error)));
          } else response.destroy();
        } finally { httpRequests.delete(controller); }
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method || '')) { response.writeHead(403); response.end(); return; }
      if (path === clientChromePackagePath) {
        const content = await readFile(join(projectRoot, '.local', 'chrome-client.tgz'));
        response.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': 'attachment; filename="chrome-client.tgz"' });
        response.end(request.method === 'HEAD' ? undefined : content);
        return;
      }
      if (path === '/site.webmanifest') {
        response.writeHead(200, { 'Content-Type': 'application/manifest+json' });
        response.end(request.method === 'HEAD' ? undefined : JSON.stringify(webManifest));
        return;
      }
      if (path === '/favicon.ico') {
        response.writeHead(302, { Location: brandAssets.icon192 });
        response.end();
        return;
      }
      if (path === '/api/configuration/bootstrap') {
        if (!snapshotBody) { response.writeHead(404); response.end(); return; }
        response.setHeader('Cache-Control', 'private, no-cache');
        response.setHeader('ETag', snapshotTag!);
        response.setHeader('Vary', 'Accept-Encoding');
        if (request.headers['if-none-match']?.split(',').some(tag =>
          tag.trim() === snapshotTag || tag.trim() === snapshotTag!.slice(2) || tag.trim() === '*')) {
          response.writeHead(304); response.end(); return;
        }
        const useGzip = acceptsGzip(request.headers['accept-encoding']);
        if (useGzip) response.setHeader('Content-Encoding', 'gzip');
        response.writeHead(200, { 'Content-Type': mime['.json'] });
        response.end(request.method === 'HEAD' ? undefined : useGzip ? compressedSnapshot : snapshotBody);
        return;
      }
      if (path === '/api/status') {
        response.writeHead(200, { 'Content-Type': mime['.json'] });
        response.end(JSON.stringify({ connected: control.connected, rendererVersion, workspace, clients: clients.size,
          appServerVersion: serverVersion(control),
          executionMode: 'shared-daemon',
          scheduler: automations.status(),
          notifications: notifications.status(),
          hosts: [{ hostId: 'local', transport: 'websocket' }, ...catalog.hosts.map(host => ({ hostId: host.hostId, transport: 'ssh-websocket' }))],
          pendingRequests: chromeClients.pendingRequests + httpRequests.size + control.pending.size + [...fileConnections.values(), ...[...clients.values()].flatMap(connections => [...connections.values()])].reduce((sum, connection) => sum + connection.pending.size, 0),
          configurationSnapshot: configurationSnapshot ? { capturedAt: configurationSnapshot.capturedAt, bytes: Buffer.byteLength(configurationSnapshot.data) } : null,
          unsupported: [...unsupported], error: control.lastError })); return;
      }
      if (path === '/source-workspace.css' && sourceStyle) {
        const useGzip = compressedSourceStyle && acceptsGzip(request.headers['accept-encoding']);
        response.setHeader('Vary', 'Accept-Encoding');
        if (useGzip) response.setHeader('Content-Encoding', 'gzip');
        response.writeHead(200, { 'Content-Type': mime['.css'] });
        response.end(request.method === 'HEAD' ? undefined : useGzip ? compressedSourceStyle : sourceStyle);
        return;
      }
      if (path === '/workbench-pinned-entry.js' && sourceHtml && (request.method === 'GET' || request.method === 'HEAD')) {
        const entry = await rendererCache.load('pinned-tool-entry', () => readFile(join(projectRoot, '.local', 'workbench-entry.js')), true);
        const useGzip = entry.compressed && acceptsGzip(request.headers['accept-encoding']);
        response.setHeader('Vary', 'Accept-Encoding');
        if (useGzip) response.setHeader('Content-Encoding', 'gzip');
        response.writeHead(200, { 'Content-Type': mime['.js'] });
        response.end(request.method === 'HEAD' ? undefined : useGzip ? entry.compressed : entry.content);
        return;
      }
      if (options.sourceWorkspace && /^\/source-chunks\/(?:(?:output-files|port-forwarding-view)-[a-z0-9]+\.js|terminal-runtime-[a-z0-9]+\.(?:js|css)|project-emojis-[a-f0-9]{12}\.json)$/i.test(path) &&
          (request.method === 'GET' || request.method === 'HEAD')) {
        const chunk = join(projectRoot, '.local', path.slice(1));
        const cached = await rendererCache.load('source:' + chunk, () => readFile(chunk), true);
        const useGzip = cached.compressed && acceptsGzip(request.headers['accept-encoding']);
        response.setHeader('Vary', 'Accept-Encoding');
        if (useGzip) response.setHeader('Content-Encoding', 'gzip');
        response.writeHead(200, { 'Content-Type': mime[extname(path)]!, 'Cache-Control': 'public, max-age=31536000, immutable' });
        response.end(request.method === 'HEAD' ? undefined : useGzip ? cached.compressed : cached.content);
        return;
      }
      if (path === '/native-host.js' || path === '/workbench-entry.js') {
        const useGzip = acceptsGzip(request.headers['accept-encoding']);
        const content = path === '/native-host.js' ? browserHost : browserEntry;
        const compressed = path === '/native-host.js' ? compressedBrowserHost : compressedBrowserEntry;
        response.setHeader('Vary', 'Accept-Encoding');
        if (useGzip) response.setHeader('Content-Encoding', 'gzip');
        response.writeHead(200, { 'Content-Type': mime['.js'] });
        response.end(request.method === 'HEAD' ? undefined : useGzip ? compressed : content);
        return;
      }
      if (path === '/notification-worker.js') {
        response.writeHead(200, { 'Content-Type': mime['.js'], 'Service-Worker-Allowed': '/' });
        response.end(request.method === 'HEAD' ? undefined : notificationWorker); return;
      }
      // Native route names are extensionless. Preserve the original asset tree.
      if (!extname(path) && !path.startsWith('/api/')) {
        const route = initialWorkspaceRoute(null, url.search, path);
        const html = sourceHtml && !usesPinnedToolRenderer(route)
          ? sourceHtml.replace('<html lang="' + defaultAppLocale + '">', '<html lang="' + workspaceLocale(settings.localeOverride) + '">')
          : pinnedToolHtml;
        response.writeHead(200, { 'Content-Type': mime['.html'] });
        response.end(path === '/' ? html : html.replace('<head>', '<head><meta name="initial-route" content="' + path.replaceAll('"', '&quot;').replaceAll('<', '&lt;') + '">'));
        return;
      }
      const webRenderer = path.startsWith(webRendererPrefix + '/');
      if (webRenderer) path = path.slice(webRendererPrefix.length);
      const assetRoot = path.startsWith('/brand/') ? join(projectRoot, 'public') : renderer;
      const file = resolve(assetRoot, '.' + path);
      if (!file.startsWith(assetRoot + sep)) { response.writeHead(404); response.end(); return; }
      const readAsset = () => loadWebResource(file, path, webRenderer);
      const immutable = path.startsWith('/assets/') && /-[a-f0-9]{8,}\.[^.]+$/.test(path);
      const compressible = /\.(js|mjs|css|svg|json|wasm)$/.test(path);
      const cached = immutable ? await rendererCache.load((webRenderer ? 'web:' : 'original:') + file, readAsset, compressible,
        webRenderer && brotliStartupBundles.has(webRendererPrefix + path)) : null;
      let content = cached?.content ?? await readAsset();
      if (immutable) {
        response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
      if (compressible) {
        response.setHeader('Vary', 'Accept-Encoding');
        const accept = request.headers['accept-encoding'];
        const gzipQuality = encodingQuality(accept, 'gzip');
        const brotliQuality = cached?.brotli ? encodingQuality(accept, 'br') : 0;
        if (cached?.brotli && brotliQuality > 0 && brotliQuality >= gzipQuality) {
          content = cached.brotli;
          response.setHeader('Content-Encoding', 'br');
        } else if (content.length > 1024 && gzipQuality > 0) {
          content = cached?.compressed ?? await compress(content, { level: 1 });
          response.setHeader('Content-Encoding', 'gzip');
        }
      }
      response.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream' });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch { response.writeHead(404); response.end(); }
  });
  const webSockets = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
  const chromeSockets = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
  server.on('upgrade', (request, socket, head) => {
    if (request.url === clientChromePath && allowed(request, true)) {
      let label: string;
      try { label = decodeURIComponent(String(request.headers['x-workbench-device'] ?? '')); } catch { socket.destroy(); return; }
      if (!label || label.length > 120 || /[\r\n\0]/.test(label)) { socket.destroy(); return; }
      const clientKey = chromeClients.authorize(request);
      if (!clientKey) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
      chromeSockets.handleUpgrade(request, socket, head, client => chromeClients.attach(clientKey, client, label));
      return;
    }
    if (request.url !== '/native-host' || !allowed(request, true)) { socket.destroy(); return; }
    webSockets.handleUpgrade(request, socket, head, client => webSockets.emit('connection', client));
  });
  webSockets.on('connection', client => {
    const connections = new Map<string, CodexConnection>();
    clients.set(client, connections);
    // Seed the pinned renderer's existing query-cache bootstrap before its
    // modules mount, avoiding a separate request/update for each sidebar key.
    send(client, { type: 'yard-sidebar-bootstrap', value: {
      catalogEntries: [],
      globalStateEntries: ['local-projects', 'remote-projects', 'selected-project', 'selected-remote-host-id',
        'sidebar-project-thread-orders', 'thread-project-assignments', 'projectless-thread-ids',
        'thread-projectless-output-directories', 'thread-workspace-root-hints', 'pinned-thread-ids',
        'remote-connection-auto-connect-by-host-id', 'codex-managed-remote-connections']
        .map(key => ({ key, value: globals[key] })),
      workspaceRootOptions: { roots: projectRoots(),
        canonicalPathByRoot: Object.fromEntries(projectRoots().map(path => [path, path])) },
      projectlessWorkspaceRoot: { workspaceRoot: join(dataDir, 'workspaces') },
    } });
    const address = server.address() as import('node:net').AddressInfo;
    const browser = new ChromePanelRouter(chromeConnection, chromeClients, message => send(client, message), publicOrigin || `http://127.0.0.1:${address.port}`);
    browsers.set(client, browser);
    const terminal = new TerminalHost({ workspace, connectionFor: hostId => connectedFor(client, connections, hostId),
      send: event => send(client, { type: 'terminal-event', event }) });
    terminals.set(client, terminal);
    client.on('message', data => {
      let message: HostMessage;
      try { message = JSON.parse(String(data)); } catch { client.close(1007); return; }
      void handle(message, client, connections).catch(error => {
        if (message.type === 'fetch') send(client, { type: 'fetch-response', requestId: message.requestId, responseType: 'error', status: 500, error: error.message });
        else if (message.request) send(client, { type: 'mcp-response', hostId: message.hostId ?? 'local', message: { id: message.request.id,
          error: { code: typeof error.code === 'number' ? error.code : -32000, message: error.message,
            data: error.data === undefined ? { uncertain: error.uncertain === true } : error.data } } });
      });
    });
    client.on('close', () => {
      clients.delete(client);
      void browser.close().finally(() => browsers.delete(client));
      // Hang up page-owned shells before closing their daemon connection, so
      // an interactive shell can notify its background jobs before exiting.
      void terminal.dispose().catch(() => {}).finally(() => {
        terminals.delete(client);
        for (const connection of connections.values()) connection.close();
      });
    });
    client.on('error', () => { client.terminate(); });
  });

  function notifyConnection(client: WebSocket, hostId: string, connection: CodexConnection, isSnapshot = false) {
    send(client, { type: 'codex-app-server-connection-changed', hostId, transport: 'websocket', isSnapshot,
      state: connection.connected ? 'connected' : 'disconnected', error: connection.lastError });
    if (connection.connected) {
      const version = serverVersion(connection);
      send(client, { type: 'codex-app-server-initialized', hostId, transport: 'websocket', isSnapshot, appServerVersion: version,
        installedCodexVersion: version, yardSidebarStateAvailable: sidebar.supportsHost(hostId) });
    }
  }

  function connectionFor(client: WebSocket, connections: Map<string, CodexConnection>, hostId: string) {
    validHost(hostId);
    let connection = connections.get(hostId);
    if (connection) return connection;
    const ssh = sshHosts.get(hostId);
    connection = new CodexConnection(ssh ? '' : socketPath, ssh ? {
      createConnection: () => (options.sshStream ?? createSshProxyStream)(ssh, paths => hostPaths.set(hostId, paths)), connectTimeout: 20_000,
    } : { cwd: workspace });
    connections.set(hostId, connection);
    const current = connection;
    current.on('message', (message: { id?: string | number; method: string; params: unknown }) => observeBackend(hostId, message, () => {
      if (message.method === 'thread/readState/changed' || message.method === 'thread/status/changed') return;
      const params = record(message.params);
      if (hostId === 'local' && message.method === 'turn/completed') {
        legacyTitleCalls.delete(JSON.stringify([params.threadId, record(params.turn).id]));
      }
      // Resumed desktop threads retain their dynamic title tool. The pinned
      // renderer rejects that transport before it reaches a host. Reuse the
      // same current-thread handler as MCP without replacing a loaded session.
      if (hostId === 'local' && message.id != null && message.method === 'item/tool/call' &&
          params.namespace === 'codex_app' && params.tool === 'set_thread_title' &&
          typeof params.threadId === 'string' && typeof params.turnId === 'string' && typeof params.callId === 'string') {
        const turnKey = JSON.stringify([params.threadId, params.turnId]);
        let calls = legacyTitleCalls.get(turnKey);
        if (!calls) { calls = new Map(); legacyTitleCalls.set(turnKey, calls); }
        let result = calls.get(params.callId);
        if (!result) {
          result = callHostTool({ callerSource: 'codex', hostId: 'local', namespace: 'codex_app', tool: 'set_thread_title',
            threadId: params.threadId, turnId: params.turnId, callId: params.callId, arguments: params.arguments });
          calls.set(params.callId, result);
        }
        const socket = current.socket;
        void result.then(reply => {
          if (current.socket === socket && current.connected) return current.respond(message.id!, reply);
        })
          // A lost reply is uncertain; never retry a title write on reconnect.
          .catch(() => {});
        return;
      }
      send(client, message.id != null ? { type: 'mcp-request', hostId, request: message }
        : { type: 'mcp-notification', hostId, method: message.method,
          params: message.method === 'thread/settings/updated' ? providerRouting.present(hostId, message.params, String(params.threadId)) : message.params });
    }));
    current.on('status', () => {
      // The daemon survives a client disconnect. Keep other hosts connected;
      // the renderer restores subscriptions when this host reconnects.
      notifyConnection(client, hostId, current);
    });
    return current;
  }

  async function connectedFor(client: WebSocket, connections: Map<string, CodexConnection>, hostId: string) {
    const connection = connectionFor(client, connections, hostId);
    try { await connection.connect(); }
    catch (error) {
      send(client, { type: 'codex-app-server-connection-changed', hostId, transport: 'websocket', state: 'disconnected', error: (error as Error).message });
      throw error;
    }
    await sidebar.ensureHost(hostId);
    return connection;
  }

  async function handle(message: HostMessage, client: WebSocket, connections: Map<string, CodexConnection>) {
    if (await petOverlay.handle(message, value => send(client, value))) return;
    const hostId = message.hostId ?? 'local';
    validHost(hostId);
    if (message.type === 'inbox-item-set-read-state' || message.type === 'inbox-automation-runs-mark-all-read') {
      await automations.fetch(message.type, message); return;
    }
    if (message.type === 'ready') {
      for (const key of ['host_config', 'remote_ssh_connections', 'remote_wsl_connections', 'remote_control_connections']) {
        send(client, { type: 'shared-object-updated', key, value: sharedObject(key) });
      }
      await connectedFor(client, connections, 'local');
      // Initialization RPCs can connect before React subscribes to host events.
      // Replay the state at ready so version-dependent onboarding can finish.
      for (const [id, connection] of connections) notifyConnection(client, id, connection, true);
      return;
    }
    if (message.type === 'shared-object-subscribe') {
      send(client, { type: 'shared-object-updated', key: message.key, value: sharedObject(String(message.key)) });
      return;
    }
    if (message.type === 'mcp-response' && message.response) {
      // Replies belong to an existing connection. Reconnecting here would send
      // an approval to a daemon connection that never received the request.
      const connection = connections.get(hostId);
      if (!connection?.connected) throw new Error('连接已断开，请核对请求状态');
      if (message.response.error) {
        if (!connection.socket || connection.socket.readyState !== WebSocket.OPEN) throw new Error('连接已断开，请核对请求状态');
        connection.socket.send(JSON.stringify(message.response));
      }
      else await connection.respond(message.response.id, message.response.result);
      return;
    }
    if ((message.type === 'mcp-request' || message.type === 'thread-prewarm-start') && message.request) {
      const { method, id } = message.request;
      const isPrewarm = message.type === 'thread-prewarm-start';
      if (isPrewarm && method !== 'thread/start') throw new Error('预热通道只接受 thread/start');
      const params = { ...message.request.params };
      let requestParams = message.request.params == null ? message.request.params : params;
      if (fileMethods.has(method)) {
        if (method === 'fs/createDirectory' || method === 'fs/writeFile') await connectedFor(client, connections, hostId);
        const result = await files.rpc(method, params, hostId, hostPaths.get(hostId)?.codexHome);
        send(client, { type: 'mcp-response', hostId, message: { id, result } }); return;
      }
      const connection = await connectedFor(client, connections, hostId);
      if (!readMethods.has(method) && !writeMethods.has(method)) { unsupported.add(method); throw new Error('Web 宿主尚未接入：' + method); }
      if (method === 'thread/fork' && params.attachToSource === true && !supportsAttachedThreads(serverVersion(connection))) {
        throw new Error('保存侧边对话需要该主机运行 Codex CLI 0.169.1 或更新版本；请先更新后端进程。');
      }
      if (method === 'thread/delete') {
        await guardPrewarmDelete(hostId, String(params.threadId), connection);
      }
      if (options.sourceWorkspace && (method === 'thread/start' || method === 'thread/settings/update') &&
          typeof params.yardPermissionChoice === 'string') {
        const starting = method === 'thread/start';
        const current = starting ? null : await connection.request('thread/resume', { threadId: params.threadId, excludeTurns: true });
        const cwd = current?.thread.cwd ?? params.cwd;
        if (typeof cwd !== 'string') throw new Error('No workspace is selected.');
        const model = current?.model ?? (typeof params.model === 'string' ? params.model : undefined);
        const choices = await connection.permissionCatalog(cwd, {
          model: modelSelection(model)?.model ?? model ?? undefined,
          projectless: starting && !params.projectId,
          current: { approvalsReviewer: current?.approvalsReviewer },
        });
        const selected = choices.find(choice => choice.id === params.yardPermissionChoice && choice.allowed);
        if (!selected) throw new Error('This permission is no longer available. Reopen the menu to refresh it.');
        Object.assign(params, starting ? permissionStart(selected) : selected.native);
        delete params.yardPermissionChoice;
      }
      if (hostId === 'local' && (method === 'thread/start' || method === 'thread/fork')) {
        params.config = { ...record(params.config), ...hostTools.config };
        requestParams = params;
      }
      if (hostId === 'local' && method === 'thread/resume') {
        const loaded = await connection.request('thread/loaded/list', {});
        if (!loaded.data.some(id => id === params.threadId)) {
          params.config = { ...record(params.config), ...hostTools.config };
          requestParams = params;
        }
      }
      // Parameterless RPCs such as config/mcpServer/reload accept null or an
      // omitted params field. Preserve that wire contract instead of sending {}.
      // Installing packages and interactive MCP calls can outlast the normal
      // metadata deadline. Keep the selected connection and never replay writes.
      const pluginRequest = method.startsWith('plugin/') || method.startsWith('marketplace/') || method.startsWith('mcpServer/');
      if (method === 'turn/start' && typeof params.threadId === 'string') prewarmedThreads.publish(hostId, params.threadId);
      const execute = () => method.startsWith('project/') || method.startsWith('threadSection/') || method === 'thread/section/move'
        ? sidebar.request(hostId, method, params)
        : providerRouting.request(hostId, connection, method, requestParams, { mutating: writeMethods.has(method),
          ...(pluginRequest ? { timeoutMs: 300_000 } : {}) });
      let result = isPrewarm ? await prewarmedThreads.start(hostId, execute) : await execute();
      if (method === 'thread/list') result = prewarmedThreads.filterList(hostId, result);
      const responseThreadId = record(record(result).thread).id;
      if (typeof responseThreadId !== 'string' || !prewarmedThreads.isHidden(hostId, responseThreadId)) await sidebar.observeResponse(hostId, method, result);
      if (method === 'thread/metadata/update' && Object.hasOwn(params, 'projectId')) await sidebar.getAssignment(String(params.threadId), hostId);
      if (method === 'turn/start') {
        const turn = record(record(result).turn);
        if (typeof turn.id === 'string') notifications.watch(hostId, String(params.threadId), turn.id);
      }
      if (method === 'thread/resume' || method.startsWith('thread/queue/')) {
        void notifications.trackThread(hostId, String(params.threadId)).catch(() => {});
      }
      if (method === 'thread/archive' || method === 'thread/unarchive') automations.threadArchived(hostId, String(params.threadId), method === 'thread/archive');
      if (method === 'thread/delete') prewarmedThreads.forget(hostId, String(params.threadId));
      // The renderer's browser.in-app capability reads experimentalFeature/list.
      // Manual Chrome transport includes pairing an access computer, even when
      // the optional service-machine Chrome is not configured.
      if (method === 'experimentalFeature/list') {
        const features = Array.isArray(record(result).data) ? record(result).data as ObjectValue[] : [];
        result = { ...record(result), data: features.map(feature => feature.name === 'in_app_browser' || feature.name === 'in_app_local_automation' ? { ...feature, enabled: true } : feature) };
      }
      if (method === 'getAuthStatus') result = { ...record(result), authToken: null };
      send(client, { type: 'mcp-response', hostId, message: { id, result } });
      return;
    }
    if (message.type === 'fetch') {
      const params = typeof message.body === 'string' ? record(JSON.parse(message.body)) : record(message.params);
      const endpoint = message.url?.split('/').at(-1) || '';
      const body = await fetchHost(endpoint, params, client, connections);
      send(client, { type: 'fetch-response', requestId: message.requestId, responseType: 'success', status: 200, headers: {}, body });
      return;
    }
    if (message.type === 'worker-request' && message.request) {
      // The official text preview checks Git for deleted content after an fs
      // error. Every unsupported worker lookup must settle in the same envelope.
      const method = String(message.workerId) + '/' + message.request.method;
      unsupported.add(method);
      send(client, { type: 'worker-response', workerId: message.workerId, response: {
        id: message.request.id, method: message.request.method,
        result: { type: 'error', error: { message: method === 'git/stable-metadata' ? 'Web 宿主尚未接入 Git 仓库比较' : 'Web 宿主尚未接入：' + method } },
      } });
      return;
    }
    // Window controls and telemetry have no browser-side action.
    if (message.type === 'open-url' && typeof message.url === 'string') send(client, { type: 'open-url', url: message.url });
  }

  async function fetchHost(endpoint: string, params: ObjectValue, client: WebSocket, connections: Map<string, CodexConnection>): Promise<unknown> {
    const hostId = typeof params.hostId === 'string' ? params.hostId : 'local';
    validHost(hostId);
    const sidebarHostIds = () => [...new Set(['local', ...[...connections].filter(([, connection]) => connection.connected).map(([id]) => id)])]
      .filter(id => sidebar.supportsHost(id));
    if (fileEndpoints.has(endpoint)) return files.fetch(endpoint, params);
    if (automationEndpoints.has(endpoint)) return automations.fetch(endpoint, params);
    switch (endpoint) {
      case 'thread-goal-objective': {
        await connectedFor(client, connections, hostId);
        return files.goalObjective(params, hostId, hostPaths.get(hostId)!.codexHome);
      }
      case 'development-preview': {
        if (typeof params.url !== 'string') throw new Error('需要开发预览网址');
        return developmentPreviews.open(params.url, hostId);
      }
      case 'source-workspace-permissions': {
        if (!options.sourceWorkspace) throw new Error('The source workspace is disabled.');
        const connection = await connectedFor(client, connections, hostId);
        const model = typeof params.model === 'string' ? modelSelection(params.model)?.model ?? params.model : undefined;
        return publicPermissions(await connection.permissionCatalog(typeof params.cwd === 'string' ? params.cwd : workspace, {
          model, projectless: params.projectless === true,
          current: params.automaticReview === true ? { approvalsReviewer: 'auto_review' } : undefined,
        }));
      }
      case 'model-providers': {
        const connection = await connectedFor(client, connections, hostId);
        if (params.operation === 'set-enabled') {
          if (typeof params.id !== 'string' || typeof params.enabled !== 'boolean') throw new Error('供应商启停参数无效');
          const result = await modelProviders.update(hostId, connection, params.id, params.enabled);
          broadcast({ type: 'yard-model-providers-changed', hostId });
          return result;
        }
        return modelProviders.snapshot(hostId, connection);
      }
      case 'startup-sidebar': {
        if (hostId !== 'local' && !options.sourceWorkspace) throw new Error('The source workspace is disabled.');
        const searchTerm = options.sourceWorkspace && typeof params.searchTerm === 'string' ? params.searchTerm.trim().slice(0, 240) : '';
        const cursor = options.sourceWorkspace && !searchTerm && typeof params.cursor === 'string' ? params.cursor : undefined;
        const connection = hostId === 'local' ? control : await connectedFor(client, connections, hostId);
        const result = prewarmedThreads.filterList(hostId, await connection.request('thread/list', { limit: 50, sortKey: 'recency_at',
          archived: false, modelProviders: null, sourceKinds: [], useStateDbOnly: true,
          ...(searchTerm ? { searchTerm } : {}), ...(cursor === undefined ? {} : { cursor }) }));
        if (!searchTerm) await sidebar.observeThreadList(hostId, result);
        const pins = hostId === 'local' ? undefined : (await sidebar.pins.list({ hostId })).threadIds;
        const snapshot = startupSidebar(result.data as unknown as ObjectValue[], globals, result.readStates ?? {}, hostId, pins, workspaceLocale(settings.localeOverride));
        if (options.sourceWorkspace && !searchTerm) {
          snapshot.nextCursor = result.nextCursor;
          if (hostId === 'local' && cursor === undefined) snapshot.selectedProject = startupProjectSelection(globals['selected-project']);
        }
        return snapshot;
      }
      case 'source-workspace-hosts': {
        if (!options.sourceWorkspace) throw new Error('The source workspace is disabled.');
        return remoteProfiles().map(({ hostId, displayName, autoConnect }) => ({ hostId, displayName, autoConnect }));
      }
      case 'source-sidebar-project': {
        if (!options.sourceWorkspace || typeof params.projectId !== 'string') throw new Error('Invalid workspace project.');
        const connection = hostId === 'local' ? control : await connectedFor(client, connections, hostId);
        await sidebar.ensureHost(hostId);
        const project = sidebarProjectRoots(globals, hostId).find(project => project.id === params.projectId);
        if (!project) throw new Error('The project is no longer available.');
        if (params.operation === 'pin' && typeof params.pinned === 'boolean') {
          await sidebar.setProjectPinned(hostId, project.id, params.pinned);
          return { success: true };
        }
        if (params.operation === 'appearance') {
          const appearance = readProjectAppearance(params.appearance);
          if (params.appearance !== null && !appearance) throw new Error('Invalid project marker.');
          await sidebar.setProjectAppearance(hostId, project.id, appearance);
          return { success: true };
        }
        if (params.operation === 'folders') return { roots: project.paths };
        if (params.operation === 'edit') {
          const name = typeof params.name === 'string' ? params.name.trim() : '';
          if (!name || name.length > 240) throw new Error('Enter a valid project name.');
          let roots: string[] | undefined;
          if (params.roots !== undefined) {
            if (!Array.isArray(params.roots) || !params.roots.length || params.roots.length > 16 ||
                !params.roots.every((root): root is string => typeof root === 'string' && !root.includes('\0') && isAbsolute(root))) {
              throw new Error('Select one or more project folders.');
            }
            roots = [...new Set(params.roots)];
            await Promise.all(roots.filter(path => !project.paths.includes(path)).map(async path => {
              const metadata = record(await files.fetch('workspace-files', { hostId, path, operation: 'getMetadata' }));
              if (metadata.kind !== 'directory') throw new Error('A source folder is unavailable: ' + path);
            }));
          }
          await sidebar.editProject(hostId, project.id, { name, roots });
          return { success: true };
        }
        if (params.operation === 'remove') {
          await sidebar.editProject(hostId, project.id, null);
          const selection = startupProjectSelection(globals['selected-project']);
          if (hostId === 'local' && selection?.type === 'local' && selection.projectId === project.id) {
            globals['selected-project'] = null;
            await persist();
            broadcast({ type: 'global-state-updated', keys: ['selected-project'] });
          }
          return { success: true };
        }
        if (params.operation !== 'read' && params.operation !== 'archive-targets') throw new Error('Invalid project operation.');
        const canonical = sidebar.resolveProjectId(hostId, project.id);
        const projectFor = sidebarThreadProject(globals, hostId);
        const visible = new Map<string, boolean>();
        // A project can display both explicitly assigned conversations and
        // older unassigned conversations that were opened in its folder.
        const scopes = [...(canonical ? [{ projectId: canonical }] : []), ...(project.paths.length ? [{ cwd: project.paths }] : [])];
        const more = await Promise.all(scopes.map(async filter => {
          const cursors = new Set<string>();
          let cursor: string | null = null;
          do {
            const page: ThreadListResponse = prewarmedThreads.filterList(hostId, await connection.request('thread/list', {
              limit: 100, cursor, useStateDbOnly: true, archived: false, sourceKinds: [], ...filter,
            }));
            for (const thread of page.data) {
              const row = record(thread);
              if (!thread.id || thread.ephemeral || row.threadSource === 'ambient_suggestions' || projectFor(row) !== project.id) continue;
              visible.set(thread.id, thread.status?.type === 'active');
            }
            cursor = page.nextCursor;
            if (cursor == null || cursors.has(cursor)) break;
            cursors.add(cursor);
          } while (cursors.size < 5);
          return cursor != null;
        }));
        const partial = !canonical || more.some(Boolean);
        if (params.operation === 'archive-targets') {
          if (partial) throw new Error('The complete project chat list is unavailable. Archive individual chats instead.');
          return [...visible.keys()].sort();
        }
        return { roots: project.paths, count: visible.size, active: [...visible.values()].filter(Boolean).length, partial } satisfies SidebarProjectDetails;
      }
      case 'sidebar-refresh': {
        const ids = sidebarHostIds();
        const results = await Promise.allSettled(ids.map(id => sidebar.refreshHost(id)));
        const failedHostIds = ids.filter((_, index) => results[index]?.status === 'rejected');
        return { success: failedHostIds.length === 0, failedHostIds };
      }
      case 'sidebar-orders': {
        if (params.operation === 'project-order') { await sidebar.setGlobal('project-order', params.ids); return { success: true }; }
        const hostIds = sidebarHostIds();
        const pins = await Promise.all(hostIds.map(async id => ({ id, pins: await sidebar.pins.list({ hostId: id })
          .catch(() => ({ threadIds: sidebar.cachedSectionSnapshot(id).pinnedThreadIds })) })));
        return { projects: hostIds.flatMap(id => sidebar.projects(id).map(project => ({ id: project.id, hostId: id }))),
          pins: pins.flatMap(({ id, pins }) => pins.threadIds.map(threadId => ({ id: threadId, hostId: id }))),
          aliases: globals['app-server-project-id-by-legacy-project-id-by-host'] ?? {} };
      }
      case 'sidebar-sections': {
        await connectedFor(client, connections, hostId);
        if (params.operation === 'snapshot') return sidebar.sectionSnapshot(hostId);
        if (params.operation === 'merge' || params.operation === 'replace') {
          return sidebar.setSections(hostId, params.sections as Parameters<typeof sidebar.setSections>[1], { mode: params.operation,
            ...(Array.isArray(params.deleteSectionIds) ? { deleteSectionIds: params.deleteSectionIds as string[] } : {}) });
        }
        throw new Error('无效的分组操作');
      }
      case 'pinned-thread-sections': {
        const operation = String(params.operation);
        if (operation === 'list') {
          const hostIds = typeof params.hostId === 'string' ? sidebar.supportsHost(hostId) ? [hostId] : [] : sidebarHostIds();
          const groups = await Promise.all(hostIds.map(async id => ({ id, snapshot: await sidebar.sectionSnapshot(id)
            .catch(error => { if (id === 'local' || typeof params.hostId === 'string') throw error; return sidebar.cachedSectionSnapshot(id); }) })));
          return { hostIds, sections: groups.flatMap(({ id, snapshot }) => snapshot.sections.map(section => ({ ...section, hostId: id }))) };
        }
        await connectedFor(client, connections, hostId);
        if (operation === 'members') {
          const snapshot = await sidebar.sectionSnapshot(hostId);
          return snapshot.sections.find(section => section.id === params.sectionId)?.threadIds ?? [];
        }
        if (operation === 'create') {
          if (typeof params.logicalSectionId !== 'string' || typeof params.name !== 'string') throw new Error('无效的分组参数');
          const section = record(record(await sidebar.request(hostId, 'threadSection/create', { name: params.name, appearance: null })).section);
          const id = String(section.id);
          if (typeof params.threadIdToMove === 'string') {
            const connection = await toolConnection(hostId);
            const current = await connection.request('thread/read', { threadId: params.threadIdToMove, includeTurns: false });
            if (params.previousSectionId !== undefined && current.thread.section?.id !== (params.previousSectionId ?? undefined)) throw new Error('会话分组已变化，请刷新后重试');
            await sidebar.request(hostId, 'thread/section/move', { threadId: params.threadIdToMove, sectionId: id });
          }
          return section;
        }
        if (operation === 'update') return record(await sidebar.request(hostId, 'threadSection/update', {
          sectionId: params.sectionId, name: params.name })).section;
        if (operation === 'delete') { await sidebar.request(hostId, 'threadSection/delete', { sectionId: params.sectionId }); return { success: true }; }
        if (operation === 'move') {
          const connection = connectionFor(client, connections, hostId);
          const current = await connection.request('thread/read', { threadId: params.threadId, includeTurns: false });
          if (params.previousSectionId !== undefined && (current.thread.section?.id ?? null) !== params.previousSectionId) return { success: false };
          await sidebar.request(hostId, 'thread/section/move', { threadId: params.threadId, sectionId: params.sectionId ?? null,
            ...(params.beforeThreadId !== undefined ? { beforeThreadId: params.beforeThreadId } : {}) });
          return { success: true };
        }
        throw new Error('无效的分组操作');
      }
      case 'thread-read-state': {
        if (typeof params.threadId !== 'string' || !params.threadId) throw new Error('无效的会话ID');
        const connection = await connectedFor(client, connections, hostId);
        if (params.unread === undefined) return connection.request('thread/read', { threadId: params.threadId, includeTurns: false });
        if (typeof params.unread !== 'boolean' || typeof params.expectedRevision !== 'string') throw new Error('无效的未读状态参数');
        return connection.request('thread/readState/update', { threadId: params.threadId,
          operation: { type: params.unread ? 'unread' : 'read' }, expectedRevision: params.expectedRevision }, { mutating: true });
      }
      case 'upload-local-file-attachments': {
        await toolConnection(hostId);
        const paths = hostPaths.get(hostId);
        if (!paths) throw new Error('附件主机尚未连接');
        return files.uploadLocalFileAttachments(params, hostId, paths.codexHome);
      }
      case 'port-forwarding': return portForwarding.request(params);
      case 'chrome-browser': return browsers.get(client)!.request(params as unknown as ChromeRequest);
      case 'chrome-connections': return chromeClients.connections(params as unknown as ConnectionRequest);
      case 'refresh-remote-connections': return { remoteConnections: remoteProfiles() };
      case 'discover-remote-ssh-connections': return { sshAliases: await discoverSshAliases(options.sshConfigPath) };
      case 'save-codex-managed-remote-ssh-connections': {
        const hosts = savedSshHosts(params.remoteConnections, sshHosts);
        const key = 'codex-managed-remote-connections', previous = globals[key];
        globals[key] = hosts;
        try { await persist(); }
        catch (error) { if (globals[key] === hosts) { if (previous === undefined) delete globals[key]; else globals[key] = previous; } throw error; }
        const next = new Map(hosts.map(host => [host.hostId, host]));
        const changed = [...sshHosts].filter(([id, old]) => {
          const host = next.get(id);
          return !host || old.sshAlias !== host.sshAlias || old.sshHost !== host.sshHost || old.sshPort !== host.sshPort || old.identity !== host.identity;
        });
        catalog.hosts = hosts;
        sshHosts.clear();
        for (const host of hosts) sshHosts.set(host.hostId, host);
        await portForwarding.hostsChanged(changed.map(([id]) => id));
        const closing: Promise<unknown>[] = [];
        for (const [id] of changed) {
          for (const [page, connections] of clients) {
            const connection = connections.get(id);
            connections.delete(id);
            closing.push((terminals.get(page)?.closeHost(id) ?? Promise.resolve()).finally(() => connection?.close()));
            send(page, { type: 'codex-app-server-connection-changed', hostId: id, transport: 'websocket', state: 'disconnected' });
          }
          fileConnections.get(id)?.close(); fileConnections.delete(id); hostPaths.delete(id);
          await sidebar.forgetHost(id);
        }
        broadcast({ type: 'shared-object-updated', key: 'remote_ssh_connections', value: remoteProfiles() });
        await Promise.all(closing);
        return { remoteConnections: remoteProfiles() };
      }
      case 'set-remote-connection-auto-connect': {
        if (!sshHosts.has(hostId) || typeof params.autoConnect !== 'boolean') throw new Error('需要 SSH 主机和连接状态');
        globals['remote-connection-auto-connect-by-host-id'] = {
          ...record(globals['remote-connection-auto-connect-by-host-id']), [hostId]: params.autoConnect,
        };
        await persist();
        broadcast({ type: 'shared-object-updated', key: 'remote_ssh_connections', value: remoteProfiles() });
        if (params.autoConnect) await connectedFor(client, connections, hostId);
        else {
          const connection = connections.get(hostId);
          try { await terminals.get(client)?.closeHost(hostId); }
          finally {
            connections.delete(hostId);
            connection?.close();
            send(client, { type: 'codex-app-server-connection-changed', hostId, transport: 'websocket', state: 'disconnected' });
          }
        }
        return { remoteConnections: remoteProfiles(), state: params.autoConnect ? 'connected' : 'disconnected', error: null };
      }
      case 'set-remote-wsl-connections-enabled': return { remoteWslConnections: [] };
      case 'set-remote-control-connections-enabled': return { remoteControlConnections: [] };
      case 'app-server-connection-state': {
        const connection = connections.get(hostId);
        if (connection) notifyConnection(client, hostId, connection, true);
        return { state: connection?.connected ? 'connected' : connection?.connecting ? 'connecting' : 'disconnected', error: connection?.lastError ?? null };
      }
      case 'thread-projects': {
        if (params.operation === 'getThreadStartProjectId') {
          const assignment = record(params.value);
          if (assignment.projectKind === 'remote') {
            const id = typeof assignment.hostId === 'string' ? assignment.hostId :
              (Array.isArray(globals['remote-projects']) ? globals['remote-projects'] as ObjectValue[] : [])
                .find(project => project.id === assignment.projectId)?.hostId;
            if (typeof id === 'string') await connectedFor(client, connections, id);
          }
        }
        return threadProjects(params.operation as ThreadProjectOperation, params.value);
      }
      case 'list-pinned-threads': return threadPins.list();
      case 'set-thread-pinned': return threadPins.set(params);
      case 'set-pinned-threads-order': return threadPins.setOrder(params);
      case 'custom-avatars': return typeof params.avatarId === 'string' ? petAssets.loadAvatar(params.avatarId) : petAssets.load();
      case 'terminal': return terminals.get(client)!.request(params.operation as TerminalOperation, params.args as unknown[]);
      case 'queued-follow-up-send-lock-acquire':
      case 'queued-follow-up-send-lock-release': {
        const { conversationId, messageId, lockId } = params;
        if (typeof conversationId !== 'string' || !conversationId || typeof messageId !== 'string' || !messageId || typeof lockId !== 'string' || !lockId) {
          throw new Error('发送协调需要 conversationId、messageId 和 lockId');
        }
        const request = { conversationId, messageId, lockId };
        if (endpoint === 'queued-follow-up-send-lock-acquire') return { acquired: queuedSendLocks.acquire(request) };
        queuedSendLocks.release({ ...request, sent: params.sent === true });
        return null;
      }
      case 'get-settings': return { values: settings, configuredValues: settings };
      case 'codex-command-keymap-state': return { bindings: [], keymapPath: null, supported: false,
        primaryNumberShortcutTarget: settings['primary-number-shortcut-target'] ?? 'tabs' };
      case 'get-setting': return { value: settings[String(params.key)] };
      case 'set-setting': settings[String(params.key)] = params.value; await persist(); petOverlay.settingChanged(String(params.key)); return { success: true };
      case 'get-global-state': await sidebar.ensureHost('local'); return { value: globals[String(params.key)] };
      case 'set-global-state': {
        const key = String(params.key);
        if (sidebar.ownsGlobal(key)) await sidebar.setGlobal(key, params.value);
        else { globals[key] = params.value; await persist(); broadcast({ type: 'global-state-updated', keys: [key] }); }
        return { success: true };
      }
      case 'os-info': return { platform: 'linux', osVersion: 'Web', osRelease: 'Web', isSystemBackdropSupported: false, isVsCodeRunningInsideWsl: false, isCodexRunningInsideWsl: false };
      case 'locale-info': return { ideLocale: defaultAppLocale, systemLocale: defaultAppLocale };
      case 'codex-home':
      case 'home-directory': {
        if (hostId !== 'local') await connectedFor(client, connections, hostId);
        const paths = hostPaths.get(hostId)!;
        return endpoint === 'codex-home' ? { codexHome: paths.codexHome } : { homeDirectory: paths.homeDirectory };
      }
      case 'projectless-workspace-root': {
        if (hostId !== 'local') throw new Error('请选择已登记的 SSH 项目目录');
        return { workspaceRoot: join(dataDir, 'workspaces') };
      }
      case 'projectless-thread-cwd': {
        if (hostId !== 'local') throw new Error('请选择已登记的 SSH 项目目录');
        const workspaceRoot = join(dataDir, 'workspaces');
        await mkdir(workspaceRoot, { recursive: true });
        const cwd = await mkdtemp(join(workspaceRoot, 'chat-'));
        return { cwd, outputDirectory: cwd, workspaceRoot };
      }
      case 'workspace-root-options': {
        await sidebar.ensureHost(hostId);
        const roots = projectRoots(hostId);
        return { roots, canonicalPathByRoot: Object.fromEntries(roots.map(path => [path, path])) };
      }
      case 'mcp-codex-config': return { config: {} }; // Private session adapter is merged on the server.
      case 'developer-instructions': return { instructions: '' };
      case 'is-copilot-api-available': return { available: false };
      case 'get-copilot-api-proxy-info': return null;
      case 'codex-command-keymap-state': return { bindings: [], keymapPath: null, supported: false };
      default: unsupported.add(endpoint); throw new Error('Web 宿主尚未接入：' + endpoint);
    }
  }
  try {
    await control.connect();
    await sidebar.ensureHost('local');
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    automations.start();
    notifications.start();
  } catch (error) { prewarmedThreads.close(); clearInterval(reconnectControl); await developmentPreviews.close(); await notifications.close(); await automations.close(); control.close(); await hostTools.close(); throw error; }
  return {
    server, control, automations, notifications,
    url: 'http://127.0.0.1:' + (server.address() as import('node:net').AddressInfo).port,
    async close() {
      prewarmedThreads.close();
      clearInterval(reconnectControl);
      await Promise.all([portForwarding.close(), developmentPreviews.close()]);
      await automations.close();
      await notifications.close();
      chromeClients.close();
      files.close();
      await Promise.all([...browsers.values()].map(browser => browser.close()));
      await Promise.all([...terminals.values()].map(terminal => terminal.dispose()));
      for (const connection of fileConnections.values()) connection.close();
      for (const controller of httpRequests) controller.abort();
      for (const [client, connections] of clients) { client.terminate(); for (const connection of connections.values()) connection.close(); }
      control.close(); webSockets.close(); chromeSockets.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await hostTools.close(); await nativeTools.close(); await threadProjects('flush', undefined); await persistQueue;
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let socketPath = process.env.AGENTS_CODEX_SOCKET;
  if (!socketPath) {
    console.error('Starting or reusing the Codex CLI daemon…');
    const { stdout } = await promisify(execFile)(process.env.AGENTS_CODEX_BIN || 'codex', ['app-server', 'daemon', 'start'],
      { timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });
    const daemon = JSON.parse(stdout) as { socketPath?: string };
    if (!daemon.socketPath) throw new Error('Codex CLI did not return a daemon socket. Check the supported CLI versions in README.md.');
    socketPath = daemon.socketPath;
  }
  const app = await createNativeWorkbench({ socketPath, sourceWorkspace: process.env.AGENTS_SOURCE_WORKSPACE === '1' });
  console.log(JSON.stringify({ url: app.url, rendererVersion, mode: 'Codex CLI daemon' }));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}
