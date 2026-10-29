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
  microphoneInputDeviceId: string | null;
  preventSleepWhileRunning: boolean;
  autoArchiveAfterDays: number;
  localeOverride: string | null;
  reviewDelivery: 'inline' | 'detached';
  'git-branch-prefix': string;
  'git-always-force-push': boolean;
  'git-create-pull-request-as-draft': boolean;
  'git-pull-request-merge-method': 'merge' | 'squash';
  'git-review-mode': 'full' | 'last-turn-only';
  'git-commit-instructions': string;
  'git-pr-instructions': string;
  'git-pr-watch-auto-merge': boolean;
  'git-pr-watch-instructions': string;
  'git-worktree-root': string;
  'worktree-upstream-refresh-mode': 'never' | 'best-effort';
  'worktree-auto-cleanup-enabled': boolean;
  'worktree-keep-count': number;
  'external-browser-link-shortcut': 'unassigned' | 'primary' | 'alt' | 'primary-shift';
  'open-link-in-target-preference': 'in-app-browser' | 'external-browser';
  'open-local-url-in-target-preference': 'in-app-browser' | 'external-browser';
  'browser-show-full-url': boolean;
  'browser-annotation-screenshots-mode': 'always' | 'necessary';
  'primary-number-shortcut-target': 'sidebar' | 'tabs';
  'reduced-motion-preference': 'system' | 'on' | 'off';
  'dock-icon-preference': 'app-default' | 'codex-system' | 'space-system';
  'ambient-suggestions-enabled': boolean;
  'show-context-window-usage': boolean;
  'show-educational-tips': boolean;
  'composer-permission-mode-visibility': PermissionModeVisibility;
  'app-shell-bottom-panel-launcher-visible': boolean;
  'confirm-before-close': 'never' | 'keyboardOnly' | 'always';
  'notifications-turn-mode': 'off' | 'unfocused' | 'always';
  'notifications-permissions-enabled': boolean;
  'notifications-questions-enabled': boolean;
  'notifications-dot-enabled': boolean;
}
export type PermissionModeVisibility = boolean | { 'full-access'?: boolean | null; [key: string]: unknown };
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
const permissionModeVisibility = (value: unknown): value is PermissionModeVisibility =>
  bool(value) || (record(value) && (value['full-access'] == null || bool(value['full-access'])));
export function fullAccessVisible(value: PermissionModeVisibility): boolean {
  return typeof value === 'boolean' ? value : value['full-access'] ?? true;
}
export function setFullAccessVisible(value: PermissionModeVisibility, visible: boolean): PermissionModeVisibility {
  return typeof value === 'boolean' ? visible : { ...value, 'full-access': visible };
}
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
  microphoneInputDeviceId: { source: 'setting', defaultValue: null, valid: (value: unknown): value is string | null => value === null || typeof value === 'string' && value.length > 0 },
  preventSleepWhileRunning: { source: 'setting', defaultValue: false, valid: bool },
  autoArchiveAfterDays: { source: 'setting', defaultValue: 0, valid: numberIn(0, Number.MAX_SAFE_INTEGER) },
  localeOverride: { source: 'setting', defaultValue: null, valid: nullableString },
  reviewDelivery: { source: 'setting', defaultValue: 'inline', valid: oneOf('inline', 'detached') },
  'git-branch-prefix': { source: 'global', defaultValue: 'codex/', valid: string },
  'git-always-force-push': { source: 'global', defaultValue: false, valid: bool },
  'git-create-pull-request-as-draft': { source: 'global', defaultValue: true, valid: bool },
  'git-pull-request-merge-method': { source: 'global', defaultValue: 'merge', valid: oneOf('merge', 'squash') },
  'git-review-mode': { source: 'global', defaultValue: 'full', valid: oneOf('full', 'last-turn-only') },
  'git-commit-instructions': { source: 'global', defaultValue: '', valid: string },
  'git-pr-instructions': { source: 'global', defaultValue: '', valid: string },
  'git-pr-watch-auto-merge': { source: 'global', defaultValue: false, valid: bool },
  'git-pr-watch-instructions': { source: 'global', defaultValue: '', valid: string },
  'git-worktree-root': { source: 'global', defaultValue: '', valid: string },
  'worktree-upstream-refresh-mode': { source: 'global', defaultValue: 'never', valid: oneOf('never', 'best-effort') },
  'worktree-auto-cleanup-enabled': { source: 'global', defaultValue: true, valid: bool },
  'worktree-keep-count': { source: 'global', defaultValue: 15, valid: numberIn(1, Number.MAX_SAFE_INTEGER) },
  'external-browser-link-shortcut': { source: 'setting', defaultValue: 'primary', valid: oneOf('unassigned', 'primary', 'alt', 'primary-shift') },
  'open-link-in-target-preference': { source: 'setting', defaultValue: 'in-app-browser', valid: oneOf('in-app-browser', 'external-browser') },
  'open-local-url-in-target-preference': { source: 'setting', defaultValue: 'in-app-browser', valid: oneOf('in-app-browser', 'external-browser') },
  'browser-show-full-url': { source: 'setting', defaultValue: false, valid: bool },
  'browser-annotation-screenshots-mode': { source: 'setting', defaultValue: 'always', valid: oneOf('always', 'necessary') },
  'primary-number-shortcut-target': { source: 'atom', defaultValue: 'tabs', valid: oneOf('sidebar', 'tabs') },
  'reduced-motion-preference': { source: 'global', defaultValue: 'system', valid: oneOf('system', 'on', 'off') },
  'dock-icon-preference': { source: 'global', defaultValue: 'app-default', valid: oneOf('app-default', 'codex-system', 'space-system') },
  'ambient-suggestions-enabled': { source: 'global', defaultValue: true, valid: bool },
  'show-context-window-usage': { source: 'atom', defaultValue: false, valid: bool },
  'show-educational-tips': { source: 'atom', defaultValue: true, valid: bool },
  'composer-permission-mode-visibility': { source: 'atom', defaultValue: true, valid: permissionModeVisibility },
  'app-shell-bottom-panel-launcher-visible': { source: 'atom', defaultValue: true, valid: bool },
  'confirm-before-close': { source: 'atom', defaultValue: 'keyboardOnly', valid: oneOf('never', 'keyboardOnly', 'always') },
  'notifications-turn-mode': { source: 'global', defaultValue: 'unfocused', valid: oneOf('off', 'unfocused', 'always') },
  'notifications-permissions-enabled': { source: 'global', defaultValue: true, valid: bool },
  'notifications-questions-enabled': { source: 'global', defaultValue: true, valid: bool },
  'notifications-dot-enabled': { source: 'global', defaultValue: true, valid: bool },
};

export const preferenceKeys = Object.keys(preferenceDefinitions) as PreferenceKey[];
export interface PreferenceObservation { exists: boolean; value?: unknown }
export interface PreferenceEntry<T> {
  value: T;
  saved: T;
  observation: PreferenceObservation | null;
  editBase: PreferenceObservation | null;
  baseValue: T;
  editRevision: number;
  conflict: boolean;
  available: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
}
export type PreferenceSnapshot = { [K in PreferenceKey]: PreferenceEntry<PreferenceValues[K]> };
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
const clone = <T>(value: T): T => structuredClone(value);
const put = (target: Record<string, unknown>, key: string, value: unknown) =>
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  return Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every(key => Object.hasOwn(right, key) && same(left[key], right[key]));
}
function observation(response: unknown): PreferenceObservation {
  if (!record(response) || typeof response.exists !== 'boolean') throw new Error('Preference response does not identify whether the value exists');
  return response.exists ? { exists: true, value: clone(response.value) } : { exists: false };
}
function mergeThemeDraft(base: unknown, current: unknown, draft: unknown): unknown {
  if (same(base, draft)) return clone(current);
  if (!record(base) || !record(current) || !record(draft)) return clone(draft);
  const result: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(current), ...Object.keys(draft)])) {
    const inBase = Object.hasOwn(base, key), inDraft = Object.hasOwn(draft, key), inCurrent = Object.hasOwn(current, key);
    if (inBase === inDraft && (!inBase || same(base[key], draft[key]))) {
      if (inCurrent) put(result, key, clone(current[key]));
    } else if (inDraft) {
      put(result, key, inBase && inCurrent ? mergeThemeDraft(base[key], current[key], draft[key]) : clone(draft[key]));
    }
  }
  return result;
}
export function mergeImportedTheme(current: ChromeTheme, imported: ChromeTheme): ChromeTheme {
  const merge = (left: unknown, right: unknown): unknown => {
    if (!record(left) || !record(right)) return clone(right);
    const result: Record<string, unknown> = clone(left);
    for (const [key, value] of Object.entries(right)) put(result, key, Object.hasOwn(left, key) ? merge(left[key], value) : clone(value));
    return result;
  };
  const result = merge(current, imported) as ChromeTheme;
  for (const [family, face] of [['ui', 'uiFace'], ['content', 'contentFace'], ['code', 'codeFace']] as const) {
    if (Object.hasOwn(imported.fonts, family) && !Object.hasOwn(imported.fonts, face) &&
      !same(current.fonts[family], imported.fonts[family])) delete result.fonts[face];
  }
  return result;
}

function initialSnapshot(): PreferenceSnapshot {
  return Object.fromEntries(preferenceKeys.map(key => {
    const value = clone(preferenceDefinitions[key].defaultValue);
    return [key, { value, saved: clone(value), observation: null, editBase: null, baseValue: clone(value),
      editRevision: 0, conflict: false, available: false, loading: true, saving: false, error: null }];
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
  private platform = 'unknown';
  private unsubscribe: (() => void) | null = null;
  private readonly client: WorkbenchClient;
  constructor(client: WorkbenchClient) { this.client = client; }
  setPlatform(platform: string): void { this.platform = platform; }
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
      const source = event.type === 'global-state-updated' ? 'global' : event.type === 'persisted-atom-updated' || event.type === 'persisted-atoms-changed' ? 'atom' :
        event.type === 'settings-changed' ? 'setting' : null;
      if (source) {
        const keys = Array.isArray(event.keys) && event.keys.length ? event.keys : typeof event.key === 'string' ? [event.key] :
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
          for (const key of settings) if (revisions.get(key) === (this.revisions.get(key) ?? 0)) {
            this.applyRead(key, Object.hasOwn(response.values, key) ? { exists: true, value: response.values[key] } : { exists: false });
          }
        } catch (error) {
          if (lifecycle !== this.lifecycle) return;
          for (const key of settings) if (revisions.get(key) === (this.revisions.get(key) ?? 0)) this.update(key, { loading: false, error: errorText(error) });
        }
      })(),
      ...others.map(key => this.reload(key)),
    ]);
  }
  private applyRead<K extends PreferenceKey>(key: K, raw: PreferenceObservation): void {
    const definition = preferenceDefinitions[key];
    const entry = this.snapshot[key];
    if (entry.saving) { this.pendingRefresh.add(key); return; }
    const value = raw.exists ? raw.value : definition.defaultValue;
    const conflict = Boolean(entry.editBase && (entry.conflict || !same(entry.editBase, raw)));
    if (!definition.valid(value)) {
      this.update(key, { observation: clone(raw), conflict, loading: false, available: false,
        error: 'Saved value is invalid; it has not been changed.' });
      return;
    }
    const editBase = entry.editBase && !conflict && same(entry.value, value) ? null : entry.editBase;
    this.update(key, { observation: clone(raw), editBase, conflict, saved: clone(value),
      value: editBase ? entry.value : clone(value), available: true, loading: false, error: null });
  }
  async reload(key: PreferenceKey): Promise<void> {
    if (this.snapshot[key].saving) { this.pendingRefresh.add(key); return; }
    const revision = (this.revisions.get(key) ?? 0) + 1;
    const lifecycle = this.lifecycle;
    this.revisions.set(key, revision);
    const source = preferenceDefinitions[key].source;
    const endpoint = source === 'setting' ? 'get-setting' : source === 'global' ? 'get-global-state' : 'get-persisted-atom';
    try {
      const response = await this.client.host<unknown>(endpoint, { key });
      if (this.lifecycle === lifecycle && this.revisions.get(key) === revision) this.applyRead(key, observation(response));
    } catch (error) {
      if (this.lifecycle === lifecycle && this.revisions.get(key) === revision) this.update(key, { loading: false, error: errorText(error) });
    }
  }
  edit<K extends PreferenceKey>(key: K, value: PreferenceValues[K]): void {
    const entry = this.snapshot[key];
    if (!entry.available || !entry.observation || !preferenceDefinitions[key].valid(value) || same(entry.value, value)) return;
    const editBase = entry.editBase ?? clone(entry.observation);
    const baseValue = entry.editBase ? entry.baseValue : clone(entry.value);
    const cancel = !entry.saving && !entry.conflict && same(value, baseValue) && same(editBase, entry.observation);
    this.update(key, { value: clone(value), editBase: cancel ? null : editBase, baseValue,
      editRevision: entry.editRevision + 1, error: null });
  }
  discard(): void {
    for (const key of preferenceKeys) {
      const entry = this.snapshot[key];
      if (!entry.saving && entry.editBase) this.update(key,
        { value: clone(entry.saved), editBase: null, conflict: false, error: entry.available ? null : entry.error });
    }
  }
  resolveConflict(key: PreferenceKey, choice: 'current' | 'draft'): void {
    const entry = this.snapshot[key];
    if (!entry.conflict || entry.saving || !entry.observation) return;
    if (choice === 'current') {
      this.update(key, { value: clone(entry.saved), editBase: null, conflict: false,
        error: entry.available ? null : 'Saved value is invalid; it has not been changed.' });
      return;
    }
    if (!entry.available) return;
    let draft: unknown = entry.value;
    if ((key === 'appearanceLightChromeTheme' || key === 'appearanceDarkChromeTheme') && draft !== null) {
      const fallback = defaultThemes[key === 'appearanceLightChromeTheme' ? 'light' : 'dark'];
      draft = mergeThemeDraft(entry.baseValue ?? fallback, entry.saved ?? fallback, draft);
    }
    if (key === 'composer-permission-mode-visibility' && permissionModeVisibility(draft) && permissionModeVisibility(entry.saved)) {
      draft = setFullAccessVisible(entry.saved, fullAccessVisible(draft));
    }
    this.update(key, { value: clone(draft) as never, editBase: clone(entry.observation), baseValue: clone(entry.saved) as never,
      editRevision: entry.editRevision + 1, conflict: false, error: null });
  }
  get dirty(): boolean { return preferenceKeys.some(key => this.snapshot[key].editBase !== null); }
  get saving(): boolean { return preferenceKeys.some(key => this.snapshot[key].saving); }
  async save(): Promise<boolean> {
    const keys = preferenceKeys.filter(key => this.snapshot[key].editBase !== null);
    if (keys.some(key => !this.snapshot[key].available || this.snapshot[key].saving || this.snapshot[key].conflict)) return false;
    const results = await Promise.all(keys.map(key => this.saveKey(key)));
    return results.every(Boolean);
  }
  async saveOne(key: PreferenceKey, assertBeforeSend?: () => void): Promise<boolean> {
    const entry = this.snapshot[key];
    if (!entry.available || entry.saving || !entry.editBase || entry.conflict) return false;
    return this.saveKey(key, assertBeforeSend);
  }
  private async saveKey(key: PreferenceKey, assertBeforeSend?: () => void): Promise<boolean> {
    const source = preferenceDefinitions[key].source;
    const endpoint = source === 'setting' ? 'set-setting' : source === 'global' ? 'set-global-state' : 'set-persisted-atom';
    const getEndpoint = source === 'setting' ? 'get-setting' : source === 'global' ? 'get-global-state' : 'get-persisted-atom';
    const initial = this.snapshot[key];
    if (!initial.editBase || initial.conflict) return false;
    const expected = clone(initial.editBase);
    let sent = clone(initial.value);
    if (key === 'git-worktree-root' && typeof sent === 'string') {
      const path = sent.trim();
      const windows = this.platform === 'windows' || this.platform === 'win32';
      const absolute = windows ? /^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/i.test(path) : path.startsWith('/');
      if (path && (this.platform === 'unknown' || !absolute || path.includes('\0'))) {
        this.update(key, { error: 'Enter an absolute path for this host, or leave it blank.' });
        return false;
      }
      if (path !== sent) { this.update(key, { value: path }); sent = path; }
      if (same(sent, initial.baseValue) && same(expected, initial.observation)) {
        this.update(key, { value: sent, editBase: null, error: null }); return true;
      }
    }
    const editRevision = this.snapshot[key].editRevision;
    const value = (key === 'appearanceLightChromeTheme' || key === 'appearanceDarkChromeTheme') && sent === null ? undefined : sent;
    const written: PreferenceObservation = value === undefined ? { exists: false } : { exists: true, value: clone(value) };
    let acknowledged = false;
    this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1);
    this.update(key, { saving: true, error: null });
    try {
      const response = await this.client.host<{ success?: boolean }>(endpoint, { key, value, expected }, { assertBeforeSend });
      if (response?.success !== true) throw new Error('The host did not confirm the write');
      acknowledged = true;
      const read = observation(await this.client.host<unknown>(getEndpoint, { key }));
      const actual = read.exists ? read.value : preferenceDefinitions[key].defaultValue;
      if (!preferenceDefinitions[key].valid(actual)) throw new Error('The saved value could not be verified');
      const current = this.snapshot[key];
      const matches = same(read, written);
      const newer = current.editRevision !== editRevision && !same(current.value, sent);
      this.update(key, { observation: read, saved: clone(actual) as never, value: (matches && !newer ? clone(actual) : current.value) as never,
        editBase: matches && !newer ? null : written, baseValue: clone(sent) as never, conflict: !matches, saving: false,
        error: matches ? null : 'The value changed while saving. Review the current value before saving.' });
      if (this.pendingRefresh.delete(key)) void this.reload(key);
      return matches;
    } catch (error) {
      this.pendingRefresh.delete(key);
      if (acknowledged) this.update(key, { observation: written, saved: clone(sent) as never, editBase: written, baseValue: clone(sent) as never });
      this.update(key, { saving: false, error: `Could not confirm save: ${errorText(error)}. Your edit is preserved.` });
      if (!acknowledged) {
        await this.reload(key);
        if (!this.snapshot[key].conflict) this.update(key, { error: `Could not confirm save: ${errorText(error)}. Your edit is preserved.` });
      }
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
