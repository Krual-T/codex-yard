import { useEffect, useRef, useState } from 'react';
import type { ApprovalBrowserAuthScope } from './approval-browser-auth.tsx';

export interface ApprovalBrowserAuthManualState {
  scope: ApprovalBrowserAuthScope;
  revision: number;
  phase: 'available' | 'opening' | 'active' | 'finishing' | 'unknown';
}

export type ApprovalBrowserAuthManualAction = (
  request: { scope: ApprovalBrowserAuthScope; action: 'open' | 'back' | 'finish' | 'not-now'; signal: AbortSignal },
) => Promise<void>;

export interface ApprovalBrowserAuthPasswordManagerState {
  scope: ApprovalBrowserAuthScope;
  revision: number;
  provider: 'onepassword';
  phase: 'available' | 'starting' | 'waiting' | 'denied' | 'expired' | 'failed' | 'filling' | 'unknown';
}

export type ApprovalBrowserAuthPasswordManagerAction = (
  request: { scope: ApprovalBrowserAuthScope; provider: 'onepassword'; action: 'start' | 'reopen' | 'back'; signal: AbortSignal },
) => Promise<void>;

interface PendingAction {
  controller: AbortController;
  revision: number;
  settled: boolean;
}

/** The host must publish an authoritative revision after every attempted change. */
function useHostAction(revision: number, onPendingChange: (pending: boolean) => void) {
  const latestRevision = useRef(revision);
  latestRevision.current = revision;
  const notify = useRef(onPendingChange);
  notify.current = onPendingChange;
  const pendingRef = useRef<PendingAction | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => () => {
    if (pendingRef.current) { pendingRef.current.controller.abort(); notify.current(false); }
  }, []);
  useEffect(() => {
    const action = pendingRef.current;
    if (action?.settled && revision > action.revision) {
      pendingRef.current = null;
      setPending(null);
      setError(false);
      notify.current(false);
    }
  }, [revision, pending]);

  const run = async (perform: (signal: AbortSignal) => Promise<void>, unchangedOnSuccess = false) => {
    if (pendingRef.current) return;
    const action: PendingAction = { controller: new AbortController(), revision, settled: false };
    pendingRef.current = action;
    notify.current(true);
    setPending(action); setError(false);
    let succeeded = false;
    try { await perform(action.controller.signal); succeeded = true; }
    catch { if (!action.controller.signal.aborted) setError(true); }
    if (action.controller.signal.aborted || pendingRef.current !== action) return;
    if (latestRevision.current > action.revision || succeeded && unchangedOnSuccess) {
      pendingRef.current = null;
      setPending(null);
      notify.current(false);
    } else {
      action.settled = true;
      setPending({ ...action });
    }
  };
  return { pending: pending !== null, error, run };
}

export function ApprovalBrowserAuthManual({ state, disabled, onAction, onPendingChange }: {
  state: ApprovalBrowserAuthManualState;
  disabled: boolean;
  onAction?: ApprovalBrowserAuthManualAction;
  onPendingChange(pending: boolean): void;
}) {
  const action = useHostAction(state.revision, onPendingChange);
  const run = (name: 'open' | 'back' | 'finish' | 'not-now') => {
    if (!disabled && onAction) void action.run(signal => onAction({ scope: state.scope, action: name, signal }));
  };
  const unavailable = disabled || action.pending || !onAction;
  return <section aria-label="Sign in on the website">
    {state.phase === 'available' && <button type="button" disabled={unavailable} onClick={() => run('open')}>Take over to sign in</button>}
    {state.phase === 'opening' && <p role="status">Opening the browser...</p>}
    {state.phase === 'active' && <>
      <h3>Let me know when you're done signing in</h3>
      <button type="button" disabled={unavailable} onClick={() => run('back')}>Back to sign in</button>
      <button type="button" disabled={unavailable} onClick={() => run('not-now')}>Not now</button>
      <button type="button" disabled={unavailable} onClick={() => run('finish')}>Done</button>
    </>}
    {state.phase === 'finishing' && <p role="status">Finishing sign-in...</p>}
    {state.phase === 'unknown' && <p role="alert">The browser sign-in result could not be confirmed.</p>}
    {action.pending && <p role="status">Waiting for the browser host...</p>}
    {action.error && <p role="alert">The browser host could not confirm this action.</p>}
  </section>;
}

export function ApprovalBrowserAuthPasswordManager({ state, disabled, onAction, onPendingChange }: {
  state: ApprovalBrowserAuthPasswordManagerState;
  disabled: boolean;
  onAction?: ApprovalBrowserAuthPasswordManagerAction;
  onPendingChange(pending: boolean): void;
}) {
  const action = useHostAction(state.revision, onPendingChange);
  const run = (name: 'start' | 'reopen' | 'back') => {
    if (!disabled && onAction) void action.run(signal => onAction({ scope: state.scope, provider: state.provider, action: name, signal }), name === 'reopen');
  };
  const unavailable = disabled || action.pending || !onAction;
  return <section aria-label="1Password sign-in">
    {state.phase === 'starting' && <p role="status">Requesting a login from 1Password...</p>}
    {state.phase === 'waiting' && <p role="status">Approve the login request in 1Password.</p>}
    {state.phase === 'denied' && <p role="alert">The login request was declined in 1Password.</p>}
    {state.phase === 'expired' && <p role="alert">The 1Password login request expired.</p>}
    {state.phase === 'failed' && <p role="alert">The 1Password login could not be requested.</p>}
    {state.phase === 'filling' && <p role="status">Completing private sign-in...</p>}
    {state.phase === 'unknown' && <p role="alert">The private sign-in result could not be confirmed.</p>}
    {(state.phase === 'available' || state.phase === 'denied' || state.phase === 'expired' || state.phase === 'failed')
      && <button type="button" disabled={unavailable} onClick={() => run('start')}>Fill with 1Password</button>}
    {state.phase === 'waiting' && <button type="button" disabled={unavailable} onClick={() => run('reopen')}>Open 1Password</button>}
    {state.phase !== 'available' && state.phase !== 'filling' && state.phase !== 'unknown'
      && <button type="button" disabled={unavailable} onClick={() => run('back')}>Use another method</button>}
    {action.pending && <p role="status">Waiting for the browser host...</p>}
    {action.error && <p role="alert">The browser host could not confirm this action.</p>}
  </section>;
}
