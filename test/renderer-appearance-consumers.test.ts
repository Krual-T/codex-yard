import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { codeThemes } from '../src/renderer/settings/preferences.ts';
import { resolveCodeTheme } from '../src/renderer/appearance/code-theme.ts';

test('every available code theme has an independent palette and unknown values fall back without mutation', () => {
  for (const mode of ['light', 'dark'] as const) {
    const palettes = codeThemes[mode].map(id => {
      const resolved = resolveCodeTheme(mode, id);
      assert.equal(resolved.id, id);
      assert.equal(resolved.fallback, false);
      return JSON.stringify(resolved.colors);
    });
    assert.equal(new Set(palettes).size, codeThemes[mode].length);
    assert.deepEqual(resolveCodeTheme(mode, 'missing-theme'), { ...resolveCodeTheme(mode, 'codex'), fallback: true });
    assert.equal(resolveCodeTheme(mode, 'toString').id, 'codex');
  }
});

test('owned editor, diff and workspace consume appearance and report the active scope', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 120_000,
}, async t => {
  const root = await mkdtemp('/tmp/yard-f-appearance-');
  const patch = '@@ -1 +1 @@\n-old value\n+new value\n';
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
      import * as React from 'react';
      import { createRoot } from 'react-dom/client';
      import { EditorView } from '@codemirror/view';
      import { CodeEditor } from './src/renderer/files/CodeEditor.tsx';
      import { DiffViewer } from './src/renderer/diff/DiffViewer.tsx';
      import { WorkspacePanels } from './src/renderer/panels/WorkspacePanels.tsx';
      import './src/renderer/panels/workspace-panels.css';
      const editorRoot = createRoot(document.getElementById('editor'));
      const diffRoot = createRoot(document.getElementById('diff'));
      const panelRoot = createRoot(document.getElementById('panel'));
      const state = {changes:[], kinds:[], calls:[], consumed:[], opened:[], closed:0};
      let editorProps = {path:'/outside.ts',text:'const answer = "hello"; // note\\n',theme:'light',visible:true,readOnly:false,
        onChange:text => state.changes.push(text),onSave() {}};
      let diffProps = {diff:${JSON.stringify(patch)},path:'/w/file.ts',markerStyle:'color',
        onOpenFile:(path,line) => state.opened.push({path,line})};
      const client = {async host(endpoint, params = {}) {
        state.calls.push({endpoint,params:structuredClone(params)});
        if (endpoint === 'workspace-directory-entries') return {entries:[]};
        if (endpoint === 'workspace-files') return {text:'file contents\\n'};
        if (endpoint === 'read-file-binary') return {contentsBase64:btoa('file contents\\n'),mimeType:'text/plain'};
        if (endpoint === 'terminal') return true;
        throw new Error('Unexpected synthetic host endpoint: ' + endpoint);
      }, subscribe() { return () => {}; }};
      let panelProps = {client, scopeId:'scope-a',hostId:'local',cwd:'/w',
        appearance:{theme:'dark',codeFontSize:16,codeLineHeight:24,codeThemeId:'dracula',diffMarkerStyle:'symbols'},request:null,
        onRequestConsumed:id => state.consumed.push(id),onClose:() => state.closed++,onActiveKindChange:kind => state.kinds.push(kind)};
      const renderEditor = changes => { editorProps = {...editorProps,...changes}; editorRoot.render(React.createElement(CodeEditor, editorProps)); };
      const renderDiff = changes => { diffProps = {...diffProps,...changes}; diffRoot.render(React.createElement(DiffViewer, diffProps)); };
      const renderPanel = changes => { panelProps = {...panelProps,...changes}; panelRoot.render(React.createElement(WorkspacePanels, panelProps)); };
      window.appearanceFixture = {state,renderEditor,renderDiff,renderPanel,
        view:() => EditorView.findFromDOM(document.querySelector('#editor .cm-content'))};
      renderEditor({}); renderDiff({}); renderPanel({});
    ` }, bundle: true, write: false, format: 'iife', outdir: 'appearance-fixture', loader: { '.css': 'css' },
  });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'],
    env: { ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache') } });
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  let completed = false;
  t.after(async () => { await context.close(); await browser.close(); if (completed) await rm(root, { recursive: true, force: true }); });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.route('http://127.0.0.1:47834/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body>
      <div id="editor" style="height:250px"></div><div id="diff" class="yard-workspace-panels" style="height:250px"></div>
      <div id="panel" style="height:350px"></div></body></html>` }));
    await page.goto('http://127.0.0.1:47834/');
    await page.addStyleTag({ content: ':root{--yard-code-size:20px;--yard-code-font:"Courier New",monospace;--yard-diff-added:#078141;--yard-diff-removed:#bc2935}' +
      bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text });
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text });
    const editor = page.locator('#editor .cm-content');
    const keyword = editor.locator('span').filter({ hasText: /^const$/ });
    await keyword.waitFor();
    const metrics = () => editor.evaluate(element => {
      const style = getComputedStyle(element.closest('.cm-editor')!.querySelector('.cm-scroller')!);
      return { size: style.fontSize, line: style.lineHeight, family: style.fontFamily };
    });
    assert.deepEqual(await metrics(), { size: '20px', line: '30px', family: '"Courier New", monospace' });
    await page.evaluate(() => document.documentElement.style.setProperty('--yard-code-size', '23px'));
    assert.equal((await metrics()).line, '34.5px');
    await page.evaluate(() => document.documentElement.style.setProperty('--yard-code-line-height', '31px'));
    assert.equal((await metrics()).line, '31px');
    await page.evaluate(() => { const style = document.getElementById('editor')!.style;
      style.setProperty('--yard-panel-code-size', '15px'); style.setProperty('--yard-panel-code-line-height', '22px');
      style.setProperty('--yard-panel-code-font', 'serif'); });
    assert.deepEqual(await metrics(), { size: '15px', line: '22px', family: 'serif' });

    await page.evaluate(() => { (window as any).appearanceFixture.originalView = (window as any).appearanceFixture.view(); });
    for (const mode of ['light', 'dark'] as const) for (const id of codeThemes[mode]) {
      const colors = resolveCodeTheme(mode, id).colors;
      const expected = await page.evaluate(values => values.map(value => {
        const element = document.createElement('span'); element.style.color = value; document.body.append(element);
        const color = getComputedStyle(element).color; element.remove(); return color;
      }), [colors.keyword, colors.string, colors.comment]);
      await page.evaluate(({ mode, id }) => (window as any).appearanceFixture.renderEditor({ theme: mode, codeThemeId: id }), { mode, id });
      await page.waitForFunction(colors => {
        const tokens = Array.from(document.querySelectorAll('#editor .cm-content span'));
        return ['const', '"hello"', '// note'].every((text, index) => {
          const token = tokens.find(element => element.textContent === text);
          return token && getComputedStyle(token).color === colors[index];
        });
      }, expected);
      assert.equal(await page.evaluate(() => (window as any).appearanceFixture.view() === (window as any).appearanceFixture.originalView), true, `${mode}/${id} replaced the editor`);
    }
    await page.evaluate(() => (window as any).appearanceFixture.renderEditor({ theme: 'dark', codeThemeId: 'missing-theme' }));
    await page.waitForFunction(() => getComputedStyle(Array.from(document.querySelectorAll('#editor .cm-content span')).find(element => element.textContent === 'const')!).color === 'rgb(214, 165, 232)');
    await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.type('x');
    const selection = await page.evaluate(() => (window as any).appearanceFixture.view().state.selection.main.toJSON());
    await page.evaluate(() => (window as any).appearanceFixture.renderEditor({ theme: 'dark', codeThemeId: 'dracula' }));
    await page.waitForFunction(() => getComputedStyle(Array.from(document.querySelectorAll('#editor .cm-content span')).find(element => element.textContent === 'const')!).color === 'rgb(255, 121, 198)');
    assert.deepEqual(await page.evaluate(() => (window as any).appearanceFixture.view().state.selection.main.toJSON()), selection);
    assert.equal(await editor.evaluate(element => document.activeElement === element), true);
    await page.locator('#editor').getByRole('button', { name: 'Undo', exact: true }).click();
    assert.equal(await page.evaluate(() => (window as any).appearanceFixture.view().state.doc.toString()), 'const answer = "hello"; // note\n');
    await page.locator('#editor').getByRole('button', { name: 'Redo', exact: true }).click();
    assert.equal((await page.evaluate(() => (window as any).appearanceFixture.view().state.doc.toString())).endsWith('x'), true);

    await editor.focus();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: '中', selectionStart: 1, selectionEnd: 1 });
    assert.equal(await page.evaluate(() => (window as any).appearanceFixture.view().compositionStarted), true);
    await page.evaluate(() => (window as any).appearanceFixture.renderEditor({ theme: 'light', codeThemeId: 'github' }));
    await page.waitForFunction(() => getComputedStyle(Array.from(document.querySelectorAll('#editor .cm-content span')).find(element => element.textContent === 'const')!).color === 'rgb(207, 34, 46)');
    assert.equal(await page.evaluate(() => (window as any).appearanceFixture.view().compositionStarted), true);
    assert.equal(await editor.evaluate(element => document.activeElement === element), true);
    await cdp.send('Input.insertText', { text: '中文' });
    assert.equal((await page.evaluate(() => (window as any).appearanceFixture.view().state.doc.toString())).endsWith('x中文'), true);
    await cdp.detach();

    const diff = page.locator('#diff');
    const added = diff.locator('.yard-diff-line.is-add');
    const removed = diff.locator('.yard-diff-line.is-delete');
    await added.waitFor();
    assert.equal(await added.getByRole('img', { name: 'Added line' }).innerText(), '');
    assert.equal(await added.locator('.yard-diff-marker').evaluate(element => getComputedStyle(element, '::before').backgroundColor), 'rgb(7, 129, 65)');
    assert.equal(await removed.locator('.yard-diff-marker').evaluate(element => getComputedStyle(element, '::before').backgroundColor), 'rgb(188, 41, 53)');
    await page.evaluate(() => (window as any).appearanceFixture.renderDiff({ markerStyle: 'symbols' }));
    await page.waitForFunction(() => document.querySelector('#diff .yard-diff-lines')?.getAttribute('data-marker-style') === 'symbols');
    assert.equal(await added.getByRole('img', { name: 'Added line' }).innerText(), '+');
    assert.equal(await removed.getByRole('img', { name: 'Removed line' }).innerText(), '-');
    await diff.getByRole('button', { name: 'Switch to split diff' }).click();
    assert.equal(await diff.locator('.yard-diff-side.is-add .yard-diff-marker').innerText(), '+');
    assert.equal(await diff.locator('.yard-diff-side.is-delete .yard-diff-marker').innerText(), '-');
    await diff.getByRole('button', { name: 'Copy diff' }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), patch);
    await diff.getByRole('button', { name: 'Open file' }).click();
    assert.deepEqual(await page.evaluate(() => (window as any).appearanceFixture.state.opened), [{ path: '/w/file.ts', line: undefined }]);

    const panel = page.locator('#panel');
    const sendRequest = (request: object, changes: object = {}) => page.evaluate(({ request, changes }) =>
      (window as any).appearanceFixture.renderPanel({ ...changes, request }), { request, changes });
    const lastKind = () => page.evaluate(() => (window as any).appearanceFixture.state.kinds.at(-1));
    await page.waitForFunction(() => (window as any).appearanceFixture.state.kinds.at(-1) === null);
    await sendRequest({ id: 'term-a', kind: 'terminal', scopeId: 'scope-a', hostId: 'local', cwd: '/w' });
    await panel.getByRole('tab', { name: 'Terminal' }).waitFor();
    await page.waitForFunction(() => (window as any).appearanceFixture.state.kinds.at(-1) === 'terminal');
    await sendRequest({ id: 'diff-a', kind: 'diff', scopeId: 'scope-a', hostId: 'local', cwd: '/w', diff: patch });
    await page.waitForFunction(() => (window as any).appearanceFixture.state.kinds.at(-1) === 'diff');
    assert.equal(await panel.locator('.yard-diff-line.is-add .yard-diff-marker').innerText(), '+');
    await panel.getByRole('tab', { name: 'Terminal' }).click();
    await page.waitForFunction(() => (window as any).appearanceFixture.state.kinds.at(-1) === 'terminal');
    await page.evaluate(() => (window as any).appearanceFixture.renderPanel({ scopeId: 'scope-b', request: null }));
    await page.waitForFunction(() => (window as any).appearanceFixture.state.kinds.at(-1) === null);
    await sendRequest({ id: 'file-b', kind: 'file', scopeId: 'scope-b', hostId: 'local', cwd: '/w', path: 'file.ts' });
    await panel.getByRole('textbox', { name: 'File: /w/file.ts' }).waitFor();
    assert.equal(await lastKind(), 'file');
    await page.evaluate(() => (window as any).appearanceFixture.renderPanel({ hostId: 'remote', cwd: '/else', request: null }));
    await page.waitForFunction(() => (window as any).appearanceFixture.state.kinds.at(-1) === null);
    await page.evaluate(() => (window as any).appearanceFixture.renderPanel({ hostId: 'local', cwd: '/w', request: null }));
    await page.waitForFunction(() => (window as any).appearanceFixture.state.kinds.at(-1) === 'file');
    await page.evaluate(() => (window as any).appearanceFixture.renderPanel({ scopeId: 'scope-a', request: null }));
    await page.waitForFunction(() => (window as any).appearanceFixture.state.kinds.at(-1) === 'terminal');
    assert.equal(await page.evaluate(() => (window as any).appearanceFixture.state.calls.filter((call: any) => call.endpoint === 'terminal' && call.params.operation === 'create').length), 1);
    await panel.getByRole('tab', { name: 'Changes' }).click();
    await panel.getByRole('button', { name: 'Close diff' }).click();
    await page.waitForFunction(() => (window as any).appearanceFixture.state.kinds.at(-1) === 'terminal');
    await panel.getByRole('button', { name: 'Close terminal' }).click();
    await page.waitForFunction(() => (window as any).appearanceFixture.state.kinds.at(-1) === null);
    await page.evaluate(() => (window as any).appearanceFixture.renderPanel({ scopeId: 'scope-b', request: null }));
    await page.waitForFunction(() => (window as any).appearanceFixture.state.kinds.at(-1) === 'file');
    await panel.getByRole('button', { name: 'Close file.ts' }).click();
    await page.waitForFunction(() => (window as any).appearanceFixture.state.kinds.at(-1) === null);
    await sendRequest({ id: 'term-b', kind: 'terminal', scopeId: 'scope-b', hostId: 'local', cwd: '/w' });
    await page.waitForFunction(() => (window as any).appearanceFixture.state.kinds.at(-1) === 'terminal');
    await panel.getByRole('button', { name: 'Close panel' }).click();
    await page.waitForFunction(() => (window as any).appearanceFixture.state.closed === 1);
    assert.equal(await lastKind(), null);
    assert.deepEqual(errors, []);
    completed = true;
  } catch (error) {
    await page.screenshot({ path: join(root, 'failure.png'), fullPage: true }).catch(() => {});
    await writeFile(join(root, 'errors.txt'), `${String(error)}\n${errors.join('\n')}`);
    throw new Error(`Appearance browser failure artifacts: ${root}`, { cause: error });
  }
});
