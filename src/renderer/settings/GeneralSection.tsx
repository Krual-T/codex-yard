import { useState } from 'react';
import { entryState, Row, Select, Toggle } from './PreferenceControls.tsx';
import type { PreferenceProps } from './PreferenceControls.tsx';
import { fullAccessVisible, setFullAccessVisible } from './preferences.ts';
import type { GeneralPreferenceKey, GeneralPreferenceValues } from './preferences.ts';
import { hasTranslations, languageOptions, translateKnown, useI18n } from '../i18n/index.tsx';

export function GeneralSection(props: PreferenceProps & { platform: string; navigate: (section: string) => void }) {
  const { t } = useI18n();
  const [confirmFullAccess, setConfirmFullAccess] = useState(false);
  const language = props.snapshot.localeOverride.value ?? '';
  const fullAccess = props.snapshot['composer-permission-mode-visibility'];
  const bottomPanel = props.snapshot['app-shell-bottom-panel-launcher-visible'];
  const close = props.snapshot['confirm-before-close'];
  const save = <K extends GeneralPreferenceKey>(key: K, value: GeneralPreferenceValues[K]) => {
    props.preferences.edit(key, value);
    void props.preferences.saveOne(key);
  };
  const setFullAccess = (visible: boolean) => {
    const value = fullAccess.editBase && fullAccessVisible(fullAccess.baseValue) === visible
      ? fullAccess.baseValue : setFullAccessVisible(fullAccess.value, visible);
    save('composer-permission-mode-visibility', value);
  };
  const learnMore = <a href="https://developers.openai.com/codex/config-basic" target="_blank" rel="noreferrer"
    style={{ color: 'var(--yard-accent, #339cff)', textDecoration: 'none' }}>Learn more</a>;
  const archiveDays = props.snapshot.autoArchiveAfterDays.value;
  return <>
    <h1>{t('General')}</h1>
    <h3 className="yard-settings-group-title">{translateKnown(t, 'Permissions')}</h3>
    <div className="yard-setting-group">
      <Row label="Default permissions" description={<span style={{ display: 'block', maxWidth: 540 }}>By default, ChatGPT can read and edit files in its workspace. It can ask for additional access when needed</span>}>
        <input type="checkbox" role="switch" aria-label="Default permissions are always shown" checked disabled readOnly style={{ backgroundColor: 'var(--yard-accent, #339cff)' }} />
      </Row>
      <Row label="Full access" description={<span style={{ display: 'block', maxWidth: 540 }}>When ChatGPT runs with full access, it can edit any file on your computer and run commands with network, without your approval. This significantly increases the risk of data loss, leaks, or unexpected behavior. {learnMore} about elevated risks.</span>}
        error={fullAccess.error} retry={() => { void props.preferences.reload('composer-permission-mode-visibility'); }}>
        <input type="checkbox" role="switch" aria-label="Show Full access in the composer" checked={fullAccessVisible(fullAccess.value)}
          style={fullAccessVisible(fullAccess.value) ? { backgroundColor: 'var(--yard-accent, #339cff)' } : undefined}
          disabled={entryState(fullAccess).disabled || fullAccess.conflict} onChange={event => {
            if (event.target.checked) setConfirmFullAccess(true); else setFullAccess(false);
          }} />
      </Row>

    </div>
    <h3 className="yard-settings-group-title">{t('General')}</h3>
    <div className="yard-setting-group">
      <Row label="Default file open destination" description="Where files and folders open by default">
        <button type="button" disabled title="No file-opening targets are available in this web host.">No targets found</button>
      </Row>
      <Row label="Language" description={<>{t('Language for the app.')}{language && !hasTranslations(language) && <> {t('Interface text is currently shown in English for this language.')}</>}</>}
        error={props.snapshot.localeOverride.error} retry={() => { void props.preferences.reload('localeOverride'); }}>
        <select aria-label={t('Language')} value={language} disabled={entryState(props.snapshot.localeOverride).disabled}
          onChange={event => props.preferences.edit('localeOverride', event.target.value || null)}>
          <option value="">{t('Auto detect')}</option>
          {language && !languageOptions.some(option => option.value === language) && <option value={language}>{language}{!hasTranslations(language) && ` (${t('English text')})`}</option>}
          {languageOptions.map(option => <option key={option.value} value={option.value}>{option.label}{!option.translated && ` (${t('English text')})`}</option>)}
        </select>
      </Row>
      <Row label="Confirm before closing a window" description={close.value === 'keyboardOnly' ? 'Warn when a tab-close shortcut would close the window' : 'Choose when to warn before closing a window. Alt+F4 and the close button warn only with Always'}
        error={close.error} retry={() => { void props.preferences.reload('confirm-before-close'); }}>
        <select aria-label="Confirm before closing a window" value={close.value} disabled={entryState(close).disabled || close.conflict}
          onChange={event => save('confirm-before-close', event.target.value as GeneralPreferenceValues['confirm-before-close'])}>
          <option value="never">Never</option><option value="keyboardOnly">Close shortcut only</option><option value="always">Always</option>
        </select>
      </Row>

      <Row label="Bottom panel" description="Show the bottom panel control in the app header"
        error={bottomPanel.error} retry={() => { void props.preferences.reload('app-shell-bottom-panel-launcher-visible'); }}>
        <input type="checkbox" role="switch" aria-label="Bottom panel" checked={bottomPanel.value} disabled={entryState(bottomPanel).disabled || bottomPanel.conflict}
          style={bottomPanel.value ? { backgroundColor: 'var(--yard-accent, #339cff)' } : undefined}
          onChange={event => save('app-shell-bottom-panel-launcher-visible', event.target.checked)} />
      </Row>

      {bottomPanel.value && <Row label="Default terminal location" description="Choose where the terminal shortcut and environment actions open terminal tabs"
        error={props.snapshot.defaultTerminalLocation.error} retry={() => { void props.preferences.reload('defaultTerminalLocation'); }}>
        <div className="yard-segmented" role="group" aria-label={t('Default terminal location')}>
          {(['bottom', 'right'] as const).map(value => <button key={value} type="button" aria-pressed={props.snapshot.defaultTerminalLocation.value === value}
            disabled={entryState(props.snapshot.defaultTerminalLocation).disabled} onClick={() => props.preferences.edit('defaultTerminalLocation', value)}>{t(value === 'bottom' ? 'Bottom' : 'Right')}</button>)}
        </div>
      </Row>}
      {props.platform !== 'windows' && <Toggle {...props} accent setting="preventSleepWhileRunning" label="Prevent sleep while running"
        unavailable="Keeping the computer awake is not available in this web host." />}
      <Row label="Automatically archive inactive chats" description="Automatic archiving is not available in this web host." error={props.snapshot.autoArchiveAfterDays.error}
        retry={() => { void props.preferences.reload('autoArchiveAfterDays'); }}>
        <select aria-label="Automatically archive inactive chats" value={archiveDays} disabled>
          <option value={archiveDays}>{archiveDays === 0 ? 'Never' : `${archiveDays} ${archiveDays === 1 ? 'day' : 'days'}`}</option>
        </select>
      </Row>
      <Row label="Import work from other AI apps" description="Bring over your setup, projects, and recent chats">
        <button type="button" disabled title="Importing from other apps is not available in this web host.">Unavailable</button>
      </Row>
      <Row label="Open source licenses" description="Third-party notices for bundled dependencies"><button type="button" onClick={() => props.navigate('open-source-licenses')}>{t('View')}</button></Row>
    </div>
    <h3 className="yard-settings-group-title">{t('Composer')}</h3>
    <div className="yard-setting-group">
      <Toggle {...props} accent setting="composerPlainTextMode" label="Plain text composer" description="Keep code, Markdown, and links as literal text while writing messages" />
      <Toggle {...props} accent setting="show-context-window-usage" label="Show context window usage" ariaLabel="Show context window usage in the composer" />
      <Select {...props} setting="composerEnterBehavior" label="Send shortcut" description="Choose when Enter sends a prompt or inserts a new line" options={[
        { value: 'enter', label: 'Enter' }, { value: 'cmdIfMultiline', label: 'Enter, or Ctrl/Command + Enter for multiline' },
        { value: 'cmdAlways', label: 'Ctrl/Command + Enter' },
      ]} />
      <Row label="Follow-up behavior" description="Queue follow-ups while ChatGPT runs or steer the current run." searchId="follow-up" error={props.snapshot.followUpQueueMode.error} retry={() => { void props.preferences.reload('followUpQueueMode'); }}>
        <div className="yard-segmented" role="group" aria-label={t('Follow-up messages')}>
          {(['queue', 'steer'] as const).map(value => <button key={value} type="button"
            aria-pressed={value === 'steer' ? props.snapshot.followUpQueueMode.value !== 'queue' : props.snapshot.followUpQueueMode.value === 'queue'}
            disabled={entryState(props.snapshot.followUpQueueMode).disabled} onClick={() => props.preferences.edit('followUpQueueMode', value)}>{translateKnown(t, value === 'queue' ? 'Queue' : 'Steer')}</button>)}
        </div>
      </Row>
      <Toggle {...props} accent setting="show-educational-tips" label="Educational tips" />
      <Toggle {...props} accent setting="ambient-suggestions-enabled" label="Suggestions" description="Show suggestions in the workspace." />
    </div>
    <h3 className="yard-settings-group-title">{translateKnown(t, 'Notifications')}</h3>
    <div className="yard-setting-group">
      <Row label="Turn completion notifications" description="Set when ChatGPT alerts you that it's finished. Notification delivery is not available in this web host."
        error={props.snapshot['notifications-turn-mode'].error} retry={() => { void props.preferences.reload('notifications-turn-mode'); }}>
        <select aria-label="Turn completion notifications" value={props.snapshot['notifications-turn-mode'].value}
          disabled={entryState(props.snapshot['notifications-turn-mode']).disabled || props.snapshot['notifications-turn-mode'].conflict}
          onChange={event => save('notifications-turn-mode', event.target.value as GeneralPreferenceValues['notifications-turn-mode'])}>
          <option value="off">Never</option><option value="unfocused">Only when unfocused</option><option value="always">Always</option>
        </select>
      </Row>

      {(['notifications-permissions-enabled', 'notifications-questions-enabled', 'notifications-dot-enabled'] as const).map((key, index) =>
        <Row key={key} label={['Enable permission notifications', 'Enable question notifications', 'Enable dot notifications'][index]}
          description={['Show alerts when notification permissions are required', 'Show alerts when input is needed to continue', 'Show alerts when your dot sends you a message'][index]}
          error={props.snapshot[key].error} retry={() => { void props.preferences.reload(key); }}>
          <input type="checkbox" role="switch" aria-label={['Enable permission notifications', 'Enable question notifications', 'Enable dot notifications'][index]}
            checked={props.snapshot[key].value} disabled={entryState(props.snapshot[key]).disabled || props.snapshot[key].conflict}
            style={props.snapshot[key].value ? { backgroundColor: 'var(--yard-accent, #339cff)' } : undefined}
            onChange={event => save(key, event.target.checked)} />
        </Row>)}
    </div>
    {confirmFullAccess && <div className="yard-dialog-backdrop"><div className="yard-dialog" role="dialog" aria-modal="true" aria-labelledby="yard-full-access-title"
      onKeyDown={event => { if (event.key === 'Escape') setConfirmFullAccess(false); }}>
      <h2 id="yard-full-access-title">Make Full Access available?</h2>
      <p>When selected, ChatGPT can access the internet and read and edit files without asking for approval, including potentially destructive commands.</p>
      <p>Turning this on adds Full Access to the permissions menu. It does not turn Full Access on. {learnMore}</p>
      <div className="yard-actions"><button type="button" autoFocus onClick={() => setConfirmFullAccess(false)}>{t('Cancel')}</button>
        <button type="button" disabled={entryState(fullAccess).disabled || fullAccess.conflict} onClick={() => { setConfirmFullAccess(false); setFullAccess(true); }}>Confirm</button></div>
    </div></div>}
  </>;
}
