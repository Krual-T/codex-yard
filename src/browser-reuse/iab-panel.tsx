import { useCallback, useEffect, useRef, useState } from 'react';
import type { IabPanelRequest, IabPanelState } from './iab-protocol.ts';

/** A view of the same tabs controlled by the original Browser plugin. Removing
 * this view stops polling; its pages and ongoing agent work belong to Yard. */
export function IabBrowserPanel({ sessionId, request }: { sessionId: string; request(value: IabPanelRequest): Promise<IabPanelState> }) {
  const [state, setState] = useState<IabPanelState>({ tabs: [] }), [error, setError] = useState('');
  const [address, setAddress] = useState<string | undefined>(), [text, setText] = useState('');
  const pending = useRef(false), current = useRef({ sessionId, request });
  const queue = useRef(Promise.resolve());
  current.current = { sessionId, request };
  const run = useCallback(async (operation: IabPanelRequest['operation'], extra: Partial<IabPanelRequest> = {}) => {
    if (pending.current && operation === 'state') return;
    const owner = current.current;
    const work = queue.current.then(async () => {
      if (current.current.sessionId !== owner.sessionId) return;
      pending.current = true;
      try {
        const value = await owner.request({ sessionId: owner.sessionId, operation, ...extra });
        if (current.current.sessionId === owner.sessionId) { setState(value); setError(''); }
      } catch (cause) { if (current.current.sessionId === owner.sessionId) setError((cause as Error).message); }
      finally { pending.current = false; }
    });
    queue.current = work.catch(() => {});
    await work;
  }, []);
  useEffect(() => {
    setState({ tabs: [] }); setAddress(undefined); setError('');
    void run('state');
    const timer = setInterval(() => { void run('state'); }, 1500);
    return () => clearInterval(timer);
  }, [sessionId, run]);
  const selected = state.tabs.find(tab => tab.id === state.selectedTabId);
  return <section aria-label="Yard Browser" data-codex-character-input-boundary style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: 8, padding: 8 }}>
    <nav aria-label="Browser tabs" style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
      {state.tabs.map(tab => <button key={tab.id} type="button" aria-pressed={tab.id === state.selectedTabId} title={tab.url}
        onClick={() => { setAddress(undefined); void run('select', { tabId: tab.id }); }}>{tab.title || 'New tab'}</button>)}
      <button type="button" aria-label="New browser tab" onClick={() => { setAddress(undefined); void run('new'); }}>＋</button>
    </nav>
    <form style={{ display: 'flex', gap: 4 }} aria-label="Browser navigation" onSubmit={event => {
      event.preventDefault(); void run('navigate', { tabId: selected?.id, url: address ?? selected?.url ?? 'about:blank' }); setAddress(undefined);
    }}>
      <button type="button" aria-label="Reload browser tab" disabled={!selected} onClick={() => { void run('reload', { tabId: selected?.id }); }}>↻</button>
      <input aria-label="Browser URL" value={address ?? selected?.url ?? ''} onChange={e => setAddress(e.target.value)} spellCheck={false} style={{ flex: 1, minWidth: 0 }} placeholder="https://example.com" />
      <button type="submit">Go</button>
      <button type="button" aria-label="Close browser tab" disabled={!selected} onClick={() => { void run('close', { tabId: selected?.id }); }}>×</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {!selected && <p>新建一个标签页，或在聊天中让 Browser 打开网页。页面由 Yard 保留，关闭此面板后仍可继续。</p>}
    {state.frame && <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#fff' }}>
      <img src={state.frame.image} alt={selected?.title || 'Browser page'} draggable={false} tabIndex={0}
        style={{ width: '100%', display: 'block', outlineOffset: -2 }}
        onClick={event => {
          const bounds = event.currentTarget.getBoundingClientRect(), frame = state.frame!;
          void run('click', { tabId: selected?.id, x: (event.clientX - bounds.left) / bounds.width * frame.width, y: (event.clientY - bounds.top) / bounds.height * frame.height });
        }}
        onKeyDown={event => {
          if (event.ctrlKey || event.altKey || event.metaKey) return;
          if (['Tab', 'Enter', 'Backspace', 'Delete', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
            event.preventDefault(); void run('key', { tabId: selected?.id, key: event.key });
          } else if (event.key.length === 1) { event.preventDefault(); void run('text', { tabId: selected?.id, text: event.key }); }
        }} />
    </div>}
    {selected && <form style={{ display: 'flex', gap: 4 }} onSubmit={event => { event.preventDefault(); void run('text', { tabId: selected.id, text }); setText(''); }}>
      <input aria-label="Text for focused browser field" value={text} onChange={e => setText(e.target.value)} placeholder="向网页中选中的输入框填写文字" style={{ flex: 1, minWidth: 0 }} />
      <button type="submit">输入</button>
    </form>}
  </section>;
}
