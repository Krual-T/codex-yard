import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createServer, request } from 'node:http';
import { createConnection } from 'node:net';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket, WebSocketServer } from 'ws';
import { DevelopmentPreviews } from '../src/native/development-previews.ts';

const parent = 'https://preview.example.ts.net:8765';
async function until(check: () => Promise<boolean>, message: string) {
  const end = Date.now() + 6000;
  while (!await check()) { if (Date.now() > end) throw new Error(message); await delay(25); }
}
async function closed(port: number) {
  return new Promise<boolean>(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(false); }); socket.once('error', () => resolve(true));
  });
}
async function fixture(t: import('node:test').TestContext, idleMs?: number) {
  const root = await mkdtemp('/tmp/yard-preview-test-');
  const binary = join(root, 'tailscale.mjs'), mode = join(root, 'mode'), log = join(root, 'events');
  await writeFile(mode, 'running'); await writeFile(log, '');
  await writeFile(binary, `#!/usr/bin/env node
import {readFileSync,appendFileSync,writeFileSync} from 'node:fs';
const mode=readFileSync(${JSON.stringify(mode)},'utf8');
if(process.argv[2]==='serve'&&process.argv[3]==='status') {
 console.log(JSON.stringify({TCP:{'8765':{HTTPS:true}}}));
} else if(process.argv[2]==='status') {
 console.log(JSON.stringify({BackendState:mode==='offline'?'Stopped':'Running',Self:{DNSName:'preview.example.ts.net.'}}));
} else {
 const port=Number(process.argv.find(a=>a.startsWith('--https=')).split('=')[1]);
 const event=type=>appendFileSync(${JSON.stringify(log)},JSON.stringify({type,port,pid:process.pid,worker:process.ppid})+'\\n');
 event('start');
 if(mode==='denied') {console.error('Access denied: Serve permission');process.exit(1);}
 if(mode==='conflict-once') writeFileSync(${JSON.stringify(mode)},'running');
 if(mode==='conflict'||mode==='conflict-once') {console.error('sending serve config: updating config: listener already exists for port '+port);process.exit(1);}
 if(mode!=='silent') console.log('Available within your tailnet: https://preview.example.ts.net:'+port+'/');
 process.on('SIGINT',()=>{event('stop');process.exit(0);});
 setInterval(()=>{},1000);
}
`, { mode: 0o700 });
  const seen: { url?: string; origin?: string; host?: string; body: string }[] = [];
  const upstream = createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    seen.push({ url: req.url, origin: req.headers.origin, host: req.headers.host, body });
    if (req.url === '/drop-post') { req.socket.destroy(); return; }
    if (req.url === '/stream' || req.url === '/broken-stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: first\n\n');
      const finish = setTimeout(() => req.url === '/stream' ? res.end('data: last\n\n') : res.destroy(), req.url === '/stream' ? 400 : 40);
      res.once('close', () => clearTimeout(finish)); return;
    }
    if (req.url === '/redirect') { res.writeHead(302, { location: service + '/page?q=redirect#fragment' }); res.end(); return; }
    if (req.url === '/docs/start') { res.writeHead(302, { location: 'next?q=relative#fragment' }); res.end(); return; }
    if (req.url === '/localhost-redirect') { res.writeHead(302, { location: 'http://' + req.headers.host + '/page?q=localhost' }); res.end(); return; }
    res.writeHead(200, { 'content-type': req.url?.startsWith('/api') ? 'application/json' : 'text/html',
      'content-security-policy': "default-src 'self'; script-src 'self'; frame-ancestors 'self'", 'x-frame-options': 'SAMEORIGIN',
      'set-cookie': 'app=yes; Domain=localhost; Path=/; HttpOnly' });
    res.end(req.url?.startsWith('/api') ? JSON.stringify({ body, origin: req.headers.origin }) : '<h1>preview</h1>');
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const service = 'http://127.0.0.1:' + (upstream.address() as import('node:net').AddressInfo).port;
  const previews = new DevelopmentPreviews({ publicOrigin: parent, localOrigin: () => 'http://127.0.0.1:8765', tailscaleBin: binary, idleMs });
  const events = async () => (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as { type: string; pid: number; port: number; worker: number });
  t.after(async () => { await previews.close(); upstream.closeAllConnections(); await new Promise<void>(resolve => upstream.close(() => resolve())); await rm(root, { recursive: true, force: true }); });
  return { root, previews, service, upstream, seen, mode, binary, events };
}
function transport(url: string) { const target = new URL(url); return { base: 'http://127.0.0.1:' + target.port, host: target.host, origin: target.origin, port: Number(target.port) }; }

test('development preview reuses one lease and carries paths, bodies, framing policy, cookies and redirects', async t => {
  const h = await fixture(t);
  const [one, two] = await Promise.all([h.previews.open(h.service + '/page?q=1#section'), h.previews.open(h.service + '/other')]);
  const wire = transport(one.url);
  assert.equal(new URL(two.url).origin, wire.origin);
  assert.equal(new URL(one.url).pathname + new URL(one.url).search + new URL(one.url).hash, '/page?q=1#section');
  assert.equal((await h.events()).filter(e => e.type === 'start').length, 1);
  const response = await fetch(wire.base + '/api/save', { method: 'POST', headers: { host: wire.host, origin: wire.origin }, body: '中文 request body' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { body: '中文 request body', origin: h.service });
  assert.equal(h.seen.at(-1)?.host, new URL(h.service).host);
  assert.equal(response.headers.get('x-frame-options'), null);
  assert.match(response.headers.get('content-security-policy')!, /script-src 'self'/);
  assert.match(response.headers.get('content-security-policy')!, new RegExp("frame-ancestors 'self' " + parent.replaceAll('.', '\\.')));
  assert.equal(response.headers.get('set-cookie'), 'app=yes; Path=/; HttpOnly');
  const redirect = await fetch(wire.base + '/redirect', { headers: { host: wire.host }, redirect: 'manual' });
  assert.equal(redirect.headers.get('location'), wire.origin + '/page?q=redirect#fragment');
  const relative = await fetch(wire.base + '/docs/start', { redirect: 'manual' });
  assert.equal(relative.headers.get('location'), wire.origin + '/docs/next?q=relative#fragment');
});

test('localhost keeps its upstream Host, Origin and absolute redirects while connecting only to loopback', async t => {
  const h = await fixture(t), source = h.service.replace('127.0.0.1', 'localhost');
  const wire = transport((await h.previews.open(source)).url);
  await fetch(wire.base + '/api', { method: 'POST', headers: { origin: wire.origin }, body: 'one' });
  assert.equal(h.seen.at(-1)?.host, new URL(source).host);
  assert.equal(h.seen.at(-1)?.origin, source);
  const redirect = await fetch(wire.base + '/localhost-redirect', { redirect: 'manual' });
  assert.equal(redirect.headers.get('location'), wire.origin + '/page?q=localhost');
});

test('development preview keeps request destinations pinned and checks Host and Origin', async t => {
  const h = await fixture(t), opened = await h.previews.open(h.service), wire = transport(opened.url);
  const getStatus = (headers: Record<string, string>) => new Promise<number | undefined>((resolve, reject) => {
    const req = request(wire.base + '/', { headers }, response => { response.resume(); response.once('end', () => resolve(response.statusCode)); });
    req.once('error', reject); req.end();
  });
  assert.equal(await getStatus({ host: 'untrusted.test' }), 403);
  assert.equal(await getStatus({ host: wire.host, origin: 'https://untrusted.test' }), 403);
  for (const path of ['http://untrusted.test/private', '//untrusted.test/private', '/\\untrusted.test/']) {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(wire.base, { path, headers: { host: wire.host } }, response => { response.resume(); response.once('end', () => resolve(response.statusCode)); });
      req.once('error', reject); req.end();
    });
    assert.equal(status, 403);
  }
  for (const url of ['file:///etc/passwd', 'http://user:pass@localhost:3000/', 'http://localhost:22/', 'http://localhost/']) await assert.rejects(h.previews.open(url));
  await assert.rejects(h.previews.open(h.service, 'remote-ssh-other'), /Yard 运行主机/);
  assert.equal((await h.previews.open('https://external.test/')).url, 'https://external.test/');
  assert.equal((await h.previews.open('http://127.0.0.1:8765/local/chat')).url, parent + '/local/chat');
});

test('active streams survive idle sweeping and broken responses and POSTs are never replayed', async t => {
  const h = await fixture(t, 150), wire = transport((await h.previews.open(h.service)).url);
  const stream = await fetch(wire.base + '/stream');
  const text = stream.text();
  await delay(220); await h.previews.sweep();
  assert.equal(await closed(wire.port), false);
  assert.equal(await text, 'data: first\n\ndata: last\n\n');
  const broken = await fetch(wire.base + '/broken-stream');
  await assert.rejects(broken.text());
  const post = await fetch(wire.base + '/drop-post', { method: 'POST', body: 'once' });
  assert.equal(post.status, 502);
  assert.equal(post.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(h.seen.filter(row => row.url === '/drop-post').length, 1);
  assert.equal(h.seen.filter(row => row.url === '/broken-stream').length, 1);
});

test('development preview relays WebSocket upgrades using the service Origin and retains active leases', async t => {
  const h = await fixture(t, 150);
  const wss = new WebSocketServer({ noServer: true });
  h.upstream.on('upgrade', (req, socket, head) => {
    if (req.headers.origin !== h.service) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, ws => ws.on('message', data => ws.send('reply:' + String(data))));
  });
  const wire = transport((await h.previews.open(h.service + '/socket')).url);
  const ws = new WebSocket(wire.base.replace('http:', 'ws:') + '/socket', { headers: { host: wire.host, origin: wire.origin } });
  t.after(() => { ws.terminate(); wss.close(); });
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const answer = new Promise<string>(resolve => ws.once('message', data => resolve(String(data)))); ws.send('中文');
  assert.equal(await answer, 'reply:中文');
  await delay(220); await h.previews.sweep(); assert.equal(await closed(wire.port), false);
  ws.close(); await new Promise<void>(resolve => ws.once('close', () => resolve()));
  await until(() => closed(wire.port), 'idle preview was not released');
});

test('failed setup rolls back its listener and can retry after permission, conflict and offline failures', async t => {
  const h = await fixture(t);
  for (const mode of ['denied', 'conflict']) {
    await writeFile(h.mode, mode);
    const starts = (await h.events()).filter(e => e.type === 'start').length;
    await assert.rejects(h.previews.open(h.service), /未能启动/);
    const attempts = (await h.events()).filter(e => e.type === 'start').slice(starts);
    assert.equal(attempts.length, mode === 'conflict' ? 3 : 1);
    for (const event of attempts) assert.equal(await closed(event.port), true);
  }
  await writeFile(h.mode, 'offline'); await assert.rejects(h.previews.open(h.service), /已连接的 Tailscale/);
  await writeFile(h.mode, 'running');
  assert.equal((await fetch(transport((await h.previews.open(h.service)).url).base)).status, 200);
});

test('a Serve port collision retries a different random mapping while preserving the source application', async t => {
  const h = await fixture(t); await writeFile(h.mode, 'conflict-once');
  const result = await h.previews.open(h.service + '/page?q=1#part'), wire = transport(result.url);
  const attempts = (await h.events()).filter(event => event.type === 'start');
  assert.equal(attempts.length, 2);
  assert.notEqual(attempts[0]!.port, attempts[1]!.port);
  assert.equal(await closed(attempts[0]!.port), true);
  assert.equal(wire.port, attempts[1]!.port);
  assert.equal(new URL(result.url).pathname + new URL(result.url).search + new URL(result.url).hash, '/page?q=1#part');
  assert.equal((await fetch(wire.base + '/page')).status, 200);
  assert.equal(h.seen.at(-1)?.host, new URL(h.service).host);
});

test('idle and failed Serve leases are recreated from the original development URL', async t => {
  const h = await fixture(t, 120);
  const first = transport((await h.previews.open(h.service + '/source')).url);
  await until(() => closed(first.port), 'idle preview was not released');
  const second = transport((await h.previews.open(h.service + '/source')).url);
  const cli = (await h.events()).filter(e => e.type === 'start').at(-1)!;
  process.kill(cli.pid, 'SIGKILL');
  await until(() => closed(second.port), 'failed Serve proxy was not released');
  assert.ok((await h.previews.open(h.service + '/source')).url.endsWith('/source'));
  assert.equal((await h.events()).filter(e => e.type === 'start').length, 3);
});

test('a Yard process crash disconnects the IPC lease owner and terminates its foreground Serve', async t => {
  const h = await fixture(t);
  const runner = join(h.root, 'runner.mjs');
  await writeFile(runner, `import {DevelopmentPreviews} from ${JSON.stringify(new URL('../src/native/development-previews.ts', import.meta.url).href)};
const manager=new DevelopmentPreviews({publicOrigin:${JSON.stringify(parent)},localOrigin:()=> 'http://127.0.0.1:8765',tailscaleBin:${JSON.stringify(h.binary)}});
process.send(await manager.open(${JSON.stringify(h.service)}));`);
  const child = fork(runner, { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(() => child.kill('SIGKILL'));
  const opened = await new Promise<{ url: string }>((resolve, reject) => { child.once('message', message => resolve(message as { url: string })); child.once('error', reject); child.once('exit', code => reject(new Error('runner exit ' + code))); });
  const cli = (await h.events()).find(e => e.type === 'start')!;
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve())); child.kill('SIGKILL'); await exited;
  await until(async () => (await h.events()).some(e => e.pid === cli.pid && e.type === 'stop'), 'foreground CLI survived its Yard parent crash');
  assert.equal(await closed(transport(opened.url).port), true);
});

test('local-only Yard keeps direct navigation and missing services create no Serve lease', async t => {
  const h = await fixture(t);
  const direct = new DevelopmentPreviews({ publicOrigin: '', localOrigin: () => 'http://127.0.0.1:8765' });
  t.after(() => direct.close());
  assert.equal((await direct.open(h.service)).url, h.service + '/');
  await new Promise<void>(resolve => h.upstream.close(() => resolve()));
  await assert.rejects(h.previews.open(h.service), /开发服务尚未运行/);
  assert.deepEqual(await h.events(), []);
});

test('closing Yard cancels an in-progress Serve launch without publishing a successful preview', async t => {
  const h = await fixture(t); await writeFile(h.mode, 'silent');
  const opening = h.previews.open(h.service).then(() => 'success', error => error as Error);
  const queued = h.previews.open(h.service + '/queued').then(() => 'success', error => error as Error);
  await until(async () => (await h.events()).some(event => event.type === 'start'), 'Serve did not begin');
  const started = Date.now(); await h.previews.close();
  assert.ok(Date.now() - started < 5000, 'shutdown must cancel creation rather than await its setup deadline');
  assert.ok(await opening instanceof Error);
  assert.ok(await queued instanceof Error);
  assert.equal((await h.events()).filter(event => event.type === 'start').length, 1);
  const first = (await h.events()).find(event => event.type === 'start')!;
  assert.equal(await closed(first.port), true);
  await assert.rejects(h.previews.open(h.service), /已关闭/);
});

test('a crashed IPC worker terminates its whole Serve process group and permits a fresh open', { skip: process.platform !== 'linux' }, async t => {
  const h = await fixture(t), first = transport((await h.previews.open(h.service)).url);
  const cli = (await h.events()).find(event => event.type === 'start')!;
  process.kill(cli.worker, 'SIGKILL');
  await until(() => closed(first.port), 'proxy survived its IPC worker');
  await until(async () => {
    try { return /\) Z /.test(await readFile('/proc/' + cli.pid + '/stat', 'utf8')); }
    catch { return true; }
  }, 'Serve child survived its IPC worker');
  assert.ok((await h.previews.open(h.service)).url.startsWith('https:'));
});

test('a silent Serve launch has a fifteen-second total setup deadline and cleans up', { timeout: 22000 }, async t => {
  const h = await fixture(t); await writeFile(h.mode, 'silent');
  const started = Date.now(); await assert.rejects(h.previews.open(h.service), /取消或超时/);
  assert.ok(Date.now() - started < 20000);
  const first = (await h.events()).find(event => event.type === 'start')!;
  assert.equal(await closed(first.port), true);
  assert.ok((await h.events()).some(event => event.pid === first.pid && event.type === 'stop'));
});
