import type { WorkbenchClient } from '../workbench-contract.ts';
import { isConfigTarget, userConfigTarget } from './config-target.ts';
import type { ConfigTarget, ConfigTargetResult } from './config-target.ts';
import { createSettingsWriteId, SettingsConfigOperations, settingsConfigOperations } from './config-operations.ts';
import { configReadSource, sameConfigSource } from './config-source.ts';
import type { ConfigReadSource } from '../../../lib/config-write-protocol.ts';

export interface RemoteWorktreePreferences { root: string; autoCleanup: boolean; keepCount: number }
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
interface WorktreeConfigRead { config?: { desktop?: unknown; profile?: unknown }; layers?: unknown; yardConfigSource?: unknown }
interface WorktreeDraft { root: string; autoCleanup: boolean; keepCount: string }
type WorktreeField = keyof WorktreeDraft;
export interface RemoteWorktreeSnapshot {
  loading: boolean; saving: boolean; error: string | null; writeError: string | null; warning: string | null;
  saved: RemoteWorktreePreferences | null; draft: WorktreeDraft | null; profile: string | null;
  draftStorageError: string | null; draftSaving: boolean;
  conflicts: WorktreeField[];
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const draftFor = (value: RemoteWorktreePreferences): WorktreeDraft => ({ ...value, keepCount: String(value.keepCount) });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function readDesktop(result: WorktreeConfigRead): RemoteWorktreePreferences {
  if (!record(result?.config)) throw new Error('The host returned an invalid configuration response.');
  const desktop = result.config.desktop === undefined ? {} : result.config.desktop;
  if (!record(desktop)) throw new Error('The remote worktree configuration is invalid.');
  const root = desktop['git-worktree-root'], cleanup = desktop['worktree-auto-cleanup-enabled'], keep = desktop['worktree-keep-count'];
  if ((root !== undefined && typeof root !== 'string') || (cleanup !== undefined && typeof cleanup !== 'boolean') ||
    (keep !== undefined && (typeof keep !== 'number' || !Number.isSafeInteger(keep) || keep < 1))) {
    throw new Error('The remote worktree configuration contains an invalid value.');
  }
  return { root: root ?? '', autoCleanup: cleanup ?? true, keepCount: keep ?? 15 };
}

export async function readRemoteWorktreePreferences(client: WorkbenchClient, hostId: string): Promise<RemoteWorktreePreferences> {
  const result = await client.rpc<WorktreeConfigRead>('config/read', { includeLayers: false }, hostId);
  return readDesktop(result);
}

export class RemoteWorktreeSettings {
  private readonly client: WorkbenchClient;
  private readonly hostId: string;
  private readonly operations: SettingsConfigOperations;
  readonly editorId = createSettingsWriteId();
  private draftWrites: Promise<void> = Promise.resolve();
  private draftRevision: number | null = null;
  private conflictBaselines: Partial<WorktreeDraft> = {};
  private targetNeedsReview = false;
  private draftWriteCount = 0;
  private listeners = new Set<() => void>();
  private generation = 0;
  private target: ConfigTarget | null = null;
  private draftTarget: ConfigTarget | null = null;
  private source: ConfigReadSource | null = null;
  private draftSource: ConfigReadSource | null = null;
  private snapshot: RemoteWorktreeSnapshot = { loading: true, saving: false, error: null, writeError: null, warning: null,
    saved: null, draft: null, profile: null, draftStorageError: null, draftSaving: false, conflicts: [] };
  constructor(client: WorkbenchClient, hostId: string, operations = settingsConfigOperations(client)) {
    this.client = client; this.hostId = hostId; this.operations = operations;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<RemoteWorktreeSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  retryDraftPersistence() {
    if (this.snapshot.saving) return this.draftWrites;
    const { draft, saved, profile, conflicts } = this.snapshot;
    const copy = structuredClone({ draft, saved, profile, conflicts, conflictBaselines: this.conflictBaselines,
      target: this.draftTarget, source: this.draftSource, targetNeedsReview: this.targetNeedsReview });
    this.draftWriteCount++; this.update({ draftSaving: true });
    const dirty = this.dirty;
    this.draftWrites = this.draftWrites.then(() => dirty ? this.operations.saveDraft(this.hostId, 'worktrees', undefined, this.editorId, copy)
      : this.operations.clearEditorDraft(this.hostId, 'worktrees', undefined, this.editorId))
      .then(revision => { this.draftRevision = revision; this.update({ draftStorageError: null }); }, error => this.update({ draftStorageError: message(error) }))
      .finally(() => { if (--this.draftWriteCount === 0) this.update({ draftSaving: false }); });
    return this.draftWrites;
  }
  get dirty() { return Boolean(this.snapshot.saved && this.snapshot.draft && !same(draftFor(this.snapshot.saved), this.snapshot.draft)); }
  dispose() { this.generation++; }
  async restoreDraft(source: unknown): Promise<void> {
    if (this.dirty || this.snapshot.loading || this.snapshot.saving) throw new Error('Finish the current edit before restoring another copy.');
    if (!record(source) || !record(source.draft) || !record(source.saved)
      || typeof source.draft.root !== 'string' || typeof source.draft.autoCleanup !== 'boolean' || typeof source.draft.keepCount !== 'string'
      || typeof source.saved.root !== 'string' || typeof source.saved.autoCleanup !== 'boolean' || typeof source.saved.keepCount !== 'number'
      || !(source.profile === null || typeof source.profile === 'string') || !(source.target === null || isConfigTarget(source.target))) {
      throw new Error('The saved worktree edit has no verifiable baseline.');
    }
    const fields: WorktreeField[] = ['root', 'autoCleanup', 'keepCount'];
    if (source.conflicts !== undefined && (!Array.isArray(source.conflicts) || source.conflicts.some(field => !fields.includes(field)))) throw new Error('The saved worktree conflicts cannot be read.');
    const original = draftFor(source.saved as unknown as RemoteWorktreePreferences), savedDraft = source.draft as unknown as WorktreeDraft;
    const conflicts = source.conflicts === undefined ? fields.filter(field => savedDraft[field] !== original[field]) : source.conflicts as WorktreeField[];
    const baselines = source.conflictBaselines;
    if (baselines !== undefined && (!record(baselines) || (baselines.root !== undefined && typeof baselines.root !== 'string')
      || (baselines.keepCount !== undefined && typeof baselines.keepCount !== 'string')
      || (baselines.autoCleanup !== undefined && typeof baselines.autoCleanup !== 'boolean'))) throw new Error('The saved worktree conflict baseline cannot be read.');
    this.conflictBaselines = { ...(baselines as Partial<WorktreeDraft> | undefined) };
    for (const field of conflicts) if (!(field in this.conflictBaselines)) {
      if (field === 'autoCleanup') this.conflictBaselines[field] = original[field]; else this.conflictBaselines[field] = original[field];
    }
    this.draftTarget = source.target as ConfigTarget | null; this.draftSource = configReadSource(source.source, this.hostId);
    this.targetNeedsReview = !source.target || source.targetNeedsReview === true;
    this.update({ draft: source.draft as unknown as WorktreeDraft, saved: source.saved as unknown as RemoteWorktreePreferences, profile: source.profile, conflicts });
    await this.retryDraftPersistence(); await this.load();
  }
  private async read(): Promise<{ value: RemoteWorktreePreferences; profile: string | null; target: ConfigTargetResult; source: ConfigReadSource | null }> {
    const result = await this.client.rpc<WorktreeConfigRead>('config/read', { includeLayers: true }, this.hostId);
    const value = readDesktop(result);
    const rawProfile = result.config?.profile;
    if (rawProfile !== undefined && rawProfile !== null && typeof rawProfile !== 'string') throw new Error('The active configuration profile is invalid.');
    const profile = rawProfile || null;
    const source = configReadSource(result.yardConfigSource, this.hostId);
    return { value, profile, source, target: source ? userConfigTarget(result.layers, source.codexHome)
      : { target: null, error: 'Cannot save without the original configuration connection. Reload and review your edit.' } };
  }
  async load(reviewSource = false) {
    if (this.snapshot.saving) return;
    const generation = ++this.generation;
    this.update({ loading: true, error: null });
    try {
      const read = await this.read();
      if (generation !== this.generation) return;
      if (this.dirty && (!this.draftTarget || this.targetNeedsReview) && (!reviewSource || !read.source || !read.target.target)) {
        this.update({ loading: false, writeError: 'This edit has no verified configuration target. Reload and review your edit before saving.' }); return;
      }
      if (this.dirty && !sameConfigSource(this.draftSource, read.source) && (!reviewSource || !read.source)) {
        this.update({ loading: false, writeError: 'The configuration connection changed or is unavailable. Reload and review your edit.' }); return;
      }
      if (this.dirty && read.profile !== this.snapshot.profile) {
        this.update({ loading: false, error: 'The active profile changed. Discard your edits and reload before continuing.' }); return;
      }
      if (this.dirty && this.draftTarget && read.target.target && (this.draftTarget.file !== read.target.target.file
        || this.draftTarget.profile !== read.target.target.profile)) {
        this.update({ loading: false, error: 'The target configuration changed. Discard your edits before changing targets.' }); return;
      }
      const current = draftFor(read.value), previous = this.snapshot.draft, saved = this.snapshot.saved;
      const wasDirty = this.dirty;
      const draft = { ...current }, conflicts: WorktreeField[] = [];
      if (previous && saved) for (const field of ['root', 'autoCleanup', 'keepCount'] as const) {
        const baseline = draftFor(saved)[field];
        if (previous[field] === baseline || previous[field] === current[field]) continue;
        if (field === 'autoCleanup') draft[field] = previous[field] as boolean;
        else draft[field] = previous[field] as string;
        if (current[field] !== baseline || this.snapshot.conflicts.includes(field)) {
          conflicts.push(field);
          if (!(field in this.conflictBaselines)) {
            if (field === 'autoCleanup') this.conflictBaselines[field] = baseline as boolean; else this.conflictBaselines[field] = baseline as string;
          }
        }
      }
      for (const field of ['root', 'autoCleanup', 'keepCount'] as const) if (!conflicts.includes(field)) delete this.conflictBaselines[field];
      this.target = read.target.target;
      this.source = read.source;
      if (this.dirty && reviewSource) { this.draftSource = read.source; this.draftTarget = read.target.target; this.targetNeedsReview = false; }
      if (same(draft, current)) { this.draftTarget = null; this.targetNeedsReview = false; }
      this.update({ loading: false, saved: read.value, draft, conflicts,
        error: conflicts.length ? 'Some settings changed elsewhere. Review each conflict before saving.' : null,
        profile: read.profile, writeError: read.target.error });
      if (wasDirty || this.dirty) void this.retryDraftPersistence();
    } catch (error) { if (generation === this.generation) this.update({ loading: false, error: message(error) }); }
  }
  edit(patch: Partial<WorktreeDraft>) {
    if (this.snapshot.draft && !this.snapshot.saving && !this.snapshot.loading) {
      if (!this.dirty) { this.draftTarget = this.target; this.draftSource = this.source; this.targetNeedsReview = !this.target; }
      const draft = { ...this.snapshot.draft, ...patch };
      const saved = this.snapshot.saved && draftFor(this.snapshot.saved);
      const conflicts = this.snapshot.conflicts.filter(field => !saved || draft[field] !== saved[field]);
      for (const field of ['root', 'autoCleanup', 'keepCount'] as const) if (!conflicts.includes(field)) delete this.conflictBaselines[field];
      if (saved && same(draft, saved)) this.draftTarget = null;
      this.update({ draft, conflicts, error: conflicts.length ? this.snapshot.error : null, warning: null }); void this.retryDraftPersistence();
    }
  }
  resolveConflict(field: WorktreeField, choice: 'current' | 'draft') {
    if (!this.snapshot.draft || !this.snapshot.saved || !this.snapshot.conflicts.includes(field) || this.snapshot.saving) return;
    const current = draftFor(this.snapshot.saved);
    const draft = choice === 'current' ? { ...this.snapshot.draft, [field]: current[field] } : { ...this.snapshot.draft };
    const conflicts = this.snapshot.conflicts.filter(item => item !== field);
    delete this.conflictBaselines[field];
    if (same(draft, current)) this.draftTarget = null;
    this.update({ draft, conflicts, error: conflicts.length ? this.snapshot.error : null }); void this.retryDraftPersistence();
  }
  async discard(): Promise<boolean> {
    if (!this.snapshot.saved || this.snapshot.saving) return false;
    this.generation++; this.update({ saving: true, loading: false });
    try {
      await this.draftWrites;
      await this.operations.clearEditorDraft(this.hostId, 'worktrees', undefined, this.editorId);
      this.draftRevision = null; this.draftTarget = null; this.targetNeedsReview = false; this.conflictBaselines = {};
      this.update({ saving: false, draft: draftFor(this.snapshot.saved), conflicts: [], error: null, warning: null, draftStorageError: null }); return true;
    } catch (error) { this.update({ saving: false, draftStorageError: message(error) }); return false; }
  }
  async save(): Promise<boolean> {
    const { draft, saved, profile } = this.snapshot, target = this.target;
    if (!draft || !saved || !this.dirty || this.snapshot.saving || this.snapshot.loading) return false;
    if (this.snapshot.conflicts.length) { this.update({ error: 'Review each conflicting setting before saving.' }); return false; }
    const source = this.draftSource;
    if (!source) { this.update({ error: 'The original configuration connection is unavailable. Reload and review your edit.' }); return false; }
    if (!target || !this.draftTarget || this.targetNeedsReview) { this.update({ error: this.snapshot.writeError || 'Cannot save without a verified configuration version.' }); return false; }
    const root = draft.root.trim(), count = Number(draft.keepCount);
    const isWindows = /^[a-z]:[\\/]|^\\\\/i.test(target.file);
    if (root && !(isWindows ? /^(?:[a-z]:[\\/]|\\\\)/i : /^\//).test(root)) {
      this.update({ error: 'Enter an absolute path for the selected host.' }); return false;
    }
    if (!draft.keepCount.trim() || !Number.isSafeInteger(count)) { this.update({ error: 'Enter a whole number for the auto-delete limit.' }); return false; }
    const intended: RemoteWorktreePreferences = { root, autoCleanup: draft.autoCleanup, keepCount: Math.max(1, count) };
    const generation = ++this.generation;
    this.update({ saving: true, error: null, warning: null });
    try {
      await this.draftWrites;
      if (this.snapshot.draftStorageError) throw new Error('The newer edit could not be saved in the browser.');
      if (this.draftRevision === null) throw new Error('The current edit has no saved browser revision.');
      if (generation !== this.generation) return false;
      const before = await this.read(), currentTarget = before.target.target;
      if (!sameConfigSource(source, before.source)) {
        this.update({ saving: false, writeError: 'The configuration connection changed. Reload and review your edit.' }); return false;
      }
      if (generation !== this.generation) return false;
      if (before.profile !== profile || !same(before.value, saved) || !currentTarget || currentTarget.file !== target.file ||
        currentTarget.profile !== target.profile || currentTarget.version !== target.version) {
        this.update({ saving: false, error: 'The target configuration changed. Reload and review your edits before saving.' }); return false;
      }
      const edits: { keyPath: string; value: string | boolean | number; mergeStrategy: 'replace' }[] = [];
      if (intended.root !== saved.root) edits.push({ keyPath: 'desktop.git-worktree-root', value: intended.root, mergeStrategy: 'replace' });
      if (intended.autoCleanup !== saved.autoCleanup) edits.push({ keyPath: 'desktop.worktree-auto-cleanup-enabled', value: intended.autoCleanup, mergeStrategy: 'replace' });
      if (intended.keepCount !== saved.keepCount) edits.push({ keyPath: 'desktop.worktree-keep-count', value: intended.keepCount, mergeStrategy: 'replace' });
      if (!edits.length) {
        await this.operations.clearEditorDraft(this.hostId, 'worktrees', undefined, this.editorId);
        this.draftRevision = null; this.draftTarget = null; this.targetNeedsReview = false; this.conflictBaselines = {};
        this.update({ saving: false, draft: draftFor(saved), draftStorageError: null }); return true;
      }
      const submitted = await this.operations.submit(this.hostId, 'config/batchWrite', {
        edits, filePath: target.filePath, expectedVersion: target.version, reloadUserConfig: true,
      }, { section: 'worktrees', editorId: this.editorId, revision: this.draftRevision, source, draft: { draft, saved, profile, target, source } }, () => generation === this.generation);
      if (generation !== this.generation) return false;
      const result = submitted.result as { status: 'ok' | 'okOverridden'; version?: string; overriddenMetadata?: { message?: string } | null };
      if (result?.status !== 'ok' && result?.status !== 'okOverridden') throw new Error('The host did not confirm the write');
      const after = await this.read();
      if (!sameConfigSource(source, after.source)) throw new Error('The configuration connection changed after the save. Check the original operation.');
      if (generation !== this.generation) return false;
      const fields: WorktreeField[] = ['root', 'autoCleanup', 'keepCount'];
      const matches = fields.every(field => intended[field] === saved[field] || intended[field] === after.value[field])
        && after.profile === profile && after.target.target?.file === target.file;
      const current = draftFor(after.value), previous = draftFor(saved), next = { ...current }, conflicts: WorktreeField[] = [];
      for (const field of fields) if (intended[field] !== saved[field] && intended[field] !== after.value[field]) {
        conflicts.push(field);
        if (field === 'autoCleanup') { next[field] = draft[field]; this.conflictBaselines[field] = previous[field]; }
        else { next[field] = draft[field]; this.conflictBaselines[field] = previous[field]; }
      }
      if (matches) await this.operations.finish(submitted.operationId, { consumeSubmittedDraft: true });
      if (generation !== this.generation) return false;
      this.target = after.target.target;
      if (matches) { this.draftTarget = null; this.draftRevision = null; this.conflictBaselines = {}; }
      this.update({ saving: false, saved: after.value, draft: matches ? current : next, conflicts, writeError: after.target.error,
        warning: result.status === 'okOverridden' ? result.overriddenMetadata?.message || 'A higher-priority configuration overrides this change.' : null,
        error: matches ? null : 'The saved configuration differs from your edit. Review the effective values.' });
      if (!matches && this.dirty) void this.retryDraftPersistence();
      return matches;
    } catch (error) {
      if (generation === this.generation) this.update({ saving: false, error: `Could not confirm save: ${message(error)}. Your edit is preserved.` });
      return false;
    }
  }
}
