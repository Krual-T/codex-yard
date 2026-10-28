import type { HostMessage } from '../native/protocol.ts';
import { targetKey, chromeSnapshot } from './protocol.ts';
import type { BrowserTarget, ChromeElementComment, ChromeElementContext, ChromePanelState, ChromeRequest, ChromeTransport } from './protocol.ts';
import type { ChromeConnections, ConnectionRequest } from './client-protocol.ts';

export class BrowserChrome {
  private readonly listeners = new Map<string, Set<(state: ChromePanelState) => void>>();
  private readonly states = new Map<string, ChromePanelState>();
  private readonly connectionsByTarget = new Map<string, 'client' | 'server'>();
  private readonly generations = new Map<string, number>();
  private commentConverter?: (comment: ChromeElementComment, line: number) => unknown;
  private commentRouteResolver?: (route: string) => string | null;
  private readonly ownerRoutes = new Map<string, string>();
  // This is the Web implementation of the shipped diff_comments shared object.
  // The renderer owns its editing, removal and submission semantics.
  private comments: Record<string, unknown[]> = {};
  private clientKey?: string;
  private readonly requestHost: (endpoint: string, body: unknown) => Promise<unknown>;
  private readonly publish: (message: HostMessage) => void;
  constructor(requestHost: (endpoint: string, body: unknown) => Promise<unknown>, publish: (message: HostMessage) => void) {
    this.requestHost = requestHost; this.publish = publish;
    try { this.comments = JSON.parse(localStorage.getItem('workbench.browser-comments.v1') || '{}'); } catch {}
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
  async selectedElement(target: BrowserTarget, pageId: number): Promise<ChromeElementContext> {
    const key = targetKey(target), generation = this.generations.get(key) ?? 0;
    const state = await this.request({ ...target, pageId, operation: 'element-context' });
    if (generation !== (this.generations.get(key) ?? 0) || this.states.get(key)?.pageId !== pageId) throw new Error('浏览器面板已切换，请重新引用');
    if (!state.elementContext) throw new Error(state.error || 'Chrome 未返回所选元素');
    return state.elementContext;
  }
  selectionVersion(target: BrowserTarget) { return this.generations.get(targetKey(target)) ?? 0; }
  selectionIsCurrent(target: BrowserTarget, pageId: number, version: number) {
    return this.selectionVersion(target) === version && this.getState(target)?.pageId === pageId;
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
    const key = targetKey(request);
    if (request.operation === 'select' || request.operation === 'release' || request.operation === 'command') {
      this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
    }
    const generation = this.generations.get(key) ?? 0;
    try {
      const state = await this.requestHost('chrome-browser', { ...request,
        connection: this.connectionFor(request), clientKey: this.identity() }) as ChromePanelState;
      if (generation !== (this.generations.get(key) ?? 0)) return state;
      // An element lookup is a transient read and may finish after a page change.
      if (request.operation === 'element-context') return state;
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
