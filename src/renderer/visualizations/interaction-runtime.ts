export type VisualizationInteraction =
  | { type: 'hover'; isHovering: boolean; pointerType?: 'touch' }
  | { type: 'input'; method: 'pointer' | 'keyboard' | 'keyboard-navigation' }
  | { type: 'click'; isInteractive: boolean };

/** Report only bounded interaction metadata from actual frame input. */
export function installVisualizationInteractions(options: {
  send(event: VisualizationInteraction | { type: 'preview-key'; key: 'ArrowLeft' | 'ArrowRight' | 'Escape' }): void;
  isFullscreen(): boolean;
  isAnnotating(): boolean;
  cancelAnnotation(): void;
}) {
  const abort = new AbortController();
  const { signal } = abort;
  let hovering = false, touch = false;
  const bubbledClicks = new WeakSet<Event>();
  const interactive = 'button,input,select,textarea,label,summary,a[href],audio[controls],video[controls],[onclick],[data-visualization-interactive],[contenteditable]:not([contenteditable="false"]),[role~="button"],[role~="checkbox"],[role~="combobox"],[role~="gridcell"],[role~="link"],[role~="listbox"],[role~="menuitem"],[role~="menuitemcheckbox"],[role~="menuitemradio"],[role~="option"],[role~="radio"],[role~="scrollbar"],[role~="searchbox"],[role~="slider"],[role~="spinbutton"],[role~="switch"],[role~="tab"],[role~="textbox"],[role~="treeitem"]';
  function hover(next: boolean, nextTouch = false) {
    if (next === hovering && nextTouch === touch) return;
    hovering = next; touch = nextTouch;
    options.send({ type: 'hover', isHovering: hovering, ...(touch ? { pointerType: 'touch' as const } : {}) });
  }
  window.addEventListener('pointerover', event => {
    if (event.isTrusted) hover(event.pointerType !== 'touch', event.pointerType === 'touch');
  }, { capture: true, signal });
  window.addEventListener('pointermove', event => {
    if (event.isTrusted && event.pointerType !== 'touch' && event.clientX >= 0 && event.clientY >= 0 &&
        event.clientX < window.innerWidth && event.clientY < window.innerHeight) hover(true);
  }, { capture: true, signal });
  window.addEventListener('pointerout', event => {
    if (event.isTrusted && event.pointerType !== 'touch' && event.relatedTarget === null) hover(false);
  }, { capture: true, signal });
  window.addEventListener('pointerdown', event => {
    if (event.isTrusted) options.send({ type: 'input', method: 'pointer' });
  }, { capture: true, signal });
  window.addEventListener('keydown', event => {
    if (!event.isTrusted || event.isComposing || event.key === 'Shift' || event.altKey || event.ctrlKey || event.metaKey) return;
    options.send({ type: 'input', method: ['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) ? 'keyboard-navigation' : 'keyboard' });
  }, { capture: true, signal });
  window.addEventListener('click', event => { if (event.isTrusted) bubbledClicks.add(event); }, { signal });
  window.addEventListener('click', event => {
    if (!event.isTrusted) return;
    const elements = event.composedPath().filter((target): target is Element => target instanceof Element);
    const isInteractive = elements.some(element => element.matches(interactive) || (element instanceof HTMLElement && element.hasAttribute('tabindex') && element.tabIndex >= 0)) ||
      (elements[0] !== undefined && getComputedStyle(elements[0]).cursor === 'pointer');
    window.setTimeout(() => {
      if (!signal.aborted) options.send({ type: 'click', isInteractive: isInteractive || event.defaultPrevented || (event.bubbles && !bubbledClicks.has(event)) });
    }, 0);
  }, { capture: true, signal });
  window.addEventListener('keydown', event => {
    if (!event.isTrusted || event.isComposing || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'Escape' && options.isAnnotating()) {
      event.preventDefault(); options.cancelAnnotation(); return;
    }
    if (!options.isFullscreen() || !['ArrowLeft', 'ArrowRight', 'Escape'].includes(event.key)) return;
    const target = event.composedPath().find((value): value is HTMLElement => value instanceof HTMLElement);
    const editable = target?.closest('[contenteditable]');
    const editing = target && (target.isContentEditable || (editable && editable.getAttribute('contenteditable') !== 'false') ||
      target.closest('input,textarea,select,[role="slider"],[role="spinbutton"],[role="combobox"],[role="listbox"],[role="grid"],[role="tree"],[role="tablist"],[role="menu"]'));
    if (event.key !== 'Escape' && editing) return;
    const key = event.key as 'ArrowLeft' | 'ArrowRight' | 'Escape';
    window.setTimeout(() => { if (!signal.aborted && !event.defaultPrevented && options.isFullscreen()) options.send({ type: 'preview-key', key }); }, 0);
  }, { signal });
  return {
    resetHover() { hovering = false; touch = false; },
    dispose() { abort.abort(); },
  };
}
