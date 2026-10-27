import { parseArgs } from 'node:util';
import { connectChrome } from '../src/browser-reuse/chrome-mcp.ts';
import { startBrowserPreview } from '../src/browser-reuse/preview-server.ts';

const { values } = parseArgs({ options: { 'auto-connect': { type: 'boolean' }, 'browser-url': { type: 'string' },
  'ssh-host': { type: 'string' }, 'mcp-entry': { type: 'string' }, port: { type: 'string' } } });
if (Boolean(values['auto-connect']) === Boolean(values['browser-url'])) throw new Error('指定 --auto-connect 或 --browser-url，二选一。此入口不会启动浏览器或开启调试权限。');
const remote = values['ssh-host'];
if (Boolean(remote) !== Boolean(values['mcp-entry']) || (remote && !values['auto-connect'])) throw new Error('--ssh-host 与 --mcp-entry 必须一起使用，并显式指定 --auto-connect');
const port = Number(values.port ?? 0);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('端口无效');
const chrome = await connectChrome(values['auto-connect'] ? { autoConnect: true,
  ...(remote ? { windowsSsh: { host: remote, mcpEntry: values['mcp-entry']! } } : {}) } : { browserUrl: values['browser-url']! });
try {
  const preview = await startBrowserPreview(chrome, port, remote ? 'Windows / SSH：' + remote : undefined);
  console.log('Chrome 预览（本次进程授权链接）：' + preview.url);
  console.log('按 Ctrl+C 结束预览和 MCP 连接，保留 Chrome 及标签页。');
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
    void preview.close().finally(() => chrome.close()).then(() => process.exit(0));
  });
} catch (error) { await chrome.close(); throw error; }
