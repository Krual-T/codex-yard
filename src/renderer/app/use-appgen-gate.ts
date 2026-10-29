import { StatsigClient } from '@statsig/js-client';
import type { StatsigStorageProvider } from '../../native/statsig-storage.ts';
import { openStatsigStorage } from '../../native/statsig-storage.ts';
import { BrowserHttpFetch } from '../../native/browser-http-fetch.ts';
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { WorkbenchEvent } from '../workbench-contract.ts';
import type { BrowserWorkbenchClient } from './client.ts';

const sdkKey = 'client-sYWqzCYMRkUg4DqqiZcR5DGTNl2iD7zNJY0HoeDLzxR';
const gateName = '637432221';
const initializeUrl = 'https://ab.chatgpt.com/v1/initialize';

export interface AppgenGate {
  readonly enabled: boolean | undefined;
  readonly sourceKey: string;
  /** Check the authority captured with this particular evaluation. */
  assertCurrent(): void;
}

type Daemon = ReturnType<BrowserWorkbenchClient['captureDaemonConnection']>;
interface Scope {
  key: string;
  active: boolean;
  ready: boolean;
  daemon?: Daemon;
  sdk?: StatsigClient;
  requests: Set<string>;
}

let storagePromise: Promise<StatsigStorageProvider> | undefined;
function currentStorage(): Promise<StatsigStorageProvider> {
  return storagePromise ??= openStatsigStorage().then(storage => {
    // Stable ID belongs to this browser profile. Evaluations must come from a
    // full current network response, never from a prior cached profile value.
    const cachedEvaluation = (key: string) => key.startsWith('statsig.cached.') || key.startsWith('statsig.last_modified_time.');
    return { ...storage,
      getItem: key => cachedEvaluation(key) ? null : storage.getItem(key),
      setItem: (key, value) => { if (!cachedEvaluation(key)) storage.setItem(key, value); },
      removeItem: key => { if (!cachedEvaluation(key)) storage.removeItem(key); },
      getAllKeys: () => storage.getAllKeys().filter(key => !cachedEvaluation(key)),
    };
  }).catch(error => { storagePromise = undefined; throw error; });
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

class AppgenGateSource {
  private readonly client: BrowserWorkbenchClient;
  private readonly hostId: string;
  private readonly http = new BrowserHttpFetch();
  private readonly listeners = new Set<() => void>();
  private scope: Scope | undefined;
  private unsubscribe: (() => void) | undefined;
  private running = false;
  private snapshot: AppgenGate = this.emptySnapshot();

  constructor(client: BrowserWorkbenchClient, hostId: string) {
    this.client = client;
    this.hostId = hostId;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): AppgenGate => this.snapshot;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.unsubscribe = this.client.subscribe(this.onEvent);
    window.addEventListener('languagechange', this.languageChanged);
    this.restart();
  }

  stop(): void {
    this.running = false;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    window.removeEventListener('languagechange', this.languageChanged);
    this.retire();
  }

  private emptySnapshot(): AppgenGate {
    return { enabled: undefined, sourceKey: crypto.randomUUID(),
      assertCurrent() { throw new Error('The Sites configuration is not current.'); } };
  }

  private retire(): void {
    const scope = this.scope;
    this.scope = undefined;
    if (!scope) return;
    scope.active = false;
    for (const id of scope.requests) this.http.cancel(id);
    if (scope.sdk) void scope.sdk.shutdown().catch(() => {});
  }

  private invalidate(): void {
    this.retire();
    this.snapshot = this.emptySnapshot();
    for (const listener of this.listeners) listener();
  }

  private restart(): void {
    if (!this.running) return;
    this.retire();
    const scope: Scope = { key: crypto.randomUUID(), active: true, ready: false, requests: new Set() };
    this.scope = scope;
    this.publish(scope, undefined);
    void this.read(scope);
  }

  private publish(scope: Scope, enabled: boolean | undefined): void {
    this.snapshot = { enabled, sourceKey: scope.key, assertCurrent: () => {
      this.assertScope(scope);
      if (!scope.ready) throw new Error('The Sites configuration is not current.');
    } };
    for (const listener of this.listeners) listener();
  }

  private assertScope(scope: Scope): void {
    if (!this.running || !scope.active || this.scope !== scope) throw new Error('The Sites configuration authority has changed.');
    scope.daemon?.assertOriginal();
  }

  private languageChanged = (): void => { this.restart(); };

  private onEvent = (event: WorkbenchEvent): void => {
    if (event.type === 'connection-state') {
      if (event.state === 'connected') this.restart(); else this.invalidate();
    } else if (event.type === 'page-resumed') {
      this.restart();
    } else if (event.type === 'codex-app-server-connection-changed' && event.hostId === this.hostId) {
      if (event.state === 'connected') this.restart(); else this.invalidate();
    } else if (event.type === 'mcp-notification' && event.hostId === this.hostId &&
      (event.method === 'account/updated' || event.method === 'account/login/completed')) {
      this.restart();
    }
  };

  private async read(scope: Scope): Promise<void> {
    try {
      await this.client.connect();
      this.assertScope(scope);
      try {
        scope.daemon = this.client.captureDaemonConnection(this.hostId);
      } catch {
        // Establish the selected daemon without using this unscoped read as
        // identity evidence. Its connection notification starts a fresh read.
        await this.client.rpc('account/read', { refreshToken: false }, this.hostId);
        this.assertScope(scope);
        this.client.captureDaemonConnection(this.hostId);
        this.restart();
        return;
      }
      const check = () => this.assertScope(scope);
      const account = object(await this.client.rpc('account/read', { refreshToken: false }, this.hostId,
        { daemonConnectionGeneration: scope.daemon.generation, assertBeforeSend: check }));
      check();
      if (!account || !Object.hasOwn(account, 'account') || typeof account.requiresOpenaiAuth !== 'boolean') return;
      const identity = object(account.account);
      if (account.account !== null && identity?.type !== 'apiKey' && identity?.type !== 'chatgpt') return;
      const os = object(await this.client.host('os-info', {}, { assertBeforeSend: check }));
      check();
      if (os?.platform !== 'linux' || os.osVersion !== 'Web') return;
      const storage = await currentStorage();
      check();
      const sdk = new StatsigClient(sdkKey, {}, {
        storageProvider: storage,
        loggingEnabled: 'disabled',
        disableStatsigEncoding: true,
        networkConfig: {
          initializeUrl,
          initializeFallbackUrls: [],
          networkTimeoutMs: 10_000,
          networkOverrideFunc: async (url, args) => {
            check();
            const target = new URL(url);
            if (target.origin !== 'https://ab.chatgpt.com' || target.pathname !== '/v1/initialize' || args.method !== 'POST') {
              throw new Error('Unexpected configuration request');
            }
            if (typeof args.body !== 'string') throw new Error('Unsupported configuration request body');
            const id = crypto.randomUUID();
            const abort = () => this.http.cancel(id);
            const headers: Record<string, string> = {};
            new Headers(args.headers).forEach((value, name) => {
              if (/^(content-type|content-encoding|statsig-.+)$/i.test(name)) headers[name] = value;
            });
            if (args.signal?.aborted) throw new Error('Configuration request aborted');
            scope.requests.add(id);
            args.signal?.addEventListener('abort', abort, { once: true });
            const timer = setTimeout(abort, 10_000);
            try {
              const result = await this.http.fetch(id, { url, method: 'POST', headers, body: args.body });
              check();
              if (!('response' in result)) throw new Error('Configuration request failed');
              const response = result.response;
              const body = response.status === 200 ? await response.arrayBuffer() : null;
              if (response.status !== 200) await response.body?.cancel();
              check();
              return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
            } finally {
              clearTimeout(timer);
              scope.requests.delete(id);
              args.signal?.removeEventListener('abort', abort);
            }
          },
        },
      });
      scope.sdk = sdk;
      const stableId = sdk.getContext().stableID;
      if (!stableId) return;
      const email = identity?.type === 'chatgpt' && typeof identity.email === 'string' ? identity.email : undefined;
      const plan = identity?.type === 'chatgpt' && typeof identity.planType === 'string' ? identity.planType : undefined;
      sdk.updateUserSync({ ...(identity?.type === 'apiKey' ? { userID: `ua-${stableId}` } : {}),
        ...(email === undefined ? {} : { email }), locale: navigator.language,
        customIDs: { stableID: stableId, source_surface_stable_id: stableId },
        custom: { auth_status: identity?.type === 'chatgpt' ? 'logged_in' : 'logged_out',
          ...(identity?.type === 'chatgpt' ? { auth_method: 'chatgpt' } : identity?.type === 'apiKey' ? { auth_method: 'apikey' } : {}),
          ...(plan === undefined ? {} : { plan_type: plan }), is_openai_internal: email?.endsWith('@openai.com') ?? false,
          brand_name: 'chatgpt', systemName: 'Linux', systemVersion: 'Web' },
      }, { disableBackgroundCacheRefresh: true });
      const initialized = await sdk.initializeAsync();
      check();
      const gate = sdk.getFeatureGate(gateName, { disableExposureLog: true });
      if (!initialized.success || initialized.source !== 'Network' || gate.details.reason !== 'Network:Recognized'
        || typeof gate.__evaluation?.value !== 'boolean' || typeof gate.value !== 'boolean'
        || gate.details.warnings?.includes('PartialUserMatch') || gate.details.warnings?.includes('StableIDMismatch')) return;
      scope.ready = true;
      this.publish(scope, gate.value);
    } catch {
      // An unavailable or stale source is not a false gate evaluation.
    }
  }
}

/** A read-only evaluation tied to the selected host and its observed account. */
export function useAppgenGate(client: BrowserWorkbenchClient, hostId: string): AppgenGate {
  const owner = useRef<{ client: BrowserWorkbenchClient; hostId: string; source: AppgenGateSource } | null>(null);
  if (!owner.current || owner.current.client !== client || owner.current.hostId !== hostId) {
    owner.current?.source.stop();
    owner.current = { client, hostId, source: new AppgenGateSource(client, hostId) };
  }
  const source = owner.current.source;
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  useLayoutEffect(() => { source.start(); return () => source.stop(); }, [source]);
  return snapshot;
}
