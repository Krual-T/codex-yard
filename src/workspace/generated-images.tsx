import { useContext, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { ThreadItemSummary } from '../../lib/codex-protocol.ts';
import { imageSrc, ImagePreview } from './conversation-images.tsx';
import { ImageGenerationLoading } from './image-generation-loading.tsx';
import './generated-images.css';
import { WorkspaceOutputLinks } from './message-markdown.tsx';
import { extractGeneratedImages } from './image-edit-model.ts';

/** Pinned GeneratedImageGallery, layout="thumbnails" and schema I/F. */
export default function GeneratedImages({ items, active, hostId, turnId, startedAt }: {
  items: readonly ThreadItemSummary[]; active: boolean; hostId: string; turnId: string; startedAt?: number | null;
}) {
  const links = useContext(WorkspaceOutputLinks);
  const generations = items.filter(item => item.type === 'imageGeneration');
  const images = extractGeneratedImages(generations, turnId, startedAt ?? undefined);
  const loaded = new Set(images.map(image => image.id));
  const pending = active ? generations.filter(item => !loaded.has(item.id) &&
    (item.status === 'inProgress' || item.status === 'in_progress')).length : 0;
  const [selectedId, setSelectedId] = useState<string>();
  const [previewId, setPreviewId] = useState<string>();
  const main = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  const [ratios, setRatios] = useState<Record<string, { src: string; ratio: number }>>({});
  const selectedIndex = Math.max(0, images.findIndex(image => image.id === selectedId));
  const selected = images[selectedIndex];
  const previewIndex = images.findIndex(image => image.id === previewId);
  const preview = images[previewIndex];
  const src = selected && imageSrc(selected.image, hostId);
  const observed = selected && ratios[selected.id];
  const ratio = observed && observed.src === src ? observed.ratio : 1;
  const rail = images.length + pending > 1;
  const hasSelected = Boolean(selected);
  useLayoutEffect(() => {
    const node = main.current;
    if (!node) return;
    const measure = () => setHeight(node.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, [hasSelected]);
  if (!images.length && !pending) return null;
  const maxWidth = ratio >= 2 ? '100%' : ratio >= 1 ? '480px' : '400px';
  const style = { '--yard-generated-ratio': ratio, maxWidth } as CSSProperties;
  return <div className="yard-source-generated-images" data-thumbnails={rail || undefined}>
    {selected ? <div className="yard-source-generated-main" style={style} ref={main}>
      <button type="button" className="yard-source-generated-image" aria-label={'Generated image ' + (selectedIndex + 1)}
        onClick={() => links?.openImages ? links.openImages(images, selected.id) : setPreviewId(selected.id)} data-testid="generated-image-preview">
        <img key={src} src={src} alt={'Generated image ' + (selectedIndex + 1)} referrerPolicy="no-referrer"
          decoding="async" onLoad={event => {
            const image = event.currentTarget;
            if (image.naturalWidth && image.naturalHeight) setRatios(before => ({ ...before,
              [selected.id]: { src: src!, ratio: image.naturalWidth / image.naturalHeight } }));
          }} />
      </button>
    </div> : <div className="yard-source-generated-pending"><ImageGenerationLoading /></div>}
    {rail && <div className="yard-source-generated-thumbnails" role="group" aria-label="Generated images" style={{ maxHeight: height }}>
      {images.map(({ id, image }, index) => <button key={id} type="button" aria-label={'Show generated image ' + (index + 1)}
        aria-pressed={index === selectedIndex} onClick={() => setSelectedId(id)}>
        <img src={imageSrc(image, hostId)} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" />
      </button>)}
      {Array.from({ length: pending }, (_, index) => <div className="yard-source-generated-pending-thumbnail" key={'pending-' + index}
        aria-hidden={!images.length || index > 0}><ImageGenerationLoading thumbnail /></div>)}
    </div>}
    {preview && <ImagePreview image={preview.image} hostId={hostId} label={'Generated image ' + (previewIndex + 1)}
      close={() => setPreviewId(undefined)} previous={previewIndex > 0 ? () => setPreviewId(images[previewIndex - 1]!.id) : undefined}
      next={previewIndex + 1 < images.length ? () => setPreviewId(images[previewIndex + 1]!.id) : undefined} />}
  </div>;
}
