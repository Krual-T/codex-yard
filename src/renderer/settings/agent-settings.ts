import type { WorkbenchClient } from '../workbench-contract.ts';
import { isConfigTarget, userConfigTarget } from './config-target.ts';
import type { ConfigTarget } from './config-target.ts';
import { createSettingsWriteId, latestSettingsDraft, SettingsConfigOperations, settingsConfigOperations } from './config-operations.ts';

type Approval = 'on-request' | 'never';
type Sandbox = 'read-only' | 'workspace-write' | 'danger-full-access';
export type AgentField = 'approval' | 'sandbox';
type AgentValues = { approval: string; sandbox: string };
type RawConfig = { approval_policy?: unknown; sandbox_mode?: unknown; profile?: unknown };
type ConfigRead = { config: RawConfig; layers?: unknown };
type RequirementsRead = { requirements: { allowedApprovalPolicies?: unknown; allowedSandboxModes?: unknown } | null };
export interface AgentSnapshot {
  loading: boolean; saving: boolean; error: string | null; writeError: string | null; warning: string | null;
  profile: string | null; values: AgentValues; saved: AgentValues;
  conflicts: AgentField[];
  approvals: Approval[]; sandboxes: Sandbox[];
  draftStorageError: string | null; draftSaving: boolean;
}
const approvals: Approval[] = ['on-request', 'never'];
const sandboxes: Sandbox[] = ['read-only', 'workspace-write', 'danger-full-access'];
const advanced = '__advanced__';
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const profileName = (value: unknown) => typeof value === 'string' && value ? value : null;
const valueOf = (value: unknown, fallback: string) => value == null ? fallback : typeof value === 'string' ? value : advanced;
const matches = (a: AgentValues, b: AgentValues) => a.approval === b.approval && a.sandbox === b.sandbox;

export class AgentSettings {
  private readonly client: WorkbenchClient;
  private readonly hostId: string;
  private readonly operations: SettingsConfigOperations;
  private restored = false;
  private readonly editorId = createSettingsWriteId();
  private draftWrites: Promise<void> = Promise.resolve();
  private draftWriteCount = 0;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private target: ConfigTarget | null = null;
  private draftTarget: ConfigTarget | null = null;
  private rawApproval: unknown = null;
  private snapshot: AgentSnapshot = { loading: true, saving: false, error: null, writeError: null, warning: null,
    profile: null, values: { approval: 'on-request', sandbox: 'read-only' }, saved: { approval: 'on-request', sandbox: 'read-only' },
    approvals: [], sandboxes: [], conflicts: [], draftStorageError: null, draftSaving: false };
  constructor(client: WorkbenchClient, hostId: string, operations = settingsConfigOperations(client)) {
    this.client = client; this.hostId = hostId; this.operations = operations;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<AgentSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; for (const listener of this.listeners) listener(); }
  retryDraftPersistence() {
    const { values, saved, profile } = this.snapshot;
    const draft = structuredClone({ values, saved, profile, rawApproval: this.rawApproval, target: this.draftTarget ?? this.target });
    this.draftWriteCount++; this.update({ draftSaving: true });
    this.draftWrites = this.draftWrites.then(() => this.operations.saveDraft(this.hostId, 'agent', undefined, this.editorId, draft))
      .then(() => this.update({ draftStorageError: null }), error => this.update({ draftStorageError: message(error) }))
      .finally(() => { if (--this.draftWriteCount === 0) this.update({ draftSaving: false }); });
    return this.draftWrites;
  }
  get dirty() { return !matches(this.snapshot.values, this.snapshot.saved); }
  dispose() { this.generation++; }
  private async read(): Promise<ConfigRead> {
    const result = await this.client.rpc<ConfigRead>('config/read', { includeLayers: true }, this.hostId);
    if (!result?.config || typeof result.config !== 'object' || Array.isArray(result.config) ||
      (result.config.profile != null && typeof result.config.profile !== 'string') ||
      (result.config.sandbox_mode != null && typeof result.config.sandbox_mode !== 'string')) throw new Error('Invalid agent configuration response');
    return result;
  }
  private async targetFor(read: ConfigRead) {
    try {
      const home = await this.client.host<{ codexHome?: unknown }>('codex-home', { hostId: this.hostId });
      return userConfigTarget(read.layers, home?.codexHome);
    } catch { return { target: null, error: 'Cannot save: the selected host did not provide its configuration home and version.' }; }
  }
  private async requirements(): Promise<{ approvals: Approval[]; sandboxes: Sandbox[] }> {
    const result = await this.client.rpc<RequirementsRead>('configRequirements/read', {}, this.hostId);
    if (!result || !('requirements' in result) || result.requirements != null && (typeof result.requirements !== 'object' || Array.isArray(result.requirements))) {
      throw new Error('Invalid configuration requirements response');
    }
    const allowedApproval = result.requirements?.allowedApprovalPolicies;
    const allowedSandbox = result.requirements?.allowedSandboxModes;
    if (allowedApproval != null && !Array.isArray(allowedApproval) || allowedSandbox != null && !Array.isArray(allowedSandbox)) {
      throw new Error('Invalid configuration requirements response');
    }
    return { approvals: approvals.filter(value => allowedApproval == null || allowedApproval.includes(value)),
      sandboxes: sandboxes.filter(value => allowedSandbox == null || allowedSandbox.includes(value)) };
  }
  async load(): Promise<void> {
    if (this.snapshot.saving) return;
    const generation = ++this.generation;
    this.update({ loading: true, error: null });
    try {
      if (!this.restored) {
        const previous = await this.operations.find(this.hostId, 'agent'), draft = previous && latestSettingsDraft(previous);
        if (generation !== this.generation) return;
        if (draft && typeof draft === 'object' && !Array.isArray(draft)) {
          const value = draft as Record<string, unknown>, values = value.values, saved = value.saved;
          const valid = (v: unknown): v is AgentValues => !!v && typeof v === 'object' && !Array.isArray(v)
            && typeof (v as AgentValues).approval === 'string' && typeof (v as AgentValues).sandbox === 'string';
          if (valid(values) && valid(saved) && (value.profile === null || typeof value.profile === 'string')) {
            if (!isConfigTarget(value.target)) throw new Error('The saved agent edit has no verifiable configuration target.');
            this.snapshot = { ...this.snapshot, values, saved, profile: value.profile };
            this.rawApproval = value.rawApproval;
            this.draftTarget = value.target;
          } else throw new Error('The saved agent edit cannot be read.');
        } else if (previous) throw new Error('The saved agent edit cannot be read.');
        this.restored = true;
      }
      const [read, allowed] = await Promise.all([this.read(), this.requirements()]);
      const target = await this.targetFor(read);
      if (generation !== this.generation) return;
      const profile = profileName(read.config.profile);
      if (this.dirty && profile !== this.snapshot.profile) {
        this.update({ loading: false, error: 'The active profile changed. Discard your edits and reload before continuing.' }); return;
      }
      if (this.dirty && this.draftTarget && target.target &&
        (this.draftTarget.file !== target.target.file || this.draftTarget.profile !== target.target.profile)) {
        this.update({ loading: false, error: 'The target configuration changed. Discard your edits before changing targets.' }); return;
      }
      const saved = { approval: valueOf(read.config.approval_policy, 'on-request'), sandbox: valueOf(read.config.sandbox_mode, 'read-only') };
      const previous = this.snapshot;
      const fields: AgentField[] = ['approval', 'sandbox'];
      const values = { ...saved };
      const conflicts: AgentField[] = [];
      for (const field of fields) {
        if (previous.values[field] === previous.saved[field]) continue;
        if (previous.values[field] === saved[field]) continue;
        values[field] = previous.values[field];
        const changed = field === 'approval'
          ? JSON.stringify(read.config.approval_policy) !== JSON.stringify(this.rawApproval)
          : saved[field] !== previous.saved[field];
        if (changed || previous.conflicts.includes(field)) conflicts.push(field);
      }
      this.rawApproval = read.config.approval_policy;
      this.target = target.target;
      if (!matches(values, saved)) this.draftTarget ??= target.target;
      else this.draftTarget = null;
      this.update({ loading: false, profile, saved, values, conflicts,
        error: conflicts.length ? 'Some settings changed elsewhere. Review each conflict before saving.' : null,
        writeError: target.error, ...allowed });
    } catch (error) { if (generation === this.generation) this.update({ loading: false, error: message(error), approvals: [], sandboxes: [] }); }
  }
  edit(field: AgentField, value: string) {
    if (this.snapshot.saving || this.snapshot.loading || !(field === 'approval' ? this.snapshot.approvals : this.snapshot.sandboxes).includes(value as never)) return;
    if (!this.dirty && value !== this.snapshot.saved[field]) this.draftTarget = this.target;
    const values = { ...this.snapshot.values, [field]: value };
    const conflicts = value === this.snapshot.saved[field] ? this.snapshot.conflicts.filter(item => item !== field) : this.snapshot.conflicts;
    if (matches(values, this.snapshot.saved)) this.draftTarget = null;
    this.update({ values, conflicts, error: conflicts.length ? this.snapshot.error : null, warning: null });
    void this.retryDraftPersistence();
  }
  resolveConflict(field: AgentField, choice: 'current' | 'draft') {
    if (this.snapshot.saving || !this.snapshot.conflicts.includes(field)) return;
    const values = choice === 'current' ? { ...this.snapshot.values, [field]: this.snapshot.saved[field] } : this.snapshot.values;
    const conflicts = this.snapshot.conflicts.filter(item => item !== field);
    if (matches(values, this.snapshot.saved)) this.draftTarget = null;
    this.update({ values, conflicts, error: conflicts.length ? this.snapshot.error : null });
    void this.retryDraftPersistence();
  }
  discard() { if (this.snapshot.saving) return; this.draftTarget = null; this.update({ values: this.snapshot.saved, conflicts: [], error: null, warning: null }); void this.retryDraftPersistence(); }
  async save(): Promise<boolean> {
    if (!this.dirty || this.snapshot.saving || this.snapshot.loading) return false;
    if (this.snapshot.conflicts.length) { this.update({ error: 'Review each conflicting setting before saving.' }); return false; }
    const { values, saved, profile } = this.snapshot, target = this.target, rawApproval = this.rawApproval;
    if (!target) { this.update({ error: this.snapshot.writeError || 'Cannot save without a verified configuration version.' }); return false; }
    const generation = ++this.generation;
    this.update({ saving: true, error: null, warning: null });
    try {
      await this.draftWrites;
      if (this.snapshot.draftStorageError) throw new Error('The newer edit could not be saved in the browser.');
      if (generation !== this.generation) return false;
      const [before, allowed] = await Promise.all([this.read(), this.requirements()]);
      const current = await this.targetFor(before);
      if (generation !== this.generation) return false;
      const beforeValues = { approval: valueOf(before.config.approval_policy, 'on-request'), sandbox: valueOf(before.config.sandbox_mode, 'read-only') };
      if (profileName(before.config.profile) !== profile || !matches(beforeValues, saved) ||
        JSON.stringify(before.config.approval_policy) !== JSON.stringify(rawApproval) ||
        !current.target || current.target.file !== target.file || current.target.profile !== target.profile || current.target.version !== target.version) {
        this.update({ saving: false, error: 'Configuration changed elsewhere. Reload and review your edits before saving.' }); return false;
      }
      if (values.approval !== saved.approval && !allowed.approvals.includes(values.approval as Approval) ||
        values.sandbox !== saved.sandbox && !allowed.sandboxes.includes(values.sandbox as Sandbox)) {
        this.update({ saving: false, ...allowed, error: 'Configuration requirements changed. Reload and review your edits before saving.' }); return false;
      }
      const edits: { keyPath: string; value: string; mergeStrategy: 'upsert' }[] = [];
      if (values.approval !== saved.approval) edits.push({ keyPath: 'approval_policy', value: values.approval, mergeStrategy: 'upsert' });
      if (values.sandbox !== saved.sandbox) edits.push({ keyPath: 'sandbox_mode', value: values.sandbox, mergeStrategy: 'upsert' });
      const submitted = await this.operations.submit(this.hostId, 'config/batchWrite',
        { edits, filePath: target.filePath, expectedVersion: target.version, reloadUserConfig: true },
        { section: 'agent', draft: { values, saved, profile, rawApproval, target } }, () => generation === this.generation);
      if (generation !== this.generation) return false;
      const result = submitted.result as { status: 'ok' | 'okOverridden'; overriddenMetadata?: { message?: string } | null };
      if (result?.status !== 'ok' && result?.status !== 'okOverridden') throw new Error('The host did not confirm the write');
      const after = await this.read(), afterTarget = await this.targetFor(after);
      if (generation !== this.generation) return false;
      const actual = { approval: valueOf(after.config.approval_policy, 'on-request'), sandbox: valueOf(after.config.sandbox_mode, 'read-only') };
      const confirmed = (values.approval === saved.approval || actual.approval === values.approval) &&
        (values.sandbox === saved.sandbox || actual.sandbox === values.sandbox) &&
        profileName(after.config.profile) === profile && afterTarget.target?.file === target.file;
      this.rawApproval = after.config.approval_policy;
      this.target = afterTarget.target;
      const nextValues = confirmed ? actual : {
        approval: values.approval !== saved.approval ? values.approval : actual.approval,
        sandbox: values.sandbox !== saved.sandbox ? values.sandbox : actual.sandbox,
      };
      const conflicts: AgentField[] = confirmed ? [] : (['approval', 'sandbox'] as AgentField[]).filter(field =>
        values[field] !== saved[field] && values[field] !== actual[field]);
      if (confirmed) await this.operations.finish(submitted.operationId);
      if (generation !== this.generation) return false;
      if (confirmed) this.draftTarget = null;
      this.update({ saving: false, saved: actual, writeError: afterTarget.error,
        values: nextValues, conflicts,
        warning: result.status === 'okOverridden' ? result.overriddenMetadata?.message || 'A higher-priority configuration overrides this change.' : null,
        error: confirmed ? null : 'The saved configuration differs from your edit. Review the effective values.' });
      return confirmed;
    } catch (error) { if (generation === this.generation) this.update({ saving: false, error: `Could not confirm save: ${message(error)}. Your edit is preserved.` }); return false; }
  }
}
