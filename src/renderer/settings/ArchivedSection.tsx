import { useEffect, useRef, useState } from 'react';
import type { WorkbenchClient } from '../workbench-contract.ts';

interface ArchivedThread { id: string; name: string | null; preview?: string; cwd?: string }
interface Page { data: ArchivedThread[]; nextCursor: string | null }
export function ArchivedSection({ client, hostId, onSavingChange }: { client: WorkbenchClient; hostId: string; onSavingChange: (saving: boolean) => void }) {
  const [threads, setThreads] = useState<ArchivedThread[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const load = async (next: string | null) => {
    const current = ++generation.current;
    setLoading(true); setError(null);
    try {
      const page = await client.rpc<Page>('thread/list', { archived: true, cursor: next, limit: 50 }, hostId);
      if (!Array.isArray(page?.data)) throw new Error('Invalid archived chats response');
      if (generation.current !== current) return;
      setThreads(previous => next ? [...previous, ...page.data] : page.data);
      setCursor(page.nextCursor ?? null);
    } catch (cause) { if (generation.current === current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (generation.current === current) setLoading(false); }
  };
  useEffect(() => { void load(null); return () => { generation.current++; }; }, [client, hostId]);
  const restore = async (threadId: string) => {
    setRestoring(threadId); onSavingChange(true); setError(null);
    try {
      const result = await client.rpc<{ thread?: { id?: string } }>('thread/unarchive', { threadId }, hostId);
      if (result?.thread?.id !== threadId) throw new Error('The host did not confirm which chat was restored');
      setThreads(previous => previous.filter(thread => thread.id !== threadId));
    } catch (cause) { setError(`Could not confirm restore: ${cause instanceof Error ? cause.message : String(cause)}. Refresh to check the current state.`); }
    finally { setRestoring(null); onSavingChange(false); }
  };
  return <>
    <div className="yard-section-heading"><h2>Archived chats</h2><button type="button" disabled={loading || restoring !== null} onClick={() => { void load(null); }}>Refresh</button></div>
    {error && <p className="yard-setting-error" role="alert">{error}</p>}
    {loading && <p role="status">Loading archived chats...</p>}
    {!loading && !threads.length && !error && <p className="yard-muted">No archived chats.</p>}
    <div className="yard-setting-group">{threads.map(thread => <div className="yard-setting-row" key={thread.id}>
      <div className="yard-setting-copy"><div className="yard-setting-label">{thread.name || thread.preview || 'Untitled chat'}</div>
        {thread.cwd && <div className="yard-setting-description">{thread.cwd}</div>}</div>
      <button type="button" disabled={restoring !== null || loading} onClick={() => { void restore(thread.id); }}>{restoring === thread.id ? 'Restoring...' : 'Restore'}</button>
    </div>)}</div>
    {cursor && <button type="button" disabled={loading || restoring !== null} onClick={() => { void load(cursor); }}>Load more</button>}
  </>;
}
