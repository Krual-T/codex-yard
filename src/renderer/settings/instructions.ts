import type { WorkbenchClient } from '../workbench-contract.ts';

export type InstructionFileName = 'AGENTS.md' | 'AGENTS.override.md';
export interface InstructionFile {
  name: InstructionFileName; path: string; saved: string | null; draft: string;
  latest: string | null | undefined; needsRefresh: boolean;
}
export interface InstructionsSnapshot {
  loading: boolean; saving: boolean; error: string | null; files: InstructionFile[] | null;
}
const names: InstructionFileName[] = ['AGENTS.md', 'AGENTS.override.md'];
const maxBytes = 10 * 1024 * 1024;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
const isDirty = (file: InstructionFile) => file.draft !== (file.saved ?? '');

export class Instructions {
  private readonly client: WorkbenchClient;
  private readonly hostId: string;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private snapshot: InstructionsSnapshot = { loading: true, saving: false, error: null, files: null };
  constructor(client: WorkbenchClient, hostId: string) { this.client = client; this.hostId = hostId; }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<InstructionsSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; for (const listener of this.listeners) listener(); }
  private updateFile(name: InstructionFileName, change: (file: InstructionFile) => InstructionFile) {
    if (this.snapshot.files) this.update({ files: this.snapshot.files.map(file => file.name === name ? change(file) : file) });
  }
  get dirty() { return this.snapshot.files?.some(isDirty) ?? false; }
  dispose() { this.generation++; }

  async load() {
    if (this.snapshot.saving) return;
    const generation = ++this.generation;
    this.update({ loading: true, error: null });
    try {
      const home = await this.client.host<{ codexHome: string }>('codex-home', { hostId: this.hostId });
      if (typeof home?.codexHome !== 'string' || !/^(?:\/|[a-z]:[\\/]|\\\\)/i.test(home.codexHome)) throw new Error('Configuration home is unavailable');
      const root = home.codexHome.replace(/[\\/]+$/, ''), paths = names.map(name => `${root}/${name}`);
      const existing = await this.client.host<{ existingPaths: string[] }>('paths-exist', { hostId: this.hostId, paths });
      if (!Array.isArray(existing?.existingPaths)) throw new Error('Invalid file availability response');
      const values = await Promise.all(paths.map(async path => {
        if (!existing.existingPaths.includes(path)) return null;
        const result = await this.client.host<{ contentsBase64: string | null }>('read-file-binary', { hostId: this.hostId, path, maxBytes });
        if (result?.contentsBase64 === null) throw new Error('Instructions exceed 10 MiB.');
        if (typeof result?.contentsBase64 !== 'string') throw new Error('Invalid instructions response');
        const binary = atob(result.contentsBase64);
        if (binary.length > maxBytes) throw new Error('Instructions exceed 10 MiB.');
        return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(binary, character => character.charCodeAt(0)));
      }));
      if (generation !== this.generation) return;
      const previous = this.snapshot.files;
      const files = names.map((name, index): InstructionFile => {
        const saved = values[index], old = previous?.find(file => file.name === name);
        if (old && isDirty(old)) return { ...old, path: paths[index], latest: saved === old.saved ? undefined : saved, needsRefresh: false };
        return { name, path: paths[index], saved, draft: saved ?? '', latest: undefined, needsRefresh: false };
      });
      this.update({ loading: false, files });
    } catch (error) { if (generation === this.generation) this.update({ loading: false, error: `Could not load instructions: ${errorMessage(error)}` }); }
  }
  edit(name: InstructionFileName, draft: string) {
    if (this.snapshot.loading || this.snapshot.saving) return;
    this.updateFile(name, file => ({ ...file, draft }));
  }
  discard(name: InstructionFileName) {
    if (this.snapshot.loading || this.snapshot.saving) return;
    this.updateFile(name, file => {
      const saved = file.latest === undefined ? file.saved : file.latest;
      return { ...file, saved, draft: saved ?? '', latest: undefined, needsRefresh: false };
    });
  }
  useLatest(name: InstructionFileName) {
    if (this.snapshot.loading || this.snapshot.saving) return;
    this.updateFile(name, file => file.latest === undefined ? file : { ...file, saved: file.latest, latest: undefined });
  }
  async save(name: InstructionFileName): Promise<boolean> {
    const file = this.snapshot.files?.find(item => item.name === name);
    if (!file || !isDirty(file) || file.latest !== undefined || file.needsRefresh || this.snapshot.loading || this.snapshot.saving) return false;
    const generation = this.generation;
    this.update({ saving: true, error: null });
    try {
      const result = await this.client.host<{ saved: boolean }>('codex-agents-md-save',
        { hostId: this.hostId, fileName: name, contents: file.draft, expectedContents: file.saved });
      if (result?.saved !== true) throw new Error('The host did not confirm the save');
      if (generation !== this.generation) return false;
      this.updateFile(name, current => ({ ...current, saved: file.draft, needsRefresh: false }));
      this.update({ saving: false });
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      this.updateFile(name, current => ({ ...current, needsRefresh: true }));
      this.update({ saving: false, error: `Could not confirm save: ${errorMessage(error)}. Your draft is preserved; refresh before retrying.` });
      return false;
    }
  }
}
