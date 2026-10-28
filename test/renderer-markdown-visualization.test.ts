import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseVisualization } from '../src/renderer/markdown/visualization-directives.ts';

test('visualization payloads retain the original filename and path boundaries', () => {
  assert.deepEqual(parseVisualization('view.html'), { path: 'view.html' });
  assert.deepEqual(parseVisualization('{"path":"/work/report-1.html","title":"Report","mode":"wide"}'),
    { path: '/work/report-1.html', title: 'Report', mode: 'wide' });
  assert.deepEqual(parseVisualization('{"path":null,"type":"live"}'), { path: null, type: 'live' });
  assert.deepEqual(parseVisualization('{"path":"/work/report.html","type":"live"}'), { path: '/work/report.html', type: 'live' });
  for (const value of ['../view.html', '{"path":"../view.html"}', '{"path":"/work/../view.html"}',
    '{"path":"work/view.html"}', 'work/view.html', 'VIEW.html', 'view_1.html', '{"path":"/work/view.html","mode":"full"}',
    '{"path":null}', '{"path":"/work/a\\n.html"}', '{"path":"/work/a.html","type":"future"}']) {
    assert.equal(parseVisualization(value), null, value);
  }
});
