// These selectors are the composer boundary in the pinned 26.1013.40934 UI.
const composerInput = '[data-codex-composer="true"], textarea[id^="pending-"]';
const composerRoot = '[data-codex-composer-root]';

export function installMobileInput(): void {
  const touch = matchMedia('(pointer: coarse)');
  let editingRoot: Element | null = null;
  const interaction = (event: Event) => {
    const target = event.target instanceof Element ? event.target : null;
    editingRoot = target?.closest(composerRoot) ?? target?.closest(composerInput) ?? null;
  };
  document.addEventListener('pointerdown', interaction, { capture: true, passive: true });
  document.addEventListener('keydown', interaction, true);
  document.addEventListener('focusin', event => {
    if (event.target instanceof Element && event.target.matches(composerInput)) interaction(event);
  });

  // Stop the desktop renderer's mount/navigation focus before it can open the
  // software keyboard. Native tap/Tab focus and focus within an active composer
  // still work; other controls, dialogs and editors keep their own focus policy.
  const focus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (options?: FocusOptions): void {
    if (touch.matches && this.matches(composerInput) && !editingRoot?.contains(this)) return;
    focus.call(this, options);
  };

  const viewport = window.visualViewport;
  if (!viewport) return;
  const html = document.documentElement;
  let frame = 0;
  const update = () => {
    frame = 0;
    // Pinch zoom should magnify/pan the page without shrinking its layout.
    const fit = touch.matches && viewport.scale === 1;
    html.toggleAttribute('data-workbench-mobile-viewport', fit);
    if (fit) {
      html.style.setProperty('--workbench-viewport-height', `${viewport.height}px`);
      html.style.setProperty('--workbench-viewport-top', `${viewport.offsetTop}px`);
    } else {
      html.style.removeProperty('--workbench-viewport-height');
      html.style.removeProperty('--workbench-viewport-top');
    }
  };
  const schedule = () => { frame ||= requestAnimationFrame(update); };
  viewport.addEventListener('resize', schedule, { passive: true });
  viewport.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  touch.addEventListener('change', schedule);
  update();
}
