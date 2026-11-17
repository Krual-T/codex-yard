import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import type { CodexConnection } from '../../lib/codex.ts';
import { errorMessage, isRecord } from '../../lib/codex-protocol.ts';
import type { Page, TurnSummary } from '../../lib/codex-protocol.ts';
import type { NativeAppToolsOptions, NativeProject } from '../../lib/native-app-tools.ts';
import { validateModel } from '../../vendor/native-app-tools/26.1013.40934/portable-tools.mjs';
import type { AvailableModel } from '../../vendor/native-app-tools/26.1013.40934/portable-tools.mjs';
import { nextOccurrence } from './automation-recurrence.ts';
import type { Recurrence } from './automation-recurrence.ts';
import { record } from './protocol.ts';

export interface Automation extends Recurrence {
  id: string; kind: 'cron'; name: string; prompt: string; status: 'ACTIVE' | 'PAUSED' | 'DELETED';
  target: { type: 'project'; projectId: string } | { type: 'projectless' };
  hostId: string; cwds: string[]; executionEnvironment: 'local'; localEnvironmentConfigPath: null;
  pluginTemplateId: string | null; autoArchive: false; notificationPolicy: 'failed_runs_only' | null;
  model: string | null; reasoningEffort: string | null;
  createdAt: number; updatedAt: number; nextRunAt: number | null; lastRunAt: number | null;
}
export interface AutomationRun {
  id: string; automationId: string; automationName: string; hostId: string;
  scheduledAt: number | null; status: 'starting' | 'running' | 'waiting' | 'uncertain' | 'completed' | 'failed' | 'released';
  threadId: string | null; turnId: string | null; sourceCwd: string | null;
  createdAt: number; updatedAt: number; readAt: number | null; archived: boolean;
  error: string | null; summary: string | null;
}
interface Options extends Pick<NativeAppToolsOptions, 'connectionFor' | 'listProjects' | 'configFor' | 'setMembership' | 'projectlessRoot'> {
  dataDir: string;
  changed(): void;
  runChanged?(run: AutomationRun): void;
  now?: () => number;
  intervalMs?: number;
}
const active = new Set<AutomationRun['status']>(['starting', 'running', 'waiting', 'uncertain']);
const text = (value: unknown, name: string, limit = 10000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error(`无效的${name}。`);
  return value.trim();
};
const optionalText = (value: unknown, name: string) => value == null || value === '' ? null : text(value, name, 200);

/** Yard owns these tasks. Neither the desktop installation nor its task DB is read. */
export function createAutomations(options: Options) {
  const owner = new DatabaseSync(join(options.dataDir, 'automation-owner.sqlite'));
  try { owner.exec('BEGIN EXCLUSIVE'); }
  catch (cause) { owner.close(); throw new Error('此数据目录已有 Yard 定时任务服务在运行。', { cause }); }
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(join(options.dataDir, 'automations.sqlite'));
    db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS automations (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS automation_runs (
        id TEXT PRIMARY KEY, automation_id TEXT NOT NULL, scheduled_at INTEGER,
        status TEXT NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS automation_occurrence ON automation_runs(automation_id, scheduled_at) WHERE scheduled_at IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS automation_in_flight ON automation_runs(automation_id)
        WHERE status IN ('starting','running','waiting','uncertain');
      CREATE INDEX IF NOT EXISTS automation_history ON automation_runs(created_at DESC, id);`);
  } catch (error) { owner.close(); throw error; }
  const now = options.now ?? Date.now;
  let closing = false, started = false, timer: ReturnType<typeof setInterval> | undefined;
  let checking: Promise<void> | undefined;
  const dispatching = new Map<string, Promise<void>>();
  const preparing = new Set<string>();
  let diagnostic: string | null = null;
  const decode = <T>(row: unknown): T => JSON.parse(String(record(row).data)) as T;
  const list = () => db.prepare('SELECT data FROM automations').all().map(decode<Automation>);
  const runs = () => db.prepare("SELECT data FROM automation_runs WHERE status IN ('starting','running','waiting','uncertain')").all().map(decode<AutomationRun>);
  const task = (id: unknown) => {
    const row = db.prepare('SELECT data FROM automations WHERE id=?').get(text(id, '任务 ID', 200));
    if (!row) throw new Error('定时任务不存在。');
    return decode<Automation>(row);
  };
  function putTask(item: Automation) {
    db.prepare('INSERT INTO automations VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(item.id, JSON.stringify(item));
  }
  function putRun(run: AutomationRun) {
    run.updatedAt = now();
    db.prepare(`INSERT INTO automation_runs VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      status=excluded.status, data=excluded.data`).run(run.id, run.automationId, run.scheduledAt, run.status, run.createdAt, JSON.stringify(run));
  }
  function changeRun(run: AutomationRun, patch: Partial<AutomationRun>) {
    const current = decode<AutomationRun>(db.prepare('SELECT data FROM automation_runs WHERE id=?').get(run.id));
    // A read can overlap archive/read-state changes or an explicit release.
    // Merge execution fields into the latest row; terminal records stay terminal.
    if (!active.has(current.status)) { Object.assign(run, current); return; }
    Object.assign(run, current, patch); putRun(run); options.changed(); options.runChanged?.(run);
  }
  function assertOpen() { if (closing) throw new Error('Yard 服务正在关闭。'); }
  async function save(value: unknown, update = false) {
    assertOpen();
    const p = record(value), old = update ? task(p.id) : undefined;
    if (old?.status === 'DELETED') throw new Error('该任务已删除。');
    if (p.kind != null && p.kind !== 'cron') throw new Error('Yard 定时任务当前支持每次新建会话，请使用独立任务。');
    if (p.executionEnvironment != null && p.executionEnvironment !== 'local') throw new Error('定时任务暂不支持自动创建工作树。');
    if (p.autoArchive === true || p.localEnvironmentConfigPath != null) throw new Error('定时任务暂不支持自动归档或环境初始化脚本。');
    if (p.notificationPolicy != null && p.notificationPolicy !== 'failed_runs_only') throw new Error('无效的通知策略。');
    const status = p.status ?? old?.status ?? 'ACTIVE';
    if (status !== 'ACTIVE' && status !== 'PAUSED') throw new Error('无效的任务状态。');
    const projectId = p.projectId === undefined ? old?.target.type === 'project' ? old.target.projectId : null : p.projectId;
    const project = projectId == null ? null : (await options.listProjects()).find(p => p.projectId === projectId);
    if (projectId != null && !project) throw new Error('项目不存在，请重新选择项目。');
    const effort = optionalText(p.reasoningEffort, '推理强度');
    if (effort && !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(effort)) throw new Error('无效的推理强度。');
    const rrule = text(p.rrule, '定时规则', 4096);
    const timeZone = p.timeZone == null ? old?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone : text(p.timeZone, '时区', 128);
    new Intl.DateTimeFormat('en', { timeZone }).format();
    const changedSchedule = !old || old.rrule !== rrule || old.timeZone !== timeZone || old.status === 'PAUSED' && status === 'ACTIVE';
    const at = now(), anchor = changedSchedule ? at : old.anchor;
    const next = changedSchedule ? await nextOccurrence({ rrule, timeZone, anchor }, at) : old.nextRunAt;
    if (changedSchedule && next === null && status === 'ACTIVE') throw new Error('该定时规则没有未来的执行时间。');
    assertOpen();
    if (old && task(old.id).updatedAt !== old.updatedAt) throw new Error('任务已被其他操作修改，请刷新后重试。');
    const item: Automation = {
      id: old?.id ?? randomUUID(), kind: 'cron', name: typeof p.name === 'string' && p.name.trim() ? text(p.name, '名称', 200) : '定时任务',
      prompt: text(p.prompt, '提示词', 100000), status, rrule, timeZone, anchor,
      target: project ? { type: 'project', projectId: project.projectId } : { type: 'projectless' },
      hostId: project?.hostId ?? 'local', cwds: project ? [project.path] : [], executionEnvironment: 'local',
      localEnvironmentConfigPath: null, pluginTemplateId: optionalText(p.pluginTemplateId, '模板 ID'), autoArchive: false,
      notificationPolicy: p.notificationPolicy === 'failed_runs_only' ? p.notificationPolicy : null,
      model: optionalText(p.model, '模型'), reasoningEffort: effort,
      createdAt: old?.createdAt ?? at, updatedAt: Math.max(at, (old?.updatedAt ?? 0) + 1), nextRunAt: status === 'PAUSED' ? null : next,
      lastRunAt: old?.lastRunAt ?? null,
    };
    putTask(item); options.changed(); return { item };
  }
  async function checkModel(connection: CodexConnection, item: Automation) {
    if (!item.model) return;
    const all: AvailableModel[] = [], cursors = new Set<string>();
    let cursor: string | null = null;
    do {
      const page: Page<AvailableModel> = await connection.request<Page<AvailableModel>>('model/list', { limit: 100, ...(cursor ? { cursor } : {}) });
      all.push(...page.data); cursor = page.nextCursor;
      if (cursor && cursors.has(cursor)) throw new Error('模型列表游标未前进。');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    const error = validateModel(item.model, item.reasoningEffort ?? undefined, all);
    if (error) throw new Error(error);
  }
  async function dispatch(item: Automation, run: AutomationRun, connection: CodexConnection, project: NativeProject | null) {
    try {
      await checkModel(connection, item);
      let cwd = project?.path;
      if (!cwd) { await mkdir(options.projectlessRoot, { recursive: true }); cwd = await mkdtemp(join(options.projectlessRoot, 'scheduled-')); }
      changeRun(run, { sourceCwd: cwd });
      const { thread } = await connection.request('thread/start', { cwd, historyMode: 'paginated',
        config: { ...options.configFor(item.hostId), ...(item.reasoningEffort ? { model_reasoning_effort: item.reasoningEffort } : {}) },
        ...(item.model ? { model: item.model } : {}),
      }, { mutating: true });
      changeRun(run, { threadId: thread.id });
      await options.setMembership(thread.id, item.hostId, project, cwd);
      await connection.request('thread/name/set', { threadId: thread.id, name: item.name }, { mutating: true });
      const { turn } = await connection.request('turn/start', {
        threadId: thread.id, clientUserMessageId: run.id, input: [{ type: 'text', text: item.prompt, text_elements: [] }],
        ...(item.model ? { model: item.model } : {}), ...(item.reasoningEffort ? { effort: item.reasoningEffort } : {}),
      }, { mutating: true });
      applyTurn(run, turn);
    } catch (error) {
      changeRun(run, { status: isRecord(error) && error.uncertain === true ? 'uncertain' : 'failed', error: errorMessage(error) });
    }
  }
  function applyTurn(run: AutomationRun, turn: TurnSummary, waiting = false) {
    const summary = turn.items.filter(item => item.type === 'agentMessage' && typeof item.text === 'string').map(item => item.text).join('\n').slice(0, 1000);
    changeRun(run, { turnId: turn.id, status: turn.status === 'inProgress' ? waiting ? 'waiting' : 'running' : turn.status === 'completed' ? 'completed' : 'failed',
      error: turn.error?.message ?? (turn.status === 'interrupted' ? '本次执行已中断。' : null), summary: summary || null });
  }
  async function launch(id: string, manual: boolean) {
    assertOpen();
    if (preparing.has(id)) throw new Error('该任务正在启动。');
    preparing.add(id);
    try {
      let item = task(id);
      if (item.status === 'DELETED' || !manual && item.status !== 'ACTIVE') return null;
      if (runs().some(run => run.automationId === id)) throw new Error('该任务还有运行中或结果待核实的记录，请先查看已有会话。');
      if (runs().length >= 3) throw new Error('已有三个定时任务在执行，请稍后重试。');
      const connection = await options.connectionFor(item.hostId);
      const project = item.target.type === 'project' ? (await options.listProjects()).find(p => item.target.type === 'project' && p.projectId === item.target.projectId && p.hostId === item.hostId) : null;
      const next = manual ? item.nextRunAt : await nextOccurrence(item, now());
      assertOpen();
      // Editing/pausing while the remote connection or rule calculation is pending wins.
      if (task(id).updatedAt !== item.updatedAt) return null;
      if (!manual && (item.nextRunAt === null || item.nextRunAt > now())) return null;
      if (runs().length >= 3) throw new Error('已有三个定时任务在执行，请稍后重试。');
      const run: AutomationRun = { id: randomUUID(), automationId: id, automationName: item.name, hostId: item.hostId,
        scheduledAt: manual ? null : item.nextRunAt, status: 'starting', threadId: null, turnId: null, sourceCwd: project?.path ?? null,
        createdAt: now(), updatedAt: now(), readAt: null, archived: false, error: null, summary: null };
      db.exec('BEGIN IMMEDIATE');
      try {
        putRun(run); item = { ...item, lastRunAt: now(), nextRunAt: next, updatedAt: Math.max(now(), item.updatedAt + 1) }; putTask(item); db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      options.changed();
      if (item.target.type === 'project' && !project) {
        changeRun(run, { status: 'failed', error: '项目已移除，未启动会话。' }); return run;
      }
      const pending = dispatch(item, run, connection, project ?? null).catch(error => { diagnostic = errorMessage(error); }).finally(() => dispatching.delete(id));
      dispatching.set(id, pending);
      return run;
    } finally { preparing.delete(id); }
  }
  async function reconcile(run: AutomationRun) {
    if (dispatching.has(run.automationId)) return;
    if (!run.threadId) {
      if (run.status !== 'uncertain') changeRun(run, { status: 'uncertain', error: '启动时服务中断，无法确认是否已创建会话；请核查后解除。' });
      return;
    }
    const connection = await options.connectionFor(run.hostId);
    const { thread } = await connection.request('thread/read', { threadId: run.threadId, includeTurns: false });
    // The current paginated backend leaves thread.turns empty, even with includeTurns.
    let turn: TurnSummary | undefined, cursor: string | null = null;
    const cursors = new Set<string>();
    do {
      const turns: Page<TurnSummary> = await connection.request('thread/turns/list', { threadId: run.threadId, limit: 100,
        sortDirection: 'asc', itemsView: 'full', ...(cursor ? { cursor } : {}) });
      turn = run.turnId ? turns.data.find(t => t.id === run.turnId) : turns.data.find(t => t.items.some(i => i.type === 'userMessage' && i.clientId === run.id));
      cursor = turns.nextCursor;
      if (cursor && cursors.has(cursor)) throw new Error('会话分页游标未前进。');
      if (cursor) cursors.add(cursor);
    } while (!turn && cursor);
    if (!turn || turn.status === 'inProgress' && thread.status.type !== 'active') {
      changeRun(run, { status: 'uncertain', error: '无法确认本轮执行状态，请打开会话核查；Yard 不会重复发送。' }); return;
    }
    applyTurn(run, turn, thread.status.type === 'active' && thread.status.activeFlags.some(flag => /approval|input/i.test(flag)));
  }
  async function check() {
    diagnostic = null;
    for (const run of runs()) {
      if (closing) return;
      try { await reconcile(run); } catch (error) { diagnostic = errorMessage(error); }
    }
    for (const item of list().filter(item => item.status === 'ACTIVE' && item.nextRunAt !== null && item.nextRunAt <= now()).sort((a, b) => a.nextRunAt! - b.nextRunAt!)) {
      if (closing || runs().length >= 3) break;
      if (runs().some(run => run.automationId === item.id)) continue;
      try { await launch(item.id, false); } catch (error) { diagnostic = errorMessage(error); }
    }
  }
  function tick() {
    if (closing) return Promise.resolve();
    return checking ??= check().catch(error => { diagnostic = errorMessage(error); }).finally(() => { checking = undefined; });
  }
  function history(limit = 100, offset = 0) {
    return db.prepare('SELECT data FROM automation_runs ORDER BY created_at DESC, id LIMIT ? OFFSET ?').all(limit, offset).map(decode<AutomationRun>);
  }
  function inbox(params: Record<string, unknown>) {
    const limit = Math.min(200, Math.max(1, Number(params.limit) || 100));
    const items = history(limit).filter(run => !params.threadId || run.threadId === params.threadId).map(run => ({
      id: run.id, automationId: run.automationId, automationName: run.automationName, threadId: run.threadId,
      threadTitle: run.automationName, sourceCwd: run.sourceCwd, createdAt: run.createdAt, updatedAt: run.updatedAt,
      readAt: run.readAt, status: run.archived ? 'ARCHIVED' : active.has(run.status) && run.status !== 'uncertain' ? 'IN_PROGRESS' : 'PENDING_REVIEW',
      title: run.status === 'released' ? '结果未知，已解除' : run.status === 'uncertain' ? '执行结果待核实' : run.status === 'failed' ? '执行失败' : run.automationName,
      description: run.status === 'released' ? '结果未知，已解除调度阻塞。\n' + (run.error ?? '') : run.error ?? run.summary,
      archivedAssistantMessage: null, archivedUserMessage: null, archivedReason: null, hostId: run.hostId, runStatus: run.status,
    }));
    const unread = db.prepare("SELECT data FROM automation_runs WHERE status IN ('completed','failed','uncertain')").all().map(decode<AutomationRun>).filter(run => run.readAt === null && !run.archived && run.threadId);
    return { items, unreadRunCounts: { total: unread.length, automationIds: [...new Set(unread.map(run => run.automationId))],
      unreadRuns: unread.map(run => ({ threadId: run.threadId, automationId: run.automationId })) } };
  }
  async function fetch(endpoint: string, input: Record<string, unknown>) {
    assertOpen();
    const p = isRecord(input.params) ? input.params : input;
    switch (endpoint) {
      case 'list-automations': return { items: list().filter(item => item.status !== 'DELETED') };
      case 'automation-create': return save(p);
      case 'automation-update': return save(p, true);
      case 'automation-delete': {
        const item = task(p.id); item.status = 'DELETED'; item.nextRunAt = null; item.updatedAt = Math.max(now(), item.updatedAt + 1);
        putTask(item); options.changed(); return { success: true, item };
      }
      case 'automation-run-now': { const run = await launch(text(p.id, '任务 ID', 200), true); return { success: !!run, run }; }
      case 'inbox-items': return inbox(p);
      case 'inbox-item-set-read-state':
      case 'inbox-automation-runs-mark-all-read':
      case 'automation-run-archive': {
        for (const row of db.prepare('SELECT data FROM automation_runs').all()) {
          const run = decode<AutomationRun>(row);
          if (endpoint !== 'inbox-automation-runs-mark-all-read' && p.threadId !== run.threadId && p.id !== run.id) continue;
          if (endpoint === 'automation-run-archive') run.archived = true;
          else run.readAt = p.isRead === false ? null : now();
          putRun(run);
        }
        options.changed(); return { success: true };
      }
      case 'automation-runs': return { items: history(Math.min(200, Math.max(1, Number(p.limit) || 100)), Math.max(0, Number(p.offset) || 0)), diagnostic };
      case 'automation-run-resolve': {
        const row = db.prepare('SELECT data FROM automation_runs WHERE id=?').get(text(p.id, '运行 ID', 200));
        if (!row) throw new Error('运行记录不存在。');
        const run = decode<AutomationRun>(row);
        if (run.status !== 'uncertain' || p.confirmed !== true) throw new Error('请先核查结果待确认的会话。');
        if (run.threadId) {
          const connection = await options.connectionFor(run.hostId);
          const { thread } = await connection.request('thread/read', { threadId: run.threadId, includeTurns: false });
          if (thread.status.type === 'active') throw new Error('会话仍在执行，请先在会话中处理。');
        }
        const current = decode<AutomationRun>(db.prepare('SELECT data FROM automation_runs WHERE id=?').get(run.id));
        if (current.status !== 'uncertain') throw new Error('运行状态已变化，请刷新后核查。');
        changeRun(current, { status: 'released' }); return { success: true };
      }
      default: throw new Error('不支持的定时任务操作：' + endpoint);
    }
  }
  return {
    fetch, tick,
    threadArchived(hostId: string, threadId: string, archived: boolean) {
      for (const row of db.prepare('SELECT data FROM automation_runs').all()) {
        const run = decode<AutomationRun>(row);
        if (run.hostId === hostId && run.threadId === threadId) putRun({ ...run, archived });
      }
      options.changed();
    },
    status: () => ({ running: started && !closing, inFlight: runs().length, diagnostic }),
    start() { if (started || closing) return; started = true; void tick(); timer = setInterval(() => { void tick(); }, options.intervalMs ?? 30000); timer.unref(); },
    async close() {
      if (closing) return; closing = true; clearInterval(timer);
      await checking; await Promise.allSettled([...dispatching.values()]);
      db.close(); owner.close();
    },
  };
}

export const automationEndpoints = new Set(['list-automations', 'automation-create', 'automation-update', 'automation-delete',
  'automation-run-now', 'inbox-items', 'inbox-item-set-read-state', 'inbox-automation-runs-mark-all-read', 'automation-run-archive',
  'automation-runs', 'automation-run-resolve']);
