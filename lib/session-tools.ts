import { isAbsolute } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { RpcError } from './codex.ts';
import type { CodexConnection } from './codex.ts';
import { errorMessage, isRecord } from './codex-protocol.ts';
import type { Page, ThreadItemSummary, ThreadSummary } from './codex-protocol.ts';
import type { AppToolCall, AppToolDescriptor, ToolArgumentSchema } from './app-tools.ts';
import { appToolCatalog, setThreadTitle } from './host-tools.ts';

const threadId: ToolArgumentSchema = { type: 'string', minLength: 1, maxLength: 200 };
const cursor: ToolArgumentSchema = { type: 'string', minLength: 1, maxLength: 4000 };
const limit: ToolArgumentSchema = { type: 'integer', minimum: 1, maximum: 100 };
const message: ToolArgumentSchema = { type: 'string', minLength: 1, maxLength: 100_000 };

function tool(name: string, description: string, properties: Record<string, ToolArgumentSchema>, required: string[] = []): AppToolDescriptor {
  return { namespace: 'codex_app', name, description,
    inputSchema: { type: 'object', properties, required, additionalProperties: false } };
}

/** The adapter's pipe namespace is internal; Codex registers these as codex_yard. */
export const sessionToolCatalog: readonly AppToolDescriptor[] = [
  ...appToolCatalog.filter(item => item.name === 'set_thread_title'),
  tool('list_projects', '列出当前执行主机的 Codex 原生项目。Yard 网页收藏的目录另由网页管理。', { limit, cursor }),
  tool('list_threads', '分页列出当前执行主机未归档的主对话及其真实状态。子智能体不在此列表中。', { limit, cursor }),
  tool('read_thread', '只读分页获取主对话最近的历史项，默认 60 项，按时间倒序。不会恢复或发送对话；命令和工具输出默认省略。', {
    threadId, cursor, limit, includeOutputs: { type: 'boolean', default: false },
    maxOutputCharsPerItem: { type: 'integer', minimum: 0, maximum: 20_000 },
  }, ['threadId']),
  tool('create_thread', '创建同一主机的持久主对话并提交首条消息。默认沿用当前目录和 Codex 的默认模型、权限。返回 threadId 后可在 App 和 Yard 继续。', {
    title: { type: 'string', minLength: 1, maxLength: 200 }, message,
    cwd: { type: 'string', minLength: 1, maxLength: 4096 },
    model: { type: 'string', minLength: 1, maxLength: 200 },
    effort: { type: 'string', minLength: 1, maxLength: 50, description: '目标模型支持的推理强度，例如 high 或 max。' },
  }, ['title', 'message']),
  tool('send_message_to_thread', '向另一主对话发送一次消息。运行中的对话会收到补充输入；保留目标模型、权限和工具配置。不自动重试，结果不确定时先读取目标历史。', { threadId, message }, ['threadId', 'message']),
  tool('wait_threads', '有界等待任一主对话不再活动或需要关注，返回全部目标的真实状态。未加载不等于完成；超时、取消均不会中断目标。', {
    threadIds: { type: 'array', items: threadId, minItems: 1, maxItems: 10 },
    timeoutMs: { type: 'integer', minimum: 0, maximum: 30_000 },
  }, ['threadIds']),
];

function validate(value: unknown, schema: ToolArgumentSchema, key: string): void {
  const invalid = () => { throw new RpcError('参数无效：' + key, { status: 400 }); };
  if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) invalid();
    if (Array.isArray(value) && schema.items) value.forEach(item => validate(item, schema.items!, key));
    return;
  }
  if ((schema.type === 'integer' ? !Number.isInteger(value) : typeof value !== schema.type) ||
      (typeof value === 'number' && (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) ||
      (typeof value === 'string' && (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity) ||
        (schema.enum != null && !schema.enum.includes(value))))) invalid();
}

function argumentsFor(params: AppToolCall): Record<string, unknown> {
  const descriptor = sessionToolCatalog.find(item => item.namespace === params.namespace && item.name === params.tool);
  const args = params.arguments;
  if (!descriptor || !isRecord(args) || Object.keys(args).some(key => !Object.hasOwn(descriptor.inputSchema.properties, key))) {
    throw new RpcError('工具或参数无效。', { status: 400 });
  }
  for (const key of descriptor.inputSchema.required ?? []) {
    if (!Object.hasOwn(args, key)) throw new RpcError('缺少参数：' + key, { status: 400 });
  }
  for (const [key, value] of Object.entries(args)) validate(value, descriptor.inputSchema.properties[key]!, key);
  return args;
}

function summary(thread: ThreadSummary) {
  return { id: thread.id, title: thread.name, cwd: thread.cwd, status: thread.status };
}

function itemSummary(item: ThreadItemSummary, includeOutputs: boolean, maxChars: number) {
  const result: Record<string, unknown> = { id: item.id, type: item.type };
  function text(key: string, value: unknown) {
    if (typeof value !== 'string') return;
    result[key] = value.slice(0, maxChars);
    if (value.length > maxChars) result.truncated = true;
  }
  if (item.type === 'agentMessage') text('text', item.text);
  if (item.type === 'userMessage' && Array.isArray(item.content)) {
    text('text', item.content.filter(isRecord).filter(part => part.type === 'text').map(part => part.text).join('\n'));
  }
  if (item.type === 'commandExecution') {
    text('command', item.command);
    result.status = item.status;
    result.exitCode = item.exitCode;
    if (includeOutputs) text('output', item.aggregatedOutput);
  }
  if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') {
    result.tool = item.tool;
    result.server = item.server ?? item.namespace;
    result.status = item.status;
    if (includeOutputs) text('output', JSON.stringify(item.result ?? item.contentItems ?? item.error ?? null));
  }
  return result;
}

/** Every call uses the daemon's identity and state; no browser-local session state. */
export function createSessionToolHandler(connection: CodexConnection) {
  async function read(id: string, timeoutMs?: number) {
    const { thread } = await connection.request('thread/read', { threadId: id, includeTurns: false }, { timeoutMs });
    if (isRecord(thread) && ((isRecord(thread.source) && Object.hasOwn(thread.source, 'subAgent')) || String(thread.source ?? '').startsWith('subAgent'))) {
      throw new RpcError('目标必须是主对话。', { status: 400 });
    }
    return thread;
  }

  async function submit(id: string, text: string, caller: AppToolCall) {
    // turn/start atomically starts a turn or adds input to the active turn. A
    // read-then-steer decision would race another App/Yard client.
    const { turn } = await connection.request('turn/start', {
      threadId: id, input: [{ type: 'text', text, text_elements: [] }], parentTurnId: caller.turnId,
    }, { mutating: true });
    return { threadId: id, turnId: turn.id, accepted: true };
  }

  async function send(id: string, text: string, caller: AppToolCall, signal?: AbortSignal) {
    if (id === caller.threadId) throw new RpcError('请直接继续当前对话，不能向自身发送消息。', { status: 400 });
    await read(id);
    signal?.throwIfAborted();
    await connection.request('thread/resume', { threadId: id, excludeTurns: true }, { mutating: true });
    signal?.throwIfAborted();
    return submit(id, text, caller);
  }

  return async (params: AppToolCall, { signal }: { signal?: AbortSignal } = {}) => {
    try {
      signal?.throwIfAborted();
      const args = argumentsFor(params);
      const caller = await read(params.threadId);
      signal?.throwIfAborted();
      let result: unknown;
      switch (params.tool) {
        case 'set_thread_title': result = await setThreadTitle(connection, caller.id, args); break;
        case 'list_projects': result = await connection.request('project/list', { limit: args.limit ?? 50, cursor: args.cursor }); break;
        case 'list_threads': {
          const page = await connection.request('thread/list', { limit: args.limit ?? 50, cursor: args.cursor,
            archived: false, sourceKinds: ['cli', 'vscode', 'appServer'], sortKey: 'updated_at', useStateDbOnly: true });
          result = { data: page.data.map(summary), nextCursor: page.nextCursor };
          break;
        }
        case 'read_thread': {
          const target = await read(String(args.threadId));
          const page = await connection.request<Page<{ turnId: string; item: ThreadItemSummary }>>('thread/items/list', {
            threadId: target.id, limit: args.limit ?? 60, cursor: args.cursor, sortDirection: 'desc',
          });
          // At most two text fields per item: keep the whole page within
          // 200,000 text characters, including command/tool output if requested.
          const maxChars = Math.min(Number(args.maxOutputCharsPerItem ?? 4000), Math.floor(200_000 / Math.max(2, page.data.length * 2)));
          result = { thread: summary(target), data: page.data.map(entry => ({ turnId: entry.turnId,
            item: itemSummary(entry.item, args.includeOutputs === true, maxChars) })),
          nextCursor: page.nextCursor, maxCharsPerField: maxChars };
          break;
        }
        case 'create_thread': {
          const title = String(args.title).trim();
          if (!title || /[\x00-\x1f\x7f]/.test(title)) throw new RpcError('标题必须是单行文字。', { status: 400 });
          const cwd = typeof args.cwd === 'string' ? args.cwd : caller.cwd;
          if (!isAbsolute(cwd)) throw new RpcError('cwd 必须是绝对目录。', { status: 400 });
          const { thread } = await connection.request('thread/start', { cwd, historyMode: 'paginated',
            ...(args.model ? { model: args.model } : {}),
            ...(args.effort ? { config: { model_reasoning_effort: args.effort } } : {}),
          }, { mutating: true });
          try {
            signal?.throwIfAborted();
            await setThreadTitle(connection, thread.id, { title });
            signal?.throwIfAborted();
            result = { ...await submit(thread.id, String(args.message), params), title, created: true };
          } catch (cause) {
            // A successful creation is not rolled back when naming/submission
            // fails. Surface its identity so recovery does not create duplicates.
            result = { threadId: thread.id, created: true, error: errorMessage(cause),
              uncertain: isRecord(cause) && cause.uncertain === true };
          }
          break;
        }
        case 'send_message_to_thread': result = await send(String(args.threadId), String(args.message), params, signal); break;
        case 'wait_threads': {
          const ids = [...new Set(args.threadIds as string[])];
          const deadline = Date.now() + Number(args.timeoutMs ?? 10_000);
          while (true) {
            signal?.throwIfAborted();
            const timeoutMs = args.timeoutMs === 0 ? Math.min(1000, connection.timeout) : Math.max(1, deadline - Date.now());
            const threads = await Promise.all(ids.map(async id => {
              try { return summary(await read(id, timeoutMs)); }
              catch (cause) { return { id, status: { type: 'error' as const, message: errorMessage(cause),
                code: isRecord(cause) ? cause.code : undefined } }; }
            }));
            const ready = threads.some(thread => thread.status.type !== 'active' || thread.status.activeFlags.length > 0);
            const timedOut = threads.some(thread => thread.status.type === 'error' && thread.status.code === 'TIMEOUT') ||
              (!ready && Date.now() >= deadline);
            if (ready || timedOut) { result = { threads, timedOut, reason: timedOut ? 'timeout' : 'attention' }; break; }
            await setTimeout(Math.min(250, Math.max(1, deadline - Date.now())), undefined, { signal });
          }
          break;
        }
      }
      signal?.throwIfAborted();
      return { success: !(isRecord(result) && Object.hasOwn(result, 'error')),
        contentItems: [{ type: 'inputText' as const, text: JSON.stringify(result) }] };
    } catch (cause) {
      signal?.throwIfAborted();
      return { success: false, contentItems: [{ type: 'inputText' as const, text: JSON.stringify({
        error: errorMessage(cause), uncertain: isRecord(cause) && cause.uncertain === true,
      }) }] };
    }
  };
}
