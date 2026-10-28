import { installTweak } from '../renderer/visualizations/tweak-runtime.ts';
import { installVisualizationCarousels } from '../renderer/visualizations/carousel-runtime.ts';
import { installVisualizationInteractions } from '../renderer/visualizations/interaction-runtime.ts';
import type { AnnotationChange } from '../renderer/visualizations/annotations.ts';

// Browser transport for the pinned renderer's mcp-sandbox-rpc MessagePort API.
// The official HTML kit supplies styling, ready/height/error notifications,
// annotations and downloads. This frame owns no files, credentials or app RPC.
function startLegacyVisualization() {
type Value = Record<string, unknown>;
type Handler = (...args: unknown[]) => unknown;
const ports: MessagePort[] = [];
let host: Record<string, MessagePort> = {};
let globals: Value = {};
let widgetId: string | undefined;
let disposed = false;
const sandboxWindow = window as Window & { openai?: Value };

function record(value: unknown): Value {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as Value : {};
}
function errorValue(error: unknown) {
  return { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error) };
}
function serve(handler: Handler, existing?: MessagePort): MessagePort {
  const channel = existing ? null : new MessageChannel();
  const port = existing ?? channel!.port1;
  ports.push(port);
  port.onmessage = async event => {
    const reply = event.ports[0];
    if (!reply || event.data?.[0] !== 'CALL') return;
    try { reply.postMessage(['RESOLVE', await handler(...event.data.slice(1))]); }
    catch (error) { reply.postMessage(['REJECT', errorValue(error)]); }
    finally { reply.close(); }
  };
  port.start();
  return channel?.port2 ?? port;
}
function invoke(method: string, ...args: unknown[]): Promise<unknown> {
  const target = host[method];
  if (!target || disposed) return Promise.reject(new Error('可视化连接已关闭'));
  const { port1, port2 } = new MessageChannel();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { port1.close(); reject(new Error('可视化操作超时')); }, 120_000);
    port1.onmessage = event => {
      clearTimeout(timeout); port1.close();
      if (event.data?.[0] === 'RESOLVE') resolve(event.data[1]);
      else reject(new Error(String(record(event.data?.[1]).message ?? '可视化操作失败')));
    };
    port1.start();
    target.postMessage(['CALL', ...args], [port2]);
  });
}
function updateGlobals(value: unknown) {
  Object.assign(globals, record(value));
  Object.assign(sandboxWindow.openai ?? {}, globals);
  window.dispatchEvent(new CustomEvent('openai:set_globals', { detail: { globals: { ...globals } } }));
}
function setTheme(value: unknown) {
  const theme = record(value).theme;
  if (theme === 'dark' || theme === 'light') {
    document.documentElement.style.colorScheme = theme;
    updateGlobals({ theme, visualizationTheme: theme });
  }
}
function render(value: unknown) {
  const params = record(value);
  if (typeof params.html !== 'string' || typeof params.widgetId !== 'string') throw new Error('无效的可视化文档');
  if (widgetId || disposed) throw new Error('可视化文档已经加载');
  widgetId = params.widgetId;
  globals = { theme: params.theme, displayMode: params.displayMode, maxHeight: params.maxHeight,
    maxWidth: params.maxWidth, safeArea: params.safeArea, widgetState: params.widgetState,
    toolInput: params.toolInput, toolOutput: params.toolOutput, toolResponseMetadata: params.toolResponseMetadata };
  sandboxWindow.openai = {
    ...globals,
    callTool: (name: string, args: unknown) => invoke('callTool', name, args),
    sendFollowUpMessage: (request: unknown) => invoke('sendFollowUpMessage', request),
    requestDisplayMode: (request: unknown) => invoke('requestDisplayMode', request),
    openExternal: (request: unknown) => invoke('openExternal', request),
    setWidgetState: async (state: unknown) => {
      updateGlobals({ widgetState: state });
      const result = record(await invoke('updateWidgetState', widgetId, state));
      if (result.ok === false) throw new Error(String(result.code ?? '可视化状态保存失败'));
    },
  };
  // document.open removes document listeners, but the MessagePort handlers and
  // this closure survive. Install error listeners before executing authored JS.
  document.open();
  window.addEventListener('error', event => { void invoke('notifyEnvironmentError', errorValue(event.error ?? event.message)).catch(() => {}); });
  window.addEventListener('unhandledrejection', event => { void invoke('notifyEnvironmentError', errorValue(event.reason)).catch(() => {}); });
  document.write(params.html);
  document.close();
  setTheme({ theme: params.theme });
}

const methods: Record<string, Handler> = {
  navigate: () => { throw new Error('可视化不支持页面导航'); },
  notifyMcpAppsHostContext: value => updateGlobals({ hostContext: record(value).hostContext }),
  notifyMcpAppsToolCancelled: () => {},
  notifyMcpAppsToolInput: value => updateGlobals({ toolInput: record(value).input }),
  notifyMcpAppsToolResult: value => updateGlobals({ toolOutput: record(value).result }),
  requestMcpAppsResourceTeardown: () => { disposed = true; },
  setAdditionalGlobals: value => updateGlobals(record(value).additionalGlobals),
  setSafeArea: value => updateGlobals({ safeArea: record(value).safeArea }),
  setTheme,
  setWidgetData: () => { throw new Error('可视化不支持更换工具数据'); },
  setWidgetView: () => { throw new Error('可视化不支持更换页面'); },
};
const api = Object.fromEntries(Object.entries(methods).map(([name, handler]) => [name, serve(handler)]));
const run = new MessageChannel();
ports.push(run.port1);
run.port1.onmessage = event => {
  if (event.data?.[0] !== 'GENERATOR_GENERATE') return;
  const iterator = event.data[1] as Record<string, MessagePort>;
  let step = 0, closed = false;
  const stop = () => { closed = true; return { done: true, value: undefined }; };
  serve(() => {
    if (closed) return { done: true, value: undefined };
    if (step++ === 0) {
      render(event.data[2]);
      return { done: false, value: { type: 'environment_status', status: 2 } };
    }
    if (step === 2) return { done: false, value: { type: 'run_complete', wasFatalError: false } };
    return stop();
  }, iterator.next);
  serve(stop, iterator.return);
  serve(stop, iterator.throw);
  serve(stop, iterator.asyncDispose);
};
run.port1.start();
api.runWidgetCode = run.port2;
const reply = new MessageChannel();
ports.push(reply.port1);
reply.port1.onmessage = event => { host = event.data as Record<string, MessagePort>; reply.port1.close(); };
reply.port1.start();
window.parent.postMessage({ type: 'init', ports: api, replyPort: reply.port2 }, location.origin, [...Object.values(api), reply.port2]);
}

function startOwnedVisualization(initId: string) {
  type Value = Record<string, unknown>;
  const object = (value: unknown): Value => value != null && typeof value === 'object' && !Array.isArray(value) ? value as Value : {};
  const sandboxWindow = window as Window & { openai?: Value };
  const channel = new MessageChannel();
  const port = channel.port1;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number }>();
  let sequence = 0;
  let disposed = false;
  let rendered = false;
  let annotating = false;
  let globals: Value = {};
  let themeSheet: CSSStyleSheet | null = null;
  let tweak: ReturnType<typeof installTweak> | null = null;
  let disposeCarousels: (() => void) | undefined;
  let interactions: ReturnType<typeof installVisualizationInteractions> | undefined;
  let variables: Value = {};
  let locale: string | undefined;

  function send(value: Value) {
    if (!disposed) port.postMessage(value);
  }
  function request(method: string, payload: unknown): Promise<unknown> {
    if (disposed) return Promise.reject(new Error('Visualization connection is closed'));
    if (pending.size >= 32) return Promise.reject(new Error('Too many visualization requests'));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pending.delete(id);
        reject(new Error('Visualization request timed out'));
      }, 30_000);
      pending.set(id, { resolve, reject, timer });
      try { send({ type: 'request', id, method, payload }); }
      catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  function updateGlobals(values: Value) {
    Object.assign(globals, values);
    if (sandboxWindow.openai) Object.assign(sandboxWindow.openai, values);
    window.dispatchEvent(new CustomEvent('openai:set_globals', { detail: { globals: { ...globals } } }));
  }
  function setTheme(value: unknown, nextVariables?: unknown, nextLocale?: unknown) {
    if (value !== 'dark' && value !== 'light') return;
    if (nextVariables !== undefined) variables = object(nextVariables);
    if (typeof nextLocale === 'string' && nextLocale.length <= 100) locale = nextLocale;
    if (!themeSheet) {
      themeSheet = new CSSStyleSheet();
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, themeSheet];
    }
    const dark = value === 'dark';
    themeSheet.replaceSync(`:where(:root) {
      color-scheme: ${value};
      --background: ${dark ? '#20272a' : '#ffffff'};
      --foreground: ${dark ? '#f2f4f4' : '#1c252a'};
      --card: ${dark ? '#30393d' : '#f1f4f3'};
      --card-foreground: var(--foreground);
      --popover: var(--card); --popover-foreground: var(--foreground);
      --primary: ${dark ? '#89c9ec' : '#176b91'};
      --primary-foreground: ${dark ? '#14272d' : '#ffffff'};
      --secondary: var(--card); --secondary-foreground: var(--foreground);
      --muted: ${dark ? '#465155' : '#e3e9e7'};
      --muted-foreground: ${dark ? '#b5c2c2' : '#536568'};
      --accent: ${dark ? '#294643' : '#d6eee4'}; --accent-foreground: var(--foreground);
      --destructive: ${dark ? '#ffae9c' : '#a83625'};
      --border: ${dark ? '#647276' : '#c3cecb'}; --input: var(--border); --ring: var(--primary);
      --font-size-base: 16px; --radius: 6px;
      --blue: #418bb2; --orange: #c76840; --green: #388265; --red: #c14b41;
      --purple: #8170a8; --yellow: #b88c19;
      --viz-series-1: var(--primary); --viz-series-2: #c76840; --viz-series-3: #388265;
      --viz-series-4: #b45d83; --viz-series-5: #8170a8; --viz-series-6: #478b87;
      --viz-bg: transparent; --viz-panel: var(--card); --viz-border: var(--border);
      --viz-text: var(--foreground); --viz-muted: var(--muted-foreground); --viz-accent: var(--primary);
      --viz-accent-text: var(--primary-foreground); --viz-accent-bg: var(--accent);
      --viz-font-size: var(--font-size-base); --viz-warning: var(--destructive);
    }
    :where(body) {
      --color-background-primary: var(--background); --color-text-primary: var(--foreground);
      --color-border-secondary: var(--border);
    }`);
    const rule = themeSheet.cssRules[0] as CSSStyleRule;
    for (const [name, entry] of Object.entries(variables).slice(0, 128)) {
      if (/^--[a-z0-9_-]{1,100}$/i.test(name) && typeof entry === 'string' && entry.length <= 4096) rule.style.setProperty(name, entry);
    }
    if (document.documentElement) {
      document.documentElement.style.colorScheme = value;
      if (locale) document.documentElement.lang = locale;
    }
    updateGlobals({ theme: value, visualizationTheme: value, visualizationStyleVariables: variables, locale });
  }
  function dispose() {
    if (disposed) return;
    tweak?.cleanup();
    interactions?.dispose();
    disposeCarousels?.();
    disposed = true;
    port.close();
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error('Visualization connection is closed'));
    }
    pending.clear();
  }
  function measure() {
    const body = document.body;
    if (!body) return;
    const contentHeight = Math.max(body.scrollHeight, body.getBoundingClientRect().height);
    send({ type: 'height', height: Math.ceil(contentHeight) });
  }
  function render(message: Value) {
    if (rendered || typeof message.html !== 'string') throw new Error('Invalid visualization document');
    rendered = true;
    globals = { theme: message.theme, visualizationTheme: message.theme, displayMode: 'inline',
      widgetState: message.widgetState, maxHeight: 10_000, maxWidth: null,
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 } };
    tweak = installTweak({ request: value => request('annotations', value) });
    sandboxWindow.openai = {
      ...globals,
      callTool: (name: unknown, args: unknown) => {
        if (name === '__codex_inline_visualization_ready__') { send({ type: 'ready' }); return Promise.resolve(); }
        if (name === '__codex_inline_visualization_height__') {
          send({ type: 'height', height: object(args).height }); return Promise.resolve();
        }
        if (name === '__codex_inline_visualization_error__') {
          send({ type: 'error', message: String(object(args).message ?? 'Visualization error').slice(0, 1000) });
          return Promise.resolve();
        }
        if (name === '__codex_inline_visualization_download__') return request('download', args);
        if (name === '__codex_visualization_annotations__') return request('annotations', args);
        return Promise.reject(new Error('Visualization tool is not available'));
      },
      sendFollowUpMessage: (value: unknown) => request('follow-up', value),
      requestDisplayMode: (value: unknown) => request('display-mode', value),
      openExternal: (value: unknown) => request('open-external', value),
      setWidgetState: async (value: unknown) => {
        const saved = await request('widget-state', value);
        updateGlobals({ widgetState: saved ?? value });
      },
    };
    setTheme(message.theme, message.themeVariables, message.locale);
    document.open();
    window.addEventListener('pagehide', () => { send({ type: 'leaving' }); dispose(); }, { once: true });
    window.addEventListener('error', event => send({ type: 'error', message: String(event.message || 'Visualization error').slice(0, 1000) }));
    window.addEventListener('unhandledrejection', event => send({ type: 'error', message: String(event.reason?.message ?? event.reason ?? 'Visualization error').slice(0, 1000) }));
    window.addEventListener('click', event => {
      if (!event.isTrusted) return;
      const target = event.target;
      if (annotating && target instanceof Element && !target.closest('.viz-carousel-controls')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        annotating = false;
        const selection = window.getSelection()?.toString().trim();
        const excerpt = (selection || target.getAttribute('aria-label') || target.textContent || target.tagName).trim().slice(0, 500);
        send({ type: 'annotation-target', excerpt, ...tweak?.select(event.composedPath()) });
        return;
      }
      const anchor = event.composedPath().find(node => node instanceof HTMLAnchorElement && node.hasAttribute('download'));
      if (!(anchor instanceof HTMLAnchorElement)) return;
      let url: URL;
      try { url = new URL(anchor.href); } catch { return; }
      if (url.protocol !== 'blob:' && url.protocol !== 'data:') return;
      event.preventDefault();
      void fetch(url.href).then(response => response.blob()).then(blob => request('download', { blob, name: anchor.download })).catch(() => {});
    }, true);
    document.write(message.html);
    document.close();
    disposeCarousels = installVisualizationCarousels();
    interactions = installVisualizationInteractions({
      send: event => send({ ...event }),
      isFullscreen: () => globals.displayMode === 'fullscreen',
      isAnnotating: () => annotating,
      cancelAnnotation: () => { annotating = false; send({ type: 'annotation-escape' }); },
    });
    tweak.observe();
    setTheme(message.theme, message.themeVariables, message.locale);
    const observer = new ResizeObserver(measure);
    if (document.body) observer.observe(document.body);
    new MutationObserver(measure).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    measure();
    send({ type: 'ready' });
  }
  port.onmessage = event => {
    const message = object(event.data);
    if (message.type === 'response' && typeof message.id === 'number') {
      const item = pending.get(message.id);
      if (!item) return;
      clearTimeout(item.timer);
      pending.delete(message.id);
      if (message.ok === true) item.resolve(message.value);
      else item.reject(new Error(typeof message.error === 'string' ? message.error : 'Visualization request failed'));
    } else if (message.type === 'render') {
      try { render(message); } catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
    } else if (message.type === 'theme') setTheme(message.theme, message.themeVariables, message.locale);
    else if (message.type === 'display-mode') updateGlobals({ displayMode: message.mode });
    else if (message.type === 'pointer-leave') interactions?.resetHover();
    else if (message.type === 'widget-state') updateGlobals({ widgetState: message.state });
    else if (message.type === 'annotate') {
      annotating = message.enabled === true;
      const changes = Array.isArray(message.changes) ? message.changes as AnnotationChange[] : [];
      tweak?.update(changes);
      updateGlobals({ visualizationAnnotation: { active: annotating, selection: message.selection ?? null, changes } });
    }
    else if (message.type === 'dispose') dispose();
  };
  port.start();
  window.addEventListener('pagehide', dispose, { once: true });
  window.parent.postMessage({ type: 'yard-visualization:init', initId }, location.origin, [channel.port2]);
}

const parameters = new URLSearchParams(location.search);
const ownedInitId = parameters.get('yard_viz_init');
if (ownedInitId && /^[a-f0-9]{32}$/i.test(ownedInitId)) startOwnedVisualization(ownedInitId);
else startLegacyVisualization();
