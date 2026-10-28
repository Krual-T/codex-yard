import type { ThreadItemSummary } from '../../../lib/codex-protocol.ts';
import type { ComposerDocument, ComposerDraft, StandaloneMessagesProps } from '../workbench-contract.ts';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isComposerDocument(value: unknown): value is ComposerDocument {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (value.attrs !== undefined && !isRecord(value.attrs)) return false;
  if (value.text !== undefined && typeof value.text !== 'string') return false;
  if (value.marks !== undefined && (!Array.isArray(value.marks) || !value.marks.every((mark: unknown) =>
    isRecord(mark) && typeof mark.type === 'string' && (mark.attrs === undefined || isRecord(mark.attrs))))) return false;
  return value.content === undefined || (Array.isArray(value.content) && value.content.every(isComposerDocument));
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

export function editableDraft(item: ThreadItemSummary): ComposerDraft | null {
  if (!Array.isArray(item.content) || item.content.some((value: unknown) =>
    value === null || typeof value !== 'object' || Array.isArray(value))
    || (item.document != null && !isComposerDocument(item.document))
    || (item.hints != null && !Array.isArray(item.hints))
    || (item.format != null && typeof item.format !== 'string')) return null;
  let input: Record<string, unknown>[];
  let document: ComposerDocument | undefined;
  let hints: unknown[] | undefined;
  try {
    input = structuredClone(item.content) as Record<string, unknown>[];
    document = isComposerDocument(item.document) ? structuredClone(item.document) : undefined;
    hints = Array.isArray(item.hints) ? structuredClone(item.hints) : undefined;
  }
  catch { return null; }
  const parts = parseUserContent(item);
  const textParts = parts.filter((part) => part.kind === 'text');
  const images = parts.flatMap((part, index) => part.kind !== 'image' ? [] : [{
    id: `image-${index}`,
    src: part.image.kind === 'fileId' ? '' : part.image.value,
    ...(part.image.kind === 'path' ? { path: part.image.value } : {}),
    ...(part.image.kind === 'fileId' ? { fileId: part.image.value } : {}),
    name: part.image.label,
  }]);
  const skills = parts.flatMap((part) => part.kind === 'reference' && part.referenceType === 'skill'
    ? [{ name: part.name, path: part.path }] : []);
  return {
    text: textParts.map((part) => part.text).join('\n'), images, files: [], input,
    ...(skills.length ? { skills } : {}),
    ...(document ? { document } : {}),
    ...(hints ? { hints } : {}),
  };
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

export function resolveFileLocation(href: string, cwd: string, hostId: string): Parameters<NonNullable<StandaloneMessagesProps['onOpenFileAt']>>[0] {
  const match = /#L([1-9]\d*)(?:C([1-9]\d*))?(?:-L[1-9]\d*(?:C[1-9]\d*)?)?$/i.exec(href);
  const raw = match ? href.slice(0, match.index) : href;
  let path: string;
  if (raw.startsWith('file://')) path = resolveFilePath(raw, cwd);
  else {
    try { path = resolveFilePath(decodeURIComponent(raw), cwd); }
    catch { path = resolveFilePath(raw, cwd); }
  }
  const line = match ? Number(match[1]) : undefined;
  const column = match?.[2] ? Number(match[2]) : undefined;
  return { path, hostId, cwd,
    ...(Number.isSafeInteger(line) ? { line } : {}),
    ...(Number.isSafeInteger(column) ? { column } : {}) };
}

export function resolveFileLink(href: string, cwd: string): string {
  return resolveFileLocation(href, cwd, '').path;
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
