import { decodeHTML } from 'entities';
import { Lexer, walkTokens, type Token, type Tokens } from 'marked';
import type { TurnSummary } from '../../lib/codex-protocol.ts';
import { workspaceOutputFromLink, type OutputFile } from './output-types.ts';

export function lexMessage(text: string) {
  return Lexer.lex(text);
}

function markdownText(tokens: Token[]): string {
  return tokens.map(token => {
    if (token.type === 'list') return (token as Tokens.List).items.map(item => markdownText(item.tokens)).join('');
    if (token.type === 'image') return decodeHTML((token as Tokens.Image).text);
    if ('tokens' in token && Array.isArray(token.tokens)) return markdownText(token.tokens);
    if (token.type === 'html' || token.type === 'code' || token.type === 'codespan') return token.text;
    if (token.type === 'text' || token.type === 'escape') return decodeHTML(token.text);
    return '';
  }).join('');
}

function onlyComment(line: string) {
  while (line.startsWith('<!--')) {
    const end = line.indexOf('-->');
    if (end < 0) return true;
    line = line.slice(end + 3).trimStart();
  }
  return !line || '<!--'.startsWith(line);
}

/** Pinned renderer dZa/fZa: the latest visible Markdown line is the live caption.
 * Public summaries stay inside the existing lazy Markdown parser boundary. */
export function latestReasoningHeading(summary: string): string | null {
  const lines = summary.trimEnd().split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]!.trim();
    if (!line || onlyComment(line)) continue;
    if (/^[\p{L}\p{M}\p{N} .,!?'"’()-]+$/u.test(line) && !line.startsWith('-') && !/^\d+[.)](?: |$)/.test(line)) return line;
    const tokens = Lexer.lex(line);
    const text = markdownText(tokens).trim();
    if (!text) continue;
    const first = tokens[0];
    return first?.type === 'paragraph' && first.tokens?.length === 1 && first.tokens[0]?.type === 'strong' && text !== line
      ? latestReasoningHeading(text) ?? text : text;
  }
  return null;
}

export function linkedWorkspaceOutputs(turns: TurnSummary[], cwd: string) {
  if (!cwd.startsWith('/') || cwd === '/') return [];
  const found = new Map<string, OutputFile>();
  let remaining = 256 * 1024;
  for (let i = turns.length - 1; i >= 0 && remaining > 0 && found.size < 16; i--) {
    const turn = turns[i]!;
    if (turn.status !== 'completed') continue;
    for (let j = turn.items.length - 1; j >= 0 && remaining > 0 && found.size < 16; j--) {
      const item = turn.items[j]!;
      if (item.type !== 'agentMessage' || typeof item.text !== 'string') continue;
      const text = item.text.slice(0, remaining);
      remaining -= text.length;
      if (!text.includes('[')) continue;
      walkTokens(Lexer.lex(text), token => {
        if (found.size >= 16 || (token.type !== 'link' && token.type !== 'image')) return;
        const file = workspaceOutputFromLink(token.href, cwd);
        if (file && !found.has(file.path)) found.set(file.path, file);
      });
    }
  }
  return [...found.values()];
}
