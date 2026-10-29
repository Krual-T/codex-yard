import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { translateKnown, useI18n } from '../i18n/index.tsx';
import type { PreferenceEntry } from './preferences.ts';
import { Row, entryState } from './PreferenceControls.tsx';
import { assertCurrent, AvailabilityRow, BundledPluginControl, current, effectivePath, NavigationFailureNotice, useIntegrationNavigation } from './integration-settings.tsx';
import type { IntegrationAvailability, IntegrationSettingsProps } from './integration-settings.tsx';
import type { PluginEntry } from '../pages/plugins/catalog.ts';

export interface BrowserPreferenceValues {
  'open-link-in-target-preference': 'in-app-browser' | 'external-browser';
  'open-local-url-in-target-preference': 'in-app-browser' | 'external-browser';
  'browser-show-full-url': boolean;
  'browser-annotation-screenshots-mode': 'always' | 'necessary';
}
export type BrowserPreferenceKey = keyof BrowserPreferenceValues;
export type BrowserPreferenceSnapshot = { [K in BrowserPreferenceKey]: PreferenceEntry<BrowserPreferenceValues[K]> };
export interface BrowserPreferencePort {
  snapshot: BrowserPreferenceSnapshot;
  edit<K extends BrowserPreferenceKey>(key: K, value: BrowserPreferenceValues[K]): void;
  reload(key: BrowserPreferenceKey): Promise<void>;
  /** Uses the shared Preferences controller and checks this guard immediately before host dispatch. */
  saveOne(key: BrowserPreferenceKey, assertBeforeSend: () => void): Promise<boolean>;
}
export interface BrowserSectionProps extends IntegrationSettingsProps {
  preferences: BrowserPreferencePort;
  /** Unmodified host feature value; null means the host has not supplied a trustworthy value. */
  rawInAppBrowserFeature: boolean | null;
  pluginAvailability: IntegrationAvailability;
  extensionsAvailability: IntegrationAvailability;
  onTryPlugin?: (entry: PluginEntry) => Promise<void>;
}

type DataType = 'cookies' | 'siteData' | 'cache' | 'downloads' | 'history';
const clearTypes: readonly [DataType, string, string][] = [
  ['cookies', 'Cookies', 'Delete cookies'], ['siteData', 'Site data', 'Delete site data'],
  ['cache', 'Cached images and files', 'Delete cached images and files'],
  ['downloads', 'Download history', 'Delete download history'], ['history', 'Browsing history', 'Delete browsing history'],
];
const subpages: Record<string, { title: string; message: string }> = {
  '/settings/browser-use/history': { title: 'Browsing history', message: 'Browser history is unavailable on this web host.' },
  '/settings/browser-use/passwords': { title: 'Password manager', message: 'The built-in browser password manager is unavailable on this web host.' },
  '/settings/browser-use/contact-info': { title: 'Contact info', message: 'The built-in browser contact settings are unavailable on this web host.' },
  '/settings/browser-use/site-settings': { title: 'Site settings', message: 'The built-in browser site settings are unavailable on this web host.' },
  '/settings/browser-use/extensions': { title: 'Extensions', message: 'The built-in browser extension settings are unavailable on this web host.' },
};

function PreferenceMenu({ label, value, options, disabled, choose }: {
  label: string; value: string; options: readonly (readonly [string, string])[]; disabled: boolean; choose(value: string): void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false), root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    root.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')?.focus();
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  const move = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
    if (!items.length) return;
    event.preventDefault(); const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 :
      (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };
  return <div className="yard-integration-select" ref={root}>
    <button ref={trigger} type="button" className="yard-integration-select-trigger" aria-haspopup="menu" aria-expanded={open} disabled={disabled}
      onClick={() => setOpen(value => !value)}>{translateKnown(t, options.find(option => option[0] === value)?.[1] ?? value)}<ChevronDown size={14} aria-hidden="true" /></button>
    {open && <div className="yard-integration-select-menu" role="menu" aria-label={translateKnown(t, label)} onKeyDown={move}>
      {options.map(([option, text]) => <button type="button" role="menuitemradio" aria-checked={option === value} key={option} onClick={() => {
        setOpen(false); trigger.current?.focus(); if (option !== value) choose(option);
      }}>{translateKnown(t, text)}{option === value && <Check size={14} aria-hidden="true" />}</button>)}
    </div>}
  </div>;
}

export function BrowserSection(props: BrowserSectionProps) {
  return <BrowserSectionScope key={JSON.stringify([props.route.hostId, props.authorityKey])} {...props} />;
}

function BrowserSectionScope(props: BrowserSectionProps) {
  const { t } = useI18n(), path = effectivePath(props.route).replace(/\/$/, '');
  const feature = { enabled: props.rawInAppBrowserFeature, loading: false,
    error: props.rawInAppBrowserFeature === null ? 'In-app browser availability cannot be verified for this connection.' : null };
  const navigation = useIntegrationNavigation(props);
  const subpage = subpages[path], validSubpage = !!subpage && (path !== '/settings/browser-use/extensions' || props.extensionsAvailability !== 'restricted');
  const [expanded, setExpanded] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (path !== '/settings/browser-use' && (feature.enabled === false || subpage && !validSubpage)) navigation.navigate('/settings/browser-use', true);
  }, [feature.enabled, path, validSubpage, props.route.hostId, props.authorityKey]);
  const text = (value: string) => translateKnown(t, value);
  const setPreference = <K extends BrowserPreferenceKey>(key: K, value: BrowserPreferenceValues[K]) => {
    if (!current(props)) return;
    setSaveError(null);
    props.preferences.edit(key, value);
    void props.preferences.saveOne(key, () => assertCurrent(props)).catch(cause => {
      if (mounted.current && current(props)) setSaveError(cause instanceof Error ? cause.message : String(cause));
    });
  };
  const manage = (target: string) => navigation.navigate(`/settings/browser-use/${target}`);
  const retryFeature = () => {
    setSaveError(null);
    if (current(props)) void props.refreshAvailability().catch(cause => {
      if (mounted.current && current(props)) setSaveError(cause instanceof Error ? cause.message : String(cause));
    });
  };
  if (validSubpage && (feature.loading || feature.error)) return <>
    <NavigationFailureNotice failure={navigation.failure} retry={navigation.retry} />
    {saveError && <p className="yard-setting-error" role="alert">{saveError}</p>}
    <h1>{text(subpage.title)}</h1>{feature.loading ? <p role="status">{text('Loading browser settings...')}</p> :
      <p className="yard-setting-error" role="alert">{text('Could not load browser settings:')} {text(feature.error ?? '')} <button type="button" className="yard-link" onClick={retryFeature}>{t('Retry')}</button></p>}
  </>;
  if (validSubpage && feature.enabled) return <>
    <NavigationFailureNotice failure={navigation.failure} retry={navigation.retry} />
    <button type="button" onClick={() => navigation.navigate('/settings/browser-use')}>{text('Back to Browser')}</button>
    <h1>{text(subpage.title)}</h1><p className="yard-setting-error" role="alert">{text(path === '/settings/browser-use/extensions' && props.extensionsAvailability === 'unknown'
      ? 'Availability could not be determined for this connection.' : subpage.message)}</p>
  </>;
  const destinations = [
    ['in-app-browser', 'ChatGPT'], ['external-browser', 'Default browser'],
  ] as const;
  const preferenceSelect = (key: 'open-link-in-target-preference' | 'open-local-url-in-target-preference' | 'browser-annotation-screenshots-mode', label: string,
    description: string | undefined, options: readonly (readonly [string, string])[]) => {
    const entry = props.preferences.snapshot[key];
    return <Row label={label} description={description} error={entry.error} retry={() => { if (current(props)) void props.preferences.reload(key); }}>
      <PreferenceMenu label={label} value={entry.value} options={options} disabled={entryState(entry).disabled || entry.conflict}
        choose={value => { if (options.some(option => option[0] === value)) setPreference(key, value as BrowserPreferenceValues[typeof key]); }} />
    </Row>;
  };
  const fullUrl = props.preferences.snapshot['browser-show-full-url'];
  return <>
    <div className="yard-configuration-heading"><h1>{text('Browser')}</h1><p>{text('Manage your Browser Use preferences and site access.')}</p></div>
    <NavigationFailureNotice failure={navigation.failure} retry={navigation.retry} />
    <div className="yard-setting-group">{props.pluginAvailability === 'available' ? <BundledPluginControl props={props} name="browser" label="Browser"
      description="Let ChatGPT control the built-in browser" onTry={props.onTryPlugin} /> :
      <AvailabilityRow props={props} availability={props.pluginAvailability} label="Browser" />}</div>
    {feature.loading && <p role="status">{text('Loading browser settings...')}</p>}
    {feature.error && <p className="yard-setting-error" role="alert">{text('Could not load browser settings:')} {text(feature.error)} <button type="button" className="yard-link" onClick={retryFeature}>{t('Retry')}</button></p>}
    {saveError && <p className="yard-setting-error" role="alert">{saveError}</p>}
    {feature.enabled && <>
      <h3 className="yard-settings-group-title">{t('General')}</h3><div className="yard-setting-group">
        {preferenceSelect('open-link-in-target-preference', 'Web URL and link open destination', undefined, destinations)}
        {preferenceSelect('open-local-url-in-target-preference', 'Local URL open destination', 'Where local development sites open by default', destinations)}
        <Row label="Show full URL" description="Include the path, query, and fragment in the address bar" error={fullUrl.error}
          retry={() => { if (current(props)) void props.preferences.reload('browser-show-full-url'); }}>
          <input type="checkbox" role="switch" aria-label={text('Show full URL')} checked={fullUrl.value} disabled={entryState(fullUrl).disabled || fullUrl.conflict}
            onChange={event => setPreference('browser-show-full-url', event.target.checked)} />
        </Row>
        <Row label="Browsing data" description="Clear browsing history, site data, cache, and download history from the in-app browser"
          error={text('Clearing browsing data is unavailable on this web host.')}>
          <button type="button" className="yard-integration-secondary" disabled title={text('Clearing browsing data is unavailable on this web host.')}>{text('Clear all browsing data')}</button>
          <button type="button" aria-expanded={expanded} aria-controls="yard-browser-data-options" aria-label={text(expanded ? 'Hide individual browsing data options' : 'Show individual browsing data options')}
            onClick={() => setExpanded(value => !value)}><ChevronDown size={16} aria-hidden="true" /></button>
        </Row>
        {expanded && <div id="yard-browser-data-options">{clearTypes.map(([key, label, action]) => <Row key={key} label={label}>
          <button type="button" disabled title={text('Clearing browsing data is unavailable on this web host.')}>{text(action)}</button></Row>)}</div>}
        <Row label="Browsing history" description="View and manage pages visited in the built-in browser"><button type="button" className="yard-integration-secondary" onClick={() => manage('history')}>{text('Manage')}</button></Row>
        {preferenceSelect('browser-annotation-screenshots-mode', 'Annotation screenshots', 'Screenshots help ChatGPT better understand and address comments, but increase plan usage',
          [['always', 'Always include'], ['necessary', 'Only on drag selection']])}
      </div>
      <h3 className="yard-settings-group-title">{text('Autofill and passwords')}</h3><div className="yard-setting-group">
        <Row label="Password manager" description="Add, delete, and edit saved passwords"><button type="button" className="yard-integration-secondary" onClick={() => manage('passwords')}>{text('Manage')}</button></Row>
        <Row label="Contact info" description="Add, delete, and edit saved addresses, phone numbers, and email addresses"><button type="button" className="yard-integration-secondary" onClick={() => manage('contact-info')}>{text('Manage')}</button></Row>
      </div>
      {props.extensionsAvailability === 'available' && <><h3 className="yard-settings-group-title">{text('Extensions')}</h3><div className="yard-setting-group">
        <Row label="Extensions"><button type="button" className="yard-integration-secondary" onClick={() => manage('extensions')}>{text('Manage')}</button></Row></div></>}
      {props.extensionsAvailability === 'unknown' && <><h3 className="yard-settings-group-title">{text('Extensions')}</h3><div className="yard-setting-group">
        <Row label="Extensions" description="Availability could not be determined for this connection."><button type="button"
          onClick={() => { if (current(props)) void props.refreshAvailability().catch(cause => { if (current(props)) setSaveError(cause instanceof Error ? cause.message : String(cause)); }); }}>{t('Retry')}</button></Row></div></>}
      <h3 className="yard-settings-group-title">{text('Permissions')}</h3><div className="yard-setting-group">
        <Row label="Site settings" description="Control camera and microphone permissions in the built-in browser"><button type="button" className="yard-integration-secondary" onClick={() => manage('site-settings')}>{text('Manage')}</button></Row>
      </div>
    </>}
  </>;
}
