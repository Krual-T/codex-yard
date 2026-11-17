import type { CodexConnection } from '../../lib/codex.ts';
import { record, publicConfig } from './protocol.ts';
import type { ObjectValue } from './protocol.ts';
import { deepseekModels, isDeepseekProvider } from './deepseek-models.ts';
import { modelIdentity, modelSelection } from './model-selection.ts';
import type { ModelSelection, ProviderSnapshot } from './model-selection.ts';

interface Options {
  globals: ObjectValue;
  persist(): Promise<void>;
  fetch?: typeof fetch;
}
interface ProviderDefinition { id: string; name: string; definition: ObjectValue; catalog?: string }
const stateKey = 'model-provider-enabled-by-host-id';
const catalogOwnersKey = 'model-catalog-provider-by-host-id';
function effectiveConfig(raw: ObjectValue): ObjectValue {
  const profile = typeof raw.profile === 'string' ? record(record(raw.profiles)[raw.profile]) : {};
  return { ...raw, ...profile, model_providers: { ...record(raw.model_providers), ...record(profile.model_providers) } };
}
function catalogModel(model: ObjectValue): ObjectValue {
  return { id: model.slug, model: model.slug, displayName: model.display_name ?? model.slug, description: model.description ?? '',
    hidden: model.visibility === 'hide', isDefault: false, defaultReasoningEffort: model.default_reasoning_level ?? null,
    supportedReasoningEfforts: Array.isArray(model.supported_reasoning_levels) ? model.supported_reasoning_levels.map(value => {
      const level = record(value); return { reasoningEffort: level.effort, description: level.description ?? '' };
    }) : [], inputModalities: model.input_modalities ?? ['text'], supportsPersonality: false };
}

/** Reads secret-bearing config exclusively on the host. Public methods return
 * only provider labels, enabled state, and Codex model metadata. */
export class ModelProviders {
  private options: Options;
  private updates = Promise.resolve();
  private catalogs = new Map<string, { expires: number; data: Promise<ObjectValue[]> }>();
  private managedHosts = new Set<string>();
  private errors = new Map<string, string>();
  constructor(options: Options) { this.options = options; }
  invalidate(hostId: string) { this.catalogs.delete(hostId); }
  private async config(hostId: string, connection: CodexConnection) {
    const config = effectiveConfig(record(record(await connection.request('config/read', { includeLayers: false, cwd: null })).config));
    if (typeof config.model_catalog_json === 'string') {
      const hosts = record(this.options.globals[catalogOwnersKey]), owners = record(hosts[hostId]);
      if (typeof owners[config.model_catalog_json] !== 'string') {
        this.options.globals[catalogOwnersKey] = { ...hosts, [hostId]: { ...owners, [config.model_catalog_json]: String(config.model_provider || 'openai') } };
        try { await this.options.persist(); }
        catch (error) { this.options.globals[catalogOwnersKey] = hosts; throw error; }
      }
      config.yard_catalog_provider = record(record(this.options.globals[catalogOwnersKey])[hostId])[config.model_catalog_json];
    }
    return config;
  }
  managed(hostId: string) { return this.managedHosts.has(hostId); }
  private definitions(config: ObjectValue): ProviderDefinition[] {
    const definitions = record(config.model_providers);
    const active = typeof config.model_provider === 'string' ? config.model_provider : 'openai';
    const ids = [...new Set([...Object.keys(definitions), active])];
    return ids.map(id => {
      const profile = Object.values(record(config.profiles)).map(record).find(profile => profile.model_provider === id && typeof profile.model_catalog_json === 'string');
      const catalog = id === (config.yard_catalog_provider ?? active) && typeof config.model_catalog_json === 'string' ? config.model_catalog_json : profile?.model_catalog_json;
      return { id, name: typeof record(definitions[id]).name === 'string' ? String(record(definitions[id]).name) : id,
        definition: record(definitions[id]), ...(typeof catalog === 'string' ? { catalog } : {}) };
    });
  }
  private enabled(hostId: string, id: string) {
    return record(record(this.options.globals[stateKey])[hostId])[id] !== false;
  }
  async snapshot(hostId: string, connection: CodexConnection): Promise<ProviderSnapshot> {
    return { providers: this.definitions(await this.config(hostId, connection)).map(({ id, name }) => ({ id, name, enabled: this.enabled(hostId, id),
      ...(this.errors.has(hostId + ':' + id) ? { error: this.errors.get(hostId + ':' + id) } : {}) })) };
  }
  async update(hostId: string, connection: CodexConnection, id: string, enabled: boolean): Promise<ProviderSnapshot> {
    const operation = this.updates.catch(() => {}).then(async () => {
      if (!this.definitions(await this.config(hostId, connection)).some(provider => provider.id === id)) throw new Error('配置中没有此供应商');
      const previous = this.options.globals[stateKey];
      const hosts = record(previous);
      this.options.globals[stateKey] = { ...hosts, [hostId]: { ...record(hosts[hostId]), [id]: enabled } };
      try { await this.options.persist(); }
      catch (error) { this.options.globals[stateKey] = previous; throw error; }
      this.invalidate(hostId);
    });
    this.updates = operation;
    await operation;
    return this.snapshot(hostId, connection);
  }
  async selection(hostId: string, connection: CodexConnection, value: unknown): Promise<ModelSelection | null> {
    const selection = modelSelection(value);
    if (!selection) return null;
    const provider = this.definitions(await this.config(hostId, connection)).find(provider => provider.id === selection.provider);
    if (!provider) throw new Error('模型供应商已从配置中移除，请重新选择');
    if (!this.enabled(hostId, provider.id)) throw new Error('此供应商已禁用，请在设置中启用后再选择');
    return selection;
  }
  async definition(hostId: string, connection: CodexConnection, id: string) {
    return this.definitions(await this.config(hostId, connection)).find(provider => provider.id === id)?.definition ?? {};
  }
  async catalogPath(hostId: string, connection: CodexConnection, id: string) {
    return this.definitions(await this.config(hostId, connection)).find(provider => provider.id === id)?.catalog;
  }
  publicConfig(hostId: string, result: unknown) {
    const config = effectiveConfig(record(record(result).config)), safe = publicConfig({ config });
    if (Object.keys(record(config.model_providers)).length && typeof config.model === 'string') {
      this.managedHosts.add(hostId);
      record(safe.config).model = modelIdentity(String(config.model_provider || 'openai'), config.model);
      record(safe.config).model_providers = Object.fromEntries(this.definitions(config).map(provider => [provider.id, { name: provider.name }]));
    }
    return safe;
  }
  private async upstreamModels(hostId: string, connection: CodexConnection, provider: ProviderDefinition, native: ObjectValue[]): Promise<ObjectValue[]> {
    if (provider.catalog) {
      try {
        const file = record(await connection.request('fs/readFile', { path: provider.catalog }));
        const catalog = record(JSON.parse(Buffer.from(String(file.dataBase64), 'base64').toString('utf8')));
        if (!Array.isArray(catalog.models)) throw new Error();
        return catalog.models.map(record).filter(model => typeof model.slug === 'string').map(catalogModel);
      } catch { throw new Error(provider.name + ' 配置的模型目录无法读取'); }
    }
    if (isDeepseekProvider(provider.definition)) return deepseekModels.map(catalogModel);
    if (hostId !== 'local') throw new Error(provider.name + ' 请在远程配置的 profile 中指定 model_catalog_json');
    const base = provider.definition.base_url;
    if (typeof base !== 'string' || provider.definition.requires_openai_auth === true) return native;
    const url = new URL(base.endsWith('/') ? base : base + '/');
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('模型目录地址须使用 HTTP 或 HTTPS');
    url.pathname = url.pathname.replace(/\/$/, '') + '/models';
    const headers = new Headers();
    for (const [key, value] of Object.entries(record(provider.definition.http_headers))) if (typeof value === 'string') headers.set(key, value);
    for (const [key, value] of Object.entries(record(provider.definition.env_http_headers))) {
      if (typeof value === 'string' && process.env[value]) headers.set(key, process.env[value]!);
    }
    const token = typeof provider.definition.env_key === 'string' ? process.env[provider.definition.env_key] : provider.definition.experimental_bearer_token;
    if (typeof token === 'string') headers.set('Authorization', 'Bearer ' + token);
    let response: Response;
    try { response = await (this.options.fetch ?? fetch)(url, { headers, signal: AbortSignal.timeout(10_000), redirect: 'error' }); }
    catch { throw new Error(provider.name + ' 模型目录连接失败'); }
    if (!response.ok) throw new Error(provider.name + ' 模型目录返回 HTTP ' + response.status);
    const data = record(await response.json()).data;
    if (!Array.isArray(data)) throw new Error(provider.name + ' 模型目录格式无效');
    return data.flatMap(value => {
      const id = record(value).id;
      if (typeof id !== 'string' || !id) return [];
      const known = native.find(model => model.model === id || model.id === id);
      return [{ ...(known ?? { displayName: id, description: '', hidden: false,
        supportedReasoningEfforts: [], defaultReasoningEffort: null, inputModalities: ['text'], supportsPersonality: false }), id, model: id, isDefault: false }];
    });
  }
  async models(hostId: string, connection: CodexConnection, params: ObjectValue): Promise<ObjectValue> {
    const config = await this.config(hostId, connection);
    if (!Object.keys(record(config.model_providers)).length) {
      const result = record(await connection.request('model/list', params));
      return this.enabled(hostId, String(config.model_provider || 'openai')) ? result : { data: [], nextCursor: null };
    }
    this.managedHosts.add(hostId);
    let cached = this.catalogs.get(hostId);
    if (!cached || cached.expires < Date.now()) {
      const data = (async () => {
        const native: ObjectValue[] = [];
        let cursor: unknown = null;
        do {
          const page = record(await connection.request('model/list', { includeHidden: true, cursor, limit: 100 }));
          if (Array.isArray(page.data)) native.push(...page.data.map(record));
          cursor = page.nextCursor;
        } while (cursor);
        const providers = this.definitions(config).filter(provider => this.enabled(hostId, provider.id));
        // A provider failure must leave the other providers usable. Its error is
        // reported in Settings through the catalog status below.
        const pages = await Promise.all(providers.map(async provider => {
          try {
            const models = provider.id === (config.model_provider || 'openai') && !isDeepseekProvider(provider.definition)
              && (config.yard_catalog_provider == null || config.yard_catalog_provider === provider.id)
              ? native : await this.upstreamModels(hostId, connection, provider, native);
            this.errors.delete(hostId + ':' + provider.id);
            return models.map(model => ({ ...model, id: modelIdentity(provider.id, String(model.model ?? model.id)),
              model: modelIdentity(provider.id, String(model.model ?? model.id)),
              isDefault: provider.id === (config.model_provider || 'openai') && (model.model === config.model || model.id === config.model) }));
          } catch (error) { this.errors.set(hostId + ':' + provider.id, (error as Error).message); return []; }
        }));
        return pages.flat();
      })();
      cached = { expires: Date.now() + 60_000, data };
      this.catalogs.set(hostId, cached);
      void data.catch(() => this.invalidate(hostId));
    }
    const all = (await cached.data).filter(model => params.includeHidden === true || !model.hidden);
    const offset = typeof params.cursor === 'string' && /^yard:\d+$/.test(params.cursor) ? Number(params.cursor.slice(5)) : 0;
    const limit = typeof params.limit === 'number' ? Math.max(1, Math.min(params.limit, 100)) : 100;
    return { data: all.slice(offset, offset + limit), nextCursor: offset + limit < all.length ? 'yard:' + (offset + limit) : null };
  }
}
