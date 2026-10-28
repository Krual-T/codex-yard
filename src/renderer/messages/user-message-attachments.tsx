/** @jsxRuntime classic */
import type { ComponentType, MouseEvent, ReactNode } from 'react';

export type UploadedFileAttachment = { fileName: string; fileId: string };
export type PathAttachment = {
  path: string;
  fsPath?: string | null;
  label: string;
  startLine?: number | null;
  endLine?: number | null;
  isPastedText?: boolean;
  sharedThread?: { shareId: string } | null;
};
export type UserMessageFileAttachment = PathAttachment | { upload: UploadedFileAttachment; preview?: string | null };
export type UserMessageFileAttachmentProps = {
  attachment: UserMessageFileAttachment;
  cwd?: string | null;
  hostId?: string | null;
  isUploadedFileViewerEnabled?: boolean;
};

type FileCardProps = {
  filename: string;
  resourcePath?: string;
  lineInfo?: string;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  layout: 'card' | 'pill';
  showOpenAffordance: boolean;
  variant: 'thread';
};
type FileMenuProps = {
  attachmentPreviewOrigin?: 'sent-message';
  cwd?: string | null;
  endLine?: number | null;
  hostId?: string | null;
  isAttachmentPreview: boolean;
  line?: number | null;
  openInSidePanel: boolean;
  path: string;
  children: ReactNode;
};

export type UserMessageFileAttachmentDependencies<Scope> = {
  useScope: () => Scope;
  FileCard: ComponentType<FileCardProps>;
  PastedTextCard: ComponentType<{ preview: string; onClick: () => void }>;
  FileContextMenu: ComponentType<FileMenuProps>;
  openUploadedFile: (scope: Scope, upload: UploadedFileAttachment) => void | Promise<unknown>;
  openSharedThread: (options: { event: MouseEvent<HTMLElement>; href: string; initiator: 'open_in_browser_bridge' }) => void;
  openFile: (options: {
    scope: Scope;
    path: string;
    line?: number | null;
    column?: number;
    cwd?: string | null;
    hostId?: string | null;
    attachmentPreviewOrigin?: 'sent-message';
    isAttachmentPreview: boolean;
    openInSidePanel: boolean;
    target?: 'fileManager';
  }) => void;
  isDirectory: (attachment: PathAttachment) => boolean;
  getPreviewKind: (path: string) => string | null;
  isSidePanelFile: (path: string) => boolean;
  isSidePanelMedia: (path: string) => boolean;
  formatLabel: (label: string, lineInfo: string | undefined) => string;
  formatLineInfo: (attachment: PathAttachment) => string | undefined;
};

export function createUserMessageFileAttachmentComponent<Scope>(
  React: typeof import('react'),
  dependencies: UserMessageFileAttachmentDependencies<Scope>,
): ComponentType<UserMessageFileAttachmentProps> {
  const {
    useScope, FileCard, PastedTextCard, FileContextMenu, openUploadedFile, openSharedThread, openFile,
    isDirectory, getPreviewKind, isSidePanelFile, isSidePanelMedia, formatLabel, formatLineInfo,
  } = dependencies;
  return function UserMessageFileAttachment({ attachment, cwd, hostId, isUploadedFileViewerEnabled = false }: UserMessageFileAttachmentProps) {
    const scope = useScope();
    if ('upload' in attachment) {
      const { upload, preview } = attachment;
      const onClick = () => { void openUploadedFile(scope, upload); };
      return preview == null
        ? <FileCard filename={upload.fileName} layout={isUploadedFileViewerEnabled ? 'card' : 'pill'} showOpenAffordance={isUploadedFileViewerEnabled} variant="thread" onClick={onClick} />
        : <PastedTextCard preview={preview} onClick={onClick} />;
    }

    const lineInfo = formatLineInfo(attachment);
    const path = attachment.fsPath || attachment.path;
    const directory = isDirectory(attachment);
    const isAttachmentPreview = !directory && isUploadedFileViewerEnabled && getPreviewKind(path) != null && attachment.startLine == null;
    const openInSidePanel = !directory && (isAttachmentPreview || getPreviewKind(path) === 'pptx'
      || !!attachment.isPastedText || isSidePanelFile(path) || (attachment.startLine == null && isSidePanelMedia(path)));
    const onClick = (event: MouseEvent<HTMLElement>) => {
      if (attachment.sharedThread != null) {
        openSharedThread({ event, href: `https://chatgpt.com/s/${encodeURIComponent(attachment.sharedThread.shareId)}`, initiator: 'open_in_browser_bridge' });
        return;
      }
      if (!path) return;
      openFile({
        scope, path, line: attachment.startLine, column: attachment.startLine == null ? undefined : 1, cwd, hostId,
        attachmentPreviewOrigin: isAttachmentPreview ? 'sent-message' : undefined,
        isAttachmentPreview, openInSidePanel, target: directory ? 'fileManager' : undefined,
      });
    };
    const card = <FileCard
      filename={formatLabel(attachment.label, lineInfo)}
      resourcePath={attachment.path}
      lineInfo={lineInfo}
      onClick={path ? onClick : undefined}
      layout={isAttachmentPreview ? 'card' : 'pill'}
      showOpenAffordance={isAttachmentPreview}
      variant="thread"
    />;
    if (!path || attachment.sharedThread != null) return card;
    return <FileContextMenu
      attachmentPreviewOrigin={isAttachmentPreview ? 'sent-message' : undefined}
      cwd={cwd}
      endLine={attachment.endLine}
      hostId={hostId}
      isAttachmentPreview={isAttachmentPreview}
      line={attachment.startLine}
      openInSidePanel={openInSidePanel}
      path={path}
    ><span className="inline-flex max-w-full">{card}</span></FileContextMenu>;
  };
}

export type UserMessageImageListProps = {
  srcs: string[];
  conversationId: string;
  hostId?: string | null;
  alt?: string;
  imageSource?: string;
  useImageDialog?: boolean;
};
export type UserMessageImageListItemProps = {
  src: string;
  conversationId: string;
  hostId?: string | null;
  alt?: string;
  imageSource?: string;
  useImageDialog?: boolean;
  availableImageCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPreviousImage?: () => void;
  onNextImage?: () => void;
  disableOpenAnimation: true;
};

export function createUserMessageImageListComponent(
  React: typeof import('react'),
  { ImageAttachment }: { ImageAttachment: ComponentType<UserMessageImageListItemProps> },
): ComponentType<UserMessageImageListProps> {
  return function UserMessageImageList({ srcs, conversationId, hostId, alt, imageSource, useImageDialog }: UserMessageImageListProps) {
    const [openIndex, setOpenIndex] = React.useState<number | null>(null);
    return <>{srcs.map((src, index) => <ImageAttachment
      key={index}
      src={src}
      conversationId={conversationId}
      hostId={hostId}
      alt={alt}
      availableImageCount={srcs.length}
      imageSource={imageSource}
      useImageDialog={useImageDialog}
      open={openIndex === index}
      onOpenChange={open => setOpenIndex(open ? index : null)}
      onPreviousImage={index === 0 ? undefined : () => setOpenIndex(index - 1)}
      onNextImage={index === srcs.length - 1 ? undefined : () => setOpenIndex(index + 1)}
      disableOpenAnimation={true}
    />)}</>;
  };
}
