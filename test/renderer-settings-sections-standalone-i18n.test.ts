import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createI18n } from '../src/renderer/i18n/format.ts';
import { hasTranslations, languageOptions, resolveLocale } from '../src/renderer/i18n/locale.ts';
import { messageKeys, simplifiedChinese, traditionalChinese } from '../src/renderer/i18n/messages.ts';
import * as otherMessages from '../src/renderer/i18n/other-messages.ts';
import { Preferences } from '../src/renderer/settings/preferences.ts';
import type { WorkbenchClient, WorkbenchEvent } from '../src/renderer/workbench-contract.ts';

test('locale resolution honors the override and the browser fallback without rewriting unknown values', () => {
  assert.equal(resolveLocale(null, ['fr-CA', 'en-US']), 'fr-CA');
  assert.equal(resolveLocale(undefined, ['', 'bad!', 'ja_JP']), 'ja-JP');
  assert.equal(resolveLocale('EN_gb', ['zh-CN']), 'en-GB');
  assert.equal(resolveLocale('zh-HK', ['en-US']), 'zh-HK');
  assert.equal(resolveLocale('zh-Hant', []), 'zh-CN');
  assert.equal(resolveLocale('pt', []), 'pt-BR');
  assert.equal(resolveLocale('tl', []), 'fil');
  assert.equal(resolveLocale('zz-ZZ', ['zh-CN']), 'zz-ZZ');
  assert.equal(resolveLocale('invalid!', ['zh-CN']), 'en-US');
  assert.equal(resolveLocale(null, []), 'en-US');
});

test('messages and dates use the same locale, with safe English fallback for missing translations', () => {
  const english = createI18n('en-US'), chinese = createI18n('zh-CN');
  const date = Date.UTC(2026, 0, 2);
  const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' };
  assert.equal(english.t('New chat'), 'New chat');
  assert.equal(chinese.t('New chat'), '新建对话');
  assert.equal(chinese.t('Message'), '输入消息');
  assert.equal(chinese.formatDate(date, options), new Intl.DateTimeFormat('zh-CN', options).format(date));
  assert.notEqual(chinese.formatDate(date, options), english.formatDate(date, options));
  assert.equal(chinese.formatRelative(-2, 'day', { numeric: 'always' }), new Intl.RelativeTimeFormat('zh-CN', { numeric: 'always' }).format(-2, 'day'));
  assert.equal(createI18n('it-IT').t('Settings'), 'Settings');
  assert.equal(createI18n('bad!').locale, 'en-US');
});

test('the advertised authored catalogs cover their current typed messages', () => {
  for (const catalog of [simplifiedChinese, traditionalChinese, ...Object.values(otherMessages)]) {
    assert.deepEqual(messageKeys.filter(key => !Object.hasOwn(catalog, key)), []);
  }
  assert.equal(languageOptions.length, 65);
  assert.equal(hasTranslations('it-IT'), false);
  assert.equal(hasTranslations('zh-HK'), true);
  for (const language of languageOptions) {
    const i18n = createI18n(language.value);
    assert.equal(i18n.locale, Intl.getCanonicalLocales(language.value)[0]);
    assert.ok(i18n.t('Message'));
  }
});

class FixtureClient implements WorkbenchClient {
  value: string | null = 'en-US';
  fail = false;
  private listeners = new Set<(event: WorkbenchEvent) => void>();
  subscribe(listener: (event: WorkbenchEvent) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  emit() { for (const listener of this.listeners) listener({ type: 'settings-changed', keys: ['localeOverride'] }); }
  async reply() { throw new Error('Unexpected approval'); }
  async rpc<T>(): Promise<T> { throw new Error('Unexpected RPC'); }
  async host<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    if (endpoint === 'get-settings') return { values: { localeOverride: this.value } } as T;
    if (endpoint === 'get-setting') return { value: params?.key === 'localeOverride' ? this.value : undefined } as T;
    if (endpoint === 'set-setting') {
      if (this.fail) throw new Error('offline');
      if (params?.key === 'localeOverride') this.value = params.value as string | null;
      this.emit();
      return { success: true } as T;
    }
    if (endpoint.startsWith('get-')) return { value: undefined } as T;
    throw new Error('Unexpected host request');
  }
}

test('failed language saves retain the edit and do not change the persisted locale', async () => {
  const client = new FixtureClient(), preferences = new Preferences(client);
  await preferences.load();
  preferences.edit('localeOverride', 'zh-CN'); client.fail = true;
  assert.equal(await preferences.saveOne('localeOverride'), false);
  assert.equal(preferences.getSnapshot().localeOverride.value, 'zh-CN');
  assert.equal(preferences.getSnapshot().localeOverride.saved, 'en-US');
  assert.equal(resolveLocale(preferences.getSnapshot().localeOverride.saved, []), 'en-US');
  assert.match(preferences.getSnapshot().localeOverride.error ?? '', /offline/);
  client.fail = false;
  assert.equal(await preferences.saveOne('localeOverride'), true);
  assert.equal(resolveLocale(preferences.getSnapshot().localeOverride.saved, []), 'zh-CN');
});

test('settings events refresh the authority while retaining a different unfinished language draft', async () => {
  const client = new FixtureClient(), preferences = new Preferences(client);
  const stop = preferences.start();
  await preferences.load();
  preferences.edit('localeOverride', 'ja-JP');
  client.value = 'zz-ZZ'; client.emit();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(preferences.getSnapshot().localeOverride.saved, 'zz-ZZ');
  assert.equal(preferences.getSnapshot().localeOverride.value, 'ja-JP');
  assert.equal(resolveLocale(preferences.getSnapshot().localeOverride.saved, ['en-US']), 'zz-ZZ');
  stop();
});
