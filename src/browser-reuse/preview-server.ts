import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createBrowserSession } from './chrome-mcp.ts';
import type { BrowserTools } from './chrome-mcp.ts';

export async function startBrowserPreview(tools: BrowserTools, port = 0, browserLocation = '本机（预览服务所在电脑）') {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('./preview.tsx', import.meta.url))], bundle: true, write: false,
    format: 'esm', target: 'chrome120', minify: true,
    define: { 'process.env.NODE_ENV': '"production"', __CHROME_LOCATION__: JSON.stringify(browserLocation) },
  });
  const token = randomBytes(32).toString('hex');
  const session = createBrowserSession(tools);
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'");
    const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
    const reply = (status: number, body: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
    if (request.headers.host !== new URL(origin).host) { reply(403, { error: '来源不匹配' }); return; }
    if (request.method === 'GET' && request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chrome 连接预览</title><div id="root"></div><script type="module" src="/preview.js"></script></html>'); return;
    }
    if (request.method === 'GET' && request.url === '/preview.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(bundle.outputFiles[0]!.contents); return;
    }
    const supplied = Buffer.from(request.headers.authorization ?? '');
    const expected = Buffer.from('Bearer ' + token);
    if (request.url !== '/command' || request.method !== 'POST' || request.headers.origin !== origin ||
        supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      reply(403, { error: '需要本次预览页的授权' }); return;
    }
    try {
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 32 * 1024) throw new Error('请求正文过大');
        chunks.push(chunk);
      }
      const { action, ...value } = JSON.parse(Buffer.concat(chunks).toString()) as { action: string };
      reply(200, await session.run(action, value));
    } catch (error) { reply(400, { error: (error as Error).message }); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve()); });
  const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  return { origin, url: origin + '/#' + token, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
