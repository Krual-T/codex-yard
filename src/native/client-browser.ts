import type { HostMessage } from './protocol.ts';

// Run in the renderer's click handler, before a WebSocket round trip loses
// transient user activation. The browser belongs to the visiting client.
export function openClientBrowser(message: HostMessage): boolean {
  if (message.type !== 'open-in-browser' && message.type !== 'open-url') return false;
  const url = new URL(String(message.url));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('浏览器链接需要使用不含凭据的 HTTP 或 HTTPS 地址');
  }
  window.open(url.href, '_blank', 'noopener,noreferrer');
  return true;
}
