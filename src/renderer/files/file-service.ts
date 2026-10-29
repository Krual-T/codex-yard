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

export async function readWorkspaceFile(client: WorkbenchClient, hostId: string, path: string, assertCurrent?: () => void): Promise<FileContents> {
  assertCurrent?.();
  const options = assertCurrent ? { assertBeforeSend: assertCurrent } : undefined;
  const result = await client.host<{ text?: unknown; blob?: unknown }>('workspace-files', {
    operation: 'read', hostId, path, representation: 'auto',
  }, options);
  assertCurrent?.();
  if (typeof result?.text !== 'string' && typeof result?.blob !== 'string') throw new Error('Invalid file response');
  // Auto detection samples only a prefix; validate all bytes before allowing editing.
  const binary = await client.host<{ contentsBase64?: unknown; mimeType?: unknown }>('read-file-binary', { hostId, path }, options);
  assertCurrent?.();
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
  return (text.startsWith('\ufeff') ? text.slice(1) : text).replace(/\r\n|\r/g, '\n');
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
