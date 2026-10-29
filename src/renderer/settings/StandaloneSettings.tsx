import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ComponentType } from 'react';
import { Archive, ArrowLeft, ArrowRight, GitBranch, GitPullRequest, Keyboard, Plug, Search, Settings, ShieldCheck, Sun, TerminalSquare, UserRound, Webhook } from 'lucide-react';
import type { StandaloneSettingsProps } from '../workbench-contract.ts';
import { translateKnown, useI18n } from '../i18n/index.tsx';
import { AgentSection } from './AgentSection.tsx';
import { AppearanceSection } from './AppearanceSection.tsx';
import { ArchivedSection } from './ArchivedSection.tsx';
import { CatalogSection } from './CatalogSection.tsx';
import type { CatalogKind } from './catalog.ts';
import { ConnectionsSection } from './ConnectionsSection.tsx';
import { ConfigurationRecovery } from './ConfigurationRecovery.tsx';
import { settingsConfigOperations } from './config-operations.ts';
import { GeneralSection } from './GeneralSection.tsx';
import { GitSection } from './GitSection.tsx';
import { HookSection } from './HookSection.tsx';
import type { HookSectionMemory } from './HookSection.tsx';
import { KeyboardSection } from './KeyboardSection.tsx';
import { ModelSection } from './ModelSection.tsx';
import { SettingsBrowserIntegrations } from './SettingsBrowserIntegrations.tsx';
import type { SettingsBrowserIntegrationsProps } from './SettingsBrowserIntegrations.tsx';
import { PersonalizationSection } from './PersonalizationSection.tsx';
import type { SettingsInstructionEditorProps } from './PersonalizationSection.tsx';
import { PluginSection } from './PluginSection.tsx';
import { SkillSection } from './SkillSection.tsx';
import type { SkillSectionMemory } from './SkillSection.tsx';
import { Preferences, preferenceKeys } from './preferences.ts';
import type { PreferenceProps } from './PreferenceControls.tsx';
import { PreferenceConflicts } from './PreferenceConflicts.tsx';
import { WorktreesSection } from './WorktreesSection.tsx';
import { UsageSection } from './UsageSection.tsx';
import { VoiceSection } from './VoiceSection.tsx';
import { hostPath, readSettingsRoute, sectionPath } from './routing.ts';
import { scopeKey, settingsScope } from './scope.ts';
import type { SettingsProjectRoots, SettingsSessionCwd } from './scope.ts';
import { settingsSearchItems } from './search.ts';
import './standalone-settings.css';

export interface SettingsSection { id: string; title: string; group: string }
export const settingsSections: SettingsSection[] = [
  { id: 'general-settings', title: 'General', group: 'Personal' },
  { id: 'appearance', title: 'Appearance', group: 'Personal' },
  { id: 'archived-chats', title: 'Archived chats', group: 'Personal' },
  { id: 'configuration', title: 'Configuration', group: 'Personal' },
  { id: 'personalization', title: 'Personalization', group: 'Personal' },
  { id: 'keyboard-shortcuts', title: 'Keyboard shortcuts', group: 'Personal' },
  { id: 'plugins-settings', title: 'Plugins', group: 'Integrations' },
  { id: 'hooks-settings', title: 'Hooks', group: 'Coding' },
  { id: 'git-settings', title: 'Git', group: 'Coding' },
  { id: 'local-environments', title: 'Environments', group: 'Coding' },
  { id: 'worktrees', title: 'Worktrees', group: 'Coding' },
  { id: 'voice', title: 'Voice', group: 'Codex' },
  { id: 'models', title: 'Models', group: 'Codex' },
  { id: 'agent', title: 'Agent', group: 'Codex' },
  { id: 'usage', title: 'Usage', group: 'Codex' },
  { id: 'skills-settings', title: 'Skills', group: 'Codex' },
  { id: 'mcp-settings', title: 'MCP servers', group: 'Codex' },
  { id: 'connections', title: 'Connections', group: 'Workspace' },
  { id: 'browser-use', title: 'Browser', group: 'Workspace' },
  { id: 'computer-use', title: 'Computer use', group: 'Workspace' },
  { id: 'file-type-handlers', title: 'File handlers', group: 'Workspace' },
  { id: 'security', title: 'Security', group: 'Data' },
  { id: 'billing', title: 'Billing', group: 'Data' },
  { id: 'time-management', title: 'Time management', group: 'Data' },
  { id: 'extension', title: 'Extension', group: 'Data' },
  { id: 'open-source-licenses', title: 'Open source licenses', group: 'Data' },
];

const primaryGroups = ['Personal', 'Integrations', 'Coding'] as const;
const sectionIcons: Record<string, ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }>> = {
  'general-settings': Settings, appearance: Sun, 'archived-chats': Archive, configuration: ShieldCheck,
  personalization: UserRound, 'keyboard-shortcuts': Keyboard, 'plugins-settings': Plug,
  'hooks-settings': Webhook, 'git-settings': GitBranch, 'local-environments': TerminalSquare, worktrees: GitPullRequest,
};

interface RemoteConnection { hostId: string; displayName?: string; sshAlias?: string }
export interface SettingsNavigationGuard { requestLeave(): Promise<boolean> }
export type SettingsIntegrationProps = StandaloneSettingsProps & {
  registerNavigationGuard?: (guard: SettingsNavigationGuard | null) => void;
  onOpenArchivedThread?: (hostId: string, threadId: string) => Promise<void>;
  onOpenConfig?: Parameters<typeof AgentSection>[0]['onOpenConfig'];
  browserIntegrations?: Pick<SettingsBrowserIntegrationsProps, 'captureAuthority' | 'navigate' | 'rawFeatureSource' | 'originalGates' | 'onTryPlugin'>;
  projectRoots: SettingsProjectRoots | null;
  sessionCwd: SettingsSessionCwd | null;
  scopeStatus?: { state: 'loading' | 'error' | 'ready'; error?: string; retry(): void };
  InstructionEditor: ComponentType<SettingsInstructionEditorProps>;
};
const remainingSections: Record<string, string> = {
  'local-environments': 'Project setup scripts cannot be managed from this page yet.',
  'file-type-handlers': 'File opening preferences cannot be managed from this page yet.',
  'security': 'Account security controls cannot be managed from this page yet.',
  'billing': 'Billing information cannot be managed from this page yet.',
  'time-management': 'Time management controls cannot be managed from this page yet.',
  'extension': 'Extension settings cannot be managed from this page yet.',
  'open-source-licenses': 'Third-party notices cannot be loaded from this page yet.',
};

export function StandaloneSettings(props: SettingsIntegrationProps) {
  const { client } = props;
  const preferences = useMemo(() => new Preferences(client), [client]);
  const snapshot = useSyncExternalStore(preferences.subscribe, preferences.getSnapshot, preferences.getSnapshot);
  return <SettingsPage {...props} preferences={preferences} snapshot={snapshot} />;
}

function SettingsPage({ client, hostId, location, onNavigate, onClose, registerNavigationGuard, onOpenArchivedThread, onOpenConfig, browserIntegrations, projectRoots, sessionCwd, scopeStatus, InstructionEditor, preferences, snapshot }: SettingsIntegrationProps & PreferenceProps) {
  const { t, locale } = useI18n();
  const configurationOperations = useMemo(() => settingsConfigOperations(client), [client]);
  const recovery = useSyncExternalStore(configurationOperations.subscribe, configurationOperations.getSnapshot, configurationOperations.getSnapshot);
  const route = readSettingsRoute(location, hostId);
  const { section, hostId: selectedHost } = route;
  const projectScope = settingsScope(selectedHost, projectRoots, sessionCwd);
  const foreignScope = !!(projectRoots && projectRoots.hostId !== selectedHost || sessionCwd && sessionCwd.hostId !== selectedHost);
  const scopeState = scopeStatus?.state === 'ready' && foreignScope ? 'loading' : scopeStatus?.state ?? 'ready';
  const hookMemory = useRef<HookSectionMemory | null>(null);
  const skillMemory = useRef<SkillSectionMemory | null>(null);
  const [hosts, setHosts] = useState<RemoteConnection[]>([]);
  const [hostError, setHostError] = useState<string | null>(null);
  const [platform, setPlatform] = useState('unknown');
  const [backdropSupported, setBackdropSupported] = useState(false);
  const [saving, setSaving] = useState(false);
  const [otherDirty, setOtherDirty] = useState(false);
  const [appearanceInvalid, setAppearanceInvalid] = useState(false);
  const [otherSaving, setOtherSaving] = useState(false);
  const [recoveryEditing, setRecoveryEditing] = useState(false);
  const recoveryEditingRef = useRef(false);
  const onRecoveryPending = useCallback((value: boolean) => { recoveryEditingRef.current = value; setRecoveryEditing(value); }, []);
  const [editorRevision, setEditorRevision] = useState(0);
  const [search, setSearch] = useState('');
  const [searchTarget, setSearchTarget] = useState<{ section: string; id: string; hostId: string } | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [discardError, setDiscardError] = useState<string | null>(null);
  const discardInFlight = useRef(false);
  const editorDiscard = useRef<(() => Promise<boolean>) | null>(null);
  const registerDiscard = useCallback((discard: (() => Promise<boolean>) | null) => { editorDiscard.current = discard; }, []);
  const pending = useRef<{ promise: Promise<boolean>; resolve: (allowed: boolean) => void } | null>(null);
  const transition = useRef(0);
  const dirty = preferences.dirty || otherDirty || !!recovery.localRetry.length || !!recovery.draftRetry.length
    || recovery.records.some(item => item.phase === 'pending' || item.phase === 'unknown' || item.phase === 'blocked');
  const anySaving = saving || otherSaving || recoveryEditing || recovery.draftPending > 0 || recovery.inFlight.length > 0 || preferenceKeys.some(key => snapshot[key].saving);
  const flags = useRef({ dirty, saving: anySaving });
  flags.current = { dirty, saving: anySaving };

  useLayoutEffect(() => {
    if (section !== 'hooks-settings') hookMemory.current = null;
    if (section !== 'skills-settings') skillMemory.current = null;
  }, [section]);

  const requestLeave = useCallback((): Promise<boolean> => {
    if (recoveryEditingRef.current || flags.current.saving || preferences.saving) return Promise.resolve(false);
    if (!preferences.dirty && !flags.current.dirty) return Promise.resolve(true);
    if (pending.current) return pending.current.promise;
    let resolve: (allowed: boolean) => void = () => {};
    const promise = new Promise<boolean>(done => { resolve = done; });
    pending.current = { promise, resolve };
    setConfirmLeave(true);
    return promise;
  }, [preferences]);
  const finishLeave = async (allowed: boolean) => {
    if (discardInFlight.current || allowed && (recoveryEditingRef.current || flags.current.saving || preferences.saving)) return;
    const current = pending.current;
    if (!current) return;
    if (allowed) {
      discardInFlight.current = true; setDiscarding(true); setDiscardError(null);
      try {
        const retained = section === 'hooks-settings' ? hookMemory.current?.settings : section === 'skills-settings' ? skillMemory.current?.settings : null;
        const discard = editorDiscard.current ?? (retained ? () => retained.discard() : null);
        if (discard && !await discard()) {
          setDiscardError('Could not discard this configuration edit. Retry or keep editing.'); return;
        }
        preferences.discard(); flags.current.dirty = false; setOtherDirty(false); setEditorRevision(value => value + 1);
      } catch (error) {
        setDiscardError(`Could not discard this configuration edit: ${error instanceof Error ? error.message : String(error)}`); return;
      } finally { discardInFlight.current = false; setDiscarding(false); }
    }
    pending.current = null; setConfirmLeave(false); setDiscardError(null); current.resolve(allowed);
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
    const preventUnload = (event: BeforeUnloadEvent) => { if (recoveryEditingRef.current || dirty || anySaving) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', preventUnload);
    return () => window.removeEventListener('beforeunload', preventUnload);
  }, [dirty, anySaving]);
  useEffect(() => {
    if (!searchTarget || searchTarget.section !== section || searchTarget.hostId !== selectedHost || !content.current) return;
    const root = content.current;
    const findTarget = () => {
      const target = searchTarget.id === '__heading__' ? root.querySelector<HTMLElement>('h1, h2') :
        Array.from(root.querySelectorAll<HTMLElement>('[data-setting-id]')).find(item => item.dataset.settingId === searchTarget.id);
      if (!target || !target.getClientRects().length) return;
      target.scrollIntoView({ block: 'center' });
      const control = target.matches('input, select, textarea, button') ? target :
        target.querySelector<HTMLElement>('[contenteditable="true"], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)') ??
        target.querySelector<HTMLElement>('button:not(:disabled)');
      if (searchTarget.id === 'instructions' && !target.querySelector('[contenteditable="true"], textarea:not(:disabled)')) return;
      if (control) control.focus(); else { target.tabIndex = -1; target.focus(); }
      setSearchTarget(null);
    };
    const observer = new MutationObserver(findTarget);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'hidden', 'class', 'style'] });
    findTarget();
    return () => observer.disconnect();
  }, [searchTarget, section, selectedHost]);
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
  const navigate = (next: string, targetId?: string) => {
    const action = () => {
      if (next !== section) {
        const path = sectionPath(next, route);
        onNavigate(path, { state: location.state });
      }
      setSearch('');
      setSearchTarget(targetId ? { section: next, id: targetId, hostId: selectedHost } : null);
    };
    if (next === section) action(); else guard(action);
  };
  const title = translateKnown(t, settingsSections.find(item => item.id === section)?.title ?? section);
  const groups = [...new Set(settingsSections.map(item => item.group))];
  const query = search.trim().toLocaleLowerCase(locale);
  const results = query ? settingsSections.flatMap(item => {
    const matches = (value: string) => value.toLocaleLowerCase(locale).includes(query) || translateKnown(t, value).toLocaleLowerCase(locale).includes(query);
    const entries = (settingsSearchItems[item.id] ?? []).filter(entry => matches(entry.label) &&
      !(item.id === 'general-settings' && entry.id === 'terminal-location' && !snapshot['app-shell-bottom-panel-launcher-visible'].value) &&
      !(item.id === 'general-settings' && entry.id === 'prevent-sleep' && platform === 'windows') &&
      !(item.id === 'appearance' && ['font-smoothing', 'dock-icon'].includes(entry.id) && platform !== 'macOS') &&
      !(item.id === 'appearance' && entry.id === 'transparent-window' && !backdropSupported));
    if (matches(item.title)) entries.unshift({ id: '__heading__', label: item.title });
    return entries.map(entry => ({ section: item.id, title: translateKnown(t, item.title), id: entry.id,
      display: translateKnown(t, entry.label), isTitle: entry.id === '__heading__' }));
  }) : [];
  const isCatalog = (value: string): value is CatalogKind => ['skills-settings', 'hooks-settings', 'mcp-settings', 'plugins-settings'].includes(value);
  const needsScope = section === 'plugins-settings' || section === 'hooks-settings' || section === 'skills-settings'
    || section === 'browser-use' || section === 'computer-use';
  return <div className="yard-settings">
    <aside className="yard-settings-nav" aria-label={t('Settings navigation')}>
      <div className="yard-settings-history">
        <button type="button" aria-label={t('Back')} title={t('Back')} onClick={() => guard(() => onNavigate(route.path, { delta: -1, state: location.state }))}><ArrowLeft size={16} /></button>
        <button type="button" aria-label="Forward" title="Forward" onClick={() => guard(() => onNavigate(route.path, { delta: 1, state: location.state }))}><ArrowRight size={16} /></button>
      </div>
      <button type="button" className="yard-settings-back" onClick={() => guard(onClose)}><ArrowLeft size={16} />{translateKnown(t, 'Back to app')}</button>
      {(hosts.some(host => host.hostId !== 'local') || selectedHost !== 'local') && <label className="yard-host-label">{t('Host')}
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
      </label>}
      {hostError && <p className="yard-setting-error" role="alert">{t('Could not load hosts:')} {hostError}</p>}
      <label className="yard-settings-search"><Search size={15} aria-hidden="true" /><span className="yard-sr-only">{t('Search settings')}</span>
        <input type="search" placeholder={translateKnown(t, 'Search')} aria-label={t('Search settings')} value={search} onChange={event => setSearch(event.target.value)} />
      </label>
      {query && <div className="yard-search-results" aria-label={t('Settings search results')}>
        {results.length ? results.map(result => <button type="button" key={`${result.section}:${result.id}`} onClick={() => navigate(result.section, result.id)}>
          <span>{result.display}</span>{!result.isTitle && <small>{result.title}</small>}</button>) : <p>{t('No settings found.')}</p>}
      </div>}
      <label className="yard-mobile-section">{t('Section')}
        <select aria-label={t('Settings section')} value={section} onChange={event => navigate(event.target.value)}>
          {groups.map(group => <optgroup key={group} label={translateKnown(t, group)}>{settingsSections.filter(item => item.group === group).map(item =>
            <option key={item.id} value={item.id}>{translateKnown(t, item.title)}</option>)}</optgroup>)}
        </select>
      </label>
      {!query && primaryGroups.map(group => <div className="yard-nav-group" key={group}><h2>{translateKnown(t, group)}</h2>
        {settingsSections.filter(item => item.group === group).map(item => { const Icon = sectionIcons[item.id]; return <button type="button" key={item.id} aria-current={section === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}>{Icon && <Icon size={15} strokeWidth={1.7} aria-hidden={true} />}{translateKnown(t, item.title)}</button>; })}
      </div>)}
    </aside>
    <main className="yard-settings-main" aria-label={locale.startsWith('en') ? `${title} settings` : `${t('Settings')}: ${title}`}>
      <div className="yard-settings-content" ref={content}>
        <ConfigurationRecovery client={client} hostId={selectedHost} onPendingChange={onRecoveryPending} captureAuthority={browserIntegrations ? host => browserIntegrations.captureAuthority(host).assertCurrent : undefined} />
        {needsScope && scopeState !== 'ready' ? scopeState === 'error' ?
          <p className="yard-setting-error" role="alert">{t('Selected project or session')}: {t('Unavailable')}{scopeStatus?.error ? `: ${scopeStatus.error}` : ''}{' '}
            <button type="button" className="yard-link" onClick={() => scopeStatus?.retry()}>{t('Retry')}</button></p> :
          <p role="status">{t('Selected project or session')}: {t('Loading...')}</p> :
        section === 'general-settings' ? <GeneralSection preferences={preferences} snapshot={snapshot} platform={platform} navigate={navigate} /> :
          section === 'appearance' ? <AppearanceSection key={editorRevision} preferences={preferences} snapshot={snapshot} platform={platform} backdropSupported={backdropSupported} onDirtyChange={setOtherDirty} onInvalidChange={setAppearanceInvalid} revealTarget={searchTarget?.section === section ? searchTarget.id : null} /> :
            section === 'configuration' ? <><div className="yard-configuration-heading"><h1>{translateKnown(t, 'Configuration')}</h1>
              <p>{t('Configure permissions, web access, and agent responses for new chats')}{' '}
                <a href="https://developers.openai.com/codex/config-basic" target="_blank" rel="noreferrer">{t('Learn more')}</a></p></div>
              <AgentSection key={`${selectedHost}:${editorRevision}`} client={client} hostId={selectedHost} onDirtyChange={setOtherDirty} onSavingChange={setOtherSaving} registerDiscard={registerDiscard} onOpenConfig={onOpenConfig} /></> :
            section === 'models' ? <ModelSection key={`${selectedHost}:${editorRevision}`} client={client} hostId={selectedHost} onDirtyChange={setOtherDirty} onSavingChange={setOtherSaving} registerDiscard={registerDiscard} /> :
                section === 'agent' ? <AgentSection key={`${selectedHost}:${editorRevision}`} client={client} hostId={selectedHost} onDirtyChange={setOtherDirty} onSavingChange={setOtherSaving} registerDiscard={registerDiscard} onOpenConfig={onOpenConfig} /> :
                section === 'personalization' ? <PersonalizationSection key={`${selectedHost}:${editorRevision}`} client={client} hostId={selectedHost} InstructionEditor={InstructionEditor} onDirtyChange={setOtherDirty} onSavingChange={setOtherSaving} /> :
                  section === 'voice' ? <VoiceSection preferences={preferences} snapshot={snapshot} /> :
                    section === 'usage' ? <UsageSection key={selectedHost} client={client} hostId={selectedHost} /> :
              section === 'git-settings' ? <GitSection preferences={preferences} snapshot={snapshot} suspended={confirmLeave} /> :
                section === 'worktrees' ? <WorktreesSection key={`${selectedHost}:${editorRevision}`} client={client} hostId={selectedHost}
                  preferences={preferences} snapshot={snapshot} onDirtyChange={setOtherDirty} onSavingChange={setOtherSaving} registerDiscard={registerDiscard} /> :
                  section === 'keyboard-shortcuts' ? <KeyboardSection client={client} preferences={preferences} snapshot={snapshot} platform={platform} /> :
              section === 'plugins-settings' ? <PluginSection key={`${selectedHost}:${scopeKey(projectScope)}`} client={client} hostId={selectedHost} route={route} projectScope={projectScope}
                navigate={path => guard(() => onNavigate(path, { state: location.state }))} /> :
              section === 'browser-use' || section === 'computer-use' ? browserIntegrations ? <SettingsBrowserIntegrations {...browserIntegrations}
                client={client} route={route} cwd={projectScope.paths[0] ?? ''} preferences={preferences} snapshot={snapshot}
                platform={platform === 'macOS' || platform === 'darwin' ? 'macOS' : platform === 'windows' || platform === 'win32' ? 'windows' : platform === 'linux' ? 'linux' : 'unknown'} /> :
                <p role="alert">{translateKnown(t, 'This action is unavailable on this web host.')}</p> :
              section === 'hooks-settings' ? <HookSection key={`${selectedHost}:${editorRevision}`} client={client} hostId={selectedHost}
                captureReadAuthority={browserIntegrations ? () => browserIntegrations.captureAuthority(selectedHost).assertCurrent : undefined}
                projectScope={projectScope} memory={hookMemory} revision={editorRevision} onDirtyChange={setOtherDirty} onSavingChange={setOtherSaving} registerDiscard={registerDiscard} /> :
              section === 'skills-settings' ? <SkillSection key={`${selectedHost}:${editorRevision}`} client={client} hostId={selectedHost}
                captureReadAuthority={browserIntegrations ? () => browserIntegrations.captureAuthority(selectedHost).assertCurrent : undefined}
                projectScope={projectScope} memory={skillMemory} revision={editorRevision} onDirtyChange={setOtherDirty} onSavingChange={setOtherSaving} registerDiscard={registerDiscard} /> :
              isCatalog(section) ? <CatalogSection key={`${selectedHost}:${section}`} client={client} hostId={selectedHost} kind={section} /> :
                section === 'archived-chats' ? <ArchivedSection key={selectedHost} client={client} hostId={selectedHost} onSavingChange={setOtherSaving}
                  onOpenThread={onOpenArchivedThread ? threadId => onOpenArchivedThread(selectedHost, threadId) : undefined} /> :
                  section === 'connections' ? <ConnectionsSection client={client} onSavingChange={setOtherSaving} /> :
            <><h2>{title}</h2><p className="yard-setting-error">{remainingSections[section] ?? 'This settings page cannot be displayed yet.'}</p></>}
      </div>
      <PreferenceConflicts preferences={preferences} snapshot={snapshot} />
      {(preferences.dirty || anySaving) && <div className="yard-save-bar"><span>{t('Unsaved changes')}</span><div className="yard-actions">
        <button type="button" disabled={anySaving} onClick={() => {
          preferences.discard();
          if (section === 'appearance') { setOtherDirty(false); setEditorRevision(value => value + 1); }
        }}>{t('Discard')}</button>
        <button type="button" disabled={anySaving || appearanceInvalid || !preferences.dirty || preferenceKeys.some(key => snapshot[key].conflict)} onClick={() => {
          setSaving(true); void preferences.save().finally(() => setSaving(false));
        }}>{saving ? t('Saving...') : t('Save')}</button>
      </div></div>}
      {preferenceKeys.some(key => snapshot[key].saving) && <span className="yard-sr-only" role="status">{t('Saving preferences')}</span>}
    </main>
    {confirmLeave && <div className="yard-dialog-backdrop"><div className="yard-dialog" role="dialog" aria-modal="true" aria-labelledby="yard-unsaved-title" onKeyDown={event => { if (event.key === 'Escape') void finishLeave(false); }}>
      <h2 id="yard-unsaved-title">{t('Discard unsaved changes?')}</h2><p>{t('Your edits have not been saved.')}</p>
      {discardError && <p className="yard-setting-error" role="alert">{discardError}</p>}
      <div className="yard-actions"><button type="button" autoFocus disabled={discarding} onClick={() => { void finishLeave(false); }}>{t('Keep editing')}</button>
        <button type="button" disabled={anySaving || discarding} onClick={() => { void finishLeave(true); }}>{t('Discard changes')}</button></div>
    </div></div>}
  </div>;
}
