import type { HostMessage, ObjectValue } from './protocol.ts';
import { record } from './protocol.ts';
import { previewLimit } from './file-limits.ts';

type RequestHost = (endpoint: string, params: ObjectValue) => Promise<unknown>;
interface SelectedFile { label: string; path: string; fsPath: string }
interface WorkspaceRead { hostId: string; path: string; maxBytes?: number; representation: 'auto' | 'text' | 'blob' }
interface WorkspacePath { hostId: string; path: string; fileName?: string; includeCanonicalPath?: boolean }
interface WorkspaceOpen { hostId?: string; path: string; cwd?: string; target?: string }

function download(href: string, name: string) {
  const anchor = document.createElement('a');
  anchor.href = href; anchor.download = name; anchor.hidden = true;
  document.body.append(anchor); anchor.click(); anchor.remove();
}
function downloadBytes(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>]));
  download(url, name);
  // The browser consumes the URL asynchronously, including in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
function decodeBase64(value: string) { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); }
function name(path: string) { return path.split(/[\\/]/).filter(Boolean).at(-1) || 'download'; }

export class BrowserFiles {
  private readonly request: RequestHost;
  constructor(request: RequestHost) { this.request = request; }
  read(value: WorkspaceRead) { return this.request('workspace-files', { operation: 'read', ...value }); }
  getMetadata(value: WorkspacePath) { return this.request('workspace-files', { operation: 'getMetadata', ...value }); }
  async saveCopy(value: WorkspacePath | { bytes: Uint8Array; fileName: string }) {
    if ('bytes' in value) downloadBytes(value.bytes, value.fileName);
    else await this.downloadCopy(value);
    return { path: 'fileName' in value && value.fileName || 'path' in value && name(value.path) || 'download' };
  }
  async downloadCopy(value: WorkspacePath) {
    const filename = value.fileName || name(value.path);
    const query = new URLSearchParams({ hostId: value.hostId, path: value.path, name: filename });
    const response = await fetch('/api/files/download?' + query);
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      throw new Error(record(failure).error as string || '文件下载失败');
    }
    const url = URL.createObjectURL(await response.blob());
    download(url, filename);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  getDownloadsFolderIcon() { return null; }
  // Unsupported local previews use the original openIn service. In a browser,
  // opening a file in the system viewer means downloading its actual bytes.
  async open(value: WorkspaceOpen) {
    if (value.target != null && !['systemDefault', 'fileManager'].includes(value.target)) return { success: false };
    const path = value.cwd && !value.path.startsWith('/') && !value.path.startsWith('file:') ? value.cwd + '/' + value.path : value.path;
    const source = { hostId: value.hostId ?? 'local', path };
    try {
      if (record(await this.getMetadata(source)).kind !== 'file') return { success: false };
      await this.downloadCopy(source);
      return { success: true };
    } catch { return { success: false }; }
  }

  // Called before any socket await so input.click() remains in the original
  // button's user gesture. The original React picker and composer stay intact.
  intercept(message: HostMessage, publish: (value: HostMessage) => void): boolean {
    if (message.type !== 'fetch') return false;
    const endpoint = message.url?.split('/').at(-1);
    if (!['pick-file', 'pick-files', 'save-file'].includes(endpoint || '')) return false;
    const params = typeof message.body === 'string' ? record(JSON.parse(message.body)) : record(message.params);
    const operation = endpoint === 'save-file' ? this.saveFile(params) : this.pick(endpoint === 'pick-file' ? { ...params, allowMultiple: false } : params).then(files => endpoint === 'pick-file' ? { file: files[0] ?? null } : { files });
    void operation.then(body => publish({ type: 'fetch-response', requestId: message.requestId, responseType: 'success', status: 200, headers: {}, body }),
      error => publish({ type: 'fetch-response', requestId: message.requestId, responseType: 'error', status: 400, error: error.message }));
    return true;
  }
  private async saveFile(value: ObjectValue) {
    const filename = typeof value.suggestedFilename === 'string' ? name(value.suggestedFilename) : name(String(value.sourcePath || 'download'));
    if (value.kind === 'contents' && typeof value.contentsBase64 === 'string') downloadBytes(decodeBase64(value.contentsBase64), filename);
    else if (typeof value.sourcePath === 'string') await this.downloadCopy({ hostId: typeof value.hostId === 'string' ? value.hostId : 'local', path: value.sourcePath, fileName: filename });
    else throw new Error('下载缺少文件内容或路径');
    return { path: filename };
  }
  private pick(params: ObjectValue): Promise<SelectedFile[]> {
    const input = document.createElement('input'); input.type = 'file'; input.hidden = true;
    input.multiple = params.allowMultiple !== false;
    if (params.kind === 'directory') input.webkitdirectory = true;
    else if (params.imagesOnly) input.accept = 'image/*';
    else if (Array.isArray(params.acceptedFileExtensions)) input.accept = params.acceptedFileExtensions.filter(value => typeof value === 'string').map(value => '.' + value.replace(/^\./, '')).join(',');
    document.body.append(input);
    return new Promise((resolve, reject) => {
      const cleanup = () => input.remove();
      input.addEventListener('cancel', () => { cleanup(); resolve([]); }, { once: true });
      input.addEventListener('change', () => {
        const selected = Array.from(input.files || []); cleanup();
        void this.importFiles(selected, params.kind === 'directory').then(resolve, reject);
      }, { once: true });
      input.click();
    });
  }
  async importFiles(files: File[], directory: boolean): Promise<SelectedFile[]> {
    if (!files.length) return [];
    if (files.some(file => file.size > previewLimit)) throw new Error('单个上传文件超过10 MiB');
    async function json(response: Response) {
      const result = await response.json(); if (!response.ok) throw new Error(result.error || '文件上传失败'); return result;
    }
    const upload = await json(await fetch('/api/files/uploads', { method: 'POST' }));
    const result: SelectedFile[] = [];
    for (const file of files) {
      const relativePath = directory ? file.webkitRelativePath : file.name;
      const query = new URLSearchParams({ uploadId: upload.uploadId, name: relativePath });
      result.push(await json(await fetch('/api/files/upload?' + query, { method: 'POST', body: file })));
    }
    if (!directory) return result;
    const label = files[0]!.webkitRelativePath.split('/')[0]!;
    const path = upload.directory + '/' + label;
    return [{ label, path: path + '/', fsPath: path }];
  }
}
