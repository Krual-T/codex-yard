import type { ChromeTheme, ThemeFontFace } from '../settings/preferences.ts';

type Role = 'ui' | 'content' | 'code';
const loaded = new WeakMap<Document, Map<Role, { definition: ThemeFontFace; face: FontFace }>>();
const alias = (role: Role) => `Codex Yard ${role} face`;

/** Keep saved CSS family lists and their fallbacks, including quoted families. */
export function themeFontFamily(fonts: ChromeTheme['fonts'], role: Role, fallback: string): string {
  const value = fonts[role];
  const family = value ? (CSS.supports('font-family', value) ? value : JSON.stringify(value)) : fallback;
  return fonts[`${role}Face`] ? `${JSON.stringify(alias(role))}, ${family}` : family;
}

/** Saved faces resolve through local fonts only; missing faces use the family list. */
export function applyThemeFontFaces(fonts: ChromeTheme['fonts'], document: Document): void {
  if (typeof FontFace === 'undefined' || !document.fonts) return;
  let current = loaded.get(document);
  if (!current) { current = new Map(); loaded.set(document, current); }
  for (const role of ['ui', 'content', 'code'] as const) {
    const definition = fonts[`${role}Face`] as ThemeFontFace | undefined, previous = current.get(role);
    if (definition && previous && definition.family === previous.definition.family && definition.fullName === previous.definition.fullName
      && definition.postscriptName === previous.definition.postscriptName) continue;
    if (previous) { document.fonts.delete(previous.face); current.delete(role); }
    if (!definition) continue;
    const face = new FontFace(alias(role), `local(${JSON.stringify(definition.postscriptName)}), local(${JSON.stringify(definition.fullName)})`);
    current.set(role, { definition: { ...definition }, face }); document.fonts.add(face);
    void face.load().catch(() => { /* The persisted CSS fallback remains usable. */ });
  }
}
