import { createRoot } from 'react-dom/client';
import { BrowserWorkbenchClient } from '../src/renderer/app/client.ts';
import { ConversationSessions, useConversationSession } from '../src/renderer/app/conversation-sessions.ts';
import { ThreadSummaryPanel } from '../src/renderer/app/ThreadSummaryPanel.tsx';
import type { ThreadSummaryPanelProps } from '../src/renderer/app/ThreadSummaryPanel.tsx';
import { I18nProvider } from '../src/renderer/i18n/index.tsx';
import '../src/renderer/app/app.css';

interface Call { kind: string; value?: unknown }
declare global {
  interface Window {
    threadSummaryFixture: {
      calls: Call[];
      select(host: string, thread: string): void;
      locale(value: string): void;
      outputFailure(value: boolean): void;
      restoreFailure(value: boolean): void;
      close(): void;
    };
  }
}

const client = new BrowserWorkbenchClient();
document.documentElement.dataset.theme = 'light';
const sessions = new ConversationSessions(client, async () => undefined);
const root = createRoot(document.getElementById('root')!);
const calls: Call[] = [];
let hostId = 'local', threadId = 'thread-a', locale = 'en-US', outputFailure = true, restoreFailure = true, sideFailure = true;
const note = (kind: string, value?: unknown) => { calls.push({ kind, value: structuredClone(value) }); };

function View() {
  const snapshot = useConversationSession(sessions, { hostId, threadId }, true, true, null);
  const props: ThreadSummaryPanelProps = {
    client, hostId, threadId, snapshot,
    sideChats: [
      { kind: 'active', title: 'Current side chat', working: true,
        identity: { hostId: 'local', parentThreadId: 'thread-a', draftId: 'active-draft', prepareId: 'active-prepare' } },
      { kind: 'recoverable', title: 'Saved side chat',
        identity: { hostId: 'local', parentThreadId: 'thread-a', draftId: 'saved-draft', prepareId: 'saved-prepare' } },
      { kind: 'recoverable', title: 'Duplicate saved association',
        identity: { hostId: 'local', parentThreadId: 'thread-a', draftId: 'active-draft', prepareId: 'active-prepare' } },
      { kind: 'active', title: 'Wrong host side chat',
        identity: { hostId: 'other', parentThreadId: 'thread-a', draftId: 'other-draft', prepareId: 'other-prepare' } },
      { kind: 'active', title: 'Wrong thread side chat',
        identity: { hostId: 'local', parentThreadId: 'thread-b', draftId: 'other-thread', prepareId: 'other-prepare' } },
    ],
    sideChatsError: sideFailure ? 'synthetic association read failure' : null,
    onRetrySideChats() { note('retry-side-chats'); sideFailure = false; render(); },
    onShowSideChat: identity => note('show', identity),
    async onRestoreSideChat(identity) { note('restore', identity); if (restoreFailure) throw Error('synthetic restore failure'); },
    onOpenGoal: () => note('goal'), onOpenPlan: value => note('plan', value), onOpenFile: value => note('file', value),
    onOpenWebSearch: value => note('web', value), onOpenToolSource: value => note('tool', value),
    outputs: { entries: [
      { id: 'out-1', kind: 'file', label: 'output-one.txt', path: '/fixture/project/output-one.txt' },
      { id: 'out-2', kind: 'file', label: 'output-two.txt', path: '/fixture/project/output-two.txt' },
      { id: 'out-3', kind: 'link', label: 'output-three', url: 'https://example.test/three' },
      { id: 'out-4', kind: 'file', label: 'output-four.txt', path: '/fixture/project/output-four.txt' },
    ], loading: false, error: outputFailure ? 'synthetic discovery failure' : null },
    onOpenOutput: value => note('output', value), onRetryOutputs() { note('retry-outputs'); outputFailure = false; render(); },
    subagents: [{ threadId: 'agent-a', label: 'Review agent', working: true }], onOpenSubagent: value => note('agent', value),
    backgroundProcesses: [{ id: 'process-a', command: 'npm test', working: true }], onOpenBackgroundProcess: value => note('process', value),
    onStopBackgroundProcesses: () => note('stop-processes'),
    createdChats: [{ threadId: 'created-a', label: 'Created chat' }], onOpenCreatedChat: value => note('created', value),
    onAddSource: () => note('add-source'), onClose: () => note('close'),
  };
  return <I18nProvider locale={locale}><div style={{ height: '100dvh' }}><ThreadSummaryPanel {...props} /></div></I18nProvider>;
}
function render() { root.render(<View />); }
window.threadSummaryFixture = {
  calls,
  select(host, thread) { hostId = host; threadId = thread; render(); },
  locale(value) { locale = value; render(); },
  outputFailure(value) { outputFailure = value; render(); },
  restoreFailure(value) { restoreFailure = value; },
  close() { root.unmount(); sessions.dispose(); client.close(); },
};
void client.connect();
render();
