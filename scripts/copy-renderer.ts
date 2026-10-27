import { extractFile, listPackage, statFile } from '@electron/asar';
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const rendererVersion = '26.1013.40934';
export const projectRoot = fileURLToPath(new URL('..', import.meta.url));
export const rendererRoot = join(projectRoot, '.local', 'renderer-' + rendererVersion);

// Generated third-party resources stay out of Git and are independent of app updates.
export async function copyRenderer(archive = '/usr/lib/chatgpt/resources/app.asar', target = rendererRoot) {
  try {
    const metadata = JSON.parse(await readFile(join(target, 'renderer.json'), 'utf8'));
    if (metadata.version === rendererVersion) return metadata;
    throw new Error('已有资源版本不一致：' + target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const installed = JSON.parse(extractFile(archive, 'package.json').toString());
  if (installed.version !== rendererVersion) throw new Error(`需要 Codex ${rendererVersion}，安装包版本为 ${installed.version}`);
  await mkdir(dirname(target), { recursive: true });
  const staging = await mkdtemp(join(dirname(target), 'renderer-copy-'));
  let files = 0, bytes = 0;
  for (const entry of listPackage(archive, { isPack: false })) {
    if (!entry.startsWith('/webview/')) continue;
    const member = entry.slice(1);
    const stat = statFile(archive, member);
    if ('files' in stat) continue;
    const destination = join(staging, entry.slice('/webview/'.length));
    const content = extractFile(archive, member);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
    files++; bytes += content.length;
  }
  const metadata = { version: rendererVersion, archive, files, bytes };
  await writeFile(join(staging, 'renderer.json'), JSON.stringify(metadata, null, 2) + '\n');
  await rename(staging, target);
  return metadata;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { archive: { type: 'string' }, output: { type: 'string' } } });
  console.log(JSON.stringify(await copyRenderer(values.archive, values.output)));
}
