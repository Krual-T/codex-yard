import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { resolveFilePath, safeExternalUrl } from './message-data.ts';
import type { ImageSource } from './message-data.ts';

type ImageLoad = { key: string; url?: string; error?: string };
type ImageProps = {
  source: ImageSource;
  client: WorkbenchClient;
  hostId: string;
  cwd: string;
  onOpen?: () => void;
  fullSize?: boolean;
};

export function MessageImage({ source, client, hostId, cwd, onOpen, fullSize = false }: ImageProps) {
  const [reload, setReload] = useState(0);
  const [visible, setVisible] = useState(fullSize || source.kind !== 'path');
  const anchor = useRef<HTMLSpanElement>(null);
  const key = `${hostId}\0${cwd}\0${source.kind}\0${source.value}\0${reload}`;
  const [image, setImage] = useState<ImageLoad>({ key: '' });
  useEffect(() => {
    if (visible) return;
    const element = anchor.current;
    if (!element) return;
    const show = () => setVisible(true);
    window.addEventListener('beforeprint', show);
    if (typeof IntersectionObserver === 'undefined') show();
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) show();
    }, { rootMargin: '200px' });
    observer?.observe(element);
    return () => { observer?.disconnect(); window.removeEventListener('beforeprint', show); };
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    if (source.kind === 'fileId') {
      setImage({ key, error: 'Image file ID cannot be resolved by this host.' });
    } else if (source.kind === 'url') {
      const url = safeExternalUrl(source.value, true);
      setImage(url == null ? { key, error: 'Unsupported image address.' } : { key, url });
    } else {
      setImage({ key });
      void client.host<{ contentsBase64: string | null; mimeType?: string }>('read-file-binary', {
        hostId, path: resolveFilePath(source.value, cwd), maxBytes: 10 * 1024 * 1024,
      }).then((result) => {
        if (!active) return;
        if (typeof result.contentsBase64 !== 'string') setImage({ key, error: 'Image exceeds the preview size limit.' });
        else if (!result.mimeType?.startsWith('image/')) setImage({ key, error: 'The file is not a supported image.' });
        else setImage({ key, url: `data:${result.mimeType};base64,${result.contentsBase64}` });
      }, (error: unknown) => {
        if (active) setImage({ key, error: error instanceof Error ? error.message : 'Image could not be loaded.' });
      });
    }
    return () => { active = false; };
  }, [client, cwd, hostId, key, source.kind, source.value, visible]);

  const current = image.key === key ? image : { key };
  let content;
  if (current.error) content = <span className="yard-image-error" role="status">
    <span>{current.error}</span>{source.kind === 'path' && <button type="button" onClick={() => setReload((value) => value + 1)}>Retry</button>}
  </span>;
  else if (!current.url) content = <span className="yard-image-loading" role="status">Loading image...</span>;
  else {
    const imageElement = <img src={current.url} alt={source.label} loading="lazy"
      onError={() => setImage({ key, error: 'Image could not be displayed.' })} />;
    content = onOpen && !fullSize
      ? <button type="button" className="yard-image-button" aria-label={`Open ${source.label}`} onClick={onOpen}>{imageElement}</button>
      : <span className={fullSize ? 'yard-image-full' : 'yard-image-inline'}>{imageElement}</span>;
  }
  return <span ref={anchor} className="yard-image-shell">{content}</span>;
}

type ImageViewerProps = {
  images: ImageSource[];
  index: number;
  client: WorkbenchClient;
  hostId: string;
  cwd: string;
  onIndexChange: (index: number) => void;
  onClose: () => void;
};

export function ImageViewer({ images, index, client, hostId, cwd, onIndexChange, onClose }: ImageViewerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      else if (event.key === 'ArrowLeft' && index > 0) { event.preventDefault(); onIndexChange(index - 1); }
      else if (event.key === 'ArrowRight' && index < images.length - 1) { event.preventDefault(); onIndexChange(index + 1); }
      else if (event.key === 'Tab') {
        const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
        if (buttons.length === 0) return;
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [images.length, index, onClose, onIndexChange]);
  const image = images[index];
  if (!image) return null;
  return <div ref={dialogRef} className="yard-image-overlay" role="dialog" aria-modal="true" aria-label="Image preview" onClick={onClose}>
    <div className="yard-image-dialog" onClick={(event) => event.stopPropagation()}>
      <div className="yard-image-toolbar"><span>{image.label} {index + 1} / {images.length}</span>
        <button ref={closeRef} type="button" className="yard-icon-button" title="Close" aria-label="Close image preview" onClick={onClose}><X size={18} /></button></div>
      <div className="yard-image-stage">
        <button type="button" className="yard-icon-button" title="Previous image" aria-label="Previous image" disabled={index === 0} onClick={() => onIndexChange(index - 1)}><ChevronLeft size={20} /></button>
        <MessageImage source={image} client={client} hostId={hostId} cwd={cwd} fullSize />
        <button type="button" className="yard-icon-button" title="Next image" aria-label="Next image" disabled={index === images.length - 1} onClick={() => onIndexChange(index + 1)}><ChevronRight size={20} /></button>
      </div>
    </div>
  </div>;
}
