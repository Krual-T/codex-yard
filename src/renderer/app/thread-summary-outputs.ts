import { z } from 'zod';
import type { ThreadItemSummary, ThreadSummary } from '../../../lib/codex-protocol.ts';

type ResourceActivity = 'read' | 'created' | 'updated';
export type SummaryResourceGap = 'missing-thread' | 'incomplete-history' | 'stream-gap'
  | 'legacy-tool-result' | 'invalid-resource-activities' | 'unknown-provider-scope' | 'page-resource';
export interface SummaryResourceOutput {
  kind: 'link';
  id: string;
  label: string;
  url: string;
  mimeType: string | null;
  activities: readonly ResourceActivity[];
  aliases: readonly string[];
  /** The most recent observed create/update, not merely a later read. */
  source: { hostId: string; threadId: string; turnId: string; itemId: string };
}
export interface SummaryResourceProjection {
  /** This covers MCP resource receipts, never the whole Outputs list. */
  scope: 'structured-mcp-resources';
  entries: SummaryResourceOutput[];
  gaps: SummaryResourceGap[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function safeUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password ? url : null;
  } catch { return null; }
}
const resourceSchema = z.object({
  id: z.string().min(1),
  url: z.string().refine(value => safeUrl(value) !== null),
  title: z.string().optional(),
  mimeType: z.string().optional(),
  activities: z.array(z.enum(['read', 'created', 'updated'])).min(1),
}).loose();
const activitiesSchema = z.object({ version: z.literal(1), resources: z.array(resourceSchema) }).loose();
type Resource = z.infer<typeof resourceSchema>;
const legacyFigmaSchema = z.object({ file_key: z.string(), file_url: z.string(), message: z.string().optional() }).loose();
const legacyNotionReadSchema = z.object({ metadata: z.object({ type: z.literal('page') }).loose(), title: z.string(), url: z.string() }).loose();
const legacyNotionCreateSchema = z.object({ pages: z.array(z.object({
  id: z.string(), url: z.string(), properties: z.object({ title: z.string() }).loose(),
}).loose()) }).loose();
const googleReads = new Set([
  'export_file', 'fetch', 'find_document_text_range', 'get_document', 'get_document_comments', 'get_document_paragraph_range',
  'get_document_tables', 'get_document_text', 'get_file_metadata', 'get_presentation', 'get_presentation_comments',
  'get_presentation_outline', 'get_presentation_tables', 'get_presentation_text', 'get_profile', 'get_slide', 'get_slide_thumbnail',
  'get_spreadsheet_cells', 'get_spreadsheet_comments', 'get_spreadsheet_metadata', 'get_spreadsheet_range', 'list_drives',
  'list_folder', 'recent_documents', 'search', 'search_spreadsheet_rows',
]);
const googleCreates = new Set(['copy_file', 'create_file', 'create_folder', 'create_presentation_from_template',
  'duplicate_sheet_in_new_spreadsheet', 'import_document', 'import_presentation', 'import_spreadsheet']);
const googleUpdates = new Set(['batch_update_document', 'batch_update_presentation', 'batch_update_spreadsheet', 'share_file']);
const googleUrlFields = ['documentUrl', 'document_url', 'fileUrl', 'file_url', 'presentationUrl', 'presentation_url',
  'spreadsheetUrl', 'spreadsheet_url', 'display_url', 'url', 'webViewLink', 'web_view_link'] as const;

function normalizedUrl(url: URL): string {
  const normalized = new URL(url.href);
  normalized.hash = '';
  if (normalized.pathname.length > 1) normalized.pathname = normalized.pathname.replace(/\/$/u, '');
  return normalized.href;
}
function knownProviderKey(url: URL): string | null {
  const host = url.hostname, path = url.pathname;
  if (['docs.google.com', 'sheets.google.com', 'slides.google.com'].includes(host)) {
    const match = path.match(/^\/(document|spreadsheets|presentation)\/d\/(?:e\/)?([^/]+)/u);
    return match ? `google:${match[1] === 'spreadsheets' ? 'spreadsheet' : match[1]}:${match[2]}` : null;
  }
  if (host === 'drive.google.com') {
    const id = path.match(/^\/(?:file\/d|drive\/folders)\/([^/]+)/u)?.[1] ?? url.searchParams.get('id');
    return id ? `google:drive:${id}` : null;
  }
  if (host === 'notion.so' || host.endsWith('.notion.so') || host === 'app.notion.com') {
    const id = Array.from(path.matchAll(/[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f-]{27}/giu)).at(-1)?.[0];
    return id ? `notion:${id.replaceAll('-', '').toLowerCase()}` : null;
  }
  if (host === 'linear.app') {
    const match = path.match(/^\/([^/]+)\/(issue|project|document)\/([^/]+)/u);
    return match ? `linear:${match[1]?.toLowerCase()}:${match[2]}:${match[3]?.toLowerCase()}` : null;
  }
  if (host === 'figma.com' || host.endsWith('.figma.com')) {
    const id = path.match(/^\/(?:board|design|file|make|proto|slides)\/([^/]+)/u)?.[1];
    return id ? `figma:${id}` : null;
  }
  return null;
}
function isPageTool(item: ThreadItemSummary): boolean {
  const context = asRecord(item.appContext);
  if (item.server !== 'codex_apps' && item.server !== 'pages') return false;
  if (context?.connectorId != null && context.connectorId !== 'connector_openai_pages') return false;
  const name = context?.actionName ?? item.tool;
  if (typeof name !== 'string') return false;
  const action = name.replace(/^(?:chatgpt_space[._]|pages_)/u, '');
  return (context?.connectorId != null || item.server === 'pages' || action !== name)
    && ['read_page', 'read_page_changes', 'create_page', 'create_space', 'move_page', 'edit_page', 'patch_page'].includes(action);
}
function providerScope(item: ThreadItemSummary): string | null {
  if (typeof item.pluginId === 'string') return item.pluginId;
  const context = asRecord(item.appContext);
  if (typeof context?.connectorId === 'string') return context.connectorId;
  return typeof item.server === 'string' && item.server.trim() ? `mcp-server:${item.server}` : null;
}
function isPageUrl(url: URL): boolean {
  return url.hostname === 'chatgpt.com'
    && (url.pathname.startsWith('/space/') || url.pathname.startsWith('/codex/app/space/'));
}

function legacyResource(url: string, activity: ResourceActivity, title?: string | null, id?: string, mimeType?: string | null): Resource[] {
  const parsed = safeUrl(url);
  if (!parsed) return [];
  return [{ id: id || knownProviderKey(parsed) || normalizedUrl(parsed), url: parsed.href, activities: [activity],
    ...(title ? { title } : {}), ...(mimeType ? { mimeType } : {}) }];
}

/** Existing tool receipts predate resourceActivities; no provider request is made here. */
function legacyResources(item: ThreadItemSummary): Resource[] {
  const result = asRecord(item.result);
  if (!result || typeof item.tool !== 'string') return [];
  const tool = item.tool.trim();
  const googleName = (value: unknown) => typeof value === 'string'
    && value.toLowerCase().replace(/[^a-z0-9]+/gu, '-').includes('google-drive');
  const prefixed = /^google[\s_-]+drive(?:[\s_-]+app)?[.\s_-]+(.+)$/iu.exec(tool)?.[1];
  const dot = tool.lastIndexOf('.');
  const googleTool = prefixed ?? (dot >= 0 && googleName(tool.slice(0, dot)) ? tool.slice(dot + 1) : tool);
  if (prefixed || dot >= 0 && googleName(tool.slice(0, dot)) || googleName(item.server) || googleName(item.pluginId)) {
    const activity = googleReads.has(googleTool) ? 'read' : googleCreates.has(googleTool) ? 'created' : googleUpdates.has(googleTool) ? 'updated' : null;
    const data = asRecord(result.structuredContent);
    if (activity && data) {
      const url = googleUrlFields.map(key => data[key]).find(value => typeof value === 'string');
      if (typeof url === 'string') {
        const firstText = (values: unknown[]) => values.find((value): value is string => typeof value === 'string' && !!value.trim())?.trim();
        return legacyResource(url, activity, firstText([data.title, data.display_title, data.name, asRecord(data.properties)?.title]),
          undefined, firstText([data.mimeType, data.mime_type]));
      }
    }
  }
  const name = tool.toLowerCase().replace(/[^a-z0-9]+/gu, '-');
  const figma = name.endsWith('figma-create-new-file'), notionRead = name === 'notion-fetch', notionCreate = name.endsWith('notion-create-pages');
  if (!figma && !notionRead && !notionCreate) return [];
  for (const part of Array.isArray(result.content) ? result.content : []) {
    const text = asRecord(part);
    if (text?.type !== 'text' || typeof text.text !== 'string') continue;
    let json: unknown;
    try { json = JSON.parse(text.text); } catch { continue; }
    if (figma) {
      const parsed = legacyFigmaSchema.safeParse(json);
      if (parsed.success) return legacyResource(parsed.data.file_url, 'created',
        parsed.data.message?.match(/^File\s+"(.+)"\s+created successfully\.?$/u)?.[1]?.trim(), parsed.data.file_key);
    } else if (notionRead) {
      const parsed = legacyNotionReadSchema.safeParse(json);
      if (parsed.success) return legacyResource(parsed.data.url, 'read', parsed.data.title);
    } else {
      const parsed = legacyNotionCreateSchema.safeParse(json);
      if (parsed.success) return parsed.data.pages.flatMap(page => legacyResource(page.url, 'created', page.properties.title, page.id));
    }
  }
  return [];
}

interface Group {
  order: number;
  id: string;
  aliases: Set<string>;
  url: string;
  label: string;
  hasTitle: boolean;
  mimeType: string | null;
  activities: Set<ResourceActivity>;
  producer: { order: number; source: SummaryResourceOutput['source'] } | null;
}
interface ResourceEvent {
  order: number;
  id: string;
  aliases: Set<string>;
  url: string;
  label: string;
  hasTitle: boolean;
  mimeType: string | null;
  activities: ResourceActivity[];
  producer: Group['producer'];
}

function groupResourceEvents(events: readonly ResourceEvent[]): Group[] {
  const groups = new Set<Group>(), byAlias = new Map<string, Group>();
  for (const event of events) {
    const matches = [...new Set([...event.aliases].flatMap(alias => {
      const group = byAlias.get(alias);
      return group ? [group] : [];
    }))].sort((left, right) => left.order - right.order);
    const group = matches[0] ?? { order: event.order, id: event.id, aliases: new Set<string>(), url: event.url,
      label: event.label, hasTitle: event.hasTitle, mimeType: event.mimeType,
      activities: new Set<ResourceActivity>(), producer: null };
    if (!matches.length) groups.add(group);
    for (const other of matches.slice(1)) {
      for (const alias of other.aliases) group.aliases.add(alias);
      for (const activity of other.activities) group.activities.add(activity);
      if (!group.hasTitle && other.hasTitle) { group.label = other.label; group.hasTitle = true; }
      if (!group.mimeType && other.mimeType) group.mimeType = other.mimeType;
      if (other.producer && (!group.producer || other.producer.order < group.producer.order)) group.producer = other.producer;
      groups.delete(other);
    }
    for (const alias of event.aliases) group.aliases.add(alias);
    for (const activity of event.activities) group.activities.add(activity);
    if (!group.hasTitle && event.hasTitle) { group.label = event.label; group.hasTitle = true; }
    if (!group.mimeType && event.mimeType) group.mimeType = event.mimeType;
    if (event.producer && (!group.producer || event.producer.order < group.producer.order)) group.producer = event.producer;
    for (const alias of group.aliases) byAlias.set(alias, group);
  }
  return [...groups];
}

/**
 * Project one host's ascending thread history. Missing history and other output
 * families remain explicit; the result must not establish an empty Outputs list.
 */
export function projectThreadSummaryResourceOutputs({ hostId, thread, historyComplete, streamGap }: {
  hostId: string; thread: ThreadSummary | null; historyComplete: boolean; streamGap: boolean;
}): SummaryResourceProjection {
  const gaps = new Set<SummaryResourceGap>();
  if (!thread) gaps.add('missing-thread');
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  if (!historyComplete || !Array.isArray(thread?.turns)
    || turns.some(turn => turn.itemsView !== 'full' || !Array.isArray(turn.items))) gaps.add('incomplete-history');
  if (streamGap) gaps.add('stream-gap');
  if (!thread) return { scope: 'structured-mcp-resources', entries: [], gaps: [...gaps] };

  const items = turns.flatMap(turn => Array.isArray(turn.items) ? turn.items : []);
  const enabled = items.some(item => item.type === 'mcpToolCall'
    && (item.server !== 'node_repl' && item.server !== 'cua_repl' || isPageTool(item)));
  if (!enabled) return { scope: 'structured-mcp-resources', entries: [], gaps: [...gaps] };
  const byTurn: ResourceEvent[][] = [];
  let order = 0;
  for (const turn of [...turns].reverse()) {
    const events: ResourceEvent[] = [];
    byTurn.push(events);
    for (const item of [...(Array.isArray(turn.items) ? turn.items : [])].reverse()) {
      if (item.type !== 'mcpToolCall' || item.status !== 'completed' || item.error != null || item.result == null) continue;
      if (isPageTool(item)) { gaps.add('page-resource'); continue; }
      const result = asRecord(item.result), metadata = asRecord(result?._meta);
      let resources: Resource[];
      if (!metadata || !('openai/resourceActivities' in metadata)) resources = legacyResources(item);
      else {
        const parsed = activitiesSchema.safeParse(metadata['openai/resourceActivities']);
        if (!parsed.success) { gaps.add('invalid-resource-activities'); continue; }
        resources = parsed.data.resources;
      }
      const scope = providerScope(item);
      if (scope === null && resources.length) { gaps.add('unknown-provider-scope'); continue; }
      for (const resource of resources) {
        const url = safeUrl(resource.url)!;
        if (isPageUrl(url)) { gaps.add('page-resource'); continue; }
        const provider = `provider:${scope}:${resource.id}`;
        const urlAlias = `url:${normalizedUrl(url)}`;
        const id = knownProviderKey(url) ?? provider;
        const title = resource.title?.trim() || '';
        const label = title || `${url.host.replace(/^www\./u, '')}${url.pathname === '/' ? '' : url.pathname}`;
        const currentOrder = order++;
        const producer = resource.activities.some(activity => activity === 'created' || activity === 'updated')
          ? { order: currentOrder, source: { hostId, threadId: thread.id, turnId: turn.id, itemId: item.id } } : null;
        events.push({ order: currentOrder, id, aliases: new Set([id, urlAlias, provider]), url: url.href,
          label, hasTitle: !!title, mimeType: resource.mimeType?.trim() || null, activities: resource.activities, producer });
      }
    }
  }
  const activityOrder: ResourceActivity[] = ['read', 'created', 'updated'];
  const global = new Map(groupResourceEvents(byTurn.flat()).filter(group => group.producer)
    .map(group => [group.id, group]));
  const seen = new Set<string>(), entries: SummaryResourceOutput[] = [];
  for (const turnEvents of byTurn) {
    for (const perTurn of groupResourceEvents(turnEvents)) {
      if (!perTurn.producer) continue;
      const group = global.get(perTurn.id) ?? perTurn;
      if (seen.has(group.id)) continue;
      seen.add(group.id);
      entries.push({ kind: 'link', id: group.id, label: group.label, url: group.url,
        mimeType: group.mimeType, activities: activityOrder.filter(activity => group.activities.has(activity)),
        aliases: [...group.aliases], source: perTurn.producer.source });
    }
  }
  return { scope: 'structured-mcp-resources', entries, gaps: [...gaps] };
}
