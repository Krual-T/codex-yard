#!/usr/bin/env node
import { hostname } from 'node:os';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import { ChromePanelHost } from './panel-host.ts';
import { clientChromePath } from './client-protocol.ts';
import type { ClientChromeMessage } from './client-protocol.ts';
import type { ChromeConnection } from './chrome-mcp.ts';

export interface ClientOptions { origin: string; token: string; label?: string; connection?: ChromeConnection }

export function clientEndpoint(origin: string) {
  const url = new URL(origin);
  if (url.origin !== origin || url.username || url.password ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) {
    throw new Error('工作台地址需要 HTTPS；本机测试可使用回环 HTTP 地址');
  }
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = clientChromePath;
  return url.href;
}

/** This process runs on the access computer. It only attaches the official MCP
 * to existing Chrome, and it closes its own stdio sessions on disconnection. */
export function startChromeClient(options: ClientOptions) {
  const endpoint = clientEndpoint(options.origin);
  if (!/^[a-zA-Z0-9_-]{32}$/.test(options.token)) throw new Error('配对凭据无效，请在面板重新生成');
  const label = options.label ?? hostname();
  if (!label || label.length > 120 || /[\r\n\0]/.test(label)) throw new Error('电脑名称无效');
  const socket = new WebSocket(endpoint, { origin: options.origin, headers: {
    Authorization: 'Bearer ' + options.token, 'X-Workbench-Device': encodeURIComponent(label),
  }, maxPayload: 16 * 1024 * 1024, handshakeTimeout: 15_000 });
  const hosts = new Map<string, ChromePanelHost>();
  let settled = false;
  let readyResolve: () => void, readyReject: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  let closedResolve: () => void;
  const closed = new Promise<void>(resolve => { closedResolve = resolve; });
  let cleaning: Promise<void> | undefined;
  const cleanup = () => cleaning ??= (async () => {
    if (!settled) { settled = true; readyReject(new Error('配对连接已结束，请在面板重新生成配对命令')); }
    await Promise.all([...hosts.values()].map(host => host.close()));
    hosts.clear(); closedResolve();
  })();
  socket.on('message', data => {
    let message: ClientChromeMessage | { type: 'paired' };
    try { message = JSON.parse(String(data)); } catch { socket.close(1007); return; }
    if (!message || typeof message !== 'object') { socket.close(1007); return; }
    if (message.type === 'paired') { if (!settled) { settled = true; readyResolve(); } return; }
    if (!('session' in message) || typeof message.session !== 'string' || message.session.length > 80) { socket.close(1007); return; }
    if (message.type === 'release') {
      const host = hosts.get(message.session);
      hosts.delete(message.session); void host?.close(); return;
    }
    if (message.type !== 'request' || typeof message.id !== 'string' || !message.request) { socket.close(1007); return; }
    let host = hosts.get(message.session);
    if (!host) {
      host = new ChromePanelHost(options.connection ?? { autoConnect: true }, () => {}, options.origin);
      hosts.set(message.session, host);
    }
    const { id } = message;
    void host.request(message.request).then(state => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'result', id,
        state: { ...state, location: `Chrome · ${label}（当前访问电脑）` } }));
    }, error => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'result', id, error: (error as Error).message }));
    });
  });
  socket.on('error', error => {
    if (!settled) { settled = true; readyReject(new Error('连接工作台失败：' + error.message)); }
    socket.terminate(); void cleanup();
  });
  socket.on('close', () => { void cleanup(); });
  return { ready, closed, async close() { socket.terminate(); await cleanup(); } };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('codex-yard-chrome --connect <工作台 HTTPS 地址> --pair <面板的一次性配对凭据> [--name <电脑名称>]');
    console.log('先在 Chrome 打开 chrome://inspect/#remote-debugging 并启用调试；连接时由 Chrome 询问授权。按 Ctrl+C 断开，保留真实标签。');
    return;
  }
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!, value = args[i + 1];
    if (!['--connect', '--pair', '--name', '--browser-url'].includes(key) || !value || values.has(key)) throw new Error('无效参数，使用 --help 查看接入方式');
    values.set(key, value);
  }
  if (!values.has('--connect') || !values.has('--pair')) throw new Error('请复制工作台浏览器面板里的完整配对命令');
  const client = startChromeClient({ origin: values.get('--connect')!, token: values.get('--pair')!, label: values.get('--name'),
    connection: values.has('--browser-url') ? { browserUrl: values.get('--browser-url')! } : undefined });
  const stop = () => { void client.close(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await client.ready;
    console.log('已配对工作台。请回到浏览器面板刷新，并在 Chrome 的连接询问中允许调试。按 Ctrl+C 断开。');
    await client.closed;
    console.log('连接已结束。真实 Chrome 和标签页保留；重新连接请在面板生成新的配对命令。');
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); await client.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch(error => { console.error((error as Error).message); process.exitCode = 1; });
}
