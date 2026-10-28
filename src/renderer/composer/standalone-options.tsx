import { useEffect, useState } from 'react';
import type { SubmitOptions, WorkbenchClient } from '../workbench-contract.ts';

interface Model { value: string; label: string; default: boolean; defaultEffort: string | null; efforts: string[] }
interface OptionsProps {
  client: WorkbenchClient;
  hostId: string;
  cwd: string;
  threadId: string | null;
  busy: boolean;
  value: SubmitOptions;
  onChange(value: SubmitOptions): void;
}
function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function string(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
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

export function StandaloneOptions({ client, hostId, cwd, threadId, busy, value, onChange }: OptionsProps) {
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
          approvalPolicy: string(config.approval_policy), sandboxMode: string(config.sandbox_mode),
          serviceTier: string(config.service_tier) ?? null });
        setError('');
      }).catch(reason => { if (active) setError('无法读取模型或配置：' + String(reason instanceof Error ? reason.message : reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, hostId, cwd]);
  const configured = threadId == null ? defaults : {};
  const selected = available.find(item => item.value === (value.model ?? configured.model));
  const change = (part: Partial<SubmitOptions>) => onChange({ ...value, ...part });
  return <fieldset className="standalone-composer__options" disabled={busy} title={busy ? '排队消息使用会话设置' : undefined} aria-label="会话选项">
    <label>模型 <select aria-label="模型" value={value.model ?? ''} disabled={loading || !available.length} onChange={event => {
      const model = available.find(item => item.value === (event.target.value || configured.model));
      const effort = model?.efforts.includes(value.effort ?? '') ? value.effort : model?.defaultEffort ?? model?.efforts[0] ?? null;
      change({ model: event.target.value || undefined, effort: event.target.value ? effort : undefined });
    }}>
      {!selected && value.model ? <option value={value.model}>{value.model}</option> : null}
      <option value="">{loading ? '加载中' : configured.model ? '配置默认 (' + (selected?.label ?? configured.model) + ')' : '会话默认'}</option>
      {available.map(model => <option key={model.value} value={model.value}>{model.label}</option>)}
    </select></label>
    <label>强度 <select aria-label="推理强度" value={value.effort ?? ''} disabled={loading || !selected?.efforts.length}
      onChange={event => change({ effort: event.target.value || null })}>
      <option value="">{configured.effort ? '配置默认 (' + configured.effort + ')' : '会话默认'}</option>
      {value.effort && !selected?.efforts.includes(value.effort) ? <option value={value.effort}>{value.effort}</option> : null}
      {selected?.efforts.map(effort => <option key={effort} value={effort}>{effort}</option>)}
    </select></label>
    <label>审批 <select aria-label="审批策略" value={value.approvalPolicy ?? ''} onChange={event => change({ approvalPolicy: event.target.value || undefined })}>
      <option value="">{configured.approvalPolicy ? '配置默认 (' + configured.approvalPolicy + ')' : '会话默认'}</option><option value="untrusted">不受信任时</option><option value="on-request">按请求</option><option value="never">从不</option>
    </select></label>
    <label>权限 <select aria-label="沙箱权限" value={value.sandboxMode ?? ''} onChange={event => change({ sandboxMode: event.target.value || undefined })}>
      <option value="">{configured.sandboxMode ? '配置默认 (' + configured.sandboxMode + ')' : '会话默认'}</option><option value="read-only">只读</option><option value="workspace-write">工作区写入</option><option value="danger-full-access">完全访问</option>
    </select></label>
    <label><input type="checkbox" checked={(value.serviceTier === undefined ? configured.serviceTier : value.serviceTier) === 'fast'} onChange={event => change({ serviceTier: event.target.checked ? 'fast' : null })} />快速</label>
    <label><input type="checkbox" checked={value.mode === 'plan'} onChange={event => change({ mode: event.target.checked ? 'plan' : 'default' })} />计划</label>
    {error ? <span role="alert">{error}</span> : null}
  </fieldset>;
}
