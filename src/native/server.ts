import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, mkdtemp, open, rename, realpath, chmod } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { CodexConnection } from '../../lib/codex.ts';
import { createAppTools } from '../../lib/app-tools.ts';
import { appToolCatalog, createHostToolHandler } from '../../lib/host-tools.ts';
import { projectRoot, rendererVersion } from '../../lib/app-resources.ts';
import type { ConfigReadSource } from '../../lib/config-write-protocol.ts';
import { ApprovalRequestRegistry } from './approval-requests.ts';
import { record, publicConfig, readMethods, writeMethods } from './protocol.ts';
import type { HostMessage, ObjectValue } from './protocol.ts';
import { createThreadProjects, readThreadProjectState } from './thread-projects.ts';
import { mergeThreadProjectCatalog } from './thread-project-catalog.ts';
import { createThreadProjectInventory } from './thread-project-inventory.ts';
import type { ThreadProjectOperation } from './thread-projects.ts';
import { configurationRequest, httpFailure } from './http-fetch.ts';
import type { HttpWireRequest } from './http-fetch.ts';
import { loadHostCatalog } from './hosts.ts';
import type { HostCatalog } from './hosts.ts';
import { createSshProxyStream } from './ssh.ts';
import type { HostPaths } from './ssh.ts';
import { createQueuedSendLocks } from './queued-send-locks.ts';
import { createPreferenceWrites } from './preference-writes.ts';
import { createStateMutations } from './state-mutations.ts';
import { createConfigWrites } from './config-writes.ts';
import { createConfigWriteTargets } from './config-write-targets.ts';
import { createConfigWriteHost } from './config-write-host.ts';
import { createRemoteConnectionPreferences } from './remote-connection-preferences.ts';
import { createProjectCatalogWrites } from './project-catalog-writes.ts';
import { readToolHistory } from './tool-history.ts';
import { createConversationWrites } from './conversation-writes.ts';
import { editMessage } from './message-edit.ts';
import { findSubmission } from './message-submission-status.ts';
import { createFiles, fileEndpoints, fileMethods } from './files.ts';
import type { RemoteFileCommand } from './files.ts';
import { createPetOverlay } from './pet-overlay.ts';
import { createPetAssets } from './pet-assets.ts';
import { webManifest, brandAssets } from './visual-feedback.ts';
import { TerminalHost } from './terminal.ts';
import type { TerminalOperation } from './terminal-protocol.ts';
import { chromeConnectionFromEnv } from '../browser-reuse/panel-host.ts';
import { ChromePanelRouter } from '../browser-reuse/panel-router.ts';
import { ClientChromeBroker } from '../browser-reuse/client-broker.ts';
import { clientChromePath, clientChromePackagePath } from '../browser-reuse/client-protocol.ts';
import type { ConnectionRequest } from '../browser-reuse/client-protocol.ts';
import type { ChromeConnection } from '../browser-reuse/chrome-mcp.ts';
import type { ChromeRequest } from '../browser-reuse/protocol.ts';
import { visualizationSandboxPolicy } from './visualizations.ts';

interface Options { port?: number; socketPath?: string; codexHome?: string; dataDir?: string; workspace?: string; renderer?: string; adapterPath?: string; publicOrigin?: string; httpFetch?: typeof fetch; hostCatalog?: HostCatalog; sshStream?: typeof createSshProxyStream; remoteFileCommand?: RemoteFileCommand; chromeConnection?: ChromeConnection }
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.wasm': 'application/wasm', '.json': 'application/json', '.mp3': 'audio/mpeg',
};
const compress = promisify(gzip);
function serverVersion(connection: CodexConnection) {
  return connection.server?.userAgent.match(/^[^/]+\/(\S+)/)?.[1] ?? null;
}
function acceptsGzip(value = '') {
  return value.split(',').some(encoding => {
    const [name, ...parameters] = encoding.trim().split(';');
    const quality = parameters.find(parameter => parameter.trim().startsWith('q='));
    return name === 'gzip' && (quality === undefined || Number(quality.trim().slice(2)) > 0);
  });
}

export async function createNativeWorkbench(options: Options = {}) {
  const port = options.port ?? Number(process.env.PORT || 8765);
  const codexHome = options.codexHome || process.env.CODEX_HOME || join(homedir(), '.codex');
  const workspace = await realpath(options.workspace || process.env.AGENTS_WORKSPACE || homedir());
  const socketPath = options.socketPath || process.env.AGENTS_CODEX_SOCKET || join(codexHome, 'app-server-control', 'app-server-control.sock');
  const dataDir = options.dataDir || process.env.AGENTS_DATA_DIR || join(projectRoot, '.local');
  const renderer = options.renderer || join(projectRoot, '.local', 'renderer');
  const publicOrigin = options.publicOrigin ?? process.env.AGENTS_PUBLIC_ORIGIN ?? '';
  const chromeConnection = options.chromeConnection ?? chromeConnectionFromEnv();
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
  if (publicOrigin) {
    const url = new URL(publicOrigin);
    if (url.protocol !== 'https:' || url.origin !== publicOrigin || url.username || url.password || url.hostname.includes('*')) {
      throw new Error('AGENTS_PUBLIC_ORIGIN 必须是精确 HTTPS 来源');
    }
  }
  const sandboxScript = await readFile(join(projectRoot, '.local', 'visualization-sandbox.js'), 'utf8');
  const sandboxHtml = '<!doctype html><html><head><meta charset="utf-8"><title>Visualization</title></head><body><script>' +
    sandboxScript.replaceAll('</script', '<\\/script') + '</script></body></html>';
  const html = await readFile(join(projectRoot, 'public', 'index.html'), 'utf8');
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
  const hostPaths = new Map<string, HostPaths>([['local', { homeDirectory: homedir(), codexHome }]]);
  const fileConnections = new Map<string, CodexConnection>();
  const control = new CodexConnection(socketPath, { cwd: workspace });
  const stateMutations = createStateMutations();
  const ownedPaths = new WeakMap<CodexConnection, { paths?: HostPaths; sshHost: typeof catalog.hosts[number] }>();
  const connectionSnapshots = new WeakMap<WebSocket, { connection: CodexConnection; hostId: string; paths: HostPaths; sshHost?: typeof catalog.hosts[number] }>();
  const connectionGenerations = new WeakMap<WebSocket, string>();
  async function ownedConnectionFor(hostId: string) {
    validHost(hostId);
    let connection = hostId === 'local' ? control : fileConnections.get(hostId);
    if (!connection) {
      const snapshot = { sshHost: { ...sshHosts.get(hostId)! }, paths: undefined as HostPaths | undefined };
      connection = new CodexConnection('', { createConnection: () => (options.sshStream ?? createSshProxyStream)(snapshot.sshHost, paths => {
        snapshot.paths = { ...paths }; hostPaths.set(hostId, paths);
      }), connectTimeout: 20_000 });
      ownedPaths.set(connection, snapshot);
      fileConnections.set(hostId, connection);
    }
    await connection.connect();
    const remote = ownedPaths.get(connection);
    const paths = hostId === 'local' ? { homeDirectory: homedir(), codexHome } : remote?.paths;
    if (connection.socket && paths) connectionSnapshots.set(connection.socket, {
      connection, hostId, paths: { ...paths }, ...(remote ? { sshHost: { ...remote.sshHost } } : {}),
    });
    return connection;
  }
  function configurationSource(hostId: string, connection: CodexConnection, socket: WebSocket | undefined): ConfigReadSource {
    const snapshot = socket && connectionSnapshots.get(socket);
    if (!socket || !connection.connected || connection.socket !== socket || socket.readyState !== WebSocket.OPEN
      || snapshot?.hostId !== hostId || snapshot.connection !== connection) throw new Error('The original settings connection changed. Reload the settings.');
    let generation = connectionGenerations.get(socket);
    if (!generation) { generation = crypto.randomUUID(); connectionGenerations.set(socket, generation); }
    return { hostId, generation, homeDirectory: snapshot.paths.homeDirectory, codexHome: snapshot.paths.codexHome };
  }
  const files = createFiles({ dataDir, workspace, hosts: sshHosts, remoteCommand: options.remoteFileCommand,
    mutations: stateMutations, activeConfiguration: () => configurationWrites.activeForFile() !== null,
    async request(hostId, method, params, mutating = false, onLateTerminal) {
      const connection = await ownedConnectionFor(hostId);
      return connection.request(method, params, { mutating, onLateTerminal,
        ...(onLateTerminal ? { retainLateUntilDisconnect: true as const } : {}) });
    },
  });
  function validHost(hostId: string) { if (hostId !== 'local' && !sshHosts.has(hostId)) throw new Error('未登记的执行主机：' + hostId); }
  if (!globals['remote-projects']) globals['remote-projects'] = catalog.projects;
  globals['thread-project-assignments'] = mergeThreadProjectCatalog(globals['thread-project-assignments'], catalog.assignments);
  const projects = await load('projects.json', []) as { path: string; name: string }[];
  if (!globals['local-projects']) globals['local-projects'] = Object.fromEntries(projects.map(project => [project.path, {
    id: project.path, name: project.name, rootPaths: [project.path], createdAt: Date.now(), updatedAt: Date.now(),
  }]));
  const clients = new Map<WebSocket, Map<string, CodexConnection>>();
  const approvalRequests = new ApprovalRequestRegistry<WebSocket, WebSocket>();
  const observedApprovalSockets = new WeakSet<WebSocket>();
  function observeApprovalSocket(page: WebSocket, hostId: string, socket: WebSocket) {
    if (observedApprovalSockets.has(socket)) return;
    observedApprovalSockets.add(socket);
    const source = { page, hostId, socket };
    if (socket.readyState !== WebSocket.OPEN) approvalRequests.disconnect(source);
    else socket.once('close', () => approvalRequests.disconnect(source));
  }
  const terminals = new Map<WebSocket, TerminalHost>();
  const browsers = new Map<WebSocket, ChromePanelRouter>();
  const chromeClients = new ClientChromeBroker({ configured: !!chromeConnection, label:
    chromeConnection && 'autoConnect' in chromeConnection && chromeConnection.windowsSsh
      ? chromeConnection.windowsSsh.host : hostname() });
  const queuedSendLocks = createQueuedSendLocks();
  const conversationWrite = createConversationWrites();
  const createdThreads = new Set<string>();
  const unsupported = new Set<string>();
  const httpRequests = new Set<AbortController>();
  let persistQueue = Promise.resolve();
  function persist() {
    const snapshot = JSON.stringify({ ...state, globals, settings }, null, 2) + '\n';
    persistQueue = persistQueue.catch(() => {}).then(async () => {
      const temporary = join(dataDir, `native-state.${crypto.randomUUID()}.tmp`);
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(snapshot); await file.sync(); } finally { await file.close(); }
      await rename(temporary, join(dataDir, 'native-state.json'));
      const directory = await open(dataDir, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    });
    return persistQueue;
  }
  function send(client: WebSocket, message: unknown) {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message));
  }
  function broadcast(message: unknown) { for (const client of clients.keys()) send(client, message); }
  const configurationWrites = createConfigWrites({ state, persist, mutations: stateMutations,
    findFileBlocker: () => files.hasUnresolvedSaves(),
    resolveTarget: createConfigWriteTargets({
      getConnectionSnapshot: ({ hostId, connection, socket }) => {
        const snapshot = socket instanceof WebSocket ? connectionSnapshots.get(socket) : undefined;
        return snapshot?.connection === connection && snapshot.hostId === hostId ? snapshot : undefined;
      },
      remoteCommand: options.remoteFileCommand,
    }),
  });
  const configurationWriteHost = createConfigWriteHost<{ client: WebSocket; connections: Map<string, CodexConnection> }>({
    writes: configurationWrites, validateHost: validHost,
    async connect(hostId, _context, source) {
      const connection = await ownedConnectionFor(hostId), socket = connection.socket;
      const current = configurationSource(hostId, connection, socket);
      if (source.hostId !== current.hostId || source.generation !== current.generation
        || source.homeDirectory !== current.homeDirectory || source.codexHome !== current.codexHome) {
        throw new Error('The original settings source changed. Reload the settings before saving.');
      }
      return { connection, socket };
    },
  });
  const addProject = createProjectCatalogWrites(globals, stateMutations, persist, broadcast);
  let projectCompatibility: import('./thread-projects.ts').ThreadProjectCompatibility = {};
  let projectInventoryGeneration = 0;
  const compatibility = { resolveLegacyThreadHosts: (id: string) => projectCompatibility.resolveLegacyThreadHosts?.(id) };
  const threadProjects = createThreadProjects(globals, persist, broadcast, validHost, compatibility, stateMutations);
  const petOverlay = createPetOverlay(globals, settings, persist, broadcast, stateMutations);
  const writePreference = createPreferenceWrites(settings, globals, persist, broadcast, key => petOverlay.settingChanged(key), stateMutations);
  const petAssets = createPetAssets(codexHome);
  const remotePreferences = createRemoteConnectionPreferences(catalog.hosts, globals, stateMutations, persist, broadcast);
  const remoteProfiles = remotePreferences.read;
  async function sharedObject(key: string) {
    if (key === 'host_config') return { id: 'local', kind: 'local' };
    if (key === 'remote_ssh_connections') return remoteProfiles();
    if (key === 'remote_wsl_connections' || key === 'remote_control_connections') return [];
    return undefined;
  }
  const callHostTool = createHostToolHandler({
    connection: control,
    knownThread: async (id: string) => control.request('thread/read', { threadId: id, includeTurns: false }),
    listProjects: async () => ({ projects, workspace }),
    listThreads: async params => control.request('thread/list', { ...params, archived: false }),
    readThread: (params, options) => readToolHistory(control, params, options),
  });
  const hostTools = await createAppTools({ adapterPath: options.adapterPath, socketPath: join(dataDir, 'app-tools.sock'), tools: appToolCatalog, callTool: callHostTool });
  // A daemon request is broadcast to every page subscribed to its thread.
  // Retain each result through the turn so another page or a replay only replies.
  const legacyTitleCalls = new Map<string, Map<string, ReturnType<typeof callHostTool>>>();
  const reconnectControl = setInterval(() => {
    if (!control.connected) void control.connect().catch(() => {});
  }, 2000);
  reconnectControl.unref();

  function allowed(request: import('node:http').IncomingMessage, requireOrigin = false, pageRoute = false) {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    const localOrigins = [`http://127.0.0.1:${actualPort}`, `http://localhost:${actualPort}`];
    const allowedOrigins = [...localOrigins, ...(publicOrigin ? [publicOrigin] : [])];
    const hosts = allowedOrigins.map(origin => new URL(origin).host);
    const documentNavigation = pageRoute && !requireOrigin && request.method === 'GET' &&
      request.headers['sec-fetch-mode'] === 'navigate' && request.headers['sec-fetch-dest'] === 'document';
    return hosts.includes(request.headers.host || '') &&
      (request.headers['sec-fetch-site'] !== 'cross-site' || documentNavigation) &&
      (!request.headers.origin ? !requireOrigin : allowedOrigins.includes(request.headers.origin));
  }
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self' blob:; img-src 'self' data: blob:; media-src 'self' data: blob:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; worker-src 'self' blob:; frame-ancestors 'self'");
    try {
      const url = new URL(request.url!, 'http://local');
      let path = decodeURIComponent(url.pathname);
      const pageRoute = path !== '/api' && !path.startsWith('/api/') && !extname(path);
      if (!allowed(request, false, pageRoute)) { response.writeHead(403); response.end(); return; }
      if (path === '/' && url.searchParams.get('app') === 'skybridge') {
        if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
        response.setHeader('Content-Security-Policy', visualizationSandboxPolicy);
        response.setHeader('Referrer-Policy', 'no-referrer');
        response.writeHead(200, { 'Content-Type': mime['.html'] }); response.end(sandboxHtml);
        return;
      }
      if (path.startsWith('/api/files/')) {
        if (request.method !== 'GET' && request.method !== 'HEAD' && !allowed(request, true)) { response.writeHead(403); response.end(); return; }
        try {
          if (await files.http(request, response, new URL(request.url!, 'http://local'))) return;
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
      if (path === '/api/status') {
        response.writeHead(200, { 'Content-Type': mime['.json'] });
        response.end(JSON.stringify({ connected: control.connected, rendererVersion, workspace, clients: clients.size,
          appServerVersion: serverVersion(control),
          executionMode: 'shared-daemon',
          hosts: [{ hostId: 'local', transport: 'websocket' }, ...catalog.hosts.map(host => ({ hostId: host.hostId, transport: 'ssh-websocket' }))],
          pendingRequests: chromeClients.pendingRequests + httpRequests.size + control.pending.size + [...fileConnections.values(), ...[...clients.values()].flatMap(connections => [...connections.values()])].reduce((sum, connection) => sum + connection.pending.size, 0),
          unsupported: [...unsupported], error: control.lastError })); return;
      }
      // Native route names are extensionless. Preserve the original asset tree.
      if (!extname(path) && !path.startsWith('/api/')) {
        response.writeHead(200, { 'Content-Type': mime['.html'] });
        response.end(path === '/' ? html : html.replace('<head>', '<head><meta name="initial-route" content="' + path.replaceAll('"', '&quot;').replaceAll('<', '&lt;') + '">'));
        return;
      }
      const assetRoot = path.startsWith('/brand/') ? join(projectRoot, 'public') : renderer;
      const file = resolve(assetRoot, '.' + path);
      if (!file.startsWith(assetRoot + sep)) { response.writeHead(404); response.end(); return; }
      let content: Buffer = await readFile(file);
      if (path === '/workbench-entry.js' || path === '/workbench-entry.css') response.setHeader('Cache-Control', 'no-store');
      else if (/^\/(assets|chunks)\//.test(path)) {
        response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
      if (/\.(js|mjs|css|svg|json|wasm)$/.test(path)) {
        response.setHeader('Vary', 'Accept-Encoding');
        if (content.length > 1024 && acceptsGzip(request.headers['accept-encoding'])) {
          content = await compress(content, { level: 1 });
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
        if (message.type === 'mcp-response' && message.requestId) send(client, { type: 'server-request-response', requestId: message.requestId, error: error.message, uncertain: error.uncertain === true });
        else if (message.type === 'fetch') send(client, { type: 'fetch-response', requestId: message.requestId, responseType: 'error', status: 500, error: error.message, uncertain: error.uncertain === true });
        else if (message.request) send(client, { type: 'mcp-response', hostId: message.hostId ?? 'local', message: { id: message.request.id,
          error: { code: typeof error.code === 'number' ? error.code : -32000, message: error.message,
            data: error.data === undefined ? { uncertain: error.uncertain === true } : error.data } } });
      });
    });
    client.on('close', () => {
      clients.delete(client);
      approvalRequests.closePage(client);
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
      send(client, { type: 'codex-app-server-initialized', hostId, transport: 'websocket', isSnapshot, appServerVersion: version, installedCodexVersion: version });
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
    current.on('message', (message, sourceSocket) => {
      if (!sourceSocket || sourceSocket !== current.socket || sourceSocket.readyState !== WebSocket.OPEN) return;
      observeApprovalSocket(client, hostId, sourceSocket);
      const source = { page: client, hostId, socket: sourceSocket };
      const params = record(message.params);
      const registered = message.id != null ? approvalRequests.register(source, {
        id: message.id, threadId: typeof params.threadId === 'string' ? params.threadId : null,
        ...(message.method === 'item/tool/requestUserInput' && typeof params.turnId === 'string' ? { inputTurnId: params.turnId } : {}),
      }) : undefined;
      if (registered && registered.status !== 'registered') return;
      const resolved = message.method === 'serverRequest/resolved'
        && (typeof params.requestId === 'string' || typeof params.requestId === 'number')
        ? approvalRequests.resolve(source, { requestId: params.requestId, threadId: typeof params.threadId === 'string' ? params.threadId : null }) : null;
      if (hostId === 'local' && message.method === 'turn/completed') {
        legacyTitleCalls.delete(JSON.stringify([params.threadId, record(params.turn).id]));
      }
      // Resumed desktop threads retain their dynamic title tool. The pinned
      // renderer rejects that transport before it reaches a host. Reuse the
      // same current-thread handler as MCP without replacing a loaded session.
      if (hostId === 'local' && message.id != null && message.method === 'item/tool/call' &&
          params.namespace === 'codex_app' && params.tool === 'set_thread_title' &&
          typeof params.threadId === 'string' && typeof params.turnId === 'string' && typeof params.callId === 'string') {
        if (registered?.status !== 'registered') return;
        const claimed = approvalRequests.claim(source, registered.ref);
        if (claimed.status !== 'claimed') return;
        const turnKey = JSON.stringify([params.threadId, params.turnId]);
        let calls = legacyTitleCalls.get(turnKey);
        if (!calls) { calls = new Map(); legacyTitleCalls.set(turnKey, calls); }
        let result = calls.get(params.callId);
        if (!result) {
          result = callHostTool({ callerSource: 'codex', hostId: 'local', namespace: 'codex_app', tool: 'set_thread_title',
            threadId: params.threadId, turnId: params.turnId, callId: params.callId, arguments: params.arguments });
          calls.set(params.callId, result);
        }
        void result.then(reply => {
          const payload = JSON.stringify({ id: message.id, result: reply });
          return approvalRequests.dispatch(claimed.claim, socket => new Promise<void>((resolve, reject) => {
            if (socket.readyState !== WebSocket.OPEN) { reject(new Error('Original socket closed')); return; }
            socket.send(payload, error => error ? reject(error) : resolve());
          }));
        })
          // A lost reply is uncertain; never retry a title write on reconnect.
          .catch(() => {});
        return;
      }
      send(client, registered?.status === 'registered' ? { type: 'mcp-request', hostId, request: message, requestRef: registered.ref }
        : { type: 'mcp-notification', hostId, method: message.method, params: message.params, seq: message.seq,
          ...(resolved?.status === 'resolved' ? { requestRef: resolved.ref } : {}) });
    });
    current.on('status', () => {
      // The daemon survives a client disconnect. Keep other hosts connected;
      // the renderer restores subscriptions when this host reconnects.
      if (current.socket) observeApprovalSocket(client, hostId, current.socket);
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
    return connection;
  }

  async function handle(message: HostMessage, client: WebSocket, connections: Map<string, CodexConnection>) {
    if (await petOverlay.handle(message, value => send(client, value))) return;
    const hostId = message.hostId ?? 'local';
    validHost(hostId);
    if (message.type === 'ready') {
      for (const key of ['host_config', 'remote_ssh_connections', 'remote_wsl_connections', 'remote_control_connections']) {
        send(client, { type: 'shared-object-updated', key, value: await sharedObject(key) });
      }
      await connectedFor(client, connections, 'local');
      // Initialization RPCs can connect before React subscribes to host events.
      // Replay the state at ready so version-dependent onboarding can finish.
      for (const [id, connection] of connections) notifyConnection(client, id, connection, true);
      return;
    }
    if (message.type === 'shared-object-subscribe') {
      send(client, { type: 'shared-object-updated', key: message.key, value: await sharedObject(String(message.key)) });
      return;
    }
    if (message.type === 'mcp-response' && message.response) {
      // Replies belong to an existing connection. Reconnecting here would send
      // an approval to a daemon connection that never received the request.
      const connection = connections.get(hostId);
      if (!connection?.connected) throw new Error('连接已断开，请核对请求状态');
      const socket = connection.socket;
      if (!socket || socket.readyState !== WebSocket.OPEN || typeof message.generation !== 'string') throw new Error('请求已失效，请核对请求状态');
      const payload = JSON.stringify(message.response);
      const claimed = approvalRequests.claim({ page: client, hostId, socket }, { hostId, id: message.response.id, generation: message.generation });
      if (claimed.status !== 'claimed') throw new Error('请求已失效或已回答，请核对原请求状态');
      const dispatched = await approvalRequests.dispatch(claimed.claim, original => new Promise<void>((resolve, reject) => {
        if (original.readyState !== WebSocket.OPEN) { reject(new Error('Original socket closed')); return; }
        original.send(payload, error => error ? reject(error) : resolve());
      }));
      if (dispatched.status !== 'sent') throw Object.assign(new Error(dispatched.status === 'unknown'
        ? '回答发送结果待确认，请核对原请求状态。' : '原请求已失效，回答未发送。'), { uncertain: dispatched.status === 'unknown' });
      if (message.requestId) send(client, { type: 'server-request-response', requestId: message.requestId, success: true });
      return;
    }
    if ((message.type === 'mcp-request' || message.type === 'thread-prewarm-start') && message.request) {
      const { method, id } = message.request;
      const params = { ...message.request.params };
      if (method === 'config/batchWrite' || method === 'skills/config/write') {
        throw new Error('Configuration changes require an original operation ID through configuration-write.');
      }
      if (fileMethods.has(method)) {
        if (method === 'fs/createDirectory' || method === 'fs/writeFile') await connectedFor(client, connections, hostId);
        const result = await files.rpc(method, params, hostId, hostPaths.get(hostId)?.codexHome);
        send(client, { type: 'mcp-response', hostId, message: { id, result } }); return;
      }
      const readsConfigurationSource = method === 'config/read' || method === 'skills/list';
      const connection = readsConfigurationSource ? await ownedConnectionFor(hostId) : await connectedFor(client, connections, hostId);
      const sourceSocket = connection.socket;
      const readSource = readsConfigurationSource ? configurationSource(hostId, connection, sourceSocket) : undefined;
      if (!readMethods.has(method) && !writeMethods.has(method)) { unsupported.add(method); throw new Error('Web 宿主尚未接入：' + method); }
      if (method === 'thread/delete') {
        if (!createdThreads.has(hostId + ':' + String(params.threadId))) throw new Error('仅清理本次宿主创建的空预热对话');
        const { thread } = await connection.request('thread/read', { threadId: params.threadId, includeTurns: true });
        if (thread.turns?.length || thread.status?.type !== 'idle') throw new Error('对话已有内容，保留当前数据');
      }
      if (hostId === 'local' && (method === 'thread/start' || method === 'thread/fork')) {
        params.config = { ...record(params.config), ...hostTools.config };
      }
      if (hostId === 'local' && method === 'thread/resume') {
        const loaded = await connection.request('thread/loaded/list', {});
        if (!loaded.data.some(id => id === params.threadId)) params.config = { ...record(params.config), ...hostTools.config };
      }
      const observeSubscription = message.observeSubscriptionTerminal === true && ['thread/resume', 'thread/unsubscribe'].includes(method);
      const request = () => connection.requestWithCursor(method, params, { mutating: writeMethods.has(method),
        onLateTerminal: observeSubscription ? terminal => {
          if (connections.get(hostId) !== connection) return;
          send(client, { type: 'mcp-response', hostId, late: true, message: terminal.outcome === 'success'
            ? { id, result: terminal.result } : { id, error: { code: -32000, message: terminal.error.message, data: terminal.error.data } } });
        } : undefined });
      const response = ['turn/start', 'thread/revert', 'thread/queue/start'].includes(method) && typeof params.threadId === 'string'
        ? await conversationWrite(hostId, params.threadId, request) : await request();
      let result = response.result;
      if (method === 'thread/start' && record(record(result).thread).id) createdThreads.add(hostId + ':' + String(record(record(result).thread).id));
      if (method === 'thread/delete') createdThreads.delete(hostId + ':' + String(params.threadId));
      if (method === 'config/read') result = publicConfig(result);
      if (readSource) {
        const current = configurationSource(hostId, connection, sourceSocket);
        if (current.generation !== readSource.generation || current.homeDirectory !== readSource.homeDirectory || current.codexHome !== readSource.codexHome) {
          throw new Error('The settings source changed while reading. Reload the settings.');
        }
        result = { ...record(result), yardConfigSource: readSource };
      }
      // The renderer's browser.in-app capability reads experimentalFeature/list.
      // Manual Chrome transport includes pairing an access computer, even when
      // the optional service-machine Chrome is not configured.
      if (method === 'experimentalFeature/list') {
        const features = Array.isArray(record(result).data) ? record(result).data as ObjectValue[] : [];
        result = { ...record(result), data: features.map(feature => feature.name === 'in_app_browser' ? { ...feature, enabled: true } : feature) };
      }
      if (method === 'getAuthStatus') result = { ...record(result), authToken: null };
      send(client, { type: 'mcp-response', hostId, message: { id, result }, eventCursor: response.eventCursor });
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
    if (endpoint === 'configuration-write') return configurationWriteHost.handle(params, { client, connections });
    const hostId = typeof params.hostId === 'string' ? params.hostId : 'local';
    validHost(hostId);
    if (fileEndpoints.has(endpoint)) return files.fetch(endpoint, params);
    switch (endpoint) {
      case 'approval-request-interrupt': {
        const ref = record(params.ref), connection = connections.get(hostId), socket = connection?.socket;
        if (!connection?.connected || !socket || socket.readyState !== WebSocket.OPEN || ref.hostId !== hostId
          || typeof ref.generation !== 'string' || !(typeof ref.id === 'string' || typeof ref.id === 'number' && Number.isFinite(ref.id))
          || typeof params.threadId !== 'string' || !params.threadId || typeof params.turnId !== 'string' || !params.turnId)
          throw Object.assign(new Error('原输入请求不可用，未停止其他会话。'), { uncertain: false });
        const claim = approvalRequests.claim({ page: client, hostId, socket },
          { hostId, id: ref.id, generation: ref.generation }, { threadId: params.threadId, turnId: params.turnId });
        if (claim.status !== 'claimed') throw Object.assign(new Error('原输入请求已失效或正在处理。'), { uncertain: false });
        const dispatched = await approvalRequests.dispatch(claim.claim, original => {
          if (connection.socket !== original || original.readyState !== WebSocket.OPEN) throw new Error('Original input connection closed');
          return connection.request('turn/interrupt', { threadId: params.threadId, turnId: params.turnId }, { mutating: true }).then(() => undefined);
        });
        if (dispatched.status !== 'sent') throw Object.assign(new Error('停止原任务的结果待确认，请检查原会话。'), { uncertain: dispatched.status === 'unknown' });
        return null;
      }
      case 'chrome-browser': return browsers.get(client)!.request(params as unknown as ChromeRequest);
      case 'chrome-connections': return chromeClients.connections(params as unknown as ConnectionRequest);
      case 'refresh-remote-connections': return { remoteConnections: await remoteProfiles() };
      case 'set-remote-connection-auto-connect': {
        if (!sshHosts.has(hostId) || typeof params.autoConnect !== 'boolean') throw new Error('需要 SSH 主机和连接状态');
        await remotePreferences.setAutoConnect(hostId, params.autoConnect);
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
        return { remoteConnections: await remoteProfiles(), state: params.autoConnect ? 'connected' : 'disconnected', error: null };
      }
      case 'set-remote-wsl-connections-enabled': return { remoteWslConnections: [] };
      case 'set-remote-control-connections-enabled': return { remoteControlConnections: [] };
      case 'app-server-connection-state': {
        const connection = connections.get(hostId);
        if (connection) notifyConnection(client, hostId, connection, true);
        return { state: connection?.connected ? 'connected' : connection?.connecting ? 'connecting' : 'disconnected', error: connection?.lastError ?? null };
      }
      case 'thread-project-state': {
        await stateMutations.flush();
        const unresolved = readThreadProjectState(globals, {}).unresolved;
        const needsInventory = unresolved.projectless.length > 0 || ['assignments', 'outputDirectories', 'workspaceRoots']
          .some(key => Object.keys(unresolved[key as 'assignments' | 'outputDirectories' | 'workspaceRoots']).length > 0);
        if (!needsInventory) return { ...readThreadProjectState(globals, compatibility), inventory: { complete: true, errors: {} },
          catalog: { local: globals['local-projects'], remote: globals['remote-projects'] } };
        const generation = ++projectInventoryGeneration;
        const inventory = createThreadProjectInventory(['local', ...sshHosts.keys()], async id => {
          const connection = id === 'local' ? control : connections.get(id) ?? fileConnections.get(id);
          if (!connection?.connected) throw new Error('主机未连接，旧项目归属尚未核实。');
          return connection;
        });
        const status = await inventory.refresh();
        if (generation === projectInventoryGeneration) projectCompatibility = inventory.compatibility;
        await stateMutations.flush();
        return { ...readThreadProjectState(globals, inventory.compatibility), inventory: status,
          catalog: { local: globals['local-projects'], remote: globals['remote-projects'] } };
      }
      case 'thread-projects': return threadProjects(params.operation as ThreadProjectOperation, params.value);
      case 'project-add': return addProject(hostId, params.path, params.name);
      case 'message-edit': {
        if (typeof params.threadId !== 'string' || !params.threadId) throw new Error('编辑需要会话身份。');
        const connection = await connectedFor(client, connections, hostId);
        return conversationWrite(hostId, params.threadId, () => editMessage(connection, hostId, params.threadId as string, params));
      }
      case 'message-send-status': {
        if (typeof params.threadId !== 'string' || typeof params.clientUserMessageId !== 'string') throw new Error('核对发送需要原会话及请求身份。');
        const action = params.action ?? 'send';
        if (action !== 'send' && action !== 'queue' && action !== 'steer') throw new Error('提交动作无效。');
        return findSubmission(await connectedFor(client, connections, hostId), params.threadId, params.clientUserMessageId, action);
      }
      case 'custom-avatars': return typeof params.avatarId === 'string' ? petAssets.loadAvatar(params.avatarId) : petAssets.load();
      case 'terminal': return terminals.get(client)!.request(params.operation as TerminalOperation, params.args as unknown[]);
      case 'queued-follow-up-send-lock-acquire':
      case 'queued-follow-up-send-lock-release': {
        const { conversationId, messageId, lockId } = params;
        if (typeof conversationId !== 'string' || !conversationId || typeof messageId !== 'string' || !messageId || typeof lockId !== 'string' || !lockId) {
          throw new Error('发送协调需要 conversationId、messageId 和 lockId');
        }
        const request = { hostId, conversationId, messageId, lockId };
        if (endpoint === 'queued-follow-up-send-lock-acquire') return { acquired: queuedSendLocks.acquire(request) };
        queuedSendLocks.release({ ...request, sent: params.sent === true });
        return null;
      }
      case 'get-settings': return stateMutations.run(() => {
        const values = structuredClone(settings);
        return { values, configuredValues: values };
      });
      case 'codex-command-keymap-state': return { bindings: [], keymapPath: null, supported: false,
        primaryNumberShortcutTarget: settings['primary-number-shortcut-target'] ?? 'tabs' };
      case 'get-setting': return stateMutations.run(() => ({ value: structuredClone(settings[String(params.key)]), exists: Object.hasOwn(settings, String(params.key)) }));
      case 'set-setting': return writePreference('setting', String(params.key ?? ''), params.value, params.expected);
      case 'get-global-state': return stateMutations.run(() => ({ value: structuredClone(globals[String(params.key)]), exists: Object.hasOwn(globals, String(params.key)) }));
      case 'set-global-state': return writePreference('global', String(params.key ?? ''), params.value, params.expected);
      case 'os-info': return { platform: 'linux', osVersion: 'Web', osRelease: 'Web', isSystemBackdropSupported: false, isVsCodeRunningInsideWsl: false, isCodexRunningInsideWsl: false };
      // The Web host has no IDE/device UI locale; the requesting browser owns
      // auto detection. Persisted localeOverride continues to take precedence.
      case 'locale-info': return { ideLocale: null, systemLocale: null };
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
        const roots = hostId === 'local' ? projects.map(project => project.path)
          : catalog.projects.filter(project => project.hostId === hostId).map(project => project.remotePath);
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
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  } catch (error) { clearInterval(reconnectControl); control.close(); await hostTools.close(); throw error; }
  return {
    server, control,
    url: 'http://127.0.0.1:' + (server.address() as import('node:net').AddressInfo).port,
    async close() {
      clearInterval(reconnectControl);
      chromeClients.close();
      files.close();
      await Promise.all([...browsers.values()].map(browser => browser.close()));
      await Promise.all([...terminals.values()].map(terminal => terminal.dispose()));
      for (const connection of fileConnections.values()) connection.close();
      for (const controller of httpRequests) controller.abort();
      for (const [client, connections] of clients) { client.terminate(); for (const connection of connections.values()) connection.close(); }
      control.close(); webSockets.close(); chromeSockets.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await hostTools.close(); await stateMutations.flush(); await persistQueue;
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
  const app = await createNativeWorkbench({ socketPath });
  console.log(JSON.stringify({ url: app.url, rendererVersion, mode: 'Codex CLI daemon' }));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}
