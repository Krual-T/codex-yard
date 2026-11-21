import * as React from 'react';
import { useCallback, useState } from 'react';
import type { ChromeWindow } from '../browser-reuse/browser-bridge.ts';
import type { ChromeConnections } from '../browser-reuse/client-protocol.ts';
import { installModelProviders } from '../native/model-provider-view.tsx';
import { installBrowserNotifications } from '../native/notification-view.tsx';
import { workspaceThreadRoute } from '../native/history-startup.ts';
import { request, sendHostMessage, writeAtom } from './host.ts';
import { failureText, fetchHost, PageDialog, PageError, PageSection, SettingRow, Toggle, usePageData, type WorkspacePageProps } from './page-controls.tsx';
import { HooksSettings, McpSettings, PluginInventory, TextFileDialog } from './plugins.tsx';
import { usePreference, writePreference } from './preferences.ts';

installModelProviders(React);
installBrowserNotifications(React);
const nativeSettings = window as unknown as Window & {
  workbenchModelProviderSettings(ui: unknown): React.ReactNode;
  workbenchNotificationSettings(ui: unknown): React.ReactNode;
};
const Section = Object.assign(({ children }: { children: React.ReactNode }) => <section className="yard-page-section">{children}</section>, {
  Header: ({ title }: { title: string }) => <h2>{title}</h2>, Content: ({ children }: { children: React.ReactNode }) => <>{children}</>,
});
const NotificationButton = ({ children, onClick, disabled }: { children: React.ReactNode; onClick(): void; disabled: boolean }) =>
  <button type="button" disabled={disabled} onClick={onClick}>{children}</button>;
const groups: { name: string; tabs: [string, string][] }[] = [
  { name: 'Personal', tabs: [['general-settings', 'General'], ['appearance', 'Appearance'], ['archived-chats', 'Archived chats'],
    ['agent', 'Configuration'], ['personalization', 'Personalization'], ['pets', 'Mini & Pets'], ['keyboard-shortcuts', 'Keyboard shortcuts']] },
  { name: 'Integrations', tabs: [['plugins-settings', 'Plugins'], ['computer-use', 'Computer use'], ['browser-use', 'Browser']] },
  { name: 'Coding', tabs: [['hooks-settings', 'Hooks'], ['connections', 'Connections'], ['git-settings', 'Git'], ['local-environments', 'Environments'], ['worktrees', 'Worktrees']] },
];

function PreferenceRow({ label, description, setting, fallback, options, numeric }: {
  label: string; description?: string; setting: string; fallback: string | number | boolean; options?: [string, string][]; numeric?: { min: number; max: number };
}) {
  const value = usePreference(setting, fallback);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save(next: string | number | boolean) {
    if (busy) return; setBusy(true); setError('');
    try { await writePreference(setting, next); if (setting === 'show-context-window-usage') await writeAtom(setting, next); }
    catch (error) { setError(failureText(error)); } finally { setBusy(false); }
  }
  return <><SettingRow label={label} description={description} control={typeof fallback === 'boolean' ?
    <Toggle checked={value === true} disabled={busy} ariaLabel={label} onChange={next => void save(next)} /> : options ?
      <select aria-label={label} disabled={busy} value={String(value)} onChange={event => void save(event.currentTarget.value)}>
        {!options.some(([key]) => key === String(value)) && <option value={String(value)}>{String(value)}</option>}
        {options.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select> :
      <input aria-label={label} type="number" min={numeric?.min} max={numeric?.max} disabled={busy} value={Number(value)}
        onChange={event => { if (event.currentTarget.value && event.currentTarget.validity.valid) void save(Number(event.currentTarget.value)); }} />} />
    <PageError error={error} /></>;
}

function GeneralSettings({ hostId }: { hostId: string }) {
  return <><PageSection title="Composer">
    <PreferenceRow label="Enter behavior" setting="composerEnterBehavior" fallback="enter" options={[
      ['enter', 'Enter to send'], ['cmdIfMultiline', 'Ctrl/Cmd+Enter for multiline messages'], ['cmdAlways', 'Ctrl/Cmd+Enter to send'],
    ]} />
    <PreferenceRow label="Follow-up messages" description="Choose whether to queue a message or steer the current run." setting="followUpQueueMode" fallback="queue"
      options={['queue', 'steer'].map(value => [value, value === 'queue' ? 'Queue' : 'Steer'])} />
    <PreferenceRow label="Show context window usage" setting="show-context-window-usage" fallback={false} />
  </PageSection>
    <PageSection title="Browser notifications">{nativeSettings.workbenchNotificationSettings({ Row: SettingRow, Toggle, Button: NotificationButton })}</PageSection>
    {nativeSettings.workbenchModelProviderSettings({ useHost: () => hostId, Row: SettingRow, Toggle, Section })}
  </>;
}

function AppearanceSettings() {
  return <PageSection title="Appearance">
    <PreferenceRow label="Theme" setting="appearanceTheme" fallback="system" options={[
      ['system', 'System'], ['light', 'Light'], ['dark', 'Dark'],
    ]} />
    <PreferenceRow label="UI font size" setting="sansFontSize" fallback={14} numeric={{ min: 11, max: 24 }} />
    <PreferenceRow label="Code font size" setting="codeFontSize" fallback={12} numeric={{ min: 10, max: 24 }} />
    <PreferenceRow label="Reduce motion" setting="reduced-motion-preference" fallback="system" options={[
      ['system', 'Follow system'], ['on', 'Reduce motion'], ['off', 'Off'],
    ]} />
  </PageSection>;
}

function ConfigurationSettings({ hostId, cwd }: { hostId: string; cwd?: string }) {
  const read = useCallback(() => request<{ config: Record<string, unknown>; layers?: { version?: string; name?: unknown }[] }>('config/read', { includeLayers: true, cwd: cwd ?? null }, { hostId }), [hostId, cwd]);
  const data = usePageData(read);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [file, setFile] = useState<string>();
  const fields: [string, string, [string, string][]][] = [
    ['approval_policy', 'Approval policy', [['untrusted', 'Untrusted commands'], ['on-request', 'On request'], ['never', 'Never ask']]],
    ['sandbox_mode', 'Sandbox settings', [['read-only', 'Read only'], ['workspace-write', 'Workspace write'], ['danger-full-access', 'Full access']]],
    ['web_search', 'Web search', [['disabled', 'Disabled'], ['cached', 'Cached'], ['live', 'Live']]],
    ['model_verbosity', 'Output detail', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]],
    ['model_reasoning_summary', 'Reasoning summary', [['auto', 'Auto'], ['concise', 'Concise'], ['detailed', 'Detailed'], ['none', 'None']]],
  ];
  async function save(key: string, value: string) {
    if (busy) return; setBusy(true); setError('');
    try { await request('config/batchWrite', { edits: [{ keyPath: key, value: value || null, mergeStrategy: 'upsert' }],
      filePath: null, expectedVersion: null, reloadUserConfig: true }, { hostId }); data.refresh(); }
    catch (error) { setError(failureText(error)); } finally { setBusy(false); }
  }
  return <PageSection title="Agent defaults"><p>Changes save to this host’s user configuration and apply to new chats. Project overrides and managed policies may take precedence.</p>
    <button type="button" onClick={() => {
      void fetchHost<{ codexHome: string }>('codex-home', {}, hostId).then(value => setFile(value.codexHome + '/config.toml')).catch(error => setError(failureText(error)));
    }}>Edit config.toml</button>
    <PageError error={error || data.error} retry={data.refresh} />
    {!data.value && !data.error && <p role="status">Loading configuration…</p>}
    {data.value && fields.map(([key, label, options]) => {
      const current = data.value!.config[key];
      return <SettingRow key={key} label={label} description={typeof current === 'object' && current !== null ? JSON.stringify(current) : undefined}
        control={<select aria-label={label} disabled={busy} value={typeof current === 'string' ? current : ''} onChange={event => void save(key, event.currentTarget.value)}>
          <option value="">Model default</option>{typeof current === 'string' && !options.some(([id]) => id === current) && <option>{current}</option>}
          {options.map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select>} />;
    })}
    {file && <TextFileDialog title="config.toml" path={file} hostId={hostId} editable close={() => { setFile(undefined); data.refresh(); }} />}
  </PageSection>;
}

function PersonalizationSettings({ hostId }: { hostId: string }) {
  const [file, setFile] = useState<string>(), [error, setError] = useState('');
  return <PageSection title="Custom instructions"><SettingRow label="Codex instructions" description="Edit AGENTS.md on the selected host. Repository instructions may also apply."
    control={<button type="button" onClick={() => {
      void fetchHost<{ codexHome: string }>('codex-home', {}, hostId).then(value => setFile(value.codexHome + '/AGENTS.md')).catch(error => setError(failureText(error)));
    }}>Edit custom instructions</button>} /><PageError error={error} />
    {file && <TextFileDialog title="AGENTS.md" path={file} hostId={hostId} editable close={() => setFile(undefined)} />}
  </PageSection>;
}

function ArchivedSettings({ hostId, navigate }: { hostId: string; navigate(route: string): void }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const read = useCallback(() => request<{ data: { id: string; name?: string; title?: string; preview: string }[]; nextCursor: string | null }>('thread/list', {
    archived: true, cursor, limit: 50, sortKey: 'updated_at', sortDirection: 'desc', useStateDbOnly: true,
  }, { hostId }), [hostId, cursor]);
  const data = usePageData(read);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function unarchive(id: string) {
    if (busy) return; setBusy(true); setError('');
    try { await request('thread/unarchive', { threadId: id }, { hostId }); data.refresh(); }
    catch (error) { setError(failureText(error)); } finally { setBusy(false); }
  }
  return <PageSection title="Archived chats"><PageError error={error || data.error} retry={data.refresh} />
    {!data.value && !data.error && <p role="status">Loading archived chats…</p>}
    {data.value?.data.length === 0 && <p>No archived chats.</p>}
    {data.value?.data.map(thread => <SettingRow key={thread.id} label={<button type="button" className="yard-page-text-button" onClick={() => navigate(workspaceThreadRoute(hostId, thread.id))}>
      {thread.name ?? thread.title ?? thread.preview ?? 'Untitled chat'}</button>} control={<button type="button" disabled={busy} onClick={() => void unarchive(thread.id)}>Unarchive</button>} />)}
    <div className="yard-page-inline">{cursor && <button type="button" onClick={() => setCursor(null)}>First page</button>}
      {data.value?.nextCursor && <button type="button" onClick={() => setCursor(data.value!.nextCursor)}>Next page</button>}</div>
  </PageSection>;
}

interface SshConnection { hostId: string; displayName: string; sshHost: string; sshAlias: string | null; sshPort: number | null; identity: null; autoConnect: boolean }
function ConnectionsSettings() {
  const read = useCallback(() => fetchHost<{ remoteConnections: SshConnection[] }>('refresh-remote-connections'), []);
  const data = usePageData(read);
  const [editor, setEditor] = useState<SshConnection>(), [deleting, setDeleting] = useState<SshConnection>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save(connections: SshConnection[]) {
    if (busy) return; setBusy(true); setError('');
    try { await fetchHost('save-codex-managed-remote-ssh-connections', { remoteConnections: connections }); setEditor(undefined); setDeleting(undefined); data.refresh(); }
    catch (error) { setError(failureText(error)); } finally { setBusy(false); }
  }
  return <PageSection title="SSH connections"><div className="yard-page-section-heading"><p>Connect to Codex on another host using your SSH configuration.</p>
    <button type="button" disabled={!data.value || busy} onClick={() => setEditor({ hostId: 'remote-ssh-' + crypto.randomUUID(), displayName: '', sshHost: '', sshAlias: null, sshPort: null, identity: null, autoConnect: false })}>Add SSH host</button></div>
    <PageError error={error || data.error} retry={data.refresh} />
    {data.value?.remoteConnections.length === 0 && <p>No SSH hosts configured.</p>}
    {data.value?.remoteConnections.map(connection => <SettingRow key={connection.hostId} label={connection.displayName} description={connection.sshAlias ?? connection.sshHost}
      control={<div className="yard-page-inline"><Toggle checked={connection.autoConnect} disabled={busy} ariaLabel={'Auto-connect ' + connection.displayName} onChange={autoConnect => {
        setBusy(true); setError(''); void fetchHost('set-remote-connection-auto-connect', { autoConnect }, connection.hostId)
          .catch(error => setError(failureText(error))).finally(() => { data.refresh(); setBusy(false); });
      }} /><button type="button" disabled={busy} onClick={() => setEditor(connection)}>Edit</button>
        <button type="button" disabled={busy} onClick={() => setDeleting(connection)}>Remove</button></div>} />)}
    {editor && <PageDialog title="SSH host" close={() => setEditor(undefined)}><form onSubmit={event => {
      event.preventDefault(); void save([...(data.value?.remoteConnections ?? []).filter(connection => connection.hostId !== editor.hostId), editor]);
    }}><fieldset disabled={busy}><label>Name<input required value={editor.displayName} onChange={event => setEditor({ ...editor, displayName: event.currentTarget.value })} /></label>
      <label>SSH host or alias<input required value={editor.sshAlias ?? editor.sshHost} onChange={event => setEditor({ ...editor, sshHost: event.currentTarget.value, sshAlias: null })} /></label>
      <label>Port (optional)<input type="number" min={1} max={65535} value={editor.sshPort ?? ''} onChange={event => setEditor({ ...editor, sshPort: event.currentTarget.value ? Number(event.currentTarget.value) : null })} /></label>
      <PageError error={error} /><footer><button type="button" onClick={() => setEditor(undefined)}>Cancel</button><button type="submit">Save SSH host</button></footer></fieldset></form></PageDialog>}
    {deleting && <PageDialog title="Remove SSH host?" close={() => setDeleting(undefined)}><p>Remove {deleting.displayName}? Active connections to this host will close.</p>
      <PageError error={error} /><footer><button type="button" onClick={() => setDeleting(undefined)}>Cancel</button><button type="button" disabled={busy}
        onClick={() => void save(data.value!.remoteConnections.filter(connection => connection.hostId !== deleting.hostId))}>Remove</button></footer></PageDialog>}
  </PageSection>;
}

function BrowserSettings() {
  const bridge = (window as ChromeWindow).workbenchChrome;
  const read = useCallback(() => bridge ? bridge.connections() : Promise.reject(new Error('Browser connection is unavailable.')), [bridge]);
  const data = usePageData(read);
  const [state, setState] = useState<ChromeConnections>(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const current = state ?? data.value;
  async function act(operation: 'pair' | 'disconnect') {
    if (!bridge || busy) return; setBusy(true); setError('');
    try { setState(await bridge.connections(operation)); } catch (error) { setError(failureText(error)); } finally { setBusy(false); }
  }
  return <PageSection title="Browser connections"><p>Connect Chrome on this device so Codex can use the browser you choose.</p><PageError error={error || data.error} retry={data.refresh} />
    <SettingRow label="This device" description={current?.client.label ?? 'Chrome client'} control={<span>{current?.client.connected ? 'Connected' : 'Disconnected'}</span>} />
    <div className="yard-page-inline"><button type="button" disabled={busy} onClick={() => void act(current?.client.connected ? 'disconnect' : 'pair')}>
      {current?.client.connected ? 'Disconnect Chrome' : 'Pair Chrome'}</button><button type="button" onClick={() => { setState(undefined); data.refresh(); }}>Refresh connection</button>
      <a href="/chrome-client" target="_blank" rel="noreferrer">Chrome client setup</a></div>
    {current?.pairing && <p role="status">Pairing code: <code>{current.pairing.token}</code> · expires {new Date(current.pairing.expiresAt).toLocaleTimeString()}</p>}
    <SettingRow label="Server browser" description={current?.server.label} control={<span>{current?.server.configured ? 'Configured' : 'Not configured'}</span>} />
  </PageSection>;
}

function PetsSettings() {
  const read = useCallback(() => fetchHost<{ avatarDirectory: string; avatars: { id: string; displayName: string }[] }>('custom-avatars'), []);
  const data = usePageData(read);
  const [error, setError] = useState('');
  return <PageSection title="Mini & Pets"><SettingRow label="Pet visibility" description="Show or hide your pet in this browser."
    control={<button type="button" onClick={() => { void sendHostMessage({ type: 'avatar-overlay-open' }).catch(error => setError(failureText(error))); }}>Show / hide Pet</button>} />
    <PreferenceRow label="Pet" setting="selected-avatar-id" fallback="codex" options={[
      ...['Codex', 'Dewey', 'Fireball', 'Hoots', 'Rocky', 'Seedy', 'Stacky', 'BSOD', 'Null Signal'].map(name => [name.toLowerCase().replaceAll(' ', '-'), name] as [string, string]),
      ...(data.value?.avatars.map(avatar => [avatar.id, avatar.displayName] as [string, string]) ?? []),
    ]} /><PreferenceRow label="Pet size" setting="avatar-overlay-mascot-width-px" fallback={112} numeric={{ min: 64, max: 320 }} />
    {data.value && <p>Custom pets: <code>{data.value.avatarDirectory}</code></p>}<PageError error={error || data.error} retry={data.refresh} />
  </PageSection>;
}

function CodingSettings({ section, cwd, hostId }: { section: string; cwd?: string; hostId: string }) {
  const [file, setFile] = useState<string>();
  const title = section === 'git-settings' ? 'Git' : section === 'worktrees' ? 'Worktrees' : 'Environments';
  return <PageSection title={title}>
    {section === 'git-settings' ? <p>Use Git in chat or the terminal for the selected project. Branches, commits and pull requests follow the project’s instructions.</p> :
      section === 'worktrees' ? <p>Yard runs chats in their selected project directory. Manage Git worktrees in chat or the terminal, then add the worktree as a project.</p> :
        <p>Project setup is defined in the repository. Review its environment file or project instructions before running setup commands.</p>}
    <SettingRow label="Selected project directory" control={<code>{cwd ?? 'Choose a project above'}</code>} />
    {cwd && <div className="yard-page-inline"><button type="button" onClick={() => setFile(cwd + '/AGENTS.md')}>Review project instructions</button>
      {section === 'local-environments' && <button type="button" onClick={() => setFile(cwd + '/.codex/environments/environment.toml')}>Review environment.toml</button>}</div>}
    <p className="yard-page-muted">Desktop controls for automatic worktree creation, cleanup and Git publishing are not available in Yard.</p>
    {file && <TextFileDialog title={file.split('/').at(-1)!} path={file} hostId={hostId} close={() => setFile(undefined)} />}
  </PageSection>;
}

export default function SettingsPage({ route, navigate, projects, hosts }: WorkspacePageProps) {
  const section = route.split(/[?#]/)[0]!.split('/')[2] || 'general-settings';
  const title = groups.flatMap(group => group.tabs).find(([id]) => id === section)?.[1] ?? 'Settings';
  const [hostId, setHostId] = useState('local'), [projectId, setProjectId] = useState('');
  const project = projects.find(project => project.id === projectId && project.hostId === hostId);
  const readRoot = useCallback(async () => project ? (await import('./host.ts')).projectRoot(project.id, project.hostId) : undefined, [project?.id, project?.hostId]);
  const root = usePageData(readRoot);
  const cwd = project ? root.value : undefined;
  return <div className="yard-settings-layout"><nav className="yard-settings-nav" aria-label="Settings categories"><h1>Settings</h1>
    {groups.map(group => <section key={group.name}><h2>{group.name}</h2>{group.tabs.map(([id, label]) => <a key={id} href={'/?initialRoute=' + encodeURIComponent('/settings/' + id)}
      aria-current={section === id ? 'page' : undefined} onClick={event => {
        if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); navigate('/settings/' + id); }
      }}>{label}</a>)}</section>)}</nav>
    <article className="yard-workspace-page" aria-label="Settings"><header><h1>{title}</h1><div className="yard-page-inline">
      <label>Host<select value={hostId} onChange={event => { setHostId(event.currentTarget.value); setProjectId(''); }}>{hosts.map(host => <option key={host.hostId} value={host.hostId}>{host.label}</option>)}</select></label>
      <label>Project<select value={projectId} onChange={event => setProjectId(event.currentTarget.value)}><option value="">User defaults</option>
        {projects.filter(project => project.hostId === hostId).map(project => <option key={project.id} value={project.id}>{project.label}</option>)}</select></label>
    </div></header><PageError error={root.error} retry={root.refresh} />
    <div key={section + ':' + hostId + ':' + projectId}>
      {section === 'general-settings' ? <GeneralSettings hostId={hostId} /> : section === 'appearance' ? <AppearanceSettings /> :
        section === 'agent' ? <ConfigurationSettings hostId={hostId} cwd={cwd} /> : section === 'personalization' ? <PersonalizationSettings hostId={hostId} /> :
        section === 'archived-chats' ? <ArchivedSettings hostId={hostId} navigate={navigate} /> : section === 'pets' ? <PetsSettings /> :
        section === 'connections' ? <ConnectionsSettings /> : section === 'browser-use' ? <BrowserSettings /> :
        section === 'plugins-settings' ? <><PluginInventory hostId={hostId} cwd={cwd} /><McpSettings hostId={hostId} /></> :
        section === 'computer-use' ? <PluginInventory hostId={hostId} cwd={cwd} computerOnly /> :
        section === 'hooks-settings' ? <HooksSettings hostId={hostId} cwd={cwd} /> : section === 'keyboard-shortcuts' ? <PageSection title="Keyboard shortcuts">
          {[["Ctrl/Cmd+K", 'Search chats and commands'], ['Ctrl/Cmd+,', 'Open settings'], ['Shift+Enter', 'Insert a new line'], ['Ctrl/Cmd+Shift+Enter', 'Reverse follow-up action'], ['Alt+Super+P', 'Show / hide Pet']].map(([key, action]) =>
            <SettingRow key={key} label={action} control={<kbd>{key}</kbd>} />)}</PageSection> :
        ['git-settings', 'local-environments', 'worktrees'].includes(section) ? <CodingSettings section={section} cwd={cwd} hostId={hostId} /> :
          <p>Select a settings category.</p>}
    </div></article>
  </div>;
}
