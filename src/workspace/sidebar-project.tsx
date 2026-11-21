import { Archive, Check, Folder, List, MessageCircle, Pin, PinOff } from 'lucide-react';
import { lazy, Suspense, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ProjectSection, ProjectSectionDestination } from '../native/browser-sidebar-sections.ts';
import type { SidebarProjectDetails, StartupProject } from '../native/startup-sidebar.ts';
import { projectSections, readSidebarProject, type ProjectAction } from './host.ts';
import { ToolMenu, ToolMenuItem, ToolSubmenu } from './new-tab-tools.tsx';
import { WorkspaceIcon } from './workspace-icon.tsx';
import { ProjectMarker } from './project-marker.tsx';
import { ProjectMarkerPicker } from './project-marker-picker.tsx';

const ProjectSettings = lazy(() => import('./project-settings.tsx'));
const ProjectMenuDialog = lazy(() => import('./project-menu-dialog.tsx'));
type ProjectDialog = 'edit' | 'remove' | 'section' | 'files' | 'archive';

export function SidebarProjectRow({ project, hostId, expanded, selected, activity, toggle, start, update, sections, setSections, onArchived }: {
  project: StartupProject; hostId: string; expanded: boolean; selected: boolean;
  activity?: string;
  toggle(): void; start?: () => void; update(action: ProjectAction): Promise<void>;
  sections: ProjectSection[]; setSections(next: ProjectSection[]): void;
  onArchived(ids: string[], failed: number): void;
}) {
  const [card, setCard] = useState<'pointer' | 'keyboard'>();
  const [editing, setEditing] = useState<ProjectDialog>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const row = useRef<HTMLDivElement>(null);
  const toggleButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const restore = useRef<HTMLElement | null>(null);
  const detailsId = useId();
  const clear = () => clearTimeout(timer.current);
  function dismiss() { clear(); setCard(undefined); }
  function leave() {
    clear();
    timer.current = setTimeout(() => setCard(current => current === 'pointer' ? undefined : current), 220);
  }
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    const element = panel.current, anchor = row.current;
    if (!card || !element || !anchor) return;
    element.showPopover();
    const position = () => {
      const { left, right, top, bottom } = anchor.getBoundingClientRect();
      const { width, height } = element.getBoundingClientRect();
      const x = getComputedStyle(anchor).direction === 'rtl' ? left - width - 3 : right + 3;
      const y = x >= 8 && x + width + 8 <= innerWidth ? top : bottom + 4;
      element.style.left = Math.max(8, Math.min(x, innerWidth - width - 8)) + 'px';
      element.style.top = Math.max(8, Math.min(y, innerHeight - height - 8)) + 'px';
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(element);
    if (card === 'keyboard') element.querySelector('button')?.focus({ preventScroll: true });
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || element.querySelector('.yard-project-marker-picker:popover-open')) return;
      event.preventDefault();
      setCard(undefined);
      if (card === 'keyboard' || element.contains(document.activeElement)) toggleButton.current?.focus({ preventScroll: true });
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && (element.contains(event.target) || anchor.contains(event.target))) return;
      setCard(undefined);
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && element.contains(event.target)) return;
      setCard(undefined);
    };
    window.addEventListener('keydown', escape, true);
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', position);
    return () => {
      observer.disconnect();
      window.removeEventListener('keydown', escape, true);
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', position);
      if (element.matches(':popover-open')) element.hidePopover();
    };
  }, [card]);
  function openSettings(mode: ProjectDialog, trigger?: HTMLElement) {
    restore.current = trigger ?? row.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]') ?? toggleButton.current;
    dismiss();
    setEditing(mode);
  }
  function closeSettings() {
    setEditing(undefined);
    requestAnimationFrame(() => restore.current?.focus({ preventScroll: true }));
  }
  async function locate(destination: ProjectSectionDestination) {
    const next = await projectSections.move(project.id, destination);
    setSections(next);
    requestAnimationFrame(() => {
      const moved = Array.from(document.querySelectorAll<HTMLElement>('[data-app-action-sidebar-project-id]')).find(row =>
        row.dataset.appActionSidebarProjectId === project.id);
      moved?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.focus({ preventScroll: true });
    });
  }
  const showError = (failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure));
  const sectionId = sections.find(section => section.projectIds.includes(project.id))?.id;
  async function pin() {
    if (pending) return;
    setError(undefined);
    setPending(true);
    try { await update({ operation: 'pin', pinned: !project.pinned }); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setPending(false); }
  }
  const pinLabel = project.pinned ? 'Unpin' : 'Pin';
  const PinIcon = project.pinned ? PinOff : Pin;
  return <>
    <div ref={row} className="yard-source-project-group" data-app-action-sidebar-project-row=""
      data-app-action-sidebar-project-id={project.id} data-app-action-sidebar-project-label={project.label}
      data-card-open={card !== undefined || undefined}
      onPointerEnter={event => {
        if (event.pointerType === 'touch' || row.current?.querySelector('[role="menu"]:popover-open') || editing) return;
        clear();
        timer.current = setTimeout(() => setCard(open => open ?? 'pointer'), 350);
      }} onPointerLeave={leave}>
      <button ref={toggleButton} type="button" className="yard-source-action yard-source-project-row sidebar-item hover:bg-primary-ghost-hover"
        aria-label={project.label} aria-description={activity ? 'Loaded chats: ' + activity : undefined}
        aria-expanded={expanded} aria-current={selected ? 'true' : undefined}
        aria-controls={card ? detailsId : undefined} aria-keyshortcuts="ArrowRight"
        onClick={() => { dismiss(); toggle(); }} onKeyDown={event => {
          if (event.key === 'ArrowRight') { event.preventDefault(); clear(); setCard('keyboard'); }
        }}>
        <ProjectMarker appearance={project.appearance} /><span dir="auto" className="yard-source-project-label">{project.label}</span>
        {activity && <span className="yard-source-sidebar-activity" title={'Loaded chats: ' + activity} aria-hidden="true">{activity}</span>}
      </button>
      <div className="yard-source-project-quick">
        <ToolMenu align="start" className="yard-source-project-actions" label={project.label} deferContent
          triggerButton={<button type="button" title="Project actions" aria-label={'Project actions for ' + project.label}
            onClick={dismiss}><WorkspaceIcon name="more" size={14} /></button>}>
          <ToolMenuItem onSelect={() => void pin()}><PinIcon size={15} aria-hidden="true" />{pinLabel}</ToolMenuItem>
          <ToolMenuItem onSelect={() => openSettings('edit')}><WorkspaceIcon name="gear" />Edit</ToolMenuItem>
          <div role="separator" />
          <ToolSubmenu label="Section" icon={<List size={15} aria-hidden="true" />} onOpen={() => {
            setError(undefined);
            void projectSections.load().then(setSections, showError);
          }}>
            {sections.map(section => <ToolMenuItem key={section.id} onSelect={() => void locate({ id: section.id }).catch(showError)}>
              {section.name}{sectionId === section.id && <Check size={14} aria-hidden="true" />}
            </ToolMenuItem>)}
            {sectionId && <ToolMenuItem onSelect={() => void locate(null).catch(showError)}>Remove from section</ToolMenuItem>}
            <ToolMenuItem onSelect={() => openSettings('section')}><WorkspaceIcon name="projectOpen" />New section…</ToolMenuItem>
          </ToolSubmenu>
          {hostId === 'local' && <ToolMenuItem onSelect={() => openSettings('files')}><WorkspaceIcon name="projectOpen" />Open in File Manager</ToolMenuItem>}
          <div role="separator" />
          <ToolMenuItem onSelect={() => openSettings('archive')}><Archive size={15} aria-hidden="true" />Archive chats</ToolMenuItem>
          <div role="separator" />
          <ToolMenuItem onSelect={() => openSettings('remove')}><WorkspaceIcon name="close" />Remove project</ToolMenuItem>
        </ToolMenu>
        {start && <button type="button" title="New chat" aria-label={'Start new chat in ' + project.label}
          onClick={() => { dismiss(); start(); }}><WorkspaceIcon name="edit" size={15} /></button>}
      </div>
      {card && <ProjectCard id={detailsId} reference={panel} project={project} hostId={hostId}
        enter={clear} leave={leave} edit={() => openSettings('edit', toggleButton.current ?? undefined)} pin={() => void pin()}
        changeMarker={appearance => update({ operation: 'appearance', appearance })} pending={pending} error={error} />}
    </div>
    {error && !card && <p role="alert" className="yard-source-sidebar-error">{error}</p>}
    {editing && <Suspense fallback={null}>
      {editing === 'edit' || editing === 'remove' ?
        <ProjectSettings mode={editing} project={project} hostId={hostId} apply={update} close={closeSettings} /> :
        <ProjectMenuDialog mode={editing} project={project} hostId={hostId} createSection={name => locate({ name })}
          onArchived={onArchived} close={closeSettings} />}
    </Suspense>}
  </>;
}

function ProjectCard({ id, reference, project, hostId, enter, leave, edit, pin, changeMarker, pending, error }: {
  id: string; reference: React.RefObject<HTMLElement | null>; project: StartupProject; hostId: string;
  enter(): void; leave(): void; edit(): void; pin(): void; pending: boolean; error?: string;
  changeMarker: React.ComponentProps<typeof ProjectMarkerPicker>['change'];
}) {
  const [details, setDetails] = useState<SidebarProjectDetails>();
  const [fault, setFault] = useState(false);
  const [request, retry] = useState(0);
  const [copied, setCopied] = useState<string>();
  useEffect(() => {
    let live = true;
    void readSidebarProject(hostId, project.id).then(result => {
      if (live) { setDetails(result); setFault(false); }
    }, () => { if (live) setFault(true); });
    return () => { live = false; };
  }, [hostId, project.id, request]);
  const pinLabel = project.pinned ? 'Unpin project' : 'Pin project';
  const PinIcon = project.pinned ? PinOff : Pin;
  const count = details ? (details.partial ? 'At least ' : '') + details.count + (details.count === 1 ? ' chat' : ' chats') : '';
  return <section id={id} ref={reference} popover="manual" className="yard-source-project-card bg-surface-elevated-secondary"
    aria-label={project.label} onPointerEnter={enter} onPointerLeave={leave}>
    <header>
      <ProjectMarkerPicker name={project.label} appearance={project.appearance} change={changeMarker} disabled={pending} />
      <button type="button" className="yard-source-project-card-title" onClick={edit}>{project.label}</button>
      <button type="button" disabled={pending} title={pinLabel} aria-label={pinLabel} onClick={pin}>
        <PinIcon size={13} aria-hidden="true" />
      </button>
    </header>
    <div className="yard-source-project-stats">
      <MessageCircle size={14} aria-hidden="true" />
      {details ? <><span>{count}</span>{details.active > 0 && <><span aria-hidden="true" className="yard-source-project-mid">·</span><span>{details.active} active</span></>}</>
        : fault ? <button type="button" onClick={() => { setFault(false); retry(value => value + 1); }}>Retry loading chats</button>
          : <span role="status">Loading chats…</span>}
    </div>
    {!!details?.roots.length && <div className="yard-source-project-locations">
      {details.roots.map(path => <button key={path} type="button" title={path} aria-label={'Copy project folder: ' + path} onClick={() => {
        void navigator.clipboard.writeText(path).then(() => setCopied(path), () => setCopied('Copy failed'));
      }}><Folder size={14} aria-hidden="true" /><span dir="auto">{path}</span></button>)}
      {copied && <span className="sr-only" role="status">{copied === 'Copy failed' ? copied : 'Folder copied'}</span>}
    </div>}
    <footer><button type="button" onClick={edit}><WorkspaceIcon name="gear" />Edit project</button></footer>
    {error && <p role="alert" className="yard-source-sidebar-error">{error}</p>}
  </section>;
}
