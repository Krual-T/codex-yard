import type { CodexConnection, RequestOptions } from '../../lib/codex.ts';
import { record } from './protocol.ts';
import type { ObjectValue } from './protocol.ts';
import type { ModelProviders } from './model-providers.ts';
import { modelIdentity, modelSelection } from './model-selection.ts';
import type { ModelSelection } from './model-selection.ts';

interface Options {
  providers: ModelProviders;
  connections(hostId: string): CodexConnection[];
  sessionConfig(hostId: string, provider: string, connection: CodexConnection, cwd?: string): Promise<ObjectValue>;
}

/** Codex 0.164 accepts a provider on start/fork/resume, but not turn/start.
 * Serialize model changes with sends and unload idle sessions before resuming.
 * No model traffic is proxied by Yard. */
export class ProviderRouting {
  private options: Options;
  private locks = new Map<string, Promise<unknown>>();
  private threadProviders = new Map<string, string>();
  constructor(options: Options) { this.options = options; }
  present(hostId: string, value: unknown, threadId?: string): unknown {
    const result = record(value), thread = record(result.thread);
    const id = typeof thread.id === 'string' ? thread.id : threadId;
    const provider = typeof thread.modelProvider === 'string' ? thread.modelProvider
      : typeof result.modelProvider === 'string' ? result.modelProvider
      : typeof record(result.threadSettings).modelProvider === 'string' ? String(record(result.threadSettings).modelProvider)
      : id ? this.threadProviders.get(hostId + ':' + id) : undefined;
    if (provider && id) this.threadProviders.set(hostId + ':' + id, provider);
    if (!provider || !this.options.providers.managed(hostId)) return value;
    const qualify = (item: ObjectValue): ObjectValue => ({ ...item,
      ...(typeof item.model === 'string' && !modelSelection(item.model) ? { model: modelIdentity(provider, item.model) } : {}),
      ...(item.collaborationMode && typeof item.collaborationMode === 'object' ? { collaborationMode: {
        ...record(item.collaborationMode), settings: qualify(record(record(item.collaborationMode).settings)),
      } } : {}),
    });
    return { ...qualify(result), ...(result.thread ? { thread: qualify(thread) } : {}),
      ...(result.threadSettings ? { threadSettings: qualify(record(result.threadSettings)) } : {}) };
  }
  async request(hostId: string, connection: CodexConnection, method: string, input: ObjectValue | null | undefined, options: RequestOptions): Promise<unknown> {
    const threadId = typeof input?.threadId === 'string' ? input.threadId : undefined;
    const key = threadId ? hostId + ':' + threadId : undefined;
    const run = () => this.dispatch(hostId, connection, method, input, options);
    // Reads and interrupts must remain usable while a model change is pending.
    if (!key || !['thread/resume', 'thread/settings/update', 'turn/settings/update', 'turn/start', 'thread/queue/add', 'thread/queue/start', 'thread/unsubscribe'].includes(method)) return run();
    const operation = (this.locks.get(key) ?? Promise.resolve()).catch(() => {}).then(run);
    this.locks.set(key, operation);
    try { return await operation; }
    finally { if (this.locks.get(key) === operation) this.locks.delete(key); }
  }
  private async dispatch(hostId: string, connection: CodexConnection, method: string, input: ObjectValue | null | undefined, options: RequestOptions) {
    if (method === 'model/list') return this.options.providers.models(hostId, connection, input ?? {});
    const params = input == null ? input : structuredClone(input);
    let selected: ModelSelection | null = null;
    const select = async (value: unknown) => {
      const next = await this.options.providers.selection(hostId, connection, value);
      if (!next) return value;
      if (selected && (selected.provider !== next.provider || selected.model !== next.model)) throw new Error('同一请求的模型选择不一致');
      selected = next;
      return next.model;
    };
    if (params) {
      if (params.model != null) params.model = await select(params.model);
      const mode = record(params.collaborationMode), settings = record(mode.settings);
      if (settings.model != null) settings.model = await select(settings.model);
      if (Array.isArray(params.edits) && method === 'config/batchWrite') {
        const edits = params.edits as ObjectValue[];
        for (const edit of [...edits]) if (typeof edit.keyPath === 'string' && /(^|\.)model$/.test(edit.keyPath)) {
          const selection = modelSelection(edit.value);
          if (!selection) continue;
          edit.value = await select(edit.value);
          const providerPath = edit.keyPath.slice(0, -5) + 'model_provider';
          const providerEdit = edits.find(edit => edit.keyPath === providerPath);
          if (providerEdit) providerEdit.value = selection.provider;
          else edits.push({ keyPath: providerPath, value: selection.provider, mergeStrategy: 'upsert' });
        }
      }
      if (method === 'config/value/write' && typeof params.keyPath === 'string' && /(^|\.)model$/.test(params.keyPath) && modelSelection(params.value)) {
        throw new Error('供应商和模型须一起保存，请使用 config/batchWrite');
      }
    }
    // Assignment in select() occurs across await; read the result explicitly.
    const selection = selected as ModelSelection | null;
    if (selection && params) {
      if (['thread/start', 'thread/fork', 'thread/resume'].includes(method)) {
        params.modelProvider = selection.provider;
        const cwd = typeof params.cwd === 'string' ? params.cwd : typeof params.threadId === 'string'
          ? (await connection.request('thread/read', { threadId: params.threadId, includeTurns: false })).thread.cwd : undefined;
        params.config = { ...await this.options.sessionConfig(hostId, selection.provider, connection, cwd), ...record(params.config) };
      }
      if (typeof params.threadId === 'string' && method !== 'thread/fork') {
        await this.switchProvider(hostId, connection, params.threadId, selection, params);
      }
    }
    let result = await connection.request(method, params, options);
    if (method === 'config/read') return this.options.providers.publicConfig(hostId, result);
    if (method === 'config/batchWrite' || method === 'config/value/write') this.options.providers.invalidate(hostId);
    if (method === 'thread/list' || method === 'thread/search') return result;
    result = this.present(hostId, result, typeof params?.threadId === 'string' ? params.threadId : undefined);
    return result;
  }
  private async switchProvider(hostId: string, connection: CodexConnection, threadId: string, selection: ModelSelection, requested: ObjectValue) {
    const { thread } = await connection.request('thread/read', { threadId, includeTurns: false });
    if (record(thread).modelProvider === selection.provider) return;
    if (thread.status.type === 'active') throw new Error('请等待当前任务完成后再切换模型供应商');
    const version = connection.server?.userAgent.match(/\b0\.(\d+)\./)?.[1];
    if (version && Number(version) >= 166) throw new Error('此 CLI 版本要求跨供应商创建分支会话；请新建会话选择该供应商');
    const before = record(await connection.request('thread/resume', { threadId, excludeTurns: true }));
    if (record(record(before.thread).status).type === 'active') throw new Error('请等待当前任务完成后再切换模型供应商');
    const path = record(before.thread).path;
    if (typeof path !== 'string') throw new Error('此对话尚未保存，请在新对话页选择供应商后发送首条消息');
    try { await connection.request('fs/getMetadata', { path }); }
    catch { throw new Error('此对话尚未保存，请在新对话页选择供应商后发送首条消息'); }
    const all = [...new Set([connection, ...this.options.connections(hostId)])].filter(connection => connection.connected);
    const restore: CodexConnection[] = [];
    // Preserve the effective permission and sandbox settings across the reload.
    const policy = record(before.sandbox);
    if (policy.type === 'externalSandbox') throw new Error('此会话使用外部沙箱，请新建会话选择供应商');
    const sandboxModes: Record<string, string> = { readOnly: 'read-only', workspaceWrite: 'workspace-write', dangerFullAccess: 'danger-full-access' };
    const oldConfig: ObjectValue = { model_reasoning_effort: before.reasoningEffort ?? null };
    if (policy.type === 'workspaceWrite') oldConfig.sandbox_workspace_write = {
      writable_roots: policy.writableRoots ?? [], network_access: policy.networkAccess ?? false,
      exclude_tmpdir_env_var: policy.excludeTmpdirEnvVar ?? false, exclude_slash_tmp: policy.excludeSlashTmp ?? false,
    };
    const profile = record(before.activePermissionProfile).id;
    const resume: ObjectValue = { threadId, excludeTurns: true, cwd: record(before.thread).cwd,
      model: before.model, modelProvider: record(before.thread).modelProvider,
      runtimeWorkspaceRoots: before.runtimeWorkspaceRoots,
      approvalPolicy: before.approvalPolicy, approvalsReviewer: before.approvalsReviewer,
      serviceTier: before.serviceTier ?? null, config: oldConfig,
      ...(typeof profile === 'string' ? { permissions: profile } : { sandbox: sandboxModes[String(policy.type)] }),
    };
    try {
      for (const client of all) {
        const reply = record(await client.request('thread/unsubscribe', { threadId }, { mutating: true }));
        if (client === connection || reply.status === 'unsubscribed') restore.push(client);
      }
      const result = record(await connection.request('thread/resume', { ...resume, modelProvider: selection.provider, model: selection.model,
        serviceTier: null, config: { ...oldConfig, ...await this.options.sessionConfig(hostId, selection.provider, connection, thread.cwd),
          ...(requested.effort != null ? { model_reasoning_effort: requested.effort } : {}) } }, { mutating: true }));
      if (record(result.thread).modelProvider !== selection.provider) throw new Error('Codex 尚未释放此会话，可能仍被其他客户端使用；请关闭其他客户端中的会话后重试');
      this.threadProviders.set(hostId + ':' + threadId, selection.provider);
      const mode = record(before.collaborationMode);
      const effort = requested.effort ?? record(record(requested.collaborationMode).settings).reasoning_effort
        ?? record(requested.config).model_reasoning_effort ?? before.reasoningEffort;
      await Promise.allSettled(restore.filter(client => client !== connection && client.connected)
        .map(client => client.request('thread/resume', { threadId, excludeTurns: true })));
      // Let Codex publish the complete, correctly versioned settings event to
      // every restored subscriber, retaining the previous collaboration mode.
      await connection.request('thread/settings/update', { threadId, model: selection.model, effort,
        disabledPluginIds: before.disabledPluginIds,
        ...(mode.mode ? { collaborationMode: { ...mode, settings: { ...record(mode.settings), model: selection.model, reasoning_effort: effort } } } : {}),
      }, { mutating: true });
    } catch (error) {
      // If another client kept the original session loaded, this simply rejoins
      // it. An uncertain failed resume never leads to a replayed model turn.
      await Promise.allSettled(restore.filter(client => client.connected).map(client => client.request('thread/resume', resume)));
      throw error;
    }
  }
}
