import { CodeXml, WrapText } from 'lucide-react';
import type { Token, Tokens } from 'marked';
import { createContext, createElement, Fragment, memo, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { rendererAssets } from '../native/renderer-assets.ts';
import { MessageCopy } from './message-copy.tsx';
import { workspaceOutputFromLink, type OutputFile } from './output-types.ts';
import { WorkspaceIcon } from './workspace-icon.tsx';
import './message-links.css';
import type { EditableImage } from './image-edit-model.ts';

export const WorkspaceOutputLinks = createContext<{ cwd: string; open(file: OutputFile): void; openPage?(url: string): void;
  openImages?(images: readonly EditableImage[], selectedId: string): void } | null>(null);
const StreamingMarkdown = createContext(false);

const languages: Record<string, string> = { sh: 'Bash', bash: 'Bash', shell: 'Bash', ts: 'TypeScript', typescript: 'TypeScript',
  js: 'JavaScript', javascript: 'JavaScript', py: 'Python', python: 'Python', json: 'JSON', css: 'CSS', html: 'HTML' };
const codeControl = 'inline-grid size-9 shrink-0 place-items-center rounded-full text-default leading-5 hover:bg-primary-ghost-hover focus-visible:ring-2 focus-visible:ring-ring';
type HighlightCode = (code: string, language: string) => { html: string; language: string };

function hasOpenFence(raw: string) {
  const open = /^ {0,3}(`{3,}|~{3,})/.exec(raw)?.[1];
  if (!open) return false;
  const tail = raw.trimEnd();
  const lastLine = tail.lastIndexOf('\n');
  const close = lastLine >= 0 ? /^ {0,3}(`{3,}|~{3,})$/.exec(tail.slice(lastLine + 1))?.[1] : undefined;
  return !close || close[0] !== open[0] || close.length < open.length;
}

function highlightedCode(highlight: HighlightCode, code: string, language: string): ReactNode {
  try {
    const result = highlight(code, language);
    if (result.language === 'plaintext') return code;
    const template = document.createElement('template');
    template.innerHTML = result.html;
    // Keep code as text and syntax spans. Never attach the parsed HTML to the page.
    function syntax(nodes: NodeListOf<ChildNode>): ReactNode {
      return Array.from(nodes, (node, index) => node instanceof HTMLSpanElement
        ? <span key={index} className={node.className}>{syntax(node.childNodes)}</span> : node.textContent);
    }
    return template.content.textContent === code ? syntax(template.content.childNodes) : code;
  } catch { return code; }
}

function CodeBlock({ token }: { token: Tokens.Code }) {
  const streaming = useContext(StreamingMarkdown);
  const [wrap, setWrap] = useState(false);
  const [highlight, setHighlight] = useState<HighlightCode>();
  const language = token.lang?.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? '';
  const name = (Object.hasOwn(languages, language) ? languages[language] : language) || 'Code';
  const canHighlight = !!language && token.text.length <= 64 * 1024;
  useEffect(() => {
    if (!canHighlight || highlight) return;
    let mounted = true;
    void import(rendererAssets.codeHighlighter).then((module: { highlightCode: HighlightCode }) => {
      if (mounted) setHighlight(() => module.highlightCode);
    }).catch(() => {});
    return () => { mounted = false; };
  }, [canHighlight, highlight]);
  const code = useMemo(() => highlight && canHighlight ? highlightedCode(highlight, token.text, language) : token.text,
    [highlight, canHighlight, token.text, language]);
  return <div className="yard-source-code _Root_fab4p_2 _CodeSurface_fab4p_2 _Surface_fab4p_2 _CodeBlock_1fgd0_2 relative w-full min-w-0 contain-inline-size overflow-clip rounded-(--radius-3xl-base) border border-subtle text-default"
    data-code-block="true" data-wrap={wrap}>
    <div className="flex items-center font-sans text-sm select-none _ActionBar_fab4p_2 min-h-12 gap-2 py-1.5 ps-4 pe-1.5 font-medium text-default md:ps-5">
      <CodeXml size={20} aria-hidden="true" className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <div className="flex items-center flex-wrap justify-end gap-px print:hidden" data-code-block-controls="true">
        <button className={codeControl} type="button" title={wrap ? 'Disable word wrap' : 'Enable word wrap'}
          aria-label={wrap ? 'Disable word wrap' : 'Enable word wrap'} aria-pressed={wrap} onClick={() => setWrap(value => !value)}>
          <WrapText size={16} aria-hidden="true" />
        </button>
        {(!streaming || !hasOpenFence(token.raw)) && <MessageCopy label="Copy code" text={token.text} className={codeControl} />}
      </div>
    </div>
    <div className="text-size-chat overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset _Source_fab4p_2 px-4 pt-0 pb-3 md:px-5"
      dir="ltr" data-code-block-source="true">
      <code className={'block text-size-code _CodeContent_113q4_1 ' + (wrap ? 'whitespace-pre-wrap!' : 'whitespace-pre!')}>{code}</code>
    </div>
  </div>;
}

function externalLink(raw: string) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:' ? url.href : undefined;
  } catch { return undefined; }
}

function markup(tokens: Token[]): ReactNode {
  return tokens.map((token, index) => <Fragment key={index}>{renderToken(token)}</Fragment>);
}

function MessageLink({ token }: { token: Tokens.Link }) {
  const workspace = useContext(WorkspaceOutputLinks);
  const href = externalLink(token.href);
  const file = !href && workspace?.cwd && workspaceOutputFromLink(token.href, workspace.cwd);
  const text = markup(token.tokens);
  const mention = (image?: boolean) => <span className="_Mention_a4hbb_2" data-appearance="inline-mention"
    data-font-weight="medium" data-layout="inline-flow" data-tone="accent" data-underline-on-hover="">
    {image !== undefined && <span className="_IconContainer_a4hbb_2 _SlotSizedIconContainer_a4hbb_2">
      <WorkspaceIcon name={image ? 'messageImage' : 'messageFile'} className="_Icon_a4hbb_2 _SlotSizedIcon_a4hbb_2" />
    </span>}
    <span className="_Label_a4hbb_2">{text}</span>
  </span>;
  if (href) return <a className="yard-source-message-link _ExternalMarkdownLink_1fgd0_2 _InlineMentionFocusRing_1fgd0_2"
    data-inline-mention-interactive="" href={href} target="_blank" rel="noopener noreferrer" title={token.title ?? undefined}
    onClick={event => {
      if (!workspace?.openPage || !/^https?:/.test(href) || event.defaultPrevented || event.button !== 0 ||
          event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); workspace.openPage(href);
    }}>
    {mention()}
  </a>;
  if (file && workspace) return <span role="button" tabIndex={0}
    className="yard-source-message-file-link yard-source-message-link _InlineMentionFocusRing_1fgd0_2"
    data-inline-mention-interactive="" data-file-reference="true" title={file.name}
    onKeyDown={event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); workspace.open(file); }
    }} onClick={() => workspace.open(file)}>{mention(file.preview === 'image')}</span>;
  return <span>{text}</span>;
}

function renderToken(token: Token): ReactNode {
  switch (token.type) {
    case 'space': return null;
    case 'paragraph': return <p className="_Paragraph_1fgd0_2" dir="auto">{markup((token as Tokens.Paragraph).tokens)}</p>;
    case 'heading': {
      const heading = token as Tokens.Heading;
      return createElement('h' + heading.depth, { dir: 'auto', className: '_Heading_1fgd0_2' }, markup(heading.tokens));
    }
    case 'text': {
      const text = token as Tokens.Text;
      return text.tokens?.length ? markup(text.tokens) : text.text;
    }
    case 'escape': return (token as Tokens.Escape).text;
    case 'strong': return <strong className="font-semibold">{markup((token as Tokens.Strong).tokens)}</strong>;
    case 'em': return <em>{markup((token as Tokens.Em).tokens)}</em>;
    case 'del': return <del>{markup((token as Tokens.Del).tokens)}</del>;
    case 'codespan': return <code>{(token as Tokens.Codespan).text}</code>;
    case 'code': return <CodeBlock token={token as Tokens.Code} />;
    case 'br': return <br />;
    case 'hr': return <hr />;
    case 'blockquote': return <blockquote className="_Blockquote_1fgd0_2">{markup((token as Tokens.Blockquote).tokens)}</blockquote>;
    case 'list': {
      const list = token as Tokens.List;
      const children = list.items.map((item, index) => <li key={index} className="_ListItem_1fgd0_2">{markup(item.tokens)}</li>);
      return list.ordered ?
        <ol className="_List_1fgd0_2 _OrderedList_1fgd0_2" dir="auto" start={typeof list.start === 'number' ? list.start : undefined}>{children}</ol> :
        <ul className="_List_1fgd0_2 _UnorderedList_1fgd0_2" dir="auto">{children}</ul>;
    }
    case 'checkbox': return <input aria-label="Task" type="checkbox" disabled checked={(token as Tokens.Checkbox).checked} readOnly />;
    case 'link': return <MessageLink token={token as Tokens.Link} />;
    case 'image': return <span>{(token as Tokens.Image).text}</span>;
    case 'table': {
      const table = token as Tokens.Table;
      return <div className="yard-source-table-scroll"><table>
        <thead><tr>{table.header.map((cell, index) => <th key={index} style={{ textAlign: cell.align ?? undefined }}>{markup(cell.tokens)}</th>)}</tr></thead>
        <tbody>{table.rows.map((row, index) => <tr key={index}>{row.map((cell, index) =>
          <td key={index} style={{ textAlign: cell.align ?? undefined }}>{markup(cell.tokens)}</td>)}</tr>)}</tbody>
      </table></div>;
    }
    // React escapes unsupported HTML; model output never becomes live markup.
    default: return token.raw;
  }
}

export const MessageMarkdown = memo(function MessageMarkdown({ text, lex, streaming }: {
  text: string; lex(text: string): Token[]; streaming: boolean;
}) {
  const tokens = useMemo(() => lex(text), [lex, text]);
  return <StreamingMarkdown value={streaming}>{markup(tokens)}</StreamingMarkdown>;
});
