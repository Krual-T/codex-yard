import { useEffect, useMemo, useRef, useState } from 'react';
import type { ThreadSummary } from '../../../lib/codex-protocol.ts';
import type { WorkbenchClient } from '../workbench-contract.ts';
import type { ThreadSummaryOutput } from './ThreadSummaryPanel.tsx';

function absolutePath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.includes('\0')
    && !value.split('/').some(part => part === '.' || part === '..');
}

/** The original projectless summary includes generated images, not arbitrary file changes. */
export function projectGeneratedImageOutputs(thread: ThreadSummary | null, hostId: string): ThreadSummaryOutput[] {
  if (!thread || !absolutePath(thread.cwd)) return [];
  const cwd = thread.cwd.replace(/\/+$/, '') || '/';
  const internal = ['work', '.codex_scratch'].map(part => cwd === '/' ? '/' + part : cwd + '/' + part);
  const entries = new Map<string, ThreadSummaryOutput>();
  for (const turn of [...(thread.turns ?? [])].reverse()) {
    for (const item of [...(turn.items ?? [])].reverse()) {
      const path = item.savedPath;
      if (item.type !== 'imageGeneration' || item.status !== 'completed' || item.failure != null || !absolutePath(path)
        || internal.some(root => path === root || path.startsWith(root + '/')) || entries.has(path)) continue;
      entries.set(path, { id: `generated-image:${path}`, kind: 'file', path,
        label: path.split('/').filter(Boolean).at(-1) ?? path,
        source: { hostId, threadId: thread.id, cwd: thread.cwd, turnId: turn.id, itemId: item.id } });
    }
  }
  return [...entries.values()];
}

/** Check the same host's real paths; a late response never crosses thread or input changes. */
export function useProjectlessGeneratedImages(client: WorkbenchClient, hostId: string, thread: ThreadSummary | null, enabled: boolean) {
  const candidates = useMemo(() => enabled ? projectGeneratedImageOutputs(thread, hostId) : [], [enabled, hostId, thread]);
  const [connectionRevision, setConnectionRevision] = useState(0);
  const connectionEpoch = useRef(0);
  const identity = JSON.stringify([hostId, thread?.id, thread?.cwd, candidates, connectionRevision]);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ identity: string; entries: ThreadSummaryOutput[]; error: string | null } | null>(null);
  useEffect(() => client.subscribe(event => {
    if (event.type === 'connection-state' || event.type === 'codex-app-server-connection-changed' && event.hostId === hostId) {
      ++connectionEpoch.current; setConnectionRevision(value => value + 1);
    }
  }), [client, hostId]);
  useEffect(() => {
    let active = true;
    const epoch = connectionEpoch.current;
    if (candidates.length) {
      void client.host<{ existingPaths: unknown }>('paths-exist', { hostId, paths: candidates.map(entry => entry.kind === 'file' ? entry.path : '') })
        .then(response => {
          if (!Array.isArray(response?.existingPaths) || !response.existingPaths.every(path => typeof path === 'string')) {
            throw new Error('Invalid paths-exist response');
          }
          const existing = new Set(response.existingPaths);
          if (active && connectionEpoch.current === epoch) setResult({ identity, entries: candidates.filter(entry => entry.kind === 'file' && existing.has(entry.path)), error: null });
        })
        .catch(error => { if (active && connectionEpoch.current === epoch) setResult({ identity, entries: [], error: error instanceof Error ? error.message : String(error) }); });
    }
    return () => { active = false; };
  }, [client, hostId, identity, retry]);
  const current = result?.identity === identity ? result : null;
  return { entries: current?.entries ?? [], loading: candidates.length > 0 && current === null, error: current?.error ?? null,
    retry: () => { setResult(null); setRetry(value => value + 1); } };
}
