import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { chromePipeInfo } from '../lib/browser-windows-pipe.ts';

for (const type of ['extension', 'iab']) test(`Windows Chrome discovery ${type === 'extension' ? 'accepts original extension info' : 'excludes App IAB pipes'}`,
  { skip: process.platform === 'win32' }, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'yard-chrome-pipe-'));
    const path = join(dir, 'fixture.sock');
    let method: unknown;
    const server = createServer(socket => {
      let bytes = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => {
        bytes = Buffer.concat([bytes, chunk]);
        if (bytes.length < 4 || bytes.length < bytes.readUInt32LE(0) + 4) return;
        const request = JSON.parse(bytes.subarray(4).toString());
        method = request.method;
        const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { type, name: 'Fixture' } }));
        const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
        socket.write(header.subarray(0, 2));
        setTimeout(() => socket.write(Buffer.concat([header.subarray(2), body])), 10);
      });
    });
    await new Promise<void>(resolve => server.listen(path, resolve));
    t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }); });
    const info = await chromePipeInfo(path);
    assert.equal(method, 'getInfo');
    assert.deepEqual(info, type === 'extension' ? { type, name: 'Fixture' } : null);
  });
