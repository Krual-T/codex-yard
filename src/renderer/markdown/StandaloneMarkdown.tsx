import { Children, isValidElement, useEffect, useId, useMemo, useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { Check, Clipboard, Code2, Eye, File, PanelTop, Table2 } from 'lucide-react';
import Markdown from 'react-markdown';
import type { Components, UrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import type { StandaloneMessagesProps, WorkbenchClient } from '../workbench-contract.ts';
import { writeClipboardText } from '../../native/browser-clipboard.ts';
import { MessageImage } from '../messages/MessageImage.tsx';
import { resolveFileLocation, resolveToolFileLocation, safeExternalUrl } from '../messages/message-data.ts';
import type { ImageSource } from '../messages/message-data.ts';
import { remarkVisualizations } from './visualization-directives.ts';
import { normalizeFileCitationEscapes, remarkFileCitations } from './file-citations.ts';
import type { LiveCitationTarget } from './file-citations.ts';

const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), ['dataYardVisualization', 'directive'], ['dataYardArtifact', 'directive']],
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-./, 'math-inline', 'math-display']],
    input: [...(defaultSchema.attributes?.input ?? []), 'checked'],
    ul: [...(defaultSchema.attributes?.ul ?? []), ['className', 'contains-task-list']],
    li: [...(defaultSchema.attributes?.li ?? []), ['className', 'task-list-item']],
  },
  protocols: { ...defaultSchema.protocols, href: [...(defaultSchema.protocols?.href ?? []), 'yard-visualization', 'yard-artifact'], src: ['http', 'https', 'data'] },
};

const remarkPlugins: NonNullable<ComponentProps<typeof Markdown>['remarkPlugins']> = [remarkGfm, remarkMath, remarkFileCitations, remarkVisualizations];
type RehypePlugins = NonNullable<ComponentProps<typeof Markdown>['rehypePlugins']>;
const safeHtmlPlugins: RehypePlugins = [rehypeRaw, [rehypeSanitize, schema], rehypeKatex, rehypeHighlight];
const textHtmlPlugins: RehypePlugins = [rehypeKatex, rehypeHighlight];

function textContent(node: ReactNode): string {
  return Children.toArray(node).map((child) => {
    if (typeof child === 'string' || typeof child === 'number') return String(child);
    return isValidElement<{ children?: ReactNode }>(child) ? textContent(child.props.children) : '';
  }).join('');
}

function MermaidDiagram({ source }: { source: string }) {
  const id = `yard-mermaid-${useId().replace(/[^a-z\d-]/gi, '')}`;
  const [rendered, setRendered] = useState<{ source: string; svg?: string; error?: string }>({ source: '' });
  useEffect(() => {
    let active = true;
    setRendered({ source });
    void import('mermaid').then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true });
      return mermaid.render(id, source);
    }).then(({ svg }) => { if (active) setRendered({ source, svg }); }, (error: unknown) => {
      if (active) setRendered({ source, error: error instanceof Error ? error.message : 'Diagram could not be rendered.' });
    });
    return () => { active = false; };
  }, [id, source]);
  if (rendered.source !== source || (!rendered.svg && !rendered.error)) return <div className="yard-code-loading" role="status">Rendering diagram...</div>;
  if (rendered.error) return <div className="yard-code-error" role="status">{rendered.error}</div>;
  return <div className="yard-mermaid" dangerouslySetInnerHTML={{ __html: rendered.svg ?? '' }} />;
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [showSource, setShowSource] = useState(false);
  const code = Children.toArray(children).find((child) => isValidElement<{ className?: string }>(child));
  const className = isValidElement<{ className?: string }>(code) ? code.props.className ?? '' : '';
  const language = /(?:^|\s)language-([^\s]+)/.exec(className)?.[1] ?? '';
  const renderedSource = textContent(children);
  const source = renderedSource.replace(/\n$/, '');
  const isDiagram = language.toLowerCase() === 'mermaid';
  async function copy() {
    try {
      await writeClipboardText(source);
      setCopied(true);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Copy failed.');
    }
  }
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return <div className="yard-code-block" data-markdown-copy="code-block" data-markdown-copy-text={renderedSource} data-markdown-copy-language={language}>
    <div className="yard-code-toolbar" data-markdown-copy="exclude"><span>{language || 'Code'}</span><div>
      {isDiagram && <button type="button" className="yard-icon-button" title={showSource ? 'Show diagram' : 'Show source'}
        aria-label={showSource ? 'Show diagram' : 'Show source'} onClick={() => setShowSource((value) => !value)}>
        {showSource ? <Eye size={16} /> : <Code2 size={16} />}</button>}
      <button type="button" className="yard-icon-button" title={copied ? 'Copied' : 'Copy code'}
        aria-label={copied ? 'Copied' : 'Copy code'} onClick={() => void copy()}>{copied ? <Check size={16} /> : <Clipboard size={16} />}</button>
    </div></div>
    {isDiagram && !showSource ? <MermaidDiagram source={source} /> : <pre dir="ltr">{children}</pre>}
    {error && <div className="yard-code-error" role="alert">{error}</div>}
  </div>;
}

export type StandaloneMarkdownProps = {
  text: string;
  client: WorkbenchClient;
  hostId: string;
  threadId?: string;
  cwd: string;
  allowBasicHtml?: boolean;
  onOpenFile?: (path: string) => void;
  onOpenFileAt?: StandaloneMessagesProps['onOpenFileAt'];
  onOpenVisualization?: StandaloneMessagesProps['onOpenVisualization'];
  onOpenBrowser?: StandaloneMessagesProps['onOpenBrowser'];
  onOpenArtifactCitation?: (target: LiveCitationTarget) => void;
  onOpenImage?: (image: ImageSource) => void;
};

function safeBrowserUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password;
  } catch { return false; }
}

function GoogleDocumentLinkIcon({ url }: { url: string }) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'docs.google.com' || !/^\/(?:document|spreadsheets|presentation)\/d\/[^/]+(?:\/|$)/.test(parsed.pathname)) return null;
  } catch { return null; }
  return <svg className="yard-markdown-file-icon" width="13" height="13" viewBox="0 0 84 72"
    aria-hidden="true" focusable="false" data-markdown-copy="exclude">
    <path fill="#0f9d58" d="M28 0 42 24 14 72 0 48Z" />
    <path fill="#fbbc04" d="M28 0H56L84 48H56Z" />
    <path fill="#4285f4" d="M14 72 28 48H84L70 72Z" />
  </svg>;
}

export function StandaloneMarkdown({ text, client, hostId, threadId, cwd, allowBasicHtml = false, onOpenFile, onOpenFileAt, onOpenVisualization, onOpenBrowser, onOpenArtifactCitation, onOpenImage }: StandaloneMarkdownProps) {
  const markdownText = useMemo(() => normalizeFileCitationEscapes(text), [text]);
  const components = useMemo<Components>(() => ({
    pre: CodeBlock,
    a: ({ href, children, node }) => {
      if (!href) return <span>{children}</span>;
      if (href.startsWith('yard-artifact:')) {
        // Only the directive transformer may create this action; raw HTML and ordinary links retain positions.
        if (node?.properties?.dataYardArtifact !== 'directive' || node.position) return <span>{children}</span>;
        let target: LiveCitationTarget;
        try { target = JSON.parse(decodeURIComponent(href.slice('yard-artifact:'.length))) as LiveCitationTarget; }
        catch { return <span>{children}</span>; }
        const Icon = target.kind === 'spreadsheet' ? Table2 : PanelTop;
        const icon = <Icon className="yard-markdown-file-icon" size={13} strokeWidth={1.5} aria-hidden="true"
          style={{ color: target.kind === 'spreadsheet' ? '#00a347' : '#f05c2f' }} />;
        return onOpenArtifactCitation
          ? <button type="button" className="yard-file-link yard-markdown-file-link" onClick={() => onOpenArtifactCitation(target)}>{icon}{children}</button>
          : <span className="yard-markdown-file-link">{icon}{children}</span>;
      }
      if (href.startsWith('yard-visualization:')) {
        // Generated visualization links have no source position; raw HTML retains one.
        if (node?.properties?.dataYardVisualization !== 'directive' || node.position) return <span>{children}</span>;
        let path = '';
        try { path = decodeURIComponent(href.slice('yard-visualization:'.length)); } catch { return <span>{children}</span>; }
        if (!path.trim()) return <span>{children}</span>;
        if (!threadId || !onOpenVisualization) return <span>Visualization: {path}</span>;
        return <button type="button" className="yard-file-link" onClick={() => onOpenVisualization({ hostId, threadId, path: resolveToolFileLocation(path, cwd, hostId).path })}>{children}</button>;
      }
      const external = safeExternalUrl(href);
      if (external) return <a href={external} target={external.startsWith('#') ? undefined : '_blank'}
        rel={external.startsWith('#') ? undefined : 'noreferrer noopener'} onClick={event => {
          if (!threadId?.trim() || !onOpenBrowser || !safeBrowserUrl(external) || event.defaultPrevented || event.button !== 0
            || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          onOpenBrowser({ hostId, threadId, url: external, source: 'link' });
        }}><GoogleDocumentLinkIcon url={external} />{children}</a>;
      if (!onOpenFile && !onOpenFileAt) return <span>{children}</span>;
      return <button type="button" className="yard-file-link yard-markdown-file-link" onClick={() => {
        const location = resolveFileLocation(href, cwd, hostId);
        const encodedPath = href.replace(/#L[1-9]\d*(?:C[1-9]\d*)?(?:-L[1-9]\d*(?:C[1-9]\d*)?)?$/i, '');
        try {
          const decodedPath = decodeURIComponent(encodedPath);
          if (/^(?:[a-z]:[\\/]|\\\\)/i.test(decodedPath)) location.path = resolveToolFileLocation(decodedPath, cwd, hostId).path;
        } catch { /* resolveFileLocation preserves malformed links */ }
        if (onOpenFileAt) onOpenFileAt(location); else onOpenFile?.(location.path);
      }}><File className="yard-markdown-file-icon" size={13} strokeWidth={1.5} aria-hidden="true" />{children}</button>;
    },
    img: ({ src, alt }) => {
      if (typeof src !== 'string' || !src) return <span>Image unavailable</span>;
      const source: ImageSource = { kind: /^(?:https?:|data:)/i.test(src) ? 'url' : 'path', value: src, label: alt || 'Image' };
      return <MessageImage source={source} client={client} hostId={hostId} cwd={cwd} onOpen={onOpenImage ? () => onOpenImage(source) : undefined} />;
    },
  }), [client, cwd, hostId, threadId, onOpenFile, onOpenFileAt, onOpenVisualization, onOpenBrowser, onOpenArtifactCitation, onOpenImage]);
  const transformUrl: UrlTransform = (value, _key) => {
    const trimmed = value.trim();
    if (_key === 'href' && (trimmed.startsWith('yard-visualization:') || trimmed.startsWith('yard-artifact:'))) return trimmed;
    if (/^(?:https?:|mailto:|data:|#)/i.test(trimmed)) return safeExternalUrl(trimmed, _key === 'src') ?? '';
    if (/^(?:file:\/\/|\/|\.\.?\/)/i.test(trimmed) || !/^[a-z][a-z\d+.-]*:/i.test(trimmed)) return trimmed;
    return '';
  };
  return <div className="yard-markdown"><Markdown remarkPlugins={remarkPlugins}
    rehypePlugins={allowBasicHtml ? safeHtmlPlugins : textHtmlPlugins} urlTransform={transformUrl} components={components}>{markdownText}</Markdown></div>;
}
