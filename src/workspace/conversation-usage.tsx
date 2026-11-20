import { Fragment, useCallback, useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { record } from '../native/protocol.ts';
import { browserAtoms, request } from './host.ts';
import { ToolMenu, ToolSubmenu } from './new-tab-tools.tsx';
import { WorkspaceIcon } from './workspace-icon.tsx';
import { GoalIcon } from './conversation-goal-icons.tsx';
import { contextUsage, rateLimitBuckets, rateLimitLabel, type AccountRateLimits, type ContextUsage, type RateLimitSnapshot,
  type RateLimitWindow, type ThreadTokenUsage } from './conversation-metrics.ts';
import './conversation-usage.css';

export type { AccountRateLimits, ContextUsage, RateLimitSnapshot, RateLimitWindow, ThreadTokenUsage } from './conversation-metrics.ts';
type AccountSnapshot = { value: AccountRateLimits | null; loading: boolean; error: string | null; revision: number };
const emptyAccount: AccountSnapshot = { value: null, loading: true, error: null, revision: 0 };
const accounts = new Map<string, AccountSnapshot>();
const tokens = new Map<string, ThreadTokenUsage>();
const accountListeners = new Map<string, Set<() => void>>(), tokenListeners = new Map<string, Set<() => void>>();
const scope = (hostId: string, threadId: string | null | undefined) => JSON.stringify([hostId, threadId ?? '']);
function publishAccount(hostId: string, value: AccountSnapshot) {
  accounts.set(hostId, value);
  for (const notify of accountListeners.get(hostId) ?? []) notify();
}
function subscribe(map: Map<string, Set<() => void>>, key: string, notify: () => void) {
  const set = map.get(key) ?? new Set<() => void>(); map.set(key, set); set.add(notify);
  return () => { set.delete(notify); if (!set.size) map.delete(key); };
}

// Subscribe at module load, before thread/resume can broadcast the latest
// request's usage. Lifetime token totals must not fill the context donut.
window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== location.origin) return;
  const message = record(event.data), params = record(message.params);
  if (message.type !== 'mcp-notification' || typeof message.hostId !== 'string') return;
  if (message.method === 'thread/tokenUsage/updated' && typeof params.threadId === 'string') {
    const value = record(params.tokenUsage), last = record(value.last), total = record(value.total);
    if (typeof last.totalTokens !== 'number' || typeof total.totalTokens !== 'number') return;
    const key = scope(message.hostId, params.threadId);
    tokens.set(key, value as unknown as ThreadTokenUsage);
    for (const notify of tokenListeners.get(key) ?? []) notify();
  } else if (message.method === 'account/rateLimits/updated') {
    const current = accounts.get(message.hostId) ?? emptyAccount, incoming = record(params.rateLimits);
    if (!Object.keys(incoming).length) return;
    const previous = current.value, limitId = typeof incoming.limitId === 'string' ? incoming.limitId : 'codex';
    // Rolling notifications may omit nullable account metadata; keep known
    // values and replace the supplied rate-limit windows as one snapshot.
    const prior = previous?.rateLimitsByLimitId?.[limitId] ?? (limitId === 'codex' ? previous?.rateLimits : null);
    const merged = { ...prior, ...Object.fromEntries(Object.entries(incoming).filter(([key, value]) =>
      value != null || key === 'primary' || key === 'secondary')) } as unknown as RateLimitSnapshot;
    publishAccount(message.hostId, { value: {
      ...previous, rateLimits: limitId === 'codex' ? merged : previous?.rateLimits ?? null,
      rateLimitsByLimitId: { ...previous?.rateLimitsByLimitId, [limitId]: merged },
    }, loading: false, error: null, revision: current.revision + 1 });
  }
});

export function useConversationUsage(threadId?: string | null, hostId = 'local') {
  const key = scope(hostId, threadId);
  const subscribeTokens = useCallback((notify: () => void) => subscribe(tokenListeners, key, notify), [key]);
  const readTokens = useCallback(() => tokens.get(key) ?? null, [key]);
  const tokenUsage = useSyncExternalStore(subscribeTokens, readTokens);
  const subscribeAccount = useCallback((notify: () => void) => subscribe(accountListeners, hostId, notify), [hostId]);
  const readAccount = useCallback(() => accounts.get(hostId) ?? emptyAccount, [hostId]);
  const account = useSyncExternalStore(subscribeAccount, readAccount);
  const refresh = useCallback(async () => {
    const current = accounts.get(hostId) ?? emptyAccount, revision = current.revision;
    try {
      const value = await request<AccountRateLimits>('account/rateLimits/read', {}, { hostId });
      if ((accounts.get(hostId) ?? emptyAccount).revision !== revision) return;
      publishAccount(hostId, { value, loading: false, error: null, revision: revision + 1 });
    } catch (error) {
      if ((accounts.get(hostId) ?? emptyAccount).revision !== revision) return;
      publishAccount(hostId, { ...current, loading: false, error: error instanceof Error ? error.message : 'Failed to load usage' });
    }
  }, [hostId]);
  useEffect(() => {
    void refresh();
    function reconnect(event: MessageEvent) {
      if (event.source === window && event.origin === location.origin && event.data?.type === 'codex-app-server-connection-changed' &&
          event.data.hostId === hostId && event.data.state === 'connected') void refresh();
    }
    window.addEventListener('message', reconnect);
    return () => window.removeEventListener('message', reconnect);
  }, [hostId, refresh]);
  return { tokenUsage, contextUsage: contextUsage(tokenUsage), rateLimits: account.value, loading: account.loading, error: account.error, refresh };
}
export type ConversationUsageController = ReturnType<typeof useConversationUsage>;

/** Original t6e hover tooltip, gated by show-context-window-usage (default off). */
export function ContextUsageIndicator({ usage, enabled = browserAtoms()['show-context-window-usage'] === true }: { usage: ContextUsage; enabled?: boolean }) {
  const id = useId(), trigger = useRef<HTMLSpanElement>(null), tooltip = useRef<HTMLDivElement>(null);
  const percent = usage.percent;
  function show() {
    const anchor = trigger.current, surface = tooltip.current;
    if (!anchor || !surface) return;
    if (!surface.matches(':popover-open')) surface.showPopover();
    const box = anchor.getBoundingClientRect(), bounds = surface.getBoundingClientRect();
    surface.style.left = Math.max(8, Math.min(box.left + box.width / 2 - bounds.width / 2, innerWidth - bounds.width - 8)) + 'px';
    surface.style.top = Math.max(8, box.top - bounds.height - 4) + 'px';
  }
  function hide() { if (tooltip.current?.matches(':popover-open')) tooltip.current.hidePopover(); }
  if (!enabled || percent == null || !Number.isFinite(percent)) return null;
  const clamped = Math.max(0, Math.min(100, percent)), rounded = Math.round(clamped), full = rounded >= 50;
  return <>
    <span ref={trigger} tabIndex={0} role="img" aria-label={`Context usage: ${rounded}%`} aria-describedby={id}
      className="yard-context-usage" onPointerEnter={show} onPointerLeave={hide} onFocus={show} onBlur={hide}
      onKeyDown={event => { if (event.key === 'Escape') hide(); }}>
      <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true">
        <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="2" opacity=".16" />
        <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="2" pathLength="100" strokeLinecap="round"
          strokeDasharray="100" strokeDashoffset={100 - clamped} opacity={clamped === 0 ? 0 : 1} transform="rotate(-90 6 6)" />
      </svg>
    </span>
    <div id={id} ref={tooltip} role="tooltip" popover="manual" className="yard-context-tooltip">
      <div><span>Context window:</span><span className={full ? 'yard-usage-muted' : ''}>
        {full ? `${rounded}% full` : `${rounded}% used (${100 - rounded}% left)`}</span>
        {usage.usedTokens != null && usage.contextWindow != null && <span>{Math.round(usage.usedTokens / 1_000)}k / {Math.round(usage.contextWindow / 1_000)}k tokens used</span>}
      </div>
    </div>
  </>;
}

function remaining(window: RateLimitWindow) { return Math.max(0, Math.min(100, 100 - window.usedPercent)); }
function validWindow(window: RateLimitWindow | null): window is RateLimitWindow {
  return !!window && window.windowDurationMins != null && window.windowDurationMins > 0 && Number.isFinite(window.usedPercent);
}
function resetLabel(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const now = Date.now(), date = new Date(seconds * 1_000);
  if (date.getTime() <= now) return 'now';
  return new Intl.DateTimeFormat(document.documentElement.lang || 'en', date.getTime() - now < 86_400_000
    ? { hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric' }).format(date);
}

export function AccountUsageSummary({ rateLimits, selectedModel, onUsageSettings }: {
  rateLimits: AccountRateLimits | null; selectedModel?: string | null; onUsageSettings?(): void;
}) {
  const buckets = rateLimitBuckets(rateLimits, selectedModel);
  const grid = <div className="yard-account-usage-grid">{buckets.map(({ id, name, snapshot }) => <Fragment key={id}>
    {name && <span className="yard-account-limit-name" title={name.replaceAll('_', '-')}>{name.replaceAll('_', '-')} limit:</span>}
    {[snapshot.primary, snapshot.secondary].filter(validWindow).map((window, index) => {
      const reset = resetLabel(window.resetsAt);
      return <Fragment key={index}><span className="yard-account-window">{rateLimitLabel(window.windowDurationMins)}</span>
        <span className="yard-account-remaining"><span>{Math.round(remaining(window))}%</span>{reset && <><span>•</span><span title={reset}>{reset}</span></>}</span>
      </Fragment>;
    })}
  </Fragment>)}</div>;
  return onUsageSettings ? <button type="button" role="menuitem" className="yard-account-open-settings" onClick={onUsageSettings}
    aria-label="Open usage settings">{grid}</button> : grid;
}

/** Put this submenu in the Local / SSH composer menu, matching original Ko. */
export function ConversationUsage({ controller, selectedModel, onUsageSettings }: {
  controller: ConversationUsageController; selectedModel?: string | null; onUsageSettings?(): void;
}) {
  const buckets = rateLimitBuckets(controller.rateLimits, selectedModel);
  if (!controller.loading && !buckets.length) return null;
  const tightest = buckets.flatMap(({ snapshot }) => [snapshot.primary, snapshot.secondary]).filter(validWindow)
    .filter(window => window.usedPercent >= 90).sort((a, b) => b.usedPercent - a.usedPercent || (b.windowDurationMins ?? 0) - (a.windowDurationMins ?? 0))[0];
  const label = 'Usage remaining' + (tightest ? ` ${Math.round(remaining(tightest))}%` : '');
  return <div className="yard-account-usage"><ToolSubmenu label={label} icon={<WorkspaceIcon name="usageGauge" />}
    onOpen={() => void controller.refresh()}>
    {controller.loading ? <button type="button" role="menuitem" disabled>Loading usage…</button> :
      <AccountUsageSummary rateLimits={controller.rateLimits} selectedModel={selectedModel} onUsageSettings={onUsageSettings} />}
    <a className="yard-account-learn-more" role="menuitem" target="_blank" rel="noreferrer"
      href="https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan#h_8dd84c836b">Learn more<GoalIcon name="external" size={14} /></a>
  </ToolSubmenu></div>;
}

/** Xc / AV run-location trigger, on the utility rail outside the text editor. */
export function ConversationUsageMenu({ controller, hostId = 'local', hostLabel, selectedModel, onUsageSettings }: {
  controller: ConversationUsageController; hostId?: string; hostLabel?: string; selectedModel?: string | null; onUsageSettings?(): void;
}) {
  const label = hostId === 'local' ? 'Local' : hostLabel || 'Remote';
  return <ToolMenu label="Run location" side="top" align="start" className="yard-run-location-menu"
    triggerButton={<button type="button" className="yard-run-location-trigger" aria-label="Select where to run the chat"
      title="Select where to run the chat" data-composer-navigation-target="run-location">
      <GoalIcon name={hostId === 'local' ? 'local' : 'remote'} size={16} /><span>{label}</span>
      <WorkspaceIcon name="toolChevron" size={12} className="yard-run-location-chevron" />
    </button>}>
    <button type="button" role="menuitem" className="yard-run-location-current" onClick={event => {
      event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover();
    }}><GoalIcon name={hostId === 'local' ? 'local' : 'remote'} size={16} /><span>{label}</span><WorkspaceIcon name="toolSuccess" size={12} /></button>
    <ConversationUsage controller={controller} selectedModel={selectedModel} onUsageSettings={onUsageSettings} />
  </ToolMenu>;
}
