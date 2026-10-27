import type { Root } from 'react-dom/client';
import type { HostMessage } from './protocol.ts';
import { record } from './protocol.ts';
import type { PetPosition, WebPetState } from './pet-overlay.ts';
import { rendererAssets } from './renderer-assets.ts';

type ReactRuntime = typeof import('react');
const emptyClip = 'path("M0 0Z")';

// The iframe runs the shipped /avatar-overlay route, including its providers,
// conversation managers, activity stack and actions. This shell owns only the
// browser window's lifecycle. No pet or conversation state is reconstructed here.
export function mountBrowserPet(react: ReactRuntime, dom: { createRoot(element: Element): Root },
  send: (message: HostMessage) => Promise<void>) {
  const h = react.createElement;
  const container = document.createElement('div');
  container.id = 'workbench-mini-root';
  document.body.append(container);
  const publish = (message: HostMessage) => window.postMessage(message, location.origin);
  function MiniWindow() {
    const [state, setState] = react.useState<WebPetState | null>(null);
    const [error, setError] = react.useState('');
    const [attempt, setAttempt] = react.useState(0);
    const [position, setPosition] = react.useState<PetPosition | null>(null);
    const [viewport, setViewport] = react.useState({ width: innerWidth, height: innerHeight });
    const frame = react.useRef<HTMLIFrameElement>(null);
    const drag = react.useRef<{ x: number; y: number; left: number; top: number; position: PetPosition | null } | null>(null);
    const focus = react.useRef<HTMLElement | null>(null);
    const [clip, setClip] = react.useState(emptyClip);
    const active = react.useRef(false);
    active.current = state?.isOpen === true;
    const ready = react.useRef(false);
    const connectionLost = react.useRef(false);
    react.useEffect(() => {
      const listener = (event: MessageEvent<HostMessage>) => {
        if (event.origin !== location.origin) return;
        const message = record(event.data);
        if (frame.current && event.source === frame.current.contentWindow) {
          if (message.type === 'workbench-mini-drag' && typeof message.x === 'number' && typeof message.y === 'number' && Number.isFinite(message.x) && Number.isFinite(message.y)) {
            if (message.phase === 'avatar-overlay-drag-start') {
              const rect = frame.current.getBoundingClientRect();
              drag.current = { x: message.x, y: message.y, left: rect.left, top: rect.top, position: null };
            } else if (drag.current) {
              const start = drag.current, width = Math.max(0, innerWidth - frame.current.clientWidth), height = Math.max(0, innerHeight - frame.current.clientHeight);
              if (Math.hypot(message.x - start.x, message.y - start.y) > 3) {
                start.position = { x: width ? Math.max(0, Math.min(1, (start.left + message.x - start.x) / width)) : 0,
                  y: height ? Math.max(0, Math.min(1, (start.top + message.y - start.y) / height)) : 0 };
                setPosition(start.position);
              }
              if (message.phase === 'avatar-overlay-drag-end') {
                if (start.position) void send({ type: 'workbench-pet-position', position: start.position });
                drag.current = null;
              }
            }
          }
          if (message.type === 'workbench-mini-regions' && typeof message.clip === 'string') setClip(message.clip);
          if (message.type === 'workbench-mini-error') { setClip(emptyClip); setError(String(message.error)); }
          // A late measurement must not revive a frame that just failed.
          if (message.type === 'workbench-mini-ready') ready.current = true;
          if (message.type === 'workbench-mini-focus-main') {
            focus.current?.focus();
            if (typeof message.path === 'string' && message.path.startsWith('/') && !message.path.startsWith('//')) {
              publish({ type: 'navigate-to-route', path: message.path });
            }
          }
          return;
        }
        if (event.source !== window) return;
        if (message.type === 'workbench-pet-state') {
          setState(message.state as WebPetState);
          setPosition((message.state as WebPetState).position);
          if (!(message.state as WebPetState).isOpen) setError('');
        }
        if (message.type === 'workbench-pet-error') setError(String(message.error));
        if (message.type === 'codex-app-server-connection-changed' && message.hostId === 'local') {
          if (message.state === 'connected') {
            if (connectionLost.current) {
              connectionLost.current = false;
              setClip(emptyClip); setError(''); setAttempt(value => value + 1);
            }
            void send({ type: 'avatar-overlay-open-state-request' });
          } else if (active.current) {
            connectionLost.current = true;
            setClip(emptyClip); setError('Mini 与宿主的连接已断开。');
          }
        }
      };
      window.addEventListener('message', listener);
      const resize = () => setViewport({ width: innerWidth, height: innerHeight });
      window.addEventListener('resize', resize);
      void send({ type: 'avatar-overlay-open-state-request' }).catch(() => setError('无法读取 Mini 状态。'));
      return () => { window.removeEventListener('message', listener); window.removeEventListener('resize', resize); };
    }, []);
    react.useEffect(() => {
      if (!state?.isOpen) { setClip(emptyClip); return; }
      ready.current = false;
      const timeout = setTimeout(() => { if (!ready.current) setError(previous => previous || 'Mini 加载超时，请重试。'); }, 60000);
      focus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const outside = (event: PointerEvent) => {
        if (state.visibility === 'on-demand' && event.target instanceof Node && !container.contains(event.target)) {
          void send({ type: 'avatar-overlay-hide' });
        }
      };
      document.addEventListener('pointerdown', outside);
      return () => { clearTimeout(timeout); document.removeEventListener('pointerdown', outside); focus.current?.focus(); };
    }, [state?.isOpen, state?.visibility, attempt]);
    if (!state?.isOpen && !error) return null;
    const width = Math.min(420, viewport.width), height = Math.min(620, viewport.height);
    return h('aside', { 'data-workbench-mini': '', 'aria-label': 'Codex Mini',
      style: { position: 'fixed', left: (position?.x ?? 1) * (viewport.width - width), top: (position?.y ?? 1) * (viewport.height - height), width, height, zIndex: 45, pointerEvents: 'none' } },
    state?.isOpen && !error ? h('iframe', { key: attempt, ref: frame, title: '官方 Codex Mini', src: rendererAssets.miniRoute,
      style: { width: '100%', height: '100%', border: 0, background: 'transparent', pointerEvents: clip === emptyClip ? 'none' : 'auto', clipPath: clip },
      onError: () => setError('Mini 页面加载失败。') }) : null,
    error ? h('div', { role: 'alert', style: { position: 'absolute', right: 16, bottom: 16, padding: 12, borderRadius: 12,
      background: 'var(--color-bg-primary, white)', pointerEvents: 'auto' } }, error, ' ',
    h('button', { onClick: () => { setError(''); setClip(emptyClip); setAttempt(value => value + 1); } }, '重试'), ' ',
    h('button', { onClick: () => { setError(''); void send({ type: 'avatar-overlay-close' }); } }, '关闭 Mini')) : null);
  }
  const root = dom.createRoot(container);
  root.render(h(MiniWindow));
  window.addEventListener('pagehide', event => { if (!event.persisted) { root.unmount(); container.remove(); } });
}
