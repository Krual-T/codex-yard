import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { canEditSkill, SkillSettings } from './skills.ts';
import { scopeKey, validScopePath } from './scope.ts';
import type { SettingsScope } from './scope.ts';
import { translateKnown, useI18n } from '../i18n/index.tsx';
import { SettingsDraftRecovery } from './SettingsDraftRecovery.tsx';

export interface SkillSectionMemory {
  client: WorkbenchClient; hostId: string; revision: number; cwd: string; scopeError: string | null; query: string;
  scope: { origin: string; paths: string[] }; settings: SkillSettings;
}

export function SkillSection({ client, hostId, projectScope, memory, revision, onDirtyChange, onSavingChange, registerDiscard, captureReadAuthority }: {
  client: WorkbenchClient; hostId: string; projectScope: SettingsScope; onDirtyChange: (dirty: boolean) => void; onSavingChange: (saving: boolean) => void;
  memory: RefObject<SkillSectionMemory | null>; revision: number;
  registerDiscard?: (discard: (() => Promise<boolean>) | null) => void;
  captureReadAuthority?: () => () => void;
}) {
  const { t } = useI18n();
  const [retained] = useState(() => memory.current?.client === client && memory.current.hostId === hostId && memory.current.revision === revision ? memory.current : null);
  const [cwd, setCwd] = useState(() => retained?.cwd ?? '');
  const incomingKey = scopeKey(projectScope);
  const [scope, setScope] = useState(() => retained?.scope ?? { origin: incomingKey, paths: projectScope.paths });
  const [scopeError, setScopeError] = useState<string | null>(() => retained?.scopeError ?? null);
  const [query, setQuery] = useState(() => retained?.query ?? '');
  const settings = useMemo(() => retained?.scope === scope && retained.client === client && retained.hostId === hostId && retained.revision === revision ?
    retained.settings : new SkillSettings(client, hostId, scope.paths, undefined, captureReadAuthority), [client, hostId, revision, scope, retained]);
  const state = useSyncExternalStore(settings.subscribe, settings.getSnapshot, settings.getSnapshot);
  const scopeChanged = scope.origin !== incomingKey;
  useLayoutEffect(() => { memory.current = { client, hostId, revision, cwd, scopeError, query, scope, settings }; }, [client, hostId, revision, cwd, scopeError, query, scope, settings, memory]);
  useLayoutEffect(() => {
    if (scopeChanged) return () => { settings.dispose(); onSavingChange(false); };
    const unsubscribe = client.subscribe(event => {
      if (event.type === 'mcp-notification' && event.hostId === hostId && event.method === 'skills/changed') settings.invalidate();
    });
    void settings.load();
    return () => { unsubscribe(); settings.dispose(); onSavingChange(false); };
  }, [client, hostId, settings, scopeChanged, onSavingChange]);
  useEffect(() => {
    if (scopeChanged && !settings.dirty && !state.draftStorageError && !state.saving && !state.draftSaving && !state.loading && !state.writeUncertain) {
      setScope({ origin: incomingKey, paths: projectScope.paths }); setCwd(''); setScopeError(null);
    }
  }, [scopeChanged, incomingKey, projectScope, settings, state.drafts, state.draftStorageError, state.saving, state.draftSaving, state.loading, state.writeUncertain]);
  useLayoutEffect(() => { onDirtyChange(settings.dirty || Boolean(state.draftStorageError)); }, [settings, state.drafts, state.draftStorageError, onDirtyChange]);
  useLayoutEffect(() => { onSavingChange(state.saving || state.draftSaving); }, [state.saving, state.draftSaving, onSavingChange]);
  useLayoutEffect(() => { registerDiscard?.(() => settings.discard()); return () => registerDiscard?.(null); }, [settings, registerDiscard]);
  const locked = state.loading || state.saving || state.latest !== null || state.needsRefresh || state.writeUncertain || scopeChanged;
  const search = query.trim().toLocaleLowerCase();
  const visible = state.skills.filter(skill => [skill.name, skill.displayName, skill.description, skill.scope, skill.path]
    .some(value => value.toLocaleLowerCase().includes(search)));
  return <>
    <div className="yard-section-heading"><h2>{t('Skills')}</h2><button type="button" disabled={state.loading || state.saving} onClick={() => { void settings.load(); }}>{t('Refresh')}</button></div>
    <SettingsDraftRecovery client={client} hostId={hostId} section="skills-settings" scope={scope.paths} editorId={settings.editorId}
      disabled={settings.dirty || state.loading || state.saving || state.draftSaving || scopeChanged} onRestore={draft => settings.restoreDraft(draft)} />
    <form className="yard-filter" onSubmit={event => { event.preventDefault(); if (!settings.dirty && !state.draftStorageError && !state.saving && !state.writeUncertain && !scopeChanged) {
      if (cwd && !validScopePath(cwd)) { setScopeError('Enter an absolute working directory.'); return; }
      const paths = cwd ? [cwd] : projectScope.paths;
      setScopeError(null);
      if (JSON.stringify(scope.paths) === JSON.stringify(paths)) void settings.load(); else setScope({ origin: incomingKey, paths });
    } }}>
      <label>{t('Working directory')} <input value={cwd} disabled={settings.dirty || !!state.draftStorageError || state.saving || state.writeUncertain || scopeChanged} onChange={event => setCwd(event.target.value)} placeholder={t('Selected project or session')} /></label>
      <button type="submit" disabled={settings.dirty || !!state.draftStorageError || state.saving || state.loading || state.writeUncertain || scopeChanged}>{t('Show')}</button>
    </form>
    <p className="yard-muted">{scope.paths.length ? `${t('Scope:')} ${scope.paths.join(', ')}` : t('Select a project or session with a working directory.')}</p>
    {scopeError && <p className="yard-setting-error" role="alert">{translateKnown(t, scopeError)}</p>}
    {scopeChanged && (settings.dirty || state.writeUncertain) && <div className="yard-setting-error" role="alert"><p>{t('The selected project changed. Your skill edits remain in the previous scope.')}</p>
      <button type="button" disabled={state.saving || state.writeUncertain} onClick={() => { void settings.discard().then(discarded => {
        if (discarded) { setScope({ origin: incomingKey, paths: projectScope.paths }); setCwd(''); }
      }); }}>{t('Discard edits and switch scope')}</button></div>}
    <label className="yard-plugin-search">{t('Search skills')}<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
    {state.error && <p className="yard-setting-error" role="alert">{state.error}</p>}
    {state.draftStorageError && <p className="yard-setting-error" role="alert">Could not save the newer edit in this browser: {state.draftStorageError}{' '}
      <button type="button" onClick={() => { void settings.retryDraftPersistence(); }}>Retry saving edit</button></p>}
    {state.warnings.map((warning, index) => <p className="yard-setting-error" key={`${warning}:${index}`}>{warning}</p>)}
    {state.loading && <p role="status">{t('Loading skills...')}</p>}
    {!state.loading && !state.error && !visible.length && <p className="yard-muted">{t(search ? 'No matching skills.' : 'No skills found.')}</p>}
    {state.latest && <div className="yard-skill-conflict" role="alert">
      <p>{t('Current skill state on the host:')}</p>
      <ul>{state.drafts.map(draft => {
        const previous = state.skills.find(skill => skill.id === draft.id), current = state.latest?.find(skill => skill.id === draft.id);
        return <li key={draft.id}>{previous?.displayName ?? draft.id}: {current ? t(current.enabled ? 'Enabled' : 'Disabled') : 'No longer present'}; {t('Your edit:')} {t(draft.enabled ? 'Enabled' : 'Disabled')}</li>;
      })}</ul>
      <button type="button" disabled={state.writeUncertain || state.saving} onClick={() => settings.useLatest()}>{t('Use current state and keep edits')}</button>
    </div>}
    {state.writeUncertain && <p className="yard-setting-error" role="alert">{t('The previous save has an unknown result. The host must confirm it has ended before another save.')}</p>}
    <div className="yard-setting-group">{visible.map(skill => <div className="yard-setting-row" key={skill.id}>
      <div className="yard-setting-copy"><div className="yard-setting-label">{skill.displayName}</div>
        <div className="yard-setting-description">{skill.description}</div>
        <div className="yard-setting-description">{skill.scope}{skill.pluginId ? ` | ${skill.pluginId}` : ''}</div>
        <details className="yard-skill-details"><summary>{t('Details')}</summary><p>Path: <code>{skill.path}</code></p></details>
        {!canEditSkill(skill, state.skills) && <div className="yard-setting-error">This skill shares its selector with another entry and cannot be changed here.</div>}
      </div>
      <div className="yard-setting-control"><input type="checkbox" aria-label={`${skill.displayName} (${skill.scope}, ${skill.path})`}
        checked={state.drafts.find(draft => draft.id === skill.id)?.enabled ?? skill.enabled} disabled={locked || !canEditSkill(skill, state.skills)}
        onChange={event => settings.edit(skill.id, event.target.checked)} /></div>
    </div>)}</div>
    {settings.dirty && <div className="yard-inline-save"><span>{t('Unsaved skill changes')}</span><div className="yard-actions">
      <button type="button" disabled={state.saving || state.loading || state.writeUncertain} onClick={() => { void settings.discard(); }}>{t('Discard')}</button>
      <button type="button" disabled={locked} onClick={() => { void settings.save(); }}>{t(state.saving ? 'Saving...' : 'Save')}</button>
    </div></div>}
  </>;
}
