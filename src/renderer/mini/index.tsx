import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ChevronDown, Maximize2, MessageSquare, MoreHorizontal, Settings, X } from 'lucide-react';
import type { PetPosition, WebPetState } from '../../native/pet-overlay.ts';
import type { ServerRequestRef, WorkbenchClient } from '../workbench-contract.ts';
import { builtinPets, miniShortcut, petSize, readPetOptions, readPetState } from './model.ts';
import type { BuiltinPetAssets, PetMotion, PetOption } from './model.ts';
import { PetSprite } from './PetSprite.tsx';
import './mini.css';

export type MiniCommand =
  | { type: 'avatar-overlay-open-state-request' | 'avatar-overlay-open' | 'avatar-overlay-close' | 'avatar-overlay-hide' }
  | { type: 'workbench-pet-position'; position: PetPosition };

export interface MiniApproval {
  requestRef: ServerRequestRef;
  title: string;
  detail?: string;
  choices: readonly { label: string; result: unknown }[];
  /** The parent retains an uncertain or forwarded result until the request is resolved. */
  outcome?: 'sent' | 'unknown';
}

/** This is a view of the app's existing thread projection, not a separate store. */
export interface MiniActivity {
  hostId: string;
  threadId: string;
  title: string;
  status: 'running' | 'waiting' | 'review' | 'failed' | 'idle';
  detail?: string;
  approval?: MiniApproval;
}

export interface StandaloneMiniProps {
  client: WorkbenchClient;
  send(message: MiniCommand): Promise<void>;
  activities: readonly MiniActivity[];
  onOpenThread(identity: { hostId: string; threadId: string }): void;
  onExpand(): void;
  onApprovalOutcome(requestRef: ServerRequestRef, outcome: 'sent' | 'unknown'): void;
  onOpenSettings?(): void;
  /** Manager supplies any permitted built-in sprites; custom sprites come from the host. */
  builtinAssets?: BuiltinPetAssets;
  /** The caller owns the composer, draft identity, submit and transcript. */
  children?: ReactNode;
  /** Disable when the application already owns the in-page shortcut handler. */
  shortcut?: boolean;
}

const noAssets: BuiltinPetAssets = {};
const settingKeys = ['selected-avatar-id', 'avatar-overlay-mascot-width-px', 'avatar-overlay-pet-visible'] as const;
const emptySettings: Record<string, unknown> = {};
const statusText: Record<MiniActivity['status'], string> = {
  running: 'Working', waiting: 'Needs attention', review: 'Ready for review', failed: 'Failed', idle: 'Idle',
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function Approval({ client, approval, onOutcome }: { client: WorkbenchClient; approval: MiniApproval; onOutcome: StandaloneMiniProps['onApprovalOutcome'] }) {
  const [result, setResult] = useState<'idle' | 'sending' | 'sent' | 'unknown'>('idle');
  const attempted = useRef(false);
  async function reply(value: unknown) {
    if (attempted.current || approval.outcome) return;
    attempted.current = true;
    setResult('sending');
    let outcome: 'sent' | 'unknown';
    try { await client.reply(approval.requestRef, { result: value }); outcome = 'sent'; }
    catch { outcome = 'unknown'; }
    setResult(outcome);
    onOutcome(approval.requestRef, outcome);
  }
  const visibleResult = approval.outcome ?? result;
  return <div className="yard-mini-approval">
    <strong>{approval.title}</strong>{approval.detail && <p>{approval.detail}</p>}
    <div className="yard-mini-approval-actions">{approval.choices.map((choice, index) => <button type="button" key={index}
      disabled={visibleResult !== 'idle'} onClick={() => { void reply(choice.result); }}>{choice.label}</button>)}</div>
    {visibleResult === 'sent' && <small>Response sent</small>}
    {visibleResult === 'unknown' && <small role="alert">Response could not be confirmed. Check the conversation before responding again.</small>}
  </div>;
}

function motionFor(activities: readonly MiniActivity[]): PetMotion {
  for (const status of ['waiting', 'failed', 'running', 'review'] as const) {
    if (activities.some(activity => activity.status === status)) return status;
  }
  return 'idle';
}

export function StandaloneMini({ client, send, activities, onOpenThread, onExpand, onApprovalOutcome, onOpenSettings,
  builtinAssets = noAssets, children, shortcut = true }: StandaloneMiniProps) {
  const [state, setState] = useState<WebPetState | null>(null);
  const [settings, setSettings] = useState<Record<string, unknown>>(emptySettings);
  const [custom, setCustom] = useState<unknown>(null);
  const [error, setError] = useState('');
  const [picker, setPicker] = useState(false);
  const [menu, setMenu] = useState(false);
  const [composer, setComposer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sizeDraft, setSizeDraft] = useState<number | null>(null);
  const [hover, setHover] = useState(false);
  const [position, setPosition] = useState<PetPosition | null>(null);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const container = useRef<HTMLElement>(null);
  const menuElement = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
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
  useEffect(() => { sendRef.current = send; }, [send]);

  const sendCommand = useCallback(async (message: MiniCommand) => {
    try { await sendRef.current(message); }
    catch { if (mounted.current) setError('Mini could not reach the host.'); throw new Error('Mini host request failed'); }
  }, []);

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
        if (!next.isOpen) { hiding.current = false; setMenu(false); setPicker(false); setComposer(false); }
      } else if (event.type === 'workbench-mini-setting' && typeof event.key === 'string' && settingKeys.includes(event.key as typeof settingKeys[number])) {
        const key = event.key;
        settingRevisions.current[key] = (settingRevisions.current[key] ?? 0) + 1;
        setSettings(previous => ({ ...previous, [key]: event.value }));
      } else if (event.type === 'workbench-pet-error') {
        hiding.current = false;
        setError(typeof event.error === 'string' ? event.error : 'Mini settings could not be saved.');
      } else if (event.type === 'codex-app-server-connection-changed' && event.hostId === 'local' && event.state === 'connected') {
        void sendCommand({ type: 'avatar-overlay-open-state-request' }).catch(() => {});
        void loadSettings();
        void loadCustom();
      }
    });
    void sendCommand({ type: 'avatar-overlay-open-state-request' }).catch(() => {});
    void loadSettings();
    void loadCustom();
    return () => { mounted.current = false; lifecycle.current++; unsubscribe(); };
  }, [client, loadCustom, loadSettings, sendCommand]);

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
    if (!menu && !picker && !composer) return;
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      if (menu) { setMenu(false); menuButton.current?.focus(); }
      else if (picker) { setPicker(false); menuButton.current?.focus(); }
      else setComposer(false);
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

  async function writeSetting(key: typeof settingKeys[number], value: unknown) {
    const before = settingRevisions.current[key] ?? 0;
    const generation = lifecycle.current;
    await client.host('set-setting', { key, value });
    if (mounted.current && generation === lifecycle.current && (settingRevisions.current[key] ?? 0) === before) {
      settingRevisions.current[key] = before + 1;
      setSettings(previous => ({ ...previous, [key]: value }));
    }
  }
  async function selectPet(id: string) {
    if (selectionPending.current) return;
    selectionPending.current = true;
    const generation = lifecycle.current;
    setSaving(true); setError('');
    try {
      await writeSetting('selected-avatar-id', id);
      if (!mounted.current || generation !== lifecycle.current) return;
      if (settings['avatar-overlay-pet-visible'] === false) await writeSetting('avatar-overlay-pet-visible', true);
      if (mounted.current && generation === lifecycle.current) setPicker(false);
    } catch { if (mounted.current && generation === lifecycle.current) setError('Pet selection could not be saved.'); }
    finally { selectionPending.current = false; if (mounted.current && generation === lifecycle.current) setSaving(false); }
  }
  function resizePet(value: number) {
    const revision = ++sizeRevision.current, generation = lifecycle.current;
    setSizeDraft(value);
    sizeWrites.current = sizeWrites.current.catch(() => {}).then(async () => {
      if (revision !== sizeRevision.current || generation !== lifecycle.current) return;
      await writeSetting('avatar-overlay-mascot-width-px', value);
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
        {composer && children && <section className="yard-mini-composer" aria-label="Mini conversation">{children}</section>}
        {activities.length > 0 && <div className="yard-mini-activities" aria-label="Recent activity">
          {activities.map(activity => <div className="yard-mini-activity" key={JSON.stringify([activity.hostId, activity.threadId])}>
            <button type="button" className="yard-mini-activity-link" onClick={() => onOpenThread({ hostId: activity.hostId, threadId: activity.threadId })}>
              <span className={`yard-mini-status yard-mini-status-${activity.status}`} />
              <span><strong>{activity.title || 'Untitled conversation'}</strong><small>{activity.detail || statusText[activity.status]}</small></span>
            </button>
            {activity.approval && <Approval key={JSON.stringify(activity.approval.requestRef)} client={client} approval={activity.approval} onOutcome={onApprovalOutcome} />}
          </div>)}
        </div>}
        {picker && <section className="yard-mini-picker" aria-label="Choose pet">
          <div className="yard-mini-picker-heading"><strong>Choose pet</strong><button ref={pickerClose} type="button" title="Close" aria-label="Close pet picker" onClick={() => { setPicker(false); menuButton.current?.focus(); }}><X size={15} /></button></div>
          <div className="yard-mini-options">{options.map(option => <button type="button" className="yard-mini-option" key={option.id}
            aria-pressed={option.id === selectedId} disabled={saving || !option.src} title={option.src ? option.name : `${option.name}: artwork unavailable`}
            onClick={() => { void selectPet(option.id); }}><span className="yard-mini-option-image"><PetSprite pet={option} motion="idle" /></span><span>{option.name}</span></button>)}</div>
          {!options.some(option => option.id === selectedId) && <p>Selected pet unavailable: {selectedId}</p>}
          <label className="yard-mini-size">Size <input type="range" min="80" max="224" step="1" value={sizeDraft ?? petSize(settings['avatar-overlay-mascot-width-px'])}
            disabled={saving} onChange={event => resizePet(Number(event.target.value))} /></label>
          <button type="button" className="yard-mini-refresh" onClick={() => { void loadCustom(); }}>Refresh custom pets</button>
        </section>}
        <div className="yard-mini-pet-area">
          {settings['avatar-overlay-pet-visible'] !== false && <button type="button" className="yard-mini-mascot" data-testid="avatar-mascot-button"
            aria-label={`Open Codex, ${selected.name}`} title="Open Codex" onPointerDown={pointerDown} onPointerMove={pointerMove}
            onPointerUp={event => pointerEnd(event)} onPointerCancel={event => pointerEnd(event, true)} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}
            onContextMenu={event => { event.preventDefault(); setMenu(true); }} onClick={() => { if (!ignoreClick.current) onExpand(); }}>
            <PetSprite pet={selected} motion={hover ? 'jumping' : motionFor(activities)} /></button>}
          <div className="yard-mini-controls">
            {children && <button type="button" title="Quick chat" aria-label="Quick chat" aria-expanded={composer} onClick={() => setComposer(value => !value)}><MessageSquare size={16} /></button>}
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
export { builtinPets, miniShortcut, petFrame, readPetOptions, readPetState } from './model.ts';
export type { BuiltinPetAssets, BuiltinPetId, PetMotion, PetOption } from './model.ts';
