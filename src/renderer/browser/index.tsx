import * as React from 'react';
import { BrowserChrome } from '../../browser-reuse/browser-bridge.ts';
import type { BrowserTarget, ChromePanelState } from '../../browser-reuse/protocol.ts';
import { createChromeSurface } from '../../browser-reuse/webview.tsx';
import type { ComposerDraft, WorkbenchClient } from '../workbench-contract.ts';
import { addBrowserComment, addBrowserDraftReference, browserOwnerKey, browserReferences, changeBrowserComment, readBrowserCommentsSnapshot,
  reconcileBrowserReferences, removeExplicitlyDeletedBrowserReferences, subscribeBrowserComments } from './comments.ts';
import type { BrowserOwner, BrowserReference } from './comments.ts';

export { adoptLegacyBrowserComments, browserOwnerKey, browserReferences, changeBrowserComment, readBrowserComments,
  readLegacyBrowserComments, reconcileBrowserReferences, subscribeBrowserComments } from './comments.ts';
export type { BrowserOwner, BrowserReference } from './comments.ts';

export interface StandaloneBrowserProps {
  client: WorkbenchClient;
  hostId: string;
  threadId: string | null;
  /** Stable across reloads and distinct for the home and panel drafts. */
  draftId: string;
  browserTabId: string;
  draft: ComposerDraft;
  /** Wait for draft initialization, then update the latest draft only if its owner still matches. */
  onDraftChange(owner: BrowserOwner, update: (draft: ComposerDraft) => ComposerDraft): void | Promise<void>;
  visible: boolean;
  allowNavigation: boolean;
  navigationRequest?: { id: string; url: string } | null;
  onNavigationConsumed?(id: string): void;
  onClose(): void;
}

const ChromeSurface = createChromeSurface(React);

function CommentEditor({ owner, reference, consumed, attached, onAdd }: { owner: BrowserOwner; reference: BrowserReference;
  consumed: boolean; attached: boolean; onAdd(): Promise<void> }) {
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
  const add = async () => {
    setBusy(true); setError('');
    try { await onAdd(); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  const context = reference.context.localBrowserContext as Record<string, unknown>;
  return <li style={{ borderTop: '1px solid #8884', padding: '8px 0', display: 'grid', gap: 6 }}>
    <strong>{String(context.targetDescription || 'Browser selection')}</strong>
    <span style={{ overflowWrap: 'anywhere' }}>{String(context.pageUrl || '')}</span>
    {consumed ? <span>已提交</span> : null}
    <textarea aria-label="浏览器引用批注" value={text} onChange={event => { setText(event.target.value); setDirty(true); }} rows={2} />
    <div style={{ display: 'flex', gap: 8 }}>
      {!attached ? <button disabled={busy} onClick={() => { void add(); }}>添加到草稿</button> : null}
      <button disabled={!dirty || busy} onClick={() => { void update(text); }}>保存批注</button>
      <button disabled={busy} onClick={() => { void update(null); }}>删除引用</button>
    </div>
    {error ? <span role="alert">{error}</span> : null}
  </li>;
}

function BrowserPanel({ client, owner, browserTabId, draft, visible, allowNavigation, navigationRequest, onNavigationConsumed, onDraftChange, onClose }: {
  client: WorkbenchClient; owner: BrowserOwner; browserTabId: string; visible: boolean; allowNavigation: boolean;
  draft: ComposerDraft;
  onDraftChange: StandaloneBrowserProps['onDraftChange']; onClose(): void;
  navigationRequest: StandaloneBrowserProps['navigationRequest']; onNavigationConsumed: StandaloneBrowserProps['onNavigationConsumed'];
}) {
  const ownerKey = browserOwnerKey(owner);
  const target = React.useMemo<BrowserTarget>(() => ({ conversationId: ownerKey, browserTabId }), [ownerKey, browserTabId]);
  const bridge = React.useMemo(() => new BrowserChrome((endpoint, body) => client.host(endpoint, body as Record<string, unknown>), () => {}), [client]);
  const [state, setState] = React.useState<ChromePanelState>();
  const [address, setAddress] = React.useState('');
  const [comments, setComments] = React.useState<unknown[]>([]);
  const [consumed, setConsumed] = React.useState<BrowserReference[]>([]);
  const [error, setError] = React.useState('');
  const [commentsError, setCommentsError] = React.useState('');
  const active = React.useRef(false);
  const previous = React.useRef<BrowserReference[]>([]);
  const previousDeleted = React.useRef<BrowserReference[]>([]);
  const onDraftChangeRef = React.useRef(onDraftChange);
  React.useLayoutEffect(() => { onDraftChangeRef.current = onDraftChange; }, [onDraftChange]);
  React.useEffect(() => bridge.subscribe(target, setState), [bridge, target]);
  React.useEffect(() => { setAddress(state?.frame?.url ?? ''); }, [state?.frame?.url]);
  const attemptedNavigation = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!visible || !allowNavigation || !navigationRequest || attemptedNavigation.current === navigationRequest.id) return;
    attemptedNavigation.current = navigationRequest.id;
    const request = navigationRequest;
    void (async () => {
      try {
        const url = new URL(request.url);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('网页地址无效。');
        await bridge.request({ ...target, operation: 'command', command: { type: 'navigate', url: url.href } });
      } catch (failure) { if (active.current) setError((failure as Error).message); }
      finally { onNavigationConsumed?.(request.id); }
    })();
  }, [bridge, target, visible, allowNavigation, navigationRequest, onNavigationConsumed]);
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
    let refreshing = false, pending = false;
    const refresh = () => {
      if (!live || !active.current) return;
      pending = true;
      if (refreshing) return;
      refreshing = true;
      void (async () => {
        while (live && active.current && pending) {
          pending = false;
          const nextSnapshot = await readBrowserCommentsSnapshot(owner);
          if (!live || !active.current) return;
          const next = browserReferences(owner, nextSnapshot.comments), before = previous.current;
          // Process later notifications after this draft update has committed.
          if (before.some(reference => !next.some(value => JSON.stringify(value) === JSON.stringify(reference)))
            || JSON.stringify(previousDeleted.current) !== JSON.stringify(nextSnapshot.deleted)) {
            await onDraftChangeRef.current(owner, value => removeExplicitlyDeletedBrowserReferences(
              reconcileBrowserReferences(value, before, next), nextSnapshot.deleted));
          }
          if (!live || !active.current) return;
          previous.current = next;
          previousDeleted.current = nextSnapshot.deleted;
          setComments(nextSnapshot.comments); setConsumed(nextSnapshot.consumed); setCommentsError('');
        }
      })().catch(failure => {
        if (live && active.current) setCommentsError((failure as Error).message);
      }).finally(() => { refreshing = false; if (pending) refresh(); });
    };
    const unsubscribe = subscribeBrowserComments(refresh);
    refresh();
    return () => { live = false; unsubscribe(); };
  }, [bridge, target, ownerKey, visible]);
  const quote = React.useCallback(async (_target: BrowserTarget, pageId: number) => {
    const version = bridge.selectionVersion(target);
    const anchor = await bridge.selectedElement(target, pageId);
    const isCurrent = () => active.current && bridge.selectionIsCurrent(target, pageId, version);
    if (!isCurrent()) throw new Error('浏览器面板已切换，请重新引用');
    const reference = await addBrowserComment(owner, anchor, isCurrent);
    if (!isCurrent()) throw new Error('浏览器面板已切换，批注已保留');
    await onDraftChangeRef.current(owner, value => addBrowserDraftReference(value, reference));
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
        <CommentEditor key={reference.id} owner={owner} reference={reference}
          consumed={consumed.some(value => JSON.stringify(value) === JSON.stringify(reference))}
          attached={(draft.references ?? []).some(value => value.id === reference.id)}
          onAdd={async () => { await onDraftChangeRef.current(owner, value => addBrowserDraftReference(value, reference)); }} />)}</ul> : null}
      {comments.length > references.length ? <p role="status">部分无法识别的浏览器批注已保留。</p> : null}
    </section>
  </section>;
}

export function StandaloneBrowser(props: StandaloneBrowserProps) {
  const owner = { hostId: props.hostId, threadId: props.threadId, draftId: props.draftId };
  const key = JSON.stringify([browserOwnerKey(owner), props.browserTabId]);
  return <BrowserPanel key={key} client={props.client} owner={owner} browserTabId={props.browserTabId} draft={props.draft} visible={props.visible}
    allowNavigation={props.allowNavigation} navigationRequest={props.navigationRequest} onNavigationConsumed={props.onNavigationConsumed}
    onDraftChange={props.onDraftChange} onClose={props.onClose} />;
}
