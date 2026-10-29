import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, File, FileImage, FileText, Globe, Presentation, Table2 } from 'lucide-react';
import { parse } from 'node-html-parser';
import type { ThreadSummary, TurnSummary } from '../../../lib/codex-protocol.ts';
import type { StandaloneMessagesProps, WorkbenchClient } from '../workbench-contract.ts';
import { projectMessageTurnPreviews } from './message-output-previews.ts';
import type { MessageGooglePreview, MessageOutputDirectory, MessageOutputPreview, MessageWebsitePreview } from './message-output-previews.ts';
import './message-output-previews.css';

type OpenResource = Pick<StandaloneMessagesProps, 'onOpenFile' | 'onOpenFileAt' | 'onOpenBrowser'>;
export interface MessageOutputPreviewAuthority {
  /** Changes with the original page, host, thread, cwd and connection scope. */
  sourceKey: string;
  assertCurrent(): void;
  outputDirectory?: MessageOutputDirectory;
}

function OutputCard({ entry, open, canOpen, websiteTitle }: { entry: MessageOutputPreview | MessageWebsitePreview | MessageGooglePreview;
  open(): void; canOpen: boolean; websiteTitle?: string }) {
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
  const Icon = entry.kind === 'website' ? Globe : entry.kind === 'spreadsheet' || entry.kind === 'google-drive' && entry.resourceKind === 'spreadsheet' ? Table2
    : entry.kind === 'presentation' || entry.kind === 'google-drive' && entry.resourceKind === 'presentation' ? Presentation
      : entry.kind === 'google-drive' && entry.resourceKind === 'document' ? FileText : entry.kind === 'image' ? FileImage : File;
  const label = entry.kind === 'website' ? 'Website' : entry.kind === 'google-drive'
    ? ({document:'Google Docs', spreadsheet:'Google Sheets', presentation:'Google Slides', drive:'Google Drive'} as const)[entry.resourceKind]
    : entry.kind === 'spreadsheet' ? 'Spreadsheet' : entry.kind === 'presentation' ? 'Presentation' : entry.kind === 'image' ? 'Image' : 'Document';
  const name = entry.kind === 'website' ? websiteTitle || 'Web preview' : entry.kind === 'google-drive' ? entry.title : entry.name;
  return <div className="yard-output-card">
    <button type="button" className="yard-output-open" aria-label={`Open ${name}`} disabled={!canOpen} onClick={open} />
    <div className="yard-output-description" aria-hidden="true">
      <span className={`yard-output-icon${entry.kind === 'website' ? ' yard-output-icon--website' : entry.kind === 'google-drive' ? ` yard-output-icon--google-${entry.resourceKind}` : ''}`}>
        <Icon size={20} strokeWidth={1.5} {...entry.kind === 'google-drive' && entry.resourceKind === 'document' ? {fill:'currentColor', stroke:'white'} : {}} />
      </span>
      <span className="yard-output-title"><span title={name}>{name}</span><small>{label}</small></span>
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
export function MessageOutputPreviews({ client, hostId, thread, turn, authority, onOpenFile, onOpenFileAt, onOpenBrowser }: {
  client: WorkbenchClient; hostId: string; thread: ThreadSummary; turn: TurnSummary;
  authority?: MessageOutputPreviewAuthority;
} & OpenResource) {
  const threadId = thread.id, cwd = thread.cwd;
  const directory = authority?.outputDirectory;
  const directoryPath = directory?.status === 'known' ? directory.path : undefined;
  const projection = useMemo(() => projectMessageTurnPreviews(hostId, thread, turn, directory),
    [hostId, threadId, cwd, turn, directory?.status, directoryPath]);
  const candidates = projection.entries;
  const candidateKey = JSON.stringify(projection);
  const [connectionRevision, setConnectionRevision] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const scope = useMemo(() => ({ client, hostId, threadId, cwd, turnId: turn.id, candidates, website: projection.website, google: projection.google, connectionRevision, attempt, authority }),
    [client, hostId, threadId, cwd, turn.id, candidateKey, connectionRevision, attempt, Boolean(authority), authority?.sourceKey]);
  const current = useRef<typeof scope | null>(scope);
  const [result, setResult] = useState<{ scope: typeof scope; entries: MessageOutputPreview[]; error: string | null } | null>(null);
  const [actionError, setActionError] = useState<{ scope: typeof scope; message: string } | null>(null);
  const [websiteTitle, setWebsiteTitle] = useState<{ scope: typeof scope; title: string } | null>(null);
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
    const paths = scope.candidates.map(entry => entry.path);
    if (!paths.length || !scope.hostId || !scope.threadId) return;
    let active = true;
    const checkRead = () => {
      if (!active) throw new Error('The original output source changed.');
      check(scope);
    };
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
  useEffect(() => {
    if (scope.website?.target.type !== 'file' || !scope.hostId || !scope.threadId) return;
    const path = scope.website.target.path;
    let active = true;
    const checkRead = () => {
      if (!active) throw new Error('The original output source changed.');
      check(scope);
    };
    void (async () => {
      try {
        checkRead();
        const response = await scope.client.host<{ contents: unknown }>('read-file',
          {hostId: scope.hostId, path},
          {assertBeforeSend: checkRead});
        checkRead();
        if (typeof response?.contents !== 'string') throw new Error('Invalid read-file response.');
        const title = parse(response.contents).querySelector('title')?.text.trim();
        checkRead();
        if (title) setWebsiteTitle({scope, title});
      } catch { /* The original website label remains usable if its title cannot be read. */ }
    })();
    return () => { active = false; };
  }, [scope]);

  const visible = result?.scope === scope ? result : null;
  const website = scope.website;
  if (!visible && !website && !scope.google.length && !projection.unavailable && !projection.resourceUncertain && !projection.incomplete) return null;
  const open = (entry: MessageOutputPreview | MessageWebsitePreview | MessageGooglePreview) => {
    try {
      check(scope);
      if (entry.kind === 'google-drive') {
        if (!scope.google.includes(entry)) throw new Error('The original output source changed.');
        if (!onOpenBrowser) throw new Error('Browser preview is unavailable.');
        onOpenBrowser({hostId:scope.hostId, threadId:scope.threadId, url:entry.url, source:'link'});
      } else if (entry.kind === 'website' && entry.target.type === 'url') {
        if (entry !== website) throw new Error('The original output source changed.');
        if (!onOpenBrowser) throw new Error('Browser preview is unavailable.');
        onOpenBrowser({hostId:scope.hostId, threadId:scope.threadId, url:entry.target.url});
      } else {
        if (entry.kind === 'website' ? entry !== website : !visible?.entries.includes(entry)) throw new Error('The original output source changed.');
        const path = entry.kind === 'website' && entry.target.type === 'file' ? entry.target.path
          : entry.kind !== 'website' ? entry.path : null;
        if (!path) throw new Error('The original output source changed.');
        const target = { hostId: scope.hostId, cwd: scope.cwd, path, assertCurrent: () => check(scope) };
        if (onOpenFileAt) onOpenFileAt(target);
        else if (onOpenFile) onOpenFile(path);
        else throw new Error('File preview is unavailable.');
      }
      setActionError(null);
    } catch (error) { setActionError({ scope, message: error instanceof Error ? error.message : String(error) }); }
  };
  return <div className="yard-output-previews" data-markdown-copy="exclude">
    {visible?.entries.map(entry => <OutputCard key={`${connectionRevision}:${attempt}:${entry.path}`} entry={entry}
      canOpen={Boolean(onOpenFileAt || onOpenFile)} open={() => open(entry)} />)}
    {scope.google.map(entry => <OutputCard key={`${connectionRevision}:${attempt}:${entry.url}`} entry={entry}
      canOpen open={() => open(entry)} />)}
    {website && <OutputCard key={`${connectionRevision}:${attempt}:website`} entry={website}
      websiteTitle={websiteTitle?.scope === scope ? websiteTitle.title : undefined}
      canOpen={website.target.type === 'url' || Boolean(onOpenFileAt || onOpenFile)} open={() => open(website)} />}
    {projection.unavailable && <div className="yard-output-error" role="status">Could not verify the output directory.</div>}
    {projection.resourceUncertain && <div className="yard-output-error" role="status">Could not verify app-generated output precedence for this website.</div>}
    {projection.incomplete && <div className="yard-output-error" role="status">The output cannot be verified until the turn history is complete.</div>}
    {visible?.error && <div className="yard-output-error" role="alert">Could not check output files: {visible.error}{' '}
      <button type="button" onClick={() => { current.current = null; setAttempt(value => value + 1); }}>Retry</button></div>}
    {actionError?.scope === scope && <div className="yard-output-error" role="alert">{actionError.message}</div>}
  </div>;
}
