// Explicit, local preparation only. Never run this during Yard startup.
import { cp, mkdir, mkdtemp, readFile, rename, rm, access, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { source: { type: 'string' }, destination: { type: 'string' } } });
if (!values.source) throw new Error('Usage: npm run artifacts:prepare -- --source /path/to/independently-obtained/codex-primary-runtime [--destination /new/runtime/directory]');
const source = resolve(values.source);
const destination = resolve(values.destination || join(homedir(), '.local/share/codex-yard/artifact-runtime'));
if (destination === source || destination.startsWith(source + sep)) throw new Error('Choose a destination outside the source runtime.');
try { await access(destination); throw new Error('Destination already exists; choose a new directory and retain the old runtime for rollback.'); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
const upstream = JSON.parse(await readFile(join(source, 'runtime.json'), 'utf8')) as { bundleVersion: string; targetPlatform: string; targetArch: string };
if (upstream.targetPlatform !== process.platform || upstream.targetArch !== process.arch) throw new Error('The source artifact runtime must match this execution host.');
await access(join(source, 'dependencies/node/node_modules/@oai/artifact-tool/package.json'));
await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
const staging = await mkdtemp(join(dirname(destination), '.artifact-runtime-'));
try {
  await cp(join(source, 'dependencies'), join(staging, 'dependencies'), { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
  const win = process.platform === 'win32';
  const dependencies = join(destination, 'dependencies');
  const runtime = { version: upstream.bundleVersion, platform: process.platform, arch: process.arch,
    nodePath: join(dependencies, 'node/bin', win ? 'node.exe' : 'node'),
    pythonPath: join(dependencies, win ? 'python/python.exe' : 'python/bin/python3'),
    nodeModulesPath: join(dependencies, 'node/node_modules'),
    overrideBinDir: join(dependencies, 'bin/override'), fallbackBinDir: join(dependencies, 'bin/fallback') };
  await writeFile(join(staging, 'upstream-runtime.json'), JSON.stringify(upstream, null, 2) + '\n');
  await writeFile(join(staging, 'runtime.json'), JSON.stringify(runtime, null, 2) + '\n', { mode: 0o600 });
  await rename(staging, destination);
  console.log(JSON.stringify({ manifest: join(destination, 'runtime.json'), ...runtime }, null, 2));
} catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
