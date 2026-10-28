/** @jsxRuntime classic */
import type { ComponentType, CSSProperties, ReactNode, Ref } from 'react';

type MessageDescriptor = { id: string; defaultMessage: string; description: string; values?: { elapsed: string } };
type ReasoningMarkdownComponents = {
  p: ComponentType<{ children?: ReactNode }>;
  h1: ComponentType<{ children?: ReactNode }>;
  h2: ComponentType<{ children?: ReactNode }>;
  h3: ComponentType<{ children?: ReactNode }>;
  ul: ComponentType<{ children?: ReactNode }>;
  ol: ComponentType<{ children?: ReactNode; start?: number }>;
  li: ComponentType<{ children?: ReactNode }>;
};
export type ReasoningMessageProps = {
  item: { type: 'reasoning'; content: string; completed: boolean };
  conversationId: string;
  cwd?: string | null;
  hideCodeBlocks?: boolean;
  hostId?: string | null;
};
export type ReasoningMessageDependencies = {
  useReasoningState: (conversationId: string) => string | null | undefined;
  getCompletedContent: (content: string) => string;
  formatElapsed: (milliseconds: number) => string;
  useMeasurement: () => { elementHeightPx: number; elementRef: Ref<HTMLDivElement> };
  FormattedMessage: ComponentType<MessageDescriptor>;
  Markdown: ComponentType<{ className: string; cwd?: string | null; hideCodeBlocks?: boolean; hostId?: string | null;
    isStreaming: boolean; conversationId: string; components: ReasoningMarkdownComponents; children: string }>;
  ActivityLabel: ComponentType<{ active: boolean; className: string; children: ReactNode }>;
  Header: ComponentType<{ disclosure?: { expanded: boolean; onToggle: () => void }; children: ReactNode }>;
  Scrollable: ComponentType<{ items: { key: string; node: ReactNode }[]; autoScrollToBottom: boolean; contentClassName: string;
    maxHeightByState: { preview: string; expanded: string; collapsed: string }; viewState: 'expanded'; className: string }>;
  Surface: ComponentType<{ ref?: Ref<HTMLDivElement>; variant: 'flush'; children: ReactNode }>;
  MotionDiv: ComponentType<{ initial: false; animate: { height: number; opacity: number }; transition: object;
    className: string; style: CSSProperties; children: ReactNode }>;
  Layout: ComponentType<{ header: ReactNode; body: ReactNode }>;
  transition: object;
  styles: { heading: string; paragraph: string; list: string; content: string };
  classNames: (...classes: (string | false | null | undefined)[]) => string;
};

export function createReasoningMessageComponent(React: typeof import('react'), dependencies: ReasoningMessageDependencies): ComponentType<ReasoningMessageProps> {
  const { useReasoningState, getCompletedContent, formatElapsed, useMeasurement, FormattedMessage, Markdown, ActivityLabel,
    Header, Scrollable, Surface, MotionDiv, Layout, transition, styles, classNames } = dependencies;
  const components: ReasoningMarkdownComponents = {
    p: ({ children }) => <p className={classNames(styles.paragraph, 'has-[[data-markdown-copy=inline-code]]:py-0.5')}>{children}</p>,
    h1: ({ children }) => <h1 className={classNames(styles.heading, 'font-semibold')}>{children}</h1>,
    h2: ({ children }) => <h2 className={classNames(styles.heading, 'font-semibold')}>{children}</h2>,
    h3: ({ children }) => <h3 className={classNames(styles.heading, 'font-semibold')}>{children}</h3>,
    ul: ({ children }) => <ul className={classNames(styles.list, 'list-disc ps-4')}>{children}</ul>,
    ol: ({ children, start = 1 }) => {
      const groups: { start: number; digits: number; items: React.ReactElement[] }[] = [];
      React.Children.toArray(children).filter(React.isValidElement).forEach((child, index) => {
        const number = start + index;
        const digits = String(number).length;
        const previous = groups.at(-1);
        if (previous == null || previous.digits !== digits) groups.push({ start: number, digits, items: [child] });
        else previous.items.push(child);
      });
      return <React.Fragment>{groups.map(group => <ol key={`ol-${group.start}`}
        className={classNames(styles.list, 'list-decimal', group.digits <= 2 ? 'ps-8' : group.digits === 3 ? 'ps-10' : group.digits === 4 ? 'ps-12' : 'ps-14')} start={group.start}>{group.items}</ol>)}</React.Fragment>;
    },
    li: ({ children }) => <li className="m-0">{children}</li>,
  };
  return function ReasoningMessage({ item, conversationId, cwd, hideCodeBlocks, hostId }: ReasoningMessageProps) {
    const state = useReasoningState(conversationId);
    const streaming = !item.completed;
    const [startedAt, setStartedAt] = React.useState<number | null>(() => streaming ? Date.now() : null);
    const [elapsed, setElapsed] = React.useState<number | null>(null);
    const wasStreaming = React.useRef(streaming);
    React.useEffect(() => {
      if (!wasStreaming.current && streaming) { setStartedAt(Date.now()); setElapsed(null); }
      if (wasStreaming.current && !streaming && startedAt != null && elapsed == null) {
        setElapsed(Date.now() - startedAt); setStartedAt(null);
      }
      wasStreaming.current = streaming;
    }, [elapsed, streaming, startedAt]);
    const elapsedLabel = elapsed != null && elapsed > 0 ? formatElapsed(elapsed) : null;
    const completedContent = streaming ? '' : getCompletedContent(item.content);
    const [expanded, setExpanded] = React.useState(false);
    const canExpand = !streaming && !!completedContent;
    const trimmed = item.content.trimStart();
    const header = trimmed.match(/^\*\*([^\n]*?)\*\*/);
    const streamingContent = (header ? trimmed.slice(header[0].length) : trimmed.startsWith('**') ? '' : trimmed).trimStart();
    const visible = streaming ? !!streamingContent && (state == null || state === 'resumed') : expanded;
    const displayContent = streaming ? streamingContent : completedContent;
    const { elementHeightPx, elementRef } = useMeasurement();
    const label = streaming
      ? <FormattedMessage id="reasoningItem.thinking" defaultMessage="Thinking" description="Message shown when AI is currently thinking" />
      : elapsedLabel ? <FormattedMessage id="reasoningItem.thoughtWithElapsed" defaultMessage="Thought for {elapsed}" description="Message shown when AI has finished thinking, including elapsed time" values={{ elapsed: elapsedLabel }} />
        : <FormattedMessage id="reasoningItem.thought" defaultMessage="Thought" description="Message shown when AI has finished thinking" />;
    const markdown = <Markdown className={classNames(styles.content, 'text-text/60 [&_*]:text-text/50', 'break-words text-size-chat [&_*]:text-size-chat')}
      cwd={cwd} hideCodeBlocks={hideCodeBlocks} hostId={hostId} isStreaming={streaming} conversationId={conversationId} components={components}>{displayContent}</Markdown>;
    return <Layout header={<Header disclosure={canExpand ? { expanded, onToggle: () => setExpanded(value => !value) } : undefined}>
      <ActivityLabel active={streaming} className={classNames('text-text/30', 'text-size-chat truncate group-hover/activity-header:text-default')}>{label}</ActivityLabel>
    </Header>} body={<MotionDiv initial={false} animate={{ height: visible ? elementHeightPx : 0, opacity: Number(visible) }} transition={transition}
      className={classNames(visible ? 'overflow-visible' : 'overflow-hidden')} style={{ pointerEvents: visible ? 'auto' : 'none' }}>
      <Surface ref={visible ? elementRef : null} variant="flush">{visible ? <Scrollable items={[{ key: 'reasoning-markdown', node: markdown }]}
        autoScrollToBottom={streaming} contentClassName="gap-0" maxHeightByState={{ preview: '8.75rem', expanded: '8.75rem', collapsed: '0px' }}
        viewState="expanded" className="[--edge-fade-distance:1rem]" /> : null}</Surface>
    </MotionDiv>} />;
  };
}
