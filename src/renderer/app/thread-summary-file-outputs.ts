import { fromMarkdown } from 'mdast-util-from-markdown';
import { directiveFromMarkdown } from 'mdast-util-directive';
import { directive } from 'micromark-extension-directive';
import type { ThreadItemSummary, ThreadSummary } from '../../../lib/codex-protocol.ts';
import { parseVisualization } from '../markdown/visualization-directives.ts';

export type SummaryOutputDirectory = { status: 'known'; path: string } | { status: 'none' } | { status: 'unknown' };
export type SummaryFileOutputGap = 'missing-thread' | 'incomplete-history' | 'stream-gap' | 'invalid-owner'
  | 'invalid-cwd' | 'unknown-output-directory' | 'invalid-output-directory' | 'invalid-citation'
  | 'invalid-file-change' | 'website-appgen-unknown' | 'unsupported-host-path' | 'turn-cwd-unverified'
  | 'assistant-envelope-unsupported';
export type SummaryPathResolution = 'absolute' | 'thread-cwd';
export interface SummaryOutputOrigin { hostId: string; threadId: string; cwd: string; turnId: string; itemId: string }
export interface SummaryFileOutputCandidate {
  kind: 'file'; id: string; label: string; path: string;
  source: SummaryOutputOrigin;
  via: 'citation' | 'markdown-link';
  pathResolution: SummaryPathResolution;
}
export type SummaryWebsiteCandidate = { kind: 'website'; target: { type: 'url'; url: string }
  | { type: 'file'; path: string; pathResolution: SummaryPathResolution };
  source: SummaryOutputOrigin };
export interface SummaryFileOutputProjection {
  scope: 'local-file-candidates';
  /** Newest turn first, preserving the original per-turn candidate order. */
  ordered: (SummaryFileOutputCandidate | SummaryWebsiteCandidate)[];
  /** Candidates are not evidence that a file exists. */
  entries: SummaryFileOutputCandidate[];
  /** Website fallbacks must also pass the parent's original display and navigation gates. */
  websites: SummaryWebsiteCandidate[];
  gaps: SummaryFileOutputGap[];
}

const citationExtensions = new Set(['avif', 'csv', 'doc', 'docx', 'gif', 'jpeg', 'jpg', 'md', 'mdx', 'pdf', 'png', 'ppt', 'pptx', 'tsv', 'webp', 'xls', 'xlsm', 'xlsx']);
const linkExtensions = new Set(['docx', 'pdf', 'tex', 'pptx', 'xlsx']);
const visualPath = /(?:^|\/)(?:\.codex|(?:\.codex-workspaces|OpenAI\/Codex\/workspaces)(?:\/instances\/[0-9a-f-]+)?)\/visualizations\/\d{4}\/\d{2}\/\d{2}\/[a-zA-Z0-9_-]+\/[a-z0-9]+(?:-[a-z0-9]+)*\.html$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface MarkdownNode {
  type: string;
  name?: string;
  attributes?: Record<string, string | null | undefined> | null;
  children?: MarkdownNode[];
  value?: string;
  url?: string;
  position?: { start: { line: number; offset?: number }; end: { line: number; offset?: number } };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Resolve POSIX, drive and UNC paths without relying on a Node-only browser polyfill. */
function absolutePath(value: string, cwd?: string): string | null {
  if (!value || /[\u0000-\u001f]/u.test(value)) return null;
  let path = value.replaceAll('\\', '/');
  if (/^\/\/[?.]\//u.test(path)) return null;
  if (!path.startsWith('/') && !/^[a-z]:\//i.test(path)) {
    if (/^[a-z]:/i.test(path) || !cwd) return null;
    path = `${cwd.replace(/\/+$/u, '')}/${path}`;
  }
  let root: string, rest: string;
  const drive = /^\/?([a-z]:)\//i.exec(path);
  const unc = /^\/\/([^/]+)\/([^/]+)(?:\/|$)/u.exec(path);
  if (drive) { root = `${drive[1]}/`; rest = path.slice(drive[0].length); }
  else if (unc) { root = `//${unc[1]}/${unc[2]}/`; rest = path.slice(unc[0].length); }
  else if (path.startsWith('/') && !path.startsWith('//')) { root = '/'; rest = path.slice(1); }
  else return null;
  const parts: string[] = [];
  for (const part of rest.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.length ? root + parts.join('/') : root;
}

function identity(path: string): string { return path.toLowerCase(); }
function supportedHostPath(path: string): boolean { return path.startsWith('/') && !path.startsWith('//'); }
function pathResolution(path: string): SummaryPathResolution {
  const normalized = path.replaceAll('\\', '/');
  return normalized.startsWith('/') || /^[a-z]:\//iu.test(normalized) ? 'absolute' : 'thread-cwd';
}
function inside(path: string, root: string): boolean {
  const base = identity(root).replace(/\/+$/u, '');
  const candidate = identity(path);
  return base === '' ? candidate.startsWith('/') : candidate === base || candidate.startsWith(`${base}/`);
}
function extension(path: string): string {
  const basename = path.split('/').at(-1) ?? '';
  const dot = basename.lastIndexOf('.');
  return dot > 0 ? basename.slice(dot + 1).toLowerCase() : '';
}
function markdownPath(value: string): string | null {
  let path = value;
  try { path = decodeURI(path); } catch { return null; }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path) || /^(?:www\.|mailto:|tel:)/i.test(path)) return null;
  path = path.replace(/`/gu, '').trim().replace(/(?::\d+(?::\d+)?(?:[-\u2013]\d+(?::\d+)?)?|#L\d+(?:C\d+)?(?:-L\d+(?:C\d+)?)?)$/iu, '');
  return path && linkExtensions.has(extension(path)) ? path : null;
}

interface Scan {
  citations: { path: string; itemId: string }[];
  sources: string[];
  visualizations: string[];
  links: { path: string; itemId: string }[];
  liveArtifact: boolean;
  uncertainCitation: boolean;
}

function scanMessage(text: string, itemId: string, last: boolean, scan: Scan, gaps: Set<SummaryFileOutputGap>): void {
  const root: MarkdownNode = fromMarkdown(text, { extensions: [directive()], mdastExtensions: [directiveFromMarkdown()] });
  function visit(node: MarkdownNode): void {
    if ((node.type === 'textDirective' || node.type === 'leafDirective' || node.type === 'containerDirective')
      && node.name === 'codex-file-citation') {
      const attrs = node.attributes ?? {}, path = attrs.path?.trim();
      if (!path || Object.hasOwn(attrs, 'purpose') && typeof attrs.purpose !== 'string'
        || Object.hasOwn(attrs, 'mode') && attrs.mode !== 'live'
        || Object.hasOwn(attrs, 'page_id') && (typeof attrs.page_id !== 'string' || !uuid.test(attrs.page_id))) {
        gaps.add('invalid-citation'); scan.uncertainCitation = true;
      } else if (attrs.mode === 'live') {
        if ((attrs.artifact_kind !== 'presentation' && attrs.artifact_kind !== 'workbook') || /^https?:\/\//iu.test(path)) {
          gaps.add('invalid-citation'); scan.uncertainCitation = true;
        } else if (attrs.purpose == null || attrs.purpose === 'output') scan.liveArtifact ||= last;
      } else if (!/^[a-z][a-z0-9+.-]*:\/\//iu.test(path)) {
        if (attrs.purpose == null || attrs.purpose === 'output') scan.citations.push({ path, itemId });
        else if (attrs.purpose === 'source') scan.sources.push(path);
      }
    }
    if ((node.type === 'leafDirective' || node.type === 'containerDirective')
      && (node.name === 'codex-inline-vis' || node.name === 'codex-live-vis')) {
      const path = node.attributes?.path ?? node.attributes?.file;
      if (path) scan.visualizations.push(path);
    }
    if (node.type === 'text' && node.position?.start.offset != null && node.position.end.offset != null) {
      const raw = text.slice(node.position.start.offset, node.position.end.offset);
      for (const match of raw.matchAll(/:{1,3}codex-file-citation(?=\[|\{)/gu)) {
        let escapes = 0;
        for (let index = match.index - 1; index >= 0 && raw[index] === '\\'; index--) escapes++;
        if (escapes % 2 === 0) { gaps.add('invalid-citation'); scan.uncertainCitation = true; }
      }
    }
    if (node.type === 'text' && node.value?.includes('\uE200visualize\uE202')) {
      for (const match of node.value.matchAll(/\uE200visualize\uE202([^\uE201]+)\uE201/gu)) {
        const path = parseVisualization(match[1] ?? '')?.path;
        if (path) scan.visualizations.push(path);
      }
    }
    if (last && node.type === 'link' && node.url && node.position?.start.line === node.position?.end.line
      && node.position?.start.offset != null && text[node.position.start.offset] === '[') {
      const path = markdownPath(node.url);
      if (path) scan.links.push({ path, itemId });
    }
    if (node.type !== 'code' && node.type !== 'inlineCode' && node.type !== 'html'
      && node.type !== 'image' && node.type !== 'imageReference' && node.type !== 'definition') {
      for (const child of node.children ?? []) visit(child);
    }
  }
  visit(root);
  for (const match of text.matchAll(/\u3010([^\u2020\u3011\n]+)\u2020L(\d+)(?:-L(\d+))?\u3011/gu)) {
    let path = match[1]?.trim() ?? '';
    try { path = decodeURI(path); } catch { /* Keep the original path, as the source citation parser does. */ }
    if (path.startsWith('F:')) {
      if (path.slice(2).trim()) scan.sources.push(path.slice(2).trim());
    } else if (/^(?:\/|[a-z]:[\\/]|\\\\)/iu.test(path)) scan.sources.push(path);
  }
}

function possibleAppgen(item: ThreadItemSummary): boolean {
  if (item.type !== 'mcpToolCall' || item.status === 'failed' || item.error != null) return false;
  const uri = typeof item.invocationResourceUri === 'string' ? item.invocationResourceUri
    : typeof item.mcpAppResourceUri === 'string' ? item.mcpAppResourceUri : '';
  return item.server === 'codex_apps' && typeof item.tool === 'string' && /^sites[._]/u.test(item.tool)
    || uri.startsWith('connectors://sites/') || uri.startsWith('/sites/')
    || Array.isArray(item.toolIcons) && item.toolIcons.includes('/images/ecosystem/apps/appgarden/icon.png')
      && /^\/(connector_[^/]+)\/implicit_link::\1\/[^/]+$/u.test(uri);
}

function requiresAssistantPreprocessing(text: string): boolean {
  return text.includes('[external_agent_tool_') || /^(?:\s*\[external tool (?:call:|result[\]:]))/u.test(text)
    || text.includes('<oai-mem-citation>') || text.includes('[oai-mem-citation]')
    || /<heartbeat>/iu.test(text);
}

function localWebsite(text: string): string | null {
  const candidates = new Set<string>();
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s<>)"'`]+/giu)) {
    const raw = match[0].replace(/[.,;!?]+$/u, '');
    try {
      const url = new URL(raw);
      const host = url.hostname.toLowerCase();
      if (!url.port || url.username || url.password || /[()[\]]/u.test(url.pathname + url.search + url.hash)) continue;
      if (host !== 'localhost' && !host.endsWith('.localhost') && host !== '127.0.0.1'
        && host !== '0.0.0.0' && host !== '[::1]') continue;
      candidates.add(url.href);
    } catch { /* The original text is not a usable local URL. */ }
  }
  return candidates.size === 1 ? [...candidates][0] ?? null : null;
}

/** Project known original local-output syntax. Callers verify existence and retain all other sources. */
export function projectThreadSummaryFileOutputs({ hostId, thread, historyComplete, streamGap, outputDirectory }: {
  hostId: string; thread: ThreadSummary | null; historyComplete: boolean; streamGap: boolean; outputDirectory: SummaryOutputDirectory;
}): SummaryFileOutputProjection {
  const gaps = new Set<SummaryFileOutputGap>();
  const result: SummaryFileOutputProjection = { scope: 'local-file-candidates', ordered: [], entries: [], websites: [], gaps: [] };
  if (!thread) gaps.add('missing-thread');
  if (!historyComplete || !Array.isArray(thread?.turns) || thread.turns.some(turn => turn.itemsView !== 'full' || !Array.isArray(turn.items))) gaps.add('incomplete-history');
  if (streamGap) gaps.add('stream-gap');
  if (!hostId || (thread && !thread.id)) gaps.add('invalid-owner');
  const cwd = thread && typeof thread.cwd === 'string' ? absolutePath(thread.cwd) : null;
  if (thread && !cwd) gaps.add('invalid-cwd');
  const directory = outputDirectory.status === 'known' && cwd ? absolutePath(outputDirectory.path, cwd) : null;
  if (outputDirectory.status === 'unknown') gaps.add('unknown-output-directory');
  if (outputDirectory.status === 'known' && !directory) gaps.add('invalid-output-directory');
  if (outputDirectory.status === 'known' && pathResolution(outputDirectory.path) === 'thread-cwd') gaps.add('turn-cwd-unverified');
  if (cwd && !supportedHostPath(cwd) || directory && !supportedHostPath(directory)) gaps.add('unsupported-host-path');
  if (!thread || !cwd || !hostId || !thread.id || outputDirectory.status === 'unknown'
    || outputDirectory.status === 'known' && !directory || !supportedHostPath(cwd) || directory && !supportedHostPath(directory)) {
    result.gaps = [...gaps]; return result;
  }
  const allowed = (path: string) => !['work', '.codex_scratch'].some(name => inside(path, absolutePath(name, cwd)!))
    && (directory == null || directory !== '/' && inside(path, directory));
  const seen = new Set<string>();
  const source = (turnId: string, itemId: string): SummaryOutputOrigin => ({ hostId, threadId: thread.id, cwd, turnId, itemId });
  for (const turn of [...(Array.isArray(thread.turns) ? thread.turns : [])].reverse()) {
    if (turn.status !== 'completed') continue;
    const items = Array.isArray(turn.items) ? turn.items : [];
    const messages = items.filter(item => item.type === 'agentMessage' && typeof item.text === 'string');
    const lastAgent = [...items].reverse().find(item => item.type === 'agentMessage');
    const finalMessage = turn.itemsView === 'full' && typeof lastAgent?.text === 'string' ? lastAgent : undefined;
    if (items.some(item => item.type === 'agentMessage' && typeof item.text !== 'string')) gaps.add('incomplete-history');
    if (messages.some(item => requiresAssistantPreprocessing(item.text as string))) {
      gaps.add('assistant-envelope-unsupported'); continue;
    }
    const scan: Scan = { citations: [], sources: [], visualizations: [], links: [], liveArtifact: false, uncertainCitation: false };
    for (const item of messages) scanMessage(item.text as string, item.id, item === finalMessage, scan, gaps);
    if ([...scan.sources, ...scan.visualizations].some(path => pathResolution(path) === 'thread-cwd')) gaps.add('turn-cwd-unverified');
    const visual = new Set(scan.visualizations.flatMap(path => { const value = absolutePath(path, cwd); return value ? [identity(value)] : []; }));
    const sources = new Set(scan.sources.flatMap(path => { const value = absolutePath(path, cwd); return value ? [identity(value)] : []; }));
    const turnPaths = new Set<string>();
    let uncertainOutputPath = false;
    for (const [via, candidates] of [['citation', scan.citations], ['markdown-link', scan.links]] as const) {
      for (const candidate of candidates) {
        const path = absolutePath(candidate.path, cwd);
        if (!path) { gaps.add('invalid-citation'); uncertainOutputPath = true; continue; }
        if (!supportedHostPath(path)) { gaps.add('unsupported-host-path'); uncertainOutputPath = true; continue; }
        if (!allowed(path) || visual.has(identity(path)) || visualPath.test(path)
          || !(via === 'citation' ? citationExtensions : linkExtensions).has(extension(path))
          || via === 'markdown-link' && sources.has(identity(path))) continue;
        const key = identity(path);
        const resolution = pathResolution(candidate.path);
        if (resolution === 'thread-cwd') gaps.add('turn-cwd-unverified');
        turnPaths.add(key);
        if (seen.has(key)) continue;
        seen.add(key);
        const entry: SummaryFileOutputCandidate = { kind: 'file', id: `path:${key}`, label: path.split('/').filter(Boolean).at(-1) ?? path,
          path, source: source(turn.id, candidate.itemId), via, pathResolution: resolution };
        result.entries.push(entry);
        result.ordered.push(entry);
      }
    }
    if (turnPaths.size || scan.liveArtifact || scan.uncertainCitation || uncertainOutputPath || turn.itemsView !== 'full'
      || lastAgent && !finalMessage) continue;
    const url = finalMessage && typeof finalMessage.text === 'string' ? localWebsite(finalMessage.text) : null;
    const changes = new Map<string, { path: string; itemId: string; pathResolution: SummaryPathResolution }>();
    let invalidChange = false;
    for (const item of items) {
      if (item.type !== 'fileChange' || item.status !== 'completed') continue;
      if (!Array.isArray(item.changes)) { gaps.add('invalid-file-change'); invalidChange = true; continue; }
      for (const value of item.changes) {
        const change = record(value), kind = record(change?.kind);
        if (!change || !kind || !['add', 'update', 'delete'].includes(String(kind.type)) || typeof change.path !== 'string') {
          gaps.add('invalid-file-change'); invalidChange = true; continue;
        }
        if (kind.type === 'delete') continue;
        const raw = kind.type === 'update' && typeof kind.move_path === 'string' ? kind.move_path : change.path;
        const path = absolutePath(raw, cwd);
        if (path && !supportedHostPath(path)) { gaps.add('unsupported-host-path'); invalidChange = true; continue; }
        if (!path || !/\.html?$/iu.test(path) || !allowed(path) || visual.has(identity(path)) || visualPath.test(path)) continue;
        if (!changes.has(identity(path))) changes.set(identity(path), { path, itemId: item.id, pathResolution: pathResolution(raw) });
      }
    }
    const html = !invalidChange && changes.size === 1 ? [...changes.values()][0] : undefined;
    if (!url && !html) continue;
    if (items.some(possibleAppgen)) { gaps.add('website-appgen-unknown'); continue; }
    if (url && finalMessage && !seen.has(`url:${url}`)) {
      seen.add(`url:${url}`);
      const site: SummaryWebsiteCandidate = { kind: 'website', target: { type: 'url', url }, source: source(turn.id, finalMessage.id) };
      result.websites.push(site); result.ordered.push(site);
    } else if (!url && html && !seen.has(identity(html.path))) {
      seen.add(identity(html.path));
      if (html.pathResolution === 'thread-cwd') gaps.add('turn-cwd-unverified');
      const site: SummaryWebsiteCandidate = { kind: 'website', target: { type: 'file', path: html.path, pathResolution: html.pathResolution }, source: source(turn.id, html.itemId) };
      result.websites.push(site); result.ordered.push(site);
    }
  }
  result.gaps = [...gaps];
  return result;
}
