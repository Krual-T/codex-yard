import { previewLimit } from './file-limits.ts';

/** Codex 26.1013.40934 AppHost.fileAttachments contract. The official editor
 * already reads paste/drop File bytes and owns thumbnails and send payloads. */
export interface ClipboardImage { bytes: Uint8Array; mimeType: string }
type UploadFiles = (files: File[], directory: boolean) => Promise<{ fsPath: string }[]>;
type ReportFailure = (error: Error) => void;

/** Write to the access computer's clipboard, including plain HTTP browsers. */
export async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; }
    catch { /* Some browsers deny the async API but allow a user-triggered copy. */ }
  }
  const focused = document.activeElement;
  const selection = document.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const field = document.createElement('textarea');
  field.value = text;
  field.readOnly = true;
  field.style.cssText = 'position:fixed;inset:0;opacity:0;pointer-events:none';
  document.body.append(field);
  try {
    field.select();
    if (!document.execCommand('copy')) throw new Error('复制失败，请选择内容手动复制。');
  } finally {
    field.remove();
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
    selection?.removeAllRanges();
    for (const range of ranges) selection?.addRange(range);
  }
}

const extensions: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/avif': 'avif', 'image/bmp': 'bmp', 'image/tiff': 'tiff',
  'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico',
};

export class BrowserClipboard {
  private readonly upload: UploadFiles;
  private readonly reportFailure: ReportFailure;
  constructor(upload: UploadFiles, reportFailure: ReportFailure) {
    this.upload = upload;
    this.reportFailure = reportFailure;
  }

  async persistImageFileToTemp({ bytes, mimeType }: ClipboardImage): Promise<string> {
    try {
      const type = mimeType.split(';')[0]!.trim().toLowerCase();
      const extension = extensions[type];
      if (!extension) throw new Error('不支持的剪贴板图片格式：' + mimeType);
      if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error('剪贴板图片内容为空');
      if (bytes.byteLength > previewLimit) throw new Error('单个上传文件超过10 MiB');
      // The browser has no native file path. Reuse the picker upload boundary
      // to stage exact bytes on the Web host; the official composer handles
      // transferring that local path to an SSH host when required.
      const file = new File([new Uint8Array(bytes)], `clipboard-${crypto.randomUUID()}.${extension}`, { type });
      const [result] = await this.upload([file], false);
      if (!result?.fsPath) throw new Error('图片上传未返回宿主路径');
      return result.fsPath;
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      // The original composer catches persistence errors and retains its data
      // URL fallback. Surface the failure through its existing toast component.
      this.reportFailure(error);
      throw error;
    }
  }
}
