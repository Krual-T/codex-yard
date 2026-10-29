import { createRoot } from 'react-dom/client';
import { BrowserWorkbenchClient } from '../src/renderer/app/client.ts';
import { ConversationSessions, useConversationSession } from '../src/renderer/app/conversation-sessions.ts';
import { ThreadSummaryPanel } from '../src/renderer/app/ThreadSummaryPanel.tsx';
import { I18nProvider } from '../src/renderer/i18n/index.tsx';
import '../src/renderer/app/app.css';

interface Call { kind: string; value: unknown; hostId: string; threadId: string }
declare global {
  interface Window {
    summaryParityFixture: {
      calls: Call[];
      select(hostId: string, threadId: string, projectless: boolean): void;
      show(value: boolean): void;
      failCreate(value: boolean): void;
      atom(key: string): Promise<unknown>;
      setAtom(key: string, value: unknown): Promise<unknown>;
      close(): void;
    };
  }
}
const client = new BrowserWorkbenchClient();
document.documentElement.dataset.theme = 'light';
const sessions = new ConversationSessions(client, async () => undefined);
const root = createRoot(document.getElementById('root')!);
const calls: Call[] = [];
let hostId = 'local', threadId = 'empty', projectless = false, visible = true, failCreate = false;
function View() {
  const snapshot = useConversationSession(sessions, { hostId, threadId }, true, true, null);
  const originalHost = hostId, originalThread = threadId;
  return <I18nProvider locale="en-US">{visible && <ThreadSummaryPanel client={client} hostId={hostId} threadId={threadId}
    snapshot={snapshot} sideChats={[]} onShowSideChat={() => { throw Error('unexpected side chat'); }}
    onRestoreSideChat={() => { throw Error('unexpected side chat'); }} projectless={projectless}
    outputs={{ entries: [], loading: false, canCreate: true }}
    onCreateOutput={kind => {
      calls.push({ kind: 'create', value: kind, hostId: originalHost, threadId: originalThread });
      if (failCreate) throw Error('controlled create failure');
    }}
    onOpenFile={value => { calls.push({ kind: 'file', value, hostId: originalHost, threadId: originalThread }); }}
    onOpenCreatedChat={value => { calls.push({ kind: 'created', value, hostId: originalHost, threadId: originalThread }); }} />}</I18nProvider>;
}
function render() { root.render(<View />); }
window.summaryParityFixture = {
  calls,
  select(host, thread, value) { hostId = host; threadId = thread; projectless = value; render(); },
  show(value) { visible = value; render(); },
  failCreate(value) { failCreate = value; },
  atom(key) { return client.host('get-persisted-atom', { key }); },
  setAtom(key, value) { return client.host('set-persisted-atom', { key, value }); },
  close() { root.unmount(); sessions.dispose(); client.close(); },
};
void client.connect();
render();
