import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsxRuntime from 'react/jsx-runtime';
import { createSidebarStatusBadgeComponent } from '../src/renderer/sidebar/status-badge.ts';
import type { SidebarStatusBadge, SidebarStatusBadgeDependencies, SidebarStatusBadgeProps } from '../src/renderer/sidebar/status-badge.ts';

const appSource = readFileSync(new URL(
  '../vendor/codex-app/26.1013.40934/webview/assets/app-initial-a68277f60b93.js', import.meta.url,
), 'utf8');

function between(start: string, next: string): string {
  const from = appSource.indexOf(start);
  const to = appSource.indexOf(next, from);
  assert.ok(from >= 0 && to > from && appSource.lastIndexOf(start) === from);
  return appSource.slice(from, to);
}

test('PR status constructors pass their actual badge shape through the shared hzc boundary', () => {
  const BadgeIcon = ({ status }: { status: string }) => React.createElement('svg', { 'data-status': status });
  const DetailedIcon = ({ state }: { state: { status: string } }) => React.createElement('svg', { 'data-status': state.status });
  const context = {
    nVc: jsxRuntime,
    kBc: BadgeIcon,
    ABc: DetailedIcon,
    tVc: (status: string) => status,
    qBc: () => 'open',
    JBc: (state: { status: string }) => state,
    Czc: () => React.createElement('i'),
    W: ({ defaultMessage }: { defaultMessage: string }) => defaultMessage,
  };
  const simple = runInNewContext(`(${between('function $Bc(', 'function eVc(')})`, context) as
    (status: string, locale: unknown, title?: string, url?: string) => { iconBadge: SidebarStatusBadge & { id: string } };
  const detailed = runInNewContext(`(${between('function eVc(', 'function tVc(')})`, context) as
    (data: object, locale: unknown) => { iconBadge: SidebarStatusBadge & { id: string } };
  const dependencies: SidebarStatusBadgeDependencies = {
    Tooltip: ({ children }) => React.createElement('span', { 'data-tooltip': true }, children),
    classNames: (...classes) => classes.filter(Boolean).join(' '),
  };
  const original = runInNewContext(`(${between('function hzc(', 'var gzc,_zc,vzc;function yzc()')})`, {
    gzc: { c: () => Array(11).fill(Symbol.for('react.memo_cache_sentinel')) },
    _zc: React, vzc: jsxRuntime, Wc: dependencies.classNames, Sl: dependencies.Tooltip,
  }) as React.ComponentType<SidebarStatusBadgeProps>;
  const migrated = createSidebarStatusBadgeComponent(React, dependencies);
  const badges = [
    simple('open', null, 'Fixture PR').iconBadge,
    detailed({ title: 'Fixture PR', canMerge: true, ciStatus: 'success', mergeBlocker: null }, null).iconBadge,
  ];
  for (const badge of badges) {
    assert.equal(badge.id, 'pr-status');
    assert.equal(badge.tooltipContent, null);
    assert.equal(badge.ariaLabel, undefined);
    assert.equal(badge.className, undefined);
    const markup = renderToStaticMarkup(React.createElement(migrated, { badge }));
    assert.equal(markup, renderToStaticMarkup(React.createElement(original, { badge })));
    assert.match(markup, /data-status="open"/);
    assert.doesNotMatch(markup, /data-tooltip/);
  }
});
