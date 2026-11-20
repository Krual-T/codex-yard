import { ChevronLeft, Download, File, Folder, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { readWorkspaceDirectory, searchWorkspaceFiles, type WorkspaceEntry } from './host.ts';
import { OutputPreview } from './output-preview.tsx';
import { outputFileUrl, type OutputFile } from './output-types.ts';

function relativePath(root: string, path: string) {
  const prefix = root.replace(/\/+$/, '') + '/';
  const relative = path.startsWith(prefix) ? path.slice(prefix.length) : path;
  if (relative.split('/').some(part => !part || part === '.' || part === '..') || relative.includes('\0')) return;
  return relative;
}

function workspacePreview(root: string, entry: WorkspaceEntry): OutputFile {
  const preview = /\.html?$/i.test(entry.name) ? 'html' :
    /\.(png|jpe?g|gif|webp|avif)$/i.test(entry.name) ? 'image' :
    /\.(md|txt|ts|tsx|js|jsx|mjs|cjs|jsonc?|ya?ml|log|csv|css|scss|py|rs|sh|toml|xml|go|rb|java|sql)$/i.test(entry.name) ? 'text' : null;
  return { path: root.replace(/\/+$/, '') + '/' + entry.path, name: entry.name, preview };
}

function Rows({ entries, activate }: { entries: WorkspaceEntry[]; activate(entry: WorkspaceEntry): void }) {
  const [limit, setLimit] = useState(100);
  return <>
    <ul aria-label="Workspace files">
      {entries.slice(0, limit).map(entry => <li key={entry.path}>
        <button type="button" onClick={() => activate(entry)} title={entry.path}>
          {entry.type === 'directory' ? <Folder size={16} aria-hidden="true" /> : <File size={16} aria-hidden="true" />}
          <span dir="auto">{entry.name}</span>
        </button>
      </li>)}
    </ul>
    {entries.length > limit && <button type="button" className="yard-source-files-more" onClick={() => setLimit(value => value + 100)}>Show more</button>}
  </>;
}

export function WorkspaceFiles({ root, initialQuery = '', hostId }: { root: string; initialQuery?: string; hostId: string }) {
  const [token] = useState(() => crypto.randomUUID());
  const [directory, setDirectory] = useState('');
  const [input, setInput] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [file, setFile] = useState<OutputFile>();
  const [loaded, setLoaded] = useState<{ directory: string; query: string; entries: WorkspaceEntry[]; parentPath?: string | null; error?: string }>();
  const result = loaded?.query === query && loaded.directory === directory ? loaded : undefined;
  useEffect(() => {
    let current = true;
    const load = query ? searchWorkspaceFiles(root, query, token, hostId).then(({ files }) => {
      const entries = new Map<string, WorkspaceEntry>();
      for (const file of files) {
        if (file.root !== root || (file.match_type !== 'directory' && file.match_type !== 'file')) continue;
        const path = relativePath(root, file.path);
        if (path) entries.set(path, { name: path, path, type: file.match_type });
      }
      return { entries: [...entries.values()] };
    }) : readWorkspaceDirectory(root, directory, hostId);
    void load.then(value => {
      if (current) setLoaded({ directory, query, ...value });
    }, (error: unknown) => {
      if (current) setLoaded({ directory, query, entries: [], error: error instanceof Error ? error.message : String(error) });
    });
    return () => { current = false; };
  }, [directory, query, root, token, hostId]);

  if (file) return <div className="yard-source-files yard-source-files-preview" aria-label="File preview">
    <header>
      <button type="button" aria-label="Back to files" title="Back to files" onClick={() => setFile(undefined)}><ChevronLeft size={16} aria-hidden="true" /></button>
      <span dir="auto" title={file.name}>{file.name}</span>
      <a aria-label="Download file" title="Download file" href={outputFileUrl(file, 'download', hostId)}><Download size={14} aria-hidden="true" /></a>
    </header>
    <OutputPreview file={file} hostId={hostId} />
  </div>;

  function openDirectory(path: string) {
    setDirectory(path);
    setInput('');
    setQuery('');
  }

  return <section className="yard-source-files" aria-label="Workspace files">
    <form role="search" onSubmit={event => { event.preventDefault(); setQuery(input.trim()); }}>
      <Search size={14} aria-hidden="true" />
      <input type="search" aria-label="Search files" placeholder="Search files" value={input}
        onChange={event => setInput(event.target.value)} autoComplete="off" spellCheck={false} />
    </form>
    <header>
      {(directory || query) && <button type="button" aria-label={query ? 'Clear file search' : 'Parent folder'}
        title={query ? 'Clear file search' : 'Parent folder'} onClick={() => openDirectory(query ? directory : result?.parentPath ?? '')}>
        <ChevronLeft size={16} aria-hidden="true" />
      </button>}
      <span dir="auto" title={query || directory || root}>{query || directory || root.split('/').filter(Boolean).at(-1) || '/'}</span>
    </header>
    {!result ? <p role="status">Loading…</p> : result.error ? <p role="alert">{result.error}</p> :
      result.entries.length ? <Rows key={directory + '\n' + query} entries={result.entries} activate={entry => {
        const path = relativePath(root, entry.path);
        if (!path) return;
        if (entry.type === 'directory') openDirectory(path);
        else setFile(workspacePreview(root, { ...entry, path, name: path.split('/').at(-1)! }));
      }} /> : <p role="status">{query ? 'No matching files' : 'Empty folder'}</p>}
  </section>;
}
