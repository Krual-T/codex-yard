import type { WorkbenchClient } from '../workbench-contract.ts';
import { isConfigTarget, userConfigTarget } from './config-target.ts';
import type { ConfigTarget } from './config-target.ts';
import { createSettingsWriteId, SettingsConfigOperations, settingsConfigOperations } from './config-operations.ts';
import { configReadSource, sameConfigSource } from './config-source.ts';
import type { ConfigReadSource } from '../../../lib/config-write-protocol.ts';

type Approval = 'on-request' | 'never';
type Sandbox = 'read-only' | 'workspace-write' | 'danger-full-access';
type WebSearch = 'disabled' | 'cached' | 'indexed' | 'live';
export type AgentField = 'approval' | 'sandbox' | 'networkAccess' | 'webSearch' | 'verbosity' | 'reasoning';
type AgentValues = Record<AgentField, string>;
type RawConfig = { approval_policy?: unknown; sandbox_mode?: unknown; sandbox_workspace_write?: unknown;
  web_search?: unknown; model_verbosity?: unknown; model_reasoning_summary?: unknown; profile?: unknown };
type ConfigRead = { config: RawConfig; layers?: unknown; yardConfigSource?: unknown; yardAgentConfiguration?: unknown };
type RequirementsRead = { requirements: { allowedApprovalPolicies?: unknown; allowedSandboxModes?: unknown; allowedWebSearchModes?: unknown } | null };
export interface AgentSnapshot {
  loading: boolean; saving: boolean; error: string | null; writeError: string | null; warning: string | null;
  profile: string | null; values: AgentValues; saved: AgentValues;
  conflicts: AgentField[];
  approvals: Approval[]; sandboxes: Sandbox[]; webSearches: WebSearch[]; locked: AgentField[]; projectionAvailable: boolean;
  configFile: string | null;
  draftStorageError: string | null; draftSaving: boolean;
}
const approvals: Approval[] = ['on-request', 'never'];
const sandboxes: Sandbox[] = ['read-only', 'workspace-write', 'danger-full-access'];
const webSearches: WebSearch[] = ['disabled', 'cached', 'indexed', 'live'];
const verbosity = ['', 'low', 'medium', 'high'];
const reasoning = ['auto', 'concise', 'detailed', 'none'];
const fields: AgentField[] = ['approval', 'sandbox', 'networkAccess', 'webSearch', 'verbosity', 'reasoning'];
const keys: Record<AgentField, string> = { approval: 'approval_policy', sandbox: 'sandbox_mode',
  networkAccess: 'sandbox_workspace_write.network_access', webSearch: 'web_search', verbosity: 'model_verbosity', reasoning: 'model_reasoning_summary' };
const advanced = '__advanced__';
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const profileName = (value: unknown) => typeof value === 'string' && value ? value : null;
const valueOf = (value: unknown, fallback: string) => value == null ? fallback : typeof value === 'string' ? value : advanced;
const matches = (a: AgentValues, b: AgentValues) => fields.every(field => a[field] === b[field]);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function rawValue(config: RawConfig, field: AgentField): unknown {
  if (field === 'networkAccess') return object(config.sandbox_workspace_write) ? config.sandbox_workspace_write.network_access : undefined;
  return (config as Record<string, unknown>)[keys[field]];
}
function projection(read: ConfigRead): { base: RawConfig; locked: AgentField[]; supportsIndexedWebSearch: boolean } | null {
  const data = read.yardAgentConfiguration;
  if (!object(data) || !object(data.base) || !Array.isArray(data.lockedKeys) ||
    typeof data.supportsIndexedWebSearch !== 'boolean' ||
    data.lockedKeys.some(key => typeof key !== 'string' || !Object.values(keys).includes(key))) return null;
  const lockedKeys = data.lockedKeys;
  return { base: data.base, locked: fields.filter(field => lockedKeys.includes(keys[field])), supportsIndexedWebSearch: data.supportsIndexedWebSearch };
}
function valuesFor(read: ConfigRead): AgentValues {
  const base = projection(read)?.base ?? {};
  const selected = (field: AgentField) => rawValue(base, field) ?? rawValue(read.config, field);
  const sandbox = valueOf(selected('sandbox'), 'read-only');
  const network = selected('networkAccess');
  return { approval: valueOf(selected('approval'), 'on-request'), sandbox,
    networkAccess: network == null ? 'false' : typeof network === 'boolean' ? String(network) : advanced,
    webSearch: valueOf(selected('webSearch'), sandbox === 'danger-full-access' ? 'live' : 'cached'),
    verbosity: valueOf(selected('verbosity'), ''), reasoning: valueOf(selected('reasoning'), 'auto') };
}
function writeValue(field: AgentField, value: string): string | boolean | null {
  return field === 'networkAccess' ? value === 'true' : field === 'verbosity' && value === '' ? null : value;
}

export class AgentSettings {
  private readonly client: WorkbenchClient;
  private readonly hostId: string;
  private readonly operations: SettingsConfigOperations;
  readonly editorId = createSettingsWriteId();
  private draftWrites: Promise<void> = Promise.resolve();
  private draftRevision: number | null = null;
  private conflictBaselines: Partial<Record<AgentField, { value: string; raw?: unknown }>> = {};
  private targetNeedsReview = false;
  private draftWriteCount = 0;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private target: ConfigTarget | null = null;
  private draftTarget: ConfigTarget | null = null;
  private source: ConfigReadSource | null = null;
  private draftSource: ConfigReadSource | null = null;
  private rawApproval: unknown = null;
  private snapshot: AgentSnapshot = { loading: true, saving: false, error: null, writeError: null, warning: null,
    profile: null, values: { approval: 'on-request', sandbox: 'read-only', networkAccess: 'false', webSearch: 'cached', verbosity: '', reasoning: 'auto' },
    saved: { approval: 'on-request', sandbox: 'read-only', networkAccess: 'false', webSearch: 'cached', verbosity: '', reasoning: 'auto' },
    approvals: [], sandboxes: [], webSearches: [], locked: [], projectionAvailable: false, configFile: null,
    conflicts: [], draftStorageError: null, draftSaving: false };
  constructor(client: WorkbenchClient, hostId: string, operations = settingsConfigOperations(client)) {
    this.client = client; this.hostId = hostId; this.operations = operations;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getOpenConfigTarget() {
    return this.target && this.source ? { hostId: this.hostId, file: this.target.file, source: { ...this.source } } : null;
  }
  private update(patch: Partial<AgentSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; for (const listener of this.listeners) listener(); }
  retryDraftPersistence() {
    if (this.snapshot.saving) return this.draftWrites;
    const { values, saved, profile, conflicts } = this.snapshot;
    const draft = structuredClone({ values, saved, profile, rawApproval: this.rawApproval, conflicts, conflictBaselines: this.conflictBaselines,
      target: this.draftTarget, source: this.draftSource, targetNeedsReview: this.targetNeedsReview });
    this.draftWriteCount++; this.update({ draftSaving: true });
    const dirty = this.dirty;
    this.draftWrites = this.draftWrites.then(() => dirty ? this.operations.saveDraft(this.hostId, 'agent', undefined, this.editorId, draft)
      : this.operations.clearEditorDraft(this.hostId, 'agent', undefined, this.editorId))
      .then(revision => { this.draftRevision = revision; this.update({ draftStorageError: null }); }, error => this.update({ draftStorageError: message(error) }))
      .finally(() => { if (--this.draftWriteCount === 0) this.update({ draftSaving: false }); });
    return this.draftWrites;
  }
  get dirty() { return !matches(this.snapshot.values, this.snapshot.saved); }
  dispose() { this.generation++; }
  async restoreDraft(draft: unknown): Promise<void> {
    if (this.dirty || this.snapshot.loading || this.snapshot.saving) throw new Error('Finish the current edit before restoring another copy.');
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw new Error('The saved agent edit cannot be read.');
    const value = draft as Record<string, unknown>, originalValues = value.values, originalSaved = value.saved;
    const valid = (v: unknown): v is Partial<AgentValues> & Pick<AgentValues, 'approval' | 'sandbox'> => object(v)
      && typeof v.approval === 'string' && typeof v.sandbox === 'string'
      && fields.every(field => v[field] === undefined || typeof v[field] === 'string');
    if (!valid(originalValues) || !valid(originalSaved) || !(value.profile === null || typeof value.profile === 'string') || !(value.target === null || isConfigTarget(value.target))) {
      throw new Error('The saved agent edit has no verifiable baseline.');
    }
    // Older drafts contain only approval and sandbox. New fields come from the
    // currently read baseline, not from an invented historical configuration.
    const values = { ...this.snapshot.saved, ...originalValues };
    const saved = { ...this.snapshot.saved, ...originalSaved };
    if (value.conflicts !== undefined && (!Array.isArray(value.conflicts) || value.conflicts.some(field => !fields.includes(field)))) throw new Error('The saved agent conflicts cannot be read.');
    const conflicts = value.conflicts === undefined ? fields.filter(field => values[field] !== saved[field]) : value.conflicts as AgentField[];
    const baselines = value.conflictBaselines;
    if (baselines !== undefined && (!baselines || typeof baselines !== 'object' || Array.isArray(baselines) || fields.some(field => {
      const baseline = (baselines as Record<string, unknown>)[field];
      return baseline !== undefined && (!baseline || typeof baseline !== 'object' || Array.isArray(baseline) || typeof (baseline as { value?: unknown }).value !== 'string');
    }))) throw new Error('The saved agent conflict baseline cannot be read.');
    this.conflictBaselines = structuredClone((baselines ?? {}) as typeof this.conflictBaselines);
    for (const field of conflicts) this.conflictBaselines[field] ??= { value: saved[field], ...(field === 'approval' ? { raw: value.rawApproval } : {}) };
    this.rawApproval = value.rawApproval; this.draftTarget = value.target as ConfigTarget | null; this.draftSource = configReadSource(value.source, this.hostId);
    this.targetNeedsReview = !value.target || value.targetNeedsReview === true;
    this.update({ values, saved, profile: value.profile, conflicts });
    await this.retryDraftPersistence(); await this.load();
  }
  private async read(): Promise<ConfigRead> {
    const result = await this.client.rpc<ConfigRead>('config/read', { includeLayers: true }, this.hostId);
    if (!result?.config || typeof result.config !== 'object' || Array.isArray(result.config) ||
      (result.config.profile != null && typeof result.config.profile !== 'string') ||
      (result.config.sandbox_mode != null && typeof result.config.sandbox_mode !== 'string')) throw new Error('Invalid agent configuration response');
    return result;
  }
  private async targetFor(read: ConfigRead) {
    const source = configReadSource(read.yardConfigSource, this.hostId);
    return source ? userConfigTarget(read.layers, source.codexHome)
      : { target: null, error: 'Cannot save without the original configuration connection. Reload and review your edit.' };
  }
  private async requirements(): Promise<{ approvals: Approval[]; sandboxes: Sandbox[]; webSearches: WebSearch[] }> {
    const result = await this.client.rpc<RequirementsRead>('configRequirements/read', {}, this.hostId);
    if (!result || !('requirements' in result) || result.requirements != null && (typeof result.requirements !== 'object' || Array.isArray(result.requirements))) {
      throw new Error('Invalid configuration requirements response');
    }
    const allowedApproval = result.requirements?.allowedApprovalPolicies;
    const allowedSandbox = result.requirements?.allowedSandboxModes;
    const allowedWeb = result.requirements?.allowedWebSearchModes;
    if (allowedApproval != null && !Array.isArray(allowedApproval) || allowedSandbox != null && !Array.isArray(allowedSandbox)
      || allowedWeb != null && !Array.isArray(allowedWeb)) {
      throw new Error('Invalid configuration requirements response');
    }
    return { approvals: approvals.filter(value => allowedApproval == null || allowedApproval.includes(value)),
      sandboxes: sandboxes.filter(value => allowedSandbox == null || allowedSandbox.includes(value)),
      webSearches: webSearches.filter(value => value === 'disabled' || allowedWeb == null || allowedWeb.includes(value)) };
  }
  async load(reviewSource = false): Promise<void> {
    if (this.snapshot.saving) return;
    const generation = ++this.generation;
    this.update({ loading: true, error: null });
    try {
      const [read, allowed] = await Promise.all([this.read(), this.requirements()]);
      const target = await this.targetFor(read);
      if (generation !== this.generation) return;
      const source = configReadSource(read.yardConfigSource, this.hostId);
      if (this.dirty && (!this.draftTarget || this.targetNeedsReview) && (!reviewSource || !source || !target.target)) {
        this.update({ loading: false, writeError: 'This edit has no verified configuration target. Reload and review your edit before saving.' }); return;
      }
      if (this.dirty && !sameConfigSource(this.draftSource, source) && (!reviewSource || !source)) {
        this.update({ loading: false, writeError: 'The configuration connection changed or is unavailable. Reload and review your edit.' }); return;
      }
      const profile = profileName(read.config.profile);
      if (this.dirty && profile !== this.snapshot.profile) {
        this.update({ loading: false, error: 'The active profile changed. Discard your edits and reload before continuing.' }); return;
      }
      if (this.dirty && this.draftTarget && target.target &&
        (this.draftTarget.file !== target.target.file || this.draftTarget.profile !== target.target.profile)) {
        this.update({ loading: false, error: 'The target configuration changed. Discard your edits before changing targets.' }); return;
      }
      const projected = projection(read);
      const saved = valuesFor(read);
      const previous = this.snapshot;
      const wasDirty = this.dirty;
      const values = { ...saved };
      const conflicts: AgentField[] = [];
      for (const field of fields) {
        if (previous.values[field] === previous.saved[field]) continue;
        if (previous.values[field] === saved[field]) continue;
        values[field] = previous.values[field];
        const changed = field === 'approval'
          ? JSON.stringify(rawValue(projected?.base ?? read.config, 'approval') ?? read.config.approval_policy) !== JSON.stringify(this.rawApproval)
          : saved[field] !== previous.saved[field];
        if (changed || previous.conflicts.includes(field)) {
          conflicts.push(field);
          this.conflictBaselines[field] ??= { value: previous.saved[field], ...(field === 'approval' ? { raw: this.rawApproval } : {}) };
        }
      }
      for (const field of fields) if (!conflicts.includes(field)) delete this.conflictBaselines[field];
      this.rawApproval = rawValue(projected?.base ?? read.config, 'approval') ?? read.config.approval_policy;
      this.target = target.target;
      this.source = source;
      if (this.dirty && reviewSource) { this.draftSource = source; this.draftTarget = target.target; this.targetNeedsReview = false; }
      if (matches(values, saved)) { this.draftTarget = null; this.targetNeedsReview = false; }
      this.update({ loading: false, profile, saved, values, conflicts, configFile: target.target?.file ?? null,
        projectionAvailable: !!projected, locked: projected?.locked ?? fields,
        error: conflicts.length ? 'Some settings changed elsewhere. Review each conflict before saving.' : null,
        writeError: target.error || (!projected ? 'The configuration details are unavailable. Reload after the host has been updated.' : null),
        ...allowed, webSearches: allowed.webSearches.filter(value => value !== 'indexed' || projected?.supportsIndexedWebSearch) });
      if (wasDirty || this.dirty) void this.retryDraftPersistence();
    } catch (error) { if (generation === this.generation) this.update({ loading: false, error: message(error), approvals: [], sandboxes: [], webSearches: [] }); }
  }
  edit(field: AgentField, value: string) {
    const choices: Record<AgentField, readonly string[]> = { approval: this.snapshot.approvals, sandbox: this.snapshot.sandboxes,
      networkAccess: ['true', 'false'], webSearch: this.snapshot.webSearches, verbosity, reasoning };
    if (this.snapshot.saving || this.snapshot.loading || !this.snapshot.projectionAvailable || this.snapshot.locked.includes(field) || !choices[field].includes(value)) return;
    if (!this.dirty && value !== this.snapshot.saved[field]) { this.draftTarget = this.target; this.draftSource = this.source; this.targetNeedsReview = !this.target; }
    const values = { ...this.snapshot.values, [field]: value };
    const conflicts = value === this.snapshot.saved[field] ? this.snapshot.conflicts.filter(item => item !== field) : this.snapshot.conflicts;
    if (!conflicts.includes(field)) delete this.conflictBaselines[field];
    if (matches(values, this.snapshot.saved)) this.draftTarget = null;
    this.update({ values, conflicts, error: conflicts.length ? this.snapshot.error : null, warning: null });
    void this.retryDraftPersistence();
  }
  resolveConflict(field: AgentField, choice: 'current' | 'draft') {
    if (this.snapshot.saving || !this.snapshot.conflicts.includes(field)) return;
    const values = choice === 'current' ? { ...this.snapshot.values, [field]: this.snapshot.saved[field] } : this.snapshot.values;
    const conflicts = this.snapshot.conflicts.filter(item => item !== field);
    delete this.conflictBaselines[field];
    if (matches(values, this.snapshot.saved)) this.draftTarget = null;
    this.update({ values, conflicts, error: conflicts.length ? this.snapshot.error : null });
    void this.retryDraftPersistence();
  }
  async discard(): Promise<boolean> {
    if (this.snapshot.saving) return false;
    this.generation++; this.update({ saving: true, loading: false });
    try {
      await this.draftWrites;
      await this.operations.clearEditorDraft(this.hostId, 'agent', undefined, this.editorId);
      this.draftRevision = null; this.draftTarget = null; this.targetNeedsReview = false; this.conflictBaselines = {};
      this.update({ saving: false, values: this.snapshot.saved, conflicts: [], error: null, warning: null, draftStorageError: null }); return true;
    } catch (error) { this.update({ saving: false, draftStorageError: message(error) }); return false; }
  }
  async save(): Promise<boolean> {
    if (!this.dirty || this.snapshot.saving || this.snapshot.loading) return false;
    if (this.snapshot.conflicts.length) { this.update({ error: 'Review each conflicting setting before saving.' }); return false; }
    const { values, saved, profile } = this.snapshot, target = this.target, rawApproval = this.rawApproval;
    const source = this.draftSource;
    if (!this.snapshot.projectionAvailable) { this.update({ error: 'The configuration details are unavailable. Reload the settings before saving.' }); return false; }
    if (!source) { this.update({ error: 'The original configuration connection is unavailable. Reload and review your edit.' }); return false; }
    if (!target || !this.draftTarget || this.targetNeedsReview) { this.update({ error: this.snapshot.writeError || 'Cannot save without a verified configuration version.' }); return false; }
    const generation = ++this.generation;
    this.update({ saving: true, error: null, warning: null });
    try {
      await this.draftWrites;
      if (this.snapshot.draftStorageError) throw new Error('The newer edit could not be saved in the browser.');
      if (this.draftRevision === null) throw new Error('The current edit has no saved browser revision.');
      if (generation !== this.generation) return false;
      const [before, allowed] = await Promise.all([this.read(), this.requirements()]);
      if (!sameConfigSource(source, configReadSource(before.yardConfigSource, this.hostId))) {
        this.update({ saving: false, writeError: 'The configuration connection changed. Reload and review your edit.' }); return false;
      }
      const current = await this.targetFor(before);
      if (generation !== this.generation) return false;
      const beforeProjection = projection(before);
      if (!beforeProjection) { this.update({ saving: false, writeError: 'The configuration details are unavailable. Reload the settings before saving.' }); return false; }
      const beforeValues = valuesFor(before);
      if (profileName(before.config.profile) !== profile || !matches(beforeValues, saved) ||
        JSON.stringify(rawValue(beforeProjection.base, 'approval') ?? before.config.approval_policy) !== JSON.stringify(rawApproval) ||
        !current.target || current.target.file !== target.file || current.target.profile !== target.profile || current.target.version !== target.version) {
        this.update({ saving: false, error: 'Configuration changed elsewhere. Reload and review your edits before saving.' }); return false;
      }
      if (values.approval !== saved.approval && !allowed.approvals.includes(values.approval as Approval) ||
        values.sandbox !== saved.sandbox && !allowed.sandboxes.includes(values.sandbox as Sandbox) ||
        values.webSearch !== saved.webSearch && (!allowed.webSearches.includes(values.webSearch as WebSearch) ||
          values.webSearch === 'indexed' && !beforeProjection.supportsIndexedWebSearch) ||
        fields.some(field => values[field] !== saved[field] && beforeProjection.locked.includes(field))) {
        this.update({ saving: false, ...allowed, error: 'Configuration requirements changed. Reload and review your edits before saving.' }); return false;
      }
      const changed = fields.filter(field => values[field] !== saved[field]);
      const edits = changed.map(field => ({ keyPath: keys[field], value: writeValue(field, values[field]), mergeStrategy: 'upsert' as const }));
      const submitted = await this.operations.submit(this.hostId, 'config/batchWrite',
        { edits, filePath: target.filePath, expectedVersion: target.version, reloadUserConfig: true },
        { section: 'agent', editorId: this.editorId, revision: this.draftRevision, source, draft: { values, saved, profile, rawApproval, target, source } }, () => generation === this.generation);
      if (generation !== this.generation) return false;
      const result = submitted.result as { status: 'ok' | 'okOverridden'; overriddenMetadata?: { message?: string } | null };
      if (result?.status !== 'ok' && result?.status !== 'okOverridden') throw new Error('The host did not confirm the write');
      const after = await this.read(), afterTarget = await this.targetFor(after);
      if (!sameConfigSource(source, configReadSource(after.yardConfigSource, this.hostId))) throw new Error('The configuration connection changed after the save. Check the original operation.');
      if (generation !== this.generation) return false;
      const afterProjection = projection(after);
      if (!afterProjection) throw new Error('The saved user configuration could not be verified');
      const actual = valuesFor(after);
      const confirmed = changed.every(field => (rawValue(afterProjection.base, field) ?? null) === writeValue(field, values[field])) &&
        profileName(after.config.profile) === profile && afterTarget.target?.file === target.file;
      this.rawApproval = rawValue(afterProjection.base, 'approval') ?? after.config.approval_policy;
      this.target = afterTarget.target;
      const nextValues = { ...actual };
      if (!confirmed) for (const field of changed) nextValues[field] = values[field];
      const conflicts: AgentField[] = confirmed ? [] : changed.filter(field =>
        (rawValue(afterProjection.base, field) ?? null) !== writeValue(field, values[field]));
      for (const field of conflicts) this.conflictBaselines[field] = { value: saved[field], ...(field === 'approval' ? { raw: rawApproval } : {}) };
      if (confirmed) await this.operations.finish(submitted.operationId, { consumeSubmittedDraft: true });
      if (generation !== this.generation) return false;
      if (confirmed) { this.draftTarget = null; this.draftRevision = null; this.conflictBaselines = {}; }
      this.update({ saving: false, saved: actual, writeError: afterTarget.error, locked: afterProjection.locked, configFile: afterTarget.target?.file ?? null,
        values: nextValues, conflicts,
        warning: result.status === 'okOverridden' ? result.overriddenMetadata?.message || 'A higher-priority configuration overrides this change.' : null,
        error: confirmed ? null : 'The saved configuration differs from your edit. Review the effective values.' });
      if (!confirmed) void this.retryDraftPersistence();
      return confirmed;
    } catch (error) { if (generation === this.generation) this.update({ saving: false, error: `Could not confirm save: ${message(error)}. Your edit is preserved.` }); return false; }
  }
}
