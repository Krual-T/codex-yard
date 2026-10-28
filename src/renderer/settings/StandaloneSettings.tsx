import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { StandaloneSettingsProps } from '../workbench-contract.ts';
import { I18nProvider, resolveLocale, translateKnown, useI18n } from '../i18n/index.tsx';
import { AgentSection } from './AgentSection.tsx';
import { AppearanceSection } from './AppearanceSection.tsx';
import { ArchivedSection } from './ArchivedSection.tsx';
import { CatalogSection } from './CatalogSection.tsx';
import type { CatalogKind } from './catalog.ts';
import { ConnectionsSection } from './ConnectionsSection.tsx';
import { GeneralSection } from './GeneralSection.tsx';
import { GitSection } from './GitSection.tsx';
import { HookSection } from './HookSection.tsx';
import { KeyboardSection } from './KeyboardSection.tsx';
import { ModelSection } from './ModelSection.tsx';
import { PersonalizationSection } from './PersonalizationSection.tsx';
import { PluginSection } from './PluginSection.tsx';
import { SkillSection } from './SkillSection.tsx';
import { Preferences, preferenceKeys } from './preferences.ts';
import type { PreferenceProps } from './PreferenceControls.tsx';
import { WorktreesSection } from './WorktreesSection.tsx';
import { UsageSection } from './UsageSection.tsx';
import { VoiceSection } from './VoiceSection.tsx';
import { hostPath, readSettingsRoute, sectionPath } from './routing.ts';
import './standalone-settings.css';

export interface SettingsSection { id: string; title: string; group: string }
export const settingsSections: SettingsSection[] = [
  { id: 'general-settings', title: 'General', group: 'Preferences' },
  { id: 'appearance', title: 'Appearance', group: 'Preferences' },
  { id: 'personalization', title: 'Personalization', group: 'Preferences' },
  { id: 'keyboard-shortcuts', title: 'Keyboard shortcuts', group: 'Preferences' },
  { id: 'voice', title: 'Voice', group: 'Preferences' },
  { id: 'models', title: 'Models', group: 'Codex' },
  { id: 'agent', title: 'Agent', group: 'Codex' },
  { id: 'usage', title: 'Usage', group: 'Codex' },
  { id: 'skills-settings', title: 'Skills', group: 'Codex' },
  { id: 'plugins-settings', title: 'Plugins', group: 'Codex' },
  { id: 'mcp-settings', title: 'MCP servers', group: 'Codex' },
  { id: 'hooks-settings', title: 'Hooks', group: 'Codex' },
  { id: 'git-settings', title: 'Git', group: 'Workspace' },
  { id: 'worktrees', title: 'Worktrees', group: 'Workspace' },
  { id: 'local-environments', title: 'Local environments', group: 'Workspace' },
  { id: 'connections', title: 'Connections', group: 'Workspace' },
  { id: 'browser-use', title: 'Browser', group: 'Workspace' },
  { id: 'file-type-handlers', title: 'File handlers', group: 'Workspace' },
  { id: 'archived-chats', title: 'Archived chats', group: 'Data' },
  { id: 'security', title: 'Security', group: 'Data' },
  { id: 'billing', title: 'Billing', group: 'Data' },
  { id: 'time-management', title: 'Time management', group: 'Data' },
  { id: 'extension', title: 'Extension', group: 'Data' },
  { id: 'pets', title: 'Pets', group: 'Data' },
  { id: 'open-source-licenses', title: 'Open source licenses', group: 'Data' },
];

interface RemoteConnection { hostId: string; displayName?: string; sshAlias?: string }
export interface SettingsNavigationGuard { requestLeave(): Promise<boolean> }
export type SettingsIntegrationProps = StandaloneSettingsProps & {
  registerNavigationGuard?: (guard: SettingsNavigationGuard | null) => void;
};
const searchLabels: Record<string, string[]> = {
  'general-settings': ['Default terminal location', 'Prevent sleep while running', 'Automatically archive inactive chats', 'Suggestions', 'Language',
    'Educational tips', 'Plain text composer', 'Show context window usage', 'Send message', 'Follow-up messages'],
  appearance: ['Interface font size', 'Code font size', 'Reduce motion', 'Diff markers', 'Pointer cursors', 'Font smoothing', 'Dock icon',
    'Accent', 'Background', 'Text', 'Added lines', 'Removed lines', 'Skill color', 'Contrast', 'Transparent window', 'Interface font',
    'Content font', 'Code font', 'Code theme', 'Import theme', 'Export theme'],
  models: ['Model', 'Reasoning effort'],
  agent: ['Approval policy', 'Sandbox mode', 'Experimental features'],
  personalization: ['Codex instructions', 'Codex memories', 'Custom instructions', 'ChatGPT memory'],
  voice: ['Microphone', 'Voice chat', 'Dictation'],
  usage: ['Account', 'Usage limits'],
  'git-settings': ['Branch prefix', 'Always force push', 'Create draft pull requests', 'Pull request merge method', 'Disable Git-based diffs',
    'Review delivery', 'Commit instructions', 'Pull request instructions', 'Pull request watch instructions', 'Auto-merge when ready'],
  worktrees: ['Worktree root', 'Always fetch upstream before creating worktrees', 'Automatically delete old worktrees', 'Auto-delete limit'],
  'keyboard-shortcuts': ['Number shortcuts', 'Open web link in default browser'],
};
const remainingSections: Record<string, string> = {
  'local-environments': 'Project setup scripts cannot be managed from this page yet.',
  'browser-use': 'Browser preferences, site access, extensions, history and downloads cannot be managed from this page yet.',
  'file-type-handlers': 'File opening preferences cannot be managed from this page yet.',
  'security': 'Account security controls cannot be managed from this page yet.',
  'billing': 'Billing information cannot be managed from this page yet.',
  'time-management': 'Time management controls cannot be managed from this page yet.',
  'extension': 'Extension settings cannot be managed from this page yet.',
  'pets': 'Pet selection and appearance cannot be managed from this page yet.',
  'open-source-licenses': 'Third-party notices cannot be loaded from this page yet.',
};

function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length ? [...navigator.languages] : navigator.language ? [navigator.language] : [];
}

export function StandaloneSettings(props: SettingsIntegrationProps) {
  const { client } = props;
  const preferences = useMemo(() => new Preferences(client), [client]);
  const snapshot = useSyncExternalStore(preferences.subscribe, preferences.getSnapshot, preferences.getSnapshot);
  const [languages, setLanguages] = useState(browserLanguages);
  const [hostLanguages, setHostLanguages] = useState<readonly string[]>([]);
  useEffect(() => {
    const changed = () => setLanguages(browserLanguages());
    window.addEventListener('languagechange', changed);
    return () => window.removeEventListener('languagechange', changed);
  }, []);
  useEffect(() => {
    let active = true;
    setHostLanguages([]);
    void client.host<{ ideLocale?: unknown; systemLocale?: unknown }>('locale-info').then(info => {
      if (active) setHostLanguages([info?.ideLocale, info?.systemLocale].filter((value): value is string => typeof value === 'string' && value.length > 0));
    }).catch(() => { if (active) setHostLanguages([]); });
    return () => { active = false; };
  }, [client]);
  const locale = resolveLocale(snapshot.localeOverride.saved, [...hostLanguages, ...languages]);
  return <I18nProvider locale={locale}><SettingsPage {...props} preferences={preferences} snapshot={snapshot} /></I18nProvider>;
}

function SettingsPage({ client, hostId, location, onNavigate, onClose, registerNavigationGuard, preferences, snapshot }: SettingsIntegrationProps & PreferenceProps) {
  const { t, locale } = useI18n();
  const route = readSettingsRoute(location, hostId);
  const { section, hostId: selectedHost } = route;
  const [hosts, setHosts] = useState<RemoteConnection[]>([]);
  const [hostError, setHostError] = useState<string | null>(null);
  const [platform, setPlatform] = useState('unknown');
  const [backdropSupported, setBackdropSupported] = useState(false);
  const [saving, setSaving] = useState(false);
  const [otherDirty, setOtherDirty] = useState(false);
  const [otherSaving, setOtherSaving] = useState(false);
  const [editorRevision, setEditorRevision] = useState(0);
  const [search, setSearch] = useState('');
  const [searchTarget, setSearchTarget] = useState<{ section: string; label: string } | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const pending = useRef<{ promise: Promise<boolean>; resolve: (allowed: boolean) => void } | null>(null);
  const transition = useRef(0);
  const dirty = preferences.dirty || otherDirty;
  const anySaving = saving || otherSaving || preferenceKeys.some(key => snapshot[key].saving);
  const flags = useRef({ dirty, saving: anySaving });
  flags.current = { dirty, saving: anySaving };

  const requestLeave = useCallback((): Promise<boolean> => {
    if (flags.current.saving || preferences.saving) return Promise.resolve(false);
    if (!preferences.dirty && !flags.current.dirty) return Promise.resolve(true);
    if (pending.current) return pending.current.promise;
    let resolve: (allowed: boolean) => void = () => {};
    const promise = new Promise<boolean>(done => { resolve = done; });
    pending.current = { promise, resolve };
    setConfirmLeave(true);
    return promise;
  }, [preferences]);
  const finishLeave = (allowed: boolean) => {
    if (allowed && (flags.current.saving || preferences.saving)) return;
    const current = pending.current;
    if (!current) return;
    pending.current = null;
    if (allowed) { preferences.discard(); flags.current.dirty = false; setOtherDirty(false); setEditorRevision(value => value + 1); }
    setConfirmLeave(false);
    current.resolve(allowed);
  };

  useEffect(() => preferences.start(), [preferences]);
  useEffect(() => { preferences.setPlatform(platform); }, [preferences, platform]);
  useEffect(() => {
    registerNavigationGuard?.({ requestLeave });
    return () => registerNavigationGuard?.(null);
  }, [registerNavigationGuard, requestLeave]);
  useEffect(() => () => { pending.current?.resolve(false); pending.current = null; }, [preferences]);
  useEffect(() => {
    if (route.redirect) onNavigate(route.redirect, { replace: true, state: location.state });
  }, [route.redirect, location.state, onNavigate]);
  useEffect(() => {
    let active = true;
    void client.host<{ remoteConnections: RemoteConnection[] }>('refresh-remote-connections').then(result => {
      if (active) { setHosts(Array.isArray(result.remoteConnections) ? result.remoteConnections : []); setHostError(null); }
    }).catch(error => { if (active) setHostError(error instanceof Error ? error.message : String(error)); });
    void client.host<{ platform: string; isSystemBackdropSupported: boolean }>('os-info').then(result => {
      if (active) { setPlatform(result.platform); setBackdropSupported(result.isSystemBackdropSupported); }
    }).catch(() => { if (active) setPlatform('unknown'); });
    return () => { active = false; };
  }, [client]);
  useEffect(() => {
    const preventUnload = (event: BeforeUnloadEvent) => { if (dirty || anySaving) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', preventUnload);
    return () => window.removeEventListener('beforeunload', preventUnload);
  }, [dirty, anySaving]);
  useEffect(() => {
    if (!searchTarget || searchTarget.section !== section) return;
    const rows = content.current?.querySelectorAll<HTMLElement>('.yard-setting-row') ?? [];
    const row = Array.from(rows).find(item => item.dataset.settingLabel === searchTarget.label);
    if (row) {
      row.scrollIntoView({ block: 'center' });
      row.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    }
    setSearchTarget(null);
  }, [searchTarget, section]);
  useEffect(() => {
    if (!location.hash) return;
    let id = location.hash.slice(1);
    try { id = decodeURIComponent(id); } catch { return; }
    const target = document.getElementById(id);
    if (target && content.current?.contains(target)) {
      target.scrollIntoView({ block: 'center' });
      target.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    }
  }, [location.hash, section]);

  const guard = (action: () => void) => {
    const id = ++transition.current;
    void requestLeave().then(allowed => { if (allowed && transition.current === id) action(); });
  };
  const navigate = (next: string, label?: string) => {
    const action = () => {
      if (next !== section) {
        const path = sectionPath(next, route);
        onNavigate(path, { state: location.state });
      }
      setSearch('');
      if (label) setSearchTarget({ section: next, label });
    };
    if (next === section) action(); else guard(action);
  };
  const title = translateKnown(t, settingsSections.find(item => item.id === section)?.title ?? section);
  const groups = [...new Set(settingsSections.map(item => item.group))];
  const query = search.trim().toLocaleLowerCase(locale);
  const results = query ? settingsSections.flatMap(item => {
    const matches = (value: string) => value.toLocaleLowerCase(locale).includes(query) || translateKnown(t, value).toLocaleLowerCase(locale).includes(query);
    const labels = (searchLabels[item.id] ?? []).filter(matches);
    if (matches(item.title)) labels.unshift(item.title);
    return labels.map(label => ({ section: item.id, title: translateKnown(t, item.title), label, display: translateKnown(t, label), isTitle: label === item.title }));
  }) : [];
  const isCatalog = (value: string): value is CatalogKind => ['skills-settings', 'hooks-settings', 'mcp-settings', 'plugins-settings'].includes(value);
  return <div className="yard-settings">
    <aside className="yard-settings-nav" aria-label={t('Settings navigation')}>
      <div className="yard-settings-nav-header"><strong>{t('Settings')}</strong><button type="button" onClick={() => guard(onClose)} aria-label={t('Close settings')}>{t('Close')}</button></div>
      {route.pathname.slice('/settings/'.length).includes('/') && <button type="button" onClick={() => guard(() => onNavigate(route.path, { delta: -1, state: location.state }))}>{t('Back')}</button>}
      <label className="yard-host-label">{t('Host')}
        <select aria-label={t('Settings host')} value={selectedHost} onChange={event => {
          const next = event.target.value;
          if (next === selectedHost) return;
          const path = hostPath(next, route);
          guard(() => onNavigate(path, { state: location.state }));
        }}>
          <option value="local">{t('Local')}</option>
          {selectedHost !== 'local' && !hosts.some(host => host.hostId === selectedHost) && <option value={selectedHost}>{selectedHost}</option>}
          {hosts.filter(host => host.hostId !== 'local').map(host => <option key={host.hostId} value={host.hostId}>{host.displayName || host.sshAlias || host.hostId}</option>)}
        </select>
      </label>
      {hostError && <p className="yard-setting-error" role="alert">{t('Could not load hosts:')} {hostError}</p>}
      <label className="yard-settings-search">{t('Search settings')}
        <input type="search" aria-label={t('Search settings')} value={search} onChange={event => setSearch(event.target.value)} />
      </label>
      {query && <div className="yard-search-results" aria-label={t('Settings search results')}>
        {results.length ? results.map(result => <button type="button" key={`${result.section}:${result.label}`} onClick={() => navigate(result.section, result.label)}>
          <span>{result.display}</span>{!result.isTitle && <small>{result.title}</small>}</button>) : <p>{t('No settings found.')}</p>}
      </div>}
      <label className="yard-mobile-section">{t('Section')}
        <select aria-label={t('Settings section')} value={section} onChange={event => navigate(event.target.value)}>
          {groups.map(group => <optgroup key={group} label={translateKnown(t, group)}>{settingsSections.filter(item => item.group === group).map(item =>
            <option key={item.id} value={item.id}>{translateKnown(t, item.title)}</option>)}</optgroup>)}
        </select>
      </label>
      {!query && groups.map(group => <div className="yard-nav-group" key={group}><h2>{translateKnown(t, group)}</h2>
        {settingsSections.filter(item => item.group === group).map(item => <button type="button" key={item.id} aria-current={section === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}>{translateKnown(t, item.title)}</button>)}
      </div>)}
    </aside>
    <main className="yard-settings-main" aria-label={locale.startsWith('en') ? `${title} settings` : `${t('Settings')}: ${title}`}>
      <div className="yard-settings-content" ref={content}>
        {section === 'general-settings' ? <GeneralSection preferences={preferences} snapshot={snapshot} platform={platform} navigate={navigate} /> :
          section === 'appearance' ? <AppearanceSection key={editorRevision} preferences={preferences} snapshot={snapshot} platform={platform} backdropSupported={backdropSupported} onDirtyChange={setOtherDirty} /> :
            section === 'models' ? <ModelSection key={`${selectedHost}:${editorRevision}`} client={client} hostId={selectedHost} onDirtyChange={setOtherDirty} onSavingChange={setOtherSaving} /> :
              section === 'agent' ? <AgentSection key={`${selectedHost}:${editorRevision}`} client={client} hostId={selectedHost} onDirtyChange={setOtherDirty} onSavingChange={setOtherSaving} /> :
                section === 'personalization' ? <PersonalizationSection key={`${selectedHost}:${editorRevision}`} client={client} hostId={selectedHost} onDirtyChange={setOtherDirty} onSavingChange={setOtherSaving} /> :
                  section === 'voice' ? <VoiceSection preferences={preferences} snapshot={snapshot} /> :
                    section === 'usage' ? <UsageSection key={selectedHost} client={client} hostId={selectedHost} /> :
              section === 'git-settings' ? <GitSection preferences={preferences} snapshot={snapshot} suspended={confirmLeave} /> :
                section === 'worktrees' ? <WorktreesSection key={`${selectedHost}:${editorRevision}`} client={client} hostId={selectedHost}
                  preferences={preferences} snapshot={snapshot} onDirtyChange={setOtherDirty} onSavingChange={setOtherSaving} /> :
                  section === 'keyboard-shortcuts' ? <KeyboardSection client={client} preferences={preferences} snapshot={snapshot} platform={platform} /> :
              section === 'plugins-settings' ? <PluginSection key={selectedHost} client={client} hostId={selectedHost} route={route}
                navigate={path => guard(() => onNavigate(path, { state: location.state }))} /> :
              section === 'hooks-settings' ? <HookSection key={`${selectedHost}:${editorRevision}`} client={client} hostId={selectedHost}
                onDirtyChange={setOtherDirty} onSavingChange={setOtherSaving} /> :
              section === 'skills-settings' ? <SkillSection key={`${selectedHost}:${editorRevision}`} client={client} hostId={selectedHost}
                onDirtyChange={setOtherDirty} onSavingChange={setOtherSaving} /> :
              isCatalog(section) ? <CatalogSection key={`${selectedHost}:${section}`} client={client} hostId={selectedHost} kind={section} /> :
                section === 'archived-chats' ? <ArchivedSection key={selectedHost} client={client} hostId={selectedHost} onSavingChange={setOtherSaving} /> :
                  section === 'connections' ? <ConnectionsSection client={client} onSavingChange={setOtherSaving} /> :
            <><h2>{title}</h2><p className="yard-setting-error">{remainingSections[section] ?? 'This settings page cannot be displayed yet.'}</p></>}
      </div>
      {(preferences.dirty || anySaving) && <div className="yard-save-bar"><span>{t('Unsaved changes')}</span><div className="yard-actions">
        <button type="button" disabled={anySaving} onClick={() => preferences.discard()}>{t('Discard')}</button>
        <button type="button" disabled={anySaving || !preferences.dirty} onClick={() => {
          setSaving(true); void preferences.save().finally(() => setSaving(false));
        }}>{saving ? t('Saving...') : t('Save')}</button>
      </div></div>}
      {preferenceKeys.some(key => snapshot[key].saving) && <span className="yard-sr-only" role="status">{t('Saving preferences')}</span>}
    </main>
    {confirmLeave && <div className="yard-dialog-backdrop"><div className="yard-dialog" role="dialog" aria-modal="true" aria-labelledby="yard-unsaved-title" onKeyDown={event => { if (event.key === 'Escape') finishLeave(false); }}>
      <h2 id="yard-unsaved-title">{t('Discard unsaved changes?')}</h2><p>{t('Your edits have not been saved.')}</p>
      <div className="yard-actions"><button type="button" autoFocus onClick={() => finishLeave(false)}>{t('Keep editing')}</button>
        <button type="button" disabled={anySaving} onClick={() => finishLeave(true)}>{t('Discard changes')}</button></div>
    </div></div>}
  </div>;
}
