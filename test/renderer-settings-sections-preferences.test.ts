import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transform } from 'esbuild';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { rendererRoot } from '../lib/app-resources.ts';
import type { AppearancePreferenceDependencies, AppearancePreferenceMessages, DiffMarkerStyle, ReducedMotionPreference } from '../src/renderer/settings/sections/appearance-preference-rows.tsx';
import type { MessageDescriptor, SettingRowProps, ToggleProps } from '../src/renderer/settings/sections/section-types.ts';

const source = await readFile(new URL('../src/renderer/settings/sections/appearance-preference-rows.tsx', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'tsx', format: 'esm', jsx: 'transform' });
const recovered = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`) as typeof import('../src/renderer/settings/sections/appearance-preference-rows.tsx');
const pinned = await readFile(rendererRoot + '/assets/general-settings-8997e171b11a.js', 'utf8');
function upstream(start: string, end: string) {
  const first = pinned.indexOf(start), last = pinned.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `${start} / ${end}`);
  assert.equal(pinned.indexOf(start, first + start.length), -1, `unique ${start}`);
  return pinned.slice(first, last);
}
const original = [upstream('function Ec(){', 'function Dc(){'), upstream('function Tc(){', 'function Ec(){'),
  upstream('function bc(){', 'function xc(){'), upstream('function Nc(){', 'function Pc(){')].join('');
const cache = { c: (length: number) => Array(length).fill(Symbol.for('react.memo_cache_sentinel')) };
const message = (value: string): MessageDescriptor => ({ id: value, defaultMessage: value, description: value });
const messages: AppearancePreferenceMessages = { reduceMotion: message('Reduce motion'), reducedMotionSystem: message('System'),
  on: message('On'), off: message('Off'), diffMarkers: message('Diff markers'), color: message('Color'),
  plusMinus: message('Plus/minus'), pointerCursors: message('Pointer cursors'), fontSmoothing: message('Font smoothing') };
const FormattedMessage = ({ defaultMessage }: MessageDescriptor) => React.createElement('strong', null, defaultMessage);
type Kind = 'ReducedMotion' | 'DiffMarkers' | 'PointerCursors' | 'FontSmoothing';
type Selection = { selectedId: string; onSelect: (value: never) => void; options: { id: string; label: React.ReactNode; ariaLabel: string }[] };

function harness(useOriginal: boolean, kind: Kind, platform = 'macOS', pointer: boolean | null = true, fail = false) {
  const writes: unknown[] = [], toasts: unknown[] = [], calls: string[] = [], formatted: string[] = [];
  const intl = { formatMessage: (descriptor: MessageDescriptor) => { formatted.push(descriptor.id); return descriptor.defaultMessage; } };
  const set = (key: string, value: string | boolean) => {
    writes.push([key, value]);
    return fail && key === 'pointer' ? Promise.reject(new Error('save failed')) : Promise.resolve();
  };
  const toast = { danger: (text: React.ReactNode, options: { errorAnalytics: { toastId: string } }) => {
    toasts.push([renderToStaticMarkup(text), options]);
  } };
  const scope = { setReducedMotion: (value: ReducedMotionPreference) => { void set('motion', value); },
    setDiffMarkerStyle: (value: DiffMarkerStyle) => { void set('diff', value); },
    setPointerCursors: (value: boolean) => set('pointer', value),
    setFontSmoothing: (value: boolean) => { void set('font', value); }, toast };
  let selection: Selection | undefined, toggle: ToggleProps | undefined;
  const SelectionControl = (props: Selection) => {
    selection = props;
    return React.createElement('div', { 'data-selected': props.selectedId }, props.options.map(option =>
      React.createElement('span', { key: option.id, 'aria-label': option.ariaLabel }, option.label)));
  };
  const Toggle = (props: ToggleProps) => { toggle = props; return React.createElement('input', { type: 'checkbox', checked: props.checked, readOnly: true, 'aria-label': props.ariaLabel }); };
  const Row = ({ label, description, control, className }: SettingRowProps) => React.createElement('section', { className }, label, description, typeof control === 'function' ? control({}) : control);
  const deps: AppearancePreferenceDependencies = {
    useScope: () => { calls.push('scope'); return scope; }, useIntl: () => { calls.push('intl'); return intl; },
    useReducedMotion: () => { calls.push('motion'); return 'on'; }, useDiffMarkerStyle: () => { calls.push('diff'); return 'symbols'; },
    usePointerCursors: () => { calls.push('pointer'); return pointer; }, usePlatform: () => { calls.push('platform'); return { platform }; },
    useFontSmoothing: () => { calls.push('font'); return true; }, messages, FormattedMessage, Row,
    MotionSelection: SelectionControl as AppearancePreferenceDependencies['MotionSelection'],
    DiffSelection: SelectionControl as AppearancePreferenceDependencies['DiffSelection'], Toggle,
  };
  const atoms = { reducedMotionPreference: 'motion', diffMarkerStyle: 'diff' };
  const rawScope = { get: () => toast };
  const bindings = { Q: cache, $: jsxRuntime, N: () => { calls.push('scope'); return rawScope; }, R: {},
    I: () => { calls.push('intl'); return intl; }, F: (key: string) => { calls.push(key); return { motion: 'on', diff: 'symbols', pointer, font: true }[key as 'motion']; },
    Ke: atoms, zc: 'pointer', Rc: 'font', qe: {}, Kn: () => { calls.push('platform'); return { platform }; },
    D: (_scope: object, key: string, value: string | boolean) => set(key, value), Y: messages,
    M: FormattedMessage, V: Row, Gn: SelectionControl, Le: Toggle };
  const originals = new Function(...Object.keys(bindings), `${original}; return { ReducedMotion: Ec, DiffMarkers: Tc, PointerCursors: bc, FontSmoothing: Nc };`)(...Object.values(bindings)) as Record<Kind, React.ComponentType>;
  const Component = useOriginal ? originals[kind] : recovered.createAppearancePreferenceRows(React, deps)[kind];
  const html = renderToStaticMarkup(React.createElement(Component));
  return { html, writes, toasts, calls, formatted, selection, toggle };
}

test('motion and diff choices match pinned rows and write their original settings', () => {
  for (const [kind, value, expected] of [['ReducedMotion', 'off', ['motion', 'off']], ['DiffMarkers', 'color', ['diff', 'color']]] as const) {
    const a = harness(false, kind), b = harness(true, kind);
    assert.equal(a.html, b.html);
    assert.deepEqual(a.calls, b.calls);
    assert.deepEqual(a.formatted, b.formatted);
    assert.ok(a.selection); assert.ok(b.selection);
    a.selection.onSelect(value as never); b.selection.onSelect(value as never);
    assert.deepEqual(a.writes, b.writes);
    assert.deepEqual(a.writes, [expected]);
  }
});

test('pointer cursor uses strict true and reports a rejected save through the original toast contract', async () => {
  for (const pointer of [true, false, null]) {
    const a = harness(false, 'PointerCursors', 'macOS', pointer, true), b = harness(true, 'PointerCursors', 'macOS', pointer, true);
    assert.equal(a.html, b.html);
    assert.deepEqual(a.calls, b.calls);
    assert.deepEqual(a.formatted, b.formatted);
    assert.ok(a.toggle); assert.ok(b.toggle);
    assert.equal(a.toggle.checked, pointer === true);
    a.toggle.onChange(true); b.toggle.onChange(true);
    await Promise.resolve();
    assert.deepEqual(a.writes, b.writes);
    assert.deepEqual(a.toasts, b.toasts);
    assert.equal(a.toasts.length, 1);
  }
});

test('font smoothing subscribes on every platform and only renders and saves on macOS', () => {
  for (const platform of ['macOS', 'linux', 'windows']) {
    const a = harness(false, 'FontSmoothing', platform), b = harness(true, 'FontSmoothing', platform);
    assert.equal(a.html, b.html);
    assert.deepEqual(a.calls, b.calls);
    assert.deepEqual(a.calls, ['scope', 'intl', 'platform', 'font']);
    assert.deepEqual(a.formatted, b.formatted);
    if (platform === 'macOS') {
      assert.ok(a.toggle); assert.ok(b.toggle);
      a.toggle.onChange(false); b.toggle.onChange(false);
      assert.deepEqual(a.writes, b.writes);
      assert.deepEqual(a.writes, [['font', false]]);
    } else assert.equal(a.html, '');
  }
});
