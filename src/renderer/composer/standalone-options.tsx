import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Ref } from 'react';
import type { SubmitOptions, WorkbenchClient } from '../workbench-contract.ts';
import { useI18n } from '../i18n/index.tsx';
import { ModelSettings } from '../settings/model-settings.ts';
import type { ApprovalPolicy, ApprovalsReviewer, SandboxMode } from '../../../lib/codex-protocol.ts';

interface Model { value: string; label: string; default: boolean; defaultEffort: string | null; efforts: string[] }
interface OptionsProps {
  client: WorkbenchClient;
  hostId: string;
  cwd: string;
  threadId: string | null;
  busy: boolean;
  modelRef: Ref<HTMLSelectElement>;
  value: SubmitOptions;
  onChange(patch: Partial<SubmitOptions>): void;
  onDefaultPendingChange(pending: boolean): void;
}
function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function string(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
function effectiveModelClient(client: WorkbenchClient, defaultModel: string | undefined): WorkbenchClient {
  if (!defaultModel) return client;
  return {
    async rpc<T>(method: string, params?: Record<string, unknown>, hostId?: string): Promise<T> {
      const result = await client.rpc<T>(method, params, hostId);
      if (method !== 'config/read') return result;
      const response = record(result), rawConfig = response.config;
      if (rawConfig === null || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) return result;
      const config = record(rawConfig);
      if (config.model !== null && config.model !== undefined) return result;
      // A missing configured model still has an effective model from model/list.
      return { ...response, config: { ...config, model: defaultModel } } as T;
    },
    host: client.host.bind(client), subscribe: client.subscribe.bind(client), reply: client.reply.bind(client),
  };
}
function approval(value: unknown): ApprovalPolicy | undefined {
  if (value === 'untrusted' || value === 'on-request' || value === 'never') return value;
  const granular = record(record(value).granular);
  if (['sandbox_approval', 'rules', 'skill_approval', 'request_permissions', 'mcp_elicitations'].every(key => typeof granular[key] === 'boolean')) {
    return { granular: { sandbox_approval: granular.sandbox_approval === true, rules: granular.rules === true,
      skill_approval: granular.skill_approval === true, request_permissions: granular.request_permissions === true,
      mcp_elicitations: granular.mcp_elicitations === true } };
  }
  return undefined;
}
function sandbox(value: unknown): SandboxMode | undefined {
  return value === 'read-only' || value === 'workspace-write' || value === 'danger-full-access' ? value : undefined;
}
function reviewer(value: unknown): ApprovalsReviewer | undefined {
  return value === 'user' || value === 'auto_review' || value === 'guardian_subagent' ? value : undefined;
}
async function models(client: WorkbenchClient, hostId: string): Promise<Model[]> {
  const result: Model[] = [], seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const response = record(await client.rpc('model/list', { limit: 100, ...(cursor ? { cursor } : {}) }, hostId));
    if (!Array.isArray(response.data)) throw new Error('模型列表响应无效');
    for (const raw of response.data) {
      const model = record(raw);
      const value = string(model.model) ?? string(model.id);
      if (!value || model.hidden === true) continue;
      const efforts = Array.isArray(model.supportedReasoningEfforts)
        ? model.supportedReasoningEfforts.flatMap(item => string(record(item).reasoningEffort) ?? []) : [];
      result.push({ value, label: string(model.displayName) ?? value, default: model.isDefault === true,
        defaultEffort: string(model.defaultReasoningEffort) ?? null, efforts });
    }
    cursor = string(response.nextCursor) ?? null;
    if (cursor && seen.has(cursor)) throw new Error('模型列表分页重复');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return result;
}

export function StandaloneOptions({ client, hostId, cwd, threadId, busy, modelRef, value, onChange, onDefaultPendingChange }: OptionsProps) {
  const { t } = useI18n('zh-CN');
  const [available, setAvailable] = useState<Model[]>([]);
  const [defaults, setDefaults] = useState<SubmitOptions>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const defaultModels = available.filter(item => item.default);
  const defaultModel = defaultModels.length === 1 ? defaultModels[0]?.value : undefined;
  const modelClient = useMemo(() => effectiveModelClient(client, defaultModel), [client, defaultModel]);
  const modelSettings = useMemo(() => new ModelSettings(modelClient, hostId), [modelClient, hostId]);
  const homeState = useSyncExternalStore(modelSettings.subscribe, modelSettings.getSnapshot, modelSettings.getSnapshot);
  const isHome = threadId === null;
  useEffect(() => {
    if (!isHome) return;
    void modelSettings.load();
    return () => modelSettings.dispose();
  }, [isHome, modelSettings]);
  useEffect(() => {
    onDefaultPendingChange(isHome && (homeState.saving || modelSettings.dirty));
    return () => onDefaultPendingChange(false);
  }, [isHome, modelSettings, homeState, onDefaultPendingChange]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([models(client, hostId), client.rpc('config/read', { cwd, includeLayers: false }, hostId)])
      .then(([list, response]) => {
        if (!active) return;
        const config = record(record(response).config);
        const defaults = list.filter(item => item.default);
        const model = string(config.model) ?? (defaults.length === 1 ? defaults[0]?.value : undefined);
        const selected = list.find(item => item.value === model);
        setAvailable(list);
        setDefaults({ model, effort: string(config.model_reasoning_effort) ?? selected?.defaultEffort ?? null,
          approvalPolicy: approval(config.approval_policy), sandboxMode: sandbox(config.sandbox_mode),
          approvalsReviewer: reviewer(config.approvals_reviewer), permissionProfileId: string(config.default_permissions),
          serviceTier: string(config.service_tier) ?? null });
        setError('');
      }).catch(reason => { if (active) setError('无法读取模型或配置：' + String(reason instanceof Error ? reason.message : reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, hostId, cwd]);
  const configured = threadId == null ? defaults : {};
  const selectedModel = isHome ? homeState.model ?? configured.model : value.model ?? configured.model;
  const selected = available.find(item => item.value === selectedModel);
  const modelValue = isHome ? homeState.model ?? '' : value.model ?? '';
  const effortValue = isHome ? homeState.effort ?? '' : value.effort ?? '';
  const defaultUnavailable = isHome && (homeState.loading || homeState.saving || modelSettings.dirty || !!homeState.error);
  const change = (part: Partial<SubmitOptions>) => onChange(part);
  const saveDefault = (field: 'model' | 'effort', next: string) => {
    if (!next || defaultUnavailable) return;
    if (field === 'model') modelSettings.setModel(next); else modelSettings.setEffort(next);
    if (!modelSettings.dirty) return;
    onDefaultPendingChange(true);
    void modelSettings.save();
  };
  const configuredLabel = (setting: string | undefined | null) => setting ? `${t('Configured default')} (${setting})` : t('Session default');
  const approvalLabel = (policy: ApprovalPolicy | undefined) => policy && typeof policy === 'object' ? t('Custom approval') : policy;
  return <fieldset className="standalone-composer__options" disabled={busy} title={busy ? t('Queued messages use conversation settings') : undefined} aria-label={t('Conversation options')}>
    <label>{t('Model')} <select ref={modelRef} aria-label={t('Model')}
      title={modelValue ? selected?.label ?? modelValue : configuredLabel(configured.model ? selected?.label ?? configured.model : undefined)}
      value={modelValue} disabled={loading || !available.length || defaultUnavailable} onChange={event => {
      if (isHome) { saveDefault('model', event.target.value); return; }
      const model = available.find(item => item.value === (event.target.value || configured.model));
      const effort = model?.efforts.includes(value.effort ?? '') ? value.effort : model?.defaultEffort ?? model?.efforts[0] ?? null;
      change({ model: event.target.value || undefined, effort: event.target.value ? effort : undefined });
    }}>
      {!selected && modelValue ? <option value={modelValue}>{modelValue}</option> : null}
      <option value="" disabled={isHome && !!modelValue}>{loading ? t('Loading') : configuredLabel(configured.model ? selected?.label ?? configured.model : undefined)}</option>
      {available.map(model => <option key={model.value} value={model.value}>{model.label}</option>)}
    </select></label>
    <label>{t('Effort')} <select aria-label={t('Reasoning effort')} value={effortValue} disabled={loading || !selected?.efforts.length || defaultUnavailable || isHome && !homeState.model}
      onChange={event => isHome ? saveDefault('effort', event.target.value) : change({ effort: event.target.value || null })}>
      <option value="" disabled={isHome && !!effortValue}>{configuredLabel(configured.effort)}</option>
      {effortValue && !selected?.efforts.includes(effortValue) ? <option value={effortValue}>{effortValue}</option> : null}
      {selected?.efforts.map(effort => <option key={effort} value={effort}>{effort}</option>)}
    </select></label>
    <label>{t('Approval')} <select aria-label={t('Approval policy')} value={typeof value.approvalPolicy === 'object' ? '__granular__' : value.approvalPolicy ?? ''} onChange={event => change({ approvalPolicy: approval(event.target.value) })}>
      {typeof value.approvalPolicy === 'object' ? <option value="__granular__">{t('Custom approval')}</option> : null}
      <option value="">{configuredLabel(approvalLabel(configured.approvalPolicy))}</option><option value="untrusted">{t('When untrusted')}</option><option value="on-request">{t('On request')}</option><option value="never">{t('Never')}</option>
    </select></label>
    <label>{t('Sandbox')} <select aria-label={t('Sandbox permissions')} value={value.sandboxMode ?? ''} onChange={event => change({ sandboxMode: sandbox(event.target.value), permissionProfileId: undefined })}>
      <option value="">{configuredLabel(configured.sandboxMode)}</option><option value="read-only">{t('Read only')}</option><option value="workspace-write">{t('Workspace write')}</option><option value="danger-full-access">{t('Full access')}</option>
    </select></label>
    <label><input type="checkbox" checked={(value.serviceTier === undefined ? configured.serviceTier : value.serviceTier) === 'fast'} onChange={event => change({ serviceTier: event.target.checked ? 'fast' : null })} />{t('Fast')}</label>
    <label><input type="checkbox" checked={value.mode === 'plan'} onChange={event => change({ mode: event.target.checked ? 'plan' : 'default' })} />{t('Plan')}</label>
    {error ? <span role="alert">{error}</span> : null}
    {isHome && (modelSettings.dirty || homeState.error) ? <div className="standalone-composer__model-save" role="status">
      {homeState.error || homeState.writeError ? <span role="alert">{homeState.error ?? homeState.writeError}</span> : null}
      {homeState.conflicts.map(field => <div key={field}>
        <span>{t('Default setting changed elsewhere:')} {field === 'model' ? t('Model') : t('Reasoning effort')} ({t('Current value')}: {field === 'model' ? homeState.savedModel : homeState.savedEffort}; {t('Your change')}: {field === 'model' ? homeState.model : homeState.effort})</span>
        <button type="button" onClick={() => modelSettings.resolveConflict(field, 'current')}>{t('Use current value')}</button>
        <button type="button" onClick={() => modelSettings.resolveConflict(field, 'draft')}>{t('Keep my change')}</button>
      </div>)}
      <button type="button" disabled={homeState.saving || homeState.loading} onClick={() => void modelSettings.load()}>{t('Reload default settings')}</button>
      {modelSettings.dirty && <><button type="button" disabled={homeState.saving || homeState.loading || !!homeState.error || !!homeState.writeError || !!homeState.conflicts.length}
        onClick={() => void modelSettings.save()}>{t('Save default change')}</button>
      <button type="button" disabled={homeState.saving || homeState.loading} onClick={() => modelSettings.discard()}>{t('Discard change')}</button></>}
    </div> : null}
    {isHome && homeState.warning ? <span role="status">{homeState.warning}</span> : null}
  </fieldset>;
}
