import type { TurnSummary } from '../../../lib/codex-protocol.ts';
import { outputFileCitationReferences } from '../markdown/file-citations.ts';

const extensions = new Set(['avif', 'csv', 'doc', 'docx', 'gif', 'jpeg', 'jpg', 'md', 'mdx', 'pdf', 'png',
  'ppt', 'pptx', 'tsv', 'webp', 'xls', 'xlsm', 'xlsx']);

export interface MessageOutputPreview { path: string; name: string; kind: 'document' | 'spreadsheet' | 'presentation' | 'image' }
export type MessageOutputDirectory = { status: 'none' } | { status: 'known'; path: string } | { status: 'unknown' };

// The current local and SSH file services use POSIX absolute paths.
function absolutePath(path: string, cwd: string): string | null {
  if (!cwd.startsWith('/') || cwd.startsWith('//') || /^[a-z]:[\\/]/iu.test(path) || path.startsWith('\\\\')) return null;
  const value = path.startsWith('/') ? path : `${cwd.replace(/\/+$/u, '')}/${path}`;
  if (value.startsWith('//') || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  const parts: string[] = [];
  for (const part of value.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop(); else parts.push(part);
  }
  return `/${parts.join('/')}`;
}

/** Project the original turn's supported local citation outputs, before existence checks. */
export function projectMessageOutputPreviews(turn: TurnSummary, cwd: string): MessageOutputPreview[] {
  if (turn.status !== 'completed' && turn.status !== 'failed') return [];
  const root = absolutePath(cwd, cwd);
  if (!root) return [];
  const citations: string[] = [], visualizations = new Set<string>();
  for (const item of turn.items) {
    if (item.type !== 'agentMessage' || typeof item.text !== 'string') continue;
    const references = outputFileCitationReferences(item.text);
    citations.push(...references.outputs);
    for (const value of references.visualizations) {
      const path = absolutePath(value, root);
      if (path) visualizations.add(path);
    }
  }
  const internal = ['work', '.codex_scratch'].map(name => absolutePath(name, root)!);
  const seen = new Set<string>(), result: MessageOutputPreview[] = [];
  for (const citation of citations) {
    const path = absolutePath(citation, root);
    if (!path || seen.has(path) || visualizations.has(path)
      || internal.some(directory => path === directory || path.startsWith(`${directory}/`))) continue;
    const name = path.split('/').at(-1) ?? '';
    const dot = name.lastIndexOf('.');
    const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
    if (!extensions.has(extension)) continue;
    const kind = ['csv', 'tsv', 'xls', 'xlsm', 'xlsx'].includes(extension) ? 'spreadsheet'
      : ['ppt', 'pptx'].includes(extension) ? 'presentation'
      : ['avif', 'gif', 'jpeg', 'jpg', 'png', 'webp'].includes(extension) ? 'image' : 'document';
    seen.add(path);
    result.push({ path, name, kind });
  }
  return result;
}

/** Apply the projectless output-directory fact supplied by the original parent. */
export function restrictMessageOutputDirectory(entries: MessageOutputPreview[], cwd: string, directory?: MessageOutputDirectory): {
  entries: MessageOutputPreview[]; unavailable: boolean;
} {
  if (!directory || directory.status === 'none') return { entries, unavailable: false };
  if (directory.status === 'unknown') return { entries: [], unavailable: true };
  if (directory.status !== 'known' || typeof directory.path !== 'string' || !directory.path) return { entries: [], unavailable: true };
  const path = absolutePath(directory.path, cwd);
  if (!path) return { entries: [], unavailable: true };
  if (path === '/') return { entries: [], unavailable: false };
  return { entries: entries.filter(entry => entry.path === path || entry.path.startsWith(`${path}/`)), unavailable: false };
}
