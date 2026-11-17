import { glob, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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

/** The editor sends the full catalog, including redacted, existing profiles. */
export function savedSshHosts(value: unknown, previous: Map<string, SshHost>): SshHost[] {
  if (!Array.isArray(value)) throw new Error('需要 SSH 连接列表');
  const ids = new Set<string>();
  return value.map(value => {
    const item = record(value), hostId = item.hostId;
    const alias = item.alias ?? item.sshAlias;
    const target = typeof alias === 'string' && alias.trim() ? alias.trim() : item.hostname ?? item.sshHost;
    if (typeof hostId !== 'string' || !hostId.startsWith('remote-ssh-') || ids.has(hostId) ||
        typeof target !== 'string' || !target.trim() || target.trim().startsWith('-') || /[\s\0]/.test(target.trim())) {
      throw new Error('无效或重复的 SSH 主机');
    }
    if (typeof item.displayName !== 'string' || !item.displayName.trim()) throw new Error('需要 SSH 显示名称');
    const port = item.sshPort;
    if (port != null && (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('无效的 SSH 端口');
    if (item.identity != null && (typeof item.identity !== 'string' || !item.identity.trim() || /[\0\r\n]/.test(item.identity))) throw new Error('无效的 SSH 身份文件路径');
    ids.add(hostId);
    return { hostId, displayName: item.displayName.trim(), sshAlias: typeof alias === 'string' && alias.trim() ? alias.trim() : null,
      sshHost: target.trim(), sshPort: port == null ? null : port as number,
      identity: typeof item.identity === 'string' ? item.identity.trim() : previous.get(hostId)?.identity ?? null };
  });
}

/** Enumerate explicit aliases; OpenSSH still resolves their connection options. */
export async function discoverSshAliases(configPath = join(homedir(), '.ssh/config')) {
  const aliases = new Set<string>(), visited = new Set<string>(), base = dirname(resolve(configPath));
  async function read(path: string): Promise<void> {
    if (visited.has(path)) return;
    visited.add(path);
    let text: string;
    try { text = await readFile(path, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*(Host|Include)(?:\s+|=)\s*(.*)$/i.exec(line);
      if (!match) continue;
      const values = (match[2]!.match(/"(?:\\.|[^"])*"|'[^']*'|#[^\r\n]*|[^\s#]+/g) ?? []).filter(value => !value.startsWith('#'))
        .map(value => value.replace(/^(["'])(.*)\1$/, '$2').replace(/\\(.)/g, '$1'));
      if (match[1]!.toLowerCase() === 'host') {
        for (const alias of values) if (alias && !/^[-!]/.test(alias) && !/[\s*?\[\]\0]/.test(alias)) aliases.add(alias);
      } else for (const value of values) {
        const pattern = value.startsWith('~/') ? join(homedir(), value.slice(2)) : resolve(base, value);
        for await (const included of glob(pattern)) await read(included);
      }
    }
  }
  await read(resolve(configPath));
  return [...aliases].sort();
}
