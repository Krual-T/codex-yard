/** @jsxRuntime classic */
import type { ComponentType, ReactNode, Ref, RefObject } from 'react';
import type { AssistantMessageActionsProps } from './assistant-message-actions.tsx';
import type { AssistantMemoryCitation } from './assistant-message-overflow.tsx';

export type AssistantMessageDomain = {
  autoReviewStats: { rejectedCount: number };
  hookStats: unknown;
  memoryCitation: AssistantMemoryCitation;
  goal: unknown;
  automationArguments: object;
  automationResult: unknown;
  responseAnnotation: { text: string };
  handoff: unknown;
  completedResult: unknown;
  outputFileLinks: unknown;
  visualizationPaths: unknown;
  fileOpenTarget: unknown;
  visualizationTrigger: unknown;
  intl: unknown;
  markdownComponents: unknown;
  markdownToken: unknown;
  deliveryAction: unknown;
  externalDelivery: { provider?: string; state?: string; attachmentCount?: number };
};
type AutomationCitation<D extends AssistantMessageDomain> = {
  arguments: D['automationArguments']; result: D['automationResult']; callId: string;
};
type DirectiveAttributes = { attributes: Record<string, unknown>; groupedAttributes?: Record<string, unknown>[] };
type Directives = Record<string, unknown>;
type Scope = { value: { routeTemplate?: string; routeKind?: string; conversationId?: string | null } };

export type AssistantMessageItem<D extends AssistantMessageDomain> = {
  type: 'assistant-message';
  content: string;
  completed: boolean;
  phase?: string | null;
  searchItemId?: string | null;
  sentAtMs?: number | null;
  structuredOutput?: unknown;
  responseAnnotationTargetId?: string | null;
  responseAnnotations?: D['responseAnnotation'][] | null;
  automationCitations?: AutomationCitation<D>[] | null;
  memoryCitation?: { entries: D['memoryCitation'][] } | null;
  visualizationSourcePathsByFile?: D['visualizationPaths'];
  shareSource?: { itemId: string; text: string } | null;
  computerHandoff?: D['handoff'] | null;
  requestUserInputAsync?: { questionIndex?: number | null } | null;
  externalDelivery?: D['externalDelivery'] | null;
  nativeMessage?: { roomId: string; messageId: string } | null;
  delivery?: string | null;
  aeonSentMessage?: boolean;
  renderPlaceholderWhileStreaming?: boolean;
  isRevealPending?: () => boolean | undefined;
  onRevealComplete?: () => void;
};

export type AssistantMessageProps<D extends AssistantMessageDomain> = {
  item: AssistantMessageItem<D>;
  assistantCopyText?: string | null;
  turnId?: string | null;
  autoReviewStats?: D['autoReviewStats'] | null;
  hookStats?: D['hookStats'] | null;
  after?: ReactNode;
  compactAttachment?: ReactNode;
  electronAfter?: ReactNode;
  conversationId: string;
  getVisualizeTurnTriggerType?: () => D['visualizationTrigger'];
  cwd?: string | null;
  hostId?: string | null;
  markdownMediaCacheKey?: string | null;
  onAddResponseTextAnnotation?: (text: string, range: Range) => void;
  onNavigateResponseTextAnnotation?: (annotation: D['responseAnnotation']) => void;
  onFileLinkOpen?: (path: string, target: D['fileOpenTarget']) => void;
  onFork?: () => void;
  completedThreadGoal?: D['goal'] | null;
  additionalActions?: ReactNode[] | null;
  persistentAdditionalActions?: ReactNode[] | null;
  trailingActions?: ReactNode[] | null;
  renderUsedSkillsDetails?: (close: () => void) => ReactNode;
  showShimmer?: boolean;
  alwaysShowActions?: boolean;
  sourceTurnId?: string | null;
  savedContentResponseId?: string | null;
  projectlessOutputDirectory?: string | null;
  outputFileLinks?: D['outputFileLinks'] | null;
  forceCodeBlockWordWrap?: boolean;
  hasArtifacts?: boolean;
  reportEntityType?: string;
  showActionRow?: boolean;
  showTimestampHeader?: boolean;
  showTimestampWithoutActions?: boolean;
  timestampHoverOnly?: boolean;
  renderCodeBlocksAsWritingBlocks?: boolean;
  allowCopyWhileStreaming?: boolean;
};

export type AssistantMarkdownProps<D extends AssistantMessageDomain> = {
  children: string;
  className: string;
  textStyle: { kind: 'assistant-message' };
  buffering?: { kind: 'adaptive'; streamId: string };
  components?: D['markdownComponents'];
  directiveIdPrefix?: string | null;
  conversationId: string;
  getVisualizeTurnTriggerType?: () => D['visualizationTrigger'];
  cwd?: string | null;
  hostId?: string | null;
  mediaCacheKey?: [string, string];
  visualizationSourcePathsByFile?: D['visualizationPaths'];
  turnId?: string | null;
  savedContentResponse?: { conversationId: string; responseId: string; savedContentBackend: unknown };
  allowWideBlocks: true;
  animate: boolean;
  directives: Directives;
  externalLinkAppearance?: 'underlined-text';
  fadeSegmentDelayMs?: number;
  fadeSegmentMaxDelayMs?: number;
  isStreaming: boolean;
  forceCodeBlockWordWrap: boolean;
  isBrowserEnabled: boolean;
  onAddSelectedTextToChat?: (text: string, range: Range) => void;
  onFileLinkOpen?: (path: string, target: D['fileOpenTarget']) => void;
  openFileLinksInSidePanel: true;
  renderCodeBlocksImmediately: true;
  renderCodeBlocksAsWritingBlocks: boolean;
  renderInlineVisualizations: true;
  renderRoot?: (tokens: D['markdownToken'][], renderTokens: (tokens: D['markdownToken'][]) => ReactNode) => ReactNode;
};

export type AssistantMessageDependencies<D extends AssistantMessageDomain> = {
  useScope: () => Scope;
  useIntl: () => D['intl'];
  useBrowserEnabled: () => boolean;
  useIsAeon: (conversationId: string) => boolean;
  useAeonFormatting: (conversationId: string) => boolean;
  useAeonReveal: (enabled: boolean, conversationId: string) => { displayed: boolean; messageId: string } | null | undefined;
  useNativeMessageEnabled: (enabled: boolean, conversationId: string) => boolean | null | undefined;
  useNativeMessageFeature: (enabled: boolean) => boolean;
  getDeliveryAction: (item: AssistantMessageItem<D>) => D['deliveryAction'] | null;
  describeDelivery: (text: string, attachmentCount: number, intl: D['intl']) => string;
  deliveryActionText: (action: D['deliveryAction'], intl: D['intl']) => string;
  prepareCopyText: (text: string, options: { conversationId: string; turnId?: string | null; cwd?: string | null;
    projectlessOutputDirectory: string | null; annotations?: D['responseAnnotation'][] | null; intl: D['intl'] }) => string;
  formatDisplayContent: (content: string, options: { isStreaming: boolean }) => string;
  hasAutomationCitationMarker: (content: string) => boolean;
  formatAutomationCitation: (citation: AutomationCitation<D>, index: number) => string;
  extractCompletedResults: (content: string) => D['completedResult'][];
  createFileDirectives: (options: { cwd?: string | null; hostId?: string | null; openFileLinksInSidePanel: true;
    shouldRenderPath: (path: string) => boolean }) => Directives;
  shouldRenderOutputPath: (options: { cwd?: string | null; projectlessOutputDirectory: string; resourcePath: string }) => boolean;
  createFollowupDirectives: (options: { conversationId: string; hostId?: string | null; isInteractive: boolean;
    sourceTurnId?: string | null; sourceMessageId?: string | null }) => Directives;
  createAnnotationDirectives: (annotations: D['responseAnnotation'][] | null | undefined, navigate?: (annotation: D['responseAnnotation']) => void) => Directives;
  resolveAutomationCitation: (options: { automationCitations: AutomationCitation<D>[]; automationId: string | null; index?: string }) => AutomationCitation<D> | null;
  directiveNames: { comment: string; writing: string; automation: string; other: string };
  writingDirective: unknown;
  otherDirective: unknown;
  CommentDirective: ComponentType<{ commentAttributes: Record<string, unknown>[]; conversationId: string; cwd?: string | null }>;
  AutomationCitation: ComponentType<D['automationArguments'] & { elicitation: { threadId: string; turnId?: string | null; itemId: string; elicitationType: 'automation_schedule' }; result: D['automationResult'] }>;
  formatMarkdown: (content: string) => string;
  attachOutputLinks: (content: string, links: D['outputFileLinks'] | object | null) => string;
  getSelectionContent: (element: Element) => { plainText: string; htmlText: string } | null;
  shouldOfferAnnotation: (item: AssistantMessageItem<D>) => boolean;
  AnnotationAction: ComponentType<{ hostId?: string | null; conversationId: string; turnId: string; getText: () => string }>;
  ShareAction: ComponentType<{ conversationId: string; hostId?: string | null; response: { turnId: string; itemId: string; expectedText: string } }>;
  markdownComponentsForAeon: D['markdownComponents'];
  savedContentBackend: unknown;
  isDurableHost: (hostId?: string | null) => boolean;
  renderCompactRoot: (tokens: D['markdownToken'][], renderTokens: (tokens: D['markdownToken'][]) => ReactNode,
    attachment: ReactNode, actions: ReactNode[] | null) => ReactNode;
  Markdown: ComponentType<AssistantMarkdownProps<D>>;
  StreamingProvider: ComponentType<{ value: { conversationId: string; isStreaming: boolean; turnId?: string | null }; children: ReactNode }>;
  DeliveryAction: ComponentType<{ action: D['deliveryAction']; attachmentCount: number }>;
  DeliveredMessage: ComponentType<{ text: string; attachmentCount: number }>;
  NativeMessage: ComponentType<{ roomId: string; messageId: string; bodyText: string }>;
  Reveal: ComponentType<{ className: string; reveal: boolean; children: ReactNode }>;
  getAnnouncementContent: (content: string, options: { isStreaming: boolean }) => string;
  trimStreamingAnnouncement: (content: string) => string;
  mergeRefs: (ref: RefObject<HTMLDivElement | null>, other?: Ref<HTMLDivElement>) => Ref<HTMLDivElement>;
  shimmerRef: Ref<HTMLDivElement>;
  annotationDataAttributes: { conversationId: string; messageId: string };
  formatTimestampTitle: (intl: D['intl'], sentAtMs: number) => string;
  Speaker: ComponentType<{ speaker: 'assistant' }>;
  ExternalDeliveryStatus: ComponentType<{ conversationId: string } & D['externalDelivery']>;
  LiveRegion: ComponentType<{ input: { announceCompletedOnMount: boolean; completed: boolean; content: string; cwd?: string | null;
    itemId: string; plainText?: string; projectlessOutputDirectory: string | null } }>;
  Spinner: ComponentType<{ className: string }>;
  Timestamp: ComponentType<{ sentAtMs: number }>;
  ComputerHandoff: ComponentType<{ conversationId?: string | null; handoff: D['handoff'] }>;
  CompletedResults: ComponentType<{ results: D['completedResult'][] }>;
  Actions: ComponentType<AssistantMessageActionsProps<D['autoReviewStats'], D['hookStats'], D['memoryCitation'], D['goal']>>;
  styles: { activeCommentary: string; compactMessageBody: string; compactMessageBubble: string; compactMessageBubbleWithAttachment: string };
  classNames: (...classes: (string | false | null | undefined)[]) => string;
};

export function createAssistantMessageComponent<D extends AssistantMessageDomain>(
  React: typeof import('react'), dependencies: AssistantMessageDependencies<D>,
): ComponentType<AssistantMessageProps<D>> {
  const { Markdown, StreamingProvider, DeliveryAction: DeliveryActionView, DeliveredMessage, NativeMessage, Reveal,
    Speaker, ExternalDeliveryStatus, LiveRegion, Spinner, Timestamp, ComputerHandoff, CompletedResults, Actions,
    AnnotationAction, ShareAction, AutomationCitation: AutomationCitationView, CommentDirective } = dependencies;
  const emptyCitations: AutomationCitation<D>[] = [];
  return function AssistantMessage({ item, assistantCopyText, turnId, autoReviewStats, hookStats, after, compactAttachment,
    electronAfter, conversationId, getVisualizeTurnTriggerType, cwd, hostId, markdownMediaCacheKey,
    onAddResponseTextAnnotation, onNavigateResponseTextAnnotation, onFileLinkOpen, onFork, completedThreadGoal,
    additionalActions, persistentAdditionalActions, trailingActions, renderUsedSkillsDetails, showShimmer = false,
    alwaysShowActions = false, sourceTurnId = turnId, savedContentResponseId, projectlessOutputDirectory = null,
    outputFileLinks, forceCodeBlockWordWrap = false, hasArtifacts = false, reportEntityType = 'thread',
    showActionRow = true, showTimestampHeader = false, showTimestampWithoutActions = false, timestampHoverOnly = false,
    renderCodeBlocksAsWritingBlocks = false, allowCopyWhileStreaming = false }: AssistantMessageProps<D>) {
    const scope = dependencies.useScope();
    const intl = dependencies.useIntl();
    const isBrowserEnabled = dependencies.useBrowserEnabled();
    const isAeon = dependencies.useIsAeon(conversationId);
    const aeonFormatted = dependencies.useAeonFormatting(conversationId);
    const contentRef = React.useRef<HTMLDivElement>(null);
    const aeonReveal = dependencies.useAeonReveal(isAeon, conversationId);
    const revealPending = React.useMemo(() => item.isRevealPending?.(), [item]);
    const canReveal = item.onRevealComplete != null && revealPending !== false;
    const deliveryAction = dependencies.getDeliveryAction(item);
    const delivered = item.externalDelivery?.provider === 'tibro' || item.externalDelivery?.state === 'accepted';
    const nativeEnabled = dependencies.useNativeMessageEnabled(item.nativeMessage != null, conversationId);
    const nativeFeature = dependencies.useNativeMessageFeature(item.nativeMessage != null);
    const attachmentCount = item.externalDelivery?.attachmentCount ?? 0;
    const reveal = isAeon && aeonFormatted && item.delivery !== 'async'
      && (deliveryAction != null || delivered || item.aeonSentMessage !== true);
    const finishReveal = React.useEffectEvent(() => {
      const element = contentRef.current;
      const complete = item.onRevealComplete;
      if (complete == null || element == null) return;
      let cancelled = false;
      let finished = false;
      const finish = () => { if (!cancelled && !finished) { finished = true; complete(); } };
      const animations = element.getAnimations({ subtree: true }).filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity);
      void Promise.allSettled(animations.map(animation => animation.finished)).then(finish);
      return () => { if (revealPending === true) finish(); else cancelled = true; };
    });
    React.useEffect(() => { if (canReveal) return finishReveal(); }, [canReveal, item.searchItemId]);
    const deliveryText = deliveryAction == null
      ? delivered ? dependencies.describeDelivery(item.content, attachmentCount, intl) : undefined
      : dependencies.describeDelivery(dependencies.deliveryActionText(deliveryAction, intl), attachmentCount, intl);
    const getCopyText = () => deliveryText ?? dependencies.prepareCopyText(assistantCopyText ?? '', {
      conversationId, turnId, cwd, projectlessOutputDirectory, annotations: item.responseAnnotations, intl,
    });
    const copyText = getCopyText();
    const canCopy = (item.completed || allowCopyWhileStreaming) && copyText.trim().length > 0;
    const citations = item.automationCitations ?? emptyCitations;
    const hasCitationMarker = citations.length > 0 && dependencies.hasAutomationCitationMarker(item.content);
    const content = dependencies.formatDisplayContent(item.content, { isStreaming: !item.completed });
    const contentWithCitations = hasCitationMarker ? `${content.trimEnd()}\n\n${citations.map(dependencies.formatAutomationCitation).join('\n\n')}` : content;
    const completedResults = item.completed && !isAeon ? dependencies.extractCompletedResults(item.content) : [];
    const memoryEntries = item.memoryCitation?.entries.filter(entry => entry.path.trim().length > 0) ?? [];
    const fileDirectives = React.useMemo(() => projectlessOutputDirectory == null ? undefined : dependencies.createFileDirectives({ cwd, hostId,
      openFileLinksInSidePanel: true, shouldRenderPath: path => dependencies.shouldRenderOutputPath({ cwd, projectlessOutputDirectory, resourcePath: path }) }),
    [cwd, hostId, projectlessOutputDirectory]);
    const automationDirectives = React.useMemo(() => hasCitationMarker ? { [dependencies.directiveNames.automation]: ({ attributes }: DirectiveAttributes) => {
      const citation = dependencies.resolveAutomationCitation({ automationCitations: citations,
        automationId: typeof attributes.automation_id === 'string' ? attributes.automation_id : null,
        index: typeof attributes.index === 'string' ? attributes.index : undefined });
      return citation == null ? null : <AutomationCitationView {...citation.arguments} elicitation={{ threadId: conversationId,
        turnId: sourceTurnId, itemId: citation.callId, elicitationType: 'automation_schedule' }} result={citation.result} />;
    } } : undefined, [citations, conversationId, hasCitationMarker, sourceTurnId]);
    const commentDirective = React.useMemo(() => Object.assign(({ attributes, groupedAttributes }: DirectiveAttributes) => <CommentDirective
      commentAttributes={groupedAttributes ?? [attributes]} conversationId={conversationId} cwd={cwd} />, { groupConsecutive: true }), [conversationId, cwd]);
    const interactive = item.completed && item.phase !== 'commentary';
    const followupDirectives = React.useMemo(() => dependencies.createFollowupDirectives({ conversationId, hostId, isInteractive: interactive,
      sourceTurnId, sourceMessageId: item.responseAnnotationTargetId }), [conversationId, hostId, interactive, sourceTurnId, item.responseAnnotationTargetId]);
    const annotationDirectives = React.useMemo(() => dependencies.createAnnotationDirectives(item.responseAnnotations, onNavigateResponseTextAnnotation),
      [item.responseAnnotations, onNavigateResponseTextAnnotation]);
    const directives = React.useMemo(() => ({ [dependencies.directiveNames.comment]: commentDirective, [dependencies.directiveNames.writing]: dependencies.writingDirective,
      ...followupDirectives, ...fileDirectives, ...automationDirectives, [dependencies.directiveNames.other]: dependencies.otherDirective,
      ...annotationDirectives }), [commentDirective, followupDirectives, fileDirectives, automationDirectives, annotationDirectives]);
    const getSelectedContent = () => {
      const element = contentRef.current?.querySelector('[data-selected-text-overlay-target]');
      return element == null ? null : dependencies.getSelectionContent(element);
    };
    const getCopyHtml = () => getSelectedContent()?.htmlText ?? null;
    const getSelectedText = () => {
      const element = contentRef.current?.querySelector('[data-selected-text-overlay-target]');
      return element == null ? getCopyText() : dependencies.getSelectionContent(element)?.plainText ?? '';
    };
    const persistentActions = showActionRow && item.completed && canCopy && dependencies.shouldOfferAnnotation(item)
      ? [...persistentAdditionalActions ?? [], <AnnotationAction key="annotation" hostId={hostId} conversationId={conversationId}
        turnId={turnId ?? item.responseAnnotationTargetId ?? String(item.sentAtMs)} getText={getSelectedText} />] : persistentAdditionalActions;
    const showActionsOrTimestamp = !aeonFormatted && (showActionRow || showTimestampWithoutActions);
    const actions = !aeonFormatted && showActionRow && item.completed && item.shareSource != null && sourceTurnId != null
      ? [...additionalActions ?? [], <ShareAction key="share-response" conversationId={conversationId} hostId={hostId}
        response={{ turnId: sourceTurnId, itemId: item.shareSource.itemId, expectedText: item.shareSource.text }} />] : additionalActions;
    const compactActions = aeonFormatted && (actions?.length ?? 0) > 0 ? actions ?? null : null;
    const annotationTargetId = item.responseAnnotationTargetId?.trim() ? item.responseAnnotationTargetId : undefined;
    const displayText = dependencies.attachOutputLinks(dependencies.formatMarkdown(contentWithCitations), item.completed ? outputFileLinks ?? {} : null);
    const compactMarkdown = aeonFormatted && deliveryAction == null && !delivered;
    const textStyle = React.useMemo(() => ({ kind: 'assistant-message' as const }), []);
    const mediaCacheKey = React.useMemo<[string, string] | undefined>(() => markdownMediaCacheKey == null
      ? undefined : ['local-conversation-turn', markdownMediaCacheKey], [markdownMediaCacheKey]);
    const buffering = React.useMemo(() => item.phase === 'commentary' ? undefined : {
      kind: 'adaptive' as const, streamId: `${conversationId}:${item.searchItemId}`,
    }, [conversationId, item.phase, item.searchItemId]);
    const streamingContext = React.useMemo(() => ({ conversationId, isStreaming: !item.completed, turnId }),
      [conversationId, item.completed, turnId]);
    const renderRoot = React.useMemo<AssistantMarkdownProps<D>['renderRoot']>(() => compactMarkdown
      ? (tokens, renderTokens) => dependencies.renderCompactRoot(tokens, renderTokens, compactAttachment, compactActions)
      : undefined, [compactMarkdown, compactAttachment, compactActions]);
    const markdown = <Markdown className={dependencies.classNames('[&>*:last-child]:mb-0 [&>ol:first-child]:mt-0 [&>ul:first-child]:mt-0',
      compactMarkdown && 'flex flex-col items-start gap-3', showShimmer && dependencies.styles.activeCommentary)}
      textStyle={textStyle} buffering={buffering}
      components={isAeon ? dependencies.markdownComponentsForAeon : undefined} directiveIdPrefix={item.responseAnnotationTargetId ?? item.searchItemId}
      conversationId={conversationId} getVisualizeTurnTriggerType={getVisualizeTurnTriggerType} cwd={cwd} hostId={hostId}
      mediaCacheKey={mediaCacheKey}
      visualizationSourcePathsByFile={item.visualizationSourcePathsByFile} turnId={turnId}
      savedContentResponse={scope.value.routeTemplate === '/ca/:conversationId' && savedContentResponseId != null
        ? { conversationId, responseId: savedContentResponseId, savedContentBackend: dependencies.savedContentBackend } : undefined}
      allowWideBlocks={true} animate={!reveal && (canReveal || !item.completed)} directives={directives}
      externalLinkAppearance={aeonFormatted ? 'underlined-text' : undefined} fadeSegmentDelayMs={canReveal ? 16 : undefined}
      fadeSegmentMaxDelayMs={canReveal ? 96 : undefined} isStreaming={!item.completed} forceCodeBlockWordWrap={forceCodeBlockWordWrap}
      isBrowserEnabled={isBrowserEnabled} onAddSelectedTextToChat={renderCodeBlocksAsWritingBlocks && annotationTargetId != null
        && (!isAeon || !dependencies.isDurableHost(hostId)) ? onAddResponseTextAnnotation : undefined}
      onFileLinkOpen={onFileLinkOpen} openFileLinksInSidePanel={true} renderCodeBlocksImmediately={true}
      renderCodeBlocksAsWritingBlocks={renderCodeBlocksAsWritingBlocks} renderInlineVisualizations={true}
      renderRoot={renderRoot}>{displayText}</Markdown>;
    let body: ReactNode = <StreamingProvider value={streamingContext}>{markdown}</StreamingProvider>;
    if (deliveryAction != null) body = <DeliveryActionView action={deliveryAction} attachmentCount={attachmentCount} />;
    else if (delivered) body = <React.Fragment><DeliveredMessage text={item.content} attachmentCount={attachmentCount} />
      {item.nativeMessage != null && nativeEnabled !== true && !nativeFeature
        ? <NativeMessage roomId={item.nativeMessage.roomId} messageId={item.nativeMessage.messageId} bodyText={item.content} /> : null}</React.Fragment>;
    const hasText = displayText.trim().length > 0;
    const hasBody = deliveryAction != null || delivered || hasText;
    const compactBody = compactMarkdown || compactAttachment == null ? body : <React.Fragment>
      {hasBody ? <div className={dependencies.styles.compactMessageBody}>{body}</div> : null}
      <div className={dependencies.classNames(hasBody && 'border-t-2 border-surface')}>{compactAttachment}</div></React.Fragment>;
    const compactClass = compactMarkdown ? 'w-full min-w-0' : dependencies.classNames('min-w-0', dependencies.styles.compactMessageBubble,
      compactAttachment != null && dependencies.styles.compactMessageBubbleWithAttachment);
    const renderedBody = aeonFormatted && (hasBody || compactAttachment != null) ? reveal
      ? <Reveal className={compactClass} reveal={canReveal && !(aeonReveal?.displayed && aeonReveal.messageId === item.searchItemId)}>{compactBody}</Reveal>
      : <div className={compactClass}>{compactBody}</div> : body;
    const placeholder = item.renderPlaceholderWhileStreaming === true && !item.completed;
    const announcement = placeholder ? '' : dependencies.getAnnouncementContent(displayText, { isStreaming: !item.completed });
    const timestampTitle = !showTimestampHeader && !showActionsOrTimestamp && item.sentAtMs != null
      ? dependencies.formatTimestampTitle(intl, item.sentAtMs) : undefined;
    const attributes = { [dependencies.annotationDataAttributes.conversationId]: annotationTargetId == null ? undefined : conversationId,
      [dependencies.annotationDataAttributes.messageId]: annotationTargetId };
    const mergedRef = React.useMemo(() => dependencies.mergeRefs(contentRef, showShimmer ? dependencies.shimmerRef : undefined), [showShimmer]);
    return <div ref={mergedRef} {...attributes}
      className="group flex min-w-0 flex-col" title={timestampTitle}>
      <Speaker speaker="assistant" />
      {item.externalDelivery == null ? null : <ExternalDeliveryStatus conversationId={conversationId} {...item.externalDelivery} />}
      <LiveRegion input={{ announceCompletedOnMount: reveal && revealPending === true, completed: item.completed,
        content: item.completed ? announcement : dependencies.trimStreamingAnnouncement(announcement), cwd,
        itemId: `${conversationId}\0${item.searchItemId ?? item.responseAnnotationTargetId ?? item.sentAtMs ?? 'active'}`,
        plainText: deliveryText, projectlessOutputDirectory }} />
      {placeholder ? <div className="flex w-full items-center justify-center pt-8"><Spinner className="icon-sm" /></div> : <React.Fragment>
        {showTimestampHeader && item.sentAtMs != null && (item.requestUserInputAsync?.questionIndex ?? 0) === 0
          && (hasText || item.structuredOutput != null) ? <div className="mb-3 select-none"><Timestamp sentAtMs={item.sentAtMs} /></div> : null}
        {!compactMarkdown && compactActions != null ? <div className="flex max-w-full items-center gap-2">{renderedBody}{compactActions}</div> : renderedBody}
        {item.computerHandoff != null && scope.value.routeKind === 'local-thread' ? <div className="mt-3"><ComputerHandoff conversationId={scope.value.conversationId} handoff={item.computerHandoff} /></div> : null}
        {!hasCitationMarker && citations.length > 0 ? <div>{citations.map(citation => <AutomationCitationView key={citation.callId}
          {...citation.arguments} elicitation={{ threadId: conversationId, turnId: sourceTurnId, itemId: citation.callId,
            elicitationType: 'automation_schedule' }} result={citation.result} />)}</div> : null}
        {completedResults.length === 0 ? null : <div className="mt-3"><CompletedResults results={completedResults} /></div>}
        {after == null ? null : <div className="mt-3">{after}</div>}{electronAfter == null ? null : <div className="mt-3">{electronAfter}</div>}
        {showActionsOrTimestamp ? <Actions alwaysShowActions={showActionRow && (alwaysShowActions || (persistentAdditionalActions?.length ?? 0) > 0)}
          turnId={showActionRow ? turnId : undefined} copyText={showActionRow && canCopy ? copyText : undefined}
          getCopyText={showActionRow ? getCopyText : undefined} getCopyHtml={showActionRow ? getCopyHtml : undefined}
          sentAtMs={showTimestampHeader ? null : item.sentAtMs} threadId={conversationId} reportEntityType={reportEntityType}
          autoReviewStats={showActionRow ? autoReviewStats : null} hookStats={showActionRow ? hookStats : null}
          memoryCitationEntries={showActionRow ? memoryEntries : []} completedThreadGoal={showActionRow && item.completed ? completedThreadGoal : null}
          hasArtifacts={hasArtifacts} onFork={showActionRow && item.completed ? onFork : undefined} showTimestampWithoutActions={showTimestampWithoutActions}
          timestampHoverOnly={timestampHoverOnly} additionalActions={actions} trailingActions={trailingActions}
          renderUsedSkillsDetails={renderUsedSkillsDetails} persistentAdditionalActions={persistentActions} /> : null}
      </React.Fragment>}
    </div>;
  };
}
