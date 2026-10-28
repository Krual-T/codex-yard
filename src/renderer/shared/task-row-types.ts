import type {
  ComponentType,
  DragEvent,
  MouseEvent,
  MouseEventHandler,
  ReactElement,
  ReactNode,
  Ref,
  SyntheticEvent,
} from 'react';

export type TaskRowClassValue = string | false | null | undefined;

export type TaskRowStatus = {
  type: string;
  unread?: boolean;
  unreadCount?: number;
};

export type TaskRowChip = {
  id: string;
  label?: ReactNode;
  tone?: string;
};

export type TaskRowIconBadge = {
  id: string;
  icon: ReactNode;
  preserveIconSize?: boolean;
  ariaLabel?: string;
  className?: string;
  onClick?: () => void;
  tooltipContent?: ReactNode;
};

export type TaskRowStatusPill = {
  label: ReactNode;
  ariaLabel?: string;
  hoverLabel?: ReactNode;
  onClick?: () => void;
  progress?: { deadlineMs: number; durationMs: number; nowMs?: number };
};

export type TaskRowActions = {
  archive: (() => void) | null;
  primaryAction: ReactNode;
  onMenuOpenChange: (open: boolean) => void;
  requestArchive: (() => void) | null;
};

export type TaskRowProps = {
  ref?: Ref<HTMLElement>;
  icon?: ReactNode;
  title?: ReactNode;
  titleTone?: string;
  ariaLabel?: string;
  titlePrefix?: ReactNode;
  secondaryLine?: ReactNode;
  secondaryLineWraps?: boolean;
  alignTrailingRailToTitle?: boolean;
  hiddenRowDetails?: ReactNode;
  titleSuffix?: ReactNode;
  titleSuffixPosition?: string;
  hoverCardContent?: ReactNode;
  chips?: TaskRowChip[];
  statusPill?: TaskRowStatusPill;
  iconBadges?: TaskRowIconBadge[];
  floatStatusIconsEnd?: boolean;
  metaContent?: ReactNode;
  overlayMetaContent?: ReactNode;
  metaState?: string;
  hideInlineBadgesOnHover?: boolean;
  isActive?: boolean;
  tone?: string;
  onClick: () => void;
  href?: string;
  onFileDrop?: (data: DataTransfer) => void;
  onDoubleClick?: MouseEventHandler<HTMLElement>;
  onArchive?: () => void;
  onArchiveRequest?: () => void;
  archiveAriaLabel?: string;
  primaryAction?: ReactNode;
  archiveConfirmLabel?: ReactNode;
  statusState: TaskRowStatus;
  statusIndicatorReplacesMeta?: boolean;
  hideStatusIndicator?: boolean;
  useStableTrailingRail?: boolean;
  reserveHoverActionSpace?: boolean;
  envType?: string;
  envTooltip?: ReactNode;
  disableEnvTooltip?: boolean;
  pulseEnvIcon?: boolean;
  envIconLocation?: string;
  disabled?: boolean;
  allowActionsWhenDisabled?: boolean;
  blurOnClick?: boolean;
  idleIndicatorNode?: ReactNode;
  idleStatusIndicatorNode?: ReactNode;
  statusIndicatorOverride?: ReactNode;
  indicatorRestNode?: ReactNode;
  indicatorHoverNode?: ReactNode;
  reserveLeadingSlot?: boolean;
  indentLevel?: number;
  additionalHoverActionCount?: number;
  priorityIndicatorNode?: ReactNode;
  onContextMenu?: MouseEventHandler<HTMLElement>;
  renderActions?: (actions: TaskRowActions) => ReactNode;
  onHoverCardOpenChange?: (open: boolean) => void;
  hoverCardSide?: string;
  hoverCardAlign?: string;
  hoverCardSideOffset?: number;
  hoverCardAlignOffset?: number;
  hoverCardOpenDelay?: number;
  metaHidden?: boolean;
  variant?: string;
  hostId?: string;
  dataAttributes?: Record<string, string | number | boolean | null | undefined>;
};

type TaskRowRootProps = {
  ref?: Ref<HTMLElement>;
  className: string;
  isActive: boolean;
  tone: string;
  isDisabled: boolean;
  isHighlighted: boolean;
  multiline: boolean;
  onClick: MouseEventHandler<HTMLElement>;
  onDoubleClick: MouseEventHandler<HTMLElement>;
  hasNavigationLink: boolean;
  onDragEnter: (event: DragEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onContextMenu?: MouseEventHandler<HTMLElement>;
  onPointerLeave: () => void;
  onPress?: (event: SyntheticEvent<HTMLElement>) => void;
  variant: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'data-title-aligned-trailing-rail'?: boolean;
  children: ReactNode;
};

export type TaskRowAnimatedTitleProps = {
  id?: string;
  className: string;
  animateOnGroupHover: boolean;
  'data-thread-title'?: boolean;
  'data-thread-secondary-title'?: boolean;
  children: ReactNode;
};

export type TaskRowDependencies = {
  classNames: (...classes: TaskRowClassValue[]) => string;
  useAtomValue: (atom: unknown) => unknown;
  cloudEnvironmentAtom: unknown;
  productModeAtom: unknown;
  isPlatform: (platforms: { electron?: boolean; extension?: boolean; chromeExtension?: boolean }) => boolean;
  focusApp: () => void;
  isFileTransfer: (data: DataTransfer) => boolean;
  onFileDragLeave: (event: DragEvent<HTMLElement>) => void;
  isImmediateHoverTarget: (target: EventTarget | null) => boolean;
  pulseRef: Ref<HTMLElement>;
  actionRailClassName: string;
  endRailClassName: string;
  inlineTitleSuffixClassName: string;
  endIconWidth: number;
  endIconGap: number;
  endIconPadding: number;
  errorAsset: unknown;
  RowRoot: ComponentType<TaskRowRootProps>;
  Indent: ComponentType<{ indentLevel: number; children: ReactNode }>;
  AnimatedTitle: ComponentType<TaskRowAnimatedTitleProps>;
  TitleContent: ComponentType<{ children: ReactNode }>;
  InlineBadges: ComponentType<{
    chips: TaskRowChip[]; href?: string; envIconNode: ReactNode; iconBadges: TaskRowIconBadge[];
    hideInlineBadges: boolean; disabled: boolean; className: string;
  }>;
  EndBadges: ComponentType<{
    className: string; iconBadges: TaskRowIconBadge[]; href?: string;
    leadingIconNodes: ReactNode[]; trailingIconNodes: ReactNode[]; disabled: boolean;
  }>;
  Metadata: ComponentType<{ className: string; content: ReactNode; metaState: string }>;
  EnvironmentIcon: ComponentType<{
    ref?: Ref<HTMLElement>; className?: string; disableTooltip?: boolean; envTooltip?: ReactNode;
    envType: string; href?: string; hostId?: string;
  }>;
  StatusIndicator: ComponentType<{ statusState: TaskRowStatus }>;
  StatusPill: ComponentType<TaskRowStatusPill>;
  ArchiveAction: ComponentType<{ archiveAriaLabel?: string; onArchive: () => void; useStableTrailingRail: boolean }>;
  ArchiveConfirm: ComponentType<{ label?: ReactNode; onConfirm: (event: MouseEvent<HTMLElement>) => void }>;
  ActionRail: ComponentType<{ actions: never[]; className: string; trailingAction: ReactNode }>;
  PinnedIcon: ComponentType<{ icon: ReactNode }>;
  DefaultPinIcon: ComponentType;
  Icon: ComponentType<{ className: string; 'aria-hidden': boolean; asset: unknown }>;
  FormattedMessage: ComponentType<{ id: string; defaultMessage: string; description: string }>;
  Tooltip: ComponentType<{
    disabled: boolean;
    disableHoverOpen: boolean;
    tooltipId?: string;
    cloneCustomTrigger: boolean;
    openOnFocusWithin: boolean;
    onFocus: () => void;
    getDelayDuration: (event: { target: EventTarget | null }, defaultDelay: number) => number;
    onOpenChange: (open: boolean) => void;
    side: string;
    align: string;
    alignOffset: number;
    sideOffset: number;
    interactive: boolean;
    variant: string;
    tooltipContent: ReactNode;
    children: ReactElement;
  }>;
};
