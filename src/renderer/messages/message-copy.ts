import { writeClipboardText } from '../../native/browser-clipboard.ts';

export type MessageCopyContent = { plainText: string; htmlText: string };

const allowedAttributes: Record<string, string[]> = {
  A: ['href', 'title'], BLOCKQUOTE: ['cite'], CODE: ['data-language'],
  LI: ['value'], OL: ['start'], Q: ['cite'], TD: ['colspan', 'rowspan'], TH: ['colspan', 'rowspan'],
};
const blockElements = new Set(['BLOCKQUOTE', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'P', 'PRE']);
const allowedElements = new Set([
  'A', 'BLOCKQUOTE', 'BR', 'CODE', 'DEL', 'DIV', 'EM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR',
  'INPUT', 'LI', 'OL', 'P', 'PRE', 'Q', 'S', 'SPAN', 'STRONG', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
]);

function appendCopyNode(parent: Node, source: Node, document: Document): void {
  if (source.nodeType === Node.TEXT_NODE) {
    parent.appendChild(document.createTextNode(source.textContent ?? ''));
    return;
  }
  if (!(source instanceof Element) || source.getAttribute('data-markdown-copy') === 'exclude'
    || source.getAttribute('aria-hidden') === 'true' || source.classList.contains('yard-screen-reader')
    || source.classList.contains('yard-image-shell')) return;
  if (source.classList.contains('katex-display') || source.classList.contains('katex')) {
    const math = source.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
    if (math !== undefined && math !== null) {
      const display = source.classList.contains('katex-display');
      const span = document.createElement('span');
      if (display) span.dataset.mathDisplay = 'true';
      span.textContent = display ? `$$\n${math}\n$$` : `$${math}$`;
      parent.appendChild(span);
      return;
    }
  }
  if (source.getAttribute('data-markdown-copy') === 'code-block') {
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    pre.dir = 'ltr';
    code.textContent = source.getAttribute('data-markdown-copy-text') ?? '';
    const language = source.getAttribute('data-markdown-copy-language');
    if (language) code.dataset.language = language;
    pre.append(code);
    parent.appendChild(pre);
    return;
  }
  if (source.tagName === 'BUTTON') {
    parent.appendChild(document.createTextNode(source.textContent ?? ''));
    return;
  }
  if (source.tagName === 'INPUT') {
    if (source.getAttribute('type') !== 'checkbox') return;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.disabled = true;
    if ((source as HTMLInputElement).checked) input.setAttribute('checked', '');
    parent.appendChild(input);
    return;
  }
  if (!allowedElements.has(source.tagName)) {
    for (const child of source.childNodes) appendCopyNode(parent, child, document);
    return;
  }
  const element = document.createElement(source.localName);
  for (const name of allowedAttributes[source.tagName] ?? []) {
    const value = source.getAttribute(name);
    if (value !== null) element.setAttribute(name, value);
  }
  for (const child of source.childNodes) appendCopyNode(element, child, document);
  parent.appendChild(element);
}

function listText(list: Element, indent = ''): string {
  const ordered = list.tagName === 'OL';
  let number = ordered ? Number(list.getAttribute('start') ?? 1) : 1;
  return Array.from(list.children).filter((child) => child.tagName === 'LI').map((item) => {
    if (ordered && item.hasAttribute('value')) number = Number(item.getAttribute('value'));
    const marker = ordered ? `${number++}. ` : '- ';
    const continuation = indent + ' '.repeat(marker.length);
    let output = '';
    let pending = '';
    let emitted = false;
    const flush = () => {
      const lines = pending.trim().split('\n');
      pending = '';
      if (lines.length === 1 && !lines[0]) return;
      for (const line of lines) { output += `${emitted ? continuation : indent + marker}${line}\n`; emitted = true; }
    };
    for (const child of item.childNodes) {
      if (child instanceof Element && (child.tagName === 'UL' || child.tagName === 'OL')) {
        flush();
        if (!emitted) { output += `${indent}${marker.trimEnd()}\n`; emitted = true; }
        output += listText(child, continuation);
      } else pending += nodeText(child);
    }
    flush();
    return emitted ? output : `${indent}${marker.trimEnd()}\n`;
  }).join('');
}

function nodeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof Element)) return '';
  if (node.tagName === 'INPUT') return node.hasAttribute('checked') ? '[x] ' : '[ ] ';
  if (node.tagName === 'BR') return '\n';
  if (node.tagName === 'UL' || node.tagName === 'OL') return listText(node);
  if (node.tagName === 'TABLE') return Array.from(node.querySelectorAll('tr')).map((row) =>
    Array.from(row.children).filter((cell) => cell.tagName === 'TH' || cell.tagName === 'TD')
      .map((cell) => Array.from(cell.childNodes).map(nodeText).join('').trim()).join('\t')).join('\n');
  const text = Array.from(node.childNodes).map(nodeText).join('');
  return blockElements.has(node.tagName) || node.getAttribute('data-math-display') === 'true' ? `${text}\n` : text;
}

/** Serialize only the rendered message body, including content hidden by visual collapse. */
export function messageCopyContent(root: HTMLElement): MessageCopyContent {
  const document = root.ownerDocument;
  const container = document.createElement('div');
  for (const part of root.querySelectorAll('[data-user-copy-part]')) {
    for (const child of part.childNodes) appendCopyNode(container, child, document);
  }
  return { htmlText: container.innerHTML, plainText: Array.from(container.childNodes).map(nodeText).join('').trim() };
}

/** Prefer the rich clipboard API, then a user-initiated copy event and the shared plain-text fallback. */
export async function writeMessageClipboard(content: MessageCopyContent): Promise<void> {
  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([content.plainText], { type: 'text/plain' }),
        'text/html': new Blob([content.htmlText], { type: 'text/html' }),
      })]);
      return;
    } catch { /* The synchronous copy event may still be permitted. */ }
  }
  const focused = document.activeElement;
  const selection = document.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const field = document.createElement('textarea');
  field.value = content.plainText;
  field.readOnly = true;
  field.style.cssText = 'position:fixed;inset:0;opacity:0;pointer-events:none';
  const copy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    try {
      event.clipboardData.setData('text/plain', content.plainText);
      event.clipboardData.setData('text/html', content.htmlText);
      event.preventDefault();
    } catch { /* Allow the browser's selected-text fallback. */ }
  };
  document.addEventListener('copy', copy, true);
  document.body.append(field);
  let copied = false;
  try { field.select(); copied = document.execCommand('copy'); }
  catch { /* The shared fallback can still use writeText. */ }
  finally {
    document.removeEventListener('copy', copy, true);
    field.remove();
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
    selection?.removeAllRanges();
    for (const range of ranges) selection?.addRange(range);
  }
  if (!copied) await writeClipboardText(content.plainText);
}
