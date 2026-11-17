import { join } from 'node:path';
import { projectRoot } from './app-resources.ts';

/** Per-thread configuration belongs to the Yard execution host. Passing the
 * selected display explicitly also works with an already-running Codex daemon. */
export function computerConfig(env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  const display = env.YARD_COMPUTER_DISPLAY;
  if (!display) return {};
  if (!/^:[0-9]+(?:\.0)?$/.test(display)) throw new Error('YARD_COMPUTER_DISPLAY 必须指定本机 X11 桌面的 screen 0，例如 :0 或 :99.0。');
  const directory = join(projectRoot, 'plugins/yard-computer');
  return Object.fromEntries(Object.entries({
    command: process.execPath, args: [join(directory, 'server.ts')], cwd: directory,
    ...Object.fromEntries(['YARD_COMPUTER_DISPLAY', 'YARD_COMPUTER_XAUTHORITY', 'YARD_COMPUTER_IMPORT', 'YARD_COMPUTER_XDOTOOL', 'YARD_COMPUTER_XCLIP']
      .flatMap(key => env[key] ? [['env.' + key, env[key]]] : [])),
    startup_timeout_sec: 10, tool_timeout_sec: 60,
  }).map(([key, value]) => ['mcp_servers.yard_computer.' + key, value]));
}
