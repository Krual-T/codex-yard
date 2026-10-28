import { useEffect, useLayoutEffect, useState } from 'react';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { entryState, Row } from './PreferenceControls.tsx';
import type { PreferenceProps } from './PreferenceControls.tsx';
import { readRemoteWorktreePreferences } from './worktrees.ts';
import type { RemoteWorktreePreferences } from './worktrees.ts';

export function WorktreesSection({ client, hostId, preferences, snapshot, onDirtyChange }: PreferenceProps & {
  client: WorkbenchClient; hostId: string; onDirtyChange: (dirty: boolean) => void;
}) {
  const [remote, setRemote] = useState<RemoteWorktreePreferences | null>(null);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [loading, setLoading] = useState(hostId !== 'local');
  const [reload, setReload] = useState(0);
  const [keepText, setKeepText] = useState<string | null>(null);
  const [keepError, setKeepError] = useState<string | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const local = hostId === 'local';
  const root = snapshot['git-worktree-root'], cleanup = snapshot['worktree-auto-cleanup-enabled'];
  const keep = snapshot['worktree-keep-count'], upstream = snapshot['worktree-upstream-refresh-mode'];
  const keepDirty = keepText !== null && keepText !== String(keep.value);
  useLayoutEffect(() => { onDirtyChange(keepDirty); }, [keepDirty, onDirtyChange]);
  useEffect(() => {
    if (local) return;
    let active = true;
    setLoading(true); setRemoteError(null); setRemote(null);
    void readRemoteWorktreePreferences(client, hostId).then(value => { if (active) setRemote(value); })
      .catch(error => { if (active) setRemoteError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, hostId, local, reload]);
  const saveKeep = () => {
    if (keepText === null) return;
    const input = keepText.trim();
    if (!input) { setKeepText(null); setKeepError(null); return; }
    const count = Number.parseInt(input, 10);
    if (!Number.isSafeInteger(count)) { setKeepError('Enter a whole number.'); return; }
    preferences.edit('worktree-keep-count', Math.max(1, count));
    setKeepText(null); setKeepError(null);
    void preferences.saveOne('worktree-keep-count');
  };
  return <>
    <h2>Worktrees</h2>
    <p className="yard-muted">Managed worktree listing, creation and automatic cleanup require a Git worker that is not connected in this web host.</p>
    {!local && <p className="yard-muted">Remote worktree settings belong to the selected host. Remote writes require the host configuration write target and version.</p>}
    {remoteError && <p className="yard-setting-error" role="alert">Could not load remote settings: {remoteError} <button type="button" className="yard-link" onClick={() => setReload(value => value + 1)}>Retry</button></p>}
    {loading && <p role="status">Loading remote settings...</p>}
    <div className="yard-setting-group">
      {(local || remote) && <Row label="Worktree root" description="Directory for managed worktrees; leave blank for the default." error={local ? root.error : null}
        retry={local ? () => { void preferences.reload('git-worktree-root'); } : undefined}>
        <input type="text" aria-label="Worktree root" value={local ? root.value : remote?.root ?? ''} disabled={!local || entryState(root).disabled}
          onChange={event => preferences.edit('git-worktree-root', event.target.value)}
          onBlur={() => { void preferences.saveOne('git-worktree-root'); }} onKeyDown={event => {
            if (event.key === 'Enter' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's')) {
              event.preventDefault(); void preferences.saveOne('git-worktree-root');
            }
          }} />
      </Row>}
      <Row label="Always fetch upstream before creating worktrees" error={upstream.error} retry={() => { void preferences.reload('worktree-upstream-refresh-mode'); }}>
        <input type="checkbox" role="switch" aria-label="Always fetch upstream before creating worktrees" checked={upstream.value === 'best-effort'}
          disabled={entryState(upstream).disabled} onChange={event => {
            preferences.edit('worktree-upstream-refresh-mode', event.target.checked ? 'best-effort' : 'never');
            void preferences.saveOne('worktree-upstream-refresh-mode');
          }} />
      </Row>
      {(local || remote) && <>
        <Row label="Automatically delete old worktrees" error={local ? cleanup.error : null} retry={local ? () => { void preferences.reload('worktree-auto-cleanup-enabled'); } : undefined}>
          <input type="checkbox" role="switch" aria-label="Automatically delete old worktrees" checked={local ? cleanup.value : remote?.autoCleanup ?? false}
            disabled={!local || entryState(cleanup).disabled} onChange={event => {
              if (!event.target.checked) setConfirmDisable(true);
              else { preferences.edit('worktree-auto-cleanup-enabled', true); void preferences.saveOne('worktree-auto-cleanup-enabled'); }
            }} />
        </Row>
        <Row label="Auto-delete limit" description="Number of recent managed worktrees to keep." error={keepError || (local ? keep.error : null)}
          retry={local && keep.error ? () => { void preferences.saveOne('worktree-keep-count'); } : undefined}>
          <input type="number" min={1} step={1} aria-label="Auto-delete limit" value={local ? keepText ?? String(keep.value) : String(remote?.keepCount ?? '')}
            disabled={!local || !cleanup.value || entryState(keep).disabled} onChange={event => { setKeepText(event.target.value); setKeepError(null); }}
            onBlur={saveKeep} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); saveKeep(); } }} />
        </Row>
      </>}
    </div>
    {confirmDisable && <div className="yard-dialog-backdrop"><div className="yard-dialog" role="dialog" aria-modal="true" aria-labelledby="yard-worktree-confirm">
      <h2 id="yard-worktree-confirm">Disable automatic worktree deletion?</h2><p>Old worktrees will remain until they are removed manually.</p>
      <div className="yard-actions"><button type="button" autoFocus onClick={() => setConfirmDisable(false)}>Keep automatic deletion</button>
        <button type="button" onClick={() => { setConfirmDisable(false); preferences.edit('worktree-auto-cleanup-enabled', false); void preferences.saveOne('worktree-auto-cleanup-enabled'); }}>Disable automatic deletion</button></div>
    </div></div>}
  </>;
}
