import { entryState, NumberPreference, Row, Select, Toggle } from './PreferenceControls.tsx';
import type { PreferenceProps } from './PreferenceControls.tsx';
import { hasTranslations, languageOptions, useI18n } from '../i18n/index.tsx';

export function GeneralSection(props: PreferenceProps & { platform: string; navigate: (section: string) => void }) {
  const { t } = useI18n();
  const language = props.snapshot.localeOverride.value ?? '';
  return <>
    <h1>{t('General')}</h1>
    <h3 className="yard-settings-group-title">{t('General')}</h3>
    <div className="yard-setting-group">
      <Row label="Language" description={<>{t('Language for the app.')}{language && !hasTranslations(language) && <> {t('Interface text is currently shown in English for this language.')}</>}</>}
        error={props.snapshot.localeOverride.error} retry={() => { void props.preferences.reload('localeOverride'); }}>
        <select aria-label={t('Language')} value={language} disabled={entryState(props.snapshot.localeOverride).disabled}
          onChange={event => props.preferences.edit('localeOverride', event.target.value || null)}>
          <option value="">{t('Auto detect')}</option>
          {language && !languageOptions.some(option => option.value === language) && <option value={language}>{language}{!hasTranslations(language) && ` (${t('English text')})`}</option>}
          {languageOptions.map(option => <option key={option.value} value={option.value}>{option.label}{!option.translated && ` (${t('English text')})`}</option>)}
        </select>
      </Row>
      <Row label="Default terminal location" description="Choose where the terminal shortcut and environment actions open terminal tabs"
        error={props.snapshot.defaultTerminalLocation.error} retry={() => { void props.preferences.reload('defaultTerminalLocation'); }}>
        <div className="yard-segmented" role="group" aria-label={t('Default terminal location')}>
          {(['bottom', 'right'] as const).map(value => <button key={value} type="button" aria-pressed={props.snapshot.defaultTerminalLocation.value === value}
            disabled={entryState(props.snapshot.defaultTerminalLocation).disabled} onClick={() => props.preferences.edit('defaultTerminalLocation', value)}>{t(value === 'bottom' ? 'Bottom' : 'Right')}</button>)}
        </div>
      </Row>
      {props.platform !== 'windows' && <Toggle {...props} setting="preventSleepWhileRunning" label="Prevent sleep while running"
        unavailable="Keeping the computer awake is not available in this web host." />}
      <NumberPreference {...props} setting="autoArchiveAfterDays" label="Automatically archive inactive chats" min={0} max={36500}
        description="Days of inactivity. Set to 0 to turn off automatic archiving." />
      <Row label="Open source licenses" description="Third-party notices for bundled dependencies"><button type="button" onClick={() => props.navigate('open-source-licenses')}>{t('View')}</button></Row>
    </div>
    <h3 className="yard-settings-group-title">{t('Composer')}</h3>
    <div className="yard-setting-group">
      <Toggle {...props} setting="show-educational-tips" label="Educational tips" />
      <Toggle {...props} setting="composerPlainTextMode" label="Plain text composer" description="Keep code, Markdown, and links as literal text while writing." />
      <Toggle {...props} setting="show-context-window-usage" label="Show context window usage" />
      <Select {...props} setting="composerEnterBehavior" label="Send message" options={[
        { value: 'enter', label: 'Enter' }, { value: 'cmdIfMultiline', label: 'Enter, or Ctrl/Command + Enter for multiline' },
        { value: 'cmdAlways', label: 'Ctrl/Command + Enter' },
      ]} />
      <Row label="Follow-up behavior" searchId="follow-up" error={props.snapshot.followUpQueueMode.error} retry={() => { void props.preferences.reload('followUpQueueMode'); }}>
        <div className="yard-segmented" role="group" aria-label={t('Follow-up messages')}>
          {(['queue', 'steer'] as const).map(value => <button key={value} type="button"
            aria-pressed={value === 'steer' ? props.snapshot.followUpQueueMode.value !== 'queue' : props.snapshot.followUpQueueMode.value === 'queue'}
            disabled={entryState(props.snapshot.followUpQueueMode).disabled} onClick={() => props.preferences.edit('followUpQueueMode', value)}>{t(value === 'queue' ? 'Queue' : 'Steer current turn')}</button>)}
        </div>
      </Row>
      <Toggle {...props} setting="ambient-suggestions-enabled" label="Suggestions" description="Show suggestions in the workspace." />
    </div>
  </>;
}
