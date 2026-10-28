import type { WorkbenchClient } from '../workbench-contract.ts';
import { userConfigTarget } from './config-target.ts';
import type { ConfigTarget, ConfigTargetResult } from './config-target.ts';

export interface ModelOption {
  id: string;
  model: string;
  displayName: string;
  isDefault: boolean;
  defaultReasoningEffort?: string | null;
  supportedReasoningEfforts: { reasoningEffort: string; description?: string }[];
}
interface Config { model?: string | null; model_reasoning_effort?: string | null; profile?: string | null }
interface ConfigRead { config: Config; layers?: unknown }
export interface ModelSettingsSnapshot {
  loading: boolean; saving: boolean; error: string | null; warning: string | null; writeError: string | null;
  models: ModelOption[]; profile: string | null;
  model: string | null; effort: string | null; savedModel: string | null; savedEffort: string | null;
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const same = (a: string | null, b: string | null) => a === b;
const asValue = (value: unknown): string | null => typeof value === 'string' && value ? value : null;

export class ModelSettings {
  private readonly client: WorkbenchClient;
  private readonly hostId: string;
  private listeners = new Set<() => void>();
  private generation = 0;
  private target: ConfigTarget | null = null;
  private snapshot: ModelSettingsSnapshot = { loading: true, saving: false, error: null, warning: null, writeError: null, models: [],
    profile: null, model: null, effort: null, savedModel: null, savedEffort: null };
  constructor(client: WorkbenchClient, hostId: string) { this.client = client; this.hostId = hostId; }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<ModelSettingsSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  get dirty() { return !same(this.snapshot.model, this.snapshot.savedModel) || !same(this.snapshot.effort, this.snapshot.savedEffort); }
  dispose() { this.generation++; }
  private async readConfig(): Promise<ConfigRead> {
    const result = await this.client.rpc<ConfigRead>('config/read', { includeLayers: true }, this.hostId);
    if (!result?.config || typeof result.config !== 'object' || ['model', 'model_reasoning_effort', 'profile'].some(key => {
      const value = result.config[key as keyof Config];
      return value !== undefined && value !== null && typeof value !== 'string';
    })) throw new Error('Invalid configuration response');
    return result;
  }
  private async targetFor(read: ConfigRead): Promise<ConfigTargetResult> {
    try {
      const home = await this.client.host<{ codexHome?: unknown }>('codex-home', { hostId: this.hostId });
      return userConfigTarget(read.layers, home?.codexHome, asValue(read.config.profile));
    } catch {
      return { target: null, error: 'Cannot save: the selected host did not provide its configuration home and version.' };
    }
  }
  private async readModels(): Promise<ModelOption[]> {
    const models: ModelOption[] = [], cursors = new Set<string>();
    let cursor: string | null = null;
    for (;;) {
      const page: { data: ModelOption[]; nextCursor?: string | null } = await this.client.rpc('model/list', { cursor, limit: 100 }, this.hostId);
      if (!Array.isArray(page?.data)) throw new Error('Invalid model list response');
      models.push(...page.data.filter(model => model && typeof model.model === 'string' && typeof model.id === 'string' &&
        typeof model.displayName === 'string' && Array.isArray(model.supportedReasoningEfforts)));
      const nextCursor = page.nextCursor;
      if (!nextCursor) return models;
      if (cursors.has(nextCursor) || cursors.size >= 100) throw new Error('Invalid model list pagination');
      cursor = nextCursor; cursors.add(nextCursor);
    }
  }
  async load(): Promise<void> {
    const generation = ++this.generation;
    this.update({ loading: true, error: null });
    try {
      const [read, models] = await Promise.all([this.readConfig(), this.readModels()]);
      const target = await this.targetFor(read);
      if (generation !== this.generation) return;
      const { config } = read;
      if (this.dirty && asValue(config.profile) !== this.snapshot.profile) {
        this.update({ loading: false, error: 'The active profile changed. Discard your edits and reload before continuing.' });
        return;
      }
      const model = asValue(config.model), effort = asValue(config.model_reasoning_effort);
      this.target = target.target;
      this.update({ loading: false, models, profile: asValue(config.profile), savedModel: model, savedEffort: effort, writeError: target.error,
        model: this.dirty ? this.snapshot.model : model, effort: this.dirty ? this.snapshot.effort : effort });
    } catch (error) { if (generation === this.generation) this.update({ loading: false, error: message(error) }); }
  }
  setModel(model: string) {
    const selected = this.snapshot.models.find(item => item.model === model);
    if (!selected) return;
    const efforts = Array.isArray(selected.supportedReasoningEfforts) ? selected.supportedReasoningEfforts : [];
    const defaultEffort = efforts.find(item => item.reasoningEffort === selected.defaultReasoningEffort)?.reasoningEffort;
    const effort = efforts.some(item => item.reasoningEffort === this.snapshot.effort) ? this.snapshot.effort :
      defaultEffort ?? efforts[0]?.reasoningEffort ?? null;
    this.update({ model, effort, error: null, warning: null });
  }
  setEffort(effort: string) {
    const selected = this.snapshot.models.find(item => item.model === this.snapshot.model);
    if (selected?.supportedReasoningEfforts?.some(item => item.reasoningEffort === effort)) this.update({ effort, error: null, warning: null });
  }
  discard() { this.update({ model: this.snapshot.savedModel, effort: this.snapshot.savedEffort, error: null, warning: null }); }
  async save(): Promise<boolean> {
    if (!this.dirty || this.snapshot.saving) return false;
    const { model, effort, savedModel, savedEffort, profile } = this.snapshot;
    const target = this.target;
    if (!target) {
      this.update({ error: this.snapshot.writeError || 'Cannot save without a verified configuration version. Your edit is preserved.' }); return false;
    }
    if ((!model && model !== savedModel) || (!effort && effort !== savedEffort)) {
      this.update({ error: 'This configuration cannot be written safely with the current host contract.' }); return false;
    }
    this.update({ saving: true, error: null, warning: null });
    try {
      const before = await this.readConfig();
      const currentTarget = await this.targetFor(before);
      const currentModel = asValue(before.config.model), currentEffort = asValue(before.config.model_reasoning_effort), currentProfile = asValue(before.config.profile);
      if (currentProfile !== profile || currentModel !== savedModel || currentEffort !== savedEffort) {
        this.update(currentProfile !== profile ? { saving: false,
          error: 'The active profile changed. Discard your edits and reload before continuing.' } :
          { saving: false, error: 'Configuration changed elsewhere. Reload and review your edits before saving.' });
        return false;
      }
      if (!currentTarget.target || currentTarget.target.file !== target.file || currentTarget.target.profile !== target.profile ||
        currentTarget.target.version !== target.version) {
        this.update({ saving: false, error: 'The target configuration or its version changed. Reload and review your edits before saving.' });
        return false;
      }
      const edits: { keyPath: string; value: string; mergeStrategy: 'upsert' }[] = [];
      if (model !== savedModel && model !== null) edits.push({ keyPath: 'model', value: model, mergeStrategy: 'upsert' });
      if (effort !== savedEffort && effort !== null) edits.push({ keyPath: 'model_reasoning_effort', value: effort, mergeStrategy: 'upsert' });
      const result = await this.client.rpc<{ status: 'ok' | 'okOverridden'; version?: string; overriddenMetadata?: { message?: string } | null }>('config/batchWrite', {
        edits, filePath: target.filePath, expectedVersion: target.version, reloadUserConfig: true,
      }, this.hostId);
      if (result?.status !== 'ok' && result?.status !== 'okOverridden') throw new Error('The host did not confirm the write');
      const after = await this.readConfig();
      const afterTarget = await this.targetFor(after);
      const actualModel = asValue(after.config.model), actualEffort = asValue(after.config.model_reasoning_effort);
      const matches = actualModel === model && actualEffort === effort && asValue(after.config.profile) === profile &&
        afterTarget.target?.file === target.file;
      this.target = afterTarget.target;
      this.update({ saving: false, savedModel: actualModel, savedEffort: actualEffort, writeError: afterTarget.error,
        warning: result.status === 'okOverridden' ? result.overriddenMetadata?.message || 'A higher-priority configuration overrides this change.' : null,
        error: matches ? null : 'The saved configuration differs from your edit. Review the effective values.' });
      return matches;
    } catch (error) {
      this.update({ saving: false, error: `Could not confirm save: ${message(error)}. Your edit is preserved.` });
      return false;
    }
  }
}
