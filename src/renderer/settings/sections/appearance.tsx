/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import type { ComponentType, Context, ReactNode } from 'react';
import type { SettingRowProps, SettingsPageProps, SettingsPrimitives, ToggleProps } from './section-types.ts';
import type { ThemeVariantsProps } from './theme-variants.tsx';

export interface AppearancePreferencesProps {
  defaultAdvancedExpanded?: boolean;
}

export interface AppearancePreferencesDependencies extends SettingsPrimitives {
  Row: ComponentType<SettingRowProps>;
  Toggle: ComponentType<ToggleProps>;
  Button: ComponentType<{
    'aria-controls': string;
    'aria-expanded': boolean;
    color: 'ghostTertiary';
    radius: 'small';
    size: 'inline';
    onClick: () => void;
    children?: ReactNode;
  }>;
  ExpandedIcon: ComponentType;
  CollapsedIcon: ComponentType;
  ResetAdvanced: ComponentType<{ separateModes: boolean; onResetSeparateModes: () => void }>;
  Mode: ComponentType;
  ThemeVariants: ComponentType<ThemeVariantsProps>;
  UiFontSize: ComponentType;
  ConditionalTextSetting: ComponentType;
  CodeFontSize: ComponentType;
  ReducedMotion: ComponentType;
  ConditionalDisplaySettings: ComponentType;
  DiffMarkers: ComponentType;
  PointerCursors: ComponentType;
  DockIcon: ComponentType;
  FontSmoothing: ComponentType;
  useLocalAccess: () => boolean;
}

/** tc: visual and expandable advanced preferences share the original row services. */
export function createAppearancePreferencesComponent(
  React: typeof import('react'),
  deps: AppearancePreferencesDependencies,
) {
  const { Group, Rows, Row, Toggle, Button, FormattedMessage, ExpandedIcon, CollapsedIcon,
    ResetAdvanced, Mode, ThemeVariants, UiFontSize, ConditionalTextSetting, CodeFontSize,
    ReducedMotion, ConditionalDisplaySettings, DiffMarkers, PointerCursors, DockIcon, FontSmoothing } = deps;

  return function AppearancePreferences({ defaultAdvancedExpanded = false }: AppearancePreferencesProps) {
    const advancedId = React.useId();
    const [advancedExpanded, setAdvancedExpanded] = React.useState(defaultAdvancedExpanded);
    const [separateModes, setSeparateModes] = React.useState(false);
    const localAccess = deps.useLocalAccess();

    return <>
      <Group>
        <Group.Header title={<FormattedMessage id="settings.appearance.visualStyle" defaultMessage="Visual style" description="Heading for mode, theme, color, and font preferences" />} />
        <Group.Content className="gap-4">
          <Rows><Row variant="nested" label={<span className="font-medium"><FormattedMessage id="settings.appearance.mode" defaultMessage="Mode" description="Label for the system, light, or dark appearance preference" /></span>} control={<Mode />} /></Rows>
          <ThemeVariants section="visual" separateModes={separateModes} />
        </Group.Content>
      </Group>
      <Group>
        <Group.Header title={<Button aria-controls={advancedId} aria-expanded={advancedExpanded}
          color="ghostTertiary" radius="small" size="inline" onClick={() => setAdvancedExpanded(!advancedExpanded)}>
          <FormattedMessage id="settings.appearance.advanced" defaultMessage="Advanced" description="Button that expands additional appearance preferences" />
          {advancedExpanded ? <ExpandedIcon /> : <CollapsedIcon />}
        </Button>} actions={<ResetAdvanced separateModes={separateModes} onResetSeparateModes={() => setSeparateModes(false)} />} />
        {advancedExpanded && <div id={advancedId}><Group.Content className="gap-4">
          <Rows><UiFontSize /><ConditionalTextSetting /><CodeFontSize /></Rows>
          <Rows>
            <ReducedMotion />
            <Row label={<FormattedMessage id="settings.appearance.separateModes" defaultMessage="Separate light and dark modes" description="Label for showing independent light and dark theme controls" />}
              description={<FormattedMessage id="settings.appearance.separateModes.description" defaultMessage="Choose a theme, colors, and font for each" description="Explains that this switch reveals both saved themes without changing their values" />}
              control={labels => <Toggle {...labels} checked={separateModes} onChange={setSeparateModes} />} />
          </Rows>
          <ThemeVariants section="advanced" separateModes={separateModes} />
          <ConditionalDisplaySettings />
          <Rows>
            {localAccess ? <DiffMarkers /> : null}
            <PointerCursors /><DockIcon /><FontSmoothing />
          </Rows>
        </Group.Content></div>}
      </Group>
    </>;
  };
}

export interface AppearanceOutletContext {
  navigationKey?: string;
  targetId?: string | null;
  targetText?: string | null;
}

export interface AppearanceSettingsDependencies {
  OutletContext: Context<AppearanceOutletContext | null>;
  PageTitle: ComponentType<{ slug: 'appearance' }>;
  Page: ComponentType<SettingsPageProps>;
  AppearancePreferences: ComponentType<AppearancePreferencesProps>;
}

/** f: navigation keys remount the preference state for targeted searches. */
export function createAppearanceSettingsComponent(React: typeof import('react'), deps: AppearanceSettingsDependencies) {
  const { OutletContext, PageTitle, Page, AppearancePreferences } = deps;
  return function AppearanceSettings() {
    const context = React.useContext(OutletContext);
    const defaultAdvancedExpanded = context?.targetId != null || context?.targetText != null;
    return <Page title={<PageTitle slug="appearance" />}>
      <AppearancePreferences key={context?.navigationKey} defaultAdvancedExpanded={defaultAdvancedExpanded} />
    </Page>;
  };
}
