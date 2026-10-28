import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { CSSProperties } from 'react';
import { Download, PanelLeftClose, PanelLeftOpen, Plus, RotateCw, Save, X } from 'lucide-react';
import { BrowserFiles } from '../../native/browser-files.ts';
import { DirectoryTree } from '../files/DirectoryTree.tsx';
import { FileViewer } from '../files/FileViewer.tsx';
import { TerminalPanel } from '../terminal/TerminalPanel.tsx';
import type { TerminalPanelHandle } from '../terminal/TerminalPanel.tsx';
import { DiffViewer } from '../diff/DiffViewer.tsx';
import { errorMessage, fileName, readWorkspaceFile, resolveFilePath } from '../files/file-service.ts';
import type { FileContents } from '../files/file-service.ts';
import type { ComposerDraft, WorkbenchClient } from '../workbench-contract.ts';
import { claimFileRecovery, discardFileRecovery, discardFileRecoveries, readFileRecovery, reconcileFileRecovery,
  sameFileRecovery, updateFileRecovery } from './file-save-recovery.ts';
import type { FileSaveRecovery, RecoveryPhase } from './file-save-recovery.ts';
import { panelError as localizeError, usePanelText } from './panel-i18n.ts';
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
  /** Parent navigation should freeze edits and await this barrier after a dirty confirmation. */
  onRecoveryBarrier?(barrier: (() => Promise<void>) | null): void;
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
  recovery?: FileSaveRecovery;
  revision: number;
  storageError?: boolean;
  location?: { line: number; column?: number; id: number };
}
interface TerminalTab { key: string; scopeId: string; hostId: string; cwd: string; threadId?: string }
interface DiffTab { key: string; scopeId: string; hostId: string; cwd: string; path?: string; diff?: string }

const unresolved = (recovery?: FileSaveRecovery) => recovery?.phase === 'pending' || recovery?.phase === 'unknown';
const isDirty = (tab: FileTab) => tab.content?.kind === 'text' && (tab.draft !== tab.saved || unresolved(tab.recovery) || !!tab.storageError);

export function WorkspacePanels({ client, scopeId, hostId, threadId, cwd, appearance, request, onRequestConsumed, onClose, onReference, onDirtyChange, onRecoveryBarrier }: WorkspacePanelsProps) {
  const t = usePanelText();
  const [tabs, setTabs] = useState<FileTab[]>([]);
  const [terminals, setTerminals] = useState<TerminalTab[]>([]);
  const terminalHandles = useRef(new Map<string, TerminalPanelHandle>());
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const [panelError, setPanelError] = useState<string>();
  const [diffs, setDiffs] = useState<DiffTab[]>([]);
  const tabsRef = useRef<FileTab[]>([]);
  const recoveryQueues = useRef(new Map<string, Promise<void>>());
  const recoveryFailures = useRef(new Map<string, unknown>());
  const confirmedRecoveries = useRef(new Map<string, FileSaveRecovery | undefined>());
  const [selected, setSelected] = useState<string>();
  const selectedRef = useRef<string | undefined>(undefined);
  const [findRequest, setFindRequest] = useState<{ key: string; id: number }>();
  const [showFiles, setShowFiles] = useState(true);
  const tabList = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  const consumedRequests = useRef(new Set<string>());
  const selections = useRef(new Map<string, string>());
  const mounted = useRef(true);
  const dirty = tabs.some(tab => tab.loading || tab.storageError || isDirty(tab) || tab.saving);
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
  const queueRecovery = useCallback(<T,>(key: string, task: () => Promise<T>): Promise<T> => {
    const result = (recoveryQueues.current.get(key) ?? Promise.resolve()).then(task);
    const settled = result.then(() => {}, error => { recoveryFailures.current.set(key, error); });
    recoveryQueues.current.set(key, settled);
    void settled.then(() => { if (recoveryQueues.current.get(key) === settled) recoveryQueues.current.delete(key); });
    return result;
  }, []);
  const storeRecovery = useCallback((key: string, id: string, update: (current: FileSaveRecovery) => FileSaveRecovery) =>
    queueRecovery(key, async () => {
      const stored = await updateFileRecovery(key, id, update);
      confirmedRecoveries.current.set(key, stored);
      return stored;
    }), [queueRecovery]);
  function freeze() {
    if (closingRef.current) return false;
    closingRef.current = true;
    flushSync(() => setClosing(true));
    return true;
  }
  function unfreeze() { closingRef.current = false; setClosing(false); }

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    onRecoveryBarrier?.(async () => {
      while (recoveryQueues.current.size) await Promise.all(recoveryQueues.current.values());
      const error = recoveryFailures.current.values().next().value;
      if (error) throw error;
    });
    return () => onRecoveryBarrier?.(null);
  }, [onRecoveryBarrier]);
  useEffect(() => { tabList.current?.querySelector('[role="tab"][aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [selected]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const load = useCallback((key: string, targetHost: string, path: string, loadId: number) => {
    void (async () => {
      let content: FileContents | undefined, readError: string | undefined;
      try { content = await readWorkspaceFile(client, targetHost, path); }
      catch (error) { readError = errorMessage(error); }
      let recovery: FileSaveRecovery | undefined, storageError: string | undefined;
      try { recovery = await queueRecovery(key, async () => {
        const stored = await readFileRecovery(key);
        if (content && stored && !unresolved(stored) && stored.phase !== 'conflict' && stored.draft === stored.saved) {
          await discardFileRecovery(key, stored);
          return undefined;
        }
        return stored;
      }); }
      catch (error) { storageError = errorMessage(error); }
      if (!storageError && tabsRef.current.some(tab => tab.key === key && tab.loadId === loadId)) confirmedRecoveries.current.set(key, recovery);
      const disk = content;
      if (recovery && content?.kind !== 'text') content = { kind: 'text', text: recovery.saved };
      updateTabs(previous => previous.map(tab => tab.key !== key || tab.loadId !== loadId ? tab : {
        ...tab, loading: false, content,
        draft: recovery?.draft ?? (content?.kind === 'text' ? content.text : ''),
        saved: recovery?.saved ?? (content?.kind === 'text' ? content.text : ''),
        revision: recovery?.revision ?? 0, recovery, storageError: !!storageError,
        error: storageError ? `File recovery is unavailable: ${storageError}` : unresolved(recovery)
          ? 'Save result is unknown. Check the original operation before saving again.'
          : recovery?.phase === 'conflict' ? 'File changed on disk. Keep or copy your changes before reloading.'
          : readError ? `Could not read the file: ${readError}`
            : recovery && (disk?.kind !== 'text' || recovery.saved !== disk.text) && recovery.draft !== recovery.saved
              ? 'File changed on disk. Keep or copy your changes before reloading.' : undefined,
      }));
    })();
  }, [client, queueRecovery, updateTabs]);

  const openFile = useCallback((path: string, line?: number, column?: number) => {
    const target = resolveFilePath(cwd, path);
    const key = JSON.stringify([scopeId, hostId, cwd, target]);
    const existing = tabsRef.current.find(tab => tab.key === key);
    const location = line != null ? { line, column, id: ++sequence.current } : undefined;
    if (existing) {
      if (location) updateTabs(previous => previous.map(tab => tab.key === key ? { ...tab, location } : tab));
    } else {
      const loadId = ++sequence.current;
      updateTabs(previous => [...previous, { key, scopeId, hostId, cwd, path: target, loadId, loading: true, saving: false, draft: '', saved: '', revision: 0, location }]);
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

  async function closeTab(key: string) {
    const tab = tabsRef.current.find(item => item.key === key);
    if (!tab || tab.saving || closingRef.current) return;
    const localOnly = !!tab.storageError || recoveryFailures.current.has(key);
    if ((isDirty(tab) || localOnly) && !window.confirm(t(localOnly
      ? 'Close {name} on this page? Local edits may be lost; stored recovery records will not be changed.' : unresolved(tab.recovery)
      ? 'Close {name}? The unknown save and retained edits will remain available.'
      : 'Discard unsaved changes to {name}?', {name: fileName(tab.path)}))) return;
    if (!freeze()) return;
    try {
      await recoveryQueues.current.get(key);
      const current = tabsRef.current.find(item => item.key === key);
      if (!current || current.loadId !== tab.loadId || current.revision !== tab.revision) throw new Error('File changed while closing; review the latest edit.');
      if (!localOnly && recoveryFailures.current.has(key)) throw recoveryFailures.current.get(key);
      if (!localOnly && current.recovery && !unresolved(current.recovery)) {
        const confirmed = confirmedRecoveries.current.get(key);
        if (!sameFileRecovery(confirmed, current.recovery)) throw new Error('File recovery changed while closing.');
        await discardFileRecovery(key, confirmed!);
      }
      recoveryFailures.current.delete(key);
      confirmedRecoveries.current.delete(key);
      const remaining = tabsRef.current.filter(item => item.key !== key);
      updateTabs(() => remaining);
      if (selectedRef.current === key) select([...remaining, ...terminals, ...diffs].find(item => item.scopeId === scopeId && item.hostId === hostId && item.cwd === cwd)?.key);
    } catch (error) {
      updateTabs(previous => previous.map(item => item.key === key ? { ...item, storageError: true, error: errorMessage(error) } : item));
    } finally {
      unfreeze();
    }
  }

  async function closeTerminal(key: string) {
    if (!freeze()) return;
    try {
      const closed = await terminalHandles.current.get(key)?.close() ?? true;
      if (!closed) return;
      const remaining = terminals.filter(tab => tab.key !== key);
      setTerminals(previous => previous.filter(tab => tab.key !== key));
      if (currentScope.current === scopeKey && selectedRef.current === key) {
        select([...tabsRef.current, ...remaining, ...diffs].find(tab => tab.scopeId === scopeId && tab.hostId === hostId && tab.cwd === cwd)?.key);
      }
    } finally { unfreeze(); }
  }

  function closeDiff(key: string) {
    const remaining = diffs.filter(tab => tab.key !== key);
    setDiffs(remaining);
    if (selected === key) select([...tabsRef.current, ...terminals, ...remaining].find(tab => tab.scopeId === scopeId && tab.hostId === hostId && tab.cwd === cwd)?.key);
  }

  function reload(tab: FileTab) {
    if (closingRef.current || tab.saving || unresolved(tab.recovery) || tab.storageError || isDirty(tab) && !window.confirm(t('Discard unsaved changes to {name}?', {name: fileName(tab.path)}))) return;
    const loadId = ++sequence.current;
    updateTabs(previous => previous.map(item => item.key === tab.key ? { ...item, loadId, loading: true, error: undefined } : item));
    void queueRecovery(tab.key, async () => { if (tab.recovery) await discardFileRecovery(tab.key, tab.recovery); })
      .then(() => load(tab.key, tab.hostId, tab.path, loadId)).catch(error => {
        updateTabs(previous => previous.map(item => item.key === tab.key && item.loadId === loadId ? { ...item, loading: false, storageError: true, error: errorMessage(error) } : item));
      });
  }

  async function save(tab: FileTab) {
    const current = tabsRef.current.find(item => item.key === tab.key);
    if (closingRef.current || !current || current.loading || current.saving || unresolved(current.recovery) || current.recovery?.phase === 'conflict' || current.storageError || current.content?.kind !== 'text' || !isDirty(current)) return;
    const { saved: expectedContents, draft: contents, loadId } = current;
    const id = crypto.randomUUID();
    const recovery: FileSaveRecovery = { ...current.recovery, id, checkId: id, submitted: true, phase: 'pending', contents,
      saved: expectedContents, draft: contents, revision: current.revision };
    updateTabs(previous => previous.map(item => item.key === tab.key ? { ...item, saving: true, recovery, error: undefined } : item));
    try { await queueRecovery(tab.key, async () => { await claimFileRecovery(tab.key, current.recovery, recovery); confirmedRecoveries.current.set(tab.key, recovery); }); }
    catch (error) {
      updateTabs(previous => previous.map(item => item.key !== tab.key || item.loadId !== loadId || item.recovery?.id !== id ? item : {
        ...item, saving: false, recovery: current.recovery, storageError: true, error: `Could not retain file recovery: ${errorMessage(error)}`,
      }));
      return;
    }
    try {
      const result = await client.host<{ outcome: 'saved' | 'conflict' | 'blocked'; operationId?: string }>('workspace-file-save', {
        hostId: current.hostId, cwd: current.cwd, path: current.path, expectedContents, contents, operationId: id,
      });
      if (!result || !['saved', 'conflict', 'blocked'].includes(result.outcome)
        || result.outcome === 'blocked' && typeof result.operationId !== 'string') throw new Error('Invalid save response');
      const phase: RecoveryPhase = result.outcome === 'blocked' ? 'unknown' : result.outcome;
      const stored = await storeRecovery(tab.key, id, value => ({ ...value, phase,
        ...(result.outcome === 'saved' ? { saved: contents } : {}),
        ...(result.outcome === 'blocked' ? { checkId: result.operationId!, submitted: false } : {}) }));
      updateTabs(previous => previous.map(item => item.key !== tab.key || item.loadId !== loadId || item.recovery?.id !== id ? item : {
        ...item, saving: false, recovery: { ...stored, draft: item.draft, revision: item.revision },
        saved: result.outcome === 'saved' ? contents : item.saved,
        content: result.outcome === 'saved' ? { kind: 'text', text: contents } : item.content,
        error: result.outcome === 'blocked' ? 'Another save for this file has an unknown result. Check its original operation before saving.'
          : result.outcome === 'conflict' ? 'File changed on disk. Keep or copy your changes before reloading.' : undefined,
      }));
    } catch (error) {
      const knownFailure = typeof error === 'object' && error !== null && 'uncertain' in error && error.uncertain === false;
      try {
        const stored = await storeRecovery(tab.key, id, value => ({ ...value, phase: knownFailure ? 'failed' : 'unknown' }));
        updateTabs(previous => previous.map(item => item.key !== tab.key || item.loadId !== loadId || item.recovery?.id !== id ? item : {
          ...item, saving: false, recovery: { ...stored, draft: item.draft, revision: item.revision },
          error: knownFailure ? errorMessage(error) : `Save result is unknown: ${errorMessage(error)}. Check the original operation before saving again.`,
        }));
      } catch (storageError) {
        updateTabs(previous => previous.map(item => item.key !== tab.key || item.loadId !== loadId || item.recovery?.id !== id ? item : {
          ...item, saving: false, storageError: true, error: `Save result is unknown and recovery could not be updated: ${errorMessage(storageError)}`,
        }));
      }
    }
  }

  async function checkSave(tab: FileTab) {
    const current = tabsRef.current.find(item => item.key === tab.key);
    if (closingRef.current || !current?.recovery || !unresolved(current.recovery) || current.saving || current.storageError) return;
    const { recovery, loadId } = current;
    let updatingRecovery = false;
    updateTabs(previous => previous.map(item => item.key === tab.key ? { ...item, saving: true } : item));
    try {
      const status = await client.host<{ outcome: 'pending' | 'unknown' | 'missing' | 'saved' | 'conflict' | 'failed' }>('workspace-file-save-status', {
        hostId: current.hostId, cwd: current.cwd, path: current.path, operationId: recovery.checkId,
      });
      if (!status || !['saved', 'conflict', 'failed'].includes(status.outcome)) {
        updateTabs(previous => previous.map(item => item.key !== tab.key || item.loadId !== loadId || item.recovery?.id !== recovery.id ? item : {
          ...item, saving: false, error: 'Save result is still unknown. The original write may complete later.',
        }));
        return;
      }
      const result = await readWorkspaceFile(client, current.hostId, current.path);
      if (result.kind !== 'text') throw new Error('File is no longer text');
      const saved = recovery.submitted && status.outcome === 'saved' && result.text === recovery.contents;
      const unchanged = result.text === recovery.saved;
      const phase: RecoveryPhase = saved ? 'saved' : unchanged && status.outcome === 'failed' ? 'failed' : 'conflict';
      updatingRecovery = true;
      const stored = await storeRecovery(tab.key, recovery.id, value => ({ ...value, phase,
        saved: saved ? recovery.contents : value.saved }));
      updateTabs(previous => previous.map(item => item.key !== tab.key || item.loadId !== loadId || item.recovery?.id !== recovery.id ? item : {
        ...item, saving: false, recovery: { ...stored, draft: item.draft, revision: item.revision },
        saved: saved ? recovery.contents : item.saved,
        content: saved ? { kind: 'text', text: recovery.contents } : item.content,
        error: phase === 'conflict' ? 'File changed on disk. Keep or copy your changes before reloading.' : undefined,
      }));
    } catch (error) {
      updateTabs(previous => previous.map(item => item.key !== tab.key || item.loadId !== loadId || item.recovery?.id !== recovery.id ? item : {
        ...item, saving: false, storageError: updatingRecovery || item.storageError,
        error: `Could not check the save result: ${errorMessage(error)}`,
      }));
    }
  }

  function changeFile(key: string, text: string) {
    const tab = tabsRef.current.find(item => item.key === key);
    if (closingRef.current || !tab || tab.loading || tab.draft === text) return;
    const revision = tab.revision + 1;
    updateTabs(previous => previous.map(item => item.key === key ? { ...item, draft: text, revision,
      recovery: item.recovery ? { ...item.recovery, draft: text, revision } : undefined } : item));
    if (tab.recovery) void storeRecovery(key, tab.recovery.id, value => {
      if (value.revision !== tab.revision) throw new Error('File recovery changed in another page. Keep or copy this edit before reopening.');
      return { ...value, draft: text, revision };
    }).catch(error => updateTabs(previous => previous.map(item => item.key !== key || item.loadId !== tab.loadId ? item : {
      ...item, storageError: true, error: `Could not retain file edits: ${errorMessage(error)}`,
    })));
  }

  async function retryRecovery(key: string) {
    const tab = tabsRef.current.find(item => item.key === key);
    if (!tab || !tab.storageError || !freeze()) return;
    try {
      await recoveryQueues.current.get(key);
      const disk = await readWorkspaceFile(client, tab.hostId, tab.path).catch(() => undefined);
      const current = tabsRef.current.find(item => item.key === key);
      if (!current || current.loadId !== tab.loadId || current.revision !== tab.revision) throw new Error('File changed while checking recovery.');
      const stored = await readFileRecovery(key);
      const confirmed = confirmedRecoveries.current.get(key);
      if (!sameFileRecovery(stored, confirmed) || stored && current.recovery?.id !== stored.id
        || current.recovery && !stored || stored && current.revision < stored.revision) {
        throw new Error('Another page owns a different recovery. Keep or copy these edits; closing this tab will leave that record untouched.');
      }
      const reconciled = stored ? await reconcileFileRecovery(key, stored, current.draft, current.revision) : undefined;
      confirmedRecoveries.current.set(key, reconciled);
      recoveryFailures.current.delete(key);
      updateTabs(previous => previous.map(item => item.key !== key || item.loadId !== tab.loadId ? item : {
        ...item, recovery: reconciled, storageError: false,
        error: unresolved(reconciled) ? 'Save result is unknown. Check the original operation before saving again.'
          : reconciled?.phase === 'conflict' ? 'File changed on disk. Keep or copy your changes before reloading.'
          : disk?.kind !== 'text' ? 'Could not reread this file. Keep or copy your edits.'
            : disk.text !== item.saved ? 'File changed on disk. Reload or copy your changes before saving.' : undefined,
      }));
    } catch (error) {
      updateTabs(previous => previous.map(item => item.key !== key || item.loadId !== tab.loadId ? item : {
        ...item, storageError: true, error: errorMessage(error),
      }));
    } finally { unfreeze(); }
  }

  async function download(tab: FileTab) {
    try {
      await new BrowserFiles((endpoint, params) => client.host(endpoint, params)).downloadCopy({ hostId: tab.hostId, path: tab.path });
    } catch (error) {
      updateTabs(previous => previous.map(item => item.key === tab.key && item.loadId === tab.loadId ? { ...item, error: errorMessage(error) } : item));
    }
  }

  async function closePanel(onlyThisPage = false) {
    if (closingRef.current || tabsRef.current.some(tab => tab.saving)) return;
    const localOnly = onlyThisPage || tabsRef.current.some(tab => tab.storageError || recoveryFailures.current.has(tab.key));
    if ((tabsRef.current.some(isDirty) || localOnly) && !window.confirm(t(localOnly
      ? 'Close this panel on this page? Local edits may be lost; stored recovery records will not be changed.' : tabsRef.current.some(tab => unresolved(tab.recovery))
      ? 'Close the panel? Other unsaved edits will be discarded. Unknown saves and their retained edits will remain available.' : 'Discard unsaved file changes?'))) return;
    const original = tabsRef.current.map(({ key, loadId, revision }) => ({ key, loadId, revision }));
    setPanelError(undefined);
    if (!freeze()) return;
    try {
      while (recoveryQueues.current.size) await Promise.all(recoveryQueues.current.values());
      const unchanged = () => original.length === tabsRef.current.length && original.every(expected =>
        tabsRef.current.some(tab => tab.key === expected.key && tab.loadId === expected.loadId && tab.revision === expected.revision));
      if (!unchanged()) throw new Error('Files changed while closing; review the latest edits.');
      if (!localOnly && recoveryFailures.current.size) throw recoveryFailures.current.values().next().value;
      const results = await Promise.all([...terminalHandles.current.values()].map(handle => handle.close()));
      if (results.some(closed => !closed)) { setPanelError('A terminal could not be closed. File recovery records were retained.'); return; }
      while (recoveryQueues.current.size) await Promise.all(recoveryQueues.current.values());
      if (!unchanged()) throw new Error('Files changed while closing; review the latest edits.');
      if (!localOnly) {
        const records = tabsRef.current.filter(tab => tab.recovery && !unresolved(tab.recovery)).map(tab => {
          const expected = confirmedRecoveries.current.get(tab.key);
          if (!sameFileRecovery(expected, tab.recovery)) throw new Error('File recovery changed while closing.');
          return { key: tab.key, expected: expected! };
        });
        await discardFileRecoveries(records);
      }
      recoveryFailures.current.clear();
      confirmedRecoveries.current.clear();
      updateTabs(() => []);
      setTerminals([]);
      setDiffs([]);
      selections.current.clear();
      onDirtyChange?.(false);
      onClose();
    } catch (error) {
      setPanelError(errorMessage(error));
      updateTabs(previous => previous.map(item => recoveryFailures.current.has(item.key) ? { ...item, storageError: true, error: errorMessage(error) } : item));
    } finally { unfreeze(); }
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
  return <section className="yard-workspace-panels" data-theme={appearance.theme} style={style} aria-label={t('Workspace files')} onKeyDownCapture={event => {
    if (active?.content?.kind === 'text' && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault(); event.stopPropagation();
      setFindRequest({ key: active.key, id: ++sequence.current });
    }
  }}>
    <div className="yard-panel-header">
      <button type="button" className="yard-panel-icon" title={t(showFiles ? 'Hide files' : 'Show files')} aria-label={t(showFiles ? 'Hide files' : 'Show files')} disabled={closing} onClick={() => setShowFiles(value => !value)}>
        {showFiles ? <PanelLeftClose /> : <PanelLeftOpen />}
      </button>
      <div ref={tabList} className="yard-panel-tabs" role="tablist" aria-label={t('Open workspace tabs')} inert={closing}>
        {visible.map(tab => <div className={`yard-panel-tab${tab.key === selected ? ' is-active' : ''}`} key={tab.key}>
          <button type="button" role="tab" aria-selected={tab.key === selected} title={tab.path} onClick={() => select(tab.key)}>
            <span>{fileName(tab.path)}</span>{isDirty(tab) ? <span aria-label={t('Unsaved changes')} className="yard-panel-dirty" /> : null}
          </button>
          <button type="button" className="yard-panel-tab-close" title={t('Close {name}', {name: fileName(tab.path)})} aria-label={t('Close {name}', {name: fileName(tab.path)})}
            disabled={tab.saving} onClick={() => void closeTab(tab.key)}><X /></button>
        </div>)}
        {visibleTerminals.map(tab => <div className={`yard-panel-tab${tab.key === selected ? ' is-active' : ''}`} key={tab.key}>
          <button type="button" role="tab" aria-selected={tab.key === selected} onClick={() => select(tab.key)}><span>{t('Terminal')}</span></button>
          <button type="button" className="yard-panel-tab-close" title={t('Close terminal')} aria-label={t('Close terminal')} disabled={closing} onClick={() => void closeTerminal(tab.key)}><X /></button>
        </div>)}
        {visibleDiffs.map(tab => <div className={`yard-panel-tab${tab.key === selected ? ' is-active' : ''}`} key={tab.key}>
          <button type="button" role="tab" aria-selected={tab.key === selected} title={tab.path ?? t('Changes')} onClick={() => select(tab.key)}>
            <span>{tab.path ? t('{name} changes', {name: fileName(tab.path)}) : t('Changes')}</span>
          </button>
          <button type="button" className="yard-panel-tab-close" title={t('Close diff')} aria-label={t('Close diff')} onClick={() => closeDiff(tab.key)}><X /></button>
        </div>)}
      </div>
      <button type="button" className="yard-panel-icon" title={t('Close panel')} aria-label={t('Close panel')} disabled={closing || tabs.some(tab => tab.saving)} onClick={() => void closePanel()}><X /></button>
    </div>
    {panelError ? <div className="yard-file-error" role="alert">{localizeError(t, panelError)}{' '}
      <button type="button" disabled={closing} onClick={() => void closePanel(true)}>{t('Close panel here only')}</button>
    </div> : null}
    <div className="yard-panel-body" inert={closing}>
      {showFiles ? <DirectoryTree key={scopeKey} client={client} hostId={hostId} cwd={cwd} onOpen={openFile} /> : null}
      <div className="yard-file-main">
        {terminals.map(tab => <div className="yard-terminal-container" key={tab.key} hidden={tab.key !== activeTerminal?.key}>
          <TerminalPanel client={client} hostId={tab.hostId} cwd={tab.cwd} threadId={tab.threadId} visible={tab.key === activeTerminal?.key}
            theme={appearance.theme} fontSize={fontSize} lineHeight={lineHeight} fontFamily={appearance.codeFontFamily}
            ref={handle => { if (handle) terminalHandles.current.set(tab.key, handle); else terminalHandles.current.delete(tab.key); }} />
        </div>)}
        {diffs.map(tab => <div className="yard-diff-container" key={tab.key} hidden={tab.key !== activeDiff?.key}>
          <DiffViewer diff={tab.diff} path={tab.path ? resolveFilePath(tab.cwd, tab.path) : undefined}
            onOpenFile={tab.key === activeDiff?.key ? openFile : undefined} onReference={tab.key === activeDiff?.key ? onReference : undefined} />
        </div>)}
        {active ? <>
          <div className="yard-file-toolbar">
            <span className="yard-file-path" title={active.path}>{active.path}</span>
            {active.content?.kind === 'text' ? <button type="button" className="yard-panel-icon" title={t('Save file')} aria-label={t('Save file')}
              disabled={!isDirty(active) || active.saving || active.loading || unresolved(active.recovery) || active.recovery?.phase === 'conflict' || active.storageError} onClick={() => void save(active)}><Save /></button> : null}
            <button type="button" className="yard-panel-icon" title={t('Reload file')} aria-label={t('Reload file')} disabled={active.saving || active.loading || unresolved(active.recovery) || active.storageError} onClick={() => reload(active)}><RotateCw /></button>
            <button type="button" className="yard-panel-icon" title={t('Download file')} aria-label={t('Download file')} onClick={() => void download(active)}><Download /></button>
            {onReference ? <button type="button" className="yard-panel-icon" title={t('Add file to conversation')} aria-label={t('Add file to conversation')}
              onClick={() => onReference({ text: '', images: [], files: [{ path: active.path, name: fileName(active.path) }] })}><Plus /></button> : null}
          </div>
          {active.error ? <div className="yard-file-error" role="alert">{localizeError(t, active.error)}</div> : null}
          {active.storageError ? <div className="yard-file-check"><button type="button" onClick={() => void retryRecovery(active.key)}>{t('Review recovery')}</button></div> : null}
          {unresolved(active.recovery) ? <div className="yard-file-check"><button type="button" disabled={active.saving || active.storageError} onClick={() => void checkSave(active)}>{t('Check save result')}</button></div> : null}
          {active.loading ? <div className="yard-file-status" role="status">{t('Loading...')}</div> : active.content?.kind === 'binary' ?
            <FileViewer key={`${active.key}:${active.loadId}`} client={client} hostId={active.hostId} cwd={active.cwd} threadId={threadId} path={active.path} content={active.content} text="" theme={appearance.theme} visible readOnly
              onChange={() => {}} onSave={() => {}} /> : !active.content ? <div className="yard-file-status"><button type="button" onClick={() => reload(active)}>{t('Retry')}</button></div> : null}
        </> : !activeTerminal && !activeDiff ? <div className="yard-file-status">{t('Select a file')}</div> : null}
        {tabs.filter(tab => tab.content?.kind === 'text' && !tab.loading).map(tab => <div className="yard-editor-container" key={`${tab.key}:${tab.loadId}`} hidden={tab.key !== active?.key}>
          <FileViewer client={client} hostId={tab.hostId} cwd={tab.cwd} threadId={tab.scopeId === scopeId ? threadId : undefined}
            onOpenFile={tab.key === active?.key ? openFile : undefined} path={tab.path} content={tab.content!} text={tab.draft} location={tab.location} theme={appearance.theme} visible={tab.key === active?.key}
            findRequest={findRequest?.key === tab.key ? findRequest.id : undefined}
            onFindRequestConsumed={id => setFindRequest(previous => previous?.id === id ? undefined : previous)}
            readOnly={closing}
            onChange={text => changeFile(tab.key, text)}
            onSave={() => void save(tab)} />
        </div>)}
      </div>
    </div>
  </section>;
}
