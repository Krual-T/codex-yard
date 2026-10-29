import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ThreadItemSummary, ThreadSummary, TurnSummary } from '../lib/codex-protocol.ts';
import { projectThreadSummaryFileOutputs, projectTurnAppgenResources } from '../src/renderer/app/thread-summary-file-outputs.ts';
import type { SummaryOutputDirectory } from '../src/renderer/app/thread-summary-file-outputs.ts';

const message = (id: string, text: string): ThreadItemSummary => ({ id, type: 'agentMessage', text });
const turn = (id: string, items: ThreadItemSummary[], status: TurnSummary['status'] = 'completed'): TurnSummary =>
  ({ id, status, itemsView: 'full', items });
const thread = (turns: TurnSummary[], cwd = '/workspace'): ThreadSummary =>
  ({ id: 'thread-1', name: null, cwd, turns, status: { type: 'idle' } });
const output = (value: ThreadSummary | null, outputDirectory: SummaryOutputDirectory = { status: 'none' }, hostId = 'ssh-a') =>
  projectThreadSummaryFileOutputs({ hostId, thread: value, historyComplete: true, streamGap: false, outputDirectory });

test('Sites receipt projection follows identity, URL order, deduplication and verified gate precedence', () => {
  const site = (id: string, content: Record<string, unknown>, extra: Record<string, unknown> = {}): ThreadItemSummary =>
    ({id, type:'mcpToolCall', server:'codex_apps', tool:'sites.get_site', status:'completed', error:null,
      arguments:{}, result:{content:[], structuredContent:content}, ...extra});
  const items = [
    site('old', {project_id:'one',current_live_url:'https://old.invalid/',status:'succeeded',has_mcp:false}),
    site('other', {project_id:'two',current_preview_url:'https://preview.invalid/two',title:'Two'}),
    site('new', {project_id:'one',current_live_url:'https://new.invalid/one',current_preview_url:'https://preview.invalid/one',title:' One '}),
    site('fallback', {id:'three',slug:'new',url:'https://site.invalid/three'}),
    site('nested', {result:{structured_content:{url:'https://site.invalid/four',title:'Four'}}}, {arguments:{project_id:'four'}}),
    site('context', {project_id:'context',url:'https://site.invalid/context'},
      {server:'other',tool:'invoke',appContext:{resourceUri:'connectors://sites/a/sites_get_site'}}),
    site('local', {project_id:'local',url:'http://localhost:4000/'}),
    site('missing-id', {url:'https://site.invalid/no-id'}),
    site('failed', {project_id:'failed',url:'https://site.invalid/failed'}, {status:'failed'}),
    site('error', {project_id:'error',url:'https://site.invalid/error'}, {error:{message:'failed'}}),
    site('wrong-tool', {project_id:'wrong',url:'https://site.invalid/wrong'}, {server:'other',tool:'create'}),
    site('hidden', {project_id:'hidden',url:'https://site.invalid/hidden',mcp_connection:{}}),
    site('hidden-latest', {project_id:'hidden',url:'https://site.invalid/latest'}),
  ];
  assert.deepEqual(projectTurnAppgenResources(items), [
    {projectId:'two',url:'https://preview.invalid/two',title:'Two'},
    {projectId:'one',url:'https://new.invalid/one',title:'One',hasMcp:false},
    {projectId:'three',url:'https://site.invalid/three',title:'Site'},
    {projectId:'four',url:'https://site.invalid/four',title:'Four'},
    {projectId:'context',url:'https://site.invalid/context',title:'Site'},
    {projectId:'hidden',url:'https://site.invalid/latest',title:'Site',hasMcp:true},
  ]);
  const value = thread([turn('site', [site('hidden', {project_id:'hidden',url:'https://site.invalid/',mcp_connection:{},
    schedule_suggestion:{title:'Run',prompt:'Do it'}}), message('answer', 'http://localhost:5000/')])]);
  const projection = (appgenEnabled?: boolean) => projectThreadSummaryFileOutputs({hostId:'local',thread:value,
    historyComplete:true,streamGap:false,outputDirectory:{status:'none'},appgenEnabled});
  assert.ok(projection().gaps.includes('website-appgen-unknown'));
  assert.equal(projection(true).websites.length, 0);
  assert.equal(projection(false).websites.length, 1);
});

test('completed turn citations and final document links preserve original identities, order and exclusions', () => {
  const value = thread([
    turn('old', [message('old-answer', ':codex-file-citation{path="/workspace/first.pdf"}')]),
    turn('new', [
      message('first-answer', [
        ':codex-file-citation{path="/workspace/first.pdf"}',
        '::codex-file-citation{path="/workspace/block.docx"}',
        ':codex-file-citation{path="/workspace/source.pdf" purpose="source"}',
        ':codex-file-citation{path="/workspace/output.md" purpose="output"}',
        ':codex-file-citation{path="/workspace/view.pdf" purpose="output"}',
        '```\n:codex-file-citation{path="/workspace/fenced.pdf"}\n```',
        '`[code](/workspace/code.pdf)`',
        '::codex-inline-vis{path="/workspace/view.pdf"}',
      ].join('\n\n')),
      message('final-answer', '[source](source.pdf) [explicit](output%20one.pdf#L3) [duplicate](first.pdf) ![image](image.pdf) [web](https://example.invalid/no.pdf) [wrong](out.csv)'),
    ]),
    turn('running', [message('partial', ':codex-file-citation{path="/workspace/pending.pdf"}')], 'inProgress'),
    turn('failed', [message('failed-answer', ':codex-file-citation{path="/workspace/failed.pdf"}')], 'failed'),
  ]);
  const before = structuredClone(value);
  const result = output(value);
  assert.deepEqual(value, before);
  assert.deepEqual(result.gaps, ['turn-cwd-unverified']);
  assert.deepEqual(result.entries.map(entry => [entry.path, entry.via, entry.source.turnId, entry.source.itemId]), [
    ['/workspace/first.pdf', 'citation', 'new', 'first-answer'],
    ['/workspace/block.docx', 'citation', 'new', 'first-answer'],
    ['/workspace/output.md', 'citation', 'new', 'first-answer'],
    ['/workspace/output one.pdf', 'markdown-link', 'new', 'final-answer'],
  ]);
  assert.deepEqual(result.entries[0]?.source, { hostId: 'ssh-a', threadId: 'thread-1', cwd: '/workspace', turnId: 'new', itemId: 'first-answer' });
  assert.equal(result.entries[0]?.pathResolution, 'absolute');
  assert.equal(result.entries.at(-1)?.pathResolution, 'thread-cwd');
  assert.equal(output(value, { status: 'none' }, 'ssh-b').entries[0]?.source.hostId, 'ssh-b');
});

test('known projectless directory, internal paths and path normalization do not leak other files', () => {
  const value = thread([turn('turn', [message('answer', [
    ':codex-file-citation{path="/workspace/outputs/report.xlsx"}',
    ':codex-file-citation{path="/workspace/outputs/sub/../REPORT.xlsx"}',
    ':codex-file-citation{path="/workspace/outputs2/out.pdf"}',
    ':codex-file-citation{path="/workspace/outputs/../outside.pdf"}',
    ':codex-file-citation{path="/workspace/work/out.pdf"}',
    ':codex-file-citation{path="/workspace/.codex_scratch/out.pdf"}',
    ':codex-file-citation{path="/workspace/outputs/draft.tex"}',
    '[valid tex](outputs/draft.tex)',
  ].join('\n\n'))])]);
  const scoped = output(value, { status: 'known', path: '/workspace/outputs' });
  assert.deepEqual(scoped.entries.map(entry => entry.path), ['/workspace/outputs/report.xlsx', '/workspace/outputs/draft.tex']);
  assert.deepEqual(scoped.entries.map(entry => entry.via), ['citation', 'markdown-link']);
  const unknown = output(value, { status: 'unknown' });
  assert.deepEqual(unknown.entries, []);
  assert.ok(unknown.gaps.includes('unknown-output-directory'));
  const invalid = output(value, { status: 'known', path: '' });
  assert.ok(invalid.gaps.includes('invalid-output-directory'));
  assert.deepEqual(invalid.entries, []);
  assert.deepEqual(output(value, { status: 'known', path: '/' }).entries, []);
});

test('source citations and visualization paths prevent false output links and files', () => {
  const visual = '\uE200visualize\uE202{"path":"/workspace/vis.html"}\uE201';
  const value = thread([turn('turn', [message('early', [
    ':codex-file-citation{path="/workspace/ref.pdf" purpose="source"}',
    '\u3010F:relative%20file.pdf\u2020L1-L2\u3011',
    ':codex-file-citation{path="/workspace/chart.png"}',
    '::codex-inline-vis{path="/workspace/chart.png"}',
    visual,
  ].join('\n\n')), message('answer', '[reference](ref.pdf) [reference2](relative%20file.pdf) [output](real.pdf)'),
  { id: 'change', type: 'fileChange', status: 'completed', changes: [
    { path: '/workspace/vis.html', kind: { type: 'add' }, diff: '+html' },
  ] }])]);
  const result = output(value);
  assert.deepEqual(result.entries.map(entry => entry.path), ['/workspace/real.pdf']);
  assert.deepEqual(result.websites, []);
});

test('website fallback needs a unique local URL or unique non-visual HTML change and no blocking artifacts', () => {
  const change = (id: string, paths: string[]): ThreadItemSummary => ({ id, type: 'fileChange', status: 'completed',
    changes: paths.map(path => ({ path, kind: { type: 'add' }, diff: '+html' })) });
  const value = thread([
    turn('many-html', [change('many', ['a.html', 'b.html'])]),
    turn('one-html', [change('file', ['site/index.html']), message('note', 'done')]),
    turn('url', [message('answer', 'Preview http://localhost:5199/ with your browser.')]),
    turn('multiple-url', [message('many-urls', 'http://localhost:4001/ http://localhost:4002/')]),
    turn('external-url', [message('external', 'https://example.invalid:4443/')]),
    turn('file-wins', [message('file', ':codex-file-citation{path="output.pdf"}\n\nhttp://localhost:5000/')]),
    turn('live-wins', [message('live', ':codex-file-citation{path="session-ref" mode="live" artifact_kind="workbook"}\n\nhttp://localhost:5001/')]),
    turn('uncertain-appgen', [message('maybe', 'http://localhost:5002/'),
      { id: 'sites', type: 'mcpToolCall', server: 'codex_apps', tool: 'sites.create', status: 'completed', result: {} }]),
    turn('unrelated-tool', [message('unrelated', 'http://localhost:5003/'),
      { id: 'read', type: 'mcpToolCall', server: 'ordinary', tool: 'read', status: 'completed', result: {} }]),
  ]);
  const result = output(value);
  assert.deepEqual(result.websites.map(site => [site.source.turnId, site.target]), [
    ['unrelated-tool', { type: 'url', url: 'http://localhost:5003/' }],
    ['url', { type: 'url', url: 'http://localhost:5199/' }],
    ['one-html', { type: 'file', path: '/workspace/site/index.html', pathResolution: 'thread-cwd' }],
  ]);
  assert.deepEqual(new Set(result.gaps), new Set(['website-appgen-unknown', 'turn-cwd-unverified']));
  assert.deepEqual(result.entries.map(entry => entry.path), ['/workspace/output.pdf']);
  assert.deepEqual(result.ordered.map(entry => entry.source.turnId), ['unrelated-tool', 'file-wins', 'url', 'one-html']);
});

test('website fallback deduplicates across turns and rejects ambiguous or deleted changes', () => {
  const change = (id: string, kind: string, path: string): ThreadItemSummary => ({ id, type: 'fileChange', status: 'completed',
    changes: [{ path, kind: { type: kind }, diff: '' }] });
  const value = thread([
    turn('older', [change('older-change', 'add', 'site.html')]),
    turn('newer', [change('newer-change', 'update', 'site.html')]),
    turn('deleted', [change('delete', 'delete', 'removed.html')]),
    turn('invalid', [{ id: 'invalid-change', type: 'fileChange', status: 'completed',
      changes: [{ path: 'one.html', kind: { type: 'add' } }, { path: 'other.html' }] }]),
  ]);
  const result = output(value);
  assert.deepEqual(result.websites.map(entry => [entry.source.turnId, entry.target]), [
    ['newer', { type: 'file', path: '/workspace/site.html', pathResolution: 'thread-cwd' }],
  ]);
  assert.ok(result.gaps.includes('invalid-file-change'));
});

test('a duplicate output citation still prevents a website fallback within that original turn', () => {
  const value = thread([
    turn('older', [message('older-answer', ':codex-file-citation{path="/workspace/one.pdf"}\n\nhttp://localhost:5010/')]),
    turn('newer', [message('newer-answer', ':codex-file-citation{path="/workspace/one.pdf"}')]),
  ]);
  const result = output(value);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0]?.source.turnId, 'newer');
  assert.deepEqual(result.websites, []);
});

test('partial history, bad citation and invalid scope never establish an empty result', () => {
  const value = thread([{ id: 'turn', status: 'completed', itemsView: 'summary', items: [message('answer',
    ':codex-file-citation{path="/workspace/ok.pdf"}\n\n:codex-file-citation{path="broken.pdf" mode="unexpected"}\n\n[not-confirmed-final](partial.pdf) http://localhost:5000/')]}]);
  const result = projectThreadSummaryFileOutputs({ hostId: 'remote', thread: value, historyComplete: false, streamGap: true,
    outputDirectory: { status: 'none' } });
  assert.deepEqual(new Set(result.gaps), new Set(['incomplete-history', 'stream-gap', 'invalid-citation']));
  assert.equal(result.entries[0]?.path, '/workspace/ok.pdf');
  assert.equal(result.entries.length, 1);
  assert.deepEqual(result.websites, []);
  assert.deepEqual(output(null).gaps, ['missing-thread', 'incomplete-history']);
  assert.ok(output(thread([], 'relative')).gaps.includes('invalid-cwd'));
  assert.ok(output(thread([]), { status: 'none' }, '').gaps.includes('invalid-owner'));
});

test('malformed or non-string citation fields do not become implicit output', () => {
  const value = thread([turn('t', [message('m', [
    ':codex-file-citation{path="valid.pdf"}',
    ':codex-file-citation{path="invalid.pdf" purpose}',
    ':codex-file-citation{path="broken.pdf"',
    '\\:codex-file-citation{path="literal.pdf"}',
    '` :codex-file-citation{path="code.pdf"} `',
  ].join('\n\n'))])]);
  const result = output(value);
  assert.deepEqual(result.entries.map(entry => entry.path), ['/workspace/valid.pdf']);
  assert.ok(result.gaps.includes('invalid-citation'));
  const uncertain = output(thread([turn('t', [message('m', ':codex-file-citation{path="bad.pdf"\n\nhttp://localhost:5000/')])]));
  assert.deepEqual(uncertain.websites, []);
  assert.ok(uncertain.gaps.includes('invalid-citation'));
  const missingFinal = output(thread([turn('t', [message('old', '[old](old.pdf) http://localhost:5000/'),
    { id: 'missing', type: 'agentMessage', text: null }])]));
  assert.deepEqual(missingFinal.ordered, []);
  assert.ok(missingFinal.gaps.includes('incomplete-history'));
});

test('drive and UNC paths remain explicitly unavailable to the current host path service', () => {
  const drive = thread([turn('t', [message('m', ':codex-file-citation{path="C:\\Work\\output\\a.pdf"}')])], 'C:\\Work');
  assert.deepEqual(output(drive, { status: 'known', path: 'C:\\Work\\output' }).entries, []);
  assert.ok(output(drive, { status: 'known', path: 'C:\\Work\\output' }).gaps.includes('unsupported-host-path'));
  const network = thread([turn('t', [message('m', ':codex-file-citation{path="//server/share/results/a.pdf"}')])], '//server/share');
  assert.deepEqual(output(network, { status: 'known', path: '//server/share/results' }).entries, []);
  assert.ok(output(network, { status: 'known', path: '//server/share/results' }).gaps.includes('unsupported-host-path'));
  const mixed = output(thread([turn('t', [message('m', ':codex-file-citation{path="C:/other/a.pdf"}\n\n:codex-file-citation{path="/workspace/ok.pdf"}')])]));
  assert.deepEqual(mixed.entries.map(entry => entry.path), ['/workspace/ok.pdf']);
  assert.ok(mixed.gaps.includes('unsupported-host-path'));
  const unresolved = output(thread([turn('t', [message('m', ':codex-file-citation{path="C:/other/a.pdf"}\n\nhttp://localhost:5000/')])]));
  assert.ok(unresolved.gaps.includes('unsupported-host-path'));
  assert.deepEqual(unresolved.websites, []);
});

test('assistant envelopes needing original preprocessing cannot create false outputs or website fallback', () => {
  const value = thread([
    turn('safe', [message('visible', ':codex-file-citation{path="/workspace/visible.pdf"}')]),
    turn('hidden-tool', [message('hidden', '[external_agent_tool_result]\n:codex-file-citation{path="/workspace/hidden.pdf"}\n[/external_agent_tool_result]\n\nhttp://localhost:5000/')]),
    turn('heartbeat', [message('automation', '<heartbeat><message>:codex-file-citation{path="/workspace/heartbeat.pdf"}</message></heartbeat>')]),
  ]);
  const result = output(value);
  assert.deepEqual(result.entries.map(entry => entry.path), ['/workspace/visible.pdf']);
  assert.deepEqual(result.websites, []);
  assert.ok(result.gaps.includes('assistant-envelope-unsupported'));
});
