export interface DiffRow { text: string; kind: 'add' | 'delete' | 'hunk' | 'context' | 'header'; path?: string; oldLine?: number; newLine?: number }

function headerPath(header: string): string | undefined {
  const value = header.slice(4).split('\t', 1)[0];
  // Git's quoted path syntax requires C-style decoding; do not navigate an ambiguous path.
  if (!value || value === '/dev/null' || value.startsWith('"') || value.includes('\0')) return undefined;
  return value.startsWith('b/') ? value.slice(2) : value;
}

export function diffRows(diff: string, suppliedPath?: string): DiffRow[] {
  let path = suppliedPath, oldLine: number | undefined, newLine: number | undefined, files = 0;
  return diff.split('\n').map(text => {
    if (text.startsWith('diff --git ')) {
      path = files++ === 0 ? suppliedPath : undefined;
      oldLine = newLine = undefined;
      return { text, kind: 'header' };
    }
    if (text.startsWith('+++ ')) {
      const value = text.slice(4).split('\t', 1)[0];
      path = headerPath(text) ?? (value !== '/dev/null' && files <= 1 ? suppliedPath : undefined);
      return { text, kind: 'header' };
    }
    if (text.startsWith('--- ')) return { text, kind: 'header' };
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      oldLine = Number(hunk[1]); newLine = Number(hunk[2]);
      return { text, kind: 'hunk' };
    }
    if (text.startsWith('+')) return { text, kind: 'add', path, newLine: newLine == null ? undefined : newLine++ };
    if (text.startsWith('-')) return { text, kind: 'delete', oldLine: oldLine == null ? undefined : oldLine++ };
    if (text.startsWith(' ') && oldLine != null && newLine != null) return { text, kind: 'context', path, oldLine: oldLine++, newLine: newLine++ };
    return { text, kind: 'header' };
  });
}
