import { execFile, spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { createAppTools } from '../lib/app-tools.ts';
import { CodexConnection } from '../lib/codex.ts';
import { createSessionToolHandler, sessionToolCatalog } from '../lib/session-tools.ts';

// stdout belongs exclusively to the MCP protocol. This process owns an adapter
// and one daemon connection, never the shared daemon or the HTTP Yard server.
let socketPath = process.env.AGENTS_CODEX_SOCKET;
if (!socketPath) {
  const { stdout } = await promisify(execFile)(process.env.AGENTS_CODEX_BIN || 'codex', ['app-server', 'daemon', 'start'],
    { timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });
  const daemon = JSON.parse(stdout) as { socketPath?: string };
  if (!daemon.socketPath) throw new Error('Codex CLI did not return its shared daemon socket.');
  socketPath = daemon.socketPath;
}

const connection = new CodexConnection(socketPath);
await connection.connect();
let app: Awaited<ReturnType<typeof createAppTools>>;
try { app = await createAppTools({ tools: sessionToolCatalog, callTool: createSessionToolHandler(connection) }); }
catch (cause) { connection.close(); throw cause; }
const config = app.config['mcp_servers.codex_app'];
const adapter = spawn(process.execPath, [app.adapterPath], {
  cwd: dirname(app.adapterPath), env: { ...process.env, ...config.env }, stdio: ['pipe', 'pipe', 'inherit'],
});
let closing: Promise<void> | undefined;
function close(code: number) {
  return closing ??= (async () => {
    process.exitCode = code;
    process.stdin.unpipe(adapter.stdin);
    process.stdin.destroy();
    adapter.kill('SIGTERM');
    connection.close();
    await app.close();
  })();
}
adapter.on('error', cause => { console.error(cause.message); void close(1); });
adapter.stdin.on('error', () => { void close(1); });
adapter.on('exit', code => { void close(code ?? 1); });
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void close(0); });
process.stdin.pipe(adapter.stdin);
adapter.stdout.pipe(process.stdout);
