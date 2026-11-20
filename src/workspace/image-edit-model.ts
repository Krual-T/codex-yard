import type { ThreadItemSummary } from '../../lib/codex-protocol.ts';
import type { PromptImage } from './composer-input.ts';

export type EditableImage = { id: string; image: PromptImage; label: string; turnId?: string; startedAt?: number };
export type ImageComment = { id: string; x: number; y: number; text: string };
export type ImageCommentGroup = { image: EditableImage; comments: readonly ImageComment[]; imageNumber?: number };
export type ImageEditAction =
  | { kind: 'selection'; images: readonly EditableImage[] }
  | { kind: 'comments'; groups: readonly ImageCommentGroup[]; submit?: boolean }
  | { kind: 'edit'; image: EditableImage; operation: 'remove-background' | 'remove' | 'resize'; ratio?: string; mask?: Blob };

/** Pinned app-initial bmd: generated selections have a stable attachment ID. */
export function generatedImageId(image: EditableImage): string { return 'image-playground:' + image.id; }

/** Pinned image-side-panel So: local edits attach the original, then the mask. */
export function imageEditPrompt(action: Extract<ImageEditAction, { kind: 'edit' }>): string {
  switch (action.operation) {
    case 'remove-background': return 'Remove the background from this image. Keep all foreground subjects unchanged and fully intact, with clean, smooth edges. Make the background transparent.';
    case 'remove': return 'Remove the area marked in the second image from the first image';
    case 'resize':
      if (!action.ratio?.trim()) throw new Error('An aspect ratio is required to resize an image.');
      return 'Make the aspect ratio ' + action.ratio;
  }
}

const percent = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 1 });
/** Pinned app-primary mut/hut (ul), including _ut's empty-group filtering.
 * imageNumber is the position in all submitted image attachments, including
 * uncommented images; otherwise the input order supplies that position.
 */
export function imageCommentPrompt(groups: readonly ImageCommentGroup[], prompt: string): string {
  const sections = groups.flatMap(({ comments, imageNumber }, index) => comments.length ? [
    ['Image ' + (imageNumber ?? index + 1) + ':', ...comments.map((comment, commentIndex) =>
      `${commentIndex + 1}. (x: ${percent.format(Math.min(Math.max(comment.x, 0), 1))}, y: ${percent.format(Math.min(Math.max(comment.y, 0), 1))}) ${comment.text}`)].join('\n'),
  ] : []);
  if (!sections.length) return prompt;
  const instruction = prompt.trim();
  if (instruction) sections.push('Additional instructions:\n' + instruction);
  return sections.join('\n\n');
}

// Pinned L3t/R3t. Keep the existing gallery's saved-path preference and source
// normalization when moving extraction into this pure model.
function generatedImage(item: ThreadItemSummary): PromptImage | undefined {
  const name = 'generated-image.png';
  const path = typeof item.savedPath === 'string' ? item.savedPath.trim() : '';
  if (path) return { path, name };
  const result = typeof item.result === 'string' ? item.result.trim() : '';
  if (!result) return;
  let localPath: string | undefined;
  if (/^(?:file|app):\/\//i.test(result)) {
    try { localPath = decodeURIComponent(new URL(result).pathname.replace(/^\/@fs(?=\/)/, '')); }
    catch { return; }
  } else if (/^(?:\/|[a-z]:[\\/]|\\\\)/i.test(result)) localPath = result.replace(/^\/@fs(?=\/)/, '');
  if (localPath) return { path: localPath, name };
  if (/^(?:data:image\/|https?:\/\/)/i.test(result)) return { url: result, name };
  if (/^[a-z\d+/]+={0,2}$/i.test(result)) return { url: 'data:image/png;base64,' + result, name };
}

export function extractGeneratedImages(items: readonly ThreadItemSummary[], turnId?: string, startedAt?: number): EditableImage[] {
  const images: EditableImage[] = [];
  for (const item of items) {
    if (item.type !== 'imageGeneration') continue;
    const image = generatedImage(item);
    if (image) images.push({ id: item.id, image, label: 'Generated image ' + (images.length + 1),
      ...turnId === undefined ? {} : { turnId }, ...startedAt === undefined ? {} : { startedAt } });
  }
  return images;
}
