import type { PluginCatalog } from '../pages/plugins/catalog.ts';
import type { ComposerContext, ComposerDocument } from '../workbench-contract.ts';

export type SummaryOutputKind = 'document' | 'presentation' | 'spreadsheet' | 'site';
export type SummaryOutputScope = Pick<ComposerContext, 'hostId' | 'cwd'>;

export interface SummaryOutputMessage {
  id: string;
  defaultMessage: string;
}

export interface SummaryOutputInventory extends SummaryOutputScope {
  catalog: PluginCatalog;
}

export type SummaryOutputPluginObservation =
  | { status: 'unknown' | 'scope-mismatch' | 'not-reported' | 'ambiguous'; warnings: string[] }
  | { status: 'observed'; warnings: string[]; marketplaceName: string; marketplacePath: string | null;
      name: string; sourceType: string; installPolicy: string; installed: boolean; enabled: boolean;
      availability: string | null; disabledReason: string | null };

export interface SummaryOutputPluginMention extends ComposerDocument {
  type: 'pluginMention';
  attrs: { name: string; displayName: string; path: string; description: string };
}

export interface SummaryOutputPrefill {
  kind: SummaryOutputKind;
  scope: SummaryOutputScope;
  message: SummaryOutputMessage;
  pluginId: string;
  mention: SummaryOutputPluginMention;
  observation: SummaryOutputPluginObservation;
  /** Original persisted prompt syntax; this alone is not an editable plugin mention. */
  prompt: string;
  /** Document containing the original inline node, pending composer support. */
  document: ComposerDocument;
}

const outputs: Record<SummaryOutputKind, { label: string; pluginId: string; message: SummaryOutputMessage }> = {
  document: { label: 'Documents', pluginId: 'documents@openai-primary-runtime', message: {
    id: 'home.newChatPageSuggestions.createDocument.prompt.v5',
    defaultMessage: 'Create a new document with {artifact}. Start by asking me what it should be about.',
  } },
  presentation: { label: 'Presentations', pluginId: 'presentations@openai-primary-runtime', message: {
    id: 'home.newChatPageSuggestions.createPresentation.prompt.v5',
    defaultMessage: 'Create a new presentation with {artifact}. Start by asking me what it should be about.',
  } },
  spreadsheet: { label: 'Spreadsheets', pluginId: 'spreadsheets@openai-primary-runtime', message: {
    id: 'home.newChatPageSuggestions.createSpreadsheet.prompt.v5',
    defaultMessage: 'Create a new spreadsheet with {artifact}. Start by asking me what it should be about.',
  } },
  site: { label: 'Sites', pluginId: 'sites@openai-curated-remote', message: {
    id: 'home.newChatPageSuggestions.createSite.prompt.v5',
    defaultMessage: 'Create a new site with {artifact}. Start by asking me what it should be about.',
  } },
};

function observePlugin(scope: SummaryOutputScope, inventory: SummaryOutputInventory | undefined, pluginId: string): SummaryOutputPluginObservation {
  if (!inventory) return { status: 'unknown', warnings: [] };
  if (scope.hostId !== inventory.hostId || scope.cwd !== inventory.cwd) return { status: 'scope-mismatch', warnings: [] };
  const warnings = [...inventory.catalog.warnings];
  const matches = inventory.catalog.entries.filter(entry => entry.plugin.id === pluginId);
  if (matches.length === 0) return { status: 'not-reported', warnings };
  if (matches.length !== 1) return { status: 'ambiguous', warnings };
  const entry = matches[0]!;
  return { status: 'observed', warnings, marketplaceName: entry.marketplaceName, marketplacePath: entry.marketplacePath,
    name: entry.plugin.name, sourceType: entry.plugin.source.type, installPolicy: entry.plugin.installPolicy,
    installed: entry.plugin.installed, enabled: entry.plugin.enabled,
    availability: entry.plugin.availability ?? null, disabledReason: entry.plugin.disabledReason ?? null };
}

/** Build the original prompt and node without changing any draft or dispatching a request. */
export function createSummaryOutputPrefill(options: {
  kind: SummaryOutputKind;
  context: SummaryOutputScope;
  inventory?: SummaryOutputInventory;
  /** Return a translated plain-prose template containing one literal {artifact}. */
  formatMessage?: (message: SummaryOutputMessage) => string;
}): SummaryOutputPrefill {
  if (!Object.hasOwn(outputs, options.kind) || !options.context.hostId) throw new Error('Invalid summary output or host');
  const item = outputs[options.kind];
  const message = { ...item.message };
  const template = options.formatMessage?.({ ...message }) ?? message.defaultMessage;
  const marker = '{artifact}', offset = template.indexOf(marker);
  if (offset < 0 || template.indexOf(marker, offset + marker.length) !== -1) {
    throw new Error('The output prompt must contain exactly one artifact reference');
  }
  const before = template.slice(0, offset), after = template.slice(offset + marker.length);
  // Arbitrary Markdown needs the composer's parser to construct the correct marks and blocks.
  if (/[\r\n\\`*_~\[\]<>]/u.test(before + after) || /^\s{0,3}(?:#{1,6}\s|>\s|[-+]\s|\d+[.)]\s)/u.test(before)) {
    throw new Error('The output prompt translation must be plain single-paragraph prose');
  }
  const path = `plugin://${item.pluginId}`;
  const mention: SummaryOutputPluginMention = { type: 'pluginMention', attrs: {
    name: item.label, displayName: item.label, path, description: '',
  } };
  const content: ComposerDocument[] = [];
  if (before) content.push({ type: 'text', text: before });
  content.push(mention);
  if (after) content.push({ type: 'text', text: after });
  const scope = { hostId: options.context.hostId, cwd: options.context.cwd };
  return { kind: options.kind, scope, message, pluginId: item.pluginId, mention,
    observation: observePlugin(scope, options.inventory, item.pluginId),
    prompt: `${before}[@${item.label}](${path})${after}`,
    document: { type: 'doc', content: [{ type: 'paragraph', content }] } };
}
