import type { HostMessage } from './protocol.ts';
import { record } from './protocol.ts';

export const isMiniWindow = typeof location !== 'undefined' && location.pathname === '/avatar-overlay';
export interface MiniRect { left: number; top: number; width: number; height: number }
interface SettingValue { effective: unknown; configured: unknown }
interface SettingListener {
  (value: SettingValue): Promise<void> & { [Symbol.dispose]?: () => void };
  dup(): SettingListener;
  onRpcBroken(callback: () => void): void;
  [Symbol.dispose](): void;
}

// Screen coordinates and click-through regions are the only native window
// concepts replaced here. The original page decides all content and actions.
export function createMiniHost(publish: (message: HostMessage) => void) {
  let measurement: Record<string, unknown> = {};
  let revision = 0;
  let last = '';
  const settingsListeners = new Map<string, Set<SettingListener>>();
  const parent = (message: HostMessage) => {
    if (window.parent !== window) window.parent.postMessage(message, location.origin);
  };
  function layout() {
    const width = innerWidth, height = innerHeight;
    const size = record(measurement.mascot), tray = record(measurement.tray);
    const mascotWidth = finite(size.width, 112), mascotHeight = finite(size.height, 121);
    const mascot = { left: Math.max(16, width - mascotWidth - 40), top: Math.max(16, height - mascotHeight - 90), width: mascotWidth, height: mascotHeight };
    const visibleBounds = { left: 0, top: 0, width, height };
    return { mascot, placement: 'top-end',
      tray: measurement.tray ? { left: 16, top: Math.max(16, mascot.top - finite(tray.height, 120) - 12), width: Math.max(0, Math.min(width - 32, finite(tray.width, 330))), height: Math.max(0, Math.min(mascot.top - 28, finite(tray.height, 120))) } : null,
      visibleBounds, viewport: { width, height },
      quickChat: measurement.quickChat ? { ...record(measurement.quickChat), workArea: visibleBounds, stashedEdge: null } : undefined };
  }
  function update() {
    const next = { type: 'avatar-overlay-layout-changed', isVisible: true, isGlobalRealtimeVoicePresentation: false,
      arePresentationAccessoriesVisible: true, layout: layout(), quickChatFocusRequestId: measurement.quickChatFocusRequestId };
    const signature = JSON.stringify(next);
    if (signature === last) return;
    last = signature;
    publish({ ...next, layoutRevision: ++revision });
  }
  if (isMiniWindow) {
    const style = document.createElement('style');
    style.textContent = 'html, body, #root { background: transparent !important; }';
    document.head.append(style);
    window.addEventListener('resize', update);
    // The React menu fallback is a portal below the draggable mascot in the
    // React tree. Keep its press from starting a mascot drag/pointer capture;
    // the official menu still receives the click that selects its action.
    const menuPointer = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-radix-menu-content]')) event.stopPropagation();
    };
    document.addEventListener('pointerdown', menuPointer, true);
    const failure = () => parent({ type: 'workbench-mini-error', error: 'Mini 页面运行失败，请重试。' });
    window.addEventListener('error', failure);
    window.addEventListener('unhandledrejection', failure);
    window.addEventListener('pagehide', event => {
      if (event.persisted) return;
      window.removeEventListener('resize', update);
      document.removeEventListener('pointerdown', menuPointer, true);
      window.removeEventListener('error', failure);
      window.removeEventListener('unhandledrejection', failure);
      style.remove();
    });
  }
  return {
    receive(message: HostMessage) {
      if (!isMiniWindow || message.type !== 'workbench-mini-setting') return;
      for (const listener of settingsListeners.get(String(message.key)) ?? []) {
        const result = listener({ effective: message.value, configured: message.value });
        void Promise.resolve(result).catch(() => {}).finally(() => result[Symbol.dispose]?.());
      }
    },
    handle(message: HostMessage) {
      if (!isMiniWindow) return false;
      switch (message.type) {
        case 'avatar-overlay-element-size-changed': measurement = message; update(); return true;
        case 'avatar-overlay-pointer-interaction-changed': return true;
        case 'avatar-overlay-keyboard-interaction-changed':
          if (message.isInteractive) publish({ type: 'avatar-overlay-keyboard-interaction-ready' });
          else if (message.restorePreviousFocus) parent({ type: 'workbench-mini-focus-main' });
          return true;
        case 'open-in-main-window': parent({ type: 'workbench-mini-focus-main', path: message.path }); return true;
        case 'open-current-main-window': parent({ type: 'workbench-mini-focus-main' }); return true;
        case 'show-settings': parent({ type: 'workbench-mini-focus-main', path: '/settings/pets' }); return true;
        case 'avatar-overlay-drag-start':
        case 'avatar-overlay-drag-move':
        case 'avatar-overlay-drag-end':
          parent({ type: 'workbench-mini-drag', phase: message.type, x: message.pointerScreenX, y: message.pointerScreenY });
          return true;
        case 'avatar-overlay-drag-release': return true;
        default: return false;
      }
    },
    service(Base: new () => object) {
      return new class extends Base {
        setPointerRegions(regions: MiniRect[]) {
          const paths = regions.filter(validRect).map(({ left, top, width, height }) =>
            `M${Math.max(0, left - 4)} ${Math.max(0, top - 4)}h${width + 8}v${height + 8}h-${width + 8}Z`);
          parent({ type: 'workbench-mini-regions', clip: paths.length ? `path('${paths.join(' ')}')` : 'path("M0 0Z")' });
          if (paths.length) parent({ type: 'workbench-mini-ready' });
        }
        completeQuickChatFocus(_requestId: string, layoutRevision: number) { return layoutRevision === revision; }
        setQuickChatStashed() { update(); }
        setQuickChatComposerFocused() { /* Browser focus is already owned by the composer. */ }
      }();
    },
    settings(Base: new () => object, request: (endpoint: string, body: unknown) => Promise<unknown>) {
      return new class extends Base {
        readAll() { return request('get-settings', {}); }
        async read(key: string) {
          const result = record(await request('get-setting', { key }));
          return { effective: result.value, configured: result.value };
        }
        write(key: string, value: unknown) { return request('set-setting', { key, value }); }
        subscribe(key: string, listener: SettingListener) {
          const copy = listener.dup();
          const subscribers = settingsListeners.get(key) ?? new Set<SettingListener>();
          settingsListeners.set(key, subscribers);
          subscribers.add(copy);
          const subscription = new class extends Base {
            [Symbol.dispose]() { if (subscribers.delete(copy)) copy[Symbol.dispose](); }
          }();
          copy.onRpcBroken(() => subscription[Symbol.dispose]());
          return subscription;
        }
        [Symbol.dispose]() {
          for (const subscribers of settingsListeners.values()) for (const listener of subscribers) listener[Symbol.dispose]();
          settingsListeners.clear();
        }
      }();
    },
  };
}

function finite(value: unknown, fallback: number) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback; }
function validRect(value: MiniRect) { return [value.left, value.top, value.width, value.height].every(Number.isFinite) && value.width > 0 && value.height > 0; }
