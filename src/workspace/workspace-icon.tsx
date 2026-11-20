import { createElement, memo, type ReactElement } from 'react';
import type { workspaceIconNames } from '../native/renderer-assets.ts';

type Name = keyof typeof workspaceIconNames | 'project:plane' | 'picker:plane' | 'runningSpinner' | 'toolRead' | 'toolChevron'
  | 'toolWaiting' | 'messageImage' | 'messageFile' | 'questionChevron';
type Shape = readonly [tag: string, attributes: Readonly<Record<string, string>>, children?: readonly Shape[]];
declare const __yardWorkspaceIcons: Readonly<Record<Name, { viewBox: string; shapes: readonly Shape[] }>>;

function vector([tag, attributes, children]: Shape, key: number): ReactElement {
  return createElement(tag, { ...attributes, key }, children?.map(vector));
}

export const WorkspaceIcon = memo(function WorkspaceIcon({ name, size = 16, className }: {
  name: Name; size?: number; className?: string;
}) {
  const { viewBox, shapes } = __yardWorkspaceIcons[name];
  return <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox={viewBox} className={className}>
    {shapes.map(vector)}
  </svg>;
});
