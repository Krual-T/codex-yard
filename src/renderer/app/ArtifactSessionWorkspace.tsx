import { Plus, Presentation, Table2, X } from 'lucide-react';
import type { ArtifactSessionTarget } from '../workbench-contract.ts';
import './artifact-session-workspace.css';

/** UI tabs retain resource identities, never a message's one-shot authority or document data. */
export interface ArtifactSessionTab extends Omit<ArtifactSessionTarget, 'assertCurrent'> {
  key: string;
  parentScope: string;
}

export function ArtifactSessionTabs({ tabs, selected, onSelect, onClose, onNewTab }: {
  tabs: readonly ArtifactSessionTab[];
  selected: string;
  onSelect(key: string): void;
  onClose(key: string): void;
  onNewTab(): void;
}) {
  return <div className="yard-artifact-tabs" role="tablist" aria-label="Workspace tabs">
    {tabs.map(tab => {
      const Icon = tab.kind === 'presentation' ? Presentation : Table2;
      return <div className="yard-artifact-tab" key={tab.key}>
        <button type="button" role="tab" aria-selected={selected === tab.key} onClick={() => onSelect(tab.key)}>
          <Icon size={14} aria-hidden="true" /><span>{tab.title}</span>
        </button>
        <button type="button" aria-label={`Close ${tab.title}`} onClick={() => onClose(tab.key)}><X size={13} aria-hidden="true" /></button>
      </div>;
    })}
    <button type="button" className="yard-icon-button" aria-label="New tab" onClick={onNewTab}><Plus size={16} aria-hidden="true" /></button>
  </div>;
}

/** This Web host has no Artifact Sessions service; preserve the original visible result. */
export function ArtifactSessionUnavailable({ title }: { title: string }) {
  return <section className="yard-artifact-unavailable" aria-label={title}>
    <p role="status">Live Artifact Sessions aren’t available in this app host.</p>
  </section>;
}
