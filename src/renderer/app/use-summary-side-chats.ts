import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { readComposerDraft } from '../composer/composer-draft-store.ts';
import { composerDraftAtomKey } from '../composer/composer-draft-store.ts';
import { readSideChatDraftAssociation } from '../side-chat/browser-authority.ts';
import type { SideChatDraftAssociation, SideChatDraftIdentity } from '../side-chat/browser-authority.ts';
import type { SideChatRootController } from '../side-chat/SideChatRoot.tsx';
import { subscribeBrowserAtoms } from '../storage/ui-atoms.ts';
import type { ThreadSummarySideChat } from './ThreadSummaryPanel.tsx';

export const sameSummarySideChat = (left: SideChatDraftIdentity, right: SideChatDraftIdentity) => left.hostId === right.hostId
  && left.parentThreadId === right.parentThreadId && left.draftId === right.draftId && left.prepareId === right.prepareId;

interface Options {
  controller: RefObject<SideChatRootController | null>;
  hostId: string;
  threadId: string | null;
  enabled: boolean;
  /** Parent document/connection revision; this is not a dispatch grant. */
  sourceKey: string;
  fallbackTitle: string;
  assertCurrent(): void;
}

/** Read the existing Root and draft repository; opening the card creates no child or draft. */
export function useSummarySideChats(options: Options) {
  const latest = useRef(options); latest.current = options;
  const [retry, setRetry] = useState(0);
  const [saved, setSaved] = useState<{ key: string; entries: ThreadSummarySideChat[]; loading: boolean; error: string | null }>({
    key: '', entries: [], loading: false, error: null,
  });
  useEffect(() => {
    if (!options.enabled || !options.threadId) return;
    let active = true;
    const initial = options, controller = initial.controller.current;
    const check = () => {
      initial.assertCurrent();
      if (!active || latest.current.sourceKey !== initial.sourceKey || latest.current.controller.current !== controller)
        throw new Error('The original summary conversation changed.');
    };
    setSaved(previous => ({ key: initial.sourceKey, entries: previous.key === initial.sourceKey ? previous.entries : [], loading: true, error: null }));
    void (async () => {
      check();
      if (!controller) throw new Error('Side chats are not ready.');
      const associations = await controller.listRecoverable(); check();
      const entries = await Promise.all(associations.map(async (association: SideChatDraftAssociation): Promise<ThreadSummarySideChat> => {
        if (association.hostId !== initial.hostId || association.parentThreadId !== initial.threadId) throw new Error('The side chat belongs to another conversation.');
        const draft = await readComposerDraft({ hostId: association.hostId, threadId: association.childThreadId, draftId: association.draftId });
        const current = await readSideChatDraftAssociation(association); check();
        if (JSON.stringify(current) !== JSON.stringify(association)) throw new Error('A saved side chat changed; refresh the summary.');
        return { identity: { hostId: association.hostId, parentThreadId: association.parentThreadId, draftId: association.draftId, prepareId: association.prepareId },
          kind: 'recoverable', title: draft?.draft.text.split(/\r?\n/, 1)[0]?.trim() || initial.fallbackTitle };
      }));
      check(); setSaved({ key: initial.sourceKey, entries, loading: false, error: null });
    })().catch(cause => {
      if (!active || latest.current.sourceKey !== initial.sourceKey) return;
      setSaved(previous => ({ key: initial.sourceKey, entries: previous.key === initial.sourceKey ? previous.entries : [], loading: false,
        error: cause instanceof Error ? cause.message : String(cause) }));
    });
    return () => { active = false; };
  }, [options.enabled, options.hostId, options.threadId, options.sourceKey, retry]);
  useEffect(() => options.enabled ? subscribeBrowserAtoms(keys => {
    if (keys.includes(composerDraftAtomKey)) setRetry(value => value + 1);
  }) : undefined, [options.enabled]);
  // Root publishes every mounted projection, including updates while no child
  // is active. Read it on the parent's render rather than storing another copy.
  const mounted: ThreadSummarySideChat[] = (options.controller.current?.listMounted() ?? [])
    .filter(entry => entry.identity.hostId === options.hostId && entry.identity.parentThreadId === options.threadId)
    .map(entry => ({ identity: entry.identity, title: entry.title || options.fallbackTitle, kind: 'active',
      ...(entry.working === null ? {} : { working: entry.working }) }));
  const retained = saved.key === options.sourceKey ? saved.entries.filter(entry => !mounted.some(value => sameSummarySideChat(value.identity, entry.identity))) : [];
  return { entries: [...mounted, ...retained], loading: options.enabled && saved.key !== options.sourceKey || saved.key === options.sourceKey && saved.loading,
    error: saved.key === options.sourceKey ? saved.error : null, retry: () => setRetry(value => value + 1) };
}
