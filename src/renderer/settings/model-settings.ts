import type { WorkbenchClient } from '../workbench-contract.ts';
import { isConfigTarget, userConfigTarget } from './config-target.ts';
import type { ConfigTarget, ConfigTargetResult } from './config-target.ts';
import { createSettingsWriteId, latestSettingsDraft, SettingsConfigOperations, settingsConfigOperations } from './config-operations.ts';

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
export type ModelField = 'model' | 'effort';
export interface ModelSettingsSnapshot {
  loading: boolean; saving: boolean; error: string | null; warning: string | null; writeError: string | null;
  models: ModelOption[]; profile: string | null;
  model: string | null; effort: string | null; savedModel: string | null; savedEffort: string | null;
  conflicts: ModelField[];
  draftStorageError: string | null; draftSaving: boolean;
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const same = (a: string | null, b: string | null) => a === b;
const asValue = (value: unknown): string | null => typeof value === 'string' && value ? value : null;

/** Resolve the effective model without changing the nullable configured value. */
export function resolveConfiguredModel(models: readonly ModelOption[], configuredModel: string | null): ModelOption | null {
  if (configuredModel !== null) return models.find(item => item.model === configuredModel) ?? null;
  const defaults = models.filter(item => item.isDefault === true);
  return defaults.length === 1 ? defaults[0]! : null;
}

export class ModelSettings {
  private readonly client: WorkbenchClient;
  private readonly hostId: string;
  private readonly operations: SettingsConfigOperations;
  private restored = false;
  private readonly editorId = createSettingsWriteId();
  private draftWrites: Promise<void> = Promise.resolve();
  private draftWriteCount = 0;
  private listeners = new Set<() => void>();
  private generation = 0;
  private target: ConfigTarget | null = null;
  private draftTarget: ConfigTarget | null = null;
  private snapshot: ModelSettingsSnapshot = { loading: true, saving: false, error: null, warning: null, writeError: null, models: [],
    profile: null, model: null, effort: null, savedModel: null, savedEffort: null, conflicts: [], draftStorageError: null, draftSaving: false };
  constructor(client: WorkbenchClient, hostId: string, operations = settingsConfigOperations(client)) {
    this.client = client; this.hostId = hostId; this.operations = operations;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<ModelSettingsSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  retryDraftPersistence() {
    const { model, effort, savedModel, savedEffort, profile } = this.snapshot;
    const draft = { model, effort, savedModel, savedEffort, profile, target: this.draftTarget ?? this.target };
    this.draftWriteCount++; this.update({ draftSaving: true });
    this.draftWrites = this.draftWrites.then(() => this.operations.saveDraft(this.hostId, 'models', undefined, this.editorId, draft))
      .then(() => this.update({ draftStorageError: null }), error => this.update({ draftStorageError: message(error) }))
      .finally(() => { if (--this.draftWriteCount === 0) this.update({ draftSaving: false }); });
    return this.draftWrites;
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
      return userConfigTarget(read.layers, home?.codexHome);
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
    if (this.snapshot.saving) return;
    const generation = ++this.generation;
    this.update({ loading: true, error: null });
    try {
      if (!this.restored) {
        const previous = await this.operations.find(this.hostId, 'models');
        if (generation !== this.generation) return;
        const draft = previous && latestSettingsDraft(previous);
        if (draft && typeof draft === 'object' && !Array.isArray(draft)) {
          const saved = draft as Record<string, unknown>;
          const nullable = (value: unknown) => value === null || typeof value === 'string';
          if (nullable(saved.model) && nullable(saved.effort) && nullable(saved.savedModel) && nullable(saved.savedEffort) && nullable(saved.profile)) {
            if (!isConfigTarget(saved.target)) throw new Error('The saved model edit has no verifiable configuration target.');
            this.snapshot = { ...this.snapshot, model: saved.model as string | null, effort: saved.effort as string | null,
              savedModel: saved.savedModel as string | null, savedEffort: saved.savedEffort as string | null, profile: saved.profile as string | null };
            this.draftTarget = saved.target;
          } else throw new Error('The saved model edit cannot be read.');
        } else if (previous) throw new Error('The saved model edit cannot be read.');
        this.restored = true;
      }
      const [read, models] = await Promise.all([this.readConfig(), this.readModels()]);
      const target = await this.targetFor(read);
      if (generation !== this.generation) return;
      const { config } = read;
      if (this.dirty && asValue(config.profile) !== this.snapshot.profile) {
        this.update({ loading: false, error: 'The active profile changed. Discard your edits and reload before continuing.' });
        return;
      }
      if (this.dirty && this.draftTarget && target.target &&
        (this.draftTarget.file !== target.target.file || this.draftTarget.profile !== target.target.profile)) {
        this.update({ loading: false, error: 'The target configuration changed. Discard your edits before changing targets.' }); return;
      }
      const currentModel = asValue(config.model), currentEffort = asValue(config.model_reasoning_effort);
      const previous = this.snapshot, conflicts: ModelField[] = [];
      const modelDirty = previous.model !== previous.savedModel && previous.model !== currentModel;
      const effortDirty = previous.effort !== previous.savedEffort && previous.effort !== currentEffort;
      const model = modelDirty ? previous.model : currentModel, effort = effortDirty ? previous.effort : currentEffort;
      if (modelDirty && (currentModel !== previous.savedModel || previous.conflicts.includes('model'))) conflicts.push('model');
      if (effortDirty && (currentEffort !== previous.savedEffort || previous.conflicts.includes('effort'))) conflicts.push('effort');
      this.target = target.target;
      if (modelDirty || effortDirty) this.draftTarget ??= target.target;
      else this.draftTarget = null;
      this.update({ loading: false, models, profile: asValue(config.profile), savedModel: currentModel, savedEffort: currentEffort,
        writeError: target.error, model, effort, conflicts,
        error: conflicts.length ? 'Some settings changed elsewhere. Review each conflict before saving.' : null });
    } catch (error) { if (generation === this.generation) this.update({ loading: false, error: message(error) }); }
  }
  setModel(model: string) {
    if (this.snapshot.loading || this.snapshot.saving) return;
    const selected = this.snapshot.models.find(item => item.model === model);
    if (!selected) return;
    if (!this.dirty && model !== this.snapshot.savedModel) this.draftTarget = this.target;
    const conflicts = model === this.snapshot.savedModel ? this.snapshot.conflicts.filter(field => field !== 'model') : this.snapshot.conflicts;
    if (model === this.snapshot.savedModel && this.snapshot.effort === this.snapshot.savedEffort) this.draftTarget = null;
    this.update({ model, conflicts, error: conflicts.length ? this.snapshot.error : null, warning: null });
    void this.retryDraftPersistence();
  }
  setEffort(effort: string) {
    if (this.snapshot.loading || this.snapshot.saving) return;
    const selected = resolveConfiguredModel(this.snapshot.models, this.snapshot.model);
    if (!selected) {
      this.update({ error: 'The default model is unavailable or ambiguous. Refresh the model list before changing reasoning effort.' }); return;
    }
    if (!selected.supportedReasoningEfforts.some(item => item.reasoningEffort === effort)) {
      this.update({ error: 'The selected model does not support this reasoning effort. Review your selection before saving.' }); return;
    }
    if (!this.dirty && effort !== this.snapshot.savedEffort) this.draftTarget = this.target;
    const conflicts = effort === this.snapshot.savedEffort ? this.snapshot.conflicts.filter(field => field !== 'effort') : this.snapshot.conflicts;
    if (this.snapshot.model === this.snapshot.savedModel && effort === this.snapshot.savedEffort) this.draftTarget = null;
    this.update({ effort, conflicts, error: conflicts.length ? this.snapshot.error : null, warning: null });
    void this.retryDraftPersistence();
  }
  resolveConflict(field: ModelField, choice: 'current' | 'draft') {
    if (this.snapshot.saving || !this.snapshot.conflicts.includes(field)) return;
    const model = choice === 'current' && field === 'model' ? this.snapshot.savedModel : this.snapshot.model;
    const effort = choice === 'current' && field === 'effort' ? this.snapshot.savedEffort : this.snapshot.effort;
    const conflicts = this.snapshot.conflicts.filter(item => item !== field);
    if (model === this.snapshot.savedModel && effort === this.snapshot.savedEffort) this.draftTarget = null;
    this.update({ model, effort, conflicts, error: conflicts.length ? this.snapshot.error : null });
    void this.retryDraftPersistence();
  }
  discard() { if (this.snapshot.saving) return; this.draftTarget = null; this.update({ model: this.snapshot.savedModel, effort: this.snapshot.savedEffort, conflicts: [], error: null, warning: null }); void this.retryDraftPersistence(); }
  async save(): Promise<boolean> {
    if (!this.dirty || this.snapshot.saving || this.snapshot.loading) return false;
    if (this.snapshot.conflicts.length) { this.update({ error: 'Review each conflicting setting before saving.' }); return false; }
    const { model, effort, savedModel, savedEffort, profile } = this.snapshot;
    const target = this.target;
    if (!target) {
      this.update({ error: this.snapshot.writeError || 'Cannot save without a verified configuration version. Your edit is preserved.' }); return false;
    }
    if ((!model && model !== savedModel) || (!effort && effort !== savedEffort)) {
      this.update({ error: 'This configuration cannot be written safely with the current host contract.' }); return false;
    }
    const selected = resolveConfiguredModel(this.snapshot.models, model);
    if (effort !== savedEffort && (!selected || !selected.supportedReasoningEfforts.some(item => item.reasoningEffort === effort))) {
      this.update({ error: 'The selected model does not support this reasoning effort. Review your selection before saving.' }); return false;
    }
    const generation = ++this.generation;
    this.update({ saving: true, error: null, warning: null });
    try {
      await this.draftWrites;
      if (this.snapshot.draftStorageError) throw new Error('The newer edit could not be saved in the browser.');
      if (generation !== this.generation) return false;
      const before = await this.readConfig();
      const currentTarget = await this.targetFor(before);
      if (generation !== this.generation) return false;
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
      const submitted = await this.operations.submit(this.hostId, 'config/batchWrite', {
        edits, filePath: target.filePath, expectedVersion: target.version, reloadUserConfig: true,
      }, { section: 'models', draft: { model, effort, savedModel, savedEffort, profile, target } }, () => generation === this.generation);
      if (generation !== this.generation) return false;
      const result = submitted.result as { status: 'ok' | 'okOverridden'; version?: string; overriddenMetadata?: { message?: string } | null };
      if (result?.status !== 'ok' && result?.status !== 'okOverridden') throw new Error('The host did not confirm the write');
      const after = await this.readConfig();
      const afterTarget = await this.targetFor(after);
      if (generation !== this.generation) return false;
      const actualModel = asValue(after.config.model), actualEffort = asValue(after.config.model_reasoning_effort);
      const matches = (model === savedModel || actualModel === model) && (effort === savedEffort || actualEffort === effort) && asValue(after.config.profile) === profile &&
        afterTarget.target?.file === target.file;
      this.target = afterTarget.target;
      const conflicts: ModelField[] = [];
      if (!matches && model !== savedModel && model !== actualModel) conflicts.push('model');
      if (!matches && effort !== savedEffort && effort !== actualEffort) conflicts.push('effort');
      if (matches) await this.operations.finish(submitted.operationId);
      if (generation !== this.generation) return false;
      if (matches) this.draftTarget = null;
      this.update({ saving: false, savedModel: actualModel, savedEffort: actualEffort, writeError: afterTarget.error,
        model: matches || model === savedModel ? actualModel : model,
        effort: matches || effort === savedEffort ? actualEffort : effort, conflicts,
        warning: result.status === 'okOverridden' ? result.overriddenMetadata?.message || 'A higher-priority configuration overrides this change.' : null,
        error: matches ? null : 'The saved configuration differs from your edit. Review the effective values.' });
      return matches;
    } catch (error) {
      if (generation === this.generation) this.update({ saving: false, error: `Could not confirm save: ${message(error)}. Your edit is preserved.` });
      return false;
    }
  }
}
