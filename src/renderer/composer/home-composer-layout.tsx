/** @jsxRuntime classic */
/** @jsx React.createElement */
import type { ComponentType, ReactNode } from 'react';

export type HomeComposerMode = 'chat' | 'work';
export type HomeComposerVariant = 'standard' | 'legacy' | 'lighthouse';

// Minimal controller surface used by the retained BBt/HBt layout children.
// This is a view of the existing editor controller, never a second controller.
export interface HomeComposerController {
  readonly view: { readonly dom: HTMLElement };
  getText: () => string;
}

// Controller, agent and prompt objects cross this presentation boundary intact.
// Their document/transport contracts remain owned by the upstream composer.
export interface HomeComposerLayoutProps {
  unifiedModelPickerEnabled?: boolean;
  preservePendingInput?: boolean;
  isCodexHome?: boolean;
  workspaceAgent?: unknown;
  homeComposerController?: HomeComposerController | null;
  homeComposerMode?: HomeComposerMode;
  homeComposerModeToggle?: ReactNode;
  onChatGptTaskSuggestionSelected?: (mode: HomeComposerMode) => void;
  taskSuggestionsLoading?: boolean;
  onTemporaryChatToggle?: () => void;
  projectId?: string | null;
  sharedPrompt?: unknown;
  showHomeUtilityBar?: boolean;
}

export interface HomeComposerLocation {
  pathname: string;
  search: string;
  state?: {
    aeonDraft?: unknown;
    sharedSnapshotId?: unknown;
    prefillPriorConversation?: unknown;
    pendingViewAction?: unknown;
    sidebarOnboardingChecklistCompletionOnSubmit?: unknown;
  } | null;
}

export interface LighthouseLayout {
  contentId: string;
  isOpen: boolean;
}

export interface HomeComposerLayoutDependencies {
  useSidebarOpen: () => boolean;
  useSidebarWidth: () => number;
  useMediaQuery: (query: string) => boolean;
  sidebarBreakpoint: string;
  useLocation: () => HomeComposerLocation;
  useIsWorkMode: () => boolean;
  useVoiceRequest: () => unknown;
  matchMissionControl: (pathname: string) => unknown;
  isTemporaryChat: (search: string) => boolean;
  useFeatureFlag: (key: string | false) => boolean;
  ModelPickerScope: unknown;
  ScopeProvider: ComponentType<{ scope: unknown; value: { enabled: boolean }; children?: ReactNode }>;
  KeyboardShortcuts: ComponentType;
  LegacyLayout: ComponentType<{ children?: ReactNode }>;
  ModeToggleWrapper: ComponentType<{ children?: ReactNode }>;
  WorkHomePage: ComponentType<{
    hideHeaderUpgrade: boolean;
    onTaskSuggestionSelected?: HomeComposerLayoutProps['onChatGptTaskSuggestionSelected'];
  }>;
  StandardLayout: ComponentType<HomeComposerLayoutProps & {
    hideHeaderUpgrade: boolean;
    lighthouse?: LighthouseLayout;
    prepareTaskSuggestionDestination: (mode: HomeComposerMode) => Promise<void>;
  }>;
  prepareTaskSuggestionDestination: (mode: HomeComposerMode) => Promise<void>;
}

/** RBt in App 26.1013.40934: selects the existing home layout and scope.
 * The shared editor, drafts, suggestions and submission handlers stay upstream. */
export function createHomeComposerLayoutComponent(
  React: typeof import('react'),
  deps: HomeComposerLayoutDependencies,
) {
  const { ScopeProvider, KeyboardShortcuts, LegacyLayout, ModeToggleWrapper,
    WorkHomePage, StandardLayout } = deps;

  return function HomeComposerLayout(props: HomeComposerLayoutProps = {}): ReactNode {
    const unifiedModelPickerEnabled = props.unifiedModelPickerEnabled === true;
    const sidebarOpen = deps.useSidebarOpen();
    const sidebarWidth = deps.useSidebarWidth();
    const wideScreen = deps.useMediaQuery(deps.sidebarBreakpoint);
    // Preserve the upstream media subscription, including its dynamic threshold.
    deps.useMediaQuery(`(min-width: ${672 + (sidebarOpen && wideScreen ? Math.max(sidebarWidth, 290) : 0)}px)`);
    const { pathname, search, state } = deps.useLocation();
    const contentId = React.useId();
    const workMode = deps.useIsWorkMode();
    const voiceRequest = deps.useVoiceRequest();
    const missionControl = deps.matchMissionControl(pathname) != null;
    const canUseAlternativeLayout = (workMode || missionControl)
      && !unifiedModelPickerEnabled
      && props.homeComposerMode === 'work'
      && (pathname === '/' || missionControl)
      && !deps.isTemporaryChat(search)
      && voiceRequest == null
      && state?.aeonDraft == null
      && state?.sharedSnapshotId == null
      && state?.prefillPriorConversation == null
      && state?.pendingViewAction == null
      && state?.sidebarOnboardingChecklistCompletionOnSubmit == null;
    const lighthouseEnabled = deps.useFeatureFlag(canUseAlternativeLayout ? '3226853936' : false);
    const legacyEnabled = deps.useFeatureFlag(canUseAlternativeLayout && !lighthouseEnabled ? '3480058756' : false);
    const variant: HomeComposerVariant = lighthouseEnabled && missionControl ? 'lighthouse'
      : legacyEnabled ? 'legacy' : 'standard';
    const [initialVariant] = React.useState(variant);
    const effectiveVariant = props.preservePendingInput ? initialVariant : variant;
    const lighthouse = React.useMemo(() => effectiveVariant === 'lighthouse'
      ? { contentId, isOpen: missionControl } : undefined, [contentId, missionControl, effectiveVariant]);
    const modelPickerValue = React.useMemo(() => ({ enabled: unifiedModelPickerEnabled }), [unifiedModelPickerEnabled]);

    return <ScopeProvider scope={deps.ModelPickerScope} value={modelPickerValue}>
      <KeyboardShortcuts />
      {effectiveVariant === 'legacy' ? <LegacyLayout>
        <div className="flex h-full min-h-0 flex-col">
          {props.homeComposerModeToggle == null ? null : <ModeToggleWrapper>{props.homeComposerModeToggle}</ModeToggleWrapper>}
          <div className="min-h-0 flex-1">
            {props.homeComposerController != null && <React.Suspense fallback={null}>
              <WorkHomePage hideHeaderUpgrade={false} onTaskSuggestionSelected={props.onChatGptTaskSuggestionSelected} />
            </React.Suspense>}
          </div>
        </div>
      </LegacyLayout> : <StandardLayout {...props} hideHeaderUpgrade={false} lighthouse={lighthouse}
        prepareTaskSuggestionDestination={deps.prepareTaskSuggestionDestination} />}
    </ScopeProvider>;
  };
}
