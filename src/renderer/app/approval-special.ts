import { parseApprovalForm, safeElicitationUrl } from './approval-schema.ts';

export interface ApprovalToolSuggestion {
  kind: 'tool-suggestion'; toolType: 'connector' | 'plugin'; action: 'install' | 'enable';
  toolId: string; toolName: string; reason: string; installUrl?: string;
  remotePluginId?: string; suggestionId?: string; persist?: 'always'; riskLevel?: 'low' | 'high';
}
export interface ApprovalBrowserAuthField {
  id: string; label: string; required: boolean; type: 'email' | 'number' | 'password' | 'search' | 'tel' | 'text' | 'url';
  autocomplete?: string | null;
}
export interface ApprovalBrowserAuth {
  kind: 'browser-auth'; origin: string; reason: string; challengeId: string; targetTabId?: string;
  fields: ApprovalBrowserAuthField[]; options: { id: string; label: string; fieldIds: string[] }[];
  hasQrCode: boolean; qrCode: boolean; initialQrPayload?: string; qrCodeRequiresApp?: boolean;
  hasWebauthn: boolean; riskLevel?: 'low' | 'high';
}
export type ApprovalSpecial = ApprovalToolSuggestion
  | { kind: 'user-verification'; title: string; description: string; challenge: string }
  | { kind: 'email-otp'; origin: string; riskLevel?: 'low' | 'high' } | ApprovalBrowserAuth;
export type ApprovalSpecialResult = ApprovalSpecial | { kind: 'unsupported'; reason: string } | null;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function only(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}
function emptySchema(value: unknown): boolean {
  const parsed = parseApprovalForm(value);
  return Boolean(parsed.form && parsed.form.fields.length === 0);
}
function canonicalChallenge(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > 5462 || value.length % 4 === 1) return false;
  try {
    const bytes = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    return bytes.length >= 1 && bytes.length <= 4096 && btoa(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === value;
  } catch { return false; }
}
function canonicalHttpsOrigin(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && url.href === value + '/';
  } catch { return false; }
}
function safeId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(value)
    && !['__proto__', 'constructor', 'prototype'].includes(value);
}
function browserAuth(params: Record<string, unknown>, meta: Record<string, unknown>): ApprovalSpecialResult {
  const invalid = (): ApprovalSpecialResult => ({ kind: 'unsupported', reason: 'This browser sign-in request cannot be represented safely.' });
  if (params.mode !== 'form' || !emptySchema(params.requestedSchema)
    || !only(meta, ['codex_approval_kind', 'browser_auth_challenge_id', 'origin', 'reason', 'fields', 'options', 'screenshot',
      'qrCode', 'qrCodePayload', 'qrCodeRequiresApp', 'qrCodeUrl', 'registrableDomain', 'webauthn', 'riskLevel', 'subtitle'])
    || typeof meta.browser_auth_challenge_id !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(meta.browser_auth_challenge_id)
    || typeof meta.origin !== 'string' || typeof meta.reason !== 'string' || !Array.isArray(meta.fields) || meta.fields.length > 6
    || meta.options !== undefined && (!Array.isArray(meta.options) || meta.options.length > 10)
    || meta.qrCode !== undefined && typeof meta.qrCode !== 'boolean'
    || meta.qrCodeRequiresApp !== undefined && typeof meta.qrCodeRequiresApp !== 'boolean'
    || meta.qrCodePayload !== undefined && typeof meta.qrCodePayload !== 'string'
    || meta.qrCodeUrl !== undefined && typeof meta.qrCodeUrl !== 'string'
    || meta.registrableDomain !== undefined && typeof meta.registrableDomain !== 'string'
    || meta.riskLevel != null && meta.riskLevel !== 'low' && meta.riskLevel !== 'high'
    || meta.subtitle != null && typeof meta.subtitle !== 'string') return invalid();
  try {
    const url = new URL(meta.origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return invalid();
  } catch { return invalid(); }
  let targetTabId: string | undefined;
  if (meta.screenshot !== undefined && meta.screenshot !== null) {
    if (!record(meta.screenshot)) return invalid();
    if (meta.screenshot.tabId !== undefined) {
      if (typeof meta.screenshot.tabId !== 'string' || !/^[1-9]\d*$/.test(meta.screenshot.tabId)
        || !Number.isSafeInteger(Number(meta.screenshot.tabId))) return invalid();
      targetTabId = meta.screenshot.tabId;
    }
  }
  const fields: ApprovalBrowserAuthField[] = [];
  for (const field of meta.fields) {
    if (!record(field) || !only(field, ['id', 'label', 'required', 'type', 'autocomplete']) || !safeId(field.id)
      || typeof field.label !== 'string' || typeof field.required !== 'boolean'
      || typeof field.type !== 'string' || !['email', 'number', 'password', 'search', 'tel', 'text', 'url'].includes(field.type)
      || field.autocomplete != null && typeof field.autocomplete !== 'string') return invalid();
    fields.push({ id: field.id, label: field.label, required: field.required, type: field.type as ApprovalBrowserAuthField['type'],
      ...(typeof field.autocomplete === 'string' || field.autocomplete === null ? { autocomplete: field.autocomplete } : {}) });
  }
  if (new Set(fields.map(field => field.id)).size !== fields.length) return invalid();
  const options: ApprovalBrowserAuth['options'] = [];
  for (const option of meta.options ?? []) {
    if (!record(option) || !only(option, ['id', 'label', 'field_ids']) || !safeId(option.id) || typeof option.label !== 'string'
      || !option.label.trim() || option.label.length > 120 || !Array.isArray(option.field_ids) || option.field_ids.length > 6
      || !option.field_ids.every(id => safeId(id) && fields.some(field => field.id === id))
      || new Set(option.field_ids).size !== option.field_ids.length) return invalid();
    options.push({ id: option.id, label: option.label, fieldIds: option.field_ids });
  }
  if (new Set(options.map(option => option.id)).size !== options.length) return invalid();
  let initialQrPayload = typeof meta.qrCodePayload === 'string' && meta.qrCodePayload ? meta.qrCodePayload : undefined;
  if (!initialQrPayload && typeof meta.qrCodeUrl === 'string') {
    try {
      const url = new URL(meta.qrCodeUrl);
      if (url.protocol === 'https:' && url.hostname && !url.username && !url.password) initialQrPayload = meta.qrCodeUrl;
    } catch { /* The initial URL is not a usable QR payload. */ }
  }
  return { kind: 'browser-auth', origin: meta.origin, reason: meta.reason, challengeId: meta.browser_auth_challenge_id,
    ...(targetTabId ? { targetTabId } : {}), fields, options,
    hasQrCode: meta.qrCode === true || Boolean(initialQrPayload), qrCode: meta.qrCode === true,
    ...(initialQrPayload ? { initialQrPayload } : {}),
    ...(typeof meta.qrCodeRequiresApp === 'boolean' ? { qrCodeRequiresApp: meta.qrCodeRequiresApp } : {}),
    hasWebauthn: meta.webauthn != null, ...(meta.riskLevel === 'low' || meta.riskLevel === 'high' ? { riskLevel: meta.riskLevel } : {}) };
}

/** Recognize the original special requests before rendering any ordinary form. */
export function classifyApprovalSpecial(params: Record<string, unknown>, meta: Record<string, unknown>): ApprovalSpecialResult {
  if (meta.codex_approval_kind === 'browser_auth') return browserAuth(params, meta);
  if (params.mode === 'openai/userVerification') {
    const size = (value: string) => new TextEncoder().encode(value).length;
    if (Object.keys(meta).length || typeof params.title !== 'string' || size(params.title) < 1 || size(params.title) > 256
      || typeof params.description !== 'string' || size(params.description) > 4096 || !canonicalChallenge(params.challenge))
      return { kind: 'unsupported', reason: 'This verification request cannot be represented safely.' };
    return { kind: 'user-verification', title: params.title, description: params.description, challenge: params.challenge };
  }
  if (meta.codex_approval_kind === 'browser_email_otp') {
    const parsed = parseApprovalForm(params.requestedSchema);
    if (params.mode !== 'form' || !['node_repl', 'cua_repl'].includes(String(params.serverName))
      || !only(meta, ['codex_approval_kind', 'connector_id', 'origin', 'frame_origin', 'browser_auth_challenge_id', 'otp_handle', 'riskLevel', 'subtitle'])
      || meta.connector_id !== 'browser-use' || !canonicalHttpsOrigin(meta.origin) || meta.frame_origin !== meta.origin
      || typeof meta.browser_auth_challenge_id !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(meta.browser_auth_challenge_id)
      || typeof meta.otp_handle !== 'string' || !/^[A-Za-z0-9_-]{21}[AQgw]$/.test(meta.otp_handle)
      || meta.riskLevel != null && meta.riskLevel !== 'low' && meta.riskLevel !== 'high'
      || meta.subtitle != null && typeof meta.subtitle !== 'string' || !parsed.form || parsed.form.fields.length !== 1
      || parsed.form.fields[0]?.key !== 'approved' || parsed.form.fields[0].kind !== 'boolean' || !parsed.form.fields[0].required)
      return { kind: 'unsupported', reason: 'This email-code request cannot be represented safely.' };
    return { kind: 'email-otp', origin: meta.origin, ...(meta.riskLevel === 'low' || meta.riskLevel === 'high' ? { riskLevel: meta.riskLevel } : {}) };
  }
  if (meta.codex_approval_kind === 'tool_suggestion') {
    if (params.mode !== 'form' || !emptySchema(params.requestedSchema)
      || !only(meta, ['codex_approval_kind', 'tool_type', 'suggest_type', 'suggest_reason', 'tool_id', 'tool_name', 'persist',
        'install_url', 'remote_plugin_id', 'suggestion_id', 'riskLevel', 'subtitle'])
      || meta.tool_type !== 'connector' && meta.tool_type !== 'plugin' || meta.suggest_type !== 'install' && meta.suggest_type !== 'enable'
      || typeof meta.tool_id !== 'string' || !meta.tool_id.trim() || typeof meta.tool_name !== 'string' || !meta.tool_name.trim()
      || typeof meta.suggest_reason !== 'string' || meta.persist !== undefined && meta.persist !== 'always'
      || meta.riskLevel != null && meta.riskLevel !== 'low' && meta.riskLevel !== 'high'
      || meta.subtitle != null && typeof meta.subtitle !== 'string'
      || meta.remote_plugin_id !== undefined && (typeof meta.remote_plugin_id !== 'string' || !meta.remote_plugin_id.trim())
      || meta.suggestion_id !== undefined && typeof meta.suggestion_id !== 'string'
      || meta.tool_type === 'connector' && typeof meta.install_url !== 'string'
      || meta.install_url !== undefined && (typeof meta.install_url !== 'string' || !safeElicitationUrl(meta.install_url)))
      return { kind: 'unsupported', reason: 'This tool suggestion cannot be represented safely.' };
    return { kind: 'tool-suggestion', toolType: meta.tool_type, action: meta.suggest_type, toolId: meta.tool_id,
      toolName: meta.tool_name, reason: meta.suggest_reason, ...(typeof meta.install_url === 'string' ? { installUrl: meta.install_url } : {}),
      ...(typeof meta.remote_plugin_id === 'string' ? { remotePluginId: meta.remote_plugin_id } : {}),
      ...(typeof meta.suggestion_id === 'string' ? { suggestionId: meta.suggestion_id } : {}),
      ...(meta.persist === 'always' ? { persist: 'always' } : {}),
      ...(meta.riskLevel === 'low' || meta.riskLevel === 'high' ? { riskLevel: meta.riskLevel } : {}) };
  }
  return null;
}
