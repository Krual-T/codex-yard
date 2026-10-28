/** @jsxRuntime classic */
import type { ComponentType, MouseEvent, ReactNode, Ref } from 'react';
import type { AssistantMemoryCitation } from './assistant-message-overflow.tsx';

type MessageDescriptor = { id: string; defaultMessage: string; description: string };
type ReviewStats = { rejectedCount: number };
type CopyEvent = MouseEvent<HTMLButtonElement>;
type Rating = 'thumbsUp' | 'thumbsDown';
export type RenderAssistantRatingControl = (props: {
  rating: Rating | null;
  onRate: (rating: Rating) => void;
  shouldRestoreFocus: (rating: Rating | null) => boolean;
}, setRating: (rating: Rating | null) => void) => ReactNode;

export type AssistantMessageActionsProps<AutoReviewStats extends ReviewStats, HookStats, MemoryCitation extends AssistantMemoryCitation, Goal> = {
  tooltipSide?: 'top' | 'bottom';
  browserRatingControls?: ReactNode;
  renderRatingControl?: RenderAssistantRatingControl;
  alwaysShowActions?: boolean;
  turnId?: string | null;
  autoReviewStats?: AutoReviewStats | null;
  hookStats?: HookStats | null;
  memoryCitationEntries?: MemoryCitation[];
  completedThreadGoal?: Goal | null;
  copyText?: string | null;
  getCopyText?: () => string;
  forkDisabled?: boolean;
  forkLabel?: string;
  getCopyHtml?: () => string | null;
  onCopyText?: (text: string, event: CopyEvent) => void;
  onCopySucceeded?: (text: string, event: CopyEvent) => void;
  isForking?: boolean;
  onFork?: () => void;
  sentAtMs?: number | null;
  threadId: string;
  hasArtifacts?: boolean;
  reportEntityType?: string;
  showTimestampWithoutActions?: boolean;
  timestampHoverOnly?: boolean;
  additionalActions?: ReactNode[] | null;
  endAction?: ReactNode;
  overflowActions?: ReactNode;
  persistentAdditionalActions?: ReactNode[] | null;
  trailingActions?: ReactNode[] | null;
  renderUsedSkillsDetails?: (close: () => void) => ReactNode;
  actionRowRef?: Ref<HTMLDivElement>;
};

export type AssistantMessageActionsDependencies<AutoReviewStats extends ReviewStats, HookStats, MemoryCitation extends AssistantMemoryCitation, Goal> = {
  useIntl: () => { formatMessage: (message: MessageDescriptor) => string };
  useAnalytics: () => { submitCodexAnalyticsEvent?: (event: {
    action: 'copy'; eventKind: 'action'; metadata: { surface: 'assistant_message' }; threadId: string; turnId: string;
  }) => void };
  useFeedbackEnabled: () => boolean;
  toPlainText: (text: string) => string;
  copyToClipboard: (content: string | { 'text/plain': string; 'text/html': string }, event: CopyEvent) => Promise<boolean>;
  CopyButton: ComponentType<{ iconOnly: true; iconClassName: string; buttonText: string; onCopy: (event: CopyEvent) => Promise<boolean> }>;
  Feedback: ComponentType<{ hasArtifacts: boolean; reportEntityType: string; renderControl?: RenderAssistantRatingControl; threadId: string; turnId: string }>;
  RejectedReview: ComponentType<{ stats: AutoReviewStats }>;
  OverflowMenu: ComponentType<{
    autoReviewStats?: AutoReviewStats | null; hookStats?: HookStats | null; memoryCitationEntries: MemoryCitation[];
    renderUsedSkillsDetails?: (close: () => void) => ReactNode; forkDisabled: boolean; forkLabel: string;
    isForking: boolean; onFork?: () => void; open: boolean; onOpenChange: (open: boolean) => void;
  }>;
  CompletedGoal: ComponentType<{ goal: Goal }>;
  Timestamp: ComponentType<{ sentAtMs: number }>;
  classNames: (...classes: (string | false | null | undefined)[]) => string;
};

export function createAssistantMessageActionsComponent<AutoReviewStats extends ReviewStats, HookStats, MemoryCitation extends AssistantMemoryCitation, Goal>(
  React: typeof import('react'),
  dependencies: AssistantMessageActionsDependencies<AutoReviewStats, HookStats, MemoryCitation, Goal>,
): ComponentType<AssistantMessageActionsProps<AutoReviewStats, HookStats, MemoryCitation, Goal>> {
  const { useIntl, useAnalytics, useFeedbackEnabled, toPlainText, copyToClipboard, CopyButton, Feedback,
    RejectedReview, OverflowMenu, CompletedGoal, Timestamp, classNames } = dependencies;
  return function AssistantMessageActions({
    tooltipSide = 'top', browserRatingControls, renderRatingControl, alwaysShowActions = false, turnId,
    autoReviewStats, hookStats, memoryCitationEntries = [], completedThreadGoal, copyText, getCopyText,
    forkDisabled = false, forkLabel, getCopyHtml, onCopyText, onCopySucceeded, isForking = false, onFork,
    sentAtMs, threadId, hasArtifacts = false, reportEntityType = 'thread', showTimestampWithoutActions = false,
    timestampHoverOnly = false, additionalActions, endAction, overflowActions, persistentAdditionalActions,
    trailingActions, renderUsedSkillsDetails, actionRowRef,
  }: AssistantMessageActionsProps<AutoReviewStats, HookStats, MemoryCitation, Goal>) {
    const intl = useIntl();
    const analytics = useAnalytics();
    const feedbackEnabled = useFeedbackEnabled();
    const [menuOpen, setMenuOpen] = React.useState(false);
    const effectiveForkLabel = forkLabel ?? intl.formatMessage({ id: 'assistantMessageContent.forkAriaLabel', defaultMessage: 'Fork chat from here', description: 'Aria label for the button that forks the chat from an assistant message' });
    const availableCopyText = copyText != null && copyText.trim().length > 0 ? copyText : null;
    const canRate = feedbackEnabled && turnId != null && analytics.submitCodexAnalyticsEvent != null;
    const feedback = canRate ? <Feedback hasArtifacts={hasArtifacts} reportEntityType={reportEntityType} renderControl={renderRatingControl} threadId={threadId} turnId={turnId} /> : null;
    const hasActions = availableCopyText != null || autoReviewStats != null || hookStats != null
      || memoryCitationEntries.length > 0 || completedThreadGoal != null || onFork != null || canRate
      || browserRatingControls != null || (additionalActions?.length ?? 0) > 0 || overflowActions != null
      || renderUsedSkillsDetails != null || (persistentAdditionalActions?.length ?? 0) > 0 || (trailingActions?.length ?? 0) > 0;
    if (!(hasActions || endAction != null || (showTimestampWithoutActions && sentAtMs != null))) return null;
    return <div ref={actionRowRef} className={classNames(
      'mt-1.5 flex turn-action-controls min-h-5 min-w-0 max-w-(--thread-content-max-width) flex-wrap items-center justify-start gap-0.5 browser:-ms-0.5 browser:mt-3 electron:-translate-x-1 extension:-translate-x-1.5 [&_button]:focus-visible:ring-2 [&_button]:focus-visible:ring-ring [&_button]:focus-visible:ring-offset-0',
      tooltipSide === 'top' && '[--side-tooltip:top]', tooltipSide === 'bottom' && '[--side-tooltip:bottom]',
    )}>
      {hasActions ? <div className={classNames('flex min-h-5 min-w-0 flex-wrap items-center gap-0.5 browser:gap-0',
        alwaysShowActions || menuOpen ? undefined : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100')}>
        {availableCopyText == null ? null : <CopyButton iconOnly={true} iconClassName="icon-xs" buttonText={intl.formatMessage({ id: 'assistantMessageContent.copyResponseTooltip', defaultMessage: 'Copy response', description: 'Tooltip for the button beneath an assistant message that copies the response' })} onCopy={event => {
          if (turnId != null) analytics.submitCodexAnalyticsEvent?.({ action: 'copy', eventKind: 'action', metadata: { surface: 'assistant_message' }, threadId, turnId });
          const html = getCopyHtml?.();
          const text = toPlainText(getCopyText?.() ?? availableCopyText);
          onCopyText?.(text, event);
          return copyToClipboard(html == null ? text : { 'text/plain': text, 'text/html': html }, event).then(success => {
            if (success) onCopySucceeded?.(text, event);
            return success;
          });
        }} />}
        {additionalActions}{persistentAdditionalActions}
        {browserRatingControls === undefined ? feedback : <React.Fragment>{null}<React.Fragment>{feedback}</React.Fragment></React.Fragment>}
        {autoReviewStats != null && autoReviewStats.rejectedCount > 0 ? <RejectedReview stats={autoReviewStats} /> : null}
        {overflowActions ?? <OverflowMenu autoReviewStats={autoReviewStats} hookStats={hookStats} memoryCitationEntries={memoryCitationEntries}
          renderUsedSkillsDetails={renderUsedSkillsDetails} forkDisabled={forkDisabled} forkLabel={effectiveForkLabel}
          isForking={isForking} onFork={onFork} open={menuOpen} onOpenChange={setMenuOpen} />}
        {completedThreadGoal == null ? null : <CompletedGoal goal={completedThreadGoal} />}{trailingActions}
      </div> : null}
      {sentAtMs == null ? null : <span className={classNames('ms-1.5 flex min-h-5 shrink-0 items-center', timestampHoverOnly
        ? 'opacity-0 group-hover:opacity-100' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100')}
        data-assistant-message-sent-time={true}><Timestamp sentAtMs={sentAtMs} /></span>}
      {endAction == null ? null : <div className="ms-auto flex shrink-0 items-center">{endAction}</div>}
    </div>;
  };
}
