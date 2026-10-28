import type { ReactNode } from 'react';
import { translateKnown, useI18n } from '../i18n/index.tsx';
import type { PreferenceEntry, PreferenceKey, PreferenceSnapshot, PreferenceValues, Preferences } from './preferences.ts';

export interface PreferenceProps { preferences: Preferences; snapshot: PreferenceSnapshot }

export function Row({ label, description, children, error, retry }: {
  label: string; description?: ReactNode; children?: ReactNode; error?: string | null; retry?: () => void;
}) {
  const { t } = useI18n();
  return <div className="yard-setting-row" data-setting-label={label} id={label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}>
    <div className="yard-setting-copy"><div className="yard-setting-label">{translateKnown(t, label)}</div>
      {description && <div className="yard-setting-description">{typeof description === 'string' ? translateKnown(t, description) : description}</div>}
      {error && <div className="yard-setting-error" role="alert">{error} {retry && <button type="button" className="yard-link" onClick={retry}>{t('Retry')}</button>}</div>}
    </div>
    {children && <div className="yard-setting-control">{children}</div>}
  </div>;
}

export function entryState(entry: PreferenceEntry<unknown>) {
  return { disabled: !entry.available || entry.loading || entry.saving, error: entry.error };
}

export function Toggle<K extends PreferenceKey>({ preferences, snapshot, setting, label, description, unavailable }: PreferenceProps & {
  setting: K; label: string; description?: ReactNode; unavailable?: string;
}) {
  const { t } = useI18n();
  const entry = snapshot[setting];
  return <Row label={label} description={unavailable ?? description} error={entry.error} retry={() => { void preferences.reload(setting); }}>
    <input type="checkbox" role="switch" aria-label={translateKnown(t, label)} checked={entry.value === true}
      disabled={Boolean(unavailable) || entryState(entry).disabled}
      onChange={event => preferences.edit(setting, event.target.checked as PreferenceValues[K])} />
  </Row>;
}

export function Select<K extends PreferenceKey>({ preferences, snapshot, setting, label, description, options, unavailable }: PreferenceProps & {
  setting: K; label: string; description?: ReactNode; options: readonly { value: string; label: string }[]; unavailable?: string;
}) {
  const { t } = useI18n();
  const entry = snapshot[setting];
  return <Row label={label} description={unavailable ?? description} error={entry.error} retry={() => { void preferences.reload(setting); }}>
    <select aria-label={translateKnown(t, label)} disabled={Boolean(unavailable) || entryState(entry).disabled} value={String(entry.value ?? '')}
      onChange={event => preferences.edit(setting, event.target.value as PreferenceValues[K])}>
      {options.map(option => <option key={option.value} value={option.value}>{translateKnown(t, option.label)}</option>)}
    </select>
  </Row>;
}

export function NumberPreference({ preferences, snapshot, setting, label, min, max, description }: PreferenceProps & {
  setting: 'sansFontSize' | 'codeFontSize' | 'autoArchiveAfterDays'; label: string; min: number; max: number; description?: ReactNode;
}) {
  const { t } = useI18n();
  const entry = snapshot[setting];
  return <Row label={label} description={description} error={entry.error} retry={() => { void preferences.reload(setting); }}>
    <input type="number" aria-label={translateKnown(t, label)} min={min} max={max} step={1} value={entry.value} disabled={entryState(entry).disabled}
      onChange={event => { const value = event.target.valueAsNumber; if (Number.isInteger(value)) preferences.edit(setting, value); }} />
  </Row>;
}
