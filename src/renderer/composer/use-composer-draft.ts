import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { readBrowserAtoms, subscribeBrowserAtoms } from '../storage/ui-atoms.ts';
import type { ComposerContext, ComposerDraft } from '../workbench-contract.ts';
import { clearComposerDraftRevision, composerDraftAtomKey, openComposerDraft, readComposerDraftVersions,
  retainComposerDraftVersion, sameComposerDraftValue, saveComposerDraftConflict, writeComposerDraftVersion } from './composer-draft-store.ts';
import type { ComposerDraftOwner, ComposerDraftSnapshot, ComposerDraftVersions } from './composer-draft-store.ts';
import { createId, emptyDraft, mergePrefill, normalizeDraft } from './standalone-draft.ts';
import type { Draft, StoredDraft } from './standalone-draft.ts';

export interface ComposerDraftController {
  snapshot(): ComposerDraftSnapshot | null;
  update(owner: ComposerDraftOwner, update: (draft: ComposerDraft) => ComposerDraft): Promise<boolean>;
  /** Wait for queued draft writes; this alone does not freeze or drain input. */
  flush(owner: ComposerDraftOwner): Promise<boolean>;
  /** Freeze this owner before a parent changes or unmounts it. */
  freeze(owner: ComposerDraftOwner, borrowed?: ComposerDraftLease): ComposerDraftLease | null;
  /** Use the same projection guard for parent recovery and the local submit path. */
  clearSubmittedVersion(revision: string, guard?: (atoms: Readonly<Record<string, unknown>>) => boolean): Promise<void>;
  /** Adopt an independently committed active version only if this projection still matches. */
  acceptCommittedVersion(before: ComposerDraftSnapshot, after: ComposerDraftSnapshot, applyProjection?: () => boolean): Promise<boolean>;
  /** Register before the first await of an external owner-bound draft operation. */
  beginExternalOperation(owner: ComposerDraftOwner): ComposerDraftExternalOperation | null;
}
export interface ComposerDraftLease {
  flush(): Promise<boolean>;
  release(): void;
}
export interface ComposerDraftExternalOperation {
  transaction<T>(work: (before: ComposerDraftSnapshot, isCurrent: () => boolean) =>
    Promise<{ after: ComposerDraftSnapshot; value: T }>):
    Promise<{ before: ComposerDraftSnapshot; after: ComposerDraftSnapshot; value: T; accepted: boolean }>;
  transaction<T>(work: (before: ComposerDraftSnapshot, isCurrent: () => boolean) =>
    Promise<{ after: ComposerDraftSnapshot; value: T }>, applyProjection: () => boolean):
    Promise<{ before: ComposerDraftSnapshot; after: ComposerDraftSnapshot; value: T; accepted: boolean }>;
  /** Merge and durably mark an asynchronously obtained prefill exactly once. */
  applyPrefill(prefill: { id: string; draft: ComposerDraft }): Promise<boolean>;
  finish(success: boolean): void;
}
export type FinishComposerOperation = (success: boolean) => void;
const legacyKeys = new Set(['composer-prompt-drafts-v2', 'composer-prompt-drafts-v1', 'composer-retained-documents-v1',
  'client-thread-bindings-v1', 'draft-thread-identities-v1']);
const sameOwner = (left: ComposerDraftOwner, right: ComposerDraftOwner) => left.hostId === right.hostId
  && left.threadId === right.threadId && left.draftId === right.draftId;
// IndexedDB and snapshots structured-clone editor JSON, including its null-prototype attrs.
const samePersistedDraft = (left: unknown, right: unknown): boolean => {
  try { return sameComposerDraftValue(structuredClone(left), structuredClone(right)); } catch { return false; }
};
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
interface Mutation { saved: Promise<boolean> }

export function useComposerDraft(context: ComposerContext, onController?: (controller: ComposerDraftController | null) => void,
  onChange?: (snapshot: ComposerDraftSnapshot) => void, freezeGuard?: RefObject<((afterDrain: boolean) => boolean)>,
  onFreeze?: (frozen: boolean) => void, pendingLink?: RefObject<boolean>, pendingComposition?: RefObject<boolean>,
  onLocalRevision?: (before: string, after: string) => void) {
  const owner = useMemo<ComposerDraftOwner>(() => ({ hostId: context.hostId, threadId: context.threadId, draftId: context.draftId }),
    [context.hostId, context.threadId, context.draftId]);
  const [initial] = useState<StoredDraft>(() => ({ revision: createId(), draft: emptyDraft(), prefills: [] }));
  const current = useRef(initial);
  const [stored, setStored] = useState(initial);
  const [versions, setVersions] = useState<StoredDraft[]>([]);
  const [storageError, setStorageError] = useState('');
  const [saving, setSaving] = useState(false);
  const [unresolved, setUnresolved] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [retry, setRetry] = useState(0);
  const mounted = useRef(false);
  const active = useRef<ComposerDraftController | null>(null);
  const frozen = useRef<ComposerDraftLease | null>(null);
  const cancelFrozen = useRef<(() => void) | null>(null);
  const operations = useRef(new Set<Promise<boolean>>());
  const failedOperations = useRef(0);
  const pendingProjection = useRef(0);
  const preserveProjection = useRef(false);
  const savingConflict = useRef(false);
  const external = useRef<{ phase: 'draining' | 'working' } | null>(null);
  const operationUpdate = useRef<((owner: ComposerDraftOwner, update: (draft: ComposerDraft) => ComposerDraft, prefillId?: string) => Promise<boolean>) | null>(null);
  const clearVersion = useRef<ComposerDraftController['clearSubmittedVersion'] | null>(null);
  const generation = useRef(0);
  const ready = useRef<Promise<ComposerDraftVersions> | null>(null);
  const initializing = useRef(true);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const lastWrite = useRef<Promise<boolean>>(Promise.resolve(true));
  const dirty = useRef(false);
  // Intermediate revisions in the local write queue are not independent drafts.
  const pendingAncestors = useRef(new Set<string>());
  const durableRevision = useRef<string | null>(null);
  const refreshVersions = useRef<(() => void) | null>(null);
  const changeCallback = useRef(onChange);
  changeCallback.current = onChange;
  const localRevisionCallback = useRef(onLocalRevision);
  localRevisionCallback.current = onLocalRevision;
  const freezeCallback = useRef(onFreeze);
  freezeCallback.current = onFreeze;
  const markUnresolved = useCallback(() => {
    preserveProjection.current = true;
    setUnresolved(true);
    setStorageError('当前草稿版本已变化；可见内容尚未确认保存，请先处理冲突。');
  }, []);
  const beginOperation = useCallback((finishCommitted = false): FinishComposerOperation | null => {
    if (!mounted.current || !active.current || frozen.current && (!finishCommitted || !operations.current.size)
      || external.current && !finishCommitted) return null;
    let resolve!: (success: boolean) => void;
    const pending = new Promise<boolean>(done => { resolve = done; });
    operations.current.add(pending);
    void pending.then(() => operations.current.delete(pending));
    let finished = false;
    return success => { if (!finished) { finished = true; if (!success) failedOperations.current++; resolve(success); } };
  }, []);
  const enqueue = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.current.then(operation);
    queue.current = result.then(() => undefined, () => undefined);
    return result;
  }, []);
  const publish = useCallback((controller: ComposerDraftController, value: StoredDraft) => {
    if (active.current === controller && current.current.revision === value.revision) {
      changeCallback.current?.(structuredClone({ owner, draft: value.draft, revision: value.revision }));
    }
  }, [owner]);
  const persist = useCallback((controller: ComposerDraftController, previous: StoredDraft, next: StoredDraft): Promise<boolean> => {
    const operation = enqueue(async () => {
      if (!ready.current) throw new Error('草稿存储尚未初始化。');
      await ready.current;
      if (preserveProjection.current) return false;
      const view = await writeComposerDraftVersion(owner, previous.revision, next);
      if (active.current === controller) {
        durableRevision.current = next.revision;
        if (current.current.revision === next.revision && !preserveProjection.current) {
          dirty.current = false; preserveProjection.current = false; pendingAncestors.current.clear(); setSaving(false); setVersions(view.versions);
          refreshVersions.current?.();
        }
        if (!preserveProjection.current) { setStorageError(''); publish(controller, next); }
      }
      return true;
    }).catch(reason => {
      if (active.current === controller) setStorageError('草稿未能保存，当前内容已保留：' + message(reason));
      if (active.current === controller && current.current.revision === next.revision) setSaving(false);
      return false;
    });
    lastWrite.current = operation;
    return operation;
  }, [enqueue, owner, publish]);
  const apply = useCallback((update: (draft: Draft) => Draft, prefillId?: string, fromOperation = false): Mutation | null => {
    const controller = active.current;
    if (!mounted.current || !controller || frozen.current && !fromOperation) return null;
    const previous = current.current;
    const next = { ...previous, revision: createId(), draft: update(previous.draft),
      prefills: prefillId ? [...previous.prefills, prefillId] : previous.prefills };
    pendingAncestors.current.add(previous.revision);
    current.current = next;
    localRevisionCallback.current?.(previous.revision, next.revision);
    dirty.current = true;
    setStored(next);
    if (preserveProjection.current || external.current?.phase === 'working') {
      markUnresolved(); setSaving(false);
      return { saved: Promise.resolve(false) };
    }
    setSaving(true);
    return { saved: persist(controller, previous, next) };
  }, [markUnresolved, persist]);
  const changeDraft = useCallback((update: (draft: Draft) => Draft, prefillId?: string): Promise<boolean> =>
    apply(update, prefillId)?.saved ?? Promise.resolve(false), [apply]);
  const preserveVisibleDraft = useCallback((rendered: StoredDraft, draft: Draft, composing = false): boolean => {
    if (!mounted.current || !active.current || frozen.current || external.current || initializing.current || dirty.current
      || preserveProjection.current || pendingLink?.current || (pendingComposition?.current && !composing) || current.current.revision === rendered.revision) return false;
    current.current = { ...rendered, revision: createId(), draft };
    localRevisionCallback.current?.(rendered.revision, current.current.revision);
    dirty.current = true;
    setStored(current.current);
    markUnresolved();
    setSaving(false);
    return true;
  }, [markUnresolved, pendingLink, pendingComposition]);
  const changeDraftFromOperation = useCallback((update: (draft: Draft) => Draft): Promise<boolean> =>
    apply(update, undefined, true)?.saved ?? Promise.resolve(false), [apply]);
  const updateDraftFromOperation = useCallback(async (expected: ComposerDraftOwner, update: (draft: ComposerDraft) => ComposerDraft) => {
    const applyUpdate = operationUpdate.current;
    if (!applyUpdate) return false;
    pendingProjection.current++;
    try { return await applyUpdate(expected, update); } finally { pendingProjection.current--; }
  }, []);

  const controller = useMemo<ComposerDraftController>(() => {
    const result: ComposerDraftController = {
      snapshot() {
        return active.current === result ? structuredClone({ owner, draft: current.current.draft, revision: current.current.revision }) : null;
      },
      async flush(expected) {
        if (active.current !== result || !sameOwner(owner, expected)) return false;
        if (preserveProjection.current) return false;
        if (!ready.current) throw new Error('草稿存储尚未初始化。');
        try { await ready.current; } catch { throw new Error('草稿未能保存，当前内容已保留。'); }
        for (;;) {
          if (active.current !== result || preserveProjection.current) return false;
          const revision = current.current.revision, saved = lastWrite.current;
          if (!await saved) throw new Error('草稿未能保存，当前内容已保留。');
          await queue.current;
          if (active.current !== result || preserveProjection.current) return false;
          if (revision === current.current.revision && saved === lastWrite.current) return true;
        }
      },
      freeze(expected, borrowed) {
        if (active.current !== result || !sameOwner(owner, expected)) return null;
        if (frozen.current) return borrowed === frozen.current ? borrowed : null;
        if (initializing.current) { setStorageError(value => value || '草稿正在恢复，请稍后再切换。'); return null; }
        if (!freezeGuard?.current?.(false)) return null;
        const pending = [...operations.current], failureCount = failedOperations.current;
        let cancelDrain!: () => void;
        const cancelled = new Promise<false>(resolve => { cancelDrain = () => resolve(false); });
        const lease: ComposerDraftLease = {
          async flush() {
            // Deliver pending DOM mutations (including ProseMirror's observer) before checking the write queue.
            await Promise.resolve();
            let waiting = pending;
            for (;;) {
              const completed = await Promise.race([Promise.all(waiting).then(values => values.every(Boolean)), cancelled]);
              if (frozen.current !== lease || active.current !== result || !completed || failedOperations.current !== failureCount) return false;
              await Promise.resolve();
              waiting = [...operations.current];
              if (!waiting.length) break;
            }
            if (!freezeGuard?.current?.(true)) return false;
            if (!await Promise.race([result.flush(expected).catch(() => false), cancelled])) return false;
            return frozen.current === lease && active.current === result && failedOperations.current === failureCount
              && !operations.current.size && !!freezeGuard?.current?.(true);
          },
          release() {
            if (frozen.current !== lease || active.current !== result) return;
            frozen.current = null;
            cancelDrain();
            cancelFrozen.current = null;
            if (!external.current) freezeCallback.current?.(false);
            refreshVersions.current?.();
          },
        };
        frozen.current = lease;
        cancelFrozen.current = cancelDrain;
        freezeCallback.current?.(true);
        return lease;
      },
      async update(expected, update) {
        if (active.current !== result || !sameOwner(owner, expected) || pendingComposition?.current) return false;
        const finish = beginOperation();
        if (!finish) return false;
        pendingProjection.current++;
        let success = false;
        try { success = await updateFromOperation(expected, update); return success; }
        finally { pendingProjection.current--; finish(success); }
      },
      async clearSubmittedVersion(revision, guard) {
        if (active.current !== result || !clearVersion.current) throw new Error('原输入区已改变，已发送版本尚未清理。');
        await clearVersion.current(revision, guard);
      },
      async acceptCommittedVersion(before, after, applyProjection) {
        const reject = () => {
          if (active.current === result && frozen.current && operations.current.size) failedOperations.current++;
          return false;
        };
        if (active.current !== result || !sameOwner(owner, before.owner) || !sameOwner(owner, after.owner)
          || !before.revision || !after.revision || initializing.current || pendingLink?.current || pendingComposition?.current) return reject();
        if (dirty.current || pendingProjection.current) {
          if (dirty.current) { markUnresolved(); setSaving(false); refreshVersions.current?.(); }
          return reject();
        }
        let original: ComposerDraftSnapshot, target: ComposerDraftSnapshot;
        try { original = structuredClone(before); target = structuredClone(after); } catch { return reject(); }
        const observed = current.current;
        const matches = (version: StoredDraft, expected: ComposerDraftSnapshot) => version.revision === expected.revision
          && samePersistedDraft(version.draft, expected.draft);
        if (!matches(observed, original) && !matches(observed, target)) {
          if (original.revision !== target.revision) { markUnresolved(); refreshVersions.current?.(); }
          return reject();
        }
        if (original.revision === target.revision && !samePersistedDraft(original.draft, target.draft)) return reject();
        const finish = beginOperation(true);
        if (!finish) return false;
        pendingProjection.current++;
        let success = false, deferredForLink = false;
        try {
          if (!ready.current) return false;
          await ready.current;
          const waiting = queue.current, saved = lastWrite.current;
          await waiting;
          if (!await saved || saved !== lastWrite.current || waiting !== queue.current) return false;
          const view = await readComposerDraftVersions(owner);
          if (active.current !== result || current.current !== observed || dirty.current || pendingProjection.current !== 1
            || saved !== lastWrite.current || waiting !== queue.current) return false;
          const candidates = view.versions.filter(version => version.revision === target.revision);
          if (candidates.length !== 1 || !samePersistedDraft(candidates[0]!.draft, target.draft)) return false;
          // A form opened during this read owns an unchanged local projection.
          // Closing it may re-read; applying it must still write from the original
          // revision. Only a real version/read conflict needs unresolved mode.
          if (pendingLink?.current || pendingComposition?.current) { deferredForLink = true; return false; }
          if (applyProjection?.() === false) return false;
          const next = candidates[0]!;
          current.current = next; setStored(next); setVersions(view.versions);
          if (applyProjection) localRevisionCallback.current?.(observed.revision, next.revision);
          durableRevision.current = next.revision; dirty.current = false; preserveProjection.current = false; setUnresolved(false); setSaving(false);
          lastWrite.current = Promise.resolve(true); setStorageError(''); publish(result, next);
          success = true;
          return true;
        } catch (reason) {
          if (active.current === result) setStorageError('无法读取草稿版本，当前内容已保留：' + message(reason));
          return false;
        } finally {
          pendingProjection.current--;
          if (!success && !deferredForLink && active.current === result) {
            markUnresolved(); setSaving(false); refreshVersions.current?.();
          }
          finish(success);
        }
      },
      beginExternalOperation(expected) {
        if (active.current !== result || !sameOwner(owner, expected) || frozen.current || external.current
          || initializing.current || preserveProjection.current || !freezeGuard?.current?.(false)) return null;
        const previous = [...operations.current];
        const finishOperation = beginOperation();
        if (!finishOperation) return null;
        const gate = { phase: 'draining' as 'draining' | 'working' };
        external.current = gate;
        freezeCallback.current?.(true);
        let finished = false, running = false, used = false, accepted = false;
        const live = () => !finished && external.current === gate && active.current === result;
        const prepare = async () => {
          await Promise.resolve();
          if (!(await Promise.all(previous)).every(Boolean) || !live() || !await result.flush(owner) || !live()) {
            throw new Error('草稿输入未能排空。');
          }
          gate.phase = 'working';
        };
        return {
          async transaction<T>(work: (before: ComposerDraftSnapshot, isCurrent: () => boolean) =>
            Promise<{ after: ComposerDraftSnapshot; value: T }>, applyProjection?: () => boolean) {
            if (!live() || used) throw new Error('草稿外部操作已结束或已使用。');
            used = true; running = true;
            let before: ComposerDraftSnapshot | null = null;
            try {
              await prepare();
              before = result.snapshot();
              if (!before) throw new Error('草稿身份已变化。');
              const original = before;
              const isCurrent = () => live() && !dirty.current && !preserveProjection.current
                && current.current.revision === original.revision && samePersistedDraft(current.current.draft, original.draft);
              const response = await work(structuredClone(original), isCurrent);
              accepted = isCurrent() && await result.acceptCommittedVersion(original, response.after,
                applyProjection ? () => isCurrent() && applyProjection() : undefined);
              return { before: original, after: response.after, value: response.value, accepted };
            } catch (reason) {
              if (before && live()) {
                const observed = current.current;
                try {
                  const view = await readComposerDraftVersions(owner);
                  const matches = view.versions.filter(version => version.revision === observed.revision
                    && samePersistedDraft(version.draft, observed.draft));
                  if (live()) {
                    setVersions(view.versions);
                    if (current.current !== observed || dirty.current || preserveProjection.current || matches.length !== 1) markUnresolved();
                  }
                } catch { if (live()) markUnresolved(); }
                refreshVersions.current?.();
              }
              throw reason;
            } finally { running = false; }
          },
          async applyPrefill(prefill) {
            if (!live() || used || !prefill.id) throw new Error('草稿外部操作已结束或预填无效。');
            const captured = structuredClone(prefill);
            used = true; running = true;
            try {
              await prepare();
              const update = operationUpdate.current;
              accepted = !!update && await update(owner, draft => mergePrefill(normalizeDraft(draft), captured.draft), captured.id);
              return accepted;
            } finally { running = false; }
          },
          finish(success) {
            if (finished) return;
            if (running) throw new Error('草稿外部事务仍在进行。');
            finished = true;
            if (external.current === gate) {
              external.current = null;
              if (!frozen.current && active.current === result) freezeCallback.current?.(false);
              refreshVersions.current?.();
            }
            finishOperation(success && (!used || accepted));
          },
        };
      },
    };
    async function updateFromOperation(expected: ComposerDraftOwner, update: (draft: ComposerDraft) => ComposerDraft, prefillId?: string): Promise<boolean> {
        if (active.current !== result || !sameOwner(owner, expected) || preserveProjection.current || pendingComposition?.current) return false;
        for (;;) {
          await queue.current;
          if (active.current !== result || preserveProjection.current || pendingComposition?.current) return false;
          if (!await lastWrite.current) throw new Error('草稿未能保存，当前内容已保留。');
          if (pendingComposition?.current) return false;
          const previous = current.current;
          if (prefillId && previous.prefills.includes(prefillId)) return true;
          const updated = update(structuredClone(previous.draft));
          if (active.current !== result) return false;
          const draft = normalizeDraft({ ...previous.draft, ...updated });
          if (!prefillId && JSON.stringify(draft) === JSON.stringify(previous.draft)) return true;
          const next = { ...previous, revision: createId(), draft,
            prefills: prefillId ? [...previous.prefills, prefillId] : previous.prefills };
          try {
            const view = await enqueue(async () => {
              if (!ready.current) throw new Error('草稿存储尚未初始化。');
              await ready.current;
              if (active.current !== result || current.current !== previous || pendingComposition?.current) return null;
              return writeComposerDraftVersion(owner, previous.revision, next);
            });
            if (active.current !== result) return false;
            if (pendingComposition?.current) {
              if (view) { markUnresolved(); setSaving(false); refreshVersions.current?.(); }
              return false;
            }
            if (!view || current.current !== previous) continue;
            current.current = next; setStored(next); setVersions(view.versions);
            localRevisionCallback.current?.(previous.revision, next.revision);
            durableRevision.current = next.revision; dirty.current = false; preserveProjection.current = false; setSaving(false);
            lastWrite.current = Promise.resolve(true); setStorageError(''); publish(result, next);
            return true;
          } catch (reason) {
            if (active.current === result) setStorageError('草稿未能保存，当前内容已保留：' + message(reason));
            throw new Error('草稿未能保存，当前内容已保留。');
          }
        }
    }
    operationUpdate.current = updateFromOperation;
    return result;
  }, [beginOperation, enqueue, freezeGuard, markUnresolved, owner, pendingLink, pendingComposition, publish]);

  const legacyIdentity = JSON.stringify([context.hostId, context.threadId, context.draftId, context.placement ?? null, context.legacyDraftKey ?? null]);
  useLayoutEffect(() => {
    mounted.current = true; active.current = controller;
    return () => { if (active.current === controller) { active.current = null; frozen.current = null; cancelFrozen.current?.(); cancelFrozen.current = null; } mounted.current = false; };
  }, [controller]);
  useLayoutEffect(() => {
    const serial = ++generation.current;
    let disposed = false, finished = false, versionRead = 0;
    const valid = () => !disposed && generation.current === serial && active.current === controller;
    initializing.current = true;
    setStorageError(''); setLoaded(false);
    const loading = readBrowserAtoms().then(atoms => openComposerDraft(context, atoms, valid));
    ready.current = loading;
    void loading.then(view => {
      if (!valid()) return;
      finished = true;
      initializing.current = false;
      setStorageError(value => value === '草稿正在恢复，请稍后再切换。' ? '' : value);
      const first = view.versions[0];
      if (!first) throw new Error('草稿初始化未完成。');
      setVersions(view.versions);
      if (current.current === initial) {
        current.current = first; setStored(first); lastWrite.current = Promise.resolve(true); durableRevision.current = first.revision;
        dirty.current = false; preserveProjection.current = false; setUnresolved(false); setSaving(false); publish(controller, first);
      } else if (retry > 0) {
        const value = current.current;
        void persist(controller, { ...initial, revision: durableRevision.current ?? initial.revision }, value);
      }
      setLoaded(true);
    }).catch(reason => { if (valid()) setStorageError('无法恢复草稿，当前内容已保留：' + message(reason)); });
    const refresh = () => {
      if (dirty.current && !preserveProjection.current) return;
      const serial = ++versionRead, observed = current.current, mayAdopt = !pendingProjection.current && !preserveProjection.current
        && !pendingLink?.current && !pendingComposition?.current;
      void readComposerDraftVersions(owner).then(view => {
        if (!valid() || serial !== versionRead || dirty.current && !preserveProjection.current || current.current !== observed) return;
        setVersions(view.versions);
        if (mayAdopt && !pendingProjection.current && !preserveProjection.current && !pendingLink?.current && !pendingComposition?.current
          && !frozen.current && !external.current && finished
          && !view.versions.some(value => value.revision === observed.revision) && view.versions.length === 1) {
          const next = view.versions[0]!;
          current.current = next; setStored(next); durableRevision.current = next.revision;
          lastWrite.current = Promise.resolve(true); publish(controller, next);
        }
      }).catch(reason => { if (valid()) setStorageError('无法读取草稿版本：' + message(reason)); });
    };
    refreshVersions.current = refresh;
    const unsubscribe = subscribeBrowserAtoms(keys => {
      if (keys.some(key => legacyKeys.has(key)) && !finished) { generation.current += 1; setRetry(value => value + 1); return; }
      if (keys.includes(composerDraftAtomKey)) refresh();
    });
    return () => { disposed = true; if (refreshVersions.current === refresh) refreshVersions.current = null; unsubscribe(); };
  }, [controller, legacyIdentity, retry, initial, owner, pendingLink, pendingComposition, persist, publish]);
  useLayoutEffect(() => { onController?.(controller); return () => onController?.(null); }, [controller, onController]);

  const retain = useCallback((captured: StoredDraft): Promise<boolean> => {
    if (preserveProjection.current) return Promise.resolve(false);
    const saved = lastWrite.current;
    return enqueue(async () => {
      if (!await saved) throw new Error('待发送草稿尚未保存。');
      if (preserveProjection.current) throw new Error('当前草稿冲突尚未处理。');
      await retainComposerDraftVersion(owner, captured);
      if (preserveProjection.current) throw new Error('当前草稿冲突尚未处理。');
      return true;
    }).catch(reason => {
      if (active.current === controller) setStorageError('无法保存提交版本：' + message(reason));
      return false;
    });
  }, [controller, enqueue, owner]);
  const clear = useCallback(async (revision: string, guard?: (atoms: Readonly<Record<string, unknown>>) => boolean): Promise<void> => {
    if (preserveProjection.current && current.current.revision === revision) {
      throw new Error('当前草稿冲突尚未处理。');
    }
    await clearComposerDraftRevision(owner, revision, atoms => active.current === controller
      && !pendingComposition?.current && !(preserveProjection.current && current.current.revision === revision) && (!guard || guard(atoms)));
    const view = await readComposerDraftVersions(owner);
    if (active.current !== controller) return;
    setVersions(view.versions);
    if (!preserveProjection.current && !pendingLink?.current && !pendingComposition?.current && current.current.revision === revision && view.versions[0]) {
      const next = view.versions[0];
      current.current = next; setStored(next); lastWrite.current = Promise.resolve(true); durableRevision.current = next.revision;
      dirty.current = false; preserveProjection.current = false; setUnresolved(false); setSaving(false); publish(controller, next);
    }
  }, [controller, owner, pendingLink, pendingComposition, publish]);
  clearVersion.current = clear;
  const selectVersion = useCallback(async (revision: string): Promise<void> => {
    if (pendingLink?.current) { setStorageError('请先应用或关闭链接编辑。'); return; }
    if (pendingComposition?.current) { setStorageError('请先完成输入法输入。'); return; }
    if (preserveProjection.current) return;
    const finish = beginOperation();
    if (!finish) return;
    pendingProjection.current++;
    let success = false;
    try {
      await queue.current;
      if (!await lastWrite.current) { setStorageError('当前草稿尚未保存，不能切换版本。'); return; }
      const previous = current.current;
      const view = await readComposerDraftVersions(owner);
      if (active.current !== controller || current.current !== previous || preserveProjection.current) return;
      if (pendingLink?.current || pendingComposition?.current) { setStorageError('请先完成当前输入或链接编辑。'); return; }
      const selected = view.versions.find(value => value.revision === revision);
      if (!selected) { setStorageError('该草稿版本已变化，请重新选择。'); setVersions(view.versions); return; }
      current.current = selected; setStored(selected); setVersions(view.versions); lastWrite.current = Promise.resolve(true);
      durableRevision.current = selected.revision; dirty.current = false; preserveProjection.current = false; setUnresolved(false); setSaving(false);
      setStorageError(''); publish(controller, selected); success = true;
    } finally { pendingProjection.current--; finish(success); }
  }, [beginOperation, controller, owner, pendingLink, pendingComposition, publish]);
  const saveUnresolved = useCallback(async (): Promise<boolean> => {
    if (!preserveProjection.current) return true;
    if (savingConflict.current || pendingComposition?.current) return false;
    const finish = beginOperation();
    if (!finish) return false;
    savingConflict.current = true; setSaving(true);
    pendingProjection.current++;
    let success = false;
    try {
      await queue.current;
      if (pendingComposition?.current) return false;
      const previous = current.current, next = { ...previous, revision: createId() };
      const view = await saveComposerDraftConflict(owner, next);
      if (active.current !== controller || current.current !== previous || pendingComposition?.current) return false;
      current.current = next; setStored(next); setVersions(view.versions); durableRevision.current = next.revision;
      localRevisionCallback.current?.(previous.revision, next.revision);
      dirty.current = false; preserveProjection.current = false; pendingAncestors.current.clear(); setUnresolved(false); setSaving(false);
      lastWrite.current = Promise.resolve(true); setStorageError(''); publish(controller, next);
      success = true; return true;
    } catch (reason) {
      if (active.current === controller) setStorageError('无法保存独立草稿，当前内容已保留：' + message(reason));
      return false;
    } finally {
      savingConflict.current = false;
      if (active.current === controller) setSaving(false);
      pendingProjection.current--; finish(success);
    }
  }, [beginOperation, controller, owner, pendingComposition, publish]);
  useEffect(() => () => { generation.current += 1; }, []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current || preserveProjection.current || pendingLink?.current || external.current || frozen.current || operations.current.size) event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [pendingLink]);
  return { owner, controller, current, stored, changeDraft, preserveVisibleDraft, changeDraftFromOperation, updateDraftFromOperation, beginOperation, retain, clear, selectVersion,
    conflicts: versions.filter(value => value.revision !== stored.revision && !pendingAncestors.current.has(value.revision)),
    storageError, saving, loaded, unresolved, saveUnresolved,
    recheckProjection: () => refreshVersions.current?.(),
    retry: () => { if (!preserveProjection.current && !pendingLink?.current) { initializing.current = true; setRetry(value => value + 1); } }, lastWrite };
}
