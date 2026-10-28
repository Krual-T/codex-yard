import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transform } from 'esbuild';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { rendererRoot } from '../lib/app-resources.ts';
import type { MessageDescriptor, SettingRowProps } from '../src/renderer/settings/sections/section-types.ts';
import type { AccountAccent, ChromeTheme, ThemeFontFace, ThemeFormDependencies, ThemeFormMessages, ThemeSettings, ThemeToast } from '../src/renderer/settings/sections/theme-form.tsx';
import type { ThemeVariant, ThemeVariantSettingsProps } from '../src/renderer/settings/sections/theme-variants.tsx';

const source = await readFile(new URL('../src/renderer/settings/sections/theme-form.tsx', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'tsx', format: 'esm', jsx: 'transform' });
const themeModule = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`) as typeof import('../src/renderer/settings/sections/theme-form.tsx');
const pinned = await readFile(rendererRoot + '/assets/general-settings-8997e171b11a.js', 'utf8');
const start = pinned.indexOf('function $a(e){');
const end = pinned.indexOf('function eo(e){', start);
assert.ok(start >= 0 && end > start);
assert.equal(pinned.indexOf('function $a(e){', start + 1), -1);
const original = pinned.slice(start, end);
const cache = { c: (length: number) => Array(length).fill(Symbol.for('react.memo_cache_sentinel')) };

type Props<K extends keyof ThemeFormDependencies> = ThemeFormDependencies[K] extends React.ComponentType<infer P> ? P : never;
interface Captures {
  dialog?: Props<'ImportDialog'>;
  code?: Props<'CodeThemePicker'>;
  accent?: Props<'AccentPicker'>;
  colors: Props<'ColorPicker'>[];
  fonts: Props<'FontPicker'>[];
  toggle?: Props<'Toggle'>;
  contrast?: Props<'ContrastSlider'>;
  copy?: Props<'Button'>;
}

function harness(useOriginal: boolean, props: ThemeVariantSettingsProps) {
  const values: unknown[] = [];
  let cursor = 0;
  const injected = {
    ...React,
    useState: (initial: unknown) => {
      const index = cursor++;
      if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
      return [values[index], (next: unknown) => { values[index] = typeof next === 'function' ? next(values[index]) : next; }];
    },
  } as typeof React;
  const events: unknown[] = [];
  let clipboardResult = true;
  let captured: Captures = { colors: [], fonts: [] };
  let formats: unknown[] = [];
  const message = (name: string): MessageDescriptor => ({ id: name, defaultMessage: name, description: name });
  const messages: ThemeFormMessages = {
    theme: message('theme'), chromeThemeAccent: message('accent'), chromeThemeBackground: message('background'),
    chromeThemeForeground: message('foreground'), chromeThemeContrast: message('contrast'),
    chromeThemeTranslucentSidebar: message('translucent'), chromeThemeCodeFont: message('code-font'),
  };
  const theme: ChromeTheme = {
    accent: '#111111', accentSource: 'custom', surface: '#eeeeee', ink: '#222222', contrast: 45,
    opaqueWindows: true, fonts: { ui: 'UI', content: 'Content', code: 'Code', uiFace: { family: 'UI', fullName: 'UI Regular', postscriptName: 'UI-Regular' } },
    semanticColors: { diffAdded: '#009900', diffRemoved: '#990000', skill: '#000099' },
  };
  const presets = [{ id: 'one', label: 'One' }, { id: 'bad', label: 'Broken' }];
  const themeSettings: ThemeSettings = {
    theme, fonts: theme.fonts, codeThemes: presets, selectedCodeTheme: presets[0],
    canImportThemeString: value => value.trim() === 'valid', exportThemeString: () => 'exported-theme',
    importThemeString: async value => { events.push(['import', value]); if (value === 'bad') throw new Error('bad theme'); },
    setCodeThemeId: async id => { events.push(['preset', id]); if (id === 'bad') throw new Error('bad preset'); },
    setAccountAccent: async (accent: AccountAccent, onApplied?: () => void) => { events.push(['account-accent', accent]); onApplied?.(); },
    setFontsPatch: patch => { events.push(['fonts', patch]); }, setThemePatch: patch => { events.push(['theme', patch]); },
  };
  const toast: ThemeToast = {
    success: text => { events.push(['success', text]); },
    danger: (text, options) => { events.push(['danger', React.isValidElement(text) ? renderToStaticMarkup(text) : text, options]); },
  };
  const intl = { formatMessage: (descriptor: MessageDescriptor, substitutions?: { variant: string }) => {
    formats.push([descriptor, substitutions]);
    return descriptor.defaultMessage.replace('{variant}', substitutions?.variant ?? '{variant}');
  } };
  const FormattedMessage = ({ id, defaultMessage }: MessageDescriptor) => React.createElement('strong', { 'data-message': id }, defaultMessage);
  const FormSection: ThemeFormDependencies['FormSection'] = ({ title, headerControl, children }) => React.createElement('section', null,
    React.createElement('header', null, title, headerControl), children);
  const Row = ({ label, control }: SettingRowProps) => React.createElement('div', { 'data-setting': true }, label,
    typeof control === 'function' ? control({}) : control);
  const Toggle: ThemeFormDependencies['Toggle'] = p => { captured.toggle = p; return React.createElement('i', { 'data-toggle': String(p.checked), 'data-label': p.ariaLabel }); };
  const Tooltip: ThemeFormDependencies['Tooltip'] = ({ children }) => React.createElement('span', null, children);
  const Button: ThemeFormDependencies['Button'] = p => {
    if (p.onClick) captured.copy = p;
    return React.createElement('button', { 'aria-label': p['aria-label'] }, p.children);
  };
  const ImportDialog: ThemeFormDependencies['ImportDialog'] = p => {
    captured.dialog = p;
    return React.createElement('div', { 'data-open': String(p.isOpen), 'data-valid': String(p.isImportValueValid), 'data-value': p.value }, p.triggerContent);
  };
  const CodeThemePicker: ThemeFormDependencies['CodeThemePicker'] = p => { captured.code = p; return React.createElement('i', { 'data-code-theme': p.selectedCodeTheme.id, 'data-label': p.ariaLabel }); };
  const AccentPicker: ThemeFormDependencies['AccentPicker'] = p => { captured.accent = p; return React.createElement('i', { 'data-accent': p.theme.accent, 'data-label': p.ariaLabel }); };
  const ColorPicker: ThemeFormDependencies['ColorPicker'] = p => { captured.colors.push(p); return React.createElement('i', { 'data-color': p.value, 'data-label': p.ariaLabel }); };
  const FontPicker: ThemeFormDependencies['FontPicker'] = p => {
    captured.fonts.push(p);
    return React.createElement('i', { 'data-font': p.value, 'data-controls': p.controls, 'data-default': p.defaultFont,
      'data-monospace': String(p.monospaceOnly), 'data-label': p.ariaLabel, 'data-style-label': p.styleAriaLabel });
  };
  const ContrastSlider: ThemeFormDependencies['ContrastSlider'] = p => { captured.contrast = p; return React.createElement('i', { 'data-contrast': p.value, 'data-label': p.ariaLabel }); };
  const ImportIcon = () => React.createElement('i', { 'data-icon': 'import' });
  const CopyIcon = () => React.createElement('i', { 'data-icon': 'copy' });
  const copyToClipboard = async (value: string) => { events.push(['copy', value]); return clipboardResult; };
  const deps: ThemeFormDependencies = {
    useThemeSettings: () => themeSettings, useIntl: () => intl, useToastGetter: () => () => toast, copyToClipboard, messages,
    FormattedMessage, FormSection, Row, Toggle, Tooltip, Button, ImportDialog, CodeThemePicker, AccentPicker, ColorPicker,
    FontPicker, ContrastSlider, ImportIcon, CopyIcon,
  };
  const variantTitle = (variant: ThemeVariant) => variant === 'light'
    ? React.createElement(FormattedMessage, { id: 'settings.general.appearance.lightChromeTheme', defaultMessage: 'Light theme', description: 'Label for light chrome theme controls in appearance settings' })
    : React.createElement(FormattedMessage, { id: 'settings.general.appearance.darkChromeTheme', defaultMessage: 'Dark theme', description: 'Label for dark chrome theme controls in appearance settings' });
  const variantLabel = (formatter: typeof intl, variant: ThemeVariant) => formatter.formatMessage(variant === 'light'
    ? { id: 'settings.general.appearance.theme.light', defaultMessage: 'Light', description: 'Light theme option' }
    : { id: 'settings.general.appearance.theme.dark', defaultMessage: 'Dark', description: 'Dark theme option' });
  const bindings = {
    fo: cache, po: injected, X: jsxRuntime, N: () => ({ get: () => toast }), R: {}, I: () => intl, Y: messages,
    hn: deps.useThemeSettings, uo: variantLabel, lo: variantTitle, at: copyToClipboard, qe: {},
    eo: FormSection, V: Row, Le: Toggle, dt: Tooltip, t: Button, Ne: ImportIcon, Ce: CopyIcon,
    to: ImportDialog, no: CodeThemePicker, La: AccentPicker, Da: ColorPicker, Ka: FontPicker, co: ContrastSlider, M: FormattedMessage,
  };
  const Component = useOriginal
    ? new Function(...Object.keys(bindings), `return (${original});`)(...Object.values(bindings)) as (input: ThemeVariantSettingsProps) => React.ReactNode
    : themeModule.createThemeFormComponent(injected, deps);
  const render = () => {
    cursor = 0; captured = { colors: [], fonts: [] }; formats = [];
    const html = renderToStaticMarkup(Component(props));
    return { html, captured, formats: [...formats] };
  };
  return { render, events, theme, presets, setClipboardResult: (result: boolean) => { clipboardResult = result; } };
}

test('theme form matches pinned visual and advanced layouts with exact localization inputs', () => {
  for (const section of ['visual', 'advanced'] as const) for (const variant of ['light', 'dark'] as const)
    for (const showVariantTitle of [false, true]) for (const showTranslucentSidebarToggle of [false, true]) {
      const props = { section, variant, showVariantTitle, showTranslucentSidebarToggle };
      const expected = harness(true, props), actual = harness(false, props);
      const a = actual.render(), b = expected.render();
      assert.equal(a.html, b.html);
      assert.deepEqual(a.formats, b.formats);
      assert.equal(a.captured.fonts.length, section === 'visual' ? 1 : 3);
      assert.equal(a.captured.colors.length, section === 'visual' ? 2 : 0);
      assert.equal(a.captured.toggle != null, section === 'advanced' && showTranslucentSidebarToggle);
      assert.equal(a.captured.dialog != null, section === 'visual');
      if (a.captured.code) {
        assert.equal(a.captured.code.theme, actual.theme);
        assert.equal(a.captured.code.codeThemes, actual.presets);
      }
    }
});

test('theme controls forward patches, account accents and preset failures to original services', async () => {
  const props = { section: 'visual' as const, variant: 'dark' as const, showVariantTitle: false, showTranslucentSidebarToggle: true };
  const actual = harness(false, props), expected = harness(true, props);
  const left = actual.render().captured, right = expected.render().captured;
  assert.ok(left.accent && right.accent && left.code && right.code && left.copy && right.copy);
  left.accent.onCustomColorChange('#abcdef'); right.accent.onCustomColorChange('#abcdef');
  left.colors[0].onChange('#123456'); right.colors[0].onChange('#123456');
  left.colors[1].onChange('#654321'); right.colors[1].onChange('#654321');
  const face: ThemeFontFace = { family: 'New', fullName: 'New Medium', postscriptName: 'New-Medium' };
  left.fonts[0].onChange('New', face); right.fonts[0].onChange('New', face);
  await left.accent.onSelect('blue'); await right.accent.onSelect('blue');
  left.code.onSelect('bad'); right.code.onSelect('bad');
  left.copy.onClick?.(); right.copy.onClick?.();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(actual.events, expected.events);
  assert.deepEqual(actual.events.slice(0, 4), [
    ['theme', { accent: '#abcdef', accentSource: 'custom' }], ['theme', { surface: '#123456' }],
    ['theme', { ink: '#654321' }], ['fonts', { ui: 'New', uiFace: face }],
  ]);
  assert.ok(actual.events.some(event => Array.isArray(event) && event[0] === 'danger' && event[2]?.errorAnalytics?.toastId === 'settings.general.appearance.codeTheme.applyError'));
  assert.ok(actual.events.some(event => Array.isArray(event) && event[0] === 'success' && event[1] === 'Dark theme copied'));
  actual.setClipboardResult(false); expected.setClipboardResult(false);
  left.copy.onClick?.(); right.copy.onClick?.();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(actual.events, expected.events);
  assert.equal(actual.events.filter(event => Array.isArray(event) && event[0] === 'success').length, 1);

  const advancedProps = { ...props, section: 'advanced' as const };
  const a = harness(false, advancedProps), b = harness(true, advancedProps);
  const ac = a.render().captured, bc = b.render().captured;
  assert.ok(ac.toggle && bc.toggle && ac.contrast && bc.contrast);
  ac.fonts[1].onChange(null, undefined); bc.fonts[1].onChange(null, undefined);
  ac.fonts[2].onChange('Mono', face); bc.fonts[2].onChange('Mono', face);
  ac.toggle.onChange(true); bc.toggle.onChange(true);
  ac.contrast.onChange(71); bc.contrast.onChange(71);
  assert.deepEqual(a.events, b.events);
  assert.deepEqual(a.events, [['fonts', { content: null, contentFace: undefined }], ['fonts', { code: 'Mono', codeFace: face }],
    ['theme', { opaqueWindows: false }], ['theme', { contrast: 71 }]]);
});

test('theme import preserves cancel, empty input, rejected write and successful trimmed value', async () => {
  const props = { section: 'visual' as const, variant: 'light' as const, showVariantTitle: false, showTranslucentSidebarToggle: true };
  const actual = harness(false, props), expected = harness(true, props);
  const dialogs = () => {
    const a = actual.render(), b = expected.render();
    assert.equal(a.html, b.html);
    assert.ok(a.captured.dialog && b.captured.dialog);
    return [a.captured.dialog, b.captured.dialog] as const;
  };
  let [a, b] = dialogs();
  a.onOpenChange(true); b.onOpenChange(true);
  [a, b] = dialogs(); a.onValueChange('  '); b.onValueChange('  ');
  [a, b] = dialogs(); a.onSubmit(); b.onSubmit();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(actual.events, expected.events);
  assert.equal(actual.events.length, 1);
  [a, b] = dialogs(); a.onValueChange('bad'); b.onValueChange('bad');
  [a, b] = dialogs(); a.onSubmit(); b.onSubmit();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(actual.events, expected.events);
  [a, b] = dialogs(); assert.equal(a.isOpen, true);
  a.onOpenChange(false); b.onOpenChange(false);
  [a, b] = dialogs(); assert.equal(a.value, '');
  a.onOpenChange(true); b.onOpenChange(true);
  [a, b] = dialogs(); a.onValueChange('  valid  '); b.onValueChange('  valid  ');
  [a, b] = dialogs(); assert.equal(a.isImportValueValid, true);
  a.onSubmit(); b.onSubmit();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(actual.events, expected.events);
  [a] = dialogs();
  assert.equal(a.isOpen, false);
  assert.equal(a.value, '');
  assert.ok(actual.events.some(event => Array.isArray(event) && event[0] === 'import' && event[1] === 'valid'));
  assert.ok(actual.events.some(event => Array.isArray(event) && event[0] === 'success' && event[1] === 'Light theme imported'));
});
