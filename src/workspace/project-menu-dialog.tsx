import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { StartupProject } from '../native/startup-sidebar.ts';
import { activeTurnBeforeArchive, archiveProjectTargets, archiveThread, interruptTurn, readProjectFolders } from './host.ts';
import { WorkspaceFiles } from './workspace-files.tsx';
import { WorkspaceIcon } from './workspace-icon.tsx';

type ArchiveChat = { id: string; activeTurn?: string };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

async function readArchivePlan(hostId: string, projectId: string): Promise<ArchiveChat[]> {
  const ids = await archiveProjectTargets(hostId, projectId);
  const result: ArchiveChat[] = [];
  for (let i = 0; i < ids.length; i += 8) {
    result.push(...await Promise.all(ids.slice(i, i + 8).map(async id => ({ id, activeTurn: await activeTurnBeforeArchive(id, hostId) }))));
  }
  return result;
}

export default function ProjectMenuDialog({ mode, project, hostId, createSection, onArchived, close }: {
  mode: 'section' | 'files' | 'archive'; project: StartupProject; hostId: string;
  createSection(name: string): Promise<void>;
  onArchived(ids: string[], failures: number): void;
  close(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [name, setName] = useState('');
  const [root, setRoot] = useState<string>();
  const [plan, setPlan] = useState<ArchiveChat[]>();
  const [pending, setPending] = useState(false);
  const [fault, setFault] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    element?.querySelector<HTMLElement>(mode === 'section' ? '.yard-source-section-name' : '.yard-source-project-cancel')?.focus({ preventScroll: true });
    return () => element?.close();
  }, [mode]);
  useEffect(() => {
    let live = true;
    if (mode === 'files') void readProjectFolders(hostId, project.id).then(({ roots }) => {
      if (!roots[0]) throw new Error('This project has no source folder.');
      if (live) setRoot(roots[0]);
    }).catch(error => { if (live) setFault(message(error)); });
    if (mode === 'archive') void readArchivePlan(hostId, project.id).then(next => {
      if (live) setPlan(next);
    }, error => { if (live) setFault(message(error)); });
    return () => { live = false; };
  }, [attempt, mode, hostId, project.id]);
  async function submit() {
    if (pending) return;
    setPending(true);
    setFault(undefined);
    try {
      if (mode === 'section') { await createSection(name.trim() || 'New section'); close(); }
      if (mode !== 'archive' || !plan?.length) return;
      const latest = await readArchivePlan(hostId, project.id);
      if (latest.length !== plan.length || latest.some((item, i) => item.id !== plan[i]?.id || item.activeTurn !== plan[i]?.activeTurn)) {
        setPlan(latest);
        setFault('Project chats changed. Review the updated list before confirming.');
        return;
      }
      const archived: string[] = [];
      let failed = 0;
      for (const chat of latest) {
        try {
          if (await activeTurnBeforeArchive(chat.id, hostId) !== chat.activeTurn) { failed++; continue; }
          if (chat.activeTurn) await interruptTurn(chat.id, chat.activeTurn, hostId);
          await archiveThread(chat.id, hostId);
          archived.push(chat.id);
        } catch { failed++; }
      }
      onArchived(archived, failed);
      close();
    } catch (error) { setFault(message(error)); }
    finally { setPending(false); }
  }
  const count = plan?.length ?? 0;
  const active = !!plan?.some(chat => chat.activeTurn);
  const title = mode === 'section' ? 'New section' : mode === 'files' ? project.label : !plan ? 'Archive chats' :
    (active ? 'Stop and archive ' : 'Archive ') + count + (count === 1 ? ' chat?' : ' chats?');
  return createPortal(<dialog ref={dialog} aria-labelledby={titleId}
    className={'yard-source-project-edit yard-source-project-command bg-surface-elevated-secondary/90 backdrop-blur-xl' + (mode === 'files' ? ' yard-source-project-browser' : '')}
    onCancel={event => { event.preventDefault(); if (!pending) close(); }}>
    <h2 id={titleId} dir="auto">{title}</h2>
    <button type="button" className="yard-source-project-edit-close" title="Close dialog" aria-label="Close dialog" onClick={close} disabled={pending}>
      <WorkspaceIcon name="close" />
    </button>
    {mode === 'files' ? root ? <WorkspaceFiles root={root} hostId={hostId} /> : !fault && <p role="status">Loading folders…</p> :
      <form onSubmit={event => { event.preventDefault(); void submit(); }}>
        {mode === 'section' ? <>
          <p>Group chats and projects however you like</p>
          <input className="yard-source-section-name" aria-label="Section name" placeholder="Section name" disabled={pending}
            maxLength={120} value={name} onChange={event => setName(event.currentTarget.value)} />
        </> : active ? <p>Archiving will stop any ongoing work. You can restore the chats later from archived chats.</p> :
          plan ? count ? <p>This will archive the chats in {project.label}. You can find them later in your archived chats</p> :
            <p>There are no chats to archive.</p> : !fault && <p role="status">Checking project chats…</p>}
        {fault && <p role="alert">{fault}</p>}
        <footer><button type="button" className="yard-source-project-cancel" disabled={pending} onClick={close}>Cancel</button>
          {mode === 'archive' && !plan && fault ? <button type="button" onClick={() => { setFault(undefined); setAttempt(value => value + 1); }}>Retry</button> :
            <button type="submit" className={mode === 'section' ? 'yard-source-project-save' : 'yard-source-project-danger'} disabled={pending || mode === 'archive' && !count}>
              {mode === 'section' ? 'Create section' : pending ? 'Archiving…' : active ? 'Stop and archive' : 'Archive all'}
            </button>}
        </footer>
      </form>}
    {mode === 'files' && fault && <p role="alert">{fault}</p>}
  </dialog>, document.body);
}
