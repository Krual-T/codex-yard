import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import type { CodexConnection } from '../../lib/codex.ts';
import { errorMessage, isRecord } from '../../lib/codex-protocol.ts';
import type { Page, RpcMessage, ThreadResponse, TurnSummary } from '../../lib/codex-protocol.ts';
import type { NativeAppToolsOptions, NativeProject } from '../../lib/native-app-tools.ts';
import { validateModel } from '../../vendor/native-app-tools/26.1013.40934/portable-tools.mjs';
import type { AvailableModel } from '../../vendor/native-app-tools/26.1013.40934/portable-tools.mjs';
import { nextOccurrence } from './automation-recurrence.ts';
import type { Recurrence } from './automation-recurrence.ts';
import { archivedAutomationThreads, automationThreadMissing, automationTurnIsRead, automationTurnResult, readAutomationThread } from './automation-projection.ts';
import type { AutomationThread } from './automation-projection.ts';
import { record } from './protocol.ts';
import { modelSelection } from './model-selection.ts';
import type { ProviderRouting } from './provider-routing.ts';
import type { ObjectValue } from './protocol.ts';

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
type RunHistory = Pick<AutomationRun, 'status' | 'error' | 'summary' | 'readAt' | 'archived'>;
interface StoredRun extends Omit<AutomationRun, keyof RunHistory> {
  // This is the scheduler's claim, not a second copy of the backend turn status.
  phase: 'starting' | 'tracking' | 'uncertain' | 'settled' | 'failed' | 'released';
  failure?: string | null;
  // Terminal evidence survives deletion/offline operation. Existing threads are always read live.
  history?: RunHistory;
  deleted?: boolean;
  localInbox?: { readAt: number | null; archived: boolean };
  migration?: { readAt: number | null; archived: boolean; error?: string };
  // A receipt addresses the whole thread. Reviewing an earlier result must not
  // clear newer unread messages; only that independent per-turn intent stays here.
  turnRead?: boolean;
}
interface Options extends Pick<NativeAppToolsOptions, 'connectionFor' | 'listProjects' | 'projectIdForStart' | 'configFor' | 'setMembership' | 'projectlessRoot'> {
  dataDir: string;
  changed(): void;
  runChanged?(run: AutomationRun): void;
  resolveProjectId?(hostId: string, projectId: string): Promise<string | undefined>;
  request?: ProviderRouting['request'];
  now?: () => number;
  intervalMs?: number;
}
const active = new Set<AutomationRun['status']>(['starting', 'running', 'waiting', 'uncertain']);
const claimed = new Set<StoredRun['phase']>(['starting', 'tracking', 'uncertain']);
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
  const requests = new Set<Promise<unknown>>();
  const preparing = new Set<string>();
  const projections = new Map<string, AutomationRun>();
  const archiveCache = new Map<string, { ids: Set<string>; cwds: string[]; expires: number }>();
  const archiveEvents = new Map<string, { sequence: number; archived: boolean }>();
  const receiptEpoch = new Map<string, number>();
  let archiveSequence = 0;
  let diagnostic: string | null = null;
  const decode = <T>(row: unknown): T => JSON.parse(String(record(row).data)) as T;
  const list = () => db.prepare('SELECT data FROM automations').all().map(decode<Automation>);
  const runs = () => db.prepare("SELECT data FROM automation_runs WHERE status IN ('starting','running','waiting','uncertain')").all().map(decode<StoredRun>);
  const stored = (id: string) => decode<StoredRun>(db.prepare('SELECT data FROM automation_runs WHERE id=?').get(id));
  const task = (id: unknown) => {
    const row = db.prepare('SELECT data FROM automations WHERE id=?').get(text(id, '任务 ID', 200));
    if (!row) throw new Error('定时任务不存在。');
    return decode<Automation>(row);
  };
  function putTask(item: Automation) {
    db.prepare('INSERT INTO automations VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(item.id, JSON.stringify(item));
  }
  function putRun(run: StoredRun) {
    run.updatedAt = now();
    // Keep the claim column compatible with the previous scheduler's unique
    // index. A rollback still sees accepted work and cannot send it twice.
    const claim = run.phase === 'tracking' ? 'running' : run.phase === 'settled' ? 'completed' : run.phase;
    db.prepare(`INSERT INTO automation_runs VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      status=excluded.status, data=excluded.data`).run(run.id, run.automationId, run.scheduledAt, claim, run.createdAt, JSON.stringify(run));
  }
  function changeRun(run: StoredRun, patch: Partial<StoredRun>) {
    const current = stored(run.id);
    // An explicit release or a finished claim wins over a delayed execution read.
    if (!claimed.has(current.phase)) { Object.assign(run, current); return; }
    Object.assign(run, current, patch);
    if (patch.threadId && run.localInbox) {
      // Reading an empty starting run does not acknowledge its future messages.
      if (run.localInbox.archived) run.migration = { readAt: null, archived: true };
      delete run.localInbox;
    }
    putRun(run); options.changed(); options.runChanged?.(fallback(run));
  }
  function fallback(run: StoredRun): AutomationRun {
    const last = projections.get(run.id), history = run.history;
    return { id: run.id, automationId: run.automationId, automationName: run.automationName, hostId: run.hostId,
      scheduledAt: run.scheduledAt, threadId: run.threadId, turnId: run.turnId, sourceCwd: run.sourceCwd,
      createdAt: run.createdAt, updatedAt: run.updatedAt,
      status: run.phase === 'released' ? 'released' : run.phase === 'uncertain' ? 'uncertain' : run.phase === 'starting' ? 'starting'
        : run.phase === 'failed' ? 'failed' : last?.status ?? history?.status ?? 'running',
      error: run.failure ?? (last ? last.error : history?.error ?? null), summary: last ? last.summary : history?.summary ?? null,
      readAt: run.localInbox ? run.localInbox.readAt : last ? last.readAt : history?.readAt ?? null,
      archived: run.localInbox ? run.localInbox.archived : last?.archived ?? history?.archived ?? false };
  }
  // Upgrade the old display fields once. Only affirmative read/archive marks are
  // imported; an untouched old inbox cannot undo a receipt written by another client.
  for (const row of db.prepare('SELECT data FROM automation_runs').all()) {
    const old = decode<AutomationRun & Partial<StoredRun>>(row);
    if (old.phase) continue;
    const { status, summary, error, readAt, archived, ...identity } = old;
    const terminal = status === 'completed' || status === 'failed';
    const run: StoredRun = { ...identity, phase: status === 'running' || status === 'waiting' ? 'tracking'
      : terminal && old.turnId ? 'settled' : status === 'completed' ? 'settled' : status,
      ...(terminal ? { history: { status, summary, error, readAt, archived } } : {}),
      ...(!terminal || !old.turnId ? { failure: error } : {}),
      ...(old.threadId ? { migration: { readAt, archived } } : { localInbox: { readAt, archived } }) };
    putRun(run);
  }
  function assertOpen() { if (closing) throw new Error('Yard 服务正在关闭。'); }
  // Sidebar migration preserves old IDs in backend metadata. Use that explicit
  // identity mapping so a removed project is never replaced by a similar path.
  async function migrateProject(item: Automation) {
    if (item.target.type !== 'project' || !options.resolveProjectId) return item;
    const projectId = await options.resolveProjectId(item.hostId, item.target.projectId);
    assertOpen();
    const current = task(item.id);
    if (current.updatedAt !== item.updatedAt || !projectId || projectId === item.target.projectId) return current;
    const updated = { ...current, target: { type: 'project' as const, projectId }, updatedAt: Math.max(now(), current.updatedAt + 1) };
    putTask(updated); options.changed(); return updated;
  }
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
    let projectId = p.projectId === undefined ? old?.target.type === 'project' ? old.target.projectId : null : p.projectId;
    if (old?.target.type === 'project' && projectId === old.target.projectId && options.resolveProjectId) {
      projectId = await options.resolveProjectId(old.hostId, old.target.projectId) ?? projectId;
    }
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
  function modelRequest<T>(connection: CodexConnection, item: Automation, method: string, params: ObjectValue, mutating = false): Promise<T> {
    // The provider picker saves qualified identities; legacy plain slugs keep
    // inheriting the backend's configured provider.
    return options.request && modelSelection(item.model)
      ? options.request(item.hostId, connection, method, params, { mutating }) as Promise<T>
      : connection.request<T>(method, params, { mutating });
  }
  async function checkModel(connection: CodexConnection, item: Automation) {
    if (!item.model) return;
    const all: AvailableModel[] = [], cursors = new Set<string>();
    let cursor: string | null = null;
    do {
      const page: Page<AvailableModel> = await modelRequest(connection, item, 'model/list', { limit: 100, ...(cursor ? { cursor } : {}) });
      all.push(...page.data); cursor = page.nextCursor;
      if (cursor && cursors.has(cursor)) throw new Error('模型列表游标未前进。');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    const error = validateModel(item.model, item.reasoningEffort ?? undefined, all);
    if (error) throw new Error(error);
  }
  async function dispatch(item: Automation, run: StoredRun, connection: CodexConnection, project: NativeProject | null) {
    try {
      await checkModel(connection, item);
      const projectId = project ? options.projectIdForStart ? await options.projectIdForStart(project, item.hostId) : project.projectId : null;
      if (project && projectId) project = { ...project, projectId };
      let cwd = project?.path;
      if (!cwd) { await mkdir(options.projectlessRoot, { recursive: true }); cwd = await mkdtemp(join(options.projectlessRoot, 'scheduled-')); }
      changeRun(run, { sourceCwd: cwd });
      const { thread } = await modelRequest<ThreadResponse>(connection, item, 'thread/start', { cwd, historyMode: 'paginated',
        ...(projectId ? { projectId } : {}),
        config: { ...await options.configFor(item.hostId, cwd), ...(item.reasoningEffort ? { model_reasoning_effort: item.reasoningEffort } : {}) },
        ...(item.model ? { model: item.model } : {}),
      }, true);
      changeRun(run, { threadId: thread.id });
      await options.setMembership(thread.id, item.hostId, project, cwd, thread);
      await connection.request('thread/name/set', { threadId: thread.id, name: item.name }, { mutating: true });
      const { turn } = await modelRequest<{ turn: TurnSummary }>(connection, item, 'turn/start', {
        threadId: thread.id, clientUserMessageId: run.id, input: [{ type: 'text', text: item.prompt, text_elements: [] }],
        ...(item.model ? { model: item.model } : {}), ...(item.reasoningEffort ? { effort: item.reasoningEffort } : {}),
      }, true);
      applyTurn(run, turn);
    } catch (error) {
      changeRun(run, { phase: isRecord(error) && error.uncertain === true ? 'uncertain' : 'failed', failure: errorMessage(error) });
    }
  }
  function applyTurn(run: StoredRun, turn: TurnSummary, waiting = false) {
    const result = automationTurnResult(turn, waiting);
    const view = { ...fallback(run), ...result, turnId: turn.id };
    projections.set(run.id, view);
    const terminal = turn.status !== 'inProgress';
    if (run.phase === 'tracking' && !terminal && run.turnId === turn.id && !run.failure) return;
    changeRun(run, { turnId: turn.id, phase: terminal ? 'settled' : 'tracking', failure: null,
      ...(terminal ? { history: { ...result, readAt: view.readAt, archived: view.archived } } : {}) });
  }
  async function launch(id: string, manual: boolean) {
    assertOpen();
    if (preparing.has(id)) throw new Error('该任务正在启动。');
    preparing.add(id);
    try {
      let item = await migrateProject(task(id));
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
      const run: StoredRun = { id: randomUUID(), automationId: id, automationName: item.name, hostId: item.hostId,
        scheduledAt: manual ? null : item.nextRunAt, phase: 'starting', threadId: null, turnId: null, sourceCwd: project?.path ?? null,
        createdAt: now(), updatedAt: now() };
      db.exec('BEGIN IMMEDIATE');
      try {
        putRun(run); item = { ...item, lastRunAt: now(), nextRunAt: next, updatedAt: Math.max(now(), item.updatedAt + 1) }; putTask(item); db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      options.changed();
      if (item.target.type === 'project' && !project) {
        changeRun(run, { phase: 'failed', failure: '项目已移除，未启动会话。' }); return fallback(run);
      }
      const pending = dispatch(item, run, connection, project ?? null).catch(error => { diagnostic = errorMessage(error); }).finally(() => dispatching.delete(id));
      dispatching.set(id, pending);
      return fallback(run);
    } finally { preparing.delete(id); }
  }
  async function reconcile(run: StoredRun) {
    if (dispatching.has(run.automationId)) return;
    if (run.deleted) return;
    if (!run.threadId) {
      if (run.phase !== 'uncertain') changeRun(run, { phase: 'uncertain', failure: '启动时服务中断，无法确认是否已创建会话；请核查后解除。' });
      return;
    }
    const connection = await options.connectionFor(run.hostId);
    let value: AutomationThread;
    try { value = await readAutomationThread(connection, { ...run, threadId: run.threadId }); }
    catch (error) {
      if (automationThreadMissing(error)) markDeleted(run);
      throw error;
    }
    const { thread, turn } = value;
    if (!turn || turn.status === 'inProgress' && thread.status.type !== 'active') {
      if (run.phase !== 'uncertain') changeRun(run, { phase: 'uncertain', failure: '无法确认本轮执行状态，请打开会话核查；Yard 不会重复发送。' }); return;
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
  function history(limit = -1, offset = 0) {
    return db.prepare('SELECT data FROM automation_runs ORDER BY created_at DESC, id LIMIT ? OFFSET ?').all(limit, offset).map(decode<StoredRun>);
  }
  function remember(run: StoredRun, view: AutomationRun) {
    projections.set(run.id, view);
    if (view.status !== 'completed' && view.status !== 'failed') return;
    const latest = stored(run.id), old = latest.history;
    if (old?.status === view.status && old.summary === view.summary && old.error === view.error && old.readAt === view.readAt && old.archived === view.archived) return;
    latest.history = { status: view.status, summary: view.summary, error: view.error, readAt: view.readAt, archived: view.archived };
    putRun(latest);
  }
  function markDeleted(run: StoredRun) {
    const current = stored(run.id);
    if (current.deleted) return;
    const view = fallback(current);
    current.deleted = true; current.localInbox = { readAt: view.readAt, archived: view.archived };
    delete current.migration; delete current.turnRead;
    if (claimed.has(current.phase)) {
      current.phase = 'uncertain'; current.failure = '会话已删除，无法继续核查本轮结果；请核查后解除调度阻塞。';
    }
    current.history = { status: view.status, summary: view.summary, error: view.error, readAt: view.readAt, archived: view.archived };
    putRun(current); options.changed();
  }
  async function archives(records: StoredRun[]) {
    const hosts = new Map<string, StoredRun[]>();
    for (const run of records) if (run.threadId && !run.deleted) hosts.set(run.hostId, [...hosts.get(run.hostId) ?? [], run]);
    const result = new Map<string, Set<string>>();
    for (const [hostId, runs] of hosts) {
      const cwds = runs.every(run => run.sourceCwd) ? [...new Set(runs.map(run => run.sourceCwd!))] : [];
      let cached = archiveCache.get(hostId);
      if (!cached || cached.expires <= Date.now() || cached.cwds.length !== cwds.length || cwds.some(cwd => !cached!.cwds.includes(cwd))) {
        const sequence = archiveSequence;
        const ids = await archivedAutomationThreads(await options.connectionFor(hostId), cwds);
        for (const [key, event] of archiveEvents) if (event.sequence > sequence && key.startsWith(hostId + '\0')) {
          const id = key.slice(hostId.length + 1); if (event.archived) ids.add(id); else ids.delete(id);
        }
        cached = { ids, cwds, expires: Date.now() + 30000 }; archiveCache.set(hostId, cached);
      }
      result.set(hostId, cached.ids);
    }
    return result;
  }
  const migrationPending = new Map<string, Promise<void>>();
  async function migrateInbox(run: StoredRun, value: AutomationThread, archived: boolean | undefined) {
    if (!run.migration) return archived;
    const existing = migrationPending.get(run.id);
    if (existing) { await existing; return archiveCache.get(run.hostId)?.ids.has(run.threadId!) ?? archived; }
    const pending = (async () => {
      const current = stored(run.id), intent = current.migration;
      if (!intent || !current.threadId) return;
      const connection = await options.connectionFor(current.hostId);
      try {
        if (intent.readAt !== null) {
          if (automationTurnIsRead(value) === true) intent.readAt = null;
          else if (!intent.error) {
            await writeReceipt(current, value, true, connection); intent.readAt = null;
          }
        }
        if (intent.archived && archived === true) intent.archived = false;
        else if (intent.archived && archived === false && !intent.error) {
          await connection.request('thread/archive', { threadId: current.threadId }, { mutating: true });
          threadArchived(current.hostId, current.threadId, true); archived = true; intent.archived = false;
        }
        if (intent.error && (intent.readAt !== null || intent.archived)) diagnostic = intent.error;
      } catch (error) {
        intent.error = '旧收件箱标记同步失败，请重新操作：' + errorMessage(error); diagnostic = intent.error;
        archiveCache.delete(current.hostId);
      }
      const latest = stored(run.id);
      if (!latest.migration) return;
      if (intent.readAt === null && !intent.archived) delete latest.migration;
      else latest.migration = intent;
      putRun(latest);
    })().finally(() => migrationPending.delete(run.id));
    migrationPending.set(run.id, pending); await pending;
    return archived;
  }
  async function project(run: StoredRun, archived?: boolean, strict = false): Promise<AutomationRun> {
    if (!run.threadId || run.deleted || dispatching.has(run.automationId)) return fallback(run);
    try {
      const connection = await options.connectionFor(run.hostId);
      const key = run.hostId + '\0' + run.threadId, epoch = receiptEpoch.get(key);
      const value = await readAutomationThread(connection, { ...run, threadId: run.threadId });
      archived = await migrateInbox(run, value, archived);
      if (run.migration || epoch !== receiptEpoch.get(key)) {
        value.readState = (await connection.request('thread/read', { threadId: run.threadId, includeTurns: false })).readState ?? null;
      }
      let current = stored(run.id);
      if (current.deleted) return fallback(current);
      const { turn, thread } = value;
      if (!turn || turn.status === 'inProgress' && thread.status.type !== 'active') {
        if (claimed.has(current.phase) && current.phase !== 'uncertain') changeRun(current, { phase: 'uncertain',
          failure: '无法确认本轮执行状态，请打开会话核查；Yard 不会重复发送。' });
        return { ...fallback(current), ...(current.phase === 'released' || current.phase === 'failed' ? {} : {
          status: 'uncertain', error: '本轮执行记录不可用，请打开会话核查。', summary: null }), ...(archived === undefined ? {} : { archived }) };
      }
      if (claimed.has(current.phase)) applyTurn(current, turn, thread.status.type === 'active' && thread.status.activeFlags.some(flag => /approval|input/i.test(flag)));
      current = stored(run.id);
      if (current.turnId !== turn.id) { current.turnId = turn.id; putRun(current); }
      if (current.turnRead !== undefined && value.readState?.firstUnread === null) {
        delete current.turnRead; putRun(current);
      }
      const result = automationTurnResult(turn, thread.status.type === 'active' && thread.status.activeFlags.some(flag => /approval|input/i.test(flag)));
      const isRead = current.turnRead ?? automationTurnIsRead(value);
      const archive = archiveCache.get(run.hostId);
      if (archived !== undefined && archive && (!archive.cwds.length || current.sourceCwd && archive.cwds.includes(current.sourceCwd))) {
        archived = archive.ids.has(run.threadId);
      }
      const view: AutomationRun = { ...fallback(current), ...result, turnId: turn.id,
        ...(current.phase === 'released' ? { status: 'released', error: current.failure ?? null } : {}),
        ...(current.phase === 'failed' ? { status: 'failed', error: current.failure ?? result.error } : {}),
        readAt: isRead ? current.createdAt : null, ...(archived === undefined ? {} : { archived }) };
      remember(current, view); return view;
    } catch (error) {
      if (automationThreadMissing(error)) { markDeleted(run); return fallback(stored(run.id)); }
      if (strict) throw error;
      diagnostic = errorMessage(error); return fallback(stored(run.id));
    }
  }
  async function inbox(params: Record<string, unknown>) {
    const limit = Math.min(200, Math.max(1, Number(params.limit) || 100));
    const records = history(), archived = await archives(records);
    const projected: AutomationRun[] = [];
    for (const run of records) projected.push(await project(run, archived.get(run.hostId)?.has(run.threadId!)));
    const items = projected.slice(0, limit).filter(run => !params.threadId || run.threadId === params.threadId).map(run => ({
      id: run.id, automationId: run.automationId, automationName: run.automationName, threadId: run.threadId,
      threadTitle: run.automationName, sourceCwd: run.sourceCwd, createdAt: run.createdAt, updatedAt: run.updatedAt,
      readAt: run.readAt, status: run.archived ? 'ARCHIVED' : active.has(run.status) && run.status !== 'uncertain' ? 'IN_PROGRESS' : 'PENDING_REVIEW',
      title: run.status === 'released' ? '结果未知，已解除' : run.status === 'uncertain' ? '执行结果待核实' : run.status === 'failed' ? '执行失败' : run.automationName,
      description: run.status === 'released' ? '结果未知，已解除调度阻塞。\n' + (run.error ?? '') : run.error ?? run.summary,
      archivedAssistantMessage: null, archivedUserMessage: null, archivedReason: null, hostId: run.hostId, runStatus: run.status,
    }));
    const unread = projected.filter(run => ['completed', 'failed', 'uncertain'].includes(run.status) && run.readAt === null && !run.archived && run.threadId);
    return { items, unreadRunCounts: { total: unread.length, automationIds: [...new Set(unread.map(run => run.automationId))],
      unreadRuns: unread.map(run => ({ threadId: run.threadId, automationId: run.automationId })) }, diagnostic };
  }
  async function writeReceipt(run: StoredRun, value: AutomationThread, read: boolean, connection: CodexConnection) {
    if (!value.readState) throw new Error('该会话的后端已读状态不可用，请稍后重试。');
    const index = value.turns.findIndex(turn => turn.id === value.turn?.id), later = index >= 0 && index < value.turns.length - 1;
    const canonical = automationTurnIsRead(value);
    if ((canonical !== read || value.readState.firstUnread === null && !read) && !(later && read)) {
      const reply = await connection.request('thread/readState/update', { threadId: run.threadId,
        operation: { type: read ? 'read' : 'unread' }, expectedRevision: value.readState.revision }, { mutating: true });
      value.readState = reply.readState;
    }
    const current = stored(run.id);
    if (later && automationTurnIsRead(value) !== read) current.turnRead = read;
    else delete current.turnRead;
    putRun(current);
    const key = run.hostId + '\0' + run.threadId;
    receiptEpoch.set(key, (receiptEpoch.get(key) ?? 0) + 1);
  }
  async function setInbox(endpoint: string, p: Record<string, unknown>) {
    const records = history().filter(run => (p.hostId === undefined || p.hostId === run.hostId) &&
      (endpoint === 'inbox-automation-runs-mark-all-read' || p.threadId === run.threadId || p.id === run.id));
    if (!records.length && endpoint !== 'inbox-automation-runs-mark-all-read') throw new Error('运行记录不存在。');
    const handled = new Set<string>();
    try {
      for (const run of records) {
        if (!run.threadId || run.deleted) {
          const current = stored(run.id), view = fallback(current);
          current.localInbox = endpoint === 'automation-run-archive' ? { readAt: view.readAt, archived: p.archived !== false }
            : { readAt: p.isRead === false ? null : now(), archived: view.archived };
          putRun(current); continue;
        }
        const key = run.hostId + '\0' + run.threadId;
        if (handled.has(key)) continue;
        handled.add(key);
        const connection = await options.connectionFor(run.hostId);
        if (endpoint === 'automation-run-archive') {
          const archive = p.archived !== false;
          await connection.request(archive ? 'thread/archive' : 'thread/unarchive', { threadId: run.threadId }, { mutating: true });
          threadArchived(run.hostId, run.threadId, archive);
        } else {
          const value = await readAutomationThread(connection, { ...run, threadId: run.threadId });
          await writeReceipt(run, value, p.isRead !== false, connection);
        }
        const current = stored(run.id);
        if (current.migration) {
          if (endpoint === 'automation-run-archive') current.migration.archived = false;
          else current.migration.readAt = null;
          if (current.migration.readAt === null && !current.migration.archived) delete current.migration;
          putRun(current);
        }
      }
      return { success: true };
    } catch (error) {
      if (endpoint === 'automation-run-archive') for (const run of records) archiveCache.delete(run.hostId);
      throw error;
    } finally { options.changed(); }
  }
  function track<T>(operation: () => Promise<T>) {
    assertOpen();
    const pending = operation().finally(() => requests.delete(pending));
    requests.add(pending); return pending;
  }
  async function fetchOperation(endpoint: string, input: Record<string, unknown>) {
    assertOpen();
    const p = isRecord(input.params) ? input.params : input;
    switch (endpoint) {
      case 'list-automations': return { items: await Promise.all(list().filter(item => item.status !== 'DELETED')
        .map(item => migrateProject(item).catch(() => task(item.id)))) };
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
      case 'automation-run-archive': return setInbox(endpoint, p);
      case 'automation-runs': {
        const items: AutomationRun[] = [];
        for (const run of history(Math.min(200, Math.max(1, Number(p.limit) || 100)), Math.max(0, Number(p.offset) || 0))) items.push(await project(run));
        return { items, diagnostic };
      }
      case 'automation-run-resolve': {
        const row = db.prepare('SELECT data FROM automation_runs WHERE id=?').get(text(p.id, '运行 ID', 200));
        if (!row) throw new Error('运行记录不存在。');
        const run = decode<StoredRun>(row);
        if (run.phase !== 'uncertain' || p.confirmed !== true) throw new Error('请先核查结果待确认的会话。');
        if (run.threadId && !run.deleted) {
          const connection = await options.connectionFor(run.hostId);
          try {
            const { thread } = await connection.request('thread/read', { threadId: run.threadId, includeTurns: false });
            if (thread.status.type === 'active') throw new Error('会话仍在执行，请先在会话中处理。');
          } catch (error) { if (automationThreadMissing(error)) markDeleted(run); else throw error; }
        }
        const current = stored(run.id);
        if (current.phase !== 'uncertain') throw new Error('运行状态已变化，请刷新后核查。');
        changeRun(current, { phase: 'released' }); return { success: true };
      }
      default: throw new Error('不支持的定时任务操作：' + endpoint);
    }
  }
  function threadArchived(hostId: string, threadId: string, archived: boolean) {
    if (closing) return;
    archiveEvents.set(hostId + '\0' + threadId, { sequence: ++archiveSequence, archived });
    const cached = archiveCache.get(hostId);
    if (cached) { if (archived) cached.ids.add(threadId); else cached.ids.delete(threadId); }
    for (const run of history()) if (run.hostId === hostId && run.threadId === threadId) {
      const view = { ...fallback(run), archived };
      remember(run, view);
    }
    options.changed();
  }
  return {
    fetch: (endpoint: string, input: Record<string, unknown>) => track(() => fetchOperation(endpoint, input)), tick, threadArchived,
    observe(hostId: string, message: Pick<RpcMessage, 'method' | 'params' | 'id'>) {
      if (closing) return;
      if (!['thread/readState/changed', 'thread/status/changed', 'turn/started', 'turn/completed', 'thread/archived', 'thread/unarchived', 'thread/deleted', 'thread/reverted'].includes(message.method)) return;
      const params = record(message.params);
      if (typeof params.threadId !== 'string') return;
      const records = history().filter(run => run.hostId === hostId && run.threadId === params.threadId);
      if (!records.length) return;
      if (message.method === 'thread/archived' || message.method === 'thread/unarchived') {
        threadArchived(hostId, params.threadId, message.method === 'thread/archived'); return;
      }
      if (message.method === 'thread/deleted') records.forEach(markDeleted);
      if (message.method === 'thread/readState/changed') {
        const key = hostId + '\0' + params.threadId;
        receiptEpoch.set(key, (receiptEpoch.get(key) ?? 0) + 1);
        const state = record(params.readState), first = state.firstUnread;
        for (const run of records) {
          if (first === null && run.turnRead !== undefined) { delete run.turnRead; putRun(run); }
          const read = first === null ? true : isRecord(first) && (first.type === 'threadStart' || first.turnId === run.turnId) ? false : undefined;
          if (read !== undefined) remember(run, { ...fallback(run), readAt: (run.turnRead ?? read) ? run.createdAt : null });
        }
      }
      options.changed();
      if (message.method === 'turn/completed' || message.method === 'thread/status/changed') void tick();
    },
    beforeThreadDelete(hostId: string, threadId: string) {
      return track(async () => {
        const records = history().filter(run => run.hostId === hostId && run.threadId === threadId && !run.deleted);
        if (!records.length) return;
        const archived = await archives(records);
        for (const run of records) {
          const view = await project(run, archived.get(hostId)?.has(threadId), true), current = stored(run.id);
          current.history = { status: view.status, summary: view.summary, error: view.error, readAt: view.readAt, archived: view.archived };
          putRun(current);
        }
      });
    },
    status: () => ({ running: started && !closing, inFlight: runs().length, diagnostic }),
    start() { if (started || closing) return; started = true; void tick(); timer = setInterval(() => { void tick(); }, options.intervalMs ?? 30000); timer.unref(); },
    async close() {
      if (closing) return; closing = true; clearInterval(timer);
      await checking; await Promise.allSettled([...dispatching.values(), ...requests]);
      db.close(); owner.close();
    },
  };
}

export const automationEndpoints = new Set(['list-automations', 'automation-create', 'automation-update', 'automation-delete',
  'automation-run-now', 'inbox-items', 'inbox-item-set-read-state', 'inbox-automation-runs-mark-all-read', 'automation-run-archive',
  'automation-runs', 'automation-run-resolve']);
