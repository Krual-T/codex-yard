/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import type * as ReactTypes from 'react';
import type {
  ComposerController,
  ComposerControllerProviderProps,
  ComposerDocument,
  ComposerSurfacePlacement,
} from './composer-types.ts';

export interface ComposerDraftScope {
  value: {
    kind: 'new' | 'local' | 'cloud' | 'chatgpt' | 'other';
    placement?: string;
    conversationId?: string | null;
    clientThreadId?: string | null;
  };
}

export interface ComposerDraftDocument {
  document: ComposerDocument;
  plainTextMode: boolean;
}

export interface ComposerDraftSnapshot extends ComposerDraftDocument {
  prompt: string;
}

export interface ComposerDraftScopeProps {
  scope: ComposerDraftScope;
  draftKey: string;
  conversationId: string | null | undefined;
  isWorkspaceStarter: boolean;
  rootClassName: string;
  surfacePlacement: ComposerSurfacePlacement;
  showSurface: boolean;
  plainTextMode: boolean;
  defaultPrompt?: string | null;
  composerController?: ComposerController | null;
  onPlainTextChange?: (text: string) => void;
  aboveComposerContent?: ReactTypes.ReactNode;
  aboveComposerContentLayout: 'floating' | 'header';
  hotkeyWindowHomeFooterControls?: ReactTypes.ReactNode;
  workSettingsQuery?: { isError: boolean; refetch(): unknown } | null;
  composer: ReactTypes.ReactNode;
}

export interface ComposerDraftScopeDependencies {
  ComposerProvider: ReactTypes.ComponentType<ComposerControllerProviderProps>;
  EnvironmentSetup: ReactTypes.ComponentType<{ threadId: string | null }>;
  WorkspaceBanner: ReactTypes.ComponentType;
  WorkspaceFooter: ReactTypes.ComponentType;
  SettingsError: ReactTypes.ComponentType<{ operation: 'load'; onReload(): void }>;
  isClientThreadId(value: string | null | undefined): boolean;
  hasProtectedDraft(scope: ComposerDraftScope): boolean;
  getSnapshot(scope: ComposerDraftScope): ComposerDraftSnapshot | null | undefined;
  getDocument(scope: ComposerDraftScope): ComposerDraftDocument | null | undefined;
  getPersistedText(scope: ComposerDraftScope): string;
  serializeDocument(document: ComposerDocument, options: {
    preserveTextLinkMarks: true;
    preserveUnresolvedSkillMentions?: true;
  }): { content: string };
  isPrompt(text: string): boolean;
  writeDocument(scope: ComposerDraftScope, document: ComposerDocument, plainTextMode: boolean): void;
  preserveDocument(scope: ComposerDraftScope, document: ComposerDraftDocument): void;
}

export function createComposerDraftScopeComponent(
  React: typeof ReactTypes,
  dependencies: ComposerDraftScopeDependencies,
): ReactTypes.ComponentType<ComposerDraftScopeProps> {
  const { ComposerProvider, EnvironmentSetup, WorkspaceBanner, WorkspaceFooter, SettingsError } = dependencies;

  function ComposerDraftScope({
    scope,
    draftKey,
    conversationId,
    isWorkspaceStarter,
    rootClassName,
    surfacePlacement,
    showSurface,
    plainTextMode,
    defaultPrompt,
    composerController,
    onPlainTextChange,
    aboveComposerContent,
    aboveComposerContentLayout,
    hotkeyWindowHomeFooterControls,
    workSettingsQuery,
    composer,
  }: ComposerDraftScopeProps): ReactTypes.ReactNode {
    const reuseDraft = React.useMemo(
      () => defaultPrompt == null && !dependencies.hasProtectedDraft(scope),
      [defaultPrompt, scope],
    );
    const { document, text } = React.useMemo(() => {
      const snapshot = reuseDraft ? dependencies.getSnapshot(scope) : undefined;
      const document = reuseDraft
        ? dependencies.getDocument(scope) ?? (
          snapshot?.prompt === dependencies.getPersistedText(scope) ? snapshot : undefined
        )
        : undefined;
      const text = defaultPrompt ?? (
        document != null && document.plainTextMode !== plainTextMode
          ? dependencies.serializeDocument(document.document, {
            preserveTextLinkMarks: true,
            preserveUnresolvedSkillMentions: true,
          }).content
          : dependencies.getPersistedText(scope)
      );
      return { document, text };
    }, [reuseDraft, defaultPrompt, plainTextMode, scope]);

    const onDocumentChange = React.useCallback((nextDocument: ComposerDocument, mode: boolean) => {
      if (showSurface) {
        dependencies.writeDocument(scope, nextDocument, mode);
        onPlainTextChange?.(dependencies.serializeDocument(nextDocument, { preserveTextLinkMarks: true }).content);
      }
    }, [onPlainTextChange, scope, showSurface]);
    const onDocumentDispose = React.useCallback((nextDocument: ComposerDocument, mode: boolean) => {
      if (showSurface && dependencies.getPersistedText(scope).length > 0) {
        dependencies.preserveDocument(scope, { document: nextDocument, plainTextMode: mode });
      }
    }, [scope, showSurface]);

    const value = scope.value;
    const showEnvironmentSetup = value.kind === 'local' && value.placement === 'main';
    const setupThreadId = showEnvironmentSetup
      ? value.conversationId ?? (dependencies.isClientThreadId(value.clientThreadId) ? value.clientThreadId ?? null : null)
      : null;
    const floatingContent = hotkeyWindowHomeFooterControls == null && aboveComposerContent && aboveComposerContentLayout === 'floating'
      ? <div className="px-[var(--home-composer-inline-inset)] pb-2 empty:hidden has-[[data-home-beacon-banner]]:px-0">{aboveComposerContent}</div>
      : null;
    const settingsError = workSettingsQuery?.isError
      ? <div className="px-[var(--home-composer-inline-inset)] pb-2 empty:hidden">
        <SettingsError operation="load" onReload={() => { workSettingsQuery.refetch(); }} />
      </div>
      : null;

    return <div className={rootClassName} data-codex-composer-root="" data-composer-placement={surfacePlacement.kind}>
      <div data-above-composer-portal={true} data-above-composer-conversation-id={conversationId ?? undefined}
        className="relative px-[var(--home-composer-inline-inset)] empty:hidden electron:grid">
        {showEnvironmentSetup ? <EnvironmentSetup threadId={setupThreadId} /> : null}
      </div>
      <ComposerProvider key={draftKey}
        composerController={composerController}
        defaultText={text}
        defaultTextKind={dependencies.isPrompt(text) ? 'prompt' : 'plain'}
        initialDocument={document?.plainTextMode === plainTextMode ? document.document : undefined}
        onDocumentChange={onDocumentChange}
        onDocumentDispose={onDocumentDispose}>
        {isWorkspaceStarter ? <WorkspaceBanner /> : null}
        {isWorkspaceStarter ? <WorkspaceFooter /> : null}
        {null}
        {floatingContent}
        {settingsError}
        {composer}
      </ComposerProvider>
    </div>;
  }

  return ComposerDraftScope;
}
