import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { imageSrc } from './conversation-images.tsx';
import type { EditableImage, ImageComment, ImageCommentGroup, ImageEditAction } from './image-edit-model.ts';
import { ImageEditorIcon, type ImageEditorIconName } from './image-editor-icons.tsx';
import { ImageGenerationLoading } from './image-generation-loading.tsx';
import { browserAtoms, writeAtom } from './host.ts';
import { GeneratedImageMenu, downloadImageCopy, type GeneratedImageMenuTarget } from './generated-image-menu.tsx';
import { WorkspaceIcon } from './workspace-icon.tsx';
import './generated-images.css';
import './generated-image-editor.css';

export type GeneratedImageEditorProps = {
  images: readonly EditableImage[];
  loadingImages?: readonly { id: string; turnId?: string; startedAt?: number }[];
  selectedId: string;
  hostId: string;
  visible: boolean;
  attachedImages?: readonly string[];
  attachedComments?: readonly ImageCommentGroup[];
  onOpenImage?(image: EditableImage): void;
} & ({ readOnly?: false; onSelectImage(id: string): void; onAction(action: ImageEditAction): Promise<void> }
  | { readOnly: true; onSelectImage?: never; onAction?: never });

type View = 'focused' | 'canvas';
type Mode = 'view' | 'comment' | 'remove';
type Size = { width: number; height: number };
type Point = { x: number; y: number };
type Stroke = { width: number; points: Point[] };
type CommentDraft = ImageComment & { imageId: string; saved: boolean };
type LoadingImageItem = { id: string; turnId?: string; startedAt?: number; loading: true };
type CanvasImage = EditableImage | LoadingImageItem;
const noLoadingImages: NonNullable<GeneratedImageEditorProps['loadingImages']> = [];
const canvasGuideAtom = 'has-dismissed-image-canvas-view-coachmark-v1';
const ratios = [
  ['square', 'Square', '1:1'], ['portrait', 'Portrait', '3:4'], ['story', 'Story', '9:16'],
  ['landscape', 'Landscape', '4:3'], ['widescreen', 'Widescreen', '16:9'],
] as const;
const zoomStops = [25, 50, 100, 150, 200];
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const ignoresKeys = (target: EventTarget | null) => target instanceof Element && Boolean(
  target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="menu"]'));

function menuKeys(event: React.KeyboardEvent<HTMLDivElement>) {
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
    event.preventDefault(); event.stopPropagation();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
}

function commentGroups(groups: readonly ImageCommentGroup[], image: EditableImage, comments: readonly ImageComment[]) {
  const next = groups.filter(group => group.image.id !== image.id);
  if (comments.length) {
    const previous = groups.find(group => group.image.id === image.id);
    next.push({ image, comments, ...previous?.imageNumber === undefined ? {} : { imageNumber: previous.imageNumber } });
  }
  return next;
}

function drawStrokes(canvas: HTMLCanvasElement, strokes: readonly Stroke[], mask = false) {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (mask) { context.fillStyle = '#000'; context.fillRect(0, 0, canvas.width, canvas.height); }
  context.lineCap = 'round'; context.lineJoin = 'round';
  context.strokeStyle = mask ? '#fff' : 'rgba(37, 117, 252, .55)';
  context.fillStyle = context.strokeStyle;
  for (const stroke of strokes) {
    if (!stroke.points.length) continue;
    context.lineWidth = stroke.width * canvas.width;
    const first = stroke.points[0];
    if (stroke.points.length === 1) {
      context.beginPath(); context.arc(first.x * canvas.width, first.y * canvas.height, context.lineWidth / 2, 0, Math.PI * 2);
      context.fill(); continue;
    }
    context.beginPath(); context.moveTo(first.x * canvas.width, first.y * canvas.height);
    for (const point of stroke.points.slice(1)) context.lineTo(point.x * canvas.width, point.y * canvas.height);
    context.stroke();
  }
}

function ToolButton({ icon, children, selected, disabled, onClick, label }: {
  icon: ImageEditorIconName; children: string; selected?: boolean; disabled?: boolean; onClick(): void; label?: string;
}) {
  return <button type="button" className="yard-image-editor-tool" aria-label={label ?? children}
    aria-pressed={selected} disabled={disabled} onClick={onClick}>
    <ImageEditorIcon name={icon} size={icon === 'multiselect' ? 13 : 16} /><span data-base={icon !== 'removeBackground'}>{children}</span>
  </button>;
}

function LoadingImage({ thumbnail = false, single = false, size }: { thumbnail?: boolean; single?: boolean; size?: number }) {
  return <div className="yard-image-editor-loading" data-thumbnail={thumbnail}
    style={size === undefined ? undefined : { width: size, height: size }}>
    <ImageGenerationLoading thumbnail={thumbnail} presentation={thumbnail ? 'thumbnail' : single ? 'single' : 'playground'} />
  </div>;
}

function GeneratedImageRail({ images, activeId, hostId, disabled, onSelect, onContextMenu }: {
  images: readonly CanvasImage[]; activeId?: string; hostId: string; disabled: boolean; onSelect(id: string): void;
  onContextMenu(event: React.MouseEvent<HTMLElement>, image: EditableImage): void;
}) {
  // Pinned local-generated-image-side-panel $n: 46px thumbnail, 54px pitch,
  // 6px inset. Wheel deltas move a virtual cursor, even when the rail fits.
  const rail = useRef<HTMLDivElement>(null);
  const position = useRef(29);
  const observedId = useRef<string | undefined>(undefined);
  const wheelHandler = useRef<(event: WheelEvent) => void>(() => {});
  const contentHeight = 12 + Math.max(0, images.length - 1) * 54 + 46;
  function scrollToPosition() {
    const element = rail.current;
    if (!element) return;
    const center = Math.min(contentHeight, element.clientHeight) / 2;
    element.scrollTop = Math.max(0, Math.min(position.current - center, element.scrollHeight - element.clientHeight));
  }
  function select(index: number) {
    const image = images[index];
    if (disabled || !image) return;
    position.current = 29 + index * 54;
    observedId.current = image.id;
    onSelect(image.id); scrollToPosition();
  }
  useLayoutEffect(() => {
    if (activeId !== observedId.current) {
      position.current = 29 + Math.max(0, images.findIndex(image => image.id === activeId)) * 54;
      observedId.current = activeId;
    }
    scrollToPosition();
  }, [activeId, images.length]);
  wheelHandler.current = event => {
    if (event.ctrlKey || disabled) return;
    event.preventDefault();
    const element = rail.current;
    if (!element) return;
    const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? event.deltaY * element.clientHeight : event.deltaY;
    position.current = Math.max(29, Math.min(position.current + delta, 29 + (images.length - 1) * 54));
    scrollToPosition();
    const image = images[Math.round((position.current - 29) / 54)];
    if (image && image.id !== activeId) { observedId.current = image.id; onSelect(image.id); }
  };
  useEffect(() => {
    const element = rail.current;
    if (!element) return;
    const handler = (event: WheelEvent) => wheelHandler.current(event);
    // React's delegated wheel listener is passive; this rail owns the gesture.
    element.addEventListener('wheel', handler, { passive: false });
    return () => element.removeEventListener('wheel', handler);
  }, []);
  return <div ref={rail} className="yard-image-editor-thumbnails" aria-label="Generated images">
    {images.map((image, index) => <button key={image.id} type="button"
      aria-label={'loading' in image ? `Generating image ${index + 1}` : image.label}
      aria-pressed={image.id === activeId} aria-current={image.id === activeId ? 'true' : undefined}
      title={'loading' in image ? 'Generating image…' : image.label} disabled={disabled}
      onContextMenu={event => { if (!('loading' in image)) onContextMenu(event, image); }}
      onClick={() => select(index)} onKeyDown={event => {
        const direction = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1
          : event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : 0;
        if (!direction) return;
        event.preventDefault(); event.stopPropagation();
        select(Math.max(0, images.findIndex(image => image.id === activeId)) + direction);
      }}>
      {'loading' in image ? <LoadingImage thumbnail /> : <img src={imageSrc(image.image, hostId)} alt="" draggable={false} loading="lazy" referrerPolicy="no-referrer" />}
    </button>)}
    <div className="yard-image-editor-thumbnail-tail" aria-hidden="true" />
  </div>;
}

/** Pinned image-side-panel/local-generated-image-side-panel behavior, with the
 * composer attachment state owned by the containing workspace. */
export default function GeneratedImageEditor({ images, loadingImages = noLoadingImages, selectedId, hostId, visible,
  attachedImages, attachedComments, onSelectImage, onAction, onOpenImage, readOnly = false }: GeneratedImageEditorProps) {
  const [view, setView] = useState<View>('focused');
  const [mode, setMode] = useState<Mode>('view');
  const [multiple, setMultiple] = useState(false);
  const [sizes, setSizes] = useState<Record<string, Size>>({});
  const [failures, setFailures] = useState<ReadonlySet<string>>(new Set());
  const [available, setAvailable] = useState<Size>({ width: 0, height: 0 });
  const [focusedZoom, setFocusedZoom] = useState<{ id: string; percent: number }>();
  const [canvasZoom, setCanvasZoom] = useState(100);
  const [menu, setMenu] = useState<'resize' | 'zoom'>();
  const [localSelection, setLocalSelection] = useState<readonly string[]>([]);
  const [optimisticSelection, setOptimisticSelection] = useState<readonly string[]>();
  const [localComments, setLocalComments] = useState<readonly ImageCommentGroup[]>([]);
  const [optimisticComments, setOptimisticComments] = useState<readonly ImageCommentGroup[]>();
  const [draft, setDraft] = useState<CommentDraft>();
  const [brushSize, setBrushSize] = useState(70);
  const [strokes, setStrokes] = useState<readonly Stroke[]>([]);
  const [strokeCount, setStrokeCount] = useState(0);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  const [imageMenu, setImageMenu] = useState<GeneratedImageMenuTarget>();
  const [guideDismissed, setGuideDismissed] = useState(() => browserAtoms()[canvasGuideAtom] === true);
  const [guideReady, setGuideReady] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.reducedMotion === 'true');
  const root = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const brush = useRef<HTMLCanvasElement>(null);
  const brushCursor = useRef<HTMLSpanElement>(null);
  const activeStroke = useRef<Stroke | undefined>(undefined);
  const removeImage = useRef<string | undefined>(undefined);
  const busy = useRef(false);
  const lastCanvasImage = useRef<string>(selectedId);
  const transition = useRef<{ rect: DOMRect; id: string } | undefined>(undefined);
  const animation = useRef<Animation | undefined>(undefined);
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  const pendingImages = loadingImages.filter(image => !images.some(complete => complete.id === image.id));
  const requestedLoading = pendingImages.find(image => image.id === selectedId);
  const previousImage = useRef(selectedId);
  const requestedImage = images.find(image => image.id === selectedId);
  useEffect(() => { if (requestedImage) previousImage.current = requestedImage.id; }, [requestedImage?.id]);
  const current = requestedImage ?? (requestedLoading ? undefined : images.find(image => image.id === previousImage.current) ?? images[0]);
  const loadingCurrent = requestedLoading ?? (current ? undefined : pendingImages[0]);
  const activeId = loadingCurrent?.id ?? current?.id;
  const showGuide = !readOnly && visible && Boolean(activeId) && guideReady && !guideDismissed && mode === 'view' && !pending && !draft;
  const allImages: CanvasImage[] = [...images, ...pendingImages.map(image => ({ ...image, loading: true as const }))];
  const imageIds = new Set(images.map(image => image.id));
  const selected = (optimisticSelection ?? attachedImages ?? localSelection).filter(id => imageIds.has(id));
  const groups = (optimisticComments ?? attachedComments ?? localComments).filter(group => imageIds.has(group.image.id));
  const commentCount = groups.reduce((count, group) => count + group.comments.length, 0);
  const dimensions = current ? sizes[current.id] : undefined;
  const fit = dimensions && available.width > 0 && available.height > 0
    ? Math.min(1, available.width / dimensions.width, available.height / dimensions.height) * 100 : 100;
  const percent = view === 'canvas' ? canvasZoom : focusedZoom && focusedZoom.id === current?.id ? focusedZoom.percent : fit;
  const imageGroups = useMemo(() => {
    const grouped = new Map<string, { id: string; startedAt?: number; images: CanvasImage[] }>();
    for (const image of [...images, ...loadingImages.filter(image => !images.some(complete => complete.id === image.id)).map(image => ({ ...image, loading: true as const }))]) {
      const key = image.turnId ?? image.id;
      const group = grouped.get(key) ?? { id: key, startedAt: image.startedAt, images: [] };
      group.images.push(image); grouped.set(key, group);
    }
    return [...grouped.values()];
  }, [images, loadingImages]);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element || !visible || view !== 'focused') return;
    const measure = () => {
      const style = getComputedStyle(element);
      const width = Math.max(0, element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
      const height = Math.max(0, element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom));
      setAvailable(previous => previous.width === width && previous.height === height ? previous : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, [visible, view, images.length, loadingImages.length, mode]);

  useLayoutEffect(() => {
    const source = transition.current;
    if (!source || !root.current) return;
    transition.current = undefined;
    const target = [...root.current.querySelectorAll<HTMLImageElement>('[data-editor-image]')]
      .find(image => image.dataset.editorImage === source.id);
    if (!target || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const destination = target.getBoundingClientRect();
    if (!destination.width || !destination.height) return;
    animation.current?.cancel();
    animation.current = target.animate([
      { transform: `translate(${source.rect.x - destination.x}px, ${source.rect.y - destination.y}px) scale(${source.rect.width / destination.width}, ${source.rect.height / destination.height})`, transformOrigin: 'top left' },
      { transform: 'none', transformOrigin: 'top left' },
    ], { duration: 450, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
  }, [view]);

  useLayoutEffect(() => {
    const canvas = brush.current;
    if (!canvas || !dimensions) return;
    canvas.width = dimensions.width; canvas.height = dimensions.height;
    drawStrokes(canvas, strokes.slice(0, strokeCount));
  }, [dimensions, strokes, strokeCount, mode, current?.id]);

  useEffect(() => {
    if (!visible) return;
    const handler = (event: KeyboardEvent) => keyHandler.current(event);
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [visible]);
  useEffect(() => () => animation.current?.cancel(), []);
  useEffect(() => {
    if (guideReady || guideDismissed || readOnly || !visible || !activeId) return;
    const timer = window.setTimeout(() => setGuideReady(true), 500);
    return () => window.clearTimeout(timer);
  }, [guideReady, guideDismissed, readOnly, visible, activeId]);
  useEffect(() => {
    if (readOnly) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => { if (motion.matches || document.documentElement.dataset.reducedMotion === 'true') setGuideReady(true); };
    motion.addEventListener('change', changed);
    const preference = new MutationObserver(changed);
    preference.observe(document.documentElement, { attributes: true, attributeFilter: ['data-reduced-motion'] });
    return () => { motion.removeEventListener('change', changed); preference.disconnect(); };
  }, [readOnly]);
  useEffect(() => {
    const stored = () => { if (browserAtoms()[canvasGuideAtom] === true) setGuideDismissed(true); };
    const receive = (event: MessageEvent) => {
      if (event.source === window && event.origin === location.origin && event.data?.type === 'persisted-atom-updated'
        && event.data.key === canvasGuideAtom && event.data.value === true) setGuideDismissed(true);
    };
    window.addEventListener('storage', stored); window.addEventListener('message', receive);
    return () => { window.removeEventListener('storage', stored); window.removeEventListener('message', receive); };
  }, []);
  useEffect(() => { if (!visible) setImageMenu(undefined); }, [visible]);
  useLayoutEffect(() => {
    if (menu) root.current?.querySelector<HTMLButtonElement>('[role="menu"] [role="menuitem"]')?.focus();
  }, [menu]);

  async function perform(label: string, action: () => Promise<void>) {
    if (busy.current) return false;
    busy.current = true; setPending(label); setError(undefined);
    try { await action(); return true; }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return false; }
    finally { busy.current = false; setPending(undefined); }
  }

  function applyAction(action: ImageEditAction) {
    if (readOnly || !onAction) return Promise.reject(new Error('The image is read-only.'));
    return onAction(action);
  }

  function dismissGuide() {
    setGuideDismissed(true);
    void writeAtom(canvasGuideAtom, true).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)));
  }

  function openImageMenu(event: React.MouseEvent<HTMLElement>, image: EditableImage, focused = false) {
    if (pending || busy.current || failures.has(image.id) || event.target instanceof Element && event.target.closest('input, textarea, [contenteditable="true"], [role="textbox"]')) return;
    if (focused && (mode !== 'view' || draft || !(event.target instanceof HTMLImageElement))) return;
    const picture = event.currentTarget.querySelector<HTMLImageElement>('img');
    if (!picture?.complete || !picture.naturalWidth) return;
    event.preventDefault(); event.stopPropagation(); setMenu(undefined);
    setImageMenu({ image, x: event.clientX, y: event.clientY, trigger: event.currentTarget });
  }

  async function addToChat(image: EditableImage) {
    if (readOnly || selected.includes(image.id) || groups.some(group => group.image.id === image.id)) return;
    const ids = [...new Set([...selected, ...groups.map(group => group.image.id), image.id])];
    const next = ids.flatMap(id => {
      const existing = groups.find(group => group.image.id === id);
      const item = images.find(item => item.id === id);
      return existing ? [existing] : item ? [{ image: item, comments: [] }] : [];
    });
    if (await syncComments(next)) setLocalSelection(ids);
  }

  async function selectImages(ids: readonly string[]) {
    const next = [...new Set(ids)].filter(id => imageIds.has(id));
    if (busy.current) return;
    setOptimisticSelection(next);
    const ok = await perform('selection', () => applyAction({ kind: 'selection', images: next.flatMap(id => {
      const image = images.find(image => image.id === id); return image ? [image] : [];
    }) }));
    if (ok) setLocalSelection(next);
    setOptimisticSelection(undefined);
  }

  async function syncComments(next: readonly ImageCommentGroup[], submit = false) {
    if (busy.current) return false;
    const ordered = [...next].sort((left, right) => images.findIndex(image => image.id === left.image.id) - images.findIndex(image => image.id === right.image.id));
    setOptimisticComments(ordered);
    const ok = await perform('comments', () => applyAction({ kind: 'comments', groups: ordered, ...submit ? { submit: true } : {} }));
    if (ok) setLocalComments(submit ? [] : ordered);
    setOptimisticComments(undefined);
    return ok;
  }

  async function leaveComments() {
    if (busy.current) return false;
    const ok = await perform('comments', async () => {
      await applyAction({ kind: 'comments', groups: [] });
      await applyAction({ kind: 'selection', images: [] });
    });
    if (ok) { setLocalComments([]); setLocalSelection([]); setDraft(undefined); setMode('view'); setMultiple(false); }
    return ok;
  }

  function navigate(id: string) {
    if (busy.current || draft || id === activeId) return;
    activeStroke.current = undefined;
    setFocusedZoom(undefined); setMenu(undefined); setStrokes([]); setStrokeCount(0);
    onSelectImage?.(id);
  }

  async function changeView(next: View) {
    if (readOnly) return;
    dismissGuide();
    if (busy.current || next === view || mode === 'remove') return;
    const hasComments = groups.some(group => group.comments.length > 0);
    if (current) {
      const element = [...(root.current?.querySelectorAll<HTMLImageElement>('[data-editor-image]') ?? [])]
        .find(image => image.dataset.editorImage === current.id);
      if (element) transition.current = { rect: element.getBoundingClientRect(), id: current.id };
    }
    // The pinned view toggle only changes the view. The new Canvas instance
    // starts in navigate mode and restores confirmed comments from Composer.
    const restoreComment = next === 'focused' && groups.some(group => group.image.id === current?.id && group.comments.length > 0);
    setDraft(undefined); setMenu(undefined); setMultiple(false); setMode(restoreComment ? 'comment' : 'view'); setView(next);
    if (next === 'canvas' && current && !hasComments) { lastCanvasImage.current = current.id; void selectImages([current.id]); }
    else if (multiple && !hasComments) {
      const id = selected.includes(lastCanvasImage.current) ? lastCanvasImage.current : selected.at(-1);
      if (id) { onSelectImage?.(id); void selectImages([id]); } else void selectImages([]);
    }
  }

  async function changeMode(next: Mode) {
    if (busy.current || next === mode) return;
    if (mode === 'comment' && !await leaveComments()) return;
    setMenu(undefined); setDraft(undefined); setMode(next);
    if (next === 'remove') { activeStroke.current = undefined; removeImage.current = current?.id; setStrokes([]); setStrokeCount(0); }
  }

  function activateCanvas(image: EditableImage) {
    if (busy.current) return;
    lastCanvasImage.current = image.id;
    onSelectImage?.(image.id);
    void selectImages(multiple ? selected.includes(image.id) ? selected.filter(id => id !== image.id) : [...selected, image.id] : [image.id]);
  }

  function toggleMultiple() {
    if (busy.current) return;
    const next = !multiple; setMultiple(next);
    if (!next) {
      const id = selected.includes(lastCanvasImage.current) ? lastCanvasImage.current : selected.at(-1);
      if (id) { onSelectImage?.(id); void selectImages([id]); } else void selectImages([]);
    }
  }

  function addDraft(image: EditableImage, event: React.MouseEvent<HTMLButtonElement>) {
    if (busy.current || draft) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setDraft({ id: crypto.randomUUID(), imageId: image.id, x: clamp((event.clientX - rect.left) / rect.width),
      y: clamp((event.clientY - rect.top) / rect.height), text: '', saved: false });
  }

  async function saveDraft() {
    if (!draft?.text.trim() || busy.current) return;
    const image = images.find(image => image.id === draft.imageId);
    if (!image) return;
    const comments = groups.find(group => group.image.id === image.id)?.comments ?? [];
    const comment: ImageComment = { id: draft.id, x: draft.x, y: draft.y, text: draft.text.trim() };
    const next = draft.saved ? comments.map(item => item.id === draft.id ? comment : item) : [...comments, comment];
    if (await syncComments(commentGroups(groups, image, next))) setDraft(undefined);
  }

  async function deleteComment() {
    if (!draft || busy.current) return;
    const image = images.find(image => image.id === draft.imageId);
    if (!image) return;
    const comments = groups.find(group => group.image.id === image.id)?.comments.filter(item => item.id !== draft.id) ?? [];
    if (await syncComments(commentGroups(groups, image, comments))) setDraft(undefined);
  }

  async function sendComments() {
    if (!commentCount || draft || busy.current) return;
    if (await syncComments(groups, true)) { setDraft(undefined); setMode('view'); }
  }

  async function edit(operation: 'remove-background' | 'resize', ratio?: string) {
    if (!current) return;
    setMenu(undefined);
    await perform(operation, () => applyAction({ kind: 'edit', image: current, operation, ...ratio ? { ratio } : {} }));
  }

  async function sendMask() {
    if (!current || !dimensions || !strokeCount || busy.current) return;
    if (current.id !== removeImage.current) { setError('The selected image changed. Choose Remove again to edit this image.'); return; }
    const ok = await perform('remove', async () => {
      const canvas = document.createElement('canvas');
      canvas.width = dimensions.width; canvas.height = dimensions.height;
      drawStrokes(canvas, strokes.slice(0, strokeCount), true);
      const mask = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create the image mask.')), 'image/png'));
      await applyAction({ kind: 'edit', image: current, operation: 'remove', mask });
    });
    if (ok) { setStrokes([]); setStrokeCount(0); setMode('view'); }
  }

  function strokePoint(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
  }

  function moveCursor(event: PointerEvent<HTMLCanvasElement>) {
    const cursor = brushCursor.current;
    if (cursor) {
      const rect = event.currentTarget.getBoundingClientRect(); cursor.hidden = false;
      cursor.style.transform = `translate(${event.clientX - rect.left - brushSize / 2}px, ${event.clientY - rect.top - brushSize / 2}px)`;
    }
  }

  function startStroke(event: PointerEvent<HTMLCanvasElement>) {
    if (busy.current || event.button !== 0 || !dimensions) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    activeStroke.current = { width: brushSize / event.currentTarget.getBoundingClientRect().width, points: [strokePoint(event)] };
    drawStrokes(event.currentTarget, [...strokes.slice(0, strokeCount), activeStroke.current]); moveCursor(event);
  }

  function continueStroke(event: PointerEvent<HTMLCanvasElement>) {
    moveCursor(event);
    if (!activeStroke.current) return;
    activeStroke.current.points.push(strokePoint(event));
    drawStrokes(event.currentTarget, [...strokes.slice(0, strokeCount), activeStroke.current]);
  }

  function endStroke(event: PointerEvent<HTMLCanvasElement>) {
    if (!activeStroke.current) return;
    const next = [...strokes.slice(0, strokeCount), activeStroke.current]; activeStroke.current = undefined;
    setStrokes(next); setStrokeCount(next.length);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function setZoom(next: number | 'fit') {
    setMenu(undefined);
    if (view === 'canvas') setCanvasZoom(next === 'fit' ? 100 : next);
    else setFocusedZoom(next === 'fit' || !current ? undefined : { id: current.id, percent: next });
  }

  function download() {
    if (!current) return;
    void downloadImageCopy(current, hostId).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)));
  }

  keyHandler.current = event => {
    const range = event.target instanceof HTMLInputElement && event.target.type === 'range';
    if (event.defaultPrevented || event.isComposing || (ignoresKeys(event.target) && !range)) return;
    if (pending) return;
    if (mode === 'remove' && (event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')) {
      event.preventDefault();
      activeStroke.current = undefined;
      const redo = event.shiftKey || event.key.toLowerCase() === 'y';
      setStrokeCount(value => Math.max(0, Math.min(strokes.length, value + (redo ? 1 : -1)))); return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') {
      if (draft) setDraft(undefined);
      else if (menu) setMenu(undefined);
      else if (mode === 'comment') void leaveComments();
      else if (mode === 'remove') { activeStroke.current = undefined; setMode('view'); setStrokes([]); setStrokeCount(0); }
      else return;
      event.preventDefault(); return;
    }
    if (range) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (mode === 'remove' || draft || !activeId) return;
      const index = allImages.findIndex(image => image.id === activeId) + (event.key === 'ArrowLeft' ? -1 : 1);
      if (allImages[index]) { event.preventDefault(); navigate(allImages[index].id); }
    } else if (event.key === '+' || event.key === '=' || event.key === '-') {
      event.preventDefault();
      const next = event.key === '-' ? zoomStops.filter(stop => stop < percent).at(-1) : zoomStops.find(stop => stop > percent);
      if (next) setZoom(next);
    } else if (event.key === '0') { event.preventDefault(); setZoom('fit'); }
  };

  function renderImage(image: EditableImage, canvas: boolean) {
    const comments = groups.find(group => group.image.id === image.id)?.comments ?? [];
    const imageDraft = draft?.imageId === image.id ? draft : undefined;
    const size = sizes[image.id];
    const active = image.id === current?.id;
    const style: CSSProperties | undefined = !canvas && size ? { width: size.width * percent / 100, height: size.height * percent / 100 } : undefined;
    return <div key={image.id} className="yard-image-editor-frame" tabIndex={-1} data-image-id={image.id} data-canvas={canvas}
      onContextMenu={event => openImageMenu(event, image, !canvas)}
      data-active={canvas && (mode === 'comment' ? Boolean(imageDraft || comments.length) : multiple ? selected.includes(image.id) : active)} style={style}>
      <img data-editor-image={image.id} data-ready={Boolean(size)} src={imageSrc(image.image, hostId)}
        alt={canvas ? '' : image.label} draggable={false} referrerPolicy="no-referrer" decoding="async"
        onLoad={event => {
          const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
          setSizes(previous => previous[image.id]?.width === width && previous[image.id]?.height === height ? previous : { ...previous, [image.id]: { width, height } });
          setFailures(previous => { if (!previous.has(image.id)) return previous; const next = new Set(previous); next.delete(image.id); return next; });
        }} onError={() => setFailures(previous => new Set(previous).add(image.id))} />
      {failures.has(image.id) && <span className="yard-image-editor-image-error" role="status">Image failed to load</span>}
      {canvas && mode === 'view' && <button type="button" className="yard-image-editor-image-target" aria-label={image.label}
        aria-pressed={multiple ? selected.includes(image.id) : active} disabled={Boolean(pending)} onClick={() => activateCanvas(image)} />}
      {canvas && multiple && mode === 'view' && selected.includes(image.id) && <span className="yard-image-editor-selected" aria-hidden="true"><WorkspaceIcon name="toolSuccess" size={12} /></span>}
      {mode === 'comment' && !failures.has(image.id) && <>
        <button type="button" className="yard-image-editor-comment-surface" aria-label="Image comment surface" disabled={Boolean(pending || draft)} onClick={event => addDraft(image, event)} />
        {comments.map((comment, index) => <button key={comment.id} type="button" className="yard-image-editor-comment-pin"
          aria-label={`Comment ${index + 1}`} aria-pressed={imageDraft?.id === comment.id} title={comment.text}
          disabled={Boolean(pending)} style={{ left: `${comment.x * 100}%`, top: `${comment.y * 100}%` }}
          onClick={() => setDraft({ ...comment, imageId: image.id, saved: true })}>{index + 1}</button>)}
        {imageDraft && <>
          {!imageDraft.saved && <span className="yard-image-editor-comment-pin" aria-hidden="true" style={{ left: `${imageDraft.x * 100}%`, top: `${imageDraft.y * 100}%` }}>{comments.length + 1}</span>}
          <form className="yard-image-editor-comment-draft" data-editing={imageDraft.saved} data-flip={imageDraft.x > .6}
            style={{ left: `${imageDraft.x * 100}%`, top: `${imageDraft.y * 100}%` }}
            onClick={event => event.stopPropagation()} onSubmit={event => { event.preventDefault(); void saveDraft(); }}>
            {imageDraft.saved ? <>
              <textarea autoFocus aria-label="Edit comment" value={imageDraft.text} disabled={Boolean(pending)}
                onChange={event => setDraft({ ...imageDraft, text: event.target.value })}
                onKeyDown={event => {
                  if (event.key === 'Escape') { event.stopPropagation(); setDraft(undefined); }
                  else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void saveDraft(); }
                }} />
              <div className="yard-image-editor-comment-actions">
                <button type="button" className="yard-image-editor-delete" aria-label="Delete comment" title="Delete comment" disabled={Boolean(pending)} onClick={() => void deleteComment()}><ImageEditorIcon name="trash" /></button>
                <span /><button type="button" aria-label="Cancel comment" disabled={Boolean(pending)} onClick={() => setDraft(undefined)}>Cancel</button>
                <button type="submit" className="yard-image-editor-primary" aria-label="Save comment" disabled={Boolean(pending || !imageDraft.text.trim())}>Save</button>
              </div>
            </> : <>
              <input autoFocus aria-label="Add comment" placeholder="Add a comment…" value={imageDraft.text} disabled={Boolean(pending)}
                onChange={event => setDraft({ ...imageDraft, text: event.target.value })}
                onKeyDown={event => {
                  if (event.key === 'Escape') { event.stopPropagation(); setDraft(undefined); }
                  else if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault();
                }} />
              {Boolean(imageDraft.text.trim()) && <button type="submit" className="yard-image-editor-comment-confirm" aria-label="Add comment" disabled={Boolean(pending)}><WorkspaceIcon name="toolSuccess" size={16} /></button>}
            </>}
          </form>
        </>}
      </>}
      {mode === 'remove' && active && !canvas && <>
        <canvas ref={brush} className="yard-image-editor-mask" aria-label="Remove mask"
          onPointerDown={startStroke} onPointerMove={continueStroke} onPointerUp={endStroke} onPointerCancel={endStroke}
          onPointerLeave={() => { if (brushCursor.current) brushCursor.current.hidden = true; }} />
        <span ref={brushCursor} className="yard-image-editor-brush-cursor" hidden style={{ width: brushSize, height: brushSize }} />
      </>}
    </div>;
  }

  return <div ref={root} className="yard-source-image-editor" hidden={!visible} data-view={view} data-mode={mode}
    data-active-image={activeId} data-read-only={readOnly} data-owner-host={hostId} aria-busy={Boolean(pending || loadingCurrent)} onPointerDown={event => {
      if (!(event.target instanceof Element) || event.target.closest('[data-editor-menu], .yard-image-editor-popover')) return;
      setMenu(undefined);
    }}>
    {!activeId ? <div className="yard-image-editor-empty" role="status">No generated images</div> : <>
      {!readOnly && mode !== 'remove' && <div className="yard-image-editor-view-switch" role="group" aria-label="Image view" data-guide={showGuide}>
        <button type="button" aria-label="Focused view" title="Focused view" aria-pressed={view === 'focused'} disabled={Boolean(pending)} onClick={() => void changeView('focused')}><ImageEditorIcon name="focused" /></button>
        <button type="button" aria-label="Canvas view" title="Canvas view" aria-pressed={view === 'canvas'} disabled={Boolean(pending)} onClick={() => void changeView('canvas')}><ImageEditorIcon name="canvas" /></button>
        {showGuide && <div className="yard-image-editor-coachmark" data-image-canvas-coachmark="" role="dialog"
          aria-label={view === 'focused' ? 'Try Canvas view' : 'Try focused view'}>
          <strong>{view === 'focused' ? 'Try Canvas view' : 'Try focused view'}</strong>
          <p>Switch between a focused image and all generated images</p>
          <button type="button" aria-label="Dismiss" data-image-canvas-coachmark-dismiss="" onClick={dismissGuide}><WorkspaceIcon name="closeSmall" size={12} /></button>
        </div>}
      </div>}
      {!readOnly && view === 'focused' && mode !== 'remove' && allImages.length > 1 && <GeneratedImageRail
        images={allImages} activeId={activeId} hostId={hostId} disabled={Boolean(pending || draft)} onSelect={navigate}
        onContextMenu={openImageMenu} />}
      {!readOnly && <div className="yard-image-editor-toolbar" role="toolbar" aria-label="Image editing tools">
        {mode === 'view' ? view === 'focused' ? <>
          <ToolButton icon="comment" disabled={Boolean(pending || !current || failures.has(current.id))} onClick={() => void changeMode('comment')}>Comment</ToolButton>
          <ToolButton icon="removeBackground" disabled={Boolean(pending || !current || failures.has(current.id))} onClick={() => void edit('remove-background')}>Remove BG</ToolButton>
          <ToolButton icon="remove" disabled={Boolean(pending || !current || failures.has(current.id))} onClick={() => void changeMode('remove')}>Remove</ToolButton>
          <div className="yard-image-editor-menu-anchor" data-editor-menu>
            <ToolButton icon="resize" selected={menu === 'resize'} disabled={Boolean(pending || !current || failures.has(current.id))} onClick={() => setMenu(menu === 'resize' ? undefined : 'resize')}>Resize</ToolButton>
            {menu === 'resize' && <div className="yard-image-editor-popover yard-image-editor-ratios" role="menu" aria-label="Resize" onKeyDown={event => {
              if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMenu(undefined); event.currentTarget.parentElement?.querySelector<HTMLButtonElement>('button')?.focus(); }
              else menuKeys(event);
            }}>
              {ratios.map(([icon, name, ratio]) => <button key={ratio} type="button" role="menuitem" aria-label={`${name} ${ratio}`} onClick={() => void edit('resize', ratio)}><ImageEditorIcon name={icon} /><span>{name}</span><small>{ratio}</small></button>)}
            </div>}
          </div>
        </> : <>
          <ToolButton icon="comment" disabled={Boolean(pending || !images.length)} onClick={() => void changeMode('comment')}>Comment</ToolButton>
          <ToolButton icon="multiselect" selected={multiple} disabled={Boolean(pending || !images.length)} onClick={toggleMultiple}>Multi-select</ToolButton>
        </> : <>
          <span className="yard-image-editor-hint" data-empty={!commentCount}>{mode === 'remove' ? 'Brush over what you want to remove' : commentCount ? `${commentCount} comment${commentCount === 1 ? '' : 's'}` : view === 'canvas' ? 'Add comments on multiple images to batch edit them' : 'Click on the image to add comments'}</span>
          <button type="button" className="yard-image-editor-primary" aria-label="Send edits" disabled={Boolean(pending || draft || loadingCurrent || (mode === 'remove' ? !strokeCount : !commentCount))}
            onClick={() => void (mode === 'remove' ? sendMask() : sendComments())}>{pending && <WorkspaceIcon name="runningSpinner" size={14} className="yard-image-editor-spinner" />}Send</button>
          <button type="button" className="yard-image-editor-icon-button" aria-label="Cancel" title="Cancel" disabled={Boolean(pending)}
            onClick={() => { if (mode === 'comment') void leaveComments(); else { activeStroke.current = undefined; setMode('view'); setStrokes([]); setStrokeCount(0); } }}><WorkspaceIcon name="closeSmall" size={12} /></button>
        </>}
      </div>}
      <div className="yard-image-editor-top-right">
        {view === 'focused' && <button type="button" className="yard-image-editor-download" aria-label="Download" title="Download" disabled={!current || failures.has(current.id)} onClick={download}><ImageEditorIcon name="download" /></button>}
        <div className="yard-image-editor-menu-anchor" data-editor-menu>
          <button type="button" className="yard-image-editor-zoom" aria-label="Zoom" aria-haspopup="menu" aria-expanded={menu === 'zoom'} onClick={() => setMenu(menu === 'zoom' ? undefined : 'zoom')}>
            {Math.round(percent)}%<WorkspaceIcon name="questionChevron" size={10} />
          </button>
          {menu === 'zoom' && <div className="yard-image-editor-popover yard-image-editor-zoom-options" role="menu" aria-label="Zoom" onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMenu(undefined); event.currentTarget.parentElement?.querySelector<HTMLButtonElement>('button')?.focus(); }
            else menuKeys(event);
          }}>
            {view === 'focused' && <button type="button" role="menuitem" onClick={() => setZoom('fit')}>Fit</button>}
            {zoomStops.map(stop => <button key={stop} type="button" role="menuitem" onClick={() => setZoom(stop)}>{stop}%</button>)}
          </div>}
        </div>
      </div>
      {mode === 'remove' && <>
        <div className="yard-image-editor-brush-control"><input type="range" aria-label="Brush size" min={5} max={130} step={1} value={brushSize} disabled={Boolean(pending)} onChange={event => setBrushSize(Number(event.target.value))} /></div>
        {strokes.length > 0 && <div className="yard-image-editor-history">
          <button type="button" aria-label="Undo" title="Undo" disabled={Boolean(pending || !strokeCount)} onClick={() => setStrokeCount(value => Math.max(0, value - 1))}><WorkspaceIcon name="goalRevert" size={16} /></button>
          <button type="button" aria-label="Redo" title="Redo" disabled={Boolean(pending || strokeCount >= strokes.length)} onClick={() => setStrokeCount(value => Math.min(strokes.length, value + 1))}><WorkspaceIcon name="goalRevert" size={16} className="yard-image-editor-redo" /></button>
        </div>}
      </>}
      {view === 'focused' ? <div ref={viewport} className="yard-image-editor-focus-viewport" data-rail={mode !== 'remove' && allImages.length > 1} data-manual-zoom={focusedZoom?.id === current?.id && Boolean(current)}>
        <div className="yard-image-editor-focus-plane">{loadingCurrent
          ? <div data-loading-image={loadingCurrent.id}><LoadingImage single size={Math.min(available.width, available.height) || 320} /></div>
          : current ? renderImage(current, false) : null}</div>
      </div> : <div className="yard-image-editor-canvas-viewport">
        <div className="yard-image-editor-canvas-content" style={{ zoom: canvasZoom / 100 }}>
          {imageGroups.map(group => <div key={group.id} className="yard-image-editor-canvas-group" data-turn-id={group.id} data-dated={Boolean(group.startedAt)}>
            {group.startedAt !== undefined && <time dateTime={new Date(group.startedAt * (group.startedAt < 1e12 ? 1000 : 1)).toISOString()}>
              {new Date(group.startedAt * (group.startedAt < 1e12 ? 1000 : 1)).toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </time>}
            {group.images.map(image => 'loading' in image
              ? <div key={image.id} className="yard-image-editor-canvas-loading" data-loading-image={image.id}><LoadingImage /></div>
              : renderImage(image, true))}
          </div>)}
          <div className="yard-image-editor-canvas-tail" />
        </div>
      </div>}
      {pending && mode === 'view' && <div className="yard-image-editor-pending" role="status"><WorkspaceIcon name="runningSpinner" size={14} className="yard-image-editor-spinner" />{pending === 'remove-background' ? 'Removing background…' : pending === 'resize' ? 'Resizing image…' : 'Updating…'}</div>}
      {error && <div className="yard-image-editor-error" role="alert">{error}<button type="button" aria-label="Dismiss error" onClick={() => setError(undefined)}><WorkspaceIcon name="closeSmall" size={12} /></button></div>}
      {visible && imageMenu && <GeneratedImageMenu target={imageMenu} hostId={hostId} canAdd={!readOnly}
        onAdd={addToChat} onOpen={image => {
          if (onOpenImage) onOpenImage(image);
          else window.open(imageSrc(image.image, hostId), '_blank', 'noopener,noreferrer');
        }} onError={setError} close={() => setImageMenu(undefined)} />}
    </>}
  </div>;
}
