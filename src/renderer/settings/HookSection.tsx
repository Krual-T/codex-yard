import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { canEditHook, HookSettings } from './hooks.ts';
import type { HookEntry } from './hooks.ts';

const eventLabel = (hook: HookEntry) => hook.eventName.charAt(0).toUpperCase() + hook.eventName.slice(1);
const trustLabel = (hook: HookEntry) => hook.isManaged || hook.trustStatus === 'managed' ? 'Managed' : hook.trustStatus === 'untrusted' ? 'Needs review'
  : hook.trustStatus === 'modified' ? 'Changed since review' : hook.trustStatus === 'trusted' ? '' : 'Trust status unknown';

export function HookSection({ client, hostId, onDirtyChange, onSavingChange }: {
  client: WorkbenchClient; hostId: string; onDirtyChange: (dirty: boolean) => void; onSavingChange: (saving: boolean) => void;
}) {
  const [cwd, setCwd] = useState('');
  const [scope, setScope] = useState('');
  const settings = useMemo(() => new HookSettings(client, hostId, scope), [client, hostId, scope]);
  const state = useSyncExternalStore(settings.subscribe, settings.getSnapshot, settings.getSnapshot);
  useEffect(() => { void settings.load(); return () => settings.dispose(); }, [settings]);
  useLayoutEffect(() => { onDirtyChange(settings.dirty); }, [settings, state.drafts, onDirtyChange]);
  useLayoutEffect(() => { onSavingChange(state.saving); }, [state.saving, onSavingChange]);
  const locked = state.loading || state.saving || state.latest !== null;
  return <>
    <div className="yard-section-heading"><h2>Hooks</h2><button type="button" disabled={state.loading || state.saving} onClick={() => { void settings.load(); }}>Refresh</button></div>
    <form className="yard-filter" onSubmit={event => { event.preventDefault(); if (!settings.dirty && !state.saving) {
      if (scope === cwd.trim()) void settings.load(); else setScope(cwd.trim());
    } }}>
      <label>Working directory <input value={cwd} disabled={settings.dirty || state.saving} onChange={event => setCwd(event.target.value)} placeholder="Host default" /></label>
      <button type="submit" disabled={settings.dirty || state.saving || state.loading}>Show</button>
    </form>
    {state.error && <p className="yard-setting-error" role="alert">{state.error}</p>}
    {state.targetError && <p className="yard-setting-error">{state.targetError}</p>}
    {state.warnings.map((warning, index) => <p className="yard-setting-error" key={`${warning}:${index}`}>{warning}</p>)}
    {state.loading && <p role="status">Loading hooks...</p>}
    {!state.loading && !state.error && !state.hooks.length && <p className="yard-muted">No hooks found.</p>}
    {state.latest && <div className="yard-hook-conflict" role="alert">
      <p>Current hook state on the host:</p>
      <ul>{state.drafts.map(draft => {
        const previous = state.hooks.find(hook => hook.key === draft.key), current = state.latest?.find(hook => hook.key === draft.key);
        return <li key={draft.key}>{previous ? eventLabel(previous) : draft.key}: {current ? `Configured ${current.enabled ? 'enabled' : 'disabled'}${trustLabel(current) ? ` | ${trustLabel(current)}` : ''}` : 'No longer present'}; your edit: {draft.enabled ? 'Enabled' : 'Disabled'}</li>;
      })}</ul>
      <button type="button" onClick={() => settings.useLatest()}>Use current state and keep edits</button>
    </div>}
    <div className="yard-setting-group">{state.hooks.map((hook, index) => {
      const desired = state.drafts.find(draft => draft.key === hook.key)?.enabled ?? hook.enabled;
      return <div className="yard-setting-row" key={hook.key}>
        <div className="yard-setting-copy"><div className="yard-setting-label">{eventLabel(hook)}{hook.matcher ? ` | ${hook.matcher}` : ''}</div>
          <div className="yard-setting-description">{[hook.source, trustLabel(hook)].filter(Boolean).join(' | ')}</div>
          <details className="yard-hook-details"><summary>Details</summary>
            <p>Source: <code>{hook.sourcePath}</code></p>
            {hook.handler.type === 'command' && <><p>Command</p><pre className="yard-instructions">{hook.handler.command}</pre>
              <p>{hook.handler.async ? 'Runs asynchronously' : 'Runs synchronously'}</p></>}
            {hook.handler.type === 'mcpTool' && <p>MCP tool: {hook.handler.server} / {hook.handler.tool}</p>}
            {(hook.handler.type === 'prompt' || hook.handler.type === 'agent') && <p>Type: {hook.handler.type}</p>}
            {hook.handler.type === 'unknown' && <p>Type: {hook.handler.label}</p>}
            {hook.timeoutSec != null && <p>Timeout: {hook.timeoutSec} seconds</p>}
          </details>
          {!canEditHook(hook) && !hook.isManaged && (hook.trustStatus === 'untrusted' || hook.trustStatus === 'modified') && <div className="yard-setting-description">This hook must be reviewed before it can be changed. Review is not available for this connection.</div>}
          {hook.handler.type === 'unknown' && <div className="yard-setting-description">Changing this type of hook is not available for this connection.</div>}
        </div>
        <div className="yard-setting-control"><input type="checkbox" aria-label={`${eventLabel(hook)} hook ${index + 1}`} checked={hook.trustStatus === 'trusted' || hook.trustStatus === 'managed' ? desired : false}
          disabled={locked || !canEditHook(hook)} onChange={event => settings.edit(hook.key, event.target.checked)} /></div>
      </div>;
    })}</div>
    {settings.dirty && <div className="yard-inline-save"><span>Unsaved hook changes</span><div className="yard-actions">
      <button type="button" disabled={state.saving || state.loading} onClick={() => settings.discard()}>Discard</button>
      <button type="button" disabled={locked || state.needsRefresh || !!state.targetError} onClick={() => { void settings.save(); }}>{state.saving ? 'Saving...' : 'Save'}</button>
    </div></div>}
  </>;
}
