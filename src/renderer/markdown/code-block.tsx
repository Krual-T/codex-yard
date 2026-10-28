/** @jsxRuntime classic */
import type { ComponentType, Context, ReactNode } from 'react';

export type CodeBlockClipboardContent = string | Promise<string> | Record<string, string | Blob | Promise<string | Blob>>;
export type AddSelectedTextToChat = (text: string, range: Range) => void;

export type CodeSnippetProps = {
  wrapperClassName: string;
  clipboardContent?: CodeBlockClipboardContent;
  content: string;
  allowPreview?: boolean;
  language?: string;
  showCopyButton?: boolean;
  codeBlockWordWrap?: 'off' | 'always' | 'user-controlled';
  shouldWrapCode?: boolean;
  deferEnhancementsUntilVisible?: boolean;
  stickyHeader?: boolean;
  title?: string;
  variant?: 'default' | 'preview';
};

export type WritingBlockProps = {
  className: string;
  content: string;
  onAddSelectedTextToChat?: AddSelectedTextToChat;
  showCopyButton: boolean;
};

export type MermaidDiagramProps = {
  className: string;
  allowWideBlocks?: boolean;
  clipboardContent?: CodeBlockClipboardContent;
  code: string;
  isCodeFenceOpen?: boolean;
  fallback: ReactNode;
  wideBlockKind?: 'mermaid';
};

export type MarkdownCodeBlockProps = {
  allowPreview?: boolean;
  allowWideBlocks?: boolean;
  clipboardContent?: CodeBlockClipboardContent;
  codeSnippet?: ComponentType<CodeSnippetProps>;
  content: string;
  forceCodeBlockWordWrap?: boolean;
  isCodeFenceOpen?: boolean;
  language?: string;
  mermaidDiagram?: ComponentType<MermaidDiagramProps>;
  onAddSelectedTextToChat?: AddSelectedTextToChat;
  renderImmediately?: boolean;
  stickyHeader?: boolean;
  writingBlock?: ComponentType<WritingBlockProps>;
};

export type MarkdownCodeBlockDependencies = {
  useLanguageLabel: (language: string | undefined) => string | undefined;
  CodeBlockPreviewContext: Context<boolean>;
  DefaultCodeSnippet: ComponentType<CodeSnippetProps>;
  MermaidPlaceholder: ComponentType<{ isStreaming?: boolean }>;
  isMermaidDiagram: (language: string | undefined, isCodeFenceOpen: boolean | undefined) => boolean;
  isDeferredCodeBlock: (content: string, language: string | undefined) => boolean;
  styles: { CodeBlock: string; CodeBlockPlaceholder: string };
};

type DeferredProps = {
  fallback: ReactNode;
  renderVisible: () => ReactNode;
  renderImmediately?: boolean;
};

export function createMarkdownCodeBlockComponent(
  React: typeof import('react'),
  dependencies: MarkdownCodeBlockDependencies,
): ComponentType<MarkdownCodeBlockProps> {
  const {
    useLanguageLabel, CodeBlockPreviewContext, DefaultCodeSnippet, MermaidPlaceholder,
    isMermaidDiagram, isDeferredCodeBlock, styles,
  } = dependencies;

  function WhenVisible({ fallback, renderVisible }: DeferredProps) {
    const ref = React.useRef<HTMLDivElement>(null);
    const [visible, setVisible] = React.useState(false);
    React.useEffect(() => {
      if (visible || ref.current == null) return;
      if (typeof IntersectionObserver === 'undefined') {
        const timer = setTimeout(() => setVisible(true), 0);
        return () => clearTimeout(timer);
      }
      const observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      }, { rootMargin: '600px 0px' });
      observer.observe(ref.current);
      return () => observer.disconnect();
    }, [visible]);
    return visible ? renderVisible() : <div ref={ref}>{fallback}</div>;
  }

  function Deferred({ fallback, renderVisible, renderImmediately }: DeferredProps) {
    return renderImmediately ? renderVisible() : <WhenVisible fallback={fallback} renderVisible={renderVisible} />;
  }

  return function MarkdownCodeBlock({
    allowPreview = true,
    allowWideBlocks,
    clipboardContent,
    codeSnippet: CodeSnippet = DefaultCodeSnippet,
    content,
    forceCodeBlockWordWrap,
    isCodeFenceOpen,
    language,
    mermaidDiagram: MermaidDiagram,
    onAddSelectedTextToChat,
    renderImmediately,
    stickyHeader = false,
    writingBlock: WritingBlock,
  }: MarkdownCodeBlockProps) {
    const languageLabel = useLanguageLabel(language);
    const preview = React.useContext(CodeBlockPreviewContext);
    const title = languageLabel ?? language ?? (isCodeFenceOpen ? '' : undefined);
    const snippetLanguage = language ?? (isCodeFenceOpen ? 'plaintext' : undefined);
    const variant = preview ? 'preview' : 'default';
    const isWritingLanguage = language == null || language === 'text' || language === 'md' || language === 'markdown';
    const wordWrap = !preview && !isDeferredCodeBlock(content, language)
      ? (forceCodeBlockWordWrap ? 'always' : 'user-controlled') : 'off';
    const fallback = <div className={styles.CodeBlock} data-markdown-copy="code-block" data-markdown-copy-text={content}>
      <pre className={styles.CodeBlockPlaceholder}><code>{content}</code></pre>
    </div>;

    if (WritingBlock != null && isWritingLanguage) {
      return <Deferred fallback={fallback} renderImmediately={renderImmediately} renderVisible={() => <WritingBlock
        className={styles.CodeBlock}
        content={content}
        onAddSelectedTextToChat={onAddSelectedTextToChat}
        showCopyButton={!isCodeFenceOpen}
      />} />;
    }

    if (MermaidDiagram != null && isMermaidDiagram(language, isCodeFenceOpen)) {
      const diagramFallback = <div
        className={styles.CodeBlock}
        data-markdown-copy={isCodeFenceOpen ? 'exclude' : 'code-block'}
        data-markdown-copy-text={'```mermaid\n' + content + '\n```'}
      ><MermaidPlaceholder isStreaming={isCodeFenceOpen} /></div>;
      return <Deferred fallback={diagramFallback} renderImmediately={renderImmediately} renderVisible={() => <MermaidDiagram
        className={styles.CodeBlock}
        allowWideBlocks={allowWideBlocks}
        clipboardContent={clipboardContent}
        code={content}
        isCodeFenceOpen={isCodeFenceOpen}
        fallback={<DefaultCodeSnippet
          wrapperClassName={styles.CodeBlock}
          clipboardContent={clipboardContent}
          content={content}
          language="plaintext"
          stickyHeader={stickyHeader && variant === 'default'}
          title={title}
          variant={variant}
        />}
        wideBlockKind={allowWideBlocks ? 'mermaid' : undefined}
      />} />;
    }

    const snippet = <CodeSnippet
      wrapperClassName={styles.CodeBlock}
      clipboardContent={clipboardContent}
      content={content}
      allowPreview={allowPreview && !isCodeFenceOpen}
      language={snippetLanguage}
      showCopyButton={!isCodeFenceOpen}
      codeBlockWordWrap={wordWrap}
      shouldWrapCode={wordWrap === 'always'}
      deferEnhancementsUntilVisible={true}
      stickyHeader={stickyHeader && variant === 'default'}
      title={title}
      variant={variant}
    />;
    return isDeferredCodeBlock(content, language)
      ? <Deferred fallback={fallback} renderImmediately={renderImmediately} renderVisible={() => snippet} />
      : snippet;
  };
}
