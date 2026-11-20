import type { TurnSummary } from '../../lib/codex-protocol.ts';
import { writeClipboardText } from '../native/browser-clipboard.ts';
import { workspaceThreadRoute } from '../native/history-startup.ts';
import { readTranscriptTurns } from './host.ts';

export type ChatCopy = 'link' | 'markdown' | 'directory';

export function formatThreadMarkdown(title: string, turns: TurnSummary[]) {
  const sections = ['# ' + title.replace(/\s*[\r\n]+\s*/g, ' ')];
  for (const turn of turns) for (const item of turn.items) {
    if (item.type === 'userMessage' && Array.isArray(item.content)) {
      const text = item.content.flatMap(part => part?.type === 'text' && typeof part.text === 'string' ? [part.text] : []).join('\n');
      if (text) sections.push(text.split(/\r?\n/).map(line => '> ' + line).join('\n'));
    } else if (item.type === 'agentMessage' && item.phase !== 'commentary' && typeof item.text === 'string' && item.text) {
      sections.push(item.text);
    }
  }
  return sections.join('\n\n') + '\n';
}

export async function copyChat(action: ChatCopy, id: string, hostId: string, title: string, cwd?: string) {
  if (action === 'link') {
    return writeClipboardText(hostId === 'local' ? 'codex://threads/' + encodeURIComponent(id)
      : new URL(workspaceThreadRoute(hostId, id), location.origin).href);
  }
  if (action === 'directory') {
    if (!cwd) throw new Error('The working directory is unavailable.');
    return writeClipboardText(cwd);
  }
  const markdown = readTranscriptTurns(id, hostId).then(turns => formatThreadMarkdown(title, turns));
  // Some browsers require the write itself to start in the original click.
  if (navigator.clipboard?.write && typeof ClipboardItem === 'function') {
    const payload = markdown.then(text => new Blob([text], { type: 'text/plain' }));
    void payload.catch(() => {});
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': payload })]);
      return;
    } catch { /* Use the ordinary text clipboard fallback. */ }
  }
  return writeClipboardText(await markdown);
}
