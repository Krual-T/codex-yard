import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, mkdtemp, rename, realpath, chmod } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { CodexConnection } from '../../lib/codex.ts';
import { createAppTools } from '../../lib/app-tools.ts';
import { appToolCatalog, createHostToolHandler } from '../../lib/host-tools.ts';
import { projectRoot, rendererVersion } from '../../lib/app-resources.ts';
import { record, publicConfig, readMethods, writeMethods } from './protocol.ts';
import type { HostMessage, ObjectValue } from './protocol.ts';
import { createThreadProjects, readThreadProjectState } from './thread-projects.ts';
import { mergeThreadProjectCatalog } from './thread-project-catalog.ts';
import { createThreadProjectInventory } from './thread-project-inventory.ts';
import type { ThreadProjectOperation } from './thread-projects.ts';
import { configurationRequest, httpFailure } from './http-fetch.ts';
import type { HttpWireRequest } from './http-fetch.ts';
import { loadConfigurationSnapshot } from './configuration-snapshot.ts';
import { loadHostCatalog, publicHost } from './hosts.ts';
import type { HostCatalog } from './hosts.ts';
import { createSshProxyStream } from './ssh.ts';
import type { HostPaths } from './ssh.ts';
import { createQueuedSendLocks } from './queued-send-locks.ts';
import { createPreferenceWrites } from './preference-writes.ts';
import { createStateMutations } from './state-mutations.ts';
import { readToolHistory } from './tool-history.ts';
import { createConversationWrites } from './conversation-writes.ts';
import { editMessage } from './message-edit.ts';
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
  const configurationSnapshot = await loadConfigurationSnapshot(join(dataDir, 'configuration-snapshot'), rendererVersion);
  const snapshotBody = configurationSnapshot ? Buffer.from(JSON.stringify(configurationSnapshot)) : null;
  const compressedSnapshot = snapshotBody ? await compress(snapshotBody, { level: 1 }) : null;
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
  const files = createFiles({ dataDir, workspace, hosts: sshHosts, remoteCommand: options.remoteFileCommand,
    async request(hostId, method, params, mutating = false) {
      validHost(hostId);
      let connection = hostId === 'local' ? control : fileConnections.get(hostId);
      if (!connection) {
        connection = new CodexConnection('', { createConnection: () => (options.sshStream ?? createSshProxyStream)(sshHosts.get(hostId)!, paths => hostPaths.set(hostId, paths)), connectTimeout: 20_000 });
        fileConnections.set(hostId, connection);
      }
      await connection.connect();
      return connection.request(method, params, { mutating });
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
  const pendingServerRequests = new Map<WebSocket, Map<string, { socket: WebSocket; generation: string }>>();
  const connectionGenerations = new WeakMap<WebSocket, string>();
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
  const control = new CodexConnection(socketPath, { cwd: workspace });
  let persistQueue = Promise.resolve();
  function persist() {
    const snapshot = JSON.stringify({ globals, settings }, null, 2) + '\n';
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
  const stateMutations = createStateMutations();
  let projectCompatibility: import('./thread-projects.ts').ThreadProjectCompatibility = {};
  let projectInventoryGeneration = 0;
  const compatibility = { resolveLegacyThreadHosts: (id: string) => projectCompatibility.resolveLegacyThreadHosts?.(id) };
  const threadProjects = createThreadProjects(globals, persist, broadcast, validHost, compatibility, stateMutations);
  const petOverlay = createPetOverlay(globals, settings, persist, broadcast, stateMutations);
  const writePreference = createPreferenceWrites(settings, globals, persist, broadcast, key => petOverlay.settingChanged(key), stateMutations);
  const petAssets = createPetAssets(codexHome);
  function remoteProfiles() {
    const preferences = record(globals['remote-connection-auto-connect-by-host-id']);
    return catalog.hosts.map(host => ({ ...publicHost(host), autoConnect: preferences[host.hostId] === true }));
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
      if (path === '/api/configuration/bootstrap') {
        if (!snapshotBody) { response.writeHead(404); response.end(); return; }
        const useGzip = acceptsGzip(request.headers['accept-encoding']);
        response.setHeader('Vary', 'Accept-Encoding');
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
          hosts: [{ hostId: 'local', transport: 'websocket' }, ...catalog.hosts.map(host => ({ hostId: host.hostId, transport: 'ssh-websocket' }))],
          pendingRequests: chromeClients.pendingRequests + httpRequests.size + control.pending.size + [...fileConnections.values(), ...[...clients.values()].flatMap(connections => [...connections.values()])].reduce((sum, connection) => sum + connection.pending.size, 0),
          configurationSnapshot: configurationSnapshot ? { capturedAt: configurationSnapshot.capturedAt, bytes: Buffer.byteLength(configurationSnapshot.data) } : null,
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
      pendingServerRequests.delete(client);
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
    current.on('message', (message: { id?: string | number; method: string; params: unknown; seq?: number }) => {
      const params = record(message.params);
      if (message.method === 'serverRequest/resolved') pendingServerRequests.get(client)?.delete(JSON.stringify([hostId, params.requestId]));
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
      if (message.id != null && current.socket) {
        const requests = pendingServerRequests.get(client) ?? new Map<string, { socket: WebSocket; generation: string }>();
        const connectionGeneration = connectionGenerations.get(current.socket) ?? crypto.randomUUID();
        connectionGenerations.set(current.socket, connectionGeneration);
        // A daemon may reuse a resolved JSON-RPC id on the same socket.
        const generation = connectionGeneration + ':' + crypto.randomUUID();
        requests.set(JSON.stringify([hostId, message.id]), { socket: current.socket, generation }); pendingServerRequests.set(client, requests);
      }
      send(client, message.id != null ? { type: 'mcp-request', hostId, request: message,
        requestRef: { hostId, id: message.id, generation: pendingServerRequests.get(client)?.get(JSON.stringify([hostId, message.id]))?.generation } }
        : { type: 'mcp-notification', hostId, method: message.method, params: message.params, seq: message.seq });
    });
    current.on('status', () => {
      // The daemon survives a client disconnect. Keep other hosts connected;
      // the renderer restores subscriptions when this host reconnects.
      if (!current.connected) {
        const requests = pendingServerRequests.get(client);
        for (const [key] of requests ?? []) if ((JSON.parse(key) as [string, unknown])[0] === hostId) requests?.delete(key);
      }
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
      const key = JSON.stringify([hostId, message.response.id]);
      const requests = pendingServerRequests.get(client);
      const pending = requests?.get(key);
      if (!pending || pending.socket !== connection.socket || message.generation !== pending.generation) throw new Error('请求已失效，请核对当前会话状态');
      requests?.delete(key);
      if (message.response.error) {
        if (!connection.socket || connection.socket.readyState !== WebSocket.OPEN) throw new Error('连接已断开，请核对请求状态');
        await new Promise<void>((resolve, reject) => connection.socket!.send(JSON.stringify(message.response), error => {
          if (error) reject(Object.assign(new Error('回答发送结果待确认，请核对请求状态。'), { uncertain: true })); else resolve();
        }));
      }
      else await connection.respond(message.response.id, message.response.result);
      if (message.requestId) send(client, { type: 'server-request-response', requestId: message.requestId, success: true });
      return;
    }
    if ((message.type === 'mcp-request' || message.type === 'thread-prewarm-start') && message.request) {
      const { method, id } = message.request;
      const params = { ...message.request.params };
      if (fileMethods.has(method)) {
        if (method === 'fs/createDirectory' || method === 'fs/writeFile') await connectedFor(client, connections, hostId);
        const result = await files.rpc(method, params, hostId, hostPaths.get(hostId)?.codexHome);
        send(client, { type: 'mcp-response', hostId, message: { id, result } }); return;
      }
      const connection = await connectedFor(client, connections, hostId);
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
      const request = () => connection.requestWithCursor(method, params, { mutating: writeMethods.has(method) });
      const response = ['turn/start', 'thread/revert', 'thread/queue/start'].includes(method) && typeof params.threadId === 'string'
        ? await conversationWrite(hostId, params.threadId, request) : await request();
      let result = response.result;
      if (method === 'thread/start' && record(record(result).thread).id) createdThreads.add(hostId + ':' + String(record(record(result).thread).id));
      if (method === 'thread/delete') createdThreads.delete(hostId + ':' + String(params.threadId));
      if (method === 'config/read') result = publicConfig(result);
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
    const hostId = typeof params.hostId === 'string' ? params.hostId : 'local';
    validHost(hostId);
    if (fileEndpoints.has(endpoint)) return files.fetch(endpoint, params);
    switch (endpoint) {
      case 'chrome-browser': return browsers.get(client)!.request(params as unknown as ChromeRequest);
      case 'chrome-connections': return chromeClients.connections(params as unknown as ConnectionRequest);
      case 'refresh-remote-connections': return { remoteConnections: remoteProfiles() };
      case 'set-remote-connection-auto-connect': {
        if (!sshHosts.has(hostId) || typeof params.autoConnect !== 'boolean') throw new Error('需要 SSH 主机和连接状态');
        await stateMutations.run(async () => {
          const key = 'remote-connection-auto-connect-by-host-id', existed = Object.hasOwn(globals, key), previous = globals[key];
          globals[key] = { ...record(previous), [hostId]: params.autoConnect };
          try { await persist(); }
          catch (error) { if (existed) globals[key] = previous; else delete globals[key]; throw error; }
        });
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
      case 'thread-project-state': {
        const generation = ++projectInventoryGeneration;
        const inventory = createThreadProjectInventory(['local', ...sshHosts.keys()], id => connectedFor(client, connections, id));
        const status = await inventory.refresh();
        if (generation === projectInventoryGeneration) projectCompatibility = inventory.compatibility;
        await stateMutations.flush();
        return { ...readThreadProjectState(globals, inventory.compatibility), inventory: status,
          catalog: { local: globals['local-projects'], remote: globals['remote-projects'] } };
      }
      case 'thread-projects': return threadProjects(params.operation as ThreadProjectOperation, params.value);
      case 'message-edit': {
        if (typeof params.threadId !== 'string' || !params.threadId) throw new Error('编辑需要会话身份。');
        const connection = await connectedFor(client, connections, hostId);
        return conversationWrite(hostId, params.threadId, () => editMessage(connection, hostId, params.threadId as string, params));
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
      case 'get-settings': await stateMutations.flush(); return { values: settings, configuredValues: settings };
      case 'codex-command-keymap-state': return { bindings: [], keymapPath: null, supported: false,
        primaryNumberShortcutTarget: settings['primary-number-shortcut-target'] ?? 'tabs' };
      case 'get-setting': await stateMutations.flush(); return { value: settings[String(params.key)] };
      case 'set-setting': return writePreference('setting', String(params.key ?? ''), params.value);
      case 'get-global-state': await stateMutations.flush(); return { value: globals[String(params.key)] };
      case 'set-global-state': return writePreference('global', String(params.key ?? ''), params.value);
      case 'os-info': return { platform: 'linux', osVersion: 'Web', osRelease: 'Web', isSystemBackdropSupported: false, isVsCodeRunningInsideWsl: false, isCodexRunningInsideWsl: false };
      case 'locale-info': return { ideLocale: 'zh-CN', systemLocale: 'zh-CN' };
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
