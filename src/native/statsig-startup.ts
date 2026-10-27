export interface StatsigStartupUser {
  [key: string]: unknown;
}

export interface StatsigConfigurationSnapshot {
  rendererVersion: string;
  capturedAt: string;
  user: StatsigStartupUser;
  data: string;
}

export interface StatsigStartupResult {
  success: boolean;
  source: string;
  error?: unknown;
  warnings?: string[];
}

export interface StatsigStartupClient {
  loadingStatus: string;
  dataAdapter: {
    getDataSync(user: StatsigStartupUser): {
      data: string;
      fullUserHash?: string | null;
    } | null;
    setDataLegacy(data: string, user: StatsigStartupUser): void;
  };
  getContext(): {
    user: StatsigStartupUser;
    options: { disableStorage?: boolean };
  };
  initializeAsync(options?: unknown): Promise<StatsigStartupResult>;
  initializeSync(options: { disableBackgroundCacheRefresh: boolean }): StatsigStartupResult;
  refreshValuesAsync(): Promise<StatsigStartupResult>;
}

export interface StatsigStartupConstructor {
  prototype: StatsigStartupClient;
}

export interface StatsigStartupCore {
  Storage: { getProviderName(): string };
  _getFullUserHash(user: StatsigStartupUser): string | null;
  Log: { error(...values: unknown[]): void };
}

/** Adapt the fixed renderer's async hook to cached or locally bootstrapped startup. */
export function installStatsigStartup(Client: StatsigStartupConstructor, core: StatsigStartupCore,
  loadSnapshot?: () => Promise<StatsigConfigurationSnapshot | null>): void {
  const initializeAsync = Client.prototype.initializeAsync;
  const initializations = new WeakMap<StatsigStartupClient, Promise<StatsigStartupResult>>();
  Client.prototype.initializeAsync = function (options) {
    const pending = initializations.get(this);
    if (pending) return pending;
    if (this.loadingStatus !== 'Uninitialized') {
      return initializeAsync.call(this, options);
    }
    performance.mark('workbench-config-initialize');

    const { user, options: clientOptions } = this.getContext();
    if (clientOptions.disableStorage || core.Storage.getProviderName() === 'InMemory') {
      return initializeAsync.call(this, options);
    }
    // The SDK checks stable ID and user cache key. Also require the complete
    // targeting user to match; the SDK's normal key omits fields such as plan.
    const cached = this.dataAdapter.getDataSync(user);
    if (!cached?.fullUserHash || cached.fullUserHash !== core._getFullUserHash(user)) {
      performance.mark('workbench-config-cache-miss');
      return bootstrap.call(this);
    }
    try {
      if (JSON.parse(cached.data)?.has_updates !== true) return bootstrap.call(this);
    } catch {
      return bootstrap.call(this);
    }

    const initialized = this.initializeSync({ disableBackgroundCacheRefresh: true });
    if (!initialized.success || initialized.warnings?.includes('NoCachedValues')) {
      return initializeAsync.call(this, options);
    }
    const result = Promise.resolve(initialized);
    performance.mark('workbench-config-cache-ready');
    initializations.set(this, result);
    refresh.call(this);
    return result;

    function bootstrap(this: StatsigStartupClient): Promise<StatsigStartupResult> {
      if (!loadSnapshot) return initializeAsync.call(this, options);
      const result = (async () => {
        let snapshot: StatsigConfigurationSnapshot | null;
        try { snapshot = await loadSnapshot(); }
        catch (error) {
          core.Log.error('Local configuration snapshot could not be loaded', error);
          return initializeAsync.call(this, options);
        }
        const current = this.getContext();
        if (!snapshot || !matchesAnonymousProfile(snapshot, user, core) || current.options.disableStorage ||
            core._getFullUserHash(current.user) !== core._getFullUserHash(user)) return initializeAsync.call(this, options);

        // Bootstrap the shared anonymous baseline under the current browser's
        // identity. The captured response remains unchanged and separately scoped.
        this.dataAdapter.setDataLegacy(snapshot.data, user);
        const initialized = this.initializeSync({ disableBackgroundCacheRefresh: true });
        if (!initialized.success || initialized.warnings?.includes('NoCachedValues')) {
          return initializeAsync.call(this, options);
        }
        performance.mark('workbench-config-snapshot-ready');
        refresh.call(this);
        return initialized;
      })();
      initializations.set(this, result);
      return result;
    }

    function refresh(this: StatsigStartupClient) {
      // refreshValuesAsync applies new evaluations and emits values_updated. The
      // default initializeSync background job only refreshes the adapter's cache.
      void this.refreshValuesAsync().then(update => {
        if (!update.success) core.Log.error('Statsig background configuration refresh failed', update.error);
      }, error => core.Log.error('Statsig background configuration refresh failed', error));
    }
  };
}

function matchesAnonymousProfile(snapshot: StatsigConfigurationSnapshot, user: StatsigStartupUser, core: StatsigStartupCore): boolean {
  function profile(value: StatsigStartupUser): StatsigStartupUser | null {
    const { customIDs, ...targeting } = value;
    const custom = value.custom as Record<string, unknown> | undefined;
    if (value.userID || custom?.auth_status !== 'logged_out' || !customIDs || typeof customIDs !== 'object') return null;
    if (Object.keys(customIDs).some(key => !['stableID', 'source_surface_stable_id'].includes(key))) return null;
    return targeting;
  }
  const captured = profile(snapshot.user), current = profile(user);
  return snapshot.rendererVersion === user.appVersion && captured !== null && current !== null &&
    core._getFullUserHash(captured) === core._getFullUserHash(current);
}
