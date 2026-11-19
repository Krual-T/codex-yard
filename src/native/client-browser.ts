import type { HostMessage } from './protocol.ts';

// Run in the renderer's click handler, before a WebSocket round trip loses
// transient user activation. Conversation links use the renderer's existing
// right-panel action; explicit external opens stay on the visiting client.
export function openClientBrowser(message: HostMessage, publish: (message: HostMessage) => void): boolean {
  if (message.type !== 'open-in-browser' && message.type !== 'open-url') return false;
  let url = new URL(String(message.url));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('浏览器链接需要使用不含凭据的 HTTP 或 HTTPS 地址');
  }
  if (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    && /\.html?$/i.test(url.pathname) && (message.hostId ?? 'local') === 'local'
    && url.origin !== location.origin) {
    const preview = new URL('/api/local-html-preview', location.origin);
    preview.hash = url.hash;
    url.hash = '';
    preview.searchParams.set('url', url.href);
    url = preview;
  }
  const modified = Object.values(message.clickModifiers ?? {}).some(value => value === true);
  if (message.type === 'open-in-browser' && typeof message.conversationId === 'string'
    && message.openTarget !== 'external-browser' && message.useExternalBrowser !== true
    && !modified && (message.disposition == null || message.openTarget === 'in-app-browser')) {
    publish({ type: 'toggle-browser-panel', conversationId: message.conversationId, hostId: message.hostId,
      open: true, url: url.href, presentationIntent: 'split', source: message.source ?? 'manual',
      initiator: message.initiator ?? 'markdown_link_click', yardEmbedded: true });
    return true;
  }
  window.open(url.href, '_blank', 'noopener,noreferrer');
  return true;
}
