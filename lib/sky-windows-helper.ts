#!/usr/bin/env node
// Keep the original Windows helper protocol. Windows owns its parent PID and
// input cleanup; the WSL side forwards bytes without translating tool calls.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createConnection } from 'node:net';
import type { Readable, Writable } from 'node:stream';
import { windowsNode, windowsPath } from './windows-paths.ts';

const endTurnId = Number.MAX_SAFE_INTEGER, closeId = endTurnId - 1;
type Request = { id?: unknown; meta?: unknown };

/** Exported for lifecycle verification with a disposable protocol helper. */
export function forwardWindowsSkyHelper(command: string, args: string[], env: NodeJS.ProcessEnv,
  io: { input: Readable; output: Writable; error: Writable }): { stop(): void; exited: Promise<number> } {
  const child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const pending = new Set<unknown>();
  let closing = false, cleanup: 'turn' | 'close' | null = null, failed = false, meta: unknown;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const input = createInterface({ input: io.input });
  const log = (message: string, detail?: unknown) => io.error.write(message + (detail == null ? '' : ' ' + String(detail)) + '\n');
  let didExit!: (code: number) => void;
  const exited = new Promise<number>(resolve => { didExit = resolve; });
  input.on('line', line => {
    try { const request = JSON.parse(line) as Request; if (request.id != null) pending.add(request.id); meta = request.meta; }
    catch { /* The upstream helper reports malformed requests. */ }
  });
  function finish() {
    if (!closing || pending.size || cleanup) return;
    cleanup = 'turn';
    child.stdin.write(JSON.stringify({ id: endTurnId, method: 'end_turn', params: {}, ...(meta == null ? {} : { meta }) }) + '\n');
  }
  const responses = createInterface({ input: child.stdout });
  responses.on('line', line => {
    try {
      const reply = JSON.parse(line) as { id?: unknown; ok?: boolean; error?: unknown };
      if (cleanup === 'turn' && reply.id === endTurnId) {
        if (!reply.ok) { failed = true; log('Windows Sky end_turn failed:', reply.error); }
        cleanup = 'close';
        child.stdin.write(JSON.stringify({ id: closeId, method: 'close', params: {}, ...(meta == null ? {} : { meta }) }) + '\n');
      } else if (cleanup === 'close' && reply.id === closeId) {
        if (!reply.ok) { failed = true; log('Windows Sky close failed:', reply.error); }
        child.stdin.end();
      } else { pending.delete(reply.id); finish(); }
    } catch { /* The upstream transport reports malformed responses. */ }
  });
  function stop() {
    if (closing) return;
    closing = true;
    io.input.unpipe(child.stdin);
    input.close();
    finish();
    deadline = setTimeout(() => { failed = true; log('Windows Sky input cleanup timed out.'); child.kill(); }, 4000).unref();
  }
  io.input.pipe(child.stdin, { end: false });
  io.input.once('end', stop); io.input.once('close', stop); io.input.once('error', stop);
  child.stdout.on('data', (value: Buffer) => { if (!closing) io.output.write(value); });
  child.stderr.pipe(io.error, { end: false });
  io.output.on('error', stop);
  child.stdin.on('error', () => { /* A helper exit is handled below. */ });
  child.once('error', error => { failed = true; log(error.message); });
  child.once('close', (code, signal) => {
    clearTimeout(deadline); input.close(); io.input.destroy();
    io.output.off('error', stop);
    didExit(failed ? 1 : code ?? (signal ? 1 : 0));
  });
  return { stop, exited };
}

export function runWindowsSkyHelper(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): void {
  const helper = forwardWindowsSkyHelper(command, args, env, { input: process.stdin, output: process.stdout, error: process.stderr });
  process.once('SIGTERM', helper.stop); process.once('SIGINT', helper.stop);
  void helper.exited.then(code => { process.exitCode = code; });
}

function main(): void {
  const args = process.argv.slice(2);
  const pipe = args[0] === '--pipe' ? args[1] : process.env.YARD_WINDOWS_SKY_PIPE;
  if (pipe) {
    if (process.platform !== 'win32') { forwardToWindows(['--pipe', pipe]); return; }
    const socket = createConnection(pipe);
    socket.once('connect', () => { process.stdin.pipe(socket); socket.pipe(process.stdout); });
    socket.once('error', error => { console.error(error.message); process.exitCode = 1; process.stdin.destroy(); });
    socket.once('close', () => process.stdin.destroy());
    process.once('SIGTERM', () => socket.end()); process.once('SIGINT', () => socket.end());
    return;
  }
  const childMode = args[0] === '--windows-child';
  const helper = childMode ? args[1] : process.env.YARD_SKY_WINDOWS_BINARY;
  if (!helper) throw new Error('YARD_SKY_WINDOWS_BINARY must select the copied original Windows Sky helper.');
  if (process.platform === 'win32') {
    // The upstream Linux client supplies a Linux PID. The independent Windows
    // launcher supplies its actual Windows PID instead.
    const env = { ...process.env };
    if (childMode && args[2]) env.CODEX_HOME = args[2];
    if (childMode && args[3]) env.CODEX_CLI_PATH = args[3];
    else if (env.YARD_WINDOWS_CODEX_BIN) env.CODEX_CLI_PATH = env.YARD_WINDOWS_CODEX_BIN;
    runWindowsSkyHelper(helper, ['--parent-pid', String(process.pid)], env);
    return;
  }
  const codex = process.env.YARD_WINDOWS_CODEX_BIN;
  if (!codex) throw new Error('WSL Windows Computer Use requires YARD_WINDOWS_CODEX_BIN to select a standalone Windows Codex executable (.exe).');
  const codexHome = process.env.YARD_WINDOWS_CODEX_HOME || process.env.CODEX_HOME;
  forwardToWindows(['--windows-child', windowsPath(helper), codexHome ? windowsPath(codexHome) : '', windowsPath(codex)]);
}

function forwardToWindows(args: string[]): void {
  const child = spawn(windowsNode(), [windowsPath(fileURLToPath(import.meta.url)), ...args], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  process.stdin.pipe(child.stdin); child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
  const stop = () => child.stdin.end();
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  child.stdin.on('error', () => {});
  child.once('error', error => { console.error(error.message); process.exitCode = 1; });
  child.once('close', (code, signal) => { process.stdin.destroy(); process.exitCode = code ?? (signal ? 1 : 0); });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
