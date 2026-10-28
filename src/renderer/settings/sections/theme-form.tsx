/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import type { ComponentType, ReactNode } from 'react';
import type { MessageDescriptor, SettingRowProps, ToggleProps } from './section-types.ts';
import type { ThemeVariant, ThemeVariantSettingsProps } from './theme-variants.tsx';

export interface ThemeFontFace {
  family: string;
  fullName: string;
  postscriptName: string;
}

export interface ThemeFonts {
  ui: string | null;
  content?: string | null;
  code: string | null;
  uiFace?: ThemeFontFace;
  contentFace?: ThemeFontFace;
  codeFace?: ThemeFontFace;
}

export interface ChromeTheme {
  accent: string;
  accentSource?: 'chatgpt' | 'custom';
  surface: string;
  ink: string;
  contrast: number;
  opaqueWindows: boolean;
  fonts: ThemeFonts;
  semanticColors: { diffAdded: string; diffRemoved: string; skill: string };
}

export interface CodeThemePreset {
  id: string;
  label: string;
}

export type AccountAccent = 'default' | 'blue' | 'green' | 'yellow' | 'pink' | 'orange' | 'purple' | 'black';
export type ThemePatch = Partial<Pick<ChromeTheme, 'accent' | 'accentSource' | 'surface' | 'ink' | 'opaqueWindows' | 'contrast'>>;

export interface ThemeSettings {
  canImportThemeString: (value: string) => boolean;
  codeThemes: CodeThemePreset[];
  exportThemeString: () => string;
  fonts: ThemeFonts;
  importThemeString: (value: string) => Promise<void>;
  selectedCodeTheme: CodeThemePreset;
  setCodeThemeId: (id: string) => Promise<void>;
  setAccountAccent: (accent: AccountAccent, onApplied?: () => void) => Promise<void>;
  setFontsPatch: (patch: Partial<ThemeFonts>) => void;
  setThemePatch: (patch: ThemePatch) => void;
  theme: ChromeTheme;
}

export interface ThemeFormMessages {
  theme: MessageDescriptor;
  chromeThemeAccent: MessageDescriptor;
  chromeThemeBackground: MessageDescriptor;
  chromeThemeForeground: MessageDescriptor;
  chromeThemeContrast: MessageDescriptor;
  chromeThemeTranslucentSidebar: MessageDescriptor;
  chromeThemeCodeFont: MessageDescriptor;
}

export interface ThemeToast {
  success: (message: string) => void;
  danger: (message: string | ReactNode, options: { errorAnalytics: { toastId: string } }) => void;
}

export interface ThemeFormDependencies {
  useThemeSettings: (variant: ThemeVariant) => ThemeSettings;
  useIntl: () => { formatMessage: (message: MessageDescriptor, values?: { variant: string }) => string };
  useToastGetter: () => () => ThemeToast;
  copyToClipboard: (value: string) => Promise<boolean>;
  messages: ThemeFormMessages;
  FormattedMessage: ComponentType<MessageDescriptor>;
  FormSection: ComponentType<{ title: ReactNode; headerControl?: ReactNode; children?: ReactNode }>;
  Row: ComponentType<SettingRowProps>;
  Toggle: ComponentType<ToggleProps>;
  Tooltip: ComponentType<{ cloneCustomTrigger: true; tooltipContent: string; children?: ReactNode }>;
  Button: ComponentType<{
    'aria-label': string;
    color: 'ghost';
    size: 'iconCircle';
    onClick?: () => void;
    children?: ReactNode;
  }>;
  ImportIcon: ComponentType;
  CopyIcon: ComponentType;
  ImportDialog: ComponentType<{
    exampleValue: string;
    isImportValueValid: boolean;
    isOpen: boolean;
    triggerContent: ReactNode;
    value: string;
    variantLabel: string;
    onOpenChange: (open: boolean) => void;
    onSubmit: () => void;
    onValueChange: (value: string) => void;
  }>;
  CodeThemePicker: ComponentType<{
    ariaLabel: string;
    codeThemes: CodeThemePreset[];
    selectedCodeTheme: CodeThemePreset;
    theme: ChromeTheme;
    variant: ThemeVariant;
    onSelect: (id: string) => void;
  }>;
  AccentPicker: ComponentType<{
    ariaLabel: string;
    theme: ChromeTheme;
    variant: ThemeVariant;
    onSelect: ThemeSettings['setAccountAccent'];
    onCustomColorChange: (color: string) => void;
  }>;
  ColorPicker: ComponentType<{ ariaLabel: string; value: string; onChange: (color: string) => void }>;
  FontPicker: ComponentType<{
    ariaLabel: string;
    controls: 'family' | 'style' | 'both';
    defaultFont: 'ui' | 'system';
    monospaceOnly: boolean;
    selectedThemeFontFace?: ThemeFontFace;
    styleAriaLabel: string;
    value: string | null;
    onChange: (value: string | null, face: ThemeFontFace | undefined) => void;
  }>;
  ContrastSlider: ComponentType<{ ariaLabel: string; theme: ChromeTheme; value: number; onChange: (value: number) => void }>;
}

/** $a: one light or dark theme form, backed by the original theme settings hook. */
export function createThemeFormComponent(React: typeof import('react'), deps: ThemeFormDependencies) {
  const { FormattedMessage, FormSection, Row, Toggle, Tooltip, Button, ImportIcon, CopyIcon,
    ImportDialog, CodeThemePicker, AccentPicker, ColorPicker, FontPicker, ContrastSlider, messages } = deps;

  return function ThemeForm({ section, showTranslucentSidebarToggle, showVariantTitle, variant }: ThemeVariantSettingsProps) {
    const getToast = deps.useToastGetter();
    const intl = deps.useIntl();
    const accentLabel = intl.formatMessage(messages.chromeThemeAccent);
    const backgroundLabel = intl.formatMessage(messages.chromeThemeBackground);
    const foregroundLabel = intl.formatMessage(messages.chromeThemeForeground);
    const contrastLabel = intl.formatMessage(messages.chromeThemeContrast);
    const translucentLabel = intl.formatMessage(messages.chromeThemeTranslucentSidebar);
    const { canImportThemeString, codeThemes, exportThemeString, fonts, importThemeString, selectedCodeTheme,
      setCodeThemeId, setAccountAccent, setFontsPatch, setThemePatch, theme } = deps.useThemeSettings(variant);
    const variantLabel = intl.formatMessage(variant === 'light'
      ? { id: 'settings.general.appearance.theme.light', defaultMessage: 'Light', description: 'Light theme option' }
      : { id: 'settings.general.appearance.theme.dark', defaultMessage: 'Dark', description: 'Dark theme option' });
    const importLabel = intl.formatMessage({ id: 'settings.general.appearance.chromeTheme.import.ariaLabel', defaultMessage: 'Import {variant} theme', description: 'Accessible label for importing a shared light or dark theme string' }, { variant: variantLabel });
    const exportLabel = intl.formatMessage({ id: 'settings.general.appearance.chromeTheme.export.ariaLabel', defaultMessage: 'Copy {variant} theme', description: 'Accessible label for copying a shared light or dark theme string' }, { variant: variantLabel });
    const [importOpen, setImportOpen] = React.useState(false);
    const [importValue, setImportValue] = React.useState('');

    const colorRows = [
      { role: 'accent' as const, label: accentLabel, ariaLabel: intl.formatMessage({ id: 'settings.general.appearance.chromeTheme.accent', defaultMessage: '{variant} accent color', description: 'Aria label for the accent color input in chrome theme settings' }, { variant: variantLabel }) },
      { role: 'surface' as const, label: backgroundLabel, ariaLabel: intl.formatMessage({ id: 'settings.general.appearance.chromeTheme.surface', defaultMessage: '{variant} background color', description: 'Aria label for the background color input in chrome theme settings' }, { variant: variantLabel }) },
      { role: 'ink' as const, label: foregroundLabel, ariaLabel: intl.formatMessage({ id: 'settings.general.appearance.chromeTheme.ink', defaultMessage: '{variant} ink color', description: 'Aria label for the ink color input in chrome theme settings' }, { variant: variantLabel }) },
    ];
    const fontRows = [
      { key: 'ui' as const, ariaLabel: intl.formatMessage({ id: 'settings.general.appearance.chromeTheme.uiFontFamily', defaultMessage: '{variant} UI font', description: 'Aria label for the UI font input in chrome theme settings' }, { variant: variantLabel }),
        label: section === 'visual' ? <FormattedMessage id="settings.appearance.fontFamily.short" defaultMessage="Font" description="Label for the interface font family picker in the main Appearance settings card" />
          : <FormattedMessage id="settings.appearance.uiFontStyle.short" defaultMessage="UI font style" description="Label for the interface font's weight and style picker in Advanced Appearance settings" />,
        styleAriaLabel: intl.formatMessage({ id: 'settings.general.appearance.chromeTheme.uiFontStyle', defaultMessage: '{variant} UI font style', description: 'Aria label for the UI font style dropdown in chrome theme settings' }, { variant: variantLabel }) },
      { key: 'content' as const, ariaLabel: intl.formatMessage({ id: 'settings.general.appearance.chromeTheme.contentFontFamily', defaultMessage: '{variant} content font', description: 'Aria label for the content font dropdown in chrome theme settings' }, { variant: variantLabel }),
        label: intl.formatMessage({ id: 'settings.general.appearance.chromeTheme.contentFontFamily.short', defaultMessage: 'Content font', description: 'Font for thread messages and Page content in this theme' }),
        styleAriaLabel: intl.formatMessage({ id: 'settings.general.appearance.chromeTheme.contentFontStyle', defaultMessage: '{variant} content font style', description: 'Aria label for the content font style dropdown in chrome theme settings' }, { variant: variantLabel }) },
      { key: 'code' as const, ariaLabel: intl.formatMessage({ id: 'settings.general.appearance.chromeTheme.codeFontFamily', defaultMessage: '{variant} code font', description: 'Aria label for the code font input in chrome theme settings' }, { variant: variantLabel }),
        label: intl.formatMessage(messages.chromeThemeCodeFont),
        styleAriaLabel: intl.formatMessage({ id: 'settings.general.appearance.chromeTheme.codeFontStyle', defaultMessage: '{variant} code font style', description: 'Aria label for the code font style dropdown in chrome theme settings' }, { variant: variantLabel }) },
    ];

    const updateColor = (role: 'accent' | 'surface' | 'ink', value: string) => {
      switch (role) {
        case 'accent': setThemePatch({ accent: value, accentSource: 'custom' }); break;
        case 'surface': setThemePatch({ surface: value }); break;
        case 'ink': setThemePatch({ ink: value }); break;
      }
    };
    const showImportError = () => getToast().danger(intl.formatMessage({ id: 'settings.general.appearance.chromeTheme.import.error', defaultMessage: 'Couldn’t import {variant} theme', description: 'Error toast shown when importing a theme share string fails' }, { variant: variantLabel }), { errorAnalytics: { toastId: 'settings.general.appearance.chromeTheme.import.error' } });
    const importTheme = async () => {
      const value = importValue.trim();
      if (!value) { showImportError(); return; }
      try {
        await importThemeString(value);
        setImportOpen(false);
        setImportValue('');
        getToast().success(intl.formatMessage({ id: 'settings.general.appearance.chromeTheme.import.success', defaultMessage: '{variant} theme imported', description: 'Success toast shown after importing a theme share string' }, { variant: variantLabel }));
      } catch { showImportError(); }
    };
    const copyTheme = async () => {
      if (await deps.copyToClipboard(exportThemeString())) {
        getToast().success(intl.formatMessage({ id: 'settings.general.appearance.chromeTheme.export.success', defaultMessage: '{variant} theme copied', description: 'Success toast shown after copying a theme share string' }, { variant: variantLabel }));
      }
    };

    let title: ReactNode = null;
    if (showVariantTitle) {
      title = variant === 'light'
        ? <FormattedMessage id="settings.general.appearance.lightChromeTheme" defaultMessage="Light theme" description="Label for light chrome theme controls in appearance settings" />
        : <FormattedMessage id="settings.general.appearance.darkChromeTheme" defaultMessage="Dark theme" description="Label for dark chrome theme controls in appearance settings" />;
    } else if (section === 'visual') title = <FormattedMessage {...messages.theme} />;

    return <FormSection title={title} headerControl={section === 'visual' ? <div className="flex items-center gap-2 max-sm:w-full max-sm:flex-wrap max-sm:justify-end">
      <ImportDialog exampleValue={exportThemeString()} isImportValueValid={canImportThemeString(importValue)} isOpen={importOpen}
        triggerContent={<Tooltip cloneCustomTrigger tooltipContent={importLabel}><Button aria-label={importLabel} color="ghost" size="iconCircle"><ImportIcon /></Button></Tooltip>}
        value={importValue} variantLabel={variantLabel} onOpenChange={open => { setImportOpen(open); if (!open) setImportValue(''); }}
        onSubmit={() => { void importTheme(); }} onValueChange={setImportValue} />
      <Tooltip cloneCustomTrigger tooltipContent={exportLabel}><Button aria-label={exportLabel} color="ghost" size="iconCircle" onClick={() => { void copyTheme(); }}><CopyIcon /></Button></Tooltip>
      <CodeThemePicker ariaLabel={intl.formatMessage({ id: 'settings.general.appearance.codeTheme', defaultMessage: '{variant} code theme', description: 'Aria label for the code theme picker in appearance settings' }, { variant: variantLabel })}
        codeThemes={codeThemes} selectedCodeTheme={selectedCodeTheme} theme={theme} variant={variant} onSelect={id => {
          setCodeThemeId(id).catch(() => { getToast().danger(<FormattedMessage id="settings.general.appearance.codeTheme.applyError" defaultMessage="Could not apply theme" description="Error toast when the selected theme preset cannot be loaded or applied" />, { errorAnalytics: { toastId: 'settings.general.appearance.codeTheme.applyError' } }); });
        }} />
    </div> : undefined}>
      {section === 'visual' && colorRows.map(row => <Row key={row.role} size="compact" label={row.label}
        control={row.role === 'accent' ? <AccentPicker ariaLabel={row.ariaLabel} theme={theme} variant={variant} onSelect={setAccountAccent}
          onCustomColorChange={color => updateColor('accent', color)} />
          : <ColorPicker ariaLabel={row.ariaLabel} value={theme[row.role]} onChange={color => updateColor(row.role, color)} />} />)}
      {fontRows.filter(row => section === 'advanced' || row.key === 'ui').map(row => <Row key={row.key} size="compact" label={row.label}
        control={<FontPicker ariaLabel={row.ariaLabel} controls={row.key === 'ui' ? section === 'visual' ? 'family' : 'style' : 'both'}
          defaultFont={row.key === 'content' ? 'ui' : 'system'} monospaceOnly={row.key === 'code'}
          selectedThemeFontFace={fonts[`${row.key}Face`]} styleAriaLabel={row.styleAriaLabel} value={fonts[row.key] ?? null}
          onChange={(value, face) => { setFontsPatch({ [row.key]: value, [`${row.key}Face`]: face }); }} />} />)}
      {section === 'advanced' && showTranslucentSidebarToggle ? <Row size="compact" label={translucentLabel}
        control={<Toggle checked={!theme.opaqueWindows} onChange={value => { setThemePatch({ opaqueWindows: !value }); }}
          ariaLabel={intl.formatMessage({ id: 'settings.general.appearance.chromeTheme.translucentSidebar', defaultMessage: '{variant} translucent sidebar', description: 'Aria label for the translucent sidebar toggle in chrome theme settings' }, { variant: variantLabel })} />} /> : null}
      {section === 'advanced' && <Row size="compact" label={contrastLabel}
        control={<ContrastSlider ariaLabel={intl.formatMessage({ id: 'settings.general.appearance.chromeTheme.contrast', defaultMessage: '{variant} contrast', description: 'Aria label for the contrast slider in chrome theme settings' }, { variant: variantLabel })}
          theme={theme} value={theme.contrast} onChange={value => { setThemePatch({ contrast: value }); }} />} />}
    </FormSection>;
  };
}
