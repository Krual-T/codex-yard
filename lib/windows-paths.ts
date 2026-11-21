import { execFileSync } from 'node:child_process';
import { isAbsolute } from 'node:path';

/** Windows arguments need Windows paths even when WSL launches the process. */
export function windowsPath(value: string): string {
  if (/^(?:[A-Za-z]:[\\/]|\\\\)/.test(value)) return value;
  if (process.platform === 'win32' || !isAbsolute(value)) throw new Error('A Windows or absolute WSL path is required: ' + value);
  return execFileSync('wslpath', ['-w', value], { encoding: 'utf8' }).trim();
}

export function windowsNode(env: NodeJS.ProcessEnv = process.env): string {
  if (process.platform === 'win32') return env.YARD_WINDOWS_NODE || process.execPath;
  const executable = env.YARD_WINDOWS_NODE || env.YARD_COMPUTER_WINDOWS_NODE;
  if (!executable) throw new Error('WSL Windows integrations require YARD_WINDOWS_NODE to select a standalone Windows Node.js executable.');
  return /^[A-Za-z]:[\\/]/.test(executable)
    ? execFileSync('wslpath', ['-u', executable], { encoding: 'utf8' }).trim() : executable;
}
