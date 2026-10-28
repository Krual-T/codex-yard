import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsxRuntime from 'react/jsx-runtime';
import { createSidebarStatusBadgeComponent } from '../src/renderer/sidebar/status-badge.ts';
import type { SidebarStatusBadgeDependencies, SidebarStatusBadgeProps } from '../src/renderer/sidebar/status-badge.ts';

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
