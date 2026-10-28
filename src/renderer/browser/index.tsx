import * as React from 'react';
import { BrowserChrome } from '../../browser-reuse/browser-bridge.ts';
import type { BrowserTarget, ChromePanelState } from '../../browser-reuse/protocol.ts';
import { createChromeSurface } from '../../browser-reuse/webview.tsx';
import type { ComposerDraft, WorkbenchClient } from '../workbench-contract.ts';
import type { ComposerDraftSnapshot } from '../composer/composer-draft-store.ts';
import { addBrowserCommentToDraft, attachBrowserComment, browserOwnerKey, browserReferences, changeBrowserComment, claimLegacyBrowserComment,
  claimProvenLegacyBrowserComments, listLegacyBrowserComments, readBrowserCommentsSnapshot,
  subscribeBrowserComments } from './comments.ts';
import type { BrowserOwner, BrowserReference, LegacyBrowserComments, ResolveLegacyBrowserOwner } from './comments.ts';
import { sameBrowserValue } from './draft-transaction.ts';

export { addBrowserCommentToDraft, adoptLegacyBrowserComments, attachBrowserComment, browserOwnerKey, browserReferences, changeBrowserComment,
  claimLegacyBrowserComment, claimProvenLegacyBrowserComments, listLegacyBrowserComments, pruneBrowserDraftDeletions, readBrowserComments,
  readLegacyBrowserComments, reconcileBrowserReferences, removeBrowserReferenceFromDraft, subscribeBrowserComments } from './comments.ts';
export type { BrowserOwner, BrowserReference } from './comments.ts';
export type { ResolveLegacyBrowserOwner } from './comments.ts';

export interface StandaloneBrowserProps {
  client: WorkbenchClient;
  hostId: string;
  threadId: string | null;
  /** Stable across reloads and distinct for the home and panel drafts. */
  draftId: string;
  browserTabId: string;
  draft: ComposerDraft;
  /** Retained for existing callers; explicit deletion synchronization is owned by the parent. */
  onDraftChange(owner: BrowserOwner, update: (draft: ComposerDraft) => ComposerDraft): void | Promise<void>;
  /** Flush the active composer and return its exact durable owner and revision. */
  getDraftSnapshot?(owner: BrowserOwner): Promise<ComposerDraftSnapshot>;
  /** Adopt an already committed version only if the controller still displays before. */
  onDraftVersionCommitted?(before: ComposerDraftSnapshot, after: ComposerDraftSnapshot): Promise<boolean>;
  /** Return an owner only when the existing atoms prove the complete legacy identity. */
  resolveLegacyOwner?: ResolveLegacyBrowserOwner;
  visible: boolean;
  allowNavigation: boolean;
  navigationRequest?: { id: string; url: string } | null;
  onNavigationConsumed?(id: string): void;
  onClose(): void;
}

const ChromeSurface = createChromeSurface(React);

function displayValue(value: unknown): string {
  try { return JSON.stringify(value, null, 2) ?? String(value); } catch { return '[无法显示此保存值]'; }
}

function CommentEditor({ owner, reference, saved, consumed, attached, getSnapshot, isCurrent, accept }: { owner: BrowserOwner; reference: BrowserReference;
  saved?: BrowserReference; consumed: boolean; attached: boolean; getSnapshot(): Promise<ComposerDraftSnapshot>; isCurrent(): boolean;
  accept(before: ComposerDraftSnapshot, after: ComposerDraftSnapshot): Promise<void> }) {
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
    try {
      const before = await getSnapshot();
      const after = await changeBrowserComment(owner, base, value, before, isCurrent);
      setDirty(false); await accept(before, after);
    }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  const add = async () => {
    setBusy(true); setError('');
    try { const before = await getSnapshot(); await accept(before, await attachBrowserComment(owner, reference, before, isCurrent)); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  const pendingConflict = dirty && !sameBrowserValue(base, reference.original);
  const contextValue = pendingConflict ? base.localBrowserContext : reference.context.localBrowserContext;
  const context = contextValue && typeof contextValue === 'object' && !Array.isArray(contextValue)
    ? contextValue as Record<string, unknown> : {};
  const conflict = pendingConflict || attached && (!saved || !sameBrowserValue(reference, saved));
  return <li style={{ borderTop: '1px solid #8884', padding: '8px 0', display: 'grid', gap: 6 }}>
    <strong>{String(context.targetDescription || 'Browser selection')}</strong>
    <span style={{ overflowWrap: 'anywhere' }}>{String(context.pageUrl || '')}</span>
    {consumed ? <span>已提交</span> : null}
    {conflict ? <div role="status">草稿中的引用与已保存批注不同，两份内容已保留。
      <details><summary>核对批注版本</summary><p>{pendingConflict ? '编辑起点' : '草稿版本'}</p><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{displayValue(pendingConflict ? base : reference)}</pre>
        <p>已保存版本</p><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{saved ? displayValue(saved) : '已保存批注不存在或无法识别'}</pre></details>
    </div> : null}
    <textarea aria-label="浏览器引用批注" value={text} readOnly={conflict} onChange={event => { setText(event.target.value); setDirty(true); }} rows={2} />
    <div style={{ display: 'flex', gap: 8 }}>
      {!attached ? <button disabled={busy} onClick={() => { void add(); }}>添加到草稿</button> : null}
      <button disabled={conflict || !dirty || busy} onClick={() => { void update(text); }}>保存批注</button>
      <button disabled={conflict || busy} onClick={() => { void update(null); }}>删除引用</button>
    </div>
    {error ? <span role="alert">{error}</span> : null}
  </li>;
}

function BrowserPanel({ client, owner, browserTabId, draft, visible, allowNavigation, navigationRequest, onNavigationConsumed,
  getDraftSnapshot, onDraftVersionCommitted, resolveLegacyOwner, onClose }: {
  client: WorkbenchClient; owner: BrowserOwner; browserTabId: string; visible: boolean; allowNavigation: boolean;
  draft: ComposerDraft;
  onClose(): void;
  getDraftSnapshot: StandaloneBrowserProps['getDraftSnapshot']; resolveLegacyOwner: StandaloneBrowserProps['resolveLegacyOwner'];
  onDraftVersionCommitted: StandaloneBrowserProps['onDraftVersionCommitted'];
  navigationRequest: StandaloneBrowserProps['navigationRequest']; onNavigationConsumed: StandaloneBrowserProps['onNavigationConsumed'];
}) {
  const ownerKey = browserOwnerKey(owner);
  const target = React.useMemo<BrowserTarget>(() => ({ conversationId: ownerKey, browserTabId }), [ownerKey, browserTabId]);
  const bridge = React.useMemo(() => new BrowserChrome((endpoint, body) => client.host(endpoint, body as Record<string, unknown>), () => {}), [client]);
  const [state, setState] = React.useState<ChromePanelState>();
  const [address, setAddress] = React.useState('');
  const [comments, setComments] = React.useState<unknown[]>([]);
  const [consumed, setConsumed] = React.useState<BrowserReference[]>([]);
  const [legacy, setLegacy] = React.useState<LegacyBrowserComments[]>([]);
  const [error, setError] = React.useState('');
  const [commentsError, setCommentsError] = React.useState('');
  const [legacyError, setLegacyError] = React.useState('');
  const active = React.useRef(false);
  const snapshotRef = React.useRef(getDraftSnapshot);
  const committedRef = React.useRef(onDraftVersionCommitted);
  React.useLayoutEffect(() => { snapshotRef.current = getDraftSnapshot;
    committedRef.current = onDraftVersionCommitted; }, [getDraftSnapshot, onDraftVersionCommitted]);
  const getSnapshot = React.useCallback(async () => {
    if (!active.current || !snapshotRef.current || !committedRef.current) throw new Error('草稿版本尚未就绪，浏览器引用未更改。');
    const snapshot = await snapshotRef.current(owner);
    if (!active.current) throw new Error('草稿已切换，浏览器引用未更改。');
    return snapshot;
  }, [ownerKey]);
  const accept = React.useCallback(async (before: ComposerDraftSnapshot, after: ComposerDraftSnapshot) => {
    if (before.revision === after.revision) return;
    try { if (await committedRef.current?.(before, after)) return; } catch { /* The transaction already committed. */ }
    throw new Error('批注和新草稿版本已保存，请在草稿版本中核对并选择；当前编辑已保留。');
  }, []);
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
          const [nextSnapshot, nextLegacy] = await Promise.all([readBrowserCommentsSnapshot(owner), listLegacyBrowserComments()]);
          if (!live || !active.current) return;
          setComments(nextSnapshot.comments); setConsumed(nextSnapshot.consumed); setLegacy(nextLegacy); setCommentsError('');
        }
      })().catch(failure => {
        if (live && active.current) setCommentsError((failure as Error).message);
      }).finally(() => { refreshing = false; if (pending) refresh(); });
    };
    const unsubscribe = subscribeBrowserComments(refresh);
    refresh();
    if (resolveLegacyOwner) void claimProvenLegacyBrowserComments(owner, resolveLegacyOwner, () => live && active.current)
      .catch(failure => { if (live && active.current) setLegacyError((failure as Error).message); });
    return () => { live = false; unsubscribe(); };
  }, [bridge, target, ownerKey, visible, resolveLegacyOwner]);
  const quote = React.useCallback(async (_target: BrowserTarget, pageId: number) => {
    const version = bridge.selectionVersion(target);
    const anchor = await bridge.selectedElement(target, pageId);
    const isCurrent = () => active.current && bridge.selectionIsCurrent(target, pageId, version);
    if (!isCurrent()) throw new Error('浏览器面板已切换，请重新引用');
    const before = await getSnapshot();
    const result = await addBrowserCommentToDraft(owner, anchor, before, isCurrent);
    await accept(before, result.snapshot);
    return anchor.title;
  }, [bridge, target, ownerKey, getSnapshot, accept]);
  const command = (type: string, url?: string) => {
    setError('');
    void bridge.request({ ...target, operation: 'command', command: { type, ...(url === undefined ? {} : { url }) } })
      .catch(failure => { if (active.current) setError((failure as Error).message); });
  };
  const references = browserReferences(owner, comments);
  const draftReferences = (draft.references ?? []).filter((value): value is BrowserReference => value.kind === 'browser'
    && !!value.context && value.context.hostId === owner.hostId && value.context.threadId === owner.threadId
    && value.context.draftId === owner.draftId && !!value.original && typeof value.original === 'object' && !Array.isArray(value.original));
  const displayed = references.map(saved => {
    const attached = (draft.references ?? []).filter(value => value.id === saved.id);
    const recognized = draftReferences.filter(value => value.id === saved.id);
    return { reference: attached.length === 1 && recognized.length === 1 ? recognized[0]! : saved, saved,
      attached: attached.length > 0, ambiguous: attached.length > 1 || attached.length === 1 && recognized.length !== 1, raw: attached };
  });
  for (const reference of draftReferences) if (!references.some(value => value.id === reference.id)) {
    displayed.push({ reference, saved: undefined as unknown as BrowserReference, attached: true, ambiguous: false, raw: [reference] });
  }
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
    {legacyError ? <p role="alert" style={{ margin: 8 }}>{legacyError}</p> : null}
    <div style={{ flex: 1, minHeight: 200 }}><ChromeSurface target={target} bridge={bridge} visible={visible} onQuote={quote} /></div>
    <section aria-label="浏览器引用" style={{ maxHeight: '40%', overflow: 'auto', padding: '0 8px' }}>
      {displayed.length ? <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>{displayed.map(({ reference, saved, attached, ambiguous, raw }, index) =>
        ambiguous ? <li key={reference.id + ':' + index} role="status">草稿中相同 ID 的引用无法安全核对，内容已保留。
          <details><summary>核对草稿和已保存引用</summary><p>草稿版本</p><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{displayValue(raw)}</pre>
            <p>已保存版本</p><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{displayValue(saved)}</pre></details></li> :
        <CommentEditor key={reference.id + ':' + index} owner={owner} reference={reference} saved={saved}
          consumed={consumed.some(value => sameBrowserValue(value, reference))} attached={attached} getSnapshot={getSnapshot} accept={accept}
          isCurrent={() => active.current} />)}</ul> : null}
      {comments.length > references.length ? <details><summary>无法识别或冲突的已保存批注</summary>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{displayValue(comments)}</pre></details> : null}
      {legacy.length ? <details><summary>待认领的旧浏览器批注</summary>
        <p style={{ overflowWrap: 'anywhere' }}>认领目标：主机 {owner.hostId}，会话 {owner.threadId ?? '新会话'}，草稿 {owner.draftId}</p>
        {legacy.map(entry => <section key={entry.owner}><strong>{entry.owner}</strong>
          {Array.isArray(entry.value) ? entry.value.map((item, index) => {
            const candidate = browserReferences(owner, [item])[0];
            const metadata = candidate?.original.localBrowserCommentMetadata as Record<string, unknown> | undefined;
            const collisions = candidate ? comments.filter(value => {
              if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
              const stored = (value as Record<string, unknown>).localBrowserCommentMetadata;
              return !!stored && typeof stored === 'object' && !Array.isArray(stored)
                && (stored as Record<string, unknown>).commentId === metadata?.commentId;
            }) : [];
            return <div key={index} style={{ borderTop: '1px solid #8884', padding: '8px 0' }}>
              <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{displayValue(item)}</pre>
              {collisions.length ? <details><summary>核对目标中的同 ID 批注</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{displayValue(collisions)}</pre></details> : null}
              {candidate ? <button onClick={() => {
                setLegacyError('');
                void claimLegacyBrowserComment(owner, entry.owner, entry.value as unknown[], index, collisions.length > 0, () => active.current)
                  .catch(failure => { if (active.current) setLegacyError((failure as Error).message); });
              }}>{collisions.length ? '保留两份并认领到当前草稿' : '认领到当前草稿'}</button> : <span>此旧记录无法识别，已保留。</span>}
            </div>;
          }) : <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{displayValue(entry.value)}</pre>}
        </section>)}
      </details> : null}
    </section>
  </section>;
}

export function StandaloneBrowser(props: StandaloneBrowserProps) {
  const owner = { hostId: props.hostId, threadId: props.threadId, draftId: props.draftId };
  const key = JSON.stringify([browserOwnerKey(owner), props.browserTabId]);
  return <BrowserPanel key={key} client={props.client} owner={owner} browserTabId={props.browserTabId} draft={props.draft} visible={props.visible}
    allowNavigation={props.allowNavigation} navigationRequest={props.navigationRequest} onNavigationConsumed={props.onNavigationConsumed}
    getDraftSnapshot={props.getDraftSnapshot} onDraftVersionCommitted={props.onDraftVersionCommitted}
    resolveLegacyOwner={props.resolveLegacyOwner} onClose={props.onClose} />;
}
