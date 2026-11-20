import { ChevronDown, CornerDownLeft, Folder, Globe, Hand, Pencil, ShieldAlert, SquareTerminal } from 'lucide-react';
import { useSyncExternalStore, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import type { RpcId, ThreadItemSummary, TurnSummary } from '../../lib/codex-protocol.ts';
import { record } from '../native/protocol.ts';
import { respondToServerRequest } from './host.ts';
import { InputRequestCard, parseQuestions, type Question, type Answers } from './turn-input.tsx';
import { fileChangeSummary } from './turn-activity.tsx';
import { ToolMenu } from './new-tab-tools.tsx';
import { ElicitationCard, readElicitation, type Elicitation, type ElicitationReply } from './turn-elicitation.tsx';
import { clearRequestActivity, readDisplayAnswers, recordRequestActivity, settleRequestActivity,
  type DisplayAnswers } from './turn-request-activity.ts';

const decisionLabels = { decline: 'Deny', cancel: 'Cancel', acceptForSession: 'Allow for this session', accept: 'Allow once' } as const;
type Decision = keyof typeof decisionLabels;
type RequestScope = {
  id: RpcId;
  hostId: string;
  threadId: string;
  turnId: string | null;
  submitted?: boolean;
  error?: string;
};
type Command = RequestScope & {
  kind: 'command'; label: string; question: string; target: string; permissions?: string; decisions: readonly Decision[];
};
type FileEdit = RequestScope & { kind: 'file'; itemId: string; grantRoot?: string };
type Input = RequestScope & { kind: 'input'; questions: Question[]; blocking: boolean; submittedAnswers?: DisplayAnswers };
type GrantedProfile = { network?: { enabled: boolean }; fileSystem?: Record<string, unknown> };
type PermissionTarget = { path: string; access: 'read' | 'write' | 'deny' };
type Permission = RequestScope & {
  kind: 'permissions'; profile: GrantedProfile | null; paths: PermissionTarget[]; reason: string; cwd: string;
};
type PermissionReply = { permissions: GrantedProfile; scope: 'turn' | 'session'; strictAutoReview?: boolean };
type ExternalInput = RequestScope & { kind: 'mcp'; elicitation: Elicitation; submittedAction?: ElicitationReply['action'] };
type TurnRequest = Command | FileEdit | Permission | Input | ExternalInput;
const decisionOrder = Object.keys(decisionLabels) as Decision[];
let pending: readonly TurnRequest[] = [];
const listeners = new Set<() => void>();
function publish(next: readonly TurnRequest[]) {
  pending = next;
  for (const notify of listeners) notify();
}

function remove(match: (request: TurnRequest) => boolean, resolved = false) {
  const next = pending.filter(approval => !match(approval));
  if (next.length === pending.length) return;
  for (const request of pending) {
    if (request.turnId && (request.kind === 'mcp' || request.kind === 'input') && match(request)) {
      const result = !resolved ? undefined : request.kind === 'mcp' ? request.submittedAction : request.submittedAnswers;
      settleRequestActivity({ ...request, turnId: request.turnId }, result);
    }
  }
  publish(next);
}

function readPermissionProfile(value: unknown) {
  const asked = record(value);
  const profile: GrantedProfile = {};
  const targets = new Map<string, PermissionTarget>();
  let valid = Object.keys(asked).every(key => key === 'network' || key === 'fileSystem');
  function add(path: string, access: PermissionTarget['access']) {
    targets.set(JSON.stringify([path, access]), { path, access });
  }
  if (asked.network != null) {
    const network = record(asked.network);
    if (Object.keys(network).some(key => key !== 'enabled') || ![true, false, null].includes(network.enabled as boolean | null)) valid = false;
    if (typeof network.enabled === 'boolean') profile.network = { enabled: network.enabled };
  }
  if (asked.fileSystem != null) {
    const fileSystem = record(asked.fileSystem);
    if (Object.keys(fileSystem).some(key => !['read', 'write', 'entries', 'globScanMaxDepth'].includes(key))) valid = false;
    for (const access of ['read', 'write'] as const) {
      const paths = fileSystem[access];
      if (paths == null) continue;
      if (!Array.isArray(paths)) valid = false;
      else for (const path of paths) {
        if (typeof path !== 'string' || !path.trim()) valid = false;
        else add(path, access);
      }
    }
    if (fileSystem.entries != null) {
      if (!Array.isArray(fileSystem.entries)) valid = false;
      else for (const raw of fileSystem.entries) {
        const { path, access } = record(raw), spec = record(path);
        const special = record(spec.value);
        const name = spec.type === 'path' ? spec.path : spec.type === 'glob_pattern' ? spec.pattern : spec.type === 'special'
          ? special.kind === 'root' ? 'Entire filesystem' : special.kind === 'minimal' ? 'Minimal system paths' :
            special.kind === 'project_roots' ? 'Project roots' + (typeof special.subpath === 'string' ? '/' + special.subpath : '') :
            special.kind === 'tmpdir' ? 'System temporary directory' : special.kind === 'slash_tmp' ? '/tmp' : undefined
          : undefined;
        if (typeof name !== 'string' || !name.trim() || (access !== 'read' && access !== 'write' && access !== 'deny')) valid = false;
        else add(name, access);
      }
    }
    if (targets.size) profile.fileSystem = fileSystem;
  }
  const paths = [...targets.values()];
  return { paths, profile: valid && (profile.network?.enabled || paths.some(path => path.access !== 'deny')) ? profile : null };
}

window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== location.origin) return;
  const message = record(event.data);
  const { hostId } = message;
  if (typeof hostId !== 'string') return;
  if (message.type === 'codex-app-server-connection-changed' && message.state !== 'connected') {
    remove(approval => approval.hostId === hostId);
    return;
  }
  if (message.type === 'mcp-notification') {
    const params = record(message.params);
    if (message.method === 'serverRequest/resolved') {
      remove(approval => approval.hostId === hostId && approval.id === params.requestId && approval.threadId === params.threadId, true);
    }
    if (message.method === 'turn/completed') remove(approval => approval.hostId === hostId && approval.threadId === params.threadId && approval.turnId === record(params.turn).id);
    if (message.method === 'thread/closed') remove(approval => approval.hostId === hostId && approval.threadId === params.threadId);
    if (message.method === 'thread/reverted' && typeof params.threadId === 'string') {
      remove(approval => approval.hostId === hostId && approval.threadId === params.threadId);
      clearRequestActivity(hostId, params.threadId);
    }
    return;
  }
  if (message.type !== 'mcp-request') return;
  const request = record(message.request), params = record(request.params);
  const { id, method } = request, { threadId, turnId } = params;
  if ((typeof id !== 'string' && typeof id !== 'number') ||
      typeof threadId !== 'string' || pending.some(approval => approval.hostId === hostId && approval.id === id)) return;
  if (method === 'mcpServer/elicitation/request') {
    if (turnId == null || typeof turnId === 'string') {
      const elicitation = readElicitation(params);
      if (turnId && (elicitation.mode === 'form' || elicitation.mode === 'confirmation')) {
        recordRequestActivity({ id, hostId, threadId, turnId }, {
          type: 'yardMcpRequest', serverName: elicitation.serverName, message: elicitation.message,
        });
      }
      publish([...pending, { id, hostId, threadId, turnId: turnId ?? null, kind: 'mcp', elicitation }]);
    }
    return;
  }
  if (typeof turnId !== 'string') return;
  const scope = { id, hostId, threadId, turnId };
  if (method === 'item/permissions/requestApproval') {
    publish([...pending, { ...scope, kind: 'permissions', ...readPermissionProfile(params.permissions),
      reason: typeof params.reason === 'string' ? params.reason : '', cwd: typeof params.cwd === 'string' ? params.cwd : '' }]);
    return;
  }
  if (method === 'item/fileChange/requestApproval') {
    if (typeof params.itemId === 'string') publish([...pending, { ...scope, kind: 'file', itemId: params.itemId,
      grantRoot: typeof params.grantRoot === 'string' && params.grantRoot.trim() ? params.grantRoot : undefined }]);
    return;
  }
  if (method === 'item/tool/requestUserInput') {
    const questions = parseQuestions(params.questions);
    if (questions.length) {
      recordRequestActivity(scope, { type: 'yardInputRequest',
        questions: questions.map(({ id, question, secret }) => ({ id, question, secret })) });
      publish([...pending, { ...scope, kind: 'input', questions, blocking: params.isBlocking !== false }]);
    }
    return;
  }
  if (method !== 'item/commandExecution/requestApproval') return;
  const network = params.networkApprovalContext != null;
  const { host, protocol } = record(params.networkApprovalContext);
  const target = network ? typeof host === 'string' && typeof protocol === 'string' ? protocol + ': ' + host : ''
    : typeof params.command === 'string' ? params.command : '';
  const offered = Array.isArray(params.availableDecisions) ? params.availableDecisions : ['accept', 'decline'];
  const decisions = decisionOrder.filter(action => offered.includes(action) && (target || action === 'decline' || action === 'cancel'));
  const permissions = params.additionalPermissions && JSON.stringify(params.additionalPermissions, null, 2) || undefined;
  publish([...pending, { ...scope, kind: 'command', decisions, target, permissions: typeof permissions === 'string' ? permissions : undefined,
    label: network ? 'Network access' : 'Terminal', question: typeof params.reason === 'string' && params.reason.trim()
      ? params.reason : network ? 'Allow this network connection?' : 'Allow this command?' }]);
});

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => { listeners.delete(notify); };
}

export function useTurnRequests() {
  return useSyncExternalStore(subscribe, () => pending);
}

export function isBlockingRequest(request: TurnRequest) {
  return request.kind !== 'input' || request.blocking;
}

export function isInputRequest(request: TurnRequest) {
  return request.kind === 'input' || request.kind === 'mcp' &&
    (request.elicitation.mode === 'form' || request.elicitation.mode === 'confirmation' || request.elicitation.mode === 'unsupportedForm');
}

export function useTurnRequest(threadId?: string, hostId = 'local') {
  return useSyncExternalStore(subscribe, () => {
    if (!threadId) return undefined;
    return pending.find(item => item.hostId === hostId && item.threadId === threadId && isBlockingRequest(item))
      ?? pending.find(item => item.hostId === hostId && item.threadId === threadId);
  });
}

function reply(request: TurnRequest, result: { decision: Decision } | { answers: Answers } | PermissionReply | ElicitationReply) {
  const current = pending.find(item => item.hostId === request.hostId && item.id === request.id);
  if (current !== request || current.submitted) return false;
  const submitted = request.kind === 'mcp' && 'action' in result
    ? { ...request, submitted: true, error: undefined, submittedAction: result.action }
    : request.kind === 'input' && 'answers' in result
      ? { ...request, submitted: true, error: undefined, submittedAnswers: readDisplayAnswers(request.questions, result.answers) }
      : { ...request, submitted: true, error: undefined };
  publish(pending.map(item => item === current ? submitted : item));
  try {
    respondToServerRequest(request.id, result, request.hostId);
    return true;
  }
  catch (error) {
    publish(pending.map(item => item === submitted ? {
      ...request, submitted: true, error: error instanceof Error ? error.message : String(error),
    } : item));
    return false;
  }
}

function CommandApprovalCard({ approval }: { approval: Command }) {
  const Icon = approval.label === 'Terminal' ? SquareTerminal : Globe;
  return <section className="yard-source-approval" aria-label={approval.label + ' approval'} data-source-command-approval="">
    <div role="alert">
      <div className="yard-source-approval-kind"><Icon size={14} aria-hidden="true" />{approval.label}</div>
      <h3>{approval.question}</h3>
    </div>
    {approval.target && <pre>{approval.target}</pre>}
    {approval.permissions && <pre>{approval.permissions}</pre>}
    {approval.error && <p role="alert">{approval.error}</p>}
    <div className="yard-source-approval-actions" aria-busy={approval.submitted && !approval.error}>
      {approval.decisions.map(decision => <button key={decision} type="button" data-primary={decision === 'accept' || undefined}
        disabled={approval.submitted} onClick={() => reply(approval, { decision })}>{decisionLabels[decision]}</button>)}
    </div>
  </section>;
}

export function editForRequest(request: TurnRequest, turns: readonly TurnSummary[]): ThreadItemSummary | undefined {
  if (request.kind !== 'file') return undefined;
  return turns.find(turn => turn.id === request.turnId)?.items.find(item => item.id === request.itemId && item.type === 'fileChange');
}

function approvalKeys(deny: () => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && !event.defaultPrevented && !event.currentTarget.querySelector(':popover-open')) {
      event.preventDefault();
      deny();
    }
  };
}

function ApprovalActions({ request, canAccept, decide, session, sessionTitle, sessionIcon }: {
  request: RequestScope; canAccept: boolean; decide(decision: 'decline' | 'accept' | 'acceptForSession'): void;
  session: string; sessionTitle?: string; sessionIcon?: ReactNode;
}) {
  const choose = (event: MouseEvent<HTMLButtonElement>, decision: 'accept' | 'acceptForSession') => {
    event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover();
    decide(decision);
  };
  return <div className="yard-source-approval-actions" aria-busy={request.submitted && !request.error}>
    <button type="button" aria-label="Deny" disabled={request.submitted} onClick={() => decide('decline')}>Deny <kbd>Esc</kbd></button>
    <div className="yard-source-file-approval-primary">
      <button type="button" data-primary="" aria-label="Allow once" disabled={!canAccept || request.submitted}
        onClick={() => decide('accept')}>Allow once <kbd aria-hidden="true"><CornerDownLeft size={12} /></kbd></button>
      <ToolMenu label="Approval options" side="top" deferContent className="yard-source-file-approval-menu"
        triggerButton={<button type="button" data-primary="" aria-label="Approval options" title="Approval options"
          disabled={!canAccept || request.submitted}><ChevronDown size={13} aria-hidden="true" /></button>}>
        <button type="button" role="menuitem" onClick={event => choose(event, 'accept')}>Allow once</button>
        <button type="button" role="menuitem" title={sessionTitle} onClick={event => choose(event, 'acceptForSession')}>
          {session}{sessionIcon}
        </button>
      </ToolMenu>
    </div>
  </div>;
}

function PermissionApprovalCard({ request }: { request: Permission }) {
  const { profile, paths, reason, cwd } = request;
  function decide(decision: 'decline' | 'accept' | 'acceptForSession') {
    if (decision === 'decline') reply(request, { permissions: {}, scope: 'turn' });
    else if (profile) reply(request, { permissions: profile, scope: decision === 'accept' ? 'turn' : 'session', strictAutoReview: false });
  }
  const single = !profile?.network?.enabled && paths.length === 1 && paths[0]!.access !== 'deny' ? paths[0] : undefined;
  return <section className="yard-source-approval yard-source-permission-approval" aria-label="Permissions approval"
    tabIndex={-1} onKeyDown={approvalKeys(() => decide('decline'))}>
    <div role="alert">
      <div className="yard-source-approval-kind"><Hand size={14} aria-hidden="true" />
        {profile?.network?.enabled && !paths.length ? 'Internet access' : 'Permissions'}
      </div>
      <h3>{profile?.network?.enabled ? 'Allow ChatGPT to connect to the internet?' : single ?
        <>Allow ChatGPT to {single.access === 'write' ? 'edit' : 'read'} the contents of <span title={single.path} className="yard-source-permission-path">
          <Folder size={13} aria-hidden="true" />{cwd && single.path.startsWith(cwd + '/') ? single.path.slice(cwd.length + 1) : single.path}
        </span>?</> : 'Allow ChatGPT to access additional files?'}</h3>
      {reason && <p dir="auto">{reason}</p>}
      {!single && paths.length > 0 && <ul className="yard-source-permission-paths">{paths.map(target =>
        <li key={JSON.stringify([target.path, target.access])}><span>{target.access === 'deny' ? 'Excluded' : target.access === 'write' ? 'Edit' : 'Read'}</span>
          <code dir="auto">{target.path}</code></li>)}</ul>}
    </div>
    {!profile && <p role="status">This permission request is not supported.</p>}
    {request.error && <p role="alert">{request.error}</p>}
    <ApprovalActions request={request} canAccept={!!profile} decide={decide} session="Allow this conversation" />
  </section>;
}

function FileApprovalCard({ request, item }: { request: FileEdit; item?: ThreadItemSummary }) {
  const changes = (Array.isArray(item?.changes) ? item.changes : []).map(record)
    .filter((change): change is { path: string; diff?: unknown } => typeof change.path === 'string' && Boolean(change.path));
  const canAccept = changes.length > 0;
  const decide = (decision: Decision) => {
    if (decision === 'decline' || (canAccept && (decision === 'accept' || decision === 'acceptForSession'))) {
      reply(request, { decision });
    }
  };
  return <section className="yard-source-approval" aria-label="File edit approval" data-source-file-approval=""
    tabIndex={-1} onKeyDown={approvalKeys(() => decide('decline'))}>
    <div role="alert">
      <div className="yard-source-approval-kind"><Pencil size={14} aria-hidden="true" />Edit files</div>
      <h3>{changes.length > 1 ? 'Allow ChatGPT to edit the following files?' : 'Allow ChatGPT to edit the following file?'}</h3>
    </div>
    {canAccept ? <div className="yard-source-file-approval-paths">{changes.map(({ path, diff }, index) => {
      const { directory, name, added, removed } = fileChangeSummary(path, diff);
      return <div key={path + ':' + index} className="yard-source-file-approval-path" title={path}>
        <span dir="auto"><span>{directory}</span><strong>{name}</strong></span>
        <span><span className="yard-source-diff-added">+{added}</span> <span className="yard-source-diff-removed">-{removed}</span></span>
      </div>;
    })}</div> : <p role="status">Waiting for file changes…</p>}
    {request.error && <p role="alert">{request.error}</p>}
    <ApprovalActions request={request} canAccept={canAccept} decide={decide} session="Allow all edits" sessionTitle={request.grantRoot}
      sessionIcon={<ShieldAlert size={13} aria-hidden="true" />} />
  </section>;
}

export function TurnRequestCard({ request, edit, interrupt }: {
  request: TurnRequest; edit?: ThreadItemSummary; interrupt(turnId: string): void;
}) {
  if (request.kind === 'command') return <CommandApprovalCard approval={request} />;
  if (request.kind === 'file') return <FileApprovalCard request={request} item={edit} />;
  if (request.kind === 'permissions') return <PermissionApprovalCard request={request} />;
  if (request.kind === 'mcp') return <ElicitationCard request={request.elicitation} submitted={request.submitted} error={request.error}
    onReply={value => reply(request, value)} />;
  return <InputRequestCard questions={request.questions} submitted={request.submitted} error={request.error}
    onAnswer={answers => reply(request, { answers })}
    onDismiss={() => { if (reply(request, { answers: {} }) && request.turnId) interrupt(request.turnId); }} />;
}
