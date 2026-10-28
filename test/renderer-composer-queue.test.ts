import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const chromePath = '/usr/bin/google-chrome';

test('queue editing keeps the active draft, host, attachments and undo history coherent', {
  skip: !existsSync(chromePath) && 'Google Chrome is unavailable',
}, async () => {
  const bundle = await build({
    stdin: {
      contents: "import { runQueueFixture } from './test/renderer-composer-queue-fixture.ts'; window.runQueueFixture = runQueueFixture;",
      resolveDir: process.cwd(), loader: 'ts',
    },
    bundle: true, write: false, format: 'iife',
  });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.route('**/*', route => route.abort());
      await page.setContent('<main></main>');
      await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
      const result = await page.evaluate(() => (window as unknown as {
        runQueueFixture(): Promise<{
          race: object;
          suggestionRace: object;
          edited: {
            text: string; position: object; fields: Record<string, unknown>; shared: unknown[];
            draft: object; comments: unknown[]; suggestion: unknown; prior: unknown;
          };
          undone: object;
          redone: { text: string; editing: string; fields: Record<string, unknown> };
          submittedEditing: string | null;
          storedPastes: unknown;
          calls: unknown[][];
        }>;
      }).runQueueFixture());

      assert.deepEqual(result.race, { text: 'user changed prompt', editing: null, restored: 1, focused: false, fields: {} });
      assert.deepEqual(result.suggestionRace, { suggestion: { id: 'changed-suggestion' }, restored: 2 });
      assert.equal(result.edited.text, 'queued prompt');
      assert.deepEqual(result.edited.position, {
        messageId: 'queued-1', multiUserMessageSender: { id: 'sender' }, isImageEditFollowUp: true,
        turnTrigger: { kind: 'follow-up' }, previousMessageId: 'previous', nextMessageId: 'next',
        serverSubmission: { id: 'server' }, preserveSerializedContext: true, restoredPromptContext: { id: 'context' },
      });
      assert.deepEqual(result.edited.fields.fileAttachments, [{ path: '/project/ordinary.txt' }]);
      assert.deepEqual(result.edited.fields.pastedTextAttachments, [{
        characterCount: 81, file: { path: '/project/pasted.txt' }, hostId: 'ssh-host', preview: '',
      }]);
      assert.deepEqual(result.edited.fields.imageCommentDrafts, [{ id: 'old-image-comment' }]);
      assert.deepEqual(result.edited.fields.responseTextAnnotations, [{ text: 'selected', id: 'queued-1:response-annotation:0' }]);
      assert.deepEqual(result.edited.fields.mcpAppModelContextAttachments, [{ id: 'resolved-mcp' }]);
      assert.deepEqual(result.edited.shared, [{
        file: { path: '/project/shared.txt', sharedThread: { shareId: 'share-1' } }, hostId: 'ssh-host', handoffId: 'handoff-1',
      }]);
      assert.deepEqual(result.edited.draft, {
        usedDictation: true, worktreeRecovery: { id: 'recovery' }, messageThreadId: 'message-thread',
        artifactFollowupAttributions: { id: 'artifact' }, pullRequestChecks: [{ id: 'check' }],
      });
      assert.deepEqual(result.edited.comments, [{ id: 'existing' }, { id: 'new-comment' }]);
      assert.deepEqual(result.edited.suggestion, { id: 'queued-suggestion' });
      assert.deepEqual(result.edited.prior, { id: 'queued-prior' });
      assert.deepEqual(result.undone, {
        text: 'original prompt', editing: null, fields: {}, initialDraft: true, initialSuggestion: true, originalPrior: true,
      });
      assert.equal(result.redone.text, 'queued prompt');
      assert.equal(result.redone.editing, 'queued-1');
      assert.deepEqual(result.redone.fields, result.edited.fields);
      assert.equal(result.submittedEditing, null);
      assert.deepEqual(result.storedPastes, [
        { characterCount: 100, preview: 'uploaded', upload: { accountId: 'account', fileId: 'file', fileName: 'paste.txt' } },
        { characterCount: 110, preview: 'local', file: { path: '/saved-paste' }, hostId: 'ssh-host' },
      ]);
      assert.ok(result.calls.some(call => call[0] === 'track' && call[1] === 'original prompt' && call[2] === 'queued prompt'));
      assert.ok(result.calls.some(call => call[0] === 'cleanupDraft' && call[1] === 'ssh-host'));
      assert.ok(result.calls.some(call => call[0] === 'submittedMcp' && JSON.stringify(call[1]) === '[{"id":"submitted-mcp"}]'));
      assert.ok(result.calls.some(call => call[0] === 'start' && call[1] === true && call[2] === 'thread-1' && call[3] === 'ssh-host' && call[4] === 'queued-1'));
      assert.ok(result.calls.some(call => call[0] === 'analytics' && JSON.stringify(call[3]) === '{"turnId":"turn-1"}'));
      assert.ok(result.calls.some(call => call[0] === 'error' && call[1] === 'Error: reorder failed'));
      assert.equal(result.calls.filter(call => call[0] === 'cleanupQueue' && call[1] === 'ssh-host').length, 2);
      assert.ok(result.calls.some(call => call[0] === 'restore' && call[1] === 'queued-1'));
      assert.ok(result.calls.some(call => call[0] === 'clearHistory'));
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
});
