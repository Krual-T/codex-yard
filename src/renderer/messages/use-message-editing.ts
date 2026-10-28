import { useCallback, useEffect, useRef, useState } from 'react';
import type { ThreadItemSummary, ThreadSummary } from '../../../lib/codex-protocol.ts';
import type { ComposerDraft, MessageEditOrigin, StandaloneMessagesProps } from '../workbench-contract.ts';
import { applyTextEdits, editSourceSignature, isRemovedMessageAttachments, textEdits } from './message-edit.ts';
import { serializedMessageContext } from './message-data.ts';
import type { RemovedMessageAttachment, TextEdit } from './message-edit.ts';

export type MessageEditRecoveryVersion = { sessionId: string; revision: number };

export type MessageEditRecovery = {
  draft: ComposerDraft;
  origin: MessageEditOrigin;
  /** Persist the whole editor state, including text that cannot yet be converted safely. */
  editor?: {
    sessionId: string;
    revision: number;
    baseDraft: ComposerDraft;
    edits: TextEdit[];
    addedText: string;
    removedAttachments?: RemovedMessageAttachment[];
    sourceSignature: string;
    snapshot: ThreadItemSummary;
    turnIndex: number;
    itemIndex: number;
  };
};

export type StandaloneMessagesRecoveryProps = {
  editRecovery?: MessageEditRecovery | null;
  /** A null value clears only the specified origin and version. */
  onEditDraftChange?: (value: MessageEditRecovery | null, origin: MessageEditOrigin, version: MessageEditRecoveryVersion) => Promise<void>;
};

export type EditingSession = {
  id: number;
  sessionId: string;
  identity: string;
  turnId: string;
  itemId: string;
  turnIndex: number;
  itemIndex: number;
  snapshot: ThreadItemSummary;
  draft: ComposerDraft;
  origin: MessageEditOrigin;
  signature: string;
  edits: TextEdit[];
  addedText: string;
  removedAttachments: RemovedMessageAttachment[];
  attachmentRecoveryInvalid: boolean;
  error: string;
  saveError: string;
  pending: boolean;
  sent: boolean;
  revision: number;
};
export type StartEdit = Omit<EditingSession, 'id' | 'sessionId' | 'edits' | 'addedText' | 'removedAttachments' | 'attachmentRecoveryInvalid' | 'error' | 'saveError' | 'pending' | 'sent' | 'revision'>;
export type UpdateEdit = (id: number, update: (session: EditingSession) => EditingSession) => void;

function recoveryFor(session: EditingSession, draft?: ComposerDraft): MessageEditRecovery {
  const converted = applyTextEdits(session.draft, session.edits, session.addedText, session.removedAttachments);
  return structuredClone({
    draft: draft ?? converted.draft ?? session.draft,
    origin: session.origin,
    editor: { sessionId: session.sessionId, revision: session.revision, baseDraft: session.draft, edits: session.edits, addedText: session.addedText,
      removedAttachments: session.removedAttachments,
      sourceSignature: session.signature, snapshot: session.snapshot, turnIndex: session.turnIndex, itemIndex: session.itemIndex },
  });
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message || fallback : typeof reason === 'string' && reason ? reason : fallback;
}

const recoveryKey = (origin: MessageEditOrigin) => JSON.stringify([origin.hostId, origin.threadId, origin.turnId, origin.itemId]);
const newRecoveryId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
const recoveryVersion = (session: EditingSession): MessageEditRecoveryVersion => ({ sessionId: session.sessionId, revision: session.revision });

export function useMessageEditing({ hostId, thread, threadIdentity, editRecovery, onEditDraftChange }: StandaloneMessagesRecoveryProps & {
  hostId: string; thread: ThreadSummary | null; threadIdentity: string;
}) {
  const [sessions, setSessions] = useState<Map<string, EditingSession>>(() => new Map());
  const sessionsRef = useRef(sessions);
  const dismissedRecovery = useRef(new Map<string, string>());
  const recoveryCallback = useRef(onEditDraftChange);
  recoveryCallback.current = onEditDraftChange;
  const recoveryWrites = useRef<Promise<void>>(Promise.resolve());
  const queuedPublishes = useRef(new Map<string, { session: EditingSession }>());
  const nextEditId = useRef(0);
  const putSession = useCallback((identity: string, session: EditingSession | null) => {
    const next = new Map(sessionsRef.current);
    if (session) next.set(identity, session); else next.delete(identity);
    sessionsRef.current = next;
    setSessions(next);
  }, []);
  const findSession = useCallback((id: number) => Array.from(sessionsRef.current.values()).find((session) => session.id === id), []);
  const notifyRecovery = useCallback((value: MessageEditRecovery | null, origin: MessageEditOrigin, version: MessageEditRecoveryVersion): Promise<void> => {
    const callback = recoveryCallback.current;
    if (!callback) return Promise.resolve();
    const valueCopy = value && structuredClone(value);
    const originCopy = structuredClone(origin);
    const write = recoveryWrites.current.catch(() => {}).then(() => callback(valueCopy, originCopy, version));
    recoveryWrites.current = write.catch(() => {});
    return write;
  }, []);
  const publishSession = useCallback((session: EditingSession) => {
    const callback = recoveryCallback.current;
    if (!callback) return;
    const queued = queuedPublishes.current.get(session.identity);
    if (queued && queued.session.id === session.id) { queued.session = session; return; }
    const entry = { session };
    queuedPublishes.current.set(session.identity, entry);
    const write = recoveryWrites.current.catch(() => {}).then(async () => {
      if (queuedPublishes.current.get(session.identity) === entry) queuedPublishes.current.delete(session.identity);
      const latest = entry.session;
      try {
        await callback(recoveryFor(latest), structuredClone(latest.origin), recoveryVersion(latest));
        const current = findSession(latest.id);
        if (current && current.revision === latest.revision && current.saveError) putSession(current.identity, { ...current, saveError: '' });
      } catch (reason) {
        const current = findSession(latest.id);
        if (current && current.revision === latest.revision) {
          putSession(current.identity, { ...current, saveError: `Could not save the edit recovery: ${errorMessage(reason, 'Unknown error.')}` });
        }
      }
    });
    recoveryWrites.current = write.catch(() => {});
  }, [findSession, putSession]);
  const startEdit = useCallback((session: StartEdit) => {
    if (sessionsRef.current.has(session.identity)) return;
    const id = ++nextEditId.current;
    const next = { ...session, id, sessionId: newRecoveryId(), edits: textEdits(session.draft), addedText: '', removedAttachments: [], attachmentRecoveryInvalid: false,
      error: '', saveError: '', pending: false, sent: false, revision: 0 };
    dismissedRecovery.current.delete(next.identity);
    putSession(next.identity, next);
    publishSession(next);
  }, [publishSession, putSession]);
  const updateEdit = useCallback<UpdateEdit>((id, update) => {
    const current = findSession(id);
    if (!current || current.attachmentRecoveryInvalid) return;
    const result = update(current);
    const changed = result.edits !== current.edits || result.addedText !== current.addedText || result.removedAttachments !== current.removedAttachments;
    const next = changed ? { ...result, revision: current.revision + 1 } : result;
    putSession(current.identity, next);
    if (changed) publishSession(next);
  }, [findSession, publishSession, putSession]);
  const endEdit = useCallback((id: number, submitted = false) => {
    const current = findSession(id);
    if (!current || (current.pending && !submitted)) return;
    putSession(current.identity, { ...current, pending: true, sent: submitted || current.sent, error: '', saveError: '' });
    void notifyRecovery(null, current.origin, recoveryVersion(current)).then(() => {
      const latest = findSession(id);
      if (!latest) return;
      dismissedRecovery.current.set(latest.identity, recoveryKey(latest.origin));
      putSession(latest.identity, null);
    }).catch((reason: unknown) => {
      const latest = findSession(id);
      if (latest) putSession(latest.identity, { ...latest, pending: false,
        error: `${latest.sent ? 'The edit was sent, but its recovery could not be cleared' : 'The edit could not be discarded'}: ${errorMessage(reason, 'Unknown error.')}` });
    });
  }, [findSession, notifyRecovery, putSession]);
  const submitEdit = useCallback((id: number, submit: NonNullable<StandaloneMessagesProps['onEdit']>) => {
    const current = findSession(id);
    if (!current || current.pending || current.sent || current.attachmentRecoveryInvalid) return;
    const result = applyTextEdits(current.draft, current.edits, current.addedText, current.removedAttachments);
    const draft = result.draft;
    if (!draft) { putSession(current.identity, { ...current, error: result.error }); return; }
    const meaningfulInput = draft.input?.some((entry) => {
      if (entry.type !== 'text') return true;
      if (typeof entry.text !== 'string') return false;
      const context = serializedMessageContext(entry.text);
      return Boolean(context.body.trim() || context.files.length || (context.unresolved && entry.text.trim()));
    });
    if (!meaningfulInput) {
      putSession(current.identity, { ...current, error: 'Enter a message before sending.' });
      return;
    }
    putSession(current.identity, { ...current, pending: true, error: '', saveError: '' });
    const saved = recoveryCallback.current ? notifyRecovery(recoveryFor(current, draft), current.origin, recoveryVersion(current)) : Promise.resolve();
    void saved.then(() => submit(draft, structuredClone(current.origin)))
      .then(() => endEdit(id, true)).catch((reason: unknown) => {
        const latest = findSession(id);
        if (latest) putSession(latest.identity, { ...latest, pending: false, error: errorMessage(reason, 'Edit failed.') });
      });
  }, [endEdit, findSession, notifyRecovery, putSession]);
  useEffect(() => {
    if (!editRecovery) { dismissedRecovery.current.delete(threadIdentity); return; }
    const { origin, draft, editor } = editRecovery;
    if (!thread || origin.hostId !== hostId || origin.threadId !== thread.id || sessionsRef.current.has(threadIdentity)
      || dismissedRecovery.current.get(threadIdentity) === recoveryKey(origin)) return;
    const turnIndex = thread.turns.findIndex((turn) => turn.id === origin.turnId);
    const itemIndex = turnIndex < 0 ? -1 : thread.turns[turnIndex]!.items.findIndex((item) => item.id === origin.itemId && item.type === 'userMessage');
    const source = itemIndex < 0 ? null : thread.turns[turnIndex]!.items[itemIndex]!;
    const baseDraft = structuredClone(editor?.baseDraft ?? draft);
    const snapshot = structuredClone(editor?.snapshot ?? source ?? { id: origin.itemId, type: 'userMessage', content: baseDraft.input,
      ...(baseDraft.document !== undefined ? { document: baseDraft.document } : {}),
      ...(origin.format !== undefined ? { format: origin.format } : {}), ...(origin.hints !== undefined ? { hints: origin.hints } : {}) });
    const hasVersion = Boolean(editor?.sessionId && Number.isSafeInteger(editor.revision) && editor.revision >= 0);
    const attachmentRecoveryInvalid = editor?.removedAttachments !== undefined && !isRemovedMessageAttachments(editor.removedAttachments);
    const session: EditingSession = { id: ++nextEditId.current, sessionId: hasVersion ? editor!.sessionId : newRecoveryId(), identity: threadIdentity, turnId: origin.turnId, itemId: origin.itemId,
      turnIndex: editor?.turnIndex ?? (turnIndex < 0 ? thread.turns.length : turnIndex), itemIndex: editor?.itemIndex ?? Math.max(0, itemIndex),
      snapshot, draft: baseDraft, origin: structuredClone(origin), signature: editor?.sourceSignature ?? editSourceSignature(snapshot),
      edits: structuredClone(editor?.edits ?? textEdits(baseDraft)), addedText: editor?.addedText ?? '',
      removedAttachments: attachmentRecoveryInvalid ? [] : structuredClone(editor?.removedAttachments ?? []), attachmentRecoveryInvalid,
      error: '', saveError: '',
      pending: false, sent: false, revision: hasVersion ? editor!.revision : 0 };
    putSession(threadIdentity, session);
    if (!hasVersion && !attachmentRecoveryInvalid) publishSession(session);
  }, [editRecovery, hostId, publishSession, putSession, thread, threadIdentity]);
  const editingHere = sessions.get(threadIdentity) ?? null;
  const recoveryAvailable = Boolean(editingHere && (onEditDraftChange
    || (editRecovery && recoveryKey(editRecovery.origin) === recoveryKey(editingHere.origin))));
  return { editingHere, recoveryAvailable, startEdit, updateEdit, endEdit, submitEdit };
}
