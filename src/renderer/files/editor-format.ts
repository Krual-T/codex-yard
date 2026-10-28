import { invertedEffects } from '@codemirror/commands';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import type { Extension, Transaction } from '@codemirror/state';

interface FileFormat { bom: boolean; endings: string }

const restoreFormat = StateEffect.define<FileFormat>();

function updatedFormat(format: FileFormat, transaction: Transaction): FileFormat {
  let endings = format.endings;
  const changes: { index: number; removed: number; inserted: number }[] = [];
  transaction.changes.iterChanges((from, to, _fromNew, _toNew, inserted) => {
    const start = transaction.startState.doc.lineAt(from).number - 1;
    changes.push({ index: start, removed: transaction.startState.doc.lineAt(to).number - 1 - start, inserted: inserted.lines - 1 });
  });
  for (const change of changes.reverse()) {
    const ending = endings[change.index] ?? endings[change.index - 1] ?? 'n';
    endings = endings.slice(0, change.index) + ending.repeat(change.inserted) + endings.slice(change.index + change.removed);
  }
  let result = endings === format.endings ? format : { ...format, endings };
  for (const effect of transaction.effects) if (effect.is(restoreFormat)) result = effect.value;
  return result;
}

/** Keep exact original line separators outside CodeMirror's normalized document. */
export function fileFormat(initial: string): { extension: Extension; field: StateField<FileFormat> } {
  const initialFormat: FileFormat = {
    bom: initial.startsWith('\ufeff'),
    endings: Array.from(initial.matchAll(/\r\n|\r|\n/g), match => match[0] === '\r\n' ? 'w' : match[0] === '\r' ? 'r' : 'n').join(''),
  };
  const field = StateField.define<FileFormat>({
    create: () => initialFormat,
    update: updatedFormat,
  });
  return {
    field,
    extension: [field, invertedEffects.of(transaction => {
      const before = transaction.startState.field(field);
      return updatedFormat(before, transaction) === before ? [] : [restoreFormat.of(before)];
    })],
  };
}

export function fileText(state: EditorState, field: StateField<FileFormat>): string {
  const format = state.field(field);
  const lines = state.doc.iter();
  let result = format.bom ? '\ufeff' : '';
  let line = 0;
  while (!lines.next().done) {
    if (lines.lineBreak) {
      const ending = format.endings[line++];
      result += ending === 'w' ? '\r\n' : ending === 'r' ? '\r' : '\n';
    } else result += lines.value;
  }
  return result;
}
