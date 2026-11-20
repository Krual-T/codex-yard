import { AtSign, ChevronDown, ChevronRight, File, Globe, Link, Paperclip, Search, Workflow } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import type { TurnSummary } from '../../lib/codex-protocol.ts';
import { conversationSources, type ConversationSources, type SourceItemsByTurn } from './conversation-sources-model.ts';
import { McpCallOutput } from './mcp-call-output.tsx';
import { workspacePlugins } from './sidebar-profile.tsx';
import { WorkspaceIcon } from './workspace-icon.tsx';
import { listComposerPlugins } from './host.ts';
import type { PluginMention } from './output-types.ts';
import type { PromptAttachment } from './composer-input.ts';
import type { TurnStream } from './turn-stream.ts';
import './conversation-sources.css';

const emptyItems: SourceItemsByTurn = new Map();
const readEmpty = () => emptyItems;
const noSubscription = () => () => {};

export function useConversationSources(turns: readonly TurnSummary[] | undefined, stream: TurnStream | undefined) {
  const known = useSyncExternalStore(stream?.subscribe ?? noSubscription, stream?.readSources ?? readEmpty);
  return useMemo(() => conversationSources(turns ?? [], known), [turns, known]);
}

function moveInMenu(event: KeyboardEvent<HTMLDivElement>) {
  if (event.defaultPrevented || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) ||
      event.target instanceof HTMLInputElement && (event.key === 'Home' || event.key === 'End')) return;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(':scope > [role="menuitem"], :scope > label > input')];
  if (!items.length) return;
  const current = items.indexOf(document.activeElement as HTMLElement);
  const next = event.key === 'Home' || (current < 0 && event.key === 'ArrowDown') ? 0 :
    event.key === 'End' || current < 0 ? items.length - 1 :
    (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  event.preventDefault();
  items[next]?.focus();
}

function PluginChoices({ cwd, insert, hostId }: { cwd: string | undefined; insert(mention: PluginMention): void; hostId: string }) {
  const [query, setQuery] = useState('');
  const [listing, setListing] = useState<PluginMention[] | 'failed'>();
  useEffect(() => {
    let current = true;
    void listComposerPlugins(cwd, hostId).then(plugins => { if (current) setListing(plugins); }, () => { if (current) setListing('failed'); });
    return () => { current = false; };
  }, [cwd, hostId]);
  const filtered = Array.isArray(listing) ? listing.filter(plugin =>
    (plugin.label + ' ' + plugin.plugin).toLowerCase().includes(query.trim().toLowerCase())) : [];
  return <>
    <label><Search size={13} aria-hidden="true" /><input aria-label="Search plugins" placeholder="Search plugins…" value={query}
      onChange={event => setQuery(event.target.value)} /></label>
    {listing === undefined ? <p role="status">Loading plugins…</p> :
      listing === 'failed' ? <p role="alert">Couldn't load plugins</p> :
        !filtered.length && <p role="status">{query.trim() ? 'No results' : 'No enabled plugins'}</p>}
    {filtered.map(plugin => <button key={plugin.plugin} type="button" role="menuitem" onClick={() => insert(plugin)}>
      <AtSign size={14} aria-hidden="true" /><span>{plugin.label}</span>
    </button>)}
    <a role="menuitem" href={workspacePlugins}><AtSign size={14} aria-hidden="true" /><span>Connect plugins</span><ChevronRight size={12} aria-hidden="true" /></a>
  </>;
}

function SourceMenu({ attach, cwd, insertPlugin, hostId }: { attach(): void; cwd?: string; insertPlugin(mention: PluginMention): void; hostId: string }) {
  const id = useId(), pluginsId = useId();
  const menu = useRef<HTMLDivElement>(null);
  const pluginMenu = useRef<HTMLDivElement>(null);
  const pluginTrigger = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [plugins, setPlugins] = useState(false);
  const showPlugins = (focus: boolean) => {
    if (!pluginMenu.current || !menu.current) return;
    const surface = pluginMenu.current;
    const { left, top, bottom } = menu.current.getBoundingClientRect();
    const beside = left >= 252;
    surface.style.left = (beside ? left - 244 : Math.max(8, Math.min(innerWidth - 248, left))) + 'px';
    surface.style.top = Math.max(8, Math.min(innerHeight - 136, beside ? top : bottom + 3)) + 'px';
    if (!surface.matches(':popover-open')) surface.showPopover();
    if (focus) requestAnimationFrame(() => surface.querySelector('input')?.focus());
  };
  return <>
    <button ref={trigger} className="yard-source-output-add" type="button" title="Attach files or connect apps"
      aria-label="Attach files or connect apps" aria-haspopup="menu" aria-expanded={open} popoverTarget={id}
      onClick={event => {
        const bounds = event.currentTarget.getBoundingClientRect();
        if (!menu.current) return;
        menu.current.style.left = Math.max(8, Math.min(innerWidth - 188, bounds.right - 180)) + 'px';
        menu.current.style.top = Math.max(8, Math.min(innerHeight - 122, bounds.bottom + 2)) + 'px';
      }}><WorkspaceIcon name="plus" /></button>
    <div id={id} ref={menu} popover="auto" className="yard-source-sources-menu" role="menu" aria-label="Add a source"
      onToggle={event => setOpen(event.newState === 'open')} onKeyDown={moveInMenu}>
      <button ref={pluginTrigger} role="menuitem" type="button" aria-haspopup="menu" aria-controls={pluginsId} aria-expanded={plugins}
        onClick={() => showPlugins(true)} onPointerEnter={event => { if (event.pointerType === 'mouse') showPlugins(false); }}
        onKeyDown={event => { if (event.key === 'ArrowRight') { event.preventDefault(); showPlugins(true); } }}>
        <AtSign size={14} aria-hidden="true" /><span>Use plugins</span><ChevronRight size={12} aria-hidden="true" />
      </button>
      <button role="menuitem" type="button" onPointerEnter={() => pluginMenu.current?.hidePopover()}
        onClick={() => { menu.current?.hidePopover(); attach(); trigger.current?.focus(); }}>
        <Paperclip size={14} aria-hidden="true" /><span>Attach files or folders</span>
      </button>
      <div id={pluginsId} ref={pluginMenu} popover="auto" className="yard-source-sources-menu yard-source-sources-plugins"
        role="menu" aria-label="Plugins"
        onToggle={event => setPlugins(event.newState === 'open')}
        onKeyDown={event => {
          if (event.key === 'ArrowLeft' && !(event.target instanceof HTMLInputElement)) {
            event.preventDefault(); pluginMenu.current?.hidePopover(); pluginTrigger.current?.focus();
          }
          moveInMenu(event); event.stopPropagation();
        }}>
        {plugins && <PluginChoices cwd={cwd} hostId={hostId} insert={plugin => { menu.current?.hidePopover(); insertPlugin(plugin); }} />}
      </div>
    </div>
  </>;
}

function SourcesFiles({ files, openFile }: { files: readonly PromptAttachment[]; openFile(file: PromptAttachment): void }) {
  return files.map(file => <li key={file.path}>
    <button type="button" className="yard-source-sources-file" title={file.name} onClick={() => openFile(file)}>
      <File size={14} aria-hidden="true" /><span dir="auto">{file.name}</span>
    </button>
  </li>);
}

type SourceActions = { openFile(file: PromptAttachment): void };
export function SourcesSummary({ data, openDetails, openFile, attach, insertPlugin, cwd, hostId }: SourceActions & {
  data: ConversationSources; openDetails(): void; attach(): void; insertPlugin(mention: PluginMention): void; cwd?: string; hostId: string;
}) {
  const section = useId();
  const [expanded, setExpanded] = useState(true);
  const hasWeb = data.web.searchCount > 0 || data.web.pages.length > 0;
  if (!data.integrations.length && !hasWeb && !data.files.length) return null;
  return <section className="yard-source-sources-summary">
    <header>
      <button type="button" className="yard-source-output-heading" aria-expanded={expanded} aria-controls={section}
        onClick={() => setExpanded(value => !value)}><span>Sources</span>
        {expanded ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
      </button>
      <SourceMenu attach={attach} cwd={cwd} insertPlugin={insertPlugin} hostId={hostId} />
    </header>
    <div id={section} hidden={!expanded}>
      <ul aria-label="Sources" className="yard-source-sources-list">
        <SourcesFiles files={data.files} openFile={openFile} />
        {data.integrations.map(integration => <li key={integration.id}><Workflow size={14} aria-hidden="true" /><span>{integration.name}</span></li>)}
        {hasWeb && <li><Globe size={14} aria-hidden="true" /><span>Web search</span></li>}
      </ul>
      <button type="button" className="yard-source-sources-view" onClick={openDetails}><Workflow size={14} aria-hidden="true" />View all</button>
    </div>
  </section>;
}

function SourceDisclosure({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return <li className="yard-source-source-disclosure">
    <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
      <span>{label}</span>{open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
    </button>
    <ul id={id} hidden={!open}>{open && children}</ul>
  </li>;
}

export function SourcesPanel({ data, openFile, openPage }: SourceActions & {
  data: ConversationSources; openPage(url: string): void;
}) {
  const { searchCount, queries, pages } = data.web;
  return <div className="yard-source-sources-panel">
    <ul aria-label="Sources">
      <SourcesFiles files={data.files} openFile={openFile} />
      {data.integrations.map(integration => <li key={integration.id} className="yard-source-sources-group">
        <div><Workflow size={16} aria-hidden="true" /><span>{integration.name}</span></div>
        <ul>
          {integration.tools.map(tool => <SourceDisclosure key={tool.id}
            label={tool.name + (tool.calls.length === 1 ? '' : ' ' + tool.calls.length + ' times')}>
            {tool.calls.map(call => <li key={call.id}><McpCallOutput item={call.item} preferStructured /></li>)}
          </SourceDisclosure>)}
        </ul>
      </li>)}
      {(searchCount > 0 || pages.length > 0) && <li className="yard-source-sources-group yard-source-sources-web">
        <div><Globe size={16} aria-hidden="true" /><span>Web search</span></div>
        <ul>
          {searchCount > 0 && <SourceDisclosure label={searchCount === 1 ? 'Searched once' : 'Searched ' + searchCount + ' times'}>
            {queries.map(query => <li key={query}>{query}</li>)}
          </SourceDisclosure>}
          {pages.length > 0 && <SourceDisclosure label={pages.length === 1 ? 'Opened one page' : 'Opened ' + pages.length + ' pages'}>
            {pages.map(page => <li key={page.url}>
              <button type="button" className="yard-source-source-link" title={page.url} onClick={() => openPage(page.url)}>
                <Link size={14} aria-hidden="true" /><span>{page.label}</span>
              </button>
            </li>)}
          </SourceDisclosure>}
        </ul>
      </li>}
    </ul>
  </div>;
}
