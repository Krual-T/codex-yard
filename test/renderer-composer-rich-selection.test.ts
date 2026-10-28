import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('rich editing uses the current DOM selection before queued selectionchange events', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
    import React, {useRef,useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {StandaloneRichEditor} from './src/renderer/composer/StandaloneRichEditor.tsx';
    const initial={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'First'}]},
      {type:'paragraph',content:[{type:'text',text:'Second'}]}]};
    function Fixture(){
      const [document,setDocument]=useState(initial), current=useRef(initial);
      window.fixture={snapshot:()=>current.current};
      return React.createElement(StandaloneRichEditor,{document,currentDocument:()=>current.current,ariaLabel:'Rich input',
        onChange:value=>{current.current=value;setDocument(value)},onKeyDown:()=>false,onImages:()=>{},onInvalid:()=>{},onCompletionContext:()=>{}});
    }
    createRoot(document.getElementById('root')).render(React.createElement(Fixture));
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }));
    await page.goto('http://localhost/');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const editor = page.getByRole('textbox', { name: 'Rich input' });
    await editor.focus();
    await editor.evaluate(element => {
      const first = element.querySelector('p')!.firstChild!;
      const range = document.createRange(); range.setStart(first, 0); range.collapse(true);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      const second = element.querySelectorAll('p')[1]!.firstChild!;
      range.setStart(second, second.textContent!.length); range.collapse(true);
      selection.removeAllRanges(); selection.addRange(range);
      const clipboard = new DataTransfer(); clipboard.setData('text/plain', 'paste'); clipboard.setData('text/html', '<strong>paste</strong>');
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }));
    });
    const paste = await editor.innerHTML();
    await page.reload();
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await editor.focus();
    await editor.evaluate(element => {
      const first = element.querySelector('p')!.firstChild!;
      const range = document.createRange(); range.selectNodeContents(first);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      const second = element.querySelectorAll('p')[1]!;
      range.selectNodeContents(second); range.collapse(false);
      selection.removeAllRanges(); selection.addRange(range);
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    });
    const entered = await editor.innerHTML();
    assert.match(paste, /^<p>First<\/p><p>Second<strong>paste<\/strong><\/p>$/, `paste selection: ${paste}; enter selection: ${entered}`);
    assert.equal(await editor.locator('p').first().innerText(), 'First');
    assert.equal(await editor.locator('p').count(), 3);
    assert.match(JSON.stringify(await page.evaluate(() => (window as any).fixture.snapshot())), /Second/);
    await page.reload();
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await editor.focus();
    await editor.evaluate(element => {
      const first = element.querySelector('p')!.firstChild!;
      const range = document.createRange(); range.selectNodeContents(first);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      range.selectNodeContents(element.querySelectorAll('p')[1]!);
      selection.removeAllRanges(); selection.addRange(range);
      const button = document.querySelector('button[aria-label="粗体"]') as HTMLButtonElement;
      button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      button.click();
    });
    assert.equal(await editor.locator('p').first().innerText(), 'First');
    assert.equal(await editor.locator('p').nth(1).locator('strong').innerText(), 'Second');
    await editor.press('Control+z');
    assert.equal(await editor.locator('strong').count(), 0);
    const imePrevented = await editor.evaluate(element => {
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      const event = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true, cancelable: true });
      element.dispatchEvent(event);
      element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      return event.defaultPrevented;
    });
    assert.equal(imePrevented, false);
    assert.equal(await editor.locator('p').count(), 2);
  } finally { await context.close(); await browser.close(); }
});
