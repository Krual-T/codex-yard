import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    messageAttachmentHarness: {
      saved: () => { editor: { revision: number; removedAttachments: unknown[] }; draft: { input: Record<string, unknown>[] } } | null;
      edits: { draft: { input: Record<string, unknown>[]; images: unknown[] }; origin: unknown }[];
      show: (value: boolean) => void;
      editMode: (value: 'reject' | 'resolve') => void;
      corruptRecovery: () => void;
      restoreRecovery: () => void;
    };
  }
}

const chromePath = '/usr/bin/google-chrome';
const require = createRequire(import.meta.url);
const artifacts = process.env.YARD_MESSAGE_TEST_SCREENSHOTS;

test('attachment removal, undo and persisted recovery retain the untouched message input', {
  skip: !existsSync(chromePath) && 'An isolated headless browser is unavailable', timeout: 90_000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { StandaloneMessages } from './src/renderer/messages/StandaloneMessages.tsx';
      let saved = null, preserved = null, visible = true, mode = 'reject';
      const edits = [];
      const gif = 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
      const client = { rpc: async () => { throw Error('unexpected rpc'); }, host: async () => ({contentsBase64:gif,mimeType:'image/gif'}),
        subscribe: () => () => {}, reply: async () => { throw Error('unexpected approval'); } };
      const prefix = '# Files mentioned by the user:\\n\\n## Notes: /work/notes.md\\nLibrary file metadata: {"fileId":"f","libraryFileId":"l"}\\n'
        + '\\n## Keep: /work/keep.txt (line 3)\\n\\n## My request:\\n';
      const thread = {id:'thread',cwd:'/work',name:null,status:{type:'idle'},turns:[{id:'turn',status:'completed',itemsView:'full',items:[
        {id:'user',type:'userMessage',format:'markdown',hints:['search'],content:[
          {type:'text',text:prefix+'Review',text_elements:[]}, {type:'image',fileId:'opaque',detail:'high'},
          {type:'localImage',path:'/work/keep.png',detail:'low'}, {type:'mention',name:'project',path:'/work'}]}
      ]}]};
      const root = createRoot(document.getElementById('root'));
      const onEditDraftChange = async value => { saved = value && structuredClone(value); };
      const onEdit = async (draft,origin,prepare) => { await prepare(); edits.push({draft:structuredClone(draft),origin:structuredClone(origin)});
        if(mode === 'reject') throw Error('Synthetic send failure'); };
      function render(){root.render(visible ? React.createElement(StandaloneMessages,{client,hostId:'ssh',thread,editHistory:{order:'ascending',tailComplete:true},
        editRecovery:saved,onEditDraftChange,onEdit}) : null);}
      window.messageAttachmentHarness = {saved:()=>saved,edits,show(value){visible=value;render();},editMode(value){mode=value;},
        corruptRecovery(){preserved=structuredClone(saved);saved.editor.removedAttachments=[{kind:'image',inputIndex:1,future:'keep'}];},
        restoreRecovery(){saved=preserved;}};
      render();
    ` },
    bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' },
    plugins: [{ name: 'single-katex', setup(builder) { builder.onResolve({ filter: /^katex$/ }, () => ({ path: require.resolve('katex') })); } }],
  });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route('**/*', (route) => route.abort());
    await page.setContent('<div id="root" style="height:820px"></div>');
    await page.addStyleTag({ content: readFileSync(new URL('../src/renderer/messages/standalone-messages.css', import.meta.url), 'utf8').replace(/^@import[^;]+;/, '') });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const user = page.locator('[data-message-id="user"]');
    await user.getByRole('button', { name: 'Edit message' }).click();
    for (const theme of [
      { name:'dark', bg:'#181818', fg:'#ffffff', surface:'#212121', border:'#444444', muted:'#ababab', accent:'#339cff' },
      { name:'light', bg:'#ffffff', fg:'#1a1c1f', surface:'#f6f6f6', border:'#cccccc', muted:'#666666', accent:'#225fa1' },
    ]) {
      await page.evaluate((value) => {
        for (const key of ['bg', 'fg', 'surface', 'border', 'muted', 'accent'] as const) {
          document.documentElement.style.setProperty(`--yard-${key}`, value[key]);
        }
      }, theme);
      const input = user.getByRole('textbox', { name:'Edit message text' });
      assert.equal(await input.evaluate((element) => getComputedStyle(element).backgroundColor), theme.name === 'dark' ? 'rgb(24, 24, 24)' : 'rgb(255, 255, 255)');
      const bounds = await user.getByRole('button', { name:'Remove Notes' }).evaluate((button) => {
        const control = button.getBoundingClientRect();
        const label = button.parentElement!.firstElementChild!.getBoundingClientRect();
        return { right:control.right, left:control.left, labelRight:label.right, width:document.documentElement.clientWidth,
          pageWidth:document.documentElement.scrollWidth };
      });
      assert.ok(bounds.right <= bounds.width && bounds.labelRight <= bounds.left && bounds.pageWidth <= bounds.width);
      if (artifacts) await page.screenshot({ path: join(artifacts, `standalone-b-attachment-${theme.name}-390.png`) });
    }
    await user.getByRole('button', { name: 'Remove Notes' }).click();
    await user.getByRole('button', { name: 'Remove image 2' }).click();
    await page.waitForFunction(() => window.messageAttachmentHarness.saved()?.editor.removedAttachments.length === 2);
    assert.deepEqual((await page.evaluate(() => window.messageAttachmentHarness.saved()))?.editor.removedAttachments,
      [{kind:'file',inputIndex:0,fileIndex:0},{kind:'image',inputIndex:1}]);
    await user.getByRole('button', { name: 'Open keep.png' }).click();
    await page.getByRole('dialog', { name: 'Image preview' }).getByText('keep.png 1 / 1').waitFor();
    await page.getByRole('button', { name: 'Close image preview' }).click();
    await page.evaluate(() => window.messageAttachmentHarness.show(false));
    await page.locator('.yard-messages-root').waitFor({ state:'detached' });
    await page.evaluate(() => window.messageAttachmentHarness.show(true));
    await user.getByRole('button', { name: 'Restore Notes' }).waitFor();
    await user.getByRole('button', { name: 'Restore image 2' }).waitFor();
    await user.getByRole('button', { name: 'Restore Notes' }).click();
    await user.getByRole('button', { name: 'Remove Notes' }).click();
    await user.getByRole('textbox', { name: 'Edit message text' }).fill('Changed request');
    await user.getByRole('button', { name: 'Send', exact: true }).click();
    await user.getByText('Synthetic send failure').waitFor();
    assert.equal(await user.getByRole('textbox', { name: 'Edit message text' }).inputValue(), 'Changed request');
    const failed = (await page.evaluate(() => window.messageAttachmentHarness.edits)).at(-1)!;
    assert.deepEqual(failed.origin, {hostId:'ssh',threadId:'thread',turnId:'turn',itemId:'user',format:'markdown',hints:['search']});
    assert.deepEqual(failed.draft.input, [
      {type:'text',text:'# Files mentioned by the user:\n\n\n## Keep: /work/keep.txt (line 3)\n\n## My request:\nChanged request',text_elements:[]},
      {type:'localImage',path:'/work/keep.png',detail:'low'}, {type:'mention',name:'project',path:'/work'},
    ]);
    assert.equal(failed.draft.images.length, 1);
    await page.evaluate(() => { window.messageAttachmentHarness.show(false); window.messageAttachmentHarness.corruptRecovery(); });
    await page.locator('.yard-messages-root').waitFor({ state:'detached' });
    await page.evaluate(() => window.messageAttachmentHarness.show(true));
    await user.getByText('The saved attachment changes are unrecognized.', { exact: false }).waitFor();
    assert.equal(await user.getByRole('textbox', { name: 'Edit message text' }).isDisabled(), true);
    assert.equal(await user.getByRole('button', { name: 'Send', exact: true }).isDisabled(), true);
    assert.deepEqual((await page.evaluate(() => window.messageAttachmentHarness.saved()))?.editor.removedAttachments,
      [{kind:'image',inputIndex:1,future:'keep'}]);
    await page.evaluate(() => { window.messageAttachmentHarness.show(false); window.messageAttachmentHarness.restoreRecovery(); });
    await page.locator('.yard-messages-root').waitFor({ state:'detached' });
    await page.evaluate(() => window.messageAttachmentHarness.show(true));
    await user.getByRole('button', { name: 'Restore Notes' }).waitFor();
    await page.evaluate(() => window.messageAttachmentHarness.editMode('resolve'));
    await user.getByRole('button', { name: 'Send', exact: true }).click();
    await user.getByRole('button', { name: 'Edit message' }).waitFor();
    assert.equal(await page.evaluate(() => window.messageAttachmentHarness.saved()), null);
    await page.close();
  } finally { await browser.close(); }
});
