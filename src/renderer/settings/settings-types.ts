import type { ComponentType, ReactNode, RefCallback } from 'react';

export type SettingsMessage = { id: string; defaultMessage: string; description: string };
export type SettingsAction = () => void;
export type SettingsSection = { slug: string; appRoute?: string };
export type SettingsRemoteConnection = { hostId: string; displayName: string };
export type SettingsLocation = { key: string; pathname: string; search: string; hash: string; state: unknown };
export type SettingsNavigate = (
  to: string | number | { pathname: string; search: string },
  options?: { replace?: boolean; state?: unknown },
) => void;
export type SelectSettingsSection = (slug: string, targetText?: string | null, focusUsageTab?: boolean, route?: string) => void;

export type VisibleSettings = {
  activeSettingsSection: string;
  cloudPreferencesAccessError?: { retry: () => void; isRetrying: boolean } | null;
  settingsNavigationSections: SettingsSection[];
  showEnterpriseUsageLabel: boolean;
  shouldRedirectToVisibleSettingsSection: boolean;
  shouldRenderRouteContent: boolean;
  visibleSettingsSections: SettingsSection[];
};

// The original scoped configuration services supply these operations. The page
// owns only navigation/confirmation UI, never a second configuration store.
export type SettingsActions = {
  prepareHostNavigation: (hostId: string) => void;
  discardChanges: (navigate: SettingsAction) => void;
  trackProfileVisit: () => void;
  updateLegacyContentRect: (element: HTMLElement | null) => void;
};

export type SettingsOutletContext = {
  visibleSettingsSections: SettingsSection[];
  showEnterpriseUsageLabel: boolean;
  onClose: SettingsAction;
  onSelectSection: SelectSettingsSection;
  restoreUsageTabFocus: RefCallback<HTMLElement>;
};

export type SettingsSidebarProps = {
  canCollapse: boolean;
  codexMicroDeviceModel: unknown;
  showEnterpriseUsageLabel: boolean;
  settingsSections: SettingsSection[];
  searchableSections: SettingsSection[];
  activeSection: string;
  onClearHostFilter?: SettingsAction;
  searchHostId: string;
  sidebarHostSelector: ReactNode;
  onSelect: (slug: string, targetText?: string | null, route?: string) => void;
  onSelectPlugin: (route: string) => void;
  onSelectTeam: (teamId: string, tab: string, afterNavigate?: SettingsAction) => void;
  onBack?: SettingsAction;
  groupSettingsSections: boolean;
};

export type SettingsPageDependencies = {
  useSettingsActions: () => SettingsActions;
  useCodexMicroDeviceModel: () => unknown;
  useIntl: () => { formatMessage: (message: SettingsMessage) => string };
  useNavigate: () => SettingsNavigate;
  useLocation: () => SettingsLocation;
  useHostSelection: () => {
    connectedRemoteConnections?: SettingsRemoteConnection[] | null;
    selectedHostId: string;
    setSelectedHostId: (hostId: string) => void;
  };
  useSectionMatch: () => { params: { section?: string; '*'?: string } } | null;
  useToolMatch: () => { params: { server: string; toolName: string } } | null;
  useAvailableTool: (hostId: string) => { server: string; readTool: string } | { server: string; tool: { name: string } } | null;
  normalizeUsageTab: (tab: string | null) => string;
  isLocalHost: (hostId: string) => boolean;
  useVisibleSettings: (section: string | null, localHost: boolean, hostId: string) => VisibleSettings;
  useReturnPath: () => string | null;
  useLayout: (location: SettingsLocation) => string;
  useHasUnsavedChanges: () => boolean;
  shouldNavigateBack: (state: unknown) => boolean;
  resolveSection: (slug: string, sections: SettingsSection[]) => { path: string; sectionSlug: string };
  sectionPath: (slug: string) => string;
  localHostId: string;
  useResizeObserver: (callback: (entry: ResizeObserverEntry, element: HTMLElement) => void) => RefCallback<HTMLElement>;
  registerSettingsCommand: (callback: (source: string) => boolean | void) => () => void;
  HostDropdown: ComponentType<{
    align: 'end'; connectedRemoteConnections: SettingsRemoteConnection[]; contentWidth: 'sidebar';
    localIcon: ComponentType<{ className?: string }>; localLabel: string; onSelectHost: (hostId: string) => void;
    selectedHostId: string; showConnectedIndicator: boolean; triggerVariant: 'filter';
  }>;
  LocalIcon: ComponentType<{ className?: string }>;
  LoadingSection: ComponentType<{ section: string }>;
  SectionTitle: ComponentType<{ slug: string }>;
  CloudPreferencesError: ComponentType<{ isRetrying: boolean; onRetry: SettingsAction }>;
  SectionContainer: ComponentType<{ title: ReactNode; children: ReactNode }>;
  Outlet: ComponentType<{ context: SettingsOutletContext }>;
  Redirect: ComponentType<{ to: string; state?: unknown; replace: boolean }>;
  DocumentTitle: ComponentType<{ title: string }>;
  Sidebar: ComponentType<SettingsSidebarProps>;
  Content: ComponentType<{ navigationKey: string; slateLayout: boolean; targetId: string | null; targetText: string | null; children: ReactNode }>;
  Shell: ComponentType<{ legacyContentRef: RefCallback<HTMLElement>; requestNavigation: (action: SettingsAction) => void; sidebar: ReactNode; children: ReactNode }>;
  UnsavedChangesDialog: ComponentType<{ pendingNavigation: SettingsAction | null; onClearPendingNavigation: SettingsAction }>;
};
