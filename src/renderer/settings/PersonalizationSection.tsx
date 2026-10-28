import { useEffect, useState } from 'react';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { Row } from './PreferenceControls.tsx';

type Instructions = { path: string; contents: string | null; overridePath: string; overrideContents: string | null };
type LoadState = { loading: boolean; instructions: Instructions | null; error: string | null };

export function PersonalizationSection({ client, hostId }: { client: WorkbenchClient; hostId: string }) {
  const [state, setState] = useState<LoadState>({ loading: true, instructions: null, error: null });
  const [memory, setMemory] = useState<{ loading: boolean; status: { v2ConsolidatedThreads: number; v2Ready: boolean } | null; error: string | null }>({ loading: true, status: null, error: null });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    const load = async () => {
      setState(previous => ({ ...previous, loading: true, error: null }));
      try {
        const home = await client.host<{ codexHome: string }>('codex-home', { hostId });
        if (typeof home?.codexHome !== 'string' || !/^(?:\/|[a-z]:[\\/]|\\\\)/i.test(home.codexHome)) throw new Error('Configuration home is unavailable');
        const root = home.codexHome.replace(/[\\/]+$/, ''), normal = `${root}/AGENTS.md`, override = `${root}/AGENTS.override.md`;
        const existing = await client.host<{ existingPaths: string[] }>('paths-exist', { hostId, paths: [normal, override] });
        if (!Array.isArray(existing?.existingPaths)) throw new Error('Invalid file availability response');
        const read = async (path: string) => {
          if (!existing.existingPaths.includes(path)) return null;
          const file = await client.host<{ contents: string }>('read-file', { hostId, path });
          if (typeof file?.contents !== 'string') throw new Error('Invalid instructions response');
          return file.contents;
        };
        const [contents, overrideContents] = await Promise.all([read(normal), read(override)]);
        const instructions = { path: normal, contents, overridePath: override, overrideContents };
        if (active) setState({ loading: false, instructions, error: null });
      } catch (error) { if (active) setState({ loading: false, instructions: null, error: error instanceof Error ? error.message : String(error) }); }
    };
    setMemory(previous => ({ ...previous, loading: true, error: null }));
    void client.rpc<{ v2ConsolidatedThreads: number; v2Ready: boolean }>('memory/status', {}, hostId).then(status => {
      if (!status || !Number.isInteger(status.v2ConsolidatedThreads) || status.v2ConsolidatedThreads < 0 || typeof status.v2Ready !== 'boolean') throw new Error('Invalid memory status response');
      if (active) setMemory({ loading: false, status, error: null });
    }).catch(error => { if (active) setMemory({ loading: false, status: null, error: error instanceof Error ? error.message : String(error) }); });
    void load(); return () => { active = false; };
  }, [client, hostId, revision]);
  return <>
    <div className="yard-section-heading"><h2>Personalization</h2><button type="button" disabled={state.loading || memory.loading} onClick={() => setRevision(value => value + 1)}>Refresh</button></div>
    <h3>Codex instructions</h3>
    <p className="yard-muted">Instructions for {hostId === 'local' ? 'the local host' : hostId}. Project instructions may also apply.</p>
    {state.loading ? <p>Loading instructions...</p> : state.error ? <p className="yard-setting-error" role="alert">Could not load instructions: {state.error} <button type="button" className="yard-link" onClick={() => setRevision(value => value + 1)}>Retry</button></p> :
      state.instructions ? <><p className="yard-muted"><code>{state.instructions.path}</code></p>
        {state.instructions.overrideContents?.trim() && <p role="status">These instructions are overridden by AGENTS.override.md.</p>}
        {state.instructions.contents === null ? <p>No AGENTS.md file exists on this host.</p> : <pre className="yard-instructions">{state.instructions.contents || '(Empty file)'}</pre>}
        {state.instructions.overrideContents !== null && <details><summary>View AGENTS.override.md</summary>
          <p className="yard-muted"><code>{state.instructions.overridePath}</code></p><pre className="yard-instructions">{state.instructions.overrideContents || '(Empty file)'}</pre></details>}</> : null}
    <p className="yard-muted">Editing user instructions is not available for this connection.</p>
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
