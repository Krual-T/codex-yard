import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { canEditSkill, SkillSettings } from './skills.ts';

export function SkillSection({ client, hostId, onDirtyChange, onSavingChange }: {
  client: WorkbenchClient; hostId: string; onDirtyChange: (dirty: boolean) => void; onSavingChange: (saving: boolean) => void;
}) {
  const [cwd, setCwd] = useState('');
  const [scope, setScope] = useState('');
  const [query, setQuery] = useState('');
  const settings = useMemo(() => new SkillSettings(client, hostId, scope), [client, hostId, scope]);
  const state = useSyncExternalStore(settings.subscribe, settings.getSnapshot, settings.getSnapshot);
  useEffect(() => {
    const unsubscribe = client.subscribe(event => {
      if (event.type === 'mcp-notification' && event.hostId === hostId && event.method === 'skills/changed') settings.invalidate();
    });
    void settings.load();
    return () => { unsubscribe(); settings.dispose(); };
  }, [client, hostId, settings]);
  useLayoutEffect(() => { onDirtyChange(settings.dirty); }, [settings, state.drafts, onDirtyChange]);
  useLayoutEffect(() => { onSavingChange(state.saving); }, [state.saving, onSavingChange]);
  const locked = state.loading || state.saving || state.latest !== null || state.needsRefresh;
  const search = query.trim().toLocaleLowerCase();
  const visible = state.skills.filter(skill => [skill.name, skill.displayName, skill.description, skill.scope, skill.path]
    .some(value => value.toLocaleLowerCase().includes(search)));
  return <>
    <div className="yard-section-heading"><h2>Skills</h2><button type="button" disabled={state.loading || state.saving} onClick={() => { void settings.load(); }}>Refresh</button></div>
    <form className="yard-filter" onSubmit={event => { event.preventDefault(); if (!settings.dirty && !state.saving) {
      if (scope === cwd.trim()) void settings.load(); else setScope(cwd.trim());
    } }}>
      <label>Working directory <input value={cwd} disabled={settings.dirty || state.saving} onChange={event => setCwd(event.target.value)} placeholder="Host default" /></label>
      <button type="submit" disabled={settings.dirty || state.saving || state.loading}>Show</button>
    </form>
    <label className="yard-plugin-search">Search skills<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
    {state.error && <p className="yard-setting-error" role="alert">{state.error}</p>}
    {state.warnings.map((warning, index) => <p className="yard-setting-error" key={`${warning}:${index}`}>{warning}</p>)}
    {state.loading && <p role="status">Loading skills...</p>}
    {!state.loading && !state.error && !visible.length && <p className="yard-muted">{search ? 'No matching skills.' : 'No skills found.'}</p>}
    {state.latest && <div className="yard-skill-conflict" role="alert">
      <p>Current skill state on the host:</p>
      <ul>{state.drafts.map(draft => {
        const previous = state.skills.find(skill => skill.id === draft.id), current = state.latest?.find(skill => skill.id === draft.id);
        return <li key={draft.id}>{previous?.displayName ?? draft.id}: {current ? current.enabled ? 'Enabled' : 'Disabled' : 'No longer present'}; your edit: {draft.enabled ? 'Enabled' : 'Disabled'}</li>;
      })}</ul>
      <button type="button" onClick={() => settings.useLatest()}>Use current state and keep edits</button>
    </div>}
    <div className="yard-setting-group">{visible.map(skill => <div className="yard-setting-row" key={skill.id}>
      <div className="yard-setting-copy"><div className="yard-setting-label">{skill.displayName}</div>
        <div className="yard-setting-description">{skill.description}</div>
        <div className="yard-setting-description">{skill.scope}{skill.pluginId ? ` | ${skill.pluginId}` : ''}</div>
        <details className="yard-skill-details"><summary>Details</summary><p>Path: <code>{skill.path}</code></p></details>
        {!canEditSkill(skill, state.skills) && <div className="yard-setting-error">This skill shares its selector with another entry and cannot be changed here.</div>}
      </div>
      <div className="yard-setting-control"><input type="checkbox" aria-label={`${skill.displayName} (${skill.scope}, ${skill.path})`}
        checked={state.drafts.find(draft => draft.id === skill.id)?.enabled ?? skill.enabled} disabled={locked || !canEditSkill(skill, state.skills)}
        onChange={event => settings.edit(skill.id, event.target.checked)} /></div>
    </div>)}</div>
    {settings.dirty && <div className="yard-inline-save"><span>Unsaved skill changes</span><div className="yard-actions">
      <button type="button" disabled={state.saving || state.loading} onClick={() => settings.discard()}>Discard</button>
      <button type="button" disabled={locked} onClick={() => { void settings.save(); }}>{state.saving ? 'Saving...' : 'Save'}</button>
    </div></div>}
  </>;
}
