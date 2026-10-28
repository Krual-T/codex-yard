import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { createComposerQueueEditControls } from '../src/renderer/composer/composer-queue-edit.ts';
import type {
  ComposerQueueControls,
  ComposerQueueDependencies,
  ComposerQueueProps,
  QueueActions,
  QueueEditResult,
  QueuePromptDraft,
  QueueUndoOperations,
  QueueUndoOptions,
} from '../src/renderer/composer/composer-queue-types.ts';
import { createComposerControllerFixture } from './renderer-composer-fixture.ts';

export async function runQueueFixture(): Promise<object> {
  type Comment = { id: string };
  type PriorConversation = { id: string };
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const calls: unknown[][] = [];
  const scope: {
    draft: QueuePromptDraft;
    fields: Record<string, unknown>;
    shared: unknown[];
    suggestion: unknown;
  } = { draft: { usedDictation: false }, fields: {}, shared: [], suggestion: { id: 'original-suggestion' } };
  const initialDraft = scope.draft;
  const originalSuggestion = scope.suggestion;
  const priorConversation = { id: 'previous-conversation' };
  let currentPrior: PriorConversation | null = priorConversation;
  let comments: Comment[] = [{ id: 'existing' }];
  const controller = createComposerControllerFixture();
  controller.setPromptText('original prompt');
  controller.view.dispatch = () => { calls.push(['history']); };
  const message: QueueEditResult<Comment, PriorConversation>['message'] = {
    id: 'queued-1', text: 'queued prompt', multiUserMessageSender: { id: 'sender' },
    context: {
      fileAttachments: [
        { path: '/project/ordinary.txt' },
        { path: '/project/pasted.txt' },
        { path: '/project/shared.txt', sharedThread: { shareId: 'share-1' } },
      ],
      generatedPastedTextAttachmentPaths: ['/project/pasted.txt'],
      imageAttachments: [{ id: 'image' }], addedFiles: [{ path: '/project/new.txt' }],
      imageCommentDraft: { id: 'old-image-comment' },
      sharedThreadAttributions: [{ shareId: 'share-1', handoffId: 'handoff-1' }],
      commentAttachments: [{ id: 'existing' }, { id: 'new-comment' }],
      responseTextAnnotations: [{ text: 'selected' }],
      mcpAppModelContextAttachments: [{ id: 'submitted-mcp' }],
      priorConversation: { id: 'queued-prior' }, presentationSuggestionDraft: { id: 'queued-suggestion' },
      usedDictation: true, worktreeRecovery: { id: 'recovery' }, messageThreadId: 'message-thread',
      artifactFollowupAttributions: { id: 'artifact' }, pullRequestChecks: [{ id: 'check' }],
      isImageEditFollowUp: true, turnTrigger: { kind: 'follow-up' }, restoredPromptContext: { id: 'context' },
    },
  };
  const editResult: QueueEditResult<Comment, PriorConversation> = {
    message, previousMessageId: 'previous', nextMessageId: 'next',
    serverSubmission: { id: 'server' }, preserveSerializedContext: true,
  };
  let deferEdit = false;
  let finishEdit: ((result: QueueEditResult<Comment, PriorConversation> | null) => void) | undefined;
  let canRestore = true;
  const actions: QueueActions<typeof scope, Comment, PriorConversation> = {
    beginEdit: async id => {
      calls.push(['beginEdit', id]);
      if (deferEdit) return await new Promise(resolve => { finishEdit = resolve; });
      return editResult;
    },
    restoreEdit: async result => { calls.push(['restoreEdit', result.message.id]); },
    remove: async id => { calls.push(['remove', id]); return { message, canRestore }; },
    restore: async result => { calls.push(['restore', result.message.id]); },
    start: async options => {
      calls.push(['start', options.scope === scope, options.conversationId, options.executionHostId, options.messageId, options.submission]);
      options.onSendResult('sent', { turnId: 'turn-1' });
    },
    reorder: async ids => { calls.push(['reorder', ids]); if (ids[0] === 'fail') throw Error('reorder failed'); },
    resumeInterruptedSteers: async () => { calls.push(['resume']); },
  };
  let undo: { options: QueueUndoOptions; operations: QueueUndoOperations<unknown> } | undefined;
  let commitEdit: (() => void) | undefined;
  const dependencies: ComposerQueueDependencies<typeof scope, Comment, PriorConversation> = {
    useScope: () => scope,
    useController: () => controller,
    usePastedTextAttachments: () => pastedBeforeEdit,
    clearAttachments: () => { calls.push(['clearAttachments']); },
    closeHistory: transaction => transaction,
    updatePrompt: (_scope, update) => { const next = { ...scope.draft }; update(next); scope.draft = next; },
    setComposerField: (_scope, key, value) => { scope.fields[key] = value; },
    setSharedThreadAttachments: (_scope, attachments) => { scope.shared = attachments; },
    generatedPastedPaths: (files, paths) => paths?.filter(path => files.some(file => file.path === path)),
    normalizeFiles: files => files,
    normalizePastedText: (attachments, hostId) => attachments.map(attachment => attachment.upload != null
      ? attachment : { ...attachment, hostId: attachment.hostId ?? hostId }),
    deduplicateComments: values => values.filter((value, index) => values.findIndex(other => other.id === value.id) === index),
    clearMcpContext: () => { calls.push(['clearMcp']); },
    queuedMcpContext: () => [{ id: 'resolved-mcp' }],
    restoreSubmittedMcpContext: (_scope, attachments) => { calls.push(['submittedMcp', attachments]); },
    getDraft: () => scope.draft,
    restoreDraft: (_scope, draft) => { scope.draft = draft as QueuePromptDraft; },
    getPresentationSuggestion: () => scope.suggestion,
    setPresentationSuggestion: (_scope, suggestion) => { scope.suggestion = suggestion; },
    captureChanges: (_scope, action) => {
      const before = { fields: structuredClone(scope.fields), shared: structuredClone(scope.shared) };
      action();
      return { before, after: { fields: structuredClone(scope.fields), shared: structuredClone(scope.shared) } };
    },
    applyChanges: (_scope, changes, direction) => {
      const change = changes as { before: { fields: Record<string, unknown>; shared: unknown[] }; after: { fields: Record<string, unknown>; shared: unknown[] } };
      const value = direction === 'undo' ? change.before : change.after;
      scope.fields = structuredClone(value.fields); scope.shared = structuredClone(value.shared);
      calls.push(['applyChanges', direction]);
    },
    runUndoable: async (_scope, options, operations) => {
      const value = await operations.perform();
      if (operations.shouldCommit(value)) {
        undo = { options, operations: operations as QueueUndoOperations<unknown> };
        operations.onCommit?.(value, { id: 'undo-handle' });
      }
      return value;
    },
    formatUndoLabel: message => message.id,
    setEditHistoryStatus: (_scope, status) => { calls.push(['status', status]); },
    trackEditHistory: (_scope, _handle, before, after, onCommit) => { calls.push(['track', before, after]); commitEdit = onCommit; },
    clearEditHistory: () => { calls.push(['clearHistory']); },
    cleanupDraftAttachments: (_scope, host, pasted) => { calls.push(['cleanupDraft', host, pasted]); },
    cleanupQueuedAttachments: (_scope, host, files, pasted) => { calls.push(['cleanupQueue', host, files, pasted]); },
    recordSend: (context, outcome, details) => { calls.push(['analytics', context, outcome, details]); },
    maxPastedTextCharacters: 80,
    editUndoExpiryMs: 1800000,
  };
  const pastedBeforeEdit = [{ characterCount: 10, file: { path: '/old-paste' }, hostId: 'local', preview: 'old' }];
  const props: ComposerQueueProps<typeof scope, Comment, PriorConversation> = {
    conversationId: 'thread-1', executionHostId: 'ssh-host', focusComposer: () => { calls.push(['focus']); },
    incrementAttachmentGeneration: () => { calls.push(['generation']); }, onError: error => { calls.push(['error', String(error)]); },
    queuedSubmission: { id: 'submission' }, priorConversation, queuedFollowUps: { actions },
    remoteSshMessageAnalyticsContext: { id: 'analytics' },
    setComments: next => { comments = typeof next === 'function' ? next(comments) : next; },
    setPriorConversation: next => { currentPrior = next; },
  };
  const useQueue = createComposerQueueEditControls(React, dependencies);
  let controls: ComposerQueueControls<Comment, PriorConversation>;
  function Harness(): null { controls = useQueue(props); return null; }
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => { root.render(React.createElement(Harness)); });

  deferEdit = true;
  const pending = controls!.handleEditMessage('queued-1');
  controller.setPromptText('user changed prompt');
  finishEdit!(editResult);
  await React.act(async () => { await pending; });
  const race = {
    text: controller.getPersistedText(), editing: controls!.editingMessageId,
    restored: calls.filter(call => call[0] === 'restoreEdit').length,
    focused: calls.some(call => call[0] === 'focus'), fields: structuredClone(scope.fields),
  };

  controller.setPromptText('original prompt');
  const pendingSuggestion = controls!.handleEditMessage('queued-1');
  scope.suggestion = { id: 'changed-suggestion' };
  finishEdit!(editResult);
  await React.act(async () => { await pendingSuggestion; });
  const suggestionRace = { suggestion: scope.suggestion, restored: calls.filter(call => call[0] === 'restoreEdit').length };
  scope.suggestion = originalSuggestion;
  deferEdit = false;
  await React.act(async () => { await controls!.handleEditMessage('queued-1'); });
  const edited = structuredClone({
    text: controller.getPersistedText(), position: controls!.editingMessagePosition,
    fields: scope.fields, shared: scope.shared, draft: scope.draft, comments,
    suggestion: scope.suggestion, prior: currentPrior,
  });
  const editUndo = undo!;
  await React.act(async () => { await editUndo.operations.undo(); editUndo.options.onUndoSuccess?.(); });
  const undone = {
    text: controller.getPersistedText(), editing: controls!.editingMessageId,
    fields: structuredClone(scope.fields), initialDraft: scope.draft === initialDraft,
    initialSuggestion: scope.suggestion === originalSuggestion, originalPrior: currentPrior === priorConversation,
  };
  await React.act(async () => { await editUndo.operations.redo(); editUndo.options.onRedoSuccess?.(); });
  const redone = { text: controller.getPersistedText(), editing: controls!.editingMessageId, fields: structuredClone(scope.fields) };
  commitEdit!();
  await React.act(async () => { await controls!.handleEditedMessageSubmitted(); });
  const submittedEditing = controls!.editingMessageId;
  controls!.restoreQueuedMessageDraft({ ...message, context: { ...message.context, pastedTextAttachments: [
    { characterCount: 100, preview: 'uploaded', upload: { accountId: 'account', fileId: 'file', fileName: 'paste.txt' } },
    { characterCount: 110, preview: 'local', file: { path: '/saved-paste' } },
  ] } });
  const storedPastes = structuredClone(scope.fields.pastedTextAttachments);
  controls!.restoreSubmittedDraft(message);
  await controls!.handleSendNowMessage('queued-1');
  controls!.messageListActions.onReorderMessages(['queued-2', 'queued-1']);
  controls!.messageListActions.onReorderMessages(['fail']);
  controls!.messageListActions.onResumeInterruptedQueue();
  await Promise.resolve();
  await Promise.resolve();
  canRestore = false;
  await controls!.handleDeleteMessage('queued-1');
  canRestore = true;
  await controls!.handleDeleteMessage('queued-1');
  const deleteUndo = undo!;
  await deleteUndo.operations.undo();
  deleteUndo.options.onFinalize?.('undo');
  await React.act(async () => { root.unmount(); });
  container.remove();
  return { race, suggestionRace, edited, undone, redone, submittedEditing, storedPastes, calls };
}
