import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { transform } from 'esbuild';
import { rendererRoot } from '../lib/app-resources.ts';
import { adaptNotificationSettings } from '../src/native/notification-renderer.ts';

test('Notification settings compile against the pinned renderer and reject a changed version boundary', async () => {
  const path = '/assets/notifications-settings-ccf8e20eaab9.js';
  const original = await readFile(join(rendererRoot, path));
  const adapted = adaptNotificationSettings(path, original);
  assert.notDeepEqual(adapted, original);
  await transform(adapted.toString('utf8'), { loader: 'js' });
  assert.throws(() => adaptNotificationSettings(path, Buffer.from('changed upstream module')), /固定界面版本不匹配/);
});
