import type { ServerRequestRef, WorkbenchClient, WorkbenchEvent } from '../workbench-contract.ts';
import { isServerRequestEvent } from './client.ts';
import type { ApprovalDialogProps, ApprovalInputDraft, ApprovalOutcome, ServerRequest } from './ApprovalDialog.tsx';
import type { ApprovalFormValues } from './approval-schema.ts';

export type ApprovalRequestOutcome = ApprovalOutcome | 'expired';
export interface ApprovalRequestState {
  request: ServerRequest;
  outcome: ApprovalRequestOutcome;
  current: boolean;
  inputDraft: ApprovalInputDraft;
  formDraft?: ApprovalFormValues;
  error?: string;
}

export interface ApprovalRequestsOptions {
  /** Confirm that this exact ref is still pending after a definitely undispatched attempt. */
  verifyPending?(ref: ServerRequestRef): Promise<boolean>;
}

export type ApprovalDialogBinding = Pick<ApprovalDialogProps, 'request' | 'stateRef' | 'outcome' | 'onBegin' | 'onOutcome' |
  'inputDraft' | 'onInputDraftChange' | 'onInputAnswerChange' | 'formDraft' | 'onFormDraftChange' | 'onRespond' | 'onUnsupported' | 'onCheckRequestValidity'>;
type Attempt = { owner: symbol; dispatched: boolean; verified: boolean; knownNotSent: boolean };
type Entry = ApprovalRequestState & { attempt?: Attempt; verifiedOwner?: symbol };

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const key = (ref: ServerRequestRef) => JSON.stringify([ref.hostId, ref.id, ref.generation]);
const sameRef = (a: ServerRequestRef, b: ServerRequestRef) =>
  a.hostId === b.hostId && a.id === b.id && a.generation === b.generation;
const sameId = (a: ServerRequestRef, b: ServerRequestRef) => a.hostId === b.hostId && a.id === b.id;
const validRef = (value: unknown): value is ServerRequestRef => object(value)
  && typeof value.hostId === 'string' && value.hostId.length > 0
  && typeof value.generation === 'string' && value.generation.length > 0
  && (typeof value.id === 'string' || typeof value.id === 'number' && Number.isFinite(value.id));
const threadOf = (request: ServerRequest) => typeof request.params.threadId === 'string' ? request.params.threadId : null;

/** One instance belongs to the parent app, not to either approval surface. */
export class ApprovalRequestsController {
  private readonly client: WorkbenchClient;
  private readonly options: ApprovalRequestsOptions;
  private readonly entries = new Map<string, Entry>();
  private readonly seenRefs = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private snapshot: readonly ApprovalRequestState[] = [];
  private readonly unsubscribeClient: () => void;
  private readonly hostDisconnected = new Set<string>();
  private bridgeDisconnected = false;
  private disposed = false;

  constructor(client: WorkbenchClient, options: ApprovalRequestsOptions = {}) {
    this.client = client;
    this.options = options;
    this.unsubscribeClient = client.subscribe(event => this.onEvent(event));
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  readonly getSnapshot = (): readonly ApprovalRequestState[] => this.snapshot;

  private publish() {
    this.snapshot = Array.from(this.entries.values(), ({ attempt: _attempt, verifiedOwner: _verifiedOwner, ...entry }) => entry);
    for (const listener of this.listeners) listener();
  }

  private replace(ref: ServerRequestRef, next: Entry) {
    this.entries.set(key(ref), next);
    this.publish();
  }

  private invalidate(hostId: string | null) {
    let changed = false;
    for (const [entryKey, entry] of this.entries) {
      if (!entry.current || hostId !== null && entry.request.hostId !== hostId) continue;
      const outcome = entry.outcome === 'ready' ? 'expired' : entry.outcome === 'sending' ? 'unknown' : entry.outcome;
      this.entries.set(entryKey, { ...entry, current: false, outcome, attempt: undefined, verifiedOwner: undefined,
        error: outcome === 'unknown' ? 'The original connection was lost; the response may have been sent.'
          : 'The original connection was lost; this request cannot be used again.' });
      changed = true;
    }
    if (changed) this.publish();
  }

  private onEvent(event: WorkbenchEvent) {
    if (this.disposed) return;
    if (event.type === 'connection-state') {
      if (event.state === 'connected') this.bridgeDisconnected = false;
      else if (event.state === 'disconnected' || event.state === 'connecting') {
        this.bridgeDisconnected = true;
        this.invalidate(null);
      }
      return;
    }
    if (event.type === 'codex-app-server-connection-changed' && typeof event.hostId === 'string') {
      if (event.state === 'connected') this.hostDisconnected.delete(event.hostId);
      else if (event.state === 'disconnected' || event.state === 'connecting') {
        this.hostDisconnected.add(event.hostId);
        this.invalidate(event.hostId);
      }
      return;
    }
    if (isServerRequestEvent(event)) {
      const ref = { ...event.requestRef };
      const entryKey = key(ref);
      const request: ServerRequest = { hostId: ref.hostId, id: ref.id, ref, method: event.request.method,
        params: structuredClone(event.request.params ?? {}) };
      const previous = this.entries.get(entryKey);
      if (previous) {
        if (previous.request.method !== request.method || JSON.stringify(previous.request.params) !== JSON.stringify(request.params)) {
          this.replace(ref, { ...previous, current: false, outcome: 'unknown', attempt: undefined,
            error: 'The original request changed without a new identity.' });
        }
        return;
      }
      if (this.seenRefs.has(entryKey)) return;
      this.seenRefs.add(entryKey);
      for (const [oldKey, old] of this.entries) {
        if (old.current && sameId(old.request.ref, ref)) {
          this.entries.set(oldKey, { ...old, current: false, attempt: undefined, verifiedOwner: undefined,
            outcome: old.outcome === 'sending' ? 'unknown' : old.outcome === 'ready' ? 'expired' : old.outcome,
            error: 'A newer request reused this identifier. Open the original conversation to check.' });
        }
      }
      const current = !this.bridgeDisconnected && !this.hostDisconnected.has(ref.hostId);
      this.entries.set(entryKey, { request, current, outcome: current ? 'ready' : 'expired', inputDraft: {},
        ...(!current ? { error: 'The original connection is unavailable.' } : {}) });
      this.publish();
      return;
    }
    if (event.type !== 'mcp-notification' || event.method !== 'serverRequest/resolved'
      || typeof event.hostId !== 'string' || !object(event.params)) return;
    const { requestId, threadId } = event.params;
    if ((typeof requestId !== 'string' && typeof requestId !== 'number') || typeof threadId !== 'string' || !threadId) return;
    if (validRef(event.requestRef) && event.requestRef.hostId === event.hostId && event.requestRef.id === requestId) {
      this.resolved(event.requestRef, threadId);
      return;
    }
    // An uncorrelated notification can belong to an earlier generation of the same ID.
    let changed = false;
    for (const [entryKey, entry] of this.entries) {
      if (!entry.current || entry.request.hostId !== event.hostId || entry.request.id !== requestId || threadOf(entry.request) !== threadId) continue;
      this.entries.set(entryKey, { ...entry, current: false, outcome: entry.outcome === 'sent' ? 'sent' : 'unknown', attempt: undefined, verifiedOwner: undefined,
        error: 'A resolved notification lacked the original request generation. Check the conversation.' });
      changed = true;
    }
    if (changed) this.publish();
  }

  /** Only a host-correlated resolution for the original thread may remove a request. */
  resolved(ref: ServerRequestRef, threadId: string): boolean {
    const entry = this.entries.get(key(ref));
    if (!entry || !sameRef(entry.request.ref, ref) || !threadId || threadOf(entry.request) !== threadId) return false;
    this.entries.delete(key(ref));
    this.publish();
    return true;
  }

  updateInputDraft(ref: ServerRequestRef, draft: ApprovalInputDraft): void {
    const entry = this.entries.get(key(ref));
    if (!entry?.current || entry.outcome !== 'ready') return;
    this.replace(ref, { ...entry, inputDraft: structuredClone(draft) });
  }

  updateInputAnswer(ref: ServerRequestRef, questionId: string, answer: { selected: string | null; other: string }): void {
    const entry = this.entries.get(key(ref));
    if (!entry?.current || entry.outcome !== 'ready') return;
    this.replace(ref, { ...entry, inputDraft: { ...entry.inputDraft, [questionId]: { ...answer } } });
  }

  updateFormDraft(ref: ServerRequestRef, draft: ApprovalFormValues): void {
    const entry = this.entries.get(key(ref));
    if (!entry?.current || entry.outcome !== 'ready') return;
    this.replace(ref, { ...entry, formDraft: structuredClone(draft) });
  }

  private begin(ref: ServerRequestRef, owner: symbol, expected?: Entry): boolean {
    const entry = this.entries.get(key(ref));
    if (this.disposed || !entry?.current || expected && expected !== entry || entry.outcome !== 'ready'
      || this.bridgeDisconnected || this.hostDisconnected.has(ref.hostId)) return false;
    this.replace(ref, { ...entry, outcome: 'sending', error: undefined, verifiedOwner: undefined,
      attempt: { owner, dispatched: false, verified: false, knownNotSent: false } });
    return true;
  }

  private outcome(ref: ServerRequestRef, owner: symbol, outcome: ApprovalOutcome) {
    const entry = this.entries.get(key(ref));
    if (!entry?.current || entry.attempt?.owner !== owner) return;
    if (outcome === 'sent' && entry.outcome === 'sending') {
      this.replace(ref, { ...entry, outcome: 'sent', attempt: undefined });
    } else if (outcome === 'unknown' && entry.outcome === 'sending') {
      this.replace(ref, { ...entry, outcome: 'unknown', error: 'The response could not be confirmed.' });
    } else if (outcome === 'ready' && entry.attempt.verified && (entry.outcome === 'sending'
      || entry.outcome === 'unknown' && entry.attempt.knownNotSent)) {
      this.replace(ref, { ...entry, outcome: 'ready', attempt: undefined, verifiedOwner: owner,
        error: 'The original request is still pending; retry is available.' });
    }
  }

  private async check(ref: ServerRequestRef, owner: symbol): Promise<boolean> {
    const entry = this.entries.get(key(ref));
    if (!entry?.current) return false;
    if (entry.outcome === 'ready' && entry.verifiedOwner === owner) return true;
    if (entry.attempt?.owner !== owner || !this.options.verifyPending || this.bridgeDisconnected || this.hostDisconnected.has(ref.hostId)) return false;
    if (entry.outcome === 'unknown' && !entry.attempt.knownNotSent) return false;
    const attempt = entry.attempt;
    let pending = false;
    try { pending = await this.options.verifyPending(ref); } catch { return false; }
    const latest = this.entries.get(key(ref));
    if (!pending || !latest?.current || latest.attempt !== attempt || this.bridgeDisconnected || this.hostDisconnected.has(ref.hostId)) return false;
    this.replace(ref, { ...latest, attempt: { ...attempt, verified: true } });
    return true;
  }

  private async performReply(ref: ServerRequestRef, owner: symbol, response: { result: unknown } | { error: { code: number; message: string } }): Promise<void> {
    const entry = this.entries.get(key(ref));
    if (!entry?.current || entry.outcome !== 'sending' || entry.attempt?.owner !== owner || entry.attempt.dispatched)
      throw new Error('The original approval request is no longer available.');
    const attempt = { ...entry.attempt, dispatched: true };
    this.replace(ref, { ...entry, attempt });
    try {
      await this.client.reply(ref, response);
      const latest = this.entries.get(key(ref));
      if (!latest?.current || latest.outcome !== 'sending' || latest.attempt !== attempt)
        throw Object.assign(new Error('The original approval response can no longer be confirmed.'), { uncertain: true });
      this.replace(ref, { ...latest, outcome: 'sent', attempt: undefined });
    } catch (cause) {
      const latest = this.entries.get(key(ref));
      if (latest?.current && latest.outcome === 'sending' && latest.attempt === attempt) {
        const knownNotSent = object(cause) && cause.uncertain === false;
        this.replace(ref, { ...latest, outcome: 'unknown', attempt: { ...attempt, knownNotSent },
          error: knownNotSent ? 'The reply failed; the original request must be checked before retrying.' : 'The response could not be confirmed.' });
        if (knownNotSent && await this.check(ref, owner)) this.outcome(ref, owner, 'ready');
      }
      throw cause;
    }
  }

  /** Mini uses this directly; the reservation and reply are shared with the dialog. */
  async respond(ref: ServerRequestRef, result: unknown): Promise<void> {
    const owner = Symbol('mini approval');
    if (!this.begin(ref, owner)) throw new Error('The original approval request is no longer available.');
    return this.performReply(ref, owner, { result });
  }

  dialog(ref: ServerRequestRef): ApprovalDialogBinding | null {
    const entry = this.entries.get(key(ref));
    if (!entry) return null;
    const owner = Symbol('approval dialog');
    const matches = (candidate: ServerRequestRef) => sameRef(ref, candidate);
    return {
      request: entry.request, stateRef: entry.request.ref, outcome: entry.outcome === 'expired' ? 'unknown' : entry.outcome,
      inputDraft: entry.inputDraft, formDraft: entry.formDraft,
      onBegin: candidate => matches(candidate) && this.begin(ref, owner, entry),
      onOutcome: (candidate, outcome) => { if (matches(candidate)) this.outcome(ref, owner, outcome); },
      onInputDraftChange: (candidate, draft) => { if (matches(candidate)) this.updateInputDraft(ref, draft); },
      onInputAnswerChange: (candidate, questionId, answer) => { if (matches(candidate)) this.updateInputAnswer(ref, questionId, answer); },
      onFormDraftChange: (candidate, draft) => { if (matches(candidate)) this.updateFormDraft(ref, draft); },
      onRespond: result => this.performReply(ref, owner, { result }),
      onUnsupported: () => this.performReply(ref, owner, { error: { code: -32601, message: '当前 Web 宿主不支持此请求。' } }),
      onCheckRequestValidity: this.options.verifyPending
        ? candidate => matches(candidate) ? this.check(ref, owner) : Promise.resolve(false)
        : undefined,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.invalidate(null);
    this.disposed = true;
    this.unsubscribeClient();
    this.listeners.clear();
  }
}
