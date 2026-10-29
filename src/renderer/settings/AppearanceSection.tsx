import { useEffect, useLayoutEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Download } from 'lucide-react';
import { translateKnown, useI18n } from '../i18n/index.tsx';
import { NumberPreference, Row, Select, Toggle, entryState } from './PreferenceControls.tsx';
import type { PreferenceProps } from './PreferenceControls.tsx';
import { codeThemes, defaultThemes, exportTheme, importTheme, mergeImportedTheme, preferenceDefinitions } from './preferences.ts';
import type { ChromeTheme, PreferenceKey, ThemeVariant } from './preferences.ts';
import { ThemeFontControls } from './ThemeFontControls.tsx';

type ColorKey = 'surface' | 'ink';
type ColorDrafts = Record<ThemeVariant, Partial<Record<ColorKey, string>>>;
const validColor = (value: string) => /^#[\da-f]{6}$/i.test(value);

function ModePreview({ mode }: { mode: 'system' | ThemeVariant }) {
  return <span className={`yard-mode-preview yard-mode-${mode}`} aria-hidden="true">
    <span className="yard-mode-window yard-mode-window-light"><i /><b /><b /><b /></span>
    {mode !== 'light' && <span className="yard-mode-window yard-mode-window-dark"><i /><b /><b /><b /></span>}
  </span>;
}

function ThemeEditor({ variant, onDirtyChange, onInvalidChange, revealTarget, ...props }: PreferenceProps & {
  variant: ThemeVariant; platform: string; backdropSupported: boolean; onDirtyChange: (dirty: boolean) => void;
  onInvalidChange: (invalid: boolean) => void; revealTarget: string | null;
}) {
  const { t, locale } = useI18n();
  const variantLabel = t(variant === 'light' ? 'Light' : 'Dark').toLocaleLowerCase(locale);
  const titleVariant = t(variant === 'light' ? 'Light' : 'Dark');
  const themeLabel = t(variant === 'light' ? 'Light theme' : 'Dark theme');
  const themeKey = variant === 'light' ? 'appearanceLightChromeTheme' : 'appearanceDarkChromeTheme';
  const codeKey = variant === 'light' ? 'appearanceLightCodeThemeId' : 'appearanceDarkCodeThemeId';
  const entry = props.snapshot[themeKey], codeEntry = props.snapshot[codeKey];
  const theme = entry.value ?? defaultThemes[variant];
  const [dialog, setDialog] = useState<'import' | 'export' | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [colors, setColors] = useState<ColorDrafts>({ light: {}, dark: {} });
  const [fontOpen, setFontOpen] = useState(false);
  const [accentOpen, setAccentOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const invalidColor = Object.values(colors).some(variantColors => Object.values(variantColors).some(value => value !== undefined && !validColor(value)));
  useLayoutEffect(() => { onDirtyChange(dialog === 'import' && text.trim().length > 0 || invalidColor); }, [dialog, text, invalidColor, onDirtyChange]);
  useLayoutEffect(() => { onInvalidChange(invalidColor); }, [invalidColor, onInvalidChange]);
  useLayoutEffect(() => () => onInvalidChange(false), [onInvalidChange]);
  useEffect(() => {
    if (!revealTarget) return;
    if (['ui-font-size', 'code-font-size', 'reduced-motion', 'diff-markers', 'pointer-cursors', 'font-smoothing', 'dock-icon',
      'theme-added', 'theme-removed', 'theme-skill', 'theme-contrast', 'transparent-window'].includes(revealTarget)) setAdvanced(true);
    if (['ui-font', 'content-font', 'code-font'].includes(revealTarget)) setFontOpen(true);
    if (revealTarget === 'theme-accent') setAccentOpen(true);
  }, [revealTarget]);
  const disabled = entryState(entry).disabled;
  const update = (patch: Partial<ChromeTheme>) => props.preferences.edit(themeKey, { ...theme, ...patch });
  const copyTheme = () => {
    const exported = exportTheme(variant, theme, codeEntry.value);
    const showFallback = () => { setText(exported); setError(t('Clipboard unavailable. Select and copy the text.')); setDialog('export'); };
    setCopyStatus('');
    if (!navigator.clipboard) { showFallback(); return; }
    void navigator.clipboard.writeText(exported).then(() => setCopyStatus(t('Copied.'))).catch(showFallback);
  };
  const applyImport = () => {
    try {
      const next = importTheme(text, variant);
      props.preferences.edit(themeKey, mergeImportedTheme(theme, next.theme));
      props.preferences.edit(codeKey, next.codeThemeId);
      setColors(current => ({ ...current, [variant]: {} }));
      setDialog(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const editColor = (key: ColorKey, value: string) => {
    setColors(current => ({ ...current, [variant]: { ...current[variant], [key]: validColor(value) ? undefined : value } }));
    if (validColor(value)) update({ [key]: value });
  };
  const reset = () => {
    setColors({ light: {}, dark: {} });
    for (const key of appearanceKeys) props.preferences.edit(key, preferenceDefinitions[key].defaultValue);
  };
  return <>
    <section className="yard-theme-editor" aria-label={translateKnown(t, 'Theme')}>
      <h2 className="yard-sr-only">{translateKnown(t, 'Theme')}</h2>
      <div className="yard-appearance-card">
        <Row label="Theme" error={codeEntry.error} retry={() => { void props.preferences.reload(codeKey); }}>
          <button className="yard-icon-button" type="button" data-setting-id="theme-import" title={`${t('Import')} ${themeLabel.toLocaleLowerCase(locale)}`}
            aria-label={`${t('Import')} ${themeLabel.toLocaleLowerCase(locale)}`} onClick={() => { setText(''); setError(''); setDialog('import'); }} disabled={disabled || entryState(codeEntry).disabled}><Download size={16} /></button>
          <button className="yard-icon-button" type="button" data-setting-id="theme-export" title={`${t('Copy')} ${themeLabel.toLocaleLowerCase(locale)}`}
            aria-label={`${t('Copy')} ${themeLabel.toLocaleLowerCase(locale)}`} onClick={copyTheme} disabled={disabled || entryState(codeEntry).disabled}><Copy size={16} /></button>
          <span className="yard-sr-only" role="status">{copyStatus}</span>
          <span className="yard-code-theme-select"><span aria-hidden="true">Aa</span><select data-setting-id="code-theme" aria-label={`${titleVariant} ${translateKnown(t, 'code theme').toLocaleLowerCase(locale)}`} value={codeEntry.value} disabled={entryState(codeEntry).disabled}
            onChange={event => props.preferences.edit(codeKey, event.target.value)}>
            {[...(codeThemes[variant].includes(codeEntry.value) ? [] : [codeEntry.value]), ...codeThemes[variant]].map(value => <option key={value} value={value}>{value === 'codex' ? 'ChatGPT' : value}</option>)}
          </select><ChevronDown size={13} aria-hidden="true" /></span>
        </Row>
        <Row label="Accent" error={entry.error} retry={() => { void props.preferences.reload(themeKey); }}>
          <details className="yard-theme-menu" open={accentOpen} onToggle={event => setAccentOpen(event.currentTarget.open)}>
            <summary aria-label={`${titleVariant} accent color`}><span className="yard-swatch" style={{ backgroundColor: theme.accentSource === 'custom' ? theme.accent : '#000' }} />{theme.accentSource === 'custom' ? theme.accent.toUpperCase() : t('Default')}<ChevronDown size={13} /></summary>
            <div className="yard-theme-popover"><button type="button" disabled={disabled} onClick={() => { update({ accent: defaultThemes[variant].accent, accentSource: 'chatgpt' }); setAccentOpen(false); }}>{t('Default')}</button>
              <label>{translateKnown(t, 'Custom')} <input type="color" aria-label={`${variantLabel} ${translateKnown(t, 'Accent')}`} value={theme.accent} disabled={disabled}
                onChange={event => update({ accent: event.target.value, accentSource: 'custom' })} /></label></div>
          </details>
        </Row>
        {([['surface', 'Background'], ['ink', 'Foreground']] as const).map(([key, label]) => <Row key={key} label={label} searchId={key === 'ink' ? 'theme-text' : undefined}
          error={colors[variant][key] !== undefined && !validColor(colors[variant][key]!) ? 'Enter a six-digit hex color, such as #123456.' : entry.error}
          retry={entry.error ? () => { void props.preferences.reload(themeKey); } : undefined}>
          <div className="yard-color-control"><input type="color" aria-label={`${titleVariant} ${label.toLocaleLowerCase(locale)} color`} value={theme[key]} disabled={disabled}
            onChange={event => editColor(key, event.target.value)} />
            <input type="text" aria-label={`${titleVariant} ${label.toLocaleLowerCase(locale)} color value`} value={colors[variant][key] ?? theme[key].toUpperCase()}
              aria-invalid={colors[variant][key] !== undefined && !validColor(colors[variant][key]!)} disabled={disabled} onChange={event => editColor(key, event.target.value)} /></div>
        </Row>)}
        <Row label="Font"><details className="yard-theme-menu" open={fontOpen} onToggle={event => setFontOpen(event.currentTarget.open)}>
          <summary aria-label={`${titleVariant} UI font`}>{theme.fonts.ui || t('System')}<ChevronDown size={13} /></summary>
          <div className="yard-theme-popover yard-font-popover"><ThemeFontControls fonts={theme.fonts} variantLabel={variantLabel} disabled={disabled} onChange={fonts => update({ fonts })} /></div>
        </details></Row>
      </div>
    </section>
    <button type="button" className="yard-advanced-toggle" aria-expanded={advanced} onClick={() => setAdvanced(value => !value)}>{translateKnown(t, 'Advanced')}<ChevronRight size={15} className={advanced ? 'yard-advanced-open' : ''} /></button>
    {advanced && <div className="yard-advanced-settings">
      <div className="yard-appearance-card">
        <NumberPreference {...props} setting="sansFontSize" label="Interface font size" min={11} max={16} />
        <NumberPreference {...props} setting="codeFontSize" label="Code font size" min={8} max={24} />
        <Select {...props} setting="reduced-motion-preference" label="Reduce motion" options={[{ value: 'system', label: 'System' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />
        <Select {...props} setting="appearanceDiffMarkerStyle" label="Diff markers" options={[{ value: 'color', label: 'Color' }, { value: 'symbols', label: 'Plus / minus' }]} />
        <Toggle {...props} setting="usePointerCursors" label="Pointer cursors" />
        {props.platform === 'macOS' && <Toggle {...props} setting="useFontSmoothing" label="Font smoothing" />}
        {props.platform === 'macOS' && <Select {...props} setting="dock-icon-preference" label="Dock icon" unavailable="Changing the Dock icon is unavailable in the web host." options={[{ value: 'app-default', label: 'Default' }, { value: 'codex-system', label: 'Codex' }, { value: 'space-system', label: 'Space' }]} />}
        {([['diffAdded', 'Added lines'], ['diffRemoved', 'Removed lines'], ['skill', 'Skill color']] as const).map(([key, label]) => <Row key={key} label={label}>
          <input type="color" aria-label={`${variantLabel} ${translateKnown(t, label)}`} value={theme.semanticColors[key]} disabled={disabled}
            onChange={event => update({ semanticColors: { ...theme.semanticColors, [key]: event.target.value } })} />
          <span className="yard-color-value">{theme.semanticColors[key]}</span></Row>)}
        <Row label="Contrast"><input type="range" aria-label={`${variantLabel} ${t('Contrast').toLocaleLowerCase(locale)}`} min={0} max={100} value={theme.contrast} disabled={disabled}
          onChange={event => update({ contrast: Number(event.target.value) })} /><output>{theme.contrast}</output></Row>
        {props.backdropSupported && <Row label="Transparent window"><input type="checkbox" role="switch" aria-label={`${variantLabel} ${t('Transparent window').toLocaleLowerCase(locale)}`}
          checked={!theme.opaqueWindows} disabled={disabled} onChange={event => update({ opaqueWindows: !event.target.checked })} /></Row>}
      </div>
      <button type="button" onClick={reset}>{t('Restore defaults')}</button>
    </div>}
    {dialog && <div className="yard-dialog-backdrop"><div className="yard-dialog" role="dialog" aria-modal="true" aria-label={`${t(dialog === 'import' ? 'Import' : 'Export')} ${themeLabel.toLocaleLowerCase(locale)}`}>
      <h3>{t(dialog === 'import' ? 'Import' : 'Export')} {themeLabel.toLocaleLowerCase(locale)}</h3>
      <textarea autoFocus value={text} onChange={event => setText(event.target.value)} readOnly={dialog === 'export'} aria-label={t('Theme share string')} />
      {error && <p className="yard-setting-error" role="alert">{error}</p>}
      <div className="yard-actions"><button type="button" onClick={() => setDialog(null)}>{t('Close')}</button>
        {dialog === 'import' ? <button type="button" onClick={applyImport}>{t('Import')}</button> : <button type="button" onClick={() => {
          if (!navigator.clipboard) { setError(t('Clipboard unavailable. Select and copy the text.')); return; }
          void navigator.clipboard.writeText(text).then(() => setError(t('Copied.'))).catch(() => setError(t('Clipboard unavailable. Select and copy the text.')));
        }}>{t('Copy')}</button>}
      </div>
    </div></div>}
  </>;
}

const appearanceKeys: PreferenceKey[] = ['appearanceTheme', 'appearanceLightChromeTheme', 'appearanceDarkChromeTheme',
  'appearanceLightCodeThemeId', 'appearanceDarkCodeThemeId', 'appearanceDiffMarkerStyle', 'sansFontSize', 'codeFontSize',
  'useFontSmoothing', 'usePointerCursors', 'reduced-motion-preference', 'dock-icon-preference'];

export function AppearanceSection(props: PreferenceProps & { platform: string; backdropSupported: boolean; onDirtyChange: (dirty: boolean) => void;
  onInvalidChange: (invalid: boolean) => void; revealTarget?: string | null }) {
  const { t } = useI18n();
  const [systemDark, setSystemDark] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;
    const changed = () => setSystemDark(media.matches);
    media.addEventListener('change', changed); return () => media.removeEventListener('change', changed);
  }, []);
  const mode = props.snapshot.appearanceTheme.value;
  const variant: ThemeVariant = mode === 'system' ? systemDark ? 'dark' : 'light' : mode;
  return <>
    <h1>{t('Appearance')}</h1>
    <h3 className="yard-appearance-label">{translateKnown(t, 'Visual style')}</h3>
    <div className="yard-appearance-card yard-mode-row"><span>{translateKnown(t, 'Mode')}</span>
      <div className="yard-mode-options" role="radiogroup" aria-label={translateKnown(t, 'Theme')}>
        {(['system', 'light', 'dark'] as const).map(value => <label key={value} title={t(value === 'system' ? 'System' : value === 'light' ? 'Light' : 'Dark')}>
          <input className="yard-sr-only" type="radio" name="yard-appearance-mode" value={value} checked={mode === value} disabled={entryState(props.snapshot.appearanceTheme).disabled}
            onChange={() => props.preferences.edit('appearanceTheme', value)} aria-label={t(value === 'system' ? 'System' : value === 'light' ? 'Light' : 'Dark')} />
          <ModePreview mode={value} />
        </label>)}
      </div>
    </div>
    {props.snapshot.appearanceTheme.error && <p className="yard-setting-error" role="alert">{props.snapshot.appearanceTheme.error} <button className="yard-link" type="button" onClick={() => { void props.preferences.reload('appearanceTheme'); }}>{t('Retry')}</button></p>}
    <ThemeEditor {...props} variant={variant} revealTarget={props.revealTarget ?? null} />
  </>;
}
