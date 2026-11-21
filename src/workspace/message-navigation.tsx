import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { TurnSummary } from '../../lib/codex-protocol.ts';
import { onConversationHistoryChanged, request } from './host.ts';
import { MessageNavigationHistory, NavigationTargetChanged, messageMarkers, type MessageMarker, type NavigationWindow } from './message-navigation-history.ts';
import './message-navigation.css';

type Elements = { scroller: RefObject<HTMLDivElement | null>; content: RefObject<HTMLDivElement | null> };
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const anchorFor = (root: Element | null, id: string) => Array.from(root?.querySelectorAll<HTMLElement>('[data-message-navigation-id]') ?? [])
  .find(node => node.dataset.messageNavigationId === id);

export function useMessageNavigation({ threadId, hostId, recent, scroller, content, follow }: Elements & {
  threadId: string; hostId: string; recent: readonly TurnSummary[]; follow: RefObject<boolean>;
}) {
  const history = useMemo(() => new MessageNavigationHistory(params => request('thread/turns/list', {
    ...params, threadId,
  }, { hostId })), [threadId, hostId]);
  const [revision, update] = useState(0);
  const [past, setPast] = useState<NavigationWindow>();
  const [target, setTarget] = useState<{ id: string; instant: boolean }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const navigation = useRef<AbortController | null>(null);
  const retry = useRef<() => void>(() => {});
  const lifetime = useRef(new AbortController());
  const refresh = useRef<() => Promise<void>>(async () => {});
  const rendered = past ? past.turns.map(turn => recent.find(live => live.id === turn.id) ?? turn) : recent;
  const known = useMemo(() => [...(past?.turns ?? []), ...recent], [past, recent]);
  const markers = useMemo(() => messageMarkers(history.complete ? history.locations : [], known, history.previews), [history, known, revision]);

  useEffect(() => {
    const scope = new AbortController();
    lifetime.current = scope;
    let indexing: AbortController | undefined;
    refresh.current = async () => {
      indexing?.abort();
      const controller = indexing = new AbortController();
      try {
        await history.index(controller.signal);
        if (!scope.signal.aborted) {
          if (history.complete) setPast(current => current ? { ...current,
            before: current.turns[0]?.id !== history.locations[0]?.turnId,
            after: current.turns.at(-1)?.id !== history.locations.at(-1)?.turnId,
          } : current);
          update(value => value + 1);
        }
      }
      catch { /* Loaded messages remain navigable when the directory is unavailable. */ }
    };
    setPast(undefined); setTarget(undefined); setError(''); setBusy(false);
    void refresh.current();
    const off = onConversationHistoryChanged(threadId, reverted => {
      if (reverted) {
        lifetime.current.abort(); lifetime.current = new AbortController();
        navigation.current?.abort(); history.previews.clear();
        setPast(undefined); setTarget(undefined); setError(''); setBusy(false);
      }
      void refresh.current();
    }, hostId);
    return () => { scope.abort(); lifetime.current.abort(); indexing?.abort(); navigation.current?.abort(); off(); };
  }, [history, threadId, hostId]);

  const preview = useCallback(async (marker: MessageMarker) => {
    if (known.some(turn => turn.id === marker.turnId)) return;
    await history.preview(marker.turnId, lifetime.current.signal);
    if (!lifetime.current.signal.aborted) update(value => value + 1);
  }, [history, known]);

  const reveal = useCallback(async (marker: MessageMarker, smooth = true) => {
    navigation.current?.abort();
    const controller = navigation.current = new AbortController();
    retry.current = () => { void reveal(marker); };
    setError('');
    follow.current = false;
    if (anchorFor(content.current, marker.id)) {
      setBusy(false); setTarget({ id: marker.id, instant: !smooth }); return;
    }
    if (recent.some(turn => turn.id === marker.turnId)) {
      setPast(undefined); setBusy(false); setTarget({ id: marker.id, instant: true }); return;
    }
    setBusy(true);
    try {
      let window: NavigationWindow;
      try { window = await history.around(marker.turnId, controller.signal); }
      catch (error) {
        if (!(error instanceof NavigationTargetChanged)) throw error;
        await refresh.current(); controller.signal.throwIfAborted();
        window = await history.around(marker.turnId, controller.signal);
      }
      controller.signal.throwIfAborted();
      setPast(window); setTarget({ id: marker.id, instant: true }); update(value => value + 1);
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error));
    } finally { if (navigation.current === controller && !controller.signal.aborted) setBusy(false); }
  }, [history, recent, content, follow]);

  const latest = useCallback(() => {
    navigation.current?.abort(); setPast(undefined); setTarget(undefined); setBusy(false); setError('');
    follow.current = true;
    requestAnimationFrame(() => { const node = scroller.current; if (node) node.scrollTop = node.scrollHeight; });
  }, [follow, scroller]);

  const extend = async (direction: 'before' | 'after') => {
    if (!past || !past[direction] || busy) return;
    navigation.current?.abort();
    const controller = navigation.current = new AbortController();
    retry.current = () => { void extend(direction); };
    const node = scroller.current, first = content.current?.querySelector<HTMLElement>('[data-message-navigation-turn]');
    const top = first?.getBoundingClientRect().top;
    follow.current = false; setBusy(true); setError('');
    try {
      const window = await history.extend(past, direction, controller.signal);
      controller.signal.throwIfAborted(); setPast(window);
      requestAnimationFrame(() => {
        if (controller.signal.aborted || !node || !first?.isConnected || top === undefined) return;
        const scale = node.getBoundingClientRect().width / node.offsetWidth || 1;
        node.scrollTop += (first.getBoundingClientRect().top - top) / scale;
      });
    } catch (error) { if (!controller.signal.aborted) setError(String(error)); }
    finally { if (navigation.current === controller && !controller.signal.aborted) setBusy(false); }
  };

  useLayoutEffect(() => {
    const node = scroller.current, anchor = target && anchorFor(content.current, target.id);
    if (!node || !anchor) return;
    const scale = node.getBoundingClientRect().width / node.offsetWidth || 1;
    follow.current = false;
    node.scrollTo({ top: node.scrollTop + (anchor.getBoundingClientRect().top - node.getBoundingClientRect().top) / scale - 16,
      behavior: target.instant || reducedMotion() ? 'instant' : 'smooth' });
    anchor.dataset.messageNavigationFlash = 'true';
    const timer = setTimeout(() => { delete anchor.dataset.messageNavigationFlash; }, reducedMotion() ? 0 : 1400);
    return () => { clearTimeout(timer); delete anchor.dataset.messageNavigationFlash; };
  }, [target, scroller, content, follow]);

  return { turns: rendered, past, busy, extend, latest,
    rail: <MessageNavigationRail markers={markers} scroller={scroller} content={content} preview={preview} reveal={reveal} />,
    status: (busy || error) ? <div className="yard-source-message-navigation-status" role={error ? 'alert' : 'status'}>
      {error ? <>Could not open this message. <button type="button" onClick={() => retry.current()}>Retry</button></> : 'Opening message…'}
    </div> : null };
}

function MessageNavigationRail({ markers, scroller, content, preview, reveal }: Elements & {
  markers: MessageMarker[]; preview(marker: MessageMarker): Promise<void>; reveal(marker: MessageMarker, smooth?: boolean): Promise<void>;
}) {
  const [room, setRoom] = useState(false);
  const [active, setActive] = useState<string[]>([]);
  const [hover, setHover] = useState<string>();
  const [tooltip, setTooltip] = useState<string>();
  const [previewError, setPreviewError] = useState<string>();
  const [previewing, setPreviewing] = useState<string>();
  const [tooltipTop, setTooltipTop] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLElement>(null);
  const dragging = useRef(false);
  const suppressClick = useRef(false);
  const pressed = useRef<MessageMarker | undefined>(undefined);
  const keyboardTarget = useRef<string | undefined>(undefined);
  const latest = useRef({ markers, reveal }); latest.current = { markers, reveal };
  const visible = room && markers.length >= 4;
  const selected = markers.find(marker => marker.id === hover);
  const previewMarker = markers.find(marker => marker.id === tooltip);
  const targeted = hover ?? active[0];
  const targetIndex = markers.findIndex(marker => marker.id === targeted);

  useEffect(() => {
    const node = scroller.current, body = content.current;
    if (!node || !body) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const scrollRect = node.getBoundingClientRect(), contentRect = body.getBoundingClientRect();
        const scale = node.offsetWidth ? scrollRect.width / node.offsetWidth : 1;
        setRoom((contentRect.left - scrollRect.left) / (scale || 1) >= 48);
      });
    };
    const sizes = new ResizeObserver(measure); sizes.observe(node); sizes.observe(body);
    // The pinned client also observes style changes, which catches CSS zoom and pane transitions.
    const styles = new MutationObserver(measure);
    for (let parent: Element | null = body; parent; parent = parent.parentElement) styles.observe(parent, { attributes: true, attributeFilter: ['style', 'class'] });
    window.addEventListener('resize', measure); measure();
    return () => { sizes.disconnect(); styles.disconnect(); window.removeEventListener('resize', measure); cancelAnimationFrame(frame); };
  }, [scroller, content]);

  useEffect(() => {
    const node = scroller.current, body = content.current;
    if (!node || !body) return;
    const intersecting = new Set<string>();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.messageNavigationTurn!;
        if (entry.isIntersecting) intersecting.add(id); else intersecting.delete(id);
      }
      setActive(markers.filter(marker => intersecting.has(marker.turnId)).map(marker => marker.id));
    }, { root: node, rootMargin: '-16px 0px 0px' });
    body.querySelectorAll('[data-message-navigation-turn]').forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, [markers, scroller, content]);

  useEffect(() => {
    if (!visible) { setHover(undefined); setTooltip(undefined); }
  }, [visible]);
  useEffect(() => {
    if (!selected || !visible) return;
    let current = true;
    setPreviewError(undefined);
    const prefetch = setTimeout(() => {
      setPreviewing(selected.id);
      void preview(selected).catch(() => { if (current) setPreviewError(selected.id); })
        .finally(() => { if (current) setPreviewing(undefined); });
    }, 150);
    const show = setTimeout(() => setTooltip(selected.id), 250);
    return () => { current = false; clearTimeout(prefetch); clearTimeout(show); setTooltip(undefined); };
  }, [selected?.id, visible, preview]);
  useLayoutEffect(() => {
    if (!tooltip || !rail.current) return;
    const button = Array.from(list.current?.querySelectorAll<HTMLElement>('[data-marker-id]') ?? []).find(node => node.dataset.markerId === tooltip);
    if (!button) return;
    const rect = rail.current.getBoundingClientRect(), scale = rect.width / rail.current.offsetWidth || 1;
    setTooltipTop((button.getBoundingClientRect().top - rect.top) / scale - 8);
  }, [tooltip]);
  useEffect(() => {
    if (hover || !active.length || !list.current) return;
    const node = Array.from(list.current.querySelectorAll<HTMLElement>('[data-marker-id]')).find(node => node.dataset.markerId === active[0]);
    if (!node) return;
    if (node.offsetTop < list.current.scrollTop || node.offsetTop + 10 > list.current.scrollTop + list.current.clientHeight) {
      list.current.scrollTop = node.offsetTop - list.current.clientHeight / 2;
    }
  }, [active, hover]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        !['ArrowUp', 'ArrowDown'].includes(event.key) || !scroller.current?.parentElement?.contains(document.activeElement)) return;
      const { markers, reveal } = latest.current;
      if (!markers.length) return;
      const current = markers.findIndex(marker => marker.id === (keyboardTarget.current ?? active[0]));
      const index = Math.max(0, Math.min(markers.length - 1, (current < 0 ? markers.length : current) + (event.key === 'ArrowUp' ? -1 : 1)));
      const marker = markers[index]!; keyboardTarget.current = marker.id;
      event.preventDefault(); void reveal(marker);
    };
    window.addEventListener('keydown', onKey);
    const scroll = () => { keyboardTarget.current = undefined; };
    scroller.current?.addEventListener('wheel', scroll, { passive: true });
    return () => { window.removeEventListener('keydown', onKey); scroller.current?.removeEventListener('wheel', scroll); };
  }, [active, scroller]);

  const parent = scroller.current?.parentElement;
  if (!parent || !visible) return null;
  return createPortal(<nav ref={rail} className="yard-source-message-navigation" aria-label="Message navigation"
    onPointerLeave={() => { if (!dragging.current) setHover(undefined); }}>
    <div ref={list} className="yard-source-message-navigation-list" onScroll={() => setTooltip(undefined)}
      onPointerDown={event => {
        if (event.button !== 0) return;
        dragging.current = true; suppressClick.current = false;
        keyboardTarget.current = undefined;
        pressed.current = markers.find(marker => marker.id === (event.target as Element).closest<HTMLElement>('[data-marker-id]')?.dataset.markerId);
        event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={event => {
        if (!dragging.current) return;
        const node = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-marker-id]');
        const marker = markers.find(marker => marker.id === node?.dataset.markerId);
        if (!marker || marker.id === hover) return;
        setHover(marker.id); suppressClick.current = true;
        if (anchorFor(content.current, marker.id)) { keyboardTarget.current = marker.id; void reveal(marker, false); }
      }} onPointerUp={event => {
        dragging.current = false;
        if (!suppressClick.current && pressed.current) { keyboardTarget.current = pressed.current.id; void reveal(pressed.current); }
        pressed.current = undefined;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }} onPointerCancel={() => { dragging.current = false; suppressClick.current = true; setHover(undefined); }}>
      {Array.from({ length: Math.ceil(markers.length / 64) }, (_, chunk) => <div className="yard-source-message-navigation-group" key={chunk}>
        {markers.slice(chunk * 64, chunk * 64 + 64).map((marker, offset) => {
          const index = chunk * 64 + offset, distance = Math.abs(index - targetIndex);
          const width = targetIndex < 0 || distance > 3 ? 6 : 6 + 20 * [1, .7, .4, .2][distance]!;
          return <button type="button" key={marker.id} data-marker-id={marker.id} aria-label={`Go to message ${index + 1}`}
            aria-current={active.includes(marker.id) ? 'location' : undefined} aria-describedby={tooltip === marker.id ? 'yard-message-preview-' + encodeURIComponent(marker.id) : undefined}
            data-targeted={marker.id === targeted || undefined} data-active={active.includes(marker.id) || undefined}
            onPointerEnter={() => setHover(marker.id)} onFocus={() => { setHover(marker.id); void preview(marker).catch(() => setPreviewError(marker.id)); }}
            onBlur={() => setHover(undefined)} onClick={event => {
              if (event.detail === 0) { keyboardTarget.current = marker.id; void reveal(marker); }
            }}><span style={{ width }} /></button>;
        })}
      </div>)}
    </div>
    {previewMarker && <div role="tooltip" id={'yard-message-preview-' + encodeURIComponent(previewMarker.id)} className="yard-source-message-navigation-preview"
      style={{ top: Math.max(-rail.current!.offsetTop + 16, Math.min(tooltipTop, parent.clientHeight - rail.current!.offsetTop - 112)) }}>
      {previewError === previewMarker.id ? <p>Preview unavailable</p> : <>
        <strong dir="auto">{previewMarker.prompt || previewMarker.attachments.join(', ') || (previewing === previewMarker.id ? 'Loading…' : 'Message')}</strong>
        {previewMarker.response && <p dir="auto">{previewMarker.response}</p>}
        {!!previewMarker.attachments.length && <small>{previewMarker.attachments.join(', ')}</small>}
      </>}
    </div>}
  </nav>, parent);
}
