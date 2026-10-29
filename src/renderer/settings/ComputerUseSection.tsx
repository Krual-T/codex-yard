import { useEffect } from 'react';
import { translateKnown, useI18n } from '../i18n/index.tsx';
import type { PluginEntry } from '../pages/plugins/catalog.ts';
import { Row } from './PreferenceControls.tsx';
import { AvailabilityRow, BundledPluginControl, effectivePath, IntegrationControlRow, NavigationFailureNotice, useIntegrationNavigation } from './integration-settings.tsx';
import type { IntegrationAvailability, IntegrationSettingsProps } from './integration-settings.tsx';

export interface ComputerUseSectionProps extends IntegrationSettingsProps {
  platform: 'macOS' | 'windows' | 'linux' | 'unknown';
  computerUseAvailability: IntegrationAvailability;
  externalBrowserAvailability: IntegrationAvailability;
  onTryPlugin?: (entry: PluginEntry) => Promise<void>;
}

export function ComputerUseSection(props: ComputerUseSectionProps) {
  return <ComputerUseSectionScope key={JSON.stringify([props.route.hostId, props.authorityKey])} {...props} />;
}

function ComputerUseSectionScope(props: ComputerUseSectionProps) {
  const { t } = useI18n(), text = (value: string) => translateKnown(t, value);
  const navigation = useIntegrationNavigation(props);
  const path = effectivePath(props.route).replace(/\/$/, '');
  const browserDetails = path === '/settings/computer-use/chrome' || path === '/settings/computer-use/google-chrome';
  useEffect(() => {
    if (path !== '/settings/computer-use' && !browserDetails) navigation.navigate('/settings/computer-use', true);
  }, [path, browserDetails, props.route.hostId, props.authorityKey]);
  if (browserDetails) return <>
    <NavigationFailureNotice failure={navigation.failure} retry={navigation.retry} />
    <button type="button" onClick={() => navigation.navigate('/settings/computer-use')}>{text('Back to Computer use')}</button>
    <h1>{text('Google Chrome')}</h1>
    <p className="yard-setting-error" role="alert">{text('Chrome extension status is unavailable on this web host.')}</p>
  </>;
  return <>
    <div className="yard-configuration-heading"><h1>{text('Computer use')}</h1><p>{text('Manage how ChatGPT uses other applications on your computer')}</p></div>
    <NavigationFailureNotice failure={navigation.failure} retry={navigation.retry} />
    <h3 className="yard-settings-group-title">{text('Control')}</h3>
    <div className="yard-setting-group">
      {props.computerUseAvailability === 'available' && (props.platform === 'macOS' || props.platform === 'windows') &&
        <BundledPluginControl props={props} name="computer-use" label="Any App" description="Let ChatGPT control apps on your computer" onTry={props.onTryPlugin} />}
      {props.computerUseAvailability === 'unknown' && (props.platform === 'macOS' || props.platform === 'windows') &&
        <AvailabilityRow props={props} availability="unknown" label="Any App" />}
      {props.externalBrowserAvailability === 'available' ? <IntegrationControlRow label="Google Chrome"><Row label="Google Chrome" description="Chrome extension status is unavailable on this web host.">
        <button type="button" className="yard-integration-secondary" onClick={() => navigation.navigate('/settings/computer-use/chrome')}>{text('Manage')}</button>
      </Row></IntegrationControlRow> : <AvailabilityRow props={props} availability={props.externalBrowserAvailability} label="Google Chrome" />}
    </div>
    {props.computerUseAvailability === 'available' && (props.platform === 'macOS' || props.platform === 'windows') && <>
      <h3 className="yard-settings-group-title">{text('Always allowed apps')}</h3>
      <p className="yard-setting-error" role="alert">{text('Allowed app settings are unavailable on this web host.')}</p>
    </>}
  </>;
}
