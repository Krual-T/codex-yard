import { useMemo, useState } from 'react';
import { Columns2, Copy, ExternalLink, Plus, Rows2, WrapText } from 'lucide-react';
import { writeClipboardText } from '../../native/browser-clipboard.ts';
import { errorMessage, fileName } from '../files/file-service.ts';
import type { ComposerDraft } from '../workbench-contract.ts';
import { panelError, usePanelText } from '../panels/panel-i18n.ts';
import { diffRows, splitDiffRows } from './diff-service.ts';
import type { DiffRow } from './diff-service.ts';
import './diff.css';

export interface DiffViewerProps {
  diff?: string;
  path?: string;
  markerStyle?: 'color' | 'symbols';
  onOpenFile?(path: string, line?: number): void;
  onReference?(draft: ComposerDraft): void;
}

export function DiffViewer({ diff, path, markerStyle = 'color', onOpenFile, onReference }: DiffViewerProps) {
  const t = usePanelText();
  const rows = useMemo(() => diff == null ? [] : diffRows(diff, path), [diff, path]);
  const splitRows = useMemo(() => splitDiffRows(rows), [rows]);
  const [error, setError] = useState<string>();
  const [layout, setLayout] = useState<'unified' | 'split'>('unified');
  const [wrap, setWrap] = useState(false);
  async function copy() {
    try { await writeClipboardText(diff ?? ''); setError(undefined); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  function newLine(row: DiffRow) {
    return row.path && row.newLine != null && onOpenFile ? <button type="button" className="yard-diff-number" title={t('Open {path}:{line}', {path: row.path, line: row.newLine})}
      aria-label={t('Open {path} line {line}', {path: row.path, line: row.newLine})} onClick={() => onOpenFile(row.path!, row.newLine)}>{row.newLine}</button> :
      <span className="yard-diff-number">{row.newLine ?? ''}</span>;
  }
  function marker(row?: DiffRow) {
    const kind = row?.kind === 'add' || row?.kind === 'delete' ? row.kind : undefined;
    return <span className={`yard-diff-marker${kind ? ` is-${kind}` : ''}`}
      role={kind ? 'img' : undefined} aria-label={kind ? t(kind === 'add' ? 'Added line' : 'Removed line') : undefined} aria-hidden={kind ? undefined : true}>
      {markerStyle === 'symbols' ? kind === 'add' ? '+' : kind === 'delete' ? '-' : '' : ''}
    </span>;
  }
  const text = (row?: DiffRow) => row ? row.kind === 'add' || row.kind === 'delete' || row.kind === 'context' ? row.text.slice(1) || ' ' : row.text || ' ' : ' ';
  return <div className="yard-diff-viewer">
    <div className="yard-file-toolbar">
      <span className="yard-file-path" title={path ?? t('Changes')}>{path ?? t('Changes')}</span>
      {path && onOpenFile ? <button type="button" className="yard-panel-icon" title={t('Open file')} aria-label={t('Open file')} onClick={() => onOpenFile(path)}><ExternalLink /></button> : null}
      {path && onReference ? <button type="button" className="yard-panel-icon" title={t('Add file to conversation')} aria-label={t('Add file to conversation')}
        onClick={() => onReference({ text: '', images: [], files: [{ path, name: fileName(path) }] })}><Plus /></button> : null}
      {diff != null ? <button type="button" className="yard-panel-icon" title={t('Copy diff')} aria-label={t('Copy diff')} onClick={() => void copy()}><Copy /></button> : null}
      {diff != null ? <button type="button" className="yard-panel-icon" title={t(layout === 'unified' ? 'Switch to split diff' : 'Switch to unified diff')}
        aria-label={t(layout === 'unified' ? 'Switch to split diff' : 'Switch to unified diff')} onClick={() => setLayout(value => value === 'unified' ? 'split' : 'unified')}>
        {layout === 'unified' ? <Columns2 /> : <Rows2 />}</button> : null}
      {diff != null ? <button type="button" className="yard-panel-icon" title={t(wrap ? 'Disable word wrap' : 'Enable word wrap')}
        aria-label={t(wrap ? 'Disable word wrap' : 'Enable word wrap')} aria-pressed={wrap} onClick={() => setWrap(value => !value)}><WrapText /></button> : null}
    </div>
    {error ? <div className="yard-file-error" role="alert">{panelError(t, error)}</div> : null}
    {diff == null ? <div className="yard-file-status" role="status">{t('Diff is unavailable')}</div> :
      <div className={`yard-diff-lines${wrap ? ' is-wrapped' : ''}`} data-marker-style={markerStyle} aria-label={t('Diff')}>{layout === 'unified' ? rows.map((row, index) => <div className={`yard-diff-line is-${row.kind}`} key={index}>
        <span className="yard-diff-number">{row.oldLine ?? ''}</span>
        {newLine(row)}
        {marker(row)}<span className="yard-diff-text">{text(row)}</span>
      </div>) : splitRows.map((pair, index) => pair.kind === 'meta' ?
        <div className={`yard-diff-line is-${pair.row.kind}`} key={index}><span className="yard-diff-text">{pair.row.text || ' '}</span></div> :
        <div className="yard-diff-split-row" key={index}>
          <div className={`yard-diff-side is-${pair.old?.kind ?? 'empty'}`}>
            <span className="yard-diff-number">{pair.old?.oldLine ?? ''}</span>{marker(pair.old)}<span className="yard-diff-text">{text(pair.old)}</span>
          </div>
          <div className={`yard-diff-side is-${pair.current?.kind ?? 'empty'}`}>
            {pair.current ? newLine(pair.current) : <span className="yard-diff-number" />}
            {marker(pair.current)}<span className="yard-diff-text">{text(pair.current)}</span>
          </div>
        </div>)}</div>}
  </div>;
}
