import { validControlValue, type AnnotationChange, type AnnotationControl, type ControlValue } from './annotations.ts';

type Binding = { object: Record<string, unknown>; property: string; control: AnnotationControl };
type Panel = { id: string; targetId: string; container: Element; onChange?: () => void; bindings: Map<string, Binding>; accepted: AnnotationControl[]; disposed: boolean; pending: Promise<void>; visible: boolean; nextControl: number };
type Bridge = { request(payload: unknown): Promise<unknown> };

/** Installs the object-binding API inside the opaque visualization frame. */
export function installTweak(bridge: Bridge) {
  const panels = new Map<string, Panel>();
  const targets = new WeakMap<Element, string>();
  const previews = new Map<Binding, ControlValue>();
  let nextPanel = 0;
  let nextTarget = 0;
  let stopped = false;
  let observer: MutationObserver | null = null;
  let variants = '[]';
  let refresh = () => {};

  function snapshot(panel: Panel) {
    const target = panel.container;
    if (!target.isConnected) throw new Error('Tweak container is unavailable');
    const rect = target.getBoundingClientRect();
    const selector = target.id ? `#${CSS.escape(target.id)}` : target.localName;
    return { id: panel.targetId, label: (target.getAttribute('aria-label') || target.getAttribute('title') || target.id || target.localName).replace(/\s+/g, ' ').trim().slice(0, 80) || target.localName,
      selector: selector.slice(0, 1024), tagName: target.localName, visible: !target.closest('.viz-carousel > [data-variant][hidden]'),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
  }
  function set(binding: Binding, value: ControlValue, panel: Panel) {
    if (panel.disposed || !panel.container.isConnected || binding.object[binding.property] === value) return;
    try { binding.object[binding.property] = value; panel.onChange?.(); }
    catch (error) { window.dispatchEvent(new ErrorEvent('error', { message: error instanceof Error ? error.message : String(error), error })); }
  }
  function synchronize(changes: AnnotationChange[]) {
    const desired = new Map<Binding, { value: ControlValue; panel: Panel }>();
    const owners = new Map<Element, Panel>();
    for (const panel of panels.values()) if (!panel.disposed && panel.accepted.length && panel.container.isConnected) owners.set(panel.container, panel);
    for (const change of changes) {
      const panel = panels.get(change.registrationId);
      if (!panel || panel.disposed || panel.targetId !== change.targetId || owners.get(panel.container) !== panel) continue;
      for (const edit of change.annotationControlChanges) {
        const binding = panel.bindings.get(edit.callback);
        const control = panel.accepted.find(item => item.callback === edit.callback);
        if (binding && control && edit.previousValue === control.currentValue && edit.value !== control.currentValue && validControlValue(control, edit.value)) desired.set(binding, { value: edit.value, panel });
      }
    }
    for (const binding of [...previews.keys()]) {
      if (desired.has(binding)) continue;
      const owner = [...panels.values()].find(panel => panel.bindings.get(binding.control.callback) === binding);
      previews.delete(binding);
      if (owner) set(binding, binding.control.currentValue, owner);
    }
    for (const [binding, change] of desired) {
      if (change.panel.disposed) continue;
      if (previews.get(binding) === change.value) continue;
      previews.set(binding, change.value);
      set(binding, change.value, change.panel);
    }
  }
  function disposePanel(panel: Panel) {
    if (panel.disposed) return;
    for (const binding of panel.bindings.values()) if (previews.delete(binding)) set(binding, binding.control.currentValue, panel);
    panel.disposed = true;
    panels.delete(panel.id);
    void bridge.request({ type: 'dispose', registrationId: panel.id }).catch(() => {});
  }

  class Tweak {
    #panel: Panel;
    constructor(options: { container: Element; onChange?: () => void }) {
      if (!(options?.container instanceof Element) || options.container.ownerDocument !== document) throw new TypeError('Tweak needs a component element as its container');
      let targetId = targets.get(options.container);
      if (!targetId) { targetId = String(++nextTarget); targets.set(options.container, targetId); }
      this.#panel = { id: `tweak-${++nextPanel}`, targetId, container: options.container, onChange: options.onChange, bindings: new Map(), accepted: [], disposed: false, pending: Promise.resolve(), visible: true, nextControl: 0 };
    }
    get supported() { return !stopped; }
    #bind(object: Record<string, unknown>, property: string, definition: Omit<AnnotationControl, 'callback' | 'currentValue'>) {
      const panel = this.#panel;
      if (panel.disposed || stopped) throw new Error('Tweak has been disposed');
      if (!object || typeof object !== 'object' || typeof property !== 'string') throw new TypeError('Invalid Tweak binding');
      if (panel.bindings.size >= 12 || (!panels.has(panel.id) && panels.size >= 64)) throw new RangeError('Too many Tweak controls');
      const control = { ...definition, callback: `${panel.id}-${++panel.nextControl}`, currentValue: object[property] } as AnnotationControl;
      if (!validControlValue(control, control.currentValue) || (control.type === 'range' && (!Number.isFinite(control.step) || control.step! <= 0 || !Number.isFinite(control.min) || !Number.isFinite(control.max) || control.min! >= control.max!))) throw new TypeError('Tweak bindings require a valid current value');
      const controls = [...panel.bindings.values()].map(binding => binding.control).concat(control);
      if (JSON.stringify({ controlsMode: 'replace', controls }).length > 16_384) throw new RangeError('Tweak controls exceed the maximum size');
      panel.bindings.set(control.callback, { object, property, control });
      panels.set(panel.id, panel);
      panel.pending = panel.pending.then(async () => {
        if (panel.disposed || stopped) return;
        const target = snapshot(panel);
        const result = await bridge.request({ type: panel.accepted.length ? 'update' : 'register', registrationId: panel.id,
          annotationControls: { controlsMode: 'replace', controls: [...panel.accepted, control] }, targets: [target] });
        if (panel.disposed || stopped) return;
        const accepted = (result as { annotationControls?: { controls?: unknown } })?.annotationControls?.controls;
        if (!Array.isArray(accepted)) throw new Error('Tweak registration rejected');
        panel.accepted = accepted as AnnotationControl[];
        panel.visible = target.visible;
        refresh();
      }).catch(() => { panel.bindings.delete(control.callback); if (!panel.accepted.length) disposePanel(panel); });
      return this;
    }
    addSlider(object: Record<string, unknown>, property: string, options: { min: number; max: number; step?: number; unit?: string; label?: string; reference?: unknown }) {
      return this.#bind(object, property, { type: 'range', label: `${options.label ?? property}${options.unit ? ` (${options.unit})` : ''}`, min: options.min, max: options.max, step: options.step ?? 1, reference: options.reference });
    }
    addColorPicker(object: Record<string, unknown>, property: string, options: { label?: string; reference?: unknown } = {}) { return this.#bind(object, property, { type: 'color', label: options.label ?? property, reference: options.reference }); }
    addToggle(object: Record<string, unknown>, property: string, options: { label?: string; reference?: unknown } = {}) { return this.#bind(object, property, { type: 'toggle', label: options.label ?? property, reference: options.reference }); }
    addSelect(object: Record<string, unknown>, property: string, options: { options: (string | { label: string; value: string })[]; label?: string; reference?: unknown }) {
      return this.#bind(object, property, { type: 'select', label: options.label ?? property, reference: options.reference, options: options.options.map(value => typeof value === 'string' ? { label: value, value } : value) });
    }
    dispose() { disposePanel(this.#panel); }
  }
  (window as unknown as { Tweak: typeof Tweak }).Tweak = Tweak;
  return {
    observe() {
      refresh = () => {
        for (const panel of panels.values()) {
          if (!panel.container.isConnected) { disposePanel(panel); continue; }
          const target = snapshot(panel);
          if (!panel.accepted.length || panel.visible === target.visible) continue;
          panel.visible = target.visible;
          panel.pending = panel.pending.then(async () => {
            if (!panel.disposed) await bridge.request({ type: 'update', registrationId: panel.id,
              annotationControls: { controlsMode: 'replace', controls: panel.accepted }, targets: [snapshot(panel)] });
          }).catch(() => {});
        }
        const selectedVariants = [...document.querySelectorAll<HTMLElement>('.viz-carousel[data-active-variant]')].slice(0, 32).flatMap((root, carousel) => {
          const variant = root.dataset.activeVariant?.slice(0, 256);
          const label = root.getAttribute('aria-label')?.slice(0, 256);
          return variant ? [{ carousel, variant, ...(label ? { label } : {}) }] : [];
        });
        const next = JSON.stringify(selectedVariants);
        if (next !== variants) { variants = next; void bridge.request({ type: 'variants', selectedVariants }).catch(() => {}); }
      };
      observer = new MutationObserver(refresh);
      observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-active-variant', 'hidden'] });
      refresh();
    },
    select(path: EventTarget[]) {
      const ordered = [...panels.values()].reverse();
      for (const node of path) {
        const panel = ordered.find(item => item.container === node && item.accepted.length && !item.disposed && item.visible);
        if (panel) return { registrationId: panel.id, targetId: panel.targetId };
      }
      return null;
    },
    update(changes: AnnotationChange[]) { synchronize(changes); },
    cleanup() { observer?.disconnect(); synchronize([]); stopped = true; for (const panel of [...panels.values()]) disposePanel(panel); },
  };
}
