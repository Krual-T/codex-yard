import { useLayoutEffect, useState } from 'react';
import { useI18n } from '../i18n/index.tsx';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { entryState, Row } from './PreferenceControls.tsx';
import type { PreferenceProps } from './PreferenceControls.tsx';
import { RemoteWorktreesSection } from './RemoteWorktreesSection.tsx';

type WorktreesProps = PreferenceProps & { client: WorkbenchClient; hostId: string;
  onDirtyChange: (dirty: boolean) => void; onSavingChange: (saving: boolean) => void;
  registerDiscard?: (discard: (() => Promise<boolean>) | null) => void };

function UpstreamControl({ preferences, snapshot }: PreferenceProps) {
  const { t } = useI18n();
  const upstream = snapshot['worktree-upstream-refresh-mode'];
  return <Row label="Always fetch upstream before creating worktrees" error={upstream.error} retry={() => { void preferences.reload('worktree-upstream-refresh-mode'); }}>
    <input type="checkbox" role="switch" aria-label={t('Always fetch upstream before creating worktrees')} checked={upstream.value === 'best-effort'}
      disabled={entryState(upstream).disabled} onChange={event => {
        preferences.edit('worktree-upstream-refresh-mode', event.target.checked ? 'best-effort' : 'never');
        void preferences.saveOne('worktree-upstream-refresh-mode');
      }} />
  </Row>;
}

export function WorktreesSection(props: WorktreesProps) {
  return props.hostId === 'local' ? <LocalWorktreesSection {...props} /> :
    <RemoteWorktreesSection client={props.client} hostId={props.hostId} onDirtyChange={props.onDirtyChange} onSavingChange={props.onSavingChange}
      registerDiscard={props.registerDiscard}
      upstream={<UpstreamControl preferences={props.preferences} snapshot={props.snapshot} />} />;
}

function LocalWorktreesSection({ preferences, snapshot, onDirtyChange }: WorktreesProps) {
  const { t } = useI18n();
  const [keepText, setKeepText] = useState<string | null>(null);
  const [keepError, setKeepError] = useState<string | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const root = snapshot['git-worktree-root'], cleanup = snapshot['worktree-auto-cleanup-enabled'];
  const keep = snapshot['worktree-keep-count'];
  const keepDirty = keepText !== null && keepText !== String(keep.value);
  useLayoutEffect(() => { onDirtyChange(keepDirty); }, [keepDirty, onDirtyChange]);
  const saveKeep = () => {
    if (keepText === null) return;
    const input = keepText.trim();
    if (!input) { setKeepText(null); setKeepError(null); return; }
    const count = Number.parseInt(input, 10);
    if (!Number.isSafeInteger(count)) { setKeepError(t('Enter a whole number.')); return; }
    preferences.edit('worktree-keep-count', Math.max(1, count));
    setKeepText(null); setKeepError(null);
    void preferences.saveOne('worktree-keep-count');
  };
  return <>
    <h2>{t('Worktrees')}</h2>
    <p className="yard-muted">{t('Creating and automatically cleaning up worktrees are not available for this connection.')}</p>
    <div className="yard-setting-group">
      <Row label="Worktree root" description="Directory for managed worktrees; leave blank for the default." error={root.error}
        retry={() => { void preferences.reload('git-worktree-root'); }}>
        <input type="text" aria-label={t('Worktree root')} value={root.value} disabled={entryState(root).disabled}
          onChange={event => preferences.edit('git-worktree-root', event.target.value)}
          onBlur={() => { void preferences.saveOne('git-worktree-root'); }} onKeyDown={event => {
            if (event.key === 'Enter' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's')) {
              event.preventDefault(); void preferences.saveOne('git-worktree-root');
            }
          }} />
      </Row>
      <UpstreamControl preferences={preferences} snapshot={snapshot} />
      <Row label="Automatically delete old worktrees" error={cleanup.error} retry={() => { void preferences.reload('worktree-auto-cleanup-enabled'); }}>
        <input type="checkbox" role="switch" aria-label={t('Automatically delete old worktrees')} checked={cleanup.value}
          disabled={entryState(cleanup).disabled} onChange={event => {
            if (!event.target.checked) setConfirmDisable(true);
            else { preferences.edit('worktree-auto-cleanup-enabled', true); void preferences.saveOne('worktree-auto-cleanup-enabled'); }
          }} />
      </Row>
      <Row label="Auto-delete limit" description="Number of recent managed worktrees to keep." error={keepError || keep.error}
        retry={keep.error ? () => { void preferences.saveOne('worktree-keep-count'); } : undefined}>
        <input type="number" min={1} step={1} aria-label={t('Auto-delete limit')} value={keepText ?? String(keep.value)}
          disabled={!cleanup.value || entryState(keep).disabled} onChange={event => { setKeepText(event.target.value); setKeepError(null); }}
          onBlur={saveKeep} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); saveKeep(); } }} />
      </Row>
    </div>
    {confirmDisable && <div className="yard-dialog-backdrop"><div className="yard-dialog" role="dialog" aria-modal="true" aria-labelledby="yard-worktree-confirm">
      <h2 id="yard-worktree-confirm">{t('Disable automatic worktree deletion?')}</h2><p>{t('Old worktrees will remain until they are removed manually.')}</p>
      <div className="yard-actions"><button type="button" autoFocus onClick={() => setConfirmDisable(false)}>{t('Keep automatic deletion')}</button>
        <button type="button" onClick={() => { setConfirmDisable(false); preferences.edit('worktree-auto-cleanup-enabled', false); void preferences.saveOne('worktree-auto-cleanup-enabled'); }}>{t('Disable automatic deletion')}</button></div>
    </div></div>}
  </>;
}
