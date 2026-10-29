import type { ApprovalPolicy, ApprovalsReviewer, SandboxMode, ThreadSummary, RequestOptions } from '../../lib/codex-protocol.ts';

/** The browser talks only to Yard's host bridge, which owns CLI connections. */
export interface WorkbenchEvent {
  type: string;
  hostId?: string;
  [key: string]: unknown;
}
export interface ServerRequestEvent extends WorkbenchEvent {
  type: 'mcp-request';
  hostId: string;
  requestRef: ServerRequestRef;
  request: { id: string | number; method: string; params?: Record<string, unknown> };
}
export type WorkbenchDispatchOptions = Pick<RequestOptions, 'onLateTerminal'> & {
  /** Check the captured original authority after connection waits, immediately before sending. */
  assertBeforeSend?: () => void;
  /** Original page/host daemon socket token, captured before the operation's first await. */
  daemonConnectionGeneration?: string;
};
export interface WorkbenchClient {
  rpc<T = unknown>(method: string, params?: Record<string, unknown>, hostId?: string, options?: WorkbenchDispatchOptions): Promise<T>;
  host<T = unknown>(endpoint: string, params?: Record<string, unknown>, options?: Pick<WorkbenchDispatchOptions, 'assertBeforeSend'>): Promise<T>;
  subscribe(listener: (event: WorkbenchEvent) => void): () => void;
  reply(request: ServerRequestRef, response: { result: unknown } | { error: { code: number; message: string } }): Promise<void>;
}
export interface ServerRequestRef { hostId: string; generation: string; id: string | number }
export interface ComposerContext {
  hostId: string;
  threadId: string | null;
  cwd: string;
  /** Stable identity of one draft, including multiple new drafts in the same cwd. */
  draftId: string;
  placement?: 'main' | 'side-chat' | 'mini';
  legacyDraftKey?: string;
}
export interface ComposerImage {
  id: string;
  src: string;
  previewSrc?: string;
  path?: string;
  name?: string;
  fileId?: string;
}
export interface ComposerDocument {
  type: string;
  attrs?: Record<string, unknown>;
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: ComposerDocument[];
}
export interface ComposerDraft {
  text: string;
  images: ComposerImage[];
  files: { path: string; name: string }[];
  /** Browser element and other explicitly selected contextual references. */
  references?: { id: string; text: string; kind?: string; context?: Record<string, unknown>; original?: unknown }[];
  document?: ComposerDocument;
  /** Original ordered protocol content, retained through message editing. */
  input?: Record<string, unknown>[];
  hints?: unknown[];
  skills?: { name: string; path: string }[];
}
export interface SubmitOptions {
  model?: string;
  effort?: string | null;
  approvalPolicy?: ApprovalPolicy;
  sandboxMode?: SandboxMode;
  approvalsReviewer?: ApprovalsReviewer;
  permissionProfileId?: string;
  serviceTier?: string | null;
  mode?: 'default' | 'plan';
}
/** The resolved mode request is frozen before its first turn/start. */
export interface SubmissionCollaborationMode {
  mode: 'default' | 'plan';
  settings: { model: string; reasoning_effort: string | null; developer_instructions: null };
}
export type SubmitAction = { type: 'send' } | { type: 'queue' } | { type: 'steer'; turnId: string };
export interface MessageEditOrigin {
  hostId: string;
  threadId: string;
  turnId: string;
  itemId: string;
  format?: string;
  hints?: unknown[];
}
export interface StandaloneComposerProps {
  client: WorkbenchClient;
  context: ComposerContext;
  busy: boolean;
  onSubmit(draft: ComposerDraft, options: SubmitOptions, action: SubmitAction): Promise<void>;
  onInterrupt(): Promise<void>;
  /** App resumes the selected thread before starting an authoritative queue item. */
  onStartQueued?(queuedSubmissionId: string, assertAuthority?: () => void, originalAuthority?: () => void): Promise<void>;
  /** Explicit contextual reference prefill, consumed once per id; never a message edit. */
  prefill?: { id: string; draft: ComposerDraft } | null;
  /** Called only after this prefill has been durably merged into its draft. */
  onPrefillConsumed?(id: string): void;
}
export interface StandaloneMessagesProps {
  client: WorkbenchClient;
  hostId: string;
  /** The committed route target is known before its transcript finishes loading. */
  threadId?: string | null;
  thread: ThreadSummary | null;
  onEdit?(draft: ComposerDraft, origin: MessageEditOrigin, prepare: () => Promise<void>): Promise<void>;
  onFork?(turnId: string): void | Promise<void>;
  onOpenFile?(path: string): void;
  onOpenFileAt?(location: { path: string; hostId: string; cwd?: string; line?: number; column?: number }): void;
  onOpenVisualization?(value: { hostId: string; threadId: string; path: string }): void;
  onOpenBrowser?(value: { hostId: string; threadId: string; url?: string }): void;
}
export interface StandaloneSettingsProps {
  client: WorkbenchClient;
  hostId: string;
  location: { pathname: string; search: string; hash: string; state: unknown };
  onNavigate(path: string, options?: { replace?: boolean; delta?: number; state?: unknown }): void;
  onClose(): void;
}
