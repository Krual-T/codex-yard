import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, File, FileImage, Presentation, Table2 } from 'lucide-react';
import type { TurnSummary } from '../../../lib/codex-protocol.ts';
import type { StandaloneMessagesProps, WorkbenchClient } from '../workbench-contract.ts';
import { projectMessageOutputPreviews, restrictMessageOutputDirectory } from './message-output-previews.ts';
import type { MessageOutputDirectory, MessageOutputPreview } from './message-output-previews.ts';
import './message-output-previews.css';

type OpenFile = Pick<StandaloneMessagesProps, 'onOpenFile' | 'onOpenFileAt'>;
export interface MessageOutputPreviewAuthority {
  /** Changes with the original page, host, thread, cwd and connection scope. */
  sourceKey: string;
  assertCurrent(): void;
  outputDirectory?: MessageOutputDirectory;
}

function OutputCard({ entry, open, canOpen }: { entry: MessageOutputPreview; open(): void; canOpen: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setMenuOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setMenuOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [menuOpen]);
  const Icon = entry.kind === 'spreadsheet' ? Table2 : entry.kind === 'presentation' ? Presentation : entry.kind === 'image' ? FileImage : File;
  const label = entry.kind === 'spreadsheet' ? 'Spreadsheet' : entry.kind === 'presentation' ? 'Presentation' : entry.kind === 'image' ? 'Image' : 'Document';
  return <div className="yard-output-card">
    <button type="button" className="yard-output-open" aria-label={`Open ${entry.name}`} disabled={!canOpen} onClick={open} />
    <div className="yard-output-description" aria-hidden="true">
      <span className="yard-output-icon"><Icon size={20} strokeWidth={1.5} /></span>
      <span className="yard-output-title"><span title={entry.name}>{entry.name}</span><small>{label}</small></span>
    </div>
    <div className="yard-output-menu" ref={menu}>
      <button type="button" ref={trigger} className="yard-output-menu-trigger" aria-haspopup="menu" aria-expanded={menuOpen}
        onClick={() => setMenuOpen(value => !value)}>Open in <ChevronDown size={13} aria-hidden="true" /></button>
      {menuOpen && <div className="yard-output-menu-content" role="menu" aria-label="Open in">
        <div className="yard-output-menu-note">External app discovery is unavailable in this web host.</div>
      </div>}
    </div>
  </div>;
}

/** The card is scoped to the same host and conversation as the rendered turn. */
export function MessageOutputPreviews({ client, hostId, threadId, cwd, turn, authority, onOpenFile, onOpenFileAt }: {
  client: WorkbenchClient; hostId: string; threadId: string; cwd: string; turn: TurnSummary;
  authority?: MessageOutputPreviewAuthority;
} & OpenFile) {
  const directory = authority?.outputDirectory;
  const directoryPath = directory?.status === 'known' ? directory.path : undefined;
  const projection = useMemo(() => {
    const all = projectMessageOutputPreviews(turn, cwd);
    return { ...restrictMessageOutputDirectory(all, cwd, directory), hasCandidates: all.length > 0 };
  }, [turn, cwd, directory?.status, directoryPath]);
  const candidates = projection.entries;
  const candidateKey = JSON.stringify(candidates);
  const [connectionRevision, setConnectionRevision] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const scope = useMemo(() => ({ client, hostId, threadId, cwd, turnId: turn.id, candidates, connectionRevision, attempt, authority }),
    [client, hostId, threadId, cwd, turn.id, candidateKey, connectionRevision, attempt, Boolean(authority), authority?.sourceKey]);
  const current = useRef<typeof scope | null>(scope);
  const [result, setResult] = useState<{ scope: typeof scope; entries: MessageOutputPreview[]; error: string | null } | null>(null);
  const [actionError, setActionError] = useState<{ scope: typeof scope; message: string } | null>(null);
  const check = (expected: typeof scope) => {
    if (current.current !== expected) throw new Error('The original output source changed.');
    const checked: unknown = expected.authority?.assertCurrent();
    if (checked && (typeof checked === 'object' || typeof checked === 'function') && typeof (checked as { then?: unknown }).then === 'function') {
      void Promise.resolve(checked).catch(() => {});
      throw new Error('The output source check must be synchronous.');
    }
    if (current.current !== expected) throw new Error('The original output source changed.');
  };

  useLayoutEffect(() => {
    current.current = scope;
    return () => { if (current.current === scope) current.current = null; };
  }, [scope]);
  useEffect(() => client.subscribe(event => {
    if (event.type === 'page-resumed' || event.type === 'connection-state'
      || event.type === 'codex-app-server-connection-changed' && event.hostId === hostId) {
      current.current = null;
      setConnectionRevision(value => value + 1);
    }
  }), [client, hostId]);
  useEffect(() => {
    if (!scope.candidates.length || !scope.hostId || !scope.threadId) return;
    let active = true;
    const checkRead = () => {
      if (!active) throw new Error('The original output source changed.');
      check(scope);
    };
    const paths = scope.candidates.map(entry => entry.path);
    void (async () => {
      try {
        checkRead();
        const response = await scope.client.host<{ existingPaths: unknown }>('paths-exist', { hostId: scope.hostId, paths }, { assertBeforeSend: checkRead });
        checkRead();
        if (!Array.isArray(response?.existingPaths) || !response.existingPaths.every(path => typeof path === 'string' && paths.includes(path))) {
          throw new Error('Invalid paths-exist response.');
        }
        const existing = new Set(response.existingPaths);
        setResult({ scope, entries: scope.candidates.filter(entry => existing.has(entry.path)), error: null });
      } catch (error) {
        try { checkRead(); } catch { return; }
        setResult({ scope, entries: scope.candidates, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return () => { active = false; };
  }, [scope]);

  const visible = result?.scope === scope ? result : null;
  if (projection.unavailable && projection.hasCandidates) return <div className="yard-output-error" role="status">Could not verify the output directory.</div>;
  if (!visible) return null;
  const open = (entry: MessageOutputPreview) => {
    try {
      check(scope);
      if (!visible.entries.includes(entry)) throw new Error('The original output source changed.');
      if (onOpenFileAt) onOpenFileAt({ hostId: scope.hostId, cwd: scope.cwd, path: entry.path });
      else if (onOpenFile) onOpenFile(entry.path);
      else throw new Error('File preview is unavailable.');
      setActionError(null);
    } catch (error) { setActionError({ scope, message: error instanceof Error ? error.message : String(error) }); }
  };
  return <div className="yard-output-previews" data-markdown-copy="exclude">
    {visible.entries.map(entry => <OutputCard key={`${connectionRevision}:${attempt}:${entry.path}`} entry={entry}
      canOpen={Boolean(onOpenFileAt || onOpenFile)} open={() => open(entry)} />)}
    {visible.error && <div className="yard-output-error" role="alert">Could not check output files: {visible.error}{' '}
      <button type="button" onClick={() => { current.current = null; setAttempt(value => value + 1); }}>Retry</button></div>}
    {actionError?.scope === scope && <div className="yard-output-error" role="alert">{actionError.message}</div>}
  </div>;
}
