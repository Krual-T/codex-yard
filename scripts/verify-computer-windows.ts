// Run in an idle, signed-in Windows desktop. Uses only a disposable test window.
// No App, personal Codex home, clipboard contents or existing app are modified.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { WindowsDesktop, runWindows } from '../plugins/yard-computer/windows.ts';

if (process.platform !== 'win32') throw new Error('Run with standalone Windows Node >=24.5 in the signed-in desktop session.');
const root = process.env.YARD_WINDOWS_EVIDENCE ? resolve(process.env.YARD_WINDOWS_EVIDENCE) : await mkdtemp(join(tmpdir(), 'yard-computer-check-'));
await mkdir(root, { recursive: true });
await Promise.all(['stop', 'state.json', 'report.json'].map(name => rm(join(root, name), { force: true })));
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const fixture = `$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class YardFixture {
  [StructLayout(LayoutKind.Sequential)] public struct LastInput { public uint size,time; }
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LastInput input);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
}
'@
$root=${literal(root)}
function Save-State($state) { [IO.File]::WriteAllText((Join-Path $root 'state.json'),($state|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false)) }
if (![Environment]::UserInteractive -or [Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0) { Save-State @{error='Need interactive desktop, not Session 0'}; exit 1 }
$last=[YardFixture+LastInput]::new();$last.size=[Runtime.InteropServices.Marshal]::SizeOf($last)
if (![YardFixture]::GetLastInputInfo([ref]$last)) { throw 'Cannot check desktop idle time' }
$idle=([uint32]([Environment]::TickCount -band 0xffffffff)-[long]$last.time)/1000
if ($idle -lt 60) { Save-State @{error='Desktop is active; wait for 60 seconds idle before this test';idleSeconds=$idle}; exit 2 }
[void][YardFixture]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
$before=[YardFixture]::GetClipboardSequenceNumber()
$form=[Windows.Forms.Form]::new();$form.Text='Yard independent Computer test';$form.Size=[Drawing.Size]::new(620,400);$form.StartPosition='CenterScreen';$form.TopMost=$true
$text=[Windows.Forms.TextBox]::new();$text.Location=[Drawing.Point]::new(30,35);$text.Size=[Drawing.Size]::new(520,65);$text.Multiline=$true
$button=[Windows.Forms.Button]::new();$button.Location=[Drawing.Point]::new(30,115);$button.Size=[Drawing.Size]::new(180,35);$button.Text='Disposable test button'
$panel=[Windows.Forms.Panel]::new();$panel.Location=[Drawing.Point]::new(30,185);$panel.Size=[Drawing.Size]::new(520,100);$panel.BackColor=[Drawing.Color]::SteelBlue
$form.Controls.AddRange(@($text,$button,$panel))
$script:clicks=0;$script:drags=0;$script:wheel=0;$script:shortcuts=0;$script:dragStart=$null
$button.add_Click({$script:clicks++})
$text.add_KeyDown({param($sender,$e) if ($e.Control -and $e.KeyCode -eq [Windows.Forms.Keys]::A) {$script:shortcuts++;$text.SelectAll();$e.SuppressKeyPress=$true}})
$text.add_MouseWheel({param($sender,$e) $script:wheel+=$e.Delta})
$panel.add_MouseDown({param($sender,$e) $script:dragStart=$e.Location;$panel.Capture=$true})
$panel.add_MouseUp({param($sender,$e) if ($script:dragStart -and [Math]::Abs($e.X-$script:dragStart.X) -gt 20) {$script:drags++};$panel.Capture=$false;$script:dragStart=$null})
function Position($control,$x,$y) { $point=$control.PointToScreen([Drawing.Point]::new($x,$y)); @{x=$point.X;y=$point.Y} }
$timer=[Windows.Forms.Timer]::new();$timer.Interval=50
$expires=[DateTime]::UtcNow.AddSeconds(120)
$timer.add_Tick({
  Save-State @{text=$text.Text;clicks=$script:clicks;drags=$script:drags;wheel=$script:wheel;shortcuts=$script:shortcuts;foreground=([YardFixture]::GetForegroundWindow() -eq $form.Handle);windowHandle=$form.Handle.ToInt64();visible=$form.Visible;nativeVisible=[YardFixture]::IsWindowVisible($form.Handle);textPoint=(Position $text 30 20);buttonPoint=(Position $button 50 15);dragFrom=(Position $panel 30 30);dragTo=(Position $panel 180 60);clipboardUnchanged=([YardFixture]::GetClipboardSequenceNumber() -eq $before);sessionId=[Diagnostics.Process]::GetCurrentProcess().SessionId}
  if ((Test-Path (Join-Path $root 'stop')) -or [DateTime]::UtcNow -gt $expires) {$form.Close()}
})
$form.add_Shown({$form.Activate();$text.Focus();$timer.Start()})
try { [void]$form.ShowDialog() } finally {$timer.Stop();$timer.Dispose();$form.Dispose()}
`;
const bootstrap = '& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadLine()))))';
const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-STA', '-EncodedCommand', Buffer.from(bootstrap, 'utf16le').toString('base64')], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: false });
let fixtureError = '';
child.stderr.on('data', value => { fixtureError = (fixtureError + String(value)).slice(-4000); });
child.stdin.end(Buffer.from(fixture).toString('base64') + '\n');
async function state(check: (value: any) => boolean = () => true): Promise<any> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    let value;
    try { value = JSON.parse(await readFile(join(root, 'state.json'), 'utf8')); } catch {}
    if (value?.error) throw new Error(value.error);
    if (value && check(value)) return value;
    if (child.exitCode !== null) throw new Error(fixtureError || 'Fixture exited before completing');
    await delay(50);
  }
  throw new Error('Fixture state timed out: ' + fixtureError);
}
let windowHandle = 0;
const desktop = new WindowsDesktop({ run(script, signal) {
  assert.ok(Number.isSafeInteger(windowHandle) && windowHandle > 0);
  const guarded = script.replace('public static class YardDesktop {', `public static class YardDesktop {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [StructLayout(LayoutKind.Sequential)] public struct FixturePoint { public int x,y; public FixturePoint(int x,int y) {this.x=x;this.y=y;} }
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(FixturePoint point);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr handle, uint flags);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out FixturePoint point);
  public static void CheckFixture(int x, int y) { if(GetAncestor(WindowFromPoint(new FixturePoint(x,y)),2).ToInt64()!=${windowHandle}) throw new Exception("Pointer target is outside the disposable fixture; no input sent."); }
  public static void CheckScrollFixture() { FixturePoint point; if(!GetCursorPos(out point)) throw new Exception("Cannot check the fixture pointer; no input sent."); CheckFixture(point.x,point.y); }
`).replace('public static void Send(Input[] values) {', `public static void Send(Input[] values) {
    if(GetForegroundWindow().ToInt64()!=${windowHandle}) throw new Exception("Disposable fixture lost focus before SendInput; no input sent.");
`).replace('if ($events.Count) { [YardDesktop]::Send', `if ($a.type -in @('click','move')) { [YardDesktop]::CheckFixture($a.x,$a.y) }
  if ($a.type -eq 'drag') { [YardDesktop]::CheckFixture($a.fromX,$a.fromY); [YardDesktop]::CheckFixture($a.toX,$a.toY) }
  if ($a.type -eq 'scroll') { [YardDesktop]::CheckScrollFixture() }
  if ($events.Count) { [YardDesktop]::Send`).replace('switch ($a.type) {', `if ($a.type -eq 'wait') { [IO.File]::WriteAllText(${literal(join(root, 'waiting'))}, 'entered') }
  switch ($a.type) {`);
  assert.notEqual(guarded, script);
  return runWindows(guarded, signal);
} });
const checks: string[] = [];
const report: Record<string, unknown> = { ok: false, root, checks, node: process.version };
try {
  let current = await state(value => value.foreground);
  windowHandle = current.windowHandle;
  report.sessionId = current.sessionId;
  async function act(action: object, imageName?: string) {
    current = await state();
    assert.equal(current.foreground, true, 'Test window lost focus; stop before sending input');
    const content = await desktop.execute(action);
    if (imageName) {
      const image = content.find(value => value.type === 'image');
      assert.ok(image?.type === 'image');
      await writeFile(join(root, imageName), Buffer.from(image.data, 'base64'));
    }
    return content;
  }
  const screenshot = await act({ type: 'screenshot' }, 'before.png');
  report.screen = screenshot[0];
  checks.push('Actual primary-monitor PNG with physical-pixel metadata');
  await act({ type: 'click', ...current.textPoint });
  await act({ type: 'type', text: 'Yard 独立运行 42' });
  await state(value => value.text === 'Yard 独立运行 42');
  await act({ type: 'keypress', keys: ['Ctrl', 'a'] });
  await state(value => value.shortcuts === 1);
  await act({ type: 'type', text: '替换成功 73' });
  await state(value => value.text === '替换成功 73');
  checks.push('Unicode SendInput and Ctrl+A replacement in a disposable textbox');
  await act({ type: 'scroll', direction: 'down', clicks: 2 });
  await state(value => value.wheel === -240);
  checks.push('Wheel delta received by the disposable control');
  await act({ type: 'click', ...current.buttonPoint });
  await state(value => value.clicks === 1);
  await act({ type: 'drag', fromX: current.dragFrom.x, fromY: current.dragFrom.y, toX: current.dragTo.x, toY: current.dragTo.y });
  await state(value => value.drags === 1);
  checks.push('Click and drag received only by the disposable test window');
  const abort = new AbortController();
  await rm(join(root, 'waiting'), { force: true });
  const waiting = desktop.execute({ type: 'wait', milliseconds: 2000 }, abort.signal);
  // Abort after the helper has acquired the OS mutex and entered its wait.
  const rejected = assert.rejects(waiting, /cancel/i);
  const deadline = Date.now() + 15000;
  for (;;) {
    try { await readFile(join(root, 'waiting')); break; }
    catch { assert.ok(Date.now() < deadline, 'Wait helper did not enter its locked section'); await delay(20); }
  }
  abort.abort(); await rejected;
  await act({ type: 'screenshot' }, 'after.png');
  checks.push('Cancellation completes and the next screenshot reacquires the named mutex');
  assert.equal((await state()).clipboardUnchanged, true);
  checks.push('Windows clipboard sequence remains unchanged');
  report.ok = true;
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
} finally {
  await writeFile(join(root, 'stop'), 'stop');
  if (child.exitCode === null) await Promise.race([once(child, 'exit'), delay(5000)]);
  if (child.exitCode === null) child.kill();
  await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
