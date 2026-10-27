import { RpcError } from './codex.ts';
import { errorMessage, isRecord } from './codex-protocol.ts';
import type { RequestOptions } from './codex-protocol.ts';
import type { AppToolCall, AppToolDescriptor } from './app-tools.ts';

interface TitleConnection {
  request(method: 'thread/name/set', params: { threadId: string; name: string }, options: RequestOptions): Promise<unknown>;
}
export interface ListThreadsArgs { limit?: number; cursor?: string }
export interface ReadThreadArgs {
  threadId: string; hostId?: 'local'; cursor?: string; turnLimit?: number;
  includeOutputs?: boolean; maxOutputCharsPerItem?: number;
}
export interface HostToolOptions {
  connection: TitleConnection;
  knownThread: (id: string) => Promise<unknown>;
  listProjects: () => Promise<unknown>;
  listThreads: (args: ListThreadsArgs) => Promise<unknown>;
  readThread: (args: ReadThreadArgs) => Promise<unknown>;
  setTitle?: (threadId: string, args: unknown) => Promise<unknown>;
}
export interface HostToolResult { success: boolean; contentItems: { type: 'inputText'; text: string }[] }

// The official MCP adapter consumes flat descriptors, including the namespace.
export const appToolCatalog: readonly AppToolDescriptor[] = [
  {
    namespace: 'codex_app', name: 'set_thread_title',
    description: '修改当前对话的真实标题。成功结果表示标题已保存到 Codex；标题遵循项目的图标和命名约定。',
    inputSchema: {
      type: 'object', properties: {
        title: { type: 'string', description: '新的对话标题。', minLength: 1, maxLength: 200 },
        threadId: { type: 'string', description: '可省略；提供时必须是当前对话 ID。' },
      }, required: ['title'], additionalProperties: false,
    },
  },
  {
    namespace: 'codex_app', name: 'list_projects',
    description: '列出当前 Web 工作台已添加的项目及默认目录。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    namespace: 'codex_app', name: 'list_threads',
    description: '读取当前实例未归档的交互式主对话，返回标题、目录、状态及下一页游标。子 Agent 不在此列表中。',
    inputSchema: { type: 'object', properties: {
      limit: { type: 'integer', minimum: 1, maximum: 100 },
      cursor: { type: 'string' },
    }, additionalProperties: false },
  },
  {
    namespace: 'codex_app', name: 'read_thread',
    description: '只读获取当前实例中一个交互式主对话的历史。默认返回最新 10 轮，每轮最新 60 项，较早内容提供游标；不恢复或发送对话。',
    inputSchema: { type: 'object', properties: {
      threadId: { type: 'string', minLength: 1 },
      hostId: { type: 'string', enum: ['local'] },
      cursor: { type: 'string' },
      turnLimit: { type: 'integer', minimum: 1, maximum: 20 },
      includeOutputs: { type: 'boolean', default: false },
      maxOutputCharsPerItem: { type: 'integer', minimum: 0, maximum: 20000 },
    }, required: ['threadId'], additionalProperties: false },
  },
];

/** Routes only advertised, implemented host operations. Caller IDs come from MCP metadata. */
export function createHostToolHandler({ connection, knownThread, listProjects, listThreads, readThread,
  setTitle = (threadId, args) => setThreadTitle(connection, threadId, args) }: HostToolOptions) {
  return async (params: AppToolCall, { signal }: { signal?: AbortSignal } = {}): Promise<HostToolResult> => {
    signal?.throwIfAborted();
    try {
      const descriptor = appToolCatalog.find(tool => tool.namespace === params.namespace && tool.name === params.tool);
      const args = params.arguments;
      if (!descriptor || !isRecord(args) ||
          Object.keys(args).some(key => !Object.hasOwn(descriptor.inputSchema.properties, key))) {
        throw new RpcError('工具参数无效。', { status: 400 });
      }
      for (const [key, schema] of Object.entries(descriptor.inputSchema.properties)) {
        const value = args[key];
        if (value == null && !Object.hasOwn(args, key)) {
          if (descriptor.inputSchema.required?.includes(key)) throw new RpcError('缺少参数：' + key, { status: 400 });
          continue;
        }
        if ((schema.type === 'integer' ? !Number.isInteger(value) : typeof value !== schema.type) ||
            (schema.minimum != null && (typeof value !== 'number' || value < schema.minimum)) ||
            (schema.maximum != null && (typeof value !== 'number' || value > schema.maximum)) ||
            (schema.minLength != null && (typeof value !== 'string' || value.length < schema.minLength)) ||
            (schema.maxLength != null && (typeof value !== 'string' || value.length > schema.maxLength)) ||
            (schema.enum && (typeof value !== 'string' || !schema.enum.includes(value)))) {
          throw new RpcError('参数无效：' + key, { status: 400 });
        }
      }
      await knownThread(params.threadId);
      signal?.throwIfAborted();
      let result: unknown;
      switch (params.tool) {
        case 'set_thread_title': result = await setTitle(params.threadId, args); break;
        case 'list_projects': result = await listProjects(); break;
        case 'list_threads': result = await listThreads({
          ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
          ...(typeof args.cursor === 'string' ? { cursor: args.cursor } : {}),
        }); break;
        case 'read_thread': {
          if (typeof args.threadId !== 'string') throw new RpcError('缺少参数：threadId', { status: 400 });
          result = await readThread({ threadId: args.threadId,
            ...(args.hostId === 'local' ? { hostId: args.hostId } : {}),
            ...(typeof args.cursor === 'string' ? { cursor: args.cursor } : {}),
            ...(typeof args.turnLimit === 'number' ? { turnLimit: args.turnLimit } : {}),
            ...(typeof args.includeOutputs === 'boolean' ? { includeOutputs: args.includeOutputs } : {}),
            ...(typeof args.maxOutputCharsPerItem === 'number' ? { maxOutputCharsPerItem: args.maxOutputCharsPerItem } : {}),
          }); break;
        }
      }
      return { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(result) }] };
    } catch (cause) {
      signal?.throwIfAborted();
      return { success: false, contentItems: [{ type: 'inputText', text: JSON.stringify({
        error: errorMessage(cause), uncertain: isRecord(cause) && cause.uncertain === true,
      }) }] };
    }
  };
}

export async function setThreadTitle(connection: TitleConnection, threadId: string, args: unknown) {
  if (!isRecord(args) ||
      Object.keys(args).some(key => !['title', 'threadId'].includes(key)) ||
      typeof args.title !== 'string' || !args.title.trim() || args.title.length > 200 || /[\x00-\x1f\x7f]/.test(args.title)) {
    throw new RpcError('标题必须是 1–200 字符的单行文字。', { status: 400 });
  }
  if (args.threadId != null && args.threadId !== threadId) {
    throw new RpcError('此工具只能修改当前对话的标题。', { status: 403 });
  }
  const title = args.title.trim();
  await connection.request('thread/name/set', { threadId, name: title }, { mutating: true });
  return { threadId, title };
}
