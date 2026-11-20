import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import './message-actions.css';

export function MessageActions({ children }: { children: ReactNode }) {
  const timer = useRef<number | undefined>(undefined);
  const current = useRef<HTMLButtonElement | undefined>(undefined);
  const tooltip = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<HTMLButtonElement>();

  function clearHint() {
    window.clearTimeout(timer.current);
    current.current = undefined;
    setAnchor(undefined);
  }
  function queueHint(target: EventTarget | null) {
    const button = target instanceof Element ? target.closest<HTMLButtonElement>('button[data-message-hint]') : null;
    if (!button || button === current.current || button.ariaExpanded === 'true') return;
    clearHint();
    current.current = button;
    timer.current = window.setTimeout(() => {
      if (button.isConnected && button.ariaExpanded !== 'true') setAnchor(button);
    }, 400);
  }

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    const surface = tooltip.current;
    if (!surface || !anchor) return;
    surface.showPopover();
    const position = () => {
      if (!anchor.isConnected || anchor.ariaExpanded === 'true') { clearHint(); return; }
      surface.textContent = anchor.dataset.messageHint ?? '';
      const button = anchor.getBoundingClientRect();
      const { width, height } = surface.getBoundingClientRect();
      const left = button.left + (button.width - width) / 2;
      surface.style.left = Math.max(8, Math.min(left, innerWidth - width - 8)) + 'px';
      surface.style.top = (button.top >= height + 10 ? button.top - height - 2 : button.bottom + 2) + 'px';
    };
    position();
    const observer = new MutationObserver(position);
    observer.observe(anchor, { attributes: true, attributeFilter: ['data-message-hint', 'aria-expanded'] });
    window.addEventListener('scroll', clearHint, { capture: true, passive: true });
    window.addEventListener('resize', clearHint);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', clearHint, true);
      window.removeEventListener('resize', clearHint);
    };
  }, [anchor]);

  return <div className="yard-source-message-actions"
    onPointerOver={event => { if (event.pointerType === 'mouse') queueHint(event.target); }}
    onPointerOut={event => {
      if (current.current && !(event.relatedTarget instanceof Node && current.current.contains(event.relatedTarget))) clearHint();
    }}
    onFocus={event => { if (event.target.matches(':focus-visible')) queueHint(event.target); }}
    onBlur={event => { if (current.current?.contains(event.target)) clearHint(); }}
    onKeyDown={event => { if (event.key === 'Escape') clearHint(); }}>
    {children}
    {anchor && <span ref={tooltip} popover="manual" role="tooltip" className="yard-source-message-tooltip" />}
  </div>;
}
