import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, mkdtemp, open, readFile, realpath, rename, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LateRpcTerminal } from '../../lib/codex-protocol.ts';
import type { SshHost } from './ssh.ts';
import type { ObjectValue } from './protocol.ts';
import { previewLimit } from './file-limits.ts';

const downloadLimit = 64 * 1024 * 1024;
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
interface Metadata { isFile: boolean; isDirectory: boolean; sizeBytes: number; mtimeMs: number; createdAtMs: number | null }
interface DaemonMetadata { isFile: boolean; isDirectory: boolean; isSymlink: boolean; modifiedAtMs: number; createdAtMs: number }
interface DaemonEntry { fileName: string; isDirectory: boolean; isFile: boolean }
export type FileRequest = (hostId: string, method: string, params: ObjectValue, mutating?: boolean,
  onLateTerminal?: (terminal: LateRpcTerminal) => void | Promise<void>) => Promise<unknown>;
export type RemoteFileCommand = (host: SshHost, command: string, maxBytes: number, signal: AbortSignal) => Promise<Buffer>;

// Permission errors and daemon timeouts must not become an absent path.
function missing(error: unknown) {
  const value = error as { code?: unknown; message?: string };
  return value.code === 'ENOENT' || value.code === 'ENOTDIR' || /\(os error (2|20)\)/.test(value.message ?? '');
}

// Non-interactive SSH uses the same registered profile as the daemon transport.
// Frame stdout so login banners cannot become part of a downloaded binary.
export const remoteFileCommand: RemoteFileCommand = (host, command, maxBytes, signal) => new Promise((done, reject) => {
  const marker = 'AW_FILE_' + randomBytes(16).toString('hex') + '\0';
  const args = ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8'];
  if (!host.sshAlias && host.identity) args.push('-i', host.identity);
  if (!host.sshAlias && host.sshPort) args.push('-p', String(host.sshPort));
  args.push('--', host.sshAlias || host.sshHost, 'exec /bin/sh -c ' + quote(`LC_ALL=C; export LC_ALL; printf '%s\\0' ${quote(marker.slice(0, -1))}; ${command}`));
  execFile('ssh', args, { encoding: 'buffer', maxBuffer: maxBytes + 256 * 1024, timeout: 30_000, signal }, (error, stdout, stderr) => {
    if (error) { reject(new Error('SSH 文件操作失败：' + (stderr.toString().trim().slice(-1000) || error.message))); return; }
    const at = stdout.indexOf(marker);
    if (at < 0) { reject(new Error('SSH 文件响应缺少边界')); return; }
    const bytes = stdout.subarray(at + Buffer.byteLength(marker));
    if (bytes.length > maxBytes) { reject(new Error('文件响应超出大小限制')); return; }
    done(bytes);
  });
});

export function contentKind(bytes: Uint8Array, partial = false): 'text' | 'binary' | 'image' | 'pdf' {
  const mime = mediaType('', Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (bytes.some(byte => byte === 0 || byte < 32 && ![9, 10, 12, 13].includes(byte))) return 'binary';
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: partial }); return 'text'; }
  catch { return 'binary'; }
}

function mediaType(path: string, bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a/.test(bytes.subarray(0, 6).toString())) return 'image/gif';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (bytes.subarray(0, 2).toString() === 'BM') return 'image/bmp';
  if (bytes.subarray(0, 4).equals(Buffer.from([73, 73, 42, 0])) || bytes.subarray(0, 4).equals(Buffer.from([77, 77, 0, 42]))) return 'image/tiff';
  if (bytes.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))) return 'image/x-icon';
  if (bytes.subarray(4, 8).toString() === 'ftyp' && ['avif', 'avis'].includes(bytes.subarray(8, 12).toString())) return 'image/avif';
  if (bytes.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  const text = bytes.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  if (text.startsWith('<svg') || text.startsWith('<?xml') && text.includes('<svg')) return 'image/svg+xml';
  const types: Record<string, string> = { '.svg': 'image/svg+xml', '.avif': 'image/avif', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json' };
  return types[extname(path).toLowerCase()] || 'application/octet-stream';
}

function within(root: string, path: string) { const relative = posix.relative(root, path); return relative !== '..' && !relative.startsWith('../') && !posix.isAbsolute(relative); }
function limit(value: unknown, fallback: number) {
  if (value == null) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('无效的文件大小限制');
  return Math.min(value, fallback);
}
function filename(value: unknown) {
  if (typeof value !== 'string' || !value || value === '.' || value === '..' || /[\0\r\n/\\]/.test(value)) throw new Error('无效的文件名');
  return value;
}

export const fileEndpoints = new Set(['workspace-directory-entries', 'remote-workspace-directory-entries', 'read-file', 'read-file-metadata', 'read-file-binary', 'paths-exist', 'workspace-files', 'workspace-file-save', 'workspace-file-save-status', 'ensure-directory', 'visualization-read']);
export const fileMethods = new Set(['fs/readFile', 'fs/readDirectory', 'fs/getMetadata', 'fs/createDirectory', 'fs/writeFile']);

type SaveState = 'pending' | 'unknown' | 'saved' | 'conflict' | 'failed';
interface SaveReceipt { id: string; hostId: string; target: string; state: SaveState; requestRoot?: string; requestTarget?: string }
const saveStates = new Set<SaveState>(['pending', 'unknown', 'saved', 'conflict', 'failed']);

export function createFiles(options: { dataDir: string; workspace: string; hosts: Map<string, SshHost>; request: FileRequest; remoteCommand?: RemoteFileCommand }) {
  const controllers = new Set<AbortController>();
  const uploads = new Map<string, string>();
  const attachmentDirectories = new Map<string, Set<string>>();
  const creatingAttachments = new Set<string>();
  const fileWrites = new Map<string, Promise<void>>();
  const liveSaves = new Set<string>();
  let receipts: SaveReceipt[] | undefined;
  let receiptQueue: Promise<void> = Promise.resolve();
  let closed = false;
  // Persist the path fence before the daemon write.
  async function journal<T>(action: (current: SaveReceipt[]) => { value: T; next?: SaveReceipt[] }): Promise<T> {
    const run = receiptQueue.then(async () => {
      if (!receipts) {
        let raw: unknown;
        try { raw = JSON.parse(await readFile(join(options.dataDir, 'workspace-file-saves.json'), 'utf8')); }
        catch (error) { if (missing(error)) raw = []; else throw error; }
        if (!Array.isArray(raw) || !raw.every(item => item && typeof item.id === 'string' && typeof item.hostId === 'string'
          && typeof item.target === 'string' && saveStates.has(item.state))) throw new Error('文件保存记录无法读取；已阻止写入。');
        receipts = raw as SaveReceipt[];
      }
      const result = action(receipts);
      if (result.next) {
        await mkdir(options.dataDir, { recursive: true, mode: 0o700 });
        const temporary = join(options.dataDir, `workspace-file-saves.${randomBytes(12).toString('hex')}.tmp`);
        const file = await open(temporary, 'wx', 0o600);
        try { await file.writeFile(JSON.stringify(result.next)); await file.sync(); } finally { await file.close(); }
        await rename(temporary, join(options.dataDir, 'workspace-file-saves.json'));
        const directory = await open(options.dataDir, 'r');
        try { await directory.sync(); } finally { await directory.close(); }
        receipts = result.next;
      }
      return result.value;
    });
    receiptQueue = run.then(() => {}, () => {});
    return run;
  }
  async function receiptState(id: string, state: SaveState) {
    await journal(current => {
      if (!current.some(item => item.id === id && item.state === 'pending')) throw new Error('文件保存记录已改变；已阻止后续写入。');
      return { value: undefined, next: current.map(item => item.id === id ? { ...item, state } : item) };
    });
  }
  function host(value: unknown) {
    const hostId = value == null ? 'local' : value;
    if (typeof hostId !== 'string' || hostId !== 'local' && !options.hosts.has(hostId)) throw new Error('未登记的执行主机：' + String(hostId));
    return hostId;
  }
  function path(value: unknown, hostId: string) {
    if (typeof value !== 'string' || !value || value.includes('\0')) throw new Error('需要文件路径');
    if (value.startsWith('file:')) value = fileURLToPath(value);
    if (typeof value !== 'string' || /^[a-z][a-z0-9+.-]*:/i.test(value)) throw new Error('需要本机或 SSH 文件路径');
    if (hostId === 'local') return resolve(options.workspace, value);
    if (!posix.isAbsolute(value)) throw new Error('SSH 文件需要远端绝对路径');
    return posix.normalize(value);
  }
  async function remote(hostId: string, command: string, maxBytes = 1024 * 1024) {
    const controller = new AbortController(); controllers.add(controller);
    try { return await (options.remoteCommand ?? remoteFileCommand)(options.hosts.get(hostId)!, command, maxBytes, controller.signal); }
    finally { controllers.delete(controller); }
  }
  async function daemonMetadata(hostId: string, target: string): Promise<DaemonMetadata> {
    return await options.request(hostId, 'fs/getMetadata', { path: target }) as DaemonMetadata;
  }
  async function metadata(hostId: string, target: string): Promise<Metadata> {
    const info = await daemonMetadata(hostId, target);
    // fs/getMetadata has no size. Never replace it with the length of an
    // unbounded fs/readFile response just to render the preview's size limit.
    const sizeBytes = hostId === 'local' ? (await stat(target)).size
      : Number((await remote(hostId, `stat -L --printf='%s' -- ${quote(target)}`, 64)).toString());
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) throw new Error('无效的文件大小');
    return { isFile: info.isFile, isDirectory: info.isDirectory, sizeBytes, mtimeMs: info.modifiedAtMs, createdAtMs: info.createdAtMs || null };
  }
  async function canonical(hostId: string, target: string) {
    return hostId === 'local' ? realpath(target) : (await remote(hostId, `realpath -ze -- ${quote(target)}`)).toString().replace(/\0$/, '');
  }
  async function prefix(hostId: string, target: string, length: number) {
    if (hostId === 'local') {
      // A replaced path must not turn a file preview into a blocking FIFO read.
      const file = await open(target, constants.O_RDONLY | constants.O_NONBLOCK);
      try {
        if (!(await file.stat()).isFile()) throw new Error('路径不是普通文件');
        const buffer = Buffer.alloc(length);
        let offset = 0;
        while (offset < buffer.length) { const read = await file.read(buffer, offset, buffer.length - offset, null); if (!read.bytesRead) break; offset += read.bytesRead; }
        return buffer.subarray(0, offset);
      } finally { await file.close(); }
    }
    // Keep a hard byte bound even if the file grows after stat. timeout also
    // bounds a remote path replaced with a FIFO before head opens it.
    return remote(hostId, `test -f ${quote(target)} && timeout 10 head -c ${length} -- ${quote(target)}`, length);
  }
  async function bytes(hostId: string, target: string, maxBytes: number) {
    const info = await metadata(hostId, target);
    if (!info.isFile) throw new Error('路径不是普通文件');
    if (info.sizeBytes > maxBytes) throw new Error('文件超出大小限制');
    const result = await prefix(hostId, target, Math.min(maxBytes + 1, info.sizeBytes + 1));
    if (result.length > maxBytes || result.length > info.sizeBytes) throw new Error('文件读取期间变大，请重新打开');
    return result;
  }
  async function readDirectory(hostId: string, target: string): Promise<{ entries: DaemonEntry[] }> {
    return await options.request(hostId, 'fs/readDirectory', { path: target }) as { entries: DaemonEntry[] };
  }
  async function saveWorkspaceFile(params: ObjectValue, hostId: string) {
    if (closed) throw new Error('文件服务已关闭，未保存。');
    if (typeof params.cwd !== 'string' || !posix.isAbsolute(params.cwd)
      || typeof params.path !== 'string' || !params.path || params.path.includes('\0')
      || typeof params.expectedContents !== 'string' || typeof params.contents !== 'string') throw new Error('文件保存需要工作目录、路径及完整原始/新内容。');
    const expected = params.expectedContents, contents = params.contents;
    const originalBytes = Buffer.from(expected, 'utf8'), nextBytes = Buffer.from(contents, 'utf8');
    if (originalBytes.length > previewLimit || nextBytes.length > previewLimit) throw new Error('文件超过10 MiB保存限制。');
    const binary = (data: Buffer) => data.some(byte => byte < 32 && ![9, 10, 12, 13].includes(byte));
    if (originalBytes.toString('utf8') !== expected || nextBytes.toString('utf8') !== contents
      || binary(originalBytes) || binary(nextBytes)) throw new Error('文件内容不是有效的UTF-8文本，未保存。');
    const root = path(params.cwd, hostId);
    const target = path(params.path.startsWith('file:') ? params.path : posix.resolve(root, params.path), hostId);
    if (!within(root, target) || root === target) throw new Error('保存路径必须位于当前工作目录内。');
    const [realRoot, realTarget] = await Promise.all([canonical(hostId, root), canonical(hostId, target)]);
    if (!within(realRoot, realTarget) || realRoot === realTarget) throw new Error('保存路径超出当前工作目录。');
    const key = JSON.stringify([hostId, realTarget]);
    const id = params.operationId == null ? randomBytes(16).toString('hex') : params.operationId;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error('无效的文件保存操作标识。');
    const existing = await journal(current => ({ value: current.find(item => item.hostId === hostId && item.target === realTarget
      && (item.state === 'pending' || item.state === 'unknown')) }));
    if (existing) return { outcome: 'blocked' as const, operationId: existing.id };
    const result = (fileWrites.get(key) ?? Promise.resolve()).then(async () => {
      if (closed) throw new Error('文件服务已关闭，未保存。');
      const blocked = await journal(current => {
        const duplicate = current.find(item => item.id === id);
        if (duplicate && (duplicate.hostId !== hostId || duplicate.target !== realTarget)) throw new Error('文件保存操作标识已用于其他文件。');
        const prior = duplicate ?? current.find(item => item.hostId === hostId && item.target === realTarget && (item.state === 'pending' || item.state === 'unknown'));
        return prior ? { value: prior } : { value: undefined, next: [...current, {
          id, hostId, target: realTarget, requestRoot: root, requestTarget: target, state: 'pending',
        }] };
      });
      if (blocked) return { outcome: 'blocked' as const, operationId: blocked.id };
      liveSaves.add(id);
      let issued = false, returned = false, finalized = false;
      let releaseLate!: () => void;
      const afterInitial = new Promise<void>(resolve => { releaseLate = resolve; });
      const onLateTerminal = async (terminal: LateRpcTerminal) => {
        await afterInitial;
        if (closed) return;
        let state: SaveState = 'failed';
        if (terminal.outcome === 'success') {
          try {
            state = await canonical(hostId, target) === realTarget && !(await daemonMetadata(hostId, target)).isSymlink
              && (await bytes(hostId, realTarget, previewLimit)).equals(nextBytes) ? 'saved' : 'conflict';
          } catch { state = 'conflict'; }
        }
        await journal(current => {
          if (closed) return { value: undefined };
          const item = current.find(value => value.id === id && value.hostId === hostId && value.target === realTarget);
          if (!item || item.state !== 'unknown') return { value: undefined };
          return { value: undefined, next: current.map(value => value === item ? { ...value, state } : value) };
        });
      };
      try {
        const [directory, before, currentRoot, currentTarget] = await Promise.all([
          daemonMetadata(hostId, root), daemonMetadata(hostId, target), canonical(hostId, root), canonical(hostId, target),
        ]);
        if (!directory.isDirectory || !before.isFile || before.isSymlink) throw new Error('只能保存当前工作目录内已存在的普通文件，符号链接不写入。');
        if (currentRoot !== realRoot || currentTarget !== realTarget) { await receiptState(id, 'conflict'); finalized = true; return { outcome: 'conflict' as const }; }
        const currentBytes = await bytes(hostId, realTarget, previewLimit);
        // Compare original bytes, including BOM and mixed line endings, before
        // the existing daemon write. External writers are not an atomic CAS.
        if (!currentBytes.equals(originalBytes)) { await receiptState(id, 'conflict'); finalized = true; return { outcome: 'conflict' as const }; }
        const latest = await daemonMetadata(hostId, target);
        if (!latest.isFile || latest.isSymlink || latest.modifiedAtMs !== before.modifiedAtMs
          || latest.createdAtMs !== before.createdAtMs || await canonical(hostId, target) !== realTarget) { await receiptState(id, 'conflict'); finalized = true; return { outcome: 'conflict' as const }; }
        issued = true;
        await options.request(hostId, 'fs/writeFile', { path: realTarget, dataBase64: nextBytes.toString('base64') }, true, onLateTerminal);
        returned = true;
        try {
          if (await canonical(hostId, target) !== realTarget || (await daemonMetadata(hostId, target)).isSymlink
            || !(await bytes(hostId, realTarget, previewLimit)).equals(nextBytes)) throw new Error('保存后文件内容或路径已改变。');
        } catch (error) {
          await receiptState(id, 'conflict'); finalized = true;
          throw Object.assign(new Error('文件保存结果待核对，勿重复写入：' + (error instanceof Error ? error.message : String(error))), { uncertain: true });
        }
        await receiptState(id, 'saved'); finalized = true;
        return { outcome: 'saved' as const };
      } catch (error) {
        if (!finalized) {
          const definitelyFailed = !issued || !returned && typeof error === 'object' && error !== null && 'uncertain' in error && error.uncertain === false;
          try { await receiptState(id, definitelyFailed ? 'failed' : 'unknown'); }
          catch { throw Object.assign(new Error('文件保存记录无法更新，结果未知；已阻止后续写入。'), { uncertain: true }); }
          if (!definitelyFailed) throw Object.assign(new Error('文件保存结果未知；已阻止后续写入：' + (error instanceof Error ? error.message : String(error))), { uncertain: true, cause: error });
        }
        throw error;
      } finally { liveSaves.delete(id); releaseLate(); }
    });
    const settled = result.then(() => {}, () => {});
    fileWrites.set(key, settled);
    void settled.then(() => { if (fileWrites.get(key) === settled) fileWrites.delete(key); });
    return result;
  }
  async function saveStatus(params: ObjectValue, hostId: string) {
    if (typeof params.operationId !== 'string' || typeof params.cwd !== 'string' || !posix.isAbsolute(params.cwd)
      || typeof params.path !== 'string' || !params.path || params.path.includes('\0')) throw new Error('查询保存状态需要操作标识、工作目录和路径。');
    const root = path(params.cwd, hostId);
    const target = path(params.path.startsWith('file:') ? params.path : posix.resolve(root, params.path), hostId);
    if (!within(root, target) || root === target) throw new Error('查询路径必须位于当前工作目录内。');
    const recorded = await journal(current => ({ value: current.find(receipt => receipt.id === params.operationId && receipt.hostId === hostId
      && receipt.requestRoot === root && receipt.requestTarget === target) }));
    if (recorded) return { outcome: recorded.state === 'pending' && !liveSaves.has(recorded.id) ? 'unknown' : recorded.state };
    // Legacy receipts have no submitted-path fields; preserve their former lookup.
    const [realRoot, realTarget] = await Promise.all([canonical(hostId, root), canonical(hostId, target)]);
    if (!within(realRoot, realTarget) || realRoot === realTarget) throw new Error('查询路径超出当前工作目录。');
    return journal(current => {
      const item = current.find(receipt => receipt.id === params.operationId && receipt.hostId === hostId
        && receipt.requestRoot === undefined && receipt.target === realTarget);
      return { value: { outcome: !item ? 'missing' : item.state === 'pending' && !liveSaves.has(item.id) ? 'unknown' : item.state } };
    });
  }
  async function directory(params: ObjectValue, hostId: string, unbounded = false) {
    const root = path(unbounded ? params.directoryPath : params.workspaceRoot, hostId);
    if (!(await daemonMetadata(hostId, root)).isDirectory) throw new Error('workspaceRoot 必须是目录');
    const relative = unbounded ? '' : typeof params.directoryPath === 'string' ? params.directoryPath : '';
    const target = posix.resolve(root, relative || '.');
    if (!within(root, target)) throw new Error('directoryPath 必须位于 workspaceRoot 内');
    const [realRoot, realTarget] = await Promise.all([canonical(hostId, root), canonical(hostId, target)]);
    if (!within(realRoot, realTarget)) throw new Error('directoryPath 必须位于 workspaceRoot 内');
    if (!(await daemonMetadata(hostId, target)).isDirectory) throw new Error('directoryPath 必须是目录');
    const dir = posix.relative(root, target);
    const listed = await readDirectory(hostId, target);
    const entries: { name: string; path: string; type: 'directory' | 'file'; isSymlink: boolean }[] = [];
    // readDirectory omits isSymlink; getMetadata supplies it. Limit concurrent
    // requests and avoid inspecting entries the renderer will not display.
    for (let at = 0; at < listed.entries.length; at += 8) {
      const batch = await Promise.all(listed.entries.slice(at, at + 8).map(async entry => {
        const name = entry.fileName, entryPath = posix.join(target, name);
        if (!unbounded && params.includeHidden !== true && name.startsWith('.')) return null;
        if (params.directoriesOnly && !entry.isDirectory) return null;
        try {
          const info = await daemonMetadata(hostId, entryPath);
          if (info.isSymlink && info.isDirectory && (hostId !== 'local' || !within(realRoot, await canonical(hostId, entryPath)))) return null;
          return { name, path: posix.join(dir, name), type: info.isDirectory ? 'directory' as const : 'file' as const, isSymlink: info.isSymlink };
        } catch (error) { if (missing(error)) return null; throw error; }
      }));
      entries.push(...batch.filter(entry => entry != null));
    }
    entries.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1);
    return unbounded ? { directoryPath: target, parentPath: dirname(target) === target ? null : dirname(target), entries: entries.map(entry => ({ ...entry, path: posix.join(root, entry.path) })) }
      : { workspaceRoot: root, directoryPath: dir, parentPath: dir ? posix.dirname(dir).replace(/^\.$/, '') : null, entries };
  }
  async function fetchFile(endpoint: string, params: ObjectValue): Promise<unknown> {
    const hostId = host(params.hostId);
    if (endpoint === 'workspace-file-save') return saveWorkspaceFile(params, hostId);
    if (endpoint === 'workspace-file-save-status') return saveStatus(params, hostId);
    if (endpoint === 'ensure-directory') {
      if (typeof params.path !== 'string' || !posix.isAbsolute(params.path)) throw new Error('需要绝对目录');
      await options.request(hostId, 'fs/createDirectory', { path: path(params.path, hostId), recursive: true }, true);
      return { success: true };
    }
    if (endpoint === 'workspace-directory-entries') return directory(params, hostId);
    if (endpoint === 'remote-workspace-directory-entries') {
      const directoryPath = params.directoryPath || (hostId === 'local' ? options.workspace : (await remote(hostId, 'printf %s "$HOME"')).toString());
      return directory({ ...params, directoryPath }, hostId, true);
    }
    if (endpoint === 'paths-exist') return { existingPaths: (await Promise.all((Array.isArray(params.paths) ? params.paths : []).map(async value => {
      const target = path(value, hostId);
      try { await daemonMetadata(hostId, target); return value; } catch (error) { if (missing(error)) return null; throw error; }
    }))).filter(value => value != null) };
    const target = path(params.path, hostId);
    if (endpoint === 'visualization-read') {
      if (typeof params.threadId !== 'string' || !params.threadId || !/\.html?$/i.test(target)) throw new Error('需要对话与 HTML 可视化路径');
      const data = await bytes(hostId, target, 5_000_000);
      return { path: await canonical(hostId, target), contents: new TextDecoder('utf-8', { fatal: true }).decode(data) };
    }
    if (endpoint === 'workspace-files') {
      if (params.operation === 'getMetadata') {
        const info = await daemonMetadata(hostId, target);
        return info.isDirectory || info.isFile ? { kind: info.isDirectory ? 'directory' : 'file', ...params.includeCanonicalPath ? { canonicalPath: await canonical(hostId, target) } : {} } : null;
      }
      if (params.operation !== 'read') throw new Error('Web 文件服务只支持读取和下载');
      const data = await bytes(hostId, target, limit(params.maxBytes, previewLimit));
      if (params.representation === 'text' || params.representation === 'auto' && contentKind(data.subarray(0, 4096), data.length > 4096) === 'text') return { text: data.toString('utf8') };
      return { blob: data.toString('base64') };
    }
    if (endpoint === 'read-file-metadata') {
      const info = await metadata(hostId, target);
      const sample = params.contentSampleByteLimit == null ? 0 : limit(params.contentSampleByteLimit, 65536);
      const canSample = info.isFile && sample > 0 && info.sizeBytes <= limit(params.contentSampleMaxFileBytes, previewLimit);
      const kind = canSample ? contentKind(await prefix(hostId, target, Math.min(sample, info.sizeBytes)), info.sizeBytes > sample) : undefined;
      return { ...info, ...kind ? { contentKind: kind } : {} };
    }
    const maxBytes = limit(params.maxBytes, previewLimit);
    if (endpoint === 'read-file-binary' && (await metadata(hostId, target)).sizeBytes > maxBytes) return { contentsBase64: null };
    const data = await bytes(hostId, target, maxBytes);
    return endpoint === 'read-file' ? { contents: data.toString('utf8') } : { contentsBase64: data.toString('base64'), mimeType: mediaType(target, data) };
  }

  async function http(request: IncomingMessage, response: ServerResponse, url: URL) {
    if (url.pathname === '/api/files/download' && ['GET', 'HEAD'].includes(request.method || '')) {
      const hostId = host(url.searchParams.get('hostId')), target = path(url.searchParams.get('path'), hostId);
      const name = filename(url.searchParams.get('name') || basename(target));
      if (request.method === 'HEAD') {
        const info = await metadata(hostId, target);
        if (!info.isFile) throw new Error('路径不是普通文件');
        if (info.sizeBytes > downloadLimit) throw new Error('文件超出大小限制');
        response.writeHead(200, { 'Content-Length': info.sizeBytes }); response.end(); return true;
      }
      const data = await bytes(hostId, target, downloadLimit);
      response.writeHead(200, { 'Content-Type': mediaType(target, data), 'Content-Length': data.length,
        'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(name).replaceAll("'", '%27') });
      response.end(request.method === 'HEAD' ? undefined : data); return true;
    }
    if (url.pathname === '/api/files/uploads' && request.method === 'POST') {
      await mkdir(join(options.dataDir, 'uploads'), { recursive: true, mode: 0o700 });
      const directory = await mkdtemp(join(options.dataDir, 'uploads', 'pick-'));
      const uploadId = randomBytes(18).toString('hex'); uploads.set(uploadId, directory);
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ uploadId, directory })); return true;
    }
    if (url.pathname === '/api/files/upload' && request.method === 'POST') {
      const root = uploads.get(url.searchParams.get('uploadId') || '');
      if (!root) throw new Error('未知上传目录');
      const relative = url.searchParams.get('name') || '';
      if (!relative || relative.split('/').some(part => filename(part) !== part)) throw new Error('无效上传路径');
      const target = join(root, relative);
      let size = 0; const chunks: Buffer[] = [];
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > previewLimit) { request.resume(); throw new Error('单个上传文件超过10 MiB'); }
        chunks.push(chunk);
      }
      // Upload roots are private mkdtemp directories. Validate the nearest
      // existing parent before recursive mkdir so a symlink cannot escape it.
      let ancestor = dirname(target);
      for (;;) {
        try { if (!within(root, await realpath(ancestor))) throw new Error('上传路径超出本次目录'); break; }
        catch (error) { if (!missing(error)) throw error; ancestor = dirname(ancestor); }
      }
      await options.request('local', 'fs/createDirectory', { path: dirname(target), recursive: true }, true);
      if (!within(root, await realpath(dirname(target)))) throw new Error('上传路径超出本次目录');
      // fs/writeFile has no createNew/mode option. Reserve the new private
      // upload with wx before the official write; retries cannot overwrite it.
      await (await open(target, 'wx', 0o600)).close();
      await options.request('local', 'fs/writeFile', { path: target, dataBase64: Buffer.concat(chunks).toString('base64') }, true);
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ label: basename(target), path: target, fsPath: target })); return true;
    }
    return false;
  }
  // The original SSH composer copies picked local files using two daemon RPCs.
  // Permit only fresh UUID attachment directories and their first file writes;
  // this does not expose arbitrary filesystem mutation to the renderer.
  async function attachmentRequest(method: string, params: ObjectValue, hostId: string, codexHome: string,
    request = (method: string, params: ObjectValue) => options.request(hostId, method, params, true)) {
    host(hostId);
    if (hostId === 'local') throw new Error('附件传输仅用于已登记 SSH 主机');
    const target = path(params.path, hostId), key = hostId + ':' + target;
    if (method === 'fs/createDirectory') {
      if (dirname(target) !== posix.join(codexHome, 'attachments') || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(basename(target))) throw new Error('只允许创建新的附件传输目录');
      if (attachmentDirectories.has(key) || creatingAttachments.has(key)) throw new Error('附件目录已经存在或结果待确认');
      creatingAttachments.add(key);
      await request('fs/createDirectory', { path: dirname(target), recursive: true });
      // recursive:false is the daemon's exclusive mkdir. A preflight stat
      // followed by recursive mkdir would silently accept an existing UUID.
      await request('fs/createDirectory', { path: target, recursive: false });
      attachmentDirectories.set(key, new Set());
      return {};
    }
    const directory = attachmentDirectories.get(hostId + ':' + dirname(target));
    if (method !== 'fs/writeFile' || !directory || directory.has(target)) throw new Error('只允许写入本次新建附件目录中的新文件');
    filename(basename(target));
    const data = params.dataBase64;
    if (typeof data !== 'string' || data.length > Math.ceil(previewLimit / 3) * 4 || data.length % 4 !== 0) throw new Error('无效或过大的附件内容');
    const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
    if (/[^A-Za-z0-9+/]/.test(data.slice(0, data.length - padding))) throw new Error('无效的附件内容');
    if (Buffer.byteLength(data, 'base64') > previewLimit) throw new Error('附件超过10 MiB');
    directory.add(target); // A lost reply must never automatically overwrite it.
    return request('fs/writeFile', { path: target, dataBase64: data });
  }
  async function rpc(method: string, params: ObjectValue, hostId: string, codexHome?: string): Promise<unknown> {
    host(hostId);
    const target = path(params.path, hostId);
    if (method === 'fs/readFile') return { dataBase64: (await bytes(hostId, target, previewLimit)).toString('base64') };
    if (method === 'fs/readDirectory') return readDirectory(hostId, target);
    if (method === 'fs/getMetadata') {
      const { isFile, isDirectory, isSymlink, createdAtMs, modifiedAtMs } = await daemonMetadata(hostId, target);
      return { isFile, isDirectory, isSymlink, createdAtMs, modifiedAtMs };
    }
    if (!codexHome) throw new Error('附件主机尚未连接');
    return attachmentRequest(method, params, hostId, codexHome);
  }
  return { fetch: fetchFile, http, rpc, attachmentRequest, close() { closed = true; for (const controller of controllers) controller.abort(); uploads.clear(); attachmentDirectories.clear(); creatingAttachments.clear(); } };
}
