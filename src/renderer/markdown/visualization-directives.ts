type Position = { start: { offset?: number }; end: { offset?: number } };
type MarkdownNode = { type: string; value?: string; url?: string; children?: MarkdownNode[]; position?: Position;
  data?: { hProperties: { dataYardVisualization: string } } };
type MarkdownFile = { value: string | Uint8Array };

const startMarker = '\uE200visualize\uE202';
const endMarker = '\uE201';

type Visualization = { path: string | null; title?: string; type?: 'inline' | 'live'; mode?: 'wide' };

export function parseVisualization(payload: string): Visualization | null {
  const json = payload.startsWith('{');
  let value: unknown = { path: payload };
  if (json) {
    try { value = JSON.parse(payload); } catch { return null; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (item.path !== null && typeof item.path !== 'string') return null;
  if (item.title !== undefined && typeof item.title !== 'string') return null;
  if (item.type !== undefined && item.type !== 'inline' && item.type !== 'live') return null;
  if (item.mode !== undefined && item.mode !== 'wide') return null;
  if (item.wide !== undefined && typeof item.wide !== 'boolean') return null;
  const path = item.path;
  if (path === null) return item.type === 'live' ? { path, type: 'live' } : null;
  const basename = path.replaceAll('\\', '/').split('/').at(-1) ?? '';
  const absolute = /^(?:\/|[a-z]:[\\/]|\\\\)/i.test(path);
  if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(path) || /["\n\r]/.test(path)
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*\.html$/.test(basename)
    || (!absolute && (json || path !== basename))) return null;
  return { path, ...(typeof item.title === 'string' && !/["\n\r]/.test(item.title) ? { title: item.title } : {}),
    ...(item.type === 'live' || item.type === 'inline' ? { type: item.type } : {}),
    ...(item.mode === 'wide' ? { mode: item.mode } : {}) };
}

function nthIndex(text: string, search: string, index: number): number {
  let found = -1;
  for (let count = 0; count <= index; count++) {
    found = text.indexOf(search, found + 1);
    if (found < 0) break;
  }
  return found;
}

function countBefore(text: string, search: string): number {
  let count = 0;
  let position = -1;
  while ((position = text.indexOf(search, position + 1)) >= 0) count++;
  return count;
}

export function remarkVisualizations() {
  return (root: MarkdownNode, file: MarkdownFile) => {
    const source = String(file.value);
    function visit(node: MarkdownNode) {
      if (!node.children || node.type === 'link' || node.type === 'linkReference') return;
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start != null && end != null) {
        const expression = /\uE200visualize\uE202([\s\S]*?)\uE201/g;
        for (const match of source.slice(start, end).matchAll(expression)) {
          const directive = parseVisualization(match[1] ?? '');
          if (!directive) continue;
          let encodedPath: string;
          try { encodedPath = encodeURIComponent(directive.path ?? ''); }
          catch { continue; }
          const from = start + match.index;
          const to = from + match[0].length;
          const first = node.children.findIndex((child) => child.position?.start.offset != null && child.position.end.offset != null
            && child.position.start.offset <= from && child.position.end.offset > from);
          const last = node.children.findIndex((child) => child.position?.start.offset != null && child.position.end.offset != null
            && child.position.start.offset < to && child.position.end.offset >= to);
          const left = node.children[first];
          const right = node.children[last];
          if (first < 0 || last < first || left?.type !== 'text' || right?.type !== 'text'
            || typeof left.value !== 'string' || typeof right.value !== 'string'
            || left.position?.start.offset == null || right.position?.start.offset == null) continue;
          const leftIndex = nthIndex(left.value, startMarker, countBefore(source.slice(left.position.start.offset, from), startMarker));
          const rightIndex = nthIndex(right.value, endMarker, countBefore(source.slice(right.position.start.offset, to - 1), endMarker));
          if (leftIndex < 0 || rightIndex < 0) continue;
          const replacement: MarkdownNode[] = [];
          if (leftIndex > 0) replacement.push({ ...left, value: left.value.slice(0, leftIndex),
            position: { start: left.position.start, end: { offset: from } } });
          if (directive.type === 'live') replacement.push({ type: 'text', value: `Live visualization unavailable: ${match[0]}` });
          else replacement.push({ type: 'link', url: `yard-visualization:${encodedPath}`,
            data: { hProperties: { dataYardVisualization: 'directive' } },
            children: [{ type: 'text', value: directive.title || 'Open visualization' }] });
          const rest = right.value.slice(rightIndex + endMarker.length);
          if (rest) replacement.push({ ...right, value: rest, position: { start: { offset: to }, end: right.position.end } });
          node.children.splice(first, last - first + 1, ...replacement);
        }
      }
      for (const child of node.children) visit(child);
    }
    visit(root);
  };
}
