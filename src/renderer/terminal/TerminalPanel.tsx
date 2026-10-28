import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Ref } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { TerminalEvent } from '../../native/terminal-protocol.ts';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { errorMessage } from '../files/file-service.ts';
import '@xterm/xterm/css/xterm.css';

export interface TerminalPanelProps {
  client: WorkbenchClient;
  hostId: string;
  cwd: string;
  threadId?: string;
  /** An existing page-owned session may be attached, but is never recreated automatically. */
  sessionId?: string;
  visible?: boolean;
  theme?: 'light' | 'dark';
  fontSize?: number;
  lineHeight?: number;
  fontFamily?: string;
  ref?: Ref<TerminalPanelHandle>;
}
export interface TerminalPanelHandle { close(): Promise<boolean> }

export function TerminalPanel({ client, hostId, cwd, threadId, sessionId, visible = true, theme = 'dark', fontSize = 13, lineHeight = 20, fontFamily, ref }: TerminalPanelProps) {
  const element = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<() => void>(() => {});
  const closeRef = useRef<() => Promise<boolean>>(async () => true);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState('Starting terminal...');
  const [canRestart, setCanRestart] = useState(false);
  useImperativeHandle(ref, () => ({ close: () => closeRef.current() }), []);

  useEffect(() => {
    if (!element.current) return;
    const id = attempt === 0 && sessionId ? sessionId : crypto.randomUUID();
    const terminal = new Terminal({ cursorBlink: true, scrollback: 10000, fontSize: 13, fontFamily: 'ui-monospace, monospace',
      theme: { background: '#202324', foreground: '#e5e8e8', cursor: '#e5e8e8' } });
    terminalRef.current = terminal;
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element.current);
    let active = true, attached = false, ownsSession = true, stopped = false;
    let writeQueue: Promise<void> = Promise.resolve();
    let lastSize = '';
    const call = (operation: string, args: unknown[]) => client.host('terminal', { operation, args });
    const fail = (message: string, connectionLost = false) => {
      if (!active || stopped) return;
      stopped = true;
      attached = false;
      if (connectionLost) ownsSession = false;
      terminal.options.disableStdin = true;
      setStatus(message);
      setCanRestart(true);
    };
    closeRef.current = async () => {
      if (!active || !ownsSession) return true;
      stopped = true;
      attached = false;
      terminal.options.disableStdin = true;
      setCanRestart(false);
      setStatus('Closing terminal...');
      try {
        await call('close', [id]);
        ownsSession = false;
        return true;
      } catch (error) {
        if (active) setStatus(`Terminal close failed: ${errorMessage(error)}. The close result may be unknown.`);
        return false;
      }
    };
    const resize = () => {
      if (!active || !element.current || element.current.clientWidth < 20 || element.current.clientHeight < 20) return;
      fit.fit();
      if (!attached || stopped) return;
      const size = `${terminal.cols}:${terminal.rows}`;
      if (size === lastSize) return;
      lastSize = size;
      void call('resize', [id, terminal.cols, terminal.rows]).catch(error => fail(`Terminal resize failed: ${errorMessage(error)}`));
    };
    fitRef.current = resize;
    const observer = new ResizeObserver(resize);
    observer.observe(element.current);
    resize();
    setStatus('Starting terminal...');
    setCanRestart(false);

    const unsubscribe = client.subscribe(message => {
      if (message.type === 'connection-state' && message.state === 'disconnected') {
        fail('Connection lost. Open a new terminal; input will not be replayed.', true);
      }
      if (message.type === 'codex-app-server-connection-changed' && message.hostId === hostId &&
        message.state === 'disconnected' && attached) {
        fail('Connection lost. Open a new terminal; input will not be replayed.', true);
      }
      if (message.type !== 'terminal-event' || !message.event || typeof message.event !== 'object') return;
      const event = message.event as TerminalEvent;
      if (event.sessionId !== id) return;
      if (event.type === 'init-log') { terminal.reset(); terminal.write(event.log); }
      else if (event.type === 'data') terminal.write(event.data);
      else if (event.type === 'attached' && !stopped) {
        attached = true;
        terminal.options.disableStdin = false;
        setStatus(`${event.shell} - ${event.cwd}`);
        resize();
      } else if (event.type === 'exit') {
        ownsSession = false;
        fail(event.error ?? `Terminal exited${event.code == null ? '' : ` (${event.code})`}. Open a new terminal.`, true);
      } else if (event.type === 'error') fail(event.message);
      else if (event.type === 'input-status' && event.error) fail(`Terminal input failed: ${event.error}`);
    });
    terminal.options.disableStdin = true;
    const input = terminal.onData(data => {
      if (!attached || stopped) return;
      writeQueue = writeQueue.then(async () => {
        if (!active || stopped) return;
        try { await call('write', [id, data]); }
        catch (error) { fail(`Terminal input failed: ${errorMessage(error)}. Input will not be replayed.`); }
      });
    });
    const params = { sessionId: id, hostId, cwd, ...(threadId ? { conversationId: threadId } : {}), cols: terminal.cols, rows: terminal.rows };
    const operation = attempt === 0 && sessionId ? 'attachExisting' : 'create';
    void call(operation, [params]).then(result => {
      if (active && operation === 'attachExisting' && result !== true) {
        ownsSession = false;
        fail('The previous terminal is unavailable. Open a new terminal.', true);
      }
    }).catch(error => fail(`Terminal could not be opened: ${errorMessage(error)}`));

    return () => {
      active = false;
      stopped = true;
      unsubscribe();
      observer.disconnect();
      input.dispose();
      fitRef.current = () => {};
      closeRef.current = async () => true;
      terminalRef.current = null;
      if (ownsSession) void call('close', [id]).catch(() => {});
      terminal.dispose();
    };
  }, [attempt, client, cwd, hostId, sessionId, threadId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    const screen = element.current;
    if (!terminal || !screen) return;
    const apply = () => {
      const computed = getComputedStyle(screen);
      const family = fontFamily || computed.getPropertyValue('--yard-code-font').trim() || 'ui-monospace, monospace';
      terminal.options.fontFamily = family;
      terminal.options.fontSize = fontSize;
      terminal.options.lineHeight = Math.max(1, lineHeight / fontSize);
      terminal.options.theme = { background: computed.backgroundColor, foreground: computed.color, cursor: computed.color };
      fitRef.current();
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-theme'] });
    return () => observer.disconnect();
  }, [attempt, theme, fontSize, lineHeight, fontFamily]);
  useEffect(() => { if (visible) fitRef.current(); }, [visible]);
  return <div className="yard-terminal-panel">
    <div className="yard-terminal-header"><span role="status">{status}</span>
      {canRestart ? <button type="button" onClick={() => void closeRef.current().then(closed => { if (closed) setAttempt(value => value + 1); })}>New terminal</button> : null}
    </div>
    <div className="yard-terminal-screen" ref={element} aria-label="Terminal" />
  </div>;
}
