import { parseApprovalForm, safeElicitationUrl } from './approval-schema.ts';
import type { ApprovalForm } from './approval-schema.ts';
import { classifyApprovalSpecial } from './approval-special.ts';
import type { ApprovalSpecial } from './approval-special.ts';

type ConfirmationField = { label: string; value: string };
type Confirmation = { field: string; title?: string; confirmLabel?: string; destructive?: boolean;
  fields: ConfirmationField[]; sections?: { title?: string; fields: ConfirmationField[] }[] };
export type ApprovalPersistence = 'session' | 'always';
export type Elicitation = ApprovalSpecial
  | { kind: 'form'; form: ApprovalForm; confirmation?: Confirmation }
  | { kind: 'tool'; connector: string; tool?: string; parameters: Record<string, unknown>; executionBound: boolean;
      persistence: ApprovalPersistence[]; riskLevel?: 'low' | 'high' }
  | { kind: 'url'; url: string; connector?: string; connectorId?: string; linkId?: string; reason?: string; scopes?: string[];
      consent?: { origin: string; connectionId: string; scopes: { scope: string; label: string }[] } }
  | { kind: 'unsupported'; reason: string };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function only(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function allowedKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}
function persistence(value: unknown): ApprovalPersistence[] | null {
  if (value === undefined || value === null) return [];
  const options = Array.isArray(value) ? value : [value];
  if (!options.length || options.length > 2 || options.some(item => item !== 'session' && item !== 'always')
    || new Set(options).size !== options.length) return null;
  return options as ApprovalPersistence[];
}
function emptySpecialSchema(params: Record<string, unknown>): boolean {
  const parsed = parseApprovalForm(params.requestedSchema);
  return Boolean(parsed.form && parsed.form.fields.length === 0);
}

/** JSON output with invisible and directional characters visible in both keys and values. */
export function displayApprovalParameters(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/[\p{Cc}\p{Cf}\p{Zs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/gu, character => {
    if (character === ' ' || character === '\n') return character;
    const point = character.codePointAt(0)!;
    return point <= 0xffff ? '\\u' + point.toString(16).toUpperCase().padStart(4, '0')
      : '\\u{' + point.toString(16).toUpperCase() + '}';
  });
}
function codePointOrder(a: string, b: string): number {
  const x = Array.from(a, character => character.codePointAt(0)!), y = Array.from(b, character => character.codePointAt(0)!);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return x.length - y.length;
}
function canonical(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value).replace(/[\u007f-\uffff]/g, character =>
    '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (record(value)) return '{' + Object.entries(value).sort(([a], [b]) => codePointOrder(a, b))
    .map(([key, item]) => canonical(key) + ':' + canonical(item)).join(',') + '}';
  return '';
}

const databaseConnector = 'connector_20205bf7d4e99a89d7154bb849718324';
const databaseTools = ['sites.execute_database_delete', 'sites.execute_database_insert', 'sites.execute_database_update'] as const;
function databaseSummary(tool: string, parameters: Record<string, unknown>): Record<string, unknown> | null {
  if (!only(parameters, ['confirmation_summary', 'plan_token']) || typeof parameters.plan_token !== 'string'
    || !parameters.plan_token.trim() || typeof parameters.confirmation_summary !== 'string' || parameters.confirmation_summary.length > 500) return null;
  let data: unknown;
  try { data = JSON.parse(parameters.confirmation_summary); } catch { return null; }
  if (!record(data) || canonical(data) !== parameters.confirmation_summary || data.approval_version !== 1) return null;
  const shared = ['approval_version', 'binding_name', 'deployment_id', 'primary_key_column', 'primary_key_value', 'project_id', 'table_name'];
  const keys = tool.endsWith('_update') ? [...shared, 'column', 'new_value', 'old_value'] : [...shared, 'operation', 'values'];
  if (!only(data, keys) || !shared.slice(1).every(key => typeof data[key] === 'string')) return null;
  if (tool.endsWith('_update')) {
    return typeof data.column === 'string' && typeof data.new_value === 'string'
      && (data.old_value === null || typeof data.old_value === 'string') ? data : null;
  }
  const operation = tool.endsWith('_delete') ? 'delete' : 'insert';
  if (data.operation !== operation || !record(data.values)) return null;
  const validValues = Object.values(data.values).every(value => typeof value === 'string'
    || operation === 'delete' && (typeof value === 'boolean' || typeof value === 'number' && Number.isSafeInteger(value)));
  if (!Object.hasOwn(data.values, data.primary_key_column as string)) return null;
  const primaryValue = data.values[data.primary_key_column as string];
  return validValues && primaryValue != null && String(primaryValue) === data.primary_key_value ? data : null;
}

function confirmation(value: unknown, form: ApprovalForm, message: unknown): Confirmation | null {
  if (!record(value) || value.version !== 1 || typeof value.field !== 'string' || !value.field
    || typeof message !== 'string' || !message.trim() || form.fields.length !== 1
    || form.fields[0]?.key !== value.field || form.fields[0].kind !== 'boolean' || !form.fields[0].required) return null;
  if (value.presentation === undefined) return { field: value.field, fields: [] };
  if (!record(value.presentation)) return null;
  const presentation = value.presentation;
  if (typeof presentation.title !== 'string' || !presentation.title.trim() || presentation.title.trim().length > 120
    || typeof presentation.triggerLabel !== 'string' || !presentation.triggerLabel.trim() || presentation.triggerLabel.trim().length > 80
    || typeof presentation.confirmLabel !== 'string' || !presentation.confirmLabel.trim() || presentation.confirmLabel.trim().length > 80
    || presentation.destructive !== undefined && typeof presentation.destructive !== 'boolean'
    || presentation.icon !== undefined && presentation.icon !== 'shield') return null;
  const fields: ConfirmationField[] = [];
  if (presentation.fields !== undefined) {
    if (!Array.isArray(presentation.fields) || presentation.fields.length < 1 || presentation.fields.length > 20) return null;
    for (const field of presentation.fields) {
      if (!record(field) || typeof field.label !== 'string' || !field.label.trim() || field.label.trim().length > 120
        || typeof field.value !== 'string' || !field.value.trim() || field.value.length > 10000) return null;
      fields.push({ label: field.label, value: field.value });
    }
  }
  let sections: Confirmation['sections'];
  if (presentation.sections !== undefined) {
    if (!Array.isArray(presentation.sections) || presentation.sections.length < 1 || presentation.sections.length > 10) return null;
    const used = new Set<number>();
    sections = [];
    for (const section of presentation.sections) {
      if (!record(section) || section.title !== undefined && (typeof section.title !== 'string'
        || !section.title.trim() || section.title.trim().length > 120)
        || !Number.isInteger(section.bodyField) || !Number.isInteger(section.captionField)) return null;
      const body = section.bodyField as number, caption = section.captionField as number;
      if (body < 0 || caption < 0 || body >= fields.length || caption >= fields.length
        || body === caption || used.has(body) || used.has(caption)) return null;
      used.add(body); used.add(caption);
      sections.push({ ...(typeof section.title === 'string' ? { title: section.title } : {}), fields: [fields[body]!, fields[caption]!] });
    }
    if (used.size !== fields.length) return null;
  }
  return { field: value.field, title: presentation.title, confirmLabel: presentation.confirmLabel, fields,
    ...(presentation.destructive === true ? { destructive: true } : {}), ...(sections ? { sections } : {}) };
}

function chatgptHost(url: string): boolean {
  const hostname = new URL(url).hostname.toLowerCase();
  return ['chatgpt.com', 'chatgpt-staging.com'].some(domain => hostname === domain || hostname.endsWith('.' + domain));
}
function connectorAuth(meta: Record<string, unknown>): {
  connector: string; connectorId: string; linkId?: string; reason?: string; scopes: string[];
  consent?: { origin: string; connectionId: string; scopes: { scope: string; label: string }[] };
} | null {
  if (!record(meta._codex_apps) || !record(meta._codex_apps.connector_auth_failure)) return null;
  const auth = meta._codex_apps.connector_auth_failure;
  if (auth.is_auth_failure !== true || typeof auth.connector_id !== 'string' || !auth.connector_id.trim()
    || typeof auth.connector_name !== 'string' || !auth.connector_name.trim()
    || typeof auth.install_url !== 'string' || auth.auth_reason !== undefined && typeof auth.auth_reason !== 'string'
    || auth.link_id !== undefined && typeof auth.link_id !== 'string'
    || auth.requested_scopes !== undefined && (!Array.isArray(auth.requested_scopes)
      || !auth.requested_scopes.every(scope => typeof scope === 'string' && scope.trim()))) return null;
  let consentDetails: { origin: string; connectionId: string; scopes: { scope: string; label: string }[] } | undefined;
  if (auth.connection_consent !== undefined) {
    const consent = auth.connection_consent;
    if (!record(consent) || consent.type !== 'consent' || typeof consent.origin !== 'string' || !safeElicitationUrl(consent.origin)
      || typeof consent.connection_id !== 'string' || !consent.connection_id || consent.connection_id.length > 255
      || !Array.isArray(consent.scopes) || !consent.scopes.every(scope => record(scope)
        && typeof scope.scope === 'string' && typeof scope.label === 'string' && scope.label.length > 0)) return null;
    consentDetails = { origin: consent.origin, connectionId: consent.connection_id,
      scopes: consent.scopes as { scope: string; label: string }[] };
  }
  return { connector: auth.connector_name, connectorId: auth.connector_id,
    ...(typeof auth.link_id === 'string' ? { linkId: auth.link_id } : {}),
    ...(typeof auth.auth_reason === 'string' ? { reason: auth.auth_reason } : {}),
    scopes: (auth.requested_scopes ?? []) as string[], ...(consentDetails ? { consent: consentDetails } : {}) };
}

/** Classify security-bearing metadata before considering the requested form. */
export function classifyElicitation(params: Record<string, unknown>): Elicitation {
  const mode = params.mode;
  const meta = record(params._meta) ? params._meta : {};
  if (params._meta != null && !record(params._meta)) return { kind: 'unsupported', reason: 'This request has invalid metadata.' };
  const special = classifyApprovalSpecial(params, meta);
  if (special) return special;
  if (mode === 'url') {
    if (meta.codex_approval_kind !== undefined) return { kind: 'unsupported', reason: 'This special authentication request is not supported.' };
    const url = safeElicitationUrl(params.url);
    if (!url || typeof params.elicitationId !== 'string' || !params.elicitationId) return { kind: 'unsupported', reason: 'This URL request cannot be opened safely.' };
    if (params.serverName === 'codex_apps') {
      const auth = connectorAuth(meta);
      return auth && chatgptHost(url) ? { kind: 'url', url, ...auth } : { kind: 'unsupported', reason: 'This connector authentication request cannot be verified.' };
    }
    return { kind: 'url', url };
  }
  if (mode !== 'form' && mode !== 'openai/form' && mode !== 'openaiForm') return { kind: 'unsupported', reason: 'This elicitation mode is not supported.' };
  if (meta.codex_approval_kind !== undefined) {
    if (mode !== 'form' || meta.codex_approval_kind !== 'mcp_tool_call'
      || typeof meta.connector_id !== 'string' || !meta.connector_id || !record(meta.tool_params)
      || meta.tool_name !== undefined && typeof meta.tool_name !== 'string'
      || !emptySpecialSchema(params)
      || !allowedKeys(meta, ['codex_approval_kind', 'codex_request_type', 'connector_id', 'connector_name', 'tool_name',
        'tool_title', 'tool_params', 'tool_params_display', 'persist', 'riskLevel', 'subtitle'])
      || meta.codex_request_type !== undefined && meta.codex_request_type !== 'approval_request'
      || meta.riskLevel != null && meta.riskLevel !== 'low' && meta.riskLevel !== 'high') {
      return { kind: 'unsupported', reason: 'This special approval cannot be represented safely.' };
    }
    const persistent = persistence(meta.persist);
    if (!persistent) return { kind: 'unsupported', reason: 'This approval has an invalid persistence option.' };
    const riskLevel = meta.riskLevel === 'low' || meta.riskLevel === 'high' ? meta.riskLevel : undefined;
    const tool = typeof meta.tool_name === 'string' ? meta.tool_name.trim() : '';
    const database = params.serverName === 'codex_apps' && meta.connector_id === databaseConnector
      && (databaseTools.some(name => name === tool) || !tool && ('confirmation_summary' in meta.tool_params || 'plan_token' in meta.tool_params));
    if (database) {
      const summary = databaseSummary(tool || 'sites.execute_database_update', meta.tool_params);
      return summary ? { kind: 'tool', connector: meta.connector_id, tool: tool || 'sites.execute_database_update', parameters: summary,
        executionBound: true, persistence: [], riskLevel: 'high' }
        : { kind: 'unsupported', reason: 'The database change confirmation is invalid; approval is unavailable.' };
    }
    return { kind: 'tool', connector: meta.connector_id, ...(tool ? { tool } : {}), parameters: meta.tool_params,
      executionBound: false, persistence: persistent, ...(riskLevel ? { riskLevel } : {}) };
  }
  if (mode === 'form' && (params.serverName === 'browser' || params.serverName === 'browser-use')
    && meta.persist != null && typeof meta.origin === 'string' && meta.origin.trim()
    && emptySpecialSchema(params) && allowedKeys(meta, ['origin', 'persist', 'riskLevel', 'subtitle', 'tool_params', 'tool_params_display'])) {
    const persistent = persistence(meta.persist);
    if (!persistent || meta.riskLevel != null && meta.riskLevel !== 'low' && meta.riskLevel !== 'high'
      || meta.subtitle != null && typeof meta.subtitle !== 'string'
      || meta.tool_params !== undefined && !record(meta.tool_params)
      || meta.tool_params_display !== undefined && (!Array.isArray(meta.tool_params_display)
        || !meta.tool_params_display.every(item => record(item) && allowedKeys(item, ['name', 'value', 'display_name'])
          && typeof item.name === 'string' && Boolean(item.name.trim()) && Object.hasOwn(item, 'value')
          && (item.display_name === undefined || typeof item.display_name === 'string' && Boolean(item.display_name.trim())))))
      return { kind: 'unsupported', reason: 'This approval has invalid security metadata.' };
    return { kind: 'tool', connector: params.serverName, parameters: { origin: meta.origin,
      ...(meta.tool_params !== undefined ? { tool_params: meta.tool_params } : {}),
      ...(meta.tool_params_display !== undefined ? { tool_params_display: meta.tool_params_display } : {}) }, executionBound: false,
      persistence: persistent, ...(meta.riskLevel === 'low' || meta.riskLevel === 'high' ? { riskLevel: meta.riskLevel } : {}) };
  }
  if (mode === 'form' && (params.serverName === 'browser' || params.serverName === 'browser-use') && meta.persist != null)
    return { kind: 'unsupported', reason: 'This browser approval cannot be represented safely.' };
  const schema = mode === 'form' && Object.hasOwn(meta, 'openai/elicitation')
    ? record(meta['openai/elicitation']) ? meta['openai/elicitation'].requestedSchema : undefined : params.requestedSchema;
  const formMode = mode === 'openai/form' ? 'legacy-openai'
    : mode === 'openaiForm' || Object.hasOwn(meta, 'openai/elicitation') ? 'openai' : 'mcp';
  const parsed = parseApprovalForm(schema, formMode);
  if (!parsed.form) return { kind: 'unsupported', reason: parsed.error };
  if (Object.hasOwn(meta, 'openai/confirmation')) {
    const confirmed = confirmation(meta['openai/confirmation'], parsed.form, params.message);
    return confirmed ? { kind: 'form', form: parsed.form, confirmation: confirmed }
      : { kind: 'unsupported', reason: 'This confirmation cannot be represented safely.' };
  }
  return { kind: 'form', form: parsed.form };
}
