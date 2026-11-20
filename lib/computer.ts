import { join } from 'node:path';
import { projectRoot } from './app-resources.ts';

/** Per-thread configuration belongs to the Yard execution host. Passing the
 * selected display explicitly also works with an already-running Codex daemon. */
export function computerConfig(env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  const driver = env.YARD_COMPUTER_DRIVER;
  if (driver && !['x11', 'windows'].includes(driver)) throw new Error('YARD_COMPUTER_DRIVER must be x11 or windows.');
  const display = env.YARD_COMPUTER_DISPLAY;
  if (!display && driver !== 'windows') return {};
  if (driver !== 'windows' && !/^:[0-9]+(?:\.0)?$/.test(display!)) throw new Error('YARD_COMPUTER_DISPLAY 必须指定本机 X11 桌面的 screen 0，例如 :0 或 :99.0。');
  const directory = join(projectRoot, 'plugins/yard-computer');
  if (driver === 'windows' && process.platform !== 'win32' && (!env.YARD_COMPUTER_WINDOWS_NODE || !env.YARD_COMPUTER_WINDOWS_SERVER)) {
    throw new Error('Select standalone Windows Node and the Windows-visible plugin server.ts with YARD_COMPUTER_WINDOWS_NODE and YARD_COMPUTER_WINDOWS_SERVER.');
  }
  return Object.fromEntries(Object.entries({
    command: driver === 'windows' ? env.YARD_COMPUTER_WINDOWS_NODE || process.execPath : process.execPath,
    args: driver === 'windows' ? [env.YARD_COMPUTER_WINDOWS_SERVER || join(directory, 'server.ts'), '--driver=windows'] : [join(directory, 'server.ts')], cwd: directory,
    ...(driver ? { 'env.YARD_COMPUTER_DRIVER': driver } : {}),
    ...Object.fromEntries(['YARD_COMPUTER_DISPLAY', 'YARD_COMPUTER_XAUTHORITY', 'YARD_COMPUTER_IMPORT', 'YARD_COMPUTER_XDOTOOL', 'YARD_COMPUTER_XCLIP']
      .flatMap(key => env[key] ? [['env.' + key, env[key]]] : [])),
    startup_timeout_sec: 10, tool_timeout_sec: 60,
  }).map(([key, value]) => ['mcp_servers.yard_computer.' + key, value]));
}
