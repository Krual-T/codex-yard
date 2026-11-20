import { lazy, Suspense, useCallback, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { ThreadItemSummary, ThreadSummary, TurnSummary } from '../../lib/codex-protocol.ts';
import { record } from '../native/protocol.ts';
import { readTurnActivity } from './host.ts';
import { MessageBody } from './message-body.tsx';
import { MessageCopy } from './message-copy.tsx';
import { McpCallOutput } from './mcp-call-output.tsx';
import { McpAppCard } from './mcp-app.tsx';
import { mcpAppUri } from './mcp-app-model.ts';
import { WorkspaceOutputLinks } from './message-markdown.tsx';
import { workspaceOutputFromLink } from './output-types.ts';
import { AgentLink, collectTurnAgents, emptySubagents, receivers, subagentTitle, type OpenSubagent } from './turn-agents.tsx';
import type { Elicitation } from './turn-elicitation.tsx';
import { insertRequestActivity, isPendingActivity, isRequestActivity, readRequestActivity, subscribeRequestActivity } from './turn-request-activity.ts';
import { isActivity } from './turn-item-events.ts';
import type { TurnStream, WorkspaceTurn } from './turn-stream.ts';
import { ActivityShimmer } from './activity-shimmer.tsx';
import { WorkspaceIcon } from './workspace-icon.tsx';
import { loadMessageReader } from './load-message-reader.ts';
import { ConversationImages } from './conversation-images.tsx';
import { activityRange } from './turn-timeline.ts';

function activityLabel(turn: TurnSummary) {
  const stopped = turn.status === 'interrupted';
  if (typeof turn.durationMs === 'number' && Number.isFinite(turn.durationMs) && (turn.durationMs > 0 || stopped)) {
    const seconds = Math.max(stopped ? 0 : 1, Math.round(turn.durationMs / 1000));
    const minutes = Math.floor(seconds / 60);
    return (stopped ? 'You stopped after ' : 'Worked for ') +
      (minutes ? minutes + 'm' + (seconds % 60 ? ' ' + seconds % 60 + 's' : '') : seconds + 's');
  }
  if (stopped) return 'You stopped';
  const messages = turn.items.filter(isActivity).filter(item => item.type === 'agentMessage').length;
  return messages + (messages === 1 ? ' previous message' : ' previous messages');
}

const elapsedUnits = [['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]] as const;
const elapsedFormats = new Map<string, Intl.NumberFormat>();
function WorkingLabel({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let timer: number | undefined;
    const update = () => setNow(Date.now());
    const syncVisibility = () => {
      window.clearInterval(timer);
      if (document.hidden) return;
      update();
      timer = window.setInterval(update, 1_000);
    };
    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', syncVisibility);
    };
  }, []);
  let seconds = Math.floor(now / 1000 - startedAt);
  if (seconds < 1) return 'Working';
  const locale = document.documentElement.lang || 'en';
  const parts: string[] = [];
  for (const [unit, scale] of elapsedUnits) {
    const count = Math.floor(seconds / scale);
    if (!count) continue;
    seconds %= scale;
    const key = locale + ':' + unit;
    let formatter = elapsedFormats.get(key);
    if (!formatter) {
      formatter = new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'narrow' });
      elapsedFormats.set(key, formatter);
    }
    parts.push(formatter.format(count));
  }
  return 'Working for ' + parts.join(' ');
}

type ActivityHeading = { title: ReactNode; openTitle?: string; icon?: ReactNode; status?: unknown };
function ActivityDetails({ title, openTitle, icon, status, grouped, onOpen, children }: ActivityHeading & {
  grouped?: boolean; onOpen?(): void; children(): ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  return <div className="yard-source-activity-item">
    <button type="button" className="yard-source-activity-summary" data-activity-status={status === 'inProgress' ? 'running' : undefined}
      data-grouped={grouped ? '' : undefined}
      title={typeof title === 'string' ? title : undefined}
      data-source-inspect aria-expanded={open} aria-controls={open ? detailId : undefined} onClick={() => {
        if (!open) onOpen?.();
        setOpen(!open);
      }}>
      {icon}<span>{open && openTitle ? openTitle : status === 'inProgress' && typeof title === 'string'
        ? <ActivityShimmer text={title} /> : title}</span><WorkspaceIcon name="toolChevron" className="yard-source-activity-caret" size={14} />
    </button>
    {open && <div id={detailId} className="yard-source-activity-detail">{children()}</div>}
  </div>;
}

function displayedCommand(command: string) {
  const wrapped = command.trim().match(/^(?:\/bin\/)?(?:bash|zsh)\s+-lc\s+([\s\S]+)$/);
  if (!wrapped) return command;
  const argument = wrapped[1]!;
  if (argument.startsWith("'") && argument.endsWith("'")) return argument.slice(1, -1).replace(/'"'"'/g, "'");
  if (argument.startsWith('"') && argument.endsWith('"')) return argument.slice(1, -1).replace(/\\"/g, '"');
  return argument;
}

function ShellOutput({ item, command }: { item: ThreadItemSummary; command: string }) {
  const [commandExpanded, setCommandExpanded] = useState(false);
  const output = typeof item.aggregatedOutput === 'string' ? item.aggregatedOutput : '';
  const hasOutput = /\S/.test(output);
  const running = item.status === 'inProgress';
  const stopped = item.status === 'interrupted' || item.status === 'declined';
  const success = item.status === 'completed' && item.exitCode === 0;
  return <section className="yard-source-shell-log bg-secondary-soft-alpha" aria-label="Shell">
    <header>Shell</header>
    <div className="yard-source-activity-command">
      <button type="button" className="yard-source-shell-command-line" aria-expanded={commandExpanded}
        aria-label={'$ ' + command} onClick={() => setCommandExpanded(value => !value)}>
        <span aria-hidden="true">$</span><code>{command}</code>
      </button>
      <MessageCopy label="Copy command" text={command} />
    </div>
    <div className="yard-source-shell-output">
      <div className="yard-source-shell-output-scroll" role="region" aria-label="Command output" tabIndex={0}>
        <pre><code>{hasOutput ? output : running ? '' : 'No output'}</code></pre>
      </div>
      {hasOutput && <MessageCopy label="Copy output" text={output} />}
    </div>
    <footer>{!running && (success ? <><WorkspaceIcon name="toolSuccess" size={12} />Success</> :
      stopped ? item.status === 'declined' ? 'Declined' : 'Stopped' :
      'Exit code ' + (typeof item.exitCode === 'number' ? item.exitCode : 'unknown'))}</footer>
  </section>;
}

function OutputText({ label, text }: { label: string; text: string }) {
  return <div className="yard-source-activity-output">
    <pre aria-label={label} tabIndex={0}>{text}</pre>
    <MessageCopy label={'Copy ' + label.toLowerCase()} text={text} />
  </div>;
}

export function fileChangeSummary(path: string, diff: unknown) {
  const end = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1;
  const directory = path.slice(0, end), name = path.slice(end);
  let added = 0, removed = 0;
  if (typeof diff === 'string') for (const line of diff.split('\n')) {
    if (/^\+(?!\+\+ )/.test(line)) added++;
    else if (/^-(?!-- )/.test(line)) removed++;
  }
  return { directory, name, added, removed };
}

function humanize(value: unknown) {
  return typeof value === 'string' ? value.replace(/[_-]+/g, ' ').trim() : '';
}

function sentence(text: string) { return text.charAt(0).toUpperCase() + text.slice(1); }

function ToolResult({ item }: { item: ThreadItemSummary }) {
  const result = record(item.result), error = record(item.error);
  const content = item.contentItems;
  return <>
      {typeof item.activityProgress === 'string' && item.status === 'inProgress' && <p role="status">{item.activityProgress}</p>}
      {item.arguments != null && <OutputText label="Arguments" text={JSON.stringify(item.arguments, null, 2)} />}
      {Array.isArray(content) && content.map((value, index) => {
        const part = record(value);
        return (part.type === 'text' || part.type === 'inputText') && typeof part.text === 'string'
          ? <OutputText key={index} label="Tool output" text={part.text} /> : null;
      })}
      {result.structuredContent != null && <OutputText label="Structured result" text={JSON.stringify(result.structuredContent, null, 2)} />}
      {typeof error.message === 'string' && <p role="alert">{error.message}</p>}
  </>;
}

function commandAction(item: ThreadItemSummary) {
  return Array.isArray(item.commandActions) && item.commandActions.length === 1 ? record(item.commandActions[0]) : {};
}

function toolHeading(item: ThreadItemSummary, status = item.status): ActivityHeading {
  if (item.type === 'commandExecution' && typeof item.command === 'string') {
    const verb = status === 'inProgress' ? 'Running ' : status === 'declined' ? 'Declined ' :
      status === 'interrupted' ? 'Stopped ' : 'Ran ';
    const action = commandAction(item), live = status === 'inProgress';
    if (live || status === 'completed') {
      if (action.type === 'read' && typeof action.name === 'string') return {
        title: (live ? 'Reading ' : 'Read ') + action.name, icon: <WorkspaceIcon name="toolRead" />, status };
      if (action.type === 'listFiles') return {
        title: (live ? 'Listing files' : 'Listed files') + (typeof action.path === 'string' && action.path ? ' in ' + action.path : ''),
        icon: <WorkspaceIcon name="project:folder" />, status };
      if (action.type === 'search') return {
        title: (live ? 'Searching for ' : 'Searched for ') + (typeof action.query === 'string' && action.query || 'files') +
          (typeof action.path === 'string' && action.path ? ' in ' + action.path : ''),
        icon: <WorkspaceIcon name="toolFind" />, status };
    }
    return { title: verb + item.command, openTitle: verb + 'command',
      icon: <WorkspaceIcon name={status === 'interrupted' ? 'toolStop' : 'project:terminal'} />, status };
  }
  if (item.type === 'fileChange') {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    const rejected = changes.map(record).filter(change => typeof change.path === 'string');
    const file = rejected.length === 1 ? fileChangeSummary(String(rejected[0]!.path), rejected[0]!.diff) : undefined;
    const title = item.status === 'declined' ? (file ? <>Rejected <span className="yard-source-edit-name">{file.name}</span> +{file.added} -{file.removed}</> :
      'Rejected file changes') : item.status === 'inProgress' ? 'Editing files' : item.status === 'failed' ? 'File changes failed' : 'Changed files';
    return { title, icon: <WorkspaceIcon name="project:edit" />, status };
  }
  if (item.type === 'webSearch') {
    const action = record(item.action), running = status === 'inProgress';
    const query = typeof item.query === 'string' && item.query || typeof action.query === 'string' && action.query || '';
    const title = action.type === 'openPage' ? (running ? 'Opening page' : 'Opened page') :
      action.type === 'findInPage' ? (running ? 'Finding in page' : 'Searched within page') :
        (running ? 'Searching the web' : 'Searched the web') + (query ? ' for ' + query : '');
    return { title, icon: <WorkspaceIcon name="project:globe" />, status };
  }
  return { title: sentence(humanize(item.tool)), icon: item.type === 'mcpToolCall' ? <WorkspaceIcon name="toolMcp" /> : undefined, status };
}

function ToolContent({ item }: { item: ThreadItemSummary }) {
  if (item.type === 'commandExecution' && typeof item.command === 'string') {
    return <ShellOutput item={item} command={displayedCommand(item.command)} />;
  }
  if (item.type === 'fileChange') {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    return <>
        <ul>{changes.map((value, index) => {
          const change = record(value), kind = record(change.kind);
          if (typeof change.path !== 'string') return null;
          return <li key={change.path + ':' + index}>
            <div className="yard-source-activity-file"><code>{change.path}</code>
              {typeof kind.move_path === 'string' && <code>{kind.move_path}</code>}
              <span className="text-tertiary">{kind.type === 'add' ? 'Added' : kind.type === 'delete' ? 'Deleted' : 'Modified'}</span>
            </div>
            {typeof change.diff === 'string' && change.diff && <OutputText label="Diff" text={change.diff} />}
          </li>;
        })}</ul>
        {typeof item.activityOutput === 'string' && <OutputText label="Patch output" text={item.activityOutput} />}
      </>;
  }
  return item.type === 'mcpToolCall' ? <McpCallOutput item={item} /> : <ToolResult item={item} />;
}

function ActivityItem({ item, live, threadId, hostId, subagents, openSubagent }: {
  item: ThreadItemSummary; live: boolean; threadId: string; hostId: string;
  subagents: ReadonlyMap<string, ThreadSummary>; openSubagent?: OpenSubagent;
}) {
  if (item.type === 'imageView') {
    const paths = Array.isArray(item.imagePaths) ? item.imagePaths.filter((path): path is string => typeof path === 'string')
      : typeof item.path === 'string' ? [item.path] : [];
    return <ActivityDetails icon={<WorkspaceIcon name="toolImage" />}
      title={paths.length === 1 ? 'Viewed an image' : 'Viewed ' + paths.length + ' images'}>
      {() => <ConversationImages images={paths.map(path => ({ path, name: path.split(/[\\/]/).at(-1) || 'image.png' }))}
        hostId={hostId} label="Inspected image" className="yard-source-inspected-images" />}
    </ActivityDetails>;
  }
  if (isRequestActivity(item) && item.type === 'yardInputRequest') {
    const noun = item.questions.length === 1 ? 'question' : 'questions';
    const answers = item.answers;
    if (!answers) return <p className="yard-source-waiting-activity">Asking {noun}</p>;
    return <ActivityDetails title={<>Asked <span className="yard-source-request-count">{item.questions.length} {noun}</span></>}
      icon={<WorkspaceIcon name="toolQuestion" />}>
      {() => <div className="yard-source-request-detail yard-source-question-detail">
        {item.questions.map(({ id, question }, index) => <div className="yard-source-question-answer" key={id}>
          <p dir="auto">{question}</p>
          <p dir="auto" className="yard-source-request-result">{answers[index] ?? 'No answer provided'}</p>
        </div>)}
      </div>}
    </ActivityDetails>;
  }
  if (isRequestActivity(item) && item.type === 'yardMcpRequest') {
    if (!item.outcome) return <p className="yard-source-waiting-activity" dir="auto">{item.serverName} requests information</p>;
    const action = item.outcome === 'accept' ? 'Accepted' : item.outcome === 'decline' ? 'Declined' :
      item.outcome === 'cancel' ? 'Cancelled' : 'Completed';
    return <ActivityDetails title={item.serverName + ' requested information'} icon={<WorkspaceIcon name="toolHand" />}>
      {() => <div className="yard-source-request-detail">
        {typeof item.message === 'string' && item.message && <p dir="auto">{item.message}</p>}
        <p className="yard-source-request-result">{action}</p>
      </div>}
    </ActivityDetails>;
  }
  if (item.type === 'agentMessage' && typeof item.text === 'string') return <article>
    <h4 className="sr-only">ChatGPT said:</h4><MessageBody text={item.text} streaming={live} />
  </article>;
  if (item.type === 'plan' && typeof item.text === 'string') return <MessageBody text={item.text} streaming={live} />;
  if (item.type === 'collabAgentToolCall') {
    const ids = receivers(item, threadId);
    const action = item.tool;
    const status = item.status;
    const title = action === 'spawnAgent' ? status === 'inProgress' ? 'Creating an agent' : status === 'failed' ? 'Could not create agent' :
      ids.length > 1 ? 'Created ' + ids.length + ' agents' : 'Created an agent'
      : action === 'resumeAgent' ? 'Resumed an agent' : action === 'closeAgent' ? 'Closed an agent' :
        action === 'interruptAgent' ? 'Interrupted an agent' : 'Sent a message to an agent';
    return <ActivityDetails icon={<WorkspaceIcon name="toolAgent" />} title={title} status={status}>
      {() => <div className="yard-source-agent-task">
        {typeof item.prompt === 'string' && item.prompt && <MessageBody text={item.prompt} />}
        {ids.map(id => <AgentLink key={id} id={id} name={subagentTitle(subagents.get(id))} open={openSubagent} />)}
      </div>}
    </ActivityDetails>;
  }
  return null;
}

const groupedTools = new Set(['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'webSearch']);
type ActivityBlock = { key: string; item: ThreadItemSummary; appUri?: string } | { key: string; tools: ThreadItemSummary[] };

function groupImageViews(items: readonly ThreadItemSummary[]) {
  const grouped: ThreadItemSummary[] = [];
  for (const item of items) {
    const previous = grouped.at(-1);
    if (item.type === 'imageView' && previous?.type === 'imageView') {
      grouped[grouped.length - 1] = { ...previous,
        imagePaths: [...(Array.isArray(previous.imagePaths) ? previous.imagePaths : [previous.path]), item.path] };
    } else grouped.push(item);
  }
  return grouped;
}
function activityBlocks(items: readonly ThreadItemSummary[], live: boolean) {
  const blocks: ActivityBlock[] = [];
  for (const item of items) {
    const tail = blocks.at(-1);
    const appUri = (live || item.status !== 'inProgress') ? mcpAppUri(item) : undefined;
    if (appUri) blocks.push({ key: item.id, item, appUri });
    else if (!groupedTools.has(item.type)) blocks.push({ key: item.id, item });
    else if (tail && 'tools' in tail) tail.tools.push(item);
    else blocks.push({ key: item.id, tools: [item] });
  }
  return blocks;
}

const SummaryHeading = lazy(async () => {
  try {
    const { latestReasoningHeading } = await loadMessageReader();
    return { default: ({ summary }: { summary: string }) =>
      <ActivityShimmer text={latestReasoningHeading(summary) ?? 'Thinking'} /> };
  } catch { return { default: () => <ActivityShimmer text="Thinking" /> }; }
});

function SummaryCaption({ item }: { item: ThreadItemSummary }) {
  const summary = Array.isArray(item.summary)
    ? item.summary.filter((line): line is string => typeof line === 'string').join('\n\n').trim() : '';
  return <Suspense fallback={<ActivityShimmer text="Thinking" />}><SummaryHeading summary={summary} /></Suspense>;
}

function ReadFileRow({ path, name }: { path: string; name: string }) {
  const workspace = useContext(WorkspaceOutputLinks);
  const file = workspace && workspaceOutputFromLink(path, workspace.cwd);
  return <div className="yard-source-activity-search">
    <WorkspaceIcon name="toolRead" /><span>Read {file && workspace ? <button type="button" title={path}
      className="yard-source-activity-file-link" onClick={() => workspace.open(file)}>{name}</button> : name}</span>
  </div>;
}

function ActivityTool({ item, onInspect }: { item: ThreadItemSummary; onInspect(): void }) {
  const heading = toolHeading(item);
  const action = item.type === 'commandExecution' ? commandAction(item) : undefined;
  if (item.status === 'completed' && action?.type === 'read' && typeof action.name === 'string' && typeof action.path === 'string') {
    return <ReadFileRow name={action.name} path={action.path} />;
  }
  if (item.type === 'webSearch') return <div className="yard-source-activity-search">{heading.icon}<span>{heading.title}</span></div>;
  const inspectable = item.type === 'commandExecution' || item.type === 'mcpToolCall';
  return <ActivityDetails {...heading} onOpen={inspectable ? onInspect : undefined}>
    {() => <ToolContent item={item} />}
  </ActivityDetails>;
}

function repeatableMcpKey(item: ThreadItemSummary) {
  if (item.type !== 'mcpToolCall' || item.status !== 'completed' || item.error != null ||
    typeof item.server !== 'string' || !item.server || item.server === 'computer-use' ||
    typeof item.tool !== 'string' || !item.tool) return;
  const result = record(item.result), app = record(item.appContext), meta = record(result._meta);
  if (!Array.isArray(result.content) || result.isError === true ||
    (item.server === 'codex_apps' && record(result.structuredContent).isError === true) ||
    item.mcpAppUi != null || item.mcpAppResourceUri != null || app.resourceUri != null ||
    meta['codex/toolSurface'] != null ||
    (Array.isArray(item.automaticApprovalReviews) && item.automaticApprovalReviews.some(value => record(value).status !== 'approved'))) return;
  return JSON.stringify([item.server, item.tool, item.pluginId, app.connectorId, app.linkId, app.actionName]);
}

function ActivityToolRows({ items, onInspect }: { items: ThreadItemSummary[]; onInspect(): void }) {
  const runs: ThreadItemSummary[][] = [];
  let previous: string | undefined;
  for (const item of items) {
    const key = repeatableMcpKey(item);
    if (key !== undefined && key === previous) runs.at(-1)!.push(item);
    else runs.push([item]);
    previous = key;
  }
  return runs.map(run => {
    const first = run[0]!;
    if (run.length === 1) return <ActivityTool key={first.id} item={first} onInspect={onInspect} />;
    const { icon, title } = toolHeading(first);
    return <ActivityDetails key={first.id} icon={icon}
      title={<span className="yard-source-repeat-tool"><span>{title}</span>{' '}<span>· {run.length} calls</span></span>}>
      {() => <div className="yard-source-repeat-tool-rows">
        {run.map(item => <ActivityTool key={item.id} item={item} onInspect={onInspect} />)}
      </div>}
    </ActivityDetails>;
  });
}

function ActivityGroup({ items, phase, thinkingCaption, onInspect }: {
  items: ThreadItemSummary[]; phase: 'active' | 'thinking' | 'summary'; thinkingCaption?: ThreadItemSummary; onInspect(): void;
}) {
  const first = items[0]!;
  let running: ThreadItemSummary | undefined;
  if (phase !== 'summary') for (let index = items.length - 1; index >= 0; index--) {
    if (items[index]!.status === 'inProgress') { running = items[index]; break; }
  }
  const [lastRunningId, setLastRunningId] = useState<string>();
  if (running && running.id !== lastRunningId) setLastRunningId(running.id);
  // Keep the last shell caption while its result settles. The expanded tool
  // still shows the actual outcome, even while the group is waiting for text.
  const last = items.at(-1);
  const settled = phase === 'active' && !running && last?.id === lastRunningId &&
    last?.type === 'commandExecution' && last.status === 'completed' ? last : undefined;
  // Pinned Xe/Ze keeps the final read/search/list caption while exploration
  // continues. Other live groups use the public thinking caption or Thinking.
  const exploration = phase === 'active' && last?.type === 'commandExecution' && last.status === 'completed' &&
    ['read', 'listFiles', 'search'].includes(String(commandAction(last)?.type)) ? last : undefined;
  const heading: ActivityHeading = running ? toolHeading(running)
    : exploration ? toolHeading(exploration, 'inProgress')
    : phase === 'active' && thinkingCaption ? { title: <SummaryCaption item={thinkingCaption} /> }
    : phase === 'thinking' ? { title: <ActivityShimmer text="Thinking" /> }
    : settled ? toolHeading(settled, 'inProgress')
    : phase === 'active' ? { title: <ActivityShimmer text="Thinking" /> }
    : items.length === 1 ? toolHeading(first) : groupHeading(items);
  const standaloneShell = phase === 'summary' && first.type === 'commandExecution' && first.status === 'completed' &&
    (!Array.isArray(first.commandActions) || first.commandActions.every(action => record(action).type === 'unknown'));
  if (items.length === 1 && (first.type === 'webSearch' || standaloneShell)) {
    return <ActivityTool item={first} onInspect={onInspect} />;
  }
  return <ActivityDetails {...heading} openTitle={undefined} grouped={items.length > 1 && phase === 'summary'}>
    {() => <div className="yard-source-live-activity vertical-scroll-fade-mask">
      <ActivityToolRows items={items} onInspect={onInspect} />
    </div>}
  </ActivityDetails>;
}

function groupHeading(items: ThreadItemSummary[]): ActivityHeading {
  const filePaths = new Set(items.flatMap(item => item.type === 'fileChange' && Array.isArray(item.changes) ?
    item.changes.flatMap(change => typeof record(change).path === 'string' ? [record(change).path] : []) : []));
  const edited = items.some(item => item.type === 'fileChange');
  const read = items.some(item => item.type === 'commandExecution' && Array.isArray(item.commandActions) &&
    item.commandActions.some(action => ['read', 'listFiles', 'search'].includes(String(record(action).type))));
  const ran = items.filter(item => item.type === 'commandExecution' && (!Array.isArray(item.commandActions) ||
    !item.commandActions.length || item.commandActions.some(action => record(action).type === 'unknown'))).length;
  const searched = items.some(item => item.type === 'webSearch');
  const providers = new Set(items.filter(item => item.type === 'mcpToolCall').map(item => sentence(humanize(item.server))).filter(Boolean));
  const dynamic = new Set(items.filter(item => item.type === 'dynamicToolCall').map(item => humanize(item.tool)).filter(Boolean));
  const labels = [...[...providers].map(provider => 'used ' + provider + ' integration'),
    edited && (filePaths.size === 1 ? 'edited a file' : 'edited files'),
    read && 'read files', ran > 0 && (ran === 1 ? 'ran a command' : 'ran commands'),
    searched && 'searched the web', ...dynamic].filter((value): value is string => !!value);
  const iconItem = providers.size ? items.find(item => item.type === 'mcpToolCall')
    : edited ? items.find(item => item.type === 'fileChange')
    : read ? items.find(item => item.type === 'commandExecution' && Array.isArray(item.commandActions) &&
      item.commandActions.some(action => ['read', 'listFiles', 'search'].includes(String(record(action).type))))
    : ran ? items.find(item => item.type === 'commandExecution')
    : searched ? items.find(item => item.type === 'webSearch') : undefined;
  return { title: sentence(labels.join(', ') || 'used tools'), icon: iconItem && toolHeading(iconItem).icon };
}

export function TurnActivity({ stream, turn, range, disclosure, showHeader = true, toolInspected, awaitingEdit, pendingRequest, waitingForInput, externalInput,
  subagents = emptySubagents, openSubagent }: {
  stream: TurnStream; turn: WorkspaceTurn; toolInspected: boolean; awaitingEdit?: string; pendingRequest?: boolean;
  range?: { after?: string; before?: string };
  disclosure?: { expanded?: boolean; change(expanded: boolean): void }; showHeader?: boolean;
  waitingForInput?: boolean; externalInput?: Elicitation; subagents?: ReadonlyMap<string, ThreadSummary>; openSubagent?: OpenSubagent;
}) {
  const { threadId } = stream;
  const bodyId = useId();
  const [localExpanded, setExpanded] = useState<boolean>();
  const expanded = disclosure?.expanded ?? localExpanded;
  const [snapshot, setSnapshot] = useState<ThreadItemSummary[]>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const loading = useRef(false);
  const ongoing = turn.status === 'inProgress';
  const live = ongoing && range?.before === undefined, full = turn.itemsView === 'full';
  useEffect(() => { if (live) void loadMessageReader().catch(() => {}); }, [live]);
  const receipts = useSyncExternalStore(subscribeRequestActivity, () => readRequestActivity({ hostId: stream.hostId, threadId, turnId: turn.id }));
  const knownSources = useSyncExternalStore(stream.subscribe, () => stream.readSources().get(turn.id));
  let turnItems = snapshot ?? turn.items;
  if (!snapshot && !full && !live && knownSources) {
    // A summary omits the saved tool items. Keep already rendered app views
    // connected until a full history read can replace their source items.
    const saved = new Set(turnItems.map(item => item.id));
    const appItems = knownSources.filter(item => !saved.has(item.id) && item.status === 'completed' && mcpAppUri(item));
    if (appItems.length) turnItems = [...turnItems, ...appItems];
  }
  const ordered = insertRequestActivity(turnItems, receipts);
  const sourceItems = groupImageViews(range ? activityRange(ordered, range.after, range.before) : ordered);
  const agents = collectTurnAgents(sourceItems, threadId);
  const items = sourceItems.filter(item => {
    if (!isActivity(item) || item.id === awaitingEdit) return false;
    if (item.type === 'agentMessage' || item.type === 'plan') return typeof item.text === 'string' && !!item.text.trim();
    if (item.type === 'reasoning') return Array.isArray(item.summary) && item.summary.some(Boolean);
    if (item.type === 'imageView') return typeof item.path === 'string';
    if (isRequestActivity(item)) return true;
    if (item.type === 'collabAgentToolCall') return item.senderThreadId === threadId &&
      ['spawnAgent', 'resumeAgent', 'closeAgent', 'interruptAgent', 'sendInput', 'sendMessage', 'followupTask'].includes(String(item.tool));
    return groupedTools.has(item.type);
  });
  const hasAnswer = sourceItems.some(item => item.type === 'agentMessage' && !isActivity(item) &&
    typeof item.text === 'string' && item.text.trim());
  const trackThought = live && !hasAnswer;
  const latestThought = trackThought ? items.filter(item => item.type === 'reasoning').at(-1) : undefined;
  // The pinned default transcript uses reasoning only for its live fallback
  // caption. It does not insert summary disclosures into saved Work activity.
  const blocks = activityBlocks(items.filter(item => item.type !== 'reasoning'), live);
  const tail = blocks.at(-1);
  const toolThought = latestThought && tail && 'tools' in tail &&
    items.indexOf(latestThought) > items.indexOf(tail.tools.at(-1)!) ? latestThought : undefined;
  const hasApp = blocks.some(block => 'appUri' in block && !!block.appUri);
  const showThought = latestThought && (!tail || 'item' in tail) && !items.some(item => item.status === 'inProgress' && groupedTools.has(item.type)) &&
    !pendingRequest && !waitingForInput && !turn.retryMessage;
  let lastToolIndex = blocks.length - 1;
  while (lastToolIndex >= 0) {
    const block = blocks[lastToolIndex]!;
    if ('tools' in block) break;
    if (block.item.type !== 'agentMessage' || block.item.phase !== 'commentary') {
      lastToolIndex = -1;
      break;
    }
    lastToolIndex--;
  }
  const lastToolBlock = blocks[lastToolIndex], beforeTools = blocks[lastToolIndex - 1];
  // Progress after a shell-only group can keep that group's live heading.
  // Mixed operations and an inline request receipt keep a completed summary.
  const toolFollowup = live && !hasAnswer && !showThought && !pendingRequest && !waitingForInput && !turn.retryMessage &&
    lastToolIndex < blocks.length - 1 && lastToolBlock && 'tools' in lastToolBlock &&
    lastToolBlock.tools.every(item => item.type === 'commandExecution' &&
      (!Array.isArray(item.commandActions) || item.commandActions.every(action => record(action).type === 'unknown'))) &&
    !(beforeTools && 'item' in beforeTools && isRequestActivity(beforeTools.item));
  const failed = turn.status === 'failed', stopped = turn.status === 'interrupted';
  const hasActivity = items.some(item => !isRequestActivity(item) || !isPendingActivity(item)) || agents.size > 0 ||
    live && sourceItems.some(item => item.type === 'imageGeneration' && (item.status === 'inProgress' || item.status === 'in_progress'));
  const pendingActivity = sourceItems.filter(isRequestActivity).filter(isPendingActivity);
  const hasPendingInput = pendingActivity.some(item => item.type === 'yardInputRequest');
  const hasPendingMcp = pendingActivity.some(item => item.type === 'yardMcpRequest' && item.serverName === externalInput?.serverName);
  const open = failed || (expanded ?? (ongoing ? !!waitingForInput || hasActivity || !!turn.retryMessage
    : toolInspected || stopped && hasActivity));
  const inspectTool = () => stream.inspectTool(turn.id);
  const thinking = live && !hasActivity && !pendingRequest;
  const foldedProgress = live && !open && !hasAnswer
    ? items.filter(item => item.type === 'agentMessage' && item.phase === 'commentary').at(-1) : undefined;
  const load = useCallback(async () => {
    if (loading.current || snapshot || full || ongoing) return;
    loading.current = true;
    setPending(true); setError(undefined);
    try { setSnapshot(await stream.readActivity(turn.id, readTurnActivity)); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { loading.current = false; setPending(false); }
  }, [snapshot, full, ongoing, stream, turn.id]);
  useEffect(() => { if (open && !error) void load(); }, [open, error, load]);
  const retry = range?.before === undefined && turn.retryMessage && <p className="yard-source-waiting-activity" dir="auto">
    <WorkspaceIcon name="toolRetry" />{turn.retryMessage}
  </p>;
  const body = <>
    {open && pending && !hasActivity && <p role="status">Loading activity…</p>}
    {open && error && <p role="alert">{error} <button type="button" className="underline" onClick={() => void load()}>Retry</button></p>}
    {open && retry}
    {blocks.map((block, index) => {
      if ('appUri' in block && block.appUri) {
        return <McpAppCard key={block.key + ':' + block.appUri} uri={block.appUri} item={block.item} threadId={threadId} hostId={stream.hostId} />;
      }
      if (!open) return null;
      return 'tools' in block ?
        <ActivityGroup key={block.key} items={block.tools} thinkingCaption={index === blocks.length - 1 ? toolThought : undefined}
          onInspect={inspectTool} phase={toolFollowup && index === lastToolIndex ? 'thinking' :
          live && !hasAnswer && index === blocks.length - 1 ? 'active' : 'summary'} /> :
        <ActivityItem key={block.key} item={block.item} live={live} threadId={threadId} hostId={stream.hostId}
          subagents={subagents} openSubagent={openSubagent} />;
    })}
    {open && agents.size > 0 && <div className="yard-source-agent-task">
      {[...agents].map(([id, status]) => <AgentLink key={id} id={id} name={subagentTitle(subagents.get(id))}
        status={status} open={openSubagent} />)}
    </div>}
    {open && showThought && <div className="yard-source-reasoning-title" dir="auto"><SummaryCaption key={latestThought.id} item={latestThought} /></div>}
    {open && live && !thinking && !showThought && !pendingRequest && !turn.retryMessage && tail &&
      'item' in tail && !tail.appUri && !hasAnswer && !toolFollowup &&
      tail.item.type !== 'reasoning' && <p className="yard-source-thinking" role="status"><ActivityShimmer text="Thinking" /></p>}
  </>;
  if (failed) return hasActivity || turn.retryMessage || pending || error ?
    <div className="yard-source-turn-activity-body yard-source-terminal-activity" aria-busy={pending}>{body}</div> : null;
  const label = ongoing ? typeof turn.startedAt === 'number' && Number.isFinite(turn.startedAt)
    ? <WorkingLabel startedAt={turn.startedAt} /> : 'Working' : activityLabel(turn);
  const header = thinking && !turn.retryMessage ? null
    : stopped && !hasActivity && !turn.retryMessage && full ? <p className="yard-source-turn-activity-toggle">{label}</p>
    : live && !hasActivity && (!waitingForInput || externalInput !== undefined) ?
      turn.retryMessage ? null : <span className="yard-source-turn-activity-toggle">{label}</span>
    : <button type="button" data-source-inspect aria-controls={open ? bodyId : undefined} aria-expanded={open}
        className="yard-source-turn-activity-toggle" onClick={() => disclosure ? disclosure.change(!open) : setExpanded(!open)}>
        {label} <WorkspaceIcon name="toolChevron" size={14} />
      </button>;
  return <div className="yard-source-turn-activity">
    {showHeader && header && <div className="yard-source-turn-activity-header">{header}</div>}
    {thinking && !turn.retryMessage && <p className="yard-source-thinking" role="status"><ActivityShimmer text="Thinking" /></p>}
    {foldedProgress && <div className="yard-source-turn-activity-body">
      <ActivityItem item={foldedProgress} live={live} threadId={threadId} hostId={stream.hostId} subagents={subagents} />
      {!pendingRequest && !turn.retryMessage && <p className="yard-source-thinking" role="status"><ActivityShimmer text="Thinking" /></p>}
    </div>}
    {(open || hasApp) && <div id={bodyId} className="yard-source-turn-activity-body" aria-busy={pending}>
      {body}
      {open && thinking && turn.retryMessage && <p className="yard-source-thinking" role="status"><ActivityShimmer text="Thinking" /></p>}
      {open && waitingForInput && <>
        {externalInput === undefined
          ? !hasPendingInput && <p className="yard-source-waiting-activity">Asking questions</p>
          : !hasPendingMcp && <p className="yard-source-waiting-activity" dir="auto">{externalInput.mode === 'unsupportedForm'
            ? 'Awaiting approval' : externalInput.serverName + ' requests information'}</p>}
        <p className="yard-source-waiting-activity" role="status"><WorkspaceIcon name="toolWaiting" />Waiting for your answer</p>
      </>}
    </div>}
  </div>;
}
