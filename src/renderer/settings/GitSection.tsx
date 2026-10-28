import { useEffect } from 'react';
import { translateKnown, useI18n } from '../i18n/index.tsx';
import { entryState, Row } from './PreferenceControls.tsx';
import type { PreferenceProps } from './PreferenceControls.tsx';
import type { PreferenceKey, PreferenceValues } from './preferences.ts';

type InstructionKey = 'git-commit-instructions' | 'git-pr-instructions';

function InstructionEditor({ preferences, snapshot, setting, label, description, suspended }: PreferenceProps & {
  setting: InstructionKey; label: string; description: string; suspended: boolean;
}) {
  const { t } = useI18n();
  const entry = snapshot[setting];
  useEffect(() => {
    if (suspended || !entry.available || entry.saving || entry.error || entry.value === entry.saved) return;
    const timer = window.setTimeout(() => { void preferences.saveOne(setting); }, 3000);
    return () => window.clearTimeout(timer);
  }, [entry.available, entry.saving, entry.error, entry.value, entry.saved, preferences, setting, suspended]);
  return <Row label={label} description={description} error={entry.error} retry={() => { void preferences.saveOne(setting); }}>
    <textarea aria-label={translateKnown(t, label)} rows={4} value={entry.value} disabled={!entry.available || entry.loading}
      onChange={event => preferences.edit(setting, event.target.value)} onKeyDown={event => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void preferences.saveOne(setting); }
      }} />
  </Row>;
}

export function GitSection({ preferences, snapshot, suspended }: PreferenceProps & { suspended: boolean }) {
  const { t } = useI18n();
  const update = <K extends PreferenceKey>(key: K, value: PreferenceValues[K]) => {
    preferences.edit(key, value);
    void preferences.saveOne(key);
  };
  const branch = snapshot['git-branch-prefix'];
  const force = snapshot['git-always-force-push'];
  const draft = snapshot['git-create-pull-request-as-draft'];
  const merge = snapshot['git-pull-request-merge-method'];
  const review = snapshot['git-review-mode'];
  const delivery = snapshot.reviewDelivery;
  return <>
    <h2>{t('Git')}</h2>
    <p className="yard-muted">{t('These preferences are stored by this web host. Git operations and active pull request watchers are not connected.')}</p>
    <div className="yard-setting-group">
      <Row label="Branch prefix" description="Prefix used when creating branches." error={branch.error} retry={() => { void preferences.reload('git-branch-prefix'); }}>
        <input type="text" aria-label={t('Branch prefix')} value={branch.value} disabled={entryState(branch).disabled}
          onChange={event => preferences.edit('git-branch-prefix', event.target.value)}
          onBlur={() => { void preferences.saveOne('git-branch-prefix'); }} onKeyDown={event => {
            if (event.key === 'Enter' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's')) {
              event.preventDefault(); void preferences.saveOne('git-branch-prefix');
            }
          }} />
      </Row>
      <Row label="Always force push" description="Use force-with-lease when pushing." error={force.error} retry={() => { void preferences.reload('git-always-force-push'); }}>
        <input type="checkbox" role="switch" aria-label={t('Always force push')} checked={force.value} disabled={entryState(force).disabled}
          onChange={event => update('git-always-force-push', event.target.checked)} />
      </Row>
      <Row label="Create draft pull requests" error={draft.error} retry={() => { void preferences.reload('git-create-pull-request-as-draft'); }}>
        <input type="checkbox" role="switch" aria-label={t('Create draft pull requests')} checked={draft.value} disabled={entryState(draft).disabled}
          onChange={event => update('git-create-pull-request-as-draft', event.target.checked)} />
      </Row>
      <Row label="Pull request merge method" error={merge.error} retry={() => { void preferences.reload('git-pull-request-merge-method'); }}>
        <select aria-label={t('Pull request merge method')} value={merge.value} disabled={entryState(merge).disabled}
          onChange={event => update('git-pull-request-merge-method', event.target.value as 'merge' | 'squash')}>
          <option value="merge">{t('Merge')}</option><option value="squash">{t('Squash')}</option>
        </select>
      </Row>
      <Row label="Disable Git-based diffs" description="Only show the last turn in the Changes panel." error={review.error} retry={() => { void preferences.reload('git-review-mode'); }}>
        <input type="checkbox" role="switch" aria-label={t('Disable Git-based diffs')} checked={review.value === 'last-turn-only'} disabled={entryState(review).disabled}
          onChange={event => update('git-review-mode', event.target.checked ? 'last-turn-only' : 'full')} />
      </Row>
      <Row label="Review delivery" description="Start review in the current chat or in a separate chat." error={delivery.error} retry={() => { void preferences.reload('reviewDelivery'); }}>
        <select aria-label={t('Review delivery')} value={delivery.value} disabled={entryState(delivery).disabled}
          onChange={event => update('reviewDelivery', event.target.value as 'inline' | 'detached')}>
          <option value="inline">{t('Inline')}</option><option value="detached">{t('Detached')}</option>
        </select>
      </Row>
      <InstructionEditor preferences={preferences} snapshot={snapshot} suspended={suspended} setting="git-commit-instructions" label="Commit instructions" description="Added to commit message generation prompts." />
      <InstructionEditor preferences={preferences} snapshot={snapshot} suspended={suspended} setting="git-pr-instructions" label="Pull request instructions" description="Added to pull request title and description prompts." />
      <Row label="Pull request watch instructions" description="Active watcher updates are unavailable in this web host." error={snapshot['git-pr-watch-instructions'].error}>
        <textarea aria-label={t('Pull request watch instructions')} rows={4} value={snapshot['git-pr-watch-instructions'].value} disabled readOnly />
      </Row>
      <Row label="Auto-merge when ready" description="Active watcher updates are unavailable in this web host." error={snapshot['git-pr-watch-auto-merge'].error}>
        <input type="checkbox" role="switch" aria-label={t('Auto-merge when ready')} checked={snapshot['git-pr-watch-auto-merge'].value} disabled readOnly />
      </Row>
    </div>
  </>;
}
