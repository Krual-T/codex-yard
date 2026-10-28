import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/index.tsx';
import { Row } from './PreferenceControls.tsx';
import type { ChromeTheme } from './preferences.ts';
import { editFontList, groupLocalFonts, selectFontFamily, selectFontStyle } from './theme-fonts.ts';
import type { FontRole, LocalFontFamily } from './theme-fonts.ts';

type FontAccessWindow = Window & { queryLocalFonts?: () => Promise<unknown> };
const roles: FontRole[] = ['ui', 'content', 'code'];

export function ThemeFontControls({ fonts, variantLabel, disabled, onChange }: {
  fonts: ChromeTheme['fonts']; variantLabel: string; disabled: boolean; onChange: (fonts: ChromeTheme['fonts']) => void;
}) {
  const { t, locale } = useI18n();
  const [families, setFamilies] = useState<LocalFontFamily[] | null>(null);
  const [selection, setSelection] = useState<Partial<Record<FontRole, string>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const canBrowse = typeof window !== 'undefined' && typeof (window as FontAccessWindow).queryLocalFonts === 'function';
  const browse = async () => {
    if (!canBrowse) return;
    setLoading(true); setError(null);
    try {
      const result = await (window as FontAccessWindow).queryLocalFonts!();
      if (active.current) setFamilies(groupLocalFonts(result));
    } catch (reason) {
      if (active.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally { if (active.current) setLoading(false); }
  };
  return <>
    {roles.map(role => {
      const label = role === 'ui' ? 'Interface font' : role === 'content' ? 'Content font' : 'Code font';
      const face = fonts[`${role}Face`];
      const familyName = selection[role] ?? face?.family ?? '';
      const family = families?.find(item => item.family === familyName);
      const defaultFace = family?.faces[0];
      const style = face?.family === familyName ? face.postscriptName : defaultFace?.postscriptName ?? '';
      return <Row key={role} label={label} description="Leave blank to use the default.">
        <div className="yard-font-controls">
          <input type="text" aria-label={`${variantLabel} ${t(label).toLocaleLowerCase(locale)}`} value={fonts[role] ?? ''} disabled={disabled}
            onChange={event => { setSelection(current => ({ ...current, [role]: undefined })); onChange(editFontList(fonts, role, event.target.value)); }}
            onBlur={() => { if (!fonts[role] && face) onChange(selectFontStyle(fonts, role, null)); }} />
          {face && <div className="yard-font-face"><span>{t('Saved style:')} {face.fullName}</span>
            <button type="button" disabled={disabled} onClick={() => onChange(selectFontStyle(fonts, role, null))}>{t('Use default style')}</button></div>}
          {families && families.length > 0 && <div className="yard-font-selects">
            <select aria-label={`${variantLabel} ${t(label).toLocaleLowerCase(locale)} ${t('Font family').toLocaleLowerCase(locale)}`} value={family?.family ?? ''} disabled={disabled}
              onChange={event => {
                const next = event.target.value;
                if (!next) return;
                if (typeof CSS === 'undefined' || typeof CSS.escape !== 'function') { setError(t('This browser cannot apply local font names.')); return; }
                setSelection(current => ({ ...current, [role]: next }));
                if (next !== familyName) onChange(selectFontFamily(fonts, role, next, CSS.escape));
              }}>
              <option value="">{t('Choose font family')}</option>
              {families.map(item => <option key={item.family} value={item.family}>{item.family}</option>)}
            </select>
            <select aria-label={`${variantLabel} ${t(label).toLocaleLowerCase(locale)} ${t('Font style').toLocaleLowerCase(locale)}`} value={style} disabled={disabled || !family}
              onChange={event => {
                if (!family) return;
                const selected = family.faces.find(item => item.postscriptName === event.target.value);
                if (!selected) return;
                setSelection(current => ({ ...current, [role]: family.family }));
                onChange(selectFontStyle(fonts, role, selected === defaultFace ? null : selected));
              }}>
              {!family && <option value="">{t('Default style')}</option>}
              {face && family && face.family === family.family && !family.faces.some(item => item.postscriptName === face.postscriptName) &&
                <option value={face.postscriptName}>{face.fullName} ({t('Unavailable')})</option>}
              {family?.faces.map((item, index) => <option key={item.postscriptName} value={item.postscriptName}>{index === 0 ? t('Default style') : item.style || item.fullName}</option>)}
            </select>
          </div>}
        </div>
      </Row>;
    })}
    <div className="yard-font-browse"><button type="button" disabled={disabled || loading || !canBrowse} onClick={() => { void browse(); }}>
      {t(loading ? 'Loading local fonts...' : 'Browse local fonts')}</button>
      {!canBrowse && <span>{t('Local fonts are not available in this browser.')}</span>}
      {families?.length === 0 && <span>{t('No local fonts found.')}</span>}
      {error && <span className="yard-setting-error" role="alert">{t('Could not load local fonts:')} {error}</span>}
    </div>
  </>;
}
