/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import type { ReactNode } from 'react';
import type { SelectSettingsSection, SettingsAction, SettingsPageDependencies } from './settings-types.ts';

/** SettingsPage/_i in the fixed App. Route and configuration services remain
 * upstream; this component owns the original navigation and confirmation UI. */
export function createSettingsPageComponent(React: typeof import('react'), deps: SettingsPageDependencies) {
  const { HostDropdown, LocalIcon, LoadingSection, SectionTitle, CloudPreferencesError,
    SectionContainer, Outlet, Redirect, DocumentTitle, Sidebar, Content, Shell, UnsavedChangesDialog } = deps;

  return function SettingsPage(): ReactNode {
    const actions = deps.useSettingsActions();
    const shouldFocusUsageTab = React.useRef(false);
    const restoreUsageTabFocus = React.useCallback((element: HTMLElement | null) => {
      if (!shouldFocusUsageTab.current) return;
      const selected = element?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
      if (selected != null) {
        shouldFocusUsageTab.current = false;
        selected.focus();
      }
    }, []);
    const microDeviceModel = deps.useCodexMicroDeviceModel();
    const intl = deps.useIntl();
    const navigate = deps.useNavigate();
    const location = deps.useLocation();
    const { connectedRemoteConnections, selectedHostId, setSelectedHostId } = deps.useHostSelection();
    const sectionMatch = deps.useSectionMatch();
    const toolMatch = deps.useToolMatch();
    const requestedSection = sectionMatch?.params.section ?? null;
    const availableTool = deps.useAvailableTool(selectedHostId);
    const matchesAvailableTool = availableTool != null && availableTool.server === toolMatch?.params.server
      && ('readTool' in availableTool ? availableTool.readTool : availableTool.tool.name) === toolMatch?.params.toolName;
    const section = requestedSection === 'usage'
      ? deps.normalizeUsageTab(new URLSearchParams(location.search).get('tab')) : requestedSection;
    const localHost = deps.isLocalHost(selectedHostId);
    const { activeSettingsSection, cloudPreferencesAccessError, settingsNavigationSections,
      showEnterpriseUsageLabel, shouldRedirectToVisibleSettingsSection, shouldRenderRouteContent,
      visibleSettingsSections } = deps.useVisibleSettings(section === 'time-management' ? 'safety' : section, localHost, selectedHostId);
    const returnPath = deps.useReturnPath();
    const layout = deps.useLayout(location);
    const hasUnsavedChanges = deps.useHasUnsavedChanges();
    const [pendingNavigation, setPendingNavigation] = React.useState<SettingsAction | null>(null);
    const [searchTarget, setSearchTarget] = React.useState<{ label: string; navigationKey: number; route: string } | null>(null);
    const navigateBack = deps.shouldNavigateBack(location.state);

    const requestNavigation = React.useCallback((action: SettingsAction) => {
      actions.prepareHostNavigation(selectedHostId);
      if (!hasUnsavedChanges) action();
      else setPendingNavigation(() => () => actions.discardChanges(action));
    }, [actions, selectedHostId, hasUnsavedChanges]);
    const close = React.useCallback(() => requestNavigation(() => {
      if (navigateBack) navigate(-1);
      else navigate(returnPath ?? '/', { replace: true });
    }), [requestNavigation, navigate, navigateBack, returnPath]);

    const hostSelector = connectedRemoteConnections != null && connectedRemoteConnections.length > 0 ? <HostDropdown
      align="end" connectedRemoteConnections={connectedRemoteConnections} contentWidth="sidebar" localIcon={LocalIcon}
      localLabel={intl.formatMessage({ id: 'settings.hostDropdown.allSettings', defaultMessage: 'All settings',
        description: 'Label for showing all settings in the settings sidebar host filter' })}
      onSelectHost={hostId => { if (hostId !== selectedHostId) requestNavigation(() => setSelectedHostId(hostId)); }}
      selectedHostId={selectedHostId} showConnectedIndicator={true} triggerVariant="filter"
    /> : null;
    const clearHostFilter = localHost ? undefined : () => requestNavigation(() => setSelectedHostId(deps.localHostId));

    const selectSection = React.useCallback<SelectSettingsSection>((slug, targetText, focusUsageTab = false, overrideRoute) => {
      const appRoute = settingsNavigationSections.find(candidate => candidate.slug === slug)?.appRoute;
      const route = appRoute ?? overrideRoute ?? deps.resolveSection(slug, settingsNavigationSections).path;
      const recordTarget = (targetRoute: string) => setSearchTarget(previous => targetText == null ? null
        : { label: targetText, navigationKey: (previous?.navigationKey ?? 0) + 1, route: targetRoute });
      const currentRoute = location.pathname + location.search;
      const repeatedSubsection = targetText != null && (
        slug === 'cloud-environments' && new URLSearchParams(location.search).get('tab') === 'preferences'
        || slug === 'worktrees' && new URLSearchParams(location.search).get('tab') === 'environments'
      );
      if (slug === activeSettingsSection && appRoute == null && toolMatch == null
          && (overrideRoute == null || currentRoute === overrideRoute) && !repeatedSubsection
          && (slug !== 'teams' || location.pathname === '/settings/teams')) {
        if (targetText != null) recordTarget(currentRoute + location.hash);
        return;
      }
      requestNavigation(() => {
        if (slug === 'profile') actions.trackProfileVisit();
        if (appRoute != null) navigate(route);
        else {
          shouldFocusUsageTab.current = focusUsageTab;
          recordTarget(route);
          navigate(route, { replace: true, state: location.state });
        }
      });
    }, [settingsNavigationSections, activeSettingsSection, toolMatch, location, requestNavigation, actions, navigate]);

    const loading = <LoadingSection section={activeSettingsSection} />;
    let routeContent: ReactNode = loading;
    if (cloudPreferencesAccessError != null) {
      routeContent = <SectionContainer title={<SectionTitle slug={activeSettingsSection} />}>
        <CloudPreferencesError isRetrying={cloudPreferencesAccessError.isRetrying} onRetry={() => cloudPreferencesAccessError.retry()} />
      </SectionContainer>;
    } else if (shouldRenderRouteContent) {
      routeContent = <React.Suspense fallback={loading}>
        <Outlet key={selectedHostId} context={{ visibleSettingsSections, showEnterpriseUsageLabel,
          onClose: close, onSelectSection: selectSection, restoreUsageTabFocus }} />
      </React.Suspense>;
    }

    const selectTeam = (teamId: string, tab: string, afterNavigate?: SettingsAction) => {
      if (section === 'teams' && sectionMatch?.params['*'] === teamId) {
        afterNavigate?.();
        return;
      }
      requestNavigation(() => {
        setSearchTarget(null);
        navigate({ pathname: '/settings/teams/' + encodeURIComponent(teamId), search: tab === 'activity' ? '' : '?tab=' + tab },
          { replace: true, state: location.state });
        afterNavigate?.();
      });
    };
    const observeLegacyContent = deps.useResizeObserver((_entry, element) => actions.updateLegacyContentRect(element));
    const legacyContentRef = React.useCallback((element: HTMLElement | null) => {
      observeLegacyContent(element);
      if (element == null) actions.updateLegacyContentRect(null);
    }, [observeLegacyContent, actions]);
    const closeFromCommand = React.useEffectEvent(close);
    React.useEffect(() => deps.registerSettingsCommand(source => {
      if (source !== 'keyboard_shortcut') return false;
      closeFromCommand();
    }), []);

    if (shouldRedirectToVisibleSettingsSection) {
      return section === 'cloud-settings' && activeSettingsSection === 'cloud-environments'
        ? <Redirect to="/settings/cloud-environments?tab=preferences" state={location.state} replace={true} />
        : <Redirect to={deps.sectionPath(activeSettingsSection)} replace={true} />;
    }

    let sidebarSection = visibleSettingsSections.some(candidate => candidate.slug === 'usage')
      && ['analytics', 'consumer-view', 'usage-code-review'].includes(activeSettingsSection)
      ? 'usage' : deps.resolveSection(activeSettingsSection, settingsNavigationSections).sectionSlug;
    if (sidebarSection === 'age') sidebarSection = 'account';
    if (toolMatch != null) sidebarSection = matchesAvailableTool ? 'rosalind' : 'plugins-settings';
    const searchableSections = visibleSettingsSections.filter(candidate =>
      candidate.slug === 'cloud-settings' && settingsNavigationSections.some(section => section.slug === 'cloud-environments')
      || candidate.slug === 'local-environments' || settingsNavigationSections.includes(candidate));
    const sidebar = <Sidebar canCollapse={false} codexMicroDeviceModel={microDeviceModel}
      showEnterpriseUsageLabel={showEnterpriseUsageLabel} settingsSections={settingsNavigationSections}
      searchableSections={searchableSections} activeSection={sidebarSection} onClearHostFilter={clearHostFilter}
      searchHostId={selectedHostId} sidebarHostSelector={hostSelector}
      onSelect={(slug, targetText, route) => selectSection(slug, targetText, false, route)}
      onSelectPlugin={route => requestNavigation(() => navigate(route))} onSelectTeam={selectTeam}
      onBack={layout === 'legacy' ? close : undefined} groupSettingsSections={true} />;
    const navigationKey = `${location.key}:${searchTarget?.navigationKey ?? 0}`;
    const currentRoute = location.pathname + location.search + location.hash;
    return <>
      <DocumentTitle title={intl.formatMessage({ id: 'settings.documentTitle', defaultMessage: 'Settings',
        description: 'Window and browser tab title for app settings' })} />
      <Shell legacyContentRef={legacyContentRef} requestNavigation={requestNavigation} sidebar={sidebar}>
        <Content navigationKey={navigationKey} slateLayout={layout !== 'legacy'} targetId={location.hash.slice(1) || null}
          targetText={searchTarget?.route === currentRoute ? searchTarget.label : null}>{routeContent}</Content>
      </Shell>
      <UnsavedChangesDialog pendingNavigation={pendingNavigation} onClearPendingNavigation={() => setPendingNavigation(null)} />
    </>;
  };
}
