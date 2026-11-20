import { ArrowLeft, ArrowRight, Download, ImageOff, LoaderCircle, Minus, Plus, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import type { PromptImage } from './composer-input.ts';
import { attachmentUrl } from './output-types.ts';
import './conversation-images.css';

const imageLabel = 'User attachment';
const zoomStops = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500];

export function imageSrc(image: PromptImage, hostId: string) {
  return image.path !== undefined ? attachmentUrl(hostId, image.path) : image.url;
}

function ImageThumbnail({ src, open, label = imageLabel }: { src: string; open: () => void; label?: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  return <button type="button" className="yard-source-message-thumbnail" aria-label={label}
    disabled={state !== 'ready'} onClick={open} data-state={state}>
    {state === 'loading' && <LoaderCircle size={16} role="img" aria-label="Loading image" />}
    {state === 'failed' && <ImageOff size={16} role="img" aria-label="Image failed to load" />}
    {state !== 'failed' && <img src={src} alt={label} loading="lazy"
      decoding="async" referrerPolicy="no-referrer" onLoad={() => setState('ready')} onError={() => setState('failed')} />}
  </button>;
}

export function ImagePreview({ image, hostId, close, previous, next, label = imageLabel }: {
  image: PromptImage; hostId: string; close: () => void; previous?: () => void; next?: () => void; label?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  const [natural, setNatural] = useState<{ src: string; width: number; height: number }>();
  const [failed, setFailed] = useState<string>();
  const [zoom, setZoom] = useState<{ src: string; percent: number }>();
  const src = imageSrc(image, hostId);
  const dimensions = natural?.src === src ? natural : undefined;
  const fit = dimensions && available.width > 0 && available.height > 0
    ? Math.min(1, available.width / dimensions.width, available.height / dimensions.height) * 100
    : undefined;
  const percent = zoom?.src === src ? zoom.percent : fit;
  const stops = fit === undefined || zoomStops.includes(fit) ? zoomStops : [...zoomStops, fit].sort((a, b) => a - b);
  const zoomIn = percent === undefined ? undefined : stops.find(stop => stop > percent);
  const zoomOut = percent === undefined ? undefined : stops.filter(stop => stop < percent).at(-1);

  useLayoutEffect(() => {
    const modal = dialog.current;
    const plane = viewport.current;
    if (!modal || !plane) return;
    if (!modal.open) modal.showModal();
    closeButton.current?.focus({ preventScroll: true });
    const measure = () => setAvailable({ width: plane.clientWidth, height: plane.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(plane);
    return () => observer.disconnect();
  }, []);

  function step(change: (() => void) | undefined) {
    if (!change) return;
    setZoom(undefined);
    viewport.current?.scrollTo(0, 0);
    change();
  }

  function download() {
    const link = document.createElement('a');
    link.href = image.path !== undefined ? attachmentUrl(hostId, image.path, true, image.name) : image.url;
    link.download = image.name;
    link.click();
  }

  return <dialog ref={dialog} role="dialog" className="yard-source-image-preview" aria-label="Image preview"
    data-gallery={Boolean(previous || next)}
    onClose={close} onClick={event => { if (event.currentTarget === event.target) dialog.current?.close(); }}
    onKeyDown={event => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      step(event.key === 'ArrowLeft' ? previous : next);
    }}>
    <h2 className="sr-only">Image preview</h2>
    <div className="yard-source-image-preview-toolbar">
      <button type="button" aria-label="Download image" title="Download image" disabled={failed === src}
        onClick={download}><Download size={16} /></button>
      <button type="button" ref={closeButton} aria-label="Close image preview" title="Close image preview"
        onClick={() => dialog.current?.close()}><X size={18} /></button>
    </div>
    {previous && <button type="button" className="yard-source-image-previous" aria-label="Previous image"
      title="Previous image" onClick={() => { closeButton.current?.focus(); step(previous); }}><ArrowLeft size={18} /></button>}
    {next && <button type="button" className="yard-source-image-next" aria-label="Next image"
      title="Next image" onClick={() => { closeButton.current?.focus(); step(next); }}><ArrowRight size={18} /></button>}
    <div ref={viewport} className="yard-source-image-preview-viewport">
      <div className="yard-source-image-preview-plane"
        onClick={event => { if (event.currentTarget === event.target) dialog.current?.close(); }}>
        {failed === src ? <span className="yard-source-image-preview-failed" role="status">Image failed to load</span> :
          <img key={src} src={src} alt={label} draggable={false} decoding="async" referrerPolicy="no-referrer"
          style={dimensions && percent !== undefined ? {
            width: dimensions.width * percent / 100, height: dimensions.height * percent / 100,
          } : undefined}
          onLoad={event => {
            const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
            setNatural({ src, width, height });
          }} onError={() => setFailed(src)} />}
      </div>
    </div>
    <div className="yard-source-image-preview-zoom">
      <button type="button" aria-label="Zoom out image" title="Zoom out image" disabled={zoomOut === undefined}
        onClick={() => { if (zoomOut !== undefined) setZoom({ src, percent: zoomOut }); }}><Minus size={16} /></button>
      <span>{percent === undefined ? '' : Math.round(percent) + '%'}</span>
      <button type="button" aria-label="Zoom in image" title="Zoom in image" disabled={zoomIn === undefined}
        onClick={() => { if (zoomIn !== undefined) setZoom({ src, percent: zoomIn }); }}><Plus size={16} /></button>
    </div>
  </dialog>;
}

export function ConversationImages({ images, hostId, label = imageLabel, className = '' }: {
  images: readonly PromptImage[]; hostId: string; label?: string; className?: string;
}) {
  const [index, setIndex] = useState<number>();
  const current = index === undefined ? undefined : images[index];
  return <>
    <div className={'yard-source-message-images ' + className}>
      {images.map((image, index) => <ImageThumbnail key={index} src={imageSrc(image, hostId)} label={label} open={() => setIndex(index)} />)}
    </div>
    {current && index !== undefined && <ImagePreview image={current} hostId={hostId} label={label} close={() => setIndex(undefined)}
      previous={index > 0 ? () => setIndex(index - 1) : undefined}
      next={index + 1 < images.length ? () => setIndex(index + 1) : undefined} />}
  </>;
}
