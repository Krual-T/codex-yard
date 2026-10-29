import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const chromePath = process.env.AGENTS_TEST_CHROMIUM || '/usr/bin/google-chrome';

test('History API failures release leave guards without committing or consuming a history index', { skip: !existsSync(chromePath) }, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import {createRouteNavigation} from './src/renderer/app/route-navigation.ts';
    let frozen=false, commits=0, outcomes=[], historyErrors=[], controller;
    const install=()=>controller=createRouteNavigation(()=>commits++, async()=>{frozen=true;return true},
      (committed,error)=>{frozen=false;outcomes.push({committed,error:error instanceof Error?error.message:null})},
      error=>historyErrors.push(error instanceof Error?error.message:String(error)));
    install();
    window.navigationHarness={
      navigate:(path,options)=>controller.navigate(path,options),
      replace:path=>controller.replaceCurrentURL(path),
      historyErrors:()=>historyErrors,
      state:()=>({frozen,commits,outcomes,index:history.state?.__yardIndex??null,path:location.pathname}),
      fail(method){const original=history[method].bind(history);history[method]=(...args)=>{history[method]=original;throw new DOMException('blocked '+method,'SecurityError')}},
      restart(blockInit=false){controller.dispose();history.replaceState(null,'','/settings/browser-use/downloads');frozen=false;commits=0;outcomes=[];
        if(blockInit)window.navigationHarness.fail('replaceState');install()},
    };
  ` }, bundle: true, write: false, format: 'iife' });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://yard-navigation.test/**', route => route.fulfill({ contentType: 'text/html', body: '<div>route fixture</div>' }));
    await page.goto('http://yard-navigation.test/local/thread-a');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const run = (body: string) => page.evaluate(body);
    await run("navigationHarness.fail('pushState')");
    assert.equal(await run("navigationHarness.navigate('/local/thread-b')"), false);
    assert.deepEqual(await run('navigationHarness.state()'), { frozen: false, commits: 0,
      outcomes: [{ committed: false, error: 'blocked pushState' }], index: 0, path: '/local/thread-a' });
    assert.equal(await run("navigationHarness.navigate('/local/thread-b')"), true);
    assert.equal((await run('navigationHarness.state()') as { index: number }).index, 1);
    await run("navigationHarness.fail('go')");
    assert.equal(await run("navigationHarness.navigate('/local/thread-a',{delta:-1})"), false);
    assert.equal((await run('navigationHarness.state()') as { frozen: boolean }).frozen, false);
    assert.equal(await run("navigationHarness.navigate('/local/thread-c')"), true);
    assert.equal((await run('navigationHarness.state()') as { index: number }).index, 2);
    await run('navigationHarness.restart()');
    assert.equal(await run("navigationHarness.navigate('/settings/browser-use',{delta:-1})"), true);
    assert.deepEqual(await run('navigationHarness.state()'), { frozen: false, commits: 1,
      outcomes: [{ committed: true, error: null }], index: 0, path: '/settings/browser-use' });
    await run("navigationHarness.fail('replaceState')");
    assert.equal(await run("navigationHarness.replace('/settings/browser-use?retained=1')"), false);
    assert.equal(await run('location.search'), '');
    assert.deepEqual(await run('navigationHarness.historyErrors()'), ['blocked replaceState']);
    await run('navigationHarness.restart(true)');
    assert.deepEqual(await run('navigationHarness.historyErrors()'), ['blocked replaceState', 'blocked replaceState']);
    assert.equal((await run('navigationHarness.state()') as { path: string }).path, '/settings/browser-use/downloads');
    assert.equal(await run("navigationHarness.replace('/settings/browser-use/downloads?recovered=1#retained')"), true);
    assert.equal(await run('history.state.__yardIndex'), 0);
    assert.equal(await run('history.state.__yardState'), null);
    assert.equal(await run('location.search + location.hash'), '?recovered=1#retained');
    assert.equal((await run('navigationHarness.state()') as { commits: number }).commits, 0);
    assert.equal(await run("navigationHarness.navigate('/local/recovered')"), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
