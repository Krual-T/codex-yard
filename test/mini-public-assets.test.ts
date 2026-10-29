import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import { builtinPetAssets } from '../src/renderer/mini/model.ts';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex } from './fake-codex.ts';

test('all public pet sprites decode in the browser and contain visible first frames', {
  skip: !existsSync('/usr/bin/google-chrome') && 'An isolated headless browser is unavailable', timeout: 60_000,
}, async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage();
    const assets = new Map(Object.values(builtinPetAssets).map(path => [path, readFileSync(join(process.cwd(), 'public', path))]));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://mini.test') return route.abort();
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' });
      const body = assets.get(url.pathname);
      return body ? route.fulfill({ contentType: 'image/webp', body }) : route.abort();
    });
    await page.goto('http://mini.test/');
    const decoded = await page.evaluate(async paths => Promise.all(paths.map(async path => {
      const image = new Image();
      image.src = path;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 192; canvas.height = 208;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0, 192, 208, 0, 0, 192, 208);
      const data = context.getImageData(0, 0, 192, 208).data;
      let visible = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i]) visible++;
      return { path, width: image.naturalWidth, height: image.naturalHeight, visible };
    })), Object.values(builtinPetAssets));
    for (const image of decoded) {
      assert.equal(image.width, 1536, image.path);
      assert.equal(image.height, 2288, image.path);
      assert.ok(image.visible > 0, image.path);
    }
  } finally { await browser.close(); }
});

test('the actual host serves and decodes the built-in pet URLs', {
  skip: !existsSync('/usr/bin/google-chrome') && 'An isolated headless browser is unavailable', timeout: 60_000,
}, async t => {
  if (!existsSync('.local/visualization-sandbox.js')) { t.skip('Run npm run build:host before testing the actual host'); return; }
  const root = await mkdtemp('/tmp/yard-mini-host-');
  const fake = await createFakeCodex(root);
  let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  t.after(async () => { await browser?.close(); await app?.close(); await fake.close(); await rm(root, { recursive:true, force:true }); });
  app = await createNativeWorkbench({ port:0, socketPath:fake.socketPath, codexHome:join(root,'codex'),
    dataDir:join(root,'data'), workspace:root, hostCatalog:{hosts:[],projects:[],assignments:{}} });
  const paths = Object.values(builtinPetAssets);
  const responses = await Promise.all(paths.map(path => fetch(app!.url + path)));
  await Promise.all(responses.map(response => response.arrayBuffer()));
  for (let index = 0; index < paths.length; index++) {
    assert.equal(responses[index]!.status, 200, paths[index]);
    assert.match(responses[index]!.headers.get('content-type') ?? '', /^image\/webp/);
  }
  browser = await chromium.launch({ executablePath:'/usr/bin/google-chrome', headless:true, args:['--no-sandbox','--disable-background-networking'] });
  const page = await browser.newPage();
  await page.goto(app.url);
  const dimensions = await page.evaluate(async paths => Promise.all(paths.map(async path => {
    const image = new Image(); image.src = path; await image.decode();
    return {path, width:image.naturalWidth, height:image.naturalHeight};
  })), paths);
  for (const image of dimensions) { assert.equal(image.width,1536,image.path); assert.equal(image.height,2288,image.path); }
});
