import type { HostMessage, ObjectValue } from './protocol.ts';
import { record } from './protocol.ts';
import { fileTransferLimit } from './file-limits.ts';

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
function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]!);
    reader.onerror = () => reject(reader.error ?? new Error('文件读取失败'));
    reader.readAsDataURL(blob);
  });
}

export class BrowserFiles {
  private readonly request: RequestHost;
  private readonly paths = new WeakMap<File, string>();
  constructor(request: RequestHost) { this.request = request; }
  getPathForFile(file: File): string | null { return this.paths.get(file) ?? null; }
  async stageFiles(files: File[]): Promise<void> {
    // Separate upload roots preserve equal filenames from different folders.
    await Promise.all(files.filter(file => !this.paths.has(file)).map(file => this.importFiles([file], false)));
  }
  async read(value: WorkspaceRead) {
    if (value.representation !== 'blob') return this.request('workspace-files', { operation: 'read', ...value });
    const result = await this.readBinary({ ...value });
    if (result.contentsBase64 == null) throw new Error('文件超出预览大小限制');
    return { blob: result.contentsBase64 };
  }
  private async readBinary(value: ObjectValue) {
    const query = new URLSearchParams({ hostId: String(value.hostId ?? 'local'), path: String(value.path ?? '') });
    if (value.maxBytes != null) query.set('maxBytes', String(value.maxBytes));
    const response = await fetch('/api/files/content?' + query);
    // Keep the pinned renderer's size-limit contract. The large base64 string
    // is delivered to its local callback, never through the 16 MiB WebSocket.
    if (response.status === 413) return { contentsBase64: null };
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      throw new Error(record(failure).error as string || '文件读取失败');
    }
    return { contentsBase64: await blobBase64(await response.blob()), mimeType: response.headers.get('Content-Type') ?? 'application/octet-stream' };
  }
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
    if (!['pick-file', 'pick-files', 'save-file', 'read-file-binary'].includes(endpoint || '')) return false;
    const params = typeof message.body === 'string' ? record(JSON.parse(message.body)) : record(message.params);
    const operation = endpoint === 'read-file-binary' ? this.readBinary(params) : endpoint === 'save-file' ? this.saveFile(params) : this.pick(endpoint === 'pick-file' ? { ...params, allowMultiple: false } : params).then(files => endpoint === 'pick-file' ? { file: files[0] ?? null } : { files });
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
    if (files.some(file => file.size > fileTransferLimit)) throw new Error('单个上传文件超过64 MiB');
    async function json(response: Response) {
      const result = await response.json(); if (!response.ok) throw new Error(result.error || '文件上传失败'); return result;
    }
    const upload = await json(await fetch('/api/files/uploads', { method: 'POST' }));
    const result: SelectedFile[] = [];
    for (const file of files) {
      const relativePath = directory ? file.webkitRelativePath : file.name;
      const query = new URLSearchParams({ uploadId: upload.uploadId, name: relativePath });
      const selected = await json(await fetch('/api/files/upload?' + query, { method: 'POST', body: file })) as SelectedFile;
      this.paths.set(file, selected.fsPath);
      result.push(selected);
    }
    if (!directory) return result;
    const label = files[0]!.webkitRelativePath.split('/')[0]!;
    const path = upload.directory + '/' + label;
    return [{ label, path: path + '/', fsPath: path }];
  }
}
