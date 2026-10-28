import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Download, PanelLeftClose, PanelLeftOpen, Plus, RotateCw, Save, X } from 'lucide-react';
import { BrowserFiles } from '../../native/browser-files.ts';
import { DirectoryTree } from '../files/DirectoryTree.tsx';
import { FileViewer } from '../files/FileViewer.tsx';
import { TerminalPanel } from '../terminal/TerminalPanel.tsx';
import type { TerminalPanelHandle } from '../terminal/TerminalPanel.tsx';
import { DiffViewer } from '../diff/DiffViewer.tsx';
import { editFileText, editorText, errorMessage, fileName, readWorkspaceFile, resolveFilePath } from '../files/file-service.ts';
import type { FileContents } from '../files/file-service.ts';
import type { ComposerDraft, WorkbenchClient } from '../workbench-contract.ts';
import './workspace-panels.css';

interface RequestScope { id: string; scopeId: string; hostId: string; cwd: string }
export type FilePanelRequest = RequestScope & { kind: 'file'; path: string; line?: number; column?: number };
export type TerminalPanelRequest = RequestScope & { kind: 'terminal' };
export type DiffPanelRequest = RequestScope & { kind: 'diff'; path?: string; diff?: string };
export type WorkspacePanelRequest = FilePanelRequest | TerminalPanelRequest | DiffPanelRequest;
export interface WorkspacePanelAppearance {
  theme: 'light' | 'dark';
  codeFontSize: number;
  /** Resolved line height in CSS pixels. */
  codeLineHeight: number;
  /** Defaults to the App's inherited --yard-code-font. */
  codeFontFamily?: string;
}
export interface WorkspacePanelsProps {
  client: WorkbenchClient;
  /** Stable identity of a thread or a new conversation draft. */
  scopeId: string;
  hostId: string;
  threadId?: string;
  cwd: string;
  appearance: WorkspacePanelAppearance;
  request: WorkspacePanelRequest | null;
  onRequestConsumed(id: string): void;
  onClose(): void;
  onReference?(draft: ComposerDraft): void;
  /** Includes drafts and pending or uncertain saves in every retained scope. */
  onDirtyChange?(dirty: boolean): void;
}

interface FileTab {
  key: string;
  scopeId: string;
  hostId: string;
  cwd: string;
  path: string;
  loadId: number;
  loading: boolean;
  saving: boolean;
  content?: FileContents;
  draft: string;
  saved: string;
  error?: string;
  uncertain?: { expectedContents: string; contents: string };
  location?: { line: number; column?: number; id: number };
}
interface TerminalTab { key: string; scopeId: string; hostId: string; cwd: string; threadId?: string }
interface DiffTab { key: string; scopeId: string; hostId: string; cwd: string; path?: string; diff?: string }

const isDirty = (tab: FileTab) => tab.content?.kind === 'text' && (tab.draft !== tab.saved || !!tab.uncertain);

export function WorkspacePanels({ client, scopeId, hostId, threadId, cwd, appearance, request, onRequestConsumed, onClose, onReference, onDirtyChange }: WorkspacePanelsProps) {
  const [tabs, setTabs] = useState<FileTab[]>([]);
  const [terminals, setTerminals] = useState<TerminalTab[]>([]);
  const terminalHandles = useRef(new Map<string, TerminalPanelHandle>());
  const [closing, setClosing] = useState(false);
  const [diffs, setDiffs] = useState<DiffTab[]>([]);
  const tabsRef = useRef<FileTab[]>([]);
  const [selected, setSelected] = useState<string>();
  const selectedRef = useRef<string | undefined>(undefined);
  const [findRequest, setFindRequest] = useState<{ key: string; id: number }>();
  const [showFiles, setShowFiles] = useState(true);
  const tabList = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  const consumedRequests = useRef(new Set<string>());
  const selections = useRef(new Map<string, string>());
  const mounted = useRef(true);
  const dirty = tabs.some(tab => isDirty(tab) || tab.saving);
  const scopeKey = JSON.stringify([scopeId, hostId, cwd]);
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const select = useCallback((key: string | undefined) => {
    if (key) selections.current.set(scopeKey, key);
    else selections.current.delete(scopeKey);
    selectedRef.current = key;
    setSelected(key);
  }, [scopeKey]);

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
  useEffect(() => { tabList.current?.querySelector('[role="tab"][aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [selected]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const load = useCallback((key: string, targetHost: string, path: string, loadId: number) => {
    void readWorkspaceFile(client, targetHost, path).then(content => {
      updateTabs(previous => previous.map(tab => tab.key !== key || tab.loadId !== loadId ? tab : {
        ...tab, loading: false, content, draft: content.kind === 'text' ? content.text : '',
        saved: content.kind === 'text' ? content.text : '', error: undefined, uncertain: undefined,
      }));
    }).catch(error => {
      updateTabs(previous => previous.map(tab => tab.key !== key || tab.loadId !== loadId ? tab : {
        ...tab, loading: false, error: errorMessage(error),
      }));
    });
  }, [client, updateTabs]);

  const openFile = useCallback((path: string, line?: number, column?: number) => {
    const target = resolveFilePath(cwd, path);
    const key = JSON.stringify([scopeId, hostId, cwd, target]);
    const existing = tabsRef.current.find(tab => tab.key === key);
    const location = line != null ? { line, column, id: ++sequence.current } : undefined;
    if (existing) {
      if (location) updateTabs(previous => previous.map(tab => tab.key === key ? { ...tab, location } : tab));
    } else {
      const loadId = ++sequence.current;
      updateTabs(previous => [...previous, { key, scopeId, hostId, cwd, path: target, loadId, loading: true, saving: false, draft: '', saved: '', location }]);
      load(key, hostId, target, loadId);
    }
    select(key);
  }, [scopeId, cwd, hostId, load, select, updateTabs]);

  useEffect(() => {
    const matches = [...tabsRef.current, ...terminals, ...diffs].filter(tab => tab.scopeId === scopeId && tab.hostId === hostId && tab.cwd === cwd);
    const restored = matches.find(tab => tab.key === selections.current.get(scopeKey))?.key ?? matches[0]?.key;
    selectedRef.current = restored;
    setSelected(restored);
    // Restore selection only when the active scope changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);
  useEffect(() => {
    if (closing || !request || consumedRequests.current.has(request.id)) return;
    consumedRequests.current.add(request.id);
    onRequestConsumed(request.id);
    if (request.scopeId !== scopeId || request.hostId !== hostId || request.cwd !== cwd) return;
    if (request.kind === 'file') openFile(request.path, request.line, request.column);
    else if (request.kind === 'terminal') {
      const key = JSON.stringify(['terminal', scopeId, hostId, cwd, request.id]);
      setTerminals(previous => previous.some(tab => tab.key === key) ? previous : [...previous, { key, scopeId, hostId, cwd, threadId }]);
      select(key);
    } else if (request.kind === 'diff') {
      const key = JSON.stringify(['diff', scopeId, hostId, cwd, request.id]);
      setDiffs(previous => previous.some(tab => tab.key === key) ? previous : [...previous, { key, scopeId, hostId, cwd, path: request.path, diff: request.diff }]);
      select(key);
    }
  }, [closing, openFile, request, scopeId, hostId, cwd, threadId, onRequestConsumed, select]);

  function closeTab(key: string) {
    const tab = tabsRef.current.find(item => item.key === key);
    if (!tab || tab.saving) return;
    if (isDirty(tab) && !window.confirm(`Discard unsaved changes to ${fileName(tab.path)}?`)) return;
    const remaining = tabsRef.current.filter(item => item.key !== key);
    updateTabs(() => remaining);
    if (selected === key) select([...remaining, ...terminals, ...diffs].find(item => item.scopeId === scopeId && item.hostId === hostId && item.cwd === cwd)?.key);
  }

  async function closeTerminal(key: string) {
    if (closing) return;
    setClosing(true);
    const closed = await terminalHandles.current.get(key)?.close() ?? true;
    setClosing(false);
    if (!closed) return;
    const remaining = terminals.filter(tab => tab.key !== key);
    setTerminals(previous => previous.filter(tab => tab.key !== key));
    if (currentScope.current === scopeKey && selectedRef.current === key) {
      select([...tabsRef.current, ...remaining, ...diffs].find(tab => tab.scopeId === scopeId && tab.hostId === hostId && tab.cwd === cwd)?.key);
    }
  }

  function closeDiff(key: string) {
    const remaining = diffs.filter(tab => tab.key !== key);
    setDiffs(remaining);
    if (selected === key) select([...tabsRef.current, ...terminals, ...remaining].find(tab => tab.scopeId === scopeId && tab.hostId === hostId && tab.cwd === cwd)?.key);
  }

  function reload(tab: FileTab) {
    if (tab.saving || isDirty(tab) && !window.confirm(`Discard unsaved changes to ${fileName(tab.path)}?`)) return;
    const loadId = ++sequence.current;
    updateTabs(previous => previous.map(item => item.key === tab.key ? { ...item, loadId, loading: true, error: undefined } : item));
    load(tab.key, tab.hostId, tab.path, loadId);
  }

  async function save(tab: FileTab) {
    const current = tabsRef.current.find(item => item.key === tab.key);
    if (!current || current.loading || current.saving || current.uncertain || current.content?.kind !== 'text' || !isDirty(current)) return;
    const { saved: expectedContents, draft: contents, loadId } = current;
    updateTabs(previous => previous.map(item => item.key === tab.key ? { ...item, saving: true, error: undefined } : item));
    try {
      const result = await client.host<{ outcome: 'saved' | 'conflict' }>('workspace-file-save', {
        hostId: current.hostId, cwd: current.cwd, path: current.path, expectedContents, contents,
      });
      if (result?.outcome === 'conflict') {
        updateTabs(previous => previous.map(item => item.key !== tab.key || item.loadId !== loadId ? item : {
          ...item, saving: false, error: 'File changed on disk. Reload or copy your changes before saving.',
        }));
        return;
      }
      if (result?.outcome !== 'saved') throw new Error('Invalid save response');
      updateTabs(previous => previous.map(item => item.key !== tab.key || item.loadId !== loadId ? item : {
        ...item, saving: false, saved: contents, content: { kind: 'text', text: contents },
      }));
    } catch (error) {
      const knownFailure = typeof error === 'object' && error !== null && 'uncertain' in error && error.uncertain === false;
      updateTabs(previous => previous.map(item => item.key !== tab.key || item.loadId !== loadId ? item : {
        ...item, saving: false,
        uncertain: knownFailure ? undefined : { expectedContents, contents },
        error: knownFailure ? errorMessage(error) : `Save result is unknown: ${errorMessage(error)}. Check the file before saving again.`,
      }));
    }
  }

  async function checkSave(tab: FileTab) {
    const current = tabsRef.current.find(item => item.key === tab.key);
    if (!current?.uncertain || current.saving) return;
    const { uncertain, loadId } = current;
    updateTabs(previous => previous.map(item => item.key === tab.key ? { ...item, saving: true } : item));
    try {
      const result = await readWorkspaceFile(client, current.hostId, current.path);
      if (result.kind !== 'text') throw new Error('File is no longer text');
      const saved = result.text === uncertain.contents;
      const unchanged = result.text === uncertain.expectedContents;
      updateTabs(previous => previous.map(item => item.key !== tab.key || item.loadId !== loadId ? item : {
        ...item, saving: false, uncertain: undefined,
        saved: saved ? uncertain.contents : item.saved,
        content: saved ? { kind: 'text', text: uncertain.contents } : item.content,
        error: saved || unchanged ? undefined : 'File changed on disk. Reload or copy your changes before saving.',
      }));
    } catch (error) {
      updateTabs(previous => previous.map(item => item.key !== tab.key || item.loadId !== loadId ? item : {
        ...item, saving: false, error: `Could not check the save result: ${errorMessage(error)}`,
      }));
    }
  }

  async function download(tab: FileTab) {
    try {
      await new BrowserFiles((endpoint, params) => client.host(endpoint, params)).downloadCopy({ hostId: tab.hostId, path: tab.path });
    } catch (error) {
      updateTabs(previous => previous.map(item => item.key === tab.key && item.loadId === tab.loadId ? { ...item, error: errorMessage(error) } : item));
    }
  }

  async function closePanel() {
    if (closing) return;
    if (tabsRef.current.some(tab => tab.saving)) return;
    if (tabsRef.current.some(isDirty) && !window.confirm('Discard unsaved file changes?')) return;
    setClosing(true);
    const results = await Promise.all([...terminalHandles.current.values()].map(handle => handle.close()));
    setClosing(false);
    if (results.some(closed => !closed)) return;
    updateTabs(() => []);
    setTerminals([]);
    setDiffs([]);
    selections.current.clear();
    onDirtyChange?.(false);
    onClose();
  }

  const visible = tabs.filter(tab => tab.scopeId === scopeId && tab.hostId === hostId && tab.cwd === cwd);
  const active = visible.find(tab => tab.key === selected);
  const visibleTerminals = terminals.filter(tab => tab.scopeId === scopeId && tab.hostId === hostId && tab.cwd === cwd);
  const activeTerminal = visibleTerminals.find(tab => tab.key === selected);
  const visibleDiffs = diffs.filter(tab => tab.scopeId === scopeId && tab.hostId === hostId && tab.cwd === cwd);
  const activeDiff = visibleDiffs.find(tab => tab.key === selected);
  const fontSize = Number.isFinite(appearance.codeFontSize) && appearance.codeFontSize > 0 ? appearance.codeFontSize : 12;
  const lineHeight = Number.isFinite(appearance.codeLineHeight) && appearance.codeLineHeight > 0 ? appearance.codeLineHeight : 18;
  const style = { '--yard-panel-code-size': `${fontSize}px`, '--yard-panel-code-line-height': `${lineHeight}px`,
    ...(appearance.codeFontFamily ? { '--yard-panel-code-font': appearance.codeFontFamily } : {}) } as CSSProperties;
  return <section className="yard-workspace-panels" data-theme={appearance.theme} style={style} aria-label="Workspace files" onKeyDownCapture={event => {
    if (active?.content?.kind === 'text' && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault(); event.stopPropagation();
      setFindRequest({ key: active.key, id: ++sequence.current });
    }
  }}>
    <div className="yard-panel-header">
      <button type="button" className="yard-panel-icon" title={showFiles ? 'Hide files' : 'Show files'} aria-label={showFiles ? 'Hide files' : 'Show files'} disabled={closing} onClick={() => setShowFiles(value => !value)}>
        {showFiles ? <PanelLeftClose /> : <PanelLeftOpen />}
      </button>
      <div ref={tabList} className="yard-panel-tabs" role="tablist" aria-label="Open workspace tabs" inert={closing}>
        {visible.map(tab => <div className={`yard-panel-tab${tab.key === selected ? ' is-active' : ''}`} key={tab.key}>
          <button type="button" role="tab" aria-selected={tab.key === selected} title={tab.path} onClick={() => select(tab.key)}>
            <span>{fileName(tab.path)}</span>{isDirty(tab) ? <span aria-label="Unsaved changes" className="yard-panel-dirty" /> : null}
          </button>
          <button type="button" className="yard-panel-tab-close" title={`Close ${fileName(tab.path)}`} aria-label={`Close ${fileName(tab.path)}`}
            disabled={tab.saving} onClick={() => closeTab(tab.key)}><X /></button>
        </div>)}
        {visibleTerminals.map(tab => <div className={`yard-panel-tab${tab.key === selected ? ' is-active' : ''}`} key={tab.key}>
          <button type="button" role="tab" aria-selected={tab.key === selected} onClick={() => select(tab.key)}><span>Terminal</span></button>
          <button type="button" className="yard-panel-tab-close" title="Close terminal" aria-label="Close terminal" disabled={closing} onClick={() => void closeTerminal(tab.key)}><X /></button>
        </div>)}
        {visibleDiffs.map(tab => <div className={`yard-panel-tab${tab.key === selected ? ' is-active' : ''}`} key={tab.key}>
          <button type="button" role="tab" aria-selected={tab.key === selected} title={tab.path ?? 'Changes'} onClick={() => select(tab.key)}>
            <span>{tab.path ? `${fileName(tab.path)} changes` : 'Changes'}</span>
          </button>
          <button type="button" className="yard-panel-tab-close" title="Close diff" aria-label="Close diff" onClick={() => closeDiff(tab.key)}><X /></button>
        </div>)}
      </div>
      <button type="button" className="yard-panel-icon" title="Close panel" aria-label="Close panel" disabled={closing || tabs.some(tab => tab.saving)} onClick={() => void closePanel()}><X /></button>
    </div>
    <div className="yard-panel-body" inert={closing}>
      {showFiles ? <DirectoryTree key={scopeKey} client={client} hostId={hostId} cwd={cwd} onOpen={openFile} /> : null}
      <div className="yard-file-main">
        {terminals.map(tab => <div className="yard-terminal-container" key={tab.key} hidden={tab.key !== activeTerminal?.key}>
          <TerminalPanel client={client} hostId={tab.hostId} cwd={tab.cwd} threadId={tab.threadId} visible={tab.key === activeTerminal?.key}
            theme={appearance.theme} fontSize={fontSize} lineHeight={lineHeight} fontFamily={appearance.codeFontFamily}
            ref={handle => { if (handle) terminalHandles.current.set(tab.key, handle); else terminalHandles.current.delete(tab.key); }} />
        </div>)}
        {activeDiff ? <DiffViewer diff={activeDiff.diff} path={activeDiff.path ? resolveFilePath(activeDiff.cwd, activeDiff.path) : undefined} onOpenFile={openFile} onReference={onReference} /> : null}
        {active ? <>
          <div className="yard-file-toolbar">
            <span className="yard-file-path" title={active.path}>{active.path}</span>
            {active.content?.kind === 'text' ? <button type="button" className="yard-panel-icon" title="Save file" aria-label="Save file"
              disabled={!isDirty(active) || active.saving || active.loading || !!active.uncertain} onClick={() => void save(active)}><Save /></button> : null}
            <button type="button" className="yard-panel-icon" title="Reload file" aria-label="Reload file" disabled={active.saving || active.loading} onClick={() => reload(active)}><RotateCw /></button>
            <button type="button" className="yard-panel-icon" title="Download file" aria-label="Download file" onClick={() => void download(active)}><Download /></button>
            {onReference ? <button type="button" className="yard-panel-icon" title="Add file to conversation" aria-label="Add file to conversation"
              onClick={() => onReference({ text: '', images: [], files: [{ path: active.path, name: fileName(active.path) }] })}><Plus /></button> : null}
          </div>
          {active.error ? <div className="yard-file-error" role="alert">{active.error}</div> : null}
          {active.uncertain ? <div className="yard-file-check"><button type="button" disabled={active.saving} onClick={() => void checkSave(active)}>Check save result</button></div> : null}
          {active.loading ? <div className="yard-file-status" role="status">Loading...</div> : active.content ?
            <FileViewer key={`${active.key}:${active.loadId}`} path={active.path} content={active.content} text={editorText(active.draft)} location={active.location} lineHeight={lineHeight}
              findRequest={findRequest?.key === active.key ? findRequest.id : undefined}
              onFindRequestConsumed={id => setFindRequest(previous => previous?.id === id ? undefined : previous)}
              readOnly={false}
              onChange={(text, edit) => updateTabs(previous => previous.map(tab => tab.key === active.key ? { ...tab, draft: editFileText(tab.draft, text, edit) } : tab))}
              onSave={() => void save(active)} /> : <div className="yard-file-status"><button type="button" onClick={() => reload(active)}>Retry</button></div>}
        </> : !activeTerminal && !activeDiff ? <div className="yard-file-status">Select a file</div> : null}
      </div>
    </div>
  </section>;
}
