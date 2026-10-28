/** @jsxRuntime classic */
import type { ComponentType, ReactNode } from 'react';

type MessageDescriptor = { id: string; defaultMessage: string; description: string };

export type MermaidLoadingPlaceholderDependencies = {
  useIntl: () => { formatMessage: (message: MessageDescriptor) => string };
  Skeleton: ComponentType<{ className: string; variant: 'solid'; role: 'status'; 'aria-label': string }>;
  ShimmeringStatus: ComponentType<{ message: ReactNode }>;
  FormattedMessage: ComponentType<MessageDescriptor>;
};

export function createMermaidLoadingPlaceholderComponent(
  React: typeof import('react'),
  dependencies: MermaidLoadingPlaceholderDependencies,
): ComponentType<{ isStreaming?: boolean }> {
  const { useIntl, Skeleton, ShimmeringStatus, FormattedMessage } = dependencies;
  return function MermaidLoadingPlaceholder({ isStreaming }: { isStreaming?: boolean }) {
    const intl = useIntl();
    if (!isStreaming) {
      const label = intl.formatMessage({
        id: 'mermaidDiagram.loading',
        defaultMessage: 'Loading Mermaid diagram',
        description: 'Accessible label for a Mermaid diagram loading placeholder',
      });
      return <Skeleton className="aspect-video min-h-60 w-full rounded-lg" variant="solid" role="status" aria-label={label} />;
    }
    return <div className="w-full" data-mermaid-streaming={true} role="status">
      <ShimmeringStatus message={<FormattedMessage
        id="codeBlock.mermaid.loadingDiagram"
        defaultMessage="Loading diagram"
        description="Shimmering status text shown while a Mermaid diagram response is waiting to render"
      />} />
    </div>;
  };
}
