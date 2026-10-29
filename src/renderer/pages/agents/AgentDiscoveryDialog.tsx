import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Bot, X } from 'lucide-react';
import { workspaceAgentDetail } from './catalog.ts';
import type { WorkspaceAgent, WorkspaceAgentDetail, WorkspaceIdentity } from './catalog.ts';
import type { WorkspaceAgentsPageProps } from './WorkspaceAgentsPage.tsx';

interface AgentDiscoveryDialogProps {
  hostId: string;
  identity: WorkspaceIdentity;
  agent: WorkspaceAgent;
  onLoad: NonNullable<WorkspaceAgentsPageProps['onLoadAgentDetail']>;
  onOpen?: WorkspaceAgentsPageProps['onOpenAgent'];
  onSetPinned?: WorkspaceAgentsPageProps['onSetAgentPinned'];
  renderAppsSetup?: WorkspaceAgentsPageProps['renderAgentAppsSetup'];
  renderIcon?: WorkspaceAgentsPageProps['renderAgentIcon'];
  onClose(): void;
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function AgentDiscoveryDialog({ hostId, identity, agent, onLoad, onOpen, onSetPinned, renderAppsSetup, renderIcon, onClose }: AgentDiscoveryDialogProps) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(false);
  const inFlight = useRef(false);
  const [detail, setDetail] = useState<WorkspaceAgentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [setup, setSetup] = useState(false);
  const [pin, setPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const element = dialog.current; element?.showModal();
    return () => { if (element?.open) element.close(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null); setDetail(null);
    void (async () => {
      try {
        const result = workspaceAgentDetail(await onLoad({ hostId, identity, agentId: agent.id, signal: controller.signal }), agent.id);
        if (!controller.signal.aborted) setDetail(result);
      } catch (cause) { if (!controller.signal.aborted) setError(message(cause)); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [retry]);
  const version = detail?.latestPublishedVersion;
  const open = async () => {
    if (!detail || !version || !onOpen || inFlight.current) return;
    inFlight.current = true; setBusy(true); setActionError(null);
    try {
      if (pin && detail.isPinned === false) {
        if (!onSetPinned) throw new Error('Pinning is unavailable');
        await onSetPinned({ hostId, identity, agent: { ...agent, name: version.name.trim() || agent.id, icon: version.icon }, pinned: true });
        if (!alive.current) return;
        setDetail({ ...detail, isPinned: true });
      }
      if (!alive.current) return;
      await onOpen({ hostId, identity, agent, view: 'directory' });
      if (alive.current) dialog.current?.close();
    } catch (cause) { if (alive.current) setActionError(message(cause)); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  };
  return <dialog className="yard-agent-dialog" ref={dialog} aria-labelledby={titleId} onClose={onClose}
    onCancel={event => { if (busy) event.preventDefault(); }}>
    <header><div><h2 id={titleId}>{version?.name.trim() || agent.name.trim() || 'Agent details'}</h2>
      {version && <p>{version.description || version.tagline}</p>}</div>
      <button className="yard-agent-close" type="button" aria-label="Close agent details" title="Close" disabled={busy} autoFocus onClick={() => dialog.current?.close()}><X size={18} /></button></header>
    {loading && <p role="status">Loading agent details...</p>}
    {!loading && (error || !version) && <div role="alert" className="yard-agents-error">This agent is unavailable{error ? `: ${error}` : '.'}
      <button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
    {!loading && version && <>
      {setup && renderAppsSetup ? renderAppsSetup({ hostId, identity, agentId: agent.id, onBack: () => setSetup(false) }) : <>
        <div className="yard-agent-detail-identity"><span className="yard-agent-icon" aria-hidden="true">{renderIcon ? renderIcon({ ...agent, icon: version.icon }) : <Bot size={22} />}</span>
          {detail?.creatorName && <span>By {detail.creatorName}</span>}</div>
        {version.starterPrompts.length > 0 && <ul className="yard-agent-prompts">{version.starterPrompts.slice(0, 3).map((prompt, index) =>
          <li key={`${prompt.title}:${index}`}><strong>{prompt.title}</strong><span>{prompt.shortDescription}</span></li>)}</ul>}
        <button type="button" className="yard-agent-secondary" disabled={!renderAppsSetup || busy} onClick={() => setSetup(true)}>Set up apps</button>
      </>}
      {detail?.isPinned !== true && <label className="yard-agent-pin" title={!onSetPinned || detail?.isPinned === null ? 'Pinning is unavailable' : undefined}><input type="checkbox" checked={pin} disabled={!onSetPinned || detail?.isPinned === null || busy} onChange={event => setPin(event.target.checked)} /> Pin agent to sidebar</label>}
      {actionError && <p role="alert" className="yard-agents-error">Could not open agent: {actionError}</p>}
    </>}
    <footer>{setup && <button type="button" className="yard-agent-secondary" disabled={busy} onClick={() => setSetup(false)}>Back</button>}
      <button type="button" className="yard-agent-primary" disabled={loading || !version || !onOpen || busy} onClick={() => void open()}>{busy ? 'Opening...' : 'Open agent'}</button></footer>
  </dialog>;
}
