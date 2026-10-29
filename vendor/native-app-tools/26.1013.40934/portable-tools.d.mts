import type { AppToolDescriptor } from '../../../lib/app-tools.ts';
import type { Page, RpcMessage, ThreadSummary, TurnSummary } from '../../../lib/codex-protocol.ts';

export interface WaitTarget { threadId: string; hostId?: string; afterCursor?: string }
export interface NativeArguments {
  threadId?: string; hostId?: string; title?: string; prompt?: string; source?: 'codex' | 'chatgpt';
  model?: string; thinking?: string; cursor?: string; limit?: number; turnLimit?: number;
  pinned?: boolean; archived?: boolean; read?: boolean; includeOutputs?: boolean;
  maxOutputCharsPerItem?: number; targets?: WaitTarget[]; timeoutMs?: number;
  target?: { type: 'project'; projectId: string; environment: { type: 'local' | 'worktree'; startingState?: unknown } }
    | { type: 'projectless'; directoryName?: string } | { type: 'chatgptWorkCloud'; projectId?: string };
  environment?: { type: 'same-directory' | 'worktree' };
}
export interface ParseError { issues: { path: (string | number)[]; message: string }[] }
interface NativeSchema { safeParse(value: unknown): { success: true; data: NativeArguments } | { success: false; error: ParseError } }
export interface ToolResult { success: boolean; contentItems: { type: 'inputText'; text: string }[] }
export interface NativeReadOptions { includeTurns: boolean; requestOptions?: { timeoutMs?: number } }
export interface NativeTurnsOptions { cursor?: string; itemsView?: string; itemSnapshot?: string; limit?: number;
  maxBytes?: number; requestOptions?: { timeoutMs?: number } }
export interface NativeManager {
  getHostId(): string;
  readThread(id: string, options: NativeReadOptions): Promise<{ thread: ThreadSummary }>;
  listThreadTurns(id: string, options: NativeTurnsOptions): Promise<{ response: Page<TurnSummary> }>;
  addNotificationCallback(methods: string[], listener: (value: RpcMessage) => void, onError?: (cause: Error) => void): () => void;
  addThreadDeletedListener(listener: (id: string) => void, onError?: (cause: Error) => void): () => void;
}
export interface NativeHosts { getManagers(preferred?: string): NativeManager[]; subscribe(hostId: string, listener: () => void): () => void }
export interface AvailableModel { model: string; description: string; supportedReasoningEfforts: { reasoningEffort: string }[] }
export const catalog: Omit<AppToolDescriptor, 'namespace'>[];
export const schemas: Record<string, NativeSchema>;
export class ThreadWaiter {
  constructor(hosts: NativeHosts, formatter: typeof formatAssistantMessage);
  resolveThreadHost(options: { preferredHostId?: string; threadId: string; signal: AbortSignal; requestOptions?: { timeoutMs?: number } }): Promise<{ hostId: string; manager: NativeManager }>;
  waitForThreads(options: { targets: WaitTarget[]; timeoutMs: number; signal?: AbortSignal }): Promise<unknown>;
}
export function formatAssistantMessage(value: string, active?: boolean): { content: string; removed: boolean };
export function readHistory(options: { getAppServerVersion(): string | null; cursor?: string; hostId: string; isCloudHost: boolean;
  includeOutputs: boolean; manager: NativeManager; maxOutputCharsPerItem: number; signal?: AbortSignal;
  thread: ThreadSummary; threadId: string; turnLimit: number }): Promise<unknown>;
export function success(value: unknown): ToolResult;
export function failure(message: string): ToolResult;
export function invalidArguments(name: string, error: ParseError): ToolResult;
export function validateModel(model: string, thinking: string | undefined, available: AvailableModel[] | null): string | null;
export function nativeParentThread(thread: ThreadSummary): string | null;
export function delegationTurnInput(params: { appServerVersion: string | null; sourceThreadId: string; input: string; toolName: string }): {
  input: { type: 'text'; text: string; text_elements: unknown[] }[];
  toolOutput?: { name: string; namespace: string; output: string };
};
