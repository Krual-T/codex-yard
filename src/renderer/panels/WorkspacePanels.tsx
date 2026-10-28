import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, PanelLeftClose, PanelLeftOpen, Plus, RotateCw, Save, X } from 'lucide-react';
import { BrowserFiles } from '../../native/browser-files.ts';
import { DirectoryTree } from '../files/DirectoryTree.tsx';
import { FileViewer } from '../files/FileViewer.tsx';
import { editorText, errorMessage, fileName, fileText, readWorkspaceFile, resolveFilePath, toBase64 } from '../files/file-service.ts';
import type { FileContents } from '../files/file-service.ts';
import type { ComposerDraft, WorkbenchClient } from '../workbench-contract.ts';
import './workspace-panels.css';

export type FilePanelRequest = { id: string; kind: 'file'; path: string; line?: number; column?: number };
export interface WorkspacePanelsProps {
  client: WorkbenchClient;
  hostId: string;
  threadId?: string;
  cwd: string;
  request: FilePanelRequest | null;
  onClose(): void;
  onReference?(draft: ComposerDraft): void;
  /** Lets the outer App guard navigation or unmounting when edits are retained. */
  onDirtyChange?(dirty: boolean): void;
}

interface FileTab {
  key: string;
  hostId: string;
  cwd: string;
  path: string;
  loadId: number;
  loading: boolean;
  saving: boolean;
  content?: FileContents;
  text: string;
  saved: string;
  error?: string;
  location?: { line: number; column?: number; id: number };
}

const isDirty = (tab: FileTab) => tab.content?.kind === 'text' && tab.text !== editorText(tab.saved);

export function WorkspacePanels({ client, hostId, cwd, request, onClose, onReference, onDirtyChange }: WorkspacePanelsProps) {
  const [tabs, setTabs] = useState<FileTab[]>([]);
  const tabsRef = useRef<FileTab[]>([]);
  const [selected, setSelected] = useState<string>();
  const [showFiles, setShowFiles] = useState(true);
  const sequence = useRef(0);
  const mounted = useRef(true);
  const dirty = tabs.some(tab => isDirty(tab) || tab.saving);

  const updateTabs = useCallback((update: (previous: FileTab[]) => FileTab[]) => {
    if (!mounted.current) return;
    const next = update(tabsRef.current);
    tabsRef.current = next;
    setTabs(next);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const load = useCallback((key: string, targetHost: string, path: string, loadId: number) => {
    void readWorkspaceFile(client, targetHost, path).then(content => {
      updateTabs(previous => previous.map(tab => tab.key !== key || tab.loadId !== loadId ? tab : {
        ...tab, loading: false, content, text: content.kind === 'text' ? editorText(content.text) : '',
        saved: content.kind === 'text' ? content.text : '', error: undefined,
      }));
    }).catch(error => {
      updateTabs(previous => previous.map(tab => tab.key !== key || tab.loadId !== loadId ? tab : {
        ...tab, loading: false, error: errorMessage(error),
      }));
    });
  }, [client, updateTabs]);

  const openFile = useCallback((path: string, line?: number, column?: number) => {
    const target = resolveFilePath(cwd, path);
    const key = JSON.stringify([hostId, cwd, target]);
    const existing = tabsRef.current.find(tab => tab.key === key);
    const location = line != null ? { line, column, id: ++sequence.current } : undefined;
    if (existing) {
      if (location) updateTabs(previous => previous.map(tab => tab.key === key ? { ...tab, location } : tab));
    } else {
      const loadId = ++sequence.current;
      updateTabs(previous => [...previous, { key, hostId, cwd, path: target, loadId, loading: true, saving: false, text: '', saved: '', location }]);
      load(key, hostId, target, loadId);
    }
    setSelected(key);
  }, [cwd, hostId, load, updateTabs]);

  useEffect(() => {
    setSelected(previous => {
      const current = tabsRef.current.find(tab => tab.key === previous && tab.hostId === hostId && tab.cwd === cwd);
      return current?.key ?? tabsRef.current.find(tab => tab.hostId === hostId && tab.cwd === cwd)?.key;
    });
  }, [hostId, cwd]);
  useEffect(() => {
    if (request?.kind === 'file') openFile(request.path, request.line, request.column);
  }, [openFile, request?.id, request?.kind, request?.path, request?.line, request?.column]);

  function closeTab(key: string) {
    const tab = tabsRef.current.find(item => item.key === key);
    if (!tab || tab.saving) return;
    if (isDirty(tab) && !window.confirm(`Discard unsaved changes to ${fileName(tab.path)}?`)) return;
    const remaining = tabsRef.current.filter(item => item.key !== key);
    updateTabs(() => remaining);
    if (selected === key) setSelected(remaining.find(item => item.hostId === hostId && item.cwd === cwd)?.key);
  }

  function reload(tab: FileTab) {
    if (tab.saving || isDirty(tab) && !window.confirm(`Discard unsaved changes to ${fileName(tab.path)}?`)) return;
    const loadId = ++sequence.current;
    updateTabs(previous => previous.map(item => item.key === tab.key ? { ...item, loadId, loading: true, error: undefined } : item));
    load(tab.key, tab.hostId, tab.path, loadId);
  }

  async function save(tab: FileTab) {
    const current = tabsRef.current.find(item => item.key === tab.key);
    if (!current || current.loading || current.saving || current.content?.kind !== 'text' || !isDirty(current)) return;
    const { text, saved, loadId } = current;
    updateTabs(previous => previous.map(item => item.key === tab.key ? { ...item, saving: true, error: undefined } : item));
    try {
      const disk = await readWorkspaceFile(client, current.hostId, current.path);
      if (disk.kind !== 'text' || disk.text !== saved) throw new Error('File changed on disk. Reload or copy your changes before saving.');
      const serialized = fileText(text, saved);
      await client.rpc('fs/writeFile', { path: current.path, dataBase64: toBase64(serialized) }, current.hostId);
      updateTabs(previous => previous.map(item => item.key !== tab.key || item.loadId !== loadId ? item : {
        ...item, saving: false, saved: serialized, content: { kind: 'text', text: serialized },
      }));
    } catch (error) {
      updateTabs(previous => previous.map(item => item.key !== tab.key || item.loadId !== loadId ? item : {
        ...item, saving: false, error: errorMessage(error),
      }));
    }
  }

  async function download(tab: FileTab) {
    try {
      await new BrowserFiles((endpoint, params) => client.host(endpoint, params)).downloadCopy({ hostId: tab.hostId, path: tab.path });
    } catch (error) {
      updateTabs(previous => previous.map(item => item.key === tab.key ? { ...item, error: errorMessage(error) } : item));
    }
  }

  function closePanel() {
    if (tabsRef.current.some(tab => tab.saving)) return;
    if (tabsRef.current.some(isDirty) && !window.confirm('Discard unsaved file changes?')) return;
    updateTabs(() => []);
    onDirtyChange?.(false);
    onClose();
  }

  const visible = tabs.filter(tab => tab.hostId === hostId && tab.cwd === cwd);
  const active = visible.find(tab => tab.key === selected);
  return <section className="yard-workspace-panels" aria-label="Workspace files">
    <div className="yard-panel-header">
      <button type="button" className="yard-panel-icon" title={showFiles ? 'Hide files' : 'Show files'} aria-label={showFiles ? 'Hide files' : 'Show files'} onClick={() => setShowFiles(value => !value)}>
        {showFiles ? <PanelLeftClose /> : <PanelLeftOpen />}
      </button>
      <div className="yard-panel-tabs" role="tablist" aria-label="Open files">
        {visible.map(tab => <div className={`yard-panel-tab${tab.key === selected ? ' is-active' : ''}`} key={tab.key}>
          <button type="button" role="tab" aria-selected={tab.key === selected} title={tab.path} onClick={() => setSelected(tab.key)}>
            <span>{fileName(tab.path)}</span>{isDirty(tab) ? <span aria-label="Unsaved changes" className="yard-panel-dirty" /> : null}
          </button>
          <button type="button" className="yard-panel-tab-close" title={`Close ${fileName(tab.path)}`} aria-label={`Close ${fileName(tab.path)}`}
            disabled={tab.saving} onClick={() => closeTab(tab.key)}><X /></button>
        </div>)}
      </div>
      <button type="button" className="yard-panel-icon" title="Close panel" aria-label="Close panel" disabled={tabs.some(tab => tab.saving)} onClick={closePanel}><X /></button>
    </div>
    <div className="yard-panel-body">
      {showFiles ? <DirectoryTree client={client} hostId={hostId} cwd={cwd} onOpen={openFile} /> : null}
      <div className="yard-file-main">
        {active ? <>
          <div className="yard-file-toolbar">
            <span className="yard-file-path" title={active.path}>{active.path}</span>
            {active.content?.kind === 'text' ? <button type="button" className="yard-panel-icon" title="Save file" aria-label="Save file"
              disabled={!isDirty(active) || active.saving || active.loading} onClick={() => void save(active)}><Save /></button> : null}
            <button type="button" className="yard-panel-icon" title="Reload file" aria-label="Reload file" disabled={active.saving || active.loading} onClick={() => reload(active)}><RotateCw /></button>
            <button type="button" className="yard-panel-icon" title="Download file" aria-label="Download file" onClick={() => void download(active)}><Download /></button>
            {onReference ? <button type="button" className="yard-panel-icon" title="Add file to conversation" aria-label="Add file to conversation"
              onClick={() => onReference({ text: '', images: [], files: [{ path: active.path, name: fileName(active.path) }] })}><Plus /></button> : null}
          </div>
          {active.error ? <div className="yard-file-error" role="alert">{active.error}</div> : null}
          {active.loading ? <div className="yard-file-status" role="status">Loading...</div> : active.content ?
            <FileViewer path={active.path} content={active.content} text={active.text} location={active.location}
              onChange={text => updateTabs(previous => previous.map(tab => tab.key === active.key ? { ...tab, text } : tab))}
              onSave={() => void save(active)} /> : <div className="yard-file-status"><button type="button" onClick={() => reload(active)}>Retry</button></div>}
        </> : <div className="yard-file-status">Select a file</div>}
      </div>
    </div>
  </section>;
}
