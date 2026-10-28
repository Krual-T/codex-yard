import { useEffect, useState } from 'react';
import { Check, Clipboard } from 'lucide-react';

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = window.setTimeout(() => setState('idle'), 2500);
    return () => window.clearTimeout(timer);
  }, [state]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('error');
    }
  }
  const description = state === 'copied' ? 'Copied' : state === 'error' ? 'Copy failed' : label;
  return <button type="button" className="yard-icon-button" aria-label={description} title={description} onClick={() => void copy()}>
    {state === 'copied' ? <Check size={16} /> : <Clipboard size={16} />}
    <span className="yard-screen-reader" role="status">{state === 'error' ? 'Copy failed' : ''}</span>
  </button>;
}
