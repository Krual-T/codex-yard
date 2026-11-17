/** @jsxRuntime classic */
/** @jsx React.createElement */
import type * as ReactRuntime from 'react';

interface FileTabProps {
  path?: string | null;
  hostId?: string;
  initialLine?: number | null;
  initialEndLine?: number | null;
  initialColumn?: number | null;
  column?: number | null;
  tabState?: { lineToReveal?: number | null; textDraft?: string | null; pierreDraft?: unknown };
  tabId: string;
  setTabState(value: unknown): void;
  onDownload?: () => Promise<void>;
}
type FileTab = ReactRuntime.ComponentType<FileTabProps>;
let React: typeof ReactRuntime;

function HtmlFileTab({ original: Original, file }: { original: FileTab; file: FileTabProps }) {
  const [source, setSource] = React.useState(file.initialLine != null || file.initialColumn != null || file.initialEndLine != null || file.column != null || file.tabState?.lineToReveal != null);
  const line = file.tabState?.lineToReveal ?? file.initialLine;
  const column = file.column ?? file.initialColumn;
  React.useEffect(() => { if (line != null || column != null) setSource(true); }, [line, column]);
  const title = file.path?.split(/[\\/]/).pop() ?? 'HTML';
  const query = new URLSearchParams({ path: file.path ?? '', hostId: file.hostId ?? 'local' });
  return <section className="flex h-full min-h-0 flex-col" aria-label="HTML 文件">
    <div className="flex shrink-0 gap-1 border-b border-token-border-default px-4 py-2" role="group" aria-label="HTML 显示方式">
      <button type="button" className="rounded-md px-3 py-1 hover:bg-token-bg-secondary" style={{ fontWeight: source ? 400 : 600 }} aria-pressed={!source} onClick={() => setSource(false)}>预览</button>
      <button type="button" className="rounded-md px-3 py-1 hover:bg-token-bg-secondary" style={{ fontWeight: source ? 600 : 400 }} aria-pressed={source} onClick={() => setSource(true)}>源码</button>
    </div>
    <div className="relative min-h-0 flex-1">
      {source ? <Original {...file} /> : <iframe className="h-full w-full border-0 bg-white" title={title} sandbox="allow-scripts" referrerPolicy="no-referrer" src={'/api/files/html-preview?' + query} />}
    </div>
  </section>;
}

export function installFilePreviews(runtime: typeof ReactRuntime): void {
  React = runtime;
  const target = window as Window & { workbenchFilePreview?: (original: FileTab, props: FileTabProps) => ReactRuntime.ReactNode };
  target.workbenchFilePreview = (original, file) => /\.html?$/i.test(file.path ?? '') && file.hostId !== 'durable'
    ? <HtmlFileTab key={file.tabId} original={original} file={file} />
    : React.createElement(original, file);
}
