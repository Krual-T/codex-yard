import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n/index.tsx';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { Row } from './PreferenceControls.tsx';
import { RemoteWorktreeSettings } from './worktrees.ts';
import { SettingsDraftRecovery } from './SettingsDraftRecovery.tsx';

export function RemoteWorktreesSection({ client, hostId, onDirtyChange, onSavingChange, registerDiscard, upstream }: {
  client: WorkbenchClient; hostId: string; onDirtyChange: (dirty: boolean) => void;
  onSavingChange: (saving: boolean) => void; upstream: ReactNode;
  registerDiscard?: (discard: (() => Promise<boolean>) | null) => void;
}) {
  const { t } = useI18n();
  const settings = useMemo(() => new RemoteWorktreeSettings(client, hostId), [client, hostId]);
  const state = useSyncExternalStore(settings.subscribe, settings.getSnapshot, settings.getSnapshot);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const dirty = settings.dirty;
  useEffect(() => { void settings.load(); return () => settings.dispose(); }, [settings]);
  useLayoutEffect(() => { onDirtyChange(dirty || Boolean(state.draftStorageError)); }, [dirty, state.draftStorageError, onDirtyChange]);
  useLayoutEffect(() => { onSavingChange(state.saving || state.draftSaving); }, [state.saving, state.draftSaving, onSavingChange]);
  useLayoutEffect(() => { registerDiscard?.(() => settings.discard()); return () => registerDiscard?.(null); }, [settings, registerDiscard]);
  return <>
    <h2>{t('Worktrees')}</h2>
    <SettingsDraftRecovery client={client} hostId={hostId} section="worktrees" editorId={settings.editorId}
      disabled={dirty || state.loading || state.saving || state.draftSaving} onRestore={draft => settings.restoreDraft(draft)} />
    <p className="yard-muted">Worktree preferences for {hostId}.</p>
    <p className="yard-muted">{t('Creating and automatically cleaning up worktrees are not available for this connection.')}</p>
    {state.loading && <p role="status">{t('Loading remote settings...')}</p>}
    {state.error && <p className="yard-setting-error" role="alert">{state.error} <button type="button" className="yard-link" disabled={state.loading || state.saving}
      onClick={() => { void settings.load(true); }}>Reload and review</button></p>}
    {state.writeError && <p className="yard-setting-error" role="alert">{state.writeError} <button type="button" className="yard-link" disabled={state.loading || state.saving}
      onClick={() => { void settings.load(true); }}>Reload and review</button></p>}
    {state.draftStorageError && <p className="yard-setting-error" role="alert">Could not save the newer edit in this browser: {state.draftStorageError}{' '}
      <button type="button" onClick={() => { void settings.retryDraftPersistence(); }}>Retry saving edit</button></p>}
    {state.warning && <p role="status">{state.warning}</p>}
    {state.conflicts.map(field => <div className="yard-setting-error" role="alert" key={field}>
      <p>{field === 'root' ? 'Worktree root' : field === 'autoCleanup' ? 'Automatic deletion' : 'Auto-delete limit'} changed elsewhere. Current: {String(state.saved?.[field])}; your edit: {String(state.draft?.[field])}.</p>
      <div className="yard-actions"><button type="button" disabled={state.saving} onClick={() => settings.resolveConflict(field, 'current')}>{t('Use current value')}</button>
        <button type="button" disabled={state.saving} onClick={() => settings.resolveConflict(field, 'draft')}>{t('Keep my change')}</button></div>
    </div>)}
    <div className="yard-setting-group">
      {state.draft && <Row label="Worktree root" description="Directory for managed worktrees; leave blank for the default.">
        <input type="text" aria-label={t('Worktree root')} value={state.draft.root} disabled={state.saving}
          onChange={event => settings.edit({ root: event.target.value })} />
      </Row>}
      {upstream}
      {state.draft && <>
        <Row label="Automatically delete old worktrees"><input type="checkbox" role="switch" aria-label={t('Automatically delete old worktrees')}
          checked={state.draft.autoCleanup} disabled={state.saving} onChange={event => {
            if (!event.target.checked) setConfirmDisable(true); else settings.edit({ autoCleanup: true });
          }} /></Row>
        <Row label="Auto-delete limit" description="Number of recent managed worktrees to keep.">
          <input type="number" min={1} step={1} aria-label={t('Auto-delete limit')} value={state.draft.keepCount}
            disabled={!state.draft.autoCleanup || state.saving} onChange={event => settings.edit({ keepCount: event.target.value })} />
        </Row>
      </>}
    </div>
    {dirty && <div className="yard-inline-save"><span>{t('Unsaved worktree settings')}</span><div className="yard-actions">
      <button type="button" disabled={state.saving} onClick={() => { void settings.discard(); }}>{t('Discard')}</button>
      <button type="button" disabled={state.loading || state.saving || Boolean(state.writeError) || state.conflicts.length > 0} onClick={() => { void settings.save(); }}>{t(state.saving ? 'Saving...' : 'Save')}</button>
    </div></div>}
    {confirmDisable && <div className="yard-dialog-backdrop"><div className="yard-dialog" role="dialog" aria-modal="true" aria-labelledby="yard-remote-worktree-confirm">
      <h2 id="yard-remote-worktree-confirm">{t('Disable automatic worktree deletion?')}</h2><p>{t('Old worktrees will remain until they are removed manually.')}</p>
      <div className="yard-actions"><button type="button" autoFocus onClick={() => setConfirmDisable(false)}>{t('Keep automatic deletion')}</button>
        <button type="button" onClick={() => { setConfirmDisable(false); settings.edit({ autoCleanup: false }); }}>{t('Disable automatic deletion')}</button></div>
    </div></div>}
  </>;
}
