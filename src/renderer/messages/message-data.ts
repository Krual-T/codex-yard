import type { ThreadItemSummary } from '../../../lib/codex-protocol.ts';
import type { ComposerDraft } from '../workbench-contract.ts';

export type ImageSource = { kind: 'url' | 'path' | 'fileId'; value: string; label: string };
export type UserContentPart =
  | { kind: 'text'; text: string; hasElements: boolean }
  | { kind: 'image'; image: ImageSource; hasDetail: boolean }
  | { kind: 'reference'; name: string; path: string; referenceType: 'skill' | 'mention' }
  | { kind: 'unsupported'; value: unknown };

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function displayJson(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2) ?? ''; }
  catch { return String(value); }
}

export function parseUserContent(item: ThreadItemSummary): UserContentPart[] {
  return asArray(item.content).map((value): UserContentPart => {
    const input = asRecord(value);
    if (input.type === 'text' && typeof input.text === 'string') {
      return { kind: 'text', text: input.text, hasElements: asArray(input.text_elements).length > 0 };
    }
    if (input.type === 'localImage' && typeof input.path === 'string') {
      return { kind: 'image', image: { kind: 'path', value: input.path, label: input.path.split('/').at(-1) || 'Image' }, hasDetail: input.detail != null };
    }
    if (input.type === 'image') {
      if (typeof input.url === 'string') return { kind: 'image', image: { kind: 'url', value: input.url, label: 'Image' }, hasDetail: input.detail != null };
      if (typeof input.fileId === 'string') return { kind: 'image', image: { kind: 'fileId', value: input.fileId, label: 'Image' }, hasDetail: input.detail != null };
    }
    if ((input.type === 'skill' || input.type === 'mention') && typeof input.name === 'string' && typeof input.path === 'string') {
      return { kind: 'reference', name: input.name, path: input.path, referenceType: input.type };
    }
    return { kind: 'unsupported', value };
  });
}

export function editableDraft(parts: UserContentPart[]): ComposerDraft | null {
  if (parts.some((part) => part.kind === 'unsupported' || part.kind === 'reference'
    || (part.kind === 'text' && part.hasElements)
    || (part.kind === 'image' && (part.image.kind === 'fileId' || part.hasDetail)))) return null;
  const textParts = parts.filter((part) => part.kind === 'text');
  if (textParts.length > 1 || (textParts.length && parts[0]?.kind !== 'text')) return null;
  const images = parts.flatMap((part, index) => part.kind !== 'image' ? [] : [{
    id: `image-${index}`,
    src: part.image.value,
    ...(part.image.kind === 'path' ? { path: part.image.value } : {}),
    name: part.image.label,
  }]);
  return { text: textParts[0]?.text ?? '', images, files: [] };
}

export function resolveFilePath(path: string, cwd: string): string {
  if (path.startsWith('file://')) {
    try {
      const url = new URL(path);
      return !url.hostname || url.hostname === 'localhost' ? decodeURIComponent(url.pathname) : path;
    } catch { return path; }
  }
  return path.startsWith('/') ? path : `${cwd.replace(/\/+$/, '')}/${path}`;
}

export function resolveFileLink(href: string, cwd: string): string {
  const path = href.replace(/#L\d+(?:C\d+)?(?:-L\d+(?:C\d+)?)?$/i, '');
  if (path.startsWith('file://')) return resolveFilePath(path, cwd);
  try { return resolveFilePath(decodeURIComponent(path), cwd); }
  catch { return resolveFilePath(path, cwd); }
}

export function safeExternalUrl(value: string, image = false): string | undefined {
  const url = value.trim();
  if (image && /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z\d+/=\s]+$/i.test(url)) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (!image && /^(?:mailto:|#)/i.test(url)) return url;
  return undefined;
}

export function imageFromGeneration(item: ThreadItemSummary): ImageSource | null {
  if (typeof item.savedPath === 'string' && item.savedPath.trim()) {
    return { kind: 'path', value: item.savedPath, label: 'Generated image' };
  }
  if (typeof item.fileId === 'string' && item.fileId) return { kind: 'fileId', value: item.fileId, label: 'Generated image' };
  if (typeof item.result !== 'string' || !item.result.trim()) return null;
  const value = item.result.trim();
  if (/^(?:https?:|data:image\/)/i.test(value)) return { kind: 'url', value, label: 'Generated image' };
  if (value.startsWith('/') || value.startsWith('file://')) return { kind: 'path', value, label: 'Generated image' };
  return { kind: 'url', value: `data:image/png;base64,${value}`, label: 'Generated image' };
}
