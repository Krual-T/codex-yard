import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transform } from 'esbuild';
import * as React from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ThinkingStatusSlotDependencies, ThinkingStatusSlotProps } from '../src/renderer/messages/thinking-status.tsx';

const { code } = await transform(await readFile(new URL('../src/renderer/messages/thinking-status.tsx', import.meta.url), 'utf8'), { loader: 'tsx', format: 'esm', jsx: 'transform' });
assert.doesNotMatch(code, /react\/jsx-runtime/);
const { createThinkingStatusSlotComponent } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`) as typeof import('../src/renderer/messages/thinking-status.tsx');
const vendor = await readFile(new URL('../vendor/codex-app/26.1013.40934/webview/assets/local-conversation-turn-981410324fed.js', import.meta.url), 'utf8');

test('thinking slot matches the original active and reduced-motion layouts', () => {
  let reducedMotion = false;
  const deps: ThinkingStatusSlotDependencies = { useReducedMotion: () => reducedMotion, transition: { duration: 0.2 },
    AnimatePresence: ({ children }) => React.createElement(React.Fragment, null, children),
    MotionDiv: ({ children }) => React.createElement('div', { 'data-motion': '' }, children) };
  const New = createThinkingStatusSlotComponent(React, deps);
  const start = 'function ss(e){let t=(0,us.c)(8),';
  const end = 't[5]=a,t[6]=o,t[7]=s):s=t[7],s}';
  assert.equal(vendor.split(start).length, 2); assert.equal(vendor.split(end).length, 2);
  const begin = vendor.indexOf(start);
  const source = vendor.slice(begin, vendor.indexOf(end, begin) + end.length);
  const Old = new Function('us', 'M', 'Z', 'B', 'Ce', 'ke', `return (${source})`)(
    { c: (size: number) => Array(size).fill(Symbol.for('react.memo_cache_sentinel')) }, deps.useReducedMotion,
    { jsx, jsxs }, { div: deps.MotionDiv }, deps.transition, deps.AnimatePresence,
  ) as React.ComponentType<ThinkingStatusSlotProps>;
  for (const reduced of [false, true]) for (const isActive of [false, true]) {
    reducedMotion = reduced;
    const props = { isActive, children: 'Thinking' };
    assert.equal(renderToStaticMarkup(React.createElement(New, props)), renderToStaticMarkup(React.createElement(Old, props)));
  }
});
