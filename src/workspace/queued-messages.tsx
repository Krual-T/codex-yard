import { CornerDownRight, ListEnd, MessageSquarePlus, Pencil, Play, Send, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { record } from '../native/protocol.ts';
import { attachedPrompt, type PromptAttachment } from './composer-input.ts';
import { followUpMode, listQueuedSubmissions, type FollowUpMode, type QueuedSubmission } from './host.ts';
import { ToolMenu, ToolMenuItem } from './new-tab-tools.tsx';
import { WorkspaceIcon } from './workspace-icon.tsx';

export function queuedPrompt(submission: QueuedSubmission) {
  const items = submission.input.map(record);
  const text = items.filter(item => item.type === 'text' && typeof item.text === 'string').map(item => item.text).join('\n');
  const parsed = attachedPrompt(text);
  const attachments: PromptAttachment[] = [...parsed.attachments];
  let editable = true;
  for (const item of items) {
    if (item.type === 'localImage' && typeof item.path === 'string' && item.path.startsWith('/')) {
      const path = item.path;
      if (!attachments.some(entry => entry.path === path)) attachments.push({ path, name: path.split('/').at(-1) || path, image: true });
    } else if (item.type !== 'text' || Array.isArray(item.text_elements) && item.text_elements.length) editable = false;
  }
  return { text: parsed.text, attachments, editable };
}

export function useQueuedMessages(threadId: string | undefined, hostId: string) {
  const [items, setItems] = useState<QueuedSubmission[]>([]);
  const [revision, setRevision] = useState(0);
  const [mode, setMode] = useState<FollowUpMode>('steer');
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!threadId) return;
    let live = true;
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin) return;
      const message = record(event.data);
      if (message.hostId !== hostId) return;
      if (message.type === 'mcp-notification' && message.method === 'thread/queue/changed' && record(message.params).threadId === threadId ||
          message.type === 'codex-app-server-connection-changed' && message.state === 'connected') setRevision(value => value + 1);
    };
    window.addEventListener('message', receive);
    void followUpMode().then(({ value }) => {
      if (live) setMode(value === 'queue' ? 'queue' : 'steer');
    }).catch(() => {});
    return () => { live = false; window.removeEventListener('message', receive); };
  }, [threadId, hostId]);
  useEffect(() => {
    if (!threadId) return;
    let live = true;
    void listQueuedSubmissions(threadId, hostId).then(entries => {
      if (live) { setItems(entries); setError(undefined); }
    }, failure => {
      if (live) setError(failure instanceof Error ? failure.message : String(failure));
    });
    return () => { live = false; };
  }, [threadId, hostId, revision]);
  return { items, mode, error, refresh: () => setRevision(value => value + 1), setMode: async (next: FollowUpMode) => {
    await followUpMode(next);
    setMode(next);
  } };
}

export function QueuedMessages({ items, mode, active, paused, disabled, edit, discard, send, reorder, setMode, openSidechat }: {
  items: QueuedSubmission[]; mode: FollowUpMode; active: boolean; paused: boolean; disabled: boolean;
  edit(item: QueuedSubmission): void; discard(item: QueuedSubmission): void; send(item: QueuedSubmission): void;
  reorder(ids: string[]): void; setMode(mode: FollowUpMode): void; openSidechat?(item: QueuedSubmission): void;
}) {
  const dragged = useRef<string>(undefined);
  if (!items.length) return null;
  function move(source: string, target: string) {
    if (source === target || disabled) return;
    const ids = items.map(item => item.id);
    const from = ids.indexOf(source), to = ids.indexOf(target);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, source);
    reorder(ids);
  }
  const action = active ? 'Steer' : 'Send';
  return <section className="yard-source-queued" aria-label="Queued messages" data-source-queued-messages="">
    {paused && <div className="yard-source-queue-paused"><span>Queue paused because you interrupted</span>
      <button type="button" disabled={disabled} onClick={() => send(items[0]!)}><Play size={13} aria-hidden="true" />Resume</button>
    </div>}
    {items.map((item, index) => {
      const preview = queuedPrompt(item);
      const text = preview.text.trim() || preview.attachments.map(file => file.name).join(', ') || 'Queued message';
      return <div key={item.id} className="yard-source-queued-row" draggable={items.length > 1 && !disabled}
        onDragStart={event => { dragged.current = item.id; event.dataTransfer.effectAllowed = 'move'; }}
        onDragEnd={() => { dragged.current = undefined; }}
        onDragOver={event => { if (dragged.current) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }}
        onDrop={event => { if (dragged.current) { event.preventDefault(); move(dragged.current, item.id); dragged.current = undefined; } }}>
        <ListEnd size={12} className="yard-source-queued-handle" aria-hidden="true" />
        <div className="yard-source-queued-preview" role="group" aria-label={`Preview queued message ${index + 1}: ${text}`} title={text}>
          <p dir="auto">{text}</p>
        </div>
        <button type="button" className="yard-source-queued-submit" title={active ? 'Submit without interrupting the model' : action}
          aria-label={action} disabled={disabled} onClick={() => send(item)}>
          {active ? <CornerDownRight size={12} aria-hidden="true" /> : <Send size={12} aria-hidden="true" />}{action}
        </button>
        <button type="button" title="Delete queued message" aria-label="Delete queued message" disabled={disabled} onClick={() => discard(item)}>
          <Trash2 size={12} aria-hidden="true" />
        </button>
        <ToolMenu align="end" label="Queued message actions" className="yard-source-queued-menu" deferContent
          triggerButton={<button type="button" aria-label="Queued message actions" title="Queued message actions" disabled={disabled}>
            <WorkspaceIcon name="more" size={12} />
          </button>}>
          {preview.editable && <ToolMenuItem onSelect={() => edit(item)}><Pencil size={14} aria-hidden="true" />Edit message</ToolMenuItem>}
          {openSidechat && preview.editable && <ToolMenuItem onSelect={() => openSidechat(item)}><MessageSquarePlus size={14} aria-hidden="true" />Open in side chat</ToolMenuItem>}
          <ToolMenuItem onSelect={() => setMode(mode === 'queue' ? 'steer' : 'queue')}>
            <ListEnd size={14} aria-hidden="true" />{mode === 'queue' ? 'Turn off queueing' : 'Turn on queueing'}
          </ToolMenuItem>
        </ToolMenu>
      </div>;
    })}
  </section>;
}
