import { ChevronsUpDown, ChevronRight, Columns2, Diff, FileSearch, PanelRight, Rows2, Undo2, WrapText } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { TurnSummary } from '../../lib/codex-protocol.ts';
import { changeName, turnChanges, type ChangedPatch } from './turn-changes.ts';
import { mergeLiveTurns, type TurnStream, type WorkspaceTurn } from './turn-stream.ts';

export type OpenTurnChanges = (turnId: string) => void;
const subscribeEmpty = () => () => {};
const fileLabel = (count: number) => count + (count === 1 ? ' file changed' : ' files changed');

function ChangeStats({ added, removed }: { added: number; removed: number }) {
  return <span className="yard-source-change-stats">
    <span className="yard-source-diff-added">+{added}</span><span className="yard-source-diff-removed">-{removed}</span>
  </span>;
}

export function ComposerChanges({ stream, activeTurn, history, open, fallback }: {
  stream?: TurnStream; activeTurn?: string | null; history?: TurnSummary[];
  open?: OpenTurnChanges; fallback: ReactNode;
}) {
  const live = useSyncExternalStore(activeTurn && stream && open ? stream.subscribe : subscribeEmpty,
    () => activeTurn && open ? stream?.read().find(turn => turn.id === activeTurn) : undefined);
  const turn = activeTurn && open ? live ?? history?.find(turn => turn.id === activeTurn) : undefined;
  const changes = useMemo(() => turnChanges(turn), [turn]);
  const shown = !!(turn && open && changes.files.length);
  return <>
    <div className="yard-source-access-notice" data-has-changes={shown}>{fallback}</div>
    {shown && <div className="yard-source-changes-live">
      <button type="button" title="View changes" className="yard-source-changes-pill" onClick={() => open!(turn!.id)}>
        <span>{fileLabel(changes.files.length)}</span><ChangeStats {...changes} />
      </button>
    </div>}
  </>;
}

export function TurnChangeCard({ turn, open }: { turn: WorkspaceTurn; open: OpenTurnChanges }) {
  const changes = useMemo(() => turnChanges(turn), [turn]);
  if (!changes.files.length) return null;
  const label = changes.files.length === 1 ? 'Edited ' + changeName(changes.files[0]!.path) : 'Edited ' + changes.files.length + ' files';
  return <div className="yard-source-turn-changes">
    <button type="button" className="yard-source-turn-changes-target" aria-label="View changed files" onClick={() => open(turn.id)} />
    <span className="yard-source-turn-changes-icon"><Diff aria-hidden="true" size={18} /></span>
    <div className="yard-source-turn-changes-copy">
      <span title={label}>{label}</span>
      <span className="yard-source-turn-changes-stats"><ChangeStats {...changes} /></span>
      <span className="yard-source-turn-changes-hover" aria-hidden="true">View changes <PanelRight size={12} /></span>
    </div>
    <div className="yard-source-turn-changes-actions">
      <button type="button" disabled title="No reversible snapshot is available">Undo <Undo2 size={13} aria-hidden="true" /></button>
      <button type="button" onClick={() => open(turn.id)}>View changes</button>
    </div>
  </div>;
}

type Line = { number?: number; type?: 'added' | 'removed'; text: string };
type Pair = [Line | undefined, Line | undefined];

function patchRows(patch: ChangedPatch, split: boolean): Pair[] {
  const rows: Pair[] = [];
  if (!patch.hunks.length) return (patch.raw?.trimEnd().split('\n') ?? [])
    .map(text => [{ text } as Line, undefined]);
  for (const hunk of patch.hunks) {
    let old = hunk.oldStart, next = hunk.newStart;
    let before: Line[] = [], after: Line[] = [];
    const flush = () => {
      for (let i = 0; i < Math.max(before.length, after.length); i++) rows.push([before[i], after[i]]);
      before = []; after = [];
    };
    for (const line of hunk.lines) {
      if (line.startsWith('-')) {
        const value = { type: 'removed', text: line.slice(1), number: old++ } as const;
        if (split) before.push(value); else rows.push([value, undefined]);
      } else if (line.startsWith('+')) {
        const value = { type: 'added', text: line.slice(1), number: next++ } as const;
        if (split) after.push(value); else rows.push([undefined, value]);
      } else {
        flush();
        if (line.startsWith(' ')) {
          const text = line.slice(1);
          rows.push([{ text, number: old++ }, { text, number: next++ }]);
        } else rows.push([{ text: line }, undefined]);
      }
    }
    flush();
  }
  return rows;
}

function DiffCell({ line, beside }: { line?: Line; beside?: Line }) {
  return <span className="yard-source-diff-cell" data-diff-line={line?.type}>
    {beside && <span className="yard-source-diff-number">{beside.number}</span>}
    <span className="yard-source-diff-number">{line?.number}</span>
    <code>{line?.text || ' '}</code>
  </span>;
}

function PatchLines({ patch, split, wrap }: { patch: ChangedPatch; split: boolean; wrap: boolean }) {
  const rows = useMemo(() => patchRows(patch, split), [patch, split]);
  if (!rows.length) return <p className="yard-source-diff-empty">{patch.isBinary ? 'Binary file changed' : 'No line changes'}</p>;
  return <div className="yard-source-change-patch" aria-label="Diff" tabIndex={0} data-split={split} data-wrap={wrap}>
    {rows.map(([before, after], index) => <div className="yard-source-diff-row" key={index}>
      {split ? <><DiffCell line={before} /><DiffCell line={after} /></> :
        <DiffCell line={after ?? before} beside={after && before ? before : undefined} />}
    </div>)}
  </div>;
}

export function TurnChangesPanel({ turnId, stream, turns, cwd }: {
  turnId: string; stream: TurnStream; turns?: TurnSummary[]; cwd?: string;
}) {
  const live = useSyncExternalStore(stream.subscribe, stream.read);
  const loaded = useMemo(() => mergeLiveTurns(turns, live), [turns, live]);
  const turn = loaded.find(turn => turn.id === turnId);
  const changes = useMemo(() => turnChanges(turn, cwd), [turn, cwd]);
  const panel = useRef<HTMLElement>(null);
  const jump = useRef<HTMLDivElement>(null);
  const jumpId = useId();
  const [compact, setCompact] = useState(false);
  const [mode, setMode] = useState<'Auto' | 'Unified' | 'Split'>('Auto');
  const [wrap, setWrap] = useState(false);
  const [files, setFiles] = useState(false);
  const [closed, setClosed] = useState(new Set<string>());
  useEffect(() => {
    const node = panel.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width;
      if (width) setCompact(width < 640);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const split = mode === 'Auto' ? !compact : mode === 'Split';
  const allOpen = changes.files.every(file => !closed.has(file.path));
  const nextMode = mode === 'Auto' ? 'Unified' : mode === 'Unified' ? 'Split' : 'Auto';
  function showFile(path: string) {
    setClosed(previous => { const next = new Set(previous); next.delete(path); return next; });
    const file = [...(panel.current?.querySelectorAll<HTMLElement>('[data-change-file]') ?? [])].find(node => node.dataset.changeFile === path);
    file?.scrollIntoView({ block: 'start' });
    file?.querySelector('button')?.focus({ preventScroll: true });
  }
  return <section className="yard-source-changes-panel" aria-label="Turn changes" ref={panel}>
    <div className="yard-source-changes-panel-toolbar">
      <div role="group" aria-label="Review source" className="yard-source-changes-panel-summary">
        <span>{loaded.at(-1)?.id === turnId ? 'Last Turn' : 'Selected Turn'}</span><ChangeStats {...changes} />
      </div>
      <div role="group" aria-label="Changes controls" className="yard-source-changes-panel-controls">
        <button type="button" title="Jump to file" aria-label="Jump to file" popoverTarget={jumpId} disabled={!changes.files.length}><FileSearch size={14} /></button>
        <button type="button" title="Word wrap" aria-label="Word wrap" aria-pressed={wrap} onClick={() => setWrap(!wrap)}><WrapText size={14} /></button>
        <button type="button" title={allOpen ? 'Collapse all diffs' : 'Expand all diffs'} aria-label={allOpen ? 'Collapse all diffs' : 'Expand all diffs'}
          disabled={!changes.files.length} onClick={() => setClosed(new Set(allOpen ? changes.files.map(file => file.path) : []))}><ChevronsUpDown size={14} /></button>
        <button type="button" title={mode + ' diff: switch to ' + nextMode.toLowerCase() + ' diff'}
          aria-label={mode + ' diff: switch to ' + nextMode.toLowerCase() + ' diff'} onClick={() => setMode(nextMode)}>
          {split ? <Columns2 size={14} /> : <Rows2 size={14} />}
        </button>
        <button type="button" title="Show files" aria-label="Show files" aria-pressed={files} onClick={() => setFiles(!files)}><PanelRight size={14} /></button>
      </div>
      <div className="yard-source-changes-jump" id={jumpId} ref={jump} popover="auto" aria-label="Jump to file">
        {changes.files.map(file => <button key={file.path} type="button" title={file.path} onClick={() => { jump.current?.hidePopover(); showFile(file.path); }}>{file.path}</button>)}
      </div>
    </div>
    <div className="yard-source-changes-panel-body">
      {changes.files.length ? <div className="yard-source-changes-files">
        {changes.files.map(file => <div data-change-file={file.path} key={file.path}>
          <button type="button" className="yard-source-change-file" title={file.path} aria-label={file.path} aria-expanded={!closed.has(file.path)} onClick={() =>
            setClosed(previous => { const next = new Set(previous); if (!next.delete(file.path)) next.add(file.path); return next; })}>
            <ChevronRight className="yard-source-changes-chevron" size={14} aria-hidden="true" />
            <span title={file.path} dir="auto">{file.path}</span><ChangeStats {...file} />
          </button>
          {!closed.has(file.path) && file.patches.map((patch, index) => <PatchLines key={index} patch={patch} split={split} wrap={wrap} />)}
        </div>)}
      </div> : <p className="yard-source-diff-empty">No file changes</p>}
      {files && <nav className="yard-source-change-file-list" aria-label="Changed files">
        {changes.files.map(file => <button key={file.path} type="button" title={file.path} onClick={() => showFile(file.path)}>{file.path}</button>)}
      </nav>}
    </div>
  </section>;
}
