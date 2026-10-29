import { useRef, useState } from 'react';
import { useI18n } from '../i18n/index.tsx';
import type { SettingsDraftRecord } from './config-operations.ts';
import { configReadSource } from './config-source.ts';

export interface PluginEditRecoveryProps {
  drafts: readonly SettingsDraftRecord[];
  activeHostId: string;
  disabled: boolean;
  onSave(draft: SettingsDraftRecord): Promise<void>;
  onDiscard(draft: SettingsDraftRecord): Promise<void>;
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function json(value: unknown): string | null {
  try { return JSON.stringify(value, null, 2) ?? null; } catch { return null; }
}

function validEdit(item: SettingsDraftRecord): boolean {
  const edit = item.draft;
  return typeof item.hostId === 'string' && item.hostId.length > 0 && item.section === 'plugins-settings'
    && Array.isArray(item.scope) && item.scope.every(path => typeof path === 'string')
    && typeof item.editorId === 'string' && item.editorId.startsWith('recovered:')
    && Number.isSafeInteger(item.revision) && item.revision > 0
    && object(edit) && typeof edit.pluginId === 'string' && edit.pluginId.trim().length > 0
    && typeof edit.enabled === 'boolean'
    && (edit.originalSource === undefined || configReadSource(edit.originalSource, item.hostId) !== null);
}

function editKey(item: SettingsDraftRecord): string {
  return JSON.stringify([item.hostId, item.section, item.scope ?? [], item.editorId, item.revision]);
}

type Action = (draft: SettingsDraftRecord) => Promise<void>;
type Run = (item: SettingsDraftRecord, name: 'save' | 'discard', action: Action) => Promise<boolean>;

function SavedPluginEdit({ item, activeHostId, disabled, busy, onSave, onDiscard, run }: {
  item: SettingsDraftRecord; activeHostId: string; disabled: boolean; busy: boolean;
  onSave: Action; onDiscard: Action; run: Run;
}) {
  const { t } = useI18n();
  const [confirm, setConfirm] = useState<SettingsDraftRecord | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const details = useRef<HTMLDetailsElement>(null);
  const edit = object(item.draft) ? item.draft : null;
  const source = edit?.originalSource;
  const content = json(item);
  const valid = validEdit(item);
  const copy = () => {
    if (content === null) return;
    setCopyMessage(null);
    void (navigator.clipboard?.writeText(content) ?? Promise.reject(new Error('Clipboard unavailable')))
      .then(() => setCopyMessage(t('Copied.')))
      .catch(() => { if (details.current) details.current.open = true; setCopyMessage(t('Clipboard unavailable. Select and copy the text.')); });
  };
  return <article>
    <p>{t('Host')}: <code>{item.hostId}</code> | Editor: <code>{item.editorId}</code> | Revision: {item.revision}</p>
    <p>{t('Scope:')} <code>{item.scope === undefined ? '(not recorded)' : json(item.scope) ?? '(unavailable)'}</code></p>
    <p>Plugin: <code>{typeof edit?.pluginId === 'string' && edit.pluginId ? edit.pluginId : t('Unavailable')}</code>
      {' | '}Target: {typeof edit?.enabled === 'boolean' ? t(edit.enabled ? 'Enabled' : 'Disabled') : t('Unavailable')}</p>
    <p>Source: <code>{source === undefined ? '(not recorded)' : json(source) ?? '(unavailable)'}</code></p>
    {!valid && <p role="status">This saved edit is incomplete or invalid. Review or copy its original contents.</p>}
    {valid && item.hostId !== activeHostId && <p role="status">Select the original host to save this edit.</p>}
    <details ref={details}><summary>View saved edit</summary><pre className="yard-instructions">{content ?? 'This saved edit cannot be represented as JSON.'}</pre></details>
    {copyMessage && <p role="status">{copyMessage}</p>}
    <div className="yard-actions">
      <button type="button" disabled={!valid || item.hostId !== activeHostId || disabled || busy}
        onClick={() => { void run(item, 'save', onSave); }}>Save this plugin edit</button>
      <button type="button" disabled={content === null} onClick={copy}>Copy saved edit</button>
      <button type="button" disabled={disabled || busy || confirm !== null} onClick={() => {
        try { setConfirm(structuredClone(item)); } catch { setCopyMessage('This saved edit cannot be copied for confirmation.'); }
      }}>Discard this copy</button>
    </div>
    {confirm && <div role="group" aria-label="Confirm discard of saved plugin edit">
      <p>Discard only this saved copy? The original operation and other saved edits are not deleted.</p>
      <div className="yard-actions">
        <button type="button" disabled={disabled || busy} onClick={() => {
          void run(confirm, 'discard', onDiscard).then(done => { if (done) setConfirm(null); });
        }}>Confirm discard of this copy</button>
        <button type="button" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
      </div>
    </div>}
  </article>;
}

export function PluginEditRecovery({ drafts, activeHostId, disabled, onSave, onDiscard }: PluginEditRecoveryProps) {
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run: Run = async (item, name, action) => {
    if (disabled || busyRef.current || (name === 'save' && (!validEdit(item) || item.hostId !== activeHostId))) return false;
    const identity = `${item.hostId}, ${item.editorId}, revision ${item.revision}`;
    busyRef.current = true; setBusy(true); setError(null);
    try {
      const original = structuredClone(item);
      await action(original);
      return true;
    } catch (reason) {
      setError(`Could not ${name} saved plugin edit (${identity}): ${reason instanceof Error ? reason.message : String(reason)}`);
      return false;
    } finally { busyRef.current = false; setBusy(false); }
  };
  if (!drafts.length && !error) return null;
  return <section className="yard-setting-error" aria-label="Saved plugin edits">
    <h3>Saved plugin edits</h3>
    {error && <p role="alert">{error}</p>}
    {drafts.map(item => <SavedPluginEdit key={editKey(item)} item={item} activeHostId={activeHostId}
      disabled={disabled} busy={busy} onSave={onSave} onDiscard={onDiscard} run={run} />)}
  </section>;
}
