import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transform } from 'esbuild';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { rendererRoot } from '../lib/app-resources.ts';
import type { AppearanceOutletContext, AppearancePreferencesDependencies, AppearancePreferencesProps, AppearanceSettingsDependencies } from '../src/renderer/settings/sections/appearance.tsx';
import type { ControlLabels, SettingRowProps, SettingsGroup, ToggleProps } from '../src/renderer/settings/sections/section-types.ts';
import type { ThemeVariant, ThemeVariantSettingsProps, ThemeVariantsProps } from '../src/renderer/settings/sections/theme-variants.tsx';

async function load<T>(url: URL): Promise<T> {
  const source = await readFile(url, 'utf8');
  const { code } = await transform(source, { loader: 'tsx', format: 'esm', jsx: 'transform' });
  return await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`) as T;
}
const { createAppearancePreferencesComponent, createAppearanceSettingsComponent } = await load<typeof import('../src/renderer/settings/sections/appearance.tsx')>(new URL('../src/renderer/settings/sections/appearance.tsx', import.meta.url));
const { createThemeVariantsComponent } = await load<typeof import('../src/renderer/settings/sections/theme-variants.tsx')>(new URL('../src/renderer/settings/sections/theme-variants.tsx', import.meta.url));
const pinned = await readFile(rendererRoot + '/assets/general-settings-8997e171b11a.js', 'utf8');
const pinnedRoute = await readFile(rendererRoot + '/assets/appearance-settings-deb0b7565185.js', 'utf8');
function upstream(source: string, start: string, end: string): string {
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `${start} / ${end}`);
  assert.equal(source.indexOf(start, first + start.length), -1, `unique ${start}`);
  return source.slice(first, last);
}
const originalPreferences = upstream(pinned, 'function tc(e){', 'function nc(){');
const originalVariants = upstream(pinned, 'function Qa(e){', 'function $a(e){');
const originalRoute = upstream(pinnedRoute, 'function f(){', 'var p,m,h;');
const cache = { c: (length: number) => Array(length).fill(Symbol.for('react.memo_cache_sentinel')) };

function statefulReact() {
  const values: unknown[] = [];
  let cursor = 0;
  const injected = {
    ...React,
    useId: () => 'appearance-id',
    useState: (initial: unknown) => {
      const index = cursor++;
      if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
      return [values[index], (next: unknown) => { values[index] = typeof next === 'function' ? next(values[index]) : next; }];
    },
  } as typeof React;
  return { injected, resetCursor: () => { cursor = 0; } };
}

function preferenceHarness(original: boolean, local: boolean) {
  const state = statefulReact();
  let observed: {
    button?: { onClick: () => void; 'aria-expanded': boolean; 'aria-controls': string };
    toggle?: ToggleProps;
    reset?: { separateModes: boolean; onResetSeparateModes: () => void };
  } = {};
  const labels: ControlLabels = { 'aria-labelledby': 'row-label', 'aria-describedby': 'row-description' };
  const leaf = (name: string) => () => React.createElement('i', { 'data-row': name });
  const Group = Object.assign(
    ({ children }: React.PropsWithChildren) => React.createElement('section', null, children),
    {
      Header: ({ title, actions }: { title: React.ReactNode; actions?: React.ReactNode }) => React.createElement('header', null, title, actions),
      Content: ({ children, className }: React.PropsWithChildren<{ className?: string }>) => React.createElement('article', { className }, children),
    },
  ) as SettingsGroup;
  const Rows = ({ children }: React.PropsWithChildren) => React.createElement('div', null, children);
  const FormattedMessage = ({ defaultMessage }: { defaultMessage: string }) => React.createElement('strong', null, defaultMessage);
  const Row = ({ label, description, control, variant }: SettingRowProps) => React.createElement('div', { 'data-variant': variant },
    label, description, typeof control === 'function' ? control(labels) : control);
  const Toggle = (props: ToggleProps) => { observed.toggle = props; return React.createElement('input', { type: 'checkbox', checked: props.checked, readOnly: true, ...labels }); };
  const Button: AppearancePreferencesDependencies['Button'] = props => {
    observed.button = props;
    return React.createElement('button', { 'aria-controls': props['aria-controls'], 'aria-expanded': props['aria-expanded'] }, props.children);
  };
  const ResetAdvanced: AppearancePreferencesDependencies['ResetAdvanced'] = props => {
    observed.reset = props;
    return React.createElement('i', { 'data-reset': String(props.separateModes) });
  };
  const ThemeVariants = (props: ThemeVariantsProps) => React.createElement('i', { 'data-theme-section': props.section, 'data-separate': String(props.separateModes) });
  const deps: AppearancePreferencesDependencies = {
    Group, Rows, FormattedMessage, Row, Toggle, Button, ResetAdvanced, ThemeVariants,
    ExpandedIcon: leaf('expanded'), CollapsedIcon: leaf('collapsed'), Mode: leaf('mode'),
    UiFontSize: leaf('ui-font-size'), ConditionalTextSetting: leaf('conditional-text'), CodeFontSize: leaf('code-font-size'),
    ReducedMotion: leaf('reduced-motion'), ConditionalDisplaySettings: leaf('conditional-display'), DiffMarkers: leaf('diff-markers'),
    PointerCursors: leaf('pointer'), DockIcon: leaf('dock-icon'), FontSmoothing: leaf('font-smoothing'), useLocalAccess: () => local,
  };
  const bindings = {
    Q: cache, Lc: state.injected, $: jsxRuntime, L: () => local, Vr: 'local', U: Group, rt: Rows,
    V: Row, Le: Toggle, M: FormattedMessage, t: Button, ee: deps.ExpandedIcon, s: deps.CollapsedIcon,
    Xo: ResetAdvanced, yc: deps.Mode, Qa: ThemeVariants, jc: deps.UiFontSize, la: deps.ConditionalTextSetting,
    Mc: deps.CodeFontSize, Ec: deps.ReducedMotion, ua: deps.ConditionalDisplaySettings, Tc: deps.DiffMarkers,
    bc: deps.PointerCursors, xc: deps.DockIcon, Nc: deps.FontSmoothing,
  };
  const Component = original
    ? new Function(...Object.keys(bindings), `return (${originalPreferences});`)(...Object.values(bindings)) as (props: AppearancePreferencesProps) => React.ReactNode
    : createAppearancePreferencesComponent(state.injected, deps);
  const render = (props: AppearancePreferencesProps = {}) => {
    state.resetCursor();
    observed = {};
    const html = renderToStaticMarkup(Component(props));
    assert.ok(observed.button && observed.reset);
    return { html, button: observed.button, toggle: observed.toggle, reset: observed.reset };
  };
  return { render, labels };
}

test('Appearance advanced controls preserve local state, reset and capability branches', () => {
  for (const local of [false, true]) {
    const expected = preferenceHarness(true, local), actual = preferenceHarness(false, local);
    const compare = (props: AppearancePreferencesProps = {}) => {
      const next = actual.render(props), reference = expected.render(props);
      assert.equal(next.html, reference.html);
      assert.equal(next.button['aria-expanded'], reference.button['aria-expanded']);
      assert.equal(next.button['aria-controls'], 'appearance-id');
      assert.equal(next.reset.separateModes, reference.reset.separateModes);
      return { next, reference };
    };
    let current = compare();
    assert.doesNotMatch(current.next.html, /data-row="ui-font-size"/);
    current.next.button.onClick(); current.reference.button.onClick();
    current = compare();
    assert.match(current.next.html, /data-row="ui-font-size"/);
    assert.equal(current.next.html.includes('data-row="diff-markers"'), local);
    assert.deepEqual({ 'aria-labelledby': current.next.toggle?.['aria-labelledby'], 'aria-describedby': current.next.toggle?.['aria-describedby'] }, actual.labels);
    current.next.toggle?.onChange(true); current.reference.toggle?.onChange(true);
    current = compare();
    assert.match(current.next.html, /data-theme-section="visual" data-separate="true"/);
    assert.match(current.next.html, /data-theme-section="advanced" data-separate="true"/);
    current.next.reset.onResetSeparateModes(); current.reference.reset.onResetSeparateModes();
    current = compare();
    assert.match(current.next.html, /data-theme-section="visual" data-separate="false"/);
    current.next.button.onClick(); current.reference.button.onClick();
    assert.doesNotMatch(compare({ defaultAdvancedExpanded: true }).next.html, /data-row="ui-font-size"/);
  }
  const opened = preferenceHarness(false, true).render({ defaultAdvancedExpanded: true });
  assert.match(opened.html, /data-row="ui-font-size"/);
});

test('theme variant dispatcher matches pinned order, current mode and backdrop fallback', () => {
  for (const section of ['visual', 'advanced'] as const) for (const separateModes of [false, true])
    for (const variant of ['light', 'dark'] as const) for (const supported of [true, false, undefined]) {
      const data = supported === undefined ? undefined : { isSystemBackdropSupported: supported };
      const ThemeVariantSettings = (props: ThemeVariantSettingsProps) => React.createElement('i', {
        'data-section': props.section, 'data-variant': props.variant,
        'data-title': String(props.showVariantTitle), 'data-translucent': String(props.showTranslucentSidebarToggle),
      });
      const deps = { useCurrentVariant: () => variant, useBackdropSupport: () => ({ data }), ThemeVariantSettings };
      const bindings = { fo: cache, X: jsxRuntime, Pr: () => variant, Kr: (value: ThemeVariant) => value, $r: deps.useBackdropSupport, $a: ThemeVariantSettings };
      const Original = new Function(...Object.keys(bindings), `return (${originalVariants});`)(...Object.values(bindings)) as React.ComponentType<ThemeVariantsProps>;
      const Recovered = createThemeVariantsComponent(React, deps);
      const props = { section, separateModes };
      const html = renderToStaticMarkup(React.createElement(Recovered, props));
      assert.equal(html, renderToStaticMarkup(React.createElement(Original, props)));
      assert.equal((html.match(/data-variant=/g) ?? []).length, separateModes ? 2 : 1);
      assert.match(html, new RegExp(`data-translucent="${supported !== false}"`));
      if (!separateModes) assert.match(html, new RegExp(`data-variant="${variant}" data-title="false"`));
      else assert.ok(html.indexOf('data-variant="light"') < html.indexOf('data-variant="dark"'));
    }
});

test('Appearance route uses search targets and navigation key without replacing outlet state', () => {
  const Context = React.createContext<AppearanceOutletContext | null>(null);
  let context: AppearanceOutletContext | null = null;
  const injected = { ...React, useContext: () => context } as typeof React;
  const Page: AppearanceSettingsDependencies['Page'] = ({ children }) => React.createElement('main', null, children);
  const PageTitle: AppearanceSettingsDependencies['PageTitle'] = ({ slug }) => React.createElement('h1', null, slug);
  const Preferences = (_props: AppearancePreferencesProps) => null;
  const bindings = { p: cache, m: injected, h: jsxRuntime, c: Context, a: PageTitle, o: Page, u: Preferences };
  const Original = new Function(...Object.keys(bindings), `return (${originalRoute});`)(...Object.values(bindings)) as () => React.ReactElement<{ children: React.ReactElement<AppearancePreferencesProps> }>;
  const Recovered = createAppearanceSettingsComponent(injected, { OutletContext: Context, Page, PageTitle, AppearancePreferences: Preferences });
  for (const value of [null, { navigationKey: 'one' }, { navigationKey: 'two', targetId: '' }, { navigationKey: 'three', targetText: 'font' }]) {
    context = value;
    const original = Original().props.children;
    const recovered = Recovered().props.children;
    assert.equal(recovered.key, original.key);
    assert.deepEqual(recovered.props, original.props);
    assert.equal(recovered.props.defaultAdvancedExpanded, value?.targetId != null || value?.targetText != null);
  }
});
