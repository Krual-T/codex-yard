import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    userMessageHarness: {
      render: (host: string, path: string) => void;
      resolve: (host: string, path: string) => void;
      reject: (host: string, path: string) => void;
      reads: { endpoint: string; hostId: string; path: string; maxBytes: number }[];
    };
  }
}

test('standalone message images ignore late responses from previous hosts and paths', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Isolated Chrome is unavailable', timeout: 120_000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {MessageImage} from './src/renderer/messages/MessageImage.tsx';
      const pending = new Map(), reads = [];
      const client = {rpc:async () => {throw Error('Unexpected RPC');}, reply:async () => {}, subscribe:() => () => {},
        host:(endpoint, params) => {
          reads.push({endpoint,...params});
          return new Promise((resolve,reject) => pending.set(params.hostId + ':' + params.path,{resolve,reject}));
        }};
      const root = createRoot(document.getElementById('root'));
      const entry = (host,path) => {
        const key = host + ':' + path, item = pending.get(key);
        if (!item) throw Error('No pending image ' + key);
        pending.delete(key); return item;
      };
      window.userMessageHarness = {reads,
        render(host,path) {root.render(<MessageImage client={client} hostId={host} cwd="/work" fullSize
          source={{kind:'path',value:path,label:'Attachment'}}/>);},
        resolve(host,path) {entry(host,path).resolve({mimeType:'image/gif',contentsBase64:'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='});},
        reject(host,path) {entry(host,path).reject(Error('stale image failure'));},
      };
    ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic',
  });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });

    await page.evaluate(() => window.userMessageHarness.render('host-a', 'slow.gif'));
    await page.waitForFunction(() => window.userMessageHarness.reads.length === 1);
    await page.evaluate(() => window.userMessageHarness.render('host-b', 'fresh.gif'));
    await page.waitForFunction(() => window.userMessageHarness.reads.length === 2);
    assert.deepEqual(await page.evaluate(() => window.userMessageHarness.reads), [
      { endpoint: 'read-file-binary', hostId: 'host-a', path: '/work/slow.gif', maxBytes: 10 * 1024 * 1024 },
      { endpoint: 'read-file-binary', hostId: 'host-b', path: '/work/fresh.gif', maxBytes: 10 * 1024 * 1024 },
    ]);
    await page.evaluate(() => window.userMessageHarness.resolve('host-a', '/work/slow.gif'));
    assert.equal(await page.getByRole('img', { name: 'Attachment' }).count(), 0);
    assert.equal(await page.getByRole('status').textContent(), 'Loading image...');
    await page.evaluate(() => window.userMessageHarness.resolve('host-b', '/work/fresh.gif'));
    await page.getByRole('img', { name: 'Attachment' }).waitFor();

    await page.evaluate(() => window.userMessageHarness.render('host-c', 'older.gif'));
    await page.waitForFunction(() => window.userMessageHarness.reads.length === 3);
    await page.evaluate(() => window.userMessageHarness.render('host-d', 'current.gif'));
    await page.waitForFunction(() => window.userMessageHarness.reads.length === 4);
    await page.evaluate(() => window.userMessageHarness.resolve('host-d', '/work/current.gif'));
    await page.getByRole('img', { name: 'Attachment' }).waitFor();
    await page.evaluate(() => window.userMessageHarness.reject('host-c', '/work/older.gif'));
    assert.equal(await page.getByRole('img', { name: 'Attachment' }).count(), 1);
    assert.equal(await page.getByText('stale image failure').count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
