import { useEffect, useRef, useState } from 'react';
import type { ThreadSettingsResponse, ThreadSummary } from '../../../lib/codex-protocol.ts';
import type { WorkbenchClient, WorkbenchEvent } from '../workbench-contract.ts';
import { eventItemKey, loadThread, reconcileThreadSnapshot } from '../app/load-thread.ts';
import { applyThreadEvent, isItemDelta } from '../app/thread-state.ts';
import type { SideChatController } from './controller.ts';

interface Projection { key: string; thread: ThreadSummary | null; loading: boolean; complete: boolean; error: string | null; streamGap: boolean; expired: boolean }
const keyFor = (hostId: string, threadId: string) => JSON.stringify([hostId, threadId]);

export type RestoreSideChatSubscription = (scope: {
  hostId: string; parentThreadId: string; childThreadId: string;
}) => Promise<{ status: 'restored' } | { status: 'expired'; message?: string }>;

export function useSideThread(client: WorkbenchClient, controller: SideChatController, initial: ThreadSummary | null,
  restoreSubscription?: RestoreSideChatSubscription) {
  const hostId = controller.getSnapshot().parent.hostId, threadId = initial?.id ?? '';
  const key = keyFor(hostId, threadId);
  const restoreRef = useRef(restoreSubscription);
  restoreRef.current = restoreSubscription;
  const [retry, setRetry] = useState(0);
  const consumedRetry = useRef(0);
  const [projection, setProjection] = useState<Projection>({ key: '', thread: null, loading: false, complete: false, error: null, streamGap: false, expired: false });
  useEffect(() => {
    if (!initial || !threadId) return;
    const explicitlyRetried = retry !== consumedRetry.current;
    consumedRetry.current = retry;
    let active = true, reading = false, hydrated = false, historyGeneration = 0, needsRead = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observed = new Set<string>();
    const buffered: WorkbenchEvent[] = [];
    setProjection(previous => previous.key === key
      ? { ...previous, loading: true, error: null, expired: false }
      : { key, thread: initial, loading: true, complete: false, error: null, streamGap: false, expired: false });
    const scheduleRead = () => {
      needsRead = true;
      if (!reading && !timer) timer = setTimeout(() => { timer = undefined; void read(); }, 150);
    };
    const read = async () => {
      if (!active || reading) return;
      const generation = historyGeneration;
      reading = true; needsRead = false;
      try {
        if (controller.getSnapshot().subscriptionLost) {
          if (!explicitlyRetried) throw new Error('侧聊订阅已失效，原会话和草稿已保留。请恢复订阅后重试。');
          if (!restoreRef.current) throw new Error('宿主尚未接入侧聊订阅恢复，原会话和草稿已保留。');
          const result = await restoreRef.current({ hostId, parentThreadId: controller.getSnapshot().parent.threadId, childThreadId: threadId });
          if (!active || generation !== historyGeneration) return;
          if (result?.status === 'expired') {
            setProjection(previous => previous.key === key ? { ...previous, loading: false, complete: false, expired: true,
              error: result.message || '临时侧聊已过期，原草稿仍被保留。' } : previous);
            return;
          }
          if (result?.status !== 'restored') throw new Error('宿主未确认原侧聊订阅已恢复。');
          controller.markSubscriptionRestored();
        }
        const snapshot = await loadThread(client, hostId, threadId);
        if (!active || generation !== historyGeneration) return;
        if (snapshot.thread.id !== threadId) throw new Error('宿主返回了其他会话的历史。');
        const events = buffered.splice(0), owned = new Set(observed);
        setProjection(previous => previous.key !== key ? previous : {
          ...previous, thread: reconcileThreadSnapshot(snapshot, previous.thread, events, owned), loading: false, complete: true, error: null,
          streamGap: snapshot.thread.turns.some(turn => turn.status === 'inProgress'
            && ![...owned].some(item => item.startsWith(JSON.stringify([turn.id]).slice(0, -1) + ','))),
        });
        hydrated = true;
      } catch (error) {
        if (!active || generation !== historyGeneration) return;
        const events = buffered.splice(0);
        setProjection(previous => previous.key !== key ? previous : { ...previous,
          thread: previous.thread ? events.reduce(applyThreadEvent, previous.thread) : previous.thread,
          loading: false, complete: false, error: error instanceof Error ? error.message : String(error) });
        hydrated = true;
      } finally { reading = false; if (active && needsRead) scheduleRead(); }
    };
    const unsubscribe = client.subscribe(event => {
      if (!active) return;
      if (event.type === 'page-resumed' || event.type === 'connection-state' && event.state === 'disconnected'
        || event.type === 'codex-app-server-connection-changed' && event.hostId === hostId && event.state === 'disconnected') {
        controller.markSubscriptionLost();
        historyGeneration++; buffered.length = 0; observed.clear(); hydrated = false; needsRead = false;
        clearTimeout(timer); timer = undefined;
        setProjection(previous => previous.key === key ? { ...previous, complete: false, loading: false, streamGap: true,
          expired: false, error: '侧聊连接已中断，原会话和草稿已保留。请恢复订阅后重试。' } : previous);
        return;
      }
      if (controller.getSnapshot().subscriptionLost || event.type !== 'mcp-notification' || event.hostId !== hostId
        || (event.params as { threadId?: string } | undefined)?.threadId !== threadId) return;
      const itemKey = eventItemKey(event);
      if (event.method === 'thread/settings/updated') {
        const settings = (event.params as { threadSettings?: ThreadSettingsResponse & { effort?: string | null; sandboxPolicy?: ThreadSettingsResponse['sandbox'] } }).threadSettings;
        if (settings) controller.updateSettings({ ...settings,
          ...(settings.effort !== undefined ? { reasoningEffort: settings.effort } : {}),
          ...(settings.sandboxPolicy !== undefined ? { sandbox: settings.sandboxPolicy } : {}) });
      }
      if (event.method === 'item/started' && itemKey) observed.add(itemKey);
      if (event.method === 'turn/started') controller.markActivity();
      if (event.method === 'thread/reverted') {
        historyGeneration++; buffered.length = 0; observed.clear(); hydrated = false;
        setProjection(previous => previous.key === key ? { ...previous, complete: false, loading: true,
          thread: previous.thread ? { ...previous.thread, turns: [], status: { type: 'idle' } } : null } : previous);
        scheduleRead(); return;
      }
      if (reading || !hydrated) buffered.push(event);
      else setProjection(previous => previous.key === key && previous.thread
        ? { ...previous, thread: applyThreadEvent(previous.thread, event),
          complete: event.method === 'turn/started' || event.method === 'turn/completed' ? false : previous.complete,
          streamGap: event.method === 'item/started' ? false : isItemDelta(event) && !observed.has(itemKey ?? '') ? true : previous.streamGap }
        : previous);
      if (event.method === 'turn/completed') scheduleRead();
    });
    void read();
    return () => { active = false; clearTimeout(timer); unsubscribe(); };
  }, [client, controller, hostId, threadId, key, retry]);
  return { ...(projection.key === key ? projection : { key, thread: initial, loading: !!initial, complete: false, error: null, streamGap: false, expired: false }),
    canSubmit: () => !controller.getSnapshot().subscriptionLost, retry: () => setRetry(value => value + 1) };
}
