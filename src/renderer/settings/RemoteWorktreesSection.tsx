import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { Row } from './PreferenceControls.tsx';
import { RemoteWorktreeSettings } from './worktrees.ts';

export function RemoteWorktreesSection({ client, hostId, onDirtyChange, onSavingChange, upstream }: {
  client: WorkbenchClient; hostId: string; onDirtyChange: (dirty: boolean) => void;
  onSavingChange: (saving: boolean) => void; upstream: ReactNode;
}) {
  const settings = useMemo(() => new RemoteWorktreeSettings(client, hostId), [client, hostId]);
  const state = useSyncExternalStore(settings.subscribe, settings.getSnapshot, settings.getSnapshot);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const dirty = settings.dirty;
  useEffect(() => { void settings.load(); return () => settings.dispose(); }, [settings]);
  useLayoutEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useLayoutEffect(() => { onSavingChange(state.saving); }, [state.saving, onSavingChange]);
  return <>
    <h2>Worktrees</h2>
    <p className="yard-muted">Worktree preferences for {hostId}.</p>
    <p className="yard-muted">Creating and automatically cleaning up worktrees are not available for this connection.</p>
    {state.loading && <p role="status">Loading remote settings...</p>}
    {state.error && <p className="yard-setting-error" role="alert">{state.error} <button type="button" className="yard-link" disabled={state.loading || state.saving}
      onClick={() => { void settings.load(); }}>Reload</button></p>}
    {state.writeError && <p className="yard-setting-error" role="alert">{state.writeError} <button type="button" className="yard-link" disabled={state.loading || state.saving}
      onClick={() => { void settings.load(); }}>Reload</button></p>}
    {state.warning && <p role="status">{state.warning}</p>}
    <div className="yard-setting-group">
      {state.draft && <Row label="Worktree root" description="Directory for managed worktrees; leave blank for the default.">
        <input type="text" aria-label="Worktree root" value={state.draft.root} disabled={state.saving}
          onChange={event => settings.edit({ root: event.target.value })} />
      </Row>}
      {upstream}
      {state.draft && <>
        <Row label="Automatically delete old worktrees"><input type="checkbox" role="switch" aria-label="Automatically delete old worktrees"
          checked={state.draft.autoCleanup} disabled={state.saving} onChange={event => {
            if (!event.target.checked) setConfirmDisable(true); else settings.edit({ autoCleanup: true });
          }} /></Row>
        <Row label="Auto-delete limit" description="Number of recent managed worktrees to keep.">
          <input type="number" min={1} step={1} aria-label="Auto-delete limit" value={state.draft.keepCount}
            disabled={!state.draft.autoCleanup || state.saving} onChange={event => settings.edit({ keepCount: event.target.value })} />
        </Row>
      </>}
    </div>
    {dirty && <div className="yard-inline-save"><span>Unsaved worktree settings</span><div className="yard-actions">
      <button type="button" disabled={state.saving} onClick={() => settings.discard()}>Discard</button>
      <button type="button" disabled={state.loading || state.saving || Boolean(state.writeError)} onClick={() => { void settings.save(); }}>{state.saving ? 'Saving...' : 'Save'}</button>
    </div></div>}
    {confirmDisable && <div className="yard-dialog-backdrop"><div className="yard-dialog" role="dialog" aria-modal="true" aria-labelledby="yard-remote-worktree-confirm">
      <h2 id="yard-remote-worktree-confirm">Disable automatic worktree deletion?</h2><p>Old worktrees will remain until they are removed manually.</p>
      <div className="yard-actions"><button type="button" autoFocus onClick={() => setConfirmDisable(false)}>Keep automatic deletion</button>
        <button type="button" onClick={() => { setConfirmDisable(false); settings.edit({ autoCleanup: false }); }}>Disable automatic deletion</button></div>
    </div></div>}
  </>;
}
