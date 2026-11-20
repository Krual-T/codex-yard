import { Minimize2, SquareTerminal, X } from 'lucide-react';
import { WorkspaceIcon } from './workspace-icon.tsx';
import { useId, useRef, useState } from 'react';
import { TerminalPanel, type WorkspaceTerminalSession } from './terminal-panel.tsx';

export function HomeTerminal({ scope, projectId, ready }: { scope?: string; projectId?: string; ready: boolean }) {
  const [sessions, setSessions] = useState(() => new Map<string, { open: boolean; session: WorkspaceTerminalSession }>());
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const current = scope ? sessions.get(scope) : undefined;

  function toggle() {
    if (!scope || !ready) return;
    const sessionId = crypto.randomUUID();
    setSessions(previous => {
      const next = new Map(previous);
      const existing = next.get(scope);
      next.set(scope, existing ? { ...existing, open: !existing.open } :
        { open: true, session: { sessionId, hostId: 'local', projectId } });
      return next;
    });
  }

  function returnToHome(key: string, close: boolean) {
    setSessions(previous => {
      const item = previous.get(key);
      if (!item) return previous;
      const next = new Map(previous);
      if (close) next.delete(key); else next.set(key, { ...item, open: false });
      return next;
    });
    trigger.current?.focus();
  }

  return <>
    {scope && <button type="button" className="yard-source-home-side-toggle" ref={trigger}
      aria-label="Toggle side panel" title="Toggle side panel" aria-pressed={current?.open ?? false} disabled={!ready}
      onClick={toggle}><WorkspaceIcon name="sidebarClosed" className="rotate-180" /></button>}
    {[...sessions].map(([key, { open, session }]) => {
      const active = key === scope && open;
      const id = panelId + '-' + session.sessionId;
      const labelId = id + '-tab';
      return <aside key={session.sessionId} className="yard-source-home-side" aria-label="Side panel" hidden={!active}>
        <header>
          <div className="yard-source-home-side-tab">
            <div role="tablist" aria-label="Chat tabs">
              <button type="button" role="tab" aria-selected="true" aria-controls={id} id={labelId}>
                <SquareTerminal size={14} aria-hidden="true" /><span>Terminal 1</span>
              </button>
            </div>
            <button type="button" aria-label="Close Terminal 1 tab" title="Close Terminal 1 tab"
              onClick={() => returnToHome(key, true)}><X size={12} aria-hidden="true" /></button>
          </div>
          <button type="button" className="yard-source-home-side-exit" aria-label="Exit full screen" title="Exit full screen" aria-pressed="true"
            onClick={() => returnToHome(key, false)}><Minimize2 size={14} aria-hidden="true" /></button>
        </header>
        <TerminalPanel session={session} visible={active} tab={{ panelId: id, labelId }} />
      </aside>;
    })}
  </>;
}
