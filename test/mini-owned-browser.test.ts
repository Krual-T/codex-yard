import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    miniHarness: {
      calls: { messages: Record<string, unknown>[]; settings: Record<string, unknown>[]; replies: unknown[]; opened: unknown[]; expanded: number };
      setting(key: string, value: unknown): void;
      resolveSettings(): void;
      visibility(value: string): void;
      remount(): void;
      listeners(): number;
      failNextSetting(): void;
    };
  }
}

test('owned Mini uses the host and parent projection across interactions and remounts', {
  skip: !existsSync('/usr/bin/google-chrome') && 'An isolated headless browser is unavailable', timeout: 90_000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { StandaloneMini } from './src/renderer/mini/index.tsx';
      const canvas = document.createElement('canvas'); canvas.width = 1536; canvas.height = 2288;
      const drawing = canvas.getContext('2d'); drawing.fillStyle = '#5c88b0'; drawing.fillRect(0, 0, canvas.width, canvas.height);
      drawing.fillStyle = '#eac86c'; drawing.fillRect(35, 25, 110, 140); const sprite = canvas.toDataURL('image/png');
      const calls = { messages: [], settings: [], replies: [], opened: [], expanded: 0 };
      const listeners = new Set();
      let state = {isOpen:true, visibility:'always-visible', position:null};
      const settings = {'selected-avatar-id':'codex', 'avatar-overlay-mascot-width-px':112, 'avatar-overlay-pet-visible':true};
      const oldSettings = {...settings};
      let resolveSettings, firstRead = true, failSetting = false, draft = '';
      const heldSettings = new Promise(resolve => { resolveSettings = resolve; });
      const emit = event => { for (const listener of [...listeners]) listener(event); };
      const client = { rpc: async () => { throw Error('Unexpected RPC'); },
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
        host: async (endpoint, params = {}) => {
          if (endpoint === 'get-settings') { if (firstRead) { firstRead = false; return heldSettings; } return {values:{...settings}}; }
          if (endpoint === 'custom-avatars') return {avatars:[{id:'custom:legacy',displayName:'Legacy',spriteVersionNumber:1,spritesheetDataUrl:sprite}]};
          if (endpoint === 'set-setting') { calls.settings.push({...params}); if (failSetting) {failSetting = false; throw Error('disk full');}
            settings[params.key] = params.value; emit({type:'workbench-mini-setting',key:params.key,value:params.value}); return {success:true}; }
          throw Error('Unexpected host endpoint ' + endpoint);
        }, reply: async (ref, response) => { calls.replies.push({ref,response}); if (ref.id === 'unknown') throw Error('connection lost'); }
      };
      const send = async message => { calls.messages.push(message);
        if (message.type === 'avatar-overlay-open') state = {...state,isOpen:!state.isOpen};
        if (message.type === 'avatar-overlay-close' || message.type === 'avatar-overlay-hide') state = {...state,isOpen:false};
        if (message.type === 'workbench-pet-position') state = {...state,position:message.position};
        emit({type:'workbench-pet-state',state});
      };
      const activities = [
        {hostId:'ssh-a',threadId:'same-id',title:'Remote task',status:'waiting',detail:'Approval requested',
          approval:{requestRef:{hostId:'ssh-a',generation:'g1',id:'approval'},title:'Run command?',detail:'printf fixture',choices:[{label:'Deny',result:{decision:'decline'}}]}},
        {hostId:'local',threadId:'same-id',title:'Local task',status:'running',
          approval:{requestRef:{hostId:'local',generation:'g2',id:'unknown'},title:'Unknown result',choices:[{label:'Accept',result:{decision:'accept'}}]}}
      ];
      const hostConnections = {local:{state:'connected',fresh:true,revision:'local-1',requestGeneration:'g2'},'ssh-a':{state:'connected',fresh:true,revision:'remote-1',requestGeneration:'g1'}};
      let root;
      function render() { root.render(React.createElement(StandaloneMini, {client,send,activities,hostConnections,quickChatHostId:'local',builtinAssets:{codex:sprite,hoots:sprite},
        onOpenThread: identity => calls.opened.push(identity), onExpand: () => calls.expanded++, onOpenSettings: () => {},
        onApprovalOutcome: (ref,outcome) => { const item=activities.find(item=>item.approval.requestRef.id===ref.id); item.approval.outcome=outcome; render(); }},
        React.createElement('textarea',{ 'aria-label':'Fixture draft',value:draft,onChange:event=>{draft=event.target.value;render();} })) ); }
      function mount() {root=createRoot(document.getElementById('root')); render();}
      window.miniHarness = { calls, setting(key,value) { settings[key]=value;emit({type:'workbench-mini-setting',key,value}); },
        resolveSettings() { resolveSettings({values:oldSettings}); }, visibility(value) {state={...state,visibility:value};emit({type:'workbench-pet-state',state});},
        remount() {root.unmount();mount();}, listeners() {return listeners.size;}, failNextSetting() {failSetting=true;} };
      mount();
    ` },
    bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' },
  });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    await page.route('**/*', route => route.abort());
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<button id="under" aria-label="Underlying control" style="position:fixed;width:20px;height:20px"></button><div id="root"></div>');
    await page.addStyleTag({ content: readFileSync(new URL('../src/renderer/mini/mini.css', import.meta.url), 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.getByText('Remote task').waitFor();
    await page.evaluate(() => { window.miniHarness.setting('selected-avatar-id', 'custom:legacy'); window.miniHarness.resolveSettings(); });
    await page.locator('[data-codex-pet-id="custom:legacy"]').waitFor();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('[data-codex-pet-id="custom:legacy"]').count(), 1, 'a late settings read must not replace a newer event');
    assert.equal(await page.evaluate(() => window.miniHarness.listeners()), 1);
    await page.getByRole('button', { name: /Remote task/ }).click();
    assert.deepEqual(await page.evaluate(() => window.miniHarness.calls.opened), [{ hostId: 'ssh-a', threadId: 'same-id' }]);
    await page.getByRole('button', { name: 'Deny' }).click();
    assert.deepEqual((await page.evaluate(() => window.miniHarness.calls.replies))[0],
      { ref: { hostId: 'ssh-a', generation: 'g1', id: 'approval' }, response: { result: { decision: 'decline' } } });
    await page.getByRole('button', { name: 'Accept' }).click();
    await page.getByRole('alert').filter({ hasText: 'could not be confirmed' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Accept' }).isDisabled(), true);
    assert.equal((await page.evaluate(() => window.miniHarness.calls.replies)).length, 2);

    await page.getByRole('button', { name: 'Quick chat', exact: true }).click();
    await page.getByRole('textbox', { name: 'Fixture draft' }).fill('kept by parent');
    await page.getByRole('button', { name: 'Quick chat', exact: true }).click();
    await page.getByRole('button', { name: 'Quick chat', exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: 'Fixture draft' }).inputValue(), 'kept by parent');
    await page.getByRole('button', { name: 'Quick chat', exact: true }).click();
    await page.getByRole('button', { name: 'Mini menu' }).click();
    await page.getByRole('menuitem', { name: 'Choose pet' }).click();
    await page.evaluate(() => window.miniHarness.failNextSetting());
    await page.getByRole('button', { name: 'Hoots' }).click();
    await page.getByRole('alert').filter({ hasText: 'Pet selection could not be saved' }).waitFor();
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByRole('button', { name: 'Hoots' }).click();
    await page.locator('[data-codex-pet-id="hoots"]').waitFor();
    assert.equal((await page.evaluate(() => window.miniHarness.calls.settings)).at(-1)?.value, 'hoots');

    await page.getByRole('button', { name: 'Mini menu' }).click();
    await page.getByRole('menuitem', { name: 'Choose pet' }).click();
    const slider = page.getByRole('slider', { name: 'Size' });
    await slider.focus(); await slider.press('End');
    await page.waitForFunction(() => window.miniHarness.calls.settings.some(value => value.key === 'avatar-overlay-mascot-width-px' && value.value === 224));
    assert.equal(await slider.inputValue(), '224');
    await page.getByRole('button', { name: 'Close pet picker' }).click();

    await page.evaluate(() => {
      const rect = document.querySelector('[data-workbench-mini]')!.getBoundingClientRect();
      const under = document.getElementById('under')!;
      under.style.left = `${rect.left + 2}px`; under.style.top = `${rect.top + 2}px`;
    });
    await page.getByRole('button', { name: 'Underlying control' }).click();
    assert.equal(await page.locator('[data-workbench-mini]').count(), 1);
    const mascot = page.getByTestId('avatar-mascot-button');
    const bounds = await mascot.boundingBox(); assert.ok(bounds);
    const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 180, y - 70, { steps: 5 }); await page.mouse.up();
    await page.waitForFunction(() => window.miniHarness.calls.messages.some(value => value.type === 'workbench-pet-position'));
    assert.equal(await page.evaluate(() => window.miniHarness.calls.expanded), 0, 'drag must not open the main window');
    const positionBefore = await page.locator('[data-workbench-mini]').boundingBox();
    await mascot.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Choose pet' }).waitFor();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.getByRole('menuitem', { name: 'Mini settings' }).evaluate(element => document.activeElement === element), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('menu').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Mini menu' }).evaluate(element => document.activeElement === element), true);
    await page.evaluate(() => window.miniHarness.remount());
    await page.locator('[data-codex-pet-id="hoots"]').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Accept' }).isDisabled(), true);
    const positionAfter = await page.locator('[data-workbench-mini]').boundingBox();
    assert.ok(positionBefore && positionAfter && Math.abs(positionBefore.x - positionAfter.x) < 1 && Math.abs(positionBefore.y - positionAfter.y) < 1);
    assert.equal(await page.evaluate(() => window.miniHarness.listeners()), 1);

    await page.evaluate(() => window.miniHarness.setting('selected-avatar-id', 'custom:unknown'));
    await page.getByTestId('avatar-mascot-button').getByText('custom:unknown').waitFor();
    assert.equal((await page.evaluate(() => window.miniHarness.calls.settings)).some(value => value.value === 'custom:unknown'), false);
    await page.evaluate(() => window.miniHarness.setting('selected-avatar-id', 'hoots'));
    await page.setViewportSize({ width: 360, height: 640 });
    await page.waitForFunction(() => { const r = document.querySelector('[data-workbench-mini]')?.getBoundingClientRect(); return r && r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; });
    const narrow = await page.locator('[data-workbench-mini]').boundingBox();
    assert.ok(narrow && narrow.x >= 0 && narrow.y >= 0 && narrow.x + narrow.width <= 360 && narrow.y + narrow.height <= 640);
    if (process.env.MINI_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.MINI_EVIDENCE_DIR, 'mini-mobile.png') });
    await page.setViewportSize({ width: 1100, height: 800 });
    if (process.env.MINI_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.MINI_EVIDENCE_DIR, 'mini-desktop.png') });

    await page.evaluate(() => window.miniHarness.visibility('on-demand'));
    await page.evaluate(() => { const under = document.getElementById('under')!; under.style.left = '2px'; under.style.top = '2px'; });
    await page.getByRole('button', { name: 'Underlying control' }).click();
    await page.locator('[data-workbench-mini]').waitFor({ state: 'detached' });
    assert.ok((await page.evaluate(() => window.miniHarness.calls.messages)).some(value => value.type === 'avatar-overlay-hide'));
    await page.keyboard.press('Meta+Alt+p');
    await page.locator('[data-workbench-mini]').waitFor();
    await page.getByRole('button', { name: 'Mini menu' }).click();
    await page.getByRole('menuitem', { name: 'Hide Mini' }).click();
    await page.locator('[data-workbench-mini]').waitFor({ state: 'detached' });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
