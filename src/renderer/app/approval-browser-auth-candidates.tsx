import { useEffect, useRef, useState } from 'react';
import { sameBrowserAuthScope } from './approval-browser-auth.tsx';
import type { ApprovalBrowserAuthScope } from './approval-browser-auth.tsx';

/** A short-lived host mapping, never the original credential or selection identifier. */
export interface ApprovalBrowserAuthCandidate {
  choiceId: string;
  accountLabel: string;
  origin: string;
  expiresAt: number;
}

export interface ApprovalBrowserAuthCandidates {
  scope: ApprovalBrowserAuthScope;
  status: 'loading' | 'ready' | 'error';
  candidates: readonly ApprovalBrowserAuthCandidate[];
  hasMore: boolean;
}

export type ApprovalBrowserAuthRequestCandidates = (
  request: { scope: ApprovalBrowserAuthScope; page: 'refresh' | 'next'; signal: AbortSignal },
) => Promise<void>;

export type ApprovalBrowserAuthUseCandidate = (
  request: { scope: ApprovalBrowserAuthScope; choiceId: string },
) => Promise<void>;

function visibleText(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}\p{Zs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/gu, character => {
    if (character === ' ') return character;
    const point = character.codePointAt(0)!;
    return point <= 0xffff ? '\\u' + point.toString(16).toUpperCase().padStart(4, '0')
      : '\\u{' + point.toString(16).toUpperCase() + '}';
  });
}

function validCandidates(candidates: readonly ApprovalBrowserAuthCandidate[]): boolean {
  return Array.isArray(candidates) && candidates.every(candidate => candidate && typeof candidate.choiceId === 'string'
    && candidate.choiceId.trim() && typeof candidate.accountLabel === 'string' && candidate.accountLabel.trim()
    && typeof candidate.origin === 'string' && candidate.origin.trim()
    && Number.isSafeInteger(candidate.expiresAt) && candidate.expiresAt > 0)
    && new Set(candidates.map(candidate => candidate.choiceId)).size === candidates.length;
}

export function ApprovalBrowserAuthSavedLogins({ scope, snapshot, disabled, onRequest, onUse }: {
  scope: ApprovalBrowserAuthScope;
  snapshot: ApprovalBrowserAuthCandidates;
  disabled: boolean;
  onRequest?: ApprovalBrowserAuthRequestCandidates;
  onUse?: (choiceId: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const matches = sameBrowserAuthScope(scope, snapshot.scope);
  const valid = matches && validCandidates(snapshot.candidates);
  const live = valid ? snapshot.candidates.filter(candidate => candidate.expiresAt * 1000 > now) : [];
  const choice = selected === null ? live[0] : live.find(candidate => candidate.choiceId === selected);
  const nextExpiry = live.reduce<number | undefined>((earliest, candidate) =>
    earliest === undefined || candidate.expiresAt < earliest ? candidate.expiresAt : earliest, undefined);

  useEffect(() => {
    setNow(Date.now());
  }, [snapshot]);
  useEffect(() => {
    if (nextExpiry === undefined) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(2147483647, Math.max(0, nextExpiry * 1000 - Date.now())));
    return () => clearTimeout(timer);
  }, [nextExpiry, now]);
  useEffect(() => () => { pending.current?.abort(); }, []);
  useEffect(() => {
    if ((disabled || !matches) && pending.current) {
      pending.current.abort();
      pending.current = null;
      setLoading(false);
    }
  }, [disabled, matches]);

  const request = async (page: 'refresh' | 'next') => {
    if (disabled || !matches || !onRequest || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true); setLoadError(false);
    try { await onRequest({ scope, page, signal: controller.signal }); }
    catch { if (!controller.signal.aborted) setLoadError(true); }
    finally {
      if (pending.current === controller) {
        pending.current = null;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
  };
  const useChoice = () => {
    if (!choice || disabled || !onUse) return;
    if (choice.expiresAt * 1000 <= Date.now()) { setNow(Date.now()); return; }
    onUse(choice.choiceId);
  };

  if (!matches) return <p role="alert">Saved sign-in choices do not match this request.</p>;
  if (!valid) return <p role="alert">Saved sign-in choices could not be verified.</p>;
  return <section aria-label="Saved sign-in choices">
    <h4>Saved sign-ins</h4>
    {snapshot.status === 'loading' && <p role="status">Loading saved sign-ins...</p>}
    {snapshot.status === 'error' && <p role="alert">Saved sign-ins could not be loaded.</p>}
    {snapshot.status === 'ready' && live.length > 0 && <fieldset disabled={disabled || loading}>
      <legend>Choose a saved sign-in</legend>
      {live.map(candidate => <label key={candidate.choiceId} style={{ display: 'block', overflowWrap: 'anywhere' }}>
        <input type="radio" name="saved-browser-auth-login" checked={choice?.choiceId === candidate.choiceId}
          onChange={() => setSelected(candidate.choiceId)} /> <bdi>{visibleText(candidate.accountLabel)}</bdi>
        {' '}<small><bdi>{visibleText(candidate.origin)}</bdi></small>
      </label>)}
    </fieldset>}
    {snapshot.status === 'ready' && !live.length && <p>No current saved sign-ins.</p>}
    {selected !== null && !choice && <p role="status">This saved sign-in choice expired or is no longer available. Choose again.</p>}
    {loadError && <p role="alert">Saved sign-ins could not be updated.</p>}
    {snapshot.status === 'ready' && live.length > 0 && <button type="button" disabled={disabled || loading || !choice || !onUse}
      onClick={useChoice}>Use saved sign-in</button>}
    {snapshot.status === 'ready' && snapshot.hasMore && <button type="button" disabled={disabled || loading || !onRequest}
      onClick={() => { void request('next'); }}>More saved sign-ins</button>}
    {snapshot.status === 'error' && <button type="button" disabled={disabled || loading || !onRequest}
      onClick={() => { void request('refresh'); }}>Retry saved sign-ins</button>}
  </section>;
}
