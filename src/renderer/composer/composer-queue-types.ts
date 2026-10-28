import type * as React from 'react';
import type { ComposerController, ComposerTransaction } from './composer-types.ts';

export interface QueueFileAttachment {
  path: string;
  sharedThread?: { shareId: string } | null;
}

export type QueuePastedTextAttachment = {
  characterCount: number;
  codeBlockLanguage?: string | null;
  preview: string;
} & (
  | { file: QueueFileAttachment; hostId?: string | null; upload?: null }
  | { file?: QueueFileAttachment | null; hostId?: string | null; upload: { accountId: string; fileId: string; fileName: string } }
);

export interface QueueMessageContext<Comment extends object = object, PriorConversation = unknown> {
  fileAttachments: QueueFileAttachment[];
  imageAttachments: object[];
  addedFiles: QueueFileAttachment[];
  generatedPastedTextAttachmentPaths?: string[] | null;
  pastedTextAttachments?: QueuePastedTextAttachment[] | null;
  imageCommentDrafts?: object[] | null;
  imageCommentDraft?: object | null;
  appshotContexts?: object[] | null;
  uploadedFileAttachments?: object[] | null;
  sharedThreadAttributions?: { shareId: string; handoffId?: string }[] | null;
  attachmentOrder?: unknown[] | null;
  commentAttachments?: Comment[] | null;
  selectedTextAttachments?: object[] | null;
  responseTextAnnotations?: object[] | null;
  pullRequestMergeConflict?: object | null;
  priorConversation?: PriorConversation | null;
  presentationSuggestionDraft?: unknown;
  mcpAppModelContextAttachments?: object[] | null;
  usedDictation?: boolean | null;
  worktreeRecovery?: unknown;
  messageThreadId?: string | null;
  aeonReplyQuote?: unknown;
  artifactFollowupAttributions?: unknown;
  pullRequestChecks?: object[] | null;
  isImageEditFollowUp?: boolean;
  turnTrigger?: unknown;
  restoredPromptContext?: unknown;
}

export interface QueuedComposerMessage<Comment extends object = object, PriorConversation = unknown> {
  id: string;
  text: string;
  context: QueueMessageContext<Comment, PriorConversation>;
  multiUserMessageSender?: unknown;
}

export interface QueueEditResult<Comment extends object = object, PriorConversation = unknown> {
  message: QueuedComposerMessage<Comment, PriorConversation>;
  previousMessageId?: string | null;
  nextMessageId?: string | null;
  serverSubmission?: unknown;
  preserveSerializedContext?: unknown;
}

export interface QueueDeleteResult<Comment extends object = object, PriorConversation = unknown> {
  message: QueuedComposerMessage<Comment, PriorConversation>;
  canRestore?: boolean;
}

export interface QueueEditPosition {
  messageId: string;
  multiUserMessageSender: unknown;
  isImageEditFollowUp: boolean | undefined;
  turnTrigger: unknown;
  previousMessageId: string | null | undefined;
  nextMessageId: string | null | undefined;
  serverSubmission: unknown;
  preserveSerializedContext: unknown;
  restoredPromptContext: unknown;
}

export interface QueueActions<Scope, Comment extends object = object, PriorConversation = unknown> {
  beginEdit(messageId: string): Promise<QueueEditResult<Comment, PriorConversation> | null>;
  restoreEdit(result: QueueEditResult<Comment, PriorConversation>): Promise<void>;
  remove(messageId: string): Promise<QueueDeleteResult<Comment, PriorConversation> | null>;
  restore(result: QueueDeleteResult<Comment, PriorConversation>): Promise<void>;
  start(options: {
    scope: Scope;
    conversationId: string | null;
    executionHostId: string;
    messageId: string;
    onSendResult(outcome: unknown, result?: { turnId?: string } | null): void;
    submission: object;
  }): Promise<void>;
  reorder(messageIds: string[]): Promise<void>;
  resumeInterruptedSteers(): Promise<void>;
}

export interface ComposerQueueProps<Scope, Comment extends object = object, PriorConversation = unknown> {
  conversationId: string | null;
  executionHostId: string;
  focusComposer(): void;
  incrementAttachmentGeneration(): void;
  onError(error: unknown): void;
  queuedSubmission: object;
  priorConversation: PriorConversation | null;
  queuedFollowUps: { actions: QueueActions<Scope, Comment, PriorConversation> };
  remoteSshMessageAnalyticsContext: unknown;
  setComments: React.Dispatch<React.SetStateAction<Comment[]>>;
  setPriorConversation(conversation: PriorConversation | null): void;
}

export interface ComposerQueueControls<Comment extends object = object, PriorConversation = unknown> {
  editingMessageId: string | null;
  editingMessagePosition: QueueEditPosition | null;
  handleEditMessage(messageId: string): Promise<void>;
  handleDeleteMessage(messageId: string): Promise<void>;
  handleSendNowMessage(messageId: string): Promise<void>;
  handleEditedMessageSubmitted(): Promise<void>;
  restoreQueuedMessageDraft(message: QueuedComposerMessage<Comment, PriorConversation>): void;
  restoreSubmittedDraft(message: QueuedComposerMessage<Comment, PriorConversation>): void;
  messageListActions: {
    onEditMessage(messageId: string): void;
    onDeleteMessage(messageId: string): void;
    onSendNowMessage(messageId: string): void;
    onReorderMessages(messageIds: string[]): void;
    onResumeInterruptedQueue(): void;
  };
}

export interface QueuePromptDraft {
  usedDictation?: boolean;
  worktreeRecovery?: unknown;
  messageThreadId?: string;
  aeonReplyQuote?: unknown;
  artifactFollowupAttributions?: unknown;
  pullRequestChecks?: object[];
}

export interface QueueComposerFields {
  imageAttachments: object[];
  imageCommentDrafts: object[];
  appshotContexts: object[];
  fileAttachments: QueueFileAttachment[];
  pastedTextAttachments: QueuePastedTextAttachment[];
  uploadedFileAttachments: object[];
  addedFiles: QueueFileAttachment[];
  attachmentOrder: unknown[];
  selectedTextAttachments: object[];
  responseTextAnnotations: (object & { id: string })[];
  pullRequestMergeConflict: object | null;
  mcpAppModelContextAttachments: object[];
}

export interface QueueUndoOptions {
  label: unknown;
  expiresAfterMs?: number;
  transitionQueueKey: string;
  onRedoSuccess?(): void;
  onUndoSuccess?(): void;
  onFinalize?(reason: string): void;
}

export interface QueueUndoOperations<Result> {
  perform(): Promise<Result>;
  shouldCommit(result: Result): boolean;
  onCommit?(result: Result, handle: unknown): void;
  redo(): Promise<void>;
  undo(): Promise<void>;
}

export interface ComposerQueueDependencies<Scope, Comment extends object = object, PriorConversation = unknown> {
  useScope(): Scope;
  useController(): ComposerController;
  usePastedTextAttachments(): QueuePastedTextAttachment[];
  clearAttachments(scope: Scope): void;
  closeHistory(transaction: ComposerTransaction): ComposerTransaction;
  updatePrompt(scope: Scope, update: (draft: QueuePromptDraft) => void): void;
  setComposerField<Key extends keyof QueueComposerFields>(scope: Scope, key: Key, value: QueueComposerFields[Key]): void;
  setSharedThreadAttachments(scope: Scope, attachments: {
    file: QueueFileAttachment;
    hostId: string;
    handoffId: string | undefined;
  }[]): void;
  generatedPastedPaths(files: QueueFileAttachment[], paths: string[] | null | undefined): Iterable<string> | undefined;
  normalizeFiles(files: QueueFileAttachment[]): QueueFileAttachment[];
  normalizePastedText(attachments: QueuePastedTextAttachment[], hostId: string): QueuePastedTextAttachment[];
  deduplicateComments(comments: Comment[]): Comment[];
  clearMcpContext(scope: Scope): void;
  queuedMcpContext(scope: Scope, message: QueuedComposerMessage<Comment, PriorConversation>): object[];
  restoreSubmittedMcpContext(scope: Scope, attachments: object[]): void;
  getDraft(scope: Scope): unknown;
  restoreDraft(scope: Scope, draft: unknown): void;
  getPresentationSuggestion(scope: Scope): unknown;
  setPresentationSuggestion(scope: Scope, suggestion: unknown): void;
  captureChanges(scope: Scope, action: () => void): unknown;
  applyChanges(scope: Scope, changes: unknown, direction: 'undo' | 'redo'): void;
  runUndoable<Result>(scope: Scope, options: QueueUndoOptions, operations: QueueUndoOperations<Result>): Promise<Result>;
  formatUndoLabel(message: { id: string; defaultMessage: string; description: string }): unknown;
  setEditHistoryStatus(scope: Scope, status: 'editing' | 'undone'): void;
  trackEditHistory(scope: Scope, handle: unknown, before: string, after: string, onCommit: () => void): void;
  clearEditHistory(scope: Scope): void;
  cleanupDraftAttachments(scope: Scope, hostId: string, attachments: QueuePastedTextAttachment[]): void;
  cleanupQueuedAttachments(scope: Scope, hostId: string, files: QueueFileAttachment[], pasted: QueuePastedTextAttachment[]): void;
  recordSend(context: unknown, outcome: unknown, details: { turnId: string | undefined }): void;
  maxPastedTextCharacters: number;
  editUndoExpiryMs: number;
}
