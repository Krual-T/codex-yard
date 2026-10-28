import { useEffect, useState } from 'react';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { entryState, Row } from './PreferenceControls.tsx';
import type { PreferenceProps } from './PreferenceControls.tsx';

interface KeymapState { supported: boolean; bindings: { command: string }[] }

export function KeyboardSection({ client, preferences, snapshot, platform }: PreferenceProps & { client: WorkbenchClient; platform: string }) {
  const [state, setState] = useState<KeymapState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setState(null); setError(null);
    void client.host<KeymapState>('codex-command-keymap-state').then(value => {
      if (typeof value?.supported !== 'boolean' || !Array.isArray(value.bindings)) throw new Error('Invalid keyboard settings response');
      if (active) setState(value);
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [client, attempt]);
  const number = snapshot['primary-number-shortcut-target'];
  const external = snapshot['external-browser-link-shortcut'];
  const primary = platform === 'macOS' ? 'Command' : 'Ctrl';
  const alt = platform === 'macOS' ? 'Option' : 'Alt';
  return <>
    <h2>Keyboard shortcuts</h2>
    <div className="yard-setting-group">
      <Row label="Number shortcuts" description={`Choose where ${primary}+1-9 navigates.`} error={number.error}
        retry={() => { void preferences.reload('primary-number-shortcut-target'); }}>
        <select aria-label="Number shortcuts" value={number.value} disabled={entryState(number).disabled} onChange={event => {
          preferences.edit('primary-number-shortcut-target', event.target.value as 'sidebar' | 'tabs');
          void preferences.saveOne('primary-number-shortcut-target');
        }}><option value="sidebar">Chats</option><option value="tabs">Tabs</option></select>
      </Row>
      <Row label="Open web link in default browser" description="Modifier used when opening links." error={external.error}
        retry={() => { void preferences.reload('external-browser-link-shortcut'); }}>
        <select aria-label="Open web link in default browser" value={external.value} disabled={entryState(external).disabled} onChange={event => {
          preferences.edit('external-browser-link-shortcut', event.target.value as 'unassigned' | 'primary' | 'alt' | 'primary-shift');
          void preferences.saveOne('external-browser-link-shortcut');
        }}><option value="unassigned">Unassigned</option><option value="primary">{primary}+Click</option>
          <option value="alt">{alt}+Click</option><option value="primary-shift">{primary}+Shift+Click</option></select>
      </Row>
    </div>
    {error && <p className="yard-setting-error" role="alert">Could not load shortcuts: {error} <button type="button" className="yard-link" onClick={() => setAttempt(value => value + 1)}>Retry</button></p>}
    {!state && !error && <p role="status">Loading shortcuts...</p>}
    {state && !state.supported && <p className="yard-muted">Custom keyboard bindings are not supported by this web host.</p>}
    {state?.supported && <>
      <p className="yard-muted">Custom shortcut editing is not connected in this web host.</p>
      <div className="yard-setting-group">{state.bindings.filter(binding => typeof binding.command === 'string').map((binding, index) =>
        <Row key={`${binding.command}:${index}`} label={binding.command} />)}</div>
    </>}
  </>;
}
