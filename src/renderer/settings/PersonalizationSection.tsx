import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { Instructions } from './instructions.ts';
import { Row } from './PreferenceControls.tsx';

export function PersonalizationSection({ client, hostId, onDirtyChange, onSavingChange }: {
  client: WorkbenchClient; hostId: string; onDirtyChange: (dirty: boolean) => void; onSavingChange: (saving: boolean) => void;
}) {
  const instructions = useMemo(() => new Instructions(client, hostId), [client, hostId]);
  const state = useSyncExternalStore(instructions.subscribe, instructions.getSnapshot, instructions.getSnapshot);
  const [memory, setMemory] = useState<{ loading: boolean; status: { v2ConsolidatedThreads: number; v2Ready: boolean } | null; error: string | null }>({ loading: true, status: null, error: null });
  const [revision, setRevision] = useState(0);
  useEffect(() => { void instructions.load(); return () => instructions.dispose(); }, [instructions]);
  useLayoutEffect(() => { onDirtyChange(instructions.dirty); }, [instructions, state.files, onDirtyChange]);
  useLayoutEffect(() => { onSavingChange(state.saving); }, [state.saving, onSavingChange]);
  useEffect(() => {
    let active = true;
    setMemory(previous => ({ ...previous, loading: true, error: null }));
    void client.rpc<{ v2ConsolidatedThreads: number; v2Ready: boolean }>('memory/status', {}, hostId).then(status => {
      if (!status || !Number.isInteger(status.v2ConsolidatedThreads) || status.v2ConsolidatedThreads < 0 || typeof status.v2Ready !== 'boolean') throw new Error('Invalid memory status response');
      if (active) setMemory({ loading: false, status, error: null });
    }).catch(error => { if (active) setMemory({ loading: false, status: null, error: error instanceof Error ? error.message : String(error) }); });
    return () => { active = false; };
  }, [client, hostId, revision]);
  const refresh = () => { void instructions.load(); setRevision(value => value + 1); };
  return <>
    <div className="yard-section-heading"><h2>Personalization</h2><button type="button" disabled={state.loading || state.saving} onClick={refresh}>Refresh</button></div>
    <h3>Codex instructions</h3>
    <p className="yard-muted">Instructions for {hostId === 'local' ? 'the local host' : hostId}. Project instructions may also apply.</p>
    {state.error && <p className="yard-setting-error" role="alert">{state.error} <button type="button" className="yard-link" disabled={state.loading || state.saving} onClick={refresh}>Refresh</button></p>}
    {state.loading && <p role="status">Loading instructions...</p>}
    {state.files?.find(file => file.name === 'AGENTS.override.md')?.saved?.trim() && <p role="status">AGENTS.override.md takes precedence over AGENTS.md.</p>}
    {state.files?.map(file => <section className="yard-instruction-editor" key={file.name} data-setting-id={file.name === 'AGENTS.md' ? 'instructions' : undefined}>
      <label htmlFor={`yard-instructions-${file.name}`}><strong>{file.name}</strong></label>
      <p className="yard-muted"><code>{file.path}</code>{file.saved === null ? ' (not created)' : ''}</p>
      <textarea id={`yard-instructions-${file.name}`} aria-label={file.name} value={file.draft} disabled={state.loading || state.saving}
        onChange={event => instructions.edit(file.name, event.target.value)} />
      {file.latest !== undefined && <div role="alert" className="yard-setting-error">
        <p>The file changed on the host. Review its current contents before saving your draft.</p>
        <details><summary>Current file on host</summary><pre className="yard-instructions">{file.latest === null ? '(File no longer exists)' : file.latest || '(Empty file)'}</pre></details>
        <button type="button" onClick={() => instructions.useLatest(file.name)}>Use current file as save baseline</button>
        <p>Saving afterward will replace the current file with your draft.</p>
      </div>}
      {file.needsRefresh && <p className="yard-setting-error">Refresh to check the current file before saving again.</p>}
      {file.draft !== (file.saved ?? '') && <div className="yard-inline-save"><span>Unsaved {file.name}</span><div className="yard-actions">
        <button type="button" disabled={state.loading || state.saving} onClick={() => instructions.discard(file.name)}>Discard</button>
        <button type="button" disabled={state.loading || state.saving || file.needsRefresh || file.latest !== undefined} onClick={() => { void instructions.save(file.name); }}>{state.saving ? 'Saving...' : 'Save'}</button>
      </div></div>}
    </section>)}
    <h3>Codex memory</h3>
    <div className="yard-setting-group">
      <Row label="Codex memories" description="Memory settings and deleting memories are not available for this connection."
        error={memory.error ? `Could not load memory status: ${memory.error}` : null} retry={() => setRevision(value => value + 1)}>
        <span>{memory.loading ? 'Loading...' : memory.status ? `${memory.status.v2ConsolidatedThreads} consolidated chats; ${memory.status.v2Ready ? 'ready' : 'not ready'}` : 'Unavailable'}</span>
      </Row>
    </div>
    <h3>ChatGPT personalization</h3>
    <div className="yard-setting-group">
      <Row label="Custom instructions" description="ChatGPT account instructions are not available for this connection." />
      <Row label="ChatGPT memory" description="ChatGPT account memory is not available for this connection." />
    </div>
  </>;
}
