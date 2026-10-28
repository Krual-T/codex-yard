import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { StandaloneSettingsProps } from '../workbench-contract.ts';
import { AppearanceSection } from './AppearanceSection.tsx';
import { ArchivedSection } from './ArchivedSection.tsx';
import { CatalogSection } from './CatalogSection.tsx';
import type { CatalogKind } from './catalog.ts';
import { ConnectionsSection } from './ConnectionsSection.tsx';
import { GeneralSection } from './GeneralSection.tsx';
import { ModelSection } from './ModelSection.tsx';
import { Preferences, preferenceKeys } from './preferences.ts';
import { hostPath, readSettingsRoute, sectionPath } from './routing.ts';
import type { SettingsRoute } from './routing.ts';
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
export type SettingsIntegrationProps = Omit<StandaloneSettingsProps, 'onNavigate'> & {
  onNavigate?: (path: string, options?: { replace?: boolean }) => void;
  registerNavigationGuard?: (guard: SettingsNavigationGuard | null) => void;
};
const searchLabels: Record<string, string[]> = {
  'general-settings': ['Default terminal location', 'Prevent sleep while running', 'Automatically archive inactive chats', 'Suggestions', 'Language',
    'Educational tips', 'Plain text composer', 'Show context window usage', 'Send message', 'Follow-up messages'],
  appearance: ['Interface font size', 'Code font size', 'Reduce motion', 'Diff markers', 'Pointer cursors', 'Font smoothing', 'Dock icon',
    'Accent', 'Background', 'Text', 'Added lines', 'Removed lines', 'Skill color', 'Contrast', 'Transparent window', 'Interface font',
    'Content font', 'Code font', 'Code theme', 'Import theme', 'Export theme'],
  models: ['Model', 'Reasoning effort'],
};

export function StandaloneSettings({ client, hostId, initialSection, location, onNavigate, onClose, registerNavigationGuard }: SettingsIntegrationProps) {
  const preferences = useMemo(() => new Preferences(client), [client]);
  const snapshot = useSyncExternalStore(preferences.subscribe, preferences.getSnapshot, preferences.getSnapshot);
  const incoming = readSettingsRoute(location, initialSection, hostId);
  const [route, setRoute] = useState<SettingsRoute>(() => incoming);
  const routeRef = useRef(route);
  routeRef.current = route;
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
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;
  const dirty = preferences.dirty || otherDirty;
  const flags = useRef({ dirty, saving: saving || otherSaving });
  flags.current = { dirty, saving: saving || otherSaving };

  const requestLeave = useCallback((): Promise<boolean> => {
    if (flags.current.saving) return Promise.resolve(false);
    if (!preferences.dirty && !flags.current.dirty) return Promise.resolve(true);
    if (pending.current) return pending.current.promise;
    let resolve: (allowed: boolean) => void = () => {};
    const promise = new Promise<boolean>(done => { resolve = done; });
    pending.current = { promise, resolve };
    setConfirmLeave(true);
    return promise;
  }, [preferences]);
  const finishLeave = (allowed: boolean) => {
    const current = pending.current;
    if (!current) return;
    pending.current = null;
    if (allowed) { preferences.discard(); flags.current.dirty = false; setOtherDirty(false); setEditorRevision(value => value + 1); }
    setConfirmLeave(false);
    current.resolve(allowed);
  };

  useEffect(() => preferences.start(), [preferences]);
  useEffect(() => {
    registerNavigationGuard?.({ requestLeave });
    return () => registerNavigationGuard?.(null);
  }, [registerNavigationGuard, requestLeave]);
  useEffect(() => () => { pending.current?.resolve(false); pending.current = null; }, [preferences]);
  useEffect(() => {
    if (incoming.path === routeRef.current.path && incoming.hostId === routeRef.current.hostId) return;
    const id = ++transition.current;
    void requestLeave().then(allowed => {
      if (id !== transition.current) return;
      if (allowed) setRoute(incoming);
      else if (incoming.path !== routeRef.current.path) navigateRef.current?.(routeRef.current.path, { replace: true });
    });
  }, [incoming.path, incoming.hostId, requestLeave]);
  useEffect(() => {
    if (!route.redirect || !onNavigate) return;
    const next = readSettingsRoute({ pathname: '/settings/general', search: route.search }, undefined, route.hostId);
    setRoute(next);
    onNavigate(route.redirect, { replace: true });
  }, [route.redirect, route.search, route.hostId, onNavigate]);
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
    const preventUnload = (event: BeforeUnloadEvent) => { if (dirty || saving || otherSaving) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', preventUnload);
    return () => window.removeEventListener('beforeunload', preventUnload);
  }, [dirty, saving, otherSaving]);
  useEffect(() => {
    if (!searchTarget || searchTarget.section !== section) return;
    const rows = content.current?.querySelectorAll<HTMLElement>('.yard-setting-row') ?? [];
    const row = Array.from(rows).find(item => item.querySelector('.yard-setting-label')?.textContent === searchTarget.label);
    if (row) {
      row.scrollIntoView({ block: 'center' });
      row.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    }
    setSearchTarget(null);
  }, [searchTarget, section]);

  const guard = (action: () => void) => {
    const id = ++transition.current;
    void requestLeave().then(allowed => { if (allowed && transition.current === id) action(); });
  };
  const navigate = (next: string, label?: string) => {
    const action = () => {
      if (next !== section) {
        const path = sectionPath(next, route);
        setRoute(readSettingsRoute({ pathname: path.split('?')[0], search: path.includes('?') ? path.slice(path.indexOf('?')) : '' }, next, selectedHost));
        onNavigate?.(path);
      }
      setSearch('');
      if (label) setSearchTarget({ section: next, label });
    };
    if (next === section) action(); else guard(action);
  };
  const title = settingsSections.find(item => item.id === section)?.title ?? section;
  const groups = [...new Set(settingsSections.map(item => item.group))];
  const query = search.trim().toLocaleLowerCase();
  const results = query ? settingsSections.flatMap(item => {
    const labels = (searchLabels[item.id] ?? []).filter(label => label.toLocaleLowerCase().includes(query));
    if (item.title.toLocaleLowerCase().includes(query)) labels.unshift(item.title);
    return labels.map(label => ({ section: item.id, title: item.title, label }));
  }) : [];
  const isCatalog = (value: string): value is CatalogKind => ['skills-settings', 'hooks-settings', 'mcp-settings', 'plugins-settings'].includes(value);
  return <div className="yard-settings">
    <aside className="yard-settings-nav" aria-label="Settings navigation">
      <div className="yard-settings-nav-header"><strong>Settings</strong><button type="button" onClick={() => guard(onClose)} aria-label="Close settings">Close</button></div>
      <label className="yard-host-label">Host
        <select aria-label="Settings host" value={selectedHost} onChange={event => {
          const next = event.target.value;
          if (next === selectedHost) return;
          const path = hostPath(next, route);
          guard(() => {
            setRoute(readSettingsRoute({ pathname: path.split('?')[0], search: path.includes('?') ? path.slice(path.indexOf('?')) : '' }, section, next));
            onNavigate?.(path);
          });
        }}>
          <option value="local">Local</option>
          {selectedHost !== 'local' && !hosts.some(host => host.hostId === selectedHost) && <option value={selectedHost}>{selectedHost}</option>}
          {hosts.filter(host => host.hostId !== 'local').map(host => <option key={host.hostId} value={host.hostId}>{host.displayName || host.sshAlias || host.hostId}</option>)}
        </select>
      </label>
      {hostError && <p className="yard-setting-error" role="alert">Could not load hosts: {hostError}</p>}
      <label className="yard-settings-search">Search settings
        <input type="search" aria-label="Search settings" value={search} onChange={event => setSearch(event.target.value)} />
      </label>
      {query && <div className="yard-search-results" aria-label="Settings search results">
        {results.length ? results.map(result => <button type="button" key={`${result.section}:${result.label}`} onClick={() => navigate(result.section, result.label)}>
          <span>{result.label}</span>{result.label !== result.title && <small>{result.title}</small>}</button>) : <p>No settings found.</p>}
      </div>}
      <label className="yard-mobile-section">Section
        <select aria-label="Settings section" value={section} onChange={event => navigate(event.target.value)}>
          {groups.map(group => <optgroup key={group} label={group}>{settingsSections.filter(item => item.group === group).map(item =>
            <option key={item.id} value={item.id}>{item.title}</option>)}</optgroup>)}
        </select>
      </label>
      {!query && groups.map(group => <div className="yard-nav-group" key={group}><h2>{group}</h2>
        {settingsSections.filter(item => item.group === group).map(item => <button type="button" key={item.id} aria-current={section === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}>{item.title}</button>)}
      </div>)}
    </aside>
    <main className="yard-settings-main" aria-label={`${title} settings`}>
      <div className="yard-settings-content" ref={content}>
        {section === 'general-settings' ? <GeneralSection preferences={preferences} snapshot={snapshot} platform={platform} navigate={navigate} /> :
          section === 'appearance' ? <AppearanceSection key={editorRevision} preferences={preferences} snapshot={snapshot} platform={platform} backdropSupported={backdropSupported} onDirtyChange={setOtherDirty} /> :
            section === 'models' ? <ModelSection key={`${selectedHost}:${editorRevision}`} client={client} hostId={selectedHost} onDirtyChange={setOtherDirty} onSavingChange={setOtherSaving} /> :
              isCatalog(section) ? <CatalogSection key={`${selectedHost}:${section}`} client={client} hostId={selectedHost} kind={section} /> :
                section === 'archived-chats' ? <ArchivedSection key={selectedHost} client={client} hostId={selectedHost} onSavingChange={setOtherSaving} /> :
                  section === 'connections' ? <ConnectionsSection client={client} onSavingChange={setOtherSaving} /> :
            <><h2>{title}</h2><p className="yard-setting-error">This settings section is not yet available in the web host.</p></>}
      </div>
      {(preferences.dirty || saving) && <div className="yard-save-bar"><span>Unsaved changes</span><div className="yard-actions">
        <button type="button" disabled={saving} onClick={() => preferences.discard()}>Discard</button>
        <button type="button" disabled={saving || !preferences.dirty} onClick={() => {
          setSaving(true); void preferences.save().finally(() => setSaving(false));
        }}>{saving ? 'Saving...' : 'Save'}</button>
      </div></div>}
      {preferenceKeys.some(key => snapshot[key].saving) && <span className="yard-sr-only" role="status">Saving preferences</span>}
    </main>
    {confirmLeave && <div className="yard-dialog-backdrop"><div className="yard-dialog" role="dialog" aria-modal="true" aria-labelledby="yard-unsaved-title" onKeyDown={event => { if (event.key === 'Escape') finishLeave(false); }}>
      <h2 id="yard-unsaved-title">Discard unsaved changes?</h2><p>Your edits have not been saved.</p>
      <div className="yard-actions"><button type="button" autoFocus onClick={() => finishLeave(false)}>Keep editing</button>
        <button type="button" onClick={() => finishLeave(true)}>Discard changes</button></div>
    </div></div>}
  </div>;
}
