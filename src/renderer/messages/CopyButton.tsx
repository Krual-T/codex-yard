import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { writeClipboardText } from '../../native/browser-clipboard.ts';
import { writeMessageClipboard } from './message-copy.ts';
import type { MessageCopyContent } from './message-copy.ts';

export function CopyButton({ text, label, content }: { text: string; label: string; content?: () => MessageCopyContent }) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = window.setTimeout(() => setState('idle'), 2500);
    return () => window.clearTimeout(timer);
  }, [state]);
  async function copy() {
    try {
      if (content) await writeMessageClipboard(content());
      else await writeClipboardText(text);
      setState('copied');
    } catch {
      setState('error');
    }
  }
  const description = state === 'copied' ? 'Copied' : state === 'error' ? 'Copy failed' : label;
  return <button type="button" className="yard-icon-button" aria-label={description} title={description} onClick={() => void copy()}>
    {state === 'copied' ? <Check size={14} /> : <Copy size={14} />}
    <span className="yard-screen-reader" role="status">{state === 'error' ? 'Copy failed' : ''}</span>
  </button>;
}
