const referenceLocales = [
  'am', 'ar', 'bg-BG', 'bn-BD', 'bs-BA', 'ca-ES', 'cs-CZ', 'da-DK', 'de-DE', 'el-GR',
  'es-419', 'es-ES', 'et-EE', 'fa', 'fi-FI', 'fr-CA', 'fr-FR', 'gu-IN', 'hi-IN', 'hr-HR',
  'hu-HU', 'hy-AM', 'id-ID', 'is-IS', 'it-IT', 'ja-JP', 'ka-GE', 'kk', 'kn-IN', 'ko-KR',
  'lt', 'lv-LV', 'mk-MK', 'ml', 'mn', 'mr-IN', 'ms-MY', 'my-MM', 'nb-NO', 'nl-NL', 'pa',
  'pl-PL', 'pt-BR', 'pt-PT', 'ro-RO', 'ru-RU', 'sk-SK', 'sl-SI', 'so-SO', 'sq-AL', 'sr-RS',
  'sv-SE', 'sw-TZ', 'ta-IN', 'te-IN', 'th-TH', 'tl', 'tr-TR', 'uk-UA', 'ur', 'vi-VN',
  'zh-CN', 'zh-HK', 'zh-TW',
] as const;

const preferredRegion: Readonly<Record<string, string>> = { es: 'es-419', fr: 'fr-FR', pt: 'pt-BR', zh: 'zh-CN' };

function canonical(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try { return Intl.getCanonicalLocales(value.trim().replace(/_/g, '-'))[0] ?? null; }
  catch { return null; }
}

/** Resolve an existing setting or browser language without changing either source. */
export function resolveLocale(override: unknown, languages: readonly string[]): string {
  const hasOverride = typeof override === 'string' && override.length > 0;
  const input = hasOverride ? canonical(override) : languages.map(canonical).find(Boolean) ?? null;
  if (!input) return 'en-US';
  const normalized = input.toLowerCase();
  if (normalized === 'en' || normalized.startsWith('en-')) return input;
  const exact = referenceLocales.find(locale => locale.toLowerCase() === normalized);
  if (exact) return exact;
  const [language, second] = normalized.split('-');
  const candidates = referenceLocales.filter(locale => locale.toLowerCase().split('-')[0] === language);
  if (!language || candidates.length === 0) return input;
  let region: string | undefined;
  if (!second) {
    try { region = new Intl.Locale(language).maximize().region?.toLowerCase(); } catch { /* Keep the catalog fallback. */ }
  }
  return candidates.find(locale => locale.toLowerCase() === `${language}-${second}`) ??
    candidates.find(locale => region && locale.toLowerCase() === `${language}-${region}`) ??
    candidates.find(locale => locale === preferredRegion[language]) ?? candidates[0]!;
}

const translatedLanguages = new Set(['en', 'zh', 'ja', 'ko', 'es', 'fr', 'de', 'pt']);

export function hasTranslations(locale: string): boolean {
  const language = canonical(locale)?.split('-')[0];
  return language != null && translatedLanguages.has(language);
}

function languageLabel(locale: string): string {
  if (locale === 'en-US') return 'English';
  try { return new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale; }
  catch { return locale; }
}

/** The original locale choices remain selectable even when their text falls back to English. */
export const languageOptions: readonly { value: string; label: string; translated: boolean }[] =
  ['en-US', ...referenceLocales].map(value => ({ value, label: languageLabel(value), translated: hasTranslations(value) }));
