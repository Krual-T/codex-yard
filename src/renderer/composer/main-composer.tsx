/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import type * as ReactTypes from 'react';
import type { MainComposerViewDependencies, MainComposerViewProps } from './composer-types.ts';

export function createMainComposerViewComponent(
  React: typeof ReactTypes,
  dependencies: MainComposerViewDependencies,
): ReactTypes.ComponentType<MainComposerViewProps> {
  const { MotionContext, PresentationContext, Parts, Editor, Surface } = dependencies;

  function MainComposerView({
    layoutState,
    editor,
    surfacePlacement,
    hasVisibleAttachments,
    attachments,
    attachmentRef,
    attachmentsHidden = false,
    imageMarkupAttachment,
    replyContext,
    header,
    inputIntegrations,
    leadingActions,
    modelControl,
    secondaryActions,
    primaryAction,
    expansionControl,
    bodyRef,
    footerRef,
    trailingControlsRef,
    actionsRef,
    inputInert,
    isInteractionBlocked = false,
    isGoalMode = false,
    workHome = false,
    voice,
    interaction,
  }: MainComposerViewProps): ReactTypes.ReactNode {
    const motion = React.useContext(MotionContext);
    const presentation = React.useContext(PresentationContext);
    const { layout, setComposerWidthMeasureRef, onSingleLineOverflowChange, onCompositionStateChange } = layoutState;
    const {
      centerPlaceholder, placeholderContent, accessibleStatus, workingStartedAtMs, readOnlyContent, ...editorProps
    } = editor;
    const isHome = surfacePlacement.kind === 'home';
    const isHostedHome = isHome && surfacePlacement.chromeMode === 'hosted';
    const spacing = surfacePlacement.kind === 'hotkey' ? 'flush' : 'default';
    let surfaceVariant: string | undefined;
    let radiusVariant: 'default' | 'compact' | undefined;
    switch (surfacePlacement.kind) {
      case 'document':
        surfaceVariant = 'document';
        radiusVariant = 'default';
        break;
      case 'comment':
        surfaceVariant = surfacePlacement.surfaceVariant;
        radiusVariant = 'compact';
        break;
      case 'embedded':
      case 'hotkey':
        surfaceVariant = 'inline';
        break;
      case 'panel':
        surfaceVariant = 'default';
        break;
    }

    let voiceLayout: ReactTypes.ReactNode = null;
    if (voice?.recording != null) voiceLayout = voice.recording;
    else if (voice?.legacyDictation != null) {
      voiceLayout = <dependencies.LegacyDictation {...voice.legacyDictation} noBottomMargin={surfacePlacement.kind === 'hotkey'} />;
    } else if (voice?.realtime != null) {
      voiceLayout = <dependencies.RealtimeVoice {...voice.realtime} noBottomMargin={surfacePlacement.kind === 'hotkey'} />;
    }

    const input = (
      <Parts.Input
        hidden={voice?.hideEditor}
        inert={inputInert}
        layout={layout}
        placeholderContent={readOnlyContent == null ? placeholderContent : undefined}
        spacing={spacing}
        variant={workHome ? 'work-home' : 'default'}
      >
        {accessibleStatus == null ? null : <span className="sr-only" role="status">{accessibleStatus}</span>}
        {readOnlyContent ?? (
          <Editor
            {...editorProps}
            key="composer-input"
            className={dependencies.classNames(
              'text-base transition-[min-height] duration-relaxed ease-enter-snappy motion-reduce:transition-none',
              isGoalMode ? 'min-h-20' : 'min-h-0',
              centerPlaceholder && '[&_.ProseMirror]:text-center',
            )}
            workingStartedAtMs={workingStartedAtMs ?? null}
            singleLine={layout === 'single-line'}
            onSingleLineOverflowChange={onSingleLineOverflowChange}
            onCompositionStateChange={onCompositionStateChange}
          />
        )}
      </Parts.Input>
    );
    const measuredBodyRef = React.useMemo(
      () => dependencies.mergeRefs(setComposerWidthMeasureRef, bodyRef),
      [setComposerWidthMeasureRef, bodyRef],
    );
    const dictation = voice?.dictation == null ? undefined : {
      showTranscript: voice.dictation.showTranscript,
      controls: (
        <div className="contents" inert={isInteractionBlocked}>
          {'controls' in voice.dictation ? voice.dictation.controls : <dependencies.DictationControls {...voice.dictation} />}
        </div>
      ),
    };
    const leadingControls = voiceLayout == null
      ? <Parts.FooterInlineControls gap="normal">{leadingActions}</Parts.FooterInlineControls>
      : null;
    const trailingControls = voiceLayout == null ? (
      <div className="contents" inert={isInteractionBlocked}>
        <Parts.FooterControls ref={trailingControlsRef} layout={layout}>
          {modelControl == null ? null : <Parts.FooterExpandingControls><Parts.FooterAction>{modelControl}</Parts.FooterAction></Parts.FooterExpandingControls>}
          <Parts.FooterActions ref={actionsRef} spacing="none">
            {secondaryActions}
            {primaryAction == null ? null : <div className="ms-2 flex items-center">{primaryAction}</div>}
          </Parts.FooterActions>
        </Parts.FooterControls>
      </div>
    ) : null;
    const inputWithIntegrations = <div className="contents" inert={isInteractionBlocked}>{input}{inputIntegrations}</div>;

    return (
      <>
        <Surface
          blockReason={null}
          hasDropTargetPortal={false}
          isSubmitting={false}
          showShiftOverlay={false}
          {...interaction}
          animateRadius={presentation.quickChatComposerPresentation != null && !presentation.quickChatComposerPresentation.shouldReduceMotion}
          utilityBarVariant={isHome ? 'home' : 'default'}
          layout={layout}
          renderOwnSurface={!isHostedHome}
          surfaceVariant={surfaceVariant}
          surfaceOverflow={surfacePlacement.kind === 'hotkey' ? 'visible' : undefined}
          density={surfacePlacement.kind === 'document' || surfacePlacement.kind === 'comment' ? 'compact' : 'default'}
          radiusVariant={radiusVariant}
        >
          <Parts.Body
            ref={measuredBodyRef}
            animateHeight={motion !== 'default'}
            layout={hasVisibleAttachments || replyContext != null || voiceLayout != null ? 'multiline' : layout}
          >
            {header}
            {imageMarkupAttachment}
            {expansionControl}
            {replyContext == null ? null : <Parts.ReplyContext>{replyContext}</Parts.ReplyContext>}
            <div className="contents" inert={isInteractionBlocked}>
              <Parts.Attachments
                ref={attachmentRef}
                hasVisibleAttachments={hasVisibleAttachments}
                hidden={attachmentsHidden}
                spacing={hasVisibleAttachments || layout === 'multiline' ? spacing : 'flush'}
              >
                {attachments}
              </Parts.Attachments>
            </div>
            <Parts.AdaptiveFooter
              ref={footerRef}
              input={inputWithIntegrations}
              dictation={dictation}
              dictationEnabled={voice?.dictationEnabled}
              isVoiceLayout={voiceLayout != null}
              layout={layout}
              spacing={spacing}
              leadingControls={leadingControls}
              trailingControls={trailingControls}
            />
            <div className="contents" inert={isInteractionBlocked}>{voiceLayout}</div>
          </Parts.Body>
        </Surface>
      </>
    );
  }

  return MainComposerView;
}
