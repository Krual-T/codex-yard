import { useLayoutEffect, useState } from 'react';
import { NumberPreference, Row, Select, Toggle, entryState } from './PreferenceControls.tsx';
import type { PreferenceProps } from './PreferenceControls.tsx';
import { codeThemes, defaultThemes, exportTheme, importTheme, preferenceDefinitions } from './preferences.ts';
import type { ChromeTheme, PreferenceKey, ThemeVariant } from './preferences.ts';

function ThemeEditor({ variant, onDirtyChange, ...props }: PreferenceProps & { variant: ThemeVariant; backdropSupported: boolean; onDirtyChange: (dirty: boolean) => void }) {
  const themeKey = variant === 'light' ? 'appearanceLightChromeTheme' : 'appearanceDarkChromeTheme';
  const codeKey = variant === 'light' ? 'appearanceLightCodeThemeId' : 'appearanceDarkCodeThemeId';
  const entry = props.snapshot[themeKey];
  const codeEntry = props.snapshot[codeKey];
  const theme = entry.value ?? defaultThemes[variant];
  const [dialog, setDialog] = useState<'import' | 'export' | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  useLayoutEffect(() => { onDirtyChange(dialog === 'import' && text.trim().length > 0); }, [dialog, text, onDirtyChange]);
  const disabled = entryState(entry).disabled;
  const update = (patch: Partial<ChromeTheme>) => props.preferences.edit(themeKey, { ...theme, ...patch });
  const font = (key: 'ui' | 'content' | 'code', value: string) => {
    const fonts = { ...theme.fonts, [key]: value || null };
    delete fonts[`${key}Face`];
    update({ fonts });
  };
  const openExport = () => { setText(exportTheme(variant, theme, codeEntry.value)); setError(''); setDialog('export'); };
  const applyImport = () => {
    try {
      const next = importTheme(text, variant);
      props.preferences.edit(themeKey, next.theme);
      props.preferences.edit(codeKey, next.codeThemeId);
      setDialog(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <section className="yard-theme-editor">
    <div className="yard-section-heading"><h3>{variant === 'light' ? 'Light' : 'Dark'} theme</h3>
      <div className="yard-actions"><button type="button" onClick={() => { setText(''); setError(''); setDialog('import'); }} disabled={disabled || entryState(codeEntry).disabled}>Import</button>
        <button type="button" onClick={openExport} disabled={disabled || entryState(codeEntry).disabled}>Export</button></div>
    </div>
    <div className="yard-theme-preview" style={{ backgroundColor: theme.surface, color: theme.ink, borderColor: theme.accent }}>
      <span style={{ color: theme.accent }}>Aa</span><span>Theme preview</span><code>const color = true;</code>
    </div>
    <div className="yard-setting-group">
      {([['accent', 'Accent'], ['surface', 'Background'], ['ink', 'Text']] as const).map(([key, label]) =>
        <Row key={key} label={label} error={entry.error} retry={() => { void props.preferences.reload(themeKey); }}>
          <input type="color" aria-label={`${variant} ${label}`} value={theme[key]} disabled={disabled}
            onChange={event => update(key === 'accent' ? { accent: event.target.value, accentSource: 'custom' } : { [key]: event.target.value })} />
          <span className="yard-color-value">{theme[key]}</span>
        </Row>)}
      {([['diffAdded', 'Added lines'], ['diffRemoved', 'Removed lines'], ['skill', 'Skill color']] as const).map(([key, label]) =>
        <Row key={key} label={label}><input type="color" aria-label={`${variant} ${label}`} value={theme.semanticColors[key]} disabled={disabled}
          onChange={event => update({ semanticColors: { ...theme.semanticColors, [key]: event.target.value } })} />
          <span className="yard-color-value">{theme.semanticColors[key]}</span></Row>)}
      <Row label="Contrast"><input type="range" aria-label={`${variant} contrast`} min={0} max={100} value={theme.contrast} disabled={disabled}
        onChange={event => update({ contrast: Number(event.target.value) })} /><output>{theme.contrast}</output></Row>
      {props.backdropSupported && <Row label="Transparent window"><input type="checkbox" role="switch" aria-label={`${variant} transparent window`}
        checked={!theme.opaqueWindows} disabled={disabled} onChange={event => update({ opaqueWindows: !event.target.checked })} /></Row>}
      {entry.available && <>
        {(['ui', 'content', 'code'] as const).map(key => <Row key={key} label={`${key === 'ui' ? 'Interface' : key === 'content' ? 'Content' : 'Code'} font`} description="Leave blank to use the default.">
          <input type="text" aria-label={`${variant} ${key} font`} value={theme.fonts[key] ?? ''} disabled={disabled}
            onChange={event => font(key, event.target.value)} />
        </Row>)}
      </>}
      <Select {...props} setting={codeKey} label="Code theme" options={
        [...(codeThemes[variant].includes(codeEntry.value) ? [] : [codeEntry.value]), ...codeThemes[variant]].map(value => ({ value, label: value }))
      } />
    </div>
    {dialog && <div className="yard-dialog-backdrop"><div className="yard-dialog" role="dialog" aria-modal="true" aria-label={`${dialog === 'import' ? 'Import' : 'Export'} ${variant} theme`}>
      <h3>{dialog === 'import' ? 'Import' : 'Export'} {variant} theme</h3>
      <textarea autoFocus value={text} onChange={event => setText(event.target.value)} readOnly={dialog === 'export'} aria-label="Theme share string" />
      {error && <p className="yard-setting-error" role="alert">{error}</p>}
      <div className="yard-actions"><button type="button" onClick={() => setDialog(null)}>Close</button>
        {dialog === 'import' ? <button type="button" onClick={applyImport}>Import</button> :
          <button type="button" onClick={() => {
            if (!navigator.clipboard) { setError('Clipboard unavailable. Select and copy the text.'); return; }
            void navigator.clipboard.writeText(text).then(() => setError('Copied.')).catch(() => setError('Clipboard unavailable. Select and copy the text.'));
          }}>Copy</button>}
      </div>
    </div></div>}
  </section>;
}

const appearanceKeys: PreferenceKey[] = ['appearanceTheme', 'appearanceLightChromeTheme', 'appearanceDarkChromeTheme',
  'appearanceLightCodeThemeId', 'appearanceDarkCodeThemeId', 'appearanceDiffMarkerStyle', 'sansFontSize', 'codeFontSize',
  'useFontSmoothing', 'usePointerCursors', 'reduced-motion-preference', 'dock-icon-preference'];

export function AppearanceSection(props: PreferenceProps & { platform: string; backdropSupported: boolean; onDirtyChange: (dirty: boolean) => void }) {
  const [variant, setVariant] = useState<ThemeVariant>('light');
  const reset = () => { for (const key of appearanceKeys) props.preferences.edit(key, preferenceDefinitions[key].defaultValue); };
  return <>
    <div className="yard-section-heading"><h2>Appearance</h2><button type="button" onClick={reset}>Restore defaults</button></div>
    <div className="yard-setting-group">
      <Select {...props} setting="appearanceTheme" label="Appearance" options={[
        { value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' },
      ]} />
      <NumberPreference {...props} setting="sansFontSize" label="Interface font size" min={11} max={16} />
      <NumberPreference {...props} setting="codeFontSize" label="Code font size" min={8} max={24} />
      <Select {...props} setting="reduced-motion-preference" label="Reduce motion" options={[
        { value: 'system', label: 'System' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' },
      ]} />
      <Select {...props} setting="appearanceDiffMarkerStyle" label="Diff markers" options={[
        { value: 'color', label: 'Color' }, { value: 'symbols', label: 'Plus / minus' },
      ]} />
      <Toggle {...props} setting="usePointerCursors" label="Pointer cursors" />
      {props.platform === 'macOS' && <Toggle {...props} setting="useFontSmoothing" label="Font smoothing" />}
      {props.platform === 'macOS' && <Select {...props} setting="dock-icon-preference" label="Dock icon" unavailable="Changing the Dock icon is unavailable in the web host." options={[
        { value: 'app-default', label: 'Default' }, { value: 'codex-system', label: 'Codex' }, { value: 'space-system', label: 'Space' },
      ]} />}
    </div>
    <div className="yard-segmented" aria-label="Edit theme variant">
      {(['light', 'dark'] as const).map(value => <button type="button" key={value} aria-pressed={variant === value} onClick={() => setVariant(value)}>{value === 'light' ? 'Light' : 'Dark'}</button>)}
    </div>
    <ThemeEditor {...props} key={variant} variant={variant} />
    {!props.backdropSupported && <p className="yard-muted">Transparent windows are unavailable on this platform.</p>}
  </>;
}
