/** @jsxRuntime classic */
/** @jsx React.createElement */
import type { ComponentType, ReactNode } from 'react';
import type { TaskRowAnimatedTitleProps, TaskRowClassValue, TaskRowProps } from '../shared/task-row-types.ts';

export type SidebarConversationRowProps = Omit<TaskRowProps, 'secondaryLine' | 'alignTrailingRailToTitle'> & {
  secondaryContent?: ReactNode;
  wrapSecondaryContent?: boolean;
};

export type SidebarConversationRowDependencies = {
  TaskRow: ComponentType<TaskRowProps>;
  AnimatedTitle: ComponentType<TaskRowAnimatedTitleProps>;
  classNames: (...classes: TaskRowClassValue[]) => string;
};

// Mirrors vEc; the original row continues to own all selection and action state.
export function createSidebarConversationRowComponent(
  React: typeof import('react'),
  { TaskRow, AnimatedTitle, classNames }: SidebarConversationRowDependencies,
) {
  return function SidebarConversationRow({
    secondaryContent,
    statusState,
    variant,
    wrapSecondaryContent,
    ...rowProps
  }: SidebarConversationRowProps): ReactNode {
    const hasSecondaryContent = secondaryContent != null;
    const wraps = wrapSecondaryContent ?? variant === 'sidebarAvatar';
    const secondaryLine = !hasSecondaryContent ? undefined : wraps
      ? <span
          className={classNames(
            'line-clamp-2 w-full pe-row-y text-xs leading-4 text-tertiary select-none',
            variant === 'sidebarAvatar' && 'min-h-8',
          )}
          data-thread-secondary-title={true}
        >{secondaryContent}</span>
      : <AnimatedTitle
          className="text-xs leading-4 text-tertiary select-none"
          data-thread-secondary-title={true}
          animateOnGroupHover={true}
        ><span className="inline-flex items-center gap-1">{secondaryContent}</span></AnimatedTitle>;

    return <TaskRow
      {...rowProps}
      alignTrailingRailToTitle={wraps}
      statusState={statusState}
      secondaryLine={secondaryLine}
      variant={variant ?? (hasSecondaryContent ? 'sidebar' : 'default')}
    />;
  };
}
