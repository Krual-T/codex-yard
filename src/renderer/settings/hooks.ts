import type { WorkbenchClient } from '../workbench-contract.ts';
import { isConfigTarget, userConfigTarget } from './config-target.ts';
import type { ConfigTarget } from './config-target.ts';
import { validScopePath } from './scope.ts';
import { createSettingsWriteId, SettingsConfigOperations, SettingsWriteError, settingsConfigOperations } from './config-operations.ts';
import type { WriteStatus } from './config-operations.ts';
import { configReadSource, sameConfigSource } from './config-source.ts';
import type { ConfigReadSource } from '../../../lib/config-write-protocol.ts';

type Handler = { type: 'command'; command: string; async: boolean } | { type: 'mcpTool'; server: string; tool: string }
  | { type: 'prompt' | 'agent' } | { type: 'unknown'; label: string };
export interface HookEntry {
  key: string; eventName: string; matcher: string | null; source: string; sourcePath: string;
  trustStatus: string; isManaged: boolean; enabled: boolean; timeoutSec: number | null; handler: Handler;
}
interface HookGroup { cwd: string; hooks: HookEntry[]; warnings: string[]; errors: { path: string; message: string }[] }
interface HookRead { hooks: HookEntry[]; warnings: string[]; target: ConfigTarget | null; targetError: string | null; profile: string | null; source: ConfigReadSource | null }
export interface HookDraft { key: string; enabled: boolean }
export interface HookSnapshot {
  loading: boolean; saving: boolean; hooks: HookEntry[]; warnings: string[]; drafts: HookDraft[];
  error: string | null; targetError: string | null; needsRefresh: boolean; writeUncertain: boolean; latest: HookEntry[] | null;
  draftStorageError: string | null; draftSaving: boolean;
}
const unknownWrite = 'The previous hook save has an unknown result. The host must confirm it has ended before another save.';
const text = (error: unknown) => error instanceof Error ? error.message : String(error);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const sameTarget = (left: ConfigTarget | null, right: ConfigTarget | null) => !!left && !!right
  && left.file === right.file && left.version === right.version && left.filePath === right.filePath;
export const canEditHook = (hook: HookEntry) => !hook.isManaged && hook.trustStatus === 'trusted' && hook.handler.type !== 'unknown';

function hookEntry(value: unknown): HookEntry {
  if (!record(value) || typeof value.key !== 'string' || !value.key || typeof value.eventName !== 'string'
    || !(typeof value.matcher === 'string' || value.matcher == null) || typeof value.source !== 'string'
    || typeof value.sourcePath !== 'string' || typeof value.trustStatus !== 'string'
    || typeof value.isManaged !== 'boolean' || typeof value.enabled !== 'boolean'
    || !(value.timeoutSec == null || typeof value.timeoutSec === 'number' && Number.isFinite(value.timeoutSec))) throw new Error('Invalid hook response');
  let handler: Handler;
  if (value.handlerType === 'command' && typeof value.command === 'string' && (value.async === undefined || typeof value.async === 'boolean')) {
    handler = { type: 'command', command: value.command, async: value.async ?? false };
  } else if (value.handlerType === 'mcpTool' && typeof value.server === 'string' && typeof value.tool === 'string') {
    handler = { type: 'mcpTool', server: value.server, tool: value.tool };
  } else if (value.handlerType === 'prompt' || value.handlerType === 'agent') handler = { type: value.handlerType };
  else if (typeof value.handlerType === 'string' && value.handlerType !== 'command' && value.handlerType !== 'mcpTool') handler = { type: 'unknown', label: value.handlerType };
  else throw new Error('Invalid hook handler');
  return { key: value.key, eventName: value.eventName, matcher: value.matcher ?? null, source: value.source, sourcePath: value.sourcePath,
    trustStatus: value.trustStatus, isManaged: value.isManaged, enabled: value.enabled, timeoutSec: (value.timeoutSec as number | null | undefined) ?? null, handler };
}
function hookGroups(value: unknown): HookGroup[] {
  if (!Array.isArray(value)) throw new Error('Invalid hook response');
  return value.map(group => {
    if (!record(group) || typeof group.cwd !== 'string' || !Array.isArray(group.hooks) || !Array.isArray(group.warnings)
      || group.warnings.some((item: unknown) => typeof item !== 'string') || !Array.isArray(group.errors)
      || group.errors.some((error: unknown) => !record(error) || typeof error.path !== 'string' || typeof error.message !== 'string')) throw new Error('Invalid hook response');
    return { cwd: group.cwd, hooks: group.hooks.map(hookEntry), warnings: group.warnings, errors: group.errors } as HookGroup;
  });
}
function uniqueHooks(groups: HookGroup[]): HookEntry[] {
  const hooks = new Map<string, HookEntry>();
  for (const group of groups) for (const hook of group.hooks) {
    const existing = hooks.get(hook.key);
    if (existing && JSON.stringify(existing) !== JSON.stringify(hook)) throw new Error('The host returned conflicting hook states');
    hooks.set(hook.key, hook);
  }
  return [...hooks.values()];
}
function baseLayers(layers: unknown): unknown {
  if (!Array.isArray(layers)) return layers;
  return layers.filter(layer => record(layer) && record(layer.name) && layer.name.type === 'user' && layer.name.profile === null);
}

export class HookSettings {
  private readonly client: WorkbenchClient;
  private readonly hostId: string;
  private readonly cwds: readonly string[];
  private readonly operations: SettingsConfigOperations;
  private readonly captureReadAuthority?: () => () => void;
  private originalId: string | null = null;
  private resolvedOriginalId: string | null = null;
  private originalBlocker: WriteStatus | null = null;
  readonly editorId = createSettingsWriteId();
  private draftWrites: Promise<void> = Promise.resolve();
  private draftRevision: number | null = null;
  private draftWriteCount = 0;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private writeInFlight = false;
  private discarding = false;
  private target: ConfigTarget | null = null;
  private profile: string | null = null;
  private source: ConfigReadSource | null = null;
  private latestRead: HookRead | null = null;
  private snapshot: HookSnapshot = { loading: true, saving: false, hooks: [], warnings: [], drafts: [], error: null, targetError: null, needsRefresh: false, writeUncertain: false, latest: null, draftStorageError: null, draftSaving: false };
  constructor(client: WorkbenchClient, hostId: string, cwds: readonly string[], operations = settingsConfigOperations(client), captureReadAuthority?: () => () => void) {
    this.client = client; this.hostId = hostId; this.cwds = [...cwds]; this.operations = operations;
    this.captureReadAuthority = captureReadAuthority;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<HookSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; for (const listener of this.listeners) listener(); }
  retryDraftPersistence() {
    if (this.snapshot.saving) return this.draftWrites;
    const draft = structuredClone({ drafts: this.snapshot.drafts, hooks: this.snapshot.hooks, target: this.target, profile: this.profile, source: this.source });
    this.draftWriteCount++; this.update({ draftSaving: true });
    const dirty = this.dirty;
    this.draftWrites = this.draftWrites.then(() => dirty ? this.operations.saveDraft(this.hostId, 'hooks-settings', this.cwds, this.editorId, draft)
      : this.operations.clearEditorDraft(this.hostId, 'hooks-settings', this.cwds, this.editorId))
      .then(revision => { this.draftRevision = revision; this.update({ draftStorageError: null }); }, error => this.update({ draftStorageError: text(error) }))
      .finally(() => { if (--this.draftWriteCount === 0) this.update({ draftSaving: false }); });
    return this.draftWrites;
  }
  get dirty() { return this.snapshot.drafts.length > 0; }
  async restoreDraft(value: unknown): Promise<void> {
    if (this.dirty || this.snapshot.loading || this.snapshot.saving) throw new Error('Finish the current edit before restoring another copy.');
    if (!record(value) || !Array.isArray(value.drafts) || !value.drafts.every((item: unknown) =>
      record(item) && typeof item.key === 'string' && typeof item.enabled === 'boolean')) throw new Error('The saved hook edits cannot be read.');
    const hooks = Array.isArray(value.hooks) && value.hooks.every((item: unknown) => record(item) && typeof item.key === 'string'
      && typeof item.enabled === 'boolean' && typeof item.trustStatus === 'string' && typeof item.isManaged === 'boolean' && record(item.handler))
      ? value.hooks as HookEntry[] : this.snapshot.hooks;
    this.source = configReadSource(value.source, this.hostId);
    if (isConfigTarget(value.target)) this.target = value.target;
    if (value.profile === null || typeof value.profile === 'string') this.profile = value.profile;
    this.update({ drafts: value.drafts as HookDraft[], hooks, needsRefresh: true });
    await this.retryDraftPersistence(); await this.load();
  }
  dispose() {
    this.generation++;
    if (this.discarding) return;
    if (this.snapshot.saving) this.update({ saving: false, loading: false, needsRefresh: true,
      writeUncertain: this.snapshot.writeUncertain || this.writeInFlight,
      error: this.writeInFlight ? unknownWrite : 'The save was interrupted. Refresh and review your edits before saving.' });
    else if (this.snapshot.loading) this.update({ loading: false });
  }

  private async read(assertBeforeSend?: () => void): Promise<HookRead> {
    if (!this.cwds.length || !this.cwds.every(validScopePath)) throw new Error('Select a project or session with a working directory.');
    type ConfigResponse = { config: { profile?: unknown }; layers?: unknown; yardConfigSource?: unknown };
    const configBefore = await this.client.rpc<ConfigResponse>('config/read', { includeLayers: true }, this.hostId, { assertBeforeSend }).catch(() => null);
    const listResult = await this.client.rpc<{ data: unknown }>('hooks/list', { cwds: this.cwds }, this.hostId, { assertBeforeSend });
    const configResult = await this.client.rpc<ConfigResponse>('config/read', { includeLayers: true }, this.hostId, { assertBeforeSend }).catch(() => null);
    const groups = hookGroups(listResult?.data), hooks = uniqueHooks(groups);
    const warnings = groups.flatMap(group => [...group.warnings, ...group.errors.map(error => `${error.path}: ${error.message}`)]);
    let target: ConfigTarget | null = null, targetError: string | null = null, profile: string | null = null;
    const firstSource = configReadSource(configBefore?.yardConfigSource, this.hostId), source = configReadSource(configResult?.yardConfigSource, this.hostId);
    if (configBefore && configResult && sameConfigSource(firstSource, source) && source && record(configResult.config)
      && (configResult.config.profile == null || typeof configResult.config.profile === 'string')) {
      profile = typeof configResult.config.profile === 'string' && configResult.config.profile ? configResult.config.profile : null;
      const resolved = userConfigTarget(baseLayers(configResult.layers), source.codexHome);
      const original = userConfigTarget(baseLayers(configBefore.layers), source.codexHome);
      target = resolved.target; targetError = resolved.error;
      if (!sameTarget(original.target, target) || configBefore.config?.profile !== configResult.config.profile) {
        target = null; targetError = 'The configuration changed while hooks were read. Refresh and review your edits.';
      }
    } else targetError = 'Cannot save without a verified configuration connection. Refresh and review your edits.';
    return { hooks, warnings, target, targetError, profile, source: target ? source : null };
  }
  private changed(read: HookRead): boolean {
    if (!sameTarget(this.target, read.target) || this.profile !== read.profile || !sameConfigSource(this.source, read.source)) return true;
    return this.snapshot.drafts.some(draft => {
      const previous = this.snapshot.hooks.find(hook => hook.key === draft.key), current = read.hooks.find(hook => hook.key === draft.key);
      return !previous || !current || JSON.stringify(previous) !== JSON.stringify(current);
    });
  }
  async load(): Promise<void> {
    if (this.snapshot.saving) return;
    const generation = ++this.generation;
    this.update({ loading: true, error: null });
    try {
      const assertOriginal = this.captureReadAuthority?.();
      const assertBeforeSend = () => {
        if (generation !== this.generation) throw new Error('The original hook settings page is no longer active.');
        assertOriginal?.();
      };
      assertBeforeSend();
      const previous = await this.operations.find(this.hostId, 'hooks-settings', this.cwds);
      if (generation !== this.generation) return;
      const unresolved = !!previous && (previous.phase === 'pending' || previous.phase === 'unknown' || previous.phase === 'blocked' || !!previous.operation?.storageError);
      if (!this.originalId && previous) this.originalId = previous.operationId;
      if (previous?.operationId === this.originalId && previous.blocker) this.originalBlocker = previous.blocker;
      let resolved = !!previous && previous.operationId === this.originalId && !unresolved;
      if (this.snapshot.writeUncertain && this.originalId && !resolved && previous?.operationId !== this.originalId) {
        const blocker = this.originalBlocker;
        resolved = this.resolvedOriginalId === this.originalId
          || await this.operations.originalNotSentClosed(this.hostId, this.originalId, 'config/batchWrite')
          || !!(blocker?.method && blocker.hostId === this.hostId && await this.operations.originalFinished(blocker.hostId, blocker.operationId, blocker.method, assertBeforeSend))
          || !blocker && await this.operations.originalFinished(this.hostId, this.originalId, 'config/batchWrite', assertBeforeSend);
        if (generation !== this.generation) return;
      }
      if (unresolved && previous?.operationId === this.originalId) {
        this.snapshot = { ...this.snapshot, writeUncertain: true, needsRefresh: true };
      } else if (this.snapshot.writeUncertain && resolved) {
        this.snapshot = { ...this.snapshot, writeUncertain: false, needsRefresh: true };
      }
      const read = await this.read(assertBeforeSend);
      if (generation !== this.generation) return;
      if (this.dirty && (this.snapshot.needsRefresh || this.changed(read))) {
        this.latestRead = read;
        this.update({ loading: false, hooks: this.snapshot.hooks.length ? this.snapshot.hooks : read.hooks,
          latest: read.hooks, warnings: read.warnings, targetError: read.targetError,
          error: this.snapshot.writeUncertain ? unknownWrite : 'Hook settings changed or the last save could not be confirmed. Review the current state before saving.' });
      } else {
        this.latestRead = null; this.target = read.target; this.profile = read.profile; this.source = read.source;
        this.update({ loading: false, hooks: read.hooks, warnings: read.warnings, targetError: read.targetError, latest: null, needsRefresh: false });
      }
    } catch (error) { if (generation === this.generation) this.update({ loading: false, error: `Could not load hooks: ${text(error)}` }); }
  }
  edit(key: string, enabled: boolean) {
    if (this.snapshot.loading || this.snapshot.saving || this.snapshot.latest || this.snapshot.writeUncertain) return;
    const hook = this.snapshot.hooks.find(item => item.key === key);
    if (!hook || !canEditHook(hook)) return;
    const drafts = this.snapshot.drafts.filter(item => item.key !== key);
    if (hook.enabled !== enabled) drafts.push({ key, enabled });
    this.update({ drafts, error: null });
    void this.retryDraftPersistence();
  }
  async discard(): Promise<boolean> {
    if (this.snapshot.saving || this.snapshot.writeUncertain || this.discarding) return false;
    this.discarding = true;
    this.generation++; this.update({ saving: true, loading: false });
    try {
      await this.draftWrites;
      await this.operations.clearEditorDraft(this.hostId, 'hooks-settings', this.cwds, this.editorId);
      this.draftRevision = null;
      const latest = this.latestRead;
      const refresh = this.snapshot.needsRefresh && !latest;
      if (latest) { this.target = latest.target; this.profile = latest.profile; this.source = latest.source; this.latestRead = null; }
      this.update({ saving: false, drafts: [], hooks: latest?.hooks ?? this.snapshot.hooks, warnings: latest?.warnings ?? this.snapshot.warnings,
        targetError: latest ? latest.targetError : this.snapshot.targetError, error: null, draftStorageError: null, latest: null, needsRefresh: false });
      if (refresh) void this.load();
      return true;
    } catch (error) { this.update({ saving: false, draftStorageError: text(error) }); return false; }
    finally { this.discarding = false; }
  }
  useLatest() {
    if (this.snapshot.saving) return;
    if (this.snapshot.writeUncertain) { this.update({ error: unknownWrite }); return; }
    const latest = this.latestRead;
    if (!latest) return;
    if (!latest.source) { this.update({ error: 'The configuration connection is unavailable. Refresh and review your edits.' }); return; }
    if (this.snapshot.drafts.some(draft => !latest.hooks.some(hook => hook.key === draft.key && canEditHook(hook)))) {
      this.update({ error: 'A changed hook is missing or requires review. Discard edits and refresh before continuing.' }); return;
    }
    this.target = latest.target; this.profile = latest.profile; this.source = latest.source; this.latestRead = null;
    const drafts = this.snapshot.drafts.filter(draft => latest.hooks.find(hook => hook.key === draft.key)?.enabled !== draft.enabled);
    this.update({ hooks: latest.hooks, warnings: latest.warnings, targetError: latest.targetError, drafts, latest: null, needsRefresh: false, error: null });
    void this.retryDraftPersistence();
  }
  async save(): Promise<boolean> {
    if (!this.dirty || this.snapshot.saving || this.snapshot.loading || this.snapshot.latest || this.snapshot.needsRefresh || this.snapshot.writeUncertain) return false;
    const target = this.target;
    if (!target) { this.update({ error: this.snapshot.targetError || 'Cannot save without a verified configuration version.' }); return false; }
    const source = this.source;
    if (!source) { this.update({ error: 'The original configuration connection is unavailable. Refresh and review your edits.' }); return false; }
    const generation = ++this.generation, drafts = this.snapshot.drafts;
    this.update({ saving: true, error: null });
    let writeStarted = false, writeFinished = false;
    try {
      await this.draftWrites;
      if (this.snapshot.draftStorageError) throw new Error('The newer edit could not be saved in the browser.');
      if (this.draftRevision === null) throw new Error('The current edit has no saved browser revision.');
      if (generation !== this.generation) return false;
      const before = await this.read();
      if (generation !== this.generation) return false;
      if (this.changed(before)) {
        this.latestRead = before;
        this.update({ saving: false, latest: before.hooks, warnings: before.warnings, targetError: before.targetError,
          error: 'Hook settings changed elsewhere. Review the current state before saving.' }); return false;
      }
      const edits = drafts.map(draft => ({ keyPath: `hooks.state.${JSON.stringify(draft.key)}.enabled`, value: draft.enabled, mergeStrategy: 'upsert' }));
      writeStarted = true;
      this.writeInFlight = true;
      let result: { status: 'ok' | 'okOverridden' };
      let operationId: string;
      try {
        const submitted = await this.operations.submit(this.hostId, 'config/batchWrite',
          { edits, filePath: null, expectedVersion: target.version, reloadUserConfig: true },
          { section: 'hooks-settings', scope: this.cwds, editorId: this.editorId, revision: this.draftRevision, source, draft: { drafts, source } }, () => generation === this.generation,
          id => { this.originalId = id; this.resolvedOriginalId = null; this.originalBlocker = null; });
        if (this.originalId === submitted.operationId) this.resolvedOriginalId = submitted.operationId;
        result = submitted.result as { status: 'ok' | 'okOverridden' };
        operationId = submitted.operationId;
      } finally { this.writeInFlight = false; }
      writeFinished = true;
      if (generation !== this.generation) return false;
      if (result?.status !== 'ok') throw new Error(result?.status === 'okOverridden' ? 'A higher-priority setting overrides the change' : 'The host did not confirm the write');
      const after = await this.read();
      if (generation !== this.generation) return false;
      if (!sameConfigSource(source, after.source) || !after.target || after.target.file !== target.file || after.profile !== this.profile
        || drafts.some(draft => !after.hooks.some(hook => hook.key === draft.key && canEditHook(hook) && hook.enabled === draft.enabled))) {
        this.latestRead = after;
        this.update({ saving: false, latest: after.hooks, warnings: after.warnings, targetError: after.targetError, needsRefresh: true,
          error: 'The host reported different hook settings after saving. Review the current state.' }); return false;
      }
      await this.operations.finish(operationId, { consumeSubmittedDraft: true });
      if (generation !== this.generation) return false;
      this.target = after.target; this.profile = after.profile; this.latestRead = null;
      this.update({ saving: false, hooks: after.hooks, warnings: after.warnings, targetError: after.targetError,
        drafts: [], latest: null, needsRefresh: false, error: null });
      return true;
    } catch (error) {
      if (error instanceof SettingsWriteError && error.operationId && this.originalId === error.operationId) {
        this.resolvedOriginalId = error.uncertain ? null : error.operationId;
        this.originalBlocker = error.blocker ?? null;
      }
      if (generation === this.generation) {
        const writeUncertain = error instanceof SettingsWriteError ? error.uncertain : writeStarted && !writeFinished;
        this.update({ saving: false, needsRefresh: true, writeUncertain,
          error: writeUncertain ? unknownWrite : `Could not confirm save: ${text(error)}. Your edits are preserved; refresh before retrying.` });
      }
      return false;
    }
  }
}
