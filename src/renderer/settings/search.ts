export interface SettingsSearchItem { id: string; label: string }

export const settingsSearchItems: Record<string, readonly SettingsSearchItem[]> = {
  'general-settings': [
    { id: 'terminal-location', label: 'Default terminal location' }, { id: 'prevent-sleep', label: 'Prevent sleep while running' },
    { id: 'auto-archive', label: 'Automatically archive inactive chats' }, { id: 'suggestions', label: 'Suggestions' },
    { id: 'language', label: 'Language' }, { id: 'educational-tips', label: 'Educational tips' },
    { id: 'plain-text', label: 'Plain text composer' }, { id: 'context-usage', label: 'Show context window usage' },
    { id: 'send-message', label: 'Send message' }, { id: 'follow-up', label: 'Follow-up messages' },
  ],
  appearance: [
    { id: 'ui-font-size', label: 'Interface font size' }, { id: 'code-font-size', label: 'Code font size' },
    { id: 'reduced-motion', label: 'Reduce motion' }, { id: 'diff-markers', label: 'Diff markers' },
    { id: 'pointer-cursors', label: 'Pointer cursors' }, { id: 'font-smoothing', label: 'Font smoothing' },
    { id: 'dock-icon', label: 'Dock icon' }, { id: 'theme-accent', label: 'Accent' },
    { id: 'theme-background', label: 'Background' }, { id: 'theme-text', label: 'Text' },
    { id: 'theme-added', label: 'Added lines' }, { id: 'theme-removed', label: 'Removed lines' },
    { id: 'theme-skill', label: 'Skill color' }, { id: 'theme-contrast', label: 'Contrast' },
    { id: 'transparent-window', label: 'Transparent window' }, { id: 'ui-font', label: 'Interface font' },
    { id: 'content-font', label: 'Content font' }, { id: 'code-font', label: 'Code font' },
    { id: 'code-theme', label: 'Code theme' }, { id: 'theme-import', label: 'Import theme' }, { id: 'theme-export', label: 'Export theme' },
  ],
  models: [{ id: 'model', label: 'Model' }, { id: 'effort', label: 'Reasoning effort' }],
  agent: [{ id: 'approval', label: 'Approval policy' }, { id: 'sandbox', label: 'Sandbox mode' }, { id: 'experimental', label: 'Experimental features' }],
  personalization: [{ id: 'instructions', label: 'Codex instructions' }, { id: 'codex-memory', label: 'Codex memories' },
    { id: 'custom-instructions', label: 'Custom instructions' }, { id: 'chatgpt-memory', label: 'ChatGPT memory' }],
  voice: [{ id: 'microphone', label: 'Microphone' }, { id: 'voice-chat', label: 'Voice chat' }, { id: 'dictation', label: 'Dictation' }],
  usage: [{ id: 'account', label: 'Account' }, { id: 'usage-limits', label: 'Usage limits' }],
  'git-settings': [
    { id: 'branch-prefix', label: 'Branch prefix' }, { id: 'force-push', label: 'Always force push' },
    { id: 'draft-pr', label: 'Create draft pull requests' }, { id: 'pr-merge', label: 'Pull request merge method' },
    { id: 'git-diffs', label: 'Disable Git-based diffs' }, { id: 'review-delivery', label: 'Review delivery' },
    { id: 'commit-instructions', label: 'Commit instructions' }, { id: 'pr-instructions', label: 'Pull request instructions' },
    { id: 'pr-watch', label: 'Pull request watch instructions' }, { id: 'auto-merge', label: 'Auto-merge when ready' },
  ],
  worktrees: [
    { id: 'worktree-root', label: 'Worktree root' }, { id: 'worktree-fetch', label: 'Always fetch upstream before creating worktrees' },
    { id: 'worktree-cleanup', label: 'Automatically delete old worktrees' }, { id: 'worktree-limit', label: 'Auto-delete limit' },
  ],
  'keyboard-shortcuts': [{ id: 'number-shortcuts', label: 'Number shortcuts' }, { id: 'browser-shortcut', label: 'Open web link in default browser' }],
};

const ids = new Map(Object.values(settingsSearchItems).flat().map(item => [item.label, item.id]));
export function settingSearchId(label: string): string | undefined { return ids.get(label); }
