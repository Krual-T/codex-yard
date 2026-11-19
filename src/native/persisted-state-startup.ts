export interface HydrationOptions {
  responsePriority?: string;
  onHydrated(canWrite: boolean): void;
}
export type Hydrate = (options: HydrationOptions) => () => void;

interface PendingHydration {
  hydrate: Hydrate;
  handoff?: Hydrate;
  ready: boolean;
  canWrite: boolean;
  stop(): void;
  listener?: HydrationOptions['onHydrated'];
}

/** One page's original restoration, transferred to its original provider.
 * No saved-state copy or additional subscription survives the handoff. */
export class PersistedStateStartup {
  private pending?: PendingHydration;

  prepare(hydrate: Hydrate, commitPermission: (canWrite: boolean) => void) {
    if (this.pending) return;
    const pending: PendingHydration = { hydrate, ready: false, canWrite: false, stop() {} };
    this.pending = pending;
    let first = true;
    pending.handoff = options => {
      // Render only reads this function. Transfer ownership when React actually
      // commits the effect, so discarded/Suspense renders cannot orphan it.
      if (!first) return pending.hydrate(options);
      first = false;
      if (this.pending === pending) this.pending = undefined;
      pending.listener = options.onHydrated;
      if (pending.ready) options.onHydrated(pending.canWrite);
      return () => {
        pending.listener = undefined;
        pending.stop();
      };
    };
    try {
      pending.stop = hydrate({ onHydrated: canWrite => {
        pending.ready = true;
        pending.canWrite = canWrite;
        commitPermission(canWrite);
        pending.listener?.(canWrite);
      } });
    } catch (error) {
      this.pending = undefined;
      throw error;
    }
  }

  isHydrated(excludedKeys?: unknown): boolean {
    return excludedKeys === undefined && this.pending?.ready === true;
  }

  get(excludedKeys?: unknown): Hydrate | undefined {
    if (excludedKeys !== undefined || !this.pending) return;
    return this.pending.handoff;
  }

  dispose() {
    this.pending?.stop();
    this.pending = undefined;
  }
}
