import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { ComposerDraft, WorkbenchClient } from '../workbench-contract.ts';
import { parseRegistration, validControlValue, type AnnotationChange, type AnnotationControl, type AnnotationRegistration, type ControlValue } from './annotations.ts';
import { normalizeWidgetState, readVisualizationState, visualizationAtomKey, writeVisualizationState } from './state.ts';
export { readVisualizationModelContext, type VisualizationModelContext } from './state.ts';

export interface VisualizationReferenceContext {
  type: 'visualization';
  hostId: string;
  threadId: string;
  path: string;
  title?: string;
  context?: unknown;
}
export interface StandaloneVisualizationProps {
  client: WorkbenchClient;
  hostId: string;
  threadId: string;
  path: string;
  onPrefill(draft: ComposerDraft): void;
  onClose(): void;
  theme?: 'light' | 'dark';
  themeVariables?: Record<string, string>;
  locale?: string;
  initialWidgetState?: unknown;
  onWidgetStateChange?(state: unknown): void | Promise<void>;
}

type Value = Record<string, unknown>;
type Download = { blob: Blob; name: string };
const object = (value: unknown): Value => value != null && typeof value === 'object' && !Array.isArray(value) ? value as Value : {};
const buttonStyle: CSSProperties = { border: '1px solid #b8c0c7', borderRadius: 4, padding: '6px 9px', background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit' };
const filename = (value: string) => value.split(/[\\/]/).at(-1)?.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 180) || 'visualization';
function pickerColor(value: ControlValue): string {
  const color = String(value);
  if (/^#[\da-f]{3,4}$/i.test(color)) return `#${[...color.slice(1, 4)].map(char => char + char).join('')}`;
  return /^#[\da-f]{6,8}$/i.test(color) ? color.slice(0, 7) : '#000000';
}
function preserveAlpha(old: ControlValue, color: string): string {
  const value = String(old);
  if (/^#[\da-f]{4}$/i.test(value)) return `${color}${value[4]}${value[4]}`;
  if (/^#[\da-f]{8}$/i.test(value)) return `${color}${value.slice(7)}`;
  return color;
}
function visualizationDraft(prompt: string, referenceContext: VisualizationReferenceContext): ComposerDraft {
  const reference = {
    id: crypto.randomUUID(),
    text: `Visualization: ${referenceContext.title ?? filename(referenceContext.path)}`,
    kind: 'visualization',
    context: { ...referenceContext },
    original: { originalUserInput: prompt, referenceContext },
  };
  return { text: prompt, images: [], files: [], references: [reference] };
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename(name);
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** A host-scoped preview. Authored HTML receives only the limited visualization port. */
export function StandaloneVisualization(props: StandaloneVisualizationProps) {
  const { client, hostId, threadId, path, theme = 'light' } = props;
  const frameRef = useRef<HTMLIFrameElement>(null);
  const portRef = useRef<MessagePort | null>(null);
  const registrationsRef = useRef(new Map<string, AnnotationRegistration>());
  const changesRef = useRef<AnnotationChange[]>([]);
  const annotationActiveRef = useRef(false);
  const selectionRef = useRef<{ registrationId: string; targetId: string } | null>(null);
  const variantsRef = useRef<{ carousel: number; variant: string; label?: string }[]>([]);
  const epochRef = useRef(0);
  const propsRef = useRef(props);
  useLayoutEffect(() => { propsRef.current = props; });
  const sourceRef = useRef<{ path: string; contents: string } | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [height, setHeight] = useState(320);
  const [expanded, setExpanded] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const [excerpt, setExcerpt] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [registrations, setRegistrations] = useState<AnnotationRegistration[]>([]);
  const [selection, setSelection] = useState<{ registrationId: string; targetId: string } | null>(null);
  const [changes, setChanges] = useState<AnnotationChange[]>([]);
  const [pendingDownload, setPendingDownload] = useState<Download | null>(null);
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [savingAnnotation, setSavingAnnotation] = useState(false);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let active = true;
    let port: MessagePort | null = null;
    let timer: number | undefined;
    let unsubscribe: (() => void) | undefined;
    let accepted = false;
    const epoch = ++epochRef.current;
    const requests = new Set<number>();
    const initId = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    const frameUrl = new URL('/', window.location.origin);
    frameUrl.searchParams.set('app', 'skybridge');
    frameUrl.searchParams.set('yard_viz_init', initId);
    setStatus('loading'); setError(''); setHeight(320); setExpanded(false);
    setAnnotating(false); setExcerpt(null); setComment(''); setPendingDownload(null); setPendingLink(null);
    registrationsRef.current = new Map(); changesRef.current = []; annotationActiveRef.current = false; selectionRef.current = null;
    variantsRef.current = []; setSavingAnnotation(false);
    setRegistrations([]); setSelection(null); setChanges([]);
    sourceRef.current = null;
    let widgetState: unknown = propsRef.current.initialWidgetState;
    let persisted = propsRef.current.initialWidgetState === undefined && !propsRef.current.onWidgetStateChange;
    const currentIdentity = () => active && propsRef.current.client === client && propsRef.current.hostId === hostId &&
      propsRef.current.threadId === threadId && propsRef.current.path === path;

    function fail(message: string) {
      if (!currentIdentity()) return;
      active = false;
      setError(message);
      setStatus('error');
      window.removeEventListener('message', onMessage);
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe?.(); unsubscribe = undefined;
      port?.close();
      if (portRef.current === port) portRef.current = null;
    }
    async function handleRequest(message: Value) {
      if (!currentIdentity() || typeof message.id !== 'number' || !Number.isSafeInteger(message.id) || message.id < 1 || requests.has(message.id) || requests.size >= 32) return;
      const id = message.id;
      requests.add(id);
      const input = object(message.payload);
      try {
        let value: unknown;
        if (message.method === 'follow-up') {
          if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 20_000) throw new Error('Invalid follow-up');
          if (input.title !== undefined && (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 250)) throw new Error('Invalid follow-up title');
          let context: unknown;
          if (input.context !== undefined) {
            const serialized = JSON.stringify(input.context);
            if (serialized === undefined || serialized.length > 32_768) throw new Error('Invalid follow-up context');
            context = JSON.parse(serialized) as unknown;
          }
          if (input.title !== undefined || input.context !== undefined) {
            propsRef.current.onPrefill(visualizationDraft(input.prompt, { type: 'visualization', hostId, threadId, path: sourceRef.current?.path ?? path,
              ...(typeof input.title === 'string' ? { title: input.title.trim() } : {}), ...(input.context !== undefined ? { context } : {}) }));
          } else propsRef.current.onPrefill({ text: input.prompt, images: [], files: [] });
        } else if (message.method === 'display-mode') {
          if (input.mode !== 'inline' && input.mode !== 'fullscreen') throw new Error('Invalid display mode');
          setExpanded(input.mode === 'fullscreen');
          port?.postMessage({ type: 'display-mode', mode: input.mode });
          value = { mode: input.mode };
        } else if (message.method === 'download') {
          if (!(input.blob instanceof Blob) || input.blob.size > 10_000_000 || typeof input.name !== 'string') throw new Error('Invalid download');
          setPendingDownload({ blob: input.blob, name: filename(input.name) });
          value = { queued: true };
        } else if (message.method === 'open-external') {
          if (typeof input.href !== 'string' || input.href.length > 4_096) throw new Error('Invalid link');
          const url = new URL(input.href);
          if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Invalid link');
          setPendingLink(url.href);
          value = { queued: true };
        } else if (message.method === 'widget-state') {
          const serialized = JSON.stringify(message.payload);
          if (serialized === undefined || serialized.length > 100_000) throw new Error('Invalid widget state');
          const update = propsRef.current.onWidgetStateChange;
          if (update) await update(JSON.parse(serialized) as unknown);
          else if (persisted && sourceRef.current) {
            const nextState = normalizeWidgetState(JSON.parse(serialized) as unknown);
            await writeVisualizationState(client, { hostId, threadId, path: sourceRef.current.path }, nextState);
            value = nextState;
          }
          else throw new Error('Widget state persistence is unavailable');
        } else if (message.method === 'annotations') {
          if (input.type === 'register' || input.type === 'update') {
            const registration = parseRegistration(input);
            if (input.type === 'register' && (registrationsRef.current.has(registration.registrationId) || registrationsRef.current.size >= 64)) throw new Error('Annotation registration already exists or is full');
            if (input.type === 'update' && !registrationsRef.current.has(registration.registrationId)) throw new Error('Unknown annotation registration');
            registrationsRef.current.set(registration.registrationId, registration);
            const owners = new Map<string, string>();
            for (const item of registrationsRef.current.values()) for (const target of item.targets) if (target.visible) owners.set(target.id, item.registrationId);
            changesRef.current = changesRef.current.map(change => change.registrationId !== registration.registrationId ? change : {
              ...change, annotationControlChanges: change.annotationControlChanges.filter(edit => {
                const control = registration.controls.find(item => item.callback === edit.callback);
                return !!control && control.currentValue === edit.previousValue && validControlValue(control, edit.value);
              }),
            }).filter(change => change.annotationControlChanges.length > 0 && owners.get(change.targetId) === change.registrationId);
            if (selectionRef.current && owners.get(selectionRef.current.targetId) !== selectionRef.current.registrationId) {
              selectionRef.current = null; setSelection(null); setExcerpt(null);
            }
            setChanges([...changesRef.current]);
            setRegistrations([...registrationsRef.current.values()]);
            port?.postMessage({ type: 'annotate', enabled: annotationActiveRef.current, selection: selectionRef.current, changes: changesRef.current });
            value = { annotationControls: { controlsMode: 'replace', controls: registration.controls } };
          } else if (input.type === 'dispose') {
            if (typeof input.registrationId !== 'string') throw new Error('Invalid annotation registration');
            registrationsRef.current.delete(input.registrationId);
            changesRef.current = changesRef.current.filter(change => change.registrationId !== input.registrationId);
            setChanges(changesRef.current);
            setRegistrations([...registrationsRef.current.values()]);
            if (selectionRef.current?.registrationId === input.registrationId) { selectionRef.current = null; setSelection(null); }
            port?.postMessage({ type: 'annotate', enabled: annotationActiveRef.current, selection: selectionRef.current, changes: changesRef.current });
          } else if (input.type === 'select') {
            const registration = typeof input.registrationId === 'string' ? registrationsRef.current.get(input.registrationId) : undefined;
            const target = registration?.targets.find(item => item.id === input.targetId && item.visible);
            if (!annotationActiveRef.current || !registration || !target) throw new Error('Invalid annotation selection');
            const next = { registrationId: registration.registrationId, targetId: target.id };
            selectionRef.current = next; setSelection(next); setExcerpt(target.label); annotationActiveRef.current = false; setAnnotating(false);
            port?.postMessage({ type: 'annotate', enabled: false, selection: next, changes: changesRef.current });
          } else if (input.type === 'escape') {
            annotationActiveRef.current = false; setAnnotating(false); selectionRef.current = null; setSelection(null); setExcerpt(null);
            changesRef.current = []; setChanges([]); port?.postMessage({ type: 'annotate', enabled: false, changes: [] });
          } else if (input.type === 'variants') {
            if (!Array.isArray(input.selectedVariants) || input.selectedVariants.length > 32) throw new Error('Invalid visualization variants');
            variantsRef.current = input.selectedVariants.map((item: unknown) => {
              const variant = object(item);
              if (!Number.isInteger(variant.carousel) || Number(variant.carousel) < 0 || Number(variant.carousel) > 31 || typeof variant.variant !== 'string' || !variant.variant || variant.variant.length > 256 || (variant.label !== undefined && (typeof variant.label !== 'string' || variant.label.length > 256))) throw new Error('Invalid visualization variant');
              return { carousel: Number(variant.carousel), variant: variant.variant, ...(typeof variant.label === 'string' ? { label: variant.label } : {}) };
            });
          } else throw new Error('Invalid annotation operation');
        } else throw new Error('Visualization operation is not available');
        if (currentIdentity()) port?.postMessage({ type: 'response', id, ok: true, value });
      } catch (reason) {
        if (currentIdentity()) port?.postMessage({ type: 'response', id, ok: false, error: reason instanceof Error ? reason.message : 'Visualization operation failed' });
      } finally { requests.delete(id); }
    }
    function onMessage(event: MessageEvent) {
      const message = object(event.data);
      if (!currentIdentity() || accepted || event.source !== frame?.contentWindow || event.origin !== 'null' || message.type !== 'yard-visualization:init' || message.initId !== initId || event.ports.length !== 1 || frame.src !== frameUrl.href) return;
      accepted = true;
      window.removeEventListener('message', onMessage);
      port = event.ports[0];
      portRef.current = port;
      port.onmessage = event => {
        if (!currentIdentity()) return;
        const value = object(event.data);
        if (value.type === 'ready') {
          if (timer !== undefined) clearTimeout(timer);
          setStatus('ready');
        } else if (value.type === 'height' && typeof value.height === 'number' && Number.isFinite(value.height)) {
          setHeight(Math.max(120, Math.min(10_000, Math.ceil(value.height))));
        } else if (value.type === 'error') {
          setError(typeof value.message === 'string' ? value.message.slice(0, 1000) : 'Visualization error');
        } else if (value.type === 'annotation-target') {
          annotationActiveRef.current = false; setAnnotating(false);
          const registration = typeof value.registrationId === 'string' ? registrationsRef.current.get(value.registrationId) : undefined;
          const target = registration?.targets.find(item => item.id === value.targetId && item.visible);
          const next = registration && target ? { registrationId: registration.registrationId, targetId: target.id } : null;
          selectionRef.current = next; setSelection(next);
          setExcerpt(typeof value.excerpt === 'string' ? value.excerpt.slice(0, 500) : '');
          port?.postMessage({ type: 'annotate', enabled: false, selection: next, changes: changesRef.current });
        } else if (value.type === 'leaving') fail('Visualization frame navigated away');
        else if (value.type === 'request') void handleRequest(value);
      };
      port.start();
      port.postMessage({ type: 'render', html: sourceRef.current?.contents, theme: propsRef.current.theme ?? 'light', themeVariables: propsRef.current.themeVariables, locale: propsRef.current.locale, widgetState });
    }
    void client.host<{ path: string; contents: string }>('visualization-read', { hostId, threadId, path }).then(async result => {
      if (!currentIdentity()) return;
      if (typeof result?.path !== 'string' || typeof result.contents !== 'string') throw new Error('Invalid visualization response');
      sourceRef.current = result;
      if (persisted) {
        const identity = { hostId, threadId, path: result.path };
        let stateVersion = 0;
        unsubscribe = client.subscribe(event => {
          if (event.type !== 'persisted-atom-updated' || !Array.isArray(event.keys) || !event.keys.includes(visualizationAtomKey('visualization-state-v3', identity))) return;
          const version = ++stateVersion;
          void readVisualizationState(client, identity).then(state => {
            if (currentIdentity() && version === stateVersion) { widgetState = state; port?.postMessage({ type: 'widget-state', state }); }
          }).catch(reason => {
            if (currentIdentity()) setError(reason instanceof Error ? reason.message : 'Could not read visualization state');
          });
        });
        while (currentIdentity()) {
          const version = stateVersion;
          const state = await readVisualizationState(client, identity);
          if (version === stateVersion) { widgetState = state; break; }
        }
      }
      if (!currentIdentity()) return;
      window.addEventListener('message', onMessage);
      timer = window.setTimeout(() => fail('Visualization did not become ready'), 15_000);
      frame.src = frameUrl.href;
    }).catch(reason => fail(reason instanceof Error ? reason.message : 'Could not read visualization'));
    return () => {
      active = false;
      if (epochRef.current === epoch) epochRef.current++;
      window.removeEventListener('message', onMessage);
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe?.();
      try { port?.postMessage({ type: 'dispose' }); } catch { /* already closed */ }
      port?.close();
      if (portRef.current === port) portRef.current = null;
    };
  }, [client, hostId, threadId, path, attempt]);

  useEffect(() => { portRef.current?.postMessage({ type: 'theme', theme, themeVariables: props.themeVariables ?? {}, locale: props.locale }); }, [theme, props.themeVariables, props.locale]);
  function changeMode(next: boolean) {
    setExpanded(next);
    portRef.current?.postMessage({ type: 'display-mode', mode: next ? 'fullscreen' : 'inline' });
  }
  function startAnnotation() {
    const next = !annotating;
    annotationActiveRef.current = next; setAnnotating(next);
    setExcerpt(null); setSelection(null); selectionRef.current = null;
    if (!next) { changesRef.current = []; setChanges([]); }
    portRef.current?.postMessage({ type: 'annotate', enabled: next, selection: null, changes: changesRef.current });
  }
  function changeControl(control: AnnotationControl, value: ControlValue) {
    if (!selection || !validControlValue(control, value)) return;
    const previous = changesRef.current.find(change => change.registrationId === selection.registrationId && change.targetId === selection.targetId);
    const edits = (previous?.annotationControlChanges ?? []).filter(edit => edit.callback !== control.callback);
    if (value !== control.currentValue) edits.push({ callback: control.callback, previousValue: control.currentValue, value });
    changesRef.current = changesRef.current.filter(change => change.registrationId !== selection.registrationId || change.targetId !== selection.targetId);
    if (edits.length) changesRef.current.push({ ...selection, annotationControlChanges: edits });
    setChanges([...changesRef.current]);
    portRef.current?.postMessage({ type: 'annotate', enabled: false, selection, changes: changesRef.current });
  }
  async function prefillAnnotation() {
    if (savingAnnotation || (!comment.trim() && changesRef.current.length === 0) || excerpt === null) return;
    const epoch = epochRef.current;
    if (selection || changesRef.current.length) {
      const selected = selection && registrationsRef.current.get(selection.registrationId)?.targets.find(target => target.id === selection.targetId);
      const context = { ...(selected ? { selection: selected } : {}), changes: changesRef.current.map(change => {
        const registration = registrationsRef.current.get(change.registrationId);
        return { target: registration?.targets.find(target => target.id === change.targetId), edits: change.annotationControlChanges.map(edit => {
          const control = registration?.controls.find(item => item.callback === edit.callback);
          return { label: control?.label, reference: control?.reference, previousValue: edit.previousValue, value: edit.value };
        }) };
      }), selectedVariants: variantsRef.current };
      const prompt = comment.trim() || 'Apply these visualization changes.';
      setSavingAnnotation(true);
      try {
        if (changesRef.current.length && sourceRef.current && propsRef.current.initialWidgetState === undefined && !propsRef.current.onWidgetStateChange) {
          await writeVisualizationState(client, { hostId, threadId, path: sourceRef.current.path }, { modelContent: context }, 'visualization-interaction-state-v1');
        }
      } catch (reason) { if (epochRef.current === epoch) { setSavingAnnotation(false); setError(reason instanceof Error ? reason.message : 'Could not save visualization changes'); } return; }
      if (epochRef.current !== epoch || propsRef.current.client !== client || propsRef.current.hostId !== hostId || propsRef.current.threadId !== threadId || propsRef.current.path !== path) return;
      setSavingAnnotation(false);
      propsRef.current.onPrefill(visualizationDraft(prompt,
        { type: 'visualization', hostId, threadId, path: sourceRef.current?.path ?? path, title: 'Visualization changes', context }));
    } else propsRef.current.onPrefill({ text: `Visualization: ${sourceRef.current?.path ?? path}\nSelection: ${excerpt}\nFeedback: ${comment.trim()}`, images: [], files: [] });
    changesRef.current = []; setChanges([]); selectionRef.current = null; setSelection(null);
    portRef.current?.postMessage({ type: 'annotate', enabled: false, changes: [] });
    setExcerpt(null); setComment('');
  }
  const selectedRegistration = selection ? registrations.find(item => item.registrationId === selection.registrationId) : undefined;
  const selectedChanges = selection ? changes.find(item => item.registrationId === selection.registrationId && item.targetId === selection.targetId) : undefined;
  function displayedValue(control: AnnotationControl) { return selectedChanges?.annotationControlChanges.find(edit => edit.callback === control.callback)?.value ?? control.currentValue; }
  function cancelAnnotation() {
    changesRef.current = []; setChanges([]); selectionRef.current = null; setSelection(null);
    portRef.current?.postMessage({ type: 'annotate', enabled: false, changes: [] });
    setExcerpt(null); setComment('');
  }

  return <section aria-label="Visualization" style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'auto', color: theme === 'dark' ? '#f2f4f4' : '#1c252a', background: theme === 'dark' ? '#20272a' : '#fff', ...(expanded ? { position: 'fixed', inset: 12, zIndex: 1000, boxShadow: '0 8px 32px #0005' } : {}) }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', padding: 8, borderBottom: '1px solid #9ca9ad' }}>
      <strong style={{ flex: '1 1 120px', overflowWrap: 'anywhere' }}>{filename(sourceRef.current?.path ?? path)}</strong>
      <button style={buttonStyle} disabled={status !== 'ready' || savingAnnotation} onClick={startAnnotation}>{annotating ? 'Cancel annotation' : 'Annotate'}</button>
      <button style={buttonStyle} disabled={!sourceRef.current} onClick={() => { if (sourceRef.current) download(new Blob([sourceRef.current.contents], { type: 'text/html' }), filename(sourceRef.current.path)); }}>Download HTML</button>
      <button style={buttonStyle} disabled={status !== 'ready'} onClick={() => changeMode(!expanded)}>{expanded ? 'Exit expanded view' : 'Expand'}</button>
      <button style={buttonStyle} onClick={props.onClose}>Close</button>
    </div>
    {status === 'loading' && <div role="status" style={{ padding: 8 }}>Loading visualization...</div>}
    {error && <div role="alert" style={{ padding: 8, color: theme === 'dark' ? '#ffd5c9' : '#9f2418' }}>{error}{status === 'error' && <> <button style={buttonStyle} onClick={() => setAttempt(value => value + 1)}>Retry</button></>}</div>}
    {annotating && <div role="status" style={{ padding: 8 }}>Select an element in the visualization.</div>}
    {excerpt !== null && <div style={{ display: 'grid', gap: 6, padding: 8, borderBottom: '1px solid #9ca9ad' }}>
      <div style={{ overflowWrap: 'anywhere' }}>{excerpt || 'Selected element'}</div>
      {selectedRegistration && <fieldset disabled={savingAnnotation} style={{ display: 'grid', gap: 8, border: 0, padding: 0, margin: 0 }}>
        <legend>Adjustments</legend>
        {selectedRegistration.controls.map(control => <label key={control.callback} style={{ display: 'grid', gap: 3 }}>
          <span>{control.label}</span>
          {control.type === 'range' && <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input aria-label={control.label} type="range" min={control.min} max={control.max} step={control.step} value={Number(displayedValue(control))} onChange={event => changeControl(control, Number(event.target.value))} />
            <output>{String(displayedValue(control))}</output>
          </span>}
          {control.type === 'color' && <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input aria-label={`${control.label} picker`} type="color" value={pickerColor(displayedValue(control))} onChange={event => changeControl(control, preserveAlpha(displayedValue(control), event.target.value))} />
            <input key={`${control.callback}:${displayedValue(control)}`} aria-label={control.label} type="text" defaultValue={String(displayedValue(control))} onBlur={event => {
              if (validControlValue(control, event.currentTarget.value)) changeControl(control, event.currentTarget.value);
              else event.currentTarget.value = String(displayedValue(control));
            }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
          </span>}
          {control.type === 'toggle' && <input aria-label={control.label} type="checkbox" checked={displayedValue(control) === true} onChange={event => changeControl(control, event.target.checked)} />}
          {control.type === 'select' && <select aria-label={control.label} value={String(displayedValue(control))} onChange={event => changeControl(control, event.target.value)}>
            {control.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>}
        </label>)}
      </fieldset>}
      <label>Feedback <textarea aria-label="Annotation feedback" disabled={savingAnnotation} value={comment} onChange={event => setComment(event.target.value)} style={{ display: 'block', width: '100%', boxSizing: 'border-box', minHeight: 64, font: 'inherit' }} /></label>
      <div><button style={buttonStyle} disabled={savingAnnotation || (!comment.trim() && changes.length === 0)} onClick={() => { void prefillAnnotation(); }}>Add to draft</button> <button style={buttonStyle} disabled={savingAnnotation} onClick={cancelAnnotation}>Cancel</button></div>
    </div>}
    {pendingDownload && <div style={{ padding: 8 }}>Download {pendingDownload.name}? <button style={buttonStyle} onClick={() => { download(pendingDownload.blob, pendingDownload.name); setPendingDownload(null); }}>Download file</button> <button style={buttonStyle} onClick={() => setPendingDownload(null)}>Dismiss download</button></div>}
    {pendingLink && <div style={{ padding: 8, overflowWrap: 'anywhere' }}>Open {pendingLink}? <a href={pendingLink} target="_blank" rel="noopener noreferrer" onClick={() => setPendingLink(null)}>Open link</a> <button style={buttonStyle} onClick={() => setPendingLink(null)}>Dismiss link</button></div>}
    <iframe key={JSON.stringify([hostId, threadId, path, attempt])} ref={frameRef} title="Visualization content" sandbox="allow-scripts" referrerPolicy="no-referrer" style={{ display: status === 'ready' ? 'block' : 'none', border: 0, width: '100%', height: expanded ? '100%' : height, minHeight: expanded ? 160 : undefined, flex: expanded ? '1 1 auto' : undefined, background: 'transparent' }} />
  </section>;
}
