import type { WorkbenchClient } from '../workbench-contract.ts';
import { isConfigTarget, userConfigTarget } from './config-target.ts';
import type { ConfigTarget, ConfigTargetResult } from './config-target.ts';
import { createSettingsWriteId, latestSettingsDraft, SettingsConfigOperations, settingsConfigOperations } from './config-operations.ts';

export interface RemoteWorktreePreferences { root: string; autoCleanup: boolean; keepCount: number }
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
interface WorktreeConfigRead { config?: { desktop?: unknown; profile?: unknown }; layers?: unknown }
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
  private restored = false;
  private readonly editorId = createSettingsWriteId();
  private draftWrites: Promise<void> = Promise.resolve();
  private draftWriteCount = 0;
  private listeners = new Set<() => void>();
  private generation = 0;
  private target: ConfigTarget | null = null;
  private draftTarget: ConfigTarget | null = null;
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
    const { draft, saved, profile } = this.snapshot;
    const copy = structuredClone({ draft, saved, profile, target: this.draftTarget ?? this.target });
    this.draftWriteCount++; this.update({ draftSaving: true });
    this.draftWrites = this.draftWrites.then(() => this.operations.saveDraft(this.hostId, 'worktrees', undefined, this.editorId, copy))
      .then(() => this.update({ draftStorageError: null }), error => this.update({ draftStorageError: message(error) }))
      .finally(() => { if (--this.draftWriteCount === 0) this.update({ draftSaving: false }); });
    return this.draftWrites;
  }
  get dirty() { return Boolean(this.snapshot.saved && this.snapshot.draft && !same(draftFor(this.snapshot.saved), this.snapshot.draft)); }
  dispose() { this.generation++; }
  private async read(): Promise<{ value: RemoteWorktreePreferences; profile: string | null; target: ConfigTargetResult }> {
    const result = await this.client.rpc<WorktreeConfigRead>('config/read', { includeLayers: true }, this.hostId);
    const value = readDesktop(result);
    const rawProfile = result.config?.profile;
    if (rawProfile !== undefined && rawProfile !== null && typeof rawProfile !== 'string') throw new Error('The active configuration profile is invalid.');
    const profile = rawProfile || null;
    try {
      const home = await this.client.host<{ codexHome?: unknown }>('codex-home', { hostId: this.hostId });
      return { value, profile, target: userConfigTarget(result.layers, home?.codexHome) };
    } catch {
      return { value, profile, target: { target: null, error: 'Cannot save: the selected host did not provide its configuration home and version.' } };
    }
  }
  async load() {
    if (this.snapshot.saving) return;
    const generation = ++this.generation;
    this.update({ loading: true, error: null });
    try {
      if (!this.restored) {
        const previous = await this.operations.find(this.hostId, 'worktrees'), source = previous && latestSettingsDraft(previous);
        if (generation !== this.generation) return;
        if (record(source) && record(source.draft) && record(source.saved)
          && typeof source.draft.root === 'string' && typeof source.draft.autoCleanup === 'boolean' && typeof source.draft.keepCount === 'string'
          && typeof source.saved.root === 'string' && typeof source.saved.autoCleanup === 'boolean' && typeof source.saved.keepCount === 'number'
          && (source.profile === null || typeof source.profile === 'string')) {
          if (!isConfigTarget(source.target)) throw new Error('The saved worktree edit has no verifiable configuration target.');
          this.snapshot = { ...this.snapshot, draft: source.draft as unknown as WorktreeDraft,
            saved: source.saved as unknown as RemoteWorktreePreferences, profile: source.profile };
          this.draftTarget = source.target;
        } else if (previous) throw new Error('The saved worktree edit cannot be read.');
        this.restored = true;
      }
      const read = await this.read();
      if (generation !== this.generation) return;
      if (this.dirty && read.profile !== this.snapshot.profile) {
        this.update({ loading: false, error: 'The active profile changed. Discard your edits and reload before continuing.' }); return;
      }
      if (this.dirty && this.draftTarget && read.target.target && (this.draftTarget.file !== read.target.target.file
        || this.draftTarget.profile !== read.target.target.profile)) {
        this.update({ loading: false, error: 'The target configuration changed. Discard your edits before changing targets.' }); return;
      }
      const current = draftFor(read.value), previous = this.snapshot.draft, saved = this.snapshot.saved;
      const draft = { ...current }, conflicts: WorktreeField[] = [];
      if (previous && saved) for (const field of ['root', 'autoCleanup', 'keepCount'] as const) {
        const baseline = draftFor(saved)[field];
        if (previous[field] === baseline || previous[field] === current[field]) continue;
        if (field === 'autoCleanup') draft[field] = previous[field] as boolean;
        else draft[field] = previous[field] as string;
        if (current[field] !== baseline || this.snapshot.conflicts.includes(field)) conflicts.push(field);
      }
      this.target = read.target.target;
      if (same(draft, current)) this.draftTarget = null; else this.draftTarget ??= read.target.target;
      this.update({ loading: false, saved: read.value, draft, conflicts,
        error: conflicts.length ? 'Some settings changed elsewhere. Review each conflict before saving.' : null,
        profile: read.profile, writeError: read.target.error });
    } catch (error) { if (generation === this.generation) this.update({ loading: false, error: message(error) }); }
  }
  edit(patch: Partial<WorktreeDraft>) {
    if (this.snapshot.draft && !this.snapshot.saving && !this.snapshot.loading) {
      if (!this.dirty) this.draftTarget = this.target;
      const draft = { ...this.snapshot.draft, ...patch };
      const saved = this.snapshot.saved && draftFor(this.snapshot.saved);
      const conflicts = this.snapshot.conflicts.filter(field => !saved || draft[field] !== saved[field]);
      if (saved && same(draft, saved)) this.draftTarget = null;
      this.update({ draft, conflicts, error: conflicts.length ? this.snapshot.error : null, warning: null }); void this.retryDraftPersistence();
    }
  }
  resolveConflict(field: WorktreeField, choice: 'current' | 'draft') {
    if (!this.snapshot.draft || !this.snapshot.saved || !this.snapshot.conflicts.includes(field) || this.snapshot.saving) return;
    const current = draftFor(this.snapshot.saved);
    const draft = choice === 'current' ? { ...this.snapshot.draft, [field]: current[field] } : { ...this.snapshot.draft };
    const conflicts = this.snapshot.conflicts.filter(item => item !== field);
    if (same(draft, current)) this.draftTarget = null;
    this.update({ draft, conflicts, error: conflicts.length ? this.snapshot.error : null }); void this.retryDraftPersistence();
  }
  discard() {
    if (this.snapshot.saved && !this.snapshot.saving) { this.draftTarget = null; this.update({ draft: draftFor(this.snapshot.saved), conflicts: [], error: null, warning: null }); void this.retryDraftPersistence(); }
  }
  async save(): Promise<boolean> {
    const { draft, saved, profile } = this.snapshot, target = this.target;
    if (!draft || !saved || !this.dirty || this.snapshot.saving || this.snapshot.loading) return false;
    if (this.snapshot.conflicts.length) { this.update({ error: 'Review each conflicting setting before saving.' }); return false; }
    if (!target) { this.update({ error: this.snapshot.writeError || 'Cannot save without a verified configuration version.' }); return false; }
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
      if (generation !== this.generation) return false;
      const before = await this.read(), currentTarget = before.target.target;
      if (generation !== this.generation) return false;
      if (before.profile !== profile || !same(before.value, saved) || !currentTarget || currentTarget.file !== target.file ||
        currentTarget.profile !== target.profile || currentTarget.version !== target.version) {
        this.update({ saving: false, error: 'The target configuration changed. Reload and review your edits before saving.' }); return false;
      }
      const edits: { keyPath: string; value: string | boolean | number; mergeStrategy: 'replace' }[] = [];
      if (intended.root !== saved.root) edits.push({ keyPath: 'desktop.git-worktree-root', value: intended.root, mergeStrategy: 'replace' });
      if (intended.autoCleanup !== saved.autoCleanup) edits.push({ keyPath: 'desktop.worktree-auto-cleanup-enabled', value: intended.autoCleanup, mergeStrategy: 'replace' });
      if (intended.keepCount !== saved.keepCount) edits.push({ keyPath: 'desktop.worktree-keep-count', value: intended.keepCount, mergeStrategy: 'replace' });
      if (!edits.length) { this.update({ saving: false, draft: draftFor(saved) }); return true; }
      const submitted = await this.operations.submit(this.hostId, 'config/batchWrite', {
        edits, filePath: target.filePath, expectedVersion: target.version, reloadUserConfig: true,
      }, { section: 'worktrees', draft: { draft, saved, profile, target } }, () => generation === this.generation);
      if (generation !== this.generation) return false;
      const result = submitted.result as { status: 'ok' | 'okOverridden'; version?: string; overriddenMetadata?: { message?: string } | null };
      if (result?.status !== 'ok' && result?.status !== 'okOverridden') throw new Error('The host did not confirm the write');
      const after = await this.read();
      if (generation !== this.generation) return false;
      const matches = same(after.value, intended) && after.profile === profile && after.target.target?.file === target.file;
      if (matches) await this.operations.finish(submitted.operationId);
      if (generation !== this.generation) return false;
      this.target = after.target.target;
      if (matches) this.draftTarget = null;
      this.update({ saving: false, saved: after.value, draft: matches ? draftFor(after.value) : draft, writeError: after.target.error,
        warning: result.status === 'okOverridden' ? result.overriddenMetadata?.message || 'A higher-priority configuration overrides this change.' : null,
        error: matches ? null : 'The saved configuration differs from your edit. Review the effective values.' });
      return matches;
    } catch (error) {
      if (generation === this.generation) this.update({ saving: false, error: `Could not confirm save: ${message(error)}. Your edit is preserved.` });
      return false;
    }
  }
}
