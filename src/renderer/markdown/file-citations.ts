import { directiveFromMarkdown } from 'mdast-util-directive';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { directive } from 'micromark-extension-directive';
import type { Root } from 'mdast';
import type { Plugin } from 'unified';

type MarkdownNode = {
  type: string;
  name?: string;
  attributes?: Record<string, string | null | undefined> | null;
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const codeExtensions = new Set(['bash', 'c', 'cc', 'cfg', 'conf', 'cpp', 'css', 'cxx', 'go', 'h', 'har',
  'hh', 'hpp', 'htm', 'html', 'hxx', 'ini', 'ipynb', 'java', 'js', 'json', 'json5', 'jsonl', 'jsx',
  'less', 'lock', 'm', 'mjs', 'mts', 'php', 'phtml', 'ps1', 'py', 'pyi', 'rb', 'rs', 'sass', 'scss',
  'sh', 'sql', 'toml', 'ts', 'tsx', 'vue', 'webmanifest', 'xhtml', 'xml', 'yaml', 'yml', 'zsh']);
const codeNames = new Set(['.env', '.env.example', '.env.local', '.gitignore', '.npmrc', '.prettierignore',
  '.prettierrc', 'cargo.lock', 'cargo.toml', 'dockerfile', 'makefile', 'requirements.txt', 'yarn.lock']);

function positiveLine(value: string | null | undefined): number | undefined {
  const line = typeof value === 'string' ? Number.parseInt(value, 10) : NaN;
  return Number.isSafeInteger(line) && line > 0 ? line : undefined;
}

function isCodeFile(name: string): boolean {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  return codeNames.has(lower) || (dot > 0 && codeExtensions.has(lower.slice(dot + 1)));
}

function citationLink(attributes: MarkdownNode['attributes']): { url: string; label: string; filePath?: string } | null {
  const attrs = attributes ?? {};
  const path = typeof attrs.path === 'string' ? attrs.path.trim() : '';
  if (!path || /[\u0000-\u001f\u007f]/u.test(path)
    || (Object.hasOwn(attrs, 'purpose') && typeof attrs.purpose !== 'string')
    || (Object.hasOwn(attrs, 'mode') && attrs.mode !== 'live')
    || (Object.hasOwn(attrs, 'page_id') && (typeof attrs.page_id !== 'string' || !uuid.test(attrs.page_id.trim())))) return null;
  if (attrs.mode === 'live') return null;
  if (['document', 'presentation', 'workbook'].includes(attrs.artifact_kind ?? '')
    && ['page_number', 'slide_number', 'slide_id', 'sheet', 'object_id', 'range'].some(key => attrs[key] != null)) return null;

  if (/^https?:\/\//iu.test(path)) {
    try {
      const url = new URL(path);
      if (url.username || url.password) return null;
      return { url: path, label: attrs.label?.trim() || attrs.title?.trim() || path };
    } catch { return null; }
  }
  let filePath = path;
  if (/^file:\/\//iu.test(path)) {
    try {
      const url = new URL(path);
      if ((url.hostname && url.hostname !== 'localhost') || url.search || url.hash) return null;
      filePath = decodeURIComponent(url.pathname);
    } catch { return null; }
  } else if (/^[a-z][a-z\d+.-]*:/iu.test(path) && !/^[a-z]:[\\/]/iu.test(path)) return null;

  const name = filePath.split(/[\\/]/u).at(-1) || filePath;
  const start = positiveLine(attrs.lineRangeStart ?? attrs.line_range_start);
  const end = positiveLine(attrs.lineRangeEnd ?? attrs.line_range_end);
  const lineLabel = start == null ? '' : end != null && end !== start ? ` (lines ${start}-${end})`
    : start === 1 && !isCodeFile(name) ? '' : ` (line ${start})`;
  try {
    const encoded = encodeURIComponent(filePath).replace(/%2F/giu, '/');
    return { url: `${encoded}${start == null ? '' : `#L${start}`}`, label: `${name}${lineLabel}`, filePath };
  } catch { return null; }
}

/** Read local output citations with the same parser and validation as the inline links. */
export function outputFileCitationReferences(text: string): { outputs: string[]; visualizations: string[] } {
  const source = normalizeFileCitationEscapes(text);
  const root = fromMarkdown(source, { extensions: [directive()], mdastExtensions: [directiveFromMarkdown()] }) as unknown as MarkdownNode;
  const outputs: string[] = [], visualizations: string[] = [];
  function visit(node: MarkdownNode): void {
    if (['code', 'inlineCode', 'html', 'link', 'linkReference', 'image', 'imageReference', 'definition'].includes(node.type)) return;
    const isDirective = node.type === 'textDirective' || node.type === 'leafDirective' || node.type === 'containerDirective';
    if (isDirective && node.name === 'codex-file-citation') {
      const citation = citationLink(node.attributes);
      const purpose = node.attributes?.purpose;
      if (citation?.filePath && (purpose == null || purpose === 'output')) outputs.push(citation.filePath);
      return;
    }
    if (isDirective && (node.name === 'codex-inline-vis' || node.name === 'codex-live-vis')) {
      const path = node.attributes?.path ?? node.attributes?.file;
      const start = node.position?.start.offset;
      const lineStart = start == null ? -1 : source.lastIndexOf('\n', start - 1) + 1;
      if (path && start != null && /^\s*$/u.test(source.slice(lineStart, start))) visualizations.push(path);
      return;
    }
    for (const child of node.children ?? []) visit(child);
  }
  visit(root);
  return { outputs, visualizations };
}

/** The original tokenizer accepts escaped quotes in directive attributes. */
export function normalizeFileCitationEscapes(source: string): string {
  if (!source.includes('codex-file-citation') || (!source.includes('\\"') && !source.includes("\\'"))) return source;
  const root = fromMarkdown(source, { extensions: [directive()], mdastExtensions: [directiveFromMarkdown()] }) as unknown as MarkdownNode;
  const replacements: { start: number; end: number; value: string }[] = [];
  function candidate(start: number): void {
    let escapes = 0;
    for (let index = start - 1; index >= 0 && source[index] === '\\'; index--) escapes++;
    if (escapes % 2) return;
    const open = source.indexOf('{', start);
    if (open < 0 || !/^:{1,3}codex-file-citation$/u.test(source.slice(start, open))) return;
    let quote = '', value = source.slice(start, open + 1), changed = false;
    for (let index = open + 1; index < source.length && source[index] !== '\n' && source[index] !== '\r'; index++) {
      const character = source[index] ?? '';
      if (quote && character === '\\' && source[index + 1] === quote) {
        value += quote === '"' ? '&#34;' : '&#39;';
        changed = true;
        index++;
      } else {
        value += character;
        if (quote && character === quote) quote = '';
        else if (!quote && (character === '"' || character === "'")) quote = character;
        else if (!quote && character === '}') {
          if (!changed) return;
          const parsed = fromMarkdown(value, { extensions: [directive()], mdastExtensions: [directiveFromMarkdown()] }) as unknown as MarkdownNode;
          const first = parsed.children?.[0];
          const directiveNode = first?.type === 'paragraph' ? first.children?.[0] : first;
          if (directiveNode?.name === 'codex-file-citation' && directiveNode.position?.end.offset === value.length
            && citationLink(directiveNode.attributes)) replacements.push({ start, end: index + 1, value });
          return;
        }
      }
    }
  }
  function visit(node: MarkdownNode): void {
    if (['code', 'inlineCode', 'html', 'link', 'linkReference', 'image', 'imageReference', 'definition'].includes(node.type)) return;
    const start = node.position?.start.offset, end = node.position?.end.offset;
    if (start != null && end != null) {
      if (node.type === 'textDirective' && node.name === 'codex-file-citation' && source[end] === '{') candidate(start);
      if (node.type === 'text') {
        for (const match of source.slice(start, end).matchAll(/:{1,3}codex-file-citation(?=\{)/gu)) candidate(start + match.index);
      }
    }
    for (const child of node.children ?? []) visit(child);
  }
  visit(root);
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    source = source.slice(0, replacement.start) + replacement.value + source.slice(replacement.end);
  }
  return source;
}

/** Use ordinary Markdown links so citation clicks follow the existing file/browser policy. */
export const remarkFileCitations: Plugin<[], Root> = function () {
  const data = this.data() as { micromarkExtensions?: ReturnType<typeof directive>[];
    fromMarkdownExtensions?: ReturnType<typeof directiveFromMarkdown>[] };
  (data.micromarkExtensions ??= []).push(directive());
  (data.fromMarkdownExtensions ??= []).push(directiveFromMarkdown());
  return (tree, file) => {
    const source = String(file.value);
    function visit(node: MarkdownNode, insideLink: boolean): void {
      if (!node.children) return;
      const nestedLink = insideLink || node.type === 'link' || node.type === 'linkReference';
      node.children = node.children.map(child => {
        const isDirective = child.type === 'textDirective' || child.type === 'leafDirective' || child.type === 'containerDirective';
        if (!isDirective) { visit(child, nestedLink); return child; }
        const start = child.position?.start.offset, end = child.position?.end.offset;
        const raw = start == null || end == null ? '' : source.slice(start, end);
        const citation = !nestedLink && child.name === 'codex-file-citation' ? citationLink(child.attributes) : null;
        const replacement = citation
          ? { type: 'link', url: citation.url, children: [{ type: 'text', value: citation.label }] }
          : { type: 'text', value: raw };
        return child.type === 'textDirective' ? replacement : { type: 'paragraph', children: [replacement] };
      });
    }
    visit(tree as unknown as MarkdownNode, false);
  };
};
