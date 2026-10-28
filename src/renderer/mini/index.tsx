import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ChevronDown, Maximize2, MessageSquare, MoreHorizontal, Settings, X } from 'lucide-react';
import type { PetPosition, WebPetState } from '../../native/pet-overlay.ts';
import type { ServerRequestRef, WorkbenchClient } from '../workbench-contract.ts';
import { builtinPetAssets, builtinPets, miniShortcut, petSize, readPetOptions, readPetState } from './model.ts';
import type { BuiltinPetAssets, PetMotion, PetOption } from './model.ts';
import { PetSprite } from './PetSprite.tsx';
import { Approval, NotificationAction, Question } from './requests.tsx';
import type { MiniActionOutcome, MiniActionRunner, MiniApproval, MiniIdentity, MiniNotificationAction, MiniOutcome, MiniQuestion, MiniRequest } from './requests.tsx';
import './mini.css';

export type MiniCommand =
  | { type: 'avatar-overlay-open-state-request' | 'avatar-overlay-open' | 'avatar-overlay-close' | 'avatar-overlay-hide' }
  | { type: 'workbench-pet-position'; position: PetPosition };

/** Revision changes only when the parent's host projection has been refreshed. */
export interface MiniHostConnection {
  state: 'connected' | 'connecting' | 'disconnected';
  fresh: boolean;
  revision: string;
  /** Daemon connection generation of currently valid server requests. */
  requestGeneration: string | null;
}

/** This is a view of the app's existing thread projection, not a separate store. */
export interface MiniActivity {
  hostId: string;
  threadId: string;
  title: string;
  status: 'running' | 'waiting' | 'review' | 'failed' | 'idle';
  detail?: string;
  approval?: MiniApproval;
  question?: MiniQuestion;
  /** Authoritative pending queue for threads with more than one request. */
  requests?: readonly MiniRequest[];
  actions?: readonly MiniNotificationAction[];
}

export interface StandaloneMiniProps {
  client: WorkbenchClient;
  send(message: MiniCommand): Promise<void>;
  activities: readonly MiniActivity[];
  /** Local bridge loss invalidates all projections; each revision must change after refresh. */
  hostConnections: Readonly<Record<string, MiniHostConnection | undefined>>;
  onOpenThread(identity: MiniIdentity): void;
  onExpand(): void;
  /** Retain outcomes for every request, including questions, until that request is resolved. */
  onApprovalOutcome(requestRef: ServerRequestRef, outcome: MiniOutcome): void;
  onNotificationAction?: MiniActionRunner;
  onNotificationActionOutcome?: MiniActionOutcome;
  onOpenSettings?(): void;
  /** Override built-in sprite URLs when the host serves them at a different path. */
  builtinAssets?: BuiltinPetAssets;
  /** The caller owns the composer, draft identity, submit and transcript. */
  children?: ReactNode;
  /** The host of the caller's current Quick chat draft. */
  quickChatHostId?: string;
  /** Required for notification follow-up; null threadId denotes a new draft. */
  quickChatTarget?: { hostId: string; threadId: string | null };
  onQuickChatTarget?(identity: MiniIdentity): void;
  /** Disable when the application already owns the in-page shortcut handler. */
  shortcut?: boolean;
}

const settingKeys = ['selected-avatar-id', 'avatar-overlay-mascot-width-px', 'avatar-overlay-pet-visible'] as const;
const emptySettings: Record<string, unknown> = {};
const statusText: Record<MiniActivity['status'], string> = {
  running: 'Working', waiting: 'Needs attention', review: 'Ready for review', failed: 'Failed', idle: 'Idle',
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function motionFor(activities: readonly MiniActivity[]): PetMotion {
  for (const status of ['waiting', 'failed', 'running', 'review'] as const) {
    if (activities.some(activity => activity.status === status)) return status;
  }
  return 'idle';
}

export function StandaloneMini({ client, send, activities, hostConnections, onOpenThread, onExpand, onApprovalOutcome,
  onNotificationAction, onNotificationActionOutcome, onOpenSettings, builtinAssets = builtinPetAssets, children, quickChatHostId,
  quickChatTarget, onQuickChatTarget, shortcut = true }: StandaloneMiniProps) {
  const [state, setState] = useState<WebPetState | null>(null);
  const [settings, setSettings] = useState<Record<string, unknown>>(emptySettings);
  const [custom, setCustom] = useState<unknown>(null);
  const [error, setError] = useState('');
  const [picker, setPicker] = useState(false);
  const [menu, setMenu] = useState(false);
  const [composer, setComposer] = useState(false);
  const [requestedTarget, setRequestedTarget] = useState<MiniIdentity | null>(null);
  const [saving, setSaving] = useState(false);
  const [sizeDraft, setSizeDraft] = useState<number | null>(null);
  const [hover, setHover] = useState(false);
  const [position, setPosition] = useState<PetPosition | null>(null);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [, setConnectionVersion] = useState(0);
  const container = useRef<HTMLElement>(null);
  const composerElement = useRef<HTMLElement>(null);
  const composerFocusRequested = useRef(false);
  const menuElement = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const quickChatButton = useRef<HTMLButtonElement>(null);
  const pickerClose = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const stateRef = useRef<WebPetState | null>(null);
  const settingRevisions = useRef<Record<string, number>>({});
  const mounted = useRef(false);
  const lifecycle = useRef(0);
  const settingsRead = useRef(0);
  const customRead = useRef(0);
  const sizeRevision = useRef(0);
  const sizeWrites = useRef<Promise<void>>(Promise.resolve());
  const selectionPending = useRef(false);
  const drag = useRef<{ pointerId: number; x: number; y: number; left: number; top: number; moved: boolean; position: PetPosition | null } | null>(null);
  const ignoreClick = useRef(false);
  const hiding = useRef(false);
  const sendRef = useRef(send);
  const connectionsRef = useRef(hostConnections);
  const activitiesRef = useRef(activities);
  const quickChatHost = quickChatTarget?.hostId ?? quickChatHostId;
  const quickChatHostRef = useRef(quickChatHost);
  const barriers = useRef(new Map<string, string | null>());
  const observedConnections = useRef(new Map<string, string>());
  const invalidRequests = useRef(new Map<string, Set<string>>());
  const localEpoch = useRef(0);
  connectionsRef.current = hostConnections;
  activitiesRef.current = activities;
  quickChatHostRef.current = quickChatHost;
  useEffect(() => { sendRef.current = send; }, [send]);

  const hostReady = useCallback((hostId: string) => {
    const current = connectionsRef.current[hostId];
    const observed = observedConnections.current.get(hostId);
    if (!current || current.state !== 'connected' || !current.fresh || observed === 'disconnected' || observed === 'connecting') return false;
    return !barriers.current.has(hostId) || barriers.current.get(hostId) !== current.revision;
  }, []);

  const usable = useCallback((hostId: string) => hostReady('local') && hostReady(hostId), [hostReady]);

  const requestReady = useCallback((ref: ServerRequestRef, hostId: string) =>
    ref.hostId === hostId && usable(hostId) && connectionsRef.current[hostId]?.requestGeneration === ref.generation &&
      !invalidRequests.current.get(hostId)?.has(ref.generation), [usable]);

  const invalidate = useCallback((hostId: string) => {
    const targets = hostId === 'local' ? new Set(['local', ...Object.keys(connectionsRef.current),
      ...activitiesRef.current.map(activity => activity.hostId), ...(quickChatHostRef.current ? [quickChatHostRef.current] : [])]) : new Set([hostId]);
    for (const id of targets) {
      barriers.current.set(id, connectionsRef.current[id]?.revision ?? null);
      const generations = invalidRequests.current.get(id) ?? new Set<string>();
      const activeGeneration = connectionsRef.current[id]?.requestGeneration;
      if (activeGeneration) generations.add(activeGeneration);
      for (const activity of activitiesRef.current) if (activity.hostId === id) {
        for (const request of [activity.approval, activity.question, ...(activity.requests ?? []).map(item => item.request)]) {
          if (request?.requestRef.hostId === id) generations.add(request.requestRef.generation);
        }
      }
      invalidRequests.current.set(id, generations);
    }
    if (hostId === 'local') {
      localEpoch.current++;
      settingsRead.current++;
      customRead.current++;
      sizeRevision.current++;
      setSizeDraft(null);
    }
    if (hostId === 'local' || hostId === quickChatHostRef.current) composerFocusRequested.current = false;
    setConnectionVersion(version => version + 1);
  }, []);

  const sendCommand = useCallback(async (message: MiniCommand) => {
    if (message.type !== 'avatar-overlay-open-state-request' && !hostReady('local')) {
      if (mounted.current) setError('Mini connection is unavailable.');
      throw new Error('Mini connection is unavailable');
    }
    try { await sendRef.current(message); }
    catch { if (mounted.current) setError('Mini could not reach the host.'); throw new Error('Mini host request failed'); }
  }, [hostReady]);

  const loadSettings = useCallback(async () => {
    const before = { ...settingRevisions.current };
    const generation = lifecycle.current, request = ++settingsRead.current;
    try {
      const response = object(await client.host('get-settings'));
      if (!mounted.current || generation !== lifecycle.current || request !== settingsRead.current) return;
      const values = object(response.values);
      setSettings(previous => {
        const next = { ...previous };
        for (const key of settingKeys) if ((settingRevisions.current[key] ?? 0) === (before[key] ?? 0)) next[key] = values[key];
        return next;
      });
    } catch { if (mounted.current && generation === lifecycle.current && request === settingsRead.current) setError('Pet settings could not be loaded.'); }
  }, [client]);

  const loadCustom = useCallback(async () => {
    const generation = lifecycle.current, request = ++customRead.current;
    try {
      const response = await client.host('custom-avatars');
      if (mounted.current && generation === lifecycle.current && request === customRead.current) setCustom(response);
    } catch { if (mounted.current && generation === lifecycle.current && request === customRead.current) setError('Custom pets could not be loaded.'); }
  }, [client]);

  useEffect(() => {
    mounted.current = true;
    lifecycle.current++;
    const unsubscribe = client.subscribe(event => {
      if (event.type === 'workbench-pet-state') {
        const next = readPetState(event.state);
        if (!next) return;
        if (!next.isOpen && container.current?.contains(document.activeElement)) previousFocus.current?.focus();
        stateRef.current = next;
        setState(next);
        if (!drag.current) setPosition(next.position);
        if (!next.isOpen) { hiding.current = false; setMenu(false); setPicker(false); setComposer(false); setRequestedTarget(null); }
      } else if (event.type === 'workbench-mini-setting' && typeof event.key === 'string' && settingKeys.includes(event.key as typeof settingKeys[number])) {
        const key = event.key;
        settingRevisions.current[key] = (settingRevisions.current[key] ?? 0) + 1;
        setSettings(previous => ({ ...previous, [key]: event.value }));
      } else if (event.type === 'workbench-pet-error') {
        hiding.current = false;
        setError(typeof event.error === 'string' ? event.error : 'Mini settings could not be saved.');
      } else if (event.type === 'codex-app-server-connection-changed' && typeof event.hostId === 'string') {
        if (typeof event.state === 'string') observedConnections.current.set(event.hostId, event.state);
        if (event.state === 'disconnected' || event.state === 'connecting') invalidate(event.hostId);
        if (event.hostId === 'local' && event.state === 'connected') {
          setConnectionVersion(version => version + 1);
          void sendCommand({ type: 'avatar-overlay-open-state-request' }).catch(() => {});
          void loadSettings();
          void loadCustom();
        } else if (event.state === 'connected') setConnectionVersion(version => version + 1);
      }
    });
    void sendCommand({ type: 'avatar-overlay-open-state-request' }).catch(() => {});
    void loadSettings();
    void loadCustom();
    return () => { mounted.current = false; lifecycle.current++; unsubscribe(); };
  }, [client, invalidate, loadCustom, loadSettings, sendCommand]);

  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  useEffect(() => {
    if (!shortcut) return;
    const listener = (event: KeyboardEvent) => {
      if (!miniShortcut(event, /Mac|iPhone|iPad/.test(navigator.platform))) return;
      event.preventDefault();
      void sendCommand({ type: 'avatar-overlay-open' }).catch(() => {});
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [sendCommand, shortcut]);

  useEffect(() => {
    if (menu) menuElement.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    else if (picker) pickerClose.current?.focus();
  }, [menu, picker]);

  useEffect(() => {
    if (requestedTarget && quickChatTarget?.hostId === requestedTarget.hostId && quickChatTarget.threadId === requestedTarget.threadId) setRequestedTarget(null);
  }, [requestedTarget, quickChatTarget?.hostId, quickChatTarget?.threadId]);

  useEffect(() => {
    if (!menu && !picker && !composer) return;
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      if (menu) { setMenu(false); menuButton.current?.focus(); }
      else if (picker) { setPicker(false); menuButton.current?.focus(); }
      else { setComposer(false); setRequestedTarget(null); composerFocusRequested.current = false; quickChatButton.current?.focus(); }
    };
    const outside = (event: PointerEvent) => {
      if (menu && event.target instanceof Node && !menuElement.current?.contains(event.target) && !menuButton.current?.contains(event.target)) setMenu(false);
    };
    window.addEventListener('keydown', keyboard, true);
    document.addEventListener('pointerdown', outside, true);
    return () => { window.removeEventListener('keydown', keyboard, true); document.removeEventListener('pointerdown', outside, true); };
  }, [menu, picker, composer]);

  useEffect(() => {
    if (!state?.isOpen) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const outside = (event: PointerEvent) => {
      if (state.visibility !== 'on-demand' || hiding.current || !(event.target instanceof Node) || container.current?.contains(event.target)) return;
      hiding.current = true;
      void sendCommand({ type: 'avatar-overlay-hide' }).catch(() => { hiding.current = false; });
    };
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('pointerdown', outside);
      if (container.current?.contains(document.activeElement)) previousFocus.current?.focus();
    };
  }, [state?.isOpen, state?.visibility, sendCommand]);

  async function writeSetting(key: typeof settingKeys[number], value: unknown, epoch: number, revision: string) {
    if (epoch !== localEpoch.current || !hostReady('local') || connectionsRef.current.local?.revision !== revision) throw new Error('Mini connection is unavailable');
    const before = settingRevisions.current[key] ?? 0;
    const generation = lifecycle.current;
    await client.host('set-setting', { key, value });
    if (epoch !== localEpoch.current || !hostReady('local') || connectionsRef.current.local?.revision !== revision) throw new Error('Mini connection changed while saving');
    if (mounted.current && generation === lifecycle.current && (settingRevisions.current[key] ?? 0) === before) {
      settingRevisions.current[key] = before + 1;
      setSettings(previous => ({ ...previous, [key]: value }));
    }
  }
  async function selectPet(id: string) {
    if (selectionPending.current || !hostReady('local')) return;
    selectionPending.current = true;
    const generation = lifecycle.current;
    const epoch = localEpoch.current;
    const revision = connectionsRef.current.local!.revision;
    setSaving(true); setError('');
    try {
      await writeSetting('selected-avatar-id', id, epoch, revision);
      if (!mounted.current || generation !== lifecycle.current) return;
      if (settings['avatar-overlay-pet-visible'] === false) await writeSetting('avatar-overlay-pet-visible', true, epoch, revision);
      if (mounted.current && generation === lifecycle.current) setPicker(false);
    } catch { if (mounted.current && generation === lifecycle.current) setError('Pet selection could not be saved.'); }
    finally { selectionPending.current = false; if (mounted.current && generation === lifecycle.current) setSaving(false); }
  }
  function resizePet(value: number) {
    if (!hostReady('local')) return;
    const revision = ++sizeRevision.current, generation = lifecycle.current;
    const epoch = localEpoch.current;
    const connectionRevision = connectionsRef.current.local!.revision;
    setSizeDraft(value);
    sizeWrites.current = sizeWrites.current.catch(() => {}).then(async () => {
      if (revision !== sizeRevision.current || generation !== lifecycle.current || epoch !== localEpoch.current || !hostReady('local') || connectionsRef.current.local?.revision !== connectionRevision) return;
      await writeSetting('avatar-overlay-mascot-width-px', value, epoch, connectionRevision);
      if (mounted.current && generation === lifecycle.current && revision === sizeRevision.current) setSizeDraft(null);
    }).catch(() => {
      if (mounted.current && generation === lifecycle.current && revision === sizeRevision.current) {
        setSizeDraft(null); setError('Pet size could not be saved.'); void loadSettings();
      }
    });
  }

  const options = readPetOptions(custom, builtinAssets);
  const selectedId = typeof settings['selected-avatar-id'] === 'string' ? settings['selected-avatar-id'] as string : builtinPets[0].id;
  const selected: PetOption = options.find(option => option.id === selectedId) ?? { id: selectedId, name: selectedId, rows: 11 };
  const localReady = hostReady('local');
  const connectionMessage = (hostId: string) => {
    const current = hostConnections[hostId];
    return observedConnections.current.get(hostId) === 'disconnected' || !current || current.state === 'disconnected' ? 'Connection lost' : 'Refreshing activity';
  };
  const targetReady = !requestedTarget || quickChatTarget?.hostId === requestedTarget.hostId && quickChatTarget.threadId === requestedTarget.threadId;
  const quickReady = targetReady && !!quickChatHost && usable(quickChatHost);
  useEffect(() => {
    if (!composer || !quickReady || !composerFocusRequested.current) return;
    const input = composerElement.current?.querySelector<HTMLElement>('textarea:not(:disabled), input:not(:disabled), [contenteditable="true"]');
    if (input) { composerFocusRequested.current = false; input.focus(); }
  }, [composer, quickReady, quickChatTarget?.hostId, quickChatTarget?.threadId]);
  function openFollowUp(identity: MiniIdentity) {
    if (!onQuickChatTarget || !quickChatTarget || !usable(identity.hostId)) return;
    composerFocusRequested.current = true;
    setRequestedTarget(identity);
    setComposer(true);
    onQuickChatTarget(identity);
  }
  const width = Math.min(420, viewport.width), height = Math.min(620, viewport.height);
  const left = (position?.x ?? 1) * Math.max(0, viewport.width - width), top = (position?.y ?? 1) * Math.max(0, viewport.height - height);
  const style = { left, top, width, height, '--yard-pet-width': `${sizeDraft ?? petSize(settings['avatar-overlay-mascot-width-px'])}px` } as CSSProperties;

  function pointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left, top, moved: false, position: null };
  }
  function pointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const start = drag.current;
    if (!start || event.pointerId !== start.pointerId) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) <= 3) return;
    start.moved = true;
    const maxX = Math.max(0, window.innerWidth - width), maxY = Math.max(0, window.innerHeight - height);
    start.position = { x: maxX ? Math.max(0, Math.min(1, (start.left + dx) / maxX)) : 0,
      y: maxY ? Math.max(0, Math.min(1, (start.top + dy) / maxY)) : 0 };
    setPosition(start.position);
  }
  function pointerEnd(event: React.PointerEvent<HTMLButtonElement>, cancelled = false) {
    const start = drag.current;
    if (!start || event.pointerId !== start.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (cancelled) { setPosition(stateRef.current?.position ?? null); return; }
    if (start.moved && start.position) {
      ignoreClick.current = true;
      window.setTimeout(() => { ignoreClick.current = false; }, 0);
      void sendCommand({ type: 'workbench-pet-position', position: start.position }).catch(() => setPosition(stateRef.current?.position ?? null));
    }
  }

  if (!state?.isOpen && !error) return null;
  return <aside ref={container} className="yard-mini" data-workbench-mini="" aria-label="Codex Mini" style={style}>
    <div className="yard-mini-content">
      {state?.isOpen && <>
        {!localReady && <div className="yard-mini-connection" role="status">{connectionMessage('local')}. Activity is paused.</div>}
        {composer && children && <section ref={composerElement} className="yard-mini-composer" aria-label="Mini conversation">
          <div className="yard-mini-composer-heading"><strong>Quick chat</strong><button type="button" title="Close Quick chat" aria-label="Close Quick chat"
            onClick={() => { setComposer(false); setRequestedTarget(null); composerFocusRequested.current = false; quickChatButton.current?.focus(); }}><X size={15} /></button></div>
          {!quickReady && <p className="yard-mini-composer-status" role="status">{!targetReady ? 'Opening conversation...' : quickChatHost ? `${connectionMessage(localReady ? quickChatHost : 'local')}. Quick chat is paused.` : 'Select a conversation to use Quick chat.'}</p>}
          <div inert={!quickReady}>{children}</div>
        </section>}
        {activities.length > 0 && <div className="yard-mini-activities" aria-label="Recent activity">
          {activities.map(activity => {
            const ready = usable(activity.hostId);
            const identity = { hostId: activity.hostId, threadId: activity.threadId };
            const unavailable = connectionMessage(localReady ? activity.hostId : 'local');
            const requests: readonly MiniRequest[] = activity.requests ?? [
              ...(activity.approval ? [{ kind: 'approval' as const, request: activity.approval }] : []),
              ...(activity.question ? [{ kind: 'question' as const, request: activity.question }] : []),
            ];
            return <div className="yard-mini-activity" key={JSON.stringify([activity.hostId, activity.threadId])}>
            <button type="button" className="yard-mini-activity-link" onClick={() => onOpenThread({ hostId: activity.hostId, threadId: activity.threadId })}>
              <span className={`yard-mini-status yard-mini-status-${ready ? activity.status : 'paused'}`} />
              <span><strong>{activity.title || 'Untitled conversation'}</strong><small>{ready ? activity.detail || statusText[activity.status] : `${unavailable}. Activity paused.`}</small></span>
            </button>
            {requests.map(({ kind, request }) => <div key={JSON.stringify(request.requestRef)}>
              {kind === 'approval'
                ? <Approval client={client} approval={request} enabled={requestReady(request.requestRef, activity.hostId)}
                  canWrite={() => requestReady(request.requestRef, activity.hostId)} onOutcome={onApprovalOutcome} />
                : <Question client={client} question={request} enabled={requestReady(request.requestRef, activity.hostId)}
                  canWrite={() => requestReady(request.requestRef, activity.hostId)} onOutcome={onApprovalOutcome} />}
              {ready && !requestReady(request.requestRef, activity.hostId) && <small className="yard-mini-request-expired" role="status">Request expired. Open the conversation to check its status.</small>}
            </div>)}
            {activity.actions?.length ? <div className="yard-mini-request-actions yard-mini-activity-actions">{activity.actions.map(action => <NotificationAction
              key={action.id} action={action} identity={identity} enabled={ready} canWrite={() => usable(activity.hostId)} onOpen={onOpenThread}
              onFollowUp={children && onQuickChatTarget && quickChatTarget ? openFollowUp : undefined} onRun={onNotificationAction} onOutcome={onNotificationActionOutcome} />)}</div> : null}
          </div>; })}
        </div>}
        {picker && <section className="yard-mini-picker" aria-label="Choose pet">
          <div className="yard-mini-picker-heading"><strong>Choose pet</strong><button ref={pickerClose} type="button" title="Close" aria-label="Close pet picker" onClick={() => { setPicker(false); menuButton.current?.focus(); }}><X size={15} /></button></div>
          <div className="yard-mini-options">{options.map(option => <button type="button" className="yard-mini-option" key={option.id}
            aria-pressed={option.id === selectedId} disabled={saving || !localReady || !option.src} title={option.src ? option.name : `${option.name}: artwork unavailable`}
            onClick={() => { void selectPet(option.id); }}><span className="yard-mini-option-image"><PetSprite pet={option} motion="idle" /></span><span>{option.name}</span></button>)}</div>
          {!options.some(option => option.id === selectedId) && <p>Selected pet unavailable: {selectedId}</p>}
          <label className="yard-mini-size">Size <input type="range" min="80" max="224" step="1" value={sizeDraft ?? petSize(settings['avatar-overlay-mascot-width-px'])}
            disabled={saving || !localReady} onChange={event => resizePet(Number(event.target.value))} /></label>
          <button type="button" className="yard-mini-refresh" disabled={!localReady} onClick={() => { void loadCustom(); }}>Refresh custom pets</button>
        </section>}
        <div className="yard-mini-pet-area">
          {settings['avatar-overlay-pet-visible'] !== false && <button type="button" className="yard-mini-mascot" data-testid="avatar-mascot-button"
            aria-label={`Open Codex, ${selected.name}`} title="Open Codex" onPointerDown={pointerDown} onPointerMove={pointerMove}
            onPointerUp={event => pointerEnd(event)} onPointerCancel={event => pointerEnd(event, true)} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}
            onContextMenu={event => { event.preventDefault(); setMenu(true); }} onClick={() => { if (!ignoreClick.current) onExpand(); }}>
            <PetSprite pet={selected} motion={hover ? 'jumping' : motionFor(activities.filter(activity => usable(activity.hostId)))} /></button>}
          <div className="yard-mini-controls">
            {children && <button ref={quickChatButton} type="button" title="Quick chat" aria-label="Quick chat" aria-expanded={composer} onClick={() => {
              if (composer) setRequestedTarget(null);
              composerFocusRequested.current = !composer && quickReady;
              setComposer(!composer);
            }}><MessageSquare size={16} /></button>}
            <button type="button" title="Open Codex" aria-label="Open Codex" onClick={onExpand}><Maximize2 size={16} /></button>
            <button ref={menuButton} type="button" title="Mini menu" aria-label="Mini menu" aria-expanded={menu} onClick={() => setMenu(value => !value)}><MoreHorizontal size={18} /></button>
          </div>
          {menu && <div ref={menuElement} className="yard-mini-menu" role="menu" onKeyDown={event => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
            const current = items.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 :
              (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items[next]?.focus();
          }}>
            <button type="button" role="menuitem" onClick={() => { setMenu(false); setPicker(true); void loadCustom(); }}><ChevronDown size={15} /> Choose pet</button>
            {onOpenSettings && <button type="button" role="menuitem" onClick={() => { setMenu(false); onOpenSettings(); }}><Settings size={15} /> Mini settings</button>}
            <button type="button" role="menuitem" onClick={() => { setMenu(false); void sendCommand({ type: 'avatar-overlay-close' }).catch(() => {}); }}><X size={15} /> Hide Mini</button>
          </div>}
        </div>
      </>}
      {error && <div className="yard-mini-error" role="alert">{error}<div><button type="button" onClick={() => {
        setError(''); void sendCommand({ type: 'avatar-overlay-open-state-request' }).catch(() => {}); void loadSettings(); void loadCustom();
      }}>Retry</button><button type="button" onClick={() => { setError(''); void sendCommand({ type: 'avatar-overlay-close' }).catch(() => {}); }}>Hide Mini</button></div></div>}
    </div>
  </aside>;
}

export const StandalonePetOverlay = StandaloneMini;
export { builtinPetAssets, builtinPets, miniShortcut, petFrame, readPetOptions, readPetState } from './model.ts';
export type { BuiltinPetAssets, BuiltinPetId, PetMotion, PetOption } from './model.ts';
export { classifyMiniFailure } from './requests.tsx';
export type { MiniActionOutcome, MiniActionRunner, MiniApproval, MiniIdentity, MiniNotificationAction, MiniOutcome, MiniQuestion, MiniRequest } from './requests.tsx';
