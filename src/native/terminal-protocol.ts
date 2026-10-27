/** App 26.1013.40934's AppHost.services.terminal contract. */
export interface TerminalCreate {
  sessionId: string;
  hostId?: string | null;
  cwd?: string | null;
  conversationId?: string;
  environmentId?: string | null;
  cols?: number;
  rows?: number;
}
export interface TerminalSnapshot { cwd: string; shell: string; buffer: string; truncated: boolean }
export type TerminalEvent =
  | { type: 'attached'; sessionId: string; cwd: string; shell: string }
  | { type: 'data'; sessionId: string; data: string }
  | { type: 'init-log'; sessionId: string; log: string }
  | { type: 'exit'; sessionId: string; code: number | null; signal: string | null; error?: string }
  | { type: 'error'; sessionId: string; message: string }
  | { type: 'input-status'; sessionId: string; error: string | null };
export type TerminalOperation = 'create' | 'attach' | 'attachExisting' | 'close' | 'write' | 'resize' | 'getShellCwd' | 'getThreadSnapshot';

/** Narrow host boundary; the page's existing CodexConnection implements it. */
export interface TerminalConnection {
  connected: boolean;
  request(method: string, params: Record<string, unknown>, options?: { mutating?: boolean; timeoutMs?: number }): Promise<unknown>;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(event: 'status', listener: () => void): unknown;
  off(event: 'message', listener: (message: unknown) => void): unknown;
  off(event: 'status', listener: () => void): unknown;
}

// Fields verified against the running daemon's experimental generated v2
// ProcessSpawnParams. Other calls below use ProcessWriteStdinParams,
// ProcessResizePtyParams and ProcessKillParams, keyed by this same handle.
export interface ProcessSpawnParams extends Record<string, unknown> {
  command: string[];
  processHandle: string;
  cwd: string;
  tty: boolean;
  timeoutMs: number | null;
  outputBytesCap: number | null;
  env: Record<string, string>;
  size: { rows: number; cols: number };
}
