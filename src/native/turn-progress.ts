import type { ReactElement } from 'react';
import { record } from './protocol.ts';
import type { HostMessage } from './protocol.ts';
import { writeClipboardText } from './browser-clipboard.ts';

export const progressWaitMs = 120_000;

/** Observe this visible turn, without interpreting silence as a failed request.
 * Backend retries and task execution remain owned by Codex. */
export class TurnProgress {
  readonly hostId: string;
  readonly threadId: string;
  readonly turnId: string;
  lastProgressAt: number;
  retrying = false;
  disconnected = false;
  finished = false;

  constructor(hostId: string, threadId: string, turnId: string, now = Date.now()) {
    this.hostId = hostId; this.threadId = threadId; this.turnId = turnId;
    this.lastProgressAt = now;
  }

  observe(message: HostMessage, now = Date.now()) {
    if ((message.hostId ?? 'local') !== this.hostId || this.finished) return;
    if (message.type === 'codex-app-server-connection-changed') {
      this.disconnected = message.state !== 'connected';
      if (!this.disconnected) this.lastProgressAt = now;
      return;
    }
    if (message.type !== 'mcp-notification') return;
    const params = record(message.params);
    if (params.threadId !== this.threadId || params.turnId != null && params.turnId !== this.turnId) return;
    if (message.method === 'turn/completed') {
      if (record(params.turn).id === this.turnId) this.finished = true;
    } else if (message.method === 'error' && params.turnId === this.turnId) {
      this.retrying = params.willRetry === true;
      if (!this.retrying) this.finished = true; // The native terminal error owns recovery.
    } else if (message.method === 'item/started' || message.method === 'item/completed'
      || typeof message.method === 'string' && message.method.startsWith('item/')
        && (message.method.endsWith('Delta') || message.method.endsWith('/delta'))) {
      this.lastProgressAt = now;
      this.retrying = false;
    }
  }

  notice(now = Date.now(), working = false): string | null {
    if (this.finished) return null;
    if (this.disconnected) return '与执行主机的连接已断开，正在重新连接。任务可能仍在运行。';
    if (this.retrying) return '请求遇到问题，Codex 正在重试。';
    if (working || now - this.lastProgressAt < progressWaitMs) return null;
    const minutes = Math.floor((now - this.lastProgressAt) / 60_000);
    return `已有 ${minutes} 分钟未收到新进展。模型可能仍在处理，也可能正在等待网络响应。`;
  }
}

function withoutImageData(text: string) {
  return text.replace(/data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=_-]+/g, '[图片数据已省略，请按文件路径读取]');
}

/** A user-reviewed continuation draft: paths and recent results, never a fork
 * of the image history or an automatically replayed task. */
export function continuationPrompt(value: unknown, threadId: string, turnId: string, hostId = 'local'): string {
  const data = record(value).data;
  const turns = Array.isArray(data) ? data.map(record) : [];
  const current = turns.find(turn => turn.id === turnId);
  if (!current) throw new Error('当前轮次已改变，请重新打开对话后核对。');
  const items = Array.isArray(current.items) ? current.items.map(record) : [];
  const requests: string[] = [];
  for (const item of items) {
    if (item.type !== 'userMessage' || !Array.isArray(item.content)) continue;
    for (const raw of item.content) {
      const part = record(raw);
      if (part.type === 'text' && typeof part.text === 'string') requests.push(withoutImageData(part.text));
      if (part.type === 'localImage' && typeof part.path === 'string') requests.push('附件原图：' + part.path);
      if (part.type === 'image' && typeof part.url === 'string' && !part.url.startsWith('data:')) requests.push('附件图片：' + part.url);
    }
  }
  const completed = turns.find(turn => turn.id !== turnId && turn.status === 'completed');
  const previous = (Array.isArray(completed?.items) ? completed.items.map(record) : [])
    .filter(item => item.type === 'agentMessage' && item.phase !== 'commentary' && typeof item.text === 'string')
    .map(item => withoutImageData(item.text as string)).join('\n\n');
  if (!requests.length) throw new Error('未读到本轮请求，请先核对原对话。');
  const bound = (text: string) => text.length > 16_000 ? text.slice(0, 16_000) + '\n[内容较长，其余信息请按需查看原对话。]' : text;
  return `继续处理以下任务。执行主机：${hostId}。来源对话：${threadId}。执行前先检查文件当前内容和已有产物，避免重复操作。按需读取附件原文件。\n\n`
    + (previous ? '最近一次已完成的结果：\n' + bound(previous) + '\n\n' : '')
    + '当前请求：\n' + bound(requests.join('\n\n'));
}

interface ProgressProps {
  hostId: string;
  threadId: string;
  turnId: string;
  working: boolean;
  interrupt(): Promise<unknown>;
  read(): Promise<unknown>;
}
export interface TurnProgressWindow extends Window { workbenchTurnProgress?: (props: ProgressProps) => ReactElement }

export function installTurnProgress(React: typeof import('react')) {
  const h = React.createElement;
  function Surface(props: ProgressProps) {
    const latest = React.useRef(props); latest.current = props;
    const [notice, setNotice] = React.useState<string | null>(null);
    const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
    const [draft, setDraft] = React.useState('');
    React.useEffect(() => {
      const progress = new TurnProgress(props.hostId, props.threadId, props.turnId);
      let displayed: string | null = null;
      const refresh = () => {
        const next = progress.notice(Date.now(), latest.current.working);
        if (next !== displayed) { displayed = next; setNotice(next); }
      };
      const listener = (event: MessageEvent<HostMessage>) => {
        if (event.source !== window || event.origin !== location.origin || !event.data) return;
        progress.observe(event.data);
        // Token deltas update the clock; only notice changes schedule a render.
        refresh();
      };
      window.addEventListener('message', listener);
      const timer = setInterval(refresh, 15_000);
      return () => { clearInterval(timer); window.removeEventListener('message', listener); };
    }, [props.hostId, props.threadId, props.turnId]);
    async function copy() {
      setBusy(true); setError('');
      try {
        const text = continuationPrompt(await latest.current.read(), props.threadId, props.turnId, props.hostId);
        setDraft(text);
        await writeClipboardText(text);
      } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
      finally { setBusy(false); }
    }
    async function stop() {
      setBusy(true); setError('');
      try { await latest.current.interrupt(); }
      catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
      finally { setBusy(false); }
    }
    if (!notice) return null;
    return h('section', { className: 'flex flex-col gap-2 rounded-xl border border-token-border-default p-3 text-sm', 'aria-label': '任务等待状态' },
      h('p', { role: 'status' }, notice),
      h('p', { className: 'text-token-text-secondary' }, '图片较多的旧对话可复制最近请求、已完成结果和文件路径，在同一执行主机的新对话中继续。请先停止当前任务，再在新对话发送。'),
      h('div', { className: 'flex flex-wrap gap-4' },
        h('button', { type: 'button', disabled: busy, className: 'underline', onClick: () => { void stop(); } }, '停止等待'),
        h('button', { type: 'button', disabled: busy, className: 'underline', onClick: () => { void copy(); } }, '复制续接提示')),
      error ? h('p', { role: 'alert' }, error) : null,
      draft ? h('details', { open: true }, h('summary', null, '续接提示（不包含历史图片数据）'),
        h('textarea', { readOnly: true, value: draft, rows: 5, className: 'w-full', 'aria-label': '续接提示', onFocus: (event: { currentTarget: HTMLTextAreaElement }) => event.currentTarget.select() })) : null);
  }
  (window as TurnProgressWindow).workbenchTurnProgress = props => h(Surface, { ...props,
    key: JSON.stringify([props.hostId, props.threadId, props.turnId]) });
}
