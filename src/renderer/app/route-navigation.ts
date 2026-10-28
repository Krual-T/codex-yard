export interface NavigationOptions { replace?: boolean; delta?: number; state?: unknown }

/** Keep the committed URL visible while an asynchronous leave guard is open. */
export function createRouteNavigation(changed: () => void, requestLeave: () => Promise<boolean>) {
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
    history.go(target - position);
    await next;
    if (moving === next) moving = null;
  };
  const pop = () => {
    position = Number(history.state?.__yardIndex ?? 0);
    if (arrived) { const resolve = arrived; arrived = null; resolve(); return; }
    if (approvedPop) { approvedPop = false; commit(); return; }
    if (pending) { void moveTo(index); return; }
    const target = { url: location.href, state: history.state, index: position };
    pending = true;
    void (async () => {
      try {
        await moveTo(index);
        if (target.index === index) history.replaceState(committed.state, '', committed.url);
        if (disposed || !await requestLeave()) return;
        if (moving) await moving;
        await moveTo(target.index);
        if (disposed) return;
        if (target.index === index) history.replaceState(target.state, '', target.url);
        commit();
      } finally { pending = false; }
    })();
  };
  window.addEventListener('popstate', pop);
  return {
    async navigate(path: string, options: NavigationOptions = {}): Promise<boolean> {
      if (pending || disposed) return false;
      pending = true;
      try {
        if (!await requestLeave() || disposed) return false;
        if (options.delta) { approvedPop = true; history.go(options.delta); return true; }
        if (!options.replace) index++;
        const state = { __yardIndex: index, __yardState: options.state ?? null };
        if (options.replace) history.replaceState(state, '', path); else history.pushState(state, '', path);
        position = index; commit(); return true;
      } finally { pending = false; }
    },
    dispose() { disposed = true; arrived?.(); arrived = null; window.removeEventListener('popstate', pop); },
  };
}
