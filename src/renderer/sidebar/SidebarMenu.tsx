import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight } from 'lucide-react';

export type SidebarMenuEntry =
  | { kind: 'separator' }
  | { kind: 'heading'; label: string }
  | {
    kind: 'item'; id: string; label: string; icon?: ReactNode; description?: string; shortcut?: string;
    role?: 'menuitem' | 'menuitemradio' | 'menuitemcheckbox'; checked?: boolean; danger?: boolean;
    disabledReason?: string; children?: readonly SidebarMenuEntry[]; onSelect?: () => void | Promise<void>;
  };

type Item = Extract<SidebarMenuEntry, { kind: 'item' }>;
type Point = { left: number; top: number };

function positionMenu(anchor: DOMRect, width: number, height: number, placement: 'below' | 'above' | 'submenu'): Point {
  const right = innerWidth - width - 8, bottom = innerHeight - height - 8;
  const wantedLeft = placement === 'submenu'
    ? anchor.right + 4 <= right ? anchor.right + 4 : anchor.left - width - 4
    : anchor.left;
  const wantedTop = placement === 'above' ? anchor.top - height - 4
    : placement === 'submenu' ? anchor.top : anchor.bottom + 4;
  return { left: Math.max(8, Math.min(wantedLeft, right)), top: Math.max(8, Math.min(wantedTop, bottom)) };
}

export function SidebarMenu({ label, items, children, className = '', contextTarget, placement = 'below', width = 216,
  matchTriggerWidth = false }: {
  label: string; items: readonly SidebarMenuEntry[]; children: ReactNode; className?: string;
  contextTarget?: RefObject<HTMLDivElement | null>; placement?: 'below' | 'above'; width?: number; matchTriggerWidth?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [point, setPoint] = useState<Point | null>(null);
  const [position, setPosition] = useState<Point>({ left: 8, top: 8 });
  const [submenu, setSubmenu] = useState<string | null>(null);
  const [subPosition, setSubPosition] = useState<Point>({ left: 8, top: 8 });
  const [error, setError] = useState('');
  const [errorInSubmenu, setErrorInSubmenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const mainMenu = useRef<HTMLDivElement>(null);
  const subMenu = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const focusSubmenu = useRef(false);
  const id = useId();
  const active = items.find((entry): entry is Item => entry.kind === 'item' && entry.id === submenu);
  const menuWidth = Math.min(matchTriggerWidth ? trigger.current?.getBoundingClientRect().width ?? width : width, innerWidth - 16);

  function close(restore = false) {
    setOpen(false); setSubmenu(null); setError('');
    if (restore && returnFocus.current?.isConnected) returnFocus.current.focus();
  }
  function show(at: Point | null, focus: HTMLElement | null) {
    setPoint(at); returnFocus.current = focus; setSubmenu(null); setError(''); setOpen(true);
  }
  useEffect(() => {
    const target = contextTarget?.current;
    if (!target) return;
    const showContext = (event: MouseEvent) => {
      event.preventDefault();
      show({ left: event.clientX, top: event.clientY }, target.querySelector<HTMLButtonElement>('button'));
    };
    target.addEventListener('contextmenu', showContext);
    return () => target.removeEventListener('contextmenu', showContext);
  }, [contextTarget]);
  useLayoutEffect(() => {
    if (!open || !mainMenu.current) return;
    const anchor = point ? new DOMRect(point.left, point.top, 0, 0) : trigger.current?.getBoundingClientRect();
    if (anchor) setPosition(positionMenu(anchor, menuWidth, mainMenu.current.getBoundingClientRect().height, point ? 'submenu' : placement));
  }, [open, point, placement, menuWidth, error]);
  useLayoutEffect(() => {
    if (!open || !mainMenu.current) return;
    mainMenu.current.querySelector<HTMLButtonElement>('[role^=menuitem]')?.focus();
  }, [open, point]);
  useLayoutEffect(() => {
    if (!submenu || !subMenu.current || !mainMenu.current) return;
    const button = [...mainMenu.current.querySelectorAll<HTMLButtonElement>('[data-menu-item]')]
      .find(element => element.dataset.menuItem === submenu);
    if (!button) return;
    setSubPosition(positionMenu(button.getBoundingClientRect(), Math.min(220, innerWidth - 16),
      subMenu.current.getBoundingClientRect().height, 'submenu'));
    if (focusSubmenu.current) subMenu.current.querySelector<HTMLButtonElement>('[role^=menuitem]')?.focus();
    focusSubmenu.current = false;
  }, [submenu, error]);
  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !layer.current?.contains(event.target) && !trigger.current?.contains(event.target)) close();
    };
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node) || !layer.current?.contains(event.target)) close();
    };
    const resize = () => close();
    document.addEventListener('pointerdown', pointer);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', pointer);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', resize);
    };
  }, [open]);
  function openSubmenu(item: Item, focus: boolean) {
    if (!item.children || item.disabledReason) return;
    if (submenu === item.id && focus) {
      subMenu.current?.querySelector<HTMLButtonElement>('[role^=menuitem]')?.focus();
      return;
    }
    if (errorInSubmenu) setError('');
    focusSubmenu.current = focus;
    setSubmenu(item.id);
  }
  function select(item: Item, inSubmenu: boolean) {
    if (item.disabledReason) { setErrorInSubmenu(inSubmenu); setError(item.disabledReason); return; }
    if (busyRef.current) return;
    if (item.children) { openSubmenu(item, true); return; }
    if (!item.onSelect) return;
    setError(''); setErrorInSubmenu(inSubmenu); busyRef.current = true; setBusy(true);
    let result: void | Promise<void>;
    try { result = item.onSelect(); } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      busyRef.current = false; setBusy(false); return;
    }
    void Promise.resolve(result).then(() => {
      if (item.role !== 'menuitemcheckbox') close(true);
    }, cause => {
      setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { busyRef.current = false; setBusy(false); });
  }
  function keyboard(event: ReactKeyboardEvent<HTMLDivElement>, isSubmenu: boolean) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      if (isSubmenu) {
        const button = mainMenu.current?.querySelector<HTMLButtonElement>('[aria-expanded=true]');
        setSubmenu(null); if (errorInSubmenu) setError(''); button?.focus();
      } else close(true);
      return;
    }
    if (event.key === 'ArrowLeft' && isSubmenu) {
      event.preventDefault();
      const button = mainMenu.current?.querySelector<HTMLButtonElement>('[aria-expanded=true]');
      setSubmenu(null); if (errorInSubmenu) setError(''); button?.focus(); return;
    }
    if (event.key === 'ArrowRight' && !isSubmenu) {
      const current = event.target instanceof HTMLElement ? event.target.dataset.menuItem : undefined;
      const item = items.find((entry): entry is Item => entry.kind === 'item' && entry.id === current);
      if (item?.children) { event.preventDefault(); openSubmenu(item, true); }
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(':scope > button[role^=menuitem]')];
    if (!buttons.length) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : event.key === 'ArrowDown' ? (current + 1) % buttons.length : (current + buttons.length - 1) % buttons.length;
    buttons[next]?.focus();
  }
  function renderEntries(entries: readonly SidebarMenuEntry[], inSubmenu: boolean) {
    return entries.map((entry, index) => {
      if (entry.kind === 'separator') return <div key={index} role="separator" className="yard-sidebar-menu-separator" />;
      if (entry.kind === 'heading') return <div key={index} className="yard-sidebar-menu-heading">{entry.label}</div>;
      return <button key={entry.id} type="button" role={entry.role ?? 'menuitem'} data-menu-item={entry.id}
        aria-disabled={!!entry.disabledReason || busy || undefined} aria-description={entry.disabledReason} title={entry.disabledReason}
        aria-checked={entry.role === 'menuitemradio' || entry.role === 'menuitemcheckbox' ? !!entry.checked : undefined}
        aria-haspopup={entry.children ? 'menu' : undefined} aria-expanded={entry.children ? submenu === entry.id : undefined}
        className={entry.danger ? 'yard-sidebar-menu-danger' : undefined}
        onMouseEnter={() => {
          if (!inSubmenu) {
            if (entry.children) openSubmenu(entry, false);
            else { setSubmenu(null); if (errorInSubmenu) setError(''); }
          }
        }}
        onClick={() => select(entry, inSubmenu)}>
        {entry.icon && <span className="yard-sidebar-menu-icon">{entry.icon}</span>}
        <span className="yard-sidebar-menu-copy"><span>{entry.label}</span>
          {entry.description && <span className="yard-sidebar-menu-description">{entry.description}</span>}</span>
        {entry.shortcut && <kbd>{entry.shortcut}</kbd>}
        {entry.checked && <Check aria-hidden="true" className="yard-sidebar-menu-check" />}
        {entry.children && <ChevronRight aria-hidden="true" className="yard-sidebar-menu-chevron" />}
      </button>;
    });
  }
  return <>
    <button ref={trigger} type="button" className={className} aria-label={label} title={label}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => open ? close() : show(null, trigger.current)}>{children}</button>
    {open && createPortal(<div ref={layer} className="yard-sidebar-menu-layer">
      <div ref={mainMenu} id={id} className="yard-owned-sidebar-menu" role="menu" aria-label={label}
        style={{ ...position, width: menuWidth }} onKeyDown={event => keyboard(event, false)}>
        {renderEntries(items, false)}{error && !errorInSubmenu && <div className="yard-sidebar-menu-error" role="alert">{error}</div>}
      </div>
      {active?.children && <div ref={subMenu} className="yard-owned-sidebar-menu yard-owned-sidebar-submenu"
        role="menu" aria-label={active.label} style={{ ...subPosition, width: Math.min(220, innerWidth - 16) }}
        onKeyDown={event => keyboard(event, true)}>{renderEntries(active.children, true)}
        {error && errorInSubmenu && <div className="yard-sidebar-menu-error" role="alert">{error}</div>}</div>}
    </div>, document.body)}
  </>;
}
