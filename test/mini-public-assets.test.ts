import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import { builtinPetAssets, builtinPets } from '../src/renderer/mini/model.ts';

const hashes: Record<string, string> = {
  codex: 'ac2990f24d55372411cebdc66a726e1fcbf5e80ec95378e2d25a6241abbedf88',
  dewey: 'f2be8f576ab9d6cf287dd3518f86670e98d0270a83d41015d1018ab3aef791be',
  fireball: 'c1447dba809eb642e58aa213da5920eb27764e0f1df34a5651db091a1f79cbf3',
  hoots: '62539958eb6ab2b23c6cb640c6ca9516a42a75e785203eee3eeff4d9c4581456',
  rocky: '81970d728fb0a024385298c47dd9128ee18e9eb9d1db84ccacd42edea9f3bd6a',
  seedy: '4cc6c9f4bc61882379472dfa7fa91ca128b90933b0ae3cda9fff3da91dc6d1f8',
  stacky: '7e1afd29221d3ac0de0bd7a528e9b49170910742e634cd666fa7ad16d7b2e7d2',
  bsod: 'b55c717298786dc56622c287d707d60e526fd7b32b39a60346871d6c6516b26d',
  'null-signal': 'a816f7488c187ffe8b7f5d58319deb6cfa591f98c219ef06cbaf10d1f9f330db',
};

test('public pet sprite files retain their reviewed source bytes without reading the vendor snapshot', () => {
  for (const pet of builtinPets) {
    const path = builtinPetAssets[pet.id];
    assert.ok(path.startsWith('/pets/'));
    const bytes = readFileSync(join(process.cwd(), 'public', path));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), hashes[pet.id], pet.id);
  }
});

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
