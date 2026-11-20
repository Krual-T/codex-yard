import { ChevronRight, Ghost, LifeBuoy, Settings } from 'lucide-react';
import { WorkspaceIcon } from './workspace-icon.tsx';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { mountBrowserPet } from '../native/browser-pet.ts';
import type { HostMessage } from '../native/protocol.ts';
import { profileLabel, sendHostMessage } from './host.ts';

export const workspacePlugins = '/?initialRoute=/plugins';
let petMounted = false;

export function settingsUrl(section: string, returnRoute?: string) {
  const query = new URLSearchParams({ initialRoute: '/settings/' + section });
  if (returnRoute) query.set('workspaceReturn', returnRoute);
  return '/?' + query;
}

function mountPet() {
  if (petMounted) return;
  mountBrowserPet(React, { createRoot }, sendHostMessage);
  petMounted = true;
}

export function SidebarProfile({ returnRoute }: { returnRoute?: string }) {
  const id = React.useId();
  const helpId = React.useId();
  const trigger = React.useRef<HTMLButtonElement>(null);
  const surface = React.useRef<HTMLDivElement>(null);
  const helpTrigger = React.useRef<HTMLButtonElement>(null);
  const helpSurface = React.useRef<HTMLDivElement>(null);
  const focusHelp = React.useRef(false);
  const [label, setLabel] = React.useState('Settings');
  const [showProfile, setShowProfile] = React.useState(false);
  const [showHelp, setShowHelp] = React.useState(false);
  const [petOpen, setPetOpen] = React.useState(false);
  const [error, setError] = React.useState<string>();

  React.useEffect(() => {
    let revision = 0;
    const refresh = () => {
      const request = ++revision;
      void profileLabel().then(label => { if (request === revision) setLabel(label); });
    };
    const receive = (event: MessageEvent<HostMessage>) => {
      if (event.source !== window || event.origin !== location.origin) return;
      const message = event.data;
      if (message?.type === 'workbench-pet-state') {
        const visible = (message.state as { isOpen?: boolean } | null)?.isOpen === true;
        setPetOpen(visible);
        if (visible) mountPet();
      } else if (message?.type === 'mcp-notification' && message.hostId === 'local' &&
          (message.method === 'account/updated' || message.method === 'account/gatewayOAuth/changed')) refresh();
    };
    let paint = requestAnimationFrame(() => {
      paint = requestAnimationFrame(() => {
        refresh();
        void sendHostMessage({ type: 'avatar-overlay-open-state-request' }).catch(console.error);
      });
    });
    window.addEventListener('message', receive);
    return () => {
      cancelAnimationFrame(paint);
      revision++;
      window.removeEventListener('message', receive);
    };
  }, []);

  React.useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      if (event.key === ',' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        location.assign(settingsUrl('general-settings', returnRoute));
      } else if (event.code === 'KeyP' && event.altKey && event.metaKey && !event.ctrlKey && !event.shiftKey) {
        event.preventDefault();
        togglePet();
      }
    };
    window.addEventListener('keydown', shortcuts);
    return () => window.removeEventListener('keydown', shortcuts);
  }, [returnRoute]);

  function togglePet() {
    setError(undefined);
    mountPet();
    void sendHostMessage({ type: 'avatar-overlay-open' }).catch(() => setError('Unable to change Mini visibility.'));
  }
  function selectHelp(keyboard: boolean) {
    const parent = surface.current, submenu = helpSurface.current, button = helpTrigger.current;
    if (!parent || !submenu || !button) return;
    const bounds = parent.getBoundingClientRect(), row = button.getBoundingClientRect();
    const beside = innerWidth - bounds.right >= 200;
    submenu.style.left = (beside ? bounds.right + 4 : bounds.left + 4) + 'px';
    submenu.style.bottom = (innerHeight - (beside ? row.bottom : bounds.top) + 4) + 'px';
    if (!submenu.matches(':popover-open')) {
      focusHelp.current = keyboard;
      submenu.showPopover();
    } else if (keyboard) submenu.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }
  function closeProfile() {
    surface.current?.hidePopover();
    trigger.current?.focus({ preventScroll: true });
  }
  function closeHelp(event: React.KeyboardEvent) {
    if (event.key !== 'ArrowLeft' || !helpSurface.current?.matches(':popover-open')) return false;
    event.preventDefault();
    helpSurface.current.hidePopover();
    helpTrigger.current?.focus();
    return true;
  }
  function moveInMenu(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const entries = [...event.currentTarget.querySelectorAll<HTMLElement>(':scope > [role="menuitem"]:not([aria-disabled])')];
    if (!entries.length) return;
    event.preventDefault();
    const current = entries.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 :
      (current < 0 ? (event.key === 'ArrowDown' ? 0 : entries.length - 1) :
        (current + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length);
    entries[next]?.focus();
  }

  return <footer className="yard-source-profile">
    <button ref={trigger} type="button" className="yard-source-profile-trigger sidebar-item hover:bg-primary-ghost-hover"
      aria-haspopup="menu" aria-expanded={showProfile} popoverTarget={id} onClick={event => {
        const menu = surface.current;
        if (!menu) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        menu.style.left = (bounds.left + 1) + 'px';
        menu.style.bottom = (innerHeight - bounds.top + 7) + 'px';
        menu.style.width = bounds.width + 'px';
      }}>
      <WorkspaceIcon name="gear" /><span>{label}</span>
    </button>
    {error && <p role="alert" className="yard-source-sidebar-error">{error}</p>}
    <div ref={surface} id={id} className="yard-source-profile-menu bg-surface-elevated-secondary/90 backdrop-blur-sm"
      popover="auto" role="menu" aria-label={label} tabIndex={-1}
      onKeyDown={event => { if (!closeHelp(event)) moveInMenu(event); }} onToggle={event => {
        if (event.target !== event.currentTarget) return;
        const open = event.newState === 'open';
        setShowProfile(open);
        if (open && !event.currentTarget.contains(document.activeElement)) event.currentTarget.focus();
      }}>
      <div role="menuitem" aria-disabled="true">{label}</div>
      <div role="separator" />
      <button type="button" role="menuitem" tabIndex={-1} onClick={() => { closeProfile(); togglePet(); }}>
        <Ghost size={14} aria-hidden="true" />{petOpen ? 'Hide Pet' : 'Show Pet'}<kbd>Alt+Super+P</kbd>
      </button>
      <a role="menuitem" tabIndex={-1} href={settingsUrl('general-settings', returnRoute)}>
        <Settings size={14} aria-hidden="true" />Settings<kbd>Ctrl+,</kbd>
      </a>
      <div role="separator" />
      <button ref={helpTrigger} type="button" role="menuitem" tabIndex={-1} aria-haspopup="menu" aria-expanded={showHelp}
        aria-controls={helpId} onClick={event => selectHelp(event.detail === 0)}
        onKeyDown={event => { if (event.key === 'ArrowRight') { event.preventDefault(); selectHelp(true); } }}>
        <LifeBuoy size={14} aria-hidden="true" />Help<ChevronRight size={14} className="yard-source-profile-caret" aria-hidden="true" />
      </button>
      <div ref={helpSurface} id={helpId} popover="auto" role="menu" aria-label="Help" tabIndex={-1}
        className="yard-source-profile-menu yard-source-profile-help bg-surface-elevated-secondary/90 backdrop-blur-sm"
        onToggle={event => {
          const open = event.newState === 'open';
          setShowHelp(open);
          if (open && focusHelp.current) event.currentTarget.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
        }} onKeyDown={event => {
          if (!closeHelp(event)) moveInMenu(event);
          if (event.defaultPrevented) event.stopPropagation();
        }}>
        <a role="menuitem" tabIndex={-1} href="https://developers.openai.com/codex/changelog" target="_blank" rel="noreferrer" onClick={closeProfile}>What's new</a>
        <a role="menuitem" tabIndex={-1} href={settingsUrl('keyboard-shortcuts', returnRoute)}>Keyboard shortcuts</a>
        <a role="menuitem" tabIndex={-1} href="https://learn.chatgpt.com/docs/quickstart" target="_blank" rel="noreferrer" onClick={closeProfile}>User guide</a>
      </div>
    </div>
  </footer>;
}
