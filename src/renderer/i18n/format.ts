import { messageKeys, simplifiedChinese, traditionalChinese } from './messages.ts';
import type { MessageKey, Messages } from './messages.ts';
import { french, german, japanese, korean, portuguese, spanish } from './other-messages.ts';
import { workspaceMessageKeys, workspaceMessagesFor } from './workspace-messages.ts';

export interface I18n {
  locale: string;
  t(key: MessageKey): string;
  formatDate(value: Date | number, options?: Intl.DateTimeFormatOptions): string;
  formatRelative(value: number, unit: Intl.RelativeTimeFormatUnit, options?: Intl.RelativeTimeFormatOptions): string;
}

function messagesFor(locale: string): Messages {
  const language = locale.toLowerCase().split('-')[0];
  if (language === 'zh') return /(?:^|-)(?:tw|hk|mo|hant)(?:-|$)/i.test(locale) ? traditionalChinese : simplifiedChinese;
  return ({ ja: japanese, ko: korean, es: spanish, fr: french, de: german, pt: portuguese } as Record<string, Messages>)[language!] ?? {};
}

export function createI18n(locale: string): I18n {
  let safeLocale: string;
  try { safeLocale = Intl.getCanonicalLocales(locale)[0] ?? 'en-US'; } catch { safeLocale = 'en-US'; }
  const messages = { ...messagesFor(safeLocale), ...workspaceMessagesFor(safeLocale) };
  return {
    locale: safeLocale,
    t: key => messages[key] ?? key,
    formatDate: (value, options) => new Intl.DateTimeFormat(safeLocale, options).format(value),
    formatRelative: (value, unit, options) => new Intl.RelativeTimeFormat(safeLocale, options).format(value, unit),
  };
}

const knownMessages = new Set<string>([...messageKeys, ...workspaceMessageKeys]);
export function translateKnown(t: I18n['t'], value: string): string {
  return knownMessages.has(value) ? t(value as MessageKey) : value;
}
