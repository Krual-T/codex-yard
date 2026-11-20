import type { ModelSummary, SessionConfig, SessionSettings, ThreadSettingsResponse } from './codex-protocol.ts';

export function sessionSettings(config: SessionConfig, models: readonly ModelSummary[] = []): SessionSettings {
  return {
    model: config.model || models.find(model => model.isDefault)?.id || null,
    modelProvider: config.model_provider || null,
    reasoningEffort: config.model_reasoning_effort ?? null,
    approvalPolicy: config.approval_policy ?? null,
    sandboxMode: config.sandbox_mode ?? null,
    serviceTier: config.service_tier ?? null,
    ...(config.approvals_reviewer ? { approvalsReviewer: config.approvals_reviewer } : {}),
    ...(config.default_permissions ? { permissionProfileId: config.default_permissions } : {}),
  };
}

export function threadSettings(result: ThreadSettingsResponse): Partial<SessionSettings> {
  const sandboxTypes = { dangerFullAccess: 'danger-full-access', workspaceWrite: 'workspace-write',
    readOnly: 'read-only', externalSandbox: 'external-sandbox' } as const;
  const settings: Partial<SessionSettings> = {};
  function copy<K extends keyof ThreadSettingsResponse & keyof SessionSettings>(key: K) {
    if (Object.hasOwn(result, key)) Object.assign(settings, { [key]: result[key] });
  }
  for (const key of ['model', 'modelProvider', 'reasoningEffort', 'approvalPolicy', 'serviceTier', 'approvalsReviewer'] as const) {
    copy(key);
  }
  if (Object.hasOwn(result, 'effort')) settings.reasoningEffort = result.effort;
  const mode = typeof result.collaborationMode === 'string' ? result.collaborationMode : result.collaborationMode?.mode;
  if (mode === 'plan' || mode === 'default') settings.collaborationMode = mode;
  const sandbox = result.sandbox ?? result.sandboxPolicy;
  if (sandbox) settings.sandboxMode = sandboxTypes[sandbox.type];
  if (Object.hasOwn(result, 'activePermissionProfile')) settings.permissionProfileId = result.activePermissionProfile?.id ?? null;
  return settings;
}
