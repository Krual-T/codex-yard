export interface NavigationOptions { replace?: boolean; delta?: number; state?: unknown }

/** Keep the committed URL visible while an asynchronous leave guard is open. */
export function createRouteNavigation(changed: () => void, requestLeave: () => Promise<boolean>, settled?: (committed: boolean, error?: unknown) => void) {
  let index = Number(history.state?.__yardIndex ?? 0), position = index;
  let committed = { url: location.href, state: history.state };
  let pending = false, approvedPop = false, disposed = false;
  let moving: Promise<void> | null = null, arrived: (() => void) | null = null;
  if (!Object.hasOwn(history.state ?? {}, '__yardIndex')) {
    history.replaceState({ __yardIndex: index, __yardState: history.state }, '', location.href);
    committed.state = history.state;
  }
  const commit = () => {
    index = position; committed = { url: location.href, state: history.state }; changed();
  };
  const moveTo = async (target: number): Promise<void> => {
    if (moving) await moving;
    if (disposed || target === position) return;
    const next = new Promise<void>(resolve => { arrived = resolve; });
    moving = next;
    try { history.go(target - position); }
    catch (error) { arrived = null; moving = null; throw error; }
    await next;
    if (moving === next) moving = null;
  };
  const pop = () => {
    position = Number(history.state?.__yardIndex ?? 0);
    if (arrived) { const resolve = arrived; arrived = null; resolve(); return; }
    if (approvedPop) {
      approvedPop = false;
      try { commit(); } finally { settled?.(true); }
      return;
    }
    if (pending) { void moveTo(index); return; }
    const target = { url: location.href, state: history.state, index: position };
    pending = true;
    void (async () => {
      let didCommit = false, failure: unknown;
      try {
        await moveTo(index);
        if (target.index === index) history.replaceState(committed.state, '', committed.url);
        if (disposed || !await requestLeave()) return;
        if (moving) await moving;
        await moveTo(target.index);
        if (disposed) return;
        if (target.index === index) history.replaceState(target.state, '', target.url);
        commit(); didCommit = true;
      } catch (error) { failure = error; }
      finally { pending = false; settled?.(didCommit, failure); }
    })();
  };
  window.addEventListener('popstate', pop);
  return {
    /** Update facts about this same page without leaving or draining its editor. */
    replaceCurrentURL(path: string): boolean {
      if (pending || disposed || moving) return false;
      const target = new URL(path, committed.url), previous = new URL(committed.url);
      if (target.origin !== previous.origin || target.pathname !== previous.pathname) return false;
      history.replaceState(committed.state, '', target.href);
      committed = { url: location.href, state: history.state };
      return true;
    },
    async navigate(path: string, options: NavigationOptions = {}): Promise<boolean> {
      if (pending || disposed) return false;
      pending = true;
      let didCommit = false, failure: unknown;
      try {
        if (!await requestLeave() || disposed) return false;
        if (options.delta && index + options.delta >= 0) { approvedPop = true; history.go(options.delta); return true; }
        // A directly opened nested settings page has no earlier Yard entry.
        const replace = options.replace || !!options.delta;
        const nextIndex = replace ? index : index + 1;
        const state = { __yardIndex: nextIndex, __yardState: options.state ?? null };
        if (replace) history.replaceState(state, '', path); else history.pushState(state, '', path);
        position = nextIndex; commit(); didCommit = true; return true;
      } catch (error) { approvedPop = false; failure = error; return false; }
      finally { pending = false; if (!approvedPop) settled?.(didCommit, failure); }
    },
    dispose() { disposed = true; arrived?.(); arrived = null; window.removeEventListener('popstate', pop); },
  };
}
