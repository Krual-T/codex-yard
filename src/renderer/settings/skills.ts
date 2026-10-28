import type { WorkbenchClient } from '../workbench-contract.ts';

export interface SkillEntry {
  id: string; name: string; displayName: string; description: string; path: string;
  scope: string; pluginId: string | null; enabled: boolean;
}
interface SkillRead { skills: SkillEntry[]; warnings: string[] }
export interface SkillDraft { id: string; enabled: boolean }
export interface SkillSnapshot {
  loading: boolean; saving: boolean; skills: SkillEntry[]; warnings: string[]; drafts: SkillDraft[];
  latest: SkillEntry[] | null; needsRefresh: boolean; error: string | null;
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

async function readSkills(client: WorkbenchClient, hostId: string, cwd: string): Promise<SkillRead> {
  const result = await client.rpc<{ data: unknown }>('skills/list', { cwds: cwd ? [cwd] : [], forceReload: true }, hostId);
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
  return { skills: [...unique.values()], warnings };
}

export class SkillSettings {
  private readonly client: WorkbenchClient;
  private readonly hostId: string;
  private readonly cwd: string;
  private readonly listeners = new Set<() => void>();
  private snapshot: SkillSnapshot = { loading: true, saving: false, skills: [], warnings: [], drafts: [], latest: null, needsRefresh: false, error: null };
  private latestRead: SkillRead | null = null;
  private generation = 0;
  private invalidated = false;
  constructor(client: WorkbenchClient, hostId: string, cwd: string) { this.client = client; this.hostId = hostId; this.cwd = cwd; }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<SkillSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; for (const listener of this.listeners) listener(); }
  get dirty() { return this.snapshot.drafts.length > 0; }
  dispose() { this.generation++; this.invalidated = false; }
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
    return this.snapshot.drafts.some(draft => {
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
      const read = await readSkills(this.client, this.hostId, this.cwd);
      if (generation !== this.generation) return;
      if (this.dirty && (this.snapshot.latest || this.snapshot.needsRefresh || this.changed(read))) {
        this.latestRead = read;
        this.update({ loading: false, latest: read.skills, warnings: read.warnings,
          error: 'Skill settings changed or the last save could not be confirmed. Review the current state before saving.' });
      } else {
        this.latestRead = null;
        this.update({ loading: false, skills: read.skills, warnings: read.warnings, latest: null, needsRefresh: false });
      }
    } catch (error) { if (generation === this.generation) this.update({ loading: false, error: `Could not load skills: ${errorText(error)}` }); }
    finally { if (generation === this.generation) this.refreshIfInvalidated(); }
  }
  edit(id: string, enabled: boolean) {
    if (this.snapshot.loading || this.snapshot.saving || this.snapshot.latest || this.snapshot.needsRefresh) return;
    const skill = this.snapshot.skills.find(item => item.id === id);
    if (!skill || !canEditSkill(skill, this.snapshot.skills)) return;
    const drafts = this.snapshot.drafts.filter(item => item.id !== id);
    if (skill.enabled !== enabled) drafts.push({ id, enabled });
    this.update({ drafts, error: null });
  }
  discard() {
    if (this.snapshot.saving) return;
    const latest = this.latestRead, refresh = this.snapshot.needsRefresh && !latest;
    this.latestRead = null;
    this.update({ drafts: [], skills: latest?.skills ?? this.snapshot.skills, warnings: latest?.warnings ?? this.snapshot.warnings,
      latest: null, needsRefresh: refresh, error: null });
    if (refresh) void this.load();
  }
  useLatest() {
    const latest = this.latestRead;
    if (!latest) return;
    if (this.snapshot.drafts.some(draft => {
      const skill = latest.skills.find(item => item.id === draft.id);
      return !skill || !canEditSkill(skill, latest.skills);
    })) {
      this.update({ error: 'An edited skill is missing or has an ambiguous selector. Discard edits and refresh before continuing.' }); return;
    }
    const drafts = this.snapshot.drafts.filter(draft => latest.skills.find(skill => skill.id === draft.id)?.enabled !== draft.enabled);
    this.latestRead = null;
    this.update({ skills: latest.skills, warnings: latest.warnings, drafts, latest: null, needsRefresh: false, error: null });
  }
  async save(): Promise<boolean> {
    if (!this.dirty || this.snapshot.saving || this.snapshot.loading || this.snapshot.latest || this.snapshot.needsRefresh) return false;
    const generation = ++this.generation, drafts = this.snapshot.drafts;
    this.update({ saving: true, error: null });
    try {
      const before = await readSkills(this.client, this.hostId, this.cwd);
      if (generation !== this.generation) return false;
      if (this.changed(before)) {
        this.latestRead = before;
        this.update({ saving: false, latest: before.skills, warnings: before.warnings, error: 'Skill settings changed elsewhere. Review the current state before saving.' });
        return false;
      }
      for (const draft of drafts) {
        const skill = before.skills.find(item => item.id === draft.id);
        if (!skill || !canEditSkill(skill, before.skills)) throw new Error('The skill selector is no longer unique');
        const result = await this.client.rpc<{ effectiveEnabled?: unknown }>('skills/config/write', { ...selector(skill), enabled: draft.enabled }, this.hostId);
        if (generation !== this.generation) return false;
        if (result?.effectiveEnabled !== draft.enabled) throw new Error('The host reported a different effective skill state');
      }
      const after = await readSkills(this.client, this.hostId, this.cwd);
      if (generation !== this.generation) return false;
      if (drafts.some(draft => {
        const previous = before.skills.find(skill => skill.id === draft.id), current = after.skills.find(skill => skill.id === draft.id);
        return !previous || !current || !canEditSkill(current, after.skills) || current.enabled !== draft.enabled
          || current.scope !== previous.scope || current.pluginId !== previous.pluginId;
      })) {
        this.latestRead = after;
        this.update({ saving: false, latest: after.skills, warnings: after.warnings, needsRefresh: true,
          error: 'The host reported different skill settings after saving. Review the current state.' }); return false;
      }
      this.latestRead = null;
      this.update({ saving: false, skills: after.skills, warnings: after.warnings, drafts: [], latest: null, needsRefresh: false, error: null });
      return true;
    } catch (error) {
      if (generation === this.generation) this.update({ saving: false, needsRefresh: true,
        error: `Could not confirm save: ${errorText(error)}. Your edits are preserved; refresh before retrying.` });
      return false;
    } finally { if (generation === this.generation) this.refreshIfInvalidated(); }
  }
}
