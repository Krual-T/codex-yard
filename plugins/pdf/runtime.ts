import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const manifest = process.argv[2] || process.env.YARD_ARTIFACT_RUNTIME_MANIFEST || join(homedir(), '.local/share/codex-yard/artifact-runtime/runtime.json');
let runtime: Record<string, string>;
try { runtime = JSON.parse(await readFile(manifest, 'utf8')) as Record<string, string>; }
catch (cause) { throw new Error(`Prepare the independent artifact runtime first; cannot read ${manifest}. See Yard docs/standalone-plugins.md.`, { cause }); }
for (const key of ['nodePath', 'pythonPath', 'nodeModulesPath', 'overrideBinDir', 'fallbackBinDir']) {
  if (!runtime[key]) throw new Error('Runtime manifest is missing ' + key);
  await access(runtime[key]);
}
console.log(JSON.stringify(runtime, null, 2));
