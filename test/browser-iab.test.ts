import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connect } from 'node:net';
import { once } from 'node:events';
import { access, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { endianness } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { parseIabNetworkPolicy, startIabHost } from '../lib/browser-iab.ts';

test('iab refuses network restrictions it cannot maintain across every frame and worker', () => {
  assert.deepEqual(parseIabNetworkPolicy({ constraints: [{ kind: 'domains', mode: 'denylist', patterns: [] }] }), {
    constraints: [{ kind: 'domains', mode: 'denylist', patterns: [] }],
  });
  for (const constraint of [
    { kind: 'domains', mode: 'allowlist', patterns: [] },
    { kind: 'domains', mode: 'denylist', patterns: ['blocked.example'] },
    { kind: 'origins', mode: 'allowlist', patterns: ['https://allowed.example'] },
  ]) assert.throws(() => parseIabNetworkPolicy({ constraints: [constraint] }), /does not yet support restricted network/);
  assert.throws(() => parseIabNetworkPolicy({}), /missing/);
  assert.throws(() => parseIabNetworkPolicy({ constraints: [{ kind: 'unknown', mode: 'denylist', patterns: [] }] }), /Unsupported/);
});

test('a debugger attach completing after socket disconnect is immediately detached', { timeout: 8000 }, async () => {
  const directory = await mkdtemp('/tmp/yard-iab-attach-'), path = join(directory, 'browser.sock');
  const attaching = join(directory, 'attaching'), resume = join(directory, 'resume'), detached = join(directory, 'detached');
  const fixture = join(directory, 'chromium-fixture');
  // A controlled CDP pipe makes the disconnect happen while Chromium's attach
  // acknowledgement is still in flight, without depending on a timing race.
  await writeFile(fixture, `#!${process.execPath}
import {createReadStream,createWriteStream,writeFileSync,existsSync} from 'node:fs';
const output=createWriteStream('',{fd:4});let buffer='';
function reply(value,result={}){output.write(JSON.stringify({id:value.id,result})+'\\0');}
createReadStream('',{fd:3}).setEncoding('utf8').on('data',chunk=>{
buffer+=chunk;let end;while((end=buffer.indexOf('\\0'))>=0){
const value=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
if(value.method==='Target.createTarget')reply(value,{targetId:'fixture-page'});
else if(value.method==='Target.getTargetInfo')reply(value,{targetInfo:{targetId:'fixture-page',title:'Fixture',url:'about:blank'}});
else if(value.method==='Target.attachToTarget'){
writeFileSync(${JSON.stringify(attaching)},'pending');
const timer=setInterval(()=>{if(existsSync(${JSON.stringify(resume)})){clearInterval(timer);reply(value,{sessionId:'late-session'});}},5);
}else if(value.method==='Target.detachFromTarget'){writeFileSync(${JSON.stringify(detached)},value.params.sessionId);reply(value);}
else if(value.method==='Browser.close'){reply(value);setTimeout(()=>process.exit(),10);}
else reply(value);
}});
`, { mode: 0o700 });
  const host = await startIabHost({ socketPath: path, dataDirectory: join(directory, 'state'), executablePath: fixture });
  const socket = connect(path); await once(socket, 'connect');
  const send = (id: number, method: string, params: Record<string, unknown> = {}) => {
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params: { session_id: 'fixture', turn_id: 'fixture-turn', ...params } }));
    const length = Buffer.alloc(4);
    if (endianness() === 'LE') length.writeUInt32LE(body.length); else length.writeUInt32BE(body.length);
    socket.write(Buffer.concat([length, body]));
  };
  async function fileExists(file: string) { try { await access(file); return true; } catch { return false; } }
  async function until(predicate: () => Promise<boolean>) {
    const deadline = Date.now() + 3000;
    while (!(await predicate())) { assert.ok(Date.now() < deadline, 'CDP fixture timed out'); await delay(5); }
  }
  try {
    let created = false; socket.on('data', () => { created = true; });
    send(1, 'createTab'); await until(async () => created);
    send(2, 'attach', { tabId: 1, networkPolicy: { constraints: [] } });
    await until(() => fileExists(attaching));
    socket.destroy(); await once(socket, 'close'); await delay(20);
    await writeFile(resume, 'resume');
    await until(() => fileExists(detached));
  } finally { socket.destroy(); await host.close(); await rm(directory, { recursive: true, force: true }); }
});

test('original native framing handles partial frames and binds a socket to its first session', async () => {
  const directory = await mkdtemp('/tmp/yard-iab-contract-');
  const path = join(directory, 'browser.sock');
  const host = await startIabHost({ socketPath: path, dataDirectory: join(directory, 'state'), executablePath: '/not-an-App-or-Chromium' });
  const socket = connect(path);
  await once(socket, 'connect');
  let buffered = Buffer.alloc(0);
  const replies = new Map<number, Record<string, unknown>>();
  socket.on('data', chunk => {
    buffered = Buffer.concat([buffered, typeof chunk === 'string' ? Buffer.from(chunk) : chunk]);
    while (buffered.length >= 4) {
      const size = endianness() === 'LE' ? buffered.readUInt32LE() : buffered.readUInt32BE();
      if (buffered.length < size + 4) return;
      const value = JSON.parse(buffered.subarray(4, size + 4).toString('utf8'));
      buffered = buffered.subarray(size + 4);
      replies.set(value.id, value); socket.emit('reply');
    }
  });
  let nextId = 0;
  async function call(method: string, session_id: string) {
    const id = ++nextId, body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params: { session_id, turn_id: 'turn-fixture' } }));
    const header = Buffer.alloc(4);
    if (endianness() === 'LE') header.writeUInt32LE(body.length); else header.writeUInt32BE(body.length);
    socket.write(header.subarray(0, 2)); socket.write(Buffer.concat([header.subarray(2), body]));
    const signal = AbortSignal.timeout(3000);
    while (!replies.has(id)) await once(socket, 'reply', { signal });
    return replies.get(id)!;
  }
  try {
    if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600);
    const info = (await call('getInfo', 'first-session')).result as { type: string; metadata: { codexSessionId: string } };
    assert.equal(info.type, 'iab'); assert.equal(info.metadata.codexSessionId, 'first-session');
    assert.deepEqual((await call('getTabs', 'first-session')).result, []);
    const changed = await call('getTabs', 'second-session');
    assert.match(String((changed.error as Record<string, unknown>).message), /another session/);
    // Discovery and empty state never start an arbitrary executable.
    assert.equal((await call('getInfo', 'first-session')).error, undefined);
  } finally { socket.destroy(); await host.close(); await rm(directory, { recursive: true, force: true }); }
});
