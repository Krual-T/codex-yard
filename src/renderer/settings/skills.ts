import type { WorkbenchClient } from '../workbench-contract.ts';
import { validScopePath } from './scope.ts';
import { createSettingsWriteId, SettingsConfigOperations, SettingsWriteError, settingsConfigOperations } from './config-operations.ts';
import type { WriteStatus } from './config-operations.ts';
import { configReadSource, sameConfigSource } from './config-source.ts';
import type { ConfigReadSource } from '../../../lib/config-write-protocol.ts';

export interface SkillEntry {
  id: string; name: string; displayName: string; description: string; path: string;
  scope: string; pluginId: string | null; enabled: boolean;
}
interface SkillRead { skills: SkillEntry[]; warnings: string[]; source: ConfigReadSource | null }
export interface SkillDraft { id: string; enabled: boolean }
export interface SkillSnapshot {
  loading: boolean; saving: boolean; skills: SkillEntry[]; warnings: string[]; drafts: SkillDraft[];
  latest: SkillEntry[] | null; needsRefresh: boolean; writeUncertain: boolean; error: string | null;
  draftStorageError: string | null; draftSaving: boolean;
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const selector = (skill: SkillEntry): { name: string } | { path: string } => skill.name.includes(':') ? { name: skill.name } : { path: skill.path };
const selectorKey = (skill: SkillEntry) => JSON.stringify(selector(skill));
export const canEditSkill = (skill: SkillEntry, skills: SkillEntry[]) => skills.filter(other => selectorKey(other) === selectorKey(skill)).length === 1;

function parseSkill(value: unknown): SkillEntry {
  if (!record(value) || typeof value.name !== 'string' || !value.name || typeof value.path !== 'string' || !value.path
    || typeof value.description !== 'string' || typeof value.scope !== 'string' || !value.scope || typeof value.enabled !== 'boolean'
    || !(value.pluginId == null || typeof value.pluginId === 'string')
    || !(value.interface == null || record(value.interface))) throw new Error('Invalid skill response');
  const details = value.interface;
  if (record(details) && !(details.displayName == null || typeof details.displayName === 'string')) throw new Error('Invalid skill response');
  return { id: JSON.stringify([value.path, value.name]), name: value.name,
    displayName: record(details) && typeof details.displayName === 'string' && details.displayName ? details.displayName : value.name,
    description: value.description, path: value.path, scope: value.scope, pluginId: value.pluginId ?? null, enabled: value.enabled };
}

async function readSkills(client: WorkbenchClient, hostId: string, cwds: readonly string[]): Promise<SkillRead> {
  if (!cwds.length || !cwds.every(validScopePath)) throw new Error('Select a project or session with a working directory.');
  const result = await client.rpc<{ data: unknown; yardConfigSource?: unknown }>('skills/list', { cwds, forceReload: true }, hostId);
  if (!Array.isArray(result?.data)) throw new Error('Invalid skills response');
  const unique = new Map<string, SkillEntry>(), warnings: string[] = [];
  for (const group of result.data) {
    if (!record(group) || typeof group.cwd !== 'string' || !Array.isArray(group.skills) || !Array.isArray(group.errors)) throw new Error('Invalid skills response');
    for (const value of group.skills) {
      const skill = parseSkill(value), previous = unique.get(skill.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(skill)) throw new Error('The host returned conflicting skill states');
      unique.set(skill.id, skill);
    }
    for (const error of group.errors) {
      if (!record(error) || typeof error.path !== 'string' || typeof error.message !== 'string') throw new Error('Invalid skill error');
      warnings.push(`${error.path}: ${error.message}`);
    }
  }
  return { skills: [...unique.values()], warnings, source: configReadSource(result.yardConfigSource, hostId) };
}

export class SkillSettings {
  private readonly client: WorkbenchClient;
  private readonly hostId: string;
  private readonly cwds: readonly string[];
  private readonly operations: SettingsConfigOperations;
  private originalId: string | null = null;
  private resolvedOriginalId: string | null = null;
  private originalBlocker: WriteStatus | null = null;
  readonly editorId = createSettingsWriteId();
  private draftWrites: Promise<void> = Promise.resolve();
  private draftWriteCount = 0;
  private readonly listeners = new Set<() => void>();
  private snapshot: SkillSnapshot = { loading: true, saving: false, skills: [], warnings: [], drafts: [], latest: null, needsRefresh: false, writeUncertain: false, error: null, draftStorageError: null, draftSaving: false };
  private latestRead: SkillRead | null = null;
  private source: ConfigReadSource | null = null;
  private generation = 0;
  private invalidated = false;
  private writeInFlight = false;
  constructor(client: WorkbenchClient, hostId: string, cwds: readonly string[], operations = settingsConfigOperations(client)) {
    this.client = client; this.hostId = hostId; this.cwds = [...cwds]; this.operations = operations;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<SkillSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; for (const listener of this.listeners) listener(); }
  retryDraftPersistence() {
    const draft = structuredClone({ drafts: this.snapshot.drafts, skills: this.snapshot.skills, source: this.source });
    this.draftWriteCount++; this.update({ draftSaving: true });
    const dirty = this.dirty;
    this.draftWrites = this.draftWrites.then(() => dirty ? this.operations.saveDraft(this.hostId, 'skills-settings', this.cwds, this.editorId, draft)
      : this.operations.clearEditorDraft(this.hostId, 'skills-settings', this.cwds, this.editorId))
      .then(() => this.update({ draftStorageError: null }), error => this.update({ draftStorageError: errorText(error) }))
      .finally(() => { if (--this.draftWriteCount === 0) this.update({ draftSaving: false }); });
    return this.draftWrites;
  }
  get dirty() { return this.snapshot.drafts.length > 0; }
  async restoreDraft(value: unknown): Promise<void> {
    if (this.dirty || this.snapshot.loading || this.snapshot.saving) throw new Error('Finish the current edit before restoring another copy.');
    if (!record(value) || !Array.isArray(value.drafts) || !value.drafts.every((item: unknown) =>
      record(item) && typeof item.id === 'string' && typeof item.enabled === 'boolean')) throw new Error('The saved skill edits cannot be read.');
    const skills = Array.isArray(value.skills) && value.skills.every((item: unknown) => record(item) && typeof item.id === 'string'
      && typeof item.name === 'string' && typeof item.path === 'string' && typeof item.enabled === 'boolean' && typeof item.scope === 'string')
      ? value.skills as SkillEntry[] : this.snapshot.skills;
    this.source = configReadSource(value.source, this.hostId);
    this.update({ drafts: value.drafts as SkillDraft[], skills, needsRefresh: true });
    await this.retryDraftPersistence(); await this.load();
  }
  dispose() {
    this.generation++; this.invalidated = false;
    if (this.snapshot.saving) this.update({ saving: false, loading: false, needsRefresh: true,
      writeUncertain: this.snapshot.writeUncertain || this.writeInFlight,
      error: this.writeInFlight ? null :
        'The save was interrupted. Refresh and review your edits before saving.' });
    else if (this.snapshot.loading) this.update({ loading: false });
  }
  invalidate() {
    if (this.snapshot.saving || this.snapshot.loading) { this.invalidated = true; return; }
    void this.load();
  }
  private refreshIfInvalidated() {
    if (this.invalidated && !this.snapshot.saving && !this.snapshot.loading) {
      this.invalidated = false; void this.load();
    }
  }
  private changed(read: SkillRead): boolean {
    return !sameConfigSource(this.source, read.source) || this.snapshot.drafts.some(draft => {
      const previous = this.snapshot.skills.find(skill => skill.id === draft.id), current = read.skills.find(skill => skill.id === draft.id);
      return !previous || !current || !canEditSkill(current, read.skills) || previous.enabled !== current.enabled
        || previous.scope !== current.scope || previous.pluginId !== current.pluginId;
    });
  }
  async load(): Promise<void> {
    if (this.snapshot.saving) return;
    const generation = ++this.generation;
    this.update({ loading: true, error: null });
    try {
      const previous = await this.operations.find(this.hostId, 'skills-settings', this.cwds);
      if (generation !== this.generation) return;
      const unresolved = !!previous && (previous.phase === 'pending' || previous.phase === 'unknown' || previous.phase === 'blocked' || !!previous.operation?.storageError);
      if (!this.originalId && previous) this.originalId = previous.operationId;
      if (previous?.operationId === this.originalId && previous.blocker) this.originalBlocker = previous.blocker;
      let resolved = !!previous && previous.operationId === this.originalId && !unresolved;
      if (this.snapshot.writeUncertain && this.originalId && !resolved && previous?.operationId !== this.originalId) {
        const blocker = this.originalBlocker;
        resolved = this.resolvedOriginalId === this.originalId
          || !!(blocker?.method && await this.operations.originalFinished(blocker.hostId, blocker.operationId, blocker.method))
          || !blocker && await this.operations.originalFinished(this.hostId, this.originalId, 'skills/config/write');
        if (generation !== this.generation) return;
      }
      if (unresolved && previous?.operationId === this.originalId) {
        this.snapshot = { ...this.snapshot, writeUncertain: true, needsRefresh: true };
      } else if (this.snapshot.writeUncertain && resolved) {
        this.snapshot = { ...this.snapshot, writeUncertain: false, needsRefresh: true };
      }
      const read = await readSkills(this.client, this.hostId, this.cwds);
      if (generation !== this.generation) return;
      if (this.dirty && (this.snapshot.latest || this.snapshot.needsRefresh || this.changed(read))) {
        this.latestRead = read;
        this.update({ loading: false, skills: this.snapshot.skills.length ? this.snapshot.skills : read.skills, latest: read.skills, warnings: read.warnings,
          error: 'Skill settings changed or the last save could not be confirmed. Review the current state before saving.' });
      } else {
        this.latestRead = null; this.source = read.source;
        this.update({ loading: false, skills: read.skills, warnings: read.warnings, latest: null, needsRefresh: this.snapshot.writeUncertain });
      }
    } catch (error) { if (generation === this.generation) this.update({ loading: false, error: `Could not load skills: ${errorText(error)}` }); }
    finally { if (generation === this.generation) this.refreshIfInvalidated(); }
  }
  edit(id: string, enabled: boolean) {
    if (this.snapshot.loading || this.snapshot.saving || this.snapshot.latest || this.snapshot.needsRefresh || this.snapshot.writeUncertain) return;
    const skill = this.snapshot.skills.find(item => item.id === id);
    if (!skill || !canEditSkill(skill, this.snapshot.skills)) return;
    const drafts = this.snapshot.drafts.filter(item => item.id !== id);
    if (skill.enabled !== enabled) drafts.push({ id, enabled });
    this.update({ drafts, error: null });
    void this.retryDraftPersistence();
  }
  discard() {
    if (this.snapshot.saving || this.snapshot.writeUncertain) return;
    const latest = this.latestRead, refresh = this.snapshot.needsRefresh && !latest;
    if (latest) this.source = latest.source;
    this.latestRead = null;
    this.update({ drafts: [], skills: latest?.skills ?? this.snapshot.skills, warnings: latest?.warnings ?? this.snapshot.warnings,
      latest: null, needsRefresh: refresh || this.snapshot.writeUncertain, error: null });
    void this.retryDraftPersistence();
    if (refresh) void this.load();
  }
  useLatest() {
    const latest = this.latestRead;
    if (!latest || this.snapshot.writeUncertain) return;
    if (!latest.source) { this.update({ error: 'The configuration connection is unavailable. Refresh and review your edits.' }); return; }
    if (this.snapshot.drafts.some(draft => {
      const skill = latest.skills.find(item => item.id === draft.id);
      return !skill || !canEditSkill(skill, latest.skills);
    })) {
      this.update({ error: 'An edited skill is missing or has an ambiguous selector. Discard edits and refresh before continuing.' }); return;
    }
    const drafts = this.snapshot.drafts.filter(draft => latest.skills.find(skill => skill.id === draft.id)?.enabled !== draft.enabled);
    this.source = latest.source; this.latestRead = null;
    this.update({ skills: latest.skills, warnings: latest.warnings, drafts, latest: null, needsRefresh: false, error: null });
    void this.retryDraftPersistence();
  }
  async save(): Promise<boolean> {
    if (!this.dirty || this.snapshot.saving || this.snapshot.loading || this.snapshot.latest || this.snapshot.needsRefresh || this.snapshot.writeUncertain) return false;
    const source = this.source;
    if (!source) { this.update({ error: 'The original configuration connection is unavailable. Refresh and review your edits.' }); return false; }
    const generation = ++this.generation, drafts = this.snapshot.drafts;
    let writeInFlight = false;
    const completed: string[] = [];
    this.update({ saving: true, error: null });
    try {
      await this.draftWrites;
      if (this.snapshot.draftStorageError) throw new Error('The newer edit could not be saved in the browser.');
      if (generation !== this.generation) return false;
      const before = await readSkills(this.client, this.hostId, this.cwds);
      if (generation !== this.generation) return false;
      if (this.changed(before)) {
        this.latestRead = before;
        this.update({ saving: false, latest: before.skills, warnings: before.warnings, error: 'Skill settings changed elsewhere. Review the current state before saving.' });
        return false;
      }
      for (const draft of drafts) {
        const skill = before.skills.find(item => item.id === draft.id);
        if (!skill || !canEditSkill(skill, before.skills)) throw new Error('The skill selector is no longer unique');
        writeInFlight = true;
        this.writeInFlight = true;
        let result: { effectiveEnabled?: unknown };
        try {
          const submitted = await this.operations.submit(this.hostId, 'skills/config/write', { ...selector(skill), enabled: draft.enabled },
            { section: 'skills-settings', scope: this.cwds, editorId: this.editorId, source, draft: { drafts, source } }, () => generation === this.generation,
            id => { this.originalId = id; this.resolvedOriginalId = null; this.originalBlocker = null; });
          if (this.originalId === submitted.operationId) this.resolvedOriginalId = submitted.operationId;
          result = submitted.result as { effectiveEnabled?: unknown };
          completed.push(submitted.operationId);
        }
        finally { this.writeInFlight = false; }
        writeInFlight = false;
        if (generation !== this.generation) return false;
        if (result?.effectiveEnabled !== draft.enabled) throw new Error('The host reported a different effective skill state');
      }
      const after = await readSkills(this.client, this.hostId, this.cwds);
      if (generation !== this.generation) return false;
      if (!sameConfigSource(source, after.source) || drafts.some(draft => {
        const previous = before.skills.find(skill => skill.id === draft.id), current = after.skills.find(skill => skill.id === draft.id);
        return !previous || !current || !canEditSkill(current, after.skills) || current.enabled !== draft.enabled
          || current.scope !== previous.scope || current.pluginId !== previous.pluginId;
      })) {
        this.latestRead = after;
        this.update({ saving: false, latest: after.skills, warnings: after.warnings, needsRefresh: true,
          error: 'The host reported different skill settings after saving. Review the current state.' }); return false;
      }
      await this.operations.finishSuccessfulGroup(completed);
      if (generation !== this.generation) return false;
      this.latestRead = null;
      this.update({ saving: false, skills: after.skills, warnings: after.warnings, drafts: [], latest: null, needsRefresh: false, error: null });
      return true;
    } catch (error) {
      if (error instanceof SettingsWriteError && error.operationId && this.originalId === error.operationId) {
        this.resolvedOriginalId = error.uncertain ? null : error.operationId;
        this.originalBlocker = error.blocker ?? null;
      }
      const uncertain = error instanceof SettingsWriteError ? error.uncertain : writeInFlight;
      if (generation === this.generation) this.update({ saving: false, needsRefresh: true, writeUncertain: uncertain,
        error: uncertain ? `Could not confirm save: ${errorText(error)}. Your edits are preserved; the host must confirm the previous operation has ended before another save.` :
          `Could not confirm save: ${errorText(error)}. Your edits are preserved; refresh and review the current state.` });
      return false;
    } finally { if (generation === this.generation) this.refreshIfInvalidated(); }
  }
}
