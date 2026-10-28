/** @jsxRuntime classic */
import type { ComponentType, Context, CSSProperties, ReactNode, RefObject } from 'react';

export type MarkdownRootDomain = {
  tokens: unknown;
  components: object;
  directives: unknown;
  listItemDecoration: unknown;
  openCodeFenceToken: unknown;
  renderRoot: unknown;
  renderText: unknown;
  streamingTokenKeys: unknown;
  mediaCacheKey: unknown;
  mediaPreviewKey: unknown;
  mediaPreview: unknown;
};
export type MarkdownResourcePolicy = 'allow' | 'restricted';
export type MarkdownMediaOptions<D extends MarkdownRootDomain> = {
  allowPlayableMedia: boolean;
  allowWideBlocks: boolean;
  animateImageEnter: boolean;
  conversationId: string | null;
  cwd: string | null;
  direction: 'auto' | 'ltr' | 'rtl';
  forceCodeBlockWordWrap: boolean;
  hideCodeBlocks?: boolean;
  hostId: string | null;
  mediaCacheKey?: D['mediaCacheKey'];
  mediaPresentation: string;
  externalResourcePolicy: MarkdownResourcePolicy;
  renderMedia: <P extends object>(component: ComponentType<P & {
    imagePreviewsRef: RefObject<Map<D['mediaPreviewKey'], D['mediaPreview']>>;
  }>, props: P) => ReactNode;
};
export type MarkdownRootProps<D extends MarkdownRootDomain> = {
  allowBasicHtml?: boolean;
  allowPlayableMedia?: boolean;
  allowWideBlocks?: boolean;
  animateMarkdown?: boolean;
  className?: string;
  components?: Partial<D['components']>;
  conversationId?: string | null;
  cwd?: string | null;
  direction?: 'auto' | 'ltr' | 'rtl';
  directives?: D['directives'];
  directiveIdPrefix?: string | null;
  externalResourcePolicy?: MarkdownResourcePolicy;
  forceCodeBlockWordWrap?: boolean;
  getDefaultComponents: (options: MarkdownMediaOptions<D>) => D['components'];
  getListItemDecorationProps?: D['listItemDecoration'];
  hideCodeBlocks?: boolean;
  hostId?: string | null;
  mediaCacheKey?: D['mediaCacheKey'];
  mediaPresentation?: string;
  openCodeFenceToken?: D['openCodeFenceToken'];
  renderRoot?: D['renderRoot'];
  renderText?: D['renderText'];
  streamingTokenKeys?: D['streamingTokenKeys'];
  suppressMathParseErrors?: boolean;
  textStyle?: { kind?: string; tone?: string; linkColor?: string };
  tokens: D['tokens'];
  trailingContent?: ReactNode;
};
export type MarkdownRootDependencies<D extends MarkdownRootDomain> = {
  ExternalResourcePolicyContext: Context<MarkdownResourcePolicy>;
  defaultHostId: string;
  markdownRootClassName: string;
  markdownIdAttribute: string;
  classNames: (...classes: (string | false | null | undefined)[]) => string;
  onCopy: (event: ClipboardEvent, root: HTMLDivElement) => void;
  renderTokens: (tokens: D['tokens'], options: {
    allowBasicHtml: boolean; components: D['components']; conversationId: string | null;
    directives?: D['directives']; directiveIdPrefix?: string | null; hostId: string | null; isUserMessage: boolean;
    getListItemDecorationProps?: D['listItemDecoration']; openCodeFenceToken?: D['openCodeFenceToken'];
    renderRoot?: D['renderRoot']; renderText?: D['renderText']; streamingTokenKeys?: D['streamingTokenKeys'];
    suppressMathParseErrors: boolean; trailingContent?: ReactNode;
  }) => ReactNode;
};

export function createMarkdownRootComponent<D extends MarkdownRootDomain>(
  React: typeof import('react'), dependencies: MarkdownRootDependencies<D>,
): ComponentType<MarkdownRootProps<D>> {
  const { ExternalResourcePolicyContext, defaultHostId, markdownRootClassName, markdownIdAttribute, classNames, onCopy, renderTokens } = dependencies;
  return function MarkdownRoot({ allowBasicHtml = false, allowPlayableMedia = true, allowWideBlocks = false,
    animateMarkdown = false, className, components, conversationId = null, cwd = null, direction = 'auto', directives,
    directiveIdPrefix, externalResourcePolicy = 'allow', forceCodeBlockWordWrap = false, getDefaultComponents,
    getListItemDecorationProps, hideCodeBlocks, hostId = defaultHostId, mediaCacheKey, mediaPresentation = 'default',
    openCodeFenceToken, renderRoot, renderText, streamingTokenKeys, suppressMathParseErrors = false, textStyle, tokens,
    trailingContent }: MarkdownRootProps<D>) {
    const id = React.useId();
    const rootRef = React.useRef<HTMLDivElement>(null);
    const imagePreviewsRef = React.useRef(new Map<D['mediaPreviewKey'], D['mediaPreview']>());
    const parentPolicy = React.useContext(ExternalResourcePolicyContext);
    const policy: MarkdownResourcePolicy = externalResourcePolicy === 'restricted' || parentPolicy === 'restricted' ? 'restricted' : 'allow';
    const renderMedia = React.useCallback(<P extends object>(component: ComponentType<P & {
      imagePreviewsRef: RefObject<Map<D['mediaPreviewKey'], D['mediaPreview']>>;
    }>, props: P) => React.createElement(component, { ...props, imagePreviewsRef }), []);
    const options = React.useMemo(() => ({ allowPlayableMedia, allowWideBlocks, animateImageEnter: animateMarkdown,
      conversationId, cwd, direction, forceCodeBlockWordWrap, hideCodeBlocks, hostId, mediaCacheKey, mediaPresentation,
      externalResourcePolicy: policy, renderMedia }), [allowPlayableMedia, allowWideBlocks, animateMarkdown, conversationId,
      cwd, direction, forceCodeBlockWordWrap, hideCodeBlocks, hostId, mediaCacheKey, mediaPresentation, policy, renderMedia]);
    const defaultComponents = React.useMemo(() => getDefaultComponents(options), [getDefaultComponents, options]);
    React.useEffect(() => {
      const root = rootRef.current;
      if (root == null) return;
      const document = root.ownerDocument;
      const handleCopy = (event: ClipboardEvent) => onCopy(event, root);
      document.addEventListener('copy', handleCopy, { capture: true });
      return () => document.removeEventListener('copy', handleCopy, { capture: true });
    }, []);
    const content = React.useMemo(() => renderTokens(tokens, { allowBasicHtml, components: { ...defaultComponents, ...components },
      conversationId, directives, directiveIdPrefix, hostId, isUserMessage: textStyle?.tone === 'user-message',
      getListItemDecorationProps, openCodeFenceToken, renderRoot, renderText, streamingTokenKeys, suppressMathParseErrors,
      trailingContent }), [tokens, allowBasicHtml, defaultComponents, components, conversationId, directives, directiveIdPrefix,
      hostId, textStyle?.tone, getListItemDecorationProps, openCodeFenceToken, renderRoot, renderText, streamingTokenKeys,
      suppressMathParseErrors, trailingContent]);
    return <ExternalResourcePolicyContext.Provider value={policy}><div ref={rootRef} {...{ [markdownIdAttribute]: id }} dir={direction}
      data-markdown-animated={animateMarkdown ? '' : undefined} data-markdown-text-style={textStyle?.kind}
      data-markdown-text-tone={textStyle?.tone} className={classNames(markdownRootClassName, '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0', className)}
      style={{ '--markdown-link-color': textStyle?.linkColor ?? 'currentColor' } as CSSProperties}>{content}</div></ExternalResourcePolicyContext.Provider>;
  };
}
