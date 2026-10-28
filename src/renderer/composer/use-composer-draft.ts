import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { readBrowserAtoms, subscribeBrowserAtoms } from '../storage/ui-atoms.ts';
import type { ComposerContext, ComposerDraft } from '../workbench-contract.ts';
import { clearComposerDraftRevision, composerDraftAtomKey, openComposerDraft, readComposerDraftVersions,
  retainComposerDraftVersion, writeComposerDraftVersion } from './composer-draft-store.ts';
import type { ComposerDraftOwner, ComposerDraftSnapshot, ComposerDraftVersions } from './composer-draft-store.ts';
import { createId, emptyDraft, normalizeDraft } from './standalone-draft.ts';
import type { Draft, StoredDraft } from './standalone-draft.ts';

export interface ComposerDraftController {
  snapshot(): ComposerDraftSnapshot | null;
  update(owner: ComposerDraftOwner, update: (draft: ComposerDraft) => ComposerDraft): Promise<boolean>;
  /** Wait for the current editing projection before changing owner or leaving the page. */
  flush(owner: ComposerDraftOwner): Promise<boolean>;
}
const legacyKeys = new Set(['composer-prompt-drafts-v2', 'composer-prompt-drafts-v1', 'composer-retained-documents-v1',
  'client-thread-bindings-v1', 'draft-thread-identities-v1']);
const sameOwner = (left: ComposerDraftOwner, right: ComposerDraftOwner) => left.hostId === right.hostId
  && left.threadId === right.threadId && left.draftId === right.draftId;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
interface Mutation { saved: Promise<boolean> }

export function useComposerDraft(context: ComposerContext, onController?: (controller: ComposerDraftController | null) => void,
  onChange?: (snapshot: ComposerDraftSnapshot) => void) {
  const owner = useMemo<ComposerDraftOwner>(() => ({ hostId: context.hostId, threadId: context.threadId, draftId: context.draftId }),
    [context.hostId, context.threadId, context.draftId]);
  const [initial] = useState<StoredDraft>(() => ({ revision: createId(), draft: emptyDraft(), prefills: [] }));
  const current = useRef(initial);
  const [stored, setStored] = useState(initial);
  const [versions, setVersions] = useState<StoredDraft[]>([]);
  const [storageError, setStorageError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [retry, setRetry] = useState(0);
  const mounted = useRef(false);
  const active = useRef<ComposerDraftController | null>(null);
  const generation = useRef(0);
  const ready = useRef<Promise<ComposerDraftVersions> | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const lastWrite = useRef<Promise<boolean>>(Promise.resolve(true));
  const dirty = useRef(false);
  const durableRevision = useRef<string | null>(null);
  const changeCallback = useRef(onChange);
  changeCallback.current = onChange;
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
      const view = await writeComposerDraftVersion(owner, previous.revision, next);
      if (active.current === controller) {
        durableRevision.current = next.revision;
        if (current.current.revision === next.revision) { dirty.current = false; setSaving(false); }
        setVersions(view.versions); setStorageError(''); publish(controller, next);
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
  const apply = useCallback((update: (draft: Draft) => Draft, prefillId?: string): Mutation | null => {
    const controller = active.current;
    if (!mounted.current || !controller) return null;
    const previous = current.current;
    const next = { ...previous, revision: createId(), draft: update(previous.draft),
      prefills: prefillId ? [...previous.prefills, prefillId] : previous.prefills };
    current.current = next;
    dirty.current = true;
    setSaving(true);
    setStored(next);
    return { saved: persist(controller, previous, next) };
  }, [persist]);
  const changeDraft = useCallback((update: (draft: Draft) => Draft, prefillId?: string): Promise<boolean> =>
    apply(update, prefillId)?.saved ?? Promise.resolve(false), [apply]);

  const controller = useMemo<ComposerDraftController>(() => {
    const result: ComposerDraftController = {
      snapshot() {
        return active.current === result ? structuredClone({ owner, draft: current.current.draft, revision: current.current.revision }) : null;
      },
      async flush(expected) {
        if (active.current !== result || !sameOwner(owner, expected)) return false;
        if (!ready.current) throw new Error('草稿存储尚未初始化。');
        try { await ready.current; } catch { throw new Error('草稿未能保存，当前内容已保留。'); }
        for (;;) {
          if (active.current !== result) return false;
          const revision = current.current.revision, saved = lastWrite.current;
          if (!await saved) throw new Error('草稿未能保存，当前内容已保留。');
          await queue.current;
          if (active.current !== result) return false;
          if (revision === current.current.revision && saved === lastWrite.current) return true;
        }
      },
      async update(expected, update) {
        if (active.current !== result || !sameOwner(owner, expected)) return false;
        for (;;) {
          await queue.current;
          if (active.current !== result) return false;
          if (!await lastWrite.current) throw new Error('草稿未能保存，当前内容已保留。');
          const previous = current.current;
          const updated = update(structuredClone(previous.draft));
          if (active.current !== result) return false;
          const draft = normalizeDraft({ ...previous.draft, ...updated });
          if (JSON.stringify(draft) === JSON.stringify(previous.draft)) return true;
          const next = { ...previous, revision: createId(), draft };
          try {
            const view = await enqueue(async () => {
              if (!ready.current) throw new Error('草稿存储尚未初始化。');
              await ready.current;
              if (active.current !== result || current.current !== previous) return null;
              return writeComposerDraftVersion(owner, previous.revision, next);
            });
            if (active.current !== result) return false;
            if (!view || current.current !== previous) continue;
            current.current = next; setStored(next); setVersions(view.versions);
            durableRevision.current = next.revision; dirty.current = false; setSaving(false);
            lastWrite.current = Promise.resolve(true); setStorageError(''); publish(result, next);
            return true;
          } catch (reason) {
            if (active.current === result) setStorageError('草稿未能保存，当前内容已保留：' + message(reason));
            throw new Error('草稿未能保存，当前内容已保留。');
          }
        }
      },
    };
    return result;
  }, [enqueue, owner, publish]);

  const legacyIdentity = JSON.stringify([context.hostId, context.threadId, context.draftId, context.placement ?? null, context.legacyDraftKey ?? null]);
  useLayoutEffect(() => {
    mounted.current = true; active.current = controller;
    return () => { if (active.current === controller) active.current = null; mounted.current = false; };
  }, [controller]);
  useLayoutEffect(() => {
    const serial = ++generation.current;
    let disposed = false, finished = false, versionRead = 0;
    const valid = () => !disposed && generation.current === serial && active.current === controller;
    setStorageError(''); setLoaded(false);
    const loading = readBrowserAtoms().then(atoms => openComposerDraft(context, atoms, valid));
    ready.current = loading;
    void loading.then(view => {
      if (!valid()) return;
      finished = true;
      const first = view.versions[0];
      if (!first) throw new Error('草稿初始化未完成。');
      setVersions(view.versions);
      if (current.current === initial) {
        current.current = first; setStored(first); lastWrite.current = Promise.resolve(true); durableRevision.current = first.revision;
        dirty.current = false; setSaving(false); publish(controller, first);
      } else if (retry > 0) {
        const value = current.current;
        void persist(controller, { ...initial, revision: durableRevision.current ?? initial.revision }, value);
      }
      setLoaded(true);
    }).catch(reason => { if (valid()) setStorageError('无法恢复草稿，当前内容已保留：' + message(reason)); });
    const unsubscribe = subscribeBrowserAtoms(keys => {
      if (keys.some(key => legacyKeys.has(key)) && !finished) { generation.current += 1; setRetry(value => value + 1); return; }
      if (keys.includes(composerDraftAtomKey)) {
        const serial = ++versionRead, observed = current.current;
        void readComposerDraftVersions(owner).then(view => {
          if (!valid() || serial !== versionRead) return;
          setVersions(view.versions);
          if (finished && !dirty.current && current.current === observed
            && !view.versions.some(value => value.revision === observed.revision) && view.versions.length === 1) {
            const next = view.versions[0]!;
            current.current = next; setStored(next); durableRevision.current = next.revision;
            lastWrite.current = Promise.resolve(true); publish(controller, next);
          }
        })
          .catch(reason => { if (valid()) setStorageError('无法读取草稿版本：' + message(reason)); });
      }
    });
    return () => { disposed = true; unsubscribe(); };
  }, [controller, legacyIdentity, retry, initial, owner, persist, publish]);
  useLayoutEffect(() => { onController?.(controller); return () => onController?.(null); }, [controller, onController]);

  const retain = useCallback((captured: StoredDraft): Promise<boolean> => {
    const saved = lastWrite.current;
    return enqueue(async () => {
      if (!await saved) throw new Error('待发送草稿尚未保存。');
      await retainComposerDraftVersion(owner, captured);
      return true;
    }).catch(reason => {
      if (active.current === controller) setStorageError('无法保存提交版本：' + message(reason));
      return false;
    });
  }, [controller, enqueue, owner]);
  const clear = useCallback(async (revision: string): Promise<void> => {
    await clearComposerDraftRevision(owner, revision);
    const view = await readComposerDraftVersions(owner);
    if (active.current !== controller) return;
    setVersions(view.versions);
    if (current.current.revision === revision && view.versions[0]) {
      const next = view.versions[0];
      current.current = next; setStored(next); lastWrite.current = Promise.resolve(true); durableRevision.current = next.revision;
      dirty.current = false; setSaving(false); publish(controller, next);
    }
  }, [controller, owner, publish]);
  const selectVersion = useCallback(async (revision: string): Promise<void> => {
    await queue.current;
    if (!await lastWrite.current) { setStorageError('当前草稿尚未保存，不能切换版本。'); return; }
    const previous = current.current;
    const view = await readComposerDraftVersions(owner);
    if (active.current !== controller || current.current !== previous) return;
    const selected = view.versions.find(value => value.revision === revision);
    if (!selected) { setStorageError('该草稿版本已变化，请重新选择。'); setVersions(view.versions); return; }
    current.current = selected; setStored(selected); setVersions(view.versions); lastWrite.current = Promise.resolve(true);
    durableRevision.current = selected.revision; dirty.current = false; setSaving(false);
    setStorageError(''); publish(controller, selected);
  }, [controller, owner, publish]);
  useEffect(() => () => { generation.current += 1; }, []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty.current) event.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);
  return { owner, controller, current, stored, changeDraft, retain, clear, selectVersion,
    conflicts: versions.filter(value => value.revision !== stored.revision), storageError, saving, loaded, retry: () => setRetry(value => value + 1), lastWrite };
}
