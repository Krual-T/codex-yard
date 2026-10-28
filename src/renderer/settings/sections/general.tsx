/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import type { ComponentType } from 'react';
import type { MessageDescriptor, SettingsPageProps, SettingsPrimitives } from './section-types.ts';

export interface WindowsShellService {
  openStartupSettings: () => Promise<void>;
  getStartupStatus: () => Promise<boolean>;
}

export interface GeneralSettingsRows {
  AccessSettings: ComponentType;
  FullAccessSettings: ComponentType;
  ProjectlessWorkspace: ComponentType;
  DefaultOpenTarget: ComponentType;
  AgentEnvironment: ComponentType;
  TerminalShell: ComponentType;
  Language: ComponentType;
  MenuBar: ComponentType<{ appName: string }>;
  CloseConfirmation: ComponentType;
  AdditionalPreference: ComponentType;
  WindowsStartup: ComponentType<{ service: WindowsShellService }>;
  BottomPanelControl: ComponentType;
  TerminalLocation: ComponentType;
  PreventSleep: ComponentType;
  AutoArchive: ComponentType;
  ChatHistoryCompression: ComponentType<{ hostId: string }>;
  ServiceTier: ComponentType;
  AmbientSuggestions: ComponentType;
  ImportSettings: ComponentType;
  OpenSourceLicenses: ComponentType;
  Plugins: ComponentType<{ hostId: string }>;
  DesktopBeta: ComponentType;
  InAppUpdates: ComponentType;
  MessagePredictions: ComponentType;
  EducationalTips: ComponentType<{ withComposerGroup: boolean }>;
  LiteralText: ComponentType;
  ContextUsage: ComponentType;
  EnterBehavior: ComponentType;
  FollowUpBehavior: ComponentType;
  PopoutWindow: ComponentType;
  Notifications: ComponentType;
}

export interface GeneralSettingsDependencies extends SettingsPrimitives {
  Page: ComponentType<SettingsPageProps>;
  PageTitle: ComponentType<{ slug: 'general-settings' }>;
  ToysBoundary: ComponentType<{ name: 'toys'; children?: import('react').ReactNode }>;
  Toys: ComponentType;
  rows: GeneralSettingsRows;
  composerGroupTitle: MessageDescriptor;
  notificationsTitle: MessageDescriptor;
  appName: string;
  getWindowsShell: () => WindowsShellService | null | undefined;
  useAnySettingsAccess: () => boolean;
  useLocalAccess: () => boolean;
  useLocalOrWorkLocalAccess: () => boolean;
  useHostId: () => string;
  useFeatureFlag: (key: '1372061905' | '2425897452') => boolean;
  useImportFeatureFlag: () => boolean;
  useImportDismissed: () => boolean | null | undefined;
}

/** GeneralSettings and its arrangements, Js/Ys/Xs/Zs in App 26.1013.40934. */
export function createGeneralSettingsComponents(
  React: typeof import('react'),
  deps: GeneralSettingsDependencies,
) {
  const { Page, PageTitle, ToysBoundary, Toys, Group, Rows, FormattedMessage, rows } = deps;

  function ComposerGroup() {
    return <Group>
      <Group.Header title={<FormattedMessage {...deps.composerGroupTitle} />} />
      <Group.Content><Rows>
        <rows.EducationalTips withComposerGroup={false} />
        <rows.LiteralText />
      </Rows></Group.Content>
    </Group>;
  }

  function LimitedGeneralContent() {
    const windowsShell = deps.getWindowsShell();
    return <>
      <Group>
        <Group.Header title={<FormattedMessage id="settings.general.groupTitle" defaultMessage="General" description="Heading for the general settings group" />} />
        <Group.Content><Rows>
          <rows.Language />
          <rows.MenuBar appName="ChatGPT" />
          <rows.CloseConfirmation />
          {windowsShell != null && <rows.WindowsStartup service={windowsShell} />}
          <rows.DesktopBeta />
          <rows.InAppUpdates />
        </Rows></Group.Content>
      </Group>
      <ComposerGroup />
    </>;
  }

  function GeneralContent() {
    const hostId = deps.useHostId();
    const localAccess = deps.useLocalAccess();
    const localOrWorkLocalAccess = deps.useLocalOrWorkLocalAccess();
    const popoutEnabled = deps.useFeatureFlag('1372061905');
    const suggestionsEnabled = deps.useFeatureFlag('2425897452');
    const importFlag = deps.useImportFeatureFlag();
    const importDismissed = deps.useImportDismissed() === true;
    const windowsShell = deps.getWindowsShell();

    return <>
      {localOrWorkLocalAccess && <><rows.AccessSettings /><rows.FullAccessSettings /></>}
      <Group>
        <Group.Header title={<FormattedMessage id="settings.general.groupTitle" defaultMessage="General" description="Heading for the general settings group" />} />
        <Group.Content><Rows>
          {localOrWorkLocalAccess && <><rows.ProjectlessWorkspace /><rows.DefaultOpenTarget /></>}
          {localOrWorkLocalAccess && <><rows.AgentEnvironment /><rows.TerminalShell /></>}
          <rows.Language />
          <rows.MenuBar appName={deps.appName} />
          <rows.CloseConfirmation />
          <rows.AdditionalPreference />
          {windowsShell != null && <rows.WindowsStartup service={windowsShell} />}
          {localAccess && <><rows.BottomPanelControl /><rows.TerminalLocation /></>}
          {localOrWorkLocalAccess && <><rows.PreventSleep /><rows.AutoArchive /><rows.ChatHistoryCompression hostId={hostId} /></>}
          <rows.ServiceTier />
          {localOrWorkLocalAccess && suggestionsEnabled && <rows.AmbientSuggestions />}
          {localOrWorkLocalAccess && !importFlag && !importDismissed && <rows.ImportSettings />}
          <rows.OpenSourceLicenses />
          <rows.Plugins hostId={hostId} />
          <rows.DesktopBeta />
          <rows.InAppUpdates />
        </Rows></Group.Content>
      </Group>
      {localOrWorkLocalAccess ? <Group>
        <Group.Header title={<FormattedMessage {...deps.composerGroupTitle} />} />
        <Group.Content><Rows>
          <rows.MessagePredictions />
          <rows.EducationalTips withComposerGroup={false} />
          <rows.LiteralText />
          <rows.ContextUsage />
          <rows.EnterBehavior />
          <rows.FollowUpBehavior />
        </Rows></Group.Content>
      </Group> : <ComposerGroup />}
      {localAccess && popoutEnabled && <rows.PopoutWindow />}
      <Group id="notifications">
        <Group.Header title={<FormattedMessage {...deps.notificationsTitle} />} />
        <Group.Content><Rows><rows.Notifications /></Rows></Group.Content>
      </Group>
    </>;
  }

  function GeneralSettings() {
    const anySettingsAccess = deps.useAnySettingsAccess();
    return <Page title={<PageTitle slug="general-settings" />}>
      {anySettingsAccess ? <GeneralContent /> : <LimitedGeneralContent />}
      <ToysBoundary name="toys"><Toys /></ToysBoundary>
    </Page>;
  }

  return { GeneralSettings, GeneralContent, LimitedGeneralContent, ComposerGroup };
}
