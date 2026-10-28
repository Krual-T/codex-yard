import { defaultMarkdownParser, MarkdownParser } from 'prosemirror-markdown';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import type { ComposerDocument } from '../workbench-contract.ts';
import { composerSchema, serializeRichDocument } from './rich-document.ts';

const tokens = Object.fromEntries(Object.entries(defaultMarkdownParser.tokens).filter(([name]) => name !== 'hr' && name !== 'image'));
const parser = new MarkdownParser(composerSchema, defaultMarkdownParser.tokenizer, {
  ...tokens,
  list_item: { block: 'regular_list_item' },
  bullet_list: { block: 'list' },
  ordered_list: { block: 'ordered_list', getAttrs: token => ({ startingNumber: Number(token.attrGet('start')) || 1 }) },
  fence: { block: 'code_block', getAttrs: token => ({ language: token.info || null, autoDetectLanguage: !token.info }), noCloseToken: true },
});

export function serializeGoalDocument(document: ProseMirrorNode): string {
  return serializeRichDocument(document, { standardParagraphs: true, tightLists: true, escapeExtraCharacters: /[$|]/g });
}

/** Only switch modes when the current source is representable without changing it. */
export function goalMarkdownDocument(source: string): ComposerDocument | null {
  if (/(^|[^\\])\${1,2}(?=\S)/.test(source)) return null;
  try {
    const document = parser.parse(source);
    if (!document || serializeGoalDocument(document) !== source) return null;
    document.check();
    return document.toJSON() as ComposerDocument;
  } catch { return null; }
}
