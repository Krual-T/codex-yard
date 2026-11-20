import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { createNewTab, type NewTabMenu } from '../native/new-tab-view.tsx';

export const NewTab = createNewTab(React);

type DropdownProps = React.ComponentProps<NewTabMenu['Dropdown']>;
export function ToolMenu({ triggerButton, onCloseAutoFocus, children, label, align = 'end', side = 'bottom', className = '', deferContent = false }:
  Omit<DropdownProps, 'align' | 'onCloseAutoFocus'> & {
    label: string; align?: 'start' | 'end'; side?: 'top' | 'bottom'; className?: string; deferContent?: boolean;
    onCloseAutoFocus?: DropdownProps['onCloseAutoFocus'];
  }) {
  const id = React.useId();
  const trigger = React.useRef<HTMLButtonElement>(null);
  const menu = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);
  React.useLayoutEffect(() => {
    const surface = menu.current;
    if (!open || !surface?.matches(':popover-open') || !trigger.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const { width, height } = surface.getBoundingClientRect();
    surface.style.left = Math.max(8, Math.min(align === 'start' ? anchor.left : anchor.right - width, innerWidth - width - 8)) + 'px';
    const above = anchor.top - height - 4, below = anchor.bottom + 4;
    const top = side === 'top' && (above >= 8 || below + height > innerHeight - 8) ? above : below;
    surface.style.top = Math.max(8, Math.min(top, innerHeight - height - 8)) + 'px';
    if (!surface.contains(document.activeElement)) menuItems(surface)[0]?.focus({ preventScroll: true });
  }, [align, open, side]);
  return <>
    {React.cloneElement(triggerButton as React.ReactElement<React.ComponentPropsWithRef<'button'>>, {
      ref: trigger, popoverTarget: id, 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': id,
    })}
    <div ref={menu} id={id} role="menu" aria-label={label} popover="auto" data-rendered={!deferContent || open}
      className={'yard-source-message-menu bg-surface-elevated-secondary/90 backdrop-blur-sm ' + className}
      onToggle={event => {
        if (event.target !== event.currentTarget) return;
        const surface = event.currentTarget;
        const active = event.newState === 'open';
        setOpen(active);
        if (!active) {
          let restore = true;
          onCloseAutoFocus?.({ preventDefault: () => { restore = false; } });
          const focused = document.activeElement;
          if (restore && (focused === document.body || surface.contains(focused))) trigger.current?.focus({ preventScroll: true });
        }
      }}
      onKeyDown={event => {
        if (event.defaultPrevented) return;
        if (event.key === 'Tab') {
          event.currentTarget.hidePopover();
          trigger.current?.focus({ preventScroll: true });
        } else menuKeys(event);
      }}>
      {(!deferContent || open) && children}
    </div>
  </>;
}

function menuItems(menu: HTMLElement) {
  return Array.from(menu.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:enabled'))
    .filter(item => item.closest('[role="menu"]') === menu);
}
function menuKeys(event: React.KeyboardEvent<HTMLElement>) {
  const items = menuItems(event.currentTarget);
  if (!items.length) return;
  const current = items.findIndex(item => item === document.activeElement);
  const next = event.key === 'ArrowDown' ? (current + 1) % items.length :
    event.key === 'ArrowUp' ? (current > 0 ? current : items.length) - 1 :
    event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1;
  if (next >= 0) { event.preventDefault(); items[next]?.focus(); }
}

export function ToolSubmenu({ label, icon, children, onOpen }: {
  label: string; icon: React.ReactNode; children: React.ReactNode; onOpen?(): void;
}) {
  const id = React.useId();
  const trigger = React.useRef<HTMLButtonElement>(null);
  const menu = React.useRef<HTMLDivElement>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  const position = React.useCallback(() => {
    const anchor = trigger.current, surface = menu.current;
    if (!anchor || !surface?.matches(':popover-open')) return;
    const box = anchor.getBoundingClientRect(), { width, height } = surface.getBoundingClientRect();
    const right = box.right + 9;
    surface.style.left = Math.max(8, Math.min(right + width + 8 <= innerWidth ? right : box.left - width - 9, innerWidth - width - 8)) + 'px';
    surface.style.top = Math.max(8, Math.min(box.top - 4, innerHeight - height - 8)) + 'px';
  }, []);
  React.useLayoutEffect(() => {
    const surface = menu.current;
    if (!open || !surface) return;
    position();
    const frame = requestAnimationFrame(position);
    const observer = new ResizeObserver(position);
    observer.observe(surface);
    window.addEventListener('resize', position);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', position);
    };
  }, [open, position]);
  function show(focus: boolean) {
    clearTimeout(timer.current);
    const anchor = trigger.current, surface = menu.current;
    if (!anchor || !surface) return;
    if (!surface.matches(':popover-open')) {
      surface.showPopover();
      position();
      onOpen?.();
    }
    if (focus) menuItems(surface)[0]?.focus({ preventScroll: true });
    else anchor.focus({ preventScroll: true });
  }
  return <div onPointerEnter={event => {
    clearTimeout(timer.current);
    if (event.pointerType === 'mouse') show(false);
  }} onPointerLeave={() => {
    timer.current = setTimeout(() => {
      const surface = menu.current;
      if (surface?.matches(':popover-open') && !surface.contains(document.activeElement)) surface.hidePopover();
    }, 180);
  }}>
    <button type="button" ref={trigger} tabIndex={-1} role="menuitem" aria-haspopup="menu" aria-expanded={open}
      aria-controls={id} onClick={() => show(true)} onKeyDown={event => {
        if (event.key === 'ArrowRight') { event.preventDefault(); show(true); }
      }}>{icon}{label}<ChevronRight size={13} aria-hidden="true" className="yard-source-submenu-chevron" /></button>
    <div ref={menu} id={id} role="menu" aria-label={label} popover="auto"
      className="yard-source-message-menu yard-source-project-actions yard-source-project-submenu bg-surface-elevated-secondary/90 backdrop-blur-sm"
      onToggle={event => setOpen(event.newState === 'open')}
      onKeyDown={event => {
        if (event.key === 'ArrowLeft' || event.key === 'Escape') {
          event.preventDefault();
          event.currentTarget.hidePopover();
          trigger.current?.focus({ preventScroll: true });
        } else menuKeys(event);
      }}>
      {children}
    </div>
  </div>;
}

const Dropdown: NewTabMenu['Dropdown'] = props => <ToolMenu {...props} label="更多工具" />;

export const ToolMenuItem = ({ onSelect, children, 'aria-label': label }:
  React.ComponentProps<NewTabMenu['Item']> & Pick<React.AriaAttributes, 'aria-label'>) =>
  <button type="button" role="menuitem" tabIndex={-1} aria-label={label} onClick={event => {
    let menu = event.currentTarget.closest<HTMLElement>('[role="menu"][popover]');
    while (menu) {
      if (menu.matches(':popover-open')) menu.hidePopover();
      menu = menu.parentElement?.closest<HTMLElement>('[role="menu"][popover]') ?? null;
    }
    onSelect();
  }}>{children}</button>;

export const newTabMenu: NewTabMenu = { Dropdown, Item: ToolMenuItem };
