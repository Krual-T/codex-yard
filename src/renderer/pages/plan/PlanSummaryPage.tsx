import { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Clipboard, Download } from 'lucide-react';
import { StandaloneMarkdown } from '../../markdown/StandaloneMarkdown.tsx';
import type { ImageSource } from '../../messages/message-data.ts';
import type { WorkbenchClient } from '../../workbench-contract.ts';
import '../../messages/standalone-messages.css';
import './plan-summary.css';

export type PlanSummaryPageProps = {
  client: WorkbenchClient;
  hostId?: string | null;
  conversationId?: string | null;
  planContent?: string | null;
  cwd?: string | null;
  loading?: boolean;
  onOpenFile?: (path: string) => void;
  onOpenImage?: (image: ImageSource) => void;
  onBack?: () => void;
};

export function PlanSummaryPage({ client, hostId, conversationId, planContent, cwd, loading = false,
  onOpenFile, onOpenImage, onBack }: PlanSummaryPageProps) {
  if (!hostId || !conversationId || !planContent) {
    return <main className="yard-plan-page">
      {loading ? <div className="yard-plan-state" role="status">Loading plan...</div>
        : <div className="yard-plan-state"><h1>Plan unavailable</h1>
          <p>Return to the conversation to open its plan.</p>
          {onBack && <button type="button" onClick={onBack}>Back to conversation</button>}
        </div>}
    </main>;
  }
  return <PlanSummary key={JSON.stringify([hostId, conversationId, planContent])} client={client}
    hostId={hostId} content={planContent} cwd={cwd} onOpenFile={onOpenFile} onOpenImage={onOpenImage} />;
}

function PlanSummary({ client, hostId, content, cwd, onOpenFile, onOpenImage }: {
  client: WorkbenchClient; hostId: string; content: string; cwd?: string | null;
  onOpenFile?: (path: string) => void; onOpenImage?: (image: ImageSource) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setError('');
    } catch (reason) {
      setCopied(false);
      setError(reason instanceof Error ? reason.message : 'Could not copy the plan.');
    }
  }

  function download() {
    let url: string | undefined;
    try {
      url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'PLAN.md';
      link.click();
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not download the plan.');
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  }

  return <main className="yard-plan-page"><section className="yard-plan" aria-labelledby="yard-plan-title">
    <header className="yard-plan-header"><h1 id="yard-plan-title">Plan</h1><div className="yard-plan-actions">
      {content.trim() && <><button type="button" title="Download plan" aria-label="Download plan" onClick={download}><Download size={16} /></button>
        <button type="button" title={copied ? 'Copied' : 'Copy plan'} aria-label={copied ? 'Copied' : 'Copy plan'} onClick={() => void copy()}>
          {copied ? <Check size={16} /> : <Clipboard size={16} />}</button></>}
      <button type="button" title={expanded ? 'Collapse plan' : 'Expand plan'}
        aria-label={expanded ? 'Collapse plan' : 'Expand plan'} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
    </div></header>
    {error && <p role="alert" className="yard-plan-error">{error}</p>}
    <div className={expanded ? 'yard-plan-body' : 'yard-plan-body is-collapsed'}>
      <div className="yard-plan-content" inert={!expanded}><StandaloneMarkdown text={content} client={client} hostId={hostId}
        cwd={cwd ?? ''} onOpenFile={cwd ? onOpenFile : undefined} onOpenImage={onOpenImage} /></div>
      {!expanded && <button className="yard-plan-expand" type="button" onClick={() => setExpanded(true)}>Expand plan</button>}
    </div>
  </section></main>;
}
