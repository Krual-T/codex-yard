import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, File, Folder, FolderOpen, RefreshCw } from 'lucide-react';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { errorMessage, resolveFilePath } from './file-service.ts';

interface DirectoryEntry { name: string; path: string; type: 'directory' | 'file'; isSymlink: boolean }
interface DirectoryState { loading: boolean; entries?: DirectoryEntry[]; error?: string }
interface Props { client: WorkbenchClient; hostId: string; cwd: string; onOpen(path: string): void }

export function DirectoryTree({ client, hostId, cwd, onOpen }: Props) {
  const [directories, setDirectories] = useState<Record<string, DirectoryState>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']));
  const generation = useRef(0);

  const load = useCallback((directoryPath: string) => {
    const current = generation.current;
    setDirectories(previous => ({ ...previous, [directoryPath]: { loading: true } }));
    void client.host<{ entries: DirectoryEntry[] }>('workspace-directory-entries', {
      hostId, workspaceRoot: cwd, directoryPath, includeHidden: true,
    }).then(result => {
      if (current !== generation.current) return;
      if (!Array.isArray(result?.entries)) throw new Error('Invalid directory response');
      setDirectories(previous => ({ ...previous, [directoryPath]: { loading: false, entries: result.entries } }));
    }).catch(error => {
      if (current === generation.current) setDirectories(previous => ({ ...previous, [directoryPath]: { loading: false, error: errorMessage(error) } }));
    });
  }, [client, cwd, hostId]);

  useEffect(() => {
    generation.current++;
    setDirectories({});
    setExpanded(new Set(['']));
    load('');
    return () => { generation.current++; };
  }, [load]);

  function refresh() {
    generation.current++;
    setDirectories({});
    setExpanded(new Set(['']));
    load('');
  }

  function toggle(path: string) {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else {
      next.add(path);
      if (!directories[path]) load(path);
    }
    setExpanded(next);
  }

  function renderDirectory(path: string, depth: number) {
    const directory = directories[path];
    if (directory?.loading) return <div className="yard-files-tree-status" style={{ paddingLeft: 12 + depth * 14 }}>Loading...</div>;
    if (directory?.error) return <div className="yard-files-tree-error" role="alert" style={{ paddingLeft: 12 + depth * 14 }}>
      {directory.error} <button type="button" onClick={() => load(path)}>Retry</button>
    </div>;
    return directory?.entries?.map(entry => {
      const isOpen = expanded.has(entry.path);
      return <div key={entry.path}>
        <button type="button" className="yard-files-tree-entry" style={{ paddingLeft: 8 + depth * 14 }}
          title={entry.path} onClick={() => entry.type === 'directory' ? toggle(entry.path) : onOpen(resolveFilePath(cwd, entry.path))}
          aria-expanded={entry.type === 'directory' ? isOpen : undefined}>
          {entry.type === 'directory' ? <>{isOpen ? <ChevronDown /> : <ChevronRight />}{isOpen ? <FolderOpen /> : <Folder />}</> : <><span className="yard-files-tree-spacer" /><File /></>}
          <span>{entry.name}</span>
        </button>
        {entry.type === 'directory' && isOpen ? renderDirectory(entry.path, depth + 1) : null}
      </div>;
    });
  }

  return <div className="yard-files-tree">
    <div className="yard-files-tree-heading"><span title={cwd}>Files</span>
      <button type="button" className="yard-panel-icon" title="Refresh files" aria-label="Refresh files" onClick={refresh}><RefreshCw /></button>
    </div>
    <div className="yard-files-tree-list">{renderDirectory('', 0)}</div>
  </div>;
}
