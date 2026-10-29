import type { ThreadSummary, TurnSummary } from '../../../lib/codex-protocol.ts';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { directiveFromMarkdown } from 'mdast-util-directive';
import { directive } from 'micromark-extension-directive';
import { projectThreadSummaryFileOutputs } from '../app/thread-summary-file-outputs.ts';
import { normalizeFileCitationEscapes, outputFileCitationReferences } from '../markdown/file-citations.ts';

const extensions = new Set(['avif', 'csv', 'doc', 'docx', 'gif', 'jpeg', 'jpg', 'md', 'mdx', 'pdf', 'png',
  'ppt', 'pptx', 'tsv', 'webp', 'xls', 'xlsm', 'xlsx']);

export interface MessageOutputPreview { path: string; name: string; kind: 'document' | 'spreadsheet' | 'presentation' | 'image' }
export type MessageOutputDirectory = { status: 'none' } | { status: 'known'; path: string } | { status: 'unknown' };
export type MessageWebsitePreview = { kind: 'website'; target: { type: 'url'; url: string } | { type: 'file'; path: string } };
type GoogleKind = 'document' | 'spreadsheet' | 'presentation' | 'drive';
export type MessageGooglePreview = { kind: 'google-drive'; resourceKind: GoogleKind; url: string; title: string };

interface MarkdownNode {
  type: string; name?: string; url?: string; value?: string; alt?: string | null;
  attributes?: Record<string, string | null>; children?: MarkdownNode[];
  position?: { start: { offset?: number; line?: number }; end: { offset?: number; line?: number } };
}

function googleResource(value: string): { url: string; kind: GoogleKind; key: string; identity: string } | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  const kind = url.hostname === 'docs.google.com'
    ? url.pathname.startsWith('/document/') ? 'document' : url.pathname.startsWith('/spreadsheets/') ? 'spreadsheet'
      : url.pathname.startsWith('/presentation/') ? 'presentation' : null
    : url.hostname === 'sheets.google.com' ? 'spreadsheet' : url.hostname === 'slides.google.com' ? 'presentation'
      : url.hostname === 'drive.google.com' ? 'drive' : null;
  if (!kind) return null;
  const id = url.pathname.match(/\/(?:d|folders)\/(?:e\/)?([^/]+)/u)?.[1] ?? url.searchParams.get('id');
  const key = `${kind}:${id ?? url.href}`;
  const nativeId = url.hostname === 'docs.google.com'
    ? url.pathname.match(/^\/(?:document|spreadsheets|presentation)\/d\/(?:e\/)?([^/]+)/u)?.[1] : undefined;
  return { url: url.href, kind, key, identity: nativeId ?? key };
}

const googleReads = new Set('export_file.fetch.find_document_text_range.get_document.get_document_comments.get_document_paragraph_range.get_document_tables.get_document_text.get_file_metadata.get_presentation.get_presentation_comments.get_presentation_outline.get_presentation_tables.get_presentation_text.get_profile.get_slide.get_slide_thumbnail.get_spreadsheet_cells.get_spreadsheet_comments.get_spreadsheet_metadata.get_spreadsheet_range.list_drives.list_folder.recent_documents.search.search_spreadsheet_rows'.split('.'));
const googleWrites = new Set('batch_update_document.batch_update_presentation.batch_update_spreadsheet.copy_file.create_file.create_folder.create_presentation_from_template.delete_file.duplicate_sheet_in_new_spreadsheet.import_document.import_presentation.import_spreadsheet.share_file'.split('.'));
const googleUrlFields = ['documentUrl', 'document_url', 'fileUrl', 'file_url', 'presentationUrl', 'presentation_url',
  'spreadsheetUrl', 'spreadsheet_url', 'display_url', 'url', 'webViewLink', 'web_view_link'];
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Derive only the Google resources the original completed-turn consumer could display. */
function googlePreviews(turn: TurnSummary): MessageGooglePreview[] {
  if (turn.itemsView !== 'full') return [];
  const final = [...turn.items].reverse().find(item => item.type === 'agentMessage');
  const text = typeof final?.text === 'string' ? normalizeFileCitationEscapes(final.text) : '';
  if (!text) return [];
  const titles = new Map<string, string>(), read = new Set<string>(), written = new Set<string>();
  let hasRead = false, hasWrite = false, unknown = false;
  for (const item of turn.items) {
    if (item.type !== 'mcpToolCall' || item.status !== 'completed' || item.error != null || typeof item.tool !== 'string') continue;
    const response = object(item.result);
    if (!response) continue;
    const data = object(response.structuredContent);
    const resources = googleUrlFields.flatMap(field => typeof data?.[field] === 'string' ? [googleResource(data[field] as string)] : [])
      .filter((value): value is NonNullable<typeof value> => value !== null);
    const title = [data?.title, data?.display_title, data?.name, object(data?.properties)?.title]
      .find((value): value is string => typeof value === 'string' && Boolean(value.trim()))?.trim();
    if (title) for (const resource of resources) titles.set(resource.key, title);
    const isGoogle = (value: unknown) => typeof value === 'string'
      && value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '-').includes('google-drive');
    const tool = item.tool.trim();
    const prefix = /^google[\s_-]+drive(?:[\s_-]+app)?[.\s_-]+(.+)$/iu.exec(tool)?.[1];
    const dot = tool.lastIndexOf('.');
    const name = prefix ?? (dot >= 0 && isGoogle(tool.slice(0, dot)) ? tool.slice(dot + 1) : tool);
    if (!prefix && name === tool && !isGoogle(item.server) && !isGoogle(item.pluginId)) continue;
    if (!googleReads.has(name) && !googleWrites.has(name)) { unknown = true; continue; }
    const write = googleWrites.has(name) && name !== 'delete_file';
    if (write) hasWrite = true; else hasRead = true;
    for (const resource of resources) (write ? written : read).add(resource.key);
  }
  for (const key of written) read.delete(key);
  const suppressLinks = hasRead && !hasWrite && !unknown;
  const citations: { resource: NonNullable<ReturnType<typeof googleResource>>; title: string }[] = [];
  const links: { resource: NonNullable<ReturnType<typeof googleResource>>; title: string }[] = [];
  let hasCitation = false;
  const root = fromMarkdown(text, { extensions: [directive()], mdastExtensions: [directiveFromMarkdown()] }) as unknown as MarkdownNode;
  function addLink(node: MarkdownNode, source: string): void {
    const start = node.position?.start.offset, end = node.position?.end.offset;
    if (start == null || end == null || node.position?.start.line !== node.position?.end.line) return;
    const syntax = source.slice(start, end);
    if (!(syntax.startsWith('[') || syntax.startsWith('![')) || !syntax.endsWith(')') || !node.url) return;
    const resource = googleResource(node.url);
    if (!resource) return;
    const label = node.type === 'image' ? node.alt ?? '' : syntax.slice(1, syntax.indexOf('](')).trim();
    links.push({ resource, title: titles.get(resource.key) ?? label });
  }
  function visit(node: MarkdownNode): void {
    if (node.type === 'code' || node.type === 'html' || node.type === 'definition') return;
    if (node.type === 'inlineCode') {
      const value = node.value?.trim() ?? '';
      const parsed = fromMarkdown(value) as unknown as MarkdownNode;
      const paragraph = parsed.children?.[0], child = paragraph?.children?.[0];
      if (parsed.children?.length === 1 && paragraph?.children?.length === 1 && child?.type === 'link') addLink(child, value);
      return;
    }
    if (node.type === 'link' || node.type === 'image') { addLink(node, text); return; }
    if (node.type === 'textDirective' && node.name === 'codex-file-citation') {
      hasCitation = true;
      const attrs = node.attributes ?? {}, resource = typeof attrs.path === 'string' ? googleResource(attrs.path) : null;
      if (resource && resource.kind !== 'drive' && /\/(?:d|folders)\/(?:e\/)?[^/]+/u.test(new URL(resource.url).pathname)
        && attrs.mode == null && (attrs.purpose == null || attrs.purpose === 'output')) {
        citations.push({ resource, title: titles.get(resource.key) || attrs.label?.trim() || attrs.title?.trim() || resource.url });
      }
      return;
    }
    for (const child of node.children ?? []) visit(child);
  }
  visit(root);
  const seen = new Set<string>(), result: MessageGooglePreview[] = [];
  for (const item of [...citations, ...(hasCitation || suppressLinks ? [] : links.filter(link => !read.has(link.resource.key)))]) {
    if (seen.has(item.resource.identity)) continue;
    seen.add(item.resource.identity);
    result.push({ kind:'google-drive', resourceKind:item.resource.kind, url:item.resource.url, title:item.title || item.resource.url });
  }
  return result;
}

function previewForPath(path: string): MessageOutputPreview {
  const name = path.split('/').at(-1) ?? '';
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  const kind = ['csv', 'tsv', 'xls', 'xlsm', 'xlsx'].includes(extension) ? 'spreadsheet'
    : ['ppt', 'pptx'].includes(extension) ? 'presentation'
    : ['avif', 'gif', 'jpeg', 'jpg', 'png', 'webp'].includes(extension) ? 'image' : 'document';
  return { path, name, kind };
}

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
    seen.add(path);
    result.push(previewForPath(path));
  }
  return result;
}

/** Reuse the existing single-turn output projection for website and Markdown-link precedence. */
export function projectMessageTurnPreviews(hostId: string, thread: ThreadSummary, turn: TurnSummary,
  directory?: MessageOutputDirectory): { entries: MessageOutputPreview[]; website: MessageWebsitePreview | null; google: MessageGooglePreview[]; unavailable: boolean;
    resourceUncertain: boolean; incomplete: boolean } {
  const all = projectMessageOutputPreviews(turn, thread.cwd);
  const restricted = restrictMessageOutputDirectory(all, thread.cwd, directory);
  if (turn.status !== 'completed' && turn.status !== 'failed') return { ...restricted, website: null, google: [], resourceUncertain: false, incomplete: false };
  const normalizedTurn = turn.status === 'failed' ? { ...turn, status: 'completed' as const } : turn;
  // The original edited-path collector includes delete paths; the Summary
  // projector otherwise omits them, so preserve them for website selection.
  const websiteTurn = { ...normalizedTurn, items: normalizedTurn.items.map(item => item.type !== 'fileChange' || !Array.isArray(item.changes) ? item
    : { ...item, changes: item.changes.map(change => {
      if (!change || typeof change !== 'object' || !('kind' in change)) return change;
      const kind = change.kind;
      return kind && typeof kind === 'object' && 'type' in kind && kind.type === 'delete'
        ? { ...change, kind: { ...kind, type: 'add' } } : change;
    }) }) };
  const project = (outputDirectory: MessageOutputDirectory, value = websiteTurn) => projectThreadSummaryFileOutputs({ hostId,
    thread: { ...thread, turns: [value] }, historyComplete: value.itemsView === 'full', streamGap: false, outputDirectory });
  const unrestricted = project({ status: 'none' });
  const selected = directory && directory.status !== 'none' ? project(directory) : unrestricted;
  const unknownDirectory = directory?.status === 'unknown'
    || directory?.status === 'known' && selected.gaps.includes('invalid-output-directory');
  const unrestrictedFileWebsite = unrestricted.websites.some(site => site.target.type === 'file');
  const unavailable = restricted.unavailable && (all.length > 0 || unrestricted.entries.length > 0 || unrestrictedFileWebsite);
  const seen = new Set(restricted.entries.map(entry => entry.path.toLowerCase()));
  const entries = [...restricted.entries];
  for (const entry of selected.entries) {
    if (entry.via !== 'markdown-link' || seen.has(entry.path.toLowerCase())) continue;
    seen.add(entry.path.toLowerCase());
    entries.push(previewForPath(entry.path));
  }
  const site = (unknownDirectory && !unavailable ? unrestricted : selected).websites[0];
  const website = !entries.length && !unavailable && site
    ? { kind: 'website' as const, target: site.target.type === 'url'
      ? { type: 'url' as const, url: site.target.url } : { type: 'file' as const, path: site.target.path } } : null;
  const resourceUncertain = !entries.length && (unknownDirectory && !unavailable ? unrestricted : selected).gaps.includes('website-appgen-unknown');
  // A partial turn may be missing a higher-priority output. This projection is
  // only used to explain why the candidate is not actionable.
  const partial = normalizedTurn.itemsView !== 'full' && !entries.length && !unavailable
    ? project(directory?.status === 'known' ? directory : { status: 'none' }, { ...websiteTurn, itemsView: 'full' }) : null;
  const incomplete = Boolean(partial && (partial.websites.length || partial.gaps.includes('website-appgen-unknown')
    || googlePreviews({ ...normalizedTurn, itemsView: 'full' }).length));
  const google = unrestricted.gaps.includes('assistant-envelope-unsupported') ? [] : googlePreviews(normalizedTurn);
  return { entries, website, google, unavailable, resourceUncertain, incomplete };
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
