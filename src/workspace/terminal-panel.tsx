import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { TerminalCreate, TerminalEvent, TerminalOperation } from '../native/terminal-protocol.ts';
import { projectRoot } from './host.ts';

declare const __yardTerminalUrl: string;
declare const __yardTerminalCss: string;
type Runtime = typeof import('./terminal-runtime.ts');
type TerminalBridge = {
  call(operation: TerminalOperation, args: unknown[]): Promise<unknown>;
  watch(listener: (event: TerminalEvent) => void): () => void;
};
const transport = (window as unknown as { workbenchTerminal: TerminalBridge }).workbenchTerminal;
let runtime: Promise<Runtime> | undefined;
function loadTerminal() {
  return runtime ??= (() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = __yardTerminalCss;
    const paint = new Promise<void>((resolve, reject) => {
      link.onload = () => resolve();
      link.onerror = () => reject(new Error('Unable to load terminal styles.'));
    });
    document.head.append(link);
    return Promise.all([import(__yardTerminalUrl) as Promise<Runtime>, paint]).then(([module]) => module)
      .catch(error => { link.remove(); runtime = undefined; throw error; });
  })();
}

export type WorkspaceTerminalSession = TerminalCreate & { projectId?: string };

export function TerminalPanel({ session, visible, close, tab }: {
  session: WorkspaceTerminalSession; visible: boolean; close?(): void;
  tab?: { panelId: string; labelId: string };
}) {
  const container = useRef<HTMLDivElement>(null);
  const focusTerminal = useRef<() => void>(undefined);
  const [status, setStatus] = useState('Connecting…');
  const [fault, setFault] = useState(false);
  useEffect(() => {
    const element = container.current!;
    const { sessionId, projectId, ...target } = session;
    type MountedTerminal = ReturnType<Runtime['mountTerminal']>;
    let terminal: MountedTerminal | undefined;
    let attached = false, requested = false, cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let observer: ResizeObserver | undefined;
    let input: ReturnType<MountedTerminal['onInput']> | undefined;
    let resize: ReturnType<MountedTerminal['onResize']> | undefined;
    let dimensions: ReturnType<MountedTerminal['size']>;
    const failed = (error: unknown) => {
      if (cancelled) return;
      setFault(true);
      setStatus(error instanceof Error ? error.message : String(error));
    };
    function sendSize() {
      if (!attached || !terminal) return;
      const { cols, rows } = terminal.size();
      if (cols === dimensions.cols && rows === dimensions.rows) return;
      dimensions = { cols, rows };
      void transport.call('resize', [sessionId, cols, rows]).catch(failed);
    }
    const cwd = projectId ? projectRoot(projectId, target.hostId ?? 'local') : Promise.resolve(target.cwd);
    void Promise.all([loadTerminal(), cwd]).then(async ([{ mountTerminal }, cwd]) => {
      if (cancelled) return;
      terminal = mountTerminal(element);
      focusTerminal.current = terminal.focus;
      dimensions = terminal.size();
      unsubscribe = transport.watch(event => {
        if (event.sessionId !== sessionId || cancelled || !terminal) return;
        if (event.type === 'data') { terminal.write(event.data); return; }
        if (event.type === 'attached') {
          attached = true;
          setStatus('');
          terminal.setReady(true);
          if (element.getBoundingClientRect().width) terminal.focus();
          sendSize();
        } else if (event.type === 'error' || event.type === 'exit') {
          attached = false;
          terminal.setReady(false);
          if (event.type === 'error' || event.error) failed(event.type === 'error' ? event.message : event.error);
          else setStatus(event.code === null ? 'Terminal closed' : 'Terminal exited (' + event.code + ')');
        } else if (event.type === 'input-status' && event.error) {
          failed(event.error);
        }
      });
      input = terminal.onInput(data => {
        if (attached) void transport.call('write', [sessionId, data]).catch(failed);
      });
      resize = terminal.onResize(sendSize);
      observer = new ResizeObserver(() => { if (element.clientWidth) terminal?.fit(); });
      observer.observe(element);
      requested = true;
      await transport.call('create', [{ ...target, ...dimensions, sessionId, cwd }]);
    }).catch(failed);

    return () => {
      cancelled = true;
      unsubscribe?.();
      observer?.disconnect();
      input?.dispose();
      resize?.dispose();
      terminal?.close();
      focusTerminal.current = undefined;
      if (requested) void transport.call('close', [sessionId]).catch(console.error);
    };
  }, [session]);
  useEffect(() => { if (visible) focusTerminal.current?.(); }, [visible]);

  return <section className="yard-source-terminal" role={tab ? 'tabpanel' : undefined} id={tab?.panelId}
    aria-labelledby={tab?.labelId} aria-label={tab ? undefined : 'Terminal'} data-codex-terminal="" hidden={!visible}>
    {!tab && <header><span>Terminal</span><button type="button" aria-label="Close terminal" title="Close terminal" onClick={close}>
      <X size={14} aria-hidden="true" />
    </button></header>}
    {status && <p role={fault ? 'alert' : 'status'}>{status}</p>}
    <div className="yard-source-terminal-screen" ref={container} />
  </section>;
}
