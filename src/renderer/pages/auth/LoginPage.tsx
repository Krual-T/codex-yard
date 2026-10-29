import { useEffect, useRef, useState } from 'react';
import type { WorkbenchClient, WorkbenchEvent } from '../../workbench-contract.ts';
import { cancelLogin, readAccount, readLoginMethods, startLogin } from './auth.ts';
import type { LoginAttempt, LoginMethods } from './auth.ts';
import './login.css';

export interface LoginPageProps {
  client: WorkbenchClient;
  hostId: string;
  onAuthenticated(): void | Promise<void>;
}

type PendingAttempt = { id?: string; early: { id: string; success: boolean; error: string | null }[] };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function LoginPage(props: LoginPageProps) {
  return <LoginScope key={props.hostId} {...props} />;
}

function LoginScope({ client, hostId, onAuthenticated }: LoginPageProps) {
  const [methods, setMethods] = useState<LoginMethods | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState<Exclude<LoginAttempt, { type: 'apiKey' }> | null>(null);
  const [other, setOther] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [needsAccountCheck, setNeedsAccountCheck] = useState(false);
  const [revision, setRevision] = useState(0);
  const alive = useRef(false);
  const pending = useRef<PendingAttempt | null>(null);
  const authCallback = useRef(onAuthenticated);
  authCallback.current = onAuthenticated;

  useEffect(() => { alive.current = true; return () => { alive.current = false; pending.current = null; }; }, []);
  useEffect(() => {
    let current = true;
    setLoading(true); setError(null); setMethods(null);
    void (async () => {
      const account = await readAccount(client, hostId);
      if (!current) return;
      if (account.authenticated) { await authCallback.current(); return; }
      const allowed = await readLoginMethods(client, hostId);
      if (current) { setMethods(allowed); setNeedsAccountCheck(false); }
    })().catch(cause => { if (current) setError(`Could not check sign-in: ${message(cause)}`); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [client, hostId, revision]);

  const confirmAccount = async () => {
    const account = await readAccount(client, hostId);
    if (!alive.current) return;
    if (!account.authenticated) throw new Error('Sign-in has not completed');
    await authCallback.current();
  };
  const finish = async (owner: PendingAttempt, success: boolean, errorText: string | null) => {
    if (pending.current !== owner) return;
    pending.current = null; setAttempt(null);
    if (!success) { setError(errorText || 'Sign-in did not complete.'); setBusy(false); return; }
    setBusy(true);
    try { await confirmAccount(); }
    catch (cause) { if (alive.current) { setNeedsAccountCheck(true); setError(`Could not confirm sign-in: ${message(cause)}`); } }
    finally { if (alive.current) setBusy(false); }
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => client.subscribe((event: WorkbenchEvent) => {
    if (event.type !== 'mcp-notification' || event.hostId !== hostId || event.method !== 'account/login/completed') return;
    const value = event.params;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const data = value as Record<string, unknown>;
    if (typeof data.loginId !== 'string' || typeof data.success !== 'boolean') return;
    const owner = pending.current;
    if (!owner) return;
    const completion = { id: data.loginId, success: data.success, error: typeof data.error === 'string' ? data.error : null };
    if (!owner.id && owner.early.length < 20) owner.early.push(completion);
    else if (owner.id === completion.id) void finishRef.current(owner, completion.success, completion.error);
  }), [client, hostId]);

  const start = async (mode: 'chatgpt' | 'chatgptDeviceCode' | 'apiKey') => {
    if (pending.current || busy || needsAccountCheck || mode === 'apiKey' && !apiKey.trim()) return;
    const owner: PendingAttempt = { early: [] }; pending.current = owner;
    setBusy(true); setError(null);
    try {
      const result = await startLogin(client, hostId, mode === 'apiKey' ? { type: 'apiKey', apiKey: apiKey.trim() } : { type: mode });
      if (!alive.current || pending.current !== owner) return;
      if (result.type === 'apiKey') {
        pending.current = null; setApiKey(''); await confirmAccount();
      } else {
        owner.id = result.loginId; setAttempt(result);
        const completed = owner.early.find(item => item.id === result.loginId);
        if (completed) await finish(owner, completed.success, completed.error);
      }
    } catch (cause) {
      if (alive.current && pending.current === owner) {
        pending.current = null; setNeedsAccountCheck(true); setError(`Could not start sign-in: ${message(cause)}. Check the account before trying again.`);
      } else if (alive.current && !pending.current) { setNeedsAccountCheck(true); setError(`Could not confirm sign-in: ${message(cause)}`); }
    } finally { if (alive.current) setBusy(false); }
  };
  const cancel = async () => {
    const owner = pending.current;
    if (!owner?.id || busy) return;
    setBusy(true); setError(null);
    try {
      const status = await cancelLogin(client, hostId, owner.id);
      if (!alive.current || pending.current !== owner) return;
      pending.current = null; setAttempt(null);
      if (status === 'notFound') {
        try { await confirmAccount(); } catch (cause) { if (alive.current) { setNeedsAccountCheck(true); setError(`Could not confirm sign-in: ${message(cause)}`); } }
      }
    } catch (cause) { if (alive.current && pending.current === owner) setError(`Could not cancel sign-in: ${message(cause)}`); }
    finally { if (alive.current) setBusy(false); }
  };

  return <main className="yard-login"><div className="yard-login-content">
    <img src="/brand/icon.svg" width="42" height="42" alt="" />
    <h1>Sign in to Codex</h1>
    {loading && <p role="status">Checking sign-in...</p>}
    {error && <div className="yard-login-error" role="alert"><p>{error}</p></div>}
    {busy && !attempt && <p role="status">Starting sign-in...</p>}
    {attempt && <section aria-label="Sign-in in progress">
      <p>Continue in your browser, then return here.</p>
      {attempt.type === 'chatgptDeviceCode' && <p>Enter code <strong className="yard-login-code">{attempt.userCode}</strong></p>}
      <a className="yard-login-primary" href={attempt.url} target="_blank" rel="noopener noreferrer">Open sign-in</a>
      <button type="button" disabled={busy} onClick={() => void cancel()}>Cancel sign-in</button>
    </section>}
    {!loading && !attempt && methods && <div className="yard-login-actions">
      {methods.chatgpt && <button className="yard-login-primary" type="button" disabled={busy || needsAccountCheck} onClick={() => void start('chatgpt')}>Continue with ChatGPT</button>}
      {methods.chatgpt && <button type="button" disabled={busy || needsAccountCheck} onClick={() => void start('chatgptDeviceCode')}>Use device code</button>}
      {methods.api && !other && <button type="button" disabled={busy || needsAccountCheck} onClick={() => setOther(true)}>Enter API key</button>}
      {methods.api && other && <form onSubmit={event => { event.preventDefault(); void start('apiKey'); }}>
        <label>API key<input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} autoComplete="off" spellCheck={false} /></label>
        <button type="submit" disabled={busy || needsAccountCheck || !apiKey.trim()}>Continue</button>
        <button type="button" disabled={busy} onClick={() => { setOther(false); setApiKey(''); }}>Back</button>
      </form>}
      {!methods.api && !methods.chatgpt && <p>Your administrator has disabled the available sign-in methods.</p>}
    </div>}
    <p className="yard-login-help">You can also sign in on the selected machine with <code>codex login</code>, then check the account.</p>
    {!attempt && <button type="button" disabled={loading || busy} onClick={() => setRevision(value => value + 1)}>Check account</button>}
  </div></main>;
}
