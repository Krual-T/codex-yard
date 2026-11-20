import { ArrowUp, ChevronRight, Folder, FolderPlus } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { StartupProject } from '../native/startup-sidebar.ts';
import { browseProjectFolders, readProjectFolders, type ProjectAction } from './host.ts';
import { WorkspaceIcon } from './workspace-icon.tsx';
import { ProjectMarkerPicker } from './project-marker-picker.tsx';

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export default function ProjectSettings({ mode, project, hostId, apply, close }: {
  mode: 'edit' | 'remove'; project: StartupProject; hostId: string;
  apply(action: ProjectAction): Promise<void>; close(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const [screen, setScreen] = useState(mode);
  const [name, setName] = useState(project.label);
  const [roots, setRoots] = useState<string[]>();
  const [changedRoots, markRootsChanged] = useState(false);
  const [reading, setReading] = useState(0);
  const [readError, setReadError] = useState<string>();
  const [picking, setPicking] = useState(false);
  const [pending, setPending] = useState(false);
  const [fault, setFault] = useState<string>();
  const title = useId();
  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useLayoutEffect(() => {
    (screen === 'edit' && !picking ? nameInput.current : cancelButton.current)?.focus();
  }, [screen, picking]);
  useEffect(() => {
    if (mode === 'remove') return;
    let live = true;
    void readProjectFolders(hostId, project.id).then(result => {
      if (live) setRoots(result.roots);
    }, error => { if (live) setReadError(errorText(error)); });
    return () => { live = false; };
  }, [hostId, mode, project.id, reading]);
  function selectRoots(next: string[]) {
    setRoots(next);
    markRootsChanged(true);
  }
  async function perform(action: ProjectAction) {
    if (pending) return;
    setPending(true);
    setFault(undefined);
    try { await apply(action); close(); }
    catch (error) { setFault(errorText(error)); setPending(false); }
  }
  const cancelRemove = () => mode === 'edit' ? setScreen('edit') : close();
  return createPortal(<dialog ref={dialog} aria-labelledby={title} className="yard-source-project-edit bg-surface-elevated-secondary/90 backdrop-blur-xl"
    onCancel={event => {
      event.preventDefault();
      if (pending) return;
      if (picking) setPicking(false);
      else if (screen === 'remove') cancelRemove();
      else close();
    }}>
    {screen === 'remove' ? <>
      <h2 id={title}>Remove {hostId === 'local' ? 'local ' : ''}project?</h2>
      <p>Remove {project.label} from the sidebar? Its folders and chats will be kept.</p>
      {fault && <p role="alert">{fault}</p>}
      <footer><button ref={cancelButton} type="button" disabled={pending} onClick={cancelRemove}>Cancel</button>
        <button type="button" className="yard-source-project-danger" disabled={pending} onClick={() => void perform({ operation: 'remove' })}>Remove project</button></footer>
    </> : picking ? <>
      <h2 id={title}>Add folder</h2>
      <FolderPicker hostId={hostId} root={roots?.[0]} selected={roots ?? []} cancel={() => setPicking(false)} choose={path => {
        selectRoots([...roots ?? [], path]);
        setPicking(false);
      }} />
    </> : <form onSubmit={event => {
      event.preventDefault();
      if (!name.trim() || changedRoots && !roots?.length) return;
      if (name.trim() === project.label && !changedRoots) close();
      else void perform({ operation: 'edit', name: name.trim(), roots: changedRoots ? roots : undefined });
    }}>
      <h2 id={title}>Edit project</h2>
      <button type="button" className="yard-source-project-edit-close" title="Close" aria-label="Close" disabled={pending}
        onClick={close}><WorkspaceIcon name="close" /></button>
      <div className="yard-source-project-name-input">
        <ProjectMarkerPicker name={project.label} appearance={project.appearance} disabled={pending} closedFolder change={appearance =>
          apply({ operation: 'appearance', appearance })} />
        <input ref={nameInput} aria-label="Project name" required value={name} maxLength={240} disabled={pending}
          onChange={event => setName(event.currentTarget.value)} />
      </div>
      <h3>Source folders</h3>
      <div className="yard-source-project-folders">
        {roots?.map(path => <div key={path} title={path}>
          <Folder size={16} aria-hidden="true" /><span dir="auto">{path.split('/').filter(Boolean).at(-1) || path}</span>
          <button type="button" title="Remove folder" aria-label={'Remove folder: ' + path} disabled={pending}
            onClick={() => selectRoots(roots.filter(root => root !== path))}><WorkspaceIcon name="close" size={14} /></button>
        </div>)}
        {roots ? <button type="button" disabled={pending || roots.length >= 16} onClick={() => setPicking(true)}>
          <FolderPlus size={16} aria-hidden="true" />Add folder
        </button> : readError ? <button type="button" title={readError} onClick={() => { setReadError(undefined); setReading(attempt => attempt + 1); }}>Retry loading folders</button>
          : <p role="status">Loading folders…</p>}
      </div>
      {fault && <p role="alert">{fault}</p>}
      <footer><button type="button" className="yard-source-project-danger" disabled={pending}
        onClick={() => setScreen('remove')}>Remove {hostId === 'local' ? 'local ' : ''}project</button>
        <button type="button" disabled={pending} onClick={close}>Cancel</button>
        <button type="submit" className="yard-source-project-save" disabled={pending || !name.trim() || changedRoots && !roots?.length}>Save</button></footer>
    </form>}
  </dialog>, document.body);
}

function FolderPicker({ hostId, root, selected, cancel, choose }: {
  hostId: string; root?: string; selected: string[]; cancel(): void; choose(path: string): void;
}) {
  const [target, setTarget] = useState(root);
  const [listed, setListed] = useState<Awaited<ReturnType<typeof browseProjectFolders>>>();
  const [fault, setFault] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    void browseProjectFolders(hostId, target).then(next => {
      if (live) setListed(next);
    }, error => { if (live) setFault(errorText(error)); });
    return () => { live = false; };
  }, [hostId, target, attempt]);
  function browse(path: string) {
    setTarget(path);
    setFault(undefined);
    setListed(undefined);
  }
  return <>
    <div className="yard-source-folder-path">
      <button type="button" title="Parent folder" aria-label="Parent folder" disabled={!listed?.parentPath}
        onClick={() => listed?.parentPath && browse(listed.parentPath)}><ArrowUp size={16} aria-hidden="true" /></button>
      <span dir="auto">{listed?.directoryPath ?? target ?? ''}</span>
    </div>
    <div className="yard-source-project-folders yard-source-folder-options">
      {listed ? listed.entries.length ? listed.entries.map(entry => <button type="button" key={entry.path} onClick={() => browse(entry.path)}>
        <Folder size={16} aria-hidden="true" /><span dir="auto">{entry.name}</span><ChevronRight size={14} aria-hidden="true" />
      </button>) : <p>No subfolders</p> : fault ? <>
        <p role="alert">{fault}</p><button type="button" onClick={() => { setFault(undefined); setAttempt(value => value + 1); }}>Retry</button>
      </> : <p role="status">Loading folders…</p>}
    </div>
    <footer><button type="button" onClick={cancel}>Cancel</button>
      <button type="button" className="yard-source-project-save" disabled={!listed || selected.includes(listed.directoryPath)}
        onClick={() => listed && choose(listed.directoryPath)}>Add folder</button></footer>
  </>;
}
