import type { ThreadSummary } from '../../../lib/codex-protocol.ts';
import type { SubmitOptions } from '../workbench-contract.ts';

export interface SideChatParent {
  hostId: string;
  threadId: string;
  cwd: string;
  archived: boolean;
  workspaceRoots: string[];
  projectId: string | null;
  options: SubmitOptions;
  /** An actual parent-scoped instruction snapshot, including an explicitly empty one. */
  developerInstructions: { text: string; source: string } | null;
  /** Effective fork configuration obtained for this parent, not the selected page. */
  forkConfig: Record<string, unknown>;
  capabilities: {
    ephemeralFork: boolean;
    boundaryInjection: boolean;
    /** The inherited goal cannot auto-continue for the entire side-chat lifetime, including after a user turn. */
    preventGoalContinuation: boolean;
    discard: 'unsubscribe' | 'stop' | null;
  };
}

export type SideChatOperationKind = 'fork' | 'boundary' | 'discard';
export interface SideChatOperation {
  id: string;
  kind: SideChatOperationKind;
  hostId: string;
  parentThreadId: string;
  childThreadId: string | null;
  method: 'thread/fork' | 'thread/inject_items' | 'thread/unsubscribe' | 'thread/stop';
  params: Record<string, unknown>;
}
export type SideChatOperationResult =
  | { outcome: 'success'; result: unknown }
  | { outcome: 'not-applied'; message: string }
  | { outcome: 'unknown'; message: string };

/** Manager persists each operation before dispatch, and can return its original late receipt. */
export interface SideChatOperations {
  execute(operation: SideChatOperation): Promise<SideChatOperationResult>;
  reconcile?(operation: SideChatOperation): Promise<SideChatOperationResult>;
  /** Evict only this child's caches and any ephemeral voice history. */
  cleanup(scope: { hostId: string; parentThreadId: string; childThreadId: string }): Promise<void>;
  /** Stop this child's voice and coordinate in-flight or unknown sends before closing. */
  prepareClose(scope: { hostId: string; parentThreadId: string; childThreadId: string }): Promise<void>;
  /** The original close path attempts to stop a running turn before unsubscribing. */
  interrupt(scope: { hostId: string; threadId: string; turnId: string }): Promise<void>;
}

export type SideChatPhase = 'idle' | 'creating' | 'create-failed' | 'create-unknown' | 'forked'
  | 'boundary' | 'boundary-failed' | 'boundary-unknown' | 'ready'
  | 'preparing-close' | 'close-failed' | 'interrupting' | 'discarding' | 'discard-failed' | 'discard-unknown' | 'cleaning' | 'cleanup-failed' | 'closed';
export interface DurableSideChatReceipt {
  hostId: string;
  parentThreadId: string;
  thread: ThreadSummary;
  childOptions: SubmitOptions;
  /** The durable provider has completed its own side-conversation setup. */
  boundaryReady: true;
  hasActivity: boolean;
}
export interface SideChatSnapshot {
  parent: SideChatParent;
  draftId: string;
  kind: 'temporary' | 'durable';
  phase: SideChatPhase;
  thread: ThreadSummary | null;
  childOptions: SubmitOptions;
  boundaryConfirmed: boolean;
  subscriptionLost: boolean;
  operation: SideChatOperation | null;
  sequence: number;
  closeRequested: boolean;
  activeTurnId: string | null;
  hasActivity: boolean;
  error: string | null;
}
