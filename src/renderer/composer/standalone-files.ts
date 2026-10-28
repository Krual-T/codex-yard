import type { WorkbenchClient } from '../workbench-contract.ts';
import { BrowserFiles } from '../../native/browser-files.ts';
import type { DraftImage } from './standalone-draft.ts';
import { createId } from './standalone-draft.ts';

const fileLimit = 10 * 1024 * 1024;
interface SelectedAttachments { images: DraftImage[]; files: { path: string; name: string }[] }
function dataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('无法读取文件'));
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('无法读取文件'));
    reader.readAsDataURL(file);
  });
}
function fileName(value: string): string {
  const safe = value.replace(/[\0\r\n/\\]/g, '_');
  return safe && safe !== '.' && safe !== '..' ? safe : 'attachment';
}
export async function importAttachments(client: WorkbenchClient, hostId: string, selected: File[]): Promise<SelectedAttachments> {
  if (selected.some(file => file.size > fileLimit)) throw new Error('单个附件不能超过 10 MiB');
  const result: SelectedAttachments = { images: [], files: [] };
  const browserFiles = new BrowserFiles((endpoint, params) => client.host(endpoint, params));
  for (const file of selected) {
    const name = fileName(file.name);
    if (file.type.startsWith('image/')) {
      const src = await dataUrl(file);
      if (hostId === 'local') {
        const uploaded = await browserFiles.importFiles([file], false);
        result.images.push({ id: createId(), name, src, previewSrc: src, path: uploaded[0]!.fsPath });
      } else result.images.push({ id: createId(), name, src, previewSrc: src });
    } else if (hostId === 'local') {
      const uploaded = await browserFiles.importFiles([file], false);
      result.files.push({ name, path: uploaded[0]!.fsPath });
    } else {
      const src = await dataUrl(file);
      const home = await client.host<{ codexHome: string }>('codex-home', { hostId });
      const directory = home.codexHome.replace(/\/$/, '') + '/attachments/' + createId();
      const path = directory + '/' + name;
      await client.rpc('fs/createDirectory', { path: directory, recursive: false }, hostId);
      await client.rpc('fs/writeFile', { path, dataBase64: src.slice(src.indexOf(',') + 1) }, hostId);
      result.files.push({ name, path });
    }
  }
  return result;
}
