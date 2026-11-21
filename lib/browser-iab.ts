/** Yard's host for the unmodified Browser plugin's native-pipe protocol.
 * The original service continues to own its DOM/Playwright, policy and approval
 * behavior. This module owns only an explicitly configured Chromium and tabs. */
import { chmod, mkdir } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { resolve } from 'node:path';
import { endianness } from 'node:os';
import { IabCdp, type CdpEvent } from './browser-iab-cdp.ts';
import { preparePrivateSocket } from './private-socket.ts';
import type { IabPanelRequest, IabPanelState } from '../src/browser-reuse/iab-protocol.ts';

type ObjectValue = Record<string, unknown>;
const record = (value: unknown): ObjectValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
interface Tab { id: number; targetId: string; sessionId: string; active: boolean; userCreated?: boolean; usedTurn?: string; markedTurn?: string }
interface Attachment { tab: Tab; cdpSessionId: string; targetId: string; top: boolean; keys: Map<string, ObjectValue>; buttons: Set<string>; x: number; y: number }
interface Peer { sessionId?: string; socket?: Socket; attachments: Map<string, Attachment>; closed: boolean }
interface Constraint { kind: 'domains' | 'origins'; mode: 'allowlist' | 'denylist'; patterns: string[] }
interface NetworkPolicy { constraints: Constraint[] }
export interface IabHostOptions { socketPath: string; dataDirectory: string; executablePath: string; headless?: boolean; args?: string[] }

/** The host currently supports unrestricted Chromium networking. Reject a
 * restricted policy before attaching; a partial Fetch interceptor would lose
 * enforcement when the tool disconnects and does not cover every worker. */
export function parseIabNetworkPolicy(value: unknown): NetworkPolicy {
  const constraints = record(value).constraints;
  if (!Array.isArray(constraints)) throw new Error('Browser network policy is missing');
  const parsed = constraints.map(raw => {
    const c = record(raw);
    if (!['domains', 'origins'].includes(String(c.kind)) || !['allowlist', 'denylist'].includes(String(c.mode)) ||
      !Array.isArray(c.patterns) || c.patterns.some(p => typeof p !== 'string' || !p || /[\s\[\]\\?#]/.test(p))) throw new Error('Unsupported browser network policy');
    return { kind: c.kind, mode: c.mode, patterns: c.patterns } as Constraint;
  });
  if (parsed.some(c => c.mode === 'allowlist' || c.patterns.length > 0)) throw new Error('Yard Browser does not yet support restricted network policies. This browser action was not attached.');
  return { constraints: parsed };
}

export async function startIabHost(options: IabHostOptions) {
  await mkdir(options.dataDirectory, { recursive: true, mode: 0o700 });
  await preparePrivateSocket(options.socketPath, 'Browser');
  const peers = new Set<Peer>(), panels = new Map<string, Peer>(), tabs = new Map<number, Tab>();
  const bindings = new Map<string, { peer: Peer; attachment: Attachment }>();
  let nextTabId = 0, closed = false, browser: IabCdp | undefined, opening: Promise<IabCdp> | undefined;
  const ownTabs = (sessionId: string) => [...tabs.values()].filter(tab => tab.sessionId === sessionId);
  function removeTab(tab: Tab) {
    tabs.delete(tab.id);
    const remaining = ownTabs(tab.sessionId);
    if (remaining.length && !remaining.some(value => value.active)) remaining[0].active = true;
  }
  async function chromium() {
    if (closed) throw new Error('Yard Browser host is closed');
    if (!opening) opening = (async () => {
      browser = new IabCdp(options.executablePath, ['--remote-debugging-pipe', '--user-data-dir=' + resolve(options.dataDirectory, 'profile'),
        '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-default-apps',
        '--disable-sync', ...(options.headless !== false ? ['--headless=new'] : []), ...(options.args ?? []), 'about:blank']);
      browser.on('event', (event: CdpEvent) => { void cdpEvent(event).catch(() => {}); });
      browser.on('closed', () => {
        for (const peer of peers) peer.socket?.destroy();
        bindings.clear(); tabs.clear();
        for (const peer of panels.values()) peer.attachments.clear();
        opening = undefined;
      });
      await browser.send('Browser.getVersion', {}, undefined, 12_000);
      await browser.send('Target.setDiscoverTargets', { discover: true });
      return browser;
    })().catch(error => { opening = undefined; throw error; });
    return opening;
  }
  function notify(peer: Peer, method: string, params: unknown) {
    if (!peer.socket || peer.socket.destroyed) return;
    send(peer.socket, { jsonrpc: '2.0', method, params });
  }
  async function cdpEvent(event: CdpEvent) {
    if (!event.sessionId && event.method === 'Target.targetCreated') {
      const info = record(event.params.targetInfo), opener = [...tabs.values()].find(tab => tab.targetId === info.openerId);
      if (info.type === 'page' && typeof info.targetId === 'string' && opener && ![...tabs.values()].some(tab => tab.targetId === info.targetId)) {
        for (const tab of ownTabs(opener.sessionId)) tab.active = false;
        const tab: Tab = { id: ++nextTabId, targetId: info.targetId, sessionId: opener.sessionId, active: true, userCreated: opener.userCreated, usedTurn: opener.usedTurn };
        tabs.set(tab.id, tab);
      }
    }
    if (!event.sessionId && event.method === 'Target.targetDestroyed') {
      for (const tab of tabs.values()) if (tab.targetId === event.params.targetId) removeTab(tab);
    }
    const owner = event.sessionId ? bindings.get(event.sessionId) : undefined;
    if (!owner) return;
    const { peer, attachment: a } = owner;
    if (event.method === 'Target.attachedToTarget') {
      const info = record(event.params.targetInfo), id = String(event.params.sessionId);
      const child: Attachment = { tab: a.tab, cdpSessionId: id, targetId: String(info.targetId), top: false, keys: new Map(), buttons: new Set(), x: 0, y: 0 };
      bindings.set(id, { peer, attachment: child }); peer.attachments.set(id, child);
    }
    if (event.method === 'Target.detachedFromTarget') {
      const id = String(event.params.sessionId); bindings.delete(id); peer.attachments.delete(id);
    }
    notify(peer, 'onCDPEvent', { source: { tabId: a.tab.id, ...(a.top ? {} : { sessionId: a.cdpSessionId }) }, method: event.method, params: event.params });
  }
  function session(peer: Peer, params: ObjectValue) {
    const id = params.session_id;
    if (typeof id !== 'string' || !id || id.length > 200 || /[\0\r\n]/.test(id)) throw new Error('Missing required browser session_id');
    if (peer.sessionId && peer.sessionId !== id) throw new Error('Browser connection belongs to another session');
    peer.sessionId = id; return id;
  }
  function tabFor(peer: Peer, id: unknown) {
    const tab = tabs.get(Number(id));
    if (!tab || tab.sessionId !== peer.sessionId) throw new Error('Tab is not part of the current browser session');
    return tab;
  }
  async function attach(peer: Peer, tab: Tab) {
    if (peer.closed) throw new Error('Browser connection is closed');
    let a = [...peer.attachments.values()].find(value => value.tab === tab && value.top);
    if (!a) {
      const cdp = await chromium();
      if (peer.closed) throw new Error('Browser connection is closed');
      const result = await cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId: tab.targetId, flatten: true });
      if (peer.closed) {
        await cdp.send('Target.detachFromTarget', { sessionId: result.sessionId }).catch(() => {});
        throw new Error('Browser connection closed while attaching');
      }
      a = { tab, cdpSessionId: result.sessionId, targetId: tab.targetId, top: true, keys: new Map(), buttons: new Set(), x: 0, y: 0 };
      peer.attachments.set(a.cdpSessionId, a); bindings.set(a.cdpSessionId, { peer, attachment: a });
    }
    return a;
  }
  async function release(a: Attachment) {
    if (!browser) return;
    for (const value of a.keys.values()) await browser.send('Input.dispatchKeyEvent', { ...value, type: 'keyUp', text: undefined }, a.cdpSessionId).catch(() => {});
    for (const button of a.buttons) await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: a.x, y: a.y, button, clickCount: 1 }, a.cdpSessionId).catch(() => {});
    a.keys.clear(); a.buttons.clear();
  }
  async function detach(peer: Peer, tab?: Tab) {
    for (const [id, a] of peer.attachments) {
      if (tab && a.tab !== tab) continue;
      await release(a);
      await browser?.send('Target.detachFromTarget', { sessionId: id }).catch(() => {});
      bindings.delete(id); peer.attachments.delete(id);
      if (a.top) notify(peer, 'onCDPDetach', { tabId: a.tab.id });
    }
  }
  async function tabInfo(peer: Peer, tab: Tab) {
    const result = await (await chromium()).send<{ targetInfo: { url: string; title: string } }>('Target.getTargetInfo', { targetId: tab.targetId });
    return { id: tab.id, title: result.targetInfo.title, url: result.targetInfo.url, active: tab.active, sessionControlled: true };
  }
  function allowedTarget(peer: Peer, targetId: unknown) {
    return typeof targetId === 'string' && (ownTabs(peer.sessionId!).some(t => t.targetId === targetId) || [...peer.attachments.values()].some(a => a.targetId === targetId));
  }
  async function request(peer: Peer, method: string, params: ObjectValue = {}): Promise<unknown> {
    if (method === 'ping') return 'pong';
    session(peer, params);
    if (method === 'getInfo') return { name: 'Yard Browser', type: 'iab', discoveryScope: 'session',
      metadata: { codexSessionId: peer.sessionId, codexAppBuildFlavor: 'prod' }, capabilities: { browser: [], tab: [] },
      apiSupportOverrides: { 'Tab.ax': false, 'Tab.clipboard': false, 'Browser.user': false }, sessionTabForegroundEnabled: false, blobDownloadsSupported: false };
    if (method === 'nameSession') return {};
    if (method === 'markTab') {
      const tab = tabFor(peer, params.tabId);
      if (!['deliverable', 'handoff'].includes(String(params.status))) throw new Error('Unsupported tab mark');
      tab.markedTurn = String(params.turn_id); return {};
    }
    if (method === 'turnEnded') {
      await detach(peer);
      for (const tab of ownTabs(peer.sessionId!)) if (!tab.userCreated && tab.usedTurn === params.turn_id && tab.markedTurn !== params.turn_id) {
        await browser?.send('Target.closeTarget', { targetId: tab.targetId }); removeTab(tab);
      }
      return {};
    }
    if (method === 'getTabs' || method === 'getUserTabs') {
      const result = [];
      for (const tab of ownTabs(peer.sessionId!)) {
        try { result.push(await tabInfo(peer, tab)); } catch { removeTab(tab); }
      }
      return result;
    }
    if (method === 'createTab') {
      const cdp = await chromium();
      const { targetId } = await cdp.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
      for (const tab of ownTabs(peer.sessionId!)) tab.active = false;
      const tab: Tab = { id: ++nextTabId, targetId, sessionId: peer.sessionId!, active: true, userCreated: peer.socket == null, usedTurn: typeof params.turn_id === 'string' ? params.turn_id : undefined };
      tabs.set(tab.id, tab); return tabInfo(peer, tab);
    }
    if (method === 'getCommittedTabUrl') return (await tabInfo(peer, tabFor(peer, params.tabId))).url;
    if (method === 'getTabContext') {
      const tab = params.tabId == null ? ownTabs(peer.sessionId!).find(t => t.active) : tabFor(peer, params.tabId);
      if (!tab) throw new Error('No active browser tab for this conversation');
      const info = await tabInfo(peer, tab), a = await attach(peer, tab);
      const result = await (await chromium()).send<{ result: { value?: string } }>('Runtime.evaluate', {
        expression: 'document.body?.innerText ?? ""', returnByValue: true,
      }, a.cdpSessionId);
      const text = result.result.value ?? '';
      return { tabId: tab.id, text: text.slice(0, 50000), title: info.title, url: info.url, truncated: text.length > 50000 };
    }
    if (method === 'executeTabRead') {
      const tab = tabFor(peer, params.tabId), info = await tabInfo(peer, tab);
      if (info.url !== params.expectedUrl) throw new Error('Browser page changed before the authorized read');
      const kind = record(params.read).kind;
      if (kind !== 'page' && kind !== 'selection') return null;
      const a = await attach(peer, tab), result = await (await chromium()).send<{ result: { value?: string } }>('Runtime.evaluate', {
        expression: kind === 'selection' ? 'window.getSelection()?.toString() ?? ""' : 'document.body?.innerText ?? ""', returnByValue: true,
      }, a.cdpSessionId);
      if ((await tabInfo(peer, tab)).url !== params.expectedUrl) throw new Error('Browser page changed during the authorized read');
      const text = result.result.value ?? '';
      return { text: text.slice(0, 50000), title: info.title, url: info.url, truncated: text.length > 50000 };
    }
    if (method === 'attach') {
      const tab = tabFor(peer, params.tabId); tab.usedTurn = typeof params.turn_id === 'string' ? params.turn_id : tab.usedTurn;
      parseIabNetworkPolicy(params.networkPolicy); await attach(peer, tab); return {};
    }
    if (method === 'detach') { await detach(peer, tabFor(peer, params.tabId)); return {}; }
    if (method === 'attachBrowserUseNetworkPolicy') { parseIabNetworkPolicy(params.policy); await attach(peer, tabFor(peer, params.tabId)); return {}; }
    if (method === 'detachBrowserUseNetworkPolicy') { tabFor(peer, params.tabId); return {}; }
    if (method === 'moveMouse') {
      const a = await attach(peer, tabFor(peer, params.tabId));
      await (await chromium()).send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: params.x, y: params.y }, a.cdpSessionId); return {};
    }
    if (method === 'executeCdp') {
      const target = record(params.target), tab = tabFor(peer, target.tabId);
      const cdp = await chromium(), command = String(params.method), commandParams = record(params.commandParams);
      const top = await attach(peer, tab);
      const a = target.sessionId || target.targetId ? [...peer.attachments.values()].find(value => value.tab === tab &&
        (target.sessionId ? value.cdpSessionId === target.sessionId : value.targetId === target.targetId)) : top;
      if (!a) throw new Error('CDP target is not attached to the current tab');
      if (command === 'Target.getTargets') {
        const value = await cdp.send<{ targetInfos: ObjectValue[] }>(command);
        return { targetInfos: value.targetInfos.filter(t => allowedTarget(peer, t.targetId)).map(t => {
          const owner = ownTabs(peer.sessionId!).find(value => value.targetId === t.targetId);
          return { ...t, tabId: owner?.id ?? tab.id };
        }) };
      }
      if (command.startsWith('Browser.')) throw new Error('Browser-wide CDP commands are not supported by the Yard session host');
      if (command.startsWith('Target.') && !['Target.setAutoAttach', 'Target.getTargetInfo', 'Target.closeTarget', 'Target.attachToTarget', 'Target.detachFromTarget'].includes(command)) throw new Error('Browser-wide target control is not supported');
      if (command === 'Target.getTargetInfo' && commandParams.targetId && !allowedTarget(peer, commandParams.targetId)) throw new Error('Target belongs to another session');
      if ((command === 'Target.closeTarget' || command === 'Target.attachToTarget') && !allowedTarget(peer, commandParams.targetId)) throw new Error('Target belongs to another session');
      if (command === 'Target.detachFromTarget' && commandParams.sessionId && !peer.attachments.has(String(commandParams.sessionId))) throw new Error('Target belongs to another session');
      if (command === 'Input.dispatchKeyEvent') {
        const key = String(commandParams.code ?? commandParams.key ?? commandParams.windowsVirtualKeyCode);
        if (commandParams.type === 'keyDown' || commandParams.type === 'rawKeyDown') a.keys.set(key, commandParams);
      }
      if (command === 'Input.dispatchMouseEvent') {
        a.x = Number(commandParams.x); a.y = Number(commandParams.y);
        if (commandParams.type === 'mousePressed') a.buttons.add(String(commandParams.button));
      }
      // Track presses before dispatch: a disconnected tool may not receive the
      // acknowledgement even though Chromium already applied the input.
      const result = await cdp.send(command, commandParams, a.cdpSessionId, typeof params.timeoutMs === 'number' ? params.timeoutMs : 15_000);
      if (command === 'Input.dispatchKeyEvent' && commandParams.type === 'keyUp') a.keys.delete(String(commandParams.code ?? commandParams.key ?? commandParams.windowsVirtualKeyCode));
      if (command === 'Input.dispatchMouseEvent' && commandParams.type === 'mouseReleased') a.buttons.delete(String(commandParams.button));
      if (command === 'Page.close' || command === 'Target.closeTarget') {
        const targetId = command === 'Page.close' ? tab.targetId : commandParams.targetId;
        for (const owned of ownTabs(peer.sessionId!)) if (owned.targetId === targetId) removeTab(owned);
      }
      return result;
    }
    throw new Error('No handler registered for method: ' + method);
  }
  const server = createServer(socket => {
    const peer: Peer = { socket, attachments: new Map(), closed: false }; peers.add(peer);
    let buffered = Buffer.alloc(0);
    socket.on('error', () => {});
    socket.on('data', chunk => {
      buffered = Buffer.concat([buffered, typeof chunk === 'string' ? Buffer.from(chunk) : chunk]);
      while (buffered.length >= 4) {
        const length = endianness() === 'LE' ? buffered.readUInt32LE(0) : buffered.readUInt32BE(0);
        if (length > 8 * 1024 * 1024) { socket.destroy(new Error('Browser request exceeds frame limit')); return; }
        if (buffered.length < length + 4) return;
        const body = buffered.subarray(4, length + 4); buffered = buffered.subarray(length + 4);
        let value: ObjectValue;
        try { value = record(JSON.parse(body.toString('utf8'))); } catch { socket.destroy(); return; }
        if (value.id == null) continue;
        void request(peer, String(value.method), record(value.params)).then(result => send(socket, { jsonrpc: '2.0', id: value.id, result }),
          error => send(socket, { jsonrpc: '2.0', id: value.id, error: { code: 1, message: error instanceof Error ? error.message : String(error) } }));
      }
    });
    socket.once('close', () => { peer.closed = true; peers.delete(peer); void detach(peer); });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.socketPath, resolve); });
  if (process.platform !== 'win32') await chmod(options.socketPath, 0o600);
  async function panel(value: IabPanelRequest): Promise<IabPanelState> {
    if (!value.sessionId || /[\0\r\n]/.test(value.sessionId)) throw new Error('A conversation is required');
    let peer = panels.get(value.sessionId);
    if (!peer) { peer = { sessionId: value.sessionId, attachments: new Map(), closed: false }; panels.set(value.sessionId, peer); }
    const call = (method: string, params: ObjectValue = {}) => request(peer!, method, { ...params, session_id: value.sessionId });
    if (value.operation === 'new') await call('createTab');
    let tab: Tab | undefined = value.tabId ? tabFor(peer, value.tabId) : ownTabs(value.sessionId).find(t => t.active) ?? ownTabs(value.sessionId)[0];
    if (!tab && value.operation === 'navigate') { await call('createTab'); tab = ownTabs(value.sessionId).find(t => t.active); }
    if (tab && value.operation === 'select') {
      for (const owned of ownTabs(value.sessionId)) owned.active = owned === tab;
    }
    if (tab && value.operation !== 'state' && value.operation !== 'new' && value.operation !== 'select') {
      const cdp = (method: string, commandParams: ObjectValue = {}) => call('executeCdp', { target: { tabId: tab!.id }, method, commandParams });
      if (value.operation === 'navigate') {
        const url = new URL(value.url!);
        if (!['http:', 'https:', 'about:'].includes(url.protocol) || (url.protocol === 'about:' && url.href !== 'about:blank') || url.username || url.password) throw new Error('Enter an HTTP or HTTPS URL without credentials');
        await cdp('Page.navigate', { url: url.href });
      } else if (value.operation === 'reload') await cdp('Page.reload');
      else if (value.operation === 'close') { await cdp('Page.close'); tab = ownTabs(value.sessionId)[0]; }
      else if (value.operation === 'click') {
        if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) throw new Error('Invalid click coordinates');
        await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: value.x, y: value.y, button: 'left', clickCount: 1 });
        await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: value.x, y: value.y, button: 'left', clickCount: 1 });
      } else if (value.operation === 'text') await cdp('Input.insertText', { text: value.text ?? '' });
      else if (value.operation === 'key') {
        const key = value.key!; if (typeof key !== 'string' || key.length > 40) throw new Error('Invalid browser key');
        const virtual: Record<string, number> = { Enter: 13, Backspace: 8, Tab: 9, Escape: 27, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46 };
        await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, windowsVirtualKeyCode: virtual[key] });
        await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: virtual[key] });
      }
    }
    const list = await call('getTabs') as IabPanelState['tabs'];
    tab = ownTabs(value.sessionId).find(value => value.active);
    let frame: IabPanelState['frame'];
    if (tab) {
      const a = await attach(peer, tab);
      const cdp = await chromium();
      const shot = await cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'jpeg', quality: 75 }, a.cdpSessionId);
      const size = await cdp.send<{ cssVisualViewport?: { clientWidth: number; clientHeight: number }; visualViewport: { clientWidth: number; clientHeight: number } }>('Page.getLayoutMetrics', {}, a.cdpSessionId);
      const viewport = size.cssVisualViewport ?? size.visualViewport;
      frame = { image: 'data:image/jpeg;base64,' + shot.data, width: viewport.clientWidth, height: viewport.clientHeight };
    }
    return { tabs: list, selectedTabId: tab?.id, frame };
  }
  return { socketPath: options.socketPath, panel, async close() {
    closed = true;
    for (const peer of peers) peer.socket?.destroy();
    const stopped = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await browser?.close(); await stopped;
  } };
}
function send(socket: Socket, value: unknown) {
  if (socket.destroyed) return;
  const data = Buffer.from(JSON.stringify(value)), header = Buffer.alloc(4);
  if (endianness() === 'LE') header.writeUInt32LE(data.length); else header.writeUInt32BE(data.length);
  socket.write(Buffer.concat([header, data]));
}
