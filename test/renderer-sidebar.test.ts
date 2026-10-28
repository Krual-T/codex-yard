import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsxRuntime from 'react/jsx-runtime';
import { createSidebarStatusBadgeComponent } from '../src/renderer/sidebar/status-badge.ts';
import type { SidebarStatusBadgeDependencies, SidebarStatusBadgeProps } from '../src/renderer/sidebar/status-badge.ts';
import type { RelativeTimeIntl, RelativeTimeMessage, RelativeTimeUnit, SidebarRelativeTimeProps } from '../src/renderer/sidebar/relative-time.tsx';

const appSource = readFileSync(new URL(
  '../vendor/codex-app/26.1013.40934/webview/assets/app-initial-a68277f60b93.js', import.meta.url,
), 'utf8');
const startAnchor = 'function hzc(e){';
const endAnchor = 'var gzc,_zc,vzc;function yzc()';
const start = appSource.indexOf(startAnchor);
const end = appSource.indexOf(endAnchor, start);
assert.ok(start >= 0 && end > start && start === appSource.lastIndexOf(startAnchor));
const originalSource = appSource.slice(start, end);

function originalBadge({ Tooltip, classNames }: SidebarStatusBadgeDependencies) {
  return runInNewContext(`(${originalSource})`, {
    gzc: { c: () => Array(11).fill(Symbol.for('react.memo_cache_sentinel')) },
    _zc: React,
    vzc: jsxRuntime,
    Sl: Tooltip,
    Wc: classNames,
  }) as React.ComponentType<SidebarStatusBadgeProps>;
}

test('sidebar status badge preserves the pinned original rendering and injected dependencies', () => {
  const iconClick = () => {};
  const iconProps: { className?: string; onClick: () => void; 'data-icon': string }[] = [];
  const tooltipContents: React.ReactNode[] = [];
  const classCalls: (string | undefined)[][] = [];
  function Icon(props: { className?: string; onClick: () => void; 'data-icon': string }) {
    iconProps.push(props);
    return React.createElement('svg', { className: props.className, 'data-icon': props['data-icon'] });
  }
  function Tooltip({ tooltipContent, children }: { tooltipContent: React.ReactNode; children: React.ReactElement }) {
    tooltipContents.push(tooltipContent);
    return React.createElement('span', { 'data-tooltip': 'present' }, children);
  }
  const dependencies: SidebarStatusBadgeDependencies = {
    Tooltip,
    classNames: (...classes) => {
      classCalls.push(classes);
      return classes.filter(Boolean).join(' ');
    },
  };
  const migrated = createSidebarStatusBadgeComponent(React, dependencies);
  const original = originalBadge(dependencies);

  for (const tooltipContent of [undefined, null, '', 'Open pull request', 0, false]) {
    const badge = {
      icon: React.createElement(Icon, { className: 'original-icon', onClick: iconClick, 'data-icon': 'pr' }),
      ariaLabel: 'Pull request status',
      className: 'original-badge',
      tooltipContent,
    };
    const expected = renderToStaticMarkup(React.createElement(original, { badge }));
    const actual = renderToStaticMarkup(React.createElement(migrated, { badge }));
    assert.equal(actual, expected, `original parity for tooltip ${String(tooltipContent)}`);
    assert.match(actual, /aria-label="Pull request status"/);
    assert.match(actual, /class="icon-2xs block shrink-0 original-icon"/);
    assert.match(actual, /class="flex h-5 w-5 items-center justify-center leading-none original-badge"/);
    assert.equal(actual.includes('data-tooltip="present"'), tooltipContent != null && tooltipContent !== '');
    assert.equal(iconProps.at(-1)?.onClick, iconClick);
    assert.equal(badge.icon.props.className, 'original-icon');
  }
  assert.deepEqual(tooltipContents, ['Open pull request', 'Open pull request', 0, 0, false, false]);
  assert.deepEqual(classCalls.slice(-2), [
    ['icon-2xs block shrink-0', 'original-icon'],
    ['flex h-5 w-5 items-center justify-center leading-none', 'original-badge'],
  ]);
});

test('sidebar status badge keeps React-node tooltip content and an icon without a class', () => {
  const tooltip = React.createElement('strong', null, 'Merged');
  const seen: React.ReactNode[] = [];
  const dependencies: SidebarStatusBadgeDependencies = {
    Tooltip: ({ tooltipContent, children }) => {
      seen.push(tooltipContent);
      return React.createElement('div', null, children, tooltipContent);
    },
    classNames: (...classes) => classes.filter(Boolean).join(' '),
  };
  const migrated = createSidebarStatusBadgeComponent(React, dependencies);
  const original = originalBadge(dependencies);
  const badge = { icon: React.createElement('svg', { 'data-icon': 'merged' }), tooltipContent: tooltip };
  const expected = renderToStaticMarkup(React.createElement(original, { badge }));
  const actual = renderToStaticMarkup(React.createElement(migrated, { badge }));
  assert.equal(actual, expected);
  assert.match(actual, /<strong>Merged<\/strong>/);
  assert.deepEqual(seen, [tooltip, tooltip]);
});

test('relative time uses the injected clock, locale and calendar at the minute boundary', async () => {
  const built = await build({
    entryPoints: ['src/renderer/sidebar/relative-time.tsx'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    metafile: true,
  });
  assert.deepEqual(Object.keys(built.metafile.inputs), ['src/renderer/sidebar/relative-time.tsx']);
  assert.deepEqual(Object.values(built.metafile.outputs).flatMap(output => output.imports), []);
  const url = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0]!.contents).toString('base64')}`;
  const { createSidebarRelativeTimeComponent } = await import(url) as typeof import('../src/renderer/sidebar/relative-time.tsx');

  const now = new Date('2026-10-28T10:00:00.000Z');
  const Clock = React.createContext(now);
  const messages: { message: RelativeTimeMessage; value: number }[] = [];
  const relativeCalls: Parameters<RelativeTimeIntl['formatRelativeTime']>[] = [];
  const intl: RelativeTimeIntl = {
    formatMessage: (message, { value }) => {
      messages.push({ message, value });
      return `${message.defaultMessage.replace('{value}', String(value))}`;
    },
    formatRelativeTime: (...args) => {
      relativeCalls.push(args);
      return 'localized relative time';
    },
  };
  const Locale = React.createContext(intl);
  let unit: RelativeTimeUnit = 'minute';
  const unitCalls: unknown[][] = [];
  let intlHookCalls = 0;
  const RelativeTime = createSidebarRelativeTimeComponent(React, {
    useNow: () => React.useContext(Clock),
    useIntl: () => {
      intlHookCalls += 1;
      return React.useContext(Locale);
    },
    getRelativeUnit: (...args) => {
      unitCalls.push(args);
      return { unit, value: 2 };
    },
    FormattedMessage: ({ id, defaultMessage }) => React.createElement('span', { 'data-id': id }, defaultMessage),
  });
  const render = (props: SidebarRelativeTimeProps, clock = now, locale = intl) => renderToStaticMarkup(
    React.createElement(Clock.Provider, { value: clock },
      React.createElement(Locale.Provider, { value: locale }, React.createElement(RelativeTime, props))),
  );
  const at = (offset: number) => new Date(now.getTime() + offset).toISOString();

  assert.equal(render({ dateString: at(-59_999) }), '<span data-id="wham.formattedRelativeDateTime.justNow">just now</span>');
  assert.equal(render({ dateString: at(60_000) }), '<span data-id="wham.formattedRelativeDateTime.justNow">just now</span>');
  assert.equal(unitCalls.length, 0);
  assert.equal(intlHookCalls, 2);

  const minuteAgo = at(-60_000);
  assert.equal(render({ dateString: minuteAgo }), '2m');
  assert.deepEqual(unitCalls.at(-1), [minuteAgo, now, 'calendar']);
  assert.equal(intlHookCalls, 4, 'compact output retains the original nested intl hook');
  assert.equal(render({ dateString: minuteAgo, format: 'relative', dayBasis: 'elapsed' }), 'localized relative time');
  assert.deepEqual(relativeCalls, [[-2, 'minute', { numeric: 'always', style: 'narrow' }]]);
  assert.deepEqual(unitCalls.at(-1), [minuteAgo, now, 'elapsed']);

  const expected: [RelativeTimeUnit, string, string, string][] = [
    ['minute', 'Minutes', 'm', 'minutes'], ['hour', 'Hours', 'h', 'hours'],
    ['day', 'Days', 'd', 'days'], ['week', 'Weeks', 'w', 'weeks'],
    ['month', 'Months', 'mo', 'months'], ['year', 'Years', 'y', 'years'],
  ];
  for (const [nextUnit, idUnit, suffix, descriptionUnit] of expected) {
    unit = nextUnit;
    assert.equal(render({ dateString: minuteAgo }), `2${suffix}`);
    assert.deepEqual(messages.at(-1), {
      message: {
        id: `wham.formattedRelativeDateTime.compact${idUnit}Ago`,
        defaultMessage: `{value}${suffix}`,
        description: `Compact ${descriptionUnit}-ago format`,
      },
      value: 2,
    });
  }

  const later = new Date(now.getTime() + 120_000);
  const translatedIntl = { ...intl, formatMessage: () => 'translated' };
  assert.equal(render({ dateString: minuteAgo }, later, translatedIntl), 'translated');
  assert.deepEqual(unitCalls.at(-1), [minuteAgo, later, 'calendar']);
});
