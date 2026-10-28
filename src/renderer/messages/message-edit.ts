import type { ThreadItemSummary, ThreadSummary } from '../../../lib/codex-protocol.ts';
import type { ComposerDocument, ComposerDraft } from '../workbench-contract.ts';
import { asRecord, serializedMessageContext } from './message-data.ts';

export type EditTarget = { turnId: string; itemId: string; restriction: string | null };
export type TextEdit = { index: number; text: string };
export type RemovedMessageAttachment = { kind: 'image'; inputIndex: number } | { kind: 'file'; inputIndex: number; fileIndex: number };
type EditResult = { draft: ComposerDraft; error?: never } | { draft?: never; error: string };

export function isRemovedMessageAttachments(value: unknown): value is RemovedMessageAttachment[] {
  return Array.isArray(value) && value.every((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const entry = item as Record<string, unknown>;
    const allowed = entry.kind === 'image' ? ['kind', 'inputIndex'] : entry.kind === 'file' ? ['kind', 'inputIndex', 'fileIndex'] : [];
    return allowed.length > 0 && Object.keys(entry).every((key) => allowed.includes(key))
      && Number.isSafeInteger(entry.inputIndex) && Number(entry.inputIndex) >= 0
      && (entry.kind !== 'file' || (Number.isSafeInteger(entry.fileIndex) && Number(entry.fileIndex) >= 0));
  });
}

export type MessageEditHistory = { order: 'ascending' | 'descending'; tailComplete: boolean };

function hasReverseTimestamps(thread: ThreadSummary): boolean {
  let previous: number | undefined;
  for (const turn of thread.turns) {
    const startedAt = (turn as typeof turn & { startedAt?: unknown }).startedAt;
    if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) continue;
    if (previous !== undefined && startedAt < previous) return true;
    previous = startedAt;
  }
  return false;
}

export function latestEditTarget(thread: ThreadSummary, history?: MessageEditHistory): EditTarget | null {
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
    } else if (history?.order !== 'ascending' || !history.tailComplete || hasReverseTimestamps(thread)) {
      restriction = 'The latest conversation history order or tail is unconfirmed. Reload it before editing.';
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

export function canRemoveImageAttachment(draft: ComposerDraft, inputIndex: number): boolean {
  const entry = draft.input?.[inputIndex];
  const matches = draft.images.filter((image) => image.id === `image-${inputIndex}`);
  if (!entry || matches.length !== 1) return false;
  const image = matches[0]!;
  if (entry.type === 'localImage') return typeof entry.path === 'string' && image.path === entry.path;
  if (entry.type !== 'image') return false;
  if (typeof entry.url === 'string') return image.src === entry.url;
  return typeof entry.fileId === 'string' && image.fileId === entry.fileId;
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
  const moved: { from: number; to: number; newFrom: number; newTo: number }[] = [];
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
    let newFrom: number;
    let newTo: number;
    if (to <= start) { newFrom = from; newTo = to; }
    else if (from >= oldEnd) { newFrom = from + delta; newTo = to + delta; }
    else {
      if (from === to) return 'The edit overlaps a reference. Restore that part of the text to preserve its context.';
      const anchor = decoder.decode(original.slice(from, to));
      const oldIndex = before.indexOf(anchor);
      const newIndex = after.indexOf(anchor);
      if (oldIndex < 0 || before.indexOf(anchor, oldIndex + 1) >= 0 || newIndex < 0 || after.indexOf(anchor, newIndex + 1) >= 0) {
        return 'The edit overlaps a reference or its position is ambiguous. Restore that part of the text to preserve its context.';
      }
      newFrom = encoder.encode(after.slice(0, newIndex)).length;
      newTo = newFrom + encoder.encode(anchor).length;
    }
    moved.push({ from, to, newFrom, newTo });
    next.push({ ...element, byteRange: { ...range, start: newFrom, end: newTo } });
  }
  moved.sort((a, b) => a.from - b.from || a.to - b.to);
  for (let index = 1; index < moved.length; index++) {
    const prior = moved[index - 1]!;
    const current = moved[index]!;
    if (prior.to > current.from || prior.newTo > current.newFrom) {
      return 'The edit makes reference positions ambiguous. Restore that part of the text to preserve its context.';
    }
  }
  entry.text_elements = next;
  return null;
}

type TextLeaf = { node: ComposerDocument; start: number; end: number };

type DocumentChange = { start: number; oldEnd: number; replacement: string };

function documentChanges(before: string, after: string): DocumentChange[] | null {
  const outer = textChange(before, after);
  const old = Array.from(before.slice(outer.start, outer.oldEnd));
  const updated = Array.from(after.slice(outer.start, outer.newEnd));
  if ((old.length + 1) * (updated.length + 1) > 1_000_000) return null;
  const width = updated.length + 1;
  const scores = new Uint32Array((old.length + 1) * width);
  for (let i = old.length - 1; i >= 0; i--) for (let j = updated.length - 1; j >= 0; j--) {
    scores[i * width + j] = old[i] === updated[j] ? scores[(i + 1) * width + j + 1]! + 1
      : Math.max(scores[(i + 1) * width + j]!, scores[i * width + j + 1]!);
  }
  const changes: DocumentChange[] = [];
  let i = 0, j = 0, position = outer.start;
  let current: DocumentChange | null = null;
  const finish = () => { if (current) { changes.push(current); current = null; } };
  while (i < old.length || j < updated.length) {
    if (i < old.length && j < updated.length && old[i] === updated[j]) {
      finish(); position += old[i]!.length; i++; j++; continue;
    }
    current ??= { start: position, oldEnd: position, replacement: '' };
    if (i < old.length && (j === updated.length || scores[(i + 1) * width + j]! >= scores[i * width + j + 1]!)) {
      position += old[i]!.length; current.oldEnd = position; i++;
    } else { current.replacement += updated[j]!; j++; }
  }
  finish();
  return changes;
}

function documentText(document: ComposerDocument, separator: string, mentionMode: 'plain' | 'markdown'): { text: string; leaves: TextLeaf[] } | null {
  const leaves: TextLeaf[] = [];
  let text = '';
  const append = (node: ComposerDocument): boolean => {
    if (node.type === 'text' && typeof node.text === 'string' && node.content === undefined) {
      const start = text.length;
      text += node.text;
      leaves.push({ node, start, end: text.length });
      return true;
    }
    if ((node.type === 'hardBreak' || node.type === 'hard_break') && node.text === undefined && node.content === undefined) { text += '\n'; return true; }
    if ((node.type === 'atMention' || node.type === 'skillMention') && node.text === undefined && node.content === undefined) {
      const attrs = node.attrs;
      const path = attrs?.path;
      const label = node.type === 'atMention' ? attrs?.label
        : mentionMode === 'markdown' ? (attrs?.promptLinkLabel || (typeof attrs?.name === 'string' ? `$${attrs.name}` : null))
          : (attrs?.displayName || attrs?.name);
      if (typeof label !== 'string' || !label || typeof path !== 'string' || !path) return false;
      if (mentionMode === 'markdown') {
        if (/[\\[\]`*_\r\n]/.test(label) || /[\s<>\\()"\x00-\x1f]/.test(path)) return false;
        text += `[${label}](${path})`;
      } else text += label;
      return true;
    }
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
  const projected = [documentText(document, '\n\n', 'plain'), documentText(document, '\n', 'plain'),
    documentText(document, '\n\n', 'markdown'), documentText(document, '\n', 'markdown')]
    .find((candidate) => candidate?.text === before);
  if (!projected) return 'This document has formatting or context that cannot be safely updated here.';
  const change = textChange(before, after);
  const single = projected.leaves.filter((leaf) => change.start >= leaf.start && change.oldEnd <= leaf.end);
  const changes = single.length === 1 ? [{ start: change.start, oldEnd: change.oldEnd, replacement: after.slice(change.start, change.newEnd) }]
    : documentChanges(before, after);
  if (!changes) return 'This edit is too large to preserve document formatting safely.';
  const updates = new Map<TextLeaf, DocumentChange[]>();
  for (const part of changes) {
    const leaves = projected.leaves.filter((leaf) => part.start >= leaf.start && part.oldEnd <= leaf.end);
    if (leaves.length !== 1) return 'This edit crosses formatting boundaries. Edit within one formatted span at a time.';
    const leaf = leaves[0]!;
    if (Object.keys(leaf.node).some((key) => !['type', 'text', 'marks', 'attrs'].includes(key))) {
      return 'This document has unrecognized text metadata that cannot be safely updated here.';
    }
    const list = updates.get(leaf) ?? [];
    list.push(part); updates.set(leaf, list);
  }
  for (const [leaf, parts] of updates) {
    let next = leaf.node.text!;
    for (const part of parts.reverse()) next = next.slice(0, part.start - leaf.start) + part.replacement + next.slice(part.oldEnd - leaf.start);
    if (!next || next.includes('\n')) return 'This edit cannot preserve the document formatting. Restore the original text.';
    leaf.node.text = next;
  }
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

export function applyTextEdits(original: ComposerDraft, edits: TextEdit[], addedText: string,
  removedAttachments: RemovedMessageAttachment[] = []): EditResult {
  if (!isRemovedMessageAttachments(removedAttachments)) return { error: 'The saved attachment changes are unrecognized. The original edit has been preserved.' };
  const draft = structuredClone(original);
  const input = draft.input;
  if (!input) return { error: 'The original message input is unavailable.' };
  const expected = textEdits(draft);
  if (expected.length !== edits.length || expected.some((entry, index) => entry.index !== edits[index]?.index)) {
    return { error: 'The original message text changed. Cancel and reopen the editor.' };
  }
  const changed = expected.some((entry, index) => entry.text !== edits[index]!.text) || (!expected.length && addedText !== '') || removedAttachments.length > 0;
  if (changed && input.some((entry) => !knownInput(entry))) {
    return { error: 'This message contains unrecognized input. Its original content has been preserved.' };
  }
  for (const [index, entry] of expected.entries()) {
    const next = edits[index]!;
    if (entry.text === next.text) continue;
    const originalText = entry.text;
    const context = serializedMessageContext(originalText);
    if (context.unresolved) return { error: 'This file context has no recognized request boundary. Its original content has been preserved.' };
    if (context.prefix && !next.text.startsWith(context.prefix)) {
      return { error: 'The message context changed. Reopen the editor to preserve its original attachments.' };
    }
    const suffix = context.prefix && context.body.endsWith('\n') && !next.text.endsWith('\n') ? '\n' : '';
    const updatedText = next.text + suffix;
    const error = adjustTextElements(input[entry.index]!, originalText, updatedText);
    if (error) return { error };
    input[entry.index]!.text = updatedText;
  }
  const removedImages = new Set<number>();
  const removedFiles = new Map<number, Set<number>>();
  for (const attachment of removedAttachments) {
    if (!Number.isSafeInteger(attachment.inputIndex) || attachment.inputIndex < 0 || attachment.inputIndex >= input.length) {
      return { error: 'An attachment no longer matches the original message. Its original content has been preserved.' };
    }
    const entry = input[attachment.inputIndex]!;
    if (attachment.kind === 'image') {
      if (!canRemoveImageAttachment(draft, attachment.inputIndex) || removedImages.has(attachment.inputIndex)) {
        return { error: 'An image no longer matches the original message. Its original content has been preserved.' };
      }
      removedImages.add(attachment.inputIndex);
    } else if (attachment.kind === 'file') {
      if (entry.type !== 'text' || typeof entry.text !== 'string' || !Number.isSafeInteger(attachment.fileIndex) || attachment.fileIndex < 0) {
        return { error: 'A file no longer matches the original message. Its original content has been preserved.' };
      }
      const files = removedFiles.get(attachment.inputIndex) ?? new Set<number>();
      if (files.has(attachment.fileIndex)) return { error: 'A file was selected more than once. Its original content has been preserved.' };
      files.add(attachment.fileIndex);
      removedFiles.set(attachment.inputIndex, files);
    } else return { error: 'An unrecognized attachment change was preserved without sending.' };
  }
  for (const [inputIndex, indices] of removedFiles) {
    const entry = input[inputIndex]!;
    const before = entry.text as string;
    const originalText = original.input?.[inputIndex]?.text;
    if (typeof originalText !== 'string') return { error: 'The original file context is unavailable.' };
    const context = serializedMessageContext(originalText);
    if (context.unresolved || !context.prefix || !before.startsWith(context.prefix)) {
      return { error: 'The file context cannot be changed safely. Its original content has been preserved.' };
    }
    let after = before;
    for (const fileIndex of [...indices].sort((a, b) => b - a)) {
      const span = context.fileSpans[fileIndex];
      if (!span?.removable) return { error: 'The file has unrecognized context and cannot be removed safely.' };
      after = after.slice(0, span.start) + after.slice(span.end);
    }
    const remainingContext = serializedMessageContext(after);
    if (!remainingContext.files.length && /^(?:# Files (?:mentioned|pasted) by the user:\r?\n[\r\n]*)+## My request(?: for Codex)?:\r?\n?$/.test(remainingContext.prefix)) {
      after = remainingContext.body;
    }
    const error = adjustTextElements(entry, before, after);
    if (error) return { error };
    entry.text = after;
  }
  if (removedImages.size) {
    const removedIds = new Set([...removedImages].map((index) => `image-${index}`));
    draft.input = input.filter((_, index) => !removedImages.has(index));
    draft.images = draft.images.filter((image) => !removedIds.has(image.id));
  }
  const remaining = draft.input ?? input;
  if (!expected.length && addedText) remaining.unshift({ type: 'text', text: addedText, text_elements: [] });
  const text = remaining.flatMap((entry) => entry.type === 'text' && typeof entry.text === 'string' ? [entry.text] : []).join('\n');
  if (draft.document) {
    const error = updateDocument(draft.document, draft.text, text);
    if (error) return { error };
  }
  draft.text = text;
  return { draft };
}
