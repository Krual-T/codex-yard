#!/usr/bin/env node
// Forward the original protocol. Its EOF cleanup releases keys but leaves a
// drag button held, so end the native drag before closing the helper's input.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
const helper = process.env.YARD_SKY_LINUX_BINARY;
if (!helper) throw new Error('YARD_SKY_LINUX_BINARY must select the original independent Sky helper.');
const child = spawn(helper, process.argv.slice(2), { stdio: ['pipe', 'pipe', 'pipe'] });
let closing = false, dragging = false, cleaning = false, failed = false;
const pending = new Map<unknown, unknown>();
const input = createInterface({ input: process.stdin });
input.on('line', line => {
  try {
    const request = JSON.parse(line);
    if (request.command === 'drag_handle') pending.set(request.id, request.input?.action);
  } catch { /* The original helper reports protocol errors. */ }
});
const responses = createInterface({ input: child.stdout });
responses.on('line', line => {
  try {
    const response = JSON.parse(line);
    if (cleaning && response.id === 9007199254740991) {
      if (!response.ok) { failed = true; console.error('Sky drag cleanup failed:', response.error); }
      child.stdin.end();
    } else {
      const action = pending.get(response.id);
      pending.delete(response.id);
      if (response.ok && action === 'start') dragging = true;
      if (response.ok && action === 'end') dragging = false;
      if (closing) finish();
    }
  } catch { /* The original transport reports protocol errors. */ }
});
function finish() {
  if (cleaning || pending.size) return;
  if (dragging) {
    cleaning = true;
    child.stdin.write('\n{"id":9007199254740991,"command":"drag_handle","input":{"action":"end"}}\n');
  } else child.stdin.end();
}
function close() {
  if (closing) return;
  closing = true;
  process.stdin.unpipe(child.stdin);
  finish();
  const deadline = setTimeout(() => { failed = true; console.error('Sky helper cleanup timed out.'); child.kill('SIGKILL'); }, 4000);
  deadline.unref();
}
process.stdin.pipe(child.stdin, { end: false });
process.stdin.once('end', close);
process.once('SIGTERM', close);
process.once('SIGINT', close);
child.stdout.on('data', (value: Buffer) => { if (!closing) process.stdout.write(value); });
child.stderr.on('data', (value: Buffer) => { if (!closing) process.stderr.write(value); });
// The original host may disappear while a response is being forwarded.
process.stdout.on('error', close);
process.stderr.on('error', close);
child.stdin.on('error', () => { child.kill(); });
child.once('error', error => { console.error(error); process.exitCode = 1; });
child.once('close', (code, signal) => { process.stdin.destroy(); process.exitCode = failed ? 1 : code ?? (signal ? 1 : 0); });
