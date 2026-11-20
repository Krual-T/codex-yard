import type { ThreadItemSummary, TurnSummary } from '../../lib/codex-protocol.ts';
import { record } from '../native/protocol.ts';
import { attachedPrompt, type PromptAttachment } from './composer-input.ts';

type SourceCall = { id: string; item: ThreadItemSummary };
export type SourceIntegration = {
  id: string; name: string; tools: { id: string; name: string; calls: SourceCall[] }[];
};
export type SourceWebPage = { url: string; label: string };
export type ConversationSources = {
  files: PromptAttachment[];
  integrations: SourceIntegration[];
  web: { searchCount: number; queries: string[]; pages: SourceWebPage[] };
};
export type SourceItemsByTurn = ReadonlyMap<string, readonly ThreadItemSummary[]>;

function label(value: string) {
  const words = value.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function attachments(item: ThreadItemSummary): PromptAttachment[] {
  const content = item.type === 'userMessage' ? item.content : item.type === 'steeringUserMessage' ? item.input : undefined;
  if (!Array.isArray(content)) return [];
  return content.flatMap(part => {
    const value = record(part);
    if (value.type === 'text' && typeof value.text === 'string') return attachedPrompt(value.text).attachments;
    if (value.type === 'localImage' && typeof value.path === 'string' && value.path.startsWith('/')) {
      const name = value.path.split('/').at(-1);
      if (name) return [{ path: value.path, name, image: true }];
    }
    return [];
  });
}

export function isSourceItem(item: ThreadItemSummary) {
  if (item.type === 'mcpToolCall') return typeof item.server === 'string' && !!item.server && item.server !== 'plugin-runtime' &&
    typeof item.tool === 'string' && !!item.tool;
  if (item.type === 'webSearch') return true;
  return (item.type === 'userMessage' || item.type === 'steeringUserMessage') && attachments(item).length > 0;
}

function webPage(value: unknown): SourceWebPage | undefined {
  if (typeof value !== 'string') return;
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return;
    return { url: url.href, label: url.host + (url.pathname === '/' ? '' : url.pathname) + url.search + url.hash };
  } catch { /* The event did not include a navigable page. */ }
}

export function conversationSources(turns: readonly TurnSummary[], known: SourceItemsByTurn): ConversationSources {
  const byTurn = new Map(turns.map(turn => [turn.id, turn]));
  const ids = [...new Set([...byTurn.keys(), ...known.keys()])].reverse();
  const files = new Map<string, PromptAttachment>();
  const integrations = new Map<string, SourceIntegration>();
  const queries = new Set<string>();
  const pages = new Map<string, SourceWebPage>();
  let searchCount = 0;
  for (const id of ids) {
    const turn = byTurn.get(id);
    const saved = turn?.items.filter(isSourceItem) ?? [];
    const toolItems = new Map(saved.map(item => [item.id, item]));
    if (!turn || turn.status === 'inProgress' || turn.itemsView !== 'full') {
      for (const item of known.get(id) ?? []) if (isSourceItem(item)) toolItems.set(item.id, item);
    }
    for (const item of [...toolItems.values()].reverse()) {
      if (item.type === 'mcpToolCall' && typeof item.server === 'string' && typeof item.tool === 'string') {
        const app = record(item.appContext);
        const key = typeof app.connectorId === 'string' && app.connectorId ? 'connector:' + app.connectorId :
          typeof item.pluginId === 'string' && item.pluginId ? 'plugin:' + item.pluginId : 'server:' + item.server;
        const name = typeof app.appName === 'string' && app.appName ? app.appName :
          app.connectorId === 'connector_openai_pages' ? 'Navigation' : label(item.server);
        let integration = integrations.get(key);
        if (!integration) {
          integration = { id: key, name, tools: [] };
          integrations.set(key, integration);
        }
        const toolName = label(item.tool);
        let tool = integration.tools.find(row => row.id === item.tool);
        if (!tool) {
          tool = { id: item.tool, name: toolName, calls: [] };
          integration.tools.push(tool);
        }
        tool.calls.push({ id: id + ':' + item.id, item });
      } else if (item.type === 'webSearch') {
        const action = record(item.action);
        if (action.type === 'openPage' || action.type === 'findInPage') {
          const page = webPage(action.url);
          if (page && !pages.has(page.url)) pages.set(page.url, page);
          continue;
        }
        const terms = action.type === 'search'
          ? Array.isArray(action.queries) && action.queries.length > 0 ? action.queries : [action.query]
          : [item.query];
        for (const term of terms) if (typeof term === 'string' && term.trim()) {
          searchCount++;
          queries.add(term.trim());
        }
      } else {
        for (const file of attachments(item)) if (!files.has(file.path)) files.set(file.path, file);
      }
    }
  }
  return { files: [...files.values()], integrations: [...integrations.values()],
    web: { searchCount, queries: [...queries], pages: [...pages.values()] } };
}
