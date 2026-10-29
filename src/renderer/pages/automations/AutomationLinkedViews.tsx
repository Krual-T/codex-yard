import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { translateKnown, useI18n } from '../../i18n/index.tsx';
import type { AutomationScope, Capability } from './model.ts';
import { errorMessage } from './model.ts';
import { readThroughOriginalBridge } from '../product-http-fallback.ts';
import './automations.css';

export interface SharedTaskPreview {
  postId: string;
  isOwner: boolean;
  sourceAutomationId: string | null;
  name: string;
  prompt: string;
  schedule: string;
}
export interface TaskShare { automationId: string; permalink: string | null }
export interface TaskRunView { automationId: string; run: { id: string; chatRef: { type: string; id: string } | null; description: string | null } | null }

export interface AutomationLinkedPorts {
  shareDialogEnabled?: boolean;
  canShare?: Capability;
  currentAccountId?: string | null;
  runAccess?: Capability;
  onLoadSharedTask?: (request: AutomationScope & { postId: string; signal: AbortSignal }) => Promise<SharedTaskPreview>;
  onLoadShare?: (request: AutomationScope & { automationId: string; signal: AbortSignal }) => Promise<TaskShare>;
  onLoadRun?: (request: AutomationScope & { automationId: string; runId: string | null; signal: AbortSignal }) => Promise<TaskRunView>;
  onOpenRun?: (request: AutomationScope & { automationId: string; runId: string; chatRef: { type: string; id: string }; replace: true;
    state: { navigationSource: unknown; sidebarArea: 'scheduled'; sidebarAutomationId: string; sidebarAutomationSource: 'cloud'; sidebarAutomationRunId: string; sidebarAutomationAccountId: string } }) => Promise<void>;
}

function ResourceView<T>({ title, load, check, children, onClose, dialog = false, navigationError, unavailable = 'This source is unavailable on the selected host.' }: {
  title: string; load?: (signal: AbortSignal) => Promise<T>; check(value: T): boolean; children(value: T, retry: () => void): ReactNode; onClose(): void; dialog?: boolean; unavailable?: string; navigationError?: string;
}) {
  const { t } = useI18n();
  const text = (value: string) => translateKnown(t, value);
  const [revision, setRevision] = useState(0);
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setValue(null); setError(null);
    if (!load) { setLoading(false); setError(unavailable); return () => controller.abort(); }
    setLoading(true);
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new DOMException('The selected page changed.', 'AbortError');
      return load(controller.signal);
    }).then(result => {
      if (!check(result)) throw new Error('The response does not match this page.');
      if (!controller.signal.aborted) setValue(result);
    }).catch(cause => { if (!controller.signal.aborted) setError(errorMessage(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [load, revision, unavailable]);
  useEffect(() => {
    const element = dialogRef.current;
    if (dialog && element && !element.open) element.showModal();
    return () => { if (element?.open) element.close(); };
  }, [dialog]);
  const retry = () => setRevision(value => value + 1);
  const content = <><header><h2>{text(title)}</h2><button type="button" onClick={onClose}>{t('Close')}</button></header>
    {navigationError && <p role="alert">{navigationError}</p>}
    {loading && <p role="status">{text('Loading...')}</p>}
    {error && <div role="alert">{text(error)} <button type="button" disabled={!load || loading} onClick={retry}>{t('Retry')}</button></div>}
    {value !== null && children(value, retry)}</>;
  return dialog ? <dialog ref={dialogRef} className="yard-automation-dialog" onCancel={event => { event.preventDefault(); onClose(); }}>{content}</dialog> :
    <section className="yard-automation-linked">{content}</section>;
}

type ScopeProps = { scope: AutomationScope; ports: AutomationLinkedPorts; onClose(): void; navigationError?: string; unavailable?: string };
export function SharedTaskDialog({ scope, ports, postId, onClose, onOwner, navigationError, unavailable }: ScopeProps & { postId: string; onOwner(automationId: string): void }) {
  const { t } = useI18n();
  const load = ports.onLoadSharedTask;
  const request = useCallback((signal: AbortSignal) => load ? load({ ...scope, postId, signal }) : readThroughOriginalBridge({ kind: 'shared-task', postId }, signal), [load, scope.hostId, scope.accountKey, scope.installationKey, scope.sessionKey, postId]);
  return <ResourceView title="Shared with you" dialog onClose={onClose} navigationError={navigationError} unavailable={unavailable} load={unavailable ? undefined : request} check={task => !!task && task.postId === postId && typeof task.isOwner === 'boolean' &&
    (task.sourceAutomationId === null || typeof task.sourceAutomationId === 'string') && typeof task.name === 'string' && typeof task.prompt === 'string' && typeof task.schedule === 'string'}>
    {task => task.isOwner && task.sourceAutomationId ? <OwnerRedirect automationId={task.sourceAutomationId} onOwner={onOwner} navigationError={navigationError} /> : <>
      <h3>{task.name}</h3><p>{task.prompt}</p><p>{task.schedule}</p>
      <p>{translateKnown(t, 'Saving this shared task is unavailable for this session.')}</p></>}
  </ResourceView>;
}

function OwnerRedirect({ automationId, onOwner, navigationError }: { automationId: string; onOwner(id: string): void; navigationError?: string }) {
  const { t } = useI18n();
  const started = useRef(false);
  useEffect(() => { if (!started.current) { started.current = true; onOwner(automationId); } }, [automationId, onOwner]);
  return navigationError ? <button type="button" onClick={() => onOwner(automationId)}>{translateKnown(t, 'Retry opening task')}</button> : <p role="status">{translateKnown(t, 'Opening your scheduled task...')}</p>;
}

export function TaskShareDialog({ scope, ports, automationId, onClose, navigationError, unavailable }: ScopeProps & { automationId: string | null }) {
  const { t } = useI18n();
  const load = ports.onLoadShare;
  const request = useCallback((signal: AbortSignal) => load ? load({ ...scope, automationId: automationId!, signal }) : readThroughOriginalBridge({ kind: 'task-share', automationId: automationId! }, signal), [load, scope.hostId, scope.accountKey, scope.installationKey, scope.sessionKey, automationId]);
  if (ports.shareDialogEnabled !== true || !ports.canShare?.allowed || automationId === null) return <ResourceView title="Share task" dialog onClose={onClose} navigationError={navigationError}
    unavailable={unavailable ?? (automationId === null ? 'A scheduled task is required to share.' : ports.shareDialogEnabled !== true ? 'Sharing feature availability has not been established.' : ports.canShare?.allowed === false ? ports.canShare.reason : 'Sharing permission has not been established.')} check={() => false}>
    {() => null}</ResourceView>;
  return <ResourceView title="Share task" dialog onClose={onClose} navigationError={navigationError} load={request} check={share => !!share && share.automationId === automationId && (share.permalink === null || typeof share.permalink === 'string')}>
    {share => <>{share.permalink ? <p>{share.permalink}</p> : <p>{translateKnown(t, 'No shared link.')}</p>}
      <p>{translateKnown(t, 'Sharing changes are unavailable for this session.')}</p></>}
  </ResourceView>;
}

export function TaskRunPage({ scope, ports, automationId, runId, onClose, onNoConversation, navigationError, isCurrent, navigationSource }: ScopeProps & {
  automationId: string; runId: string; onNoConversation(): void; isCurrent(): boolean; navigationSource: unknown;
}) {
  const { t } = useI18n();
  const requestedRun = runId === 'latest' ? null : runId;
  const load = ports.onLoadRun;
  const request = useCallback((signal: AbortSignal) => load ? load({ ...scope, automationId, runId: requestedRun, signal }) : readThroughOriginalBridge({ kind: 'task-run', automationId, runId: requestedRun }, signal), [load, scope.hostId, scope.accountKey, scope.installationKey, scope.sessionKey, automationId, requestedRun]);
  const unavailable = ports.currentAccountId === undefined ? 'The scheduled task account has not been established.' : ports.currentAccountId === null ? 'A signed-in account is required to read this run.' :
    ports.runAccess?.allowed === false ? ports.runAccess.reason : !ports.runAccess?.allowed ? 'Scheduled task run access has not been established.' : undefined;
  return <main className="yard-automations"><div className="yard-automations-content"><ResourceView title="Scheduled task run" onClose={onClose} navigationError={navigationError} load={unavailable ? undefined : request} unavailable={unavailable}
    check={value => !!value && value.automationId === automationId && (value.run === null || typeof value.run.id === 'string' && !!value.run.id &&
      (requestedRun === null || value.run.id === requestedRun) && (value.run.description === null || typeof value.run.description === 'string') &&
      (value.run.chatRef === null || typeof value.run.chatRef.type === 'string' && !!value.run.chatRef.type && typeof value.run.chatRef.id === 'string' && !!value.run.chatRef.id))}>
    {(value, retry) => value.run?.chatRef ? <OpenRunButton scope={scope} automationId={automationId} run={value.run} onOpenRun={ports.onOpenRun} accountId={ports.currentAccountId!} navigationSource={navigationSource} isCurrent={isCurrent} /> :
      runId === 'latest' ? <EmptyRunRedirect onNoConversation={onNoConversation} navigationError={navigationError} /> : <><p>{translateKnown(t, 'This run has no chat available')}</p><button type="button" onClick={retry}>{t('Retry')}</button></>}
  </ResourceView></div></main>;
}

function EmptyRunRedirect({ onNoConversation, navigationError }: { onNoConversation(): void; navigationError?: string }) {
  const { t } = useI18n();
  const started = useRef(false);
  useEffect(() => { if (!started.current) { started.current = true; onNoConversation(); } }, [onNoConversation]);
  return navigationError ? <button type="button" onClick={onNoConversation}>{translateKnown(t, 'Retry opening task')}</button> : <p role="status">{translateKnown(t, 'Opening the scheduled task...')}</p>;
}

function OpenRunButton({ scope, automationId, run, onOpenRun, accountId, navigationSource, isCurrent }: { scope: AutomationScope; automationId: string; run: NonNullable<TaskRunView['run']>; onOpenRun?: AutomationLinkedPorts['onOpenRun']; accountId: string; navigationSource: unknown; isCurrent(): boolean }) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(false);
  const started = useRef(false);
  const open = () => { setError(null); void Promise.resolve().then(() => {
    if (!alive.current || !isCurrent() || !onOpenRun || !run.chatRef) return;
    return onOpenRun({ ...scope, automationId, runId: run.id, chatRef: run.chatRef, replace: true,
      state: { navigationSource, sidebarArea: 'scheduled', sidebarAutomationId: automationId, sidebarAutomationSource: 'cloud', sidebarAutomationRunId: run.id, sidebarAutomationAccountId: accountId } });
  })
    .catch(cause => { if (alive.current) setError(errorMessage(cause)); }); };
  useEffect(() => {
    alive.current = true;
    if (onOpenRun && !started.current) { started.current = true; open(); }
    return () => { alive.current = false; };
  }, [run.id, onOpenRun]);
  return <>{run.description && <p>{run.description}</p>}<button type="button" disabled={!onOpenRun} onClick={open}>{translateKnown(t, 'Open chat')}</button>{error && <p role="alert">{error}</p>}</>;
}
