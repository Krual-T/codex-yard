// Prepare the original Windows helper and a user logon host. No App files are
// consulted; all runtime assets come from this checkout and explicit standalone
// Node/Codex executables. Default invocation previews its installation plan.
import { execFileSync, spawn } from 'node:child_process';
import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { windowsNode, windowsPath } from '../lib/windows-paths.ts';

function option(name: string): string | undefined { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
function quote(value: string): string { return "'" + value.replaceAll("'", "''") + "'"; }
function powershell(script: string): string {
  const source = "$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);" + script;
  return execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true }).trim();
}

async function install(): Promise<void> {
  if (process.platform !== 'win32') {
    const args = process.argv.slice(2);
    for (let index = 0; index < args.length; index++) if (['--codex', '--auth-source', '--codex-home', '--destination'].includes(args[index]) && args[index + 1]) args[++index] = windowsPath(args[index]);
    const child = spawn(windowsNode(), [windowsPath(fileURLToPath(import.meta.url)), ...args], { stdio: 'inherit', windowsHide: true });
    process.exitCode = await new Promise<number>((resolve, reject) => child.once('error', reject).once('close', code => resolve(code ?? 1)));
    return;
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const destination = resolve(option('--destination') || join(process.env.LOCALAPPDATA || join(process.env.USERPROFILE!, 'AppData/Local'), 'CodexYard/Standalone/computer-use'));
  const codex = option('--codex');
  if (!codex || !(await stat(codex)).isFile()) throw new Error('--codex must select an installed standalone Windows Codex executable (.exe).');
  const authSource = option('--auth-source') || join(process.env.USERPROFILE!, '.codex/auth.json');
  const codexHome = resolve(option('--codex-home') || join(destination, 'codex-home'));
  const taskName = option('--task-name') || 'Codex Yard Computer Use';
  const pipe = option('--pipe') || '\\\\.\\pipe\\codex-yard-computer-use';
  if (!pipe.startsWith('\\\\.\\pipe\\codex-yard-')) throw new Error('--pipe must name a codex-yard Windows pipe.');
  const runtime = join(destination, 'runtime-app-26.1117.3838.0');
  const configPath = join(destination, 'host.json');
  const config = { pipe, helper: join(runtime, 'lib/node_modules/@oai/sky/bin/windows/codex-computer-use.exe'), codex, codexHome };
  const host = join(destination, 'lib/sky-windows-host.ts');
  const taskInfo = powershell(`$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$t=Get-ScheduledTask -TaskName ${quote(taskName)} -ErrorAction SilentlyContinue;if($t){@{state=[string]$t.State;xml=(Export-ScheduledTask -TaskName ${quote(taskName)})}|ConvertTo-Json -Compress}else{'null'}`);
  const previousTask = JSON.parse(taskInfo) as { state: string; xml: string } | null;
  const apply = process.argv.includes('--apply');
  if (!apply) { console.log(JSON.stringify({ apply: false, destination, config, node: process.execPath, authSource, taskName, previousTaskState: previousTask?.state ?? null,
    account: 'current Windows user, interactive logon only, limited privileges', rollback: 'Restore the saved scheduled-task XML, or unregister this task and remove this installation directory.' }, null, 2)); return; }
  if (previousTask?.state === 'Running') throw new Error('The Windows Computer Use host is running. Finish its active desktop operations and stop its scheduled task before replacing this installation.');
  const auth = await readFile(authSource);
  const backup = join(destination, 'backups', new Date().toISOString().replaceAll(':', '-'));
  await mkdir(backup, { recursive: true });
  if (previousTask) await writeFile(join(backup, 'scheduled-task.xml'), previousTask.xml);
  // Snapshot every overwritten runtime path. The recovery script also removes
  // paths newly introduced by this installation before restoring old contents.
  const restore: { path: string; backup: string; existed: boolean }[] = [];
  for (const [path, name] of [[configPath, 'host.json'], [join(destination, 'lib'), 'lib'],
    [join(destination, 'package.json'), 'package.json'], [runtime, 'runtime'], [join(codexHome, 'auth.json'), 'auth.json']]) {
    const item = { path, backup: join(backup, name), existed: false };
    try { await cp(path, item.backup, { recursive: true, verbatimSymlinks: true }); item.existed = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    restore.push(item);
  }
  const rollbackPath = join(backup, 'restore.ps1');
  const rollback = `$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';\n` +
    `Stop-ScheduledTask -TaskName ${quote(taskName)} -ErrorAction SilentlyContinue;\n` +
    `Unregister-ScheduledTask -TaskName ${quote(taskName)} -Confirm:$false -ErrorAction SilentlyContinue;\n` +
    restore.map(item => `if(Test-Path -LiteralPath ${quote(item.path)}){Remove-Item -LiteralPath ${quote(item.path)} -Recurse -Force};\n` +
      (item.existed ? `Copy-Item -LiteralPath ${quote(item.backup)} -Destination ${quote(item.path)} -Recurse -Force;\n` : '')).join('') +
    (previousTask ? `Register-ScheduledTask -TaskName ${quote(taskName)} -Xml (Get-Content -LiteralPath ${quote(join(backup, 'scheduled-task.xml'))} -Raw -Encoding UTF8) -Force | Out-Null;\n` : '') +
    `Write-Output 'Previous Windows Computer Use files and task definition restored. The restored task is stopped.';\n`;
  await writeFile(rollbackPath, rollback);
  await writeFile(join(backup, 'restore.json'), JSON.stringify({ taskName, previousTaskState: previousTask?.state ?? null, paths: restore }, null, 2) + '\n');
  await mkdir(join(destination, 'lib'), { recursive: true });
  for (const name of ['sky-windows-host.ts', 'sky-windows-helper.ts', 'windows-paths.ts']) await cp(join(root, 'lib', name), join(destination, 'lib', name));
  await writeFile(join(destination, 'package.json'), '{"type":"module"}\n');
  await cp(join(root, 'vendor/node-repl/app-26.1117.3838.0/win32-x64'), runtime, { recursive: true, verbatimSymlinks: true });
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  await writeFile(join(codexHome, 'auth.json'), auth, { mode: 0o600 });
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  const args = `"${host}" --config "${configPath}"`;
  powershell(`$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$user=[Security.Principal.WindowsIdentity]::GetCurrent().Name;
$action=New-ScheduledTaskAction -Execute ${quote(process.execPath)} -Argument ${quote(args)} -WorkingDirectory ${quote(destination)};
$principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited;
$trigger=New-ScheduledTaskTrigger -AtLogOn -User $user;
$settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries;
Register-ScheduledTask -TaskName ${quote(taskName)} -Action $action -Principal $principal -Trigger $trigger -Settings $settings -Force | Out-Null;
Start-ScheduledTask -TaskName ${quote(taskName)};`);
  console.log(JSON.stringify({ apply: true, destination, configPath, pipe, taskName, backup, node: process.execPath, rollback: `powershell.exe -NoProfile -File "${rollbackPath}"`,
    next: 'Set YARD_COMPUTER_TARGET=windows, YARD_WINDOWS_NODE and YARD_WINDOWS_SKY_PIPE in the Yard service environment. The Windows user must remain signed in with an unlocked desktop.' }, null, 2));
}
await install().catch(error => { console.error((error as Error).message); process.exitCode = 1; });
