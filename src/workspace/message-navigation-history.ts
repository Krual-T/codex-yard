import type { Page, TurnSummary } from '../../lib/codex-protocol.ts';
import { record } from '../native/protocol.ts';
import { attachedPrompt } from './composer-input.ts';
import { questionReplies } from '../native/async-questions.ts';

export type MessageLocation = { turnId: string; pageCursor: string | null; offset: number };
export type MessageMarker = {
  id: string; turnId: string; itemId?: string; prompt: string; response: string; attachments: string[];
};
export type NavigationWindow = { turns: TurnSummary[]; before: boolean; after: boolean };
type TurnPage = Page<TurnSummary> & { backwardsCursor?: string | null };
export type FetchNavigationTurns = (params: Record<string, unknown>) => Promise<TurnPage>;

export const messageNavigationId = (turnId: string, itemId?: string) => JSON.stringify([turnId, itemId ?? null]);
const clip = (text: string) => {
  const characters = Array.from(text.trim());
  return characters.length > 240 ? characters.slice(0, 239).join('') + '…' : text.trim();
};

export function turnMessageMarkers(turn: TurnSummary): MessageMarker[] {
  const result: MessageMarker[] = [];
  for (const item of turn.items) {
    if (item.type === 'userMessage') {
      const attachments: string[] = [], text: string[] = [];
      const answers = questionReplies(item);
      if (answers.length) text.push(...answers.map(answer => answer.answer));
      else for (const part of Array.isArray(item.content) ? item.content.map(record) : []) {
        if (part.type === 'text' && typeof part.text === 'string') {
          const prompt = attachedPrompt(part.text);
          text.push(prompt.text);
          attachments.push(...prompt.attachments.map(file => file.name));
        } else if (part.type === 'localImage' || part.type === 'image') {
          attachments.push(typeof part.path === 'string' ? part.path.split(/[\\/]/).at(-1) || 'Image' : 'Image');
        }
      }
      result.push({ id: messageNavigationId(turn.id, result.length ? item.id : undefined), turnId: turn.id,
        itemId: item.id, prompt: clip(text.join('\n')), response: '', attachments: [...new Set(attachments)] });
    } else if (item.type === 'agentMessage' && typeof item.text === 'string' && result.length) {
      result[result.length - 1]!.response = clip(item.text);
    }
  }
  return result;
}

export function messageMarkers(locations: readonly MessageLocation[], known: readonly TurnSummary[],
  previews: ReadonlyMap<string, TurnSummary>): MessageMarker[] {
  const turns = new Map(known.filter(turn => !turn.id.startsWith('preparing:')).map(turn => [turn.id, turn]));
  const order = [...new Set([...locations.map(location => location.turnId), ...turns.keys()])];
  return order.flatMap(turnId => {
    const turn = turns.get(turnId) ?? previews.get(turnId);
    if (turn) return turnMessageMarkers(turn);
    return [{ id: messageNavigationId(turnId), turnId, prompt: '', response: '', attachments: [] }];
  });
}

export class NavigationTargetChanged extends Error {
  constructor() { super('The conversation changed while locating this message.'); }
}

/** The pinned rail's 10 × 100 metadata directory, using the existing host RPC.
 * Summaries already retain every user input and final reply, so previews and
 * distant navigation do not need to download tool output or resume a thread. */
export class MessageNavigationHistory {
  locations: MessageLocation[] = [];
  complete = false;
  readonly previews = new Map<string, TurnSummary>();
  private readonly fetchTurns: FetchNavigationTurns;
  private readonly cursors = new Map<string, string | null>();
  private readonly pending = new Map<string, Promise<TurnSummary>>();

  constructor(fetchTurns: FetchNavigationTurns) { this.fetchTurns = fetchTurns; }

  async index(signal: AbortSignal) {
    const locations: MessageLocation[] = [], seen = new Set<string>(), ids = new Set<string>();
    let cursor: string | null = null, complete = false;
    for (let page = 0; page < 10; page++) {
      signal.throwIfAborted();
      const response = await this.fetchTurns({ cursor, limit: 100, sortDirection: 'desc', itemsView: 'notLoaded' });
      signal.throwIfAborted();
      response.data.forEach((turn, offset) => {
        if (ids.has(turn.id)) return;
        ids.add(turn.id);
        locations.push({ turnId: turn.id, pageCursor: response.backwardsCursor ?? cursor, offset });
      });
      cursor = response.nextCursor;
      if (cursor === null) { complete = true; break; }
      if (seen.has(cursor)) throw new Error('The host returned a repeated navigation cursor.');
      seen.add(cursor);
    }
    this.cursors.clear();
    this.locations = locations.reverse();
    this.complete = complete;
    return { locations: this.locations, complete };
  }

  private async cursor(location: MessageLocation, signal: AbortSignal) {
    const key = JSON.stringify(location);
    signal.throwIfAborted();
    if (this.cursors.has(key)) return this.cursors.get(key)!;
    if (!location.offset) return location.pageCursor;
    const page = await this.fetchTurns({ cursor: location.pageCursor, limit: location.offset,
      sortDirection: 'desc', itemsView: 'notLoaded' });
    signal.throwIfAborted();
    if (page.nextCursor === null) throw new NavigationTargetChanged();
    this.cursors.set(key, page.nextCursor);
    return page.nextCursor;
  }

  preview(turnId: string, signal: AbortSignal): Promise<TurnSummary> {
    const cached = this.previews.get(turnId);
    if (cached) return Promise.resolve(cached);
    const pending = this.pending.get(turnId);
    if (pending) return pending;
    const promise = (async () => {
      const location = this.locations.find(location => location.turnId === turnId);
      if (!location) throw new NavigationTargetChanged();
      const cursor = await this.cursor(location, signal);
      signal.throwIfAborted();
      const page = await this.fetchTurns({ cursor, limit: 1, sortDirection: 'desc', itemsView: 'summary' });
      signal.throwIfAborted();
      const turn = page.data[0];
      if (turn?.id !== turnId) throw new NavigationTargetChanged();
      this.previews.set(turnId, turn);
      return turn;
    })().finally(() => { if (this.pending.get(turnId) === promise) this.pending.delete(turnId); });
    this.pending.set(turnId, promise);
    return promise;
  }

  private async range(start: number, end: number, signal: AbortSignal): Promise<NavigationWindow> {
    const location = this.locations[end - 1];
    if (!location) throw new NavigationTargetChanged();
    const cursor = await this.cursor(location, signal);
    signal.throwIfAborted();
    const page = await this.fetchTurns({ cursor, limit: end - start, sortDirection: 'desc', itemsView: 'summary' });
    signal.throwIfAborted();
    const turns = page.data.slice().reverse();
    const expected = this.locations.slice(start, end);
    if (turns.length !== expected.length || turns.some((turn, index) => turn.id !== expected[index]?.turnId)) {
      throw new NavigationTargetChanged();
    }
    for (const turn of turns) this.previews.set(turn.id, turn);
    return { turns, before: start > 0, after: end < this.locations.length };
  }

  async around(turnId: string, signal: AbortSignal) {
    const position = this.locations.findIndex(location => location.turnId === turnId);
    if (position < 0) throw new NavigationTargetChanged();
    return this.range(Math.max(0, position - 4), Math.min(this.locations.length, position + 5), signal);
  }

  async extend(window: NavigationWindow, direction: 'before' | 'after', signal: AbortSignal) {
    const start = this.locations.findIndex(location => location.turnId === window.turns[0]?.id);
    const end = this.locations.findIndex(location => location.turnId === window.turns.at(-1)?.id) + 1;
    if (start < 0 || end === 0) throw new NavigationTargetChanged();
    const next = direction === 'before' ? await this.range(Math.max(0, start - 2), start, signal)
      : await this.range(end, Math.min(this.locations.length, end + 2), signal);
    return direction === 'before' ? { ...window, before: next.before, turns: [...next.turns, ...window.turns] }
      : { ...window, after: next.after, turns: [...window.turns, ...next.turns] };
  }
}
