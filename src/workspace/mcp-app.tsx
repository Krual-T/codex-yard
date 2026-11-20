import { Maximize2, Workflow } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ThreadItemSummary } from '../../lib/codex-protocol.ts';
import { record } from '../native/protocol.ts';
import { callMcpAppTool, readMcpAppResource, readMcpAppTools, type McpAppScope } from './host.ts';
import { McpCallOutput, McpRawOutput } from './mcp-call-output.tsx';
import { isAppReadTool, mcpAppResource } from './mcp-app-model.ts';
import { mcpAppSandboxPath } from '../native/mcp-app-sandbox.ts';

type Resource = NonNullable<ReturnType<typeof mcpAppResource>>;
type Load = { status: 'loading' } | { status: 'loaded'; value: Resource } | { status: 'failed' };

export type McpAppTab = {
  id: string;
  name: string;
  dock(target: HTMLDivElement | null): void;
  focusInline(): boolean;
};
export const McpAppTabs = createContext<{ open(app: McpAppTab): void; close(id: string): void } | null>(null);

export function McpAppTabContent({ app }: { app: McpAppTab }) {
  const attach = useCallback((target: HTMLDivElement | null) => {
    if (!target) return;
    app.dock(target);
    return () => app.dock(null);
  }, [app]);
  return <div className="yard-source-mcp-app-tab-content" ref={attach} />;
}

function McpAppFrame({ resource, scope, item, name, docked, canDock, onFullscreen, onReady, onError }: {
  resource: Resource; scope: McpAppScope; item: ThreadItemSummary; name: string; docked: boolean; canDock: boolean;
  onFullscreen(allowed: boolean): void; onReady(): void; onError(): void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [key] = useState(() => crypto.randomUUID());
  const [ready, setReady] = useState(false);
  const [height, setHeight] = useState(200);
  const displayMode = docked ? 'fullscreen' : 'inline';
  const connection = useRef({ provisioned: false, bound: false, initialized: false, ready: false, busy: false });
  const delivered = useRef<{ args?: unknown; result?: unknown }>({});
  const send = (body: Record<string, unknown>) => {
    if (connection.current.bound) frame.current?.contentWindow?.postMessage({ jsonrpc: '2.0', ...body }, '*');
  };
  const notifyTool = useEffectEvent(() => {
    if (!connection.current.ready) return;
    if (item.arguments !== delivered.current.args) {
      delivered.current.args = item.arguments;
      send({ method: 'ui/notifications/tool-input', params: { arguments: item.arguments } });
    }
    if (item.status === 'completed' && item.result != null && item.result !== delivered.current.result) {
      delivered.current.result = item.result;
      send({ method: 'ui/notifications/tool-result', params: item.result });
    }
  });
  const receive = useEffectEvent(async (event: MessageEvent) => {
    if (event.source !== frame.current?.contentWindow || event.origin !== 'null') return;
    const data = record(event.data), state = connection.current;
    if (data.type === 'yard-mcp-app-awaiting-document' && !state.provisioned) {
      state.provisioned = true;
      frame.current?.contentWindow?.postMessage({ type: 'yard-mcp-app-document', key, html: resource.html }, '*');
      return;
    }
    if (data.key === key) {
      if (data.type === 'yard-mcp-app-bind') state.bound = true;
      if (data.type === 'yard-mcp-app-close') {
        state.bound = state.ready = false;
        onError();
      }
      return;
    }
    if (!state.bound || data.jsonrpc !== '2.0') return;
    const params = record(data.params);
    const id = typeof data.id === 'string' || typeof data.id === 'number' ? data.id : undefined;
    if (data.method === 'ui/initialize' && id !== undefined && !state.initialized) {
      state.initialized = true;
      const theme = window.document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
      const modes = record(params.appCapabilities).availableDisplayModes;
      const fullscreen = canDock && (!Array.isArray(modes) || modes.includes('fullscreen'));
      onFullscreen(fullscreen);
      send({ id, result: { protocolVersion: '2026-01-26', hostInfo: { name: 'Codex Yard', version: '1.0.0' },
        hostCapabilities: { serverTools: {} }, hostContext: { theme, displayMode, availableDisplayModes: fullscreen ? ['inline', 'fullscreen'] : ['inline'] } } });
      return;
    }
    if (!state.initialized) return;
    if (data.method === 'ui/notifications/initialized' && !state.ready) {
      state.ready = true;
      setReady(true);
      onReady();
      notifyTool();
      return;
    }
    if (!state.ready) return;
    if (data.method === 'ui/notifications/size-changed' && typeof params.height === 'number' && Number.isFinite(params.height)) {
      setHeight(Math.max(48, Math.min(1024, Math.ceil(params.height))));
      return;
    }
    if (id === undefined) return;
    if (data.method === 'ui/request-display-mode') {
      // The host's tab controls own opening/closing the right panel.
      send({ id, result: { mode: displayMode } });
      return;
    }
    const reject = (code: number, message: string) => send({ id, error: { code, message } });
    if (data.method !== 'tools/call') { reject(-32601, 'Method unavailable'); return; }
    if (state.busy || item.status !== 'completed') { reject(-32000, 'App tool call is unavailable'); return; }
    if (typeof params.name !== 'string' || !params.name || (params.arguments != null &&
      (typeof params.arguments !== 'object' || Array.isArray(params.arguments)))) { reject(-32602, 'Invalid tool arguments'); return; }
    state.busy = true;
    try {
      const catalog = await readMcpAppTools(scope);
      if (!state.ready || !frame.current) return;
      if (!isAppReadTool(catalog, scope.server, params.name)) { reject(-32602, 'Tool is unavailable to this app'); return; }
      const result = await callMcpAppTool(scope, params.name, record(params.arguments));
      if (state.ready && frame.current) send({ id, result });
    } catch {
      if (state.ready && frame.current) reject(-32000, 'App tool request failed');
    } finally { state.busy = false; }
  });
  useLayoutEffect(() => {
    function onMessage(event: MessageEvent) { void receive(event); }
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      connection.current.bound = connection.current.ready = false;
    };
  }, []);
  useEffect(() => { notifyTool(); }, [item.arguments, item.result, item.status]);
  const notifyDisplayMode = useEffectEvent(() => {
    send({ method: 'ui/notifications/host-context-changed', params: { displayMode } });
  });
  useEffect(() => { if (ready) notifyDisplayMode(); }, [ready, displayMode]);
  const fail = useEffectEvent(() => onError());
  useEffect(() => {
    if (ready) return;
    const deadline = setTimeout(fail, 10_000);
    return () => clearTimeout(deadline);
  }, [ready]);
  const visible = ready && item.status === 'completed';
  return <div className="yard-source-mcp-app-surface" data-mcp-app-inline-surface={docked ? undefined : 'card'} style={docked ? undefined : { height: visible ? height : 200 }}>
    {!visible && <div className="yard-source-mcp-app-placeholder" aria-hidden="true" />}
    <iframe ref={frame} title={name} sandbox="allow-scripts" referrerPolicy="no-referrer" src={mcpAppSandboxPath}
      data-app-ready={visible} tabIndex={visible ? 0 : -1} aria-hidden={!visible} />
  </div>;
}

export function McpAppCard({ uri, item, threadId, hostId }: { uri: string; item: ThreadItemSummary; threadId: string; hostId: string }) {
  const server = String(item.server);
  const label = server.replace(/[_-]+/g, ' ');
  const name = label.charAt(0).toUpperCase() + label.slice(1);
  const tabs = useContext(McpAppTabs);
  const id = useId();
  const inline = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [surface] = useState(() => {
    const node = document.createElement('div');
    node.className = 'yard-source-mcp-app-host';
    return node;
  });
  const [docked, setDocked] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [fallbackTarget, setFallbackTarget] = useState<HTMLDivElement | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [frameReady, setFrameReady] = useState(false);
  const tab = useMemo<McpAppTab>(() => ({
    id: 'app-' + id,
    name,
    dock(target) {
      const parent = target ?? inline.current;
      if (!parent?.isConnected) return;
      const move = (parent as HTMLDivElement & { moveBefore?(node: Node, before: Node | null): void }).moveBefore;
      // Keep React's portal container fixed, and move that container without
      // disconnecting the iframe's browsing context.
      if (move && surface.isConnected) {
        if (surface.parentElement !== parent) move.call(parent, surface, null);
      } else {
        setFrameReady(false);
        setFallbackTarget(target);
      }
      setDocked(!!target);
    },
    focusInline() {
      const button = trigger.current;
      if (!button?.getClientRects().length) return false;
      button.focus();
      return document.activeElement === button;
    },
  }), [id, name, surface]);
  useLayoutEffect(() => {
    inline.current?.append(surface);
    return () => surface.remove();
  }, [surface]);
  useEffect(() => () => tabs?.close(tab.id), [tabs, tab.id]);
  useEffect(() => {
    let active = true;
    function failed() { if (active) setLoad({ status: 'failed' }); }
    void readMcpAppResource({ hostId, threadId, server }, uri).then(reply => {
      if (!active) return;
      const value = mcpAppResource(reply, uri);
      if (value) setLoad({ status: 'loaded', value });
      else failed();
    }, failed);
    return () => { active = false; };
  }, [attempt, hostId, threadId, server, uri]);
  const opening = load.status !== 'failed' && (item.status === 'inProgress' || !frameReady);
  return <section className="yard-source-mcp-app" aria-label={name + ' app'}>
    <div className="yard-source-mcp-app-card" data-mcp-app-card="true" data-docked={docked}
      data-bordered={load.status !== 'failed' && (load.status !== 'loaded' || load.value.bordered)}>
      <div className="yard-source-mcp-app-heading">
        <Workflow size={14} aria-hidden="true" />
        <span role={opening ? 'status' : undefined} dir="auto">{opening ? 'Opening ' + name : name}</span>
        {tabs && canFullscreen && load.status !== 'failed' && <button ref={trigger} type="button"
          aria-label="Open app in tab" title="Open app in tab" onClick={() => tabs.open(tab)}>
          <Maximize2 size={13} aria-hidden="true" />
        </button>}
      </div>
      <div ref={inline} hidden={docked} />
      {!docked && load.status !== 'failed' && item.result != null && <McpRawOutput item={item} />}
    </div>
    {createPortal(load.status === 'failed' ? <>
      <div className="yard-source-mcp-app-failed" role="alert">
        Couldn’t open {name}
        <button type="button" onClick={() => { setFrameReady(false); setLoad({ status: 'loading' }); setAttempt(value => value + 1); }}>Retry</button>
      </div>
      <McpCallOutput item={item} />
    </> : load.status === 'loaded' ?
      <McpAppFrame resource={load.value} name={name} scope={{ hostId, threadId, server }} item={item}
        docked={docked} canDock={!!tabs} onFullscreen={setCanFullscreen}
        onReady={() => setFrameReady(true)}
        onError={() => setLoad({ status: 'failed' })} /> :
      <div className="yard-source-mcp-app-placeholder" aria-hidden="true" />, fallbackTarget ?? surface)}
  </section>;
}
