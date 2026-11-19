import { record } from './protocol.ts';
import type { ObjectValue } from './protocol.ts';

const attachmentKey = 'pull-request-attachment-records-v3';
const legacyPrefix = 'codex:persisted-atom:';
const derivedKeys = new Set([
  'config-derived-agent-mode-by-host-id', 'heartbeat-thread-permissions-by-id', 'mcp-global-entrypoints-v2',
  // The pinned snapshot mentions these retired catalogs only in its logout
  // cleanup list. Current discovery rebuilds the live entrypoint projection.
  'mcp-extension-sidebar-catalog', 'mcp-server-tools-cache-v2', 'mcp-extension-sidebar-tools-v1',
  'mcp-extension-sidebar-tools-v2', 'mcp-extension-sidebar-entries-v1',
]);

export interface QueuedIntent extends ObjectValue {
  id: string;
  pausedReason?: string;
  submission?: ObjectValue & { status?: string; hostId?: string };
}
export interface QueueConvergence<T extends QueuedIntent> {
  hostId: string;
  threadId: string;
  read(): T[];
  update(change: (messages: T[]) => T[]): Promise<unknown>;
  isSame(left: T, right: T): boolean;
  isCurrent(message: T): boolean;
  canMigrate(message: T): boolean;
  wasAccepted(messageId: string): boolean;
  isNotSent(error: unknown): boolean;
  queue: {
    load(threadId: string): Promise<unknown>;
    canEnqueue(threadId: string, message: T): boolean;
    findByClientMessageId(threadId: string, messageId: string): string | undefined;
    enqueue(threadId: string, message: T, position: undefined, beforeDispatch: () => Promise<void>, restored: undefined,
      isCurrent: () => boolean): Promise<{ serverAccepted?: boolean }>;
  };
}
export interface AttachmentMigration {
  identityKey: string;
  payload: ObjectValue;
}
type BrowserStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/** Only backend projections are discarded. Drafts, explicit choices and
 * navigation/backfill metadata retain their original storage contracts. */
export class BrowserStateConvergence {
  private readonly storage: BrowserStorage;
  private readonly summaries = new Map<string, ObjectValue[]>();
  private readonly queueMigrations = new Map<string, Promise<void>>();
  private readonly attachmentMigrations = new Map<string, Promise<void>>();

  constructor(storage: BrowserStorage) {
    this.storage = storage;
    const atoms = this.atoms();
    let changed = false;
    for (const key of Object.keys(atoms)) if (this.isDerivedAtom(key)) { delete atoms[key]; changed = true; }
    if (changed) storage.setItem('native-atoms', JSON.stringify(atoms));
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    for (const key of keys) {
      if (key?.startsWith(legacyPrefix) && this.isDerivedAtom(key.slice(legacyPrefix.length))) storage.removeItem(key);
    }
  }

  isDerivedAtom(key: string): boolean {
    return derivedKeys.has(key) || key.startsWith('remote-thread-summaries-v3:');
  }

  readRemoteSummaries(hostId: string): ObjectValue[] { return this.summaries.get(hostId) ?? []; }
  writeRemoteSummaries(hostId: string, summaries: ObjectValue[]): void {
    this.summaries.set(hostId, summaries.map(summary => {
      const { hasUnreadTurn: _oldReceipt, ...value } = summary;
      return value;
    }));
  }

  legacyAttachmentRecords(): ObjectValue[] {
    return [...this.attachmentRecords(this.atoms()[attachmentKey]), ...this.attachmentRecords(this.json(legacyPrefix + attachmentKey))];
  }

  /** Existing renderer serialization/queue operations do the dispatch. Moving
   * only a compatible prefix preserves ordering around local-only intents. */
  migrateQueuedFollowUps<T extends QueuedIntent>(options: QueueConvergence<T>): Promise<void> {
    const key = JSON.stringify([options.hostId, options.threadId]);
    const running = this.queueMigrations.get(key);
    if (running) return running;
    const task = this.migrateQueue(options).finally(() => { this.queueMigrations.delete(key); });
    this.queueMigrations.set(key, task);
    return task;
  }

  private async migrateQueue<T extends QueuedIntent>(options: QueueConvergence<T>): Promise<void> {
    if (options.read().length === 0) return;
    const { queue, threadId } = options;
    // Always refresh before examining old intents: a previous add may have
    // succeeded even when its response did not reach this page.
    await queue.load(threadId);
    const confirmed = (message: T) => options.wasAccepted(message.id) || queue.findByClientMessageId(threadId, message.id) != null;
    const remove = (message: T) => options.update(messages => messages.filter(current => !options.isSame(current, message)));
    for (const message of options.read()) {
      if (options.isCurrent(message) && confirmed(message)) await remove(message);
    }
    for (const original of [...options.read()]) {
      if (!options.isCurrent(original) || !options.canMigrate(original) || original.pausedReason != null ||
        original.submission != null && (original.submission.status !== 'queued' || original.submission.hostId !== options.hostId) ||
        !queue.canEnqueue(threadId, original)) break;
      let current = original;
      let dispatched = false;
      const isCurrent = () => options.isCurrent(current);
      try {
        const result = await queue.enqueue(threadId, original, undefined, async () => {
          if (!isCurrent()) return;
          const sending = { ...original, submission: { ...original.submission, hostId: options.hostId, status: 'sending' } } as T;
          await options.update(messages => messages.map(message => options.isSame(message, original) ? sending : message));
          current = sending;
          dispatched = true;
        }, undefined, isCurrent);
        if (result.serverAccepted || confirmed(original)) await remove(current);
        else break;
      } catch (error) {
        if (dispatched) {
          const uncertain = !options.isNotSent(error);
          const paused = { ...current, submission: { ...current.submission, status: uncertain ? 'outcome-unknown' : 'queued' },
            pausedReason: uncertain ? 'submission-outcome-unknown' : error instanceof Error ? error.message : String(error) } as T;
          await options.update(messages => messages.map(message => options.isSame(message, current) ? paused : message));
        }
        throw error;
      }
    }
  }

  /** Legacy records are migration input until the backend confirms each PR.
   * Branch-only/navigation records and separate backfill markers stay intact. */
  migrateAttachments(target: { hostId: string; conversationId: string },
    send: (method: string, params: ObjectValue) => Promise<unknown>,
    canonicalize: (attachment: ObjectValue) => AttachmentMigration | null): Promise<void> {
    const key = JSON.stringify([target.hostId, target.conversationId]);
    const running = this.attachmentMigrations.get(key);
    if (running) return running;
    const task = this.moveAttachments(target, send, canonicalize).finally(() => { this.attachmentMigrations.delete(key); });
    this.attachmentMigrations.set(key, task);
    return task;
  }

  private async moveAttachments(target: { hostId: string; conversationId: string },
    send: (method: string, params: ObjectValue) => Promise<unknown>,
    canonicalize: (attachment: ObjectValue) => AttachmentMigration | null): Promise<void> {
    const matches = (value: ObjectValue) => value.hostId === target.hostId && value.conversationId === target.conversationId;
    const attachments = this.legacyAttachmentRecords().filter(matches).flatMap(value => Array.isArray(value.attachments) ? value.attachments.map(record) : []);
    const candidates = new Map<string, AttachmentMigration>();
    for (const attachment of attachments) {
      const candidate = canonicalize(attachment);
      // The synchronized atom is authoritative when an older localStorage
      // compatibility copy contains the same PR with stale branch metadata.
      if (candidate && !candidates.has(candidate.identityKey)) candidates.set(candidate.identityKey, candidate);
    }
    if (candidates.size === 0) return;
    const list = async () => {
      const identities = new Set<string>();
      let cursor: unknown = null;
      do {
        const result = record(await send('thread/attachment/list', { threadId: target.conversationId, cursor, limit: 100 }));
        for (const item of Array.isArray(result.data) ? result.data : []) {
          const attachment = record(item);
          if (attachment.attachmentType === 'pull_request' && typeof attachment.identityKey === 'string') identities.add(attachment.identityKey);
        }
        cursor = result.nextCursor;
      } while (cursor != null);
      return identities;
    };
    const existing = await list();
    for (const candidate of candidates.values()) if (!existing.has(candidate.identityKey)) {
      await send('thread/attachment/add', { threadId: target.conversationId, attachmentType: 'pull_request', ...candidate });
    }
    const confirmed = await list();
    const prune = (values: ObjectValue[]) => values.flatMap(value => {
      if (!matches(value) || !Array.isArray(value.attachments)) return [value];
      const remaining = value.attachments.filter(attachment => {
        const candidate = canonicalize(record(attachment));
        return candidate == null || !confirmed.has(candidate.identityKey);
      });
      return remaining.length > 0 ? [{ ...value, attachments: remaining }] : [];
    });
    const atoms = this.atoms();
    if (Array.isArray(atoms[attachmentKey])) {
      const remaining = prune(this.attachmentRecords(atoms[attachmentKey]));
      if (remaining.length > 0) atoms[attachmentKey] = remaining; else delete atoms[attachmentKey];
      this.storage.setItem('native-atoms', JSON.stringify(atoms));
    }
    const legacy = this.json(legacyPrefix + attachmentKey);
    if (Array.isArray(legacy)) {
      const remaining = prune(this.attachmentRecords(legacy));
      if (remaining.length > 0) this.storage.setItem(legacyPrefix + attachmentKey, JSON.stringify(remaining));
      else this.storage.removeItem(legacyPrefix + attachmentKey);
    }
  }

  private attachmentRecords(value: unknown): ObjectValue[] { return Array.isArray(value) ? value.map(record) : []; }
  private atoms(): ObjectValue { return record(this.json('native-atoms')); }
  private json(key: string): unknown {
    const raw = this.storage.getItem(key);
    if (raw == null) return undefined;
    try { return JSON.parse(raw); } catch { return undefined; }
  }
}
