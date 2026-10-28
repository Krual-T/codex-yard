/** @jsxRuntime classic */
import type { ComponentType, MouseEvent, ReactNode, Ref } from 'react';
import type { CodeBlockClipboardContent } from './code-block.tsx';

type MessageDescriptor = { id: string; defaultMessage: string; description: string };
type IconProps = { className?: string };
type ButtonProps = {
  children: ReactNode;
  'aria-label'?: string;
  'aria-pressed'?: boolean;
  allowShrink?: boolean;
  disabled?: boolean;
  color: 'ghost' | 'ghostActive';
  size: 'icon' | 'composerSm' | 'imageToolbar';
  uniform?: boolean;
  className?: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  onMouseDown?: (event: MouseEvent<HTMLButtonElement>) => void;
};
type TooltipProps = {
  children: ReactNode;
  tooltipContent: ReactNode;
  cloneCustomTrigger?: boolean;
  openWhen?: 'trigger-overflows';
};
type CopyButtonProps = {
  variant: 'default' | 'codeBlock' | 'toolbar';
  ariaLabel: string;
  iconClassName: string;
  iconOnly: boolean;
  buttonText: string;
  onCopy: (event: MouseEvent<HTMLButtonElement>) => Promise<boolean>;
};

type CodeBlockStyles = {
  Root: string;
  CodeSurface: string;
  Surface: string;
  WithPreview: string;
  FloatingControls: string;
  Source: string;
  FloatingSource: string;
  Preview: string;
  PreviewHidden: string;
  ActionBar: string;
  FloatingActionBar: string;
  StickyActionBar: string;
};

export type CodeBlockFrameProps = {
  ref?: Ref<HTMLDivElement>;
  source: ReactNode;
  sourceRef?: Ref<HTMLDivElement>;
  title?: ReactNode;
  content: string;
  clipboardContent?: CodeBlockClipboardContent;
  language?: string;
  allowPreview?: boolean;
  codeCopyText?: string;
  actionButtons?: ReactNode;
  trailingActionButtons?: ReactNode;
  alternateContent?: ReactNode;
  previewContent?: ReactNode;
  isShowingPreview?: boolean;
  preview?: { sourceVisible?: boolean; setSourceVisible?: (visible: boolean) => void; source?: string };
  shouldWrapCode?: boolean;
  onToggleWrapCode?: (event: MouseEvent<HTMLButtonElement>) => void;
  wrapCodeDisabled?: boolean;
  showCopyButton?: boolean;
  copyButtonText?: string;
  onCopyCode?: () => void;
  className?: string;
  sourceClassName?: string;
  removeTopBorderRadius?: boolean;
  showActionBar?: boolean;
  showStickyRightContent?: boolean;
  stickyHeader?: boolean;
  variant?: 'default' | 'preview' | 'hover';
};

export type CodeBlockFrameDependencies = {
  useIsDark: () => boolean;
  useIntl: () => { formatMessage: (message: MessageDescriptor) => string };
  normalizeLanguage: (language: string) => string | null;
  CopyButton: ComponentType<CopyButtonProps>;
  Tooltip: ComponentType<TooltipProps>;
  Button: ComponentType<ButtonProps>;
  FormattedMessage: ComponentType<MessageDescriptor>;
  LatexPreview: ComponentType<{ source: string }>;
  WrapEnabledIcon: ComponentType<IconProps>;
  WrapDisabledIcon: ComponentType<IconProps>;
  WrappedIcon: ComponentType<IconProps>;
  UnwrappedIcon: ComponentType<IconProps>;
  CodeIcon: ComponentType<IconProps>;
  copyToClipboard: (content: CodeBlockClipboardContent, event: MouseEvent<HTMLButtonElement>) => Promise<boolean>;
  styles: CodeBlockStyles;
  classNames: (...classes: (string | false | null | undefined)[]) => string;
};

export function createCodeBlockFrameComponent(
  React: typeof import('react'),
  dependencies: CodeBlockFrameDependencies,
): ComponentType<CodeBlockFrameProps> {
  const {
    useIsDark, useIntl, normalizeLanguage, CopyButton, Tooltip, Button, FormattedMessage, LatexPreview,
    WrapEnabledIcon, WrapDisabledIcon, WrappedIcon, UnwrappedIcon, CodeIcon, copyToClipboard, styles, classNames,
  } = dependencies;

  function ActionBar({ floating, removeTopBorderRadius, sticky, variant, children }: {
    floating: boolean;
    removeTopBorderRadius?: boolean;
    sticky: boolean;
    variant: 'default' | 'preview' | 'hover';
    children: ReactNode;
  }) {
    let padding = 'px-2 py-1 text-codex-description';
    if (floating) padding = styles.FloatingActionBar;
    else if (variant === 'default') padding = 'min-h-12 gap-2 py-1.5 ps-4 pe-1.5 font-medium text-default md:ps-5';
    return <div
      data-markdown-copy="exclude"
      contentEditable={false}
      className={classNames(
        'flex items-center font-sans text-sm select-none', styles.ActionBar, padding,
        sticky && 'sticky z-10', sticky && variant !== 'default' && 'border-b border-default',
        sticky && styles.StickyActionBar, !floating && !removeTopBorderRadius && variant !== 'default' && 'rounded-t-lg',
      )}
    >{children}</div>;
  }

  function PreviewToggle({ sourceVisible, onToggle }: { sourceVisible: boolean; onToggle: () => void }) {
    const label = sourceVisible
      ? <FormattedMessage id="pageCodeBlock.showPreview" defaultMessage="Show preview" description="Button to preview a LaTeX code block as a typeset equation" />
      : <FormattedMessage id="pageCodeBlock.showSource" defaultMessage="Show source" description="Button to show the source of a code block instead of its rendered preview" />;
    return <Tooltip cloneCustomTrigger={true} openWhen="trigger-overflows" tooltipContent={label}>
      <Button allowShrink={true} color="ghost" size="composerSm" onMouseDown={event => event.preventDefault()} onClick={onToggle}>
        <span className="truncate" data-tooltip-overflow-target={true}>{label}</span>
      </Button>
    </Tooltip>;
  }

  return function CodeBlockFrame({
    ref, source, sourceRef, title, content, clipboardContent, language, allowPreview = false, codeCopyText,
    actionButtons, trailingActionButtons, alternateContent, previewContent, isShowingPreview = false, preview,
    shouldWrapCode = false, onToggleWrapCode, wrapCodeDisabled = false, showCopyButton = true, copyButtonText,
    onCopyCode, className, sourceClassName, removeTopBorderRadius, showActionBar = true,
    showStickyRightContent = true, stickyHeader = false, variant = 'default',
  }: CodeBlockFrameProps) {
    const isDark = useIsDark();
    const intl = useIntl();
    const [localSourceVisible, setLocalSourceVisible] = React.useState(false);
    const hasLatexPreview = allowPreview && language != null && normalizeLanguage(language) === 'latex'
      && content.trim().length > 0 && !/\\(?:documentclass\b|begin\s*\{document\})/.test(content);
    const sourceVisible = preview?.sourceVisible ?? localSourceVisible;
    const setSourceVisible = preview?.setSourceVisible ?? setLocalSourceVisible;
    const copyContent = clipboardContent ?? content;
    const wrapLabel = shouldWrapCode
      ? intl.formatMessage({ id: 'codeSnippet.wrap.disable', defaultMessage: 'Disable word wrap', description: 'Button to disable word wrap for a code snippet' })
      : intl.formatMessage({ id: 'codeSnippet.wrap.enable', defaultMessage: 'Enable word wrap', description: 'Button to enable word wrap for a code snippet' });
    const copyLabel = copyButtonText ?? intl.formatMessage({
      id: 'copyButton.copyCode', defaultMessage: 'Copy code', description: 'Button to copy the contents of the code snippet to the clipboard',
    });
    const handleCopy = (event: MouseEvent<HTMLButtonElement>) => {
      const result = copyToClipboard(copyContent, event);
      onCopyCode?.();
      return result;
    };
    const theme = isDark ? 'dark' : 'light';
    const buttonSize = hasLatexPreview ? 'composerSm' : variant === 'default' ? 'imageToolbar' : 'icon';
    const copyVariant = hasLatexPreview ? 'codeBlock' : variant === 'default' ? 'toolbar' : 'default';
    const WrapIcon = shouldWrapCode ? WrapEnabledIcon : WrapDisabledIcon;
    const wrapIcon = hasLatexPreview || variant === 'default'
      ? (shouldWrapCode ? <WrappedIcon /> : <UnwrappedIcon />)
      : <WrapIcon className="icon-2xs" />;

    const actionBar = showActionBar ? <ActionBar
      floating={hasLatexPreview}
      removeTopBorderRadius={removeTopBorderRadius}
      sticky={stickyHeader && !isShowingPreview && !hasLatexPreview}
      variant={variant}
    >
      {!hasLatexPreview && variant === 'default' && title != null ? <CodeIcon /> : null}
      <div className={classNames('min-w-0 flex-1 truncate', (hasLatexPreview || variant === 'preview') && 'flex h-token-button-composer-sm items-center')}>{title}</div>
      <div className={classNames('ms-auto flex items-center', variant === 'default' ? 'min-w-0 max-w-full' : 'shrink-0')}>
        {showStickyRightContent ? <div
          data-code-block-controls={true}
          role="presentation"
          className={classNames(
            'flex items-center gap-px print:hidden', hasLatexPreview && styles.FloatingControls,
            !hasLatexPreview && variant === 'default' && 'flex-wrap justify-end',
            !hasLatexPreview && variant === 'preview' && 'opacity-0 group-hover/code-snippet:opacity-100 group-focus-within/code-snippet:opacity-100',
          )}
          onMouseDown={hasLatexPreview ? event => {
            if (event.target instanceof Node && event.currentTarget.contains(event.target)) event.preventDefault();
          } : undefined}
        >
          {hasLatexPreview ? <PreviewToggle sourceVisible={sourceVisible} onToggle={() => setSourceVisible(!sourceVisible)} /> : null}
          {variant === 'default' ? null : actionButtons}
          {onToggleWrapCode != null ? <Tooltip tooltipContent={wrapLabel}>
            <Button
              aria-label={wrapLabel}
              aria-pressed={shouldWrapCode}
              disabled={wrapCodeDisabled}
              color={!hasLatexPreview && variant === 'default' ? 'ghostActive' : 'ghost'}
              size={buttonSize}
              uniform={hasLatexPreview || variant === 'default'}
              className={!hasLatexPreview && shouldWrapCode ? 'hover:text-default' : undefined}
              onClick={onToggleWrapCode}
            >{wrapIcon}</Button>
          </Tooltip> : null}
          {variant === 'default' ? actionButtons : null}
          {showCopyButton ? <CopyButton variant={copyVariant} ariaLabel={copyLabel} iconClassName="icon-xs" iconOnly={true} buttonText={copyLabel} onCopy={handleCopy} /> : null}
          {trailingActionButtons}
        </div> : null}
      </div>
    </ActionBar> : null;

    const sourceContent = isShowingPreview && previewContent != null ? null : alternateContent ?? <div
      ref={sourceRef}
      data-code-block-source={true}
      hidden={hasLatexPreview && !sourceVisible}
      inert={hasLatexPreview && !sourceVisible}
      className={classNames(
        'text-size-chat overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        styles.Source, shouldWrapCode ? 'wrap-anywhere whitespace-pre-wrap' : 'whitespace-pre',
        hasLatexPreview && styles.FloatingSource, hasLatexPreview && styles.CodeSurface,
        !hasLatexPreview && variant === 'hover' && 'p-0',
        !hasLatexPreview && variant === 'default' && (showActionBar ? 'px-4 pt-0 pb-3 md:px-5' : 'p-4 md:px-5'),
        !hasLatexPreview && variant === 'preview' && 'max-h-[calc(15lh+var(--spacing)*4)] p-2', sourceClassName,
      )}
      tabIndex={variant === 'preview' ? 0 : undefined}
      dir="ltr"
    >{source}</div>;
    const renderedLatex = hasLatexPreview ? <div
      data-code-block-preview={true}
      data-markdown-copy={sourceVisible ? 'exclude' : 'contents'}
      contentEditable={false}
      className={classNames(styles.Preview, sourceVisible && styles.PreviewHidden)}
      inert={sourceVisible}
    ><LatexPreview source={preview?.source ?? content} /></div> : null;
    return <div
      ref={ref}
      data-code-block={true}
      data-source-visible={hasLatexPreview ? sourceVisible : undefined}
      data-markdown-copy="code-block"
      data-markdown-copy-text={codeCopyText ?? (hasLatexPreview ? content : undefined)}
      data-theme={theme}
      className={classNames(
        'relative', styles.Root, variant === 'hover' ? 'w-auto overflow-visible bg-transparent' : 'w-full min-w-0 contain-inline-size',
        !hasLatexPreview && variant !== 'hover' && 'overflow-clip',
        !hasLatexPreview && variant === 'preview' && 'group/code-snippet rounded-lg border border-default bg-surface text-default',
        !hasLatexPreview && variant === 'default' && 'rounded-(--radius-3xl-base) border border-subtle text-default',
        !hasLatexPreview && variant === 'default' && (isShowingPreview ? 'bg-transparent' : styles.CodeSurface),
        !hasLatexPreview && variant === 'default' && styles.Surface, hasLatexPreview && styles.WithPreview, theme, className,
      )}
    >{actionBar}{sourceContent}{renderedLatex}{previewContent}</div>;
  };
}
