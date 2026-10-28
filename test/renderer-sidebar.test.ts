import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RelativeTimeIntl, RelativeTimeMessage, RelativeTimeUnit, SidebarRelativeTimeProps } from '../src/renderer/sidebar/relative-time.tsx';

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
