import type { WorkbenchClient } from '../workbench-contract.ts';
import { previewLimit } from '../../native/file-limits.ts';

export type FileContents =
  | { kind: 'text'; text: string }
  | { kind: 'binary'; base64: string; mimeType: string };

export function fileName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) || path;
}

/** Host file endpoints resolve relative paths against the server workspace, not the selected cwd. */
export function resolveFilePath(cwd: string, path: string): string {
  if (path.startsWith('file:')) return path;
  const input = path.startsWith('/') ? path : `${cwd.replace(/\/$/, '')}/${path}`;
  const parts: string[] = [];
  for (const part of input.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return '/' + parts.join('/');
}

export function previewMimeType(path: string, mimeType: string): string {
  if (mimeType !== 'application/octet-stream') return mimeType;
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  const media: Record<string, string> = { aac: 'audio/aac', aif: 'audio/aiff', aiff: 'audio/aiff', flac: 'audio/flac',
    m4a: 'audio/mp4', oga: 'audio/ogg', ogg: 'audio/ogg', opus: 'audio/ogg', m4v: 'video/mp4', mov: 'video/quicktime',
    ogv: 'video/ogg', webm: 'video/webm' };
  return extension && media[extension] || mimeType;
}

export async function readWorkspaceFile(client: WorkbenchClient, hostId: string, path: string): Promise<FileContents> {
  const result = await client.host<{ text?: unknown; blob?: unknown }>('workspace-files', {
    operation: 'read', hostId, path, representation: 'auto',
  });
  if (typeof result?.text !== 'string' && typeof result?.blob !== 'string') throw new Error('Invalid file response');
  // Auto detection samples only a prefix; validate all bytes before allowing editing.
  const binary = await client.host<{ contentsBase64?: unknown; mimeType?: unknown }>('read-file-binary', { hostId, path });
  if (typeof binary?.contentsBase64 !== 'string' || typeof binary.mimeType !== 'string') throw new Error('File is too large to preview');
  if (typeof result.text === 'string') {
    const bytes = base64Bytes(binary.contentsBase64);
    if (!bytes.some(byte => byte === 0 || byte < 32 && ![9, 10, 12, 13].includes(byte))) {
      let text: string | undefined;
      try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { /* Binary data. */ }
      if (text !== undefined) {
        if (text !== result.text) throw new Error('File changed while it was being read. Try again.');
        return { kind: 'text', text };
      }
    }
  }
  return { kind: 'binary', base64: binary.contentsBase64, mimeType: previewMimeType(path, binary.mimeType) };
}

export function editorText(text: string): string {
  return text.replace(/\r\n|\r/g, '\n');
}

export interface TextEdit { start: number; end: number; inputType: string }

/** Apply a textarea edit to the original bytes, preserving untouched line endings. */
export function editFileText(original: string, text: string, edit?: TextEdit): string {
  const previous = editorText(original);
  if (previous === text) return original;
  let start = edit?.start ?? -1;
  let end = edit?.end ?? -1;
  if (edit && start === end && edit.inputType.startsWith('delete')) {
    const removed = previous.length - text.length;
    if (edit.inputType.endsWith('Backward')) start -= removed;
    else end += removed;
  }
  let insertedLength = text.length - (previous.length - (end - start));
  if (start < 0 || end < start || end > previous.length || insertedLength < 0 ||
      text !== previous.slice(0, start) + text.slice(start, start + insertedLength) + previous.slice(end)) {
    start = 0;
    while (start < previous.length && start < text.length && previous[start] === text[start]) start++;
    end = previous.length;
    let textEnd = text.length;
    while (end > start && textEnd > start && previous[end - 1] === text[textEnd - 1]) { end--; textEnd--; }
    insertedLength = textEnd - start;
  }
  const rawOffset = (offset: number) => {
    let raw = 0, normalized = 0;
    while (raw < original.length && normalized < offset) {
      if (original[raw] === '\r' && original[raw + 1] === '\n') raw++;
      raw++; normalized++;
    }
    return raw;
  };
  const rawStart = rawOffset(start), rawEnd = rawOffset(end);
  const nextEnding = /\r\n|\r|\n/.exec(original.slice(rawStart))?.[0];
  const previousEndings = original.slice(0, rawStart).match(/\r\n|\r|\n/g);
  const ending = nextEnding ?? previousEndings?.at(-1) ?? '\n';
  const inserted = text.slice(start, start + insertedLength).replaceAll('\n', ending);
  return original.slice(0, rawStart) + inserted + original.slice(rawEnd);
}

export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > previewLimit) throw new Error('File exceeds the 10 MiB preview and save limit');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function base64Bytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
