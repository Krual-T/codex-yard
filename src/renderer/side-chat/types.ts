import type { ThreadSummary } from '../../../lib/codex-protocol.ts';
import type { SubmitOptions } from '../workbench-contract.ts';

export type SideChatRequestStatus = 'waiting' | 'inflight' | 'not-sent' | 'rejected' | 'unknown' | 'received' | 'invalid';
export type SideChatCloseStatus = 'idle' | 'preparing' | 'prepare-failed' | 'inflight' | 'not-sent' | 'rejected' | 'unknown'
  | 'cleanup-pending' | 'cleaning' | 'closed';

/** Authorized and sanitized projection of one native SideChatOperation. */
export interface SideChatHostView {
  operationId: string;
  parent: {
    hostId: string;
    threadId: string;
    cwd: string;
    workspaceRoots: string[];
    project: unknown;
    archived: boolean;
    options: SubmitOptions;
  };
  childId: string | null;
  child: { thread: ThreadSummary; options: SubmitOptions } | null;
  fork: { status: SideChatRequestStatus; error: string | null };
  inject: { status: SideChatRequestStatus; error: string | null };
  close: { requested: boolean; status: SideChatCloseStatus; error: string | null };
  instructionSource: 'thread-override' | 'host-config';
}

export interface SideChatHostPort {
  prepare(hostId: string, parentThreadId: string): Promise<SideChatHostView>;
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
  /** Consult the owner's durable dispatch state; host endpoints must enforce it too. */
  canDispatch(scope: SideChatScope, action: 'advance' | 'close'): boolean;
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
  expired: boolean;
  canSubmit: boolean;
  retry(): void | Promise<void>;
}
