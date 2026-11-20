import type { ThreadItemSummary } from '../../lib/codex-protocol.ts';
import { record } from '../native/protocol.ts';

export function mcpAppUri(item: ThreadItemSummary): string | undefined {
  if (item.type !== 'mcpToolCall' || typeof item.server !== 'string' || !item.server ||
    item.server === 'codex_apps' || item.error != null ||
    (item.status !== 'inProgress' && (item.status !== 'completed' || item.result == null || record(item.result).isError === true))) return;
  const meta = record(record(item.result)._meta);
  const uri = record(item.mcpAppUi).resourceUri ?? item.mcpAppResourceUri ??
    record(meta.ui).resourceUri ?? meta['ui/resourceUri'] ?? meta['openai/outputTemplate'];
  if (typeof uri === 'string' && /^ui:\/\/[^\s]+$/.test(uri)) return uri;
}

export function mcpAppResource(reply: unknown, uri: string) {
  const { contents } = record(reply);
  if (!Array.isArray(contents)) return;
  const view = contents.map(record).find(entry => entry.uri === uri && typeof entry.text === 'string' &&
    /^text\/html(?:\s*;\s*profile=mcp-app)?$/i.test(String(entry.mimeType)));
  if (!view || typeof view.text !== 'string' || new Blob([view.text]).size > 5_000_000) return;
  const meta = record(view._meta), ui = record(meta.ui);
  return { html: view.text, bordered: (meta['openai/widgetPrefersBorder'] ?? ui.prefersBorder) === true };
}

export function isAppReadTool(catalog: unknown, server: string, name: string) {
  const { data } = record(catalog);
  const entry = Array.isArray(data) ? data.map(record).find(row => row.name === server) : undefined;
  const tools = record(entry?.tools);
  const tool = Object.hasOwn(tools, name) ? record(tools[name]) : {};
  const flags = record(tool.annotations), meta = record(tool._meta);
  const visibility = record(meta.ui).visibility ?? meta['ui/visibility'];
  return tool.name === name && flags.readOnlyHint === true && flags.destructiveHint !== true &&
    (visibility == null || (Array.isArray(visibility) && visibility.includes('app')));
}
