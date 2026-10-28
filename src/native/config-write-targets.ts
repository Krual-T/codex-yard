import { constants } from 'node:fs';
import { access, lstat, realpath, stat } from 'node:fs/promises';
import { posix } from 'node:path';
import { userConfigTarget } from '../renderer/settings/config-target.ts';
import { remoteFileCommand } from './files.ts';
import type { RemoteFileCommand } from './files.ts';
import type { ConfigWriteConnection, ConfigWriteTargetInput, ConfigWriteTarget } from './config-writes.ts';
import type { HostPaths, SshHost } from './ssh.ts';

interface Options {
  getSshHost(hostId: string, connection: ConfigWriteConnection): SshHost | undefined | Promise<SshHost | undefined>;
  getHostPaths(hostId: string, connection: ConfigWriteConnection): HostPaths | undefined | Promise<HostPaths | undefined>;
  remoteCommand?: RemoteFileCommand;
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

function absolute(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0')
    || !posix.isAbsolute(value) || posix.normalize(value) !== value) {
    throw new Error('The configuration path is unavailable or ambiguous.');
  }
  return value;
}

async function localTarget(binding: string): Promise<string> {
  let entry;
  try { entry = await lstat(binding); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = await realpath(posix.dirname(binding));
    if (!(await stat(parent)).isDirectory()) throw new Error('The configuration directory is unavailable.');
    await access(parent, constants.W_OK);
    return absolute(posix.join(parent, posix.basename(binding)));
  }
  if (!entry.isFile() && !entry.isSymbolicLink()) throw new Error('The configuration target is not a regular file.');
  const target = absolute(await realpath(binding));
  if (!(await stat(target)).isFile()) throw new Error('The configuration target is not a regular file.');
  await access(target, constants.R_OK);
  return target;
}

async function sshTarget(host: SshHost, binding: string, command: RemoteFileCommand): Promise<string> {
  const parent = posix.dirname(binding);
  const script = [
    `target=${quote(binding)}`, `parent=${quote(parent)}`,
    'if [ -L "$target" ] || [ -e "$target" ]; then',
    '  [ -f "$target" ] && [ -r "$target" ] || exit 1',
    "  printf 'file\\0'; realpath -ze -- \"$target\"",
    'else',
    '  [ -d "$parent" ] && [ -w "$parent" ] || exit 1',
    "  printf 'missing\\0'; realpath -ze -- \"$parent\"",
    'fi',
  ].join('\n');
  const bytes = await command(host, script, 16 * 1024, new AbortController().signal);
  let output: string;
  try { output = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('The SSH configuration target is invalid.'); }
  const fields = output.split('\0');
  if (fields.length !== 3 || fields[2] !== '' || fields[0] !== 'file' && fields[0] !== 'missing') {
    throw new Error('The SSH configuration target is invalid.');
  }
  const resolved = absolute(fields[1]);
  return fields[0] === 'file' ? resolved : absolute(posix.join(resolved, posix.basename(binding)));
}

/** Resolve only current base-user configuration writes using the original daemon. */
export function createConfigWriteTargets(options: Options) {
  return async function resolveTarget(input: ConfigWriteTargetInput): Promise<ConfigWriteTarget> {
    const { hostId, method, params, connection } = input;
    const registered = hostId === 'local' ? undefined : await options.getSshHost(hostId, connection);
    if (hostId !== 'local' && (!registered || registered.hostId !== hostId)) throw new Error('The configuration host is not registered.');
    const host = registered ? { ...registered } : undefined;
    if (method !== 'config/batchWrite' && method !== 'skills/config/write') throw new Error('The configuration write target is not verified.');
    if (method === 'skills/config/write') {
      const path = typeof params.path === 'string' && params.path.length > 0 && !params.path.includes('\0');
      const name = typeof params.name === 'string' && params.name.length > 0 && !params.name.includes('\0');
      if (typeof params.enabled !== 'boolean' || path === name) throw new Error('The skill selector is invalid.');
    }
    const paths = await options.getHostPaths(hostId, connection);
    const home = absolute(paths?.codexHome);
    if (absolute(connection.server?.codexHome) !== home) throw new Error('The original daemon configuration home does not match the selected host.');
    const response = await connection.requestWithCursor('config/read', { includeLayers: true });
    const layers = record(response?.result) ? response.result.layers : null;
    if (!Array.isArray(layers) || layers.some(layer => !record(layer) || !record(layer.name) || typeof layer.name.type !== 'string')
      || layers.filter(layer => record(layer) && record(layer.name) && layer.name.type === 'user').length !== 1) {
      throw new Error('The base user configuration layer is unavailable or ambiguous.');
    }
    const selected = userConfigTarget(layers, home);
    if (!selected.target) throw new Error('The base user configuration layer is unavailable or ambiguous.');
    const binding = absolute(selected.target.file);
    if (binding !== posix.join(home, 'config.toml')) throw new Error('The base user configuration target does not match the daemon home.');
    if (method === 'config/batchWrite' && params.filePath !== null && params.filePath !== binding) {
      throw new Error('The requested configuration target is not the verified base user file.');
    }
    const target = host ? await sshTarget(host, binding, options.remoteCommand ?? remoteFileCommand) : await localTarget(binding);
    return { hostKey: 'global-config-writes', target, binding, scope: 'global' };
  };
}
