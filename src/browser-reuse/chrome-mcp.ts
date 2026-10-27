import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type ChromeConnection = { autoConnect: true; windowsSsh?: { host: string; mcpEntry: string } } | { browserUrl: string };
export interface ToolResult {
  isError?: boolean;
  content: { type: string; text?: string; data?: string; mimeType?: string }[];
  structuredContent?: { pages?: { id: number; url: string; title?: string; selected: boolean }[] };
}
export interface BrowserTools { callTool(name: string, args?: Record<string, unknown>): Promise<ToolResult> }
export interface BrowserView { text: string; pageId?: number; image?: string; capturedAt?: string }

export function connectionArgs(connection: ChromeConnection): string[] {
  if ('autoConnect' in connection) return ['--autoConnect'];
  const url = new URL(connection.browserUrl);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PoC 仅连接本机回环 HTTP 调试地址；跨电脑连接需要另行批准的通道');
  }
  return ['--browserUrl', url.origin];
}

export function chromeCommand(connection: ChromeConnection) {
  const args = [...connectionArgs(connection), '--experimental-vision', '--experimental-structured-content', '--no-usage-statistics', '--no-performance-crux'];
  const remote = 'autoConnect' in connection ? connection.windowsSsh : undefined;
  if (remote) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(remote.host) || !/^[a-zA-Z]:[\\/]/.test(remote.mcpEntry) || /[\0\r\n]/.test(remote.mcpEntry)) {
      throw new Error('请指定已有 SSH 别名和 Windows 上已安装官方 MCP 的绝对入口路径');
    }
    const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
    // EncodedCommand avoids interpreting paths as commands in the SSH user's
    // default shell. Environment and encoding changes last only this process.
    const script = "$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); " +
      "$env:CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS = '1'; & node " + [remote.mcpEntry, ...args].map(literal).join(' ') + '; exit $LASTEXITCODE';
    return { command: 'ssh', args: ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=yes',
      '-o', 'UpdateHostKeys=no', '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '--', remote.host,
      'powershell', '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')] };
  }
  const entry = new URL('./bin/chrome-devtools-mcp.js', pathToFileURL(createRequire(import.meta.url).resolve('chrome-devtools-mcp')));
  return { command: process.execPath, args: [fileURLToPath(entry), ...args] };
}

// MCP stdio uses one JSON-RPC message per line. Never replay a tool call after
// a timeout: an input action may already have reached the real browser.
export async function connectChrome(connection: ChromeConnection, timeoutMs = 60_000) {
  const launch = chromeCommand(connection);
  const child = spawn(launch.command, launch.args, {
    stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1' },
  });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  let nextId = 0, closed = false;
  // Tool failures are returned over JSON-RPC. Do not persist browser data/logs.
  child.stderr.resume();
  function fail(error: Error) {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
  }
  child.on('error', fail);
  child.stdin.on('error', fail);
  child.on('exit', () => { closed = true; fail(new Error('Chrome MCP 已断开，请核对标签页结果后重新连接')); });
  lines.on('line', line => {
    let message: { id?: number; result?: unknown; error?: { message: string } };
    try { message = JSON.parse(line); } catch { return; }
    if (message.id == null) return;
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id); clearTimeout(item.timer);
    if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result);
  });
  function request(method: string, params: unknown): Promise<unknown> {
    if (closed) return Promise.reject(new Error('Chrome MCP 已断开'));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        closed = true;
        fail(new Error('浏览器操作超时，结果尚未确认；请在真实标签页核对，操作不会自动重发'));
        child.kill();
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n', error => { if (error) fail(error); });
    });
  }
  async function close() {
    if (child.exitCode !== null || child.signalCode !== null) return;
    closed = true; fail(new Error('浏览器连接已结束'));
    // End only our stdio MCP/SSH process. Attached Chrome is owned by the user.
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), 1500);
    const hardStop = setTimeout(() => child.kill('SIGKILL'), 4000);
    await new Promise<void>(resolve => child.once('exit', () => resolve()));
    clearTimeout(timer); clearTimeout(hardStop); lines.close();
  }
  try {
    await request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'codex-yard-chrome', version: '0.2.0' } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  } catch (error) { await close(); throw error; }
  return {
    async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
      const result = await request('tools/call', { name, arguments: args }) as ToolResult;
      if (result.isError) throw new Error(result.content.filter(item => item.type === 'text').map(item => item.text).join('\n'));
      return result;
    }, close,
  };
}

export function resultText(result: ToolResult) { return result.content.filter(item => item.type === 'text').map(item => item.text ?? '').join('\n'); }

// MCP 1.12 requires an explicit pageId on page tools. Serialize one panel's
// action and capture so inputs are never silently sent to another tab.
export function createBrowserSession(tools: BrowserTools) {
  let queue: Promise<unknown> = Promise.resolve();
  return {
    run(action: string, value: Record<string, unknown> = {}): Promise<BrowserView> {
      const result = queue.catch(() => {}).then(async () => {
        if (action === 'pages') return { text: resultText(await tools.callTool('list_pages')) };
        const pageId = value.pageId;
        if (typeof pageId !== 'number' || !Number.isSafeInteger(pageId) || pageId < 1) throw new Error('请选择有效的标签页 ID');
        const names: Record<string, string> = { navigate: 'navigate_page', click: 'click', fill: 'fill', key: 'press_key' };
        if (!['view', 'focus', ...Object.keys(names)].includes(action)) throw new Error('不支持的浏览器操作');
        let args: Record<string, unknown> = {};
        if (action === 'navigate') {
          const url = new URL(String(value.url));
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('请输入不含凭据的 HTTP 或 HTTPS 地址');
          args = { type: 'url', url: url.href };
        }
        if (action === 'click' || action === 'fill') {
          if (typeof value.uid !== 'string' || !/^\d+_\d+$/.test(value.uid)) throw new Error('请使用当前页面结构中的元素 UID');
          args = { uid: value.uid, ...(action === 'fill' ? { value: String(value.text ?? '') } : {}) };
        }
        if (action === 'key') {
          if (typeof value.key !== 'string' || value.key.length > 80) throw new Error('请输入按键名');
          args = { key: value.key };
        }
        // Foreground capture is explicit PoC behavior. Background capture
        // stalled in the installed headless Chrome during UI verification.
        await tools.callTool('select_page', { pageId, bringToFront: true });
        if (names[action]) await tools.callTool(names[action]!, { pageId, ...args });
        const text = resultText(await tools.callTool('take_snapshot', { pageId }));
        const screenshot = await tools.callTool('take_screenshot', { pageId, format: 'jpeg', quality: 65 });
        const image = screenshot.content.find(item => item.type === 'image');
        if (!image?.data || image.mimeType !== 'image/jpeg') throw new Error('Chrome MCP 未返回 JPEG 画面');
        return { pageId, text, image: 'data:image/jpeg;base64,' + image.data, capturedAt: new Date().toISOString() };
      });
      queue = result;
      return result;
    },
  };
}
