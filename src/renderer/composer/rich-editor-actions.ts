import { baseKeymap } from 'prosemirror-commands';
import { closeHistory, history, redo, undo } from 'prosemirror-history';
import { inputRules, textblockTypeInputRule, undoInputRule, wrappingInputRule } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import { Fragment } from 'prosemirror-model';
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';
import { TextSelection } from 'prosemirror-state';
import type { Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Completion } from './standalone-completions.tsx';
import { composerSchema } from './rich-document.ts';

export interface RichCompletionContext { text: string; cursor: number; blockStart: number }
export interface RichCompletionQuery { start: number; end: number; token: string }

export function syncRichSelection(editor: EditorView): void {
  if (!editor.hasFocus() || editor.composing) return;
  const document = editor.dom.ownerDocument, selection = document.getSelection(), window = document.defaultView;
  if (!window || !selection?.anchorNode || !selection.focusNode
    || !editor.dom.contains(selection.anchorNode) || !editor.dom.contains(selection.focusNode)) return;
  // Let ProseMirror reconcile pending DOM selection and mutations before a command.
  document.dispatchEvent(new window.Event('selectionchange'));
}

export function richCompletionContext(editor: EditorView): RichCompletionContext | null {
  const { selection } = editor.state;
  if (editor.composing || !selection.empty || !selection.$from.parent.isTextblock || selection.$from.parent.type.spec.code) return null;
  const position = selection.$from;
  return {
    text: position.parent.textBetween(0, position.parent.content.size, undefined, node => node.type.name === 'hard_break' ? '\n' : '\ufffc'),
    cursor: position.parentOffset,
    blockStart: position.start(),
  };
}

/** Apply a result only while the originating textblock, token and caret still match. */
export function insertRichCompletion(editor: EditorView, expected: RichCompletionContext, query: RichCompletionQuery, item: Completion, cwd: string): boolean {
  const current = richCompletionContext(editor);
  if (!current || current.blockStart !== expected.blockStart || current.cursor !== expected.cursor || current.text !== expected.text
    || query.end !== current.cursor || query.start < 0 || current.text.slice(query.start, query.end) !== query.token) return false;
  const suffix = current.text.slice(query.end).match(query.token.startsWith('@') ? /^[^\s@$\ufffc]*/ : /^[^\s@$\/\ufffc]*/)?.[0] ?? '';
  const from = current.blockStart + query.start, to = current.blockStart + query.end + suffix.length;
  let transaction = editor.state.tr;
  let caret = from;
  if (item.kind === 'directory') {
    const text = '@' + item.path + '/';
    transaction = transaction.insertText(text, from, to);
    caret += text.length;
  } else if (item.kind === 'command') {
    transaction = transaction.delete(from, to);
  } else {
    const node = item.kind === 'skill'
      ? composerSchema.nodes.skillMention!.create({ name: item.name, path: item.path, description: item.description,
        displayName: item.name, promptLinkLabel: '$' + item.name })
      : composerSchema.nodes.atMention!.create({ label: '@' + item.path, path: cwd.replace(/\/$/, '') + '/' + item.path,
        fsPath: cwd.replace(/\/$/, '') + '/' + item.path });
    transaction = transaction.replaceWith(from, to, Fragment.fromArray([node, composerSchema.text(' ')]));
    caret += 2;
  }
  transaction = transaction.setSelection(TextSelection.create(transaction.doc, caret)).scrollIntoView();
  editor.dispatch(closeHistory(transaction));
  editor.dispatch(closeHistory(editor.state.tr));
  return true;
}

function separateHistory(command: Command): Command {
  return (state, dispatch, view) => command(state, dispatch ? transaction => {
    dispatch(closeHistory(transaction));
    if (view) dispatch(closeHistory(view.state.tr));
  } : undefined, view);
}

export function richEditorPlugins() {
  const nodes = composerSchema.nodes;
  const listItem = nodes.regular_list_item!;
  const historyPlugin = history();
  const markdownRules = inputRules({ rules: [
    wrappingInputRule(/^\s*([-+*])\s$/, nodes.list!),
    wrappingInputRule(/^([1-9]\d{0,8})\.\s$/, nodes.ordered_list!, match => ({ startingNumber: Number(match[1]) }),
      (match, node) => node.attrs.startingNumber + node.childCount === Number(match[1])),
    wrappingInputRule(/^\s*>\s$/, nodes.blockquote!),
    textblockTypeInputRule(/^(#{1,6})\s$/, nodes.heading!, match => ({ level: match[1]!.length })),
    textblockTypeInputRule(/^```([\w+-]*)\s$/, nodes.code_block!, match => ({ autoDetectLanguage: !match[1], language: match[1] || null })),
  ] });
  const keys = keymap({
    'Mod-z': undo, 'Mod-Shift-z': redo, 'Mod-y': redo, Backspace: undoInputRule,
    Enter: separateHistory(splitListItem(listItem)), Tab: separateHistory(sinkListItem(listItem)), 'Shift-Tab': separateHistory(liftListItem(listItem)),
    'Shift-Enter': (state, dispatch) => {
      const br = state.schema.nodes.hard_break;
      if (!br || state.selection.$from.parent.type.spec.code) return false;
      if (dispatch) dispatch(state.tr.replaceSelectionWith(br.create()).scrollIntoView());
      return true;
    },
  });
  const baseKeys = keymap(baseKeymap);
  return { rich: [historyPlugin, markdownRules, keys, baseKeys], plain: [historyPlugin, keys, baseKeys] };
}
