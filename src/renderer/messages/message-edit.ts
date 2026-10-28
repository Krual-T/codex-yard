import type { ThreadItemSummary, ThreadSummary } from '../../../lib/codex-protocol.ts';
import type { ComposerDocument, ComposerDraft } from '../workbench-contract.ts';
import { asRecord } from './message-data.ts';

export type EditTarget = { turnId: string; itemId: string; restriction: string | null };
export type TextEdit = { index: number; text: string };
type EditResult = { draft: ComposerDraft; error?: never } | { draft?: never; error: string };

export function latestEditTarget(thread: ThreadSummary): EditTarget | null {
  for (let turnIndex = thread.turns.length - 1; turnIndex >= 0; turnIndex--) {
    const turn = thread.turns[turnIndex]!;
    const users = turn.items.filter((item) => item.type === 'userMessage');
    const item = users.at(-1);
    if (!item) continue;
    let restriction: string | null = null;
    if (thread.status.type === 'active' || thread.turns.some((entry) => entry.status === 'inProgress')) {
      restriction = 'Wait for the active turn to finish before editing.';
    } else if (thread.status.type !== 'idle') {
      restriction = 'The conversation status is unavailable. Reload it before editing.';
    } else if (thread.turns.slice(turnIndex).some((entry) => entry.itemsView !== 'full')) {
      restriction = 'The latest conversation history is incomplete. Reload it before editing.';
    } else if (users.length > 1) {
      restriction = 'This turn contains multiple user messages and cannot be edited without losing earlier input.';
    }
    return { turnId: turn.id, itemId: item.id, restriction };
  }
  return null;
}

export function editSourceSignature(item: ThreadItemSummary): string {
  return JSON.stringify([item.content, item.document, item.format, item.hints]);
}

export function textEdits(draft: ComposerDraft): TextEdit[] {
  return (draft.input ?? []).flatMap((entry, index) => entry.type === 'text' && typeof entry.text === 'string'
    ? [{ index, text: entry.text }] : []);
}

type TextChange = { start: number; oldEnd: number; newEnd: number };

function textChange(before: string, after: string): TextChange {
  const oldChars = Array.from(before);
  const newChars = Array.from(after);
  let start = 0;
  while (start < oldChars.length && start < newChars.length && oldChars[start] === newChars[start]) start++;
  let suffix = 0;
  while (suffix < oldChars.length - start && suffix < newChars.length - start
    && oldChars[oldChars.length - suffix - 1] === newChars[newChars.length - suffix - 1]) suffix++;
  const prefixLength = oldChars.slice(0, start).join('').length;
  const oldSuffixLength = suffix ? oldChars.slice(-suffix).join('').length : 0;
  const newSuffixLength = suffix ? newChars.slice(-suffix).join('').length : 0;
  return { start: prefixLength, oldEnd: before.length - oldSuffixLength, newEnd: after.length - newSuffixLength };
}

function adjustTextElements(entry: Record<string, unknown>, before: string, after: string): string | null {
  if (Object.keys(entry).some((key) => !['type', 'text', 'text_elements'].includes(key))) {
    return 'This text contains unrecognized metadata. Restore the original text to keep it.';
  }
  const elements = entry.text_elements;
  if (elements == null) return null;
  if (!Array.isArray(elements)) return 'This text contains unrecognized references. Restore the original text to keep them.';
  if (!elements.length) return null;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const original = encoder.encode(before);
  const updated = encoder.encode(after);
  if (decoder.decode(original) !== before || decoder.decode(updated) !== after) return 'This text contains an invalid Unicode sequence.';
  const change = textChange(before, after);
  const start = encoder.encode(before.slice(0, change.start)).length;
  const oldEnd = encoder.encode(before.slice(0, change.oldEnd)).length;
  const delta = updated.length - original.length;
  const next: Record<string, unknown>[] = [];
  const boundary = (offset: number) => offset === original.length || (original[offset]! & 0xc0) !== 0x80;
  for (const value of elements) {
    const element = asRecord(value);
    const range = asRecord(element.byteRange);
    const from = range.start;
    const to = range.end;
    if (typeof from !== 'number' || typeof to !== 'number' || !Number.isInteger(from) || !Number.isInteger(to)
      || from < 0 || to < from || to > original.length) return 'This text contains an unrecognized reference range.';
    if (!boundary(from) || !boundary(to)) return 'This text contains an invalid reference range.';
    if (from === to && from === start && start === oldEnd) return 'The edit overlaps a reference. Restore that part of the text to preserve its context.';
    if (to <= start) next.push(element);
    else if (from >= oldEnd) next.push({ ...element, byteRange: { ...range, start: from + delta, end: to + delta } });
    else return 'The edit overlaps a reference. Restore that part of the text to preserve its context.';
  }
  entry.text_elements = next;
  return null;
}

type TextLeaf = { node: ComposerDocument; start: number; end: number };

function documentText(document: ComposerDocument, separator: string): { text: string; leaves: TextLeaf[] } | null {
  const leaves: TextLeaf[] = [];
  let text = '';
  const append = (node: ComposerDocument): boolean => {
    if (node.type === 'text' && typeof node.text === 'string' && node.content === undefined) {
      const start = text.length;
      text += node.text;
      leaves.push({ node, start, end: text.length });
      return true;
    }
    if (node.type === 'hardBreak' && node.text === undefined && node.content === undefined) { text += '\n'; return true; }
    if ((node.type !== 'doc' && node.type !== 'paragraph') || node.text !== undefined) return false;
    const children = node.content ?? [];
    for (let index = 0; index < children.length; index++) {
      if (node.type === 'doc' && index) text += separator;
      if (!append(children[index]!)) return false;
    }
    return true;
  };
  return append(document) ? { text, leaves } : null;
}

function updateDocument(document: ComposerDocument, before: string, after: string): string | null {
  if (before === after) return null;
  const projected = [documentText(document, '\n\n'), documentText(document, '\n')]
    .find((candidate) => candidate?.text === before);
  if (!projected) return 'This document has formatting or context that cannot be safely updated here.';
  const change = textChange(before, after);
  const leaves = projected.leaves.filter((leaf) => change.start >= leaf.start && change.oldEnd <= leaf.end);
  if (leaves.length !== 1) return 'This edit crosses formatting boundaries. Edit within one formatted span at a time.';
  const leaf = leaves[0]!;
  if (Object.keys(leaf.node).some((key) => !['type', 'text', 'marks', 'attrs'].includes(key))) {
    return 'This document has unrecognized text metadata that cannot be safely updated here.';
  }
  const next = leaf.node.text!.slice(0, change.start - leaf.start)
    + after.slice(change.start, change.newEnd) + leaf.node.text!.slice(change.oldEnd - leaf.start);
  if (!next || next.includes('\n')) return 'This edit cannot preserve the document formatting. Restore the original text.';
  leaf.node.text = next;
  return null;
}

function knownInput(entry: Record<string, unknown>): boolean {
  switch (entry.type) {
    case 'text': return typeof entry.text === 'string';
    case 'image': return typeof entry.url === 'string' || typeof entry.fileId === 'string';
    case 'localImage': case 'localAudio': return typeof entry.path === 'string';
    case 'audio': return typeof entry.url === 'string';
    case 'skill': case 'mention': return typeof entry.name === 'string' && typeof entry.path === 'string';
    default: return false;
  }
}

export function applyTextEdits(original: ComposerDraft, edits: TextEdit[], addedText: string): EditResult {
  const draft = structuredClone(original);
  const input = draft.input;
  if (!input) return { error: 'The original message input is unavailable.' };
  const expected = textEdits(draft);
  if (expected.length !== edits.length || expected.some((entry, index) => entry.index !== edits[index]?.index)) {
    return { error: 'The original message text changed. Cancel and reopen the editor.' };
  }
  const changed = expected.some((entry, index) => entry.text !== edits[index]!.text) || (!expected.length && addedText !== '');
  if (changed && input.some((entry) => !knownInput(entry))) {
    return { error: 'This message contains unrecognized input. Its original content has been preserved.' };
  }
  for (const [index, entry] of expected.entries()) {
    const next = edits[index]!;
    if (entry.text === next.text) continue;
    const error = adjustTextElements(input[entry.index]!, entry.text, next.text);
    if (error) return { error };
    input[entry.index]!.text = next.text;
  }
  if (!expected.length && addedText) input.unshift({ type: 'text', text: addedText, text_elements: [] });
  const text = textEdits(draft).map((entry) => entry.text).join('\n');
  if (draft.document) {
    const error = updateDocument(draft.document, draft.text, text);
    if (error) return { error };
  }
  draft.text = text;
  return { draft };
}
