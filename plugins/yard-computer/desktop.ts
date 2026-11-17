import { execFile, spawn } from 'node:child_process';
import { lstat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export type DesktopAction =
  | { type: 'screenshot' }
  | { type: 'click'; x: number; y: number; button?: 'left' | 'middle' | 'right'; clicks?: number }
  | { type: 'move'; x: number; y: number }
  | { type: 'drag'; fromX: number; fromY: number; toX: number; toY: number; button?: 'left' | 'middle' | 'right' }
  | { type: 'type'; text: string }
  | { type: 'keypress'; keys: string[] }
  | { type: 'scroll'; direction: 'up' | 'down' | 'left' | 'right'; clicks: number }
  | { type: 'wait'; milliseconds: number };

export type DesktopContent = { type: 'text'; text: string } | { type: 'image'; mimeType: 'image/png'; data: string };
export interface DesktopRunOptions {
  env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number; signal?: AbortSignal; input?: Buffer;
}
export type DesktopRunner = (file: string, args: string[], options: DesktopRunOptions) => Promise<Buffer>;
export interface DesktopOptions {
  display?: string;
  xauthority?: string;
  importCommand?: string;
  xdotoolCommand?: string;
  xclipCommand?: string;
  flockCommand?: string;
  run?: DesktopRunner;
}

const runFile: DesktopRunner = (file, args, options) => new Promise((resolve, reject) => {
  let closed = false, completed = false, failure: Error | null = null, result = Buffer.alloc(0);
  let forced: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const settle = () => { if (closed && completed) failure ? reject(failure) : resolve(result); };
  const { input, ...fileOptions } = options;
  // xclip's launcher forks its selection owner. Ignored output lets the launcher
  // close independently of that owner; no task text is passed through a shell.
  const child = input === undefined ? execFile(file, args, { ...fileOptions, encoding: 'buffer' }, (error, stdout, stderr) => {
    failure = error ? Object.assign(error, { stderr: stderr.toString('utf8') }) : null;
    result = stdout; completed = true; settle();
  }) : spawn(file, args, { env: options.env, signal: options.signal, stdio: ['pipe', 'ignore', 'ignore'] });
  const forceAfterGrace = () => { if (!closed) { clearTimeout(forced); forced = setTimeout(() => child.kill('SIGKILL'), 500).unref(); } };
  const stop = () => { if (!closed) { child.kill('SIGTERM'); forceAfterGrace(); } };
  if (input !== undefined) {
    child.once('error', error => { failure ??= error; completed = true; });
    child.once('exit', (code, signal) => {
      if (!failure && (code !== 0 || signal)) failure = new Error(`Selection launcher exited with ${signal ?? code}.`);
      completed = true;
    });
    deadline = setTimeout(() => { failure ??= new Error('Selection launcher timed out.'); stop(); }, options.timeout).unref();
  }
  const aborted = () => forceAfterGrace();
  child.once('close', () => {
    closed = true; clearTimeout(forced); clearTimeout(deadline); options.signal?.removeEventListener('abort', aborted); settle();
  });
  if (options.signal?.aborted) aborted(); else options.signal?.addEventListener('abort', aborted, { once: true });
  child.stdin?.on('error', () => {}); child.stdin?.end(input);
});
const buttons = { left: '1', middle: '2', right: '3' } as const;
const scrollButtons = { up: '4', down: '5', left: '6', right: '7' } as const;
const keyNames: Record<string, string> = {
  ctrl: 'ctrl', control: 'ctrl', alt: 'alt', shift: 'shift', super: 'super', meta: 'super', win: 'super',
  enter: 'Return', return: 'Return', tab: 'Tab', escape: 'Escape', esc: 'Escape', space: 'space',
  backspace: 'BackSpace', delete: 'Delete', insert: 'Insert', home: 'Home', end: 'End',
  left: 'Left', arrowleft: 'Left', right: 'Right', arrowright: 'Right', up: 'Up', arrowup: 'Up', down: 'Down', arrowdown: 'Down',
  pageup: 'Prior', pagedown: 'Next', capslock: 'Caps_Lock',
  '-': 'minus', '=': 'equal', '[': 'bracketleft', ']': 'bracketright', '\\': 'backslash',
  ';': 'semicolon', "'": 'apostrophe', ',': 'comma', '.': 'period', '/': 'slash', '`': 'grave', '+': 'plus',
};

function integer(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} 必须是 ${min} 到 ${max} 的整数。`);
  }
  return value;
}
function key(value: unknown): string {
  if (typeof value !== 'string') throw new Error('keys 必须包含键名。');
  if (/^[a-zA-Z0-9]$/.test(value)) return value;
  if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(value)) return value.toUpperCase();
  const name = keyNames[value.toLowerCase()];
  if (!name) throw new Error(`不支持的键名：${value}。使用 Ctrl、Alt、Shift、Super、Enter、方向键、F1–F24 或单个字母/数字。`);
  return name;
}
function action(value: unknown): DesktopAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('需要桌面动作对象。');
  const input = value as Record<string, unknown>;
  const coordinates = (...names: string[]) => { for (const name of names) integer(input[name], name, 0, 32767); };
  const button = () => {
    if (input.button != null && !Object.hasOwn(buttons, String(input.button))) throw new Error('button 只能是 left、middle 或 right。');
  };
  switch (input.type) {
    case 'screenshot': break;
    case 'click': coordinates('x', 'y'); button(); if (input.clicks != null) integer(input.clicks, 'clicks', 1, 3); break;
    case 'move': coordinates('x', 'y'); break;
    case 'drag': coordinates('fromX', 'fromY', 'toX', 'toY'); button(); break;
    case 'type':
      if (typeof input.text !== 'string' || input.text.length < 1 || input.text.length > 1000 || input.text.includes('\0')) {
        throw new Error('text 每次需要包含 1 到 1000 个字符，并且不能含 NUL；长文本请拆成多次输入。');
      }
      break;
    case 'keypress':
      if (!Array.isArray(input.keys) || input.keys.length < 1 || input.keys.length > 8) throw new Error('keys 需要包含 1 到 8 个键名。');
      input.keys.forEach(key); break;
    case 'scroll':
      if (!Object.hasOwn(scrollButtons, String(input.direction))) throw new Error('direction 只能是 up、down、left 或 right。');
      integer(input.clicks, 'clicks', 1, 20); break;
    case 'wait': integer(input.milliseconds, 'milliseconds', 0, 2000); break;
    default: throw new Error('不支持的桌面动作。');
  }
  return input as DesktopAction;
}

/** A local X11 connection explicitly selected by the operator. No App process or screenshot files. */
export class X11Desktop {
  private readonly display: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly importCommand: string;
  private readonly xdotoolCommand: string;
  private readonly xclipCommand: string;
  private readonly flockCommand: string;
  private readonly run: DesktopRunner;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(options: DesktopOptions = {}) {
    this.display = options.display ?? process.env.YARD_COMPUTER_DISPLAY ?? '';
    const xauthority = options.xauthority ?? process.env.YARD_COMPUTER_XAUTHORITY;
    this.env = { ...process.env, DISPLAY: this.display, ...(xauthority ? { XAUTHORITY: xauthority } : {}) };
    this.importCommand = options.importCommand ?? process.env.YARD_COMPUTER_IMPORT ?? 'import';
    this.xdotoolCommand = options.xdotoolCommand ?? process.env.YARD_COMPUTER_XDOTOOL ?? 'xdotool';
    this.xclipCommand = options.xclipCommand ?? process.env.YARD_COMPUTER_XCLIP ?? 'xclip';
    this.flockCommand = options.flockCommand ?? 'flock';
    this.run = options.run ?? runFile;
  }

  execute(value: unknown, signal?: AbortSignal): Promise<DesktopContent[]> {
    // One mouse/keyboard belongs to the display; concurrent MCP calls must stay ordered.
    const next = this.pending.then(async () => {
      signal?.throwIfAborted();
      const request = action(value);
      if (!/^:[0-9]+(?:\.0)?$/.test(this.display)) {
        throw new Error('请显式配置 YARD_COMPUTER_DISPLAY 为本机 X11 screen 0（例如 :99 或 :99.0）。Wayland 需要切换到 X11。');
      }
      if (process.platform !== 'linux') throw new Error('当前 Yard 桌面驱动支持 Linux X11。');
      return this.withDisplayLock(() => this.perform(request, signal), signal);
    });
    this.pending = next.catch(() => {});
    return next;
  }

  private async withDisplayLock<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    const directory = join('/tmp', `yard-computer-${process.getuid!()}`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const owner = await lstat(directory);
    if (!owner.isDirectory() || owner.uid !== process.getuid!() || (owner.mode & 0o077)) {
      throw new Error(`桌面锁目录必须由当前用户拥有且权限为 0700：${directory}`);
    }
    // All screens of one X server share input devices. Never unlink live flock files.
    const serverNumber = Number(this.display.slice(1).split('.')[0]);
    const child = spawn(this.flockCommand, ['--exclusive', '--timeout', '20', join(directory, `display-${serverNumber}.lock`),
      process.execPath, '-e', 'process.stdout.write("READY\\n");process.stdin.resume();'], { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    let closed = false;
    const close = new Promise<void>(resolve => child.once('close', () => { closed = true; resolve(); }));
    let abortLock: (() => void) | undefined;
    const ready = new Promise<void>((resolve, reject) => {
      abortLock = () => reject(signal?.reason);
      if (signal?.aborted) abortLock(); else signal?.addEventListener('abort', abortLock, { once: true });
      let output = '', acquired = false;
      child.once('error', cause => reject(new Error('无法启动 flock 桌面锁。请安装 util-linux。', { cause })));
      child.once('exit', () => { if (!acquired) reject(new Error('等待其他桌面操作超时或 flock 无法获得锁；本次动作尚未执行。')); });
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
        if (output === 'READY\n') { acquired = true; resolve(); }
        else if (output.length > 256) reject(new Error('桌面锁握手无效。'));
      });
    });
    try { await ready; signal?.throwIfAborted(); return await operation(); }
    finally {
      if (abortLock) signal?.removeEventListener('abort', abortLock);
      // EOF releases the lock even if the MCP parent crashes or its pipes close.
      child.stdin.end();
      if (!closed) {
        const timeout = setTimeout(() => child.kill('SIGKILL'), 1000).unref();
        await close;
        clearTimeout(timeout);
      }
    }
  }

  private async command(file: string, args: string[], signal?: AbortSignal, extra: { timeout?: number; input?: Buffer } = {}): Promise<Buffer> {
    signal?.throwIfAborted();
    try { return await this.run(file, args, { env: this.env, timeout: 10000, maxBuffer: 20 * 1024 * 1024, signal, ...extra }); }
    catch (cause) {
      signal?.throwIfAborted();
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`找不到桌面工具 ${file}。请安装 xdotool、ImageMagick 和 xclip（Debian/Ubuntu：apt install xdotool imagemagick xclip），或设置对应 YARD_COMPUTER_* 可执行文件路径。`, { cause });
      }
      throw new Error(`桌面工具执行失败，请核对 ${this.display} 的 X11 连接和 XAUTHORITY。`, { cause });
    }
  }
  private input(...args: string[]) { return this.command(this.xdotoolCommand, args); }

  private primary(target: string, signal?: AbortSignal): Promise<Buffer> {
    return this.command(this.xclipCommand, ['-selection', 'primary', '-out', '-target', target], signal, { timeout: 5000 });
  }

  private async pasteUnicode(text: string, signal: AbortSignal | undefined, markAttempted: () => void): Promise<void> {
    signal?.throwIfAborted(); markAttempted();
    const bytes = Buffer.from(text);
    await this.command(this.xclipCommand, ['-selection', 'primary', '-in', '-target', 'UTF8_STRING'], signal,
      { input: bytes, timeout: 5000 });
    // PRIMARY keeps the new text so even delayed or repeated content requests
    // can read it. The user's main CLIPBOARD is never used by this path.
    let confirmed = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      try { if ((await this.primary('UTF8_STRING', signal)).equals(bytes)) { confirmed = true; break; } }
      catch (cause) {
        const original = (cause as Error).cause as { code?: unknown; stderr?: unknown } | undefined;
        if (original?.code !== 1 || !/^Error: target (?:UTF8_STRING|STRING) not available\s*$/.test(String(original.stderr))) throw cause;
      }
      await delay(20, undefined, { signal });
    }
    if (!confirmed) throw new Error('无法确认 X11 PRIMARY 中的本次 Unicode 文本；请核对 xclip 和所选桌面后重新截图。');
    signal?.throwIfAborted();
    try { await this.command(this.xdotoolCommand, ['click', '2'], signal); }
    catch (cause) { await this.input('mouseup', '2'); throw cause; }
  }

  private async screenshot(signal?: AbortSignal): Promise<DesktopContent[]> {
    const png = await this.command(this.importCommand, ['-display', this.display, '-window', 'root', 'png:-'], signal);
    if (png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || png.toString('ascii', 12, 16) !== 'IHDR') {
      throw new Error('截图工具没有返回有效 PNG。请检查 ImageMagick import 和所选 X11 桌面。');
    }
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    if (!width || !height) throw new Error('截图尺寸无效。');
    return [
      { type: 'text', text: JSON.stringify({ display: this.display, width, height, coordinates: 'absolute screen pixels; origin at top left' }) },
      { type: 'image', mimeType: 'image/png', data: png.toString('base64') },
    ];
  }

  private async perform(request: DesktopAction, signal?: AbortSignal): Promise<DesktopContent[]> {
    signal?.throwIfAborted();
    if (request.type === 'screenshot') return this.screenshot(signal);
    const geometry = (await this.command(this.xdotoolCommand, ['getdisplaygeometry'], signal)).toString('utf8').trim().match(/^(\d+)\s+(\d+)$/);
    if (!geometry) throw new Error('无法读取 X11 桌面尺寸。');
    const width = Number(geometry[1]), height = Number(geometry[2]);
    const position = (x: number, y: number) => {
      if (x >= width || y >= height) throw new Error(`坐标 (${x}, ${y}) 超出 ${width}×${height} 桌面。请先截图核对坐标。`);
    };
    if (request.type === 'click' || request.type === 'move') position(request.x, request.y);
    if (request.type === 'drag') { position(request.fromX, request.fromY); position(request.toX, request.toY); }
    let inputAttempted = false;
    const input = (...args: string[]) => { signal?.throwIfAborted(); inputAttempted = true; return this.command(this.xdotoolCommand, args, signal); };
    try {
      switch (request.type) {
        case 'click':
          await input('mousemove', String(request.x), String(request.y));
          try { await input('click', '--repeat', String(request.clicks ?? 1), '--delay', '80', buttons[request.button ?? 'left']); }
          catch (cause) { await this.input('mouseup', buttons[request.button ?? 'left']); throw cause; }
          break;
        case 'move': await input('mousemove', String(request.x), String(request.y)); break;
        case 'drag': {
          const selectedButton = buttons[request.button ?? 'left'];
          await input('mousemove', String(request.fromX), String(request.fromY));
          try {
            await input('mousedown', selectedButton);
            for (let step = 1; step <= 8; step++) {
              await input('mousemove', String(Math.round(request.fromX + (request.toX - request.fromX) * step / 8)),
                String(Math.round(request.fromY + (request.toY - request.fromY) * step / 8)));
              await delay(16, undefined, { signal });
            }
          } finally { await this.input('mouseup', selectedButton); }
          break;
        }
        case 'type':
          signal?.throwIfAborted();
          if (/[^\x00-\x7f]/.test(request.text)) {
            await this.pasteUnicode(request.text, signal, () => { inputAttempted = true; }); break;
          }
          try {
            await input('type', '--clearmodifiers', '--delay', '0', '--', request.text);
          } catch (cause) {
            await this.input('keyup', 'Shift_L', 'Shift_R', 'Control_L', 'Control_R', 'Alt_L', 'Alt_R', 'Super_L', 'Super_R');
            throw cause;
          }
          break;
        case 'keypress': {
          const chord = request.keys.map(key).join('+');
          try { await input('key', '--clearmodifiers', chord); }
          catch (cause) { await this.input('keyup', chord); throw cause; }
          break;
        }
        case 'scroll': await input('click', '--repeat', String(request.clicks), '--delay', '25', scrollButtons[request.direction]); break;
        case 'wait': await delay(request.milliseconds, undefined, { signal }); break;
      }
      if (request.type !== 'wait') await delay(50, undefined, { signal });
      return await this.screenshot(signal);
    } catch (cause) {
      if (inputAttempted) throw new Error('桌面动作可能已生效，后续结果未确认；请先截图检查真实桌面。Yard 没有自动重试该动作。' +
        (cause instanceof Error ? ` ${cause.message}` : ''), { cause });
      throw cause;
    }
  }
}
