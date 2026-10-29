import { useEffect, useRef, useState } from 'react';
import { Bot, CheckCircle2, Cloud, ListTodo } from 'lucide-react';
import type { WorkbenchClient } from '../../workbench-contract.ts';
import { completeFirstRun } from './first-run.ts';
import type { FirstRunVariant } from './first-run.ts';
import './first-run.css';

export interface FirstRunPageProps {
  client: WorkbenchClient;
  hostId: string;
  authMethod: 'chatgpt' | 'apiKey' | 'copilot' | 'other';
  variant: FirstRunVariant;
  onContinue(): void | Promise<void>;
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function FirstRunPage(props: FirstRunPageProps) {
  return <FirstRunScope key={JSON.stringify([props.hostId, props.authMethod, props.variant])} {...props} />;
}

function FirstRunScope({ client, hostId, authMethod, variant, onContinue }: FirstRunPageProps) {
  const hasCloudAccess = authMethod === 'chatgpt';
  const [step, setStep] = useState(variant === 'chatgpt' || variant === 'none' && hasCloudAccess ? 0 : 3);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(false);
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { heading.current?.focus(); }, [step]);
  const proceed = async () => {
    if (inFlight.current) return;
    if (step < 3) { setStep(value => value + 1); return; }
    inFlight.current = true; setSaving(true); setError(null);
    try {
      const completed = await completeFirstRun(client, hostId, variant, () => alive.current);
      if (completed && alive.current) await onContinue();
    } catch (cause) { if (alive.current) setError(`Could not continue: ${message(cause)}`); }
    finally { inFlight.current = false; if (alive.current) setSaving(false); }
  };
  const steps = [
    { title: 'Codex in your IDE', text: 'Codex navigates, edits, runs commands, and executes tests in your repository.', Icon: Bot },
    { title: 'Hand off to Codex in the cloud', text: 'Send tasks to Codex to run in the background.', Icon: Cloud },
    { title: 'Turn TODOs into Codex tasks', text: 'Convert a TODO comment into a Codex task.', Icon: ListTodo },
  ];
  const item = steps[step];
  return <main className="yard-first-run"><div className="yard-first-run-content">
    <img src="/brand/icon.svg" width="42" height="42" alt="" />
    {item ? <><item.Icon className="yard-first-run-illustration" size={44} aria-hidden="true" />
      <h1 ref={heading} tabIndex={-1}>{item.title}</h1><p>{item.text}</p></> : <>
      <h1 ref={heading} tabIndex={-1}>Before you continue</h1>
      <ul><li><CheckCircle2 size={19} aria-hidden="true" /><span><strong>Decide how much autonomy you want to grant</strong><br />Choose the permissions appropriate for each task.</span></li>
        <li><CheckCircle2 size={19} aria-hidden="true" /><span><strong>Codex can make mistakes</strong><br />Review the code it writes and commands it runs.</span></li>
        {authMethod === 'chatgpt' && <li><CheckCircle2 size={19} aria-hidden="true" /><span><strong>Powered by your ChatGPT account</strong><br />Uses your plan's rate limits and data preferences.</span></li>}
        {authMethod === 'copilot' && <li><CheckCircle2 size={19} aria-hidden="true" /><span><strong>Powered by GitHub Copilot</strong><br />Uses your Copilot plan for model calls, billing, and rate limits.</span></li>}</ul>
    </>}
    {error && <p className="yard-first-run-error" role="alert">{error}</p>}
    <div className="yard-first-run-actions">{hasCloudAccess && <button type="button" disabled={saving || step === 0} onClick={() => setStep(value => Math.max(0, value - 1))}>Back</button>}
      <button type="button" className="yard-first-run-primary" disabled={saving} onClick={() => void proceed()}>{saving ? 'Saving...' : hasCloudAccess && step < 3 ? 'Next' : 'Continue'}</button></div>
  </div></main>;
}
