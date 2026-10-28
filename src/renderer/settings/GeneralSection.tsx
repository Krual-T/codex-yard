import { NumberPreference, Row, Select, Toggle } from './PreferenceControls.tsx';
import type { PreferenceProps } from './PreferenceControls.tsx';

export function GeneralSection(props: PreferenceProps & { platform: string; navigate: (section: string) => void }) {
  return <>
    <h2>General</h2>
    <div className="yard-setting-group">
      <Select {...props} setting="defaultTerminalLocation" label="Default terminal location" options={[
        { value: 'bottom', label: 'Bottom' }, { value: 'right', label: 'Right' },
      ]} />
      {props.platform !== 'windows' && <Toggle {...props} setting="preventSleepWhileRunning" label="Prevent sleep while running"
        unavailable="Keeping the computer awake is not available in this web host." />}
      <NumberPreference {...props} setting="autoArchiveAfterDays" label="Automatically archive inactive chats" min={0} max={36500}
        description="Days of inactivity. Set to 0 to turn off automatic archiving." />
      <Toggle {...props} setting="ambient-suggestions-enabled" label="Suggestions" description="Show suggestions in the workspace." />
      <Row label="Language" description="Language tag, for example en-US. Leave blank to follow the system."
        error={props.snapshot.localeOverride.error} retry={() => { void props.preferences.reload('localeOverride'); }}>
        <input type="text" aria-label="Language" value={props.snapshot.localeOverride.value ?? ''}
          disabled={!props.snapshot.localeOverride.available || props.snapshot.localeOverride.saving}
          onChange={event => props.preferences.edit('localeOverride', event.target.value || null)} />
      </Row>
      <Row label="Open source licenses"><button type="button" onClick={() => props.navigate('open-source-licenses')}>View</button></Row>
    </div>
    <h3>Composer</h3>
    <div className="yard-setting-group">
      <Toggle {...props} setting="show-educational-tips" label="Educational tips" />
      <Toggle {...props} setting="composerPlainTextMode" label="Plain text composer" description="Keep code, Markdown, and links as literal text while writing." />
      <Toggle {...props} setting="show-context-window-usage" label="Show context window usage" />
      <Select {...props} setting="composerEnterBehavior" label="Send message" options={[
        { value: 'enter', label: 'Enter' }, { value: 'cmdIfMultiline', label: 'Enter, or Ctrl/Command + Enter for multiline' },
        { value: 'cmdAlways', label: 'Ctrl/Command + Enter' },
      ]} />
      <Select {...props} setting="followUpQueueMode" label="Follow-up messages" options={[
        { value: 'steer', label: 'Steer current turn' }, { value: 'queue', label: 'Queue' }, { value: 'interrupt', label: 'Interrupt current turn' },
      ]} />
    </div>
  </>;
}
