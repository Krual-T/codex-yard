import { Schema } from 'prosemirror-model';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { defaultMarkdownSerializer, MarkdownSerializer } from 'prosemirror-markdown';
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
    link: { attrs: { href: string, title: optionalString, isAutolink: { default: false, validate: 'boolean' },
      isGeneratedAutolink: { default: false, validate: 'boolean' }, sourceAppId: optionalString,
      literalMarkdownSource: optionalString, literalMarkdownOccurrenceId: { default: null, validate: 'number|null' } },
      inclusive: false, parseDOM: [{ tag: 'a[href]', getAttrs: dom => {
        const element = dom as HTMLElement;
        return element.hasAttribute('data-composer-attrs') ? copiedAttrs(element, ['href'])
          : { href: element.getAttribute('href'), title: element.getAttribute('title') };
      } }],
      toDOM: mark => ['a', { href: mark.attrs.href, title: mark.attrs.title, 'data-composer-attrs': JSON.stringify(mark.attrs) }, 0] },
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
  chatGptSystemHint: (state, node) => state.write('[' + state.esc(node.attrs.label) + '](chatgpt-system-hint://' + node.attrs.systemHint + ')'),
}, { ...defaultMarkdownSerializer.marks, link: {
  ...defaultLink,
  open: (state, mark, parent, index) => /[\s<>]/.test(mark.attrs.href) ? '['
    : typeof defaultLink.open === 'function' ? defaultLink.open(state, mark, parent, index) : defaultLink.open,
  close: (state, mark, parent, index) => {
    if (!/[\s<>]/.test(mark.attrs.href)) {
      return typeof defaultLink.close === 'function' ? defaultLink.close(state, mark, parent, index) : defaultLink.close;
    }
    return '](' + markdownDestination(mark.attrs.href)
      + (mark.attrs.title ? ' "' + mark.attrs.title.replace(/"/g, '\\"') + '"' : '') + ')';
  },
} });

function knownKeys(value: object, allowed: string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}
function validJSON(node: ComposerDocument): boolean {
  if (!knownKeys(node, ['type', 'attrs', 'content', 'marks', 'text'])) return false;
  const spec = composerSchema.nodes[node.type];
  if (!spec || node.attrs && !knownKeys(node.attrs, Object.keys(spec.spec.attrs ?? {}))) return false;
  if (node.type === 'text' ? typeof node.text !== 'string' || !node.text || !!node.content || !!node.attrs
    : node.text !== undefined || spec.isLeaf && !!node.content?.length) return false;
  if (node.type === 'heading' && node.attrs?.level !== undefined
    && (!Number.isInteger(node.attrs.level) || (node.attrs.level as number) < 1 || (node.attrs.level as number) > 6)) return false;
  if (node.type === 'ordered_list' && node.attrs?.startingNumber !== undefined
    && (!Number.isInteger(node.attrs.startingNumber) || (node.attrs.startingNumber as number) < 1)) return false;
  if (node.type === 'skillMention' && (!node.attrs?.path || !node.attrs?.name)) return false;
  if (node.type === 'chatGptSystemHint' && (typeof node.attrs?.label !== 'string' || !node.attrs.label
    || typeof node.attrs.systemHint !== 'string' || !systemHints.has(node.attrs.systemHint))) return false;
  if (node.marks?.some(mark => {
    if (!knownKeys(mark, ['type', 'attrs'])) return true;
    const markType = composerSchema.marks[mark.type];
    if (!markType || mark.attrs && !knownKeys(mark.attrs, Object.keys(markType.spec.attrs ?? {}))) return true;
    return mark.type === 'link' && (mark.attrs?.literalMarkdownSource != null || mark.attrs?.literalMarkdownOccurrenceId != null);
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
  if (title) {
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
      if (!link || preserveTextLinkMarks && text === link.attrs.href && link.attrs.title == null) output += text;
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
