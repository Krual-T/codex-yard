import type { WorkbenchClient } from '../workbench-contract.ts';

export type ThemeVariant = 'light' | 'dark';
export interface ThemeFontFace { family: string; fullName: string; postscriptName: string }
export interface ChromeTheme {
  accent: string;
  accentSource?: 'chatgpt' | 'custom';
  contrast: number;
  fonts: { ui: string | null; content?: string | null; code: string | null;
    uiFace?: ThemeFontFace; contentFace?: ThemeFontFace; codeFace?: ThemeFontFace; [key: string]: unknown };
  ink: string;
  opaqueWindows: boolean;
  semanticColors: { diffAdded: string; diffRemoved: string; skill: string; [key: string]: unknown };
  surface: string;
  [key: string]: unknown;
}

export interface PreferenceValues {
  appearanceTheme: 'system' | 'light' | 'dark';
  appearanceLightChromeTheme: ChromeTheme | null;
  appearanceDarkChromeTheme: ChromeTheme | null;
  appearanceLightCodeThemeId: string;
  appearanceDarkCodeThemeId: string;
  appearanceDiffMarkerStyle: 'color' | 'symbols';
  sansFontSize: number;
  codeFontSize: number;
  useFontSmoothing: boolean;
  usePointerCursors: boolean;
  defaultTerminalLocation: 'bottom' | 'right';
  composerEnterBehavior: 'enter' | 'cmdIfMultiline' | 'cmdAlways';
  composerPlainTextMode: boolean;
  followUpQueueMode: 'queue' | 'steer' | 'interrupt';
  preventSleepWhileRunning: boolean;
  autoArchiveAfterDays: number;
  localeOverride: string | null;
  'reduced-motion-preference': 'system' | 'on' | 'off';
  'dock-icon-preference': 'app-default' | 'codex-system' | 'space-system';
  'ambient-suggestions-enabled': boolean;
  'show-context-window-usage': boolean;
  'show-educational-tips': boolean;
}
export type PreferenceKey = keyof PreferenceValues;
type Source = 'setting' | 'global' | 'atom';
interface Definition<K extends PreferenceKey> {
  source: Source;
  defaultValue: PreferenceValues[K];
  valid(value: unknown): value is PreferenceValues[K];
}
type Definitions = { [K in PreferenceKey]: Definition<K> };

const oneOf = <T extends string>(...values: T[]) => (value: unknown): value is T =>
  typeof value === 'string' && values.includes(value as T);
const bool = (value: unknown): value is boolean => typeof value === 'boolean';
const string = (value: unknown): value is string => typeof value === 'string';
const nullableString = (value: unknown): value is string | null => value === null || string(value);
const numberIn = (min: number, max: number) => (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const color = (value: unknown): value is string => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
const face = (value: unknown): boolean => value === undefined || (record(value) &&
  string(value.family) && string(value.fullName) && string(value.postscriptName));
export function isChromeTheme(value: unknown): value is ChromeTheme {
  if (!record(value) || !record(value.fonts) || !record(value.semanticColors)) return false;
  return color(value.accent) && (value.accentSource === undefined || oneOf('chatgpt', 'custom')(value.accentSource)) &&
    numberIn(0, 100)(value.contrast) && color(value.ink) && color(value.surface) && bool(value.opaqueWindows) &&
    nullableString(value.fonts.ui) && nullableString(value.fonts.code) &&
    (value.fonts.content === undefined || nullableString(value.fonts.content)) &&
    face(value.fonts.uiFace) && face(value.fonts.contentFace) && face(value.fonts.codeFace) &&
    color(value.semanticColors.diffAdded) && color(value.semanticColors.diffRemoved) && color(value.semanticColors.skill);
}
const nullableTheme = (value: unknown): value is ChromeTheme | null => value === null || isChromeTheme(value);

export const preferenceDefinitions: Definitions = {
  appearanceTheme: { source: 'setting', defaultValue: 'system', valid: oneOf('system', 'light', 'dark') },
  appearanceLightChromeTheme: { source: 'setting', defaultValue: null, valid: nullableTheme },
  appearanceDarkChromeTheme: { source: 'setting', defaultValue: null, valid: nullableTheme },
  appearanceLightCodeThemeId: { source: 'setting', defaultValue: 'codex', valid: string },
  appearanceDarkCodeThemeId: { source: 'setting', defaultValue: 'codex', valid: string },
  appearanceDiffMarkerStyle: { source: 'setting', defaultValue: 'color', valid: oneOf('color', 'symbols') },
  sansFontSize: { source: 'setting', defaultValue: 14, valid: numberIn(11, 16) },
  codeFontSize: { source: 'setting', defaultValue: 12, valid: numberIn(8, 24) },
  useFontSmoothing: { source: 'setting', defaultValue: true, valid: bool },
  usePointerCursors: { source: 'setting', defaultValue: false, valid: bool },
  defaultTerminalLocation: { source: 'setting', defaultValue: 'bottom', valid: oneOf('bottom', 'right') },
  composerEnterBehavior: { source: 'setting', defaultValue: 'enter', valid: oneOf('enter', 'cmdIfMultiline', 'cmdAlways') },
  composerPlainTextMode: { source: 'setting', defaultValue: false, valid: bool },
  followUpQueueMode: { source: 'setting', defaultValue: 'steer', valid: oneOf('queue', 'steer', 'interrupt') },
  preventSleepWhileRunning: { source: 'setting', defaultValue: false, valid: bool },
  autoArchiveAfterDays: { source: 'setting', defaultValue: 0, valid: numberIn(0, Number.MAX_SAFE_INTEGER) },
  localeOverride: { source: 'setting', defaultValue: null, valid: nullableString },
  'reduced-motion-preference': { source: 'global', defaultValue: 'system', valid: oneOf('system', 'on', 'off') },
  'dock-icon-preference': { source: 'global', defaultValue: 'app-default', valid: oneOf('app-default', 'codex-system', 'space-system') },
  'ambient-suggestions-enabled': { source: 'global', defaultValue: true, valid: bool },
  'show-context-window-usage': { source: 'atom', defaultValue: false, valid: bool },
  'show-educational-tips': { source: 'atom', defaultValue: true, valid: bool },
};

export const preferenceKeys = Object.keys(preferenceDefinitions) as PreferenceKey[];
export interface PreferenceEntry<T> {
  value: T;
  saved: T;
  available: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
}
export type PreferenceSnapshot = { [K in PreferenceKey]: PreferenceEntry<PreferenceValues[K]> };
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const clone = <T>(value: T): T => structuredClone(value);

function initialSnapshot(): PreferenceSnapshot {
  return Object.fromEntries(preferenceKeys.map(key => {
    const value = clone(preferenceDefinitions[key].defaultValue);
    return [key, { value, saved: clone(value), available: false, loading: true, saving: false, error: null }];
  })) as PreferenceSnapshot;
}

/** Acknowledged writes update only the saved baseline, never a newer draft. */
export class Preferences {
  private snapshot = initialSnapshot();
  private listeners = new Set<() => void>();
  private revisions = new Map<PreferenceKey, number>();
  private pendingRefresh = new Set<PreferenceKey>();
  private lifecycle = 0;
  private disposed = false;
  private unsubscribe: (() => void) | null = null;
  private readonly client: WorkbenchClient;
  constructor(client: WorkbenchClient) { this.client = client; }
  getSnapshot = (): PreferenceSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private update<K extends PreferenceKey>(key: K, patch: Partial<PreferenceEntry<PreferenceValues[K]>>): void {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, [key]: { ...this.snapshot[key], ...patch } };
    for (const listener of this.listeners) listener();
  }
  start(): () => void {
    this.disposed = false;
    const lifecycle = ++this.lifecycle;
    this.unsubscribe = this.client.subscribe(event => {
      const source = event.type === 'global-state-updated' ? 'global' : event.type === 'persisted-atoms-changed' ? 'atom' :
        event.type === 'settings-changed' ? 'setting' : null;
      if (source) {
        const keys = Array.isArray(event.keys) ? event.keys : typeof event.key === 'string' ? [event.key] :
          preferenceKeys.filter(key => preferenceDefinitions[key].source === source);
        for (const key of keys) if (typeof key === 'string' && key in preferenceDefinitions &&
          preferenceDefinitions[key as PreferenceKey].source === source) {
          const preferenceKey = key as PreferenceKey;
          if (this.snapshot[preferenceKey].saving) this.pendingRefresh.add(preferenceKey);
          else void this.reload(preferenceKey);
        }
      }
    });
    void this.load();
    return () => { if (this.lifecycle === lifecycle) { this.disposed = true; this.lifecycle++; this.unsubscribe?.(); this.unsubscribe = null; } };
  }
  async load(): Promise<void> {
    const settings = preferenceKeys.filter(key => preferenceDefinitions[key].source === 'setting');
    const others = preferenceKeys.filter(key => preferenceDefinitions[key].source !== 'setting');
    const lifecycle = this.lifecycle;
    const revisions = new Map(settings.map(key => [key, this.revisions.get(key) ?? 0]));
    await Promise.allSettled([
      (async () => {
        try {
          const response = await this.client.host<{ values: Record<string, unknown> }>('get-settings');
          if (!record(response?.values)) throw new Error('Settings response is invalid');
          if (lifecycle !== this.lifecycle) return;
          for (const key of settings) if (revisions.get(key) === (this.revisions.get(key) ?? 0)) this.applyRead(key, response.values[key]);
        } catch (error) {
          if (lifecycle !== this.lifecycle) return;
          for (const key of settings) if (revisions.get(key) === (this.revisions.get(key) ?? 0)) this.update(key, { loading: false, error: errorText(error) });
        }
      })(),
      ...others.map(key => this.reload(key)),
    ]);
  }
  private applyRead<K extends PreferenceKey>(key: K, raw: unknown): void {
    const definition = preferenceDefinitions[key];
    const value = raw === undefined ? definition.defaultValue : raw;
    if (!definition.valid(value)) {
      this.update(key, { loading: false, available: false, error: 'Saved value is invalid; it has not been changed.' });
      return;
    }
    const entry = this.snapshot[key];
    const dirty = !same(entry.value, entry.saved);
    this.update(key, { saved: clone(value), value: dirty ? entry.value : clone(value), available: true, loading: false, error: null });
  }
  async reload(key: PreferenceKey): Promise<void> {
    const revision = (this.revisions.get(key) ?? 0) + 1;
    const lifecycle = this.lifecycle;
    this.revisions.set(key, revision);
    const source = preferenceDefinitions[key].source;
    const endpoint = source === 'setting' ? 'get-setting' : source === 'global' ? 'get-global-state' : 'get-persisted-atom';
    try {
      const response = await this.client.host<{ value?: unknown }>(endpoint, { key });
      if (this.lifecycle === lifecycle && this.revisions.get(key) === revision) this.applyRead(key, response.value);
    } catch (error) {
      if (this.lifecycle === lifecycle && this.revisions.get(key) === revision) this.update(key, { loading: false, error: errorText(error) });
    }
  }
  edit<K extends PreferenceKey>(key: K, value: PreferenceValues[K]): void {
    if (this.snapshot[key].available && preferenceDefinitions[key].valid(value)) this.update(key, { value: clone(value), error: null });
  }
  discard(): void {
    for (const key of preferenceKeys) this.update(key, { value: clone(this.snapshot[key].saved), error: null });
  }
  get dirty(): boolean { return preferenceKeys.some(key => !same(this.snapshot[key].value, this.snapshot[key].saved)); }
  async save(): Promise<boolean> {
    const keys = preferenceKeys.filter(key => this.snapshot[key].available && !this.snapshot[key].saving && !same(this.snapshot[key].value, this.snapshot[key].saved));
    const results = await Promise.all(keys.map(key => this.saveKey(key)));
    return results.every(Boolean);
  }
  private async saveKey(key: PreferenceKey): Promise<boolean> {
    const source = preferenceDefinitions[key].source;
    const endpoint = source === 'setting' ? 'set-setting' : source === 'global' ? 'set-global-state' : 'set-persisted-atom';
    const getEndpoint = source === 'setting' ? 'get-setting' : source === 'global' ? 'get-global-state' : 'get-persisted-atom';
    const sent = clone(this.snapshot[key].value);
    this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1);
    this.update(key, { saving: true, error: null });
    try {
      const value = (key === 'appearanceLightChromeTheme' || key === 'appearanceDarkChromeTheme') && sent === null ? undefined : sent;
      const response = await this.client.host<{ success?: boolean }>(endpoint, { key, value });
      if (response?.success !== true) throw new Error('The host did not confirm the write');
      const read = await this.client.host<{ value?: unknown }>(getEndpoint, { key });
      const actual = read.value === undefined ? preferenceDefinitions[key].defaultValue : read.value;
      if (!preferenceDefinitions[key].valid(actual)) throw new Error('The saved value could not be verified');
      const current = this.snapshot[key].value;
      this.update(key, { saved: clone(actual), value: current, saving: false,
        error: same(actual, sent) ? null : 'The value changed while saving. Review and save again.' });
      if (this.pendingRefresh.delete(key) && same(actual, sent)) void this.reload(key);
      return same(actual, sent);
    } catch (error) {
      this.pendingRefresh.delete(key);
      this.update(key, { saving: false, error: `Could not confirm save: ${errorText(error)}. Your edit is preserved.` });
      return false;
    }
  }
}

export const defaultThemes: Record<ThemeVariant, ChromeTheme> = {
  light: { accent: '#339cff', accentSource: 'chatgpt', contrast: 45, fonts: { code: null, ui: null }, ink: '#1a1c1f',
    opaqueWindows: false, semanticColors: { diffAdded: '#00a240', diffRemoved: '#ba2623', skill: '#924ff7' }, surface: '#ffffff' },
  dark: { accent: '#339cff', accentSource: 'chatgpt', contrast: 60, fonts: { code: null, ui: null }, ink: '#ffffff',
    opaqueWindows: false, semanticColors: { diffAdded: '#40c977', diffRemoved: '#fa423e', skill: '#ad7bf9' }, surface: '#181818' },
};
export const codeThemes: Record<ThemeVariant, readonly string[]> = {
  light: ['codex', 'catppuccin', 'absolutely', 'everforest', 'github', 'gruvbox', 'linear', 'notion', 'one', 'proof', 'raycast', 'rose-pine', 'solarized', 'vercel', 'vscode-plus', 'xcode'],
  dark: ['codex', 'ayu', 'catppuccin', 'absolutely', 'dracula', 'everforest', 'github', 'gruvbox', 'linear', 'lobster', 'material', 'matrix', 'monokai', 'night-owl', 'nord', 'notion', 'og', 'oscurange', 'one', 'raycast', 'rose-pine', 'sentry', 'solarized', 'temple', 'tokyo-night', 'vercel', 'vscode-plus', 'xcode'],
};
export function exportTheme(variant: ThemeVariant, theme: ChromeTheme, codeThemeId: string): string {
  return `codex-theme-v1:${JSON.stringify({ codeThemeId, theme, variant })}`;
}
export function importTheme(input: string, variant: ThemeVariant): { theme: ChromeTheme; codeThemeId: string } {
  const text = input.trim();
  if (!text.startsWith('codex-theme-v1:')) throw new Error('Expected a codex-theme-v1 share string');
  const encoded = text.slice('codex-theme-v1:'.length);
  let parsed: unknown;
  try { parsed = JSON.parse(encoded.startsWith('{') ? encoded : decodeURIComponent(encoded)); }
  catch { throw new Error('Invalid theme share string'); }
  if (!record(parsed) || parsed.variant !== variant || !isChromeTheme(parsed.theme) ||
    typeof parsed.codeThemeId !== 'string' || !codeThemes[variant].includes(parsed.codeThemeId)) {
    throw new Error(`Invalid ${variant} theme or unsupported code theme`);
  }
  return { theme: clone(parsed.theme), codeThemeId: parsed.codeThemeId };
}
