import { useEffect, useMemo, useRef, useState } from 'react';
import type { ThreadResponse, ThreadSummary } from '../../../lib/codex-protocol.ts';
import type { WorkbenchClient } from '../workbench-contract.ts';
import type { ThreadSummaryCreatedChat } from './ThreadSummaryPanel.tsx';

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const nonempty = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const key = (hostId: string, threadId: string) => JSON.stringify([hostId, threadId]);

/** Only successful create_thread results in this conversation establish this association. */
export function projectCreatedChats(thread: ThreadSummary | null, sourceHostId: string, fallback: string): ThreadSummaryCreatedChat[] {
  if (!thread) return [];
  const results = new Map<string, ThreadSummaryCreatedChat>();
  for (const turn of [...(thread.turns ?? [])].reverse()) {
    for (const item of [...(turn.items ?? [])].reverse()) {
      if (item.status !== 'completed' || item.tool !== 'create_thread') continue;
      let content: unknown[];
      if (item.type === 'dynamicToolCall' && item.namespace === 'codex_app' && item.success === true) {
        content = array(item.contentItems).filter(value => record(value).type === 'inputText');
      } else if (item.type === 'mcpToolCall' && item.server === 'codex_app' && item.error == null && record(item.result).isError !== true) {
        content = array(record(item.result).content).filter(value => record(value).type === 'text');
      } else continue;
      const raw = record(content[0]).text;
      if (typeof raw !== 'string' || raw.length > 1_048_576) continue;
      let result: Record<string, unknown>;
      try { result = record(JSON.parse(raw)); } catch { continue; }
      if (result.kind !== undefined && result.kind !== 'codex') continue;
      const threadId = nonempty(result.threadId);
      const hostId = result.hostId === undefined ? sourceHostId : nonempty(result.hostId);
      if (!threadId || !hostId) continue;
      const identity = key(hostId, threadId);
      if (!results.has(identity)) results.set(identity, { hostId, threadId, label: fallback,
        source: { hostId: sourceHostId, threadId: thread.id, turnId: turn.id, itemId: item.id } });
      if (results.size === 5) return [...results.values()];
    }
  }
  return [...results.values()];
}

export function useCreatedChats(client: WorkbenchClient, sourceHostId: string, thread: ThreadSummary | null, fallback: string) {
  const candidates = useMemo(() => projectCreatedChats(thread, sourceHostId, fallback), [thread, sourceHostId, fallback]);
  const [revision, setRevision] = useState(0);
  const epoch = useRef(0);
  const identity = JSON.stringify([sourceHostId, thread?.id, candidates, revision]);
  const [resolved, setResolved] = useState<{ identity: string; labels: Record<string, string> } | null>(null);
  useEffect(() => client.subscribe(event => {
    if (event.type === 'connection-state' || event.type === 'codex-app-server-connection-changed'
      && (event.hostId === sourceHostId || candidates.some(chat => chat.hostId === event.hostId))) {
      ++epoch.current; setRevision(value => value + 1);
    }
  }), [client, sourceHostId, identity]);
  useEffect(() => {
    let active = true;
    const generation = epoch.current;
    for (const chat of candidates) {
      void client.rpc<ThreadResponse>('thread/read', { threadId: chat.threadId, includeTurns: false }, chat.hostId).then(response => {
        const name = response.thread?.id === chat.threadId ? nonempty(response.thread.name) : null;
        if (name && active && epoch.current === generation) setResolved(previous => ({ identity,
          labels: { ...(previous?.identity === identity ? previous.labels : {}), [key(chat.hostId, chat.threadId)]: name } }));
      }).catch(() => {});
    }
    return () => { active = false; };
  }, [client, identity]);
  const labels = resolved?.identity === identity ? resolved.labels : {};
  return candidates.map(chat => ({ ...chat, label: labels[key(chat.hostId, chat.threadId)] ?? chat.label }));
}
