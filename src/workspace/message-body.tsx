import { lazy, Suspense } from 'react';
import { loadMessageReader } from './load-message-reader.ts';
import { MessageMarkdown } from './message-markdown.tsx';

function PlainMessage({ text }: { text: string }) {
  return <p className="_Paragraph_1fgd0_2" dir="auto">{text}</p>;
}

const Markdown = lazy(async () => {
  try {
    const { lexMessage } = await loadMessageReader();
    return { default: ({ text, streaming }: { text: string; streaming: boolean }) => <MessageMarkdown text={text} lex={lexMessage} streaming={streaming} /> };
  } catch { return { default: PlainMessage }; }
});
const markdownSyntax = /(^|\n)(?: {0,3}(?:#{1,6}\s|[-+*>]\s|\d+[.)]\s|```|~~~|\|.+|---\s*$)| {4}\S)|[*_`~\[<]|https?:\/\//m;

export function MessageBody({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const plain = <PlainMessage text={text} />;
  return <div className="yard-source-message-markdown _MarkdownRoot_1fgd0_2" data-markdown-text-style="assistant-message" dir="auto">
    {markdownSyntax.test(text) ? <Suspense fallback={plain}><Markdown text={text} streaming={streaming} /></Suspense> : plain}
  </div>;
}
