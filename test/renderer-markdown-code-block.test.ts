import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transform } from 'esbuild';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  CodeSnippetProps,
  MarkdownCodeBlockDependencies,
  MarkdownCodeBlockProps,
  MermaidDiagramProps,
  WritingBlockProps,
} from '../src/renderer/markdown/code-block.tsx';
import type { MermaidLoadingPlaceholderDependencies } from '../src/renderer/markdown/mermaid-placeholder.tsx';

async function loadComponent(path: URL) {
  const { code } = await transform(await readFile(path, 'utf8'), { loader: 'tsx', format: 'esm', jsx: 'transform' });
  assert.doesNotMatch(code, /react\/jsx-runtime/);
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

const { createMarkdownCodeBlockComponent } = await loadComponent(
  new URL('../src/renderer/markdown/code-block.tsx', import.meta.url),
) as typeof import('../src/renderer/markdown/code-block.tsx');
const { createMermaidLoadingPlaceholderComponent } = await loadComponent(
  new URL('../src/renderer/markdown/mermaid-placeholder.tsx', import.meta.url),
) as typeof import('../src/renderer/markdown/mermaid-placeholder.tsx');

function fixture() {
  const preview = React.createContext(false);
  let snippet: CodeSnippetProps | undefined;
  let writing: WritingBlockProps | undefined;
  let diagram: MermaidDiagramProps | undefined;
  const dependencies: MarkdownCodeBlockDependencies = {
    useLanguageLabel: language => language === 'ts' ? 'TypeScript' : undefined,
    CodeBlockPreviewContext: preview,
    DefaultCodeSnippet: props => { snippet = props; return React.createElement('code', { 'data-snippet': '' }, props.content); },
    MermaidPlaceholder: ({ isStreaming }) => React.createElement('span', { 'data-streaming': String(!!isStreaming) }),
    isMermaidDiagram: language => language === 'mermaid',
    isDeferredCodeBlock: content => content === 'deferred',
    styles: { CodeBlock: 'code-block', CodeBlockPlaceholder: 'code-placeholder' },
  };
  const Component = createMarkdownCodeBlockComponent(React, dependencies);
  const WritingBlock = (props: WritingBlockProps) => { writing = props; return React.createElement('p', null, props.content); };
  const MermaidDiagram = (props: MermaidDiagramProps) => { diagram = props; return React.createElement('p', null, props.code); };
  const render = (props: MarkdownCodeBlockProps, isPreview = false): {
    markup: string;
    snippet: CodeSnippetProps | undefined;
    writing: WritingBlockProps | undefined;
    diagram: MermaidDiagramProps | undefined;
  } => {
    snippet = undefined;
    writing = undefined;
    diagram = undefined;
    const markup = renderToStaticMarkup(React.createElement(preview.Provider, { value: isPreview }, React.createElement(Component, props)));
    return { markup, snippet, writing, diagram };
  };
  return { render, WritingBlock, MermaidDiagram };
}

test('dispatches code, preview and open fences with the original wrapping and copy props', () => {
  const { render } = fixture();
  const normal = render({ content: 'const x = 1', language: 'ts', stickyHeader: true });
  assert.match(normal.markup, /const x = 1/);
  assert.equal(normal.snippet?.title, 'TypeScript');
  assert.equal(normal.snippet?.language, 'ts');
  assert.equal(normal.snippet?.codeBlockWordWrap, 'user-controlled');
  assert.equal(normal.snippet?.shouldWrapCode, false);
  assert.equal(normal.snippet?.allowPreview, true);
  assert.equal(normal.snippet?.showCopyButton, true);
  assert.equal(normal.snippet?.stickyHeader, true);
  assert.equal(normal.snippet?.deferEnhancementsUntilVisible, true);
  assert.equal(render({ content: 'x', forceCodeBlockWordWrap: true }).snippet?.codeBlockWordWrap, 'always');

  const open = render({ content: 'partial', isCodeFenceOpen: true, stickyHeader: true }, true);
  assert.equal(open.snippet?.title, '');
  assert.equal(open.snippet?.language, 'plaintext');
  assert.equal(open.snippet?.variant, 'preview');
  assert.equal(open.snippet?.codeBlockWordWrap, 'off');
  assert.equal(open.snippet?.allowPreview, false);
  assert.equal(open.snippet?.showCopyButton, false);
  assert.equal(open.snippet?.stickyHeader, false);
});

test('keeps deferred, writing and Mermaid content and copy markers intact', () => {
  const { render, WritingBlock, MermaidDiagram } = fixture();
  const deferred = render({ content: 'deferred', language: 'ts' });
  assert.match(deferred.markup, /data-markdown-copy="code-block"/);
  assert.match(deferred.markup, /data-markdown-copy-text="deferred"/);
  assert.match(deferred.markup, /<pre class="code-placeholder"><code>deferred<\/code><\/pre>/);
  assert.equal(deferred.snippet, undefined);
  assert.equal(render({ content: 'deferred', renderImmediately: true }).snippet?.content, 'deferred');

  const addSelection = () => {};
  const writing = render({ content: 'draft', language: 'markdown', isCodeFenceOpen: true, renderImmediately: true, writingBlock: WritingBlock, onAddSelectedTextToChat: addSelection });
  assert.equal(writing.writing?.showCopyButton, false);
  assert.equal(writing.writing?.onAddSelectedTextToChat, addSelection);
  assert.equal(writing.snippet, undefined);

  const streaming = render({ content: 'graph TD', language: 'mermaid', isCodeFenceOpen: true, mermaidDiagram: MermaidDiagram });
  assert.match(streaming.markup, /data-markdown-copy="exclude"/);
  assert.match(streaming.markup, /data-streaming="true"/);
  assert.match(streaming.markup, /data-markdown-copy-text="```mermaid\ngraph TD\n```"/);
  const complete = render({ content: 'graph TD', language: 'mermaid', mermaidDiagram: MermaidDiagram, allowWideBlocks: true, renderImmediately: true });
  assert.equal(complete.diagram?.code, 'graph TD');
  assert.equal(complete.diagram?.wideBlockKind, 'mermaid');
  const fallback = complete.diagram?.fallback as React.ReactElement<CodeSnippetProps>;
  assert.equal(fallback.props.language, 'plaintext');
  assert.equal(fallback.props.content, 'graph TD');
});

test('uses accessible, localized Mermaid loading and streaming placeholders', () => {
  const dependencies: MermaidLoadingPlaceholderDependencies = {
    useIntl: () => ({ formatMessage: ({ defaultMessage }) => defaultMessage }),
    Skeleton: ({ variant, ...props }) => React.createElement('div', { ...props, 'data-variant': variant }),
    ShimmeringStatus: ({ message }) => React.createElement('span', null, message),
    FormattedMessage: ({ defaultMessage }) => React.createElement(React.Fragment, null, defaultMessage),
  };
  const Component = createMermaidLoadingPlaceholderComponent(React, dependencies);
  const loading = renderToStaticMarkup(React.createElement(Component));
  assert.match(loading, /role="status"/);
  assert.match(loading, /aria-label="Loading Mermaid diagram"/);
  const streaming = renderToStaticMarkup(React.createElement(Component, { isStreaming: true }));
  assert.match(streaming, /data-mermaid-streaming="true" role="status"/);
  assert.match(streaming, /Loading diagram/);
});
