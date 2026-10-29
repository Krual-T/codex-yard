import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ThreadItemSummary, ThreadSummary } from '../../../lib/codex-protocol.ts';
import type { ComposerDraft, MessageEditOrigin, StandaloneMessagesProps } from '../workbench-contract.ts';
import { applyTextEdits, editSourceSignature, isRemovedMessageAttachments, textEdits } from './message-edit.ts';
import { serializedMessageContext } from './message-data.ts';
import type { RemovedMessageAttachment, TextEdit } from './message-edit.ts';

export type MessageEditRecoveryVersion = { sessionId: string; revision: number };
export type MessageEditIdentity = Pick<MessageEditOrigin, 'hostId' | 'threadId'>;

/** A view-local handle from the shared recovery store. */
export interface MessageEditAccess {
  acquire(identity: MessageEditIdentity): boolean;
  owns(identity: MessageEditIdentity): boolean;
  available(identity: MessageEditIdentity): boolean;
  capture(identity: MessageEditIdentity): () => void;
  read(identity: MessageEditIdentity): Promise<MessageEditRecovery | null>;
  subscribe(listener: () => void): () => void;
  /** Used by the editor only after its recovery has been cleared or drained. */
  release(identity: MessageEditIdentity): void;
}

export interface MessageEditNavigationLease {
  readonly origin: MessageEditOrigin;
  readonly version: MessageEditRecoveryVersion;
  flush(): Promise<void>;
  /** Relinquish the editor after a successful flush, immediately before committing navigation. */
  handoff(): void;
  release(): void;
}
export interface MessageEditNavigationController {
  /** Freeze the currently mounted editor synchronously before changing routes. */
  freeze(): MessageEditNavigationLease | null;
}

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
    /** A rebased edit must again be present in the current complete projection. */
    requiresCurrentSource?: boolean;
  };
};

export type MessageEditRebaseMarker = { origin: MessageEditOrigin; submittedVersion: MessageEditRecoveryVersion };
export type MessageEditRebaseCandidate = {
  origin: MessageEditOrigin;
  version: MessageEditRecoveryVersion;
  operationId: string;
  clientUserMessageId: string;
  recovery: MessageEditRecovery;
  thread: ThreadSummary;
};

export type StandaloneMessagesRecoveryProps = {
  editRecovery?: MessageEditRecovery | null;
  editAccess?: MessageEditAccess;
  /** A null value clears only the specified origin and version. */
  onEditDraftChange?: (value: MessageEditRecovery | null, origin: MessageEditOrigin, version: MessageEditRecoveryVersion) => Promise<void>;
  onEditNavigationController?: (controller: MessageEditNavigationController | null) => void;
  editRebase?: MessageEditRebaseMarker | null;
  onPrepareEditRebase?: (origin: MessageEditOrigin, version: MessageEditRecoveryVersion) => Promise<MessageEditRebaseCandidate>;
  onCommitEditRebase?: (candidate: MessageEditRebaseCandidate) => Promise<MessageEditRecovery>;
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
  navigationFrozen: boolean;
  rebaseChecking: boolean;
  rebaseCommitting: boolean;
  requiresCurrentSource: boolean;
  revision: number;
};
export type StartEdit = Omit<EditingSession, 'id' | 'sessionId' | 'edits' | 'addedText' | 'removedAttachments' | 'attachmentRecoveryInvalid' | 'error' | 'saveError' | 'pending' | 'sent' | 'navigationFrozen' | 'rebaseChecking' | 'rebaseCommitting' | 'requiresCurrentSource' | 'revision'>;
export type UpdateEdit = (id: number, update: (session: EditingSession) => EditingSession) => void;

function recoveryFor(session: EditingSession, draft?: ComposerDraft): MessageEditRecovery {
  const converted = applyTextEdits(session.draft, session.edits, session.addedText, session.removedAttachments);
  return structuredClone({
    draft: draft ?? converted.draft ?? session.draft,
    origin: session.origin,
    editor: { sessionId: session.sessionId, revision: session.revision, baseDraft: session.draft, edits: session.edits, addedText: session.addedText,
      removedAttachments: session.removedAttachments,
      sourceSignature: session.signature, snapshot: session.snapshot, turnIndex: session.turnIndex, itemIndex: session.itemIndex,
      ...(session.requiresCurrentSource ? { requiresCurrentSource: true } : {}) },
  });
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message || fallback : typeof reason === 'string' && reason ? reason : fallback;
}

const recoveryKey = (origin: MessageEditOrigin) => JSON.stringify([origin.hostId, origin.threadId, origin.turnId, origin.itemId]);
const newRecoveryId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
const recoveryVersion = (session: EditingSession): MessageEditRecoveryVersion => ({ sessionId: session.sessionId, revision: session.revision });

export function useMessageEditing({ hostId, thread, threadIdentity, editRecovery, editAccess, onEditDraftChange, onEditNavigationController,
  editRebase, onPrepareEditRebase, onCommitEditRebase }: StandaloneMessagesRecoveryProps & {
  hostId: string; thread: ThreadSummary | null; threadIdentity: string;
}) {
  const [sessions, setSessions] = useState<Map<string, EditingSession>>(() => new Map());
  const sessionsRef = useRef(sessions);
  const dismissedRecovery = useRef(new Map<string, string>());
  const yieldedRecovery = useRef(new Set<string>());
  const failedRecovery = useRef(new Map<string, string>());
  const restoring = useRef(new Set<string>());
  const [accessEpoch, setAccessEpoch] = useState(0);
  const [accessError, setAccessError] = useState('');
  const [localRecovery, setLocalRecovery] = useState<MessageEditRecovery | null>(null);
  const activeRecovery = localRecovery?.origin.hostId === hostId && localRecovery.origin.threadId === thread?.id ? localRecovery : editRecovery;
  const recoveryCallback = useRef(onEditDraftChange);
  recoveryCallback.current = onEditDraftChange;
  const recoveryWrites = useRef<Promise<void>>(Promise.resolve());
  const queuedPublishes = useRef(new Map<string, { session: EditingSession }>());
  const frozenSessions = useRef(new Map<string, symbol>());
  const rebaseChecks = useRef(new Map<number, symbol>());
  const activeIdentity = useRef(threadIdentity);
  const mounted = useRef(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useLayoutEffect(() => editAccess?.subscribe(() => setAccessEpoch(value => value + 1)), [editAccess]);
  const nextEditId = useRef(0);
  const putSession = useCallback((identity: string, session: EditingSession | null) => {
    const next = new Map(sessionsRef.current);
    if (session) next.set(identity, session); else next.delete(identity);
    sessionsRef.current = next;
    setSessions(next);
  }, []);
  const findSession = useCallback((id: number) => Array.from(sessionsRef.current.values()).find((session) => session.id === id), []);
  useLayoutEffect(() => {
    const previous = activeIdentity.current;
    activeIdentity.current = threadIdentity;
    if (previous === threadIdentity) return;
    yieldedRecovery.current.delete(threadIdentity);
    const session = sessionsRef.current.get(previous);
    if (session?.rebaseChecking && rebaseChecks.current.delete(session.id)) {
      putSession(previous, { ...session, rebaseChecking: false });
    }
  }, [putSession, threadIdentity]);
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
    if (sessionsRef.current.has(session.identity) || restoring.current.has(session.identity)) return;
    if (activeRecovery && activeRecovery.origin.hostId === session.origin.hostId && activeRecovery.origin.threadId === session.origin.threadId
      && dismissedRecovery.current.get(session.identity) !== recoveryKey(activeRecovery.origin)) {
      yieldedRecovery.current.delete(session.identity);
      failedRecovery.current.delete(session.identity);
      setAccessEpoch(value => value + 1);
      return;
    }
    if (editAccess && !editAccess.acquire(session.origin)) return;
    const begin = () => {
      const id = ++nextEditId.current;
      const next = { ...session, id, sessionId: newRecoveryId(), edits: textEdits(session.draft), addedText: '', removedAttachments: [], attachmentRecoveryInvalid: false,
        error: '', saveError: '', pending: false, sent: false, navigationFrozen: false, rebaseChecking: false, rebaseCommitting: false, requiresCurrentSource: false, revision: 0 };
      dismissedRecovery.current.delete(next.identity);
      putSession(next.identity, next);
      publishSession(next);
    };
    if (!editAccess) { begin(); return; }
    restoring.current.add(session.identity);
    void editAccess.read(session.origin).then(recovery => {
      restoring.current.delete(session.identity);
      if (!mounted.current || activeIdentity.current !== session.identity || !editAccess.owns(session.origin)) {
        editAccess.release(session.origin); return;
      }
      setAccessError('');
      if (recovery) { setLocalRecovery(recovery); return; }
      begin();
    }).catch((reason: unknown) => {
      restoring.current.delete(session.identity);
      editAccess.release(session.origin);
      if (mounted.current) setAccessError(`Could not read the saved message edit: ${errorMessage(reason, 'Unknown error.')}`);
    });
  }, [activeRecovery, editAccess, publishSession, putSession]);
  const updateEdit = useCallback<UpdateEdit>((id, update) => {
    const current = findSession(id);
    if (!current || (editAccess && !editAccess.owns(current.origin)) || current.pending || current.sent || current.attachmentRecoveryInvalid || frozenSessions.current.has(current.identity)) return;
    const result = update(current);
    const changed = result.edits !== current.edits || result.addedText !== current.addedText || result.removedAttachments !== current.removedAttachments;
    const next = changed ? { ...result, revision: current.revision + 1 } : result;
    putSession(current.identity, next);
    if (changed) publishSession(next);
  }, [editAccess, findSession, publishSession, putSession]);
  const endEdit = useCallback((id: number, submitted = false) => {
    const current = findSession(id);
    if (!current || (editAccess && !editAccess.owns(current.origin)) || frozenSessions.current.has(current.identity) || current.rebaseChecking || (current.pending && !submitted)) return;
    putSession(current.identity, { ...current, pending: true, sent: submitted || current.sent, error: '', saveError: '' });
    void notifyRecovery(null, current.origin, recoveryVersion(current)).then(() => {
      const latest = findSession(id);
      if (!latest) return;
      dismissedRecovery.current.set(latest.identity, recoveryKey(latest.origin));
      setLocalRecovery(null);
      putSession(latest.identity, null);
      editAccess?.release(latest.origin);
    }).catch((reason: unknown) => {
      const latest = findSession(id);
      if (latest) putSession(latest.identity, { ...latest, pending: false,
        error: `${latest.sent ? 'The edit was sent, but its recovery could not be cleared' : 'The edit could not be discarded'}: ${errorMessage(reason, 'Unknown error.')}` });
    });
  }, [editAccess, findSession, notifyRecovery, putSession]);
  const submitEdit = useCallback((id: number, submit: NonNullable<StandaloneMessagesProps['onEdit']>) => {
    const current = findSession(id);
    if (!current || (editAccess && !editAccess.owns(current.origin)) || current.pending || current.sent || current.rebaseChecking || current.attachmentRecoveryInvalid || frozenSessions.current.has(current.identity)) return;
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
  }, [editAccess, endEdit, findSession, notifyRecovery, putSession]);
  const cancelRebase = useCallback((id: number) => {
    if (!rebaseChecks.current.delete(id)) return;
    const current = findSession(id);
    if (current) putSession(current.identity, { ...current, rebaseChecking: false, error: '' });
  }, [findSession, putSession]);
  const startRebase = useCallback((id: number) => {
    const current = findSession(id);
    if (!current || (editAccess && !editAccess.owns(current.origin)) || current.pending || current.sent || current.rebaseChecking || current.attachmentRecoveryInvalid
      || frozenSessions.current.has(current.identity) || !onPrepareEditRebase || !onCommitEditRebase || !recoveryCallback.current) return;
    const converted = applyTextEdits(current.draft, current.edits, current.addedText, current.removedAttachments);
    if (!converted.draft) { putSession(current.identity, { ...current, error: converted.error }); return; }
    const token = Symbol('message-edit-rebase'), version = recoveryVersion(current), origin = structuredClone(current.origin);
    rebaseChecks.current.set(id, token);
    putSession(current.identity, { ...current, rebaseChecking: true, error: '' });
    void (async () => {
      try {
        await notifyRecovery(recoveryFor(current, converted.draft), origin, version);
        const candidate = await onPrepareEditRebase(origin, version);
        if (rebaseChecks.current.get(id) !== token) return;
        const latest = findSession(id);
        if (!latest || !mounted.current || activeIdentity.current !== current.identity || frozenSessions.current.has(current.identity)) return;
        if (latest.revision !== version.revision || latest.sessionId !== version.sessionId
          || recoveryKey(latest.origin) !== recoveryKey(origin)) throw new Error('The draft changed while checking. Your newer edit was preserved; check again.');
        if (recoveryKey(candidate.origin) !== recoveryKey(origin) || candidate.version.sessionId !== version.sessionId
          || candidate.version.revision !== version.revision) throw new Error('The checked edit no longer matches this draft.');
        putSession(latest.identity, { ...latest, rebaseChecking: false, rebaseCommitting: true, pending: true });
        await notifyRecovery(recoveryFor(latest), origin, version);
        const recovered = await onCommitEditRebase(candidate);
        const after = findSession(id), editor = recovered.editor;
        if (!after || !mounted.current || after.sessionId !== version.sessionId || after.revision !== version.revision
          || recoveryKey(after.origin) !== recoveryKey(origin)) return;
        if (!editor || editor.sessionId !== version.sessionId || editor.revision !== version.revision + 1
          || !editor.requiresCurrentSource || recovered.origin.hostId !== origin.hostId || recovered.origin.threadId !== origin.threadId) {
          throw new Error('The recovered edit could not be confirmed. Reload the saved recovery.');
        }
        putSession(after.identity, { ...after, turnId: recovered.origin.turnId, itemId: recovered.origin.itemId,
          turnIndex: editor.turnIndex, itemIndex: editor.itemIndex, snapshot: structuredClone(editor.snapshot),
          origin: structuredClone(recovered.origin), signature: editor.sourceSignature, revision: editor.revision,
          requiresCurrentSource: true, pending: false, rebaseChecking: false, rebaseCommitting: false, error: '', saveError: '' });
      } catch (reason) {
        if (rebaseChecks.current.get(id) !== token || !mounted.current) return;
        const latest = findSession(id);
        if (latest) putSession(latest.identity, { ...latest, pending: false, rebaseChecking: false, rebaseCommitting: false,
          error: errorMessage(reason, 'Could not check the sent message. Your draft was preserved.') });
      } finally {
        if (rebaseChecks.current.get(id) === token) {
          rebaseChecks.current.delete(id);
          const latest = findSession(id);
          if (mounted.current && latest?.rebaseChecking) putSession(latest.identity, { ...latest, rebaseChecking: false });
        }
      }
    })();
  }, [editAccess, findSession, notifyRecovery, onCommitEditRebase, onPrepareEditRebase, putSession]);
  useEffect(() => {
    if (!activeRecovery) { dismissedRecovery.current.delete(threadIdentity); failedRecovery.current.delete(threadIdentity); return; }
    const requested = activeRecovery.origin;
    if (!thread || requested.hostId !== hostId || requested.threadId !== thread.id || sessionsRef.current.has(threadIdentity)
      || dismissedRecovery.current.get(threadIdentity) === recoveryKey(requested)) return;
    if (yieldedRecovery.current.has(threadIdentity)) {
      if (editAccess && !editAccess.available(requested)) yieldedRecovery.current.delete(threadIdentity);
      return;
    }
    const fingerprint = JSON.stringify(activeRecovery);
    if (failedRecovery.current.get(threadIdentity) === fingerprint) return;
    const restore = (recovery: MessageEditRecovery) => {
      const { origin, draft, editor } = recovery;
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
        pending: false, sent: false, navigationFrozen: false, rebaseChecking: false, rebaseCommitting: false, requiresCurrentSource: editor?.requiresCurrentSource === true,
        revision: hasVersion ? editor!.revision : 0 };
      putSession(threadIdentity, session);
      setLocalRecovery(null);
      if (!hasVersion && !attachmentRecoveryInvalid) publishSession(session);
    };
    if (!editAccess) { restore(activeRecovery); return; }
    if (!editAccess.acquire(requested)) return;
    let cancelled = false;
    restoring.current.add(threadIdentity);
    void editAccess.read(requested).then(recovery => {
      if (cancelled || !mounted.current || activeIdentity.current !== threadIdentity || !editAccess.owns(requested)) return;
      restoring.current.delete(threadIdentity);
      if (!recovery || recovery.origin.hostId !== hostId || recovery.origin.threadId !== thread.id) {
        failedRecovery.current.set(threadIdentity, fingerprint);
        editAccess.release(requested);
        return;
      }
      failedRecovery.current.delete(threadIdentity);
      setAccessError('');
      restore(recovery);
    }).catch((reason: unknown) => {
      if (cancelled) return;
      restoring.current.delete(threadIdentity);
      failedRecovery.current.set(threadIdentity, fingerprint);
      editAccess.release(requested);
      if (mounted.current) setAccessError(`Could not read the saved message edit: ${errorMessage(reason, 'Unknown error.')}`);
    });
    return () => {
      cancelled = true;
      restoring.current.delete(threadIdentity);
      if (!sessionsRef.current.has(threadIdentity)) editAccess.release(requested);
    };
  }, [accessEpoch, activeRecovery, editAccess, hostId, publishSession, putSession, thread, threadIdentity]);
  const freeze = useCallback((): MessageEditNavigationLease | null => {
    if (!mounted.current) throw new Error('The message editor is no longer mounted.');
    const identity = activeIdentity.current;
    const session = sessionsRef.current.get(identity);
    if (!session) return null;
    if (editAccess && !editAccess.owns(session.origin)) throw new Error('The message edit is owned by another view.');
    if (session.pending) throw new Error('Wait for the current message edit operation before leaving.');
    if (frozenSessions.current.has(identity)) throw new Error('This message edit is already frozen.');
    const token = Symbol('message-edit-navigation');
    const origin = structuredClone(session.origin), version = recoveryVersion(session), sessionId = session.id;
    const snapshot = recoveryFor(session);
    let flushed = false;
    rebaseChecks.current.delete(session.id);
    frozenSessions.current.set(identity, token);
    putSession(identity, { ...session, navigationFrozen: true, rebaseChecking: false });
    function currentLease() {
      const current = sessionsRef.current.get(identity);
      if (!mounted.current || frozenSessions.current.get(identity) !== token || !current || current.id !== sessionId
        || current.sessionId !== version.sessionId || current.revision !== version.revision
        || recoveryKey(current.origin) !== recoveryKey(origin)) throw new Error('The frozen message edit is no longer current.');
      return current;
    }
    return {
      origin: structuredClone(origin), version: { ...version },
      async flush() {
        currentLease();
        flushed = false;
        try {
          if (!recoveryCallback.current) throw new Error('Message edit recovery is unavailable.');
          await notifyRecovery(snapshot, origin, version);
          const current = currentLease();
          if (current.saveError) putSession(identity, { ...current, saveError: '' });
          flushed = true;
        } catch (reason) {
          if (mounted.current && frozenSessions.current.get(identity) === token) {
            const current = sessionsRef.current.get(identity);
            if (current?.id === sessionId) putSession(identity, { ...current,
              saveError: `Could not save the edit recovery: ${errorMessage(reason, 'Unknown error.')}` });
          }
          throw reason;
        }
      },
      handoff() {
        if (!flushed) throw new Error('The message edit must be saved before handing it off.');
        const current = currentLease();
        if (editAccess && !editAccess.owns(current.origin)) throw new Error('The message edit authority changed.');
        yieldedRecovery.current.add(identity);
        frozenSessions.current.delete(identity);
        putSession(identity, null);
        editAccess?.release(origin);
      },
      release() {
        if (frozenSessions.current.get(identity) !== token) return;
        frozenSessions.current.delete(identity);
        const current = sessionsRef.current.get(identity);
        if (mounted.current && current?.id === sessionId) putSession(identity, { ...current, navigationFrozen: false });
      },
    };
  }, [editAccess, notifyRecovery, putSession]);
  const navigationController = useMemo<MessageEditNavigationController>(() => ({ freeze }), [freeze]);
  useLayoutEffect(() => {
    onEditNavigationController?.(navigationController);
    return () => { onEditNavigationController?.(null); };
  }, [navigationController, onEditNavigationController]);
  const activeSession = sessions.get(threadIdentity) ?? null;
  const editingHere = activeSession && (!editAccess || editAccess.owns(activeSession.origin)) ? activeSession : null;
  const accessRestricted = Boolean(editAccess && thread && !editAccess.available({ hostId, threadId: thread.id }));
  const recoveryAvailable = Boolean(editingHere && (onEditDraftChange
    || (editRecovery && recoveryKey(editRecovery.origin) === recoveryKey(editingHere.origin))));
  const rebaseRequired = Boolean(editingHere && editRebase && recoveryKey(editRecovery?.origin ?? editRebase.origin) === recoveryKey(editingHere.origin)
    && recoveryKey(editRebase.origin) === recoveryKey(editingHere.origin) && editingHere.sessionId === editRebase.submittedVersion.sessionId
    && editingHere.revision > editRebase.submittedVersion.revision);
  const canRebase = rebaseRequired && Boolean(onEditDraftChange && onPrepareEditRebase && onCommitEditRebase);
  return { editingHere, recoveryAvailable, rebaseRequired, canRebase, startRebase, cancelRebase, startEdit, updateEdit, endEdit, submitEdit,
    accessRestricted, accessError };
}
