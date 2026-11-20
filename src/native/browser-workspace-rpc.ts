import type { Page, ThreadResponse, TurnSummary } from '../../lib/codex-protocol.ts';
import type { HostMessage, RpcReply } from './protocol.ts';

type Send = (message: HostMessage) => Promise<void>;

export class WorkspaceRequestError extends Error {
  readonly uncertain: boolean;
  constructor(message: string, uncertain: boolean) {
    super(message); this.uncertain = uncertain;
  }
}

export function requestWorkspaceRpc<T>(send: Send, method: string, params: Record<string, unknown>,
  { type = 'mcp-request', hostId = 'local' } = {}): Promise<T> {
  const id = crypto.randomUUID();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => fail(new WorkspaceRequestError('The host did not respond.',
      ['turn/start', 'turn/steer', 'thread/fork', 'thread/revert', 'thread/settings/update', 'config/batchWrite'].includes(method) ||
        method.startsWith('thread/queue/') && method !== 'thread/queue/list')), 60_000);
    function done() {
      clearTimeout(timer);
      window.removeEventListener('message', receive);
    }
    function fail(error: unknown) {
      done();
      reject(error);
    }
    function receive(event: MessageEvent<HostMessage & { message?: RpcReply }>) {
      if (event.source !== window || event.origin !== location.origin ||
          event.data?.type !== 'mcp-response' || event.data.hostId !== hostId || event.data.message?.id !== id) return;
      done();
      const reply = event.data.message;
      if (reply.error) reject(new WorkspaceRequestError(reply.error.message,
        !!reply.error.data && typeof reply.error.data === 'object' && 'uncertain' in reply.error.data && reply.error.data.uncertain === true));
      else resolve(reply.result as T);
    }
    window.addEventListener('message', receive);
    void send({ type, hostId, request: { id, method, params } }).catch(fail);
  });
}

export async function readWorkspaceHistory(send: Send, threadId: string, cursor: string | null, hostId: string) {
  const [thread, page] = await Promise.all([
    cursor ? null : requestWorkspaceRpc<ThreadResponse>(send, 'thread/read', { threadId, includeTurns: false }, { hostId }),
    requestWorkspaceRpc<Page<TurnSummary>>(send, 'thread/turns/list', {
      threadId, cursor, limit: 2, sortDirection: 'desc', itemsView: 'summary',
    }, { hostId }),
  ]);
  return { thread: thread?.thread, turns: page.data.slice().reverse(), nextCursor: page.nextCursor };
}
