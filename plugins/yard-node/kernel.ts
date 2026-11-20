import { AsyncLocalStorage } from 'node:async_hooks';
import { Console } from 'node:console';
import { Writable } from 'node:stream';
import { Session } from 'node:inspector/promises';
import type { Runtime } from 'node:inspector';
import { createRequire, isBuiltin } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspect } from 'node:util';

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
interface Cell { content: Content[]; textBytes: number; imageBytes: number; open: boolean; overflow: boolean }
const cells = new AsyncLocalStorage<Cell>();
function text(value: string) {
  const cell = cells.getStore();
  if (!cell?.open || cell.overflow) return;
  cell.textBytes += Buffer.byteLength(value);
  if (cell.textBytes > 65536) { cell.overflow = true; return; }
  const previous = cell.content.at(-1);
  if (previous?.type === 'text') previous.text += value;
  else cell.content.push({ type: 'text', text: value });
}
const output = new Writable({ write(chunk, _encoding, done) { text(String(chunk)); done(); } });
const session = new Session(); session.connect();
const globals = globalThis as unknown as Record<string, unknown>;
globals.console = new Console(output, output);
globals.__yardInspect = (value: unknown) => inspect(value, { depth: 4, colors: false, maxStringLength: 8000, maxArrayLength: 100 });
globals.yardNode = {
  get cwd() { return process.cwd(); },
  import: (specifier: string) => import(isBuiltin(specifier) ? 'node:' + specifier.replace(/^node:/, '') : pathToFileURL(createRequire(join(process.cwd(), 'yard-session.cjs')).resolve(specifier)).href),
  emitImage(value: { bytes: Uint8Array; mimeType: string }) {
    const cell = cells.getStore();
    if (!cell?.open) throw new Error('Emit images during an active evaluation.');
    if (!value || !ArrayBuffer.isView(value.bytes) || !['image/png', 'image/jpeg'].includes(value.mimeType)) {
      throw new Error('emitImage expects { bytes: Uint8Array, mimeType: image/png or image/jpeg }.');
    }
    const bytes = Buffer.from(value.bytes.buffer, value.bytes.byteOffset, value.bytes.byteLength);
    if (value.mimeType === 'image/png' ? !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) :
      bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) throw new Error('Image bytes do not match the MIME type.');
    cell.imageBytes += bytes.length;
    if (cell.imageBytes > 8 * 1024 * 1024) { cell.overflow = true; throw new Error('Image output exceeds 8 MiB.'); }
    cell.content.push({ type: 'image', data: bytes.toString('base64'), mimeType: value.mimeType });
  },
};
// Keep model code's direct writes off the MCP transport, including delayed logs.
process.stdout.write = ((value: string | Uint8Array) => { text(String(value)); return true; }) as typeof process.stdout.write;
process.stderr.write = process.stdout.write;
process.on('message', (message: { code: string }) => {
  const cell: Cell = { content: [], textBytes: 0, imageBytes: 0, open: true, overflow: false };
  void cells.run(cell, async () => {
    let error: string | undefined;
    try {
      // Current Node protocol types omit V8's replMode option.
      const evaluation: Runtime.EvaluateParameterType & { replMode: true } = { expression: message.code, replMode: true, awaitPromise: true };
      const reply = await session.post('Runtime.evaluate', evaluation);
      if (reply.exceptionDetails) error = reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text;
      else if (reply.result.objectId) {
        const formatted = await session.post('Runtime.callFunctionOn', { objectId: reply.result.objectId,
          functionDeclaration: 'function(){return globalThis.__yardInspect(this)}', returnByValue: true });
        text(String(formatted.result.value) + '\n');
      } else if (reply.result.type !== 'undefined') text(('value' in reply.result ? inspect(reply.result.value) : reply.result.unserializableValue) + '\n');
      if (reply.result.objectId) await session.post('Runtime.releaseObject', { objectId: reply.result.objectId });
    } catch (cause) { error = String(cause); }
    finally { cell.open = false; process.send?.({ content: cell.content, error, overflow: cell.overflow }); }
  });
});
process.on('disconnect', () => process.exit());
process.send?.({ ready: true, cwd: process.cwd() });
