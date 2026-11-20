import { useId, useState, type ReactNode } from 'react';
import { WorkspaceIcon } from './workspace-icon.tsx';
import './summary-section.css';

export function SummarySection({ sectionKey, title, itemCount, actions, className, children }: {
  sectionKey: string; title: string; itemCount: number; actions?: ReactNode; className?: string; children: ReactNode;
}) {
  const id = useId();
  // An explicit choice survives streamed list updates. Until the user chooses,
  // derive the default from the current count, including the first async load.
  const [chosenExpanded, setChosenExpanded] = useState<boolean>();
  const expanded = chosenExpanded ?? itemCount <= 3;
  return <section className={['yard-summary-section', className].filter(Boolean).join(' ')}
    data-summary-section={sectionKey} data-expanded={expanded}>
    <header className="yard-summary-section-header">
      <button id={id + '-toggle'} type="button" className="yard-summary-section-toggle"
        aria-label={title} aria-expanded={expanded} aria-controls={id + '-content'}
        onClick={() => setChosenExpanded(!expanded)}>
        <span className="yard-summary-section-title">{title}</span>
        {!expanded && <span className="yard-summary-section-count" aria-hidden="true">{itemCount}</span>}
        <WorkspaceIcon name="questionChevron" size={12} className="yard-summary-section-chevron" />
      </button>
      {actions}
    </header>
    <div id={id + '-content'} className="yard-summary-section-content" hidden={!expanded}
      role="region" aria-labelledby={id + '-toggle'}>
      {children}
    </div>
  </section>;
}
