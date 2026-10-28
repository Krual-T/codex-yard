import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { resolveLocale } from './locale.ts';
import { createI18n } from './format.ts';
import type { I18n } from './format.ts';

export { hasTranslations, languageOptions, resolveLocale } from './locale.ts';
export { createI18n, translateKnown } from './format.ts';
export type { MessageKey } from './messages.ts';
export type { I18n } from './format.ts';

const Context = createContext<I18n>(createI18n(resolveLocale(null, [])));
export function I18nProvider({ locale, children }: { locale: string; children: ReactNode }) {
  const value = useMemo(() => createI18n(locale), [locale]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useI18n(): I18n { return useContext(Context); }
