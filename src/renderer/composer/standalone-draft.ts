import type { ComposerContext, ComposerDraft, ComposerImage } from '../workbench-contract.ts';

export interface DraftImage extends ComposerImage {
  previewSrc: string;
}
export interface Draft extends ComposerDraft {
  images: DraftImage[];
  references: { id: string; text: string }[];
}
interface StoredDraft { revision: string; draft: Draft; prefills: string[] }

export function createId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export const emptyDraft = (): Draft => ({ text: '', images: [], files: [], references: [] });
export function normalizeDraft(draft: ComposerDraft): Draft {
  return {
    text: draft.text,
    images: draft.images.map(image => ({ ...image, previewSrc: image.previewSrc ?? image.src })),
    files: draft.files.map(file => ({ ...file })),
    references: (draft.references ?? []).map(reference => ({ ...reference })),
  };
}
export function draftKey(context: ComposerContext): string {
  return 'codex-yard.composer.v1:' + JSON.stringify([context.hostId, context.threadId, context.threadId == null ? context.cwd : null]);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
function validDraft(value: unknown): value is Draft {
  if (!isRecord(value) || typeof value.text !== 'string' || !Array.isArray(value.images)
    || !Array.isArray(value.files) || !Array.isArray(value.references)) return false;
  return value.images.every(image => isRecord(image) && typeof image.id === 'string' && typeof image.src === 'string'
      && typeof image.previewSrc === 'string' && (image.path === undefined || typeof image.path === 'string')
      && (image.name === undefined || typeof image.name === 'string'))
    && value.files.every(file => isRecord(file) && typeof file.path === 'string' && typeof file.name === 'string')
    && value.references.every(reference => isRecord(reference) && typeof reference.id === 'string' && typeof reference.text === 'string');
}
export function readDraft(key: string): StoredDraft | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!isRecord(value) || typeof value.revision !== 'string' || !validDraft(value.draft)
      || !Array.isArray(value.prefills) || !value.prefills.every(id => typeof id === 'string')) return null;
    return { revision: value.revision, draft: value.draft, prefills: value.prefills };
  } catch { return null; }
}
export function writeDraft(key: string, value: StoredDraft): boolean {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
export function mergePrefill(current: Draft, incoming: ComposerDraft): Draft {
  const next = normalizeDraft(incoming);
  const merge = <T,>(left: T[], right: T[], id: (value: T) => string): T[] => {
    const seen = new Set(left.map(id));
    return [...left, ...right.filter(value => {
      const key = id(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })];
  };
  return {
    text: current.text && next.text ? current.text + '\n' + next.text : current.text || next.text,
    images: merge(current.images, next.images, value => value.id),
    files: merge(current.files, next.files, value => value.path),
    references: merge(current.references, next.references, value => value.id),
  };
}

export type QueueInput = { type: 'text'; text: string; text_elements: [] }
  | { type: 'image'; url: string }
  | { type: 'localImage'; path: string };
export function draftToInput(draft: ComposerDraft, hostId: string): QueueInput[] {
  const parts = [draft.text, ...draft.files.map(file => file.path), ...(draft.references ?? []).map(reference => reference.text)].filter(Boolean);
  const input: QueueInput[] = parts.length ? [{ type: 'text', text: parts.join('\n'), text_elements: [] }] : [];
  for (const image of draft.images) {
    if (hostId === 'local' && image.path) input.push({ type: 'localImage', path: image.path });
    else if (/^data:image\//i.test(image.src) || /^https?:/i.test(image.src)) input.push({ type: 'image', url: image.src });
    else {
      let path = image.src;
      if (/^file:\/\//i.test(path)) {
        try { path = decodeURIComponent(path.replace(/^file:\/\//i, '')); } catch { /* Preserve the original path. */ }
      }
      input.push({ type: 'localImage', path });
    }
  }
  return input;
}
export function hasContent(draft: Draft): boolean {
  return !!(draft.text.trim() || draft.images.length || draft.files.length || draft.references.length);
}
