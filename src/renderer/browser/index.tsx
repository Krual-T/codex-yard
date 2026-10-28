import * as React from 'react';
import { BrowserChrome } from '../../browser-reuse/browser-bridge.ts';
import type { BrowserTarget, ChromePanelState } from '../../browser-reuse/protocol.ts';
import { createChromeSurface } from '../../browser-reuse/webview.tsx';
import type { ComposerDraft, WorkbenchClient } from '../workbench-contract.ts';
import { addBrowserComment, browserOwnerKey, browserReferences, changeBrowserComment, readBrowserComments,
  reconcileBrowserReferences, subscribeBrowserComments } from './comments.ts';
import type { BrowserOwner, BrowserReference } from './comments.ts';

export { acknowledgeBrowserReferences, adoptLegacyBrowserComments, browserOwnerKey, browserReferences,
  changeBrowserComment, readBrowserComments, readLegacyBrowserComments, reconcileBrowserReferences, subscribeBrowserComments } from './comments.ts';
export type { BrowserOwner, BrowserReference } from './comments.ts';

export interface StandaloneBrowserProps {
  client: WorkbenchClient;
  hostId: string;
  threadId: string | null;
  /** Stable across reloads and distinct for the home and panel drafts. */
  draftId: string;
  browserTabId: string;
  draft: ComposerDraft;
  /** Apply the update to the latest draft only when its owner still matches. */
  onDraftChange(owner: BrowserOwner, update: (draft: ComposerDraft) => ComposerDraft): void;
  visible: boolean;
  allowNavigation: boolean;
  onClose(): void;
}

const ChromeSurface = createChromeSurface(React);

function CommentEditor({ owner, reference }: { owner: BrowserOwner; reference: BrowserReference }) {
  const initialText = (value: Record<string, unknown>) => Array.isArray(value.content)
    ? value.content.filter((item): item is { content_type: string; text: string } =>
      item != null && typeof item === 'object' && item.content_type === 'text' && typeof item.text === 'string').map(item => item.text).join('\n') : '';
  const [base, setBase] = React.useState(reference.original);
  const [text, setText] = React.useState(() => initialText(reference.original));
  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    if (!dirty) { setBase(reference.original); setText(initialText(reference.original)); }
  }, [reference.original, dirty]);
  const update = async (value: string | null) => {
    setBusy(true); setError('');
    try { await changeBrowserComment(owner, base, value); setDirty(false); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  const context = reference.context.localBrowserContext as Record<string, unknown>;
  return <li style={{ borderTop: '1px solid #8884', padding: '8px 0', display: 'grid', gap: 6 }}>
    <strong>{String(context.targetDescription || 'Browser selection')}</strong>
    <span style={{ overflowWrap: 'anywhere' }}>{String(context.pageUrl || '')}</span>
    <textarea aria-label="浏览器引用批注" value={text} onChange={event => { setText(event.target.value); setDirty(true); }} rows={2} />
    <div style={{ display: 'flex', gap: 8 }}>
      <button disabled={!dirty || busy} onClick={() => { void update(text); }}>保存批注</button>
      <button disabled={busy} onClick={() => { void update(null); }}>删除引用</button>
    </div>
    {error ? <span role="alert">{error}</span> : null}
  </li>;
}

function BrowserPanel({ client, owner, browserTabId, visible, allowNavigation, onDraftChange, onClose }: {
  client: WorkbenchClient; owner: BrowserOwner; browserTabId: string; visible: boolean; allowNavigation: boolean;
  onDraftChange: StandaloneBrowserProps['onDraftChange']; onClose(): void;
}) {
  const ownerKey = browserOwnerKey(owner);
  const target = React.useMemo<BrowserTarget>(() => ({ conversationId: ownerKey, browserTabId }), [ownerKey, browserTabId]);
  const bridge = React.useMemo(() => new BrowserChrome((endpoint, body) => client.host(endpoint, body as Record<string, unknown>), () => {}), [client]);
  const [state, setState] = React.useState<ChromePanelState>();
  const [address, setAddress] = React.useState('');
  const [comments, setComments] = React.useState<unknown[]>([]);
  const [error, setError] = React.useState('');
  const [commentsError, setCommentsError] = React.useState('');
  const active = React.useRef(false);
  const previous = React.useRef<BrowserReference[]>([]);
  const onDraftChangeRef = React.useRef(onDraftChange);
  React.useLayoutEffect(() => { onDraftChangeRef.current = onDraftChange; }, [onDraftChange]);
  React.useEffect(() => bridge.subscribe(target, setState), [bridge, target]);
  React.useEffect(() => { setAddress(state?.frame?.url ?? ''); }, [state?.frame?.url]);
  React.useLayoutEffect(() => {
    if (!visible) return;
    active.current = true;
    return () => {
      active.current = false;
      void bridge.request({ ...target, operation: 'release' }).catch(() => {});
    };
  }, [bridge, target, visible]);
  React.useEffect(() => {
    if (!visible) return;
    let live = true;
    let generation = 0;
    const refresh = () => {
      if (!active.current) return;
      const current = ++generation;
      void readBrowserComments(owner).then(nextComments => {
        if (!live || !active.current || current !== generation) return;
        const next = browserReferences(owner, nextComments), before = previous.current;
        previous.current = next;
        setComments(nextComments); setCommentsError('');
        if (before.length || next.length) onDraftChangeRef.current(owner, draft => reconcileBrowserReferences(draft, before, next));
      }).catch(failure => {
        if (live && active.current && current === generation) setCommentsError((failure as Error).message);
      });
    };
    const unsubscribe = subscribeBrowserComments(refresh);
    refresh();
    return () => { live = false; generation++; unsubscribe(); };
  }, [bridge, target, ownerKey, visible]);
  const quote = React.useCallback(async (_target: BrowserTarget, pageId: number) => {
    const version = bridge.selectionVersion(target);
    const anchor = await bridge.selectedElement(target, pageId);
    const isCurrent = () => active.current && bridge.selectionIsCurrent(target, pageId, version);
    if (!isCurrent()) throw new Error('浏览器面板已切换，请重新引用');
    await addBrowserComment(owner, anchor, isCurrent);
    return anchor.title;
  }, [bridge, target, ownerKey]);
  const command = (type: string, url?: string) => {
    setError('');
    void bridge.request({ ...target, operation: 'command', command: { type, ...(url === undefined ? {} : { url }) } })
      .catch(failure => { if (active.current) setError((failure as Error).message); });
  };
  const references = browserReferences(owner, comments);
  return <section aria-label="浏览器" style={{ display: visible ? 'flex' : 'none', flexDirection: 'column', height: '100%', minHeight: 0 }}>
    <header style={{ display: 'flex', gap: 6, alignItems: 'center', padding: 8 }}>
      <strong>Chrome</strong>
      {allowNavigation ? <>
        <button title="后退" aria-label="后退" disabled={!state?.frame?.canGoBack} onClick={() => command('go-back')}>←</button>
        <button title="前进" aria-label="前进" disabled={!state?.frame?.canGoForward} onClick={() => command('go-forward')}>→</button>
        <button title="重新加载" aria-label="重新加载" disabled={!state?.pageId} onClick={() => command('reload')}>↻</button>
        <form style={{ flex: 1, display: 'flex', minWidth: 0 }} onSubmit={event => { event.preventDefault(); if (address.trim()) command('navigate', address.trim()); }}>
          <input aria-label="网页地址" value={address} onChange={event => setAddress(event.target.value)} style={{ flex: 1, minWidth: 0 }} />
          <button>打开</button>
        </form>
      </> : null}
      <button onClick={onClose}>关闭</button>
    </header>
    {error ? <p role="alert" style={{ margin: 8 }}>{error}</p> : null}
    {commentsError ? <p role="alert" style={{ margin: 8 }}>{commentsError}</p> : null}
    <div style={{ flex: 1, minHeight: 200 }}><ChromeSurface target={target} bridge={bridge} visible={visible} onQuote={quote} /></div>
    <section aria-label="浏览器引用" style={{ maxHeight: '40%', overflow: 'auto', padding: '0 8px' }}>
      {references.length ? <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>{references.map(reference =>
        <CommentEditor key={reference.id} owner={owner} reference={reference} />)}</ul> : null}
      {comments.length > references.length ? <p role="status">部分无法识别的浏览器批注已保留。</p> : null}
    </section>
  </section>;
}

export function StandaloneBrowser(props: StandaloneBrowserProps) {
  const owner = { hostId: props.hostId, threadId: props.threadId, draftId: props.draftId };
  const key = JSON.stringify([browserOwnerKey(owner), props.browserTabId]);
  return <BrowserPanel key={key} client={props.client} owner={owner} browserTabId={props.browserTabId} visible={props.visible}
    allowNavigation={props.allowNavigation} onDraftChange={props.onDraftChange} onClose={props.onClose} />;
}
