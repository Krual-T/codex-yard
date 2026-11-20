import { ChevronDown, ChevronRight, File, GalleryVerticalEnd, LayoutGrid, Table2 } from 'lucide-react';
import { WorkspaceIcon } from './workspace-icon.tsx';
import { useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import type { TurnSummary } from '../../lib/codex-protocol.ts';
import { outputFileUrl, outputTypes, type OutputFile, type OutputType } from './output-types.ts';
import { loadMessageReader } from './load-message-reader.ts';

export function Outputs({ create, choose, cwd, turns, hostId }: {
  create(type: OutputType): void;
  choose(file: OutputFile): void;
  cwd?: string;
  turns?: TurnSummary[];
  hostId: string;
}) {
  const menuId = useId();
  const panelId = useId();
  const anchor = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const keyboard = useRef(false);
  const [expanded, setExpanded] = useState(true);
  const [opening, setOpening] = useState<{ keyboard: boolean } | null>(null);
  const open = opening !== null;
  const [files, setFiles] = useState<OutputFile[]>([]);
  useLayoutEffect(() => {
    if (!opening || !menu.current) return;
    const focus = (opening.keyboard && menu.current.querySelector('button')) || menu.current;
    focus.focus();
  }, [opening]);

  useEffect(() => {
    if (!expanded || !cwd || !turns?.some(turn => turn.status === 'completed' &&
        turn.items.some(item => item.type === 'agentMessage' && typeof item.text === 'string' && item.text.includes('[')))) {
      setFiles(previous => previous.length ? [] : previous);
      return;
    }
    const controller = new AbortController();
    const signal = controller.signal;
    void loadMessageReader().then(async ({ linkedWorkspaceOutputs }) => {
      if (signal.aborted) return;
      const candidates = linkedWorkspaceOutputs(turns, cwd);
      const present = await Promise.all(candidates.map(async file => {
        try {
          const response = await fetch(outputFileUrl(file, 'content', hostId), { method: 'HEAD', signal });
          return response.ok ? file : undefined;
        } catch { return undefined; }
      }));
      if (!signal.aborted) setFiles(present.filter(file => file !== undefined));
    }).catch(console.error);
    return () => controller.abort();
  }, [cwd, turns, expanded, hostId]);

  function position(event: MouseEvent<HTMLButtonElement>) {
    if (!anchor.current || !menu.current) return;
    keyboard.current = event.detail === 0;
    const rect = anchor.current.getBoundingClientRect();
    menu.current.style.left = Math.max(8, Math.min(innerWidth - 188, rect.right - 181)) + 'px';
    menu.current.style.top = (rect.bottom + 2) + 'px';
  }

  return <section className="yard-source-outputs">
    <header>
      <button type="button" className="yard-source-output-heading" aria-expanded={expanded} aria-controls={panelId}
        onClick={() => setExpanded(value => !value)}><span>Outputs</span>
        {expanded ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
      </button>
      <button ref={anchor} type="button" className="yard-source-output-add hover:bg-primary-ghost-hover"
        aria-label="Create a file or site" aria-haspopup="menu" aria-expanded={open} popoverTarget={menuId} onClick={position}>
        <WorkspaceIcon name="plus" />
      </button>
    </header>
    <div id={panelId} hidden={!expanded}>
      {files.length ? <ul className="yard-source-output-files">
        {files.map(file => <li key={file.path}>
          <button type="button" className="hover:bg-primary-ghost-hover" onClick={() => choose(file)} title={file.name}>
            <File size={14} aria-hidden="true" /><span dir="auto">{file.name}</span>
          </button>
        </li>)}
      </ul> : <button type="button" className="yard-source-output-empty" aria-haspopup="menu" aria-expanded={open}
        popoverTarget={menuId} onClick={position}>Create a file or site</button>}
    </div>
    <div popover="auto" role="menu" aria-label="Create a file or site" aria-orientation="vertical" id={menuId} ref={menu} tabIndex={-1}
      className="yard-source-output-menu no-drag rounded-2xl bg-surface-elevated-secondary/90 text-default backdrop-blur-sm"
      onToggle={event => setOpening(event.newState === 'open' ? { keyboard: keyboard.current } : null)}
      onKeyDown={event => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const items = [...event.currentTarget.querySelectorAll('button')];
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' || (current < 0 && event.key === 'ArrowDown') ? 0 :
          event.key === 'End' || current < 0 ? items.length - 1 :
          (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        event.preventDefault();
        items[next]?.focus();
      }}>
      {open && outputTypes.map(type => <button key={type.kind} type="button" role="menuitem" tabIndex={-1}
        className="no-drag _itemBase_bdgpi_2 rounded-xl text-default group _itemInteractive_bdgpi_2 flex flex-col"
        onClick={() => { menu.current?.hidePopover(); create(type); }}>
        <span data-menu-row-content="true" className="flex w-full min-w-0 items-center gap-[var(--spacing-menu-item-content,calc(var(--spacing)*1.5))]">
          <span className="_leadingIcon_bdgpi_2" aria-hidden="true">
            {type.kind === 'site' ? <LayoutGrid size={16} className="yard-source-site-icon" /> :
              type.kind === 'presentation' ? <GalleryVerticalEnd size={14} /> :
              type.kind === 'spreadsheet' ? <Table2 size={14} /> :
              <img alt="" width="16" height="16" src="/images/ecosystem/apps/documents/icon.png" />}
          </span>
          <span className="truncate">Create {type.kind}</span>
        </span>
      </button>)}
    </div>
  </section>;
}
