import { useEffect, useRef, useState } from 'react';
import { FolderOpen, FolderPlus } from 'lucide-react';
import type { WorkbenchClient } from '../../workbench-contract.ts';
import { loadWorkspaceOptions } from './workspace-options.ts';
import type { WorkspaceOption } from './workspace-options.ts';
import './select-workspace.css';

export interface SelectWorkspacePageProps {
  client: WorkbenchClient;
  hostId: string;
  suggestedRoots?: WorkspaceOption[];
  onPickFolder?: (hostId: string) => Promise<WorkspaceOption | null>;
  onCommitSelection?: (value: { hostId: string; roots: string[] }) => Promise<boolean>;
  onCreateProject?: (hostId: string) => Promise<boolean>;
  onComplete: (hostId: string) => void | Promise<void>;
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
const rootName = (root: string) => root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || root;

export function SelectWorkspacePage(props: SelectWorkspacePageProps) {
  return <WorkspaceScope key={props.hostId} {...props} />;
}

function WorkspaceScope({ client, hostId, suggestedRoots = [], onPickFolder, onCommitSelection, onCreateProject, onComplete }: SelectWorkspacePageProps) {
  const [roots, setRoots] = useState<WorkspaceOption[]>([]);
  const [picked, setPicked] = useState<WorkspaceOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState<'pick' | 'continue' | 'create' | null>(null);
  const [completionPending, setCompletionPending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const alive = useRef(false);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const addMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let current = true;
    setLoading(true); setLoadError(null);
    void loadWorkspaceOptions(client, hostId).then(value => { if (current) setRoots(value); })
      .catch(error => { if (current) setLoadError(errorMessage(error)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [client, hostId, revision]);
  const options = [...new Map([...roots, ...suggestedRoots, ...picked].filter(option => option.root).map(option => [option.root, option])).values()]
    .sort((a, b) => a.root.localeCompare(b.root));
  const selectedRoots = options.filter(option => selected.has(option.root)).map(option => option.root);
  const allSelected = options.length > 0 && selectedRoots.length === options.length;
  useEffect(() => { if (selectAllRef.current) selectAllRef.current.indeterminate = selectedRoots.length > 0 && !allSelected; }, [selectedRoots.length, allSelected]);
  const toggle = (root: string, checked: boolean) => {
    setSelected(previous => { const next = new Set(previous); if (checked) next.add(root); else next.delete(root); return next; });
    setActionError(null);
  };
  const perform = async (kind: 'pick' | 'continue' | 'create', operation: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setPending(kind); setActionError(null);
    try { await operation(); }
    catch (error) { if (alive.current) setActionError(errorMessage(error)); }
    finally { inFlight.current = false; if (alive.current) setPending(null); }
  };
  const pickFolder = () => onPickFolder && void perform('pick', async () => {
    const option = await onPickFolder(hostId);
    if (!alive.current || option === null) return;
    if (!option.root || typeof option.root !== 'string' || option.label != null && typeof option.label !== 'string') throw new Error('Invalid selected folder');
    setPicked(previous => [...previous.filter(item => item.root !== option.root), option]);
    setSelected(previous => new Set([...previous, option.root]));
  });
  const commit = () => void perform('continue', async () => {
    if (!completionPending) {
      if (!onCommitSelection) return;
      const saved = await onCommitSelection({ hostId, roots: selectedRoots });
      if (!alive.current) return;
      if (!saved) throw new Error('Could not add the selected folders');
      setCompletionPending(true);
    }
    await onComplete(hostId);
  });
  const create = () => onCreateProject && void perform('create', async () => {
    const saved = await onCreateProject(hostId);
    if (!alive.current) return;
    if (!saved) throw new Error('Could not create a new project');
    setCompletionPending(true);
    await onComplete(hostId);
  });
  const disabled = loading || pending !== null;
  const editingDisabled = disabled || completionPending;
  const closeMenu = () => { if (addMenu.current) { addMenu.current.open = false; addMenu.current.querySelector('summary')?.focus(); } };

  return <main className="yard-select-workspace"><div className="yard-workspace-content">
    <FolderOpen size={35} aria-hidden="true" />
    <h1>Select a project</h1>
    <p>ChatGPT will be able to edit files and run commands in selected folders.</p>
    {loading && <p role="status" className="yard-workspace-muted">Loading projects...</p>}
    {loadError && <div role="alert" className="yard-workspace-error">Could not load projects: {loadError} <button type="button" disabled={disabled} onClick={() => setRevision(value => value + 1)}>Retry</button></div>}
    {!loading && !loadError && options.length === 0 && <p className="yard-workspace-muted">Add a project to continue.</p>}
    {options.length > 0 && <fieldset disabled={editingDisabled || !!loadError} className="yard-workspace-list"><legend className="yard-workspace-sr">Available projects</legend>
      <label className="yard-workspace-all"><input ref={selectAllRef} type="checkbox" checked={allSelected}
        onChange={event => { setSelected(event.target.checked ? new Set(options.map(option => option.root)) : new Set()); setActionError(null); }} /> Select all</label>
      {options.map(option => <label key={option.root} className="yard-workspace-row"><input type="checkbox" checked={selected.has(option.root)} onChange={event => toggle(option.root, event.target.checked)} />
        <span><strong>{option.label?.trim() || rootName(option.root)}</strong><span>{option.root}</span></span></label>)}
    </fieldset>}
    {actionError && <p role="alert" className="yard-workspace-error">{actionError}</p>}
    <div className="yard-workspace-actions">{hostId === 'local' ? <details className="yard-workspace-add" ref={addMenu} onKeyDown={event => { if (event.key === 'Escape' && addMenu.current?.open) { event.preventDefault(); closeMenu(); } }}>
      <summary aria-disabled={editingDisabled || !onPickFolder && !onCreateProject} onClick={event => { if (editingDisabled || !onPickFolder && !onCreateProject) event.preventDefault(); }}><FolderPlus size={16} /> Add project</summary>
      <div><button type="button" disabled={editingDisabled || !onCreateProject} onClick={() => { closeMenu(); create(); }}>Start from scratch</button>
        <button type="button" disabled={editingDisabled || !onPickFolder} onClick={() => { closeMenu(); pickFolder(); }}>Use an existing folder</button></div>
    </details> : <button type="button" disabled={editingDisabled || !onPickFolder} onClick={pickFolder} title={!onPickFolder ? 'Folder selection is unavailable on this host' : undefined}><FolderPlus size={16} /> Add project</button>}
      <button type="button" className="yard-workspace-primary" disabled={disabled || !completionPending && (!!loadError || selectedRoots.length === 0 || !onCommitSelection)} onClick={commit}>{pending === 'continue' ? 'Adding...' : 'Continue'}</button></div>
    {hostId === 'local' && <button type="button" className="yard-workspace-skip" disabled={editingDisabled || !onCreateProject} onClick={create}>{pending === 'create' ? 'Creating a new project...' : 'Skip'}</button>}
  </div></main>;
}
