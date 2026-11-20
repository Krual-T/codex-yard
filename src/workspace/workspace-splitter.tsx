import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { browserAtoms, writeAtom } from './host.ts';

const widthAtom = 'app-shell:right-panel-width:v3';
const minimum = 320;
const chatMinimum = 352;
const step = 10;
const maxPaneWidth = (workspaceWidth: number) => Math.max(minimum, workspaceWidth - chatMinimum);
const clampRatio = (value: number) => Math.max(0, Math.min(1, value));
const toRatio = (width: number, workspaceWidth: number) => {
  const range = maxPaneWidth(workspaceWidth) - minimum;
  return range > 0 ? clampRatio((width - minimum) / range) : 0;
};
const fromRatio = (ratio: number, workspaceWidth: number) =>
  minimum + ratio * (maxPaneWidth(workspaceWidth) - minimum);
const defaultWidth = (width: number, height: number) =>
  Math.max(minimum, Math.min(height * 1.6, width - 500), Math.min(640, width - chatMinimum));

export function WorkspaceSplitter({ workspace, pane, ratio }: {
  workspace: RefObject<HTMLDivElement | null>;
  pane: string;
  ratio: RefObject<number | undefined>;
}) {
  const [max, setMax] = useState(minimum);
  const [size, setSize] = useState(minimum);
  const [dragging, setDragging] = useState(false);
  const available = useRef(0);
  const drag = useRef<{ pointer: number; origin: number; width: number; ratio: number } | null>(null);

  useLayoutEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const saved = browserAtoms()[widthAtom];
    // Match the reference's initial outer-box ratio, then size the two panes in the content box.
    const initial = element.offsetWidth;
    ratio.current ??= typeof saved === 'number' && Number.isFinite(saved)
      ? saved <= 1 ? clampRatio(saved) : toRatio(saved, initial)
      : toRatio(defaultWidth(initial, element.clientHeight), initial);
    const sync = (width: number) => {
      available.current = width;
      setMax(maxPaneWidth(width));
      setSize(fromRatio(ratio.current!, width));
    };
    element.style.setProperty('--yard-pane-ratio', String(ratio.current));
    sync(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => { if (entry) sync(entry.contentRect.width); });
    observer.observe(element);
    return () => {
      observer.disconnect();
      element.style.removeProperty('--yard-pane-ratio');
      if (drag.current) ratio.current = drag.current.ratio;
    };
  }, [workspace, ratio]);

  function resize(width: number, commit: boolean) {
    ratio.current = toRatio(width, available.current);
    workspace.current?.style.setProperty('--yard-pane-ratio', String(ratio.current));
    setSize(fromRatio(ratio.current, available.current));
    if (commit) void writeAtom(widthAtom, ratio.current).catch(console.error);
  }

  return <div className="yard-source-splitter" role="separator" tabIndex={0} aria-label="Resize workspace panes"
    aria-orientation="vertical" aria-controls={pane} aria-valuemin={minimum} aria-valuemax={max} aria-valuenow={size}
    data-dragging={dragging} onKeyDown={event => {
      if (drag.current) return;
      const forward = document.dir === 'rtl' ? 1 : -1;
      const width = event.key === 'Home' ? minimum : event.key === 'End' ? max :
        event.key === 'ArrowRight' ? size + forward * step : event.key === 'ArrowLeft' ? size - forward * step : undefined;
      if (width === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      resize(width, true);
    }} onDoubleClick={() => {
      if (workspace.current && !drag.current) resize(defaultWidth(available.current, workspace.current.clientHeight), true);
    }} onPointerDown={event => {
      if (event.button !== 0 || drag.current || ratio.current === undefined) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointer: event.pointerId, origin: event.clientX, width: size, ratio: ratio.current };
      setDragging(true);
    }} onPointerMove={event => {
      const active = drag.current;
      if (active?.pointer !== event.pointerId) return;
      resize(active.width + (active.origin - event.clientX) * (document.dir === 'rtl' ? -1 : 1), false);
    }} onPointerUp={event => {
      const active = drag.current;
      if (active?.pointer !== event.pointerId) return;
      drag.current = null;
      setDragging(false);
      if (event.clientX !== active.origin || ratio.current !== active.ratio) {
        resize(active.width + (active.origin - event.clientX) * (document.dir === 'rtl' ? -1 : 1), true);
      }
    }} onLostPointerCapture={event => {
      const active = drag.current;
      if (active?.pointer !== event.pointerId) return;
      drag.current = null;
      setDragging(false);
      resize(fromRatio(active.ratio, available.current), false);
    }} />;
}
