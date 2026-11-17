/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import type * as ReactRuntime from 'react';
import type { Root } from 'react-dom/client';
import type { PortForwardRule, PortForwardSnapshot } from './port-forwarding.ts';

type Request = (params: unknown) => Promise<PortForwardSnapshot>;
export interface PortForwardingWindow extends Window {
  workbenchPortForwarding: Request;
  workbenchOpenPortForwarding?: () => void;
}
const deviceKey = 'yard-port-forwarding-device-v1';
const statusNames = { stopped: '已停止', starting: '连接中', running: '转发中', error: '连接失败' };
let React: typeof ReactRuntime;
const css = `
.yard-forward-dialog { --forward-bg:var(--color-token-bg-primary,#fff); --forward-surface:var(--color-token-bg-secondary,#f5f6f8); --forward-border:var(--color-token-border-default,#e2e6eb); --forward-muted:var(--color-token-text-secondary,#626b77); --forward-accent:#245b8f; --forward-success:#24704b; --forward-danger:#b42318; width:min(800px,calc(100vw - 40px)); max-width:none; max-height:calc(100dvh - 40px); margin:auto; padding:0; border:1px solid var(--forward-border); border-radius:16px; background:var(--forward-bg); color:var(--color-token-text-primary,#20242a); box-shadow:0 24px 96px #0003; font:14px/1.5 var(--font-sans,system-ui); }
@supports(color:light-dark(black,white)) { .yard-forward-dialog { --forward-accent:light-dark(#245b8f,#8ebfe8); --forward-success:light-dark(#24704b,#80d2a5); --forward-danger:light-dark(#b42318,#ff9c94); } }
.yard-forward-dialog::backdrop { background:#161c2866; }
.yard-forward { padding:24px; }
.yard-forward:has(.yard-forward-settings[open]) { min-height:300px; }
.yard-forward header,.yard-forward-toolbar,.yard-forward-actions,.yard-forward-device { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.yard-forward header { margin-bottom:20px; }
.yard-forward h1 { margin:0; font-size:20px; font-weight:600; letter-spacing:-.4px; }
.yard-forward h2 { margin:0; font-size:15px; font-weight:550; overflow-wrap:anywhere; }
.yard-forward p { margin:6px 0; }
.yard-forward button,.yard-forward input,.yard-forward select,.yard-forward summary { font:inherit; color:inherit; }
.yard-forward button,.yard-forward summary { display:inline-flex; align-items:center; justify-content:center; gap:6px; min-height:36px; padding:7px 10px; border:1px solid transparent; border-radius:7px; background:transparent; cursor:pointer; white-space:nowrap; line-height:20px; }
.yard-forward :is(button,summary):hover:not(:disabled) { background:var(--forward-surface); }
.yard-forward button:disabled { opacity:.35; cursor:default; }
.yard-forward :is(button,input,select,summary):focus-visible { outline:2px solid var(--forward-accent); outline-offset:3px; }
.yard-forward button.primary { background:var(--color-token-text-primary,#20242a); color:var(--forward-bg); font-weight:500; }
.yard-forward button.primary:hover:not(:disabled) { opacity:.85; }
.yard-forward button.danger { color:var(--forward-danger); }
.yard-forward .icon { width:36px; padding:8px; flex-shrink:0; }
.yard-forward svg { width:16px; height:16px; flex-shrink:0; }
.yard-forward input,.yard-forward select { background:var(--forward-bg); border:1px solid var(--forward-border); border-radius:7px; padding:7px 10px; min-width:0; max-width:100%; min-height:36px; }
.yard-forward select { appearance:auto; }
.yard-forward-toolbar { padding-bottom:12px; border-bottom:1px solid var(--forward-border); }
.yard-forward-current { font-size:13px; color:var(--forward-muted); overflow-wrap:anywhere; }
.yard-forward-setup { padding:20px 0; max-width:360px; }
.yard-forward-settings,.yard-forward-menu { position:relative; flex-shrink:0; }
.yard-forward summary { list-style:none; }
.yard-forward summary::-webkit-details-marker { display:none; }
.yard-forward-settings > summary { color:var(--forward-muted); font-size:13px; }
.yard-forward-popover { position:absolute; z-index:1; right:0; padding:6px; border:1px solid var(--forward-border); border-radius:10px; background:var(--forward-bg); box-shadow:0 8px 28px #0002; }
.yard-forward-settings > .yard-forward-popover { top:calc(100% + 6px); width:300px; max-width:calc(100vw - 48px); padding:14px; }
.yard-forward-device { align-items:stretch; flex-direction:column; gap:12px; }
.yard-forward-device label { display:flex; flex-direction:column; gap:6px; font-size:13px; }
.yard-forward-device button { justify-content:flex-start; color:var(--forward-muted); font-size:13px; }
.yard-forward-form { margin:0; }
.yard-forward-fields { display:grid; grid-template-columns:1fr 1fr; gap:20px; margin:0 0 24px; }
.yard-forward-fields label { display:flex; flex-direction:column; gap:6px; font-size:13px; }
.yard-forward-fields .wide { grid-column:1/-1; }
.yard-forward-endpoint { display:flex; flex-direction:column; gap:16px; min-width:0; }
.yard-forward-source-address { display:grid; grid-template-columns:minmax(0,1fr) 90px; gap:10px; }
.yard-forward-row { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:end; gap:20px; padding:20px 0; border-bottom:1px solid var(--forward-border); }
.yard-forward-row:last-child { border-bottom:0; padding-bottom:0; }
.yard-forward-row-title { display:flex; align-items:center; gap:12px; margin-bottom:12px; }
.yard-forward-route { display:grid; grid-template-columns:minmax(0,1fr) 24px minmax(0,1fr); align-items:center; gap:12px; }
.yard-forward-route > div { min-width:0; overflow-wrap:anywhere; }
.yard-forward-route strong { display:block; font-size:13px; font-weight:450; }
.yard-forward-route > svg { color:var(--forward-muted); opacity:.6; }
.yard-forward code { overflow-wrap:anywhere; font:12px/1.6 var(--font-mono,ui-monospace,monospace); color:var(--forward-muted); }
.yard-forward-status { display:inline-flex; align-items:center; gap:5px; color:var(--forward-muted); font-size:11px; white-space:nowrap; }
.yard-forward-status::before { content:''; width:5px; height:5px; border-radius:50%; background:currentColor; }
.yard-forward-status[data-state="running"] { color:var(--forward-success); }
.yard-forward-status[data-state="starting"] { color:var(--forward-accent); }
.yard-forward-status[data-state="error"],.yard-forward-error { color:var(--forward-danger); }
.yard-forward-error { overflow-wrap:anywhere; }
.yard-forward-empty { padding:32px 0 16px; text-align:center; color:var(--forward-muted); }
.yard-forward-empty button { margin-top:8px; }
.yard-forward-actions { justify-content:flex-end; gap:4px; }
.yard-forward button.yard-forward-toggle { min-width:68px; border-color:var(--forward-border); }
.yard-forward-menu > .yard-forward-popover { bottom:calc(100% + 6px); min-width:140px; }
.yard-forward-menu .yard-forward-popover button { width:100%; justify-content:flex-start; font-size:13px; }
@media(max-width:600px) { .yard-forward-dialog { width:calc(100vw - 16px); max-height:calc(100dvh - 16px); border-radius:14px; } .yard-forward { padding:20px 16px; } .yard-forward h1 { font-size:18px; } .yard-forward header { gap:6px; margin-bottom:16px; } .yard-forward header .yard-forward-actions { gap:0; } .yard-forward header button { padding-inline:7px; font-size:13px; } .yard-forward-fields { grid-template-columns:1fr; } .yard-forward-row { grid-template-columns:minmax(0,1fr); gap:12px; padding:18px 0; } .yard-forward-row-title { margin-bottom:10px; } .yard-forward-route { gap:10px; } .yard-forward-row > .yard-forward-actions { justify-content:flex-end; } }
`;

function Icon({ name }: { name: 'close' | 'plus' | 'arrow' | 'play' | 'stop' | 'external' | 'settings' | 'more' }) {
  const paths = {
    close: <path d="m6 6 12 12M6 18 18 6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="M2 12h19m-5-5 5 5-5 5" />,
    play: <path d="m8 5 11 7-11 7Z" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
    external: <><path d="M14 3h7v7m0-7L11 13" /><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" /></>,
    settings: <><path d="m9 3-1 3-3 1v3l-2 2 2 2v3l3 1 1 3h6l1-3 3-1v-3l2-2-2-2V7l-3-1-1-3Z" /><circle cx="12" cy="12" r="3" /></>,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function initialDevice() { try { return localStorage.getItem(deviceKey) ?? ''; } catch { return ''; } }
function closeControl(element: HTMLElement) { element.closest('details')?.removeAttribute('open'); }
function Surface({ request, close }: { request: Request; close(): void }) {
  const [data, setData] = React.useState<PortForwardSnapshot>();
  const [device, setDevice] = React.useState(initialDevice);
  const [form, setForm] = React.useState<PortForwardRule>();
  const [busy, setBusy] = React.useState('');
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const active = React.useRef(true);
  const pending = React.useRef(false);
  const revision = React.useRef(0);
  React.useEffect(() => {
    active.current = true;
    const load = async () => {
      if (pending.current) return;
      const version = revision.current;
      try { const next = await request({ operation: 'list' }); if (active.current && version === revision.current) setData(next); }
      catch (error) { if (active.current && version === revision.current) setError((error as Error).message); }
    };
    void load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 2000);
    return () => { active.current = false; clearInterval(timer); };
  }, [request]);
  const mutate = async (params: unknown) => {
    if (pending.current) return false;
    pending.current = true; revision.current++; setBusy('working'); setError(''); setNotice('');
    try {
      const next = await request(params);
      if (active.current) setData(next);
      return true;
    } catch (error) {
      if (active.current) {
        setError((error as Error).message);
        try { const next = await request({ operation: 'list' }); if (active.current) setData(next); } catch { /* Retain the actionable operation error. */ }
      }
      return false;
    } finally { pending.current = false; if (active.current) setBusy(''); }
  };
  const hosts = data?.hosts ?? [];
  const hostName = (id: string) => hosts.find(host => host.hostId === id)?.displayName ?? '设备已移除';
  const currentDevice = hosts.some(host => host.hostId === device) ? device : '';
  const rules = data?.rules ?? [];
  // Existing receiver rules also provide the reusable service catalog. Keep
  // each client's listener and status independent; no data migration needed.
  const services = new Map<string, { template: (typeof rules)[number]; current?: (typeof rules)[number] }>();
  for (const rule of rules) {
    const key = JSON.stringify([rule.sourceHostId, rule.serviceHost, rule.servicePort]);
    const service = services.get(key) ?? { template: rule };
    if (rule.targetHostId === currentDevice && (!service.current || rule.status === 'running' || rule.status === 'starting')) service.current = rule;
    services.set(key, service);
  }
  const associate = (value: string) => {
    setDevice(value); setError(''); setNotice('');
    try { localStorage.setItem(deviceKey, value); } catch { setError('浏览器无法保存本设备关联，下次打开需要重新选择'); }
  };
  const create = () => {
    setError(''); setNotice('');
    setForm({ id: crypto.randomUUID(), name: '', sourceHostId: hosts.find(host => host.hostId !== 'local')?.hostId ?? 'local',
      targetHostId: currentDevice, serviceHost: '127.0.0.1', servicePort: 3000, localPort: 13000 });
  };
  const manageDevices = () => {
    window.postMessage({ type: 'navigate-to-route', path: '/settings/connections/ssh' }, location.origin);
    close();
  };
  const options = hosts.map(host => <option key={host.hostId} value={host.hostId}>{host.displayName}</option>);
  const deviceSelect = <label>本设备<select aria-label="本设备" value={currentDevice} disabled={!data || !!busy} onChange={event => associate(event.target.value)}>
    <option value="">请选择这台电脑或平板</option>{options}</select></label>;
  return <section className="yard-forward" data-codex-character-input-boundary>
    <style>{css}</style>
    <header><h1>{form ? data?.rules.some(rule => rule.id === form.id) ? '编辑本机转发' : '新增服务' : '端口转发管理'}</h1>
      <div className="yard-forward-actions">{!form && currentDevice ? <button onClick={create} disabled={!data || !!busy}><Icon name="plus" />新增服务</button> : null}
        <button className="icon" onClick={close} aria-label="关闭端口转发管理" title="关闭"><Icon name="close" /></button></div></header>
    {!form && currentDevice ? <div className="yard-forward-toolbar">
      <span className="yard-forward-current">本设备 · {hostName(currentDevice)}</span>
      <details className="yard-forward-settings" name="yard-forward-controls"><summary><Icon name="settings" />设备设置</summary>
        <div className="yard-forward-popover yard-forward-device">
          {deviceSelect}
          <button onClick={manageDevices}>管理 SSH 设备</button>
        </div></details>
    </div> : null}
    {error ? <p className="yard-forward-error" role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {data && !currentDevice ? <div className="yard-forward-setup yard-forward-device">
      <p>先关联当前设备，服务会转发到这里。</p>{deviceSelect}<button onClick={manageDevices}>管理 SSH 设备</button>
    </div> : null}
    {form ? <form className="yard-forward-form" onSubmit={event => {
      event.preventDefault();
      void mutate({ operation: 'save', rule: form }).then(ok => { if (ok && active.current) setForm(undefined); });
    }}>
      <fieldset className="yard-forward-fields" disabled={!!busy} style={{ padding: 0, border: 0 }}>
        <label className="wide">名称（可选）<input aria-label="转发名称" maxLength={120} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="例如：开发服务" /></label>
        <div className="yard-forward-endpoint"><label>来源设备<select aria-label="来源设备" required value={form.sourceHostId} onChange={event => setForm({ ...form, sourceHostId: event.target.value })}>{options}</select></label>
          <div className="yard-forward-source-address"><label>服务地址<input aria-label="服务地址" required value={form.serviceHost} onChange={event => setForm({ ...form, serviceHost: event.target.value })} /></label>
            <label>服务端口<input aria-label="服务端口" type="number" inputMode="numeric" required min={1} max={65535} value={form.servicePort || ''} onChange={event => setForm({ ...form, servicePort: Number(event.target.value) })} /></label></div></div>
        <div className="yard-forward-endpoint"><span className="yard-forward-current">转发到本机 · {hostName(currentDevice)}</span>
          <label>本地端口<input aria-label="本地端口" type="number" inputMode="numeric" required min={1} max={65535} value={form.localPort || ''} onChange={event => setForm({ ...form, localPort: Number(event.target.value) })} /></label></div>
      </fieldset>
      <div className="yard-forward-actions"><button type="button" disabled={!!busy} onClick={() => setForm(undefined)}>取消</button>
        <button className="primary" disabled={!!busy || !currentDevice} type="submit">{busy ? '保存中…' : '保存服务'}</button></div>
    </form> : null}
    {!data ? <p role="status">正在读取服务…</p> : currentDevice && services.size === 0 && !form ? <div className="yard-forward-empty"><p>还没有可转发的服务</p></div> : null}
    {!form && currentDevice ? <div className="yard-forward-list">{[...services.entries()].map(([key, service]) => {
      const rule = service.current ?? service.template, current = service.current;
      const running = current?.status === 'running' || current?.status === 'starting';
      const url = `http://127.0.0.1:${rule.localPort}`;
      return <article className="yard-forward-row" key={key} data-forward-id={current?.id ?? ''}>
        <div><div className="yard-forward-row-title"><h2>{rule.name}</h2><span className="yard-forward-status" data-state={current?.status ?? 'stopped'}>{current ? statusNames[current.status] : '未转发到本机'}</span></div>
        <div className="yard-forward-route"><div><strong>{hostName(rule.sourceHostId)}</strong><code>{rule.serviceHost}:{rule.servicePort}</code></div>
          <Icon name="arrow" /><div><strong>本机</strong><code>127.0.0.1:{rule.localPort}</code></div></div>
        {current?.error ? <p className="yard-forward-error">{current.error}</p> : null}</div>
        <div className="yard-forward-actions">
          <button className={`yard-forward-toggle${running ? '' : ' primary'}`} data-running={running} onClick={() => { void mutate({ operation: running ? 'stop' : 'start', id: rule.id, targetHostId: currentDevice }); }} disabled={!!busy}><Icon name={running ? 'stop' : 'play'} />{running ? '停止' : '转发到本机'}</button>
          <button className="icon" aria-label="打开网页" disabled={current?.status !== 'running'} title={current?.status !== 'running' ? '启动转发后打开网页' : '打开网页'}
            onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}><Icon name="external" /></button>
          <details className="yard-forward-menu" name="yard-forward-controls"><summary className="icon" aria-label="更多操作" title="更多操作"><Icon name="more" /></summary>
            <div className="yard-forward-popover">
              <button disabled={!!busy || running} title={running ? '停止转发后可编辑' : '配置本机转发'} onClick={event => { closeControl(event.currentTarget); setError(''); setForm({ id: current?.id ?? crypto.randomUUID(), name: rule.name, sourceHostId: rule.sourceHostId,
                targetHostId: currentDevice, serviceHost: rule.serviceHost, servicePort: rule.servicePort, localPort: rule.localPort }); }}>{current ? '编辑' : '配置本机转发'}</button>
              <button disabled={!!busy} onClick={async event => { closeControl(event.currentTarget); try { await navigator.clipboard.writeText(url); setNotice('已复制本机地址'); }
                catch { setError('复制失败，请手动复制：' + url); } }}>复制地址</button>
              {current ? <button className="danger" disabled={!!busy || running} title={running ? '停止转发后可删除' : '删除本机转发'} onClick={event => { closeControl(event.currentTarget); void mutate({ operation: 'remove', id: current.id, targetHostId: currentDevice }); }}>删除本机转发</button> : null}
            </div></details>
        </div>
      </article>;
    })}</div> : null}
  </section>;
}

export function installPortForwarding(react: typeof ReactRuntime, dom: { createRoot(container: Element): Root }) {
  React = react;
  const host = window as unknown as PortForwardingWindow;
  let dialog: HTMLDialogElement | undefined;
  host.workbenchOpenPortForwarding = () => {
    if (dialog?.isConnected) return;
    const previousFocus = document.activeElement;
    dialog = document.createElement('dialog');
    dialog.className = 'yard-forward-dialog'; dialog.setAttribute('aria-label', '端口转发管理');
    dialog.setAttribute('data-codex-character-input-boundary', '');
    document.body.append(dialog);
    const current = dialog, root = dom.createRoot(current);
    current.addEventListener('pointerdown', event => {
      for (const details of current.querySelectorAll('details[open]')) {
        if (event.target instanceof Node && !details.contains(event.target)) details.removeAttribute('open');
      }
    });
    current.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const opened = current.querySelector('details[open]');
      if (opened) { opened.removeAttribute('open'); event.preventDefault(); event.stopPropagation(); }
    });
    current.addEventListener('close', () => {
      root.unmount(); current.remove(); if (dialog === current) dialog = undefined;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    }, { once: true });
    root.render(react.createElement(Surface, { request: host.workbenchPortForwarding, close: () => current.close() }));
    current.showModal();
  };
}
