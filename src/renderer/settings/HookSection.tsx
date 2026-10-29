import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { canEditHook, HookSettings } from './hooks.ts';
import type { HookEntry } from './hooks.ts';
import { scopeKey, validScopePath } from './scope.ts';
import type { SettingsScope } from './scope.ts';
import { translateKnown, useI18n } from '../i18n/index.tsx';
import { SettingsDraftRecovery } from './SettingsDraftRecovery.tsx';

const eventLabel = (hook: HookEntry) => hook.eventName.charAt(0).toUpperCase() + hook.eventName.slice(1);
const trustLabel = (hook: HookEntry) => hook.isManaged || hook.trustStatus === 'managed' ? 'Managed' : hook.trustStatus === 'untrusted' ? 'Needs review'
  : hook.trustStatus === 'modified' ? 'Changed since review' : hook.trustStatus === 'trusted' ? '' : 'Trust status unknown';

export interface HookSectionMemory {
  client: WorkbenchClient; hostId: string; revision: number; cwd: string; scopeError: string | null;
  scope: { origin: string; paths: string[] }; settings: HookSettings;
}

export function HookSection({ client, hostId, projectScope, memory, revision, onDirtyChange, onSavingChange, registerDiscard, captureReadAuthority }: {
  client: WorkbenchClient; hostId: string; projectScope: SettingsScope; onDirtyChange: (dirty: boolean) => void; onSavingChange: (saving: boolean) => void;
  memory: RefObject<HookSectionMemory | null>; revision: number;
  registerDiscard?: (discard: (() => Promise<boolean>) | null) => void;
  captureReadAuthority?: () => () => void;
}) {
  const { t } = useI18n();
  const [retained] = useState(() => memory.current?.client === client && memory.current.hostId === hostId && memory.current.revision === revision ? memory.current : null);
  const [cwd, setCwd] = useState(() => retained?.cwd ?? '');
  const incomingKey = scopeKey(projectScope);
  const [scope, setScope] = useState(() => retained?.scope ?? { origin: incomingKey, paths: projectScope.paths });
  const [scopeError, setScopeError] = useState<string | null>(() => retained?.scopeError ?? null);
  const settings = useMemo(() => retained?.scope === scope && retained.client === client && retained.hostId === hostId && retained.revision === revision ?
    retained.settings : new HookSettings(client, hostId, scope.paths, undefined, captureReadAuthority), [client, hostId, revision, scope, retained]);
  const state = useSyncExternalStore(settings.subscribe, settings.getSnapshot, settings.getSnapshot);
  const scopeChanged = scope.origin !== incomingKey;
  useLayoutEffect(() => { memory.current = { client, hostId, revision, cwd, scopeError, scope, settings }; }, [client, hostId, revision, cwd, scopeError, scope, settings, memory]);
  useLayoutEffect(() => {
    if (!scopeChanged) void settings.load();
    return () => { settings.dispose(); onSavingChange(false); };
  }, [settings, scopeChanged, onSavingChange]);
  useEffect(() => {
    if (scopeChanged && !settings.dirty && !state.draftStorageError && !state.saving && !state.draftSaving && !state.loading && !state.writeUncertain) {
      setScope({ origin: incomingKey, paths: projectScope.paths }); setCwd(''); setScopeError(null);
    }
  }, [scopeChanged, incomingKey, projectScope, settings, state.drafts, state.draftStorageError, state.saving, state.draftSaving, state.loading, state.writeUncertain]);
  useLayoutEffect(() => { onDirtyChange(settings.dirty || Boolean(state.draftStorageError)); }, [settings, state.drafts, state.draftStorageError, onDirtyChange]);
  useLayoutEffect(() => { onSavingChange(state.saving || state.draftSaving); }, [state.saving, state.draftSaving, onSavingChange]);
  useLayoutEffect(() => { registerDiscard?.(() => settings.discard()); return () => registerDiscard?.(null); }, [settings, registerDiscard]);
  const locked = state.loading || state.saving || state.writeUncertain || state.latest !== null || scopeChanged;
  return <>
    <div className="yard-section-heading"><h2>{t('Hooks')}</h2><button type="button" disabled={state.loading || state.saving} onClick={() => { void settings.load(); }}>{t('Refresh')}</button></div>
    <SettingsDraftRecovery client={client} hostId={hostId} section="hooks-settings" scope={scope.paths} editorId={settings.editorId}
      disabled={settings.dirty || state.loading || state.saving || state.draftSaving || scopeChanged} onRestore={draft => settings.restoreDraft(draft)} />
    <form className="yard-filter" onSubmit={event => { event.preventDefault(); if (!settings.dirty && !state.draftStorageError && !state.saving && !scopeChanged) {
      if (cwd && !validScopePath(cwd)) { setScopeError('Enter an absolute working directory.'); return; }
      const paths = cwd ? [cwd] : projectScope.paths;
      setScopeError(null);
      if (JSON.stringify(scope.paths) === JSON.stringify(paths)) void settings.load(); else setScope({ origin: incomingKey, paths });
    } }}>
      <label>{t('Working directory')} <input value={cwd} disabled={settings.dirty || !!state.draftStorageError || state.saving || scopeChanged} onChange={event => setCwd(event.target.value)} placeholder={t('Selected project or session')} /></label>
      <button type="submit" disabled={settings.dirty || !!state.draftStorageError || state.saving || state.loading || scopeChanged}>{t('Show')}</button>
    </form>
    <p className="yard-muted">{scope.paths.length ? `${t('Scope:')} ${scope.paths.join(', ')}` : t('Select a project or session with a working directory.')}</p>
    {scopeError && <p className="yard-setting-error" role="alert">{translateKnown(t, scopeError)}</p>}
    {scopeChanged && settings.dirty && <div className="yard-setting-error" role="alert"><p>{t('The selected project changed. Your hook edits remain in the previous scope.')}</p>
      <button type="button" disabled={state.saving || state.writeUncertain} onClick={() => { void settings.discard().then(discarded => {
        if (discarded) { setScope({ origin: incomingKey, paths: projectScope.paths }); setCwd(''); }
      }); }}>{t('Discard edits and switch scope')}</button></div>}
    {state.error && <p className="yard-setting-error" role="alert">{translateKnown(t, state.error)}</p>}
    {state.draftStorageError && <p className="yard-setting-error" role="alert">Could not save the newer edit in this browser: {state.draftStorageError}{' '}
      <button type="button" onClick={() => { void settings.retryDraftPersistence(); }}>Retry saving edit</button></p>}
    {state.targetError && <p className="yard-setting-error">{state.targetError}</p>}
    {state.warnings.map((warning, index) => <p className="yard-setting-error" key={`${warning}:${index}`}>{warning}</p>)}
    {state.loading && <p role="status">{t('Loading hooks...')}</p>}
    {!state.loading && !state.error && !state.hooks.length && <p className="yard-muted">{t('No hooks found.')}</p>}
    {state.latest && <div className="yard-hook-conflict" role="alert">
      <p>Current hook state on the host:</p>
      <ul>{state.drafts.map(draft => {
        const previous = state.hooks.find(hook => hook.key === draft.key), current = state.latest?.find(hook => hook.key === draft.key);
        return <li key={draft.key}>{previous ? eventLabel(previous) : draft.key}: {current ? `Configured ${current.enabled ? 'enabled' : 'disabled'}${trustLabel(current) ? ` | ${trustLabel(current)}` : ''}` : 'No longer present'}; your edit: {draft.enabled ? 'Enabled' : 'Disabled'}</li>;
      })}</ul>
      <button type="button" disabled={state.writeUncertain || state.saving} onClick={() => settings.useLatest()}>Use current state and keep edits</button>
    </div>}
    <div className="yard-setting-group">{state.hooks.map((hook, index) => {
      const desired = state.drafts.find(draft => draft.key === hook.key)?.enabled ?? hook.enabled;
      return <div className="yard-setting-row" key={hook.key}>
        <div className="yard-setting-copy"><div className="yard-setting-label">{eventLabel(hook)}{hook.matcher ? ` | ${hook.matcher}` : ''}</div>
          <div className="yard-setting-description">{[hook.source, trustLabel(hook)].filter(Boolean).join(' | ')}</div>
          <details className="yard-hook-details"><summary>{t('Details')}</summary>
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
    {settings.dirty && <div className="yard-inline-save"><span>{t('Unsaved hook changes')}</span><div className="yard-actions">
      <button type="button" disabled={state.saving || state.loading || state.writeUncertain} onClick={() => { void settings.discard(); }}>{t('Discard')}</button>
      <button type="button" disabled={locked || state.needsRefresh || !!state.targetError} onClick={() => { void settings.save(); }}>{t(state.saving ? 'Saving...' : 'Save')}</button>
    </div></div>}
  </>;
}
