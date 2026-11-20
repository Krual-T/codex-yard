import type { HostMessage } from '../native/protocol.ts';
import { targetKey, chromeSnapshot } from './protocol.ts';
import type { BrowserTarget, ChromeElementComment, ChromePanelState, ChromeRequest, ChromeTransport } from './protocol.ts';
import type { ChromeConnections, ConnectionRequest } from './client-protocol.ts';

export interface EmbeddedPage {
  readonly url: string; readonly revision: number; readonly error?: string;
  readonly src?: string; readonly loading?: boolean;
  readonly history: readonly string[]; readonly index: number;
}

export class BrowserChrome {
  private readonly listeners = new Map<string, Set<(state: ChromePanelState) => void>>();
  private readonly states = new Map<string, ChromePanelState>();
  private readonly connectionsByTarget = new Map<string, 'client' | 'server'>();
  private readonly generations = new Map<string, number>();
  private commentConverter?: (comment: ChromeElementComment, line: number) => unknown;
  private commentRouteResolver?: (route: string) => string | null;
  private readonly ownerRoutes = new Map<string, string>();
  private readonly conversationHosts = new Map<string, string>();
  // This is the Web implementation of the shipped diff_comments shared object.
  // The renderer owns its editing, removal and submission semantics.
  private comments: Record<string, unknown[]> = {};
  private clientKey?: string;
  private embeddedEnabled = false;
  private readonly embedded = new Map<string, EmbeddedPage>();
  private readonly chromeTargets = new Set<string>();
  private readonly pageListeners = new Map<string, Set<() => void>>();
  private readonly requestHost: (endpoint: string, body: unknown) => Promise<unknown>;
  private readonly publish: (message: HostMessage) => void;
  constructor(requestHost: (endpoint: string, body: unknown) => Promise<unknown>, publish: (message: HostMessage) => void) {
    this.requestHost = requestHost; this.publish = publish;
    try { this.comments = JSON.parse(localStorage.getItem('workbench.browser-comments.v1') || '{}'); } catch {}
  }
  enableEmbeddedPages() { this.embeddedEnabled = true; }
  isEmbedded(target: BrowserTarget) { return this.embeddedEnabled && !this.chromeTargets.has(targetKey(target)); }
  embeddedPage(target: BrowserTarget, initialUrl = 'about:blank'): EmbeddedPage {
    const key = targetKey(target);
    let page = this.embedded.get(key);
    if (!page) {
      let url = 'about:blank', error: string | undefined;
      try { url = this.pageUrl(initialUrl); } catch (reason) { error = (reason as Error).message; }
      page = { url, revision: 0, history: [url], index: 0, error };
      this.embedded.set(key, page);
      this.preparePage(target, page);
    }
    return this.embedded.get(key)!;
  }
  subscribePage(target: BrowserTarget, listener: () => void) {
    const key = targetKey(target), listeners = this.pageListeners.get(key) ?? new Set();
    listeners.add(listener); this.pageListeners.set(key, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) this.pageListeners.delete(key); };
  }
  setEmbedded(target: BrowserTarget, enabled: boolean) {
    const key = targetKey(target);
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
    if (enabled) {
      this.chromeTargets.delete(key);
      void this.requestHost('chrome-browser', { ...target, operation: 'release', connection: this.connectionFor(target), clientKey: this.identity() }).catch(() => {});
      this.publishPage(target);
    } else {
      this.chromeTargets.add(key);
      for (const listener of this.pageListeners.get(key) ?? []) listener();
    }
  }
  acceptsHostSnapshot(message: HostMessage) {
    return message.type !== 'browser-sidebar-state' || !this.isEmbedded({ conversationId: String(message.conversationId), browserTabId: String(message.browserTabId) });
  }
  releaseView(target: BrowserTarget) {
    const key = targetKey(target);
    if (!this.isEmbedded(target)) void this.request({ ...target, operation: 'release' }).catch(() => {});
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
    this.embedded.delete(key); this.chromeTargets.delete(key); this.states.delete(key);
    this.pageListeners.delete(key); this.connectionsByTarget.delete(key);
  }
  private pageUrl(value: string) {
    if (value === 'about:blank') return value;
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('请输入不含账号密码的 HTTP 或 HTTPS 网址');
    return url.href;
  }
  private publishPage(target: BrowserTarget) {
    const key = targetKey(target), page = this.embedded.get(key);
    if (!page) return;
    for (const listener of this.pageListeners.get(key) ?? []) listener();
    const blank = page.url === 'about:blank';
    this.publish({ type: 'browser-sidebar-state', ...target, snapshot: {
      ...chromeSnapshot({ url: blank ? '' : page.url,
        title: blank ? 'New tab' : new URL(page.url).hostname,
        canGoBack: page.index > 0, canGoForward: page.index < page.history.length - 1 }),
      tabType: blank ? 'new-tab-page' : 'web',
      isLoading: page.loading ?? false,
    } });
  }
  commandEmbeddedPage(target: BrowserTarget, command: ChromeRequest['command']) {
    this.embeddedPage(target);
    const key = targetKey(target), previous = this.embedded.get(key)!;
    let page = { ...previous, error: undefined as string | undefined, src: undefined, loading: false };
    try {
      if (command?.type === 'navigate' && command.url) {
        const url = this.pageUrl(command.url);
        page.history = [...page.history.slice(0, page.index + 1), url];
        page.index = page.history.length - 1; page.url = url; page.revision++;
      } else if (command?.type === 'reload') page.revision++;
      else if (command?.type === 'go-back' && page.index > 0) { page.url = page.history[--page.index]!; page.revision++; }
      else if (command?.type === 'go-forward' && page.index < page.history.length - 1) { page.url = page.history[++page.index]!; page.revision++; }
      else return;
    } catch (reason) { page.error = (reason as Error).message; }
    this.embedded.set(key, page); this.preparePage(target, page); this.publishPage(target);
  }
  setConversationHost(conversationId: string, hostId: string) {
    if (this.conversationHosts.get(conversationId) === hostId) return;
    this.conversationHosts.set(conversationId, hostId);
    for (const [key, old] of this.embedded) if (key.startsWith(conversationId + '\0')) {
      const target = { conversationId, browserTabId: key.slice(conversationId.length + 1) };
      const page = { ...old, src: undefined, error: undefined };
      this.embedded.set(key, page); this.preparePage(target, page); this.publishPage(target);
    }
  }
  retryEmbeddedPage(target: BrowserTarget) { this.commandEmbeddedPage(target, { type: 'reload' }); }
  private preparePage(target: BrowserTarget, page: EmbeddedPage) {
    if (page.error || page.url === 'about:blank') return;
    const url = new URL(page.url);
    if (typeof location !== 'undefined' && url.origin === location.origin) return;
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return;
    const key = targetKey(target), pending = { ...this.embedded.get(key)!, loading: true };
    this.embedded.set(key, pending);
    const hostId = this.conversationHosts.get(target.conversationId);
    if (!hostId) {
      const timeout = setTimeout(() => {
        if (this.embedded.get(key) !== pending || this.conversationHosts.has(target.conversationId)) return;
        this.embedded.set(key, { ...pending, loading: false, error: '暂时无法确认网站所在设备，请重新打开当前对话后重试' }); this.publishPage(target);
      }, 5000);
      timeout.unref?.(); return;
    }
    const timeout = setTimeout(() => {
      if (this.embedded.get(key) !== pending) return;
      this.embedded.set(key, { ...pending, loading: false, error: '预览连接超时，请检查 Yard 与 Tailscale 连接后重试' }); this.publishPage(target);
    }, 20_000);
    timeout.unref?.();
    void this.requestHost('development-preview', { url: page.url, hostId }).then(value => {
      if (this.embedded.get(key) !== pending) return;
      const src = this.pageUrl((value as { url: string }).url);
      this.embedded.set(key, { ...pending, src, loading: false }); this.publishPage(target);
    }).catch(reason => {
      if (this.embedded.get(key) !== pending) return;
      this.embedded.set(key, { ...pending, loading: false, error: (reason as Error).message }); this.publishPage(target);
    }).finally(() => clearTimeout(timeout));
  }
  setCommentConverter(converter: (comment: ChromeElementComment, line: number) => unknown) { this.commentConverter = converter; }
  setCommentRouteResolver(resolver: (route: string) => string | null) { this.commentRouteResolver = resolver; }
  private commentOwner(target: BrowserTarget) {
    const route = this.ownerRoutes.get(target.conversationId);
    return (route == null ? null : this.commentRouteResolver?.(route)) ?? target.conversationId;
  }
  getCommentDrafts() { return this.comments; }
  private saveComments(value: Record<string, unknown[]>) {
    localStorage.setItem('workbench.browser-comments.v1', JSON.stringify(value));
    this.comments = value;
  }
  async quoteSelectedElement(target: BrowserTarget, pageId: number) {
    if (!this.commentConverter) throw new Error('聊天编辑器尚未就绪，请稍后再试');
    const key = targetKey(target), generation = this.generations.get(key) ?? 0;
    const owner = this.commentOwner(target);
    const state = await this.request({ ...target, pageId, operation: 'element-context' });
    if (generation !== (this.generations.get(key) ?? 0) || this.states.get(key)?.pageId !== pageId || owner !== this.commentOwner(target)) throw new Error('浏览器面板已切换，请重新引用');
    if (!state.elementContext) throw new Error(state.error || 'Chrome 未返回所选元素');
    const previous = this.comments[owner] ?? [];
    const comment = this.commentConverter({ id: crypto.randomUUID(), body: 'Chrome 中所选元素', anchor: state.elementContext }, previous.length + 1);
    this.saveComments({ ...this.comments, [owner]: [...previous, comment] });
    this.publish({ type: 'shared-object-updated', key: 'diff_comments', value: this.comments });
    return state.elementContext.title;
  }
  private identity() {
    if (!this.clientKey) {
      const storageKey = 'workbench.chrome-client.v1';
      let saved: string | null = null;
      try { saved = localStorage.getItem(storageKey); } catch {}
      this.clientKey = saved && /^[a-zA-Z0-9_-]{32,80}$/.test(saved) ? saved : crypto.randomUUID().replaceAll('-', '');
      try { localStorage.setItem(storageKey, this.clientKey); } catch {}
    }
    return this.clientKey;
  }
  connectionFor(target: BrowserTarget) { return this.connectionsByTarget.get(targetKey(target)) ?? 'client'; }
  async connections(operation: ConnectionRequest['operation'] = 'state'): Promise<ChromeConnections> {
    return await this.requestHost('chrome-connections', { operation, clientKey: this.identity() }) as ChromeConnections;
  }
  async selectConnection(target: BrowserTarget, connection: 'client' | 'server') {
    const key = targetKey(target), previous = this.connectionFor(target);
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
    this.connectionsByTarget.set(key, connection);
    const state: ChromePanelState = { location: 'Chrome', configured: false, pages: [] };
    this.states.set(key, state);
    for (const listener of this.listeners.get(key) ?? []) listener(state);
    // Release only this panel's old binding, retaining every real Chrome tab.
    if (previous !== connection) await this.requestHost('chrome-browser', { ...target, operation: 'release',
      connection: previous, clientKey: this.identity() }).catch(() => {});
    return this.request({ ...target, operation: 'state' });
  }
  request: ChromeTransport = async request => {
    const key = targetKey(request), generation = this.generations.get(key) ?? 0;
    try {
      const state = await this.requestHost('chrome-browser', { ...request,
        connection: this.connectionFor(request), clientKey: this.identity() }) as ChromePanelState;
      if (generation !== (this.generations.get(key) ?? 0)) return state;
      const { elementContext: _context, ...persistent } = state;
      if (request.operation === 'release' || request.command?.type === 'close-tab') this.states.delete(targetKey(request));
      else this.states.set(targetKey(request), persistent);
      for (const listener of this.listeners.get(targetKey(request)) ?? []) listener(persistent);
      return state;
    } catch (error) {
      if (generation !== (this.generations.get(key) ?? 0)) throw error;
      if (request.operation === 'element-context') throw error;
      const state: ChromePanelState = { configured: true, location: '', pages: [], ...this.states.get(key), frame: undefined, error: String((error as Error).message) };
      this.states.set(targetKey(request), state);
      for (const listener of this.listeners.get(targetKey(request)) ?? []) listener(state);
      throw error;
    }
  };
  getState(target: BrowserTarget) { return this.states.get(targetKey(target)); }
  subscribe(target: BrowserTarget, listener: (state: ChromePanelState) => void) {
    const key = targetKey(target);
    const listeners = this.listeners.get(key) ?? new Set();
    listeners.add(listener); this.listeners.set(key, listeners);
    const state = this.states.get(key);
    if (state) listener(state);
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(key); };
  }
  intercept(message: HostMessage) {
    if (message.type === 'browser-sidebar-owner-sync' && typeof message.conversationId === 'string' && typeof message.ownerRoutePath === 'string') {
      this.ownerRoutes.set(message.conversationId, message.ownerRoutePath);
      const host = message.ownerRoutePath.split('/')[1];
      if (host) { try { this.setConversationHost(message.conversationId, decodeURIComponent(host)); } catch {} }
      return false; // The host also persists the original owner's route.
    }
    if (message.key === 'diff_comments') {
      if (message.type === 'shared-object-set') { this.saveComments(message.value as Record<string, unknown[]> ?? {}); return true; }
      if (message.type === 'shared-object-subscribe') { this.publish({ type: 'shared-object-updated', key: 'diff_comments', value: this.comments }); return true; }
      if (message.type === 'shared-object-unsubscribe') return true;
    }
    if (message.type !== 'browser-sidebar-command') return false;
    // Screenshot surfaces have no native design overlay. The original composer
    // clears the canonical draft before sending clear-comments to the panel.
    if (['set-design-modifier-pressed', 'clear-comments'].includes((message.command as ChromeRequest['command'])?.type ?? '')) return true;
    const target = { conversationId: String(message.conversationId), browserTabId: String(message.browserTabId) };
    const command = message.command as ChromeRequest['command'];
    if (this.isEmbedded(target)) { this.commandEmbeddedPage(target, command); return true; }
    const mountNavigation = () => {
      // A new tab has no webview until a snapshot arrives. Mount the error
      // surface too, so a refused initial connection has a visible retry.
      if (command?.type === 'navigate' && command.url) this.publish({ type: 'browser-sidebar-state', ...target,
        snapshot: chromeSnapshot({ url: command.url, title: 'Chrome' }) });
    };
    void this.request({ ...target, operation: 'command', command }).then(state => { if (!state.frame) mountNavigation(); }, mountNavigation);
    return true;
  }
  attached(target: BrowserTarget, mountGeneration: number) {
    this.publish({ type: 'browser-sidebar-webview-attached', ...target, mountGeneration });
  }
}

/** These are renderer AppHost RPC methods, not daemon methods. Native window
 * registration is replaced by the Web element registered by installChromeWebviews. */
export function chromeRpcService(Base: new () => object) {
  return new class extends Base {
    registerWebviewHostSession(_request: { rendererInstanceId: string }) { return true; }
    registerWebviewHost(_request: BrowserTarget & { hostGeneration: number; rendererInstanceId: string }) { return true; }
    // DOM frames disappear on document reload. Let the renderer restore each
    // tab from its existing durable route and submitted URL.
    getPageRestoreResults(request: { pages: BrowserTarget[] }) { return request.pages.map(() => ({ status: 'missing' })); }
    syncView(_request: BrowserTarget & { mountGeneration: number; visible: boolean; presented: boolean }) { return; }
    waitForViewportSize() { return false; } // No native viewport resizing/handoff.
    cancelViewportWait() { return; }
    setAnnotationPresentation() { return; } // Screenshot surfaces have no annotation overlay.
    async subscribePermissionPrompts(_target: BrowserTarget, listener: (prompts: unknown[]) => Promise<unknown> & { [Symbol.dispose]?: () => void }) {
      // Permission prompts remain in the attached Chrome, never auto-approved.
      const result = listener([]);
      try { await result; } finally { result[Symbol.dispose]?.(); }
      return new class extends Base { [Symbol.dispose]() {} }();
    }
    setAudioMuted() { throw new Error('请在真实 Chrome 标签中调整音频'); }
  }();
}

export type ChromeWindow = Window & { workbenchChrome?: BrowserChrome };
