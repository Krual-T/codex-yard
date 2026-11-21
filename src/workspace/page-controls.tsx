import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { requestWorkspaceFetch } from '../native/browser-workspace-rpc.ts';
import { sendHostMessage } from './host.ts';
import './workspace-pages.css';

export const fetchHost = <T,>(endpoint: string, params: Record<string, unknown> = {}, hostId = 'local') =>
  requestWorkspaceFetch<T>(sendHostMessage, endpoint, params, hostId);
export const failureText = (error: unknown) => error instanceof Error ? error.message : String(error);

export function usePageData<T>(read: () => Promise<T>) {
  const [result, setResult] = useState<{ read: () => Promise<T>; value: T }>();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    let current = true;
    setError('');
    void read().then(value => { if (current) setResult({ read, value }); }, error => { if (current) setError(failureText(error)); });
    return () => { current = false; };
  }, [read, revision]);
  return { value: result?.read === read ? result.value : undefined, error, refresh };
}

export function PageSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="yard-page-section"><h2>{title}</h2>{children}</section>;
}
export function SettingRow({ label, description, control }: { label: ReactNode; description?: ReactNode; control: ReactNode }) {
  return <div className="yard-setting-row"><div><div>{label}</div>{description && <p>{description}</p>}</div><div>{control}</div></div>;
}
export function Toggle({ checked, disabled = false, onChange, ariaLabel }: {
  checked: boolean; disabled?: boolean; onChange(value: boolean): void; ariaLabel: string;
}) {
  return <input type="checkbox" role="switch" checked={checked} disabled={disabled} aria-label={ariaLabel}
    onChange={event => onChange(event.currentTarget.checked)} />;
}
export function PageError({ error, retry }: { error?: string; retry?(): void }) {
  return error ? <p role="alert" className="yard-page-error">{error}{retry && <> <button type="button" onClick={retry}>Retry</button></>}</p> : null;
}
export function PageDialog({ title, close, children }: { title: string; close(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="yard-page-dialog" aria-label={title} onCancel={close}>
    <header><h2>{title}</h2><button type="button" onClick={close} aria-label="Close">×</button></header>{children}
  </dialog>;
}

export interface PageProject { id: string; label: string; hostId: string }
export interface WorkspacePageProps { route: string; navigate(route: string): void; projects: PageProject[]; hosts: { hostId: string; label: string }[] }
