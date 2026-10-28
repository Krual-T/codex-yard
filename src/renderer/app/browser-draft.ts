import { acknowledgeBrowserReferences, browserOwnerKey, changeBrowserComment } from '../browser/comments.ts';
import type { BrowserOwner, BrowserReference } from '../browser/comments.ts';
import type { ComposerDraftController, ComposerDraftOwner, ComposerReference } from '../composer/StandaloneComposer.tsx';
import type { SendIntent } from './send-recovery.ts';
import { sendThreadKey } from './send-recovery.ts';

/** A newly created thread keeps the browser references of its original draft. */
export function browserDraftOwner(owner: ComposerDraftOwner, bindings: Record<string, string>): BrowserOwner {
  return { ...owner, threadId: owner.threadId && bindings[sendThreadKey(owner.hostId, owner.threadId)] === owner.draftId ? null : owner.threadId };
}
function browserReference(reference: ComposerReference, owner: BrowserOwner): BrowserReference | null {
  const context = reference.context;
  if (reference.kind !== 'browser' || !context || context.hostId !== owner.hostId || context.threadId !== owner.threadId
    || context.draftId !== owner.draftId || !reference.original || typeof reference.original !== 'object'
    || Array.isArray(reference.original)) return null;
  return reference as BrowserReference;
}
export async function removeBrowserDraftReference(owner: BrowserOwner, reference: ComposerReference) {
  if (reference.kind !== 'browser') return;
  const original = browserReference(reference, owner);
  if (!original) throw new Error('浏览器引用所属草稿无法核对，原批注已保留。');
  await changeBrowserComment(owner, original.original, null);
}

/** Cleanup can only acknowledge the exact submitted reference still in this draft. */
export async function acknowledgeSubmittedBrowserReferences(intent: SendIntent, controller: ComposerDraftController | null,
  bindings: Record<string, string>) {
  const owner = browserDraftOwner(intent.owner, bindings);
  const current = () => {
    const snapshot = controller?.snapshot();
    return snapshot && browserOwnerKey(browserDraftOwner(snapshot.owner, bindings)) === browserOwnerKey(owner) ? snapshot : null;
  };
  if (!current()) return;
  const submitted = (intent.draft.references ?? []).flatMap(reference => {
    const parsed = browserReference(reference, owner); return parsed ? [parsed] : [];
  });
  if (!submitted.length) return;
  await acknowledgeBrowserReferences(owner, submitted, reference => !!current()?.draft.references?.some(value =>
    JSON.stringify(value) === JSON.stringify(reference)));
}
