import { browserCommentsAtomKey, ensureBrowserCommentStore, pruneBrowserDraftDeletions, readBrowserCommentsSnapshot,
  recordSubmittedBrowserComments, removeBrowserReferenceFromDraft, subscribeBrowserComments } from '../browser/comments.ts';
import type { BrowserOwner, BrowserReference } from '../browser/comments.ts';
import type { ComposerDraftController, ComposerDraftOwner, ComposerDraftSnapshot, ComposerReference } from '../composer/StandaloneComposer.tsx';
import type { ComposerDraftExternalOperation } from '../composer/use-composer-draft.ts';
import type { SendIntent } from './send-recovery.ts';
import { sendsAtom, sendThreadKey } from './send-recovery.ts';
import { updateBrowserAtoms } from '../storage/ui-atoms.ts';

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

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
export async function removeBrowserDraftReference(owner: BrowserOwner, reference: ComposerReference,
  operation: ComposerDraftExternalOperation, retain: (before: ComposerDraftSnapshot, after: ComposerDraftSnapshot) => void,
  accepted: (snapshot: ComposerDraftSnapshot) => void): Promise<'handled' | void> {
  if (reference.kind !== 'browser') return;
  const original = browserReference(reference, owner);
  if (!original) throw new Error('浏览器引用所属草稿无法核对，原批注已保留。');
  let committed: ComposerDraftSnapshot | undefined;
  try {
    const receipt = await operation.transaction(async (before, isCurrent) => {
      const after = await removeBrowserReferenceFromDraft(owner, original, before, isCurrent);
      // Retain the complete durable result before the controller attempts adoption.
      committed = structuredClone(after); retain(before, committed);
      return { after, value: undefined };
    });
    if (receipt.accepted) accepted(receipt.after);
  } catch (error) {
    if (!committed) throw error;
  }
  // A committed root transaction must never fall through to a second deletion.
  return 'handled';
}

export async function syncBrowserDraftDeletions(owner: BrowserOwner, operation: ComposerDraftExternalOperation,
  retain: (before: ComposerDraftSnapshot, after: ComposerDraftSnapshot) => void, accepted: (snapshot: ComposerDraftSnapshot) => void) {
  let success = false;
  try {
    const receipt = await operation.transaction(async (before, isCurrent) => {
      const after = await pruneBrowserDraftDeletions(owner, before, isCurrent);
      retain(before, after);
      return { after, value: undefined };
    });
    if (receipt.accepted) { accepted(receipt.after); success = true; }
  } finally { operation.finish(success); }
}

/** Watch only the active draft; this does not register pages or acknowledge sends. */
export function watchBrowserDraftDeletions(owner: BrowserOwner,
  currentDraft: () => ComposerDraftSnapshot | null, apply: () => Promise<boolean>, onError: (error: unknown) => void) {
  let active = true, pending = false, running = false, retryAfterInput = false;
  let inputFrame: number | undefined;
  const refresh = () => {
    if (!active) return;
    pending = true;
    if (running) return;
    running = true;
    void (async () => {
      while (active && pending) {
        pending = false;
        const { deleted } = await readBrowserCommentsSnapshot(owner);
        if (!active) return;
        const draft = currentDraft();
        if (draft && (draft.draft.references ?? []).some(reference => deleted.some(marker => same(reference, marker)))) {
          retryAfterInput = !await apply();
        } else retryAfterInput = false;
      }
    })().catch(error => { if (active) { retryAfterInput = true; onError(error); } })
      .finally(() => { running = false; if (active && pending) refresh(); });
  };
  const unsubscribe = subscribeBrowserComments(refresh);
  // The editor clears its composing flag in its composition-end animation frame.
  // Run after that callback, including when an in-flight read fails at the boundary.
  const inputReady = () => {
    if (!retryAfterInput && !running) return;
    if (inputFrame !== undefined) cancelAnimationFrame(inputFrame);
    inputFrame = requestAnimationFrame(() => { inputFrame = undefined; refresh(); });
  };
  if (typeof window !== 'undefined') { window.addEventListener('compositionend', inputReady); window.addEventListener('input', inputReady); }
  refresh();
  return () => {
    active = false; unsubscribe();
    if (inputFrame !== undefined) cancelAnimationFrame(inputFrame);
    if (typeof window !== 'undefined') { window.removeEventListener('compositionend', inputReady); window.removeEventListener('input', inputReady); }
  };
}

/** Record the confirmed immutable version before clearing it and dismissing its recovery intent. */
export async function acknowledgeSubmittedBrowserReferences(intent: SendIntent, _controller: ComposerDraftController | null,
  _bindings: Record<string, string>) {
  const hasBrowserReferences = (intent.draft.references ?? []).some(reference => reference.kind === 'browser');
  if (hasBrowserReferences) await ensureBrowserCommentStore();
  await updateBrowserAtoms(atoms => {
    const recovery = atoms[sendsAtom];
    if (!record(recovery) || !record(recovery.requests) || !record(recovery.bindings)) {
      throw new Error('发送恢复记录无法核对，浏览器引用已保留。');
    }
    const stored = recovery.requests[intent.id];
    if (!record(stored) || stored.stage !== 'confirmed' || !same(stored, intent)
      || Object.values(recovery.bindings).some(value => typeof value !== 'string')) {
      throw new Error('原发送或草稿版本尚未确认，浏览器引用已保留。');
    }
    const owner = browserDraftOwner(intent.owner, recovery.bindings as Record<string, string>);
    const submitted = (intent.draft.references ?? []).flatMap(reference => {
      if (reference.kind !== 'browser') return [];
      const parsed = browserReference(reference, owner);
      if (!parsed) throw new Error('已提交浏览器引用的所属草稿无法核对，原记录已保留。');
      return [parsed];
    });
    if (!submitted.length) return { value: undefined };
    const value = recordSubmittedBrowserComments(atoms[browserCommentsAtomKey], owner,
      { intentId: intent.id, owner: intent.owner, revision: intent.revision, references: submitted });
    return { value: undefined, updates: { [browserCommentsAtomKey]: value } };
  });
}
