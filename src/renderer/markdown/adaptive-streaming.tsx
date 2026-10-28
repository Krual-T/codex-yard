/** @jsxRuntime classic */
import type { ComponentType } from 'react';

export type StreamingMarkdownBaseProps = {
  children: string;
  isStreaming?: boolean;
  animate?: boolean;
  fadeSegmentDelayMs?: number;
  fadeSegmentMaxDelayMs?: number;
};
export type AdaptiveStreamSnapshot = { streamId: string; source: string; text: string };
export type AdaptiveStreamStore = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => AdaptiveStreamSnapshot;
  update: (content: string, streamId: string, active: boolean | undefined, rate: number) => void;
  destroy: () => void;
};
export type AdaptiveStreamingMarkdownDependencies<Props extends StreamingMarkdownBaseProps, Client> = {
  useClient: () => Client;
  useReducedMotion: () => boolean;
  createStore: (content: string, streamId: string, active: boolean | undefined) => AdaptiveStreamStore;
  isSlowStreamingEnabled: (client: Client) => boolean;
  Markdown: ComponentType<Omit<Props, 'streamId'> & { adaptiveStreaming: boolean | undefined }>;
};

export function createAdaptiveStreamingMarkdownComponent<Props extends StreamingMarkdownBaseProps, Client>(
  React: typeof import('react'), dependencies: AdaptiveStreamingMarkdownDependencies<Props, Client>,
): ComponentType<Props & { streamId: string }> {
  const { useClient, useReducedMotion, createStore, isSlowStreamingEnabled, Markdown } = dependencies;
  return function AdaptiveStreamingMarkdown({ streamId, ...props }: Props & { streamId: string }) {
    const client = useClient();
    const reducedMotion = useReducedMotion();
    const adaptive = props.isStreaming && (props.animate ?? true) && !reducedMotion;
    const [store] = React.useState(() => createStore(props.children, streamId, adaptive));
    const snapshot = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    React.useLayoutEffect(() => () => store.destroy(), [store]);
    React.useLayoutEffect(() => {
      const rate = adaptive && isSlowStreamingEnabled(client) ? 0.01 : 10;
      store.update(props.children, streamId, adaptive, rate);
    }, [store, props.children, client, adaptive, streamId]);
    const visibleText = adaptive && snapshot.streamId === streamId && props.children.startsWith(snapshot.source) ? snapshot.text : props.children;
    return <Markdown {...props} adaptiveStreaming={adaptive} animate={!reducedMotion && props.animate}
      fadeSegmentDelayMs={adaptive ? 0 : props.fadeSegmentDelayMs}
      fadeSegmentMaxDelayMs={adaptive ? undefined : props.fadeSegmentMaxDelayMs}>{visibleText}</Markdown>;
  };
}
