/** @jsxRuntime classic */
import type { ComponentType, Context, ReactNode, RefCallback } from 'react';

export type CollapsibleUserMessageContentProps = {
  text: string;
  children?: ReactNode | ((visibleText: string) => ReactNode);
  collapsedLineCount?: number;
  collapseIndicator?: 'ellipsis' | 'fade';
  isAeonFormatted?: boolean;
};

type MeasurementOptions = {
  text: string;
  collapsedLineCount: number;
  fallbackFontSizePx: number;
  forceCollapsible: boolean;
};

type MeasurementResult = {
  setTextContentMeasurementRef: RefCallback<HTMLDivElement>;
  collapseState: 'uncollapsible' | 'collapsed' | 'expanded';
  handleToggleExpansion: () => void;
};

type SearchTarget = {
  highlight: 'text';
  text: string;
  isTruncated: boolean;
  reveal?: () => void;
};

type ButtonProps = {
  className: string;
  'aria-expanded': boolean;
  'data-thread-find-skip': boolean;
  'data-markdown-copy': 'exclude';
  color: 'ghostUserMessage' | 'disclosure';
  onClick: () => void;
  size: 'inline';
  children: ReactNode;
};

type FormattedMessageProps = {
  id: string;
  defaultMessage: string;
  description: string;
};

export type CollapsibleUserMessageContentDependencies = {
  useIsPrinting: () => boolean;
  useTextContentMeasurement: (options: MeasurementOptions) => MeasurementResult;
  registerThreadFindTarget: (element: HTMLDivElement, target: SearchTarget) => () => void;
  CodeBlockPreviewContext: Context<boolean>;
  Button: ComponentType<ButtonProps>;
  FormattedMessage: ComponentType<FormattedMessageProps>;
  ChevronDown: ComponentType<{ className: string }>;
  classNames: (...classes: (string | false | null | undefined)[]) => string;
};

const DEFAULT_COLLAPSED_LINE_COUNT = 20;
const CHARACTERS_PER_LINE_LIMIT = 512;
const CODE_BLOCK_SELECTOR = '[data-markdown-copy="code-block"]:not(pre)';
const LINK_SELECTOR = 'a[href], area[href]';
const FOCUSABLE_SELECTOR = 'a[href], area[href], button, input, select, textarea, summary, audio[controls], video[controls], iframe, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])';

function setElementVisible(element: Element, visible: boolean, originalAriaHidden: string | null): void {
  element.toggleAttribute('inert', !visible);
  if (!visible) element.setAttribute('aria-hidden', 'true');
  else if (originalAriaHidden === null) element.removeAttribute('aria-hidden');
  else element.setAttribute('aria-hidden', originalAriaHidden);
}

function isElementVisible(element: Element, container: Element): boolean {
  const rect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  if (element.matches(LINK_SELECTOR)) {
    return Math.min(rect.right, containerRect.right) > Math.max(rect.left, containerRect.left)
      && Math.min(rect.bottom, containerRect.bottom) > Math.max(rect.top, containerRect.top);
  }
  return rect.top >= containerRect.top && rect.right <= containerRect.right
    && rect.bottom <= containerRect.bottom && rect.left >= containerRect.left;
}

export function createCollapsibleUserMessageContentComponent(
  React: typeof import('react'),
  dependencies: CollapsibleUserMessageContentDependencies,
): ComponentType<CollapsibleUserMessageContentProps> {
  const {
    useIsPrinting,
    useTextContentMeasurement,
    registerThreadFindTarget,
    CodeBlockPreviewContext,
    Button,
    FormattedMessage,
    ChevronDown,
    classNames,
  } = dependencies;

  return function CollapsibleUserMessageContent({
    children,
    collapsedLineCount = DEFAULT_COLLAPSED_LINE_COUNT,
    collapseIndicator = 'ellipsis',
    isAeonFormatted = false,
    text,
  }: CollapsibleUserMessageContentProps) {
    const isPrinting = useIsPrinting();
    const characterLimit = collapsedLineCount * CHARACTERS_PER_LINE_LIMIT;
    const forceCollapsible = !isPrinting && typeof children === 'function' && text.length > characterLimit;
    const { setTextContentMeasurementRef, collapseState, handleToggleExpansion } = useTextContentMeasurement({
      text,
      collapsedLineCount,
      fallbackFontSizePx: 13,
      forceCollapsible,
    });
    const isCollapsed = !isPrinting && collapseState === 'collapsed';
    const showEllipsis = isCollapsed && collapseIndicator === 'ellipsis' && collapsedLineCount > 2;
    const visibleLineCount = collapsedLineCount - Number(showEllipsis);
    const contentRef = React.useRef<HTMLDivElement>(null);

    React.useLayoutEffect(() => {
      if (!isCollapsed || forceCollapsible) return;
      const container = contentRef.current;
      const content = container?.firstElementChild;
      if (container == null || content == null) return;

      const updateMaxHeight = () => {
        const codeBlocks = container.querySelectorAll(CODE_BLOCK_SELECTOR);
        if (codeBlocks.length === 0) {
          container.style.maxHeight = `${visibleLineCount}lh`;
          return;
        }
        const lineHeight = Number.parseFloat(window.getComputedStyle(container).lineHeight);
        if (!Number.isFinite(lineHeight)) return;
        const containerRect = container.getBoundingClientRect();
        const scale = container.offsetHeight === 0 ? 1 : containerRect.height / container.offsetHeight;
        let height = Math.ceil(lineHeight * visibleLineCount);
        for (const block of codeBlocks) {
          const blockRect = block.getBoundingClientRect();
          const top = (blockRect.top - containerRect.top) / scale;
          const bottom = (blockRect.bottom - containerRect.top) / scale;
          if (top < height && bottom > height) height = Math.ceil(bottom);
        }
        container.style.maxHeight = `${height}px`;
      };

      updateMaxHeight();
      const resizeObserver = new ResizeObserver(updateMaxHeight);
      resizeObserver.observe(content);
      const mutationObserver = new MutationObserver(updateMaxHeight);
      mutationObserver.observe(content, { childList: true, subtree: true });
      return () => {
        resizeObserver.disconnect();
        mutationObserver.disconnect();
      };
    }, [visibleLineCount, forceCollapsible, isCollapsed, text]);

    React.useEffect(() => {
      if (!isCollapsed) return;
      const container = contentRef.current;
      if (container == null) return;

      const elements = new Map<Element, string | null>();
      const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (elements.has(entry.target)) {
            const visible = entry.isIntersecting && (entry.target.matches(LINK_SELECTOR)
              ? entry.intersectionRatio > 0 : entry.intersectionRatio >= 1);
            setElementVisible(entry.target, visible, elements.get(entry.target) ?? null);
          }
        }
      }, { root: container, rootMargin: '0px', threshold: [2 ** -52, 1] });
      const updateElements = () => {
        for (const element of elements.keys()) {
          if (!container.contains(element)) {
            observer?.unobserve(element);
            elements.delete(element);
          }
        }
        for (const element of container.querySelectorAll(FOCUSABLE_SELECTOR)) {
          if (elements.has(element) || element.hasAttribute('inert')) continue;
          const originalAriaHidden = element.getAttribute('aria-hidden');
          elements.set(element, originalAriaHidden);
          setElementVisible(element, observer == null && isElementVisible(element, container), originalAriaHidden);
          observer?.observe(element);
        }
      };

      updateElements();
      const mutationObserver = new MutationObserver(updateElements);
      mutationObserver.observe(container, { childList: true, subtree: true });
      return () => {
        observer?.disconnect();
        mutationObserver.disconnect();
        for (const [element, originalAriaHidden] of elements) {
          setElementVisible(element, true, originalAriaHidden);
        }
      };
    }, [collapsedLineCount, isCollapsed, text]);

    const registerContent = React.useCallback<RefCallback<HTMLDivElement>>(element => {
      contentRef.current = element;
      if (element != null) {
        return registerThreadFindTarget(element, {
          highlight: 'text',
          text,
          isTruncated: isCollapsed && forceCollapsible,
          reveal: isCollapsed ? handleToggleExpansion : undefined,
        });
      }
    }, [handleToggleExpansion, forceCollapsible, isCollapsed, text]);

    const visibleContent = React.useMemo(() => typeof children === 'function'
      ? children(isCollapsed ? text.slice(0, characterLimit) : text)
      : children, [children, isCollapsed, characterLimit, text]);

    return <div className="flex flex-col items-end gap-1">
      <div className="relative w-full min-w-0 text-size-chat leading-relaxed">
        <CodeBlockPreviewContext.Provider value={!isPrinting}>
          <div
            ref={registerContent}
            className={classNames(
              isCollapsed && 'overflow-hidden',
              isCollapsed && collapseIndicator === 'fade' && 'mask-b-from-80% mask-b-to-100%',
            )}
            style={isCollapsed ? { maxHeight: `${visibleLineCount}lh` } : undefined}
          >
            <div ref={forceCollapsible ? undefined : setTextContentMeasurementRef}>{visibleContent}</div>
          </div>
        </CodeBlockPreviewContext.Provider>
        {showEllipsis ? <span aria-hidden="true" className="block">…</span> : null}
      </div>
      {!isPrinting && collapseState !== 'uncollapsible' ? <Button
        className={classNames('mt-1.5 self-start text-size-chat', !isAeonFormatted && 'text-codex-description')}
        aria-expanded={collapseState === 'expanded'}
        data-thread-find-skip={true}
        data-markdown-copy="exclude"
        color={isAeonFormatted ? 'ghostUserMessage' : 'disclosure'}
        onClick={handleToggleExpansion}
        size="inline"
      >
        <span>{collapseState === 'expanded'
          ? <FormattedMessage id="codex.userMessage.showLess" defaultMessage="Show less" description="Button label for collapsing an expanded user message" />
          : <FormattedMessage id="codex.userMessage.showMore" defaultMessage="Show more" description="Button label for expanding a truncated user message" />}</span>
        <ChevronDown className={collapseState === 'expanded' ? 'icon-2xs rotate-180' : 'icon-2xs'} />
      </Button> : null}
    </div>;
  };
}
