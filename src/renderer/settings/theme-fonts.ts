import type { ChromeTheme, ThemeFontFace } from './preferences.ts';

export type FontRole = 'ui' | 'content' | 'code';
export interface LocalFontFace extends ThemeFontFace { style: string }
export interface LocalFontFamily { family: string; faces: LocalFontFace[] }

export function groupLocalFonts(value: unknown): LocalFontFamily[] {
  if (!Array.isArray(value)) throw new Error('Invalid local font response');
  const groups = new Map<string, LocalFontFace[]>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const font = item as Record<string, unknown>;
    if (typeof font.family !== 'string' || !font.family.trim() || typeof font.fullName !== 'string' || !font.fullName.trim() ||
      typeof font.postscriptName !== 'string' || !font.postscriptName.trim() || typeof font.style !== 'string') continue;
    const faces = groups.get(font.family) ?? [];
    if (!faces.some(face => face.postscriptName === font.postscriptName)) {
      faces.push({ family: font.family, fullName: font.fullName, postscriptName: font.postscriptName, style: font.style });
      groups.set(font.family, faces);
    }
  }
  return Array.from(groups, ([family, faces]) => ({ family, faces: faces.sort((a, b) =>
    Number(!/^regular$/i.test(a.style)) - Number(!/^regular$/i.test(b.style)) || a.style.localeCompare(b.style) || a.postscriptName.localeCompare(b.postscriptName))
  })).sort((a, b) => a.family.localeCompare(b.family));
}

export function editFontList(fonts: ChromeTheme['fonts'], role: FontRole, value: string): ChromeTheme['fonts'] {
  return { ...fonts, [role]: value || null };
}

export function selectFontFamily(fonts: ChromeTheme['fonts'], role: FontRole, family: string,
  escape: (value: string) => string): ChromeTheme['fonts'] {
  const next = { ...fonts, [role]: `"${escape(family)}"` };
  delete next[`${role}Face`];
  return next;
}

export function selectFontStyle(fonts: ChromeTheme['fonts'], role: FontRole, face: ThemeFontFace | null): ChromeTheme['fonts'] {
  const next = { ...fonts };
  if (face) next[`${role}Face`] = { family: face.family, fullName: face.fullName, postscriptName: face.postscriptName };
  else delete next[`${role}Face`];
  return next;
}
