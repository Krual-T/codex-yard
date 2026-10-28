import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('CodeMirror editor keeps file bytes, history and language isolated across scopes', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 90_000,
}, async t => {
  const root = await mkdtemp('/tmp/yard-f-editor-');
  const original = '\ufeffconst a = 1;\r\nlet b = 2;\n// three\rconst c = 3;\r\n';
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
      import * as React from 'react';
      import { createRoot } from 'react-dom/client';
      import { EditorView } from '@codemirror/view';
      import { LanguageDescription, syntaxTree } from '@codemirror/language';
      import { WorkspacePanels } from './src/renderer/panels/WorkspacePanels.tsx';
      import { CodeEditor } from './src/renderer/files/CodeEditor.tsx';
      const actualLoad = LanguageDescription.prototype.load;
      const state = { files: {'/workspace/a.ts':${JSON.stringify(original)}, '/workspace/b.json':'{"name": "json"}\\n'},
        writes:[], mode:'unknown-applied', releaseLanguage:null, readonlyChanges:0, consumed:[] };
      LanguageDescription.prototype.load = function() {
        if (this.name === 'TypeScript' && !state.releaseLanguage) return new Promise((resolve, reject) => {
          state.releaseLanguage = () => actualLoad.call(this).then(resolve, reject);
        });
        return actualLoad.call(this);
      };
      const client = { async host(endpoint, params) {
        if (endpoint === 'workspace-directory-entries') return {entries:[]};
        if (endpoint === 'workspace-files') return {text:state.files[params.path]};
        if (endpoint === 'read-file-binary') {
          const bytes = new TextEncoder().encode(state.files[params.path]);
          return {contentsBase64:btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')),mimeType:'text/plain'};
        }
        if (endpoint === 'workspace-file-save') {
          state.writes.push(structuredClone(params));
          if (state.files[params.path] !== params.expectedContents) return {outcome:'conflict'};
          state.files[params.path] = params.contents;
          if (state.mode === 'unknown-applied') throw new Error('synthetic disconnect after write');
          return {outcome:'saved'};
        }
        throw new Error('Unsupported synthetic endpoint: ' + endpoint);
      }, subscribe() { return () => {}; }};
      let props = {client, scopeId:'thread-a',hostId:'test-host',cwd:'/workspace',
        appearance:{theme:'dark',codeFontSize:18,codeLineHeight:27,codeFontFamily:'monospace'},
        request:{id:'initial',scopeId:'thread-a',hostId:'test-host',cwd:'/workspace',kind:'file',path:'a.ts',line:2,column:5},
        onRequestConsumed: id => state.consumed.push(id), onClose() {}};
      const root = createRoot(document.getElementById('root'));
      const active = () => EditorView.findFromDOM(document.querySelector('.yard-editor-container:not([hidden]) .cm-content'));
      window.panelFixture = { state,
        render(changes) { props = {...props,...changes}; root.render(React.createElement(WorkspacePanels,props)); },
        view: active,
        dark() { return active().state.facet(EditorView.darkTheme); },
        tree() { return syntaxTree(active().state).topNode.name; },
        dispatch(changes) { active().dispatch({changes}); },
        readonly() {
          const node = document.createElement('div'); node.className = 'yard-workspace-panels'; node.style.height='250px'; document.body.append(node);
          createRoot(node).render(React.createElement(CodeEditor, {path:'/readonly.txt',text:'read only',theme:'light',visible:true,readOnly:true,
            onChange() { state.readonlyChanges++; },onSave() {}}));
        },
      };
      root.render(React.createElement(WorkspacePanels,props));
    ` },
    bundle: true, write: false, format: 'iife', outdir: 'editor-fixture', loader: { '.css': 'css' },
  });
  const javascript = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'],
    env: { ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache') } });
  const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  let completed = false;
  t.after(async () => { await context.close(); await browser.close(); if (completed) await rm(root, { recursive: true, force: true }); });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setContent('<!doctype html><html><head></head><body style="margin:0"><div id="root" style="height:700px"></div></body></html>');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: javascript });
    const editor = page.getByRole('textbox', { name: 'File: /workspace/a.ts' });
    await editor.waitFor();
    await page.waitForFunction(() => Boolean((window as any).panelFixture.state.releaseLanguage));
    assert.equal(await page.evaluate(() => (window as any).panelFixture.view().state.selection.main.from), 'const a = 1;\nlet '.length);
    const appearance = await editor.evaluate(element => ({ size:getComputedStyle(element).fontSize, lineHeight:getComputedStyle(element).lineHeight,
      dark:(window as any).panelFixture.dark() }));
    assert.deepEqual(appearance, { size:'18px', lineHeight:'27px', dark:true });
    assert.ok(await page.locator('.cm-lineNumbers .cm-gutterElement').filter({hasText:'2'}).count());

    await page.evaluate(() => {
      const fixture = (window as any).panelFixture;
      const text = fixture.view().state.doc.toString();
      fixture.dispatch([{from:text.indexOf('a ='),to:text.indexOf('a =') + 1,insert:'alpha'},
        {from:text.indexOf('let'),to:text.indexOf('let') + 3,insert:'var'},
        {from:text.indexOf('// three') + 8,to:text.indexOf('// three') + 9,insert:''}]);
    });
    const edited = '\ufeffconst alpha = 1;\r\nvar b = 2;\n// threeconst c = 3;\r\n';
    await page.getByRole('button', { name:'Undo', exact:true }).click();
    assert.equal(await page.evaluate(() => (window as any).panelFixture.view().state.doc.toString()), original.slice(1).replace(/\r\n|\r/g, '\n'));
    await page.getByRole('button', { name:'Redo', exact:true }).click();
    await page.getByRole('button', { name:'Save file' }).click();
    await page.getByRole('alert').filter({hasText:'Save result is unknown'}).waitFor();
    assert.deepEqual(await page.evaluate(() => (window as any).panelFixture.state.writes[0]), {
      hostId:'test-host', cwd:'/workspace', path:'/workspace/a.ts', expectedContents:original, contents:edited,
    });
    await page.evaluate(() => (window as any).panelFixture.dispatch({from:0,insert:'// draft\n'}));
    await page.getByRole('button', { name:'Check save result' }).click();
    await page.getByRole('button', { name:'Check save result' }).waitFor({state:'detached'});
    assert.equal(await page.evaluate(() => (window as any).panelFixture.state.writes.length), 1);
    await page.evaluate(() => { (window as any).panelFixture.state.mode = 'saved'; });
    await page.getByRole('button', { name:'Save file' }).click();
    await page.waitForFunction(() => (document.querySelector('[aria-label="Save file"]') as HTMLButtonElement)?.disabled);
    assert.deepEqual(await page.evaluate(() => (window as any).panelFixture.state.writes[1]), {
      hostId:'test-host', cwd:'/workspace', path:'/workspace/a.ts', expectedContents:edited, contents:'\ufeff// draft\r\n' + edited.slice(1),
    });

    await editor.focus();
    await page.keyboard.press('Control+h');
    const find = page.getByRole('textbox', {name:'Find', exact:true});
    const replace = page.getByRole('textbox', {name:'Replace', exact:true});
    await find.fill('const'); await find.press('End');
    await replace.fill('let'); await replace.press('End');
    await page.getByRole('button', {name:'replace all', exact:true}).click();
    assert.equal((await page.evaluate(() => (window as any).panelFixture.view().state.doc.toString())).includes('const'), false);
    await find.focus(); await find.press('Control+h');
    assert.equal(await replace.evaluate(element => document.activeElement === element), true);
    await find.focus(); await find.press('Control+s');
    await page.waitForFunction(() => (window as any).panelFixture.state.writes.length === 3);
    assert.equal((await page.evaluate(() => (window as any).panelFixture.state.writes[2].contents)).includes('const'), false);
    await page.getByRole('button', {name:'close', exact:true}).click();
    await page.getByRole('button', {name:'Undo', exact:true}).click();
    assert.match(await page.evaluate(() => (window as any).panelFixture.view().state.doc.toString()), /const alpha/);

    await page.evaluate(() => (window as any).panelFixture.render({scopeId:'draft-b',request:{id:'json',scopeId:'draft-b',hostId:'test-host',cwd:'/workspace',kind:'file',path:'b.json'}}));
    await page.getByRole('textbox', {name:'File: /workspace/b.json'}).waitFor();
    await page.waitForFunction(() => (window as any).panelFixture.tree() === 'JsonText');
    await page.evaluate(() => (window as any).panelFixture.state.releaseLanguage());
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => (window as any).panelFixture.tree()), 'JsonText');
    await page.evaluate(() => (window as any).panelFixture.render({scopeId:'thread-a',request:null}));
    await editor.waitFor();
    await page.waitForFunction(() => (window as any).panelFixture.tree() === 'Script');
    const keywordColor = await editor.locator('span').filter({hasText:'const'}).first().evaluate(element => getComputedStyle(element).color);
    assert.equal(keywordColor, 'rgb(214, 165, 232)');
    await page.getByRole('button', {name:'Redo', exact:true}).click();
    assert.equal((await page.evaluate(() => (window as any).panelFixture.view().state.doc.toString())).includes('const'), false);

    await page.evaluate(() => (window as any).panelFixture.readonly());
    const readonly = page.getByRole('textbox', {name:'File: /readonly.txt'});
    await readonly.waitFor(); await readonly.focus(); await page.keyboard.type('changed');
    assert.equal(await page.evaluate(() => (window as any).panelFixture.state.readonlyChanges), 0);
    assert.equal(await readonly.getAttribute('contenteditable'), 'false');
    assert.deepEqual(errors, []);
    completed = true;
  } catch (error) {
    await page.screenshot({ path:join(root,'failure.png') }).catch(() => {});
    await writeFile(join(root,'errors.txt'), `${String(error)}\n${errors.join('\n')}`);
    throw new Error(`Editor browser failure artifacts: ${root}`, {cause:error});
  }
});
