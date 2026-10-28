import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    petMotionHarness: { pending(): number; fired(): number; unmount(): void };
  }
}

test('PetSprite follows resolved app motion and system fallback, stops timers and stays on the first frame', {
  skip: !existsSync('/usr/bin/google-chrome') && 'An isolated headless browser is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { PetSprite } from './src/renderer/mini/PetSprite.tsx';
      const realSetTimeout = window.setTimeout.bind(window), realClearTimeout = window.clearTimeout.bind(window);
      const pending = new Set(); let fired = 0;
      window.setTimeout = (callback, delay, ...args) => {
        if (typeof callback !== 'function' || delay !== 120 && delay !== 220) return realSetTimeout(callback, delay, ...args);
        const timer = realSetTimeout(() => { pending.delete(timer); fired++; callback(...args); }, delay);
        pending.add(timer); return timer;
      };
      window.clearTimeout = timer => { pending.delete(timer); realClearTimeout(timer); };
      const root = createRoot(document.getElementById('root'));
      const pet = {id:'fixture',name:'Fixture',rows:11,src:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRaoAAAAASUVORK5CYII='};
      root.render(React.createElement(PetSprite,{pet,motion:'running'}));
      window.petMotionHarness = {pending:()=>pending.size,fired:()=>fired,unmount:()=>root.unmount()};
    ` },
    bundle: true, write: false, format: 'iife', jsx: 'automatic',
  });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 300 }, reducedMotion: 'no-preference' });
    await page.route('**/*', route => route.abort());
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<html data-reduced-motion="true"><body><div id="root" style="width:192px;height:208px"></div></body></html>');
    await page.addStyleTag({ content: readFileSync('src/renderer/mini/mini.css', 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const sprite = page.locator('[data-codex-pet-id="fixture"]');
    await sprite.waitFor();
    const firstFrame = await sprite.evaluate(el => (el as HTMLElement).style.backgroundPosition);
    assert.equal(firstFrame, '0% 70%');
    await page.waitForTimeout(350);
    assert.deepEqual(await page.evaluate(() => ({ pending: window.petMotionHarness.pending(), fired: window.petMotionHarness.fired() })), { pending: 0, fired: 0 });

    await page.evaluate(() => { document.documentElement.dataset.reducedMotion = 'false'; });
    await page.waitForFunction(() => window.petMotionHarness.pending() === 1);
    await page.waitForFunction(() => (document.querySelector('[data-codex-pet-id="fixture"]') as HTMLElement)?.style.backgroundPosition !== '0% 70%');
    await page.evaluate(() => { document.documentElement.dataset.reducedMotion = 'true'; });
    await page.waitForFunction(() => window.petMotionHarness.pending() === 0 &&
      (document.querySelector('[data-codex-pet-id="fixture"]') as HTMLElement)?.style.backgroundPosition === '0% 70%');
    const stoppedAt = await page.evaluate(() => window.petMotionHarness.fired());
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => window.petMotionHarness.fired()), stoppedAt);
    assert.equal(await sprite.evaluate(el => (el as HTMLElement).style.backgroundPosition), firstFrame);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const beforeOverride = await page.evaluate(() => window.petMotionHarness.fired());
    await page.evaluate(() => { document.documentElement.dataset.reducedMotion = 'false'; });
    await page.waitForFunction(() => window.petMotionHarness.pending() === 1);
    await page.waitForFunction(previous => window.petMotionHarness.fired() > previous, beforeOverride);
    await page.evaluate(() => { delete document.documentElement.dataset.reducedMotion; });
    await page.waitForFunction(() => window.petMotionHarness.pending() === 0 &&
      (document.querySelector('[data-codex-pet-id="fixture"]') as HTMLElement)?.style.backgroundPosition === '0% 70%');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForFunction(() => window.petMotionHarness.pending() === 1);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => window.petMotionHarness.pending() === 0 &&
      (document.querySelector('[data-codex-pet-id="fixture"]') as HTMLElement)?.style.backgroundPosition === '0% 70%');

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForFunction(() => window.petMotionHarness.pending() === 1);
    await page.evaluate(() => window.petMotionHarness.unmount());
    assert.equal(await page.evaluate(() => window.petMotionHarness.pending()), 0);
    await page.evaluate(() => { document.documentElement.dataset.reducedMotion = 'true'; });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.evaluate(() => window.petMotionHarness.pending()), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('PetSprite plays exactly three timed non-idle cycles, pauses while hidden and returns to idle', {
  skip: !existsSync('/usr/bin/google-chrome') && 'An isolated headless browser is unavailable', timeout: 60_000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { PetSprite } from './src/renderer/mini/PetSprite.tsx';
    const originalSet=window.setTimeout.bind(window),originalClear=window.clearTimeout.bind(window);
    const timers=new Map();let id=100000;
    window.setTimeout=(callback,delay,...args)=>{
      if(typeof callback!=='function'||![120,220,1680,660,840,1920].includes(delay))return originalSet(callback,delay,...args);
      const key=++id;timers.set(key,{callback,delay});return key;
    };
    window.clearTimeout=key=>{if(timers.has(key))timers.delete(key);else originalClear(key)};
    let visibility='visible';Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>visibility});
    const root=createRoot(document.getElementById('root'));
    root.render(React.createElement(PetSprite,{pet:{id:'fixture',name:'Fixture',rows:11,src:'data:image/png;base64,AA=='},motion:'running'}));
    window.petTimingHarness={pending:()=>Array.from(timers.values()).map(value=>value.delay),
      tick(){const [key,value]=timers.entries().next().value;timers.delete(key);value.callback()},
      hidden(value){visibility=value?'hidden':'visible';document.dispatchEvent(new Event('visibilitychange'))},
      dispose(){root.unmount()}};
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic' });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage({ reducedMotion: 'no-preference' });
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const sprite = page.locator('[data-codex-pet-id="fixture"]');
    await sprite.waitFor({ state: 'attached' });
    await page.waitForFunction(() => (window as any).petTimingHarness.pending().length === 1);
    const cycle = [120, 120, 120, 120, 120, 220];
    for (let step = 0; step < 18; step++) {
      assert.deepEqual(await page.evaluate(() => (window as any).petTimingHarness.pending()), [cycle[step % cycle.length]]);
      if (step === 7) {
        const position = await sprite.evaluate(el => (el as HTMLElement).style.backgroundPosition);
        await page.evaluate(() => (window as any).petTimingHarness.hidden(true));
        await page.waitForFunction(() => (window as any).petTimingHarness.pending().length === 0);
        assert.equal(await sprite.evaluate(el => (el as HTMLElement).style.backgroundPosition), position);
        await page.evaluate(() => (window as any).petTimingHarness.hidden(false));
        await page.waitForFunction(() => (window as any).petTimingHarness.pending().length === 1);
        assert.deepEqual(await page.evaluate(() => (window as any).petTimingHarness.pending()), [cycle[step % cycle.length]]);
      }
      await page.evaluate(() => (window as any).petTimingHarness.tick());
      const expectedMotion = step === 17 ? 'idle' : 'running';
      const expectedColumn = step === 17 ? 0 : (step + 1) % 6;
      await page.waitForFunction(({ expectedMotion, expectedColumn }) => {
        const element = document.querySelector<HTMLElement>('[data-codex-pet-id="fixture"]');
        return element?.dataset.codexPetState === expectedMotion && Math.abs(parseFloat(element.style.backgroundPosition) - expectedColumn / 7 * 100) < .001;
      }, { expectedMotion, expectedColumn });
    }
    assert.deepEqual(await page.evaluate(() => (window as any).petTimingHarness.pending()), [1680]);
    assert.equal(await sprite.getAttribute('data-codex-pet-state'), 'idle');
    await page.evaluate(() => (window as any).petTimingHarness.dispose());
    assert.deepEqual(await page.evaluate(() => (window as any).petTimingHarness.pending()), []);
  } finally { await browser.close(); }
});
