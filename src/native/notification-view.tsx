/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import type * as ReactRuntime from 'react';
import { BrowserNotifications } from './browser-notifications.ts';
import type { BrowserNotificationState } from './browser-notifications.ts';
import type { NotificationKind } from './notifications.ts';

let React: typeof ReactRuntime;
const labels: Record<NotificationKind, string> = { completed: '任务完成', failed: '执行失败', waiting: '等待审批或回答' };
interface SettingsUI {
  Row: ReactRuntime.ComponentType<{ label: ReactRuntime.ReactNode; description?: ReactRuntime.ReactNode; control: ReactRuntime.ReactNode }>;
  Toggle: ReactRuntime.ComponentType<{ checked: boolean; disabled: boolean; onChange(checked: boolean): void; ariaLabel: string }>;
  Button: ReactRuntime.ComponentType<{ color: 'outline'; size: 'toolbar'; type: 'button'; disabled: boolean; onClick(): void; children: ReactRuntime.ReactNode }>;
}
const css = `
.yard-notifications { min-width:0; }
.yard-notifications > p { margin:8px 16px 12px; font-size:12px; line-height:1.5; overflow-wrap:anywhere; }
.yard-notifications .muted { color:var(--color-token-text-secondary,#666); }
.yard-notifications-error { color:var(--color-text-danger,#b42318); overflow-wrap:anywhere; }
`;

function Surface({ client, ui: { Row, Toggle, Button } }: { client: BrowserNotifications; ui: SettingsUI }) {
  const [state, setState] = React.useState<BrowserNotificationState>();
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [notice, setNotice] = React.useState('');
  const mounted = React.useRef(false), pending = React.useRef(false), revision = React.useRef(0);
  React.useEffect(() => {
    mounted.current = true;
    const load = () => {
      if (pending.current) return;
      const version = revision.current;
      void client.load().then(next => { if (mounted.current && !pending.current && version === revision.current) setState(next); })
        .catch(error => { if (mounted.current && !pending.current && version === revision.current) setError(error.message); });
    };
    load(); window.addEventListener('focus', load);
    return () => { mounted.current = false; window.removeEventListener('focus', load); };
  }, [client]);
  const act = async (operation: () => Promise<unknown>, success = '') => {
    if (pending.current) return;
    pending.current = true; revision.current++; setBusy(true); setError(''); setNotice('');
    try {
      await operation();
      const next = await client.load();
      if (mounted.current) { setState(next); setNotice(success); }
    } catch (error) {
      if (mounted.current) {
        setError((error as Error).message);
        try { const next = await client.load(); if (mounted.current) setState(next); } catch { /* Keep the operation error. */ }
      }
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  return <section className="yard-notifications" aria-label="浏览器通知" data-codex-character-input-boundary>
    <style>{css}</style>
    <Row label={!state ? '正在读取通知设置…' : state.enabled ? '本设备通知已开启' : '本设备通知未开启'}
      description="任务有结果或需要你处理时提醒。关闭 Yard 网页后，也可以接收通知。"
      control={<Button color="outline" size="toolbar" type="button" disabled={!state?.supported || busy}
        onClick={() => {
          if (state) void act(() => state.enabled ? client.disable() : client.enable(state.preferences),
            state.enabled ? '本设备通知已关闭。' : '本设备通知已开启，可以发送一条测试通知。');
        }}>{state?.enabled ? '关闭本设备通知' : busy ? '正在开启…' : '开启本设备通知'}</Button>} />
    {state?.reason ? <p role="status">{state.reason}</p> : null}
    {state?.permission === 'denied' && state.supported ? <p>请在浏览器的网站设置中允许 Yard 发送通知，再点击开启。</p> : null}
    {(Object.keys(labels) as NotificationKind[]).map(kind => <Row key={kind} label={labels[kind]}
      control={<Toggle checked={state?.preferences[kind] ?? true} disabled={!state?.enabled || busy} ariaLabel={labels[kind]}
        onChange={checked => {
          if (state) {
            const preferences = { ...state.preferences, [kind]: checked };
            setState({ ...state, preferences }); void act(() => client.update(preferences));
          }
        }} />} />)}
    <Row label="测试通知" description="发送一条通知，检查本设备能否收到。"
      control={<Button color="outline" size="toolbar" type="button" disabled={!state?.enabled || busy}
        onClick={() => { void act(() => client.test(), '测试通知已交给浏览器推送服务，请查看系统通知。'); }}>测试通知</Button>} />
    {error ? <p className="yard-notifications-error" role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {state?.lastError && !error ? <p className="yard-notifications-error" role="status">最近发送：{state.lastError}</p> : null}
    <p className="muted">每台设备、每个浏览器分别开启。通知到达时间取决于网络和系统后台设置；电脑完全退出浏览器后可能暂停接收。</p>
  </section>;
}

export function installBrowserNotifications(react: typeof ReactRuntime) {
  React = react;
  const client = new BrowserNotifications();
  // Refresh the worker after a Yard upgrade without asking for permission or
  // subscribing a device that the user has not enabled.
  if ('serviceWorker' in navigator) void navigator.serviceWorker.getRegistration('/').then(registration => registration?.update()).catch(() => {});
  Object.assign(window, { workbenchNotificationSettings: (ui: SettingsUI) => react.createElement(Surface, { client, ui }) });
}
