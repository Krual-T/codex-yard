/** Commit the sidebar's final layout once, then move its retained surface and
 * the workspace with compositor animations. Text is never scaled. */
export function installSidebarMotion() {
  const active = new Set<Animation>();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let inheritedInert: boolean | undefined;
  let finishInert: (() => void) | undefined;
  let pending: symbol | undefined;
  const cancel = () => {
    inheritedInert = undefined; finishInert = undefined; pending = undefined;
    for (const animation of active) animation.cancel();
    active.clear();
  };
  const settle = () => { const finish = finishInert; cancel(); finish?.(); };
  const focusTrigger = () => Array.from(document.querySelectorAll<HTMLElement>('[data-app-shell-sidebar-trigger]'))
    .find(element => !element.closest('.app-shell-left-panel, [data-testid="app-shell-floating-left-panel"]')
      && !element.matches(':disabled') && element.checkVisibility({ visibilityProperty: true }))?.focus({ preventScroll: true });
  // aria-hidden excludes the closing tree immediately. Block interaction until
  // the inherited inert update follows the transition; opening unlocks at rest.
  const guardClosedPanel = (event: Event) => {
    if (!(event.target instanceof Element) || !event.target.closest('.app-shell-left-panel[aria-hidden="true"]')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.type === 'focusin') focusTrigger();
  };
  for (const type of ['pointerdown', 'click', 'contextmenu', 'focusin']) document.addEventListener(type, guardClosedPanel, true);
  const animate = (element: HTMLElement, frames: Keyframe[], duration: number, startTime: number) => {
    const animation = element.animate(frames, { duration, easing: 'cubic-bezier(0.2, 0, 0.2, 1)', fill: 'both' });
    // Assign the clock now instead of waiting for the pending play task to be
    // resolved on another rendering frame. DocumentTimeline's origin is zero.
    animation.startTime = startTime;
    animation.id = 'yard-sidebar-transition';
    active.add(animation);
    void animation.finished.then(() => {
      active.delete(animation); animation.cancel();
      if (!active.size) finishInert?.();
    }, () => { active.delete(animation); });
  };
  const transition = (open: boolean, commit: () => void, reduce: boolean,
    afterLayout: (callback: () => void) => void): boolean => {
    const slot = document.querySelector<HTMLElement>('[data-yard-sidebar-slot]');
    const panel = slot?.querySelector<HTMLElement>('.app-shell-left-panel');
    const row = slot?.closest('[data-app-shell-workspace-row]');
    // The surface also contains fixed window controls. Transform only its
    // content viewport, so those controls keep their viewport coordinates.
    const workspace = row?.querySelector<HTMLElement>('[data-app-shell-main-content-layout]');
    if (!slot || !panel || !workspace || typeof panel.animate !== 'function') return false;
    if (!pending && !active.size && row?.closest('[data-app-shell-frame]')?.getAttribute('data-app-shell-sidebar-open') === String(open)) { commit(); return true; }
    // Read the current visual positions before canceling an interrupted
    // transition. A reversal starts exactly where the previous one reached.
    // Centered chat content moves by half the sidebar width. Track a content
    // anchor so committing the narrower viewport does not jump its text.
    const anchor = workspace.querySelector<HTMLElement>('[contenteditable="true"][role="textbox"]')
      ?? workspace.querySelector<HTMLElement>('h1, h2, p') ?? workspace;
    const panelBefore = panel.getBoundingClientRect(), anchorBefore = anchor.getBoundingClientRect();
    const panelWidth = panel.offsetWidth;
    const tabs = row?.querySelector<HTMLElement>('div[data-app-shell-tab-row]');
    const tabsBefore = tabs?.getBoundingClientRect();
    const opacity = getComputedStyle(panel).opacity;
    const wasInert = panel.inert;
    cancel();
    const token = pending = Symbol();
    // Preserve the previous inherited value through the FLIP layout
    // commit and measurement. Changing inert here would restyle the entire retained tree.
    inheritedInert = wasInert;
    finishInert = () => {
      inheritedInert = undefined; finishInert = undefined;
      if (panel.isConnected) panel.inert = panel.getAttribute('aria-hidden') === 'true';
    };
    if (!open && panel.contains(document.activeElement)) focusTrigger();
    commit();
    if (!panel.isConnected || !workspace.isConnected) { settle(); return true; }
    // The pinned motion renderer normally writes this value on its next frame.
    // Apply the same final width now so FLIP measures the committed layout.
    slot.style.width = `${open ? panelWidth : 0}px`;
    if (reduce || reducedMotion.matches) { settle(); return true; }
    // Derived native motion values (including the Summary/Outputs content
    // offset) render on its frame scheduler. Measure after those writes, still
    // before paint, so the animation targets the actual final content position.
    afterLayout(() => {
      if (pending !== token) return;
      if (!panel.isConnected || !workspace.isConnected) { settle(); return; }
      const slotAfter = slot.getBoundingClientRect(), panelAfter = panel.getBoundingClientRect();
      const workspaceAfter = workspace.getBoundingClientRect();
      const panelScale = panelAfter.width / panelWidth || 1;
      const workspaceScale = workspaceAfter.width / workspace.offsetWidth || 1;
      // Complete the read phase before creating any animations. Reading the
      // content/tabs after animate() would flush their newly invalidated styles.
      const anchorAfter = anchor.isConnected ? anchor.getBoundingClientRect() : workspaceAfter;
      const tabsAfter = tabs?.isConnected ? tabs.getBoundingClientRect() : undefined;
      const tabsWidth = tabsAfter ? tabs!.offsetWidth : 0;
      pending = undefined;
      const duration = open ? 240 : 200;
      const startTime = performance.now();
      animate(panel, [
        { transform: `translateX(${(panelBefore.left - slotAfter.left) / panelScale}px)`, opacity },
        { transform: open ? 'translateX(0)' : 'translateX(-100%)', opacity: open ? 1 : 0 },
      ], duration, startTime);
      const offset = (anchorBefore.left - anchorAfter.left) / workspaceScale;
      if (Math.abs(offset) > 0.5) animate(workspace, [{ transform: `translateX(${offset}px)` }, { transform: 'translateX(0)' }], duration, startTime);
      if (tabs && tabsBefore && tabsAfter) {
        const scale = tabsAfter.width / tabsWidth || 1, delta = (tabsBefore.left - tabsAfter.left) / scale;
        if (Math.abs(delta) > 0.5) animate(tabs, [{ transform: `translateX(${delta}px)` }, { transform: 'translateX(0)' }], duration, startTime);
      }
      // Finish the inherited, nonvisual subtree update after the surfaces stop
      // moving. Reversals keep the currently installed value until they settle.
      if (!active.size) finishInert?.();
    });
    return true;
  };
  Object.assign(window, { workbenchAnimateSidebar: Object.assign(transition, {
    inert: (closed: boolean) => inheritedInert ?? closed,
    synchronizing: () => pending !== undefined,
  }) });
  window.addEventListener('resize', settle);
  reducedMotion.addEventListener('change', settle);
  window.addEventListener('pagehide', settle);
}
