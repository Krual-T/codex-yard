import { Archive, ChevronRight, Copy, GitFork, MessageSquarePlus, Pencil, Pin, PinOff } from 'lucide-react';
import { WorkspaceIcon } from './workspace-icon.tsx';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ChatCopy } from './thread-copy.ts';

function moveMenuFocus(event: KeyboardEvent<HTMLDivElement>) {
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(':scope > [role="menuitem"]:enabled'));
  if (!buttons.length) return;
  const current = buttons.findIndex(button => button === document.activeElement);
  const index = event.key === 'ArrowDown' ? (current + 1) % buttons.length :
    event.key === 'ArrowUp' ? current < 0 ? buttons.length - 1 : (current - 1 + buttons.length) % buttons.length :
    event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
  if (index >= 0) { event.preventDefault(); buttons[index]?.focus(); }
}

export type ThreadAction = 'rename' | 'pin' | 'archive';

export function ArchiveConfirmation({ title, cancel, accept }: { title: string; cancel(): void; accept(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return <dialog ref={dialog} className="yard-source-archive-dialog bg-surface-elevated-secondary text-default"
    aria-labelledby="yard-source-archive-heading" aria-describedby="yard-source-archive-description"
    onCancel={event => { event.preventDefault(); cancel(); }}>
    <h2 id="yard-source-archive-heading">Stop and archive chat?</h2>
    <p id="yard-source-archive-description">“{title}” is still running. Archiving it will stop the current turn.</p>
    <footer>
      <button type="button" autoFocus onClick={cancel}>Cancel</button>
      <button type="button" onClick={accept}>Stop and archive</button>
    </footer>
  </dialog>;
}

export function SidebarThreadMenu({ x, y, trigger, pinned, choose, close }: {
  x: number;
  y: number;
  trigger: HTMLElement;
  pinned: boolean;
  choose(action: ThreadAction): void;
  close(): void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = menu.current!;
    element.showPopover();
    const { width, height } = element.getBoundingClientRect();
    element.style.left = Math.max(8, Math.min(x, innerWidth - width - 8)) + 'px';
    element.style.top = Math.max(8, y + height + 8 <= innerHeight ? y : y - height) + 'px';
    element.querySelector('button')?.focus();
  }, [x, y]);
  useEffect(() => {
    // The right-click contextmenu event can fire before pointerup in Chromium.
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target) && !trigger.contains(event.target)) close();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [close, trigger]);
  return <div ref={menu} role="menu" aria-label="Chat actions" popover="manual" className="yard-source-thread-menu"
    onKeyDown={event => {
      if (event.key === 'Tab' || event.key === 'Escape') {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); }
        trigger.focus({ preventScroll: true });
        close();
        return;
      }
      moveMenuFocus(event);
    }}>
    <button type="button" role="menuitem" onClick={() => choose('rename')}><Pencil size={16} />Rename</button>
    <button type="button" role="menuitem" onClick={() => choose('pin')}>
      {pinned ? <PinOff size={16} /> : <Pin size={16} />}{pinned ? 'Unpin' : 'Pin'}
    </button>
    <div role="separator" />
    <button type="button" role="menuitem" onClick={() => choose('archive')}><Archive size={16} />Archive</button>
  </div>;
}

export function HeaderChatActions({ pinned, pending, rename, pin, fork, archive, sidechat, copy, hasDirectory }: {
  pinned: boolean; pending: boolean;
  rename(): void; pin(): void; fork(): void; archive(trigger: HTMLButtonElement): void; sidechat?(): void;
  copy(action: ChatCopy): void; hasDirectory: boolean;
}) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const copyTrigger = useRef<HTMLButtonElement>(null);
  const forkTrigger = useRef<HTMLButtonElement>(null);
  const submenu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [subview, setSubview] = useState<'copy' | 'fork'>();
  const subtrigger = subview === 'copy' ? copyTrigger : forkTrigger;
  function close() {
    setSubview(undefined);
    menu.current?.hidePopover();
    trigger.current?.focus({ preventScroll: true });
  }
  function choose(action: () => void) { close(); action(); }
  function closeSubmenu() {
    setSubview(undefined);
    subtrigger.current?.focus({ preventScroll: true });
  }
  useLayoutEffect(() => {
    if (!subview || !submenu.current || !menu.current || !subtrigger.current) return;
    const element = submenu.current;
    element.showPopover();
    const surface = menu.current.getBoundingClientRect();
    const anchor = subtrigger.current.getBoundingClientRect();
    const { width, height } = element.getBoundingClientRect();
    const preferred = surface.left >= width + 12 ? surface.left - width - 3 : surface.right + 3;
    Object.assign(element.style, {
      left: Math.max(8, Math.min(innerWidth - width - 8, preferred)) + 'px',
      top: Math.max(8, Math.min(anchor.top - 4, innerHeight - height - 8)) + 'px',
    });
    element.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    return () => element.hidePopover();
  }, [subview, subtrigger]);
  function openSubmenu(event: KeyboardEvent<HTMLButtonElement>, target: 'copy' | 'fork') {
    if (event.key !== 'ArrowRight') return;
    event.preventDefault();
    setSubview(target);
  }
  return <>
    <button type="button" ref={trigger} title="Chat actions" aria-label="Chat actions" aria-haspopup="menu" aria-expanded={open}
      className="yard-source-header-actions" popoverTarget={id} onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect();
        const width = Math.min(220, innerWidth - 16);
        Object.assign(menu.current!.style, {
          width: width + 'px', left: Math.max(8, Math.min(rect.left, innerWidth - width - 7)) + 'px', top: rect.bottom + 2 + 'px',
        });
      }}><WorkspaceIcon name="more" /></button>
    <div id={id} ref={menu} popover="auto" role="menu" aria-label="Chat actions" className="yard-source-thread-menu yard-source-header-menu"
      onToggle={event => {
        setOpen(event.newState === 'open');
        if (event.newState === 'closed') setSubview(undefined);
      }} onKeyDown={event => {
        if (event.key === 'Tab' || event.key === 'Escape') {
          if (event.key === 'Escape') event.preventDefault();
          close();
        } else moveMenuFocus(event);
      }}>
      <button type="button" role="menuitem" autoFocus onClick={() => choose(rename)}><Pencil size={16} />Rename</button>
      <button type="button" role="menuitem" disabled={pending} onClick={() => choose(pin)}>
        {pinned ? <PinOff size={16} /> : <Pin size={16} />}{pinned ? 'Unpin' : 'Pin'}
      </button>
      <div role="separator" />
      {sidechat && <button type="button" role="menuitem" onClick={() => choose(sidechat)}><MessageSquarePlus size={16} />New side chat</button>}
      <button type="button" role="menuitem" ref={forkTrigger} aria-haspopup="menu" aria-expanded={subview === 'fork'}
        aria-controls={id + '-fork'} onClick={() => setSubview(subview === 'fork' ? undefined : 'fork')}
        onKeyDown={event => openSubmenu(event, 'fork')}>
        <GitFork size={16} />Fork<ChevronRight size={14} className="yard-source-submenu-caret" />
      </button>
      <div role="separator" />
      <button type="button" role="menuitem" ref={copyTrigger} aria-haspopup="menu" aria-expanded={subview === 'copy'}
        aria-controls={id + '-copy'} onClick={() => setSubview(subview === 'copy' ? undefined : 'copy')}
        onKeyDown={event => openSubmenu(event, 'copy')}>
        <Copy size={16} />Copy<ChevronRight size={14} className="yard-source-submenu-caret" />
      </button>
      {subview && <div ref={submenu} id={id + '-' + subview} role="menu" aria-label={subview === 'copy' ? 'Copy' : 'Fork'}
        popover="manual" className="yard-source-thread-menu yard-source-header-submenu" data-source-submenu={subview}
        onKeyDown={event => {
          if (event.key === 'ArrowLeft' || event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeSubmenu();
          } else if (event.key !== 'Tab') {
            event.stopPropagation();
            moveMenuFocus(event);
          }
        }}>
        {subview === 'fork' ? <button type="button" role="menuitem" onClick={() => choose(fork)}><GitFork size={16} />Fork chat</button> : <>
        <button type="button" role="menuitem" onClick={() => choose(() => copy('link'))}><Copy size={16} />Copy deeplink</button>
        <button type="button" role="menuitem" onClick={() => choose(() => copy('markdown'))}><Copy size={16} />Copy as Markdown</button>
        <button type="button" role="menuitem" disabled={!hasDirectory} onClick={() => choose(() => copy('directory'))}>
          <Copy size={16} />Copy working directory
        </button>
        </>}
      </div>}
      <div role="separator" />
      <button type="button" role="menuitem" disabled={pending} onClick={() => choose(() => archive(trigger.current!))}>
        <Archive size={16} />Archive
      </button>
    </div>
  </>;
}
