import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { writeClipboardText } from '../native/browser-clipboard.ts';

export function MessageCopy({ label, text, className = 'yard-source-message-icon', messageAction = false }: {
  label: string; text: string; className?: string; messageAction?: boolean;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<number | undefined>(undefined);
  const hint = state === 'copied' ? 'Copied' : label;
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return <>
    <button type="button" title={messageAction ? undefined : hint} aria-label={messageAction ? hint : label} className={className}
      data-message-hint={messageAction ? hint : undefined} data-message-action={messageAction ? 'copy' : undefined}
      onClick={async event => {
        if (messageAction && state === 'copied') return;
        const button = event.currentTarget;
        const outcome = await writeClipboardText(text).then(() => 'copied' as const, () => 'failed' as const);
        if (!button.isConnected) return;
        setState(outcome);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setState('idle'), 1600);
      }}>
      {state === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
    </button>
    {state !== 'idle' && <span role="status" className="sr-only">{state === 'copied' ? 'Copied' : 'Copy failed'}</span>}
  </>;
}
