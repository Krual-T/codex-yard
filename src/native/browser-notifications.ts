import type { NotificationPreferences } from './notifications.ts';

interface Status {
  publicKey: string; subscribed: boolean; preferences: NotificationPreferences;
  lastSuccess: number | null; lastError: string | null;
}
export interface BrowserNotificationState extends Status { supported: boolean; reason: string; permission: NotificationPermission; enabled: boolean }

async function request<T>(body: unknown): Promise<T> {
  const response = await fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || '通知设置暂时无法保存，请稍后重试。');
  return value as T;
}
function unsupported() {
  if (!window.isSecureContext) return '请通过 HTTPS 打开 Yard 后开启通知。';
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return '此浏览器暂不支持后台通知，请使用支持通知的 Chrome、Edge、Firefox 或主屏幕网页应用。';
  return '';
}
function publicKey(value: string) { return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), character => character.charCodeAt(0)); }
async function registration() {
  await navigator.serviceWorker.register('/notification-worker.js', { scope: '/', updateViaCache: 'none' });
  return navigator.serviceWorker.ready;
}

export class BrowserNotifications {
  async load(): Promise<BrowserNotificationState> {
    const reason = unsupported();
    const existing = reason ? undefined : await navigator.serviceWorker.getRegistration('/');
    const subscription = await existing?.pushManager.getSubscription();
    const status = await request<Status>({ operation: 'status', endpoint: subscription?.endpoint });
    const permission = 'Notification' in window ? Notification.permission : 'denied';
    return { ...status, supported: !reason, reason, permission, enabled: permission === 'granted' && !!subscription && status.subscribed };
  }
  async enable(preferences: NotificationPreferences) {
    const reason = unsupported(); if (reason) throw new Error(reason);
    // Request permission in the click's user activation, before any network await.
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission !== 'granted') throw new Error(permission === 'denied'
      ? '通知权限已被关闭，请在浏览器的网站设置中允许 Yard 发送通知。' : '尚未允许通知，可以稍后再开启。');
    const [worker, status] = await Promise.all([registration(), request<Status>({ operation: 'status' })]);
    let subscription = await worker.pushManager.getSubscription();
    const key = publicKey(status.publicKey);
    const oldKey = subscription?.options.applicationServerKey;
    if (subscription && oldKey && Array.from(new Uint8Array(oldKey)).join() !== Array.from(key).join()) {
      await subscription.unsubscribe(); subscription = null;
    }
    if (!subscription) {
      let timer: ReturnType<typeof setTimeout>;
      try {
        subscription = await Promise.race([
          worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('浏览器暂时无法建立推送连接，请检查网络后重试。')), 20000); }),
        ]);
      } finally { clearTimeout(timer!); }
    }
    await request({ operation: 'subscribe', subscription: subscription.toJSON(), preferences });
    return this.load();
  }
  async disable() {
    const worker = await navigator.serviceWorker.getRegistration('/');
    const subscription = await worker?.pushManager.getSubscription();
    if (subscription) {
      await request({ operation: 'unsubscribe', endpoint: subscription.endpoint });
      await subscription.unsubscribe();
    }
    return this.load();
  }
  async update(preferences: NotificationPreferences) {
    const worker = await navigator.serviceWorker.getRegistration('/');
    const subscription = await worker?.pushManager.getSubscription();
    if (!subscription) throw new Error('请先开启本设备通知。');
    await request({ operation: 'subscribe', subscription: subscription.toJSON(), preferences });
    return this.load();
  }
  async test() {
    const worker = await navigator.serviceWorker.getRegistration('/');
    const subscription = await worker?.pushManager.getSubscription();
    if (!subscription) throw new Error('请先开启本设备通知。');
    await request({ operation: 'test', endpoint: subscription.endpoint });
  }
}
