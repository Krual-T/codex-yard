import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createI18n } from '../src/renderer/i18n/format.ts';
import { workspaceMessageKeys, workspaceMessagesFor } from '../src/renderer/i18n/workspace-messages.ts';

test('authored sidebar labels cover the supported catalogs and retain the requested date locale', () => {
  for (const locale of ['zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'es-ES', 'fr-FR', 'de-DE', 'pt-BR']) {
    const catalog = workspaceMessagesFor(locale);
    assert.deepEqual(workspaceMessageKeys.filter(key => !catalog[key]), [], locale);
    const i18n = createI18n(locale);
    assert.equal(i18n.formatDate(1_700_000_000_000, { dateStyle: 'medium', timeZone: 'UTC' }),
      new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(1_700_000_000_000));
  }
  assert.equal(createI18n('it-IT').t('Waiting for approval'), 'Waiting for approval');
});
