export interface DiffRow { text: string; kind: 'add' | 'delete' | 'hunk' | 'context' | 'header'; path?: string; oldLine?: number; newLine?: number }

function headerPath(header: string): string | undefined {
  const value = header.slice(4).split('\t', 1)[0];
  // Git's quoted path syntax requires C-style decoding; do not navigate an ambiguous path.
  if (!value || value === '/dev/null' || value.startsWith('"') || value.includes('\0')) return undefined;
  return value.startsWith('b/') ? value.slice(2) : value;
}

export function diffRows(diff: string, suppliedPath?: string): DiffRow[] {
  let path = suppliedPath, oldLine: number | undefined, newLine: number | undefined, files = 0;
  let oldRemaining = 0, newRemaining = 0;
  return diff.split('\n').map(text => {
    const inHunk = oldRemaining > 0 || newRemaining > 0;
    if (!inHunk && text.startsWith('diff --git ')) {
      path = files++ === 0 ? suppliedPath : undefined;
      oldLine = newLine = undefined;
      return { text, kind: 'header' };
    }
    if (!inHunk && text.startsWith('+++ ')) {
      const value = text.slice(4).split('\t', 1)[0];
      path = headerPath(text) ?? (value !== '/dev/null' && files <= 1 ? suppliedPath : undefined);
      return { text, kind: 'header' };
    }
    if (!inHunk && text.startsWith('--- ')) return { text, kind: 'header' };
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(text);
    if (hunk) {
      oldLine = Number(hunk[1]); oldRemaining = Number(hunk[2] ?? 1);
      newLine = Number(hunk[3]); newRemaining = Number(hunk[4] ?? 1);
      return { text, kind: 'hunk' };
    }
    if (inHunk && text.startsWith('+') && newRemaining > 0) {
      newRemaining--;
      return { text, kind: 'add', path, newLine: newLine == null ? undefined : newLine++ };
    }
    if (inHunk && text.startsWith('-') && oldRemaining > 0) {
      oldRemaining--;
      return { text, kind: 'delete', oldLine: oldLine == null ? undefined : oldLine++ };
    }
    if (inHunk && text.startsWith(' ') && oldRemaining > 0 && newRemaining > 0 && oldLine != null && newLine != null) {
      oldRemaining--; newRemaining--;
      return { text, kind: 'context', path, oldLine: oldLine++, newLine: newLine++ };
    }
    return { text, kind: 'header' };
  });
}

export type SplitDiffRow = { kind: 'meta'; row: DiffRow } | { kind: 'line'; old?: DiffRow; current?: DiffRow };

export function splitDiffRows(rows: DiffRow[]): SplitDiffRow[] {
  const result: SplitDiffRow[] = [];
  for (let index = 0; index < rows.length;) {
    const row = rows[index]!;
    if (row.kind === 'context') {
      result.push({ kind: 'line', old: row, current: row });
      index++;
    } else if (row.kind === 'add' || row.kind === 'delete') {
      const deleted: DiffRow[] = [], added: DiffRow[] = [];
      while (index < rows.length && (rows[index]!.kind === 'add' || rows[index]!.kind === 'delete')) {
        const change = rows[index++]!;
        (change.kind === 'delete' ? deleted : added).push(change);
      }
      for (let line = 0; line < Math.max(deleted.length, added.length); line++)
        result.push({ kind: 'line', old: deleted[line], current: added[line] });
    } else {
      result.push({ kind: 'meta', row });
      index++;
    }
  }
  return result;
}
