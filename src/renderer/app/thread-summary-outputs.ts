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
  /** This covers only structured MCP resources, never the whole Outputs list. */
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
  return typeof context?.connectorId === 'string' ? context.connectorId : null;
}
function isPageUrl(url: URL): boolean {
  return url.hostname === 'chatgpt.com'
    && (url.pathname.startsWith('/space/') || url.pathname.startsWith('/codex/app/space/'));
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
      if (!metadata || !('openai/resourceActivities' in metadata)) { gaps.add('legacy-tool-result'); continue; }
      const parsed = activitiesSchema.safeParse(metadata['openai/resourceActivities']);
      if (!parsed.success) { gaps.add('invalid-resource-activities'); continue; }
      const scope = providerScope(item);
      if (scope === null && parsed.data.resources.length) { gaps.add('unknown-provider-scope'); continue; }
      for (const resource of parsed.data.resources) {
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
