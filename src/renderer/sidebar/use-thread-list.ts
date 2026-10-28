import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ThreadSummary } from '../../../lib/codex-protocol.ts';
import type { WorkbenchClient } from '../workbench-contract.ts';

export interface ThreadListRow extends ThreadSummary {
  hostId: string;
  archived: boolean;
  preview?: string | null;
  updatedAt?: number;
  createdAt?: number;
}

export interface ThreadListOptions {
  hostId: string;
  archived: boolean;
  search: string;
  refreshKey: unknown;
}

export interface ThreadListError {
  message: string;
  retry: 'refresh' | 'loadMore';
}

export interface ThreadListResult {
  rows: readonly ThreadListRow[];
  nextCursor: string | null;
  loading: boolean;
  error: ThreadListError | null;
  refresh(): Promise<void>;
  loadMore(): Promise<void>;
}

interface Scope {
  client: WorkbenchClient;
  hostId: string;
  archived: boolean;
  query: string;
}

interface Snapshot {
  scope: Scope;
  rows: readonly ThreadListRow[];
  nextCursor: string | null;
  loading: boolean;
  error: ThreadListError | null;
}

interface Session {
  scope: Scope;
  active: boolean;
  generation: number;
  pending: Promise<void> | null;
  items: ThreadListRow[];
  preserved: ThreadListRow[];
  nextCursor: string | null;
  seenCursors: Set<string>;
  loading: boolean;
  error: ThreadListError | null;
  publish(): void;
}

function matches(row: ThreadListRow, query: string): boolean {
  return !query || [row.name, row.preview, row.cwd].some(value => typeof value === 'string' && value.toLowerCase().includes(query));
}

function mergeRows(first: readonly ThreadListRow[], rest: readonly ThreadListRow[]): ThreadListRow[] {
  const ids = new Set(first.map(row => row.id));
  return [...first, ...rest.filter(row => !ids.has(row.id))];
}

function listPage(value: unknown, scope: Scope): { rows: ThreadListRow[]; nextCursor: string | null } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid conversation list response');
  const page = value as { data?: unknown; nextCursor?: unknown };
  if (!Array.isArray(page.data)) throw new Error('Invalid conversation list data');
  if (page.nextCursor != null && typeof page.nextCursor !== 'string') throw new Error('Invalid conversation list cursor');
  const rows = page.data.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof (value as { id?: unknown }).id !== 'string') {
      throw new Error('Invalid conversation list item');
    }
    return { ...value, hostId: scope.hostId, archived: scope.archived } as ThreadListRow;
  });
  return { rows, nextCursor: page.nextCursor || null };
}

function request(session: Session, replace: boolean): Promise<void> {
  if (!session.active) return Promise.resolve();
  if (!replace && session.pending) return session.pending;
  if (!replace && session.error?.retry === 'refresh') return Promise.resolve();
  if (!replace && !session.nextCursor) return Promise.resolve();

  const generation = ++session.generation;
  const current = () => session.active && session.generation === generation;
  if (replace) session.preserved = mergeRows(session.items, session.preserved);
  session.loading = true;
  session.error = null;
  session.publish();

  const pending = Promise.resolve().then(async () => {
    let cursor = replace ? null : session.nextCursor;
    let items = replace ? [] : session.items.slice();
    const seenCursors = replace ? new Set<string>() : new Set(session.seenCursors);
    try {
      while (current()) {
        const response = await session.scope.client.rpc('thread/list',
          { limit: 100, cursor, sortKey: 'updated_at', archived: session.scope.archived }, session.scope.hostId);
        if (!current()) return;
        const page = listPage(response, session.scope);
        const ids = new Set(items.map(item => item.id));
        for (const row of page.rows) if (!ids.has(row.id)) { ids.add(row.id); items.push(row); }
        if (cursor !== null) seenCursors.add(cursor);
        session.items = items;
        session.seenCursors = seenCursors;
        session.nextCursor = page.nextCursor;
        if (page.nextCursor && seenCursors.has(page.nextCursor)) {
          session.nextCursor = null;
          session.error = { message: 'Conversation list cursor loop detected', retry: 'refresh' };
          return;
        }
        if (!session.scope.query || !page.nextCursor) { session.preserved = []; return; }
        session.publish();
        cursor = page.nextCursor;
      }
    } catch (cause) {
      if (current()) session.error = {
        message: cause instanceof Error ? cause.message : String(cause),
        retry: cursor === null ? 'refresh' : 'loadMore',
      };
    } finally {
      if (current()) {
        session.loading = false;
        session.pending = null;
        session.publish();
      }
    }
  });
  session.pending = pending;
  return pending;
}

/** Reads one host and archive filter at a time; search scans every page locally. */
export function useThreadList(client: WorkbenchClient, { hostId, archived, search, refreshKey }: ThreadListOptions): ThreadListResult {
  const query = search.trim().toLowerCase();
  const scope = useMemo<Scope>(() => ({ client, hostId, archived, query }), [client, hostId, archived, query]);
  const sessionRef = useRef<Session | null>(null);
  const refreshRef = useRef<{ scope: Scope; key: unknown } | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    const session: Session = {
      scope, active: true, generation: 0, pending: null, items: [], preserved: [], nextCursor: null,
      seenCursors: new Set(), loading: true, error: null,
      publish: () => setSnapshot({ scope, rows: mergeRows(session.items, session.preserved).filter(row => matches(row, scope.query)),
        nextCursor: session.nextCursor, loading: session.loading, error: session.error }),
    };
    sessionRef.current = session;
    const unsubscribe = client.subscribe(event => {
      if (event.type === 'mcp-notification' && event.hostId === scope.hostId && event.method === 'thread/status/changed')
        void request(session, true);
    });
    void request(session, true);
    return () => {
      session.active = false;
      session.generation++;
      unsubscribe();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [scope]);

  useEffect(() => {
    const previous = refreshRef.current;
    refreshRef.current = { scope, key: refreshKey };
    if (previous?.scope === scope && !Object.is(previous.key, refreshKey) && sessionRef.current?.scope === scope) {
      void request(sessionRef.current, true);
    }
  }, [scope, refreshKey]);

  const refresh = useCallback(() => {
    const session = sessionRef.current;
    return session?.scope === scope ? request(session, true) : Promise.resolve();
  }, [scope]);
  const loadMore = useCallback(() => {
    const session = sessionRef.current;
    return session?.scope === scope ? request(session, false) : Promise.resolve();
  }, [scope]);
  const visible = snapshot?.scope === scope ? snapshot : { rows: [], nextCursor: null, loading: true, error: null };
  return { rows: visible.rows, nextCursor: visible.nextCursor, loading: visible.loading, error: visible.error, refresh, loadMore };
}
