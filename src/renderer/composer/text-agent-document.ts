import { EditorState } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import type { ComposerDocument } from '../workbench-contract.ts';
import { documentChanges } from '../messages/message-edit.ts';
import { composerSchema, readRichDocument, serializePlainDocument, serializeRichDocument } from './rich-document.ts';

export function documentFromText(text: string): ComposerDocument {
  return { type: 'doc', content: text.split('\n').map(line => ({ type: 'paragraph',
    ...(line ? { content: [{ type: 'text', text: line }] } : {}) })) };
}

export interface TextAgentSpan {
  start: number;
  end: number;
  attrs: { name: string; displayName: string; conversationId: string | null; path: string };
}
export interface TextMarkSpan { start: number; end: number; marks: { type: string; attrs?: Record<string, unknown> }[] }

interface Token { start: number; end: number; from: number; to: number; node?: ProseMirrorNode }
export interface TextAgentProjection { text: string; agents: TextAgentSpan[]; tokens: Token[] }

/** A textarea can represent paragraphs, text, line breaks and whole agent atoms. */
export function projectTextAgentDocument(doc: ProseMirrorNode): TextAgentProjection | null {
  if (doc.type !== composerSchema.nodes.doc) return null;
  let text = '', position = 0;
  const agents: TextAgentSpan[] = [], tokens: Token[] = [];
  for (let index = 0; index < doc.childCount; index++) {
    const paragraph = doc.child(index);
    if (paragraph.type !== composerSchema.nodes.paragraph) return null;
    if (index) {
      tokens.push({ start: text.length, end: text.length + 1, from: position - 1, to: position + 1 });
      text += '\n';
    }
    let childPos = position + 1;
    for (let childIndex = 0; childIndex < paragraph.childCount; childIndex++) {
      const child = paragraph.child(childIndex);
      let value: string;
      if (child.isText) value = child.text ?? '';
      else if (child.type === composerSchema.nodes.hard_break) value = '\n';
      else if (child.type === composerSchema.nodes.agentMention) {
        const attrs = child.attrs;
        if (typeof attrs.name !== 'string' || typeof attrs.displayName !== 'string' || typeof attrs.path !== 'string'
          || attrs.conversationId !== null && typeof attrs.conversationId !== 'string') return null;
        value = attrs.displayName || attrs.name;
        if (!value) return null;
        agents.push({ start: text.length, end: text.length + value.length,
          attrs: { name: attrs.name, displayName: attrs.displayName, conversationId: attrs.conversationId, path: attrs.path } });
      } else return null;
      tokens.push({ start: text.length, end: text.length + value.length, from: childPos, to: childPos + child.nodeSize, node: child });
      text += value;
      childPos += child.nodeSize;
    }
    position += paragraph.nodeSize;
  }
  return { text, agents, tokens };
}

/** Split visible agent atoms at the existing protocol text-item boundaries. */
export function textAgentSegments(doc: ProseMirrorNode, segments: readonly string[]): TextAgentSpan[][] | null {
  const projection = projectTextAgentDocument(doc);
  if (!projection || projection.text !== segments.join('\n')) return null;
  let offset = 0;
  const result = segments.map(segment => {
    const start = offset, end = start + segment.length;
    offset = end + 1;
    return projection.agents.filter(agent => agent.start >= start && agent.end <= end)
      .map(agent => ({ ...agent, start: agent.start - start, end: agent.end - start }));
  });
  return result.reduce((count, segment) => count + segment.length, 0) === projection.agents.length ? result : null;
}

export function isPlainTextAgentDocument(doc: ProseMirrorNode, text: string): boolean {
  const projection = projectTextAgentDocument(doc);
  if (!projection?.agents.length || projection.text !== text) return false;
  let plain = true;
  doc.descendants(node => { if (node.marks.length) plain = false; });
  return plain;
}

function positionAt(doc: ProseMirrorNode, projection: TextAgentProjection, offset: number): number | null {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > projection.text.length) return null;
  for (const token of projection.tokens) {
    if (offset < token.start || offset > token.end) continue;
    if (offset === token.start) return token.from;
    if (offset === token.end) return token.to;
    if (token.node?.isText) return token.from + offset - token.start;
    return null;
  }
  return doc.childCount ? offset === 0 ? 1 : doc.content.size - 1 : null;
}

/** Apply visible text edits and reinsert the exact agent atoms without flattening marks. */
export function updateTextAgentDocument(original: ComposerDocument | undefined, before: string, after: string,
  agents: readonly TextAgentSpan[]): ComposerDocument | null {
  const source = readRichDocument(original ?? documentFromText(before));
  const projected = source && projectTextAgentDocument(source);
  if (!source || !projected || projected.text !== before) return null;
  let state = EditorState.create({ doc: source });
  let flatten = state.tr;
  for (const token of [...projected.tokens].reverse()) if (token.node?.type === composerSchema.nodes.agentMention) {
    flatten = flatten.replaceWith(token.from, token.to, composerSchema.text(projected.text.slice(token.start, token.end), token.node.marks));
  }
  if (flatten.docChanged) state = state.apply(flatten);
  const styles = projected.tokens.flatMap(token => Array.from(projected.text.slice(token.start, token.end),
    () => JSON.stringify(token.node?.marks.map(mark => mark.toJSON()) ?? [])));
  const changes = documentChanges(before, after, styles);
  if (!changes) return null;
  for (const change of [...changes].reverse()) {
    const current = projectTextAgentDocument(state.doc);
    if (!current) return null;
    const from = positionAt(state.doc, current, change.start), to = positionAt(state.doc, current, change.oldEnd);
    if (from === null || to === null) return null;
    try { state = state.apply(state.tr.insertText(change.replacement, from, to)); } catch { return null; }
  }
  let previous = after.length;
  for (const agent of [...agents].sort((a, b) => b.start - a.start)) {
    const label = agent.attrs.displayName || agent.attrs.name;
    if (!label || agent.start < 0 || agent.end > previous || agent.end - agent.start !== label.length
      || after.slice(agent.start, agent.end) !== label) return null;
    previous = agent.start;
    const current = projectTextAgentDocument(state.doc);
    if (!current || current.text !== after) return null;
    const from = positionAt(state.doc, current, agent.start), to = positionAt(state.doc, current, agent.end);
    if (from === null || to === null) return null;
    const left = state.doc.resolve(from), right = state.doc.resolve(to);
    if (!left.sameParent(right) || !left.parent.isTextblock || left.parent.type.spec.code) return null;
    let marks: readonly import('prosemirror-model').Mark[] | undefined, valid = true;
    state.doc.nodesBetween(from, to, node => {
      if (!node.isText) { if (node.isInline) valid = false; return; }
      if (!marks) marks = node.marks;
      else if (JSON.stringify(marks.map(mark => mark.toJSON())) !== JSON.stringify(node.marks.map(mark => mark.toJSON()))) valid = false;
    });
    if (!valid || !marks || marks.some(mark => mark.type.name === 'code' || mark.type.name === 'link')) return null;
    try {
      const node = composerSchema.nodes.agentMention!.create(agent.attrs, null, marks);
      state = state.apply(state.tr.replaceWith(from, to, node));
    } catch { return null; }
  }
  const result = projectTextAgentDocument(state.doc);
  return result?.text === after && result.agents.length === agents.length ? state.doc.toJSON() as ComposerDocument : null;
}

/** Reapply the actual editor marks to text and complete inline atoms across input segments. */
export function applyTextAgentMarks(original: ComposerDocument, ranges: readonly TextMarkSpan[]): ComposerDocument | null {
  const document = readRichDocument(original), projection = document && projectTextAgentDocument(document);
  if (!document || !projection) return null;
  let transaction = EditorState.create({ doc: document }).tr, firstRange = 0;
  for (const token of projection.tokens) {
    if (!token.node || token.node.type.name === 'hard_break') continue;
    while (firstRange < ranges.length && ranges[firstRange]!.end <= token.start) firstRange++;
    let covered = token.start;
    for (let index = firstRange; index < ranges.length && ranges[index]!.start < token.end; index++) {
      const range = ranges[index]!, start = Math.max(token.start, range.start), end = Math.min(token.end, range.end);
      if (start !== covered || start >= end || !token.node.isText && (start !== token.start || end !== token.end)) return null;
      const from = token.node.isText ? token.from + start - token.start : token.from;
      const to = token.node.isText ? token.from + end - token.start : token.to;
      transaction = transaction.removeMark(from, to);
      for (const mark of range.marks) {
        const type = composerSchema.marks[mark.type];
        if (!type) return null;
        try { transaction = transaction.addMark(from, to, type.create(mark.attrs)); } catch { return null; }
      }
      covered = end;
    }
    if (covered !== token.end) return null;
  }
  const result = transaction.doc.toJSON() as ComposerDocument;
  return readRichDocument(result) ? result : null;
}

/** Serialize each original input segment without merging its surrounding non-text items. */
export function serializeTextAgentSegments(doc: ProseMirrorNode, segments: readonly string[], plain: boolean): string[] | null {
  const projection = projectTextAgentDocument(doc);
  if (!projection || !projection.agents.length || projection.text !== segments.join('\n')) return null;
  let offset = 0;
  const result: string[] = [];
  for (const segment of segments) {
    const from = positionAt(doc, projection, offset), to = positionAt(doc, projection, offset + segment.length);
    if (from === null || to === null) return null;
    const part = doc.cut(from, to);
    result.push(plain ? serializePlainDocument(part) : serializeRichDocument(part));
    offset += segment.length + 1;
  }
  return result;
}
