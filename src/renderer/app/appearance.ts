import { defaultThemes, isChromeTheme } from '../settings/preferences.ts';
import { applyThemeFontFaces, themeFontFamily } from './theme-fonts.ts';

/** Apply the same persisted theme edited by Appearance, clearing previous-mode values. */
export function applyAppearance(values: Record<string, unknown>, dark: boolean, root = document.documentElement) {
  const raw = dark ? values.appearanceDarkChromeTheme : values.appearanceLightChromeTheme;
  const theme = isChromeTheme(raw) ? raw : defaultThemes[dark ? 'dark' : 'light'];
  const style = root.style;
  applyThemeFontFaces(theme.fonts, root.ownerDocument);
  const contrast = theme.contrast / 100;
  const variables: Record<string, string> = {
    '--yard-bg': theme.surface, '--yard-fg': theme.ink, '--yard-accent': theme.accent,
    '--yard-surface': `color-mix(in srgb, ${theme.ink} 4%, ${theme.surface})`,
    '--yard-panel': `color-mix(in srgb, ${theme.ink} 6%, ${theme.surface})`,
    '--yard-sidebar': `color-mix(in srgb, ${theme.ink} 3%, ${theme.surface})`,
    '--yard-border': `color-mix(in srgb, ${theme.ink} ${8 + contrast * 27}%, ${theme.surface})`,
    '--yard-muted': `color-mix(in srgb, ${theme.ink} ${45 + contrast * 30}%, ${theme.surface})`,
    '--yard-diff-added': theme.semanticColors.diffAdded, '--yard-diff-removed': theme.semanticColors.diffRemoved,
    '--yard-skill': theme.semanticColors.skill, '--yard-danger': theme.semanticColors.diffRemoved,
    '--yard-ui-font': themeFontFamily(theme.fonts, 'ui', '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'),
    '--yard-content-font': themeFontFamily(theme.fonts, 'content', 'var(--yard-ui-font)'),
    '--yard-code-font': themeFontFamily(theme.fonts, 'code', 'ui-monospace, SFMono-Regular, Consolas, monospace'),
    '--yard-font-size': `${typeof values.sansFontSize === 'number' ? values.sansFontSize : 14}px`,
    '--yard-code-size': `${typeof values.codeFontSize === 'number' ? values.codeFontSize : 12}px`,
  };
  for (const [key, value] of Object.entries(variables)) style.setProperty(key, value);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.codeTheme = String((dark ? values.appearanceDarkCodeThemeId : values.appearanceLightCodeThemeId) ?? 'codex');
  root.dataset.diffMarkers = values.appearanceDiffMarkerStyle === 'symbols' ? 'symbols' : 'color';
  root.dataset.fontSmoothing = String(values.useFontSmoothing !== false);
  return { theme, mode: dark ? 'dark' as const : 'light' as const };
}
