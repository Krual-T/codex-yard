import { useEffect, useState, useSyncExternalStore } from 'react';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { settingsConfigOperations } from './config-operations.ts';
import type { SettingsWriteSection } from './config-operations.ts';

export function SettingsDraftRecovery({ client, hostId, section, scope, editorId, disabled, onRestore }: {
  client: WorkbenchClient; hostId: string; section: SettingsWriteSection; scope?: readonly string[];
  editorId: string; disabled: boolean; onRestore: (draft: unknown) => Promise<void>;
}) {
  const operations = settingsConfigOperations(client);
  const state = useSyncExternalStore(operations.subscribe, operations.getSnapshot, operations.getSnapshot);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => { void operations.refresh(); }, [operations]);
  const drafts = state.drafts.filter(item => item.hostId === hostId && item.section === section && item.editorId !== editorId
    && JSON.stringify(item.scope ?? []) === JSON.stringify(scope ?? []));
  const run = (action: () => Promise<void>) => {
    setBusy(true); setError(null);
    void action().catch(reason => setError(reason instanceof Error ? reason.message : String(reason))).finally(() => setBusy(false));
  };
  if (!drafts.length && !error) return null;
  return <section aria-label="Saved configuration edits" className="yard-setting-error">
    <h3>Saved configuration edits</h3>
    {error && <p role="alert">{error}</p>}
    {drafts.map(item => <div key={`${item.editorId}:${item.revision}`}>
      <p>Editor <code>{item.editorId}</code> | revision {item.revision}</p>
      <details><summary>View saved edit and baseline</summary><pre className="yard-instructions">{JSON.stringify(item.draft, null, 2)}</pre></details>
      <div className="yard-actions">
        <button type="button" disabled={busy || disabled} onClick={() => run(() => onRestore(item.draft))}>Restore this edit</button>
        <button type="button" disabled={busy} onClick={() => run(() => operations.discardDraft(item))}>Discard this copy</button>
      </div>
    </div>)}
  </section>;
}
