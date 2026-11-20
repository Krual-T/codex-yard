import { spawn } from 'node:child_process';
import { desktopAction } from './desktop.ts';
import type { DesktopAction, DesktopContent } from './desktop.ts';

const keys: Record<string, number> = {
  ctrl: 17, control: 17, shift: 16, alt: 18, super: 91, win: 91, meta: 91,
  enter: 13, return: 13, tab: 9, escape: 27, esc: 27, space: 32, backspace: 8,
  delete: 46, insert: 45, home: 36, end: 35, pageup: 33, pagedown: 34, capslock: 20,
  left: 37, arrowleft: 37, up: 38, arrowup: 38, right: 39, arrowright: 39, down: 40, arrowdown: 40,
  '-': 189, '=': 187, '[': 219, ']': 221, '\\': 220, ';': 186, "'": 222, ',': 188, '.': 190, '/': 191, '`': 192,
};
function virtualKey(name: string): number {
  if (/^[a-z0-9]$/i.test(name)) return name.toUpperCase().charCodeAt(0);
  if (/^f([1-9]|1\d|2[0-4])$/i.test(name)) return 111 + Number(name.slice(1));
  const code = keys[name.toLowerCase()];
  if (code === undefined) throw new Error('Unsupported Windows key: ' + name);
  return code;
}

// Data is passed as base64 JSON inside a fixed script, never as PowerShell code.
export function windowsScript(action: DesktopAction, validateOnly = false): string {
  const data = { ...desktopAction(action), ...(action.type === 'keypress' ? { keyCodes: action.keys.map(virtualKey) } : {}), validateOnly };
  return `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class YardDesktop {
  [StructLayout(LayoutKind.Sequential)] public struct Mouse { public int x,y; public uint data,flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct Key { public ushort vk,scan; public uint flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] public struct Union { [FieldOffset(0)] public Mouse mouse; [FieldOffset(0)] public Key key; }
  [StructLayout(LayoutKind.Sequential)] public struct Input { public uint type; public Union value; }
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint count, Input[] input, int size);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool GetUserObjectInformation(IntPtr handle, int index, System.Text.StringBuilder result, int length, out int needed);
  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr window);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr window, IntPtr dc);
  [DllImport("gdi32.dll", SetLastError=true)] public static extern bool BitBlt(IntPtr target, int x, int y, int width, int height, IntPtr source, int sourceX, int sourceY, uint operation);
  public static System.Threading.Tasks.Task<string> ReadCancel() { return System.Threading.Tasks.Task.Run(() => Console.In.ReadLine()); }
  public static Input Pointer(int x, int y, uint flags, int data) { var i=new Input(); i.type=0; i.value.mouse.x=x; i.value.mouse.y=y; i.value.mouse.flags=flags; i.value.mouse.data=unchecked((uint)data); return i; }
  public static Input Keyboard(ushort vk, ushort scan, uint flags) { var i=new Input(); i.type=1; i.value.key.vk=vk; i.value.key.scan=scan; i.value.key.flags=flags; return i; }
  public static void Send(Input[] values) {
    int size=Marshal.SizeOf(typeof(Input));
    if(SendInput((uint)values.Length,values,size)==values.Length) return;
    var release=new System.Collections.Generic.List<Input>();
    foreach(var i in values) {
      if(i.type==1 && (i.value.key.flags&2)==0) release.Add(Keyboard(i.value.key.vk,i.value.key.scan,i.value.key.flags|2));
      if(i.type==0) { uint f=i.value.mouse.flags; if((f&2)!=0) release.Add(Pointer(0,0,4,0)); if((f&8)!=0) release.Add(Pointer(0,0,16,0)); if((f&32)!=0) release.Add(Pointer(0,0,64,0)); }
    }
    if(release.Count>0) SendInput((uint)release.Count,release.ToArray(),size);
    throw new Exception("Input may be partially applied; key/button release was attempted. Target permissions or the input desktop may have changed.");
  }
}
'@
$a = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(JSON.stringify(data)).toString('base64')}')) | ConvertFrom-Json
if ($a.validateOnly) { @{validated=$true;inputSize=[Runtime.InteropServices.Marshal]::SizeOf([type][YardDesktop+Input]);sessionId=[Diagnostics.Process]::GetCurrentProcess().SessionId} | ConvertTo-Json -Compress; exit }
if (![Environment]::UserInteractive -or [Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0) { throw 'Windows Computer needs the signed-in interactive desktop session; SSH/service Session 0 is unsupported.' }
$cancel=[YardDesktop]::ReadCancel()
function Check-Cancel { if ($cancel.IsCompleted) { throw 'Desktop operation cancelled; previous input may remain and was not retried.' } }
$mutex = [Threading.Mutex]::new($false, 'Local\\CodexYardComputer-primary-v1')
$locked = $false
try {
  $deadline=[DateTime]::UtcNow.AddSeconds(20)
  while (!$locked -and [DateTime]::UtcNow -lt $deadline) { Check-Cancel; try { $locked=$mutex.WaitOne(100) } catch [Threading.AbandonedMutexException] { $locked=$true } }
  if (!$locked) { throw 'Desktop is busy; no input was sent.' }
  Check-Cancel
  $desktop=[YardDesktop]::OpenInputDesktop(0,$false,1)
  if ($desktop -eq [IntPtr]::Zero) { throw 'No interactive input desktop. Start the Windows MCP in the signed-in desktop session, not an SSH/service session.' }
  try {
    $name=[Text.StringBuilder]::new(256); $needed=0
    if (![YardDesktop]::GetUserObjectInformation($desktop,2,$name,512,[ref]$needed) -or $name.ToString() -ne 'Default') { throw 'The Windows desktop is locked or secured; unlock it locally before using Computer.' }
  } finally { [void][YardDesktop]::CloseDesktop($desktop) }
  if ([YardDesktop]::SetThreadDpiAwarenessContext([IntPtr]::new(-4)) -eq [IntPtr]::Zero) { throw 'Per-monitor DPI awareness is unavailable; Windows 10 version 1703 or newer is required.' }
  $bounds=[Windows.Forms.Screen]::PrimaryScreen.Bounds
  $virtual=[Windows.Forms.SystemInformation]::VirtualScreen
  $events=[Collections.Generic.List[YardDesktop+Input]]::new()
  function Point($x,$y) {
    if ($x -lt 0 -or $y -lt 0 -or $x -ge $bounds.Width -or $y -ge $bounds.Height) { throw 'Coordinates are outside the primary monitor; no input was sent.' }
    $nx=[int][Math]::Round(($x+$bounds.X-$virtual.X)*65535/[Math]::Max(1,$virtual.Width-1))
    $ny=[int][Math]::Round(($y+$bounds.Y-$virtual.Y)*65535/[Math]::Max(1,$virtual.Height-1))
    $events.Add([YardDesktop]::Pointer($nx,$ny,0xE001,0))
  }
  $down=2; $up=4
  if ($a.button -eq 'right') { $down=8; $up=16 }; if ($a.button -eq 'middle') { $down=32; $up=64 }
  switch ($a.type) {
    'move' { Point $a.x $a.y }
    'click' { Point $a.x $a.y; $count=1; if ($a.clicks) { $count=$a.clicks }; for ($i=0;$i -lt $count;$i++) { $events.Add([YardDesktop]::Pointer(0,0,$down,0)); $events.Add([YardDesktop]::Pointer(0,0,$up,0)) } }
    'drag' {
      Point $a.fromX $a.fromY; $events.Add([YardDesktop]::Pointer(0,0,$down,0))
      for ($i=1;$i -le 20;$i++) { Point ([int][Math]::Round($a.fromX+($a.toX-$a.fromX)*$i/20)) ([int][Math]::Round($a.fromY+($a.toY-$a.fromY)*$i/20)) }
      $events.Add([YardDesktop]::Pointer(0,0,$up,0))
    }
    'type' { foreach ($c in $a.text.ToCharArray()) { $events.Add([YardDesktop]::Keyboard(0,[uint16][char]$c,4)); $events.Add([YardDesktop]::Keyboard(0,[uint16][char]$c,6)) } }
    'keypress' {
      foreach ($k in $a.keyCodes) { $extended=0; if ($k -in @(33,34,35,36,37,38,39,40,45,46,91)) { $extended=1 }; $events.Add([YardDesktop]::Keyboard($k,0,$extended)) }
      for ($i=$a.keyCodes.Count-1;$i -ge 0;$i--) { $k=$a.keyCodes[$i]; $extended=0; if ($k -in @(33,34,35,36,37,38,39,40,45,46,91)) { $extended=1 }; $events.Add([YardDesktop]::Keyboard($k,0,(2+$extended))) }
    }
    'scroll' { $flags=0x0800; $delta=120*$a.clicks; if ($a.direction -in @('left','right')) { $flags=0x1000 }; if ($a.direction -in @('down','left')) { $delta=-$delta }; $events.Add([YardDesktop]::Pointer(0,0,$flags,$delta)) }
    'wait' { $remaining=$a.milliseconds; while ($remaining -gt 0) { Check-Cancel; $step=[Math]::Min($remaining,50); Start-Sleep -Milliseconds $step; $remaining-=$step } }
    'screenshot' {}
    default { throw 'Unsupported desktop action.' }
  }
  Check-Cancel
  if ($events.Count) { [YardDesktop]::Send($events.ToArray()); Start-Sleep -Milliseconds 80 }
  Check-Cancel
  $bitmap=[Drawing.Bitmap]::new($bounds.Width,$bounds.Height)
  try {
    $graphics=[Drawing.Graphics]::FromImage($bitmap)
    try {
      $target=$graphics.GetHdc();$source=[YardDesktop]::GetDC([IntPtr]::Zero)
      try { if ($source -eq [IntPtr]::Zero -or ![YardDesktop]::BitBlt($target,0,0,$bounds.Width,$bounds.Height,$source,$bounds.X,$bounds.Y,0x40CC0020)) { throw 'Windows screen capture failed.' } }
      finally { if ($source -ne [IntPtr]::Zero) { [void][YardDesktop]::ReleaseDC([IntPtr]::Zero,$source) }; $graphics.ReleaseHdc($target) }
    } finally { $graphics.Dispose() }
    $memory=[IO.MemoryStream]::new()
    try { $bitmap.Save($memory,[Drawing.Imaging.ImageFormat]::Png); @{display='windows:primary';width=$bounds.Width;height=$bounds.Height;image=[Convert]::ToBase64String($memory.ToArray())} | ConvertTo-Json -Compress } finally { $memory.Dispose() }
  } finally { $bitmap.Dispose() }
} finally { if ($locked) { $mutex.ReleaseMutex() }; $mutex.Dispose() }
} catch { [Console]::Error.WriteLine($_.Exception.ToString()); exit 1 }
`;
}

export type WindowsRunner = (script: string, signal?: AbortSignal) => Promise<string>;
export const runWindows: WindowsRunner = (script, signal) => new Promise((resolve, reject) => {
  signal?.throwIfAborted();
  const bootstrap = '& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadLine()))))';
  const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(bootstrap, 'utf16le').toString('base64')],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stdout = '', stderr = '', failure: Error | undefined;
  let stopping = false, forced: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    failure ??= new Error('Windows desktop operation cancelled; input may already have changed.');
    if (!stopping) { stopping = true; child.stdin.end('cancel\n'); forced = setTimeout(() => child.kill(), 5000).unref(); }
  };
  const timer = setTimeout(() => { failure = new Error('Windows desktop operation timed out; input may already have changed.'); stop(); }, 30000);
  signal?.addEventListener('abort', stop, { once: true });
  child.stdin.on('error', () => {});
  child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 24 * 1024 * 1024) { failure = new Error('Desktop image exceeded output limit.'); child.kill(); } });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
  child.once('error', error => { failure = error; });
  child.once('close', code => {
    clearTimeout(timer); clearTimeout(forced); signal?.removeEventListener('abort', stop);
    if (failure || code !== 0) reject(failure ?? new Error('Windows desktop helper failed: ' + stderr));
    else resolve(stdout.trim());
  });
  child.stdin.write(Buffer.from(script).toString('base64') + '\n');
});

export class WindowsDesktop {
  readonly platform = 'windows';
  private pending: Promise<unknown> = Promise.resolve();
  private readonly run: WindowsRunner;
  constructor(options: { run?: WindowsRunner } = {}) { this.run = options.run ?? runWindows; }
  execute(value: unknown, signal?: AbortSignal): Promise<DesktopContent[]> {
    const next = this.pending.then(async () => {
      signal?.throwIfAborted();
      const action = desktopAction(value);
      if (process.platform !== 'win32' && this.run === runWindows) throw new Error('Windows Computer requires standalone Windows Node in the signed-in desktop session. Configure YARD_COMPUTER_WINDOWS_NODE and YARD_COMPUTER_WINDOWS_SERVER; Linux/WSLg is a different desktop.');
      try {
        const result = JSON.parse(await this.run(windowsScript(action), signal));
        if (result.display !== 'windows:primary' || !Number.isInteger(result.width) || result.width < 1 || !Number.isInteger(result.height) || result.height < 1 || typeof result.image !== 'string') throw new Error('Invalid Windows screenshot metadata.');
        const bytes = Buffer.from(result.image, 'base64');
        if (!bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) || bytes.length < 24 || bytes.readUInt32BE(16) !== result.width || bytes.readUInt32BE(20) !== result.height) throw new Error('Invalid Windows screenshot PNG.');
        return [{ type: 'text', text: JSON.stringify({ display: result.display, width: result.width, height: result.height, coordinates: 'physical primary-monitor pixels; origin at top left' }) },
          { type: 'image', mimeType: 'image/png', data: result.image }] satisfies DesktopContent[];
      } catch (cause) { throw new Error('Windows desktop action failed and was not retried. Input may already have changed; observe a new screenshot before repeating. ' + String(cause), { cause }); }
    });
    this.pending = next.catch(() => {});
    return next;
  }
}
