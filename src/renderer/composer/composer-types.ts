import type * as React from 'react';

export interface ComposerDocument {
  content: { size: number };
  textBetween(from: number, to: number, separator: string): string;
  descendants(visitor: (node: { isTextblock: boolean }, position: number) => boolean | void): void;
}

export interface ComposerTransaction {
  doc: ComposerDocument;
  replaceWith(from: number, to: number, content: unknown): ComposerTransaction;
  setSelection(selection: unknown): ComposerTransaction;
}

export interface ComposerController {
  view: {
    dom: HTMLElement;
    isDestroyed: boolean;
    state: {
      doc: ComposerDocument;
      schema: unknown;
      tr: ComposerTransaction;
      selection: { $from: { parent: { type: { name: string } } } };
    };
    dispatch(transaction: ComposerTransaction): void;
    hasFocus(): boolean;
    nodeDOM(position: number): Node | null;
  };
  eventEmitter: {
    addListener(event: 'composer-suggestion-ui-event', listener: (event: unknown) => void): void;
    removeListener(event: 'composer-suggestion-ui-event', listener: (event: unknown) => void): void;
  };
  inlineMentionIconRegistry: {
    subscribe(listener: () => void): () => void;
    getSnapshot(): readonly unknown[];
  };
  initialInputFocused?: boolean | null;
  getText(document?: ComposerDocument): string;
  getPersistedText(): string;
  setText(text: string): void;
  setPromptText(text: string): void;
  restoreText(text: string): void;
  focus(position?: 'end'): void;
  setPlaceholder(placeholder: string | undefined): void;
  setInputActive(active: boolean): void;
  clearInitialInputFocus(): void;
  addSubmitHandler(handler: (durationMs?: number) => void): () => void;
  cancelPendingSubmit(): void;
  setSubmitReady(ready: boolean): void;
  hasStandaloneBrowserAutocompleteMention(): boolean;
  dismissStandaloneBrowserAutocompleteMentionOnBlur(): void;
  cancelBrowserAutocompleteMentionDismissal(): void;
  getBrowserAutocompleteMentionDismissalSnapshot(): boolean;
  completeBrowserAutocompleteMentionDismissal(): void;
  updateLink(element: Element, text: string, href: string | null): void;
  consumeLocationPromptPrefill(locationKey: string): boolean;
  setEnterBehavior(behavior: string): void;
  setPlainTextMode(enabled: boolean): void;
  destroy(): void;
}

export type ComposerTextKind = 'plain' | 'prompt' | 'literal' | 'literal-prompt' | 'sites-prompt';

export interface ComposerControllerOptions {
  addInitialContentToHistory?: boolean;
  enableCodeBlocks?: boolean;
  enableFileMentions?: boolean;
  enableRichText?: boolean;
  enableSelectedTextLinks?: boolean;
  enableSkillMentions?: boolean;
  enableSlashCommands?: boolean | { triggers?: string[] };
  enterBehavior?: string;
  restoreMarkdownLinksAsTextLinks?: boolean;
  restorePathLinksAsFileMentions?: boolean;
}

export interface ComposerInitialContent {
  defaultText?: string;
  defaultTextKind?: ComposerTextKind;
  initialDocument?: ComposerDocument;
}

export interface PendingComposerInput {
  element: HTMLInputElement | HTMLTextAreaElement;
  locationKey: string;
}

export interface ComposerControllerProviderProps {
  children?: React.ReactNode | ((controller: ComposerController | null) => React.ReactNode);
  composerController?: ComposerController | null;
  controllerOptions?: ComposerControllerOptions;
  defaultText?: string;
  defaultTextKind?: ComposerTextKind;
  initialDocument?: ComposerDocument;
  getInitialContent?: (plainTextMode: boolean) => ComposerInitialContent | null | undefined;
  getInitialInput?: () => PendingComposerInput | null;
  initialSuggestionOptions?: object;
  onDocumentChange?: (document: ComposerDocument, plainTextMode: boolean) => void;
  onDocumentDispose?: (document: ComposerDocument, plainTextMode: boolean) => void;
  renderWhilePending?: boolean;
}

export interface ComposerControllerCreateOptions extends ComposerControllerOptions {
  enableCodeBlocks: boolean;
  enableRichText: boolean;
  enableSelectedTextLinks: boolean;
  defaultTextKind?: ComposerTextKind;
  initialDocument?: ComposerDocument;
  onDocumentChange: (document: ComposerDocument, plainTextMode: boolean) => void;
  plainTextMode: boolean;
  suggestionOptions?: object;
}

export interface ComposerControllerDependencies {
  ControllerContext: React.Context<ComposerController | null>;
  useEnterBehavior(): string;
  usePlainTextMode(): boolean;
  useIsHydrating(): boolean;
  flushSync(callback: () => void): void;
  createController(text: string | undefined, options: ComposerControllerCreateOptions): ComposerController;
  documentFromText(options: { schema: unknown; text: string }): { content: unknown };
  createTextSelection(document: ComposerDocument, anchor: number, head: number): unknown;
}

export type ComposerLayout = 'single-line' | 'multiline';
export type ComposerSurfacePlacement =
  | { kind: 'home'; chromeMode?: string }
  | { kind: 'thread' | 'document' | 'embedded' | 'hotkey' | 'panel' }
  | { kind: 'comment'; surfaceVariant: string };

export interface ComposerLayoutState {
  layout: ComposerLayout;
  setComposerWidthMeasureRef: React.Ref<HTMLElement>;
  onSingleLineOverflowChange?: (overflowing: boolean) => void;
  onCompositionStateChange?: (composing: boolean) => void;
}

export type ComposerMention =
  | { kind: 'file'; path: string; fsPath: string; isFolder: boolean }
  | { kind: 'skill' | 'app' | 'plugin' | 'mcp-resource'; path: string }
  | { kind: 'chatgpt-conversation'; conversationId: string; title: string }
  | { kind: 'page-reference'; pageId: string; blockId: string | null; title: string };

export type ComposerSuggestionEvent =
  | { type: 'close'; kind: string }
  | { type: 'submit'; kind: string; action: unknown };

export interface ComposerEditorProps {
  composerController: ComposerController;
  allowRemoteImages?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  minHeight?: number | string;
  inputFrameVariant?: string;
  disableAutoFocus?: boolean;
  focusRequestNonce?: number | string | null;
  isFocusComposerTarget?: boolean;
  linkOpenTarget?: string;
  submitReady?: boolean;
  onSubmit?: (durationMs?: number) => void;
  onUserInput?: React.FormEventHandler<HTMLElement>;
  onMentionActivate?: (mention: ComposerMention) => boolean | void;
  onSuggestionHandler?: (event: ComposerSuggestionEvent) => void;
  centerPlaceholder?: boolean;
  placeholderContent?: React.ReactNode;
  accessibleStatus?: React.ReactNode;
  workingStartedAtMs?: number | null;
  readOnlyContent?: React.ReactNode;
}

export interface ComposerInteractionProps {
  blockReason?: unknown;
  hasDropTargetPortal?: boolean;
  handleDropLocally?: boolean;
  isDragActive?: boolean;
  isSubmitting?: boolean;
  showShiftOverlay?: boolean;
  onDragEnter?: React.DragEventHandler<HTMLElement>;
  onDragOver?: React.DragEventHandler<HTMLElement>;
  onDragLeave?: React.DragEventHandler<HTMLElement>;
  onDrop?: React.DragEventHandler<HTMLElement>;
}

export interface ComposerDictationControls {
  showTranscript?: boolean;
  waveformCanvasRef?: React.Ref<HTMLCanvasElement>;
  dictationButton?: React.ReactNode;
  leadingControl?: React.ReactNode;
  modelPicker?: React.ReactNode;
  sendButton?: React.ReactNode;
}

export interface ComposerLegacyDictation {
  transcriptionAction?: 'insert' | 'send' | null;
  waveformCanvasRef?: React.Ref<HTMLCanvasElement>;
  stopDictation(action: 'abort' | 'insert' | 'send'): void;
  leadingAccessory?: React.ReactNode;
  primaryIcon?: React.ReactNode;
  noHorizontalPadding?: boolean;
  tooltipPortalContainer?: HTMLElement | null;
  chatgpt?: boolean;
  sendDisabled?: boolean;
}

export interface ComposerRealtimeVoice {
  isMicrophoneMuted: boolean;
  isMuted: boolean;
  modelPicker?: React.ReactNode;
  phase: 'starting' | 'active' | 'stopping';
  sendAction?: React.ReactNode;
  toggleMicrophoneMute(): void;
  toggleMute(): void;
  waveformCanvasRef?: React.Ref<HTMLCanvasElement>;
  stop(): void;
  tooltipPortalContainer?: HTMLElement | null;
}

export interface ComposerVoiceProps {
  recording?: React.ReactNode;
  legacyDictation?: ComposerLegacyDictation | null;
  realtime?: ComposerRealtimeVoice | null;
  hideEditor?: boolean;
  dictation?: ComposerDictationControls | (ComposerDictationControls & { controls: React.ReactNode }) | null;
  dictationEnabled?: boolean;
}

export interface MainComposerViewProps {
  layoutState: ComposerLayoutState;
  editor: ComposerEditorProps;
  surfacePlacement: ComposerSurfacePlacement;
  hasVisibleAttachments: boolean;
  attachments?: React.ReactNode;
  attachmentRef?: React.Ref<HTMLElement>;
  attachmentsHidden?: boolean;
  imageMarkupAttachment?: React.ReactNode;
  replyContext?: React.ReactNode;
  header?: React.ReactNode;
  inputIntegrations?: React.ReactNode;
  leadingActions?: React.ReactNode;
  modelControl?: React.ReactNode;
  secondaryActions?: React.ReactNode;
  primaryAction?: React.ReactNode;
  expansionControl?: React.ReactNode;
  bodyRef?: React.Ref<HTMLElement>;
  footerRef?: React.Ref<HTMLElement>;
  trailingControlsRef?: React.Ref<HTMLElement>;
  actionsRef?: React.Ref<HTMLElement>;
  inputInert?: boolean;
  isInteractionBlocked?: boolean;
  isGoalMode?: boolean;
  workHome?: boolean;
  voice?: ComposerVoiceProps;
  interaction?: ComposerInteractionProps;
}

interface PartProps { children?: React.ReactNode; ref?: React.Ref<HTMLElement> }

export interface MainComposerViewDependencies {
  MotionContext: React.Context<string>;
  PresentationContext: React.Context<{ quickChatComposerPresentation?: { shouldReduceMotion?: boolean } | null }>;
  classNames(...classes: (string | false | null | undefined)[]): string;
  mergeRefs(first: React.Ref<HTMLElement>, second?: React.Ref<HTMLElement>): React.Ref<HTMLElement>;
  Editor: React.ComponentType<Omit<ComposerEditorProps, 'centerPlaceholder' | 'placeholderContent' | 'accessibleStatus' | 'readOnlyContent'> & {
    className: string;
    workingStartedAtMs: number | null;
    singleLine: boolean;
    onSingleLineOverflowChange?: (overflowing: boolean) => void;
    onCompositionStateChange?: (composing: boolean) => void;
  }>;
  Surface: React.ComponentType<ComposerInteractionProps & PartProps & {
    animateRadius: boolean;
    utilityBarVariant: 'home' | 'default';
    layout: ComposerLayout;
    renderOwnSurface: boolean;
    surfaceVariant?: string;
    surfaceOverflow?: 'visible';
    density: 'compact' | 'default';
    radiusVariant?: 'default' | 'compact';
  }>;
  Parts: {
    Input: React.ComponentType<PartProps & { hidden?: boolean; inert?: boolean; layout: ComposerLayout; placeholderContent?: React.ReactNode; spacing: 'flush' | 'default'; variant: 'work-home' | 'default' }>;
    Attachments: React.ComponentType<PartProps & { hasVisibleAttachments: boolean; hidden: boolean; spacing: 'flush' | 'default' }>;
    ReplyContext: React.ComponentType<PartProps>;
    Body: React.ComponentType<PartProps & { animateHeight: boolean; layout: ComposerLayout }>;
    AdaptiveFooter: React.ComponentType<PartProps & { input: React.ReactNode; dictation?: { showTranscript?: boolean; controls: React.ReactNode }; dictationEnabled?: boolean; isVoiceLayout: boolean; layout: ComposerLayout; spacing: 'flush' | 'default'; leadingControls: React.ReactNode; trailingControls: React.ReactNode }>;
    FooterInlineControls: React.ComponentType<PartProps & { gap: 'normal' }>;
    FooterControls: React.ComponentType<PartProps & { layout: ComposerLayout }>;
    FooterExpandingControls: React.ComponentType<PartProps>;
    FooterAction: React.ComponentType<PartProps>;
    FooterActions: React.ComponentType<PartProps & { spacing: 'none' }>;
  };
  LegacyDictation: React.ComponentType<ComposerLegacyDictation & { noBottomMargin: boolean }>;
  RealtimeVoice: React.ComponentType<ComposerRealtimeVoice & { noBottomMargin: boolean }>;
  DictationControls: React.ComponentType<ComposerDictationControls>;
}
