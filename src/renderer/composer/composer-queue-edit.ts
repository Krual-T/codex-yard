import type * as ReactTypes from 'react';
import type {
  ComposerQueueControls,
  ComposerQueueDependencies,
  ComposerQueueProps,
  QueueEditPosition,
  QueueEditResult,
  QueueDeleteResult,
  QueuedComposerMessage,
} from './composer-queue-types.ts';

export function createComposerQueueEditControls<Scope, Comment extends object = object, PriorConversation = unknown>(
  React: typeof ReactTypes,
  dependencies: ComposerQueueDependencies<Scope, Comment, PriorConversation>,
): (props: ComposerQueueProps<Scope, Comment, PriorConversation>) => ComposerQueueControls<Comment, PriorConversation> {
  return function useComposerQueueEditControls({
    conversationId,
    executionHostId,
    focusComposer,
    incrementAttachmentGeneration,
    onError,
    queuedSubmission,
    priorConversation,
    queuedFollowUps,
    remoteSshMessageAnalyticsContext,
    setComments,
    setPriorConversation,
  }: ComposerQueueProps<Scope, Comment, PriorConversation>): ComposerQueueControls<Comment, PriorConversation> {
    const scope = dependencies.useScope();
    const controller = dependencies.useController();
    const pastedTextAttachments = dependencies.usePastedTextAttachments();
    const [editingMessagePosition, setEditingMessagePosition] = React.useState<QueueEditPosition | null>(null);

    const controls = React.useMemo(() => {
      const getPromptText = () => controller.getPersistedText();
      const startHistoryGroup = () => {
        if (!controller.view.isDestroyed) {
          controller.view.dispatch(dependencies.closeHistory(controller.view.state.tr));
        }
      };
      const restoreText = (message: QueuedComposerMessage<Comment, PriorConversation>) => {
        startHistoryGroup();
        controller.restoreText(message.text);
        dependencies.updatePrompt(scope, draft => {
          if (message.context.usedDictation == null) delete draft.usedDictation;
          else draft.usedDictation = message.context.usedDictation;
        });
        startHistoryGroup();
        dependencies.updatePrompt(scope, draft => {
          if (message.context.worktreeRecovery == null) delete draft.worktreeRecovery;
          else draft.worktreeRecovery = message.context.worktreeRecovery;
          if (message.context.messageThreadId == null) delete draft.messageThreadId;
          else draft.messageThreadId = message.context.messageThreadId;
          if (message.context.aeonReplyQuote == null) delete draft.aeonReplyQuote;
          else draft.aeonReplyQuote = message.context.aeonReplyQuote;
        });
      };
      const restoreAttachments = (message: QueuedComposerMessage<Comment, PriorConversation>) => {
        const { context } = message;
        const pastedPaths = new Set(dependencies.generatedPastedPaths(
          context.fileAttachments, context.generatedPastedTextAttachmentPaths,
        ));
        const pasted = context.pastedTextAttachments ?? context.fileAttachments
          .filter(file => pastedPaths.has(file.path))
          .map(file => ({ characterCount: dependencies.maxPastedTextCharacters + 1, file, hostId: executionHostId, preview: '' }));

        dependencies.setComposerField(scope, 'imageAttachments', context.imageAttachments);
        dependencies.setComposerField(scope, 'imageCommentDrafts', context.imageCommentDrafts ?? (context.imageCommentDraft == null ? [] : [context.imageCommentDraft]));
        dependencies.setComposerField(scope, 'appshotContexts', context.appshotContexts ?? []);
        dependencies.setComposerField(scope, 'fileAttachments', dependencies.normalizeFiles(
          context.fileAttachments.filter(file => !pastedPaths.has(file.path) && file.sharedThread == null),
        ));
        dependencies.setSharedThreadAttachments(scope, context.fileAttachments.flatMap(file => file.sharedThread == null ? [] : [{
          file: { ...file, sharedThread: file.sharedThread },
          hostId: executionHostId,
          handoffId: context.sharedThreadAttributions?.find(({ shareId }) => shareId === file.sharedThread?.shareId)?.handoffId,
        }]));
        dependencies.setComposerField(scope, 'pastedTextAttachments', dependencies.normalizePastedText(pasted, executionHostId));
        dependencies.setComposerField(scope, 'uploadedFileAttachments', context.uploadedFileAttachments ?? []);
        dependencies.setComposerField(scope, 'addedFiles', dependencies.normalizeFiles(context.addedFiles));
        dependencies.setComposerField(scope, 'attachmentOrder', context.attachmentOrder ?? []);
        setComments(comments => dependencies.deduplicateComments([...comments, ...context.commentAttachments ?? []]));
        dependencies.setComposerField(scope, 'selectedTextAttachments', context.selectedTextAttachments ?? []);
        dependencies.setComposerField(scope, 'responseTextAnnotations', (context.responseTextAnnotations ?? []).map(
          (annotation, index) => ({ ...annotation, id: `${message.id}:response-annotation:${index}` }),
        ));
        dependencies.setComposerField(scope, 'pullRequestMergeConflict', context.pullRequestMergeConflict ?? null);
        setPriorConversation(context.priorConversation ?? null);
      };
      const restoreQueuedMcp = (message: QueuedComposerMessage<Comment, PriorConversation>) => {
        dependencies.clearMcpContext(scope);
        dependencies.setComposerField(scope, 'mcpAppModelContextAttachments', dependencies.queuedMcpContext(scope, message));
      };
      const restoreDraft = (message: QueuedComposerMessage<Comment, PriorConversation>) => {
        restoreText(message);
        restoreAttachments(message);
        dependencies.setPresentationSuggestion(scope, message.context.presentationSuggestionDraft ?? null);
      };

      const handleEditMessage = async (messageId: string) => {
        const originalPrompt = getPromptText();
        const originalSuggestion = dependencies.getPresentationSuggestion(scope);
        let result: QueueEditResult<Comment, PriorConversation> | null = null;
        let editedPrompt = originalPrompt;
        let beforeDraft: unknown;
        let afterDraft: unknown;
        let position: QueueEditPosition | null = null;
        let changes: unknown = [];

        await dependencies.runUndoable(scope, {
          expiresAfterMs: dependencies.editUndoExpiryMs,
          label: dependencies.formatUndoLabel({
            id: 'appUndo.queuedMessageEdited',
            defaultMessage: 'Queued message restored',
            description: 'Toast shown after undo returns an edited message to the message queue',
          }),
          onRedoSuccess: () => dependencies.setEditHistoryStatus(scope, 'editing'),
          onUndoSuccess: () => dependencies.setEditHistoryStatus(scope, 'undone'),
          transitionQueueKey: `queued-message-edit:${conversationId ?? 'new'}`,
        }, {
          perform: async () => {
            result = await queuedFollowUps.actions.beginEdit(messageId);
            if (result == null) return null;
            if (getPromptText() !== originalPrompt || dependencies.getPresentationSuggestion(scope) !== originalSuggestion) {
              await queuedFollowUps.actions.restoreEdit(result);
              result = null;
              return null;
            }

            const { message, previousMessageId, nextMessageId } = result;
            position = {
              messageId,
              multiUserMessageSender: message.multiUserMessageSender ?? null,
              isImageEditFollowUp: message.context.isImageEditFollowUp,
              turnTrigger: message.context.turnTrigger,
              previousMessageId,
              nextMessageId,
              serverSubmission: result.serverSubmission,
              preserveSerializedContext: result.preserveSerializedContext,
              restoredPromptContext: message.context.restoredPromptContext,
            };
            dependencies.clearAttachments(scope);
            incrementAttachmentGeneration();
            setEditingMessagePosition(position);
            beforeDraft = dependencies.getDraft(scope);
            restoreText(message);
            dependencies.updatePrompt(scope, draft => {
              if (message.context.artifactFollowupAttributions == null) delete draft.artifactFollowupAttributions;
              else draft.artifactFollowupAttributions = message.context.artifactFollowupAttributions;
              draft.pullRequestChecks = message.context.pullRequestChecks ?? [];
            });
            afterDraft = dependencies.getDraft(scope);
            changes = dependencies.captureChanges(scope, () => {
              restoreAttachments(message);
              restoreQueuedMcp(message);
            });
            dependencies.setPresentationSuggestion(scope, message.context.presentationSuggestionDraft ?? null);
            editedPrompt = getPromptText();
            return result;
          },
          shouldCommit: value => value != null,
          onCommit: (_value, handle) => {
            dependencies.trackEditHistory(scope, handle, originalPrompt, editedPrompt, () => {
              dependencies.cleanupDraftAttachments(scope, executionHostId, pastedTextAttachments);
            });
            focusComposer();
          },
          redo: async () => {
            const next = await queuedFollowUps.actions.beginEdit(result?.message.id ?? messageId);
            if (next == null) throw Error('Queued message is no longer available');
            result = next;
            dependencies.applyChanges(scope, changes, 'redo');
            setEditingMessagePosition(position);
            setPriorConversation(next.message.context.priorConversation ?? null);
            if (getPromptText() !== editedPrompt) controller.restoreText(next.message.text);
            dependencies.restoreDraft(scope, afterDraft);
            dependencies.setPresentationSuggestion(scope, next.message.context.presentationSuggestionDraft ?? null);
          },
          undo: async () => {
            if (result == null) return;
            await queuedFollowUps.actions.restoreEdit(result);
            dependencies.applyChanges(scope, changes, 'undo');
            setEditingMessagePosition(null);
            setPriorConversation(priorConversation);
            if (getPromptText() !== originalPrompt) controller.setPromptText(originalPrompt);
            dependencies.restoreDraft(scope, beforeDraft);
            dependencies.setPresentationSuggestion(scope, originalSuggestion);
          },
        });
      };

      const handleEditedMessageSubmitted = async () => {
        if (editingMessagePosition != null) {
          dependencies.clearEditHistory(scope);
          setEditingMessagePosition(null);
        }
      };

      const handleDeleteMessage = async (messageId: string) => {
        let result: QueueDeleteResult<Comment, PriorConversation> | null = null;
        const cleanup = () => {
          if (result != null) dependencies.cleanupQueuedAttachments(
            scope, executionHostId, result.message.context.fileAttachments,
            result.message.context.pastedTextAttachments ?? [],
          );
        };
        await dependencies.runUndoable(scope, {
          label: dependencies.formatUndoLabel({
            id: 'appUndo.queuedMessageDeleted',
            defaultMessage: 'Queued message restored',
            description: 'Toast shown after undo restores a deleted message to the message queue',
          }),
          onFinalize: reason => { if (reason === 'undo') cleanup(); },
          transitionQueueKey: `queued-message:${conversationId ?? 'new'}`,
        }, {
          perform: async () => {
            result = await queuedFollowUps.actions.remove(messageId);
            if (result?.canRestore === false) cleanup();
            return result;
          },
          shouldCommit: value => value != null && value.canRestore !== false,
          redo: async () => {
            const next = await queuedFollowUps.actions.remove(result?.message.id ?? messageId);
            if (next == null) throw Error('Queued message is no longer available');
            result = next;
          },
          undo: async () => { if (result != null) await queuedFollowUps.actions.restore(result); },
        });
      };

      const handleSendNowMessage = async (messageId: string) => {
        await queuedFollowUps.actions.start({
          scope, conversationId, executionHostId, messageId, submission: queuedSubmission,
          onSendResult: (outcome, result) => dependencies.recordSend(
            remoteSshMessageAnalyticsContext, outcome, { turnId: result?.turnId },
          ),
        });
      };
      return {
        handleEditMessage, handleDeleteMessage, handleSendNowMessage, handleEditedMessageSubmitted,
        restoreQueuedMessageDraft: (message: QueuedComposerMessage<Comment, PriorConversation>) => { restoreDraft(message); restoreQueuedMcp(message); },
        restoreSubmittedDraft: (message: QueuedComposerMessage<Comment, PriorConversation>) => {
          restoreDraft(message);
          dependencies.restoreSubmittedMcpContext(scope, message.context.mcpAppModelContextAttachments ?? []);
        },
      };
    }, [scope, controller, conversationId, executionHostId, focusComposer, incrementAttachmentGeneration,
      queuedSubmission, pastedTextAttachments, priorConversation, queuedFollowUps.actions,
      remoteSshMessageAnalyticsContext, setComments, setPriorConversation, editingMessagePosition]);

    const messageListActions = React.useMemo(() => ({
      onEditMessage: (id: string) => { controls.handleEditMessage(id).catch(onError); },
      onDeleteMessage: (id: string) => { controls.handleDeleteMessage(id).catch(onError); },
      onSendNowMessage: (id: string) => { controls.handleSendNowMessage(id).catch(onError); },
      onReorderMessages: (ids: string[]) => { queuedFollowUps.actions.reorder(ids).catch(onError); },
      onResumeInterruptedQueue: () => { queuedFollowUps.actions.resumeInterruptedSteers().catch(onError); },
    }), [controls, onError, queuedFollowUps.actions]);

    return React.useMemo(() => ({
      editingMessageId: editingMessagePosition?.messageId ?? null,
      editingMessagePosition,
      ...controls,
      messageListActions,
    }), [editingMessagePosition, controls, messageListActions]);
  };
}
