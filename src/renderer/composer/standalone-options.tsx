import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Ref } from 'react';
import { ChevronDown, Shield } from 'lucide-react';
import { positionComposerMenu } from './composer-menu-position.ts';
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
  const { t, locale } = useI18n('zh-CN');
  const [available, setAvailable] = useState<Model[]>([]);
  const [defaults, setDefaults] = useState<SubmitOptions>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const modelSettings = useMemo(() => new ModelSettings(client, hostId), [client, hostId]);
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
  const modelValue = isHome ? homeState.model ?? configured.model ?? '' : value.model ?? '';
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
  const selectedSandbox = value.sandboxMode ?? configured.sandboxMode;
  const selectedApproval = value.approvalPolicy ?? configured.approvalPolicy;
  const selectedProfile = Object.hasOwn(value, 'permissionProfileId') ? value.permissionProfileId : configured.permissionProfileId;
  const accessLabel = selectedProfile || (selectedSandbox === 'danger-full-access' ? selectedApproval === 'never' ? t('Full access') : t('Sandbox') + ': ' + t('Full access')
    : selectedSandbox === 'workspace-write' ? t('Workspace write')
    : selectedSandbox === 'read-only' ? t('Read only') : t('Session default'));
  const effectiveEffort = effortValue || configured.effort;
  const effortLabel = effectiveEffort && locale.toLowerCase().startsWith('en')
    ? effectiveEffort[0]!.toUpperCase() + effectiveEffort.slice(1) : effectiveEffort;
  const effortChoices = selected?.efforts ?? [];
  const effortIndex = Math.max(0, effortChoices.indexOf(effectiveEffort ?? selected?.defaultEffort ?? ''));
  const modelLabel = selected?.label ?? modelValue ?? configured.model ?? t('Model');
  return <div className="standalone-composer__options" role="group" title={busy ? t('Queued messages use conversation settings') : undefined} aria-label={t('Conversation options')}>
    <details className="standalone-composer__menu standalone-composer__access" data-danger={!selectedProfile && selectedSandbox === 'danger-full-access' || undefined} onToggle={event => positionComposerMenu(event.currentTarget)}>
      <summary aria-label={t('Approval') + ': ' + accessLabel} aria-disabled={busy} onClick={event => { if (busy) event.preventDefault(); }}>
        <Shield size={16} aria-hidden="true" /><span>{accessLabel}</span>
      </summary>
      <div className="standalone-composer__menu-panel">
        <label>{t('Approval')} <select aria-label={t('Approval policy')} disabled={busy} value={typeof value.approvalPolicy === 'object' ? '__granular__' : value.approvalPolicy ?? ''} onChange={event => change({ approvalPolicy: approval(event.target.value) })}>
          {typeof value.approvalPolicy === 'object' ? <option value="__granular__">{t('Custom approval')}</option> : null}
          <option value="">{configuredLabel(approvalLabel(configured.approvalPolicy))}</option><option value="untrusted">{t('When untrusted')}</option><option value="on-request">{t('On request')}</option><option value="never">{t('Never')}</option>
        </select></label>
        <label>{t('Sandbox')} <select aria-label={t('Sandbox permissions')} disabled={busy} value={value.sandboxMode ?? ''} onChange={event => change({ sandboxMode: sandbox(event.target.value), permissionProfileId: undefined })}>
          <option value="">{configuredLabel(configured.sandboxMode)}</option><option value="read-only">{t('Read only')}</option><option value="workspace-write">{t('Workspace write')}</option><option value="danger-full-access">{t('Full access')}</option>
        </select></label>
      </div>
    </details>
    <details className="standalone-composer__menu standalone-composer__model" onToggle={event => positionComposerMenu(event.currentTarget)}>
      <summary title={t('Select model')}>
        <span>{modelLabel || t('Model')}{effortLabel ? ' ' + effortLabel : ''}</span><ChevronDown size={13} aria-hidden="true" />
      </summary>
      <div className="standalone-composer__menu-panel standalone-composer__menu-panel--right">
        <div className="standalone-composer__power-label">{effortLabel || t('Session default')}</div>
        <details className="standalone-composer__model-choices" onToggle={event => {
          const menu = event.currentTarget.closest<HTMLDetailsElement>('.standalone-composer__model');
          if (menu) positionComposerMenu(menu);
        }}><summary><span>{t('Select model')}</span><span>{modelLabel || t('Model')}</span><ChevronDown size={13} aria-hidden="true" /></summary>
        <label>{t('Model')} <select ref={modelRef} aria-label={t('Model')}
          title={modelValue ? selected?.label ?? modelValue : configuredLabel(configured.model ? selected?.label ?? configured.model : undefined)}
          value={modelValue} disabled={busy || loading || !available.length || defaultUnavailable} onChange={event => {
            if (isHome) { saveDefault('model', event.target.value); return; }
            const model = available.find(item => item.value === (event.target.value || configured.model));
            const effort = model?.efforts.includes(value.effort ?? '') ? value.effort : model?.defaultEffort ?? model?.efforts[0] ?? null;
            change({ model: event.target.value || undefined, effort: event.target.value ? effort : undefined });
          }}>
          {!selected && modelValue ? <option value={modelValue}>{modelValue}</option> : null}
          <option value="" disabled={isHome && !!modelValue}>{loading ? t('Loading') : configuredLabel(configured.model ? selected?.label ?? configured.model : undefined)}</option>
          {available.map(model => <option key={model.value} value={model.value}>{model.label}</option>)}
        </select></label></details>
        <input className="standalone-composer__power" type="range" aria-label={t('Effort')}
          aria-valuetext={effortLabel || t('Session default')} min={0} max={Math.max(0, effortChoices.length - 1)} step={1}
          value={effortIndex} disabled={busy || loading || effortChoices.length < 2 || defaultUnavailable} onChange={event => {
            const next = effortChoices[event.currentTarget.valueAsNumber];
            if (next) isHome ? saveDefault('effort', next) : change({ effort: next });
          }} />
        <details className="standalone-composer__model-advanced"><summary>{t('Conversation options')}</summary>
          <label>{t('Effort')} <select aria-label={t('Reasoning effort')} value={effortValue} disabled={busy || loading || !selected?.efforts.length || defaultUnavailable}
            onChange={event => isHome ? saveDefault('effort', event.target.value) : change({ effort: event.target.value || null })}>
            <option value="" disabled={isHome && !!effortValue}>{configuredLabel(configured.effort)}</option>
            {effortValue && !selected?.efforts.includes(effortValue) ? <option value={effortValue}>{effortValue}</option> : null}
            {selected?.efforts.map(effort => <option key={effort} value={effort}>{effort}</option>)}
          </select></label>
          <label><input type="checkbox" disabled={busy} checked={(value.serviceTier === undefined ? configured.serviceTier : value.serviceTier) === 'fast'} onChange={event => change({ serviceTier: event.target.checked ? 'fast' : null })} />{t('Fast')}</label>
        </details>
      </div>
    </details>
    {error ? <span className="standalone-composer__options-status" role="alert">{error}</span> : null}
    {isHome && (modelSettings.dirty || homeState.error) ? <div className="standalone-composer__model-save" role="status">
      {homeState.error || homeState.writeError ? <span role="alert">{homeState.error ?? homeState.writeError}</span> : null}
      {homeState.conflicts.map(field => <div key={field}>
        <span>{t('Default setting changed elsewhere:')} {field === 'model' ? t('Model') : t('Reasoning effort')} ({t('Current value')}: {field === 'model' ? homeState.savedModel : homeState.savedEffort}; {t('Your change')}: {field === 'model' ? homeState.model : homeState.effort})</span>
        <button type="button" disabled={busy} onClick={() => modelSettings.resolveConflict(field, 'current')}>{t('Use current value')}</button>
        <button type="button" disabled={busy} onClick={() => modelSettings.resolveConflict(field, 'draft')}>{t('Keep my change')}</button>
      </div>)}
      <button type="button" disabled={busy || homeState.saving || homeState.loading} onClick={() => void modelSettings.load()}>{t('Reload default settings')}</button>
      {modelSettings.dirty && <><button type="button" disabled={busy || homeState.saving || homeState.loading || !!homeState.error || !!homeState.writeError || !!homeState.conflicts.length}
        onClick={() => void modelSettings.save()}>{t('Save default change')}</button>
      <button type="button" disabled={busy || homeState.saving || homeState.loading} onClick={() => modelSettings.discard()}>{t('Discard change')}</button></>}
    </div> : null}
    {isHome && homeState.warning ? <span className="standalone-composer__options-status" role="status">{homeState.warning}</span> : null}
  </div>;
}
