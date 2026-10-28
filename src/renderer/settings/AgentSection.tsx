import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { Row } from './PreferenceControls.tsx';
import { AgentSettings } from './agent-settings.ts';

type Feature = { name: string; stage: string; displayName: string | null; description: string | null; enabled: boolean };
const hiddenFeatures = new Set(['memories', 'multi_agent', 'plugins', 'plugin', 'remote_control', 'chronicle', 'workspace_dependencies', 'default_mode_request_user_input']);
function ExperimentalFeatures({ client, hostId }: { client: WorkbenchClient; hostId: string }) {
  const [state, setState] = useState<{ loading: boolean; error: string | null; features: Feature[] }>({ loading: true, error: null, features: [] });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    const read = async () => {
      setState(previous => ({ ...previous, loading: true, error: null }));
      try {
        const features: Feature[] = [], cursors = new Set<string>();
        let cursor: string | null = null;
        do {
          const page: { data: Feature[]; nextCursor?: string | null } = await client.rpc('experimentalFeature/list', { cursor, limit: 100 }, hostId);
          if (!Array.isArray(page?.data)) throw new Error('Invalid experimental features response');
          features.push(...page.data.filter(item => item && item.stage === 'beta' && typeof item.name === 'string' && typeof item.enabled === 'boolean' &&
            (item.displayName == null || typeof item.displayName === 'string') && (item.description == null || typeof item.description === 'string') &&
            !hiddenFeatures.has(item.name) && !item.name.startsWith('realtime_')));
          cursor = page.nextCursor ?? null;
          if (cursor && (cursors.has(cursor) || cursors.size >= 100)) throw new Error('Invalid experimental features pagination');
          if (cursor) cursors.add(cursor);
        } while (cursor);
        if (active) setState({ loading: false, error: null, features });
      } catch (error) { if (active) setState({ loading: false, error: error instanceof Error ? error.message : String(error), features: [] }); }
    };
    void read(); return () => { active = false; };
  }, [client, hostId, revision]);
  return <><h3 data-setting-id="experimental" tabIndex={-1}>Experimental features</h3>
    {state.loading ? <p>Loading experimental features...</p> : state.error ? <p className="yard-setting-error" role="alert">Could not load experimental features: {state.error} <button className="yard-link" type="button" onClick={() => setRevision(value => value + 1)}>Retry</button></p> :
      state.features.length ? <><p className="yard-muted">Changing experimental features is not available for this connection.</p><div className="yard-setting-group">
        {state.features.map(feature => <Row key={feature.name} label={feature.displayName || feature.name} description={feature.description}><span>{feature.enabled ? 'On' : 'Off'}</span></Row>)}
      </div></> : <p className="yard-muted">No beta experimental features available.</p>}
  </>;
}

export function AgentSection({ client, hostId, onDirtyChange, onSavingChange }: {
  client: WorkbenchClient; hostId: string; onDirtyChange: (dirty: boolean) => void; onSavingChange: (saving: boolean) => void;
}) {
  const agent = useMemo(() => new AgentSettings(client, hostId), [client, hostId]);
  const state = useSyncExternalStore(agent.subscribe, agent.getSnapshot, agent.getSnapshot), dirty = agent.dirty;
  useEffect(() => { void agent.load(); return () => agent.dispose(); }, [agent]);
  useLayoutEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useLayoutEffect(() => { onSavingChange(state.saving); }, [state.saving, onSavingChange]);
  const approvalLabels: Record<string, string> = { 'on-request': 'Ask when requested', never: 'Never ask', untrusted: 'Untrusted commands', 'on-failure': 'On failure', __advanced__: 'Advanced policy' };
  const sandboxLabels: Record<string, string> = { 'read-only': 'Read only', 'workspace-write': 'Workspace write', 'danger-full-access': 'Full access' };
  return <>
    <div className="yard-section-heading"><h2>Agent</h2><button type="button" disabled={dirty || state.loading || state.saving} onClick={() => { void agent.load(); }}>Refresh</button></div>
    <p className="yard-muted">Defaults for {hostId === 'local' ? 'the local host' : hostId}{state.profile ? `, profile ${state.profile}` : ''}. Project and managed configuration may override these values.</p>
    {state.error && <p className="yard-setting-error" role="alert">{state.error} <button type="button" className="yard-link" disabled={state.loading || state.saving} onClick={() => { void agent.load(); }}>Reload</button></p>}
    {state.writeError && <p className="yard-setting-error" role="alert">{state.writeError}</p>}
    {state.warning && <p role="status">{state.warning}</p>}
    {state.conflicts.map(field => {
      const labels = field === 'approval' ? approvalLabels : sandboxLabels;
      return <div key={field} className="yard-setting-error" role="alert">
        <p>{field === 'approval' ? 'Approval policy' : 'Sandbox mode'} changed elsewhere. Current: {labels[state.saved[field]] || state.saved[field]}; yours: {labels[state.values[field]] || state.values[field]}.</p>
        <div className="yard-actions"><button type="button" disabled={state.saving} onClick={() => agent.resolveConflict(field, 'current')}>Use current value</button>
          <button type="button" disabled={state.saving} onClick={() => agent.resolveConflict(field, 'draft')}>Keep my change</button></div>
      </div>;
    })}
    {state.loading ? <p>Loading agent settings...</p> : <div className="yard-setting-group">
      <Row label="Approval policy" description="Choose when Codex asks for approval.">
        <select aria-label="Approval policy" value={state.values.approval} disabled={state.saving || !state.approvals.length} onChange={event => agent.edit('approval', event.target.value)}>
          {!state.approvals.includes(state.values.approval as 'on-request' | 'never') && <option value={state.values.approval}>{approvalLabels[state.values.approval] || state.values.approval}</option>}
          {state.approvals.map(value => <option key={value} value={value}>{approvalLabels[value]}</option>)}
        </select>
      </Row>
      <Row label="Sandbox mode" description="Choose how much Codex can do when running commands.">
        <select aria-label="Sandbox mode" value={state.values.sandbox} disabled={state.saving || !state.sandboxes.length} onChange={event => agent.edit('sandbox', event.target.value)}>
          {!state.sandboxes.includes(state.values.sandbox as 'read-only' | 'workspace-write' | 'danger-full-access') && <option value={state.values.sandbox}>{sandboxLabels[state.values.sandbox] || state.values.sandbox}</option>}
          {state.sandboxes.map(value => <option key={value} value={value}>{sandboxLabels[value]}</option>)}
        </select>
      </Row>
    </div>}
    {dirty && <div className="yard-inline-save"><span>Unsaved agent settings</span><div className="yard-actions">
      <button type="button" disabled={state.saving} onClick={() => agent.discard()}>Discard</button>
      <button type="button" disabled={state.saving || Boolean(state.writeError) || state.conflicts.length > 0} onClick={() => { void agent.save(); }}>{state.saving ? 'Saving...' : 'Save'}</button>
    </div></div>}
    <p className="yard-muted">Project-specific settings, network access, web search and response detail cannot be changed from this connection.</p>
    <ExperimentalFeatures client={client} hostId={hostId} />
  </>;
}
