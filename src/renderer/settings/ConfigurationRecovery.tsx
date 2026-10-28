import { useEffect, useState, useSyncExternalStore } from 'react';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { settingsConfigOperations } from './config-operations.ts';

export function ConfigurationRecovery({ client }: { client: WorkbenchClient }) {
  const operations = settingsConfigOperations(client);
  const state = useSyncExternalStore(operations.subscribe, operations.getSnapshot, operations.getSnapshot);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void operations.refresh(); }, [operations]);
  const run = (id: string, action: () => Promise<void>) => {
    setBusy(id); setError(null);
    void action().catch(reason => setError(reason instanceof Error ? reason.message : String(reason))).finally(() => setBusy(null));
  };
  if (!state.records.length && !state.error && !error && !state.localRetry.length && !state.draftRetry.length) return null;
  return <section className="yard-setting-error" aria-label="Configuration save recovery">
    <h3>Configuration save recovery</h3>
    {state.error && <p role="alert">{state.error}</p>}
    {error && <p role="alert">{error}</p>}
    {state.draftRetry.map(editorId => <p key={editorId}>A newer edit is still in this page.{' '}
      <button type="button" disabled={busy !== null} onClick={() => run(editorId, () => operations.retryDraft(editorId))}>Retry saving browser edit</button></p>)}
    {state.localRetry.filter(id => !state.records.some(item => item.operationId === id)).map(id => <p key={id}>The original browser receipt is still in this page.{' '}
      <button type="button" disabled={busy !== null} onClick={() => run(id, () => operations.retryLocal(id))}>Retry saving browser receipt</button></p>)}
    {state.records.map(item => {
      const unresolved = item.phase === 'pending' || item.phase === 'unknown' || item.phase === 'blocked';
      const terminal = item.operation?.terminal ?? item.operation?.observedTerminal;
      return <div key={item.operationId}>
        <p><strong>{item.origin.section}</strong> | {item.hostId} | {item.phase}</p>
        {item.origin.scope?.length ? <p>Scope: {item.origin.scope.join(', ')}</p> : null}
        <p>Operation: <code>{item.operationId}</code>{terminal ? ` | Result: ${terminal.kind}${terminal.kind === 'effectiveEnabled' ? ` (${terminal.value})` : ''}${terminal.kind === 'rejected' && terminal.code !== undefined ? ` (${terminal.code})` : ''}` : ''}</p>
        {item.error && <p>{item.error}</p>}
        {item.operation?.storageError && <p>The host has not saved its observed receipt yet.</p>}
        {item.blocker && <p>Blocking operation: <code>{item.blocker.operationId}</code> ({item.blocker.hostId})</p>}
        <details><summary>View original submission and edit</summary><pre className="yard-instructions">{JSON.stringify({ method: item.method, params: item.params, draft: item.origin.draft, result: item.result, newerEdits: item.workingDrafts }, null, 2)}</pre></details>
        <div className="yard-actions">
          {unresolved && <button type="button" disabled={busy !== null} onClick={() => run(item.operationId, () => operations.check(item.operationId))}>Check original operation</button>}
          {(item.operation?.storageError || item.blocker?.storageError) && <button type="button" disabled={busy !== null}
            onClick={() => run(item.operationId, () => operations.check(item.operationId, true))}>Retry saving host receipt</button>}
          {state.localRetry.includes(item.operationId) && <button type="button" disabled={busy !== null}
            onClick={() => run(item.operationId, () => operations.retryLocal(item.operationId))}>Retry saving browser receipt</button>}
          {!unresolved && !item.operation?.storageError && !state.localRetry.includes(item.operationId) && <button type="button" disabled={busy !== null || state.draftPending > 0}
            onClick={() => run(item.operationId, () => operations.finish(item.operationId, true))}>Discard saved copy</button>}
        </div>
      </div>;
    })}
  </section>;
}
