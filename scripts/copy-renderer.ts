import { extractFile, listPackage, statFile } from '@electron/asar';
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import { createZstdDecompress } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { extract } from 'tar';

export const rendererVersion = '26.1013.40934';
export const projectRoot = fileURLToPath(new URL('..', import.meta.url));
export const rendererRoot = join(projectRoot, '.local', 'renderer-' + rendererVersion);
export const runtimeRoot = join(projectRoot, '.local', 'codex-app-' + rendererVersion);
export const adapterRelativePath = 'plugins/openai-bundled/plugins/codex-app-tools/server.mjs';
export const bundledAppToolsAdapter = join(runtimeRoot, adapterRelativePath);
// Only platform-independent web resources and the Node adapter are extracted.
export const runtimeUrl = `https://persistent.oaistatic.com/codex-app-prod/linux/arch/${rendererVersion}/x86_64/chatgpt-bin-${rendererVersion}-1-x86_64.pkg.tar.zst`;

function checkVersion(archive: string) {
  const installed = JSON.parse(extractFile(archive, 'package.json').toString());
  if (installed.version !== rendererVersion) throw new Error(`需要 Codex App ${rendererVersion}，安装包版本为 ${installed.version}`);
}

export async function prepareAppResources(options: { packageArchive?: string; target?: string; fetch?: typeof fetch } = {}) {
  const target = options.target ?? runtimeRoot;
  try {
    checkVersion(join(target, 'app.asar'));
    await access(join(target, adapterRelativePath));
    return target;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await mkdir(dirname(target), { recursive: true });
  const staging = await mkdtemp(join(dirname(target), 'codex-runtime-import-'));
  try {
    let input: Readable;
    if (options.packageArchive) input = createReadStream(options.packageArchive);
    else {
      console.error(`Preparing Codex App ${rendererVersion} web resources from OpenAI (about 494 MiB, first run only).`);
      const response = await (options.fetch ?? fetch)(runtimeUrl, { signal: AbortSignal.timeout(20 * 60_000) });
      if (!response.ok || !response.body) throw new Error(`下载固定界面资源失败：HTTP ${response.status} (${runtimeUrl})`);
      input = Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>);
    }
    const prefix = 'usr/lib/chatgpt/resources/';
    await pipeline(input, createZstdDecompress(), extract({
      cwd: staging, strip: 4, strict: true,
      filter(path, entry) {
        if (!('type' in entry) || (entry.type !== 'File' && entry.type !== 'Directory')) return false;
        const relative = path.replace(/\/$/, '');
        return relative === prefix + 'app.asar' || relative === prefix + 'plugins/openai-bundled'
          || relative.startsWith(prefix + 'plugins/openai-bundled/');
      },
    }));
    checkVersion(join(staging, 'app.asar'));
    await access(join(staging, adapterRelativePath));
    await rename(staging, target);
    return target;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

// Generated third-party resources stay out of Git and are independent of app updates.
export async function copyRenderer(archive: string, target = rendererRoot) {
  try {
    const metadata = JSON.parse(await readFile(join(target, 'renderer.json'), 'utf8'));
    if (metadata.version === rendererVersion) return metadata;
    throw new Error('已有资源版本不一致：' + target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  checkVersion(archive);
  await mkdir(dirname(target), { recursive: true });
  const staging = await mkdtemp(join(dirname(target), 'renderer-copy-'));
  try {
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
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { archive: { type: 'string' }, output: { type: 'string' }, package: { type: 'string' } } });
  const resources = await prepareAppResources({ packageArchive: values.package });
  console.log(JSON.stringify(await copyRenderer(values.archive ?? join(resources, 'app.asar'), values.output)));
}
