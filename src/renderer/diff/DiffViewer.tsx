import { useMemo, useState } from 'react';
import { Copy, ExternalLink, Plus } from 'lucide-react';
import { errorMessage, fileName } from '../files/file-service.ts';
import type { ComposerDraft } from '../workbench-contract.ts';
import { diffRows } from './diff-service.ts';

export interface DiffViewerProps {
  diff?: string;
  path?: string;
  onOpenFile?(path: string, line?: number): void;
  onReference?(draft: ComposerDraft): void;
}

export function DiffViewer({ diff, path, onOpenFile, onReference }: DiffViewerProps) {
  const rows = useMemo(() => diff == null ? [] : diffRows(diff, path), [diff, path]);
  const [error, setError] = useState<string>();
  async function copy() {
    try { await navigator.clipboard.writeText(diff ?? ''); setError(undefined); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  return <div className="yard-diff-viewer">
    <div className="yard-file-toolbar">
      <span className="yard-file-path" title={path ?? 'Changes'}>{path ?? 'Changes'}</span>
      {path && onOpenFile ? <button type="button" className="yard-panel-icon" title="Open file" aria-label="Open file" onClick={() => onOpenFile(path)}><ExternalLink /></button> : null}
      {path && onReference ? <button type="button" className="yard-panel-icon" title="Add file to conversation" aria-label="Add file to conversation"
        onClick={() => onReference({ text: '', images: [], files: [{ path, name: fileName(path) }] })}><Plus /></button> : null}
      {diff != null ? <button type="button" className="yard-panel-icon" title="Copy diff" aria-label="Copy diff" onClick={() => void copy()}><Copy /></button> : null}
    </div>
    {error ? <div className="yard-file-error" role="alert">{error}</div> : null}
    {diff == null ? <div className="yard-file-status" role="status">Diff is unavailable</div> :
      <div className="yard-diff-lines" aria-label="Diff">{rows.map((row, index) => <div className={`yard-diff-line is-${row.kind}`} key={index}>
        <span className="yard-diff-number">{row.oldLine ?? ''}</span>
        {row.path && row.newLine != null && onOpenFile ? <button type="button" className="yard-diff-number" title={`Open ${row.path}:${row.newLine}`}
          aria-label={`Open ${row.path} line ${row.newLine}`} onClick={() => onOpenFile(row.path!, row.newLine)}>{row.newLine}</button> :
          <span className="yard-diff-number">{row.newLine ?? ''}</span>}
        <span className="yard-diff-text">{row.text || ' '}</span>
      </div>)}</div>}
  </div>;
}
