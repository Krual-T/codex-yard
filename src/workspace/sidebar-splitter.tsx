import { useLayoutEffect, useRef, useState } from 'react';
import { browserAtoms, writeAtom } from './host.ts';
import './sidebar-splitter.css';

const minimum = 240;
const defaultWidth = 340;
const maximum = (frame: HTMLElement) => Math.max(minimum, Math.min(520, frame.clientWidth - minimum));
const clamp = (width: number, max: number) => Math.max(minimum, Math.min(width, max));

/** The reference stores the preferred sidebar width, then clamps it to the shell. */
export function SidebarSplitter() {
  const control = useRef<HTMLDivElement>(null);
  const preferred = useRef(defaultWidth);
  const available = useRef(520);
  const [size, setSize] = useState(defaultWidth);
  const [max, setMax] = useState(520);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointer: number; x: number; width: number; preferred: number; scale: number } | null>(null);

  function resize(width: number, commit: boolean) {
    const value = clamp(width, available.current);
    preferred.current = value;
    document.documentElement.style.setProperty('--yard-source-sidebar-width', value + 'px');
    setSize(value);
    if (commit) void writeAtom('sidebar-width', value).catch(console.error);
  }

  useLayoutEffect(() => {
    const frame = control.current?.closest<HTMLElement>('.yard-source-frame');
    if (!frame) return;
    const saved = browserAtoms()['sidebar-width'];
    preferred.current = typeof saved === 'number' && Number.isFinite(saved) ? clamp(saved, 520) : defaultWidth;
    function sync() {
      const limit = maximum(frame!);
      const width = clamp(preferred.current, limit);
      available.current = limit;
      setMax(limit); setSize(width);
      document.documentElement.style.setProperty('--yard-source-sidebar-width', width + 'px');
    }
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const widthAt = (x: number, active: NonNullable<typeof drag.current>) =>
    active.width + (x - active.x) / active.scale * (document.dir === 'rtl' ? -1 : 1);

  return <div ref={control} className="yard-source-sidebar-splitter" role="separator" tabIndex={0}
    aria-label="Resize sidebar" aria-orientation="vertical" aria-controls="app-shell-sidebar"
    aria-valuemin={minimum} aria-valuemax={max} aria-valuenow={Math.round(size)} data-dragging={dragging}
    onKeyDown={event => {
      if (drag.current) return;
      const direction = document.dir === 'rtl' ? -1 : 1;
      const width = event.key === 'Home' ? minimum : event.key === 'End' ? max :
        event.key === 'ArrowRight' ? size + direction * 10 : event.key === 'ArrowLeft' ? size - direction * 10 : undefined;
      if (width === undefined) return;
      event.preventDefault(); event.stopPropagation(); resize(width, true);
    }} onDoubleClick={() => { if (!drag.current) resize(defaultWidth, true); }}
    onPointerDown={event => {
      if (event.button !== 0 || drag.current) return;
      event.preventDefault();
      const aside = event.currentTarget.parentElement!;
      const scale = aside.getBoundingClientRect().width / aside.offsetWidth || 1;
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointer: event.pointerId, x: event.clientX, width: size, preferred: preferred.current, scale };
      setDragging(true);
    }} onPointerMove={event => {
      const active = drag.current;
      if (active?.pointer === event.pointerId) resize(widthAt(event.clientX, active), false);
    }} onPointerUp={event => {
      const active = drag.current;
      if (active?.pointer !== event.pointerId) return;
      drag.current = null; setDragging(false);
      if (event.clientX !== active.x) resize(widthAt(event.clientX, active), true);
    }} onLostPointerCapture={event => {
      const active = drag.current;
      if (active?.pointer !== event.pointerId) return;
      drag.current = null; setDragging(false);
      resize(active.preferred, false);
    }} />;
}
