// Run with standalone Windows Node. The original installer keeps ownership of
// the native-host manifest and registry contract; Yard supplies independent paths.
import { execFileSync, spawn } from 'node:child_process';
import { cp, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { windowsNode, windowsPath } from '../lib/windows-paths.ts';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function install(): Promise<void> {
  if (process.platform !== 'win32') {
    // Passing paths as argv avoids inheriting App environment/WSLENV bindings.
    const args = process.argv.slice(2);
    for (let index = 0; index < args.length; index++) if (['--codex', '--node', '--node-repl', '--destination'].includes(args[index]) && args[index + 1]) args[++index] = windowsPath(args[index]);
    const child = spawn(windowsNode(), [windowsPath(fileURLToPath(import.meta.url)), ...args], { stdio: 'inherit', windowsHide: true });
    process.exitCode = await new Promise<number>((resolve, reject) => child.once('error', reject).once('close', code => resolve(code ?? 1)));
    return;
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const source = join(root, 'plugins/chrome');
  const destination = resolve(option('--destination') || join(process.env.LOCALAPPDATA || join(process.env.USERPROFILE!, 'AppData/Local'), 'CodexYard/Standalone/chrome-26.1103.60933'));
  const paths = {
    codexCliPath: option('--codex'), nodePath: option('--node') || process.execPath,
    nodeReplPath: option('--node-repl') || join(root, 'vendor/node-repl/app-26.1117.3838.0/win32-x64/bin/node_repl.exe'),
  };
  if (!paths.codexCliPath) throw new Error('--codex must select the standalone Windows Codex executable (.exe).');
  for (const [name, path] of Object.entries(paths)) if (!path || !(await stat(path)).isFile()) throw new Error(name + ' is not an installed independent executable.');
  await stat(join(source, 'extension-host/windows/x64/extension-host.exe'));
  const manifest = join(process.env.USERPROFILE!, 'AppData/Local/OpenAI/extension/com.openai.codexextension.json');
  const registry = 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.openai.codexextension';
  const backup = join(dirname(destination), 'backups', 'chrome-' + new Date().toISOString().replaceAll(':', '-'));
  const apply = process.argv.includes('--apply');
  if (!apply) {
    console.log(JSON.stringify({ apply: false, source, destination, manifest, registry, paths, backup }, null, 2));
    return;
  }
  await mkdir(backup, { recursive: true });
  let oldManifest: string | undefined;
  try { oldManifest = await readFile(manifest, 'utf8'); await cp(manifest, join(backup, 'native-host-manifest.json')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  try { execFileSync('reg.exe', ['export', registry, join(backup, 'native-host.reg'), '/y'], { stdio: 'pipe' }); }
  catch (error) {
    // A missing key has no prior registration to restore.
    try { execFileSync('reg.exe', ['query', registry], { stdio: 'pipe' }); throw error; } catch (queryError) { if (queryError === error) throw error; }
  }
  try { await cp(destination, join(backup, 'plugin'), { recursive: true, verbatimSymlinks: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await cp(source, destination, { recursive: true, verbatimSymlinks: true });
  const { install: upstreamInstall } = await import(pathToFileURL(join(destination, 'scripts/installManifest.mjs')).href) as {
    install(options: { appServerRuntimePaths: typeof paths }): Promise<void>;
  };
  await upstreamInstall({ appServerRuntimePaths: paths });
  console.log(JSON.stringify({ apply: true, destination, manifest, backup, previousManifest: oldManifest ? JSON.parse(oldManifest).path : null,
    paths, next: 'Reconnect the official Chrome extension so its native host starts from this independent installation.' }, null, 2));
}

await install().catch(error => { console.error((error as Error).message); process.exitCode = 1; });
