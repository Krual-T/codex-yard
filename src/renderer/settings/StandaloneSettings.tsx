import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { StandaloneSettingsProps } from '../workbench-contract.ts';
import { AppearanceSection } from './AppearanceSection.tsx';
import { GeneralSection } from './GeneralSection.tsx';
import { Preferences, preferenceKeys } from './preferences.ts';
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

const normalizeSection = (value?: string) => {
  const id = value?.replace(/^\/+|\/+$/g, '').replace(/^settings\//, '') || 'general-settings';
  return id === 'general' ? 'general-settings' : id;
};
interface RemoteConnection { hostId: string; displayName?: string; sshAlias?: string }

export function StandaloneSettings({ client, hostId, initialSection, onClose }: StandaloneSettingsProps) {
  const preferences = useMemo(() => new Preferences(client), [client]);
  const snapshot = useSyncExternalStore(preferences.subscribe, preferences.getSnapshot, preferences.getSnapshot);
  const [section, setSection] = useState(() => normalizeSection(initialSection));
  const [selectedHost, setSelectedHost] = useState(hostId);
  const [hosts, setHosts] = useState<RemoteConnection[]>([]);
  const [hostError, setHostError] = useState<string | null>(null);
  const [platform, setPlatform] = useState('unknown');
  const [backdropSupported, setBackdropSupported] = useState(false);
  const [saving, setSaving] = useState(false);
  const [otherDirty, setOtherDirty] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const dirty = preferences.dirty || otherDirty;

  useEffect(() => preferences.start(), [preferences]);
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
    const preventUnload = (event: BeforeUnloadEvent) => { if (dirty || saving) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', preventUnload);
    return () => window.removeEventListener('beforeunload', preventUnload);
  }, [dirty, saving]);

  const guard = (action: () => void) => {
    if (saving) return;
    if (dirty) setPendingAction(() => action); else action();
  };
  const navigate = (next: string) => {
    if (next === section) return;
    guard(() => { setSection(next); setOtherDirty(false); });
  };
  const title = settingsSections.find(item => item.id === section)?.title ?? section;
  const groups = [...new Set(settingsSections.map(item => item.group))];
  return <div className="yard-settings">
    <aside className="yard-settings-nav" aria-label="Settings navigation">
      <div className="yard-settings-nav-header"><strong>Settings</strong><button type="button" onClick={() => guard(onClose)} aria-label="Close settings">Close</button></div>
      <label className="yard-host-label">Host
        <select aria-label="Settings host" value={selectedHost} onChange={event => {
          const next = event.target.value;
          guard(() => { setSelectedHost(next); setOtherDirty(false); });
        }}>
          <option value="local">Local</option>
          {selectedHost !== 'local' && !hosts.some(host => host.hostId === selectedHost) && <option value={selectedHost}>{selectedHost}</option>}
          {hosts.filter(host => host.hostId !== 'local').map(host => <option key={host.hostId} value={host.hostId}>{host.displayName || host.sshAlias || host.hostId}</option>)}
        </select>
      </label>
      {hostError && <p className="yard-setting-error" role="alert">Could not load hosts: {hostError}</p>}
      <label className="yard-mobile-section">Section
        <select aria-label="Settings section" value={section} onChange={event => navigate(event.target.value)}>
          {groups.map(group => <optgroup key={group} label={group}>{settingsSections.filter(item => item.group === group).map(item =>
            <option key={item.id} value={item.id}>{item.title}</option>)}</optgroup>)}
        </select>
      </label>
      {groups.map(group => <div className="yard-nav-group" key={group}><h2>{group}</h2>
        {settingsSections.filter(item => item.group === group).map(item => <button type="button" key={item.id} aria-current={section === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}>{item.title}</button>)}
      </div>)}
    </aside>
    <main className="yard-settings-main" aria-label={`${title} settings`}>
      <div className="yard-settings-content">
        {section === 'general-settings' ? <GeneralSection preferences={preferences} snapshot={snapshot} platform={platform} navigate={navigate} /> :
          section === 'appearance' ? <AppearanceSection preferences={preferences} snapshot={snapshot} platform={platform} backdropSupported={backdropSupported} /> :
            <><h2>{title}</h2><p className="yard-setting-error">This settings section is not yet available in the web host.</p></>}
      </div>
      {(dirty || saving) && <div className="yard-save-bar"><span>Unsaved changes</span><div className="yard-actions">
        <button type="button" disabled={saving} onClick={() => preferences.discard()}>Discard</button>
        <button type="button" disabled={saving || !preferences.dirty} onClick={() => {
          setSaving(true); void preferences.save().finally(() => setSaving(false));
        }}>{saving ? 'Saving...' : 'Save'}</button>
      </div></div>}
      {preferenceKeys.some(key => snapshot[key].saving) && <span className="yard-sr-only" role="status">Saving preferences</span>}
    </main>
    {pendingAction && <div className="yard-dialog-backdrop"><div className="yard-dialog" role="dialog" aria-modal="true" aria-labelledby="yard-unsaved-title">
      <h2 id="yard-unsaved-title">Discard unsaved changes?</h2><p>Your edits have not been saved.</p>
      <div className="yard-actions"><button type="button" autoFocus onClick={() => setPendingAction(null)}>Keep editing</button>
        <button type="button" onClick={() => { preferences.discard(); setOtherDirty(false); setPendingAction(null); pendingAction(); }}>Discard changes</button></div>
    </div></div>}
  </div>;
}
