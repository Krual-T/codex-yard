import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/index.tsx';
import type { SettingsDraftRecord } from './config-operations.ts';
import { configReadSource } from './config-source.ts';

export interface PluginEditRecoveryProps {
  drafts: readonly SettingsDraftRecord[];
  activeHostId: string;
  disabled: boolean;
  saveDisabled?: boolean;
  onEdit?(draft: SettingsDraftRecord, enabled: boolean): Promise<void>;
  onPendingChange?(pending: boolean): void;
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
  return JSON.stringify([item.hostId, item.section, item.scope ?? null, item.editorId, item.revision]);
}

function ownerKey(item: SettingsDraftRecord): string {
  return JSON.stringify([item.hostId, item.section, item.scope ?? null, item.editorId]);
}

function sameRecord(left: SettingsDraftRecord, right: SettingsDraftRecord): boolean {
  try {
    const canonical = (value: unknown) => JSON.stringify(value, (_key, entry: unknown) => object(entry)
      ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
    return canonical(left) === canonical(right);
  } catch { return false; }
}

interface Choice {
  original: SettingsDraftRecord;
  enabled: boolean;
  phase: 'pending' | 'awaiting' | 'failed';
  error?: string;
}

function confirmsChoice(item: SettingsDraftRecord, choice: Choice): boolean {
  if (item.revision <= choice.original.revision) return false;
  try {
    const expected = structuredClone(choice.original);
    if (!object(expected.draft)) return false;
    expected.revision = item.revision;
    expected.draft.enabled = choice.enabled;
    return sameRecord(item, expected);
  } catch { return false; }
}

type Action = (draft: SettingsDraftRecord) => Promise<void>;
type Run = (item: SettingsDraftRecord, name: 'save' | 'discard', action: Action) => Promise<boolean>;
type Edit = (item: SettingsDraftRecord, enabled: boolean, retry?: boolean) => Promise<void>;

function SavedPluginEdit({ item, present, stale, choice, activeHostId, disabled, saveDisabled, busy, canEdit, onSave, onDiscard, run, editChoice, discardChoice }: {
  item: SettingsDraftRecord; activeHostId: string; disabled: boolean; saveDisabled: boolean; busy: boolean;
  present: boolean; stale: boolean; choice: Choice | undefined; canEdit: boolean;
  onSave: Action; onDiscard: Action; run: Run; editChoice: Edit; discardChoice: () => void;
}) {
  const { t } = useI18n();
  const [confirm, setConfirm] = useState<SettingsDraftRecord | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const details = useRef<HTMLDetailsElement>(null);
  const choiceDetails = useRef<HTMLDetailsElement>(null);
  const edit = object(item.draft) ? item.draft : null;
  const source = edit?.originalSource;
  const content = json(item);
  const valid = validEdit(item);
  const confirming = present && confirm !== null && editKey(confirm) === editKey(item);
  const choiceContent = choice ? json({ original: choice.original, selectedEnabled: choice.enabled }) : null;
  const changed = !!choice && (!present || !sameRecord(item, choice.original));
  const copy = (value: string | null, fallback: HTMLDetailsElement | null) => {
    if (value === null) return;
    setCopyMessage(null);
    void (navigator.clipboard?.writeText(value) ?? Promise.reject(new Error('Clipboard unavailable')))
      .then(() => setCopyMessage(t('Copied.')))
      .catch(() => { if (fallback) fallback.open = true; setCopyMessage(t('Clipboard unavailable. Select and copy the text.')); });
  };
  return <article>
    {!present && <p role="status">This original snapshot is no longer in the current saved edits.</p>}
    {stale && <p role="status">This saved edit is older than a version already seen. Wait for the current version.</p>}
    <p>{t('Host')}: <code>{item.hostId}</code> | Editor: <code>{item.editorId}</code> | Revision: {item.revision}</p>
    <p>{t('Scope:')} <code>{item.scope === undefined ? '(not recorded)' : json(item.scope) ?? '(unavailable)'}</code></p>
    <p>Plugin: <code>{typeof edit?.pluginId === 'string' && edit.pluginId ? edit.pluginId : t('Unavailable')}</code>
      {' | '}Target: {typeof edit?.enabled === 'boolean' ? t(edit.enabled ? 'Enabled' : 'Disabled') : t('Unavailable')}</p>
    <p>Source: <code>{source === undefined ? '(not recorded)' : json(source) ?? '(unavailable)'}</code></p>
    {!valid && <p role="status">This saved edit is incomplete or invalid. Review or copy its original contents.</p>}
    {valid && item.hostId !== activeHostId && <p role="status">Select the original host to save this edit.</p>}
    {typeof edit?.enabled === 'boolean' && <label className="yard-setting-control">Plugin enabled
      <input type="checkbox" role="switch" aria-label="Plugin enabled" checked={choice?.enabled ?? edit.enabled}
        disabled={!present || stale || !valid || !canEdit || item.hostId !== activeHostId || disabled || busy || !!choice}
        onChange={event => { void editChoice(item, event.currentTarget.checked); }} />
    </label>}
    {choice && <>
      <p role="status">Unconfirmed choice: {t(choice.enabled ? 'Enabled' : 'Disabled')}.
        {choice.phase === 'pending' ? ' Saving the browser edit.' : choice.phase === 'awaiting' && !changed
          ? ' Waiting for the updated saved edit.' : ''}</p>
      {choice.error && <p role="alert">Could not save this choice in the browser: {choice.error}</p>}
      {changed && !confirmsChoice(item, choice) && <p role="status">The saved edit changed. Review the original choice before continuing.</p>}
      <details ref={choiceDetails}><summary>View unsaved choice and original</summary><pre className="yard-instructions">{choiceContent ?? 'This choice cannot be represented as JSON.'}</pre></details>
      <div className="yard-actions">
        <button type="button" disabled={choiceContent === null} onClick={() => copy(choiceContent, choiceDetails.current)}>Copy unsaved choice</button>
        {choice.phase === 'failed' && <button type="button" disabled={!present || stale || !valid || !canEdit || item.hostId !== activeHostId
          || disabled || busy || !sameRecord(item, choice.original)} onClick={() => { void editChoice(item, choice.enabled, true); }}>Retry saving edit</button>}
        <button type="button" disabled={busy || choice.phase === 'pending'}
          onClick={discardChoice}>Discard unsaved choice</button>
      </div>
    </>}
    <details ref={details}><summary>View saved edit</summary><pre className="yard-instructions">{content ?? 'This saved edit cannot be represented as JSON.'}</pre></details>
    {copyMessage && <p role="status">{copyMessage}</p>}
    <div className="yard-actions">
      <button type="button" disabled={!present || stale || !valid || item.hostId !== activeHostId || disabled || saveDisabled || busy || !!choice}
        onClick={() => { void run(item, 'save', onSave); }}>Save this plugin edit</button>
      <button type="button" disabled={content === null} onClick={() => copy(content, details.current)}>Copy saved edit</button>
      <button type="button" disabled={!present || stale || disabled || busy || confirming} onClick={() => {
        try { setConfirm(structuredClone(item)); } catch { setCopyMessage('This saved edit cannot be copied for confirmation.'); }
      }}>Discard this copy</button>
    </div>
    {confirming && confirm && <div role="group" aria-label="Confirm discard of saved plugin edit">
      <p>Discard only this saved copy? The original operation and other saved edits are not deleted.
        {choice && ' Any unsaved choice remains available until explicitly discarded.'}</p>
      <div className="yard-actions">
        <button type="button" disabled={disabled || busy} onClick={() => {
          void run(confirm, 'discard', onDiscard).then(done => { if (done) setConfirm(null); });
        }}>Confirm discard of this copy</button>
        <button type="button" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
      </div>
    </div>}
  </article>;
}

export function PluginEditRecovery({ drafts, activeHostId, disabled, saveDisabled = false, onEdit, onPendingChange, onSave, onDiscard }: PluginEditRecoveryProps) {
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardError, setGuardError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Map<string, Choice>>(() => new Map());
  const choicesRef = useRef(choices);
  const pendingNotifier = useRef<((pending: boolean) => void) | null>(null);
  const pendingGuardReady = useRef(false);
  const pendingGuardFault = useRef(false);
  const seenRevisions = useRef(new Map<string, number>());
  const requireSynchronous = (result: unknown) => {
    if (result !== null && (typeof result === 'object' || typeof result === 'function')
      && typeof (result as { then?: unknown }).then === 'function') {
      void Promise.resolve(result).catch(() => {});
      throw new Error('The unsaved edit guard must be synchronous.');
    }
  };
  const publishChoices = (next: Map<string, Choice>) => {
    const before = choicesRef.current.size > 0, after = next.size > 0;
    choicesRef.current = next; setChoices(next);
    if (before && !after) {
      const notify = pendingNotifier.current;
      pendingNotifier.current = null;
      pendingGuardReady.current = false;
      try { requireSynchronous(notify?.(false)); } catch (reason) {
        pendingGuardFault.current = true;
        setGuardError(`Could not release the unsaved edit guard: ${reason instanceof Error ? reason.message : String(reason)}`);
      }
    }
  };
  const requirePendingGuard = () => {
    if (pendingGuardReady.current) return;
    const notify = pendingNotifier.current ?? onPendingChange;
    if (!notify) throw new Error('The unsaved edit guard is unavailable.');
    pendingNotifier.current = notify;
    requireSynchronous(notify(true));
    pendingGuardReady.current = true;
  };
  const updateChoice = (key: string, choice: Choice | null) => {
    const next = new Map(choicesRef.current);
    if (choice) next.set(key, choice); else next.delete(key);
    publishChoices(next);
  };
  useLayoutEffect(() => {
    for (const item of drafts) {
      const key = ownerKey(item), previous = seenRevisions.current.get(key);
      if (Number.isSafeInteger(item.revision) && (previous === undefined || item.revision > previous)) seenRevisions.current.set(key, item.revision);
    }
  });
  useEffect(() => {
    const next = new Map(choicesRef.current);
    let changed = false;
    for (const [key, choice] of next) {
      const item = drafts.find(draft => ownerKey(draft) === key);
      if (choice.phase === 'awaiting' && item && (seenRevisions.current.get(key) ?? item.revision) <= item.revision
        && confirmsChoice(item, choice)) { next.delete(key); changed = true; }
    }
    if (changed) publishChoices(next);
  });
  const editChoice: Edit = async (item, enabled, retry = false) => {
    const key = ownerKey(item), previous = choicesRef.current.get(key);
    if (!onEdit || !onPendingChange || pendingGuardFault.current || disabled || busyRef.current || !validEdit(item) || item.hostId !== activeHostId
      || (seenRevisions.current.get(key) ?? item.revision) > item.revision
      || (retry ? !previous || previous.phase !== 'failed' || previous.enabled !== enabled || !sameRecord(item, previous.original) : !!previous)) return;
    busyRef.current = true; setBusy(true); setError(null);
    let attempt: Choice | null = null;
    try {
      const original = structuredClone(retry ? previous!.original : item);
      attempt = { original, enabled, phase: 'pending' };
      updateChoice(key, attempt);
      requirePendingGuard();
      await onEdit(structuredClone(original), enabled);
      if (choicesRef.current.get(key) === attempt) updateChoice(key, { ...attempt, phase: 'awaiting' });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      if (attempt && choicesRef.current.get(key) === attempt) updateChoice(key, { ...attempt, phase: 'failed', error: message });
      else setError(`Could not prepare this plugin edit: ${message}`);
    } finally { busyRef.current = false; setBusy(false); }
  };
  const run: Run = async (item, name, action) => {
    const key = ownerKey(item);
    if (disabled || busyRef.current || (seenRevisions.current.get(key) ?? item.revision) > item.revision
      || (name === 'save' && (saveDisabled || !validEdit(item) || item.hostId !== activeHostId || choicesRef.current.has(key)))) return false;
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
  const rows = drafts.map(item => ({ item, present: true }));
  const current = new Set(rows.map(row => ownerKey(row.item)));
  for (const [key, choice] of choices) if (!current.has(key)) rows.push({ item: choice.original, present: false });
  if (!rows.length && !error && !guardError) return null;
  return <section className="yard-setting-error" aria-label="Saved plugin edits">
    <h3>Saved plugin edits</h3>
    {error && <p role="alert">{error}</p>}
    {guardError && <p role="alert">{guardError}</p>}
    {rows.map(({ item, present }) => {
      const key = ownerKey(item);
      return <SavedPluginEdit key={key} item={item} present={present} stale={(seenRevisions.current.get(key) ?? item.revision) > item.revision}
        choice={choices.get(key)} activeHostId={activeHostId} disabled={disabled} saveDisabled={saveDisabled} busy={busy} canEdit={!!onEdit && !!onPendingChange && !pendingGuardFault.current}
        onSave={onSave} onDiscard={onDiscard} run={run} editChoice={editChoice} discardChoice={() => updateChoice(key, null)} />;
    })}
  </section>;
}
