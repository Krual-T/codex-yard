import { Component, useEffect, useRef, useState } from 'react';
import type { ComponentType, CSSProperties, ReactNode } from 'react';
import type { ServerRequestRef } from '../workbench-contract.ts';

export interface ApprovalBrowserAuthBinding {
  ref: ServerRequestRef;
  hostId: string;
  threadId: string;
  challengeId: string;
  accountId: string;
  userId: string;
}

export interface ApprovalBrowserAuthScope extends ApprovalBrowserAuthBinding {
  serverName: string;
  origin: string;
  targetTabId?: string;
}

export type ApprovalBrowserAuthQrUpdate =
  | { type: 'snapshot'; payload: string; timestamp_ms: number; disappeared?: boolean }
  | { type: 'no-content' }
  | { type: 'expired' }
  | { type: 'error'; retrying: boolean };

export type ApprovalBrowserAuthQrSubscribe = (
  request: ApprovalBrowserAuthScope & { signal: AbortSignal },
  publish: (update: ApprovalBrowserAuthQrUpdate) => void,
) => void | (() => void);

/** Compatible with qrcode.react's QRCodeSVG. The host must supply an actual encoder. */
export type ApprovalQrCodeRenderer = ComponentType<{ value: string; size?: number; marginSize?: number; title?: string; style?: CSSProperties }>;

export interface ApprovalBrowserAuthAcknowledgement {
  scope: ApprovalBrowserAuthScope;
  operationId: string;
  fillStatus: 'submitted' | 'not_submitted';
  status: 'ready' | 'sending' | 'sent' | 'unknown';
}

export interface ApprovalBrowserAuthAcknowledgeRequest {
  scope: ApprovalBrowserAuthScope;
  operationId: string;
  fillStatus: 'submitted' | 'not_submitted';
}

export function sameBrowserAuthScope(a: ApprovalBrowserAuthScope, b: ApprovalBrowserAuthScope): boolean {
  return a.ref.hostId === b.ref.hostId && a.ref.generation === b.ref.generation && a.ref.id === b.ref.id
    && a.hostId === b.hostId && a.threadId === b.threadId && a.serverName === b.serverName
    && a.challengeId === b.challengeId && a.accountId === b.accountId && a.userId === b.userId
    && a.origin === b.origin && a.targetTabId === b.targetTabId;
}

export function browserAuthScopeKey(scope: ApprovalBrowserAuthScope): string {
  return JSON.stringify([scope.ref.hostId, scope.ref.generation, scope.ref.id, scope.hostId, scope.threadId,
    scope.serverName, scope.challengeId, scope.accountId, scope.userId, scope.origin, scope.targetTabId]);
}

type QrState = { status: 'waiting' | 'visible' | 'disappeared' | 'expired' | 'error' | 'render-error'; payload?: string; hadPayload: boolean };

class QrCodeBoundary extends Component<{ value: string; QrCode: ApprovalQrCodeRenderer; onError(): void; children?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  componentDidUpdate(previous: Readonly<{ value: string }>) {
    if (this.state.failed && previous.value !== this.props.value) this.setState({ failed: false });
  }
  render() {
    const { QrCode, value } = this.props;
    return this.state.failed ? <p role="alert">The sign-in code could not be displayed.</p>
      : <QrCode value={value} size={192} marginSize={4} title="Sign-in QR code" style={{ maxWidth: '100%', height: 'auto' }} />;
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

export function ApprovalBrowserAuthQr({ scope, enabled, initialPayload, requiresApp, subscribe, QrCode, canComplete,
  isCurrent, onComplete }: {
  scope: ApprovalBrowserAuthScope;
  enabled: boolean;
  initialPayload?: string;
  requiresApp?: boolean;
  subscribe: ApprovalBrowserAuthQrSubscribe;
  QrCode: ApprovalQrCodeRenderer;
  canComplete: boolean;
  isCurrent(): boolean;
  onComplete(automatic: boolean): void;
}) {
  const scopeKey = browserAuthScopeKey(scope);
  const current = useRef({ isCurrent, onComplete });
  current.current = { isCurrent, onComplete };
  const [state, setState] = useState<QrState>(() => ({ status: 'waiting', payload: initialPayload, hadPayload: Boolean(initialPayload) }));
  const latest = useRef<{ timestamp: number; payload?: string; failedPayload?: string; hadPayload: boolean; rotated: boolean; terminal: boolean }>(
    { timestamp: 0, payload: initialPayload, hadPayload: Boolean(initialPayload), rotated: false, terminal: false });
  const suspended = useRef(!enabled);
  if (!enabled) suspended.current = true;

  useEffect(() => {
    if (!enabled || latest.current.terminal) return;
    const controller = new AbortController();
    let active = true;
    let cleanup: void | (() => void);
    let stoppedBeforeCleanup = false;
    const data = latest.current;
    if (suspended.current) {
      suspended.current = false;
      data.timestamp = 0;
      data.payload = undefined;
      data.failedPayload = undefined;
      data.hadPayload = false;
      data.rotated = false;
      setState({ status: 'waiting', hadPayload: false });
    }
    const stop = () => {
      if (!active) return;
      active = false;
      controller.abort();
      if (cleanup) { const dispose = cleanup; cleanup = undefined; dispose(); }
      else stoppedBeforeCleanup = true;
    };
    const publish = (update: ApprovalBrowserAuthQrUpdate) => {
      if (!active || controller.signal.aborted || !current.current.isCurrent()) return;
      if (!update || typeof update !== 'object') { data.terminal = true; setState({ status: 'error', hadPayload: data.hadPayload }); stop(); return; }
      if (update.type === 'no-content') return;
      if (update.type === 'expired') { data.terminal = true; data.payload = undefined; setState({ status: 'expired', hadPayload: data.hadPayload }); stop(); return; }
      if (update.type === 'error') {
        setState({ status: 'error', hadPayload: data.hadPayload });
        if (!update.retrying) { data.terminal = true; stop(); }
        return;
      }
      if (update.type !== 'snapshot' || typeof update.payload !== 'string' || !update.payload
        || !Number.isSafeInteger(update.timestamp_ms) || update.timestamp_ms <= 0
        || update.disappeared !== undefined && typeof update.disappeared !== 'boolean') {
        data.terminal = true; setState({ status: 'error', hadPayload: data.hadPayload }); stop(); return;
      }
      if (update.timestamp_ms < data.timestamp) return;
      if (update.disappeared) {
        data.terminal = true;
        const canFinish = data.hadPayload && data.failedPayload !== data.payload;
        data.payload = undefined;
        setState({ status: 'disappeared', hadPayload: canFinish });
        stop();
        if (canFinish) current.current.onComplete(true);
        return;
      }
      if (data.failedPayload === update.payload) return;
      if (update.timestamp_ms > data.timestamp) {
        data.timestamp = update.timestamp_ms;
        data.payload = update.payload;
        data.hadPayload = true;
        data.rotated ||= update.payload !== initialPayload;
      }
      setState({ status: 'visible', payload: data.payload, hadPayload: data.hadPayload });
    };
    try {
      cleanup = subscribe({ ...scope, signal: controller.signal }, publish);
      if (stoppedBeforeCleanup && cleanup) { const dispose = cleanup; cleanup = undefined; dispose(); }
    } catch {
      data.terminal = true;
      if (active && current.current.isCurrent()) setState({ status: 'error', hadPayload: data.hadPayload });
      stop();
    }
    return stop;
  }, [scopeKey, enabled, subscribe]);

  const payload = enabled && !suspended.current && (state.status === 'waiting' || state.status === 'visible') ? state.payload : undefined;
  const needsApp = payload && latest.current.rotated ? !isHttpsUrl(payload) : requiresApp ?? (payload ? !isHttpsUrl(payload) : false);
  return <div>
    <p>{needsApp ? 'Scan this code with the sign-in app.' : 'Scan this code to continue signing in.'}</p>
    {payload && <div style={{ display: 'inline-block', background: '#fff', maxWidth: '100%' }}>
      <QrCodeBoundary value={payload} QrCode={QrCode} onError={() => {
        latest.current.failedPayload = payload;
        setState({ status: 'render-error', hadPayload: latest.current.hadPayload });
      }} />
    </div>}
    {!payload && state.status === 'waiting' && <p role="status">Waiting for the sign-in code...</p>}
    {state.status === 'disappeared' && <p role="status">The sign-in code is no longer displayed.</p>}
    {state.status === 'expired' && <p role="status">The sign-in code has expired.</p>}
    {state.status === 'error' && <p role="alert">The sign-in code could not be updated.</p>}
    {state.status === 'render-error' && <p role="alert">The sign-in code could not be displayed.</p>}
    {canComplete && <button type="button" disabled={!enabled || suspended.current || !state.hadPayload || state.status === 'expired'
      || state.status === 'error' || state.status === 'render-error'}
      onClick={() => current.current.onComplete(false)}>Done</button>}
  </div>;
}
