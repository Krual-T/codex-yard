import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { CSSProperties } from 'react';
import { Download, PanelLeftClose, PanelLeftOpen, PanelRightClose, Plus, RotateCw, Save, X } from 'lucide-react';
import { BrowserFiles } from '../../native/browser-files.ts';
import { DirectoryTree } from '../files/DirectoryTree.tsx';
import { FileViewer } from '../files/FileViewer.tsx';
import { TerminalPanel } from '../terminal/TerminalPanel.tsx';
import type { TerminalPanelHandle } from '../terminal/TerminalPanel.tsx';
import { DiffViewer } from '../diff/DiffViewer.tsx';
import { errorMessage, fileName, readWorkspaceFile, resolveFilePath } from '../files/file-service.ts';
import type { FileContents } from '../files/file-service.ts';
import type { ComposerDraft, WorkbenchClient } from '../workbench-contract.ts';
import { claimFileRecovery, discardFileRecovery, discardFileRecoveries, FileRecoveryChangedError, readFileRecovery, reconcileFileRecovery,
  sameFileRecovery, updateFileRecovery } from './file-save-recovery.ts';
import type { FileSaveRecovery, RecoveryPhase } from './file-save-recovery.ts';
import { panelError as localizeError, usePanelText } from './panel-i18n.ts';
import './workspace-panels.css';

interface RequestScope { id: string; scopeId: string; hostId: string; cwd: string }
export type FilePanelRequest = RequestScope & { kind: 'file'; path: string; line?: number; column?: number };
/** `reuse` selects an existing terminal for a global reveal shortcut; ordinary requests create a new tab. */
export type TerminalPanelRequest = RequestScope & { kind: 'terminal'; reuse?: boolean };
export type DiffPanelRequest = RequestScope & { kind: 'diff'; path?: string; diff?: string };
export type WorkspacePanelRequest = FilePanelRequest | TerminalPanelRequest | DiffPanelRequest;
export interface WorkspacePanelAppearance {
  theme: 'light' | 'dark';
  codeFontSize: number;
  /** Resolved line height in CSS pixels. */
  codeLineHeight: number;
  /** Defaults to the App's inherited --yard-code-font. */
  codeFontFamily?: string;
  codeThemeId?: string;
  diffMarkerStyle?: 'color' | 'symbols';
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
  /** Hide the outer panel while keeping this component mounted; explicit close has already cleaned its tabs. */
  onClose(): void;
  /** Selected tab in the current scope, or null when none is selected. */
  onActiveKindChange?(kind: 'file' | 'diff' | 'terminal' | null): void;
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
  storageConflict?: boolean;
  location?: { line: number; column?: number; id: number };
}
interface TerminalTab { key: string; scopeId: string; hostId: string; cwd: string; threadId?: string }
interface DiffTab { key: string; scopeId: string; hostId: string; cwd: string; path?: string; diff?: string }

const unresolved = (recovery?: FileSaveRecovery) => recovery?.phase === 'pending' || recovery?.phase === 'unknown';
const retainRecovery = (recovery?: FileSaveRecovery) => unresolved(recovery) || recovery?.phase === 'conflict';
const isDirty = (tab: FileTab) => tab.content?.kind === 'text' && (tab.draft !== tab.saved || retainRecovery(tab.recovery) || !!tab.storageError);
const recoveryConflict = 'Another page owns a different recovery. Keep or copy these edits; closing this tab will leave that record untouched.';

function mergeStoredRecovery(tab: FileTab, stored: FileSaveRecovery): FileTab {
  const different = stored.draft !== tab.draft || stored.revision !== tab.revision;
  return { ...tab, recovery: { ...stored, draft: tab.draft, revision: tab.revision },
    ...(different ? { storageError: true, storageConflict: true, error: recoveryConflict } : {}) };
}

export function WorkspacePanels({ client, scopeId, hostId, threadId, cwd, appearance, request, onRequestConsumed, onClose, onReference, onDirtyChange, onRecoveryBarrier, onActiveKindChange }: WorkspacePanelsProps) {
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
  const [terminalActivation, setTerminalActivation] = useState<{ key: string; scope: string }>();
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
  const activeKindCallback = useRef(onActiveKindChange);
  activeKindCallback.current = onActiveKindChange;
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
      const stored = await updateFileRecovery(key, id, update, confirmedRecoveries.current.get(key));
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
      const unretained = tabsRef.current.find(tab => tab.storageError);
      if (unretained) throw new Error(unretained.error ?? recoveryConflict);
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
      const candidates = request.reuse ? terminals.filter(tab => tab.scopeId === scopeId && tab.hostId === hostId && tab.cwd === cwd) : [];
      const selectedTerminal = candidates.find(tab => tab.key === selectedRef.current);
      const isActive = (tab: TerminalTab) => terminalHandles.current.get(tab.key)?.isActive() === true;
      const existing = selectedTerminal && isActive(selectedTerminal) ? selectedTerminal
        : [...candidates].reverse().find(isActive) ?? selectedTerminal ?? candidates.at(-1);
      const key = existing?.key ?? JSON.stringify(['terminal', scopeId, hostId, cwd, request.id]);
      if (!existing) setTerminals(previous => [...previous, { key, scopeId, hostId, cwd, threadId }]);
      select(key);
      if (existing) setTerminalActivation({ key, scope: scopeKey });
    } else if (request.kind === 'diff') {
      const key = JSON.stringify(['diff', scopeId, hostId, cwd, request.id]);
      setDiffs(previous => previous.some(tab => tab.key === key) ? previous : [...previous, { key, scopeId, hostId, cwd, path: request.path, diff: request.diff }]);
      select(key);
    }
  }, [closing, openFile, request, scopeId, hostId, cwd, threadId, onRequestConsumed, select, terminals, scopeKey]);

  async function closeTab(key: string) {
    const tab = tabsRef.current.find(item => item.key === key);
    if (!tab || tab.saving || closingRef.current) return;
    const localOnly = !!tab.storageError || recoveryFailures.current.has(key);
    if ((isDirty(tab) || localOnly) && !window.confirm(t(localOnly
      ? 'Close {name} on this page? Copy unsaved local edits first; stored recovery records will not be changed.' : retainRecovery(tab.recovery)
      ? 'Close {name}? The save recovery and retained edits will remain available.'
      : 'Discard unsaved changes to {name}?', {name: fileName(tab.path)}))) return;
    if (!freeze()) return;
    try {
      await recoveryQueues.current.get(key);
      const current = tabsRef.current.find(item => item.key === key);
      if (!current || current.loadId !== tab.loadId || current.revision !== tab.revision) throw new Error('File changed while closing; review the latest edit.');
      if (!localOnly && recoveryFailures.current.has(key)) throw recoveryFailures.current.get(key);
      if (!localOnly && current.recovery) {
        const confirmed = confirmedRecoveries.current.get(key);
        if (!sameFileRecovery(confirmed, current.recovery)) throw new Error('File recovery changed while closing.');
        await discardFileRecoveries([{ key, expected: confirmed!, retain: retainRecovery(current.recovery) }]);
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
    const guardOperationId = current.recovery?.guardOperationId;
    const recovery: FileSaveRecovery = { ...current.recovery, id, checkId: id, submitted: true, phase: 'pending', contents,
      query: undefined,
      saved: expectedContents, draft: contents, revision: current.revision };
    updateTabs(previous => previous.map(item => item.key === tab.key ? { ...item, saving: true, recovery, error: undefined } : item));
    try { await queueRecovery(tab.key, async () => { await claimFileRecovery(tab.key, current.recovery, recovery); confirmedRecoveries.current.set(tab.key, recovery); }); }
    catch (error) {
      updateTabs(previous => previous.map(item => item.key !== tab.key || item.loadId !== loadId || item.recovery?.id !== id ? item : {
        ...item, saving: false, recovery: current.recovery, storageError: true, error: `Could not retain file recovery: ${errorMessage(error)}`,
      }));
      return;
    }
    let result: { outcome: 'saved' | 'conflict' | 'blocked' | 'failed'; operationId?: string; query?: { cwd: string; path: string }; error?: string };
    try {
      result = await client.host<typeof result>('workspace-file-save', {
        hostId: current.hostId, cwd: current.cwd, path: current.path, expectedContents, contents, operationId: id,
        ...(guardOperationId ? { guardOperationId } : {}),
      });
      if (!result || !['saved', 'conflict', 'blocked', 'failed'].includes(result.outcome)
        || result.outcome === 'blocked' && (typeof result.operationId !== 'string' || typeof result.query?.cwd !== 'string'
          || !result.query.cwd.startsWith('/') || typeof result.query.path !== 'string' || !result.query.path.startsWith('/'))
        || result.outcome === 'failed' && (result.operationId !== id || typeof result.error !== 'string')) throw new Error('Invalid save response');
    } catch (error) {
      const knownFailure = typeof error === 'object' && error !== null && 'uncertain' in error && error.uncertain === false;
      try {
        let stored = await storeRecovery(tab.key, id, value => !unresolved(value) ? value : ({ ...value, phase: knownFailure ? 'failed' : 'unknown' }));
        await recoveryQueues.current.get(tab.key);
        stored = confirmedRecoveries.current.get(tab.key) ?? stored;
        updateTabs(previous => previous.map(item => item.key !== tab.key || item.loadId !== loadId || item.recovery?.id !== id ? item : mergeStoredRecovery({
          ...item, saving: false,
          error: item.storageError ? item.error : stored.phase === 'conflict' ? 'File changed on disk. Keep or copy your changes before reloading.'
            : knownFailure ? errorMessage(error) : `Save result is unknown: ${errorMessage(error)}. Check the original operation before saving again.`,
        }, stored)));
      } catch (storageError) {
        updateTabs(previous => previous.map(item => item.key !== tab.key || item.loadId !== loadId || item.recovery?.id !== id ? item : {
          ...item, saving: false, storageError: true, error: `Save result is unknown and recovery could not be updated: ${errorMessage(storageError)}`,
        }));
      }
      return;
    }
    try {
      const phase: RecoveryPhase = result.outcome === 'blocked' ? 'unknown' : result.outcome;
      let stored = await storeRecovery(tab.key, id, value => value.phase === 'conflict' || result.outcome === 'blocked' && !unresolved(value) ? value : ({ ...value, phase,
        ...(result.outcome === 'saved' ? { saved: contents, guardOperationId: id } : {}),
        ...(result.outcome === 'failed' ? { guardOperationId: id } : {}),
        ...(result.outcome === 'blocked' ? { checkId: result.operationId!, submitted: false, query: result.query! } : {}) }));
      await recoveryQueues.current.get(tab.key);
      stored = confirmedRecoveries.current.get(tab.key) ?? stored;
      const accepted = result.outcome === 'saved' && stored.phase === 'saved';
      updateTabs(previous => previous.map(item => item.key !== tab.key || item.loadId !== loadId || item.recovery?.id !== id ? item : mergeStoredRecovery({
        ...item, saving: false,
        saved: accepted ? contents : item.saved,
        content: accepted ? { kind: 'text', text: contents } : item.content,
        error: item.storageError ? item.error : stored.phase === 'conflict' ? 'File changed on disk. Keep or copy your changes before reloading.'
          : result.outcome === 'blocked' ? 'Another save for this file has an unknown result. Check its original operation before saving.'
            : result.outcome === 'failed' ? result.error : undefined,
      }, stored)));
    } catch (error) {
      updateTabs(previous => previous.map(item => item.key !== tab.key || item.loadId !== loadId || item.recovery?.id !== id ? item : {
        ...item, saving: false, storageError: true, error: `Could not retain file recovery: ${errorMessage(error)}`,
      }));
    }
  }

  async function checkSave(tab: FileTab) {
    const current = tabsRef.current.find(item => item.key === tab.key);
    if (closingRef.current || !current?.recovery || !unresolved(current.recovery) || current.saving || current.storageError) return;
    let { recovery } = current;
    const { loadId } = current;
    let updatingRecovery = false;
    updateTabs(previous => previous.map(item => item.key === tab.key ? { ...item, saving: true } : item));
    try {
      type Status = { outcome: 'pending' | 'unknown' | 'missing' | 'saved' | 'conflict' | 'failed' | 'blocked';
        targetMatch?: 'same' | 'different' | 'unknown'; operationId?: string; query?: { cwd: string; path: string } };
      const seen = new Set<string>();
      let status: Status;
      while (true) {
        if (seen.has(recovery.checkId)) throw new Error('Invalid save response');
        seen.add(recovery.checkId);
        status = await client.host<Status>('workspace-file-save-status', {
          hostId: current.hostId, cwd: current.cwd, path: current.path, operationId: recovery.checkId,
          ...(recovery.query ? { queryCwd: recovery.query.cwd, queryPath: recovery.query.path } : {}),
        });
        if (status?.outcome !== 'blocked') break;
        if (typeof status.operationId !== 'string' || !status.operationId || seen.has(status.operationId) || seen.size > 8
          || typeof status.query?.cwd !== 'string' || !status.query.cwd.startsWith('/')
          || typeof status.query.path !== 'string' || !status.query.path.startsWith('/')) {
          throw new Error('Invalid save response');
        }
        updatingRecovery = true;
        let stored = await storeRecovery(tab.key, recovery.id, value => !unresolved(value) ? value : ({ ...value,
          phase: 'unknown', checkId: status.operationId!, submitted: false, query: status.query! }));
        await recoveryQueues.current.get(tab.key);
        stored = confirmedRecoveries.current.get(tab.key) ?? stored;
        updatingRecovery = false;
        const terminalChanged = !unresolved(stored) && stored.phase !== 'conflict';
        updateTabs(previous => previous.map(item => item.key !== tab.key || item.loadId !== loadId || item.recovery?.id !== recovery.id ? item
          : mergeStoredRecovery({ ...item, saving: unresolved(stored), storageError: item.storageError || terminalChanged,
            error: item.storageError ? item.error : terminalChanged ? 'File recovery changed in another page. Keep or copy this edit before closing.'
              : stored.phase === 'conflict' ? 'File changed on disk. Keep or copy your changes before reloading.' : item.error }, stored)));
        const refreshed = tabsRef.current.find(item => item.key === tab.key && item.loadId === loadId && item.recovery?.id === recovery.id);
        if (!refreshed || refreshed.storageError || !unresolved(stored)) {
          updateTabs(previous => previous.map(item => item.key === tab.key && item.loadId === loadId ? { ...item, saving: false } : item));
          return;
        }
        recovery = stored;
      }
      if (!status || !['saved', 'conflict', 'failed'].includes(status.outcome)) {
        updateTabs(previous => previous.map(item => item.key !== tab.key || item.loadId !== loadId || item.recovery?.id !== recovery.id ? item : {
          ...item, saving: false, error: 'Save result is still unknown. The original write may complete later.',
        }));
        return;
      }
      const terminalOutcome = status.outcome as 'saved' | 'conflict' | 'failed';
      const targetMatch = status.targetMatch === 'same' || status.targetMatch === 'different' ? status.targetMatch : 'unknown';
      let saved = false, phase: RecoveryPhase = 'conflict';
      if (terminalOutcome !== 'conflict' && targetMatch === 'same') {
        const result = await readWorkspaceFile(client, current.hostId, current.path);
        if (result.kind !== 'text') throw new Error('File is no longer text');
        saved = recovery.submitted && terminalOutcome === 'saved' && result.text === recovery.contents;
        phase = saved ? 'saved' : result.text === recovery.saved && terminalOutcome === 'failed' ? 'failed' : 'conflict';
      }
      updatingRecovery = true;
      let stored = await storeRecovery(tab.key, recovery.id, value => value.phase === 'conflict' ? value : ({ ...value, phase,
        saved: saved ? recovery.contents : value.saved,
        ...(phase === 'saved' || phase === 'failed' ? { guardOperationId: recovery.checkId } : {}) }));
      await recoveryQueues.current.get(tab.key);
      stored = confirmedRecoveries.current.get(tab.key) ?? stored;
      const accepted = saved && stored.phase === 'saved';
      updateTabs(previous => previous.map(item => item.key !== tab.key || item.loadId !== loadId || item.recovery?.id !== recovery.id ? item : mergeStoredRecovery({
        ...item, saving: false,
        saved: accepted ? recovery.contents : item.saved,
        content: accepted ? { kind: 'text', text: recovery.contents } : item.content,
        error: item.storageError ? item.error : stored.phase === 'conflict' ? 'File changed on disk. Keep or copy your changes before reloading.' : undefined,
      }, stored)));
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
    let competing = false;
    if (tab.recovery) void storeRecovery(key, tab.recovery.id, value => {
      if (value.revision !== tab.revision || value.draft !== tab.draft) {
        competing = true;
        throw new Error('File recovery changed in another page. Keep or copy this edit before reopening.');
      }
      return { ...value, draft: text, revision };
    }).catch(error => updateTabs(previous => previous.map(item => item.key !== key || item.loadId !== tab.loadId ? item : {
      ...item, storageError: true, storageConflict: item.storageConflict || competing, error: `Could not retain file edits: ${errorMessage(error)}`,
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
      const hadConfirmation = confirmedRecoveries.current.has(key);
      const confirmed = confirmedRecoveries.current.get(key);
      const acceptStored = !hadConfirmation && current.revision === 0;
      const restore = hadConfirmation && !stored && confirmed && !unresolved(confirmed)
        && current.recovery?.id === confirmed.id && current.revision > confirmed.revision ? confirmed : undefined;
      if (current.storageConflict && (!stored || stored.id !== current.recovery?.id || stored.draft !== current.draft || stored.revision !== current.revision)
        || !acceptStored && (hadConfirmation && !sameFileRecovery(stored, confirmed) && !restore
        || stored && current.recovery?.id !== stored.id || current.recovery && !stored && !restore
        || stored && current.revision < stored.revision)) {
        throw new Error(recoveryConflict);
      }
      const reconciled = await reconcileFileRecovery(key, stored, acceptStored && stored ? stored.draft : current.draft,
        acceptStored && stored ? stored.revision : current.revision, restore);
      confirmedRecoveries.current.set(key, reconciled);
      recoveryFailures.current.delete(key);
      const recoveredLoadId = acceptStored && reconciled ? ++sequence.current : undefined;
      updateTabs(previous => previous.map(item => item.key !== key || item.loadId !== tab.loadId ? item : {
        ...item, recovery: reconciled, storageError: false, storageConflict: false,
        ...(acceptStored && reconciled ? { loadId: recoveredLoadId!, draft: reconciled.draft, saved: reconciled.saved, revision: reconciled.revision,
          content: { kind: 'text' as const, text: reconciled.saved } } : {}),
        error: unresolved(reconciled) ? 'Save result is unknown. Check the original operation before saving again.'
          : reconciled?.phase === 'conflict' ? 'File changed on disk. Keep or copy your changes before reloading.'
          : disk?.kind !== 'text' ? 'Could not reread this file. Keep or copy your edits.'
            : disk.text !== (acceptStored && reconciled ? reconciled.saved : item.saved) ? 'File changed on disk. Reload or copy your changes before saving.' : undefined,
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
      ? onlyThisPage ? 'Close this panel on this page? A terminal may still be running. Copy unsaved local edits first; stored recovery records will not be changed.'
        : 'Close this panel on this page? Copy unsaved local edits first; stored recovery records will not be changed.' : tabsRef.current.some(tab => retainRecovery(tab.recovery))
      ? 'Close the panel? Other unsaved edits will be discarded. Save recoveries and their retained edits will remain available.' : 'Discard unsaved file changes?'))) return;
    const original = tabsRef.current.map(({ key, loadId, revision }) => ({ key, loadId, revision }));
    setPanelError(undefined);
    if (!freeze()) return;
    try {
      while (recoveryQueues.current.size) await Promise.all(recoveryQueues.current.values());
      const unchanged = () => original.length === tabsRef.current.length && original.every(expected =>
        tabsRef.current.some(tab => tab.key === expected.key && tab.loadId === expected.loadId && tab.revision === expected.revision));
      if (!unchanged()) throw new Error('Files changed while closing; review the latest edits.');
      if (!localOnly && recoveryFailures.current.size) throw recoveryFailures.current.values().next().value;
      if (!onlyThisPage) {
        const results = await Promise.all([...terminalHandles.current.values()].map(handle => handle.close()));
        if (results.some(closed => !closed)) { setPanelError('A terminal could not be closed. File recovery records were retained.'); return; }
      }
      while (recoveryQueues.current.size) await Promise.all(recoveryQueues.current.values());
      if (!unchanged()) throw new Error('Files changed while closing; review the latest edits.');
      if (!localOnly) {
        try {
          const records = tabsRef.current.filter(tab => tab.recovery).map(tab => {
            const expected = confirmedRecoveries.current.get(tab.key);
            if (!sameFileRecovery(expected, tab.recovery)) throw new FileRecoveryChangedError(tab.key);
            return { key: tab.key, expected: expected!, retain: retainRecovery(tab.recovery) };
          });
          await discardFileRecoveries(records);
        }
        catch (error) {
          updateTabs(previous => previous.map(item => item.recovery && (!(error instanceof FileRecoveryChangedError) || error.key === item.key)
            ? { ...item, storageError: true, error: errorMessage(error) } : item));
          throw error;
        }
      }
      if (onlyThisPage) for (const handle of terminalHandles.current.values()) handle.detach();
      recoveryFailures.current.clear();
      confirmedRecoveries.current.clear();
      updateTabs(() => []);
      setTerminals([]);
      setDiffs([]);
      selections.current.clear();
      onDirtyChange?.(false);
      onActiveKindChange?.(null);
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
  const activeKind = active ? 'file' : activeTerminal ? 'terminal' : activeDiff ? 'diff' : null;
  useEffect(() => {
    if (!terminalActivation) return;
    if (terminalActivation.scope !== scopeKey || selected !== terminalActivation.key) { setTerminalActivation(undefined); return; }
    if (activeTerminal?.key !== terminalActivation.key) return;
    setTerminalActivation(undefined);
    terminalHandles.current.get(terminalActivation.key)?.activate();
  }, [terminalActivation, activeTerminal, scopeKey, selected]);
  useEffect(() => {
    if (selectedRef.current === selected) onActiveKindChange?.(activeKind);
  }, [activeKind, scopeKey, selected, onActiveKindChange]);
  useEffect(() => () => { activeKindCallback.current?.(null); }, []);
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
      {activeTerminal ? <button type="button" className="yard-panel-icon" title={t('Hide panel')} aria-label={t('Hide panel')}
        disabled={closing} onClick={onClose}><PanelRightClose /></button> : null}
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
          <DiffViewer diff={tab.diff} path={tab.path ? resolveFilePath(tab.cwd, tab.path) : undefined} markerStyle={appearance.diffMarkerStyle}
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
            onOpenFile={tab.key === active?.key ? openFile : undefined} path={tab.path} content={tab.content!} text={tab.draft} location={tab.location} theme={appearance.theme} codeThemeId={appearance.codeThemeId} visible={tab.key === active?.key}
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
