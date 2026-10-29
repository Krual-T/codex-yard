import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Ref } from 'react';
import { ChevronDown, Folder, Globe, Shield, Terminal } from 'lucide-react';
import { positionComposerMenu } from './composer-menu-position.ts';
import type { SubmitOptions, WorkbenchClient } from '../workbench-contract.ts';
import { useI18n } from '../i18n/index.tsx';
import { ModelSettings } from '../settings/model-settings.ts';
import { isCyberModel, loadComposerPermissions } from './composer-permissions.ts';
import type { ComposerPermissionChoice } from './composer-permissions.ts';
import type { ApprovalPolicy, ApprovalsReviewer, SandboxMode } from '../../../lib/codex-protocol.ts';

interface Model { value: string; label: string; default: boolean; defaultEffort: string | null; efforts: string[] }
interface OptionsProps {
  client: WorkbenchClient;
  hostId: string;
  cwd: string;
  threadId: string | null;
  projectless: boolean;
  busy: boolean;
  modelRef: Ref<HTMLButtonElement>;
  value: SubmitOptions;
  inherited?: SubmitOptions;
  fullAccessVisible?: boolean;
  onChange(patch: Partial<SubmitOptions>): void;
  onDefaultPendingChange(pending: boolean): void;
  onEffectiveOptionsChange?(options: SubmitOptions): void;
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

export function StandaloneOptions({ client, hostId, cwd, threadId, projectless, busy, modelRef, value, inherited, fullAccessVisible = true, onChange, onDefaultPendingChange, onEffectiveOptionsChange }: OptionsProps) {
  const { t, locale } = useI18n('zh-CN');
  const [available, setAvailable] = useState<Model[]>([]);
  const [defaults, setDefaults] = useState<SubmitOptions>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [defaultWritePending, setDefaultWritePending] = useState(false);
  const [permissionChoices, setPermissionChoices] = useState<ComposerPermissionChoice[]>([]);
  const [permissionLoading, setPermissionLoading] = useState(false);
  const [permissionError, setPermissionError] = useState('');
  const [confirmFullAccess, setConfirmFullAccess] = useState<ComposerPermissionChoice | null>(null);
  const confirmCancel = useRef<HTMLButtonElement>(null);
  const confirmationId = useId();
  const accessMenu = useRef<HTMLDetailsElement>(null);
  const permissionSequence = useRef(0);
  const permissionMounted = useRef(true);
  const modelSettings = useMemo(() => new ModelSettings(client, hostId), [client, hostId]);
  const homeState = useSyncExternalStore(modelSettings.subscribe, modelSettings.getSnapshot, modelSettings.getSnapshot);
  const isHome = threadId === null;
  const configSource = useMemo(() => ({ client, hostId, cwd, model: isHome ? homeState.savedModel : null,
    effort: isHome ? homeState.savedEffort : null }), [client, hostId, cwd, isHome, homeState.savedModel, homeState.savedEffort]);
  const [loadedConfigSource, setLoadedConfigSource] = useState<typeof configSource | null>(null);
  useEffect(() => {
    if (!isHome) return;
    void modelSettings.load();
    return () => modelSettings.dispose();
  }, [isHome, modelSettings]);
  useEffect(() => {
    onDefaultPendingChange(isHome && (homeState.saving || modelSettings.dirty || defaultWritePending));
    return () => onDefaultPendingChange(false);
  }, [isHome, modelSettings, homeState, defaultWritePending, onDefaultPendingChange]);
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
        setLoadedConfigSource(configSource);
        setError('');
      }).catch(reason => { if (active) setError('无法读取模型或配置：' + String(reason instanceof Error ? reason.message : reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [configSource]);
  const configured = threadId == null ? defaults : {};
  const fallback = isHome ? configured : inherited ?? {};
  const effective: SubmitOptions = { ...fallback, ...value };
  if (effective.model === undefined) effective.model = fallback.model;
  if (effective.effort === undefined) effective.effort = fallback.effort;
  if (effective.approvalPolicy === undefined) effective.approvalPolicy = fallback.approvalPolicy;
  if (effective.approvalsReviewer === undefined) effective.approvalsReviewer = fallback.approvalsReviewer;
  if (effective.serviceTier === undefined) effective.serviceTier = fallback.serviceTier;
  if (effective.sandboxMode === undefined && !effective.permissionProfileId) effective.sandboxMode = fallback.sandboxMode;
  if (effective.permissionProfileId) effective.sandboxMode = undefined;
  const effectiveKey = JSON.stringify(effective);
  useEffect(() => {
    if (loading || loadedConfigSource !== configSource || error || isHome && (homeState.loading || homeState.saving || modelSettings.dirty || defaultWritePending || !!homeState.error)) return;
    onEffectiveOptionsChange?.(effective);
  }, [effectiveKey, loading, loadedConfigSource, configSource, error, isHome, homeState.loading, homeState.saving, homeState.error, modelSettings.dirty, defaultWritePending, onEffectiveOptionsChange]);
  const selectedModel = isHome ? homeState.model ?? configured.model : value.model ?? configured.model;
  const selected = available.find(item => item.value === selectedModel);
  const modelValue = isHome ? homeState.model ?? configured.model ?? '' : value.model ?? '';
  const effortValue = isHome ? homeState.effort ?? '' : value.effort ?? '';
  const defaultUnavailable = isHome && (homeState.loading || homeState.saving || modelSettings.dirty || !!homeState.error);
  const change = (part: Partial<SubmitOptions>) => onChange(part);
  const latestDefault = useRef({ client, hostId, cwd, threadId, value, onChange });
  latestDefault.current = { client, hostId, cwd, threadId, value, onChange };
  const pendingDefault = useRef<{ client: WorkbenchClient; hostId: string; cwd: string; threadId: string | null;
    changes: { field: 'model' | 'effort'; expected: string | null; previous: string | null | undefined }[] } | null>(null);
  useEffect(() => {
    const pending = pendingDefault.current, current = latestDefault.current;
    if (!pending || homeState.loading || homeState.saving || modelSettings.dirty || homeState.error || defaultWritePending) return;
    pendingDefault.current = null;
    if (pending.client !== current.client || pending.hostId !== current.hostId || pending.cwd !== current.cwd || pending.threadId !== current.threadId) return;
    const patch: Partial<SubmitOptions> = {};
    for (const item of pending.changes) {
      const saved = item.field === 'model' ? homeState.savedModel : homeState.savedEffort;
      if (saved !== item.expected || current.value[item.field] !== item.previous) continue;
      if (item.field === 'model') patch.model = undefined; else patch.effort = undefined;
    }
    if (Object.keys(patch).length) current.onChange(patch);
  }, [homeState, modelSettings, defaultWritePending]);
  const persistDefault = () => {
    const snapshot = modelSettings.getSnapshot();
    const changes: { field: 'model' | 'effort'; expected: string | null; previous: string | null | undefined }[] = [];
    if (snapshot.model !== snapshot.savedModel && value.model !== undefined) changes.push({ field: 'model', expected: snapshot.model, previous: value.model });
    if (snapshot.effort !== snapshot.savedEffort && value.effort !== undefined) changes.push({ field: 'effort', expected: snapshot.effort, previous: value.effort });
    pendingDefault.current = { client, hostId, cwd, threadId, changes };
    setDefaultWritePending(true);
    void modelSettings.save().finally(() => { if (permissionMounted.current) setDefaultWritePending(false); });
  };
  const permissionSourceKey = JSON.stringify([hostId, cwd, threadId, projectless, effective, inherited, fullAccessVisible, busy, defaultUnavailable]);
  const permissionSource = useRef({ key: permissionSourceKey, client, hostId, cwd, model: effective.model, effective, projectless, fullAccessVisible, inherited: isHome ? undefined : inherited ?? {} });
  permissionSource.current = { key: permissionSourceKey, client, hostId, cwd, model: effective.model, effective, projectless, fullAccessVisible, inherited: isHome ? undefined : inherited ?? {} };
  useEffect(() => {
    permissionMounted.current = true;
    return () => { permissionMounted.current = false; permissionSequence.current++; };
  }, []);
  useEffect(() => { if (confirmFullAccess) confirmCancel.current?.focus(); }, [confirmFullAccess]);
  const closeConfirmation = () => {
    setConfirmFullAccess(null);
    requestAnimationFrame(() => accessMenu.current?.querySelector<HTMLElement>(':scope > summary')?.focus());
  };
  useEffect(() => { if (!fullAccessVisible && confirmFullAccess) closeConfirmation(); }, [fullAccessVisible, confirmFullAccess]);
  useLayoutEffect(() => { if (accessMenu.current?.open) positionComposerMenu(accessMenu.current); }, [permissionChoices, permissionLoading, permissionError, fullAccessVisible]);
  const readPermissions = async (choice?: ComposerPermissionChoice) => {
    const source = permissionSource.current;
    const sequence = ++permissionSequence.current;
    setPermissionLoading(true); setPermissionError('');
    try {
      const choices = await loadComposerPermissions(source.client, source.hostId, source.cwd, source.model, source.effective, source.projectless, source.inherited);
      if (!permissionMounted.current || sequence !== permissionSequence.current) return;
      if (permissionSource.current.key !== source.key || permissionSource.current.client !== source.client) throw new Error('The conversation or permissions changed; review the choices again.');
      setPermissionChoices(choices);
      if (choice) {
        const current = choices.find(item => item.id === choice.id);
        if (choice.fullAccess && !source.fullAccessVisible) throw new Error('Full access is not available in this menu.');
        if (choice.fullAccess && !source.model) throw new Error('The current model is not confirmed; reload the conversation before changing access.');
        if (!current?.allowed || current.fullAccess !== choice.fullAccess || current.resolved !== choice.resolved
          || JSON.stringify(current.patch) !== JSON.stringify(choice.patch)) throw new Error('This permission choice changed or is no longer allowed.');
        change(current.patch);
        if (choice.fullAccess) closeConfirmation();
      }
    } catch (reason) {
      if (permissionMounted.current && sequence === permissionSequence.current) {
        setPermissionChoices([]);
        setPermissionError(String(reason instanceof Error ? reason.message : reason));
      }
    } finally {
      if (permissionMounted.current && sequence === permissionSequence.current) setPermissionLoading(false);
    }
  };
  const saveDefault = (field: 'model' | 'effort', next: string) => {
    if (!next || defaultUnavailable) return;
    if (field === 'model') modelSettings.setModel(next); else modelSettings.setEffort(next);
    if (!modelSettings.dirty) {
      if (value[field] !== undefined) change(field === 'model' ? { model: undefined } : { effort: undefined });
      return;
    }
    onDefaultPendingChange(true);
    persistDefault();
  };
  const configuredLabel = (setting: string | undefined | null) => setting ? `${t('Configured default')} (${setting})` : t('Session default');
  const approvalLabel = (policy: ApprovalPolicy | undefined) => policy && typeof policy === 'object' ? t('Custom approval') : policy;
  const selectedSandbox = value.sandboxMode ?? configured.sandboxMode;
  const selectedApproval = value.approvalPolicy ?? configured.approvalPolicy;
  const selectedProfile = Object.hasOwn(value, 'permissionProfileId') ? value.permissionProfileId : configured.permissionProfileId;
  const accessLabel = selectedProfile === ':danger-full-access' ? t('Full access')
    : selectedProfile === ':workspace' || selectedProfile === ':read-only' ? (effective.approvalsReviewer === 'auto_review' || effective.approvalsReviewer === 'guardian_subagent'
      ? (locale.toLowerCase().startsWith('zh') ? '自动审查' : 'Automatic review') : (locale.toLowerCase().startsWith('zh') ? '请求审批' : 'Ask for approval'))
    : selectedProfile || (selectedSandbox === 'danger-full-access' ? selectedApproval === 'never' ? t('Full access') : t('Sandbox') + ': ' + t('Full access')
    : selectedSandbox === 'workspace-write' ? t('Workspace write')
    : selectedSandbox === 'read-only' ? t('Read only') : t('Session default'));
  const effectiveEffort = effortValue || configured.effort;
  const effortLabel = effectiveEffort && locale.toLowerCase().startsWith('en')
    ? effectiveEffort[0]!.toUpperCase() + effectiveEffort.slice(1) : effectiveEffort;
  const effortChoices = selected?.efforts ?? [];
  const effortIndex = Math.max(0, effortChoices.indexOf(effectiveEffort ?? selected?.defaultEffort ?? ''));
  const modelLabel = selected?.label ?? modelValue ?? configured.model ?? t('Model');
  const modelUnavailable = busy || loading || !available.length || defaultUnavailable;
  const chooseModel = (next: string) => {
    if (modelUnavailable) return;
    if (isHome) { saveDefault('model', next); return; }
    const model = available.find(item => item.value === (next || configured.model));
    const effort = model?.efforts.includes(value.effort ?? '') ? value.effort : model?.defaultEffort ?? model?.efforts[0] ?? null;
    change({ model: next || undefined, effort: next ? effort : undefined });
  };
  return <div className="standalone-composer__options" role="group" title={busy ? t('Queued messages use conversation settings') : undefined} aria-label={t('Conversation options')}>
    <details ref={accessMenu} className="standalone-composer__menu standalone-composer__access" data-danger={selectedProfile === ':danger-full-access' || !selectedProfile && selectedSandbox === 'danger-full-access' || undefined} onToggle={event => {
      if (event.target !== event.currentTarget) return;
      positionComposerMenu(event.currentTarget);
      if (event.currentTarget.open) void readPermissions();
    }}>
      <summary aria-label={t('Approval') + ': ' + accessLabel} aria-disabled={busy} onClick={event => { if (busy) event.preventDefault(); }}>
        <Shield size={16} aria-hidden="true" /><span>{accessLabel}</span>
      </summary>
      <div className="standalone-composer__menu-panel">
        <strong>{locale.toLowerCase().startsWith('zh') ? '如何批准 Codex 操作？' : 'How should Codex actions be approved?'}</strong>
        {permissionChoices.filter(choice => !choice.id.startsWith('sandbox:') && !choice.id.startsWith('policy:') && (fullAccessVisible || !choice.fullAccess)).map(choice => <button type="button" className="standalone-composer__permission-choice" key={choice.id}
          disabled={busy || defaultUnavailable || !choice.allowed || choice.fullAccess && !effective.model} aria-disabled={permissionLoading || undefined}
          title={choice.fullAccess && !effective.model ? 'The current model is not confirmed.' : choice.reason}
          onClick={() => { if (!permissionLoading) choice.fullAccess ? setConfirmFullAccess(choice) : void readPermissions(choice); }}>
          <span>{locale.toLowerCase().startsWith('zh') ? ({ ask: '请求审批', guardian: '自动审查', 'full-access': '完全访问', config: '自定义（config.toml）' } as Record<string, string>)[choice.id] ?? choice.label : choice.label}</span>
          <small>{locale.toLowerCase().startsWith('zh') ? ({
            'Read only until approved': '获得批准前保持只读', 'Ask before actions outside the workspace': '访问工作区外的文件或网络前请求批准',
            'Review additional permission requests automatically': '自动审查额外权限请求',
            'Access files and the internet without approval': '无需批准即可访问文件和互联网', 'Use the current directory configuration': '使用当前目录的权限配置',
          } as Record<string, string>)[choice.description] ?? choice.description : choice.description}</small>
          {!choice.allowed && choice.reason ? <small>{locale.toLowerCase().startsWith('zh') ? ({
            'Additional filesystem or network rules cannot be preserved by this composer.': '此输入区无法保留额外文件系统或网络规则。',
            'Restricted by permission requirements.': '受权限要求限制。', 'Automatic review is required for this model.': '此模型要求自动审查。',
          } as Record<string, string>)[choice.reason] ?? choice.reason : choice.reason}</small> : null}
        </button>)}
        {permissionLoading ? <span role="status">{t('Loading')}</span> : null}
        {permissionError ? <span role="alert">{permissionError} <button type="button" disabled={permissionLoading} onClick={() => void readPermissions()}>{t('Retry')}</button></span> : null}
        {permissionChoices.length ? <details onToggle={() => { if (accessMenu.current) positionComposerMenu(accessMenu.current); }}><summary>{locale.toLowerCase().startsWith('zh') ? '其他权限设置' : 'Other permission settings'}</summary>
          <label>{t('Approval')} <select aria-label={t('Approval policy')} disabled={busy || defaultUnavailable} aria-busy={permissionLoading || undefined}
            value={typeof value.approvalPolicy === 'object' ? '__granular__' : value.approvalPolicy ?? ''} onChange={event => {
              if (permissionLoading) return;
              const choice = permissionChoices.find(item => item.id === 'policy:' + (event.currentTarget.value || 'default'));
              if (choice?.allowed && (fullAccessVisible || !choice.fullAccess)) choice.fullAccess ? setConfirmFullAccess(choice) : void readPermissions(choice);
            }}>
            {typeof value.approvalPolicy === 'object' ? <option value="__granular__">{t('Custom approval')}</option> : null}
            <option value="" hidden={!fullAccessVisible && permissionChoices.find(choice => choice.id === 'policy:default')?.fullAccess} disabled={!permissionChoices.find(choice => choice.id === 'policy:default')?.allowed || !!permissionChoices.find(choice => choice.id === 'policy:default')?.fullAccess && !effective.model}>{configuredLabel(approvalLabel(configured.approvalPolicy))}</option>
            {!fullAccessVisible && value.approvalPolicy === 'never' && permissionChoices.find(choice => choice.id === 'policy:never')?.fullAccess ? <option value="never" hidden disabled>never</option> : null}
            {permissionChoices.filter(choice => choice.id.startsWith('policy:') && choice.id !== 'policy:default' && (fullAccessVisible || !choice.fullAccess)).map(choice => <option key={choice.id} value={choice.label} disabled={!choice.allowed || choice.fullAccess && !effective.model}>{choice.label}</option>)}
          </select></label>
          <label>{t('Sandbox')} <select aria-label={t('Sandbox permissions')} disabled={busy || defaultUnavailable} aria-busy={permissionLoading || undefined}
            value={value.sandboxMode ?? ''} onChange={event => {
              if (permissionLoading) return;
              const choice = permissionChoices.find(item => item.id === 'sandbox:' + (event.currentTarget.value || 'default'));
              if (choice?.allowed && (fullAccessVisible || !choice.fullAccess)) choice.fullAccess ? setConfirmFullAccess(choice) : void readPermissions(choice);
            }}>
            <option value="" hidden={!fullAccessVisible && permissionChoices.find(choice => choice.id === 'sandbox:default')?.fullAccess} disabled={!permissionChoices.find(choice => choice.id === 'sandbox:default')?.allowed || !!permissionChoices.find(choice => choice.id === 'sandbox:default')?.fullAccess && !effective.model}>{configuredLabel(configured.sandboxMode)}</option>
            {!fullAccessVisible && value.sandboxMode === 'danger-full-access' ? <option value="danger-full-access" hidden disabled>danger-full-access</option> : null}
            {permissionChoices.filter(choice => choice.id.startsWith('sandbox:') && choice.id !== 'sandbox:default' && (fullAccessVisible || !choice.fullAccess)).map(choice => <option key={choice.id} value={choice.label} disabled={!choice.allowed || choice.fullAccess && !effective.model}>{choice.label}</option>)}
          </select></label>
        </details> : null}
      </div>
    </details>
    {confirmFullAccess && fullAccessVisible ? <div className="standalone-composer__confirm-backdrop" role="presentation">
      <div className="standalone-composer__confirm" role="dialog" aria-modal="true" aria-labelledby={confirmationId}
        onKeyDown={event => {
          if (event.key === 'Escape' && !event.nativeEvent.isComposing && !permissionLoading) { event.stopPropagation(); closeConfirmation(); }
          if (event.key === 'Tab') {
            const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
            if (!buttons.length) return;
            if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
            else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
          }
        }}>
        <h2 id={confirmationId}>{effective.model && isCyberModel(effective.model)
          ? (locale.toLowerCase().startsWith('zh') ? '为网络安全模型开启完全访问？' : 'Enable Full Access for Cyber model?')
          : (locale.toLowerCase().startsWith('zh') ? '开启完全访问？' : 'Turn on Full Access?')}</h2>
        {effective.model && isCyberModel(effective.model) ? <p className="standalone-composer__confirm-risk">{locale.toLowerCase().startsWith('zh')
          ? '网络安全模型执行危险操作的风险更高。授予完全访问权限前，请确保已有适当的防护措施。'
          : 'Cyber models carry a higher risk of dangerous actions. Ensure proper safeguards are in place before granting full access.'}</p> : null}
        <p>{locale.toLowerCase().startsWith('zh') ? 'Codex 可以运行命令、使用互联网，并在此电脑的任何位置创建和编辑文件，无需您的许可。这包括但不限于：' : 'Codex will be able to run commands, use the internet, and create and edit files anywhere on this computer without your permission. This includes but is not limited to:'}</p>
        <ul className="standalone-composer__confirm-capabilities">
          <li><Folder size={20} aria-hidden="true" /><span><strong>{locale.toLowerCase().startsWith('zh') ? '文件和文件夹' : 'Files and folders'}</strong><small>{locale.toLowerCase().startsWith('zh') ? '读取、创建、修改、上传或删除此电脑上任何位置的文件' : 'Read, create, modify, upload, or delete files anywhere on this computer'}</small></span></li>
          <li><Terminal size={20} aria-hidden="true" /><span><strong>{locale.toLowerCase().startsWith('zh') ? '终端命令' : 'Terminal commands'}</strong><small>{locale.toLowerCase().startsWith('zh') ? '运行命令、安装软件和更改系统设置' : 'Run commands, install software, and change system settings'}</small></span></li>
          <li><Globe size={20} aria-hidden="true" /><span><strong>{locale.toLowerCase().startsWith('zh') ? '互联网和已连接应用' : 'Internet and connected apps'}</strong><small>{locale.toLowerCase().startsWith('zh') ? '访问网站、发送数据和使用已启用的插件' : 'Access websites, send data, and use enabled plugins'}</small></span></li>
        </ul>
        {permissionError ? <p role="alert">{permissionError}</p> : null}
        <div><button ref={confirmCancel} type="button" disabled={permissionLoading} onClick={closeConfirmation}>{t('Cancel')}</button>
          <button type="button" disabled={busy || defaultUnavailable || permissionLoading} onClick={() => void readPermissions(confirmFullAccess)}>{locale.toLowerCase().startsWith('zh') ? '确认' : 'Confirm'}</button></div>
      </div>
    </div> : null}
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
        <div className="standalone-composer__model-list" role="group" aria-label={t('Model')}>
          {!selected && modelValue ? <button type="button" disabled aria-pressed="true">{modelValue}</button> : null}
          {!isHome ? <button type="button" aria-pressed={!modelValue} disabled={modelUnavailable}
            onClick={() => chooseModel('')}>{configuredLabel(configured.model ? selected?.label ?? configured.model : undefined)}</button> : null}
          {available.map((model, index) => <button type="button" key={model.value}
            ref={model.value === selectedModel || !selected && index === 0 ? modelRef : undefined}
            data-model={model.value}
            aria-label={`${t('Model')}: ${model.label}`} aria-pressed={model.value === selectedModel}
            disabled={modelUnavailable} onClick={() => chooseModel(model.value)}>{model.label}</button>)}
          {loading ? <span>{t('Loading')}</span> : null}
        </div></details>
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
        onClick={persistDefault}>{t('Save default change')}</button>
      <button type="button" disabled={busy || homeState.saving || homeState.loading} onClick={() => modelSettings.discard()}>{t('Discard change')}</button></>}
    </div> : null}
    {isHome && homeState.warning ? <span className="standalone-composer__options-status" role="status">{homeState.warning}</span> : null}
  </div>;
}
