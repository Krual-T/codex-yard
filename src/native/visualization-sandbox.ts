// Browser transport for the pinned renderer's mcp-sandbox-rpc MessagePort API.
// The official HTML kit supplies styling, ready/height/error notifications,
// annotations and downloads. This frame owns no files, credentials or app RPC.
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
