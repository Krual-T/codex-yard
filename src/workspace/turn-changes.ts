import { parsePatch, type StructuredPatch, type StructuredPatchHunk } from 'diff';
import { record } from '../native/protocol.ts';
import type { WorkspaceTurn } from './turn-stream.ts';

export type ChangedPatch = { hunks: StructuredPatchHunk[]; raw?: string; isBinary?: boolean };
export type ChangedFile = { path: string; patches: ChangedPatch[]; added: number; removed: number };
export type Changes = { files: ChangedFile[]; added: number; removed: number };

function readPatches(diff: string): StructuredPatch[] {
  try { return parsePatch(diff); } catch { return []; }
}

function countLines(lines: Iterable<string>) {
  let added = 0, removed = 0;
  for (const line of lines) {
    if (line.startsWith('+')) added++;
    if (line.startsWith('-')) removed++;
  }
  return { added, removed };
}

export function changeName(path: string) {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

function displayName(patch: StructuredPatch) {
  const path = patch.newFileName && patch.newFileName !== '/dev/null' ? patch.newFileName : patch.oldFileName;
  return patch.isGit ? path?.replace(/^[ab]\//, '') : path;
}

function relativePath(path: string, cwd?: string) {
  if (!cwd) return path;
  const root = cwd.replace(/[\\/]+$/, '');
  return path.startsWith(root + '/') || path.startsWith(root + '\\') ? path.slice(root.length + 1) : path;
}

export function turnChanges(turn: WorkspaceTurn | undefined, cwd?: string): Changes {
  const files = new Map<string, ChangedFile>();
  let added = 0, removed = 0;
  function add(path: string, patch: ChangedPatch) {
    path = relativePath(path, cwd);
    const stats = countLines(patch.hunks.length ? patch.hunks.flatMap(hunk => hunk.lines) :
      patch.raw?.split('\n').filter(line => !line.startsWith('+++ ') && !line.startsWith('--- ')) ?? []);
    let file = files.get(path);
    if (!file) {
      file = { path, patches: [], added: 0, removed: 0 };
      files.set(path, file);
    }
    file.patches.push(patch);
    file.added += stats.added;
    file.removed += stats.removed;
    added += stats.added;
    removed += stats.removed;
  }
  if (turn?.diff !== undefined) {
    for (const patch of readPatches(turn.diff)) {
      const path = displayName(patch);
      if (path) add(path, patch);
    }
    if (!turn.diff.trim() || files.size) return { files: [...files.values()], added, removed };
  }
  for (const item of turn?.items ?? []) {
    if (item.type !== 'fileChange' || item.status !== 'completed' || !Array.isArray(item.changes)) continue;
    for (const entry of item.changes) {
      const change = record(entry), kind = record(change.kind);
      if (typeof change.path !== 'string' || !change.path || typeof change.diff !== 'string') continue;
      const path = typeof kind.move_path === 'string' && kind.move_path ? kind.move_path : change.path;
      const parsed = readPatches(change.diff);
      if (parsed.some(patch => patch.hunks.length || patch.isGit)) for (const patch of parsed) add(path, patch);
      else add(path, { hunks: [], raw: change.diff });
    }
  }
  return { files: [...files.values()], added, removed };
}
