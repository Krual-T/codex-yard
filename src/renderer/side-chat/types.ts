import type { ThreadSummary } from '../../../lib/codex-protocol.ts';
import type { SubmitOptions } from '../workbench-contract.ts';

export type SideChatRequestStatus = 'waiting' | 'inflight' | 'not-sent' | 'rejected' | 'unknown' | 'received' | 'invalid';
export type SideChatCloseStatus = 'idle' | 'preparing' | 'prepare-failed' | 'inflight' | 'not-sent' | 'rejected' | 'unknown'
  | 'cleanup-pending' | 'cleaning' | 'closed';
export type SideChatHostAction = 'start' | 'retry' | 'close' | 'retryPersistence';

/** Authorized and sanitized projection of one native SideChatOperation. */
export interface SideChatHostView {
  operationId: string;
  parent: {
    hostId: string;
    threadId: string;
    cwd: string;
  };
  childId: string | null;
  child: { thread: ThreadSummary; options: SubmitOptions } | null;
  fork: { status: SideChatRequestStatus; error: string | null };
  inject: { status: SideChatRequestStatus; error: string | null };
  close: { requested: boolean; status: SideChatCloseStatus; error: string | null };
  /** Sanitized host recovery callback error for this operation, if any. */
  recoveryError: string | null;
  /** On read only: the parent's scoped endpoint fence proves all prior calls of this action terminated. */
  settledCalls?: Partial<Record<SideChatHostAction, boolean>>;
}

export interface SideChatHostPort {
  prepare(hostId: string, parentThreadId: string): Promise<SideChatHostView>;
  /** An endpoint rejection may carry uncertain: false only when this exact call was not dispatched. */
  start(operationId: string): Promise<SideChatHostView>;
  read(operationId: string): Promise<SideChatHostView>;
  retry(operationId: string): Promise<SideChatHostView>;
  close(operationId: string): Promise<SideChatHostView>;
  retryPersistence(operationId: string): Promise<SideChatHostView>;
  subscribe(listener: (hint: { hostId: string; operationId: string }) => void): () => void;
}

export interface SideChatScope { hostId: string; parentThreadId: string; operationId: string; draftId: string }
export interface SideChatControllerOptions {
  hostId: string;
  parentThreadId: string;
  draftId: string;
  port: SideChatHostPort;
  /** Resolve only after the operation and draft association is durable. */
  onPrepared(scope: SideChatScope): Promise<void>;
  /** Advisory check; endpoints must atomically enforce the original operation and connection scope. */
  canDispatch(scope: SideChatScope, action: 'advance' | 'close' | 'persistence'): boolean;
  /** A restored operation must already have its durable draft association. */
  restored?: SideChatHostView;
}

export type SideChatPhase = 'idle' | 'preparing' | 'link-failed' | 'starting' | 'waiting' | 'forking'
  | 'fork-failed' | 'fork-unknown' | 'injecting' | 'inject-failed' | 'inject-unknown' | 'ready'
  | 'closing' | 'close-failed' | 'close-unknown' | 'closed';
export interface SideChatSnapshot {
  hostId: string;
  parentThreadId: string;
  draftId: string;
  view: SideChatHostView | null;
  phase: SideChatPhase;
  error: string | null;
  pendingClose: boolean;
  hasActivity: boolean;
}

/** The shared conversation service owns subscription, history and recovery. */
export interface SideChatHistory {
  hostId: string;
  threadId: string;
  thread: ThreadSummary | null;
  /** The child session's current authoritative options. */
  options: SubmitOptions;
  loading: boolean;
  historyComplete: boolean;
  streamGap: boolean;
  error: string | null;
  canSubmit: boolean;
  /** The original connection generation and current turn are still authorized to interrupt. */
  canInterrupt: boolean;
  retry(): void | Promise<void>;
}
