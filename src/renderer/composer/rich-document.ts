import { Fragment, Schema } from 'prosemirror-model';
import type { Mark, Node as ProseMirrorNode } from 'prosemirror-model';
import { defaultMarkdownParser, defaultMarkdownSerializer, MarkdownSerializer } from 'prosemirror-markdown';
import type { ComposerDocument } from '../workbench-contract.ts';

const string = { validate: 'string' };
const optionalString = { default: null, validate: 'string|null' };
const systemHints = new Set(['search', 'picture_v2', 'cme', 'tatertot', 'tasks', 'note']);
function copiedAttrs(element: HTMLElement, required: string[]): Record<string, unknown> | false {
  try {
    const value: unknown = JSON.parse(element.getAttribute('data-composer-attrs') ?? 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const attrs = Object.fromEntries(Object.entries(value));
    return required.every(key => typeof attrs[key] === 'string') ? attrs : false;
  } catch { return false; }
}

export function safeRichLinkHref(value: string): string | null {
  const href = value.trim();
  if (/[\u0000-\u001f\u007f]/.test(value) || !/^(?:https?:\/\/|mailto:)/i.test(href)) return null;
  try {
    const url = new URL(href);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !!url.hostname
      || url.protocol === 'mailto:' && !!url.pathname ? href : null;
  } catch { return null; }
}

/** The original automatic link uses its displayed text as an HTTP(S) destination. */
export function httpAutolinkHref(value: string): string | null {
  if (!value || /\s/u.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : null;
  } catch { return null; }
}

/** Page references are identifiers, not destinations for browser navigation. */
function validPageReference(path: unknown): boolean {
  if (typeof path !== 'string') return false;
  const id = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,199}$/u;
  const identifier = /^(page|space):\/\/([^#]+)(?:#(.+))?$/u.exec(path);
  if (identifier) return id.test(identifier[2]!) && (identifier[3] === undefined
    || identifier[1] === 'page' && id.test(identifier[3]));
  try {
    const url = new URL(path);
    const prefix = url.pathname.startsWith('/codex/app/space/') ? '/codex/app/space/' : '/space/';
    return url.origin === 'https://chatgpt.com' && !url.username && !url.password
      && url.pathname.startsWith(prefix) && id.test(url.pathname.slice(prefix.length))
      && (!url.hash || id.test(url.hash.slice(1))) && !url.searchParams.has('thread') && !url.searchParams.has('message');
  } catch { return false; }
}

/** The original thread reference accepts a qualified host or a legacy local path. */
export function parseAgentThreadPath(path: string): { threadId: string; hostId?: string } | null {
  const match = /^thread:\/\/([A-Za-z0-9_-]+)(?:\?hostId=([^?#&/]+))?$/.exec(path);
  if (!match) return null;
  if (match[2] === undefined) return { threadId: match[1]! };
  try {
    const hostId = decodeURIComponent(match[2]);
    return /^[A-Za-z0-9._:-]+$/.test(hostId) ? { threadId: match[1]!, hostId } : null;
  } catch { return null; }
}

/** Allocate identities only for explicitly created or copied link occurrences. */
export function linkOccurrenceAllocator(document: ProseMirrorNode): () => number {
  const used = new Set<number>();
  document.descendants(node => {
    const ids = [node.type.name === 'richLink' ? node.attrs.literalMarkdownOccurrenceId : null,
      ...node.marks.filter(mark => mark.type.name === 'link').map(mark => mark.attrs.literalMarkdownOccurrenceId)];
    for (const id of ids) if (typeof id === 'number' && Number.isSafeInteger(id) && id >= 0) used.add(id);
  });
  let next = 0;
  return () => {
    while (used.has(next)) next++;
    const id = next++;
    used.add(id);
    return id;
  };
}

/** The supported subset uses the names and attributes of retained composer documents. */
export const composerSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block', parseDOM: [{ tag: 'p' }], toDOM: () => ['p', 0] },
    text: { group: 'inline' },
    hard_break: { inline: true, group: 'inline', selectable: false, parseDOM: [{ tag: 'br' }], toDOM: () => ['br'] },
    heading: { attrs: { level: { default: 1, validate: 'number' } }, content: 'inline*', group: 'block', defining: true,
      parseDOM: Array.from({ length: 6 }, (_, index) => ({ tag: 'h' + (index + 1), attrs: { level: index + 1 } })),
      toDOM: node => ['h' + node.attrs.level, 0] },
    blockquote: { content: 'block+', group: 'block', defining: true, parseDOM: [{ tag: 'blockquote' }], toDOM: () => ['blockquote', 0] },
    code_block: { attrs: { autoDetectLanguage: { default: true, validate: 'boolean' }, language: optionalString },
      content: 'text*', marks: '', group: 'block', code: true, defining: true,
      parseDOM: [{ tag: 'pre', preserveWhitespace: 'full', getAttrs: dom => {
        const element = dom as HTMLElement;
        return element.hasAttribute('data-composer-attrs') ? copiedAttrs(element, []) : null;
      } }], toDOM: node => ['pre', { 'data-composer-attrs': JSON.stringify(node.attrs) }, ['code', 0]] },
    list: { content: 'regular_list_item+', group: 'block', parseDOM: [{ tag: 'ul' }], toDOM: () => ['ul', 0] },
    ordered_list: { attrs: { startingNumber: { default: 1, validate: 'number' } }, content: 'regular_list_item+', group: 'block',
      parseDOM: [{ tag: 'ol', getAttrs: dom => ({ startingNumber: Number((dom as HTMLElement).getAttribute('start') || 1) }) }],
      toDOM: node => ['ol', { start: node.attrs.startingNumber }, 0] },
    regular_list_item: { content: 'paragraph block*', defining: true, parseDOM: [{ tag: 'li' }], toDOM: () => ['li', 0] },
    atMention: { attrs: { label: string, path: string, fsPath: string }, inline: true, group: 'inline', atom: true,
      selectable: true, parseDOM: [{ tag: 'span[data-mention="file"]', getAttrs: dom => copiedAttrs(dom as HTMLElement, ['label', 'path', 'fsPath']) }],
      toDOM: node => ['span', { class: 'standalone-composer__mention', 'data-mention': 'file', 'data-composer-attrs': JSON.stringify(node.attrs) }, node.attrs.label] },
    skillMention: { attrs: { name: string, path: string, description: string, displayName: { default: '', validate: 'string' },
      iconSmall: { default: '', validate: 'string' }, brandColor: { default: '', validate: 'string' },
      promptLinkLabel: { default: '', validate: 'string' }, skillIcon: optionalString }, inline: true, group: 'inline', atom: true,
      selectable: true, parseDOM: [{ tag: 'span[data-mention="skill"]', getAttrs: dom => copiedAttrs(dom as HTMLElement, ['name', 'path', 'description']) }],
      toDOM: node => ['span', { class: 'standalone-composer__mention', 'data-mention': 'skill', 'data-composer-attrs': JSON.stringify(node.attrs) },
        node.attrs.displayName || node.attrs.name] },
    agentMention: { attrs: { name: string, displayName: { default: '', validate: 'string' }, conversationId: optionalString, path: string },
      inline: true, group: 'inline', atom: true, draggable: false, selectable: false,
      leafText: node => '@' + (node.attrs.displayName || node.attrs.name),
      parseDOM: [{ tag: 'span[data-mention="agent"]', getAttrs: dom => copiedAttrs(dom as HTMLElement, ['name', 'path']) },
        { tag: 'span[agent-mention-name][agent-mention-path]', getAttrs: dom => {
          const element = dom as HTMLElement;
          const name = element.getAttribute('agent-mention-name');
          return { name, displayName: element.getAttribute('agent-mention-display-name') ?? name,
            conversationId: element.getAttribute('agent-mention-conversation-id'), path: element.getAttribute('agent-mention-path') };
        } }],
      toDOM: node => ['span', { class: 'standalone-composer__mention', 'data-mention': 'agent',
        'data-composer-attrs': JSON.stringify(node.attrs), 'agent-mention-name': node.attrs.name,
        'agent-mention-display-name': node.attrs.displayName || node.attrs.name, 'agent-mention-path': node.attrs.path,
        ...(node.attrs.conversationId === null ? {} : { 'agent-mention-conversation-id': node.attrs.conversationId }),
        contenteditable: 'false' },
      (parseAgentThreadPath(node.attrs.path) ? '' : '@') + (node.attrs.displayName || node.attrs.name)] },
    pageReferenceMention: { attrs: { path: string, projectId: { default: '', validate: 'string' },
      spaceId: { default: '', validate: 'string' }, title: string }, inline: true, group: 'inline', atom: true, selectable: false,
      parseDOM: [{ tag: 'span[data-mention="page-reference"]', getAttrs: dom => copiedAttrs(dom as HTMLElement, ['path', 'title']) },
        { tag: 'span[page-reference-mention-path][page-reference-mention-title]', getAttrs: dom => {
          const element = dom as HTMLElement, path = element.getAttribute('page-reference-mention-path');
          return validPageReference(path) ? { path, title: element.getAttribute('page-reference-mention-title'),
            projectId: element.getAttribute('page-reference-mention-project-id') ?? '',
            spaceId: element.getAttribute('page-reference-mention-space-id') ?? '' } : false;
        } }],
      toDOM: node => ['span', { class: 'standalone-composer__mention standalone-composer__page-reference',
        'data-mention': 'page-reference', 'data-composer-attrs': JSON.stringify(node.attrs),
        title: node.attrs.path, role: 'group', 'aria-label': node.attrs.title }, node.attrs.title] },
    richLink: { attrs: { displayText: string, href: string, sourceAppId: string,
      isLoading: { default: false, validate: 'boolean' }, loadingDisplayText: optionalString,
      literalMarkdownSource: optionalString, literalMarkdownOccurrenceId: { default: null, validate: 'number|null' },
      markdownSourceStart: { default: null, validate: 'number|null' }, markdownSourceEnd: { default: null, validate: 'number|null' } },
      inline: true, group: 'inline', atom: true, selectable: false,
      parseDOM: [{ tag: 'span[data-mention="rich-link"]', getAttrs: dom => copiedAttrs(dom as HTMLElement, ['displayText', 'href', 'sourceAppId']) }],
      toDOM: node => ['span', { class: 'standalone-composer__mention', 'data-mention': 'rich-link', 'data-composer-attrs': JSON.stringify(node.attrs),
        title: node.attrs.href, role: 'button', tabindex: '0', 'aria-haspopup': 'dialog', 'aria-expanded': 'false',
        ...(node.attrs.isLoading ? { 'data-saved-loading': 'true' } : {}) },
        node.attrs.isLoading ? node.attrs.loadingDisplayText ?? node.attrs.displayText : node.attrs.displayText] },
    // Used only in a temporary serialization projection, never in a stored document.
    literalMarkdownLink: { attrs: { source: string }, inline: true, group: 'inline', atom: true },
    chatGptSystemHint: { attrs: { label: string, systemHint: string }, inline: true, group: 'inline', atom: true, selectable: false,
      parseDOM: [{ tag: 'span[data-system-hint-type][data-system-hint-label]', getAttrs: dom => {
        const element = dom as HTMLElement;
        const label = element.getAttribute('data-system-hint-label'), systemHint = element.getAttribute('data-system-hint-type');
        return label && systemHint && systemHints.has(systemHint) ? { label, systemHint } : false;
      } }],
      toDOM: node => ['span', { class: 'standalone-composer__mention', 'data-system-hint-type': node.attrs.systemHint,
        'data-system-hint-label': node.attrs.label }, node.attrs.label] },
  },
  marks: {
    strong: { parseDOM: [{ tag: 'strong' }, { tag: 'b' }], toDOM: () => ['strong', 0] },
    em: { parseDOM: [{ tag: 'em' }, { tag: 'i' }], toDOM: () => ['em', 0] },
    code: { code: true, parseDOM: [{ tag: 'code' }], toDOM: () => ['code', 0] },
    link: { attrs: { href: optionalString, title: optionalString, isAutolink: { default: false, validate: 'boolean' },
      isGeneratedAutolink: { default: false, validate: 'boolean' }, sourceAppId: optionalString,
      literalMarkdownSource: optionalString, literalMarkdownOccurrenceId: { default: null, validate: 'number|null' } },
      inclusive: false, parseDOM: [{ tag: 'span[data-composer-autolink][data-composer-attrs]', getAttrs: dom => {
        const attrs = copiedAttrs(dom as HTMLElement, []);
        return attrs && attrs.href === null ? attrs : false;
      } }, { tag: 'a[data-composer-attrs]', getAttrs: dom => copiedAttrs(dom as HTMLElement, ['href']) },
        { tag: 'a[href]', getAttrs: dom => {
        const element = dom as HTMLElement;
        return { href: element.getAttribute('href'), title: element.getAttribute('title') };
      } }],
      toDOM: mark => mark.attrs.href === null ? ['span', { 'data-composer-autolink': '', 'data-composer-attrs': JSON.stringify(mark.attrs) }, 0]
        : ['a', { ...(safeRichLinkHref(mark.attrs.href) ? { href: safeRichLinkHref(mark.attrs.href) } : { role: 'button', tabindex: '0' }),
        title: mark.attrs.title, 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'data-composer-attrs': JSON.stringify(mark.attrs) }, 0] },
  },
});

const base = defaultMarkdownSerializer.nodes;
const defaultLink = defaultMarkdownSerializer.marks.link!;
function markdownDestination(path: string): string {
  if (/[\s<>]/.test(path)) {
    return '<' + path.replace(/\\/g, '\\\\').replace(/[<>]/g, '\\$&').replace(/\r/g, '%0D').replace(/\n/g, '%0A') + '>';
  }
  return path.replace(/[\\()"\x00-\x1f]/g, character => character.charCodeAt(0) < 32
    ? '%' + character.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase() : '\\' + character);
}

interface LiteralPart { text: string; marks: string[] }
interface ParsedLiteral { href: string; title: string | null; parts: LiteralPart[] }

/** Parse an entire literal using the same Markdown rules as the editor. */
function parseLiteralLink(source: unknown): ParsedLiteral | null {
  if (typeof source !== 'string' || /[\r\n]/.test(source) || !((source.startsWith('[') && source.endsWith(')'))
    || (source.startsWith('<') && source.endsWith('>')))) return null;
  try {
    const tokens = defaultMarkdownParser.tokenizer.parse(source, {}), inline = tokens[1]?.children;
    if (tokens.length !== 3 || tokens[0]?.type !== 'paragraph_open' || tokens[1]?.type !== 'inline'
      || tokens[2]?.type !== 'paragraph_close' || !inline || inline[0]?.type !== 'link_open'
      || inline.at(-1)?.type !== 'link_close' || inline.filter(token => token.type === 'link_open').length !== 1
      || inline.filter(token => token.type === 'link_close').length !== 1) return null;
    const document = defaultMarkdownParser.parse(source);
    const paragraph = document?.childCount === 1 ? document.child(0) : null;
    if (!paragraph || paragraph.type.name !== 'paragraph' || !paragraph.childCount) return null;
    let href: string | null = null, title: string | null = null;
    const parts: LiteralPart[] = [];
    for (let index = 0; index < paragraph.childCount; index++) {
      const child = paragraph.child(index), link = child.marks.find(mark => mark.type.name === 'link');
      if (!child.isText || !child.text || !link || typeof link.attrs.href !== 'string'
        || link.attrs.href.startsWith('codex-text-link://') || link.attrs.title != null && typeof link.attrs.title !== 'string') return null;
      if (href !== null && (href !== link.attrs.href || title !== link.attrs.title)) return null;
      href = link.attrs.href; title = link.attrs.title;
      parts.push({ text: child.text, marks: child.marks.filter(mark => mark !== link).map(mark => mark.type.name).sort() });
    }
    return href === null ? null : { href, title, parts };
  } catch { return null; }
}

function verifiedLiteralLink(source: unknown, label: unknown, href: unknown): string | null {
  const parsed = parseLiteralLink(source);
  return parsed && parsed.href === href && parsed.title === null && parsed.parts.map(part => part.text).join('') === label
    ? source as string : null;
}

/** Build a transient rendering node only after the complete marked run matches its own source. */
function literalMarkProjection(nodes: ProseMirrorNode[], link: Mark): ProseMirrorNode | null {
  const source = link.attrs.literalMarkdownSource, parsed = parseLiteralLink(source);
  const target = link.attrs.href === null ? httpAutolinkHref(nodes.map(node => node.text ?? '').join('')) : link.attrs.href;
  if (!parsed || parsed.href !== target || parsed.title !== link.attrs.title) return null;
  const characters = (parts: LiteralPart[]) => parts.flatMap(part => Array.from(part.text, text => ({ text, marks: part.marks })));
  const expected = characters(parsed.parts), actual = characters(nodes.map(node => ({ text: node.text ?? '',
    marks: node.marks.filter(mark => mark.type.name !== 'link').map(mark => mark.type.name).sort() })));
  if (!expected.length || expected.length !== actual.length) return null;
  const outer = actual[0]!.marks.filter(mark => !expected[0]!.marks.includes(mark));
  if (outer.includes('code') || expected.some((item, index) => item.text !== actual[index]!.text
    || [...new Set([...item.marks, ...outer])].sort().join('\0') !== actual[index]!.marks.join('\0'))) return null;
  const marks = nodes[0]!.marks.filter(mark => mark.type.name !== 'link' && outer.includes(mark.type.name));
  return composerSchema.nodes.literalMarkdownLink!.create({ source }, null, marks);
}

function projectLiteralMarks(node: ProseMirrorNode): ProseMirrorNode {
  if (node.isLeaf) return node;
  const children: ProseMirrorNode[] = [];
  for (let index = 0; index < node.childCount; index++) {
    const child = node.child(index), link = child.isText && child.marks.find(mark => mark.type.name === 'link');
    if (!link || link.attrs.href !== null && typeof link.attrs.literalMarkdownSource !== 'string') { children.push(projectLiteralMarks(child)); continue; }
    const run = [child];
    while (index + 1 < node.childCount) {
      const next = node.child(index + 1), nextLink = next.isText && next.marks.find(mark => mark.type.name === 'link');
      if (!nextLink || !link.eq(nextLink)) break;
      run.push(next); index++;
    }
    const projected = literalMarkProjection(run, link);
    if (projected) { children.push(projected); continue; }
    if (link.attrs.href !== null) { children.push(...run); continue; }
    const href = httpAutolinkHref(run.map(item => item.text ?? '').join(''));
    const replacement = href ? link.type.create({ ...link.attrs, href }) : null;
    children.push(...run.map(item => {
      const marks = item.marks.filter(mark => !link.eq(mark));
      return item.mark(replacement ? replacement.addToSet(marks) : marks);
    }));
  }
  return node.copy(Fragment.fromArray(children));
}
const serializer = new MarkdownSerializer({
  paragraph: base.paragraph!, text: base.text!, hard_break: state => state.write('\\\n'), heading: base.heading!, blockquote: base.blockquote!,
  regular_list_item: base.list_item!,
  list: (state, node) => state.renderList(node, '  ', () => '- '),
  ordered_list: (state, node) => {
    const start = node.attrs.startingNumber as number;
    const width = String(start + node.childCount - 1).length;
    state.renderList(node, ' '.repeat(width + 2), index => String(start + index).padStart(width) + '. ');
  },
  code_block: (state, node) => {
    const longest = Array.from(node.textContent.matchAll(/`+/g)).reduce((length, match) => Math.max(length, match[0].length), 2);
    const fence = '`'.repeat(longest + 1);
    state.write(fence + (node.attrs.language ?? '') + '\n');
    state.text(node.textContent, false); state.write('\n' + fence); state.closeBlock(node);
  },
  atMention: (state, node) => state.write('[' + state.esc(node.attrs.label) + '](' + markdownDestination(node.attrs.path) + ')'),
  skillMention: (state, node) => state.write('[' + state.esc(node.attrs.promptLinkLabel || '$' + node.attrs.name) + ']('
    + markdownDestination(node.attrs.path) + ')'),
  agentMention: (state, node) => state.write('[' + state.esc('@' + (node.attrs.displayName || node.attrs.name)) + ']('
    + markdownDestination(node.attrs.path) + ')'),
  pageReferenceMention: (state, node) => state.write('[' + state.esc(node.attrs.title) + '](' + markdownDestination(node.attrs.path) + ')'),
  richLink: (state, node) => state.write(verifiedLiteralLink(node.attrs.literalMarkdownSource, node.attrs.displayText, node.attrs.href)
    ?? '[' + state.esc(node.attrs.displayText) + '](' + markdownDestination(node.attrs.href) + ')'),
  literalMarkdownLink: (state, node) => state.write(node.attrs.source),
  chatGptSystemHint: (state, node) => state.write('[' + state.esc(node.attrs.label) + '](chatgpt-system-hint://' + node.attrs.systemHint + ')'),
}, { ...defaultMarkdownSerializer.marks, link: {
  ...defaultLink,
  open: (state, mark, parent, index) => mark.attrs.title !== null || /[\s<>]/.test(mark.attrs.href) ? '['
    : typeof defaultLink.open === 'function' ? defaultLink.open(state, mark, parent, index) : defaultLink.open,
  close: (state, mark, parent, index) => {
    if (mark.attrs.title === null && !/[\s<>]/.test(mark.attrs.href)) {
      return typeof defaultLink.close === 'function' ? defaultLink.close(state, mark, parent, index) : defaultLink.close;
    }
    const title = mark.attrs.title === null ? '' : ' "' + mark.attrs.title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      .replace(/\r/g, '&#xD;').replace(/\n/g, '&#xA;') + '"';
    return '](' + markdownDestination(mark.attrs.href)
      + title + ')';
  },
} });

function knownKeys(value: object, allowed: string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}
function validJSON(node: ComposerDocument): boolean {
  if (!knownKeys(node, ['type', 'attrs', 'content', 'marks', 'text'])) return false;
  if (node.type === 'literalMarkdownLink') return false;
  const spec = composerSchema.nodes[node.type];
  if (!spec || node.attrs && !knownKeys(node.attrs, Object.keys(spec.spec.attrs ?? {}))) return false;
  if (node.type === 'text' ? typeof node.text !== 'string' || !node.text || !!node.content || !!node.attrs
    : node.text !== undefined || spec.isLeaf && !!node.content?.length) return false;
  if (node.type === 'heading' && node.attrs?.level !== undefined
    && (!Number.isInteger(node.attrs.level) || (node.attrs.level as number) < 1 || (node.attrs.level as number) > 6)) return false;
  if (node.type === 'ordered_list' && node.attrs?.startingNumber !== undefined
    && (!Number.isInteger(node.attrs.startingNumber) || (node.attrs.startingNumber as number) < 1)) return false;
  if (node.type === 'skillMention' && (!node.attrs?.path || !node.attrs?.name)) return false;
  if (node.type === 'agentMention' && node.marks?.some(mark => mark.type === 'code' || mark.type === 'link')) return false;
  if (node.type === 'pageReferenceMention' && !validPageReference(node.attrs?.path)) return false;
  if (node.type === 'richLink') {
    const attrs = node.attrs;
    if (attrs?.literalMarkdownSource != null && !verifiedLiteralLink(attrs.literalMarkdownSource, attrs.displayText, attrs.href)) return false;
    if (['literalMarkdownOccurrenceId', 'markdownSourceStart', 'markdownSourceEnd'].some(key => attrs?.[key] != null
      && (!Number.isSafeInteger(attrs[key]) || (attrs[key] as number) < 0))) return false;
    if (typeof attrs?.markdownSourceStart === 'number' && typeof attrs.markdownSourceEnd === 'number'
      && attrs.markdownSourceStart > attrs.markdownSourceEnd) return false;
  }
  if (node.type === 'chatGptSystemHint' && (typeof node.attrs?.label !== 'string' || !node.attrs.label
    || typeof node.attrs.systemHint !== 'string' || !systemHints.has(node.attrs.systemHint))) return false;
  if (node.marks?.some(mark => {
    if (!knownKeys(mark, ['type', 'attrs'])) return true;
    const markType = composerSchema.marks[mark.type];
    if (!markType || mark.attrs && !knownKeys(mark.attrs, Object.keys(markType.spec.attrs ?? {}))) return true;
    if (mark.type === 'link' && typeof mark.attrs?.literalMarkdownSource === 'string'
      && /[\r\n]/.test(mark.attrs.literalMarkdownSource)) return true;
    return mark.type === 'link' && mark.attrs?.literalMarkdownOccurrenceId != null
      && (!Number.isSafeInteger(mark.attrs.literalMarkdownOccurrenceId) || (mark.attrs.literalMarkdownOccurrenceId as number) < 0);
  })) return false;
  return node.content?.every(validJSON) ?? true;
}

export function readRichDocument(document: ComposerDocument): ProseMirrorNode | null {
  try {
    if (document.type !== 'doc' || !validJSON(document)) return null;
    const result = composerSchema.nodeFromJSON(document);
    result.check();
    return result;
  } catch { return null; }
}

export function serializeRichDocument(document: ProseMirrorNode, options?: { standardParagraphs?: boolean; tightLists?: boolean; escapeExtraCharacters?: RegExp }): string {
  const selected = options?.escapeExtraCharacters
    ? new MarkdownSerializer(serializer.nodes, serializer.marks, { escapeExtraCharacters: options.escapeExtraCharacters }) : serializer;
  document = projectLiteralMarks(document);
  // The original rich serializer joins a document consisting of paragraphs with single newlines.
  if (!options?.standardParagraphs && document.childCount && Array.from({ length: document.childCount }, (_, i) => document.child(i))
    .every(node => node.type.name === 'paragraph')) {
    return Array.from({ length: document.childCount }, (_, i) => selected.serialize(composerSchema.nodes.doc!.create(null, document.child(i)))).join('\n');
  }
  return selected.serialize(document, { tightLists: options?.tightLists });
}

/** Unmarked ordinary text takes the plain submission path even in the rich editor. */
export function isOrdinaryRichText(document: ProseMirrorNode): boolean {
  let ordinary = true;
  document.descendants(node => {
    if (node.isBlock && node.type.name !== 'paragraph' || node.marks.length
      || node.isInline && !node.isText && node.type.name !== 'hard_break'
      || node.isTextblock && node.textContent.includes('](')) ordinary = false;
    return ordinary;
  });
  return ordinary;
}

function plainLink(label: string, href: string, title?: string | null): string {
  if (title !== undefined && title !== null) {
    const escapedLabel = label.replace(/([\\`*_\[\]])/g, '\\$1');
    const escapedTitle = title.replace(/\\/g, '\\\\').replace(/[)"]/g, '\\$&').replace(/\r/g, '&#xD;').replace(/\n/g, '&#xA;');
    return '[' + escapedLabel + '](' + markdownDestination(href) + ' "' + escapedTitle + '")';
  }
  const escapedLabel = label.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]\(/g, ']\\(').replace(/\]/g, '\\]');
  const escapedHref = href.replace(/\\/g, '\\\\').replace(/\)/g, '\\)');
  return '[' + escapedLabel + '](' + escapedHref + ')';
}

function codeLanguage(node: ProseMirrorNode): string {
  const language = node.attrs.language;
  if (typeof language !== 'string' || !/^[^`\s]+$/u.test(language)) return '';
  return node.attrs.autoDetectLanguage !== false && language === 'plaintext' ? '' : language;
}

/** The original plain-mode saved text marks text links; its submitted text does not. */
export function serializePlainDocument(document: ProseMirrorNode, preserveTextLinkMarks = false): string {
  const inline = (node: ProseMirrorNode): string => {
    let output = '', text = '';
    let link: ProseMirrorNode['marks'][number] | undefined;
    const flush = () => {
      if (!text) return;
      if (link?.attrs.href === null) output += httpAutolinkHref(text) ? plainLink(text, text) : text;
      else if (!link || preserveTextLinkMarks && text === link.attrs.href && link.attrs.title == null) output += text;
      else output += plainLink(text, (preserveTextLinkMarks ? 'codex-text-link://' : '') + link.attrs.href, link.attrs.title);
      text = ''; link = undefined;
    };
    node.forEach(child => {
      if (child.isText) {
        const nextLink = child.marks.find(mark => mark.type.name === 'link');
        if (text && (link ? !nextLink || !link.eq(nextLink) : !!nextLink)) flush();
        text += child.text ?? ''; link = nextLink;
        return;
      }
      flush();
      if (child.type.name === 'hard_break') output += '\n';
      else if (child.type.name === 'atMention') output += plainLink(child.attrs.label, child.attrs.path);
      else if (child.type.name === 'skillMention') output += plainLink(child.attrs.promptLinkLabel || '$' + child.attrs.name, child.attrs.path);
      else if (child.type.name === 'agentMention') output += plainLink('@' + (child.attrs.displayName || child.attrs.name), child.attrs.path);
      else if (child.type.name === 'pageReferenceMention') output += plainLink(child.attrs.title, child.attrs.path);
      else if (child.type.name === 'richLink') output += plainLink(child.attrs.displayText, child.attrs.href);
      else if (child.type.name === 'chatGptSystemHint') output += plainLink(child.attrs.label, 'chatgpt-system-hint://' + child.attrs.systemHint);
    });
    flush();
    return output;
  };
  const lines: string[] = [];
  const code = (node: ProseMirrorNode, indent: string) => {
    const longest = Array.from(node.textContent.matchAll(/`+/g)).reduce((length, match) => Math.max(length, match[0].length), 2);
    const fence = '`'.repeat(longest + 1);
    lines.push(indent + fence + codeLanguage(node), ...node.textContent.split('\n').map(line => indent + line), indent + fence);
  };
  const list = (node: ProseMirrorNode, indent: string): void => node.forEach((item, _offset, index) => {
    const prefix = node.type.name === 'ordered_list' ? String(node.attrs.startingNumber + index) + '. ' : '- ';
    const continuation = indent + ' '.repeat(prefix.length);
    let seenParagraph = false;
    item.forEach(child => {
      if (child.type.name === 'paragraph') { lines.push((seenParagraph ? continuation : indent + prefix) + inline(child)); seenParagraph = true; }
      else block(child, continuation);
    });
  });
  const block = (node: ProseMirrorNode, indent = ''): void => {
    if (node.type.name === 'paragraph' || node.type.name === 'heading') lines.push(indent + inline(node));
    else if (node.type.name === 'code_block') code(node, indent);
    else if (node.type.name === 'list' || node.type.name === 'ordered_list') list(node, indent);
    else node.forEach(child => block(child, indent));
  };
  document.forEach(child => block(child));
  return lines.join('\n');
}

export function richDocumentSkills(document: ProseMirrorNode): { name: string; path: string }[] {
  const skills: { name: string; path: string }[] = [];
  document.descendants(node => {
    if (node.type.name === 'skillMention' && !skills.some(skill => skill.path === node.attrs.path && skill.name === node.attrs.name)) {
      skills.push({ name: node.attrs.name, path: node.attrs.path });
    }
  });
  return skills;
}
