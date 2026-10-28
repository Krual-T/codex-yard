import { translateKnown, useI18n } from '../i18n/index.tsx';
import { preferenceKeys } from './preferences.ts';
import type { PreferenceKey } from './preferences.ts';
import type { PreferenceProps } from './PreferenceControls.tsx';

const labels: Record<PreferenceKey, string> = {
  appearanceTheme: 'Appearance', appearanceLightChromeTheme: 'Light theme', appearanceDarkChromeTheme: 'Dark theme',
  appearanceLightCodeThemeId: 'Light theme: Code theme', appearanceDarkCodeThemeId: 'Dark theme: Code theme',
  appearanceDiffMarkerStyle: 'Diff markers', sansFontSize: 'Interface font size', codeFontSize: 'Code font size',
  useFontSmoothing: 'Font smoothing', usePointerCursors: 'Pointer cursors', defaultTerminalLocation: 'Default terminal location',
  composerEnterBehavior: 'Send message', composerPlainTextMode: 'Plain text composer', followUpQueueMode: 'Follow-up messages',
  microphoneInputDeviceId: 'Microphone', preventSleepWhileRunning: 'Prevent sleep while running',
  autoArchiveAfterDays: 'Automatically archive inactive chats', localeOverride: 'Language', reviewDelivery: 'Review delivery',
  'git-branch-prefix': 'Branch prefix', 'git-always-force-push': 'Always force push',
  'git-create-pull-request-as-draft': 'Create draft pull requests', 'git-pull-request-merge-method': 'Pull request merge method',
  'git-review-mode': 'Disable Git-based diffs', 'git-commit-instructions': 'Commit instructions',
  'git-pr-instructions': 'Pull request instructions', 'git-pr-watch-auto-merge': 'Auto-merge when ready',
  'git-pr-watch-instructions': 'Pull request watch instructions', 'git-worktree-root': 'Worktree root',
  'worktree-upstream-refresh-mode': 'Always fetch upstream before creating worktrees',
  'worktree-auto-cleanup-enabled': 'Automatically delete old worktrees', 'worktree-keep-count': 'Auto-delete limit',
  'external-browser-link-shortcut': 'Open web link in default browser', 'primary-number-shortcut-target': 'Number shortcuts',
  'reduced-motion-preference': 'Reduce motion', 'dock-icon-preference': 'Dock icon',
  'ambient-suggestions-enabled': 'Suggestions', 'show-context-window-usage': 'Show context window usage',
  'show-educational-tips': 'Educational tips',
};

export function PreferenceConflicts({ preferences, snapshot }: PreferenceProps) {
  const { t } = useI18n();
  const keys = preferenceKeys.filter(key => snapshot[key].conflict);
  if (!keys.length) return null;
  return <section className="yard-preference-conflicts" aria-label={t('Conflicting preferences')}>
    <p role="alert">{t('The saved preference changed elsewhere. Review the current value before saving.')}</p>
    {keys.map(key => {
      const entry = snapshot[key], current = entry.observation;
      return <div className="yard-preference-conflict" key={key}>
        <strong>{translateKnown(t, labels[key])}</strong>
        <div>{t('Current:')}</div>
        <pre>{current?.exists ? JSON.stringify(current.value, null, 2) : t('(not set)')}</pre>
        <div className="yard-actions">
          <button type="button" onClick={() => preferences.resolveConflict(key, 'current')}>{t('Use current value')}</button>
          <button type="button" disabled={!entry.available} onClick={() => preferences.resolveConflict(key, 'draft')}>{t('Review and reapply')}</button>
        </div>
      </div>;
    })}
  </section>;
}
