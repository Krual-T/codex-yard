import * as React from 'react';
import { BrowserChrome } from '../../browser-reuse/browser-bridge.ts';
import type { BrowserTarget, ChromePanelState } from '../../browser-reuse/protocol.ts';
import { createChromeSurface } from '../../browser-reuse/webview.tsx';
import type { ComposerDraft, WorkbenchClient } from '../workbench-contract.ts';
import type { ComposerDraftSnapshot } from '../composer/composer-draft-store.ts';
import type { ComposerDraftExternalOperation } from '../composer/use-composer-draft.ts';
import { addBrowserCommentToDraft, attachBrowserComment, browserOwnerKey, browserReferences, changeBrowserComment, claimLegacyBrowserComment,
  claimProvenLegacyBrowserComments, listLegacyBrowserComments, readBrowserCommentArchive, readBrowserCommentsSnapshot, removeBrowserReferenceFromDraft,
  subscribeBrowserComments } from './comments.ts';
import type { BrowserOwner, BrowserReference, LegacyBrowserComments, ResolveLegacyBrowserOwner } from './comments.ts';
import { sameBrowserValue } from './draft-transaction.ts';

export { addBrowserCommentToDraft, attachBrowserComment, browserOwnerKey, browserReferences, changeBrowserComment,
  claimLegacyBrowserComment, claimProvenLegacyBrowserComments, listLegacyBrowserComments, pruneBrowserDraftDeletions, readBrowserComments,
  readLegacyBrowserComments, removeBrowserReferenceFromDraft, subscribeBrowserComments } from './comments.ts';
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
  onDirtyChange?(dirty: boolean): void;
  onRecoveryBarrier?(barrier: (() => Promise<void>) | null): void;
  /** Synchronously bind this browser owner to its active composer's registered operation. */
  beginDraftOperation?(owner: BrowserOwner): ComposerDraftExternalOperation | null;
  /** Adopt or verify an already committed version against the active controller and durable versions. */
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

interface PendingEdit { owner: BrowserOwner; reference: BrowserReference; base: Record<string, unknown>; text: string }
interface PendingProjection { owner: BrowserOwner; before: ComposerDraftSnapshot; snapshot: ComposerDraftSnapshot }
interface BrowserDraftAction { operation: ComposerDraftExternalOperation; finish(success: boolean): void }
type DraftWork<T> = (before: ComposerDraftSnapshot, isCurrent: () => boolean) => Promise<{ after: ComposerDraftSnapshot; value: T }>;
interface BrowserEdits {
  edits: Record<string, PendingEdit>;
  projections: Record<string, PendingProjection>;
  edit(owner: BrowserOwner, reference: BrowserReference, text: string): void;
  discard(key: string): void;
  begin(owner: BrowserOwner, resolving?: boolean): () => void;
  busy(owner: BrowserOwner): boolean;
  hold(value: PendingProjection): void;
  release(value: PendingProjection): boolean;
  projection(owner: BrowserOwner): PendingProjection | undefined;
  barrier(): Promise<void>;
}
const editKey = (owner: BrowserOwner, reference: BrowserReference) => JSON.stringify([browserOwnerKey(owner), reference.id]);
const commentText = (value: Record<string, unknown>) => Array.isArray(value.content)
  ? value.content.filter((item): item is { content_type: string; text: string } =>
    item != null && typeof item === 'object' && item.content_type === 'text' && typeof item.text === 'string').map(item => item.text).join('\n') : '';

function CopyButton({ value, label }: { value: string; label: string }) {
  const [error, setError] = React.useState('');
  return <><button type="button" onClick={() => {
    void (navigator.clipboard?.writeText(value) ?? Promise.reject(new Error('Clipboard unavailable')))
      .then(() => setError('')).catch(() => setError('复制失败，请选择文本手动复制。'));
  }}>{label}</button>{error ? <span role="alert">{error}</span> : null}</>;
}

function SaveSnapshotButton({ snapshot }: { snapshot: ComposerDraftSnapshot }) {
  const [error, setError] = React.useState('');
  return <><button type="button" onClick={() => {
    let url: string | undefined, anchor: HTMLAnchorElement | undefined;
    try {
      const contents = JSON.stringify(snapshot, null, 2);
      url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
      anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'browser-draft-snapshot.json'; anchor.hidden = true;
      document.body.appendChild(anchor); anchor.click();
      setError('');
    } catch { setError('另存失败，请复制已显示的快照。'); }
    finally { anchor?.remove(); if (url) { const savedUrl = url; setTimeout(() => URL.revokeObjectURL(savedUrl), 1_000); } }
  }}>另存已保存快照</button>{error ? <span role="alert">{error}</span> : null}</>;
}

function CommentEditor({ owner, reference, saved, consumed, attached, beginAction, transact, edits }: { owner: BrowserOwner; reference: BrowserReference;
  saved?: BrowserReference; consumed: boolean; attached: boolean; beginAction(): BrowserDraftAction;
  transact<T>(operation: ComposerDraftExternalOperation, work: DraftWork<T>, onCommitted?: () => void): Promise<T>; edits: BrowserEdits }) {
  const key = editKey(owner, reference), pending = edits.edits[key];
  const base = pending?.base ?? reference.original, text = pending?.text ?? commentText(reference.original);
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const [error, setError] = React.useState('');
  const update = async (value: string | null) => {
    if (busyRef.current) return;
    let action: BrowserDraftAction;
    try { action = beginAction(); } catch (failure) { setError((failure as Error).message); return; }
    busyRef.current = true;
    setBusy(true); setError('');
    let success = false;
    try {
      await transact(action.operation, async (before, isCurrent) => ({
        after: value === null && attached
          ? await removeBrowserReferenceFromDraft(owner, reference, before, isCurrent)
          : await changeBrowserComment(owner, base, value, before, isCurrent), value: undefined,
      }), () => { if (value !== null) edits.discard(key); });
      success = true;
    }
    catch (failure) { setError((failure as Error).message); }
    finally {
      busyRef.current = false;
      try { action.finish(success); } catch (failure) { setError((failure as Error).message); }
      finally { setBusy(false); }
    }
  };
  const add = async () => {
    if (busyRef.current) return;
    let action: BrowserDraftAction;
    try { action = beginAction(); } catch (failure) { setError((failure as Error).message); return; }
    busyRef.current = true;
    setBusy(true); setError('');
    let success = false;
    try {
      await transact(action.operation, async (before, isCurrent) => ({
        after: await attachBrowserComment(owner, reference, before, isCurrent), value: undefined,
      }));
      success = true;
    }
    catch (failure) { setError((failure as Error).message); }
    finally {
      busyRef.current = false;
      try { action.finish(success); } catch (failure) { setError((failure as Error).message); }
      finally { setBusy(false); }
    }
  };
  const pendingConflict = !!pending && !sameBrowserValue(base, reference.original);
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
    <textarea aria-label="浏览器引用批注" value={text} readOnly={busy || conflict && !pending} onChange={event => edits.edit(owner, reference, event.target.value)} rows={2} />
    <div style={{ display: 'flex', gap: 8 }}>
      {!attached ? <button disabled={busy} onClick={() => { void add(); }}>添加到草稿</button> : null}
      <button disabled={conflict || !pending || busy} onClick={() => { void update(text); }}>保存批注</button>
      <button disabled={!!pending || busy || conflict && !attached} onClick={() => { void update(null); }}>{conflict && attached ? '从当前草稿移除' : '删除引用'}</button>
      {pending ? <><CopyButton value={text} label="复制未保存文字" /><button disabled={busy} onClick={() => edits.discard(key)}>放弃编辑</button></> : null}
    </div>
    {error ? <span role="alert">{error}</span> : null}
  </li>;
}

function BrowserPanel({ client, owner, browserTabId, draft, visible, allowNavigation, navigationRequest, onNavigationConsumed,
  beginDraftOperation, onDraftVersionCommitted, resolveLegacyOwner, onClose, edits }: {
  client: WorkbenchClient; owner: BrowserOwner; browserTabId: string; visible: boolean; allowNavigation: boolean;
  draft: ComposerDraft;
  edits: BrowserEdits;
  onClose(): void;
  beginDraftOperation: StandaloneBrowserProps['beginDraftOperation']; resolveLegacyOwner: StandaloneBrowserProps['resolveLegacyOwner'];
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
  const [archive, setArchive] = React.useState<string | null>(null);
  const active = React.useRef(false);
  const beginRef = React.useRef(beginDraftOperation);
  const committedRef = React.useRef(onDraftVersionCommitted);
  React.useLayoutEffect(() => { beginRef.current = beginDraftOperation;
    committedRef.current = onDraftVersionCommitted; }, [beginDraftOperation, onDraftVersionCommitted]);
  const beginAction = React.useCallback((): BrowserDraftAction => {
    const finish = edits.begin(owner);
    try {
      if (!active.current || !beginRef.current || !committedRef.current) throw new Error('草稿版本尚未就绪，浏览器引用未更改。');
      const operation = beginRef.current(owner);
      if (!operation) throw new Error('草稿当前无法接收浏览器操作，请先处理输入或草稿冲突。');
      return { operation, finish(success) { try { operation.finish(success); } finally { finish(); } } };
    } catch (failure) { finish(); throw failure; }
  }, [ownerKey, edits.begin]);
  const transact = React.useCallback(async <T,>(operation: ComposerDraftExternalOperation, work: DraftWork<T>, onCommitted?: () => void): Promise<T> => {
    let committed: PendingProjection | undefined;
    try {
      const receipt = await operation.transaction(async (before, isCurrent) => {
        const original = structuredClone(before);
        const result = await work(before, () => active.current && isCurrent());
        committed = { owner: structuredClone(owner), before: original, snapshot: structuredClone(result.after) };
        edits.hold(committed);
        onCommitted?.();
        return result;
      });
      if (committed && receipt.accepted && active.current && sameBrowserValue(receipt.before, committed.before)
        && sameBrowserValue(receipt.after, committed.snapshot) && edits.release(committed)) return receipt.value;
      throw new Error('草稿未能接收已保存版本。');
    } catch (failure) {
      if (committed) throw new Error('批注和新草稿版本已保存，请在草稿版本中核对并选择；当前编辑已保留。');
      throw failure;
    }
  }, [ownerKey, edits.hold, edits.release]);
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
        if (live && active.current) {
          setCommentsError((failure as Error).message);
          void readBrowserCommentArchive().then(value => { if (live && active.current) setArchive(value); }).catch(() => {});
        }
      }).finally(() => { refreshing = false; if (pending) refresh(); });
    };
    const unsubscribe = subscribeBrowserComments(refresh);
    refresh();
    if (resolveLegacyOwner) void claimProvenLegacyBrowserComments(owner, resolveLegacyOwner, () => live && active.current)
      .catch(failure => { if (live && active.current) setLegacyError((failure as Error).message); });
    return () => { live = false; unsubscribe(); };
  }, [bridge, target, ownerKey, visible, resolveLegacyOwner]);
  const quote = React.useCallback(async (_target: BrowserTarget, pageId: number) => {
    const action = beginAction();
    let success = false;
    try {
      const version = bridge.selectionVersion(target);
      const anchor = await bridge.selectedElement(target, pageId);
      if (!active.current || !bridge.selectionIsCurrent(target, pageId, version)) throw new Error('浏览器面板已切换，请重新引用');
      await transact(action.operation, async (before, isCurrent) => {
        const result = await addBrowserCommentToDraft(owner, anchor, before,
          () => isCurrent() && bridge.selectionIsCurrent(target, pageId, version));
        return { after: result.snapshot, value: result.reference };
      });
      success = true;
      return anchor.title;
    } finally { action.finish(success); }
  }, [bridge, target, ownerKey, beginAction, transact]);
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
  for (const reference of draftReferences) if (!displayed.some(value => value.reference.id === reference.id)) {
    const raw = (draft.references ?? []).filter(value => value.id === reference.id);
    displayed.push({ reference, saved: undefined as unknown as BrowserReference, attached: true, ambiguous: raw.length !== 1, raw });
  }
  const visibleIds = new Set(displayed.filter(value => !value.ambiguous).map(value => value.reference.id));
  const pendingElsewhere = Object.entries(edits.edits).filter(([, value]) => browserOwnerKey(value.owner) !== ownerKey || !visibleIds.has(value.reference.id));
  const projection = edits.projections[ownerKey];
  const otherProjections = Object.values(edits.projections).filter(value => browserOwnerKey(value.owner) !== ownerKey);
  const discardProjection = (value: PendingProjection) => {
    let finish: (() => void) | undefined;
    try {
      finish = edits.begin(value.owner, true);
      if (!edits.release(value)) throw new Error('待接收快照已变化，请重新核对。');
      setError('');
    } catch (failure) { setError((failure as Error).message); }
    finally { finish?.(); }
  };
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
      <button onClick={() => { void edits.barrier().then(onClose).catch(failure => setError((failure as Error).message)); }}>关闭</button>
    </header>
    {error ? <p role="alert" style={{ margin: 8 }}>{error}</p> : null}
    {commentsError ? <p role="alert" style={{ margin: 8 }}>{commentsError}</p> : null}
    {legacyError ? <p role="alert" style={{ margin: 8 }}>{legacyError}</p> : null}
    {archive !== null && commentsError ? <details><summary>取回旧批注原文</summary>
      <textarea aria-label="旧批注原文" readOnly value={archive} rows={5} /><CopyButton value={archive} label="复制旧批注原文" />
    </details> : null}
    <div style={{ flex: 1, minHeight: 200 }}><ChromeSurface target={target} bridge={bridge} visible={visible} onQuote={quote} /></div>
    <section aria-label="浏览器引用" style={{ maxHeight: '40%', overflow: 'auto', padding: '0 8px' }}>
      {projection ? <section role="status"><strong>批注和新草稿版本已保存，请在草稿版本中核对并选择。</strong>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{displayValue(projection.snapshot)}</pre>
        <CopyButton value={displayValue(projection.snapshot)} label="复制已保存版本" />
        <SaveSnapshotButton snapshot={projection.snapshot} />
        <button disabled={edits.busy(owner)} onClick={() => {
          void (async () => {
            const finish = edits.begin(owner, true);
            try {
              const current = edits.projection(owner), committed = committedRef.current;
              if (!active.current || !committed || !current || !sameBrowserValue(current, projection)
                || !await committed(projection.before, projection.snapshot) || !active.current
                || !edits.release(projection)) {
                throw new Error('当前草稿未能确认此活动版本，请核对、复制或明确放弃待接收快照。');
              }
              setError('');
            } finally { finish(); }
          })().catch(failure => setError((failure as Error).message));
        }}>核对已保存的草稿版本</button>
        <button disabled={edits.busy(owner)} onClick={() => discardProjection(projection)}>放弃此待接收快照</button>
        <span>放弃不会更改已保存的草稿或批注。</span>
      </section> : null}
      {otherProjections.map(value => <section key={browserOwnerKey(value.owner)} role="status">
        <strong>其他草稿有已保存但尚未接收的版本</strong><p>{value.owner.hostId} / {value.owner.threadId ?? '新会话'} / {value.owner.draftId}</p>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{displayValue(value.snapshot)}</pre>
        <CopyButton value={displayValue(value.snapshot)} label="复制已保存版本" />
        <SaveSnapshotButton snapshot={value.snapshot} />
        <button disabled={edits.busy(value.owner)} onClick={() => discardProjection(value)}>放弃此待接收快照</button>
        <span>放弃不会更改已保存的草稿或批注。</span>
      </section>)}
      {pendingElsewhere.length ? <section aria-label="待处理的批注编辑"><strong>待处理的批注编辑</strong>
        {pendingElsewhere.map(([key, value]) => <div key={key}>
          <p>{value.owner.hostId} / {value.owner.threadId ?? '新会话'} / {value.owner.draftId}</p>
          <textarea aria-label="待处理的批注文字" value={value.text} readOnly rows={2} />
          <CopyButton value={value.text} label="复制未保存文字" /><button onClick={() => edits.discard(key)}>放弃编辑</button>
        </div>)}
      </section> : null}
      {displayed.length ? <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>{displayed.map(({ reference, saved, attached, ambiguous, raw }) =>
        ambiguous ? <li key={reference.id} role="status">草稿中相同 ID 的引用无法安全核对，内容已保留。
          <details><summary>核对草稿和已保存引用</summary><p>草稿版本</p><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{displayValue(raw)}</pre>
            <p>已保存版本</p><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{displayValue(saved)}</pre></details></li> :
        <CommentEditor key={reference.id} owner={owner} reference={reference} saved={saved}
          consumed={consumed.some(value => sameBrowserValue(value, reference))} attached={attached} beginAction={beginAction} transact={transact}
          edits={edits} />)}</ul> : null}
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
                void (async () => {
                  const finish = edits.begin(owner);
                  try { await claimLegacyBrowserComment(owner, entry.owner, entry.value as unknown[], index, collisions.length > 0, () => active.current); }
                  finally { finish(); }
                })().catch(failure => { if (active.current) setLegacyError((failure as Error).message); });
              }}>{collisions.length ? '保留两份并认领批注' : '认领可添加的批注'}</button> : <span>此旧记录无法识别，已保留。</span>}
            </div>;
          }) : <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{displayValue(entry.value)}</pre>}
        </section>)}
      </details> : null}
    </section>
  </section>;
}

export function StandaloneBrowser(props: StandaloneBrowserProps) {
  const pending = React.useRef<Record<string, PendingEdit>>({});
  const projections = React.useRef<Record<string, PendingProjection>>({});
  const inFlight = React.useRef(new Map<string, symbol>());
  const dirtyCallback = React.useRef(props.onDirtyChange);
  const [, render] = React.useReducer((value: number) => value + 1, 0);
  React.useLayoutEffect(() => { dirtyCallback.current = props.onDirtyChange; }, [props.onDirtyChange]);
  const dirty = React.useCallback(() => inFlight.current.size > 0 || Object.keys(pending.current).length > 0
    || Object.keys(projections.current).length > 0, []);
  const changed = React.useCallback(() => { dirtyCallback.current?.(dirty()); render(); }, [dirty]);
  const edit = React.useCallback((owner: BrowserOwner, reference: BrowserReference, text: string) => {
    const key = editKey(owner, reference), previous = pending.current[key];
    pending.current = { ...pending.current, [key]: previous ? { ...previous, text }
      : { owner: structuredClone(owner), reference: structuredClone(reference), base: structuredClone(reference.original), text } };
    changed();
  }, [changed]);
  const discard = React.useCallback((key: string) => {
    if (!Object.hasOwn(pending.current, key)) return;
    const next = { ...pending.current }; delete next[key]; pending.current = next; changed();
  }, [changed]);
  const begin = React.useCallback((owner: BrowserOwner, resolving = false) => {
    const key = browserOwnerKey(owner);
    if (inFlight.current.has(key)) throw new Error('此草稿的浏览器操作正在处理，请稍后重试。');
    if (!resolving && projections.current[key]) throw new Error('请先处理此草稿的待接收快照，再修改浏览器引用。');
    const token = Symbol();
    inFlight.current.set(key, token); changed();
    return () => {
      if (inFlight.current.get(key) !== token) return;
      inFlight.current.delete(key); changed();
    };
  }, [changed]);
  const busy = React.useCallback((owner: BrowserOwner) => inFlight.current.has(browserOwnerKey(owner)), []);
  const hold = React.useCallback((value: PendingProjection) => {
    const key = browserOwnerKey(value.owner);
    if (projections.current[key]) throw new Error('此草稿已有待接收快照。');
    projections.current = { ...projections.current, [key]: structuredClone(value) };
    changed();
  }, [changed]);
  const release = React.useCallback((value: PendingProjection) => {
    const key = browserOwnerKey(value.owner);
    if (!sameBrowserValue(projections.current[key], value)) return false;
    const next = { ...projections.current }; delete next[key]; projections.current = next; changed();
    return true;
  }, [changed]);
  const projection = React.useCallback((owner: BrowserOwner) => projections.current[browserOwnerKey(owner)], []);
  const barrier = React.useCallback(async () => {
    if (dirty()) throw new Error('浏览器批注有待处理的编辑或已保存版本，请先核对、保存或明确放弃编辑。');
  }, [dirty]);
  React.useLayoutEffect(() => {
    props.onRecoveryBarrier?.(barrier); props.onDirtyChange?.(dirty());
    return () => props.onRecoveryBarrier?.(null);
  }, [props.onRecoveryBarrier, props.onDirtyChange, barrier, dirty]);
  React.useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty()) event.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  const edits: BrowserEdits = { edits: pending.current, projections: projections.current, edit, discard, begin, busy, hold, release, projection, barrier };
  const owner = { hostId: props.hostId, threadId: props.threadId, draftId: props.draftId };
  const key = JSON.stringify([browserOwnerKey(owner), props.browserTabId]);
  return <BrowserPanel key={key} client={props.client} owner={owner} browserTabId={props.browserTabId} draft={props.draft} visible={props.visible}
    allowNavigation={props.allowNavigation} navigationRequest={props.navigationRequest} onNavigationConsumed={props.onNavigationConsumed}
    beginDraftOperation={props.beginDraftOperation} onDraftVersionCommitted={props.onDraftVersionCommitted}
    resolveLegacyOwner={props.resolveLegacyOwner} onClose={props.onClose} edits={edits} />;
}
