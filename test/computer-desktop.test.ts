import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { X11Desktop } from '../plugins/yard-computer/desktop.ts';
import type { DesktopRunOptions, DesktopRunner } from '../plugins/yard-computer/desktop.ts';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X6AAAAABJRU5ErkJggg==', 'base64');
let nextDisplay = 1000000 + process.pid * 10;
interface Call { file: string; args: string[]; options: DesktopRunOptions }
function fixture(override?: DesktopRunner, display = ':' + nextDisplay++) {
  const calls: Call[] = [];
  const run: DesktopRunner = async (file, args, options) => {
    calls.push({ file, args, options });
    if (override) return override(file, args, options);
    if (file === 'test-import') return png;
    return Buffer.from(args[0] === 'getdisplaygeometry' ? '640 480\n' : '');
  };
  const desktop = new X11Desktop({ display, xauthority: '/fixture/Xauthority', importCommand: 'test-import', xdotoolCommand: 'test-xdotool', xclipCommand: 'test-xclip', run });
  return { desktop, calls, display };
}

test('desktop configuration is checked at execution, without contacting an implicit user display', async () => {
  const h = fixture(undefined, '');
  await assert.rejects(h.desktop.execute({ type: 'screenshot' }), /显式配置/);
  assert.equal(h.calls.length, 0);
  for (const display of ['hostname:0', 'localhost:0', ':1; echo unsafe', '-display', ':1\n', ':1.1']) {
    await assert.rejects(fixture(undefined, display).desktop.execute({ type: 'screenshot' }), /显式配置/);
  }
});

test('screenshots contain real PNG bytes and coordinate dimensions and use only the explicitly selected display', async () => {
  const h = fixture();
  const content = await h.desktop.execute({ type: 'screenshot' });
  assert.equal(content[0]!.type, 'text');
  assert.deepEqual(JSON.parse((content[0] as { text: string }).text), {
    display: h.display, width: 1, height: 1, coordinates: 'absolute screen pixels; origin at top left',
  });
  assert.deepEqual(content[1], { type: 'image', mimeType: 'image/png', data: png.toString('base64') });
  assert.deepEqual(h.calls.map(call => [call.file, call.args]), [['test-import', ['-display', h.display, '-window', 'root', 'png:-']]]);
  assert.equal(h.calls[0]!.options.env.DISPLAY, h.display);
  assert.equal(h.calls[0]!.options.env.XAUTHORITY, '/fixture/Xauthority');
});

test('click, text, shortcut and scroll use bounded literal argument vectors followed by a screenshot', async () => {
  const h = fixture();
  await h.desktop.execute({ type: 'click', x: 22, y: 44, button: 'right', clicks: 2 });
  const text = 'literal "quotes" $(touch should-never-execute)\n--window 10';
  await h.desktop.execute({ type: 'type', text });
  await h.desktop.execute({ type: 'keypress', keys: ['Ctrl', 'Shift', 'a'] });
  await h.desktop.execute({ type: 'scroll', direction: 'left', clicks: 3 });
  const inputs = h.calls.filter(call => call.file === 'test-xdotool' && call.args[0] !== 'getdisplaygeometry').map(call => call.args);
  assert.deepEqual(inputs, [
    ['mousemove', '22', '44'], ['click', '--repeat', '2', '--delay', '80', '3'],
    ['type', '--clearmodifiers', '--delay', '0', '--', text],
    ['key', '--clearmodifiers', 'ctrl+shift+a'], ['click', '--repeat', '3', '--delay', '25', '6'],
  ]);
  assert.equal(h.calls.filter(call => call.file === 'test-import').length, 4);
});

test('out-of-screen coordinates and malformed operations cannot emit input events', async () => {
  const h = fixture();
  for (const action of [
    { type: 'move', x: 640, y: 10 }, { type: 'click', x: 0, y: 480 },
    { type: 'drag', fromX: 1, fromY: 2, toX: 640, toY: 0 },
    { type: 'click', x: -1, y: 0 }, { type: 'move', x: 1.5, y: 0 },
    { type: 'click', x: 0, y: 0, button: 'wheel' }, { type: 'click', x: 0, y: 0, clicks: 4 },
    { type: 'keypress', keys: ['--window 5'] }, { type: 'keypress', keys: [] },
    { type: 'scroll', direction: 'up', clicks: 21 }, { type: 'scroll', direction: 'there', clicks: 1 },
    { type: 'wait', milliseconds: 2001 }, { type: 'type', text: 'a\0b' }, { type: 'shell', command: 'true' },
  ]) await assert.rejects(h.desktop.execute(action));
  assert.ok(h.calls.every(call => call.file === 'test-xdotool' && call.args[0] === 'getdisplaygeometry'));
});

test('drag releases its mouse button after a failed movement, reports uncertainty and does not replay', async () => {
  let moves = 0;
  const h = fixture(async (file, args) => {
    if (file === 'test-import') return png;
    if (args[0] === 'getdisplaygeometry') return Buffer.from('640 480');
    if (args[0] === 'mousemove' && ++moves === 2) throw new Error('injected movement failure');
    return Buffer.alloc(0);
  });
  await assert.rejects(h.desktop.execute({ type: 'drag', fromX: 10, fromY: 20, toX: 30, toY: 40 }), /可能已生效.*没有自动重试/);
  assert.equal(moves, 2);
  assert.deepEqual(h.calls.at(-1)!.args, ['mouseup', '1']);
  assert.equal(h.calls.filter(call => call.args[0] === 'mousedown').length, 1);
  // Failure released the display-wide lock and left the local action queue usable.
  assert.equal((await h.desktop.execute({ type: 'screenshot' }))[1]!.type, 'image');
});

test('separate desktop instances sharing one X server serialize action plus screenshot and release locks on failure', async () => {
  const display = ':' + nextDisplay++;
  let started!: () => void, release!: () => void;
  const begun = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = fixture(async (file, args) => {
    if (file === 'test-import') return png;
    if (args[0] === 'getdisplaygeometry') { started(); await gate; return Buffer.from('640 480'); }
    return Buffer.alloc(0);
  }, display);
  const second = fixture(undefined, display + '.0');
  const firstAction = first.desktop.execute({ type: 'move', x: 10, y: 20 });
  await begun;
  const secondAction = second.desktop.execute({ type: 'screenshot' });
  await delay(80);
  assert.equal(second.calls.length, 0);
  release();
  await firstAction;
  await secondAction;
  assert.equal(first.calls.at(-1)!.file, 'test-import');
  assert.equal(second.calls.length, 1);
});

test('invalid screenshot output and missing dependencies report actionable errors', async () => {
  const invalid = fixture(async () => Buffer.from('not an image'));
  await assert.rejects(invalid.desktop.execute({ type: 'screenshot' }), /有效 PNG/);
  const missing = fixture(async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); });
  await assert.rejects(missing.desktop.execute({ type: 'screenshot' }), /apt install xdotool imagemagick/);
  const noLock = new X11Desktop({ display: ':' + nextDisplay++, flockCommand: '/nonexistent-yard-flock' });
  await assert.rejects(noLock.execute({ type: 'screenshot' }), /安装 util-linux/);
});

test('cancelled work waiting for a display lock never emits input after the lock becomes available', async () => {
  const display = ':' + nextDisplay++;
  let started!: () => void, release!: () => void;
  const begun = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = fixture(async () => { started(); await gate; return png; }, display);
  const second = fixture(undefined, display);
  const firstAction = first.desktop.execute({ type: 'screenshot' });
  await begun;
  const controller = new AbortController();
  const blocked = second.desktop.execute({ type: 'click', x: 10, y: 20 }, controller.signal);
  await delay(50);
  controller.abort(new Error('cancel locked operation'));
  await assert.rejects(blocked, /cancel locked operation/);
  release();
  await firstAction;
  await second.desktop.execute({ type: 'screenshot' });
  assert.ok(second.calls.every(call => call.file === 'test-import'));
});

test('cancelling a drag aborts its command and releases the pressed button before another operation', async () => {
  const controller = new AbortController();
  let moves = 0;
  const h = fixture(async (file, args, options) => {
    if (file === 'test-import') return png;
    if (args[0] === 'getdisplaygeometry') return Buffer.from('640 480');
    if (args[0] === 'mousemove' && ++moves === 2) {
      assert.equal(options.signal, controller.signal);
      controller.abort(new Error('cancel drag'));
      options.signal!.throwIfAborted();
    }
    return Buffer.alloc(0);
  });
  await assert.rejects(h.desktop.execute({ type: 'drag', fromX: 10, fromY: 20, toX: 30, toY: 40 }, controller.signal), /可能已生效/);
  await h.desktop.execute({ type: 'screenshot' });
  const released = h.calls.find(call => call.args[0] === 'mouseup');
  assert.deepEqual(released?.args, ['mouseup', '1']);
  assert.equal(released?.options.signal, undefined);
  assert.equal(moves, 2);
});

function primaryFixture(previous?: string, intercept?: (file: string, args: string[], options: DesktopRunOptions) => Promise<Buffer | undefined>) {
  let selected: Buffer | undefined = previous === undefined ? undefined : Buffer.from(previous);
  const h = fixture(async (file, args, options) => {
    const intercepted = await intercept?.(file, args, options);
    if (intercepted !== undefined) return intercepted;
    if (file === 'test-import') return png;
    if (file !== 'test-xclip') return Buffer.from(args[0] === 'getdisplaygeometry' ? '640 480' : '');
    assert.deepEqual(args.slice(0, 2), ['-selection', 'primary']);
    if (args.includes('-in')) { selected = options.input; return Buffer.alloc(0); }
    assert.equal(args.at(-1), 'UTF8_STRING');
    if (selected === undefined) throw Object.assign(new Error('No selection'), { code: 1, stderr: 'Error: target UTF8_STRING not available\n' });
    return selected;
  });
  return { ...h, selected: () => selected };
}

test('Unicode keeps the new PRIMARY text available for repeated reads without touching the main clipboard', async () => {
  for (const previous of [undefined, 'previous selection']) {
    const h = primaryFixture(previous);
    await h.desktop.execute({ type: 'type', text: '你好 Yard' });
    const writes = h.calls.filter(call => call.file === 'test-xclip' && call.args.includes('-in'));
    assert.deepEqual(writes.map(call => call.options.input?.toString()), ['你好 Yard']);
    assert.deepEqual(h.calls.find(call => call.args[0] === 'click')?.args, ['click', '2']);
    assert.equal(h.calls.some(call => call.args[0] === 'type' || call.args.includes('-loops') || call.args.includes('-verbose')), false);
    assert.equal(h.selected()?.toString(), '你好 Yard');
    await h.desktop.execute({ type: 'screenshot' });
    assert.equal(h.selected()?.toString(), '你好 Yard');
    await assert.rejects(h.desktop.execute({ type: 'type', text: '中'.repeat(1001) }), /长文本请拆成多次输入/);
  }
});

test('Unicode confirms PRIMARY content before pasting and bounds retries when content does not match', async () => {
  let reads = 0;
  const h = primaryFixture('old', async (file, args) => {
    if (file === 'test-xclip' && args.includes('-out')) {
      if (++reads === 1) return Buffer.from('old');
      if (reads === 2) throw Object.assign(new Error('not ready'), { code: 1, stderr: 'Error: target STRING not available\n' });
    }
    if (args[0] === 'click') assert.equal(reads, 3);
    return undefined;
  });
  await h.desktop.execute({ type: 'type', text: '新文本' });
  assert.equal(reads, 3); assert.equal(h.selected()?.toString(), '新文本');
  const wrong = primaryFixture(undefined, async (file, args) => file === 'test-xclip' && args.includes('-out') ? Buffer.from('different') : undefined);
  await assert.rejects(wrong.desktop.execute({ type: 'type', text: '无法确认' }), /无法确认 X11 PRIMARY/);
  assert.equal(wrong.calls.filter(call => call.args.includes('-out')).length, 10);
  assert.equal(wrong.calls.some(call => call.args[0] === 'click'), false);
});

test('cancelled Unicode waits for middle-button cleanup, keeps PRIMARY and releases the display lock afterward', async () => {
  const controller = new AbortController();
  let cleaning!: () => void, release!: () => void;
  const cleaned = new Promise<void>(resolve => { cleaning = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const h = primaryFixture('old', async (_file, args, options) => {
    if (args[0] === 'click') { controller.abort(new Error('cancel middle click')); options.signal!.throwIfAborted(); }
    if (args[0] === 'mouseup') { assert.equal(options.signal, undefined); cleaning(); await gate; }
    return undefined;
  });
  let settled = false;
  const operation = assert.rejects(h.desktop.execute({ type: 'type', text: '中文' }, controller.signal), /可能已生效/)
    .then(() => { settled = true; });
  await cleaned; assert.equal(h.selected()?.toString(), '中文');
  const other = fixture(undefined, h.display), observing = other.desktop.execute({ type: 'screenshot' });
  await delay(30); assert.equal(settled, false); assert.equal(other.calls.length, 0);
  release(); await operation; await observing;
  assert.deepEqual(h.calls.find(call => call.args[0] === 'mouseup')?.args, ['mouseup', '2']);
  assert.equal(h.calls.filter(call => call.args.includes('-in')).length, 1);
  assert.equal(h.selected()?.toString(), '中文');
});

test('cancellation waits for mouse cleanup before settling or releasing the display lock', async () => {
  const controller = new AbortController(), display = ':' + nextDisplay++;
  let started!: () => void, release!: () => void, moves = 0;
  const cleaning = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = fixture(async (file, args, options) => {
    if (file === 'test-import') return png;
    if (args[0] === 'getdisplaygeometry') return Buffer.from('640 480');
    if (args[0] === 'mousemove' && ++moves === 2) { controller.abort(new Error('cancel gate')); options.signal!.throwIfAborted(); }
    if (args[0] === 'mouseup') { assert.equal(options.signal, undefined); started(); await gate; }
    return Buffer.alloc(0);
  }, display);
  let settled = false;
  const operation = first.desktop.execute({ type: 'drag', fromX: 1, fromY: 2, toX: 3, toY: 4 }, controller.signal)
    .then(() => { settled = true; }, () => { settled = true; });
  await cleaning;
  const second = fixture(undefined, display);
  const observing = second.desktop.execute({ type: 'screenshot' });
  await delay(60);
  assert.equal(settled, false); assert.equal(second.calls.length, 0);
  release(); await operation; await observing;
  assert.equal(settled, true);
});

test('aborted subprocesses close before mouse cleanup, lock release and the returned rejection', async () => {
  const root = await mkdtemp('/tmp/yard-computer-cancel-');
  try {
    const executable = join(root, 'xdotool-fixture'), pidPath = join(root, 'pid'), releasedPath = join(root, 'released');
    await writeFile(executable, '#!/usr/bin/env node\n' + `
const fs = require('node:fs');
const command = process.argv[2];
if (command === 'getdisplaygeometry') console.log('640 480');
else if (command === 'mousedown') {
  process.on('SIGTERM', () => {});
  fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));
  setInterval(() => {}, 1000);
} else if (command === 'mouseup') fs.writeFileSync(${JSON.stringify(releasedPath)}, 'released');
`, { mode: 0o700 });
    const desktop = new X11Desktop({ display: ':' + nextDisplay++, xdotoolCommand: executable });
    const controller = new AbortController();
    const rejected = assert.rejects(desktop.execute({ type: 'drag', fromX: 1, fromY: 2, toX: 3, toY: 4 }, controller.signal), /可能已生效/);
    let pid = 0;
    for (let attempt = 0; attempt < 100 && !pid; attempt++) {
      try { pid = Number(await readFile(pidPath, 'utf8')); } catch { await delay(10); }
    }
    assert.ok(pid, 'The fixture subprocess must be running before cancellation');
    controller.abort(new Error('cancel real subprocess'));
    await rejected;
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    assert.equal(await readFile(releasedPath, 'utf8'), 'released');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('aborted xclip launchers close before the Unicode call settles', async () => {
  const root = await mkdtemp('/tmp/yard-computer-selection-cancel-');
  try {
    const executable = join(root, 'desktop-fixture'), pidPath = join(root, 'pid');
    await writeFile(executable, '#!/usr/bin/env node\n' + `
const fs = require('node:fs'), args = process.argv.slice(2);
if (args[0] === 'getdisplaygeometry') console.log('640 480');
else if (args.includes('-out')) console.log(args.at(-1) === 'TARGETS' ? 'TARGETS\\nUTF8_STRING' : 'prior');
else if (args.includes('-in')) {
  process.on('SIGTERM', () => {});
  fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));
  process.stdin.resume(); setInterval(() => {}, 1000);
}
`, { mode: 0o700 });
    const desktop = new X11Desktop({ display: ':' + nextDisplay++, xdotoolCommand: executable, xclipCommand: executable });
    const controller = new AbortController();
    const rejected = assert.rejects(desktop.execute({ type: 'type', text: '中文' }, controller.signal), /可能已生效/);
    let pid = 0;
    for (let attempt = 0; attempt < 100 && !pid; attempt++) {
      try { pid = Number(await readFile(pidPath, 'utf8')); } catch { await delay(10); }
    }
    assert.ok(pid, 'The selection launcher must be running before cancellation');
    controller.abort(new Error('cancel real selection launcher')); await rejected;
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('cancelled key presses, typing and clicks release their keys and buttons without the aborted signal', async () => {
  for (const kind of ['keypress', 'type', 'click'] as const) {
    const controller = new AbortController();
    const h = fixture(async (file, args, options) => {
      if (file === 'test-import') return png;
      if (args[0] === 'key' || args[0] === 'type' || args[0] === 'click') { controller.abort(new Error('cancel input')); options.signal!.throwIfAborted(); }
      return Buffer.from(args[0] === 'getdisplaygeometry' ? '640 480' : '');
    });
    const action = kind === 'keypress' ? { type: 'keypress', keys: ['Ctrl', 'v'] }
      : kind === 'type' ? { type: 'type', text: 'ASCII typing' } : { type: 'click', x: 1, y: 2 };
    await assert.rejects(h.desktop.execute(action, controller.signal), /可能已生效/);
    const release = h.calls.find(call => call.args[0] === (kind === 'click' ? 'mouseup' : 'keyup'));
    assert.deepEqual(release?.args, kind === 'keypress' ? ['keyup', 'ctrl+v'] : kind === 'click' ? ['mouseup', '1']
      : ['keyup', 'Shift_L', 'Shift_R', 'Control_L', 'Control_R', 'Alt_L', 'Alt_R', 'Super_L', 'Super_R']);
    assert.equal(release?.options.signal, undefined);
  }
});
