import type { ComponentType, ReactElement, ReactNode } from 'react';

export type SidebarStatusBadge = {
  icon: ReactElement;
  ariaLabel?: string;
  className?: string;
  tooltipContent?: ReactNode;
};

export type SidebarStatusBadgeProps = {
  badge: SidebarStatusBadge;
};

export type SidebarStatusBadgeDependencies = {
  Tooltip: ComponentType<{ tooltipContent: ReactNode; children: ReactElement }>;
  classNames: (...classes: (string | undefined)[]) => string;
};

// Mirrors hzc in the pinned App renderer using its React and UI helpers.
export function createSidebarStatusBadgeComponent(
  React: typeof import('react'),
  { Tooltip, classNames }: SidebarStatusBadgeDependencies,
) {
  return function SidebarStatusBadge({ badge }: SidebarStatusBadgeProps): ReactElement {
    const originalIcon = badge.icon as ReactElement<{ className?: string }>;
    const icon = React.cloneElement(originalIcon, {
      className: classNames('icon-2xs block shrink-0', originalIcon.props.className),
    });
    const content = React.createElement('span', {
      'aria-label': badge.ariaLabel,
      className: classNames('flex h-5 w-5 items-center justify-center leading-none', badge.className),
    }, icon);

    if (badge.tooltipContent == null || badge.tooltipContent === '') return content;
    return React.createElement(Tooltip, { tooltipContent: badge.tooltipContent, children: content });
  };
}
