import type { ThreadItemSummary } from '../../../lib/codex-protocol.ts';
import type { ComposerDocument, ComposerDraft, StandaloneMessagesProps } from '../workbench-contract.ts';

export type ImageSource = { kind: 'url' | 'path' | 'fileId'; value: string; label: string };
export type UserContentPart =
  | { kind: 'text'; text: string; hasElements: boolean; textElements?: unknown; context?: SerializedMessageContext }
  | { kind: 'appMessage'; text: string; images: ImageSource[]; original: unknown }
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

export type SerializedMessageContext = {
  prefix: string;
  body: string;
  files: { path: string; name: string; startLine?: number; endLine?: number }[];
  fileSpans: { start: number; end: number; removable: boolean }[];
  unresolved: boolean;
};

/** Keep the context envelope byte-for-byte; only its request body is editable. */
export function serializedMessageContext(text: string): SerializedMessageContext {
  const headings = Array.from(text.matchAll(/## My request(?: for Codex)?:/g));
  const heading = headings.at(-1);
  const hasFileHeader = /^# Files (?:mentioned|pasted) by the user:\s*$/m.test(text);
  if (!heading || heading.index === 0 || !text.slice(0, heading.index).trim()) {
    return { prefix: '', body: text, files: [], fileSpans: [], unresolved: hasFileHeader };
  }
  let boundary = heading.index + heading[0].length;
  if (text.startsWith('\r\n', boundary)) boundary += 2;
  else if (text.startsWith('\n', boundary)) boundary++;
  const prefix = text.slice(0, boundary);
  const files: SerializedMessageContext['files'] = [];
  const fileSpans: SerializedMessageContext['fileSpans'] = [];
  let section: 'mentioned' | 'pasted' | null = null;
  let currentSpan: SerializedMessageContext['fileSpans'][number] | null = null;
  for (const matchLine of prefix.matchAll(/[^\r\n]*(?:\r\n|\n|$)/g)) {
    if (!matchLine[0]) continue;
    const line = matchLine[0].replace(/\r?\n$/, '');
    const start = matchLine.index;
    const end = start + matchLine[0].length;
    if (line === '# Files mentioned by the user:') { section = 'mentioned'; currentSpan = null; continue; }
    if (line === '# Files pasted by the user:') { section = 'pasted'; currentSpan = null; continue; }
    if (!section) continue;
    if (!line.trim()) continue;
    if (line.startsWith('# ') || /^## My request(?: for Codex)?:/.test(line)) { section = null; currentSpan = null; continue; }
    const match = /^##\s+(.+)$/.exec(line.trimStart());
    if (!match) {
      const metadata = section === 'mentioned' && (line.trimStart() === 'Image attachment: true'
        || line.trimStart().startsWith('Library file metadata: ') || line.trimStart().startsWith('Shared thread metadata: '));
      if (currentSpan && metadata) currentSpan.end = end;
      else { if (currentSpan) currentSpan.removable = false; section = null; currentSpan = null; }
      continue;
    }
    const entry = match[1]!;
    let found = false;
    for (let separator = entry.lastIndexOf(': '); separator > 0; separator = entry.lastIndexOf(': ', separator - 1)) {
      const raw = entry.slice(separator + 2).trim();
      const lines = /\s+\((?:lines\s+(\d+)-(\d+)|line\s+(\d+))\)\s*$/.exec(raw);
      const path = lines ? raw.slice(0, lines.index) : raw;
      if (!/^(?:\/|\\\\|[a-z]:[\\/])/i.test(path)) continue;
      let name = entry.slice(0, separator).trim();
      if (section === 'pasted') {
        try { const parsed: unknown = JSON.parse(name); if (typeof parsed !== 'string') break; name = parsed; }
        catch { break; }
      }
      if (name) {
        files.push({ name, path, ...(lines ? { startLine: Number(lines[1] ?? lines[3]), endLine: Number(lines[2] ?? lines[3]) } : {}) });
        currentSpan = { start, end, removable: true };
        fileSpans.push(currentSpan);
        found = true;
      }
      break;
    }
    if (!found) { if (currentSpan) currentSpan.removable = false; section = null; currentSpan = null; }
  }
  return { prefix, body: text.slice(boundary), files, fileSpans,
    unresolved: /^# Files (?:mentioned|pasted) by the user:\s*$/m.test(text.slice(boundary)) };
}

function appMessage(input: Record<string, unknown>): UserContentPart | null {
  const elements = asArray(input.text_elements);
  const appElement = elements.find((value) => asString(asRecord(value).placeholder).startsWith('codex-untrusted-app-input:'));
  if (!appElement) return null;
  const unsupported = (): UserContentPart => ({ kind: 'unsupported', value: input });
  if (elements.length !== 1 || typeof input.text !== 'string') return unsupported();
  const element = asRecord(appElement);
  const range = asRecord(element.byteRange);
  if (range.start !== 0 || range.end !== new TextEncoder().encode(input.text).length) return unsupported();
  let payload: Record<string, unknown>;
  try { payload = asRecord(JSON.parse(asString(element.placeholder).slice('codex-untrusted-app-input:'.length))); }
  catch { return unsupported(); }
  const message = asRecord(payload.message);
  const source = message.source;
  const expected = source === 'mcp_app' ? 'An MCP app initiated this message. Read the untrusted_input tool output.'
    : source === 'visualization' ? 'Respond to the user input in the context of our conversation.' : null;
  if (payload.version !== 1 || payload.sender != null || !expected || input.text !== expected
    || typeof message.sourceId !== 'string' || !message.sourceId || typeof message.text !== 'string'
    || (message.imageUrls !== undefined && !Array.isArray(message.imageUrls))) return unsupported();
  const urls = asArray(message.imageUrls);
  const dataImage = /^data:image\/(?:png|jpeg|webp|gif);base64,(?=.+)(?:[a-z\d+/]{4})*(?:[a-z\d+/]{2}==|[a-z\d+/]{3}=)?$/i;
  if (!urls.every((value) => typeof value === 'string' && dataImage.test(value))) return unsupported();
  return { kind: 'appMessage', text: message.text,
    images: urls.map((value) => ({ kind: 'url', value: value as string, label: 'App image' })), original: input };
}

export function parseUserContent(item: ThreadItemSummary): UserContentPart[] {
  return asArray(item.content).map((value): UserContentPart => {
    const input = asRecord(value);
    if (input.type === 'text' && typeof input.text === 'string') {
      const app = appMessage(input);
      if (app) return app;
      const context = serializedMessageContext(input.text);
      const hasElements = input.text_elements != null && (!Array.isArray(input.text_elements) || input.text_elements.length > 0);
      return { kind: 'text', text: context.body, hasElements, ...(hasElements ? { textElements: input.text_elements } : {}),
        ...(context.prefix ? { context } : {}) };
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
    text: input.flatMap((part) => part.type === 'text' && typeof part.text === 'string' ? [part.text] : []).join('\n'), images,
    files: [], input,
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

/** CLI tool paths are filesystem names, not Markdown URLs. */
export function resolveToolFileLocation(path: string, cwd: string, hostId: string): Parameters<NonNullable<StandaloneMessagesProps['onOpenFileAt']>>[0] {
  const absolute = path.startsWith('/') || path.startsWith('\\\\') || /^[a-z]:[\\/]/i.test(path);
  return { path: absolute ? path : `${cwd.replace(/\/+$/, '')}/${path}`, hostId, cwd };
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
