/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import type { DragEvent, MouseEvent, ReactNode, SyntheticEvent } from 'react';
import type { TaskRowDependencies, TaskRowProps } from './task-row-types.ts';

export type { TaskRowDependencies, TaskRowProps } from './task-row-types.ts';

// Mirrors GTc while keeping its state sources and UI primitives upstream.
export function createTaskRowComponent(React: typeof import('react'), dependencies: TaskRowDependencies) {
  const {
    classNames, useAtomValue, cloudEnvironmentAtom, productModeAtom, isPlatform, focusApp,
    isFileTransfer, onFileDragLeave, isImmediateHoverTarget, pulseRef, actionRailClassName,
    endRailClassName, inlineTitleSuffixClassName, endIconWidth, endIconGap, endIconPadding,
    errorAsset, RowRoot, Indent, AnimatedTitle, TitleContent, InlineBadges, EndBadges,
    Metadata, EnvironmentIcon, StatusIndicator, StatusPill, ArchiveAction, ArchiveConfirm,
    ActionRail, PinnedIcon, DefaultPinIcon, Icon, FormattedMessage, Tooltip,
  } = dependencies;

  return function TaskRow({
    ref, icon, title, titleTone = 'default', ariaLabel, titlePrefix, secondaryLine,
    secondaryLineWraps = true, alignTrailingRailToTitle = false, hiddenRowDetails,
    titleSuffix, titleSuffixPosition = 'end', hoverCardContent, chips = [], statusPill,
    iconBadges = [], floatStatusIconsEnd = false, metaContent, overlayMetaContent,
    metaState = 'default', hideInlineBadgesOnHover = false, isActive = false, tone = 'default',
    onClick, onFileDrop, onDoubleClick, onArchive, onArchiveRequest, archiveAriaLabel,
    primaryAction, archiveConfirmLabel, statusState, statusIndicatorReplacesMeta = false,
    hideStatusIndicator = false, useStableTrailingRail = false, reserveHoverActionSpace = false,
    envType, envTooltip, disableEnvTooltip, pulseEnvIcon, envIconLocation = 'end',
    disabled = false, allowActionsWhenDisabled = false, blurOnClick = false, idleIndicatorNode,
    idleStatusIndicatorNode, statusIndicatorOverride, indicatorRestNode, indicatorHoverNode,
    reserveLeadingSlot = false, indentLevel = 0, additionalHoverActionCount = 0,
    priorityIndicatorNode, onContextMenu, renderActions, onHoverCardOpenChange,
    hoverCardSide = 'right', hoverCardAlign = 'start', hoverCardSideOffset = 2,
    hoverCardAlignOffset = 0, hoverCardOpenDelay, metaHidden = false, variant = 'default',
    hostId, dataAttributes,
  }: TaskRowProps): ReactNode {
    const pinnedVariant = variant === 'sidebarPinned';
    const avatarVariant = variant === 'sidebarAvatar';
    const sidebarVariant = variant === 'sidebar' || avatarVariant || pinnedVariant;
    const alignRail = alignTrailingRailToTitle && secondaryLine != null;
    const inlineSuffix = titleSuffix != null && (alignRail || titleSuffixPosition === 'inline');
    const cloudEnvironment = useAtomValue(sidebarVariant && envType === 'cloud' ? cloudEnvironmentAtom : false);
    const titleId = React.useId();
    const unread = statusState.unread ?? false;
    const hasUnread = unread || (statusState.unreadCount ?? 0) > 0;
    const descriptionId = `${titleId}-description`;
    const hoverCardId = `${titleId}-hover-card`;
    const [archiveOpen, setArchiveOpen] = React.useState(false);
    const [menuOpen, setMenuOpen] = React.useState(false);

    const inlineIconBadges = statusPill != null || floatStatusIconsEnd ? [] : iconBadges;
    const endIconBadges = statusPill == null && floatStatusIconsEnd ? iconBadges : [];
    const endIdleIndicator = statusPill == null && floatStatusIconsEnd ? idleIndicatorNode : null;
    const archive = disabled ? null : onArchive ?? null;
    const requestArchive = archive == null ? null : onArchiveRequest ?? (() => setArchiveOpen(true));
    const hasArchive = archive != null;
    const hasOverlayMeta = overlayMetaContent != null;
    const inlineMeta = sidebarVariant && metaContent != null && metaContent !== false && !hasOverlayMeta && !metaHidden;
    const confirmingArchive = archiveOpen && hasArchive;
    const showMeta = !confirmingArchive;
    const actionCount = additionalHoverActionCount + (primaryAction != null || hasArchive ? 1 : 0);
    const indicatorReplacesMeta = statusPill != null
      || inlineMeta && statusState.type === 'loading' && !hideStatusIndicator
      || statusIndicatorReplacesMeta && (statusState.type === 'loading' || unread);
    const idleLeading = (floatStatusIconsEnd ? null : idleIndicatorNode) ?? indicatorRestNode;
    const errorIndicator = statusState.type === 'error' && !confirmingArchive
      && priorityIndicatorNode == null && !indicatorReplacesMeta
      ? <div className="relative flex size-5 shrink-0 items-center justify-center text-codex-description">
          <Icon className="shrink-0 text-danger" aria-hidden={false} asset={errorAsset} />
        </div>
      : null;
    const restIndicator = statusPill == null
      ? priorityIndicatorNode ?? (floatStatusIconsEnd ? null : errorIndicator) ?? idleLeading
      : null;
    const hasLeadingSlot = reserveLeadingSlot || restIndicator != null
      || statusPill == null && indicatorHoverNode != null;
    const hoverIndicator = statusPill != null || priorityIndicatorNode != null
      || !floatStatusIconsEnd && errorIndicator != null ? null : indicatorHoverNode;
    const showOnFocus = statusState.type !== 'loading' && !unread;
    let defaultAction: ReactNode = requestArchive != null && !archiveOpen
      ? <ArchiveAction archiveAriaLabel={archiveAriaLabel} onArchive={requestArchive} useStableTrailingRail={useStableTrailingRail} />
      : null;
    if (primaryAction != null) {
      defaultAction = <ActionRail actions={[]} className={actionRailClassName} trailingAction={primaryAction} />;
    }

    const leadingSlot = hasLeadingSlot
      ? <div className={classNames('flex w-4 shrink-0 items-center justify-center', disabled && 'pointer-events-none')}>
          <div className="relative flex items-center justify-center">
            {restIndicator ? <span className={classNames(
              'flex items-center justify-center',
              !!hoverIndicator && (showOnFocus ? 'group-focus-within:opacity-0 group-hover:opacity-0' : 'group-hover:opacity-0'),
            )}>{restIndicator}</span> : null}
            {hoverIndicator ? <span className={classNames(
              'flex items-center justify-center opacity-0 pointer-events-none',
              showOnFocus
                ? 'group-focus-within:opacity-100 group-hover:opacity-100 group-focus-within:pointer-events-auto group-hover:pointer-events-auto'
                : 'group-hover:opacity-100 group-hover:pointer-events-auto',
              restIndicator ? 'absolute inset-0' : 'relative',
            )}>{hoverIndicator}</span> : null}
          </div>
        </div>
      : null;
    let leadingIcon = leadingSlot;
    if (pinnedVariant) {
      leadingIcon = <PinnedIcon icon={icon ?? <DefaultPinIcon />} />;
    } else if (icon != null) {
      leadingIcon = <div className={classNames(
        'flex shrink-0 items-center justify-center', avatarVariant ? 'w-12' : 'w-4',
      )}>{icon}</div>;
    }
    const extraLeadingSlot = (icon != null || pinnedVariant) && (restIndicator != null || hoverIndicator != null)
      ? leadingSlot : null;

    const defaultStatus = statusPill == null
      ? !hideStatusIndicator && (statusState.type === 'loading' || unread)
        ? <StatusIndicator statusState={statusState} />
        : !hideStatusIndicator && statusState.type === 'idle' ? idleStatusIndicatorNode : null
      : <StatusPill {...statusPill} onClick={disabled ? undefined : statusPill.onClick} key={statusPill.progress?.deadlineMs} />;
    const status = confirmingArchive ? null : (statusPill == null ? statusIndicatorOverride : null) ?? defaultStatus;
    const actions = disabled && !allowActionsWhenDisabled || hasOverlayMeta && renderActions == null
      || confirmingArchive || statusPill?.onClick != null && !disabled
      ? null
      : renderActions ? renderActions({ archive, primaryAction, onMenuOpenChange: setMenuOpen, requestArchive }) : defaultAction;
    const hideOnActions = classNames(
      'group-focus-visible:hidden group-hover:hidden group-has-[:focus-visible]:hidden', menuOpen && 'hidden',
    );
    const metadata = showMeta && (!indicatorReplacesMeta || useStableTrailingRail && !inlineMeta && !hasOverlayMeta)
      && (!archiveOpen || renderActions != null) && metaContent != null && metaContent !== false
      ? <Metadata
          className={classNames(hideOnActions, actions != null && '[@media(hover:none)]:hidden',
            useStableTrailingRail && !hasOverlayMeta && 'shrink-0')}
          content={metaContent}
          metaState={metaState}
        /> : null;
    const overlay = overlayMetaContent == null ? null : actions == null ? overlayMetaContent
      : <div className={classNames(hideOnActions, '[@media(hover:none)]:hidden')}>{overlayMetaContent}</div>;
    const statusAtEnd = floatStatusIconsEnd && statusPill == null;
    const statusNode = status != null && !statusAtEnd
      ? <span data-hover-card-open-immediately={true} className={classNames(
          'flex shrink-0 items-center justify-center', statusPill == null ? 'size-5 -me-1' : '-me-0.5',
          useStableTrailingRail && indicatorReplacesMeta && metadata != null && 'absolute end-0',
          hasOverlayMeta && 'invisible', actions != null && hideOnActions,
        )}>{status}</span> : null;

    const environmentIcon = statusPill == null && (envType === 'worktree'
      || envType === 'cloud' && !cloudEnvironment && isPlatform({ electron: true, extension: true, chromeExtension: true })
      || envType === 'remote' || envType === 'remote-worktree')
      ? <EnvironmentIcon ref={pulseEnvIcon ? pulseRef : undefined} className={pulseEnvIcon ? 'animate-pulse' : undefined}
          disableTooltip={disableEnvTooltip} envTooltip={envTooltip} envType={envType} href={undefined} hostId={hostId} />
      : null;
    let endEnvironmentIcons: ReactNode[] = [];
    if (statusPill == null && floatStatusIconsEnd && envIconLocation === 'end') {
      if (envType === 'remote-worktree') {
        endEnvironmentIcons = [
          <EnvironmentIcon key="remote" ref={pulseEnvIcon ? pulseRef : undefined}
            className={pulseEnvIcon ? 'animate-pulse' : undefined} disableTooltip={disableEnvTooltip}
            envType="remote" href={undefined} hostId={hostId} />,
          <EnvironmentIcon key="worktree" ref={pulseEnvIcon ? pulseRef : undefined}
            className={pulseEnvIcon ? 'animate-pulse' : undefined} disableTooltip={disableEnvTooltip}
            envType="worktree" href={undefined} />,
        ];
      } else if (environmentIcon != null) {
        endEnvironmentIcons = [environmentIcon];
      }
    }
    const endErrorIndicator = floatStatusIconsEnd ? errorIndicator : null;
    const endStatus = floatStatusIconsEnd && statusPill == null ? status : null;
    const trailingIcons = [extraLeadingSlot, endErrorIndicator, endIdleIndicator, endStatus];
    const endIconCount = [...endIconBadges, ...trailingIcons].filter(item => item != null).length + endEnvironmentIcons.length;
    const endRailWidth = endIconCount === 0 ? 0 : endIconCount * endIconWidth
      + (endIconCount - 1) * endIconGap + endIconPadding;
    const endRail = !confirmingArchive && endIconCount > 0
      ? <EndBadges className={classNames(inlineMeta ? 'relative h-5 gap-2' : endRailClassName,
          hasOverlayMeta && 'invisible', actions != null && hideOnActions)}
          iconBadges={endIconBadges} href={undefined} leadingIconNodes={endEnvironmentIcons}
          trailingIconNodes={trailingIcons} disabled={disabled} /> : null;
    const hasTrailingContent = showMeta && (hasOverlayMeta || metadata || !statusAtEnd && status || confirmingArchive);
    let actionWidth: string | undefined;
    if (actions != null && (renderActions != null || !useStableTrailingRail || !hasTrailingContent)) {
      if (reserveHoverActionSpace && !alignRail) actionWidth = 'min-w-20';
      else if (actionCount >= 3) actionWidth = menuOpen ? 'min-w-20'
        : 'group-focus-visible:min-w-20 group-hover:min-w-20 group-has-[:focus-visible]:min-w-20';
      else if (actionCount === 2) actionWidth = menuOpen ? 'min-w-14'
        : 'group-focus-visible:min-w-14 group-hover:min-w-14 group-has-[:focus-visible]:min-w-14';
      else if (actionCount === 1 && sidebarVariant) actionWidth = menuOpen ? 'min-w-[36px]'
        : 'group-focus-visible:min-w-[36px] group-hover:min-w-[36px] group-has-[:focus-visible]:min-w-[36px]';
      else if (actionCount === 1) actionWidth = menuOpen ? 'min-w-5'
        : 'group-focus-visible:min-w-5 group-hover:min-w-5 group-has-[:focus-visible]:min-w-5';
    }

    const handlePress = (event: SyntheticEvent<HTMLElement>) => {
      focusApp();
      onClick();
      if (blurOnClick && event.type === 'click') event.currentTarget.blur();
    };
    const handleDoubleClick = (event: MouseEvent<HTMLElement>) => {
      if (disabled) return;
      if (archiveOpen) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!event.defaultPrevented) onDoubleClick?.(event);
    };
    const acceptsFile = (event: DragEvent<HTMLElement>) => !disabled && onFileDrop != null && isFileTransfer(event.dataTransfer);
    const handleDragEnter = (event: DragEvent<HTMLElement>) => {
      if (acceptsFile(event)) {
        event.preventDefault();
        event.currentTarget.dataset.fileDropActive = 'true';
      }
    };
    const handleDragOver = (event: DragEvent<HTMLElement>) => {
      if (acceptsFile(event)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        event.currentTarget.dataset.fileDropActive = 'true';
      }
    };
    const handleDrop = (event: DragEvent<HTMLElement>) => {
      delete event.currentTarget.dataset.fileDropActive;
      if (acceptsFile(event)) {
        event.preventDefault();
        onFileDrop?.(event.dataTransfer);
      }
    };
    const handleClick = (event: MouseEvent<HTMLElement>) => {
      if (!disabled && archiveOpen) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const rowClassName = classNames(
      'data-[app-action-sidebar-thread-selected=true]:bg-primary-ghost-hover data-[file-drop-active=true]:bg-primary-ghost-hover',
      '[@media(hover:none)]:flex [@media(hover:none)]:items-center',
      alignRail ? 'pt-1.5 pb-2' : 'py-row-y',
      !pinnedVariant && (floatStatusIconsEnd ? 'pe-row-y ps-[var(--padding-row-cell-x,var(--padding-row-x))]'
        : 'px-[var(--padding-row-cell-x,var(--padding-row-x))]'),
      pinnedVariant && (floatStatusIconsEnd ? 'pe-row-y' : 'pe-[var(--padding-row-cell-x,var(--padding-row-x))]'),
    );
    const hasHoverCard = !isPlatform({ extension: true }) && hoverCardContent != null
      && hoverCardContent !== false && hoverCardContent !== '';
    const productMode = useAtomValue(hasHoverCard ? productModeAtom : null);
    const hasHiddenDetails = hiddenRowDetails != null;
    const titleKey = typeof title === 'string' || typeof title === 'number' ? String(title) : undefined;
    const titleContent = <span className={titleTone === 'muted' ? 'text-tertiary' : undefined} dir="auto"><TitleContent>{title}</TitleContent></span>;
    const prefixedTitle = titlePrefix == null ? titleContent
      : <span className="flex min-w-0 items-center gap-1">
          <span className="contents" aria-hidden={true}>{titlePrefix}</span>
          <span className="min-w-0 flex-auto">{titleContent}</span>
        </span>;
    const titleClassName = classNames('min-w-0 select-none', !sidebarVariant && 'truncate',
      inlineSuffix ? 'w-auto flex-initial' : 'flex-1');
    const titleNode = sidebarVariant
      ? <AnimatedTitle key={titleKey} id={titleId} className={titleClassName} data-thread-title={true} animateOnGroupHover={true}>{prefixedTitle}</AnimatedTitle>
      : <span key={titleKey} id={titleId} className={titleClassName} data-thread-title={true} draggable={false}>{prefixedTitle}</span>;
    const titleWithSuffix = inlineSuffix
      ? <span className="flex min-w-0 flex-1 items-center gap-1">
          {titleNode}<span className={classNames('flex shrink-0', inlineTitleSuffixClassName)}>{titleSuffix}</span>
        </span> : titleNode;
    const trailing = (alignRail || inlineMeta) && !confirmingArchive && overlay == null && metadata == null && statusNode == null
      ? null
      : <div className={classNames('flex items-center justify-end gap-1', avatarVariant ? 'order-last' : 'ms-[3px]',
          useStableTrailingRail && 'relative me-[var(--task-row-trailing-inset)]',
          !!hasTrailingContent && !avatarVariant && 'min-w-[26px]', actionWidth)}>
          {confirmingArchive ? <ArchiveConfirm label={archiveConfirmLabel} onConfirm={event => {
            event.stopPropagation();
            setArchiveOpen(false);
            archive?.();
          }} /> : <>{overlay}{inlineMeta ? statusNode : null}
            {metadata && <div className={classNames((useStableTrailingRail && indicatorReplacesMeta || metaHidden || hasOverlayMeta) && 'invisible')}>{metadata}</div>}
            {inlineMeta ? null : statusNode}</>}
        </div>;
    const endRailSpacer = endRailWidth > 0
      ? <div className={classNames('shrink-0', actions != null && hideOnActions)} style={{ width: `${endRailWidth}px` }} /> : null;
    const unreadDescription = hasUnread ? <span id={descriptionId} className="sr-only">
      <FormattedMessage id="codex.taskRow.unreadDescription" defaultMessage="Unread"
        description="Accessible description for a chat row with unread updates" />
    </span> : null;
    const rowTitleClassName = classNames('flex min-w-0 flex-1 self-stretch text-base leading-5',
      secondaryLine == null ? 'items-center gap-2' : 'flex-col items-start gap-0.5',
      isActive ? 'text-[var(--color-text)]' : 'text-default',
      variant === 'tableRow' && '-ms-0.5 h-9 items-center self-center leading-9');
    const titleBody = secondaryLine == null
      ? <>{titleWithSuffix}{inlineSuffix ? null : titleSuffix}{null}{envIconLocation === 'middle' && environmentIcon}</>
      : <><div className={classNames('flex w-full min-w-0 flex-1 items-center', alignRail ? 'gap-1' : 'gap-2',
          alignRail && statusPill != null && 'min-h-6',
          alignRail && actions != null && (reserveHoverActionSpace ? 'pe-20'
            : 'group-focus-visible:pe-20 group-hover:pe-20 group-has-[:focus-visible]:pe-20'),
          alignRail && actions != null && menuOpen && 'pe-20')}>
          {titleWithSuffix}{inlineSuffix ? null : titleSuffix}{null}{envIconLocation === 'middle' && environmentIcon}
          {alignRail && inlineMeta ? endRail : null}{alignRail ? trailing : null}{alignRail && !inlineMeta ? endRail : null}
        </div>
        {alignRail && actions != null ? <div className={classNames('flex w-full min-w-0',
          secondaryLineWraps || reserveHoverActionSpace || menuOpen ? 'pe-20'
            : 'group-focus-visible:pe-20 group-hover:pe-20 group-has-[:focus-visible]:pe-20')}>{secondaryLine}</div> : secondaryLine}</>;
    const inlineEnvironment = envIconLocation === 'end' && !floatStatusIconsEnd && !confirmingArchive ? environmentIcon : null;
    const inlineBadgesClass = chips.length > 0 && actions != null ? hideOnActions
      : hideInlineBadgesOnHover && (menuOpen ? 'hidden' : 'group-hover:hidden');
    const body = <div className={classNames('flex min-w-0 flex-1 items-center gap-2',
      !sidebarVariant && leadingIcon == null && 'ps-0.5')}>
      {pinnedVariant ? null : leadingIcon}
      {envIconLocation === 'start' && environmentIcon}
      <div className={rowTitleClassName} data-thread-title-trigger={true}>{titleBody}</div>
      <InlineBadges chips={chips} href={undefined} envIconNode={inlineEnvironment} iconBadges={inlineIconBadges}
        hideInlineBadges={confirmingArchive} disabled={disabled} className={classNames(inlineBadgesClass)} />
    </div>;
    const rowContent = <div className="flex h-full w-full items-center text-sm leading-4 [@media(hover:none)]:relative [@media(hover:none)]:min-w-0 [@media(hover:none)]:flex-1">
      <Indent indentLevel={indentLevel}>
        {pinnedVariant ? leadingIcon : null}{body}{!alignRail && inlineMeta ? endRail : null}
        {alignRail ? null : trailing}{alignRail || inlineMeta ? null : endRailSpacer}
      </Indent>
      {alignRail || inlineMeta ? null : endRail}
    </div>;
    const row = <RowRoot {...dataAttributes} ref={ref} className={rowClassName}
      data-title-aligned-trailing-rail={alignRail || undefined} isActive={isActive} tone={tone}
      isDisabled={disabled} isHighlighted={menuOpen} multiline={secondaryLine != null} onClick={handleClick}
      onDoubleClick={handleDoubleClick} hasNavigationLink={false} onDragEnter={handleDragEnter}
      onDragOver={handleDragOver} onDragLeave={onFileDragLeave} onDrop={handleDrop}
      onContextMenu={disabled ? undefined : onContextMenu} onPointerLeave={() => setArchiveOpen(false)}
      onPress={archiveOpen ? undefined : handlePress} variant={sidebarVariant ? 'sidebar' : variant}
      aria-label={ariaLabel} aria-labelledby={ariaLabel == null ? titleId : undefined}
      aria-describedby={hasUnread ? descriptionId : undefined}>
      {unreadDescription}{rowContent}
      {actions == null ? null : <div className="contents" data-hover-card-open-immediately={true}>{actions}</div>}
    </RowRoot>;
    if (!hasHoverCard) return row;
    return <Tooltip disabled={productMode !== 'codex'} disableHoverOpen={menuOpen}
      tooltipId={hasHiddenDetails ? hoverCardId : undefined} cloneCustomTrigger={hasHiddenDetails}
      openOnFocusWithin={false} onFocus={() => {}}
      getDelayDuration={(event, defaultDelay) => hoverCardOpenDelay ?? (isImmediateHoverTarget(event.target) ? 0 : defaultDelay)}
      onOpenChange={open => onHoverCardOpenChange?.(open)} side={hoverCardSide} align={hoverCardAlign}
      alignOffset={hoverCardAlignOffset} sideOffset={hoverCardSideOffset} interactive={true} variant="rich"
      tooltipContent={hoverCardContent}>{row}</Tooltip>;
  };
}
