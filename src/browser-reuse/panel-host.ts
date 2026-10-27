import { connectChrome, resultText } from './chrome-mcp.ts';
import type { BrowserTools, ChromeConnection, ToolResult } from './chrome-mcp.ts';
import { targetKey, chromeSnapshot } from './protocol.ts';
import type { BrowserTarget, ChromeFrame, ChromePage, ChromePanelState, ChromeRequest } from './protocol.ts';
import { readSelectedElement } from './element-context.ts';

export function chromeConnectionFromEnv(env: NodeJS.ProcessEnv = process.env): ChromeConnection | undefined {
  const value = env.AGENTS_CHROME_CONNECTION;
  if (!value) return undefined;
  const connection = JSON.parse(value) as ChromeConnection;
  if (!connection || typeof connection !== 'object' ||
      (!('browserUrl' in connection && typeof connection.browserUrl === 'string') && !('autoConnect' in connection && connection.autoConnect === true))) {
    throw new Error('AGENTS_CHROME_CONNECTION 需要 browserUrl 或 autoConnect:true');
  }
  return connection;
}

export function parsePages(result: ToolResult): ChromePage[] {
  // MCP 1.12.0 formats display text as "id: title (url) [selected]".
  // Its structured pages preserve URL boundaries and avoid parsing titles.
  const pages = result.structuredContent?.pages;
  if (!Array.isArray(pages)) throw new Error('官方 MCP 未返回结构化标签列表');
  return pages.map(({ id, url, selected }) => {
    if (!Number.isSafeInteger(id) || typeof url !== 'string') throw new Error('官方 MCP 标签数据无效');
    return { id, url, selected: selected === true };
  });
}

function webUrl(value: unknown) {
  const url = new URL(String(value));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('请输入不含凭据的 HTTP 或 HTTPS 地址');
  return url.href;
}

// One queue per WebSocket owns one MCP connection. Every action has an explicit
// pageId; a failed/missing tab never falls back to a different personal tab.
export class ChromePanelHost {
  private connection?: Promise<BrowserTools & { close(): Promise<void> }>;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly panels = new Map<string, { pageId?: number; frame?: ChromeFrame }>();
  private closed = false;
  private closing?: Promise<void>;
  private readonly config: ChromeConnection | undefined;
  private readonly publish: (message: Record<string, unknown>) => void;
  private readonly origin: string;
  private readonly connect: typeof connectChrome;
  constructor(config: ChromeConnection | undefined, publish: (message: Record<string, unknown>) => void,
    origin: string, connect: typeof connectChrome = connectChrome) {
    this.config = config; this.publish = publish; this.origin = origin; this.connect = connect;
  }

  request(request: ChromeRequest): Promise<ChromePanelState> {
    const result = this.queue.catch(() => {}).then(() => this.run(request));
    this.queue = result;
    return result;
  }

  private getConnection() {
    if (!this.connection) {
      // MCP initialize only opens stdio. Chrome attachment is lazy, so include
      // a read-only probe in establishment before retaining the connection.
      const pending = this.connect(this.config!).then(async tools => {
        try { await tools.callTool('list_pages'); return tools; }
        catch (error) { await tools.close(); throw error; }
      }).catch(error => {
        if (this.connection === pending) this.connection = undefined;
        throw error;
      });
      this.connection = pending;
    }
    return this.connection;
  }

  private async run(request: ChromeRequest): Promise<ChromePanelState> {
    if (this.closed) throw new Error('浏览器面板连接已关闭');
    if (!request || typeof request.conversationId !== 'string' || typeof request.browserTabId !== 'string' ||
        !request.conversationId || !request.browserTabId || request.conversationId.length > 512 || request.browserTabId.length > 512) throw new Error('无效浏览器面板');
    const key = targetKey(request);
    const location = this.config && 'autoConnect' in this.config && this.config.windowsSsh
      ? `Chrome · ${this.config.windowsSsh.host}` : 'Chrome · 工作台服务所在电脑';
    const state: ChromePanelState = { location, configured: !!this.config, pages: [] };
    if (request.operation === 'release' || (request.operation === 'command' && request.command?.type === 'close-tab')) {
      // Closing the Web panel only detaches it. The user's actual tab survives.
      this.panels.delete(key);
      return state;
    }
    if (!this.config) return { ...state, error: '尚未连接 Chrome。请先配置 Chrome 所在电脑的官方 MCP 连接，并在个人 Chrome 中允许调试。' };
    const tools = await this.getConnection();
    if (this.closed) throw new Error('浏览器面板连接已关闭');
    const panel = this.panels.get(key) ?? {};
    this.panels.set(key, panel);
    const pages = parsePages(await tools.callTool('list_pages'));
    state.pages = pages.filter(page => !page.url.startsWith(this.origin + '/'));
    if (request.operation === 'select') {
      if (!Number.isSafeInteger(request.pageId) || !state.pages.some(page => page.id === request.pageId)) throw new Error('标签已关闭或不可用，请重新选择');
      panel.pageId = request.pageId;
      panel.frame = undefined;
    }
    if (panel.pageId == null && request.operation === 'state') {
      panel.pageId = state.pages.find(page => page.selected)?.id;
    }
    if (request.operation === 'command' && request.command?.type === 'navigate') {
      const url = webUrl(request.command.url);
      if (url.startsWith(this.origin + '/')) throw new Error('请在客户端直接打开工作台，避免递归预览');
      if (panel.pageId == null) {
        panel.pageId = state.pages.find(page => page.url === url)?.id;
        if (panel.pageId == null) {
          const created = parsePages(await tools.callTool('new_page', { url }));
          panel.pageId = created.find(page => page.selected && page.url === url)?.id ?? created.find(page => page.url === url)?.id;
          if (panel.pageId == null) throw new Error('官方 MCP 未返回新标签 ID；请核对真实 Chrome，操作不会重试');
        } else await tools.callTool('navigate_page', { pageId: panel.pageId, type: 'url', url });
      } else {
        if (!state.pages.some(page => page.id === panel.pageId)) throw new Error('原标签已关闭，请重新选择');
        await tools.callTool('navigate_page', { pageId: panel.pageId, type: 'url', url });
      }
    } else if (panel.pageId != null && !state.pages.some(page => page.id === panel.pageId)) {
      panel.frame = undefined;
      throw new Error('原标签已关闭，请重新选择；不会将输入转发给其他标签');
    }
    if (panel.pageId == null) {
      if (!['state', 'capture'].includes(request.operation)) throw new Error('请先选择已有 Chrome 标签');
      return state;
    }
    const pageId = panel.pageId;
    if (request.operation === 'element-context') {
      if (request.pageId !== pageId) throw new Error('标签已切换，未引用元素');
      return { ...state, pageId, frame: panel.frame,
        elementContext: await readSelectedElement(tools, state.pages.find(page => page.id === pageId)!) };
    } else if (request.operation === 'click') {
      if (!panel.frame || request.pageId !== pageId || typeof request.x !== 'number' || typeof request.y !== 'number' ||
          !Number.isFinite(request.x) || !Number.isFinite(request.y) || request.x < 0 || request.y < 0 || request.x > 1 || request.y > 1) throw new Error('画面已切换，请重新点击');
      await tools.callTool('click_at', { pageId, x: request.x * panel.frame.width, y: request.y * panel.frame.height });
    } else if (request.operation === 'text' || request.operation === 'key') {
      if (request.pageId !== pageId) throw new Error('标签已切换，未发送输入');
      if (request.operation === 'text') {
        if (typeof request.text !== 'string' || request.text.length > 16000) throw new Error('输入内容过长或无效');
        await tools.callTool('type_text', { pageId, text: request.text });
      } else {
        if (typeof request.key !== 'string' || request.key.length > 80) throw new Error('无效按键');
        await tools.callTool('press_key', { pageId, key: request.key });
      }
    } else if (request.operation === 'command' && request.command?.type !== 'navigate') {
      const type = ({ 'go-back': 'back', 'go-forward': 'forward', reload: 'reload' } as Record<string, string>)[request.command?.type ?? ''];
      if (!type) throw new Error(`Web Chrome 面板暂不支持：${request.command?.type ?? '未知命令'}`);
      await tools.callTool('navigate_page', { pageId, type });
    } else if (!['state', 'select', 'capture', 'command'].includes(request.operation)) throw new Error('不支持的浏览器操作');
    // This fixed read-only expression obtains CSS viewport dimensions for DPR-
    // independent coordinate mapping. No caller-supplied JavaScript or CDP.
    const metadata = resultText(await tools.callTool('evaluate_script', { pageId,
      function: '() => ({url: location.href, title: document.title, width: innerWidth, height: innerHeight, canGoBack: !!window.navigation?.canGoBack, canGoForward: !!window.navigation?.canGoForward})' }));
    const json = metadata.match(/\{[^\n]*\}/)?.[0];
    if (!json) throw new Error('官方 MCP 未返回页面尺寸');
    const info = JSON.parse(json) as Omit<ChromeFrame, 'pageId' | 'image' | 'capturedAt'>;
    if (!(info.width > 0 && info.height > 0)) throw new Error('页面尺寸不可用');
    const screenshot = await tools.callTool('take_screenshot', { pageId, format: 'jpeg', quality: 65 });
    const image = screenshot.content.find(item => item.type === 'image' && item.mimeType === 'image/jpeg');
    if (!image?.data) throw new Error('官方 MCP 未返回 JPEG 画面');
    panel.frame = { ...info, pageId, image: 'data:image/jpeg;base64,' + image.data, capturedAt: new Date().toISOString() };
    this.publishSnapshot(request, panel.frame);
    return { ...state, pageId, frame: panel.frame };
  }

  private publishSnapshot(target: BrowserTarget, frame: ChromeFrame) {
    this.publish({ type: 'browser-sidebar-state', conversationId: target.conversationId, browserTabId: target.browserTabId, snapshot: chromeSnapshot(frame) });
  }

  close(): Promise<void> {
    return this.closing ??= this.dispose();
  }
  private async dispose() {
    this.closed = true;
    await this.connection?.then(connection => connection.close(), () => {});
    await this.queue.catch(() => {});
    this.panels.clear();
  }
}
