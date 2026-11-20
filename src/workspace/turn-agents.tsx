import { Bot, Check, CircleAlert, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ThreadItemSummary, ThreadSummary } from '../../lib/codex-protocol.ts';
import type { HostMessage } from '../native/protocol.ts';
import { record } from '../native/protocol.ts';
import { listSubagents } from './host.ts';

export const emptySubagents: ReadonlyMap<string, ThreadSummary> = new Map();
export type OpenSubagent = (id: string, name: string) => void;

export function useSubagentDirectory(threadId: string | undefined, hostId: string) {
  const [directory, setDirectory] = useState<{ scope: string; rows: ReadonlyMap<string, ThreadSummary> }>();
  const scope = JSON.stringify([hostId, threadId]);
  useEffect(() => {
    if (!threadId) return;
    let current = true, revision = 0;
    function refresh() {
      const requested = ++revision;
      void listSubagents(threadId!, hostId).then(rows => {
        if (current && requested === revision) setDirectory({ scope, rows });
      }, () => { /* Tasks remain available from their turn while the directory is unavailable. */ });
    }
    function receive(event: MessageEvent<HostMessage>) {
      if (event.source !== window || event.origin !== location.origin || event.data?.hostId !== hostId) return;
      const message = event.data;
      if (message.type !== 'mcp-notification') return;
      const params = record(message.params), item = record(params.item);
      if (message.method === 'item/completed' && params.threadId === threadId &&
        item.type === 'collabAgentToolCall' && (item.tool === 'spawnAgent' || item.tool === 'resumeAgent')) refresh();
      if (message.method === 'thread/status/changed' && typeof params.threadId === 'string') {
        const id = params.threadId, status = params.status as ThreadSummary['status'] | undefined;
        if (!status) return;
        setDirectory(value => {
          const child = value?.scope === scope && value.rows.get(id);
          if (!child || !value || child.status.type === status.type) return value;
          return { scope, rows: new Map(value.rows).set(id, { ...child, status }) };
        });
      }
    }
    refresh();
    window.addEventListener('message', receive);
    return () => { current = false; window.removeEventListener('message', receive); };
  }, [threadId, hostId, scope]);
  return directory?.scope === scope ? directory.rows : emptySubagents;
}

export const subagentTitle = (child?: ThreadSummary) => child?.agentNickname?.trim() || child?.name?.trim() || 'Agent';

export function receivers(item: ThreadItemSummary, parentId: string) {
  return item.senderThreadId === parentId && Array.isArray(item.receiverThreadIds)
    ? item.receiverThreadIds.filter((id): id is string => typeof id === 'string' && !!id && id !== parentId) : [];
}

export function collectTurnAgents(items: readonly ThreadItemSummary[], parentId: string) {
  const rows = new Map<string, string | undefined>();
  for (const item of items) if (item.type === 'collabAgentToolCall') for (const id of receivers(item, parentId)) {
    const state = record(record(item.agentsStates)[id]);
    if (typeof state.status === 'string') rows.set(id, state.status);
    else if (!rows.has(id)) rows.set(id, undefined);
  }
  return rows;
}

export function AgentLink({ id, name, status, open, showStatus = true }: {
  id: string; name: string; status?: string; open?: OpenSubagent; showStatus?: boolean;
}) {
  const active = status === 'running' || status === 'pendingInit';
  const done = status === 'completed';
  const failed = status === 'errored' || status === 'notFound';
  const ended = status === 'interrupted' || status === 'shutdown';
  const label = active ? 'working' : done ? 'finished' : failed ? 'failed' : ended ? 'stopped' : undefined;
  return <div className="yard-source-agent-row" data-agent-thread-id={id}>
    {open ? <button type="button" title={name} onClick={() => open(id, name)}><Bot size={14} aria-hidden="true" /><span dir="auto">{name}</span></button> :
      <span><Bot size={14} aria-hidden="true" />{name}</span>}
    {showStatus && label && <span className="yard-source-agent-status" data-running={active || undefined}>{active ?
      <LoaderCircle size={12} aria-hidden="true" /> : failed ? <CircleAlert size={12} aria-hidden="true" /> :
      done ? <Check size={12} aria-hidden="true" /> : null}{label}</span>}
  </div>;
}
