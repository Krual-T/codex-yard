/// <reference lib="webworker" />
import type { BrowserNotification } from './notifications.ts';

const worker = globalThis as unknown as ServiceWorkerGlobalScope;
worker.addEventListener('install', event => { event.waitUntil(worker.skipWaiting()); });
worker.addEventListener('activate', event => { event.waitUntil(worker.clients.claim()); });
// No fetch handler: Yard's authenticated pages, conversations and files are
// always fetched normally and are never put in an offline cache.
worker.addEventListener('push', event => {
  event.waitUntil((async () => {
    let payload: Partial<BrowserNotification> = {};
    try { payload = event.data?.json() ?? {}; } catch { /* Display a useful notification for an empty push as well. */ }
    let route = '/';
    try {
      const target = new URL(payload.url ?? '/', worker.location.origin);
      if (target.origin === worker.location.origin && target.pathname === '/') route = target.pathname + target.search;
    } catch { /* A notification can only navigate within Yard. */ }
    const tag = typeof payload.id === 'string' ? payload.id : 'yard-notification';
    // A replay after browser reconnect must not produce another banner.
    if ((await worker.registration.getNotifications({ tag })).length) return;
    await worker.registration.showNotification(payload.title || 'Yard · 任务通知', {
      body: payload.body || '打开 Yard 查看任务状态。', tag,
      icon: '/brand/icon-192.png', badge: '/brand/icon-192.png', data: { url: route },
    });
  })());
});
worker.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(String(event.notification.data?.url ?? '/'), worker.location.origin);
    if (target.origin !== worker.location.origin) return;
    const windows = await worker.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => {
      const url = new URL(client.url);
      return client.frameType === 'top-level' && url.origin === target.origin && url.pathname === '/' && !url.searchParams.has('app');
    });
    if (!existing) { await worker.clients.openWindow(target.href); return; }
    const channel = new MessageChannel();
    const handled = new Promise<boolean>(resolve => {
      const finish = (value: boolean) => { clearTimeout(timeout); channel.port1.close(); resolve(value); };
      const timeout = setTimeout(() => finish(false), 1500);
      channel.port1.onmessage = event => finish(event.data === true);
    });
    existing.postMessage({ type: 'yard-notification-navigate', url: target.href }, [channel.port2]);
    await existing.focus();
    // A page left open across an upgrade may not have the message listener yet.
    if (!await handled) await existing.navigate(target.href);
  })());
});
