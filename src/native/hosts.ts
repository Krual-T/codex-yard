import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { record } from './protocol.ts';
import type { SshHost } from './ssh.ts';

export interface RemoteProject { id: string; hostId: string; label: string; remotePath: string }
export interface HostCatalog { hosts: SshHost[]; projects: RemoteProject[]; assignments: Record<string, unknown> }

// Read only the desktop's registered SSH profiles and project metadata. SSH
// identities remain on the server; the desktop's state file is never written.
export async function loadHostCatalog(codexHome: string): Promise<HostCatalog> {
  let state: Record<string, unknown>;
  try { state = record(JSON.parse(await readFile(join(codexHome, '.codex-global-state.json'), 'utf8'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { hosts: [], projects: [], assignments: {} }; throw error; }
  const saved = state['codex-managed-remote-connections'];
  const hosts = (Array.isArray(saved) ? saved : []).flatMap(value => {
    const item = record(value), hostId = item.hostId, alias = item.alias ?? item.sshAlias, hostname = item.hostname ?? item.sshHost;
    const target = typeof alias === 'string' && alias.trim() ? alias.trim() : typeof hostname === 'string' ? hostname.trim() : '';
    if (typeof hostId !== 'string' || !hostId.startsWith('remote-ssh-') || !target || target.startsWith('-') || /[\s\0]/.test(target)) return [];
    const port = item.sshPort;
    return [{ hostId, displayName: typeof item.displayName === 'string' ? item.displayName : target,
      sshAlias: typeof alias === 'string' && alias.trim() ? alias.trim() : null, sshHost: target,
      sshPort: typeof port === 'number' && Number.isInteger(port) && port > 0 && port < 65536 ? port : null,
      identity: typeof item.identity === 'string' ? item.identity : null }];
  });
  const ids = new Set(hosts.map(host => host.hostId)), savedProjects = state['remote-projects'];
  const projects = (Array.isArray(savedProjects) ? savedProjects : []).flatMap(value => {
    const item = record(value);
    return typeof item.id === 'string' && typeof item.hostId === 'string' && ids.has(item.hostId) && typeof item.remotePath === 'string'
      ? [{ id: item.id, hostId: item.hostId, remotePath: item.remotePath, label: typeof item.label === 'string' ? item.label : item.remotePath }] : [];
  });
  const assignments = Object.fromEntries(Object.entries(record(state['thread-project-assignments'])).filter(([, value]) => {
    const item = record(value);
    return item.projectKind === 'remote' && (typeof item.hostId === 'string' && ids.has(item.hostId) || projects.some(project => project.id === item.projectId));
  }));
  return { hosts, projects, assignments };
}

export function publicHost(host: SshHost) {
  return { hostId: host.hostId, displayName: host.displayName, source: host.sshAlias ? 'discovered' : 'codex-managed',
    sshAlias: host.sshAlias, sshHost: host.sshHost, sshPort: host.sshPort, identity: null, autoConnect: false };
}
