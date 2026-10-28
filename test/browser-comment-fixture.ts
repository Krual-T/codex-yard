import type { ChromeElementContext } from '../src/browser-reuse/protocol.ts';
import { browserCommentsAtomKey, browserOwnerKey, browserReferences, createBrowserComment,
  ensureBrowserCommentStore, claimProvenLegacyBrowserComments } from '../src/renderer/browser/comments.ts';
import type { BrowserOwner, BrowserReference } from '../src/renderer/browser/comments.ts';
import { updateBrowserAtom } from '../src/renderer/storage/ui-atoms.ts';

/** Synthetic setup only; production creates comments in the versioned transaction. */
export async function addBrowserComment(owner: BrowserOwner, anchor: ChromeElementContext): Promise<BrowserReference> {
  await ensureBrowserCommentStore();
  let reference!: BrowserReference;
  await updateBrowserAtom(browserCommentsAtomKey, previous => {
    if (!previous || typeof previous !== 'object' || Array.isArray(previous)) throw new Error('Invalid fixture store');
    const store = previous as Record<string, unknown>, entries = store.entries as Record<string, unknown>;
    const key = browserOwnerKey(owner), existing = entries[key] ?? [];
    if (!Array.isArray(existing)) throw new Error('Invalid fixture owner');
    const comment = createBrowserComment(anchor, existing.length + 1);
    reference = browserReferences(owner, [comment])[0]!;
    return { ...store, entries: { ...entries, [key]: [...existing, comment] } };
  });
  return reference;
}

export async function adoptLegacyBrowserComments(owner: BrowserOwner, legacyOwner: string, expected: unknown[]): Promise<void> {
  const identity = { hostId: owner.hostId, threadId: owner.threadId, draftId: owner.draftId };
  await claimProvenLegacyBrowserComments(owner, (atoms, key) => {
    const store = atoms[browserCommentsAtomKey] as { entries?: Record<string, unknown> } | undefined;
    return key === legacyOwner && JSON.stringify(store?.entries?.[key]) === JSON.stringify(expected) ? identity : null;
  });
}
