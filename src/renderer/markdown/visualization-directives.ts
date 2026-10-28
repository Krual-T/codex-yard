type Position = { start: { offset?: number }; end: { offset?: number } };
type MarkdownNode = { type: string; value?: string; url?: string; children?: MarkdownNode[]; position?: Position;
  data?: { hProperties: { dataYardVisualization: string } } };
type MarkdownFile = { value: string | Uint8Array };

const startMarker = '\uE200visualize\uE202';
const endMarker = '\uE201';

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
          let path: unknown;
          try { path = (JSON.parse(match[1] ?? '') as { path?: unknown } | null)?.path; }
          catch { continue; }
          if (typeof path !== 'string' || !path.trim()) continue;
          let encodedPath: string;
          try { encodedPath = encodeURIComponent(path); }
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
          replacement.push({ type: 'link', url: `yard-visualization:${encodedPath}`,
            data: { hProperties: { dataYardVisualization: 'directive' } },
            children: [{ type: 'text', value: 'Open visualization' }] });
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
