import { useEffect, useLayoutEffect, useRef } from 'react';
import { writeClipboardText } from '../native/browser-clipboard.ts';
import { imageSrc } from './conversation-images.tsx';
import type { EditableImage } from './image-edit-model.ts';
import { attachmentUrl } from './output-types.ts';
import './generated-image-menu.css';

export type GeneratedImageMenuTarget = { image: EditableImage; x: number; y: number; trigger: HTMLElement };

function animated(image: EditableImage) {
  const metadata = image as EditableImage & { isAnimated?: boolean };
  return metadata.isAnimated === true || /^data:image\/gif[;,]/i.test(image.image.url ?? '')
    || [image.image.path, image.image.url, image.image.name].some(value => value && /\.gif(?:$|[?#])/i.test(value));
}

/** Native Copy image writes PNG, including when the displayed source is JPEG
 * or WebP. Loading through an image avoids a fetch of data: URLs under CSP. */
export async function imagePng(image: EditableImage, hostId: string): Promise<Blob> {
  const source = imageSrc(image.image, hostId);
  const picture = new Image();
  const url = new URL(source, location.href);
  if (/^https?:$/.test(url.protocol) && url.origin !== location.origin) picture.crossOrigin = 'anonymous';
  picture.referrerPolicy = 'no-referrer';
  picture.src = source;
  try { await picture.decode(); }
  catch { throw new Error('Could not load the image for copying.'); }
  if (!picture.naturalWidth || !picture.naturalHeight) throw new Error('The image has no pixel data.');
  const canvas = document.createElement('canvas');
  canvas.width = picture.naturalWidth; canvas.height = picture.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not copy image.');
  context.drawImage(picture, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    try { canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not copy image.')), 'image/png'); }
    catch { reject(new Error('This image server does not allow copying image pixels.')); }
  });
}

export async function downloadImageCopy(image: EditableImage, hostId: string) {
  const source = image.image;
  const anchor = document.createElement('a');
  anchor.download = source.name;
  let objectUrl: string | undefined;
  if (source.path !== undefined) anchor.href = attachmentUrl(hostId, source.path, true, source.name);
  else if (/^(?:data:|blob:)/i.test(source.url) || new URL(source.url, location.href).origin === location.origin) anchor.href = source.url;
  else {
    const response = await fetch(source.url, { mode: 'cors', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('Could not download image.');
    objectUrl = URL.createObjectURL(await response.blob());
    anchor.href = objectUrl;
  }
  anchor.click();
  if (objectUrl) window.setTimeout(() => URL.revokeObjectURL(objectUrl!), 60_000);
}

export function GeneratedImageMenu({ target, hostId, canAdd, onAdd, onOpen, onError, close }: {
  target: GeneratedImageMenuTarget; hostId: string; canAdd: boolean;
  onAdd(image: EditableImage): Promise<void>; onOpen(image: EditableImage): void;
  onError(error: string): void; close(): void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const { image, x, y, trigger } = target;
  const address = /^https?:\/\//i.test(image.image.url ?? '') ? image.image.url : undefined;
  const canSelect = !animated(image);
  const canCopy = canSelect && typeof ClipboardItem === 'function' && typeof navigator.clipboard?.write === 'function';
  useLayoutEffect(() => {
    const node = menu.current;
    if (!node) return;
    node.showPopover();
    const { width, height } = node.getBoundingClientRect();
    node.style.left = Math.max(8, Math.min(x, innerWidth - width - 8)) + 'px';
    node.style.top = Math.max(8, Math.min(y, innerHeight - height - 8)) + 'px';
    node.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, [image.id, x, y]);
  useEffect(() => {
    const outside = (event: Event) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) close();
    };
    const scroll = (event: Event) => { if (event.target instanceof Node && !menu.current?.contains(event.target)) close(); };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', close);
    };
  }, [close]);

  function choose(action: () => void | Promise<void>) {
    // Keep ClipboardItem/write in this user activation; its PNG promise can
    // resolve afterward without dropping clipboard permission in Safari.
    try { const result = action(); close(); void Promise.resolve(result).catch(error => onError(error instanceof Error ? error.message : String(error))); }
    catch (error) { close(); onError(error instanceof Error ? error.message : String(error)); }
  }

  return <div ref={menu} role="menu" aria-label="Image actions" data-image-context-menu="" data-image-id={image.id}
    popover="manual" className="yard-generated-image-menu" onContextMenu={event => event.preventDefault()}
    onKeyDown={event => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault(); event.stopPropagation(); close();
        if (trigger.isConnected) trigger.focus({ preventScroll: true });
        return;
      }
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:enabled')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : event.key === 'ArrowUp'
        ? (index - 1 + buttons.length) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
      if (next >= 0) { event.preventDefault(); event.stopPropagation(); buttons[next]?.focus(); }
    }}>
    <button type="button" role="menuitem" onClick={() => choose(() => onOpen(image))}>Open image in new tab</button>
    {address && <button type="button" role="menuitem" onClick={() => choose(() => writeClipboardText(address))}>Copy image address</button>}
    {canAdd && canSelect && <button type="button" role="menuitem" onClick={() => choose(() => onAdd(image))}>Add to chat</button>}
    {canCopy && <button type="button" role="menuitem" onClick={() => choose(() => navigator.clipboard.write([new ClipboardItem({ 'image/png': imagePng(image, hostId) })]))}>Copy image</button>}
    <button type="button" role="menuitem" onClick={() => choose(() => downloadImageCopy(image, hostId))}>Download a copy</button>
  </div>;
}
