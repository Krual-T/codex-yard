import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { pluginEditNeedsRecovery, settingsConfigOperations, writeTerminalMessage } from './config-operations.ts';
import { saveRecoveredPluginEdit } from '../app/ProductPluginConfig.ts';
import { PluginEditRecovery } from './PluginEditRecovery.tsx';

export function ConfigurationRecovery({ client, hostId, captureAuthority, onPendingChange }: {
  client: WorkbenchClient; hostId?: string; captureAuthority?: (hostId: string) => (() => void);
  onPendingChange?: (pending: boolean) => void;
}) {
  const operations = settingsConfigOperations(client);
  const state = useSyncExternalStore(operations.subscribe, operations.getSnapshot, operations.getSnapshot);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingEdit, setPendingEdit] = useState(false);
  const reportPending = useCallback((value: boolean) => { setPendingEdit(value); onPendingChange?.(value); }, [onPendingChange]);
  const inFlight = useRef(false);
  useEffect(() => { void operations.refresh(); }, [operations]);
  const perform = async (id: string, action: () => Promise<void>) => {
    if (inFlight.current) throw new Error('Wait for the original recovery action to finish.');
    inFlight.current = true;
    setBusy(id); setError(null);
    try { await action(); } finally { inFlight.current = false; setBusy(null); }
  };
  const run = (id: string, action: () => Promise<void>) => { void perform(id, action).catch(reason => setError(reason instanceof Error ? reason.message : String(reason))); };
  const savedPluginEdits = state.drafts.filter(draft => draft.section === 'plugins-settings' && draft.editorId.startsWith('recovered:'));
  if (!pendingEdit && !state.records.length && !savedPluginEdits.length && !state.error && !error && !state.localRetry.length && !state.draftRetry.length) return null;
  return <section className="yard-setting-error" aria-label="Configuration save recovery">
    <h3>Configuration save recovery</h3>
    {state.error && <p role="alert">{state.error} <button type="button" disabled={busy !== null || state.loading}
      onClick={() => run('refresh', () => operations.refresh())}>Retry reading original operations</button></p>}
    {error && <p role="alert">{error}</p>}
    <PluginEditRecovery drafts={savedPluginEdits} activeHostId={hostId ?? 'local'}
      onPendingChange={reportPending}
      disabled={state.loading || !!state.error || state.draftPending > 0}
      saveDisabled={!captureAuthority || busy !== null || state.inFlight.length > 0
        || state.records.some(item => item.phase === 'pending' || item.phase === 'unknown' || item.phase === 'blocked')}
      onSave={draft => {
        const assertOriginal = captureAuthority?.(draft.hostId);
        if (!assertOriginal) return Promise.reject(new Error('The original settings page authority is unavailable.'));
        assertOriginal();
        return perform(draft.editorId, () => saveRecoveredPluginEdit(operations, client, draft, () => {
          try { assertOriginal(); return true; } catch { return false; }
        }));
      }} onEdit={(draft, enabled) => operations.editRecoveredPluginDraft(draft, enabled)}
      onDiscard={draft => operations.discardDraft(draft)} />
    {state.draftRetry.map(editorId => <p key={editorId}>A newer edit is still in this page.{' '}
      <button type="button" disabled={busy !== null} onClick={() => run(editorId, () => operations.retryDraft(editorId))}>Retry saving browser edit</button></p>)}
    {state.localRetry.filter(id => !state.records.some(item => item.operationId === id)).map(id => <p key={id}>The original browser receipt is still in this page.{' '}
      <button type="button" disabled={busy !== null} onClick={() => run(id, () => operations.retryLocal(id))}>Retry saving browser receipt</button>{' '}
      <button type="button" disabled={busy !== null} onClick={() => run(id, () => operations.dismissClosedLocal(id))}>Dismiss receipt for closed operation</button></p>)}
    {state.records.map(item => {
      const unresolved = item.phase === 'pending' || item.phase === 'unknown' || item.phase === 'blocked';
      const target = item.phase === 'blocked' ? item.blocker : item.operation;
      const terminal = item.operation?.terminal ?? item.operation?.observedTerminal;
      const targetTerminal = target?.terminal ?? target?.observedTerminal;
      const receipt = item.phase === 'blocked' ? item.blockerReceipt : item.recoveryReceipt;
      const targetHost = item.phase === 'blocked' ? item.blocker?.hostId ?? item.hostId : item.hostId;
      const originalEdit = pluginEditNeedsRecovery(item), selectedHost = hostId === undefined || targetHost === hostId;
      return <div key={item.operationId}>
        <p><strong>{item.origin.section}</strong> | {item.hostId} | {item.phase}</p>
        {item.origin.scope?.length ? <p>Scope: {item.origin.scope.join(', ')}</p> : null}
        <p>Operation: <code>{item.operationId}</code>{terminal ? ` | Result: ${terminal.kind}${terminal.kind === 'effectiveEnabled' ? ` (${terminal.value})` : ''}${terminal.kind === 'rejected' && terminal.code !== undefined ? ` (${terminal.code})` : ''}` : ''}</p>
        {item.error && <p>{item.error}</p>}
        {writeTerminalMessage(targetTerminal) && item.error !== writeTerminalMessage(targetTerminal) && <p>{writeTerminalMessage(targetTerminal)}</p>}
        {target?.state === 'preparing' && <p>{target.interrupted ?
          'Preparation was interrupted before sending. Save the host status to finish recovery.' : 'Preparing the original configuration save.'}</p>}
        {target?.storageError && <p>The host has not saved its observed receipt yet.</p>}
        {receipt && <p>The original recovery receipt is saved in this browser.</p>}
        {item.blocker && <p>Blocking operation: <code>{item.blocker.operationId}</code> ({item.blocker.hostId})
          {targetTerminal ? ` | Result: ${targetTerminal.kind}${targetTerminal.kind === 'effectiveEnabled' ? ` (${targetTerminal.value})` : ''}` : ''}</p>}
        <details><summary>View original submission and edit</summary><pre className="yard-instructions">{JSON.stringify({ hostId: item.hostId, scope: item.origin.scope, source: item.origin.source, method: item.method, params: item.params, draft: item.origin.draft, result: item.result, newerEdits: item.workingDrafts }, null, 2)}</pre></details>
        <div className="yard-actions">
          {unresolved && <button type="button" disabled={!selectedHost || busy !== null || state.localRetry.includes(item.operationId)} onClick={() => run(item.operationId, () => operations.check(item.operationId, false, captureAuthority?.(targetHost)))}>Check original operation</button>}
          {(target?.storageError || target?.interrupted || receipt) && unresolved && <button type="button" disabled={!selectedHost || busy !== null || state.localRetry.includes(item.operationId)}
            onClick={() => run(item.operationId, () => operations.check(item.operationId, true, captureAuthority?.(targetHost)))}>Retry saving host receipt</button>}
          {item.phase === 'unknown' && item.hostMissing && item.notSentEvidence && <button type="button" disabled={busy !== null || state.localRetry.includes(item.operationId)}
            onClick={() => run(item.operationId, () => operations.confirmNotSent(item.operationId))}>Confirm original save was not sent</button>}
          {state.localRetry.includes(item.operationId) && <button type="button" disabled={busy !== null}
            onClick={() => run(item.operationId, () => operations.retryLocal(item.operationId))}>Retry saving browser receipt</button>}
          {!unresolved && !item.operation?.storageError && !state.localRetry.includes(item.operationId) && <>
            {originalEdit && <button type="button" disabled={hostId !== undefined && item.hostId !== hostId || busy !== null || state.draftPending > 0}
              onClick={() => run(item.operationId, () => { captureAuthority?.(item.hostId)(); return operations.restoreOriginalPluginEdit(item); })}>Restore original plugin edit</button>}
            <button type="button" disabled={busy !== null || state.draftPending > 0}
              onClick={() => { if (originalEdit && !window.confirm('Discard this original plugin edit and close only this operation? The saved target and scope will be removed.')) return;
                run(item.operationId, () => operations.finish(item.operationId, { discardOriginalEdit: originalEdit })); }}>{originalEdit ? 'Discard original edit and close operation' : 'Close original operation'}</button>
          </>}
        </div>
      </div>;
    })}
  </section>;
}
