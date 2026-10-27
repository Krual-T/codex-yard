import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { StatsigConfigurationSnapshot } from './statsig-startup.ts';

/** Keep the upstream response byte-for-byte, with its capture profile alongside it. */
export async function loadConfigurationSnapshot(directory: string, rendererVersion: string): Promise<StatsigConfigurationSnapshot | null> {
  let data: string;
  try { data = await readFile(join(directory, 'initialize.json'), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  const metadata = JSON.parse(await readFile(join(directory, 'metadata.json'), 'utf8'));
  const values = JSON.parse(data);
  if (metadata.rendererVersion !== rendererVersion || !metadata.client?.user || !metadata.capturedAt ||
      values.has_updates !== true || !Object.keys(values.feature_gates ?? {}).length ||
      !values.dynamic_configs || !values.layer_configs) {
    throw new Error('本地功能配置快照不完整或界面版本不匹配，请重新抓取配置');
  }
  return { rendererVersion, capturedAt: metadata.capturedAt, user: metadata.client.user, data };
}
