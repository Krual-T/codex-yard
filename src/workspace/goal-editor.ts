import { Lexer, type Token, type Tokens } from 'marked';
import { decodeHTML } from 'entities';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { Fragment, Schema, Slice, type Mark, type Node } from 'prosemirror-model';
import { Plugin, TextSelection, type EditorState } from 'prosemirror-state';

// The original Goal tab calls ih(..., enableRichText: true,
// enableCodeBlocks: true, enterBehavior: 'newline'). Keep this editor separate
// from the conversation composer so formatting cannot submit a turn.
export const goalEditorSchema = new Schema({ nodes: {
  doc: { content: 'block+' },
  paragraph: { content: 'inline*', group: 'block', parseDOM: [{ tag: 'p' }], toDOM: () => ['p', { dir: 'auto' }, 0] },
  text: { group: 'inline' },
  heading: { attrs: { level: { default: 1 } }, content: 'inline*', group: 'block', defining: true,
    parseDOM: [1, 2, 3, 4, 5, 6].map(level => ({ tag: 'h' + level, attrs: { level } })), toDOM: node => ['h' + node.attrs.level, 0] },
  blockquote: { content: 'block+', group: 'block', defining: true, parseDOM: [{ tag: 'blockquote' }], toDOM: () => ['blockquote', 0] },
  horizontal_rule: { group: 'block', parseDOM: [{ tag: 'hr' }], toDOM: () => ['hr'] },
  code_block: { attrs: { language: { default: null } }, content: 'text*', group: 'block', code: true, marks: '', defining: true,
    parseDOM: [{ tag: 'pre', preserveWhitespace: 'full', getAttrs: element => ({ language: element.querySelector('code')?.getAttribute('data-language') ?? null }) }],
    toDOM: node => ['pre', { 'data-composer-code-block': '', dir: 'ltr' }, ['code', { spellcheck: 'false', 'data-language': node.attrs.language }, 0]] },
  bullet_list: { content: 'list_item+', group: 'block', parseDOM: [{ tag: 'ul' }], toDOM: () => ['ul', 0] },
  ordered_list: { attrs: { order: { default: 1 } }, content: 'list_item+', group: 'block',
    parseDOM: [{ tag: 'ol', getAttrs: element => ({ order: Number(element.getAttribute('start')) || 1 }) }], toDOM: node => ['ol', { start: node.attrs.order }, 0] },
  list_item: { attrs: { checked: { default: null } }, content: 'paragraph block*', defining: true,
    parseDOM: [{ tag: 'li', getAttrs: element => ({ checked: element.hasAttribute('data-checked') ? element.getAttribute('data-checked') === 'true' : null }) }],
    toDOM: node => node.attrs.checked == null ? ['li', 0] : ['li', { 'data-task-list-item': '', 'data-checked': String(node.attrs.checked) },
      ['input', { type: 'checkbox', checked: node.attrs.checked ? '' : null, contenteditable: 'false', tabindex: '-1', 'aria-label': 'Toggle task' }], ['div', 0]] },
  hard_break: { inline: true, group: 'inline', selectable: false, parseDOM: [{ tag: 'br' }], toDOM: () => ['br'] },
  table: { content: 'table_row+', group: 'block', parseDOM: [{ tag: 'table' }], toDOM: () => ['table', ['tbody', 0]] },
  table_row: { content: 'table_cell+', parseDOM: [{ tag: 'tr' }], toDOM: () => ['tr', 0] },
  table_cell: { attrs: { header: { default: false }, align: { default: null } }, content: 'inline*',
    parseDOM: [{ tag: 'td' }, { tag: 'th', attrs: { header: true } }],
    toDOM: node => [node.attrs.header ? 'th' : 'td', { style: node.attrs.align ? 'text-align:' + node.attrs.align : null }, 0] },
}, marks: {
  strong: { parseDOM: [{ tag: 'strong' }, { tag: 'b' }], toDOM: () => ['strong', 0] },
  em: { parseDOM: [{ tag: 'em' }, { tag: 'i' }], toDOM: () => ['em', 0] },
  strike: { parseDOM: [{ tag: 's' }, { tag: 'del' }], toDOM: () => ['s', 0] },
  code: { code: true, excludes: '_', parseDOM: [{ tag: 'code' }], toDOM: () => ['code', 0] },
  link: { attrs: { href: {}, title: { default: null } }, inclusive: false,
    parseDOM: [{ tag: 'a[href]', getAttrs: element => goalHref(element.getAttribute('href') ?? '') ? { href: element.getAttribute('href'), title: element.getAttribute('title') } : false }],
    toDOM: node => ['a', { href: node.attrs.href, title: node.attrs.title, rel: 'noreferrer' }, 0] },
} });
const schema = goalEditorSchema;
const paragraph = (content: readonly Node[] = []) => schema.node('paragraph', null, content);
const literal = (text: string, marks: readonly Mark[] = []) => text ? [schema.text(decodeHTML(text), marks)] : [];
function goalHref(value: string) { return !!value && !/^[\s\u0000-\u0020]*(?:javascript|vbscript|data):/i.test(value); }
function inline(tokens: Token[], marks: readonly Mark[] = []): Node[] {
  return tokens.flatMap(token => {
    switch (token.type) {
      case 'checkbox': return [];
      case 'strong': case 'em': case 'del': {
        const value = token as Tokens.Strong | Tokens.Em | Tokens.Del;
        return inline(value.tokens, [...marks, schema.marks[token.type === 'del' ? 'strike' : token.type]!.create()]);
      }
      case 'codespan': return literal(token.text, [...marks, schema.marks.code!.create()]);
      case 'link': { const value = token as Tokens.Link;
        return inline(value.tokens, goalHref(value.href) ? [...marks, schema.marks.link!.create({ href: value.href, title: value.title || null })] : marks); }
      case 'br': return [schema.node('hard_break', null, undefined, marks)];
      case 'image': return literal(token.raw, marks);
      case 'escape': return literal(token.text, marks);
      case 'text': return 'tokens' in token && token.tokens ? inline(token.tokens as Token[], marks) : literal(token.text, marks);
      default: return literal(token.raw, marks);
    }
  });
}
function blocks(tokens: Token[]): Node[] {
  return tokens.flatMap(token => {
    switch (token.type) {
      case 'space': case 'checkbox': return [];
      case 'paragraph': case 'text': return [paragraph(inline('tokens' in token && token.tokens ? token.tokens as Token[] : Lexer.lexInline(token.text)))];
      case 'heading': return [schema.node('heading', { level: token.depth }, inline(token.tokens ?? []))];
      case 'blockquote': return [schema.node('blockquote', null, blocks(token.tokens ?? []))];
      case 'hr': return [schema.node('horizontal_rule')];
      case 'code': return [schema.node('code_block', { language: token.lang?.split(/\s/)[0] || null }, token.text ? schema.text(token.text) : undefined)];
      case 'list': { const list = token as Tokens.List;
        return [schema.node(list.ordered ? 'ordered_list' : 'bullet_list', list.ordered ? { order: list.start } : null,
        list.items.map(item => {
          const content = blocks(item.tokens);
          if (!content.length || content[0]!.type !== schema.nodes.paragraph) content.unshift(paragraph());
          return schema.node('list_item', { checked: item.task ? item.checked : null }, content);
        }))]; }
      case 'table': { const table = token as Tokens.Table;
        return [schema.node('table', null, [
        schema.node('table_row', null, table.header.map((cell, index) => schema.node('table_cell', { header: true, align: table.align[index] }, inline(cell.tokens)))),
        ...table.rows.map(row => schema.node('table_row', null, row.map((cell, index) => schema.node('table_cell', { align: table.align[index] }, inline(cell.tokens))))),
      ])]; }
      default: return token.raw ? token.raw.trimEnd().split('\n').map(line => paragraph(literal(line))) : [];
    }
  });
}
export function goalDocument(text: string) {
  const content = blocks(Lexer.lex(text, { gfm: true }));
  return schema.node('doc', null, content.length ? content : [paragraph()]);
}
function inlineMarkdown(node: Node): string {
  let result = '';
  node.forEach(child => {
    if (child.type === schema.nodes.hard_break) { result += '  \n'; return; }
    let text = child.text ?? child.textContent;
    const code = child.marks.find(mark => mark.type === schema.marks.code);
    if (code) {
      const fence = '`'.repeat(Math.max(1, ...Array.from(text.matchAll(/`+/g), match => match[0].length + 1)));
      text = fence + (text.startsWith('`') || text.endsWith('`') ? ' ' + text + ' ' : text) + fence;
    } else text = text.replace(/([\\`*_\[\]~])/g, '\\$1');
    for (const mark of child.marks) {
      if (mark.type === schema.marks.strong) text = '**' + text + '**';
      else if (mark.type === schema.marks.em) text = '*' + text + '*';
      else if (mark.type === schema.marks.strike) text = '~~' + text + '~~';
      else if (mark.type === schema.marks.link) text = '[' + text + '](' + String(mark.attrs.href).replace(/[()\\]/g, '\\$&') +
        (mark.attrs.title ? ' "' + String(mark.attrs.title).replace(/"/g, '\\"') + '"' : '') + ')';
    }
    result += text;
  });
  return result;
}
function blockMarkdown(node: Node): string {
  switch (node.type.name) {
    case 'paragraph': case 'table_cell': return inlineMarkdown(node);
    case 'heading': return '#'.repeat(node.attrs.level) + ' ' + inlineMarkdown(node);
    case 'horizontal_rule': return '---';
    case 'code_block': {
      const fence = '`'.repeat(Math.max(3, ...Array.from(node.textContent.matchAll(/`+/g), match => match[0].length + 1)));
      return fence + (node.attrs.language || '') + '\n' + node.textContent + '\n' + fence;
    }
    case 'blockquote': return childrenMarkdown(node).split('\n').map(line => '> ' + line).join('\n');
    case 'bullet_list': case 'ordered_list': {
      const rows: string[] = [];
      node.forEach((item, _offset, index) => {
        const marker = node.type === schema.nodes.ordered_list ? `${node.attrs.order + index}. ` : '- ';
        const text = childrenMarkdown(item), task = item.attrs.checked == null ? '' : item.attrs.checked ? '[x] ' : '[ ] ';
        rows.push((marker + task + text.split('\n')[0]) + text.split('\n').slice(1).map(line => '\n' + ' '.repeat(marker.length) + line).join(''));
      });
      return rows.join('\n');
    }
    case 'table': {
      const rows: string[] = [];
      node.forEach((row, _offset, index) => {
        const cells: string[] = []; row.forEach(cell => cells.push(inlineMarkdown(cell).replace(/\|/g, '\\|').replace(/\n/g, '<br>')));
        rows.push('| ' + cells.join(' | ') + ' |');
        if (index === 0) { const alignment: string[] = []; row.forEach(cell => alignment.push(cell.attrs.align === 'center' ? ':---:' : cell.attrs.align === 'right' ? '---:' : cell.attrs.align === 'left' ? ':---' : '---')); rows.push('| ' + alignment.join(' | ') + ' |'); }
      });
      return rows.join('\n');
    }
    default: return childrenMarkdown(node);
  }
}
function childrenMarkdown(node: Node) {
  const parts: string[] = []; node.forEach(child => parts.push(blockMarkdown(child)));
  return parts.join(node.childCount && node.content.content.every(child => child.type === schema.nodes.paragraph) ? '\n' : '\n\n');
}
export function goalMarkdown(node: Node) { return childrenMarkdown(node); }

function inputBlock(state: EditorState, inserted: string) {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type !== schema.nodes.paragraph) return null;
  const value = $from.parent.textBetween(0, $from.parentOffset) + inserted;
  const heading = /^(#{1,6}) $/.exec(value), ordered = /^(\d+)\. $/.exec(value);
  const task = /^- \[([ xX])\] $/.exec(value);
  let node: Node;
  if (heading) node = schema.node('heading', { level: heading[1]!.length });
  else if (/^> $/.test(value)) node = schema.node('blockquote', null, paragraph());
  else if (/^[-*+] $/.test(value) || ordered || task) node = schema.node(ordered ? 'ordered_list' : 'bullet_list', ordered ? { order: Number(ordered[1]) } : null,
    schema.node('list_item', { checked: task ? task[1]!.toLowerCase() === 'x' : null }, paragraph()));
  else return null;
  const from = $from.before(), transaction = state.tr.replaceWith(from, $from.after(), node);
  return transaction.setSelection(TextSelection.near(transaction.doc.resolve(from + 1)));
}

export function goalEditorPlugins(save: () => void) {
  return [history(), keymap({ ...baseKeymap, 'Mod-z': undo, 'Mod-y': redo, 'Mod-Shift-z': redo,
    'Mod-b': toggleMark(schema.marks.strong!), 'Mod-i': toggleMark(schema.marks.em!), 'Mod-e': toggleMark(schema.marks.code!),
    'Mod-Shift-s': toggleMark(schema.marks.strike!),
    'Mod-Enter': () => { save(); return true; }, 'Mod-s': () => { save(); return true; },
    Enter: (state, dispatch) => {
      const { $from, empty } = state.selection;
      const fence = empty && $from.parent.type === schema.nodes.paragraph && /^```([\w+-]*)$/.exec($from.parent.textContent);
      if (fence) {
        dispatch?.(state.tr.replaceWith($from.before(), $from.after(), schema.node('code_block', { language: fence[1] || null })));
        return true;
      }
      return baseKeymap.Enter!(state, dispatch);
    },
    Tab: (state, dispatch) => {
      if (state.selection.$from.parent.type !== schema.nodes.code_block) return false;
      dispatch?.(state.tr.insertText('  ')); return true;
    },
  }), new Plugin({ props: {
    handleClickOn(view, _pos, node, nodePos, event) {
      if (node.type !== schema.nodes.list_item || node.attrs.checked == null || !(event.target instanceof HTMLInputElement)) return false;
      view.dispatch(view.state.tr.setNodeMarkup(nodePos, undefined, { ...node.attrs, checked: !node.attrs.checked }));
      return true;
    },
    handleTextInput(view, from, to, text) {
      if (view.composing) return false;
      const block = inputBlock(view.state, text);
      if (block) { view.dispatch(block); return true; }
      const { $from } = view.state.selection;
      if ($from.parent.type === schema.nodes.code_block || from !== to) return false;
      const value = $from.parent.textBetween(0, $from.parentOffset) + text;
      const match = /(?:^|\s)(\*\*|__|~~|`|\*|_)([^\n]+?)\1$/.exec(value);
      if (!match || !match[2]?.trim()) return false;
      const marker = match[1]!, start = from - match[0].length + text.length + (/^\s/.test(match[0]) ? 1 : 0);
      const mark = marker === '**' || marker === '__' ? 'strong' : marker === '~~' ? 'strike' : marker === '`' ? 'code' : 'em';
      view.dispatch(view.state.tr.insertText(match[2], start, to).addMark(start, start + match[2].length, schema.marks[mark]!.create()));
      return true;
    },
    handlePaste(view, event) {
      const text = event.clipboardData?.getData('text/plain');
      if (!text || view.state.selection.$from.parent.type === schema.nodes.code_block) return false;
      if (!view.state.selection.empty && /^(?:https?:\/\/|mailto:)[^\s]+$/.test(text)) {
        view.dispatch(view.state.tr.addMark(view.state.selection.from, view.state.selection.to, schema.marks.link!.create({ href: text }))); return true;
      }
      if (!/(?:^|\n)\s*(?:#{1,6} |```|~~~|[-*>] |\d+\. )|\*\*[^*]+\*\*|\[[^\]]+\]\([^\s]+\)/.test(text)) return false;
      const doc = goalDocument(text), open = doc.firstChild?.type === schema.nodes.paragraph ? 1 : 0;
      view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.from(doc.content), open, doc.lastChild?.type === schema.nodes.paragraph ? 1 : 0)).scrollIntoView());
      return true;
    },
  } })];
}
