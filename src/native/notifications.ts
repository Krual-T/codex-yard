import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateRequestDetails, generateVAPIDKeys } from 'web-push';
import type { PushSubscription, VapidKeys } from 'web-push';
import type { CodexConnection } from '../../lib/codex.ts';
import type { RpcMessage, ThreadItemSummary, TurnSummary, Page } from '../../lib/codex-protocol.ts';
import { record } from './protocol.ts';

export type NotificationKind = 'completed' | 'failed' | 'waiting';
export type NotificationPreferences = Record<NotificationKind, boolean>;
export const defaultNotificationPreferences: NotificationPreferences = { completed: true, failed: true, waiting: true };
export interface BrowserNotification {
  id: string; title: string; body: string; url: string; kind: NotificationKind | 'test';
}
interface Device {
  subscription: PushSubscription; preferences: NotificationPreferences;
  lastSuccess: number | null; lastError: string | null;
}
interface Watch {
  hostId: string; threadId: string; turnId: string; waiting?: boolean; waitingTurnId?: string; waitingSequence?: number;
  inputCursor?: { turnId: string; itemId: string };
}
interface State { keys: VapidKeys; devices: Device[]; watches: Watch[]; sent: string[] }
export interface NotificationOptions {
  dataDir: string;
  connectionFor(hostId: string): Promise<CodexConnection>;
  hostIds(): string[];
  subject?: string;
  fetch?: typeof fetch;
  intervalMs?: number;
}

function subscription(value: unknown): PushSubscription {
  const input = record(value), keys = record(input.keys);
  let endpoint: URL;
  try { endpoint = new URL(String(input.endpoint)); } catch { throw new Error('浏览器通知订阅地址无效。'); }
  // Only send encrypted Web Push requests to production browser push services.
  const known = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash || endpoint.port ||
      !(known.includes(endpoint.hostname) || endpoint.hostname.endsWith('.notify.windows.com')) || endpoint.href.length > 4096) {
    throw new Error('不支持此浏览器的推送服务，请使用 Chrome、Edge、Firefox 或 Safari。');
  }
  for (const [key, size] of [['p256dh', 65], ['auth', 16]] as const) {
    if (typeof keys[key] !== 'string' || !/^[A-Za-z0-9_-]+$/.test(keys[key] as string) || Buffer.from(keys[key] as string, 'base64url').length !== size) {
      throw new Error('浏览器通知订阅密钥无效，请重新开启通知。');
    }
  }
  return { endpoint: endpoint.href, keys: { p256dh: keys.p256dh as string, auth: keys.auth as string } };
}
function preferences(value: unknown): NotificationPreferences {
  const input = record(value);
  return Object.fromEntries(Object.keys(defaultNotificationPreferences).map(key => {
    if (typeof input[key] !== 'boolean') throw new Error('通知类型设置无效。');
    return [key, input[key]];
  })) as NotificationPreferences;
}
const keyFor = (hostId: string, threadId: string) => JSON.stringify([hostId, threadId]);
const turnEventId = (hostId: string, threadId: string, turnId: string, kind: string) => JSON.stringify([hostId, threadId, turnId, kind]);
function answeredQuestions(items: ThreadItemSummary[]) {
  const answered = new Set<string>();
  for (const item of items) {
    if (item.type !== 'userMessage' || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      const content = record(part);
      if (content.type !== 'text' || typeof content.text !== 'string') continue;
      const reply = content.text.trim().match(/^<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>$/);
      if (!reply) continue;
      try {
        const values: unknown = JSON.parse(reply[1]);
        if (Array.isArray(values)) for (const value of values) {
          const id = record(value).questionItemId;
          if (typeof id === 'string') answered.add(id);
        }
      } catch { /* Ordinary user text is not a structured question response. */ }
    }
  }
  return answered;
}
export function notificationRoute(hostId: string, threadId: string) {
  return '/?initialRoute=' + encodeURIComponent('/' + encodeURIComponent(hostId) + '/' + encodeURIComponent(threadId));
}

/** Device subscriptions, active-turn observation and push delivery outlive pages. */
export async function createBrowserNotifications(options: NotificationOptions) {
  const path = join(options.dataDir, 'browser-notifications.json');
  let state: State;
  try { state = JSON.parse(await readFile(path, 'utf8')) as State; await chmod(path, 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    state = { keys: generateVAPIDKeys(), devices: [], watches: [], sent: [] };
  }
  let saving = Promise.resolve(), working: Promise<void> | undefined, closed = false;
  const jobs = new Set<Promise<unknown>>();
  const sent = new Set(state.sent);
  const watches = new Map(state.watches.map(watch => [keyFor(watch.hostId, watch.threadId), watch]));
  function save() {
    state.watches = [...watches.values()]; state.sent = [...sent].slice(-512);
    const body = JSON.stringify(state) + '\n';
    saving = saving.catch(() => {}).then(async () => {
      await writeFile(path + '.tmp', body, { mode: 0o600 });
      await rename(path + '.tmp', path);
    });
    return saving;
  }
  await save();
  function background(job: Promise<unknown>) {
    jobs.add(job);
    void job.catch(() => {}).finally(() => jobs.delete(job));
  }
  async function deliver(device: Device, payload: BrowserNotification) {
    try {
      const request = generateRequestDetails(device.subscription, JSON.stringify(payload), {
        vapidDetails: { ...state.keys, subject: options.subject ?? 'https://github.com/Krual-T/codex-yard' },
        TTL: 3600, urgency: payload.kind === 'waiting' ? 'high' : 'normal',
      });
      // Use the same Node fetch/proxy configuration as the rest of Yard.
      const response = await (options.fetch ?? fetch)(request.endpoint, { method: request.method,
        headers: request.headers as Record<string, string>, body: new Uint8Array(request.body!),
        redirect: 'error', signal: AbortSignal.timeout(10000) });
      await response.body?.cancel();
      if (response.status === 404 || response.status === 410) {
        state.devices = state.devices.filter(current => current !== device);
        throw new Error('通知订阅已失效，请在本设备重新开启通知。');
      }
      if (!response.ok) throw new Error(`推送服务返回 ${response.status}，请稍后测试通知。`);
      device.lastSuccess = Date.now(); device.lastError = null;
    } catch (error) {
      device.lastError = error instanceof TypeError || (error as Error).name === 'TimeoutError'
        ? '暂时无法连接浏览器推送服务，请检查网络后测试通知。' : (error as Error).message;
      throw new Error(device.lastError);
    } finally { await save(); }
  }
  async function publish(payload: BrowserNotification) {
    if (closed || sent.has(payload.id)) return;
    sent.add(payload.id);
    while (sent.size > 512) sent.delete(sent.values().next().value!);
    // Claim before network delivery so duplicate daemon events/pages/restarts
    // do not send the same event again. Push delivery is best effort.
    await save();
    await Promise.allSettled(state.devices.filter(device => payload.kind === 'test' || device.preferences[payload.kind])
      .map(device => deliver(device, payload)));
  }
  function watch(hostId: string, threadId: string, turnId: string) {
    if (closed || !state.devices.length || !threadId || !turnId) return;
    const key = keyFor(hostId, threadId);
    if (!watches.has(key)) { watches.set(key, { hostId, threadId, turnId }); background(save()); }
  }
  async function trackThread(hostId: string, threadId: string) {
    if (closed || !state.devices.length || watches.has(keyFor(hostId, threadId))) return;
    const connection = await options.connectionFor(hostId);
    const { thread } = await connection.request('thread/read', { threadId, includeTurns: false });
    if (thread.status.type !== 'active') return;
    const page = await connection.request<Page<TurnSummary>>('thread/turns/list', { threadId, limit: 1, sortDirection: 'desc', itemsView: 'full' });
    const turn = page.data.find(turn => turn.status === 'inProgress');
    if (turn) watch(hostId, threadId, turn.id);
  }
  async function notifyTurn(hostId: string, threadId: string, turn: Pick<TurnSummary, 'id' | 'status'>) {
    if (turn.status !== 'completed' && turn.status !== 'failed') return;
    const kind = turn.status, id = turnEventId(hostId, threadId, turn.id, kind);
    if (sent.has(id)) return;
    let label = '点击打开对应对话。';
    try {
      const connection = await options.connectionFor(hostId);
      const { thread } = await connection.request('thread/read', { threadId, includeTurns: false });
      if (thread.name) label = thread.name.slice(0, 160);
    } catch { /* A completed turn still deserves a notification during a reconnect. */ }
    await publish({ id, kind, title: kind === 'completed' ? 'Yard · 任务已完成' : 'Yard · 任务执行失败',
      body: label, url: notificationRoute(hostId, threadId) });
  }
  function notifyWaiting(hostId: string, threadId: string, turnId: string) {
    watch(hostId, threadId, turnId);
    const watched = watches.get(keyFor(hostId, threadId));
    if (!watched || watched.waiting && watched.waitingTurnId === turnId) return Promise.resolve();
    watched.waiting = true; watched.waitingTurnId = turnId; watched.waitingSequence = (watched.waitingSequence ?? 0) + 1;
    return publish({ id: turnEventId(hostId, threadId, turnId, 'waiting:' + watched.waitingSequence), kind: 'waiting',
      title: 'Yard · 任务需要你处理', body: '打开对话，处理审批或回答问题后继续。', url: notificationRoute(hostId, threadId) });
  }
  function clearWaiting(hostId: string, threadId: string) {
    const watched = watches.get(keyFor(hostId, threadId));
    if (watched?.waiting) { watched.waiting = false; background(save()); }
  }
  function notifyInput(hostId: string, threadId: string, turnId: string, item: ThreadItemSummary, answered?: ReadonlySet<string>) {
    if (item.type !== 'agentMessage' || item.delivery !== 'async' || !Array.isArray(item.questions) || !item.questions.length) return Promise.resolve();
    if (answered && item.questions.every((_, index) => answered.has(JSON.stringify(['request_user_input_async', item.id, index])))) return Promise.resolve();
    watch(hostId, threadId, turnId);
    // Async questions leave the turn running. Each card is a separate reminder,
    // independent of the blocking approval/input episode and its active flags.
    return publish({ id: turnEventId(hostId, threadId, turnId, 'input:' + item.id), kind: 'waiting',
      title: 'Yard · 任务需要你回答', body: '打开对话，查看并回答问题。', url: notificationRoute(hostId, threadId) });
  }
  function observe(hostId: string, message: Pick<RpcMessage, 'method' | 'params' | 'id'>) {
    if (closed || !state.devices.length) return;
    const params = record(message.params), threadId = params.threadId;
    if (typeof threadId !== 'string') return;
    const turn = record(params.turn);
    if (message.method === 'turn/started' && typeof turn.id === 'string') watch(hostId, threadId, turn.id);
    if (message.method === 'turn/completed' && typeof turn.id === 'string') {
      clearWaiting(hostId, threadId);
      background(notifyTurn(hostId, threadId, turn as unknown as TurnSummary));
    }
    if (message.method === 'thread/status/changed') {
      const status = record(params.status);
      if (status.type !== 'active' || Array.isArray(status.activeFlags) && !status.activeFlags.some(flag => /approval|input/i.test(String(flag)))) clearWaiting(hostId, threadId);
    }
    if (message.method === 'item/completed' && typeof params.turnId === 'string') {
      const item = record(params.item);
      if (typeof item.id === 'string') background(notifyInput(hostId, threadId, params.turnId, item as ThreadItemSummary));
    }
    if (message.id != null && /(?:requestApproval|requestUserInput|requestPermissions|elicitation\/request)$/.test(message.method)) {
      const turnId = typeof params.turnId === 'string' ? params.turnId : watches.get(keyFor(hostId, threadId))?.turnId;
      if (turnId) { watch(hostId, threadId, turnId); background(notifyWaiting(hostId, threadId, turnId)); }
    }
  }
  async function discover() {
    if (closed || !state.devices.length) return;
    for (const hostId of options.hostIds()) {
      try {
        const connection = await options.connectionFor(hostId);
        const loaded = await connection.request('thread/loaded/list', {});
        for (const threadId of loaded.data) await trackThread(hostId, threadId);
      } catch { /* A host may be offline; existing watches are retained. */ }
    }
  }
  async function reconcileInputs(watched: Watch, connection: CodexConnection) {
    const { hostId, threadId } = watched;
    const turns = await connection.request<Page<TurnSummary>>('thread/turns/list', { threadId, limit: 1, sortDirection: 'desc', itemsView: 'summary' });
    const turnId = turns.data[0]?.id;
    if (!turnId) return;
    let cursor: string | { type: 'item'; itemId: string } | null = watched.inputCursor?.turnId === turnId
      ? { type: 'item', itemId: watched.inputCursor.itemId } : null;
    const items: ThreadItemSummary[] = [];
    const cursors = new Set<string>();
    do {
      const page: Page<{ item: ThreadItemSummary }> = await connection.request('thread/items/list', {
        threadId, turnId, sortDirection: 'asc', limit: 100, ...(cursor ? { cursor } : {}),
      });
      for (const { item } of page.data) items.push(item);
      cursor = page.nextCursor;
      if (cursor && cursors.has(cursor)) throw new Error('通知观察的消息分页游标未前进。');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    const answered = answeredQuestions(items);
    for (const item of items) await notifyInput(hostId, threadId, turnId, item, answered);
    const lastItemId = items.at(-1)?.id;
    if (lastItemId && watches.get(keyFor(hostId, threadId)) === watched) {
      watched.inputCursor = { turnId, itemId: lastItemId }; await save();
    }
  }
  async function reconcile(watched: Watch) {
    const { hostId, threadId, turnId } = watched;
    const connection = await options.connectionFor(hostId);
    const { thread } = await connection.request('thread/read', { threadId, includeTurns: false });
    if (thread.status.type === 'active') {
      if (thread.status.activeFlags.some(flag => /approval|input/i.test(flag))) await notifyWaiting(hostId, threadId, turnId);
      else clearWaiting(hostId, threadId);
      // A disconnected page receives no item events. Read only new items from
      // the latest turn; queued turns may already have replaced the watched one.
      await reconcileInputs(watched, connection);
      return;
    }
    let cursor: string | null = null, found = false;
    const turns: TurnSummary[] = [], cursors = new Set<string>();
    do {
      const page: Page<TurnSummary> = await connection.request('thread/turns/list', { threadId, limit: 50, sortDirection: 'desc', itemsView: 'full', ...(cursor ? { cursor } : {}) });
      for (const turn of page.data) { turns.push(turn); if (turn.id === turnId) { found = true; break; } }
      cursor = page.nextCursor;
      if (cursor && cursors.has(cursor)) throw new Error('通知观察的会话分页游标未前进。');
      if (cursor) cursors.add(cursor);
    } while (!found && cursor);
    if (!found) return; // Never infer a terminal state from missing history.
    const answered = answeredQuestions(turns.flatMap(turn => turn.items));
    for (const turn of turns.reverse()) {
      for (const item of turn.items) await notifyInput(hostId, threadId, turn.id, item, answered);
      await notifyTurn(hostId, threadId, turn);
    }
    // Queued messages can begin while no browser is connected. Retain their
    // thread until the backend queue is empty, without pinning a subscription.
    const queue = await connection.request<Page<unknown>>('thread/queue/list', { threadId, limit: 1 });
    if (!queue.data.length && watches.get(keyFor(hostId, threadId)) === watched) {
      watches.delete(keyFor(hostId, threadId)); await save();
    }
  }
  function tick() {
    if (closed || !state.devices.length) return Promise.resolve();
    return working ??= (async () => {
      for (const watched of watches.values()) {
        if (closed) break;
        try { await reconcile(watched); } catch { /* Backend restart or SSH outage: retry the read next tick. */ }
      }
    })().finally(() => { working = undefined; });
  }
  const timer = setInterval(() => { background(tick()); }, options.intervalMs ?? 5000); timer.unref();
  return {
    observe, watch, trackThread, tick,
    publish(payload: BrowserNotification) {
      const job = publish(payload); background(job); return job;
    },
    start() { background(tick()); },
    status: () => ({ devices: state.devices.length, watching: watches.size }),
    async request(value: unknown) {
      const input = record(value), operation = input.operation;
      const endpoint = typeof input.endpoint === 'string' ? input.endpoint : '';
      const device = state.devices.find(device => device.subscription.endpoint === endpoint);
      if (operation === 'status') return { publicKey: state.keys.publicKey, subscribed: !!device,
        preferences: device?.preferences ?? defaultNotificationPreferences, lastSuccess: device?.lastSuccess ?? null, lastError: device?.lastError ?? null };
      if (operation === 'subscribe') {
        const next = subscription(input.subscription), prefs = preferences(input.preferences);
        let device = state.devices.find(device => device.subscription.endpoint === next.endpoint);
        if (device) { device.subscription = next; device.preferences = prefs; }
        else {
          if (state.devices.length >= 32) throw new Error('已开启通知的浏览器过多，请先关闭不用的设备通知。');
          device = { subscription: next, preferences: prefs, lastSuccess: null, lastError: null }; state.devices.push(device);
        }
        await save(); background(discover()); return { subscribed: true, preferences: prefs };
      }
      if (operation === 'unsubscribe') {
        state.devices = state.devices.filter(current => current !== device);
        if (!state.devices.length) watches.clear();
        await save(); return { subscribed: false };
      }
      if (operation === 'test') {
        if (!device) throw new Error('请先开启本设备通知。');
        await deliver(device, { id: 'test-' + Date.now(), kind: 'test', title: 'Yard · 测试通知', body: '本设备已开启任务通知。', url: '/' });
        return { accepted: true };
      }
      throw new Error('不支持的浏览器通知操作。');
    },
    async close() { closed = true; clearInterval(timer); await working; await Promise.allSettled([...jobs]); await saving; },
  };
}
