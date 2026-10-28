import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    approvalHarness: {
      show(method: string, params: Record<string, unknown>, useInputEscape?: boolean): void;
      failNext(): void;
      calls: { ref: { hostId: string; generation: string; id: number }; result?: unknown; unsupported?: boolean; inputEscape?: boolean }[];
    };
  }
}

test('approval dialog follows request modes and preserves failed input and request identity', {
  skip: !existsSync('/usr/bin/google-chrome') && 'An isolated headless browser is unavailable', timeout: 90_000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: [
      "import React from 'react';",
      "import { createRoot } from 'react-dom/client';",
      "import { ApprovalDialog } from './src/renderer/app/ApprovalDialog.tsx';",
      "const root = createRoot(document.getElementById('root'));",
      'const calls = [];',
      'let next = 0, fail = false;',
      'window.approvalHarness = {',
      '  calls,',
      '  failNext() { fail = true; },',
      '  show(method, params, useInputEscape) {',
      '    const id = ++next;',
      "    const ref = { hostId:'ssh-test', generation:'generation-' + id, id };",
      '    const request = { hostId:ref.hostId, id, ref, method, params };',
      '    root.render(React.createElement(ApprovalDialog, { key:ref.generation, request,',
      '      onRespond: async result => {',
      '        calls.push({ref, result:structuredClone(result)});',
      "        if (fail) { fail = false; throw Error('Synthetic reply failure'); }",
      '        root.render(null);',
      '      },',
      '      onUnsupported: async () => { calls.push({ref, unsupported:true}); root.render(null); },',
      '      onInputEscape: !useInputEscape ? undefined : async () => {',
      '        calls.push({ref, inputEscape:true});',
      "        if (fail) { fail = false; throw Error('Synthetic reply failure'); }",
      '        root.render(null);',
      '      }',
      '    }));',
      '  }',
      '};',
    ].join('\n') }, bundle: true, write: false, format: 'iife', jsx: 'automatic',
  });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route('**/*', (route) => route.abort());
    await page.setContent('<button id="outside">Outside</button><div id="root"></div>');
    await page.addStyleTag({ content: readFileSync(new URL('../src/renderer/app/app.css', import.meta.url), 'utf8')
      + ':root{--yard-bg:#181818;--yard-fg:#f5f5f5;--yard-panel:#222;--yard-border:#555;--yard-accent:#79aaff;--yard-danger:#ff9999}' });
    await page.locator('#outside').focus();
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const dialog = page.getByRole('dialog');
    const calls = () => page.evaluate(() => window.approvalHarness.calls);

    await page.evaluate(() => window.approvalHarness.show('mcpServer/elicitation/request',
      { mode:'url', serverName:'fixture', message:'Verify access', elicitationId:'e1', url:'https://example.test/verify' }));
    const link = dialog.getByRole('link', { name:'https://example.test/verify' });
    await link.waitFor();
    assert.equal(await link.getAttribute('href'), 'https://example.test/verify');
    assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
    assert.equal(await link.evaluate((element) => document.activeElement === element), true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await dialog.getByRole('button', { name:'Continue' }).evaluate((element) => document.activeElement === element), true);
    await page.evaluate(() => document.getElementById('outside')!.focus());
    assert.equal(await link.evaluate((element) => document.activeElement === element), true);
    await page.evaluate(() => window.approvalHarness.failNext());
    await dialog.getByRole('button', { name:'Continue' }).click();
    await dialog.getByText('Synthetic reply failure').waitFor();
    assert.equal(await link.count(), 1);
    await dialog.getByRole('button', { name:'Continue' }).click();
    await dialog.waitFor({ state:'detached' });
    assert.equal(await page.locator('#outside').evaluate((element) => document.activeElement === element), true);
    assert.deepEqual((await calls()).slice(0, 2), [
      { ref:{hostId:'ssh-test',generation:'generation-1',id:1}, result:{action:'accept',content:null,_meta:null} },
      { ref:{hostId:'ssh-test',generation:'generation-1',id:1}, result:{action:'accept',content:null,_meta:null} },
    ]);

    await page.evaluate(() => window.approvalHarness.show('mcpServer/elicitation/request',
      { mode:'url', elicitationId:'e2', url:'javascript:alert(1)', message:'Untrusted URL' }));
    await dialog.getByText('This URL request cannot be opened safely.').waitFor();
    assert.equal(await dialog.getByRole('link').count(), 0);
    assert.equal(await dialog.getByRole('button', { name:'Continue' }).count(), 0);
    await dialog.getByRole('button', { name:'Decline' }).click();
    await dialog.waitFor({ state:'detached' });
    assert.deepEqual((await calls()).at(-1)?.result, {action:'decline',content:null,_meta:null});

    await page.evaluate(() => window.approvalHarness.show('mcpServer/elicitation/request', { mode:'form', message:'Form',
      requestedSchema:{type:'object',required:['name','age','confirm','plan','tags'],properties:{
        name:{type:'string',title:'Name',minLength:2}, age:{type:'integer',title:'Age',minimum:1,maximum:10},
        confirm:{type:'boolean',title:'Confirm'}, plan:{type:'string',title:'Plan',oneOf:[{const:'team',title:'Team'},{const:'solo',title:'Solo'}]},
        tags:{type:'array',title:'Tags',items:{type:'string',enum:['Alpha','Beta']},minItems:1,maxItems:1}
      }} }));
    await dialog.getByRole('button', { name:'Submit' }).click();
    await dialog.getByText('Correct the fields below before submitting.').waitFor();
    assert.equal((await calls()).length, 3);
    await dialog.getByLabel('Name (required)').fill('Ada');
    await dialog.getByLabel('Age (required)').fill('11');
    await dialog.getByLabel('Confirm (required)').selectOption('false');
    await dialog.getByLabel('Plan (required)').selectOption('team');
    await dialog.getByLabel('Alpha').check();
    const bounds = await dialog.evaluate((element) => ({ width:element.clientWidth, scrollWidth:element.scrollWidth }));
    assert.ok(bounds.scrollWidth <= bounds.width);
    if (process.env.YARD_APPROVAL_TEST_SCREENSHOTS) {
      await page.screenshot({ path: join(process.env.YARD_APPROVAL_TEST_SCREENSHOTS, 'standalone-b-approval-form-390.png') });
    }
    await dialog.getByRole('button', { name:'Submit' }).click();
    await dialog.getByText('Maximum is 10.').waitFor();
    await dialog.getByLabel('Age (required)').fill('4');
    await page.evaluate(() => window.approvalHarness.failNext());
    await dialog.getByRole('button', { name:'Submit' }).click();
    await dialog.getByText('Synthetic reply failure').waitFor();
    assert.equal(await dialog.getByLabel('Name (required)').inputValue(), 'Ada');
    assert.equal(await dialog.getByLabel('Alpha').isChecked(), true);
    await dialog.getByRole('button', { name:'Submit' }).click();
    await dialog.waitFor({ state:'detached' });
    assert.deepEqual((await calls()).at(-1), { ref:{hostId:'ssh-test',generation:'generation-3',id:3},
      result:{action:'accept',content:{name:'Ada',age:4,confirm:false,plan:'team',tags:['Alpha']},_meta:null} });

    await page.evaluate(() => window.approvalHarness.show('mcpServer/elicitation/request', { mode:'form',
      requestedSchema:JSON.parse('{"type":"object","required":["constructor","__proto__"],"properties":{"constructor":{"type":"string"},"__proto__":{"type":"string"}}}') }));
    await dialog.getByRole('button', { name:'Submit' }).click();
    await dialog.getByText('Correct the fields below before submitting.').waitFor();
    await dialog.getByLabel('constructor (required)').fill('first');
    await dialog.getByLabel('__proto__ (required)').fill('second');
    await dialog.getByRole('button', { name:'Submit' }).click();
    await dialog.waitFor({ state:'detached' });
    const specialResult = await page.evaluate(() => JSON.stringify(window.approvalHarness.calls.at(-1)?.result));
    assert.deepEqual(JSON.parse(specialResult), JSON.parse('{"action":"accept","content":{"constructor":"first","__proto__":"second"},"_meta":null}'));

    await page.evaluate(() => window.approvalHarness.show('mcpServer/elicitation/request',
      { mode:'openai/form', requestedSchema:{type:'object',properties:{}}, message:'Unknown form' }));
    await dialog.getByText('This elicitation mode is not supported.').waitFor();
    assert.equal(await dialog.getByRole('button', { name:'Submit' }).count(), 0);
    await dialog.getByRole('button', { name:'Cancel' }).click();
    await dialog.waitFor({ state:'detached' });
    assert.deepEqual((await calls()).at(-1)?.result, {action:'cancel',content:null,_meta:null});

    await page.evaluate(() => window.approvalHarness.show('mcpServer/elicitation/request',
      { mode:'form', requestedSchema:{type:'object',properties:{name:{type:'string',pattern:'^a'}}} }));
    await dialog.getByText('Unsupported or invalid schema for field: name').waitFor();
    assert.equal(await dialog.getByRole('button', { name:'Submit' }).count(), 0);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state:'detached' });
    assert.deepEqual((await calls()).at(-1)?.result, {action:'cancel',content:null,_meta:null});

    const amendment = {acceptWithExecpolicyAmendment:{execpolicy_amendment:['git','status']}};
    await page.evaluate((decision) => window.approvalHarness.show('item/commandExecution/requestApproval', {
      command:'git status', availableDecisions:[decision, {applyNetworkPolicyAmendment:{network_policy_amendment:{host:'example.test',action:'deny'}}}, 'cancel'],
    }), amendment);
    await dialog.getByRole('button', { name:'Approve and save command rule' }).waitFor();
    assert.equal(await dialog.getByRole('button', { name:'Approve', exact:true }).count(), 0);
    assert.equal(await dialog.getByRole('button', { name:'Decline' }).count(), 0);
    await dialog.getByRole('button', { name:'Approve and save command rule' }).click();
    await dialog.waitFor({ state:'detached' });
    assert.deepEqual((await calls()).at(-1)?.result, {decision:amendment});

    const networkDecision = {applyNetworkPolicyAmendment:{network_policy_amendment:{host:'example.test',action:'deny'}}};
    await page.evaluate((decision) => window.approvalHarness.show('item/commandExecution/requestApproval',
      { availableDecisions:[decision] }), networkDecision);
    await dialog.getByRole('button', { name:'Deny network for example.test' }).click();
    await dialog.waitFor({ state:'detached' });
    assert.deepEqual((await calls()).at(-1)?.result, {decision:networkDecision});

    await page.evaluate(() => window.approvalHarness.show('item/commandExecution/requestApproval',
      { availableDecisions:['decline'] }));
    await dialog.getByRole('button', { name:'Decline' }).waitFor();
    const beforeEscape = (await calls()).length;
    await page.keyboard.press('Escape');
    assert.equal((await calls()).length, beforeEscape);
    await dialog.getByRole('button', { name:'Decline' }).click();
    await dialog.waitFor({ state:'detached' });
    assert.deepEqual((await calls()).at(-1)?.result, {decision:'decline'});

    await page.evaluate(() => window.approvalHarness.show('item/commandExecution/requestApproval',
      { availableDecisions:[{futureDecision:{}}] }));
    await dialog.getByText('Some approval decisions cannot be represented safely.').waitFor();
    await dialog.getByRole('button', { name:'Dismiss request' }).click();
    await dialog.waitFor({ state:'detached' });
    assert.equal((await calls()).at(-1)?.unsupported, true);

    await page.evaluate(() => window.approvalHarness.show('item/permissions/requestApproval',
      { permissions:{network:null,fileSystem:{read:['/work'],write:null}} }));
    await dialog.getByRole('button', { name:'Approve' }).click();
    await dialog.waitFor({ state:'detached' });
    assert.deepEqual((await calls()).at(-1)?.result, {permissions:{fileSystem:{read:['/work'],write:null}},scope:'turn'});

    await page.evaluate(() => window.approvalHarness.show('item/tool/requestUserInput',
      { questions:[{id:'answer',header:'Question',question:'Select or answer',isSecret:true,isOther:true,
        options:[{label:'Option A',description:'First'}]}] }));
    await dialog.getByLabel('Option A').check();
    assert.equal(await dialog.getByLabel('Select or answer').getAttribute('type'), 'password');
    await dialog.getByRole('button', { name:'Submit' }).click();
    await dialog.waitFor({ state:'detached' });
    assert.deepEqual((await calls()).at(-1)?.result, {answers:{answer:{answers:['Option A']}}});

    await page.evaluate(() => window.approvalHarness.show('item/tool/requestUserInput', { questions:[
      {id:'choice',header:'Restricted',question:'Pick one',isOther:false,isSecret:false,options:[{label:'  Only option  '}]},
      {id:'free',header:'Free',question:'Optional response',isOther:false,isSecret:false,options:null},
      {id:'skip',header:'Skip',question:'Skip this',isOther:true,isSecret:false,options:[{label:'Unused'}]}
    ] }));
    assert.equal(await dialog.getByRole('textbox', { name:'Pick one' }).count(), 0);
    await dialog.getByLabel('Only option').check();
    await dialog.getByLabel('Optional response').fill('  Custom answer  ');
    await dialog.getByRole('button', { name:'Submit' }).click();
    await dialog.waitFor({ state:'detached' });
    assert.deepEqual((await calls()).at(-1)?.result, {answers:{choice:{answers:['Only option']},free:{answers:['Custom answer']}}});

    await page.evaluate(() => window.approvalHarness.show('item/tool/requestUserInput',
      {questions:[{id:'escape',header:'Question',question:'Preserve this',isOther:false,isSecret:false,options:null}]}, true));
    await dialog.getByLabel('Preserve this').fill('Draft answer');
    const beforeComposingEscape = (await calls()).length;
    await dialog.getByLabel('Preserve this').evaluate((element) => element.dispatchEvent(
      new KeyboardEvent('keydown', { key:'Escape', isComposing:true, bubbles:true })));
    assert.equal((await calls()).length, beforeComposingEscape);
    await page.evaluate(() => window.approvalHarness.failNext());
    await page.keyboard.press('Escape');
    await dialog.getByText('Synthetic reply failure').waitFor();
    assert.equal(await dialog.getByLabel('Preserve this').inputValue(), 'Draft answer');
    const failedEscape = (await calls()).at(-1);
    assert.equal(failedEscape?.inputEscape, true);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state:'detached' });
    assert.deepEqual((await calls()).at(-1), failedEscape);

    await page.evaluate(() => window.approvalHarness.show('execCommandApproval', {command:['echo','fixture']}));
    await dialog.getByRole('button', { name:'Decline' }).click();
    await dialog.waitFor({ state:'detached' });
    assert.deepEqual((await calls()).at(-1)?.result, {decision:{denied:{rejection:'Declined by user.'}}});
    await page.close();
  } finally { await browser.close(); }
});
