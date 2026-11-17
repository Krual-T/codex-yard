import { get } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileTransferLimit } from './file-limits.ts';
import { visualizationSandboxPolicy } from './visualizations.ts';

/** Read a self-contained HTML result on the Yard machine. Never forward browser
 * cookies or credentials, follow redirects, or run the page in Yard's origin. */
export async function localHtmlPreview(request: IncomingMessage, response: ServerResponse, params: URLSearchParams, policy = visualizationSandboxPolicy) {
  let target: URL;
  try {
    target = new URL(params.get('url') ?? '');
    if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)
      || target.username || target.password || !/\.html?$/i.test(target.pathname)
      || (params.get('hostId') ?? 'local') !== 'local') throw new Error('需要 Yard 本机的 HTTP HTML 地址');
    // Pin localhost to loopback without depending on DNS or proxy settings.
    if (target.hostname === 'localhost') target.hostname = '127.0.0.1';
  } catch {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('需要 Yard 本机的 HTTP HTML 地址'); return;
  }
  if (!['GET', 'HEAD'].includes(request.method ?? '')) {
    response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  const disconnect = () => { if (!response.writableEnded) controller.abort(); };
  response.once('close', disconnect);
  let status = 502;
  try {
    const upstream = await new Promise<IncomingMessage>((resolve, reject) => {
      get(target, { agent: false, signal: controller.signal, headers: { Accept: 'text/html' } }, resolve).once('error', reject);
    });
    try {
      if (upstream.statusCode !== 200) throw new Error('本机页面返回 HTTP ' + upstream.statusCode);
      if (!/^text\/html(?:;|$)/i.test(upstream.headers['content-type'] ?? '')) throw new Error('本机地址返回的内容不是 HTML');
      if (Number(upstream.headers['content-length']) > fileTransferLimit) { status = 413; throw new Error('HTML 页面超过 64 MiB 预览上限'); }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of upstream) {
        size += chunk.length;
        if (size > fileTransferLimit) { status = 413; throw new Error('HTML 页面超过 64 MiB 预览上限'); }
        chunks.push(chunk);
      }
      const data = Buffer.concat(chunks);
      new TextDecoder('utf-8', { fatal: true }).decode(data);
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': data.length,
        'Cache-Control': 'no-store', 'Content-Security-Policy': policy,
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      response.end(request.method === 'HEAD' ? undefined : data);
    } finally { upstream.destroy(); }
  } catch (error) {
    if (!controller.signal.aborted) {
      response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('无法预览本机 HTML：' + (error as Error).message);
    } else if (!response.destroyed) {
      response.writeHead(504, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('读取本机 HTML 超时');
    }
  } finally {
    clearTimeout(timeout);
    response.off('close', disconnect);
  }
}
