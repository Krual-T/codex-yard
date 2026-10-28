import { useEffect, useState } from 'react';
import type { Ref } from 'react';
import type { SubmitOptions, WorkbenchClient } from '../workbench-contract.ts';
import { useI18n } from '../i18n/index.tsx';
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
}
function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function string(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
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

export function StandaloneOptions({ client, hostId, cwd, threadId, busy, modelRef, value, onChange }: OptionsProps) {
  const { t } = useI18n('zh-CN');
  const [available, setAvailable] = useState<Model[]>([]);
  const [defaults, setDefaults] = useState<SubmitOptions>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([models(client, hostId), client.rpc('config/read', { cwd, includeLayers: false }, hostId)])
      .then(([list, response]) => {
        if (!active) return;
        const config = record(record(response).config);
        const model = string(config.model) ?? list.find(item => item.default)?.value ?? list[0]?.value;
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
  const selected = available.find(item => item.value === (value.model ?? configured.model));
  const change = (part: Partial<SubmitOptions>) => onChange(part);
  const configuredLabel = (setting: string | undefined | null) => setting ? `${t('Configured default')} (${setting})` : t('Session default');
  const approvalLabel = (policy: ApprovalPolicy | undefined) => policy && typeof policy === 'object' ? t('Custom approval') : policy;
  return <fieldset className="standalone-composer__options" disabled={busy} title={busy ? t('Queued messages use conversation settings') : undefined} aria-label={t('Conversation options')}>
    <label>{t('Model')} <select ref={modelRef} aria-label={t('Model')}
      title={value.model ? selected?.label ?? value.model : configuredLabel(configured.model ? selected?.label ?? configured.model : undefined)}
      value={value.model ?? ''} disabled={loading || !available.length} onChange={event => {
      const model = available.find(item => item.value === (event.target.value || configured.model));
      const effort = model?.efforts.includes(value.effort ?? '') ? value.effort : model?.defaultEffort ?? model?.efforts[0] ?? null;
      change({ model: event.target.value || undefined, effort: event.target.value ? effort : undefined });
    }}>
      {!selected && value.model ? <option value={value.model}>{value.model}</option> : null}
      <option value="">{loading ? t('Loading') : configuredLabel(configured.model ? selected?.label ?? configured.model : undefined)}</option>
      {available.map(model => <option key={model.value} value={model.value}>{model.label}</option>)}
    </select></label>
    <label>{t('Effort')} <select aria-label={t('Reasoning effort')} value={value.effort ?? ''} disabled={loading || !selected?.efforts.length}
      onChange={event => change({ effort: event.target.value || null })}>
      <option value="">{configuredLabel(configured.effort)}</option>
      {value.effort && !selected?.efforts.includes(value.effort) ? <option value={value.effort}>{value.effort}</option> : null}
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
  </fieldset>;
}
