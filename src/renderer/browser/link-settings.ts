import { preferenceDefinitions } from '../settings/preferences.ts';
import type { WorkbenchClient, WorkbenchEvent } from '../workbench-contract.ts';
import { effectiveWebLinkTarget, resolveBrowserLinkTarget } from './preferences.ts';
import type { BrowserLinkDecision, BrowserLinkTarget } from './preferences.ts';

const webKey = 'open-link-in-target-preference';
const localKey = 'open-local-url-in-target-preference';
const legacyKey = 'desktop-link-default-destination';
type Source = 'web' | 'local' | 'legacy';
const sources: readonly Source[] = ['web', 'local', 'legacy'];

export type LinkSettingObservation =
  | { readonly status: 'idle' | 'loading' | 'missing' | 'invalid' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'value'; readonly value: BrowserLinkTarget | null };

export interface LinkSettingsSnapshot {
  readonly status: 'idle' | 'active' | 'revoked';
  readonly web: LinkSettingObservation;
  readonly local: LinkSettingObservation;
  readonly legacy: LinkSettingObservation;
  /** The original settings-loading gate, as observed by this projection. */
  readonly forceExternal: boolean | null;
  readonly webTarget: BrowserLinkTarget | null;
  readonly localTarget: BrowserLinkTarget | null;
}

export type LinkSettingsDecision = BrowserLinkDecision | { kind: 'unavailable'; reason: 'authority' };

/** A captured page/host/connection lease, which must never revive after it changes. */
export interface LinkSettingsAuthority { assertCurrent(): void }

function observation(source: Source, response: unknown): LinkSettingObservation {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return { status: 'invalid' };
  const entry = response as Record<string, unknown>;
  if (typeof entry.exists !== 'boolean') return { status: 'invalid' };
  if (!entry.exists) return entry.value === undefined ? { status: 'missing' } : { status: 'invalid' };
  if (!Object.hasOwn(entry, 'value')) return { status: 'invalid' };
  if (source === 'legacy' && entry.value === null) return { status: 'value', value: null };
  const definition = preferenceDefinitions[source === 'local' ? localKey : webKey];
  return definition.valid(entry.value) ? { status: 'value', value: entry.value } : { status: 'invalid' };
}

function affected(event: WorkbenchEvent, key: string): boolean {
  const keys = Array.isArray(event.keys) ? event.keys : typeof event.key === 'string' ? [event.key] : [];
  return !keys.length || keys.includes(key);
}

/** Read-only observations of the settings and legacy atom used by message links. */
export class LinkSettings {
  private readonly client: WorkbenchClient;
  private readonly authority: LinkSettingsAuthority;
  private observations: Record<Source, LinkSettingObservation> = {
    web: { status: 'idle' }, local: { status: 'idle' }, legacy: { status: 'idle' },
  };
  private revisions: Record<Source, number> = { web: 0, local: 0, legacy: 0 };
  private status: LinkSettingsSnapshot['status'] = 'idle';
  private initialSettings = true;
  private listeners = new Set<() => void>();
  private unsubscribe: (() => void) | undefined;
  private snapshot = this.makeSnapshot();
  private readonly revokedSnapshot: LinkSettingsSnapshot = {
    status: 'revoked', web: { status: 'idle' }, local: { status: 'idle' }, legacy: { status: 'idle' },
    forceExternal: null, webTarget: null, localTarget: null,
  };

  constructor(client: WorkbenchClient, authority: LinkSettingsAuthority) {
    this.client = client; this.authority = authority;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): LinkSettingsSnapshot => {
    if (this.status === 'active' && !this.current()) this.retire(false);
    return this.status === 'revoked' ? this.revokedSnapshot : this.snapshot;
  };

  start(): void {
    if (this.status !== 'idle') return;
    this.status = 'active';
    if (!this.current()) { this.retire(); return; }
    this.unsubscribe = this.client.subscribe(this.onEvent);
    this.load(sources);
  }

  /** Explicitly retry observations in the background; resolving a click never reads. */
  retry(): void {
    if (this.status !== 'active') return;
    if (!this.current()) { this.retire(); return; }
    this.load(sources);
  }

  close(): void { this.retire(); }

  resolve(value: string, options: {
    browserPaneEnabled: boolean | null;
    openTarget?: BrowserLinkTarget;
    useExternalBrowser?: boolean;
  }): LinkSettingsDecision {
    const snapshot = this.getSnapshot();
    if (snapshot.status !== 'active') return { kind: 'unavailable', reason: 'authority' };
    return resolveBrowserLinkTarget(value, { ...options, webTarget: snapshot.webTarget, localTarget: snapshot.localTarget });
  }

  private current(): boolean {
    try { this.authority.assertCurrent(); return true; } catch { return false; }
  }

  private assertCurrent = (): void => {
    if (this.status !== 'active') throw new Error('Link settings authority has expired');
    this.authority.assertCurrent();
  };

  private retire(notify = true): void {
    if (this.status === 'revoked') return;
    this.status = 'revoked';
    for (const source of sources) this.revisions[source]++;
    this.unsubscribe?.(); this.unsubscribe = undefined;
    if (notify) this.emit();
  }

  private emit(): void { for (const listener of this.listeners) listener(); }

  private publish(): void {
    this.snapshot = this.makeSnapshot();
    this.emit();
  }

  private makeSnapshot(): LinkSettingsSnapshot {
    const { web, local, legacy } = this.observations;
    const ready = (entry: LinkSettingObservation) => entry.status === 'value' || entry.status === 'missing';
    const invalid = (entry: LinkSettingObservation) => entry.status === 'error' || entry.status === 'invalid';
    const settingsPending = web.status === 'loading' || local.status === 'loading';
    let forceExternal: boolean | null = null;
    if (this.status === 'active' && !invalid(web)) {
      if (this.initialSettings && settingsPending) {
        if (!invalid(local)) forceExternal = true;
      } else if (ready(web)) forceExternal = false;
    }
    const configured = web.status === 'value' ? web.value : null;
    const legacyDefault = legacy.status === 'value' ? legacy.value : null;
    const webKnown = web.status === 'value' || web.status === 'missing' && ready(legacy);
    const webTarget = forceExternal === true || webKnown
      ? effectiveWebLinkTarget({ forceExternal, configured, legacyDefault }) : null;
    const localTarget = local.status === 'value' ? local.value : local.status === 'missing'
      ? preferenceDefinitions[localKey].defaultValue : null;
    return { status: this.status, web, local, legacy, forceExternal, webTarget, localTarget };
  }

  private onEvent = (event: WorkbenchEvent): void => {
    if (!this.current() || event.type === 'page-resumed' ||
      event.type === 'connection-state' && event.state !== 'connected') { this.retire(); return; }
    const changed: Source[] = [];
    if (event.type === 'settings-changed') {
      if (affected(event, webKey)) changed.push('web');
      if (affected(event, localKey)) changed.push('local');
    }
    if ((event.type === 'persisted-atom-updated' || event.type === 'persisted-atoms-changed') && affected(event, legacyKey)) changed.push('legacy');
    if (changed.length) this.load(changed);
  };

  private load(changed: readonly Source[]): void {
    const requests = changed.map(source => ({ source, revision: ++this.revisions[source] }));
    for (const { source } of requests) this.observations[source] = { status: 'loading' };
    this.publish();
    for (const { source, revision } of requests) void this.read(source, revision);
  }

  private async read(source: Source, revision: number): Promise<void> {
    let result: LinkSettingObservation;
    try {
      this.assertCurrent();
      const endpoint = source === 'legacy' ? 'get-persisted-atom' : 'get-setting';
      const key = source === 'legacy' ? legacyKey : source === 'local' ? localKey : webKey;
      const value = await this.client.host(endpoint, { key }, { assertBeforeSend: this.assertCurrent });
      result = observation(source, value);
    } catch (error) {
      result = { status: 'error', message: error instanceof Error ? error.message : String(error) };
    }
    if (this.status !== 'active' || this.revisions[source] !== revision) return;
    if (!this.current()) { this.retire(); return; }
    this.observations[source] = result;
    if (this.observations.web.status !== 'loading' && this.observations.local.status !== 'loading') this.initialSettings = false;
    this.publish();
  }
}
