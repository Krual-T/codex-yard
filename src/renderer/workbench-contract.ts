import type { ThreadSummary } from '../../lib/codex-protocol.ts';

/** The browser talks only to Yard's host bridge, which owns CLI connections. */
export interface WorkbenchEvent {
  type: string;
  hostId?: string;
  [key: string]: unknown;
}
export interface WorkbenchClient {
  rpc<T = unknown>(method: string, params?: Record<string, unknown>, hostId?: string): Promise<T>;
  host<T = unknown>(endpoint: string, params?: Record<string, unknown>): Promise<T>;
  subscribe(listener: (event: WorkbenchEvent) => void): () => void;
}
export interface ComposerContext {
  hostId: string;
  threadId: string | null;
  cwd: string;
}
export interface ComposerImage {
  id: string;
  src: string;
  previewSrc?: string;
  path?: string;
  name?: string;
}
export interface ComposerDraft {
  text: string;
  images: ComposerImage[];
  files: { path: string; name: string }[];
  /** Browser element and other explicitly selected contextual references. */
  references?: { id: string; text: string }[];
}
export interface SubmitOptions {
  model?: string;
  effort?: string | null;
  approvalPolicy?: string;
  sandboxMode?: string;
  serviceTier?: string | null;
  mode?: 'default' | 'plan';
}
export interface StandaloneComposerProps {
  client: WorkbenchClient;
  context: ComposerContext;
  busy: boolean;
  onSubmit(draft: ComposerDraft, options: SubmitOptions): Promise<void>;
  onInterrupt(): Promise<void>;
  /** Optional explicit edit/reference prefill, consumed once per id. */
  prefill?: { id: string; draft: ComposerDraft } | null;
}
export interface StandaloneMessagesProps {
  client: WorkbenchClient;
  hostId: string;
  thread: ThreadSummary | null;
  onEdit?(draft: ComposerDraft): void;
  onFork?(turnId: string): void;
  onOpenFile?(path: string): void;
}
export interface StandaloneSettingsProps {
  client: WorkbenchClient;
  hostId: string;
  initialSection?: string;
  onClose(): void;
}
