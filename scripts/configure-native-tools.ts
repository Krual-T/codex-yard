import { constants } from 'node:fs';
import { access, chmod, copyFile, mkdir } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { appToolsConfig, defaultAppToolsAdapter } from '../lib/app-tools.ts';
import { projectRoot } from '../lib/app-resources.ts';
import { CodexConnection } from '../lib/codex.ts';
import { errorMessage, isRecord } from '../lib/codex-protocol.ts';
import { catalog } from '../vendor/native-app-tools/26.1013.40934/portable-tools.mjs';

// Explicit administration. Planning reads only the host catalog and daemon
// configuration; --apply adds one server and never resumes or interrupts a chat.
async function hostCatalog(socketPath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path: socketPath });
    let bytes = Buffer.alloc(0);
    const timer = setTimeout(() => finish(new Error('Conversation tool host did not respond.')), 5000);
    function finish(error?: Error, names?: string[]) {
      clearTimeout(timer); socket.destroy();
      if (error) reject(error); else resolve(names!);
    }
    socket.once('error', finish);
    socket.once('end', () => finish(new Error('Conversation tool host closed before replying.')));
    socket.once('connect', () => {
      const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 'catalog', method: 'tools/list' }));
      const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
      socket.write(Buffer.concat([header, body]));
    });
    socket.on('data', (chunk: Buffer) => {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length < 4) return;
      const size = bytes.readUInt32LE(0);
      if (size > 8 * 1024 * 1024) { finish(new Error('Conversation tool catalog is too large.')); return; }
      if (bytes.length < size + 4) return;
      try {
        const reply: unknown = JSON.parse(bytes.subarray(4, size + 4).toString('utf8'));
        if (!isRecord(reply) || reply.id !== 'catalog' || !isRecord(reply.result) || !Array.isArray(reply.result.tools)) {
          throw new Error('Conversation tool catalog is invalid.');
        }
        finish(undefined, reply.result.tools.map(tool => {
          if (!isRecord(tool) || tool.namespace !== 'codex_app' || typeof tool.name !== 'string') throw new Error('Conversation tool catalog is invalid.');
          return tool.name;
        }).sort());
      } catch (cause) { finish(new Error(errorMessage(cause))); }
    });
  });
}

let connection: CodexConnection | undefined;
let backupPath: string | undefined;
let writeState = 'notAttempted';
try {
  const { values } = parseArgs({ options: {
    socket: { type: 'string' }, 'data-dir': { type: 'string' }, adapter: { type: 'string' }, apply: { type: 'boolean' },
  } });
  const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex');
  const dataDir = resolve(values['data-dir'] || process.env.AGENTS_DATA_DIR || join(projectRoot, '.local'));
  const socketPath = values.socket || process.env.AGENTS_CODEX_SOCKET || join(codexHome, 'app-server-control/app-server-control.sock');
  const adapterPath = resolve(values.adapter || process.env.AGENTS_APP_TOOLS_ADAPTER || defaultAppToolsAdapter);
  await access(adapterPath, constants.R_OK);
  const definition = appToolsConfig(adapterPath, join(dataDir, 'app-tools.sock'))['mcp_servers.codex_app'];
  const expectedTools = catalog.map(tool => tool.name).sort();
  let tools: string[] = [], hostError: string | null = null;
  try { tools = await hostCatalog(definition.env.CODEX_APP_TOOLS_PIPE_PATH); }
  catch (cause) { hostError = errorMessage(cause); }
  const hostReady = isDeepStrictEqual(tools, expectedTools);
  connection = new CodexConnection(socketPath);
  await connection.connect();
  const snapshot = await connection.request('config/read', { includeLayers: true });
  const user = Array.isArray(snapshot.layers) ? snapshot.layers.find(layer => isRecord(layer) && isRecord(layer.name) &&
    layer.name.type === 'user' && layer.name.profile == null) : undefined;
  if (!isRecord(user) || !isRecord(user.name) || typeof user.name.file !== 'string' || typeof user.version !== 'string') {
    throw new Error('Daemon did not return the base user configuration and its version.');
  }
  const previous = isRecord(user.config) && isRecord(user.config.mcp_servers) ? user.config.mcp_servers.codex_app : undefined;
  const alreadyInstalled = isDeepStrictEqual(previous, definition);
  const plan = { server: 'codex_app', configPath: user.name.file, definition, hostReady, tools, hostError,
    existingDefinition: previous === undefined ? 'absent' : alreadyInstalled ? 'same' : 'different',
    migration: 'Loaded per-thread definitions remain until an idle unload and resume. No thread or daemon is restarted.' };
  if (!values.apply) console.log(JSON.stringify({ success: true, mode: 'plan', ...plan }));
  else {
    if (!hostReady) throw new Error('Start the twelve-tool host before applying this plan.');
    if (previous !== undefined && !alreadyInstalled) throw new Error('An explicit codex_app definition already exists; it was not replaced. Review it before migrating.');
    if (!alreadyInstalled) {
      const backupDir = join(codexHome, 'backups');
      await mkdir(backupDir, { recursive: true, mode: 0o700 });
      await chmod(backupDir, 0o700);
      backupPath = join(backupDir, 'config-before-native-tools-' + Date.now() + '.toml');
      await copyFile(user.name.file, backupPath, constants.COPYFILE_EXCL);
      await chmod(backupPath, 0o600);
      writeState = 'uncertain';
      await connection.request('config/batchWrite', { edits: [{ keyPath: 'mcp_servers.codex_app', value: definition, mergeStrategy: 'replace' }],
        filePath: user.name.file, expectedVersion: user.version, reloadUserConfig: false }, { mutating: true });
      writeState = 'installed';
    }
    await connection.request('config/mcpServer/reload', null, { mutating: true });
    console.log(JSON.stringify({ success: true, mode: 'apply', ...plan, alreadyInstalled, backupPath, writeState,
      rollback: 'codex mcp remove codex_app, then config/mcpServer/reload. Restore only this entry from the private backup if needed.' }));
  }
} catch (cause) {
  console.error(JSON.stringify({ success: false, message: errorMessage(cause), writeState, backupPath }));
  process.exitCode = 1;
} finally { connection?.close(); }
