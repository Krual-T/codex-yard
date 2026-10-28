/** @jsxRuntime classic */
import type { ComponentType, CSSProperties, MouseEvent, ReactNode, Ref, RefObject } from 'react';
import type { CollapsibleUserMessageContentProps } from './collapsible-user-message-content.tsx';

export type UserMessageBodyProps<Directives> = {
  ref?: Ref<HTMLDivElement>;
  text: string;
  cwd?: string | null;
  hostId?: string | null;
  collapsedLineCount?: number;
  directives?: Directives;
  hasSerializedParagraphs?: boolean;
  isAeonFormatted?: boolean;
  renderMath?: boolean;
  serializeVisibleText?: (text: string) => string | null | undefined;
};

export type UserMessageBodyDependencies<Directives> = {
  useExternalLinkConversationId: () => string | undefined;
  CollapsibleContent: ComponentType<CollapsibleUserMessageContentProps>;
  Markdown: ComponentType<{
    ref?: Ref<HTMLDivElement>;
    cwd?: string | null;
    directives?: Directives;
    externalLinkContextMenuConversationId?: string;
    hostId?: string | null;
    hasSerializedParagraphs?: boolean;
    renderMath?: boolean;
    text: string;
    variant: 'user-message';
  }>;
};

export function createUserMessageBodyComponent<Directives>(
  React: typeof import('react'),
  { useExternalLinkConversationId, CollapsibleContent, Markdown }: UserMessageBodyDependencies<Directives>,
): ComponentType<UserMessageBodyProps<Directives>> {
  return function UserMessageBody({
    ref, text, cwd, hostId, collapsedLineCount, directives, hasSerializedParagraphs,
    isAeonFormatted, renderMath, serializeVisibleText,
  }: UserMessageBodyProps<Directives>) {
    const externalLinkContextMenuConversationId = useExternalLinkConversationId();
    const renderText = React.useCallback((visibleText: string): ReactNode => <Markdown
      ref={ref}
      cwd={cwd}
      directives={directives}
      externalLinkContextMenuConversationId={externalLinkContextMenuConversationId}
      hostId={hostId}
      hasSerializedParagraphs={hasSerializedParagraphs}
      renderMath={renderMath}
      text={serializeVisibleText?.(visibleText) ?? visibleText}
      variant="user-message"
    />, [ref, cwd, directives, externalLinkContextMenuConversationId, hostId, hasSerializedParagraphs, renderMath, serializeVisibleText]);
    return <CollapsibleContent collapsedLineCount={collapsedLineCount} isAeonFormatted={isAeonFormatted} text={text}>{renderText}</CollapsibleContent>;
  };
}

type MessageDescriptor = { id: string; defaultMessage: string; description: string; values?: { count: number } };
type UserMessageDraft = {
  authoredMarkdownLinkSourcesByOccurrence: (string | null)[] | null;
  literalMarkdownLinkSources: (string | null)[] | null;
  message: string;
  renderFormat?: 'markdown';
};
type UserMessageStyles = {
  bubble: string;
  leadingBubble: string;
  compactMessageReaction: string;
  compactMessageBubble: string;
  compactMessageContainer: string;
  otherUserMessage: string;
  accentedBubble: string;
  temporaryBubble: string;
  temporaryOutline: string;
};

export type UserMessageSystemHint = 'search' | 'picture_v2' | 'cme' | 'tatertot' | 'tasks' | 'note';
export type UserMessageProps<HookStats, InlineSystemHints extends UserMessageSystemHint[]> = {
  message: string;
  alignment?: 'start' | 'end';
  accentColor?: string | null;
  senderAccountUserId?: string | null;
  sentAtMs?: number | null;
  collapsedLineCount?: number;
  alwaysShowActions?: boolean;
  compactActions?: boolean;
  hideActions?: boolean;
  messageStatus?: ReactNode;
  messageStatusIcon?: ReactNode;
  messageReaction?: ReactNode;
  messageReactionPlacement?: 'corner' | 'below';
  hookStats?: HookStats | null;
  referencesPriorConversation?: boolean;
  reviewMode?: boolean;
  pullRequestFixMode?: boolean;
  autoResolveSync?: boolean;
  allowEmptyEditMessage?: boolean;
  enablePlainMessageRichTextEditing?: boolean;
  hasExternalAttachments?: boolean;
  isAeonFormatted?: boolean | null;
  isTemporaryChat?: boolean;
  commentCount?: number;
  additionalActions?: ReactNode;
  messageHeader?: ReactNode;
  messageContent?: ReactNode | ((isAeonFormatted: boolean) => ReactNode);
  copyContentRef?: RefObject<HTMLElement | null>;
  copyPlainTextFromSource?: boolean;
  editMessageFormat?: 'markdown';
  enableChatGptSystemHints?: boolean;
  initialEditMessage?: string | null;
  onCopy?: () => void;
  onEditInputMount?: (element: HTMLElement) => void | (() => void);
  onEditMessage?: (message: string, format?: 'markdown', hints?: InlineSystemHints) => void | Promise<void>;
  onCopySucceeded?: (text: string, event: MouseEvent<HTMLButtonElement>) => void;
  threadId?: string | null;
  turnId?: string | null;
  cwd?: string | null;
  hostId?: string | null;
};

export type UserMessageDependencies<Scope, HookStats, InlineSystemHints extends UserMessageSystemHint[]> = {
  useScope: () => Scope;
  getThreadId: (scope: Scope) => string | null | undefined;
  useIsAeonFormatted: (enabled: boolean, threadId: string | null | undefined) => boolean;
  useCurrentUser: (enabled: boolean) => { accountUserId?: string | null; email?: string | null } | null | undefined;
  useEditDraft: (turnId: string | null | undefined) => UserMessageDraft | null | undefined;
  setEditDraft: (scope: Scope, turnId: string | null | undefined, draft: UserMessageDraft | null) => void;
  useEditingDisabled: () => boolean;
  isEditingDisabled: (scope: Scope) => boolean;
  useIntl: () => { formatMessage: (message: MessageDescriptor) => string };
  useAnalytics: () => { submitCodexAnalyticsEvent?: (event: {
    action: 'copy' | 'edit'; eventKind: 'action'; metadata: { surface: 'user_message' }; threadId: string; turnId: string;
  }) => void };
  normalizeMessage: (message: string) => string;
  isPlanImplementationRequest: (message: string) => boolean;
  getCopyContent: (ref: RefObject<HTMLElement | null>) => { plainText: string; htmlText: string } | null;
  toPlainText: (message: string) => string;
  copyToClipboard: (content: string | { 'text/plain': string; 'text/html': string }) => Promise<boolean>;
  UserMessageBody: ComponentType<UserMessageBodyProps<never>>;
  Editor: ComponentType<{
    allowEmptyMessage: boolean;
    cwd: string | null;
    enableChatGptSystemHints?: boolean;
    enablePlainMessageRichTextEditing: boolean;
    hostId?: string | null;
    initialAuthoredMarkdownLinkSourcesByOccurrence: (string | null)[] | null;
    initialMessage: string;
    initialLiteralMarkdownLinkSources: (string | null)[] | null;
    initialRenderFormat?: 'markdown';
    onCancel: () => void;
    onDraftChange: (draft: UserMessageDraft) => void;
    onEditInputMount?: (element: HTMLElement) => void | (() => void);
    onSubmit: (message: string, format?: 'markdown', hints?: InlineSystemHints) => Promise<void>;
  }>;
  Button: ComponentType<{
    className: string; color: 'ghost'; size: 'icon'; 'aria-label': string;
    onClick?: (event: MouseEvent<HTMLButtonElement>) => void; children: ReactNode;
  }>;
  Tooltip: ComponentType<{ tooltipContent: ReactNode; children: ReactNode }>;
  FormattedMessage: ComponentType<MessageDescriptor>;
  Timestamp: ComponentType<{ sentAtMs: number }>;
  HookStatsButton: ComponentType<{ stats: HookStats }>;
  CopyIcon: ComponentType<{ className: string }>;
  CopiedIcon: ComponentType<{ className: string }>;
  EditIcon: ComponentType<{ className: string }>;
  styles: UserMessageStyles;
  classNames: (...classes: (string | false | null | undefined)[]) => string;
};

export function createUserMessageComponent<Scope, HookStats, InlineSystemHints extends UserMessageSystemHint[]>(
  React: typeof import('react'),
  dependencies: UserMessageDependencies<Scope, HookStats, InlineSystemHints>,
): ComponentType<UserMessageProps<HookStats, InlineSystemHints>> {
  const {
    useScope, getThreadId, useIsAeonFormatted, useCurrentUser, useEditDraft, setEditDraft,
    useEditingDisabled, isEditingDisabled, useIntl, useAnalytics, normalizeMessage, isPlanImplementationRequest,
    getCopyContent, toPlainText, copyToClipboard, UserMessageBody, Editor, Button, Tooltip, FormattedMessage,
    Timestamp, HookStatsButton, CopyIcon, CopiedIcon, EditIcon, styles, classNames,
  } = dependencies;

  function StatusText({ children }: { children: ReactNode }) {
    return <span className="text-codex-description text-xs">{children}</span>;
  }

  return function UserMessage({
    message, alignment = 'end', accentColor, senderAccountUserId, sentAtMs, collapsedLineCount,
    alwaysShowActions = false, compactActions = false, hideActions = false, messageStatus, messageStatusIcon,
    messageReaction, messageReactionPlacement = 'corner', hookStats, referencesPriorConversation = false,
    reviewMode = false, pullRequestFixMode = false, autoResolveSync = false, allowEmptyEditMessage = false,
    enablePlainMessageRichTextEditing = false, hasExternalAttachments = false, isAeonFormatted,
    isTemporaryChat = false, commentCount = 0, additionalActions, messageHeader, messageContent,
    copyContentRef, copyPlainTextFromSource = false, editMessageFormat, enableChatGptSystemHints,
    initialEditMessage, onCopy, onEditInputMount, onEditMessage, onCopySucceeded, threadId, turnId, cwd, hostId,
  }: UserMessageProps<HookStats, InlineSystemHints>) {
    const scope = useScope();
    const editingDisabled = useEditingDisabled();
    const effectiveThreadId = threadId ?? getThreadId(scope);
    const defaultAeonFormatted = useIsAeonFormatted(isAeonFormatted == null, effectiveThreadId);
    const aeonFormatted = isAeonFormatted ?? defaultAeonFormatted;
    const currentUser = useCurrentUser(senderAccountUserId != null);
    const otherUser = currentUser != null && senderAccountUserId !== currentUser.accountUserId && senderAccountUserId !== currentUser.email;
    const normalizedMessage = normalizeMessage(message);
    const trimmedMessage = normalizedMessage.trim();
    const isPlanRequest = isPlanImplementationRequest(normalizedMessage);
    const canEdit = onEditMessage != null && turnId != null && !isPlanRequest;
    const [copied, setCopied] = React.useState(false);
    const bodyRef = React.useRef<HTMLDivElement>(null);
    const copying = React.useRef(false);
    const editDraft = useEditDraft(turnId);
    const isEditing = canEdit && editDraft != null;
    const intl = useIntl();
    const analytics = useAnalytics();
    const displayMessage = isPlanRequest ? intl.formatMessage({ id: 'codex.userMessage.implementPlan', defaultMessage: 'Yes, implement this plan', description: 'Display text for the synthetic implement-plan follow-up prompt' }) : normalizedMessage;
    const hasText = displayMessage.trim().length > 0;
    const hasChips = referencesPriorConversation || reviewMode || pullRequestFixMode || autoResolveSync || hasExternalAttachments || commentCount > 0;
    const showBubble = hasText || !hasChips;
    const showStatusRow = hasChips || messageStatus != null || (!compactActions && !hideActions && !aeonFormatted);
    const updateDraft = (draft: UserMessageDraft | null) => setEditDraft(scope, turnId, draft);
    const handleCopy = (event: MouseEvent<HTMLButtonElement>) => {
      if (copying.current) return;
      copying.current = true;
      onCopy?.();
      if (threadId != null && turnId != null) analytics.submitCodexAnalyticsEvent?.({ action: 'copy', eventKind: 'action', metadata: { surface: 'user_message' }, threadId, turnId });
      const content = isPlanRequest ? null : getCopyContent(copyContentRef ?? bodyRef);
      const plainText = !copyPlainTextFromSource && content != null ? content.plainText : toPlainText(trimmedMessage);
      const clipboardContent = content == null ? plainText : {
        'text/plain': plainText,
        'text/html': copyPlainTextFromSource ? `<div style="white-space: pre-wrap">${content.htmlText}</div>` : content.htmlText,
      };
      void copyToClipboard(clipboardContent).then(success => {
        if (success) {
          onCopySucceeded?.(plainText, event);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }
      }).finally(() => { copying.current = false; });
    };
    const handleEdit = () => {
      if (isEditingDisabled(scope)) return;
      if (threadId != null && turnId != null) analytics.submitCodexAnalyticsEvent?.({ action: 'edit', eventKind: 'action', metadata: { surface: 'user_message' }, threadId, turnId });
      if (editDraft == null) updateDraft({
        authoredMarkdownLinkSourcesByOccurrence: null, literalMarkdownLinkSources: null,
        message: initialEditMessage?.trim() ?? trimmedMessage, renderFormat: editMessageFormat,
      });
    };
    const submitEdit = async (nextMessage: string, format?: 'markdown', hints?: InlineSystemHints) => {
      if (onEditMessage == null) return;
      try {
        if (hints != null) await onEditMessage(nextMessage, format, hints);
        else if (format != null) await onEditMessage(nextMessage, format);
        else await onEditMessage(nextMessage);
        updateDraft(null);
      } catch {
        // Keep the draft open when the upstream edit fails.
      }
    };
    const body = hasText
      ? (typeof messageContent === 'function' ? messageContent(aeonFormatted) : messageContent) ?? <UserMessageBody ref={bodyRef} text={displayMessage} cwd={cwd ?? null} hostId={hostId} collapsedLineCount={collapsedLineCount} isAeonFormatted={aeonFormatted} />
      : <div className="mb-px text-size-chat text-codex-description"><FormattedMessage id="codex.userMessage.noContent" defaultMessage="(No content)" description="Text for when a user message has no content" /></div>;
    const copyLabel = copied
      ? intl.formatMessage({ id: 'codex.userMessage.copiedAriaLabel', defaultMessage: 'Copied', description: 'Aria label for the copy button after the content has been copied' })
      : intl.formatMessage({ id: 'codex.userMessage.copyAriaLabel', defaultMessage: 'Copy message', description: "Aria label for the button that copies the user's message" });
    const copyButton = <Tooltip tooltipContent={copyLabel}><Button className="focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0" color="ghost" size="icon" aria-label={copyLabel} onClick={copied ? undefined : handleCopy}>{copied ? <CopiedIcon className="icon-xs" /> : <CopyIcon className="icon-xs" />}</Button></Tooltip>;
    const bubbleClassName = classNames(
      'bg-user-message text-user-message min-w-0 max-w-(--user-chat-width) overflow-hidden break-words px-(--thread-content-margin) [&_.contain-inline-size]:[contain:initial]',
      styles.bubble, alignment === 'start' && styles.leadingBubble, aeonFormatted && styles.compactMessageBubble,
      otherUser && styles.otherUserMessage, accentColor != null && styles.accentedBubble, aeonFormatted ? 'py-2' : 'py-2.5',
      isTemporaryChat ? styles.temporaryBubble : 'rounded-2xl', !hasText && 'leading-none',
    );
    const bubble = isEditing && editDraft != null ? <div className="w-full p-px"><Editor
      allowEmptyMessage={allowEmptyEditMessage} cwd={cwd ?? null} enableChatGptSystemHints={enableChatGptSystemHints}
      enablePlainMessageRichTextEditing={enablePlainMessageRichTextEditing} hostId={hostId}
      initialAuthoredMarkdownLinkSourcesByOccurrence={editDraft.authoredMarkdownLinkSourcesByOccurrence}
      initialMessage={editDraft.message.trim()} initialLiteralMarkdownLinkSources={editDraft.literalMarkdownLinkSources}
      initialRenderFormat={editDraft.renderFormat} onCancel={() => updateDraft(null)} onDraftChange={updateDraft}
      onEditInputMount={onEditInputMount} onSubmit={submitEdit}
    /></div> : showBubble ? <div data-user-message-bubble={true} className={classNames(bubbleClassName, 'relative text-start')} style={{ '--user-message-accent-color': accentColor } as CSSProperties}>
      {isTemporaryChat ? <svg aria-hidden="true" className={classNames('pointer-events-none absolute inset-0 h-full w-full', styles.temporaryOutline)} focusable="false"><rect x="0.5" y="0.5" width="calc(100% - 1px)" height="calc(100% - 1px)" fill="none" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1" strokeDasharray="8 8" vectorEffect="non-scaling-stroke" /></svg> : null}{body}
    </div> : null;
    const showReaction = !isEditing && messageReaction != null;
    const compactReaction = <div className={classNames(styles.compactMessageReaction, otherUser && styles.otherUserMessage, 'relative flex size-7 items-center justify-center rounded-full border-2 border-surface [&_button]:absolute [&_button]:-inset-0.5 [&_button]:size-auto [&_button]:cursor-default [&_button]:text-sm [&_button]:drop-shadow-none')}>{messageReaction}</div>;
    let renderedBubble: ReactNode = bubble;
    if (aeonFormatted) {
      renderedBubble = <div className={classNames(isEditing ? 'flex w-full flex-col items-end gap-1' : 'grid max-w-full grid-cols-[auto_minmax(0,max-content)] items-center gap-x-2 gap-y-1', additionalActions == null && 'gap-x-0', showReaction && messageHeader == null && 'pt-5')}>
        {messageHeader == null ? null : <div className={classNames('col-start-2 flex min-w-0 justify-end', styles.compactMessageContainer)}>{messageHeader}</div>}
        {!isEditing && additionalActions != null ? <div className="col-start-1">{additionalActions}</div> : null}
        <div className={classNames('relative col-start-2 min-w-0 justify-self-end', isEditing && 'w-full', !isEditing && styles.compactMessageContainer, showReaction && messageHeader != null && 'mt-5')}>
          {bubble}<div className="absolute -start-3.5 -top-5 z-10 translate-x-0.5 translate-y-0.5 rtl:-translate-x-0.5" aria-live="polite" aria-atomic={true}>{showReaction ? compactReaction : null}</div>
        </div>
      </div>;
    } else if (messageReaction != null) {
      renderedBubble = <div className={classNames('relative flex w-full justify-end', messageReactionPlacement === 'corner' && 'mb-2')}>
        {bubble}<div className={messageReactionPlacement === 'below' ? 'absolute end-4 -bottom-5 z-1' : 'absolute -end-0.5 -bottom-0.5 translate-x-1/4 translate-y-1/4 rtl:-translate-x-1/4'} aria-live="polite" aria-atomic={true}>{showReaction ? messageReaction : null}</div>
      </div>;
    }
    const editLabel = intl.formatMessage({ id: 'codex.userMessage.editAriaLabel', defaultMessage: 'Edit message', description: "Tooltip and accessible label for the button that edits the user's message" });
    const renderedContent = compactActions && !hideActions && hasText && !isEditing && !aeonFormatted
      ? <div className={classNames('flex w-full items-center gap-1', alignment === 'start' ? 'flex-row-reverse justify-end' : 'justify-end')}><div className="turn-action-controls opacity-0 group-focus-within/user-message:opacity-100 group-hover/user-message:opacity-100">{copyButton}</div>{renderedBubble}</div>
      : renderedBubble;
    const actionRow = (hasText || canEdit || additionalActions != null) && !isEditing && !compactActions && !hideActions && !aeonFormatted
      ? <div className={classNames('isolate me-1 ms-1 flex items-center gap-2', !alwaysShowActions && 'opacity-0 group-focus-within/user-message:opacity-100 group-hover/user-message:opacity-100 [@media(hover:none)]:opacity-100')}>
        {sentAtMs == null ? null : <span className="flex opacity-0 group-focus-within/user-message:opacity-100 group-hover/user-message:opacity-100"><Timestamp sentAtMs={sentAtMs} /></span>}
        <div className="flex turn-action-controls items-center gap-0.5 browser:gap-0">
          {hookStats == null ? null : <HookStatsButton stats={hookStats} />}{hasText ? copyButton : null}{additionalActions}
          {canEdit && !editingDisabled ? <Tooltip tooltipContent={editLabel}><Button className="focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0" color="ghost" size="icon" aria-label={editLabel} onClick={handleEdit}><EditIcon className="icon-xs" /></Button></Tooltip> : null}
        </div>
      </div> : null;
    return <div className={classNames('group/user-message flex w-full flex-col gap-1', alignment === 'start' ? 'items-start' : 'items-end')}>
      {aeonFormatted ? null : messageHeader}{renderedContent}
      <div className={classNames('flex flex-row-reverse items-center gap-1', messageReactionPlacement === 'below' && showReaction && 'me-12', !showStatusRow && 'hidden')}>
        {messageStatus == null ? null : <div className="ms-1 me-1 flex items-center gap-2">{messageStatusIcon}<StatusText>{messageStatus}</StatusText></div>}
        {referencesPriorConversation && <StatusText><FormattedMessage id="codex.userMessage.priorConversation" defaultMessage="References prior conversation" description="Text for the prior conversation button" /></StatusText>}
        {reviewMode && <StatusText><FormattedMessage id="codex.userMessage.reviewMode" defaultMessage="Review mode" description="Chip shown when a user asked for a code review" /></StatusText>}
        {pullRequestFixMode && <StatusText><FormattedMessage id="codex.userMessage.pullRequestFixMode" defaultMessage="PR fix" description="Chip shown when the user started a pull request CI fix task" /></StatusText>}
        {autoResolveSync && <StatusText><FormattedMessage id="codex.userMessage.autoResolveSync" defaultMessage="Auto resolve conflicts" description="Chip shown when the user requested auto resolve for handoff conflicts" /></StatusText>}
        {commentCount > 0 && <StatusText><FormattedMessage id="codex.userMessage.commentCount" defaultMessage="{count, plural, one {# comment} other {# comments}}" description="Chip shown when the user included inline diff comments in the prompt" values={{ count: commentCount }} /></StatusText>}
        {actionRow}
      </div>
    </div>;
  };
}
