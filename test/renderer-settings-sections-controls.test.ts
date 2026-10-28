import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transform } from 'esbuild';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { rendererRoot } from '../lib/app-resources.ts';
import type { AppearanceControlDependencies, AppearanceControlMessages, AppearanceMode, FontSizeKind } from '../src/renderer/settings/sections/appearance-controls.tsx';
import type { MessageDescriptor, SettingRowProps } from '../src/renderer/settings/sections/section-types.ts';

const source = await readFile(new URL('../src/renderer/settings/sections/appearance-controls.tsx', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'tsx', format: 'esm', jsx: 'transform' });
const controlsModule = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`) as typeof import('../src/renderer/settings/sections/appearance-controls.tsx');
const pinned = await readFile(rendererRoot + '/assets/general-settings-8997e171b11a.js', 'utf8');
function upstream(start: string, end: string): string {
  const first = pinned.indexOf(start), last = pinned.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `${start} / ${end}`);
  assert.equal(pinned.indexOf(start, first + start.length), -1, `unique ${start}`);
  return pinned.slice(first, last);
}
const originalMode = [upstream('function yc(){', 'function bc(){'), upstream('function kc(e){', 'function Ac(e){'),
  upstream('function Ac(e){', 'function jc(){')].join('');
const originalFontRows = [upstream('function jc(){', 'function Mc(){'), upstream('function Mc(){', 'function Nc(){')].join('');
const cache = { c: (length: number) => Array(length).fill(Symbol.for('react.memo_cache_sentinel')) };
const message = (value: string): MessageDescriptor => ({ id: value, defaultMessage: value, description: value });
const messages: AppearanceControlMessages = { theme: message('Theme'), themeSystem: message('System'), light: message('Light'),
  dark: message('Dark'), uiFontSize: message('Interface size'), codeFontSize: message('Code size') };
const FormattedMessage = ({ defaultMessage }: MessageDescriptor) => React.createElement('strong', null, defaultMessage);
const artwork = (name: string) => ({ className }: { className: string }) => React.createElement('i', { className, 'data-art': name });
const SystemLightPreview = artwork('system-light'), SystemDarkPreview = artwork('system-dark');
const LightPreview = artwork('light'), DarkPreview = artwork('dark');
const classNames = (...classes: string[]) => classes.join(' ');
const limits = { ui: { min: 10, max: 30 }, code: { min: 9, max: 25 } };

function modeHarness(useOriginal: boolean, mode: AppearanceMode | null) {
  const writes: unknown[] = [], labels: string[] = [];
  const radios: { checked: boolean; onChange: () => void; label: string }[] = [];
  const intl = { formatMessage: (descriptor: MessageDescriptor) => { labels.push(descriptor.id); return descriptor.defaultMessage; } };
  const Tooltip: AppearanceControlDependencies['Tooltip'] = ({ tooltipContent, children }) => {
    assert.ok(React.isValidElement<{ children: React.ReactNode[] }>(children));
    const input = children.props.children[0];
    assert.ok(React.isValidElement<{ checked: boolean; onChange: () => void }>(input));
    radios.push({ checked: input.props.checked, onChange: input.props.onChange, label: tooltipContent });
    return React.createElement('div', { 'data-tooltip': tooltipContent }, children);
  };
  const scope = {};
  const save = (value: AppearanceMode) => { writes.push([value, { optimistic: false }]); };
  const deps: AppearanceControlDependencies = {
    useIntl: () => intl, useThemeMode: () => mode, useSaveThemeMode: () => save,
    useFontSize: () => 14, useSaveFontSize: () => () => {}, isValidFontSize: () => true,
    fontSizeLimits: limits, messages, FormattedMessage, Row: () => null, Input: () => null,
    Tooltip, SystemLightPreview, SystemDarkPreview, LightPreview, DarkPreview, classNames,
  };
  const bindings = {
    Q: cache, $: jsxRuntime, N: () => scope, R: {}, I: () => intl, F: () => mode,
    Ke: { theme: 'theme' }, D: (_scope: object, _setting: string, value: AppearanceMode, options: { optimistic: false }) => { writes.push([value, options]); },
    Y: messages, Uc: [{ id: 'system', label: messages.themeSystem }, { id: 'light', label: messages.light }, { id: 'dark', label: messages.dark }],
    dt: Tooltip, Wc: { light: LightPreview, dark: DarkPreview }, wa: SystemLightPreview, Sa: SystemDarkPreview, tt: classNames,
  };
  const Mode = useOriginal
    ? new Function(...Object.keys(bindings), `${originalMode}; return yc;`)(...Object.values(bindings)) as React.ComponentType
    : controlsModule.createAppearanceControlComponents(React, deps).Mode;
  const html = renderToStaticMarkup(React.createElement(Mode));
  return { html, writes, radios, labels };
}

test('appearance mode preserves native radio selection, preview and non-optimistic writes', () => {
  for (const mode of [null, 'system', 'light', 'dark'] as const) {
    const a = modeHarness(false, mode), b = modeHarness(true, mode);
    assert.equal(a.html, b.html);
    assert.deepEqual(a.labels, b.labels);
    assert.deepEqual(a.radios.map(({ checked, label }) => ({ checked, label })), b.radios.map(({ checked, label }) => ({ checked, label })));
    assert.deepEqual(a.radios.map(radio => radio.checked), [mode == null || mode === 'system', mode === 'light', mode === 'dark']);
    a.radios[1].onChange(); b.radios[1].onChange();
    a.radios[2].onChange(); b.radios[2].onChange();
    assert.deepEqual(a.writes, b.writes);
    assert.deepEqual(a.writes, [['light', { optimistic: false }], ['dark', { optimistic: false }]]);
  }
});

type InputProps = React.ComponentProps<AppearanceControlDependencies['Input']>;
function fontHarness(useOriginal: boolean, kind: FontSizeKind) {
  const writes: unknown[] = [], labels: string[] = [];
  const intl = { formatMessage: (descriptor: MessageDescriptor) => { labels.push(descriptor.id); return descriptor.defaultMessage; } };
  const reference = { current: null as string | null };
  const injected = { ...React, useRef: () => reference } as typeof React;
  const value = kind === 'ui' ? 14 : 13;
  const valid = (target: FontSizeKind, number: number) => Number.isInteger(number) && number >= limits[target].min && number <= limits[target].max;
  let input: InputProps | undefined;
  let inputKey: React.Key | null | undefined;
  const Input: AppearanceControlDependencies['Input'] = props => {
    input = props;
    return React.createElement('input', { type: props.type, min: props.min, max: props.max, step: props.step,
      defaultValue: props.defaultValue, 'aria-label': props['aria-label'] });
  };
  const Row = ({ label, description, control }: SettingRowProps) => {
    assert.ok(React.isValidElement<{ children: React.ReactNode[] }>(control));
    const wrapper = control.props.children[0];
    assert.ok(React.isValidElement<{ children: React.ReactElement }>(wrapper));
    inputKey = wrapper.props.children.key;
    return React.createElement('div', null, label, description, control);
  };
  const deps: AppearanceControlDependencies = {
    useIntl: () => intl, useThemeMode: () => 'system', useSaveThemeMode: () => () => {},
    useFontSize: () => value, useSaveFontSize: () => (target, size) => { writes.push([target, size]); },
    isValidFontSize: valid, fontSizeLimits: limits, messages, FormattedMessage, Row, Input,
    Tooltip: ({ children }) => children, SystemLightPreview, SystemDarkPreview, LightPreview, DarkPreview, classNames,
  };
  const makeSetting = (target: FontSizeKind) => ({ kind: target, schema: { safeParse: (number: number) => ({ success: valid(target, number) }) } });
  const Ke = { sansFontSize: makeSetting('ui'), codeFontSize: makeSetting('code') };
  const bindings = {
    Q: cache, Lc: injected, $: jsxRuntime, N: () => ({}), R: {}, I: () => intl, F: () => value, Ke,
    D: (_scope: object, setting: { kind: FontSizeKind }, number: number) => { writes.push([setting.kind, number]); },
    Y: messages, M: FormattedMessage, V: Row, ir: Input, nt: { sans: limits.ui, code: limits.code },
  };
  const original = new Function(...Object.keys(bindings), `${originalFontRows}; return { jc, Mc };`)(...Object.values(bindings)) as { jc: () => React.ReactNode; Mc: () => React.ReactNode };
  const recovered = controlsModule.createAppearanceControlComponents(injected, deps);
  const Component = useOriginal ? kind === 'ui' ? original.jc : original.Mc : kind === 'ui' ? recovered.UiFontSize : recovered.CodeFontSize;
  const html = renderToStaticMarkup(Component());
  assert.ok(input);
  return { html, input, inputKey, writes, labels };
}

test('font sizes match pinned rows, input keys and pointer, blur and Enter commits', () => {
  for (const kind of ['ui', 'code'] as const) {
    const a = fontHarness(false, kind), b = fontHarness(true, kind);
    assert.equal(a.html, b.html);
    assert.deepEqual(a.labels, b.labels);
    assert.equal(a.inputKey, b.inputKey);
    assert.equal(a.inputKey, kind === 'ui' ? '14' : '13');
    const event = (value: string) => ({ currentTarget: { value } as HTMLInputElement });
    const run = (input: InputProps) => {
      const unchanged = event(String(input.defaultValue));
      input.onPointerDown(unchanged as React.PointerEvent<HTMLInputElement>);
      input.onPointerUp(unchanged as React.PointerEvent<HTMLInputElement>);
      const changed = event(String(input.defaultValue));
      input.onPointerDown(changed as React.PointerEvent<HTMLInputElement>);
      changed.currentTarget.value = '18.0';
      input.onPointerUp(changed as React.PointerEvent<HTMLInputElement>);
      assert.equal(changed.currentTarget.value, '18');
      const invalid = event('999');
      input.onBlur(invalid as React.FocusEvent<HTMLInputElement>);
      assert.equal(invalid.currentTarget.value, String(input.defaultValue));
      const same = event(`${input.defaultValue}.0`);
      input.onBlur(same as React.FocusEvent<HTMLInputElement>);
      assert.equal(same.currentTarget.value, String(input.defaultValue));
      const enter = event('19'); let prevented = false;
      input.onKeyDown({ ...enter, key: 'Enter', preventDefault: () => { prevented = true; } } as React.KeyboardEvent<HTMLInputElement>);
      assert.equal(prevented, true);
      const other = event('20');
      input.onKeyDown({ ...other, key: 'ArrowUp', preventDefault: () => { throw new Error('unexpected preventDefault'); } } as unknown as React.KeyboardEvent<HTMLInputElement>);
    };
    run(a.input); run(b.input);
    assert.deepEqual(a.writes, b.writes);
    assert.deepEqual(a.writes, [[kind, 18], [kind, 19]]);
  }
});
