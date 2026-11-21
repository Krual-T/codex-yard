// Start in the signed-in Windows desktop, independently of Codex App. Each
// connection owns an original helper and releases its input when disconnected.
import { createServer } from 'node:net';
import { readFile, stat } from 'node:fs/promises';
import { forwardWindowsSkyHelper } from './sky-windows-helper.ts';

interface Config { pipe: string; helper: string; codex: string; codexHome: string }
if (process.platform !== 'win32') throw new Error('The Windows Computer Use host must run in the signed-in Windows desktop.');
const configFile = process.argv[process.argv.indexOf('--config') + 1];
if (!process.argv.includes('--config') || !configFile) throw new Error('--config must select the private Windows Computer Use host configuration.');
const config = JSON.parse(await readFile(configFile, 'utf8')) as Config;
if (!config.pipe?.startsWith('\\\\.\\pipe\\codex-yard-')) throw new Error('The host requires a codex-yard named pipe.');
for (const file of [config.helper, config.codex]) if (!(await stat(file)).isFile()) throw new Error('Missing independent Windows executable: ' + file);
if (!(await stat(config.codexHome)).isDirectory()) throw new Error('Missing private Windows helper CODEX_HOME.');
const active = new Set<ReturnType<typeof forwardWindowsSkyHelper>>();
const server = createServer({ allowHalfOpen: true }, socket => {
  const helper = forwardWindowsSkyHelper(config.helper, ['--parent-pid', String(process.pid)],
    { ...process.env, CODEX_CLI_PATH: config.codex, CODEX_HOME: config.codexHome },
    { input: socket, output: socket, error: process.stderr });
  active.add(helper);
  void helper.exited.then(code => { active.delete(helper); socket.destroy(); if (code) console.error('Windows Computer Use connection ended:', code); });
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen({ path: config.pipe, readableAll: false, writableAll: false });
async function stop(): Promise<void> {
  server.close();
  for (const helper of active) helper.stop();
  await Promise.all([...active].map(helper => helper.exited));
}
process.once('SIGTERM', () => { void stop(); }); process.once('SIGINT', () => { void stop(); });
