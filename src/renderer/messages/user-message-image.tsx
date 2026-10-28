/** @jsxRuntime classic */
import type { ComponentType, KeyboardEvent, MouseEvent, ReactNode, RefCallback } from 'react';

type MessageDescriptor = { id: string; defaultMessage: string; description: string };
type ImageRouteScope = { value: { kind: string; routeKind?: string; conversationId?: string } };
type ImageEntrypoint = 'image_click' | 'lightbox_edit_button';

export type UserMessageImageAssetResolver = {
  cacheKey?: readonly unknown[];
  validationSessionId?: string | null;
  useDownloadUrlAsImageSrc?: boolean;
  resolveAsset: (fileId: string) => Promise<
    | { kind: 'available'; downloadUrl: string; imageSrc?: string | null; requestHeaders?: Record<string, string> | null; eligibleForDirectUrl?: boolean }
    | { kind: 'trashed'; libraryFileId: string }
    | { kind: 'permanently-deleted' }
  >;
};
export type UserMessageSourceImage = { id: string; src?: string | null; status: string; type: string };
export type UserMessageImageEditRequest<Attribution> = {
  prompt: string;
  maskSrc?: string | null;
  annotationCount?: number;
  editMode?: string;
  attribution?: Attribution;
};
export type UserMessageImageEditSubmit<Attribution> = (
  request: UserMessageImageEditRequest<Attribution>, signal: AbortSignal,
) => Promise<boolean | void>;

export type UserMessageImageProps<Resolver extends UserMessageImageAssetResolver, Attribution,
  SourceImage extends UserMessageSourceImage, Submit extends UserMessageImageEditSubmit<Attribution>> = {
  src: string;
  conversationId: string;
  chatGptConversationId?: string;
  hostId?: string | null;
  alt?: string;
  availableImageCount?: number;
  imageAssetResolver?: Resolver | null;
  imageSource?: string;
  imageEditAttribution?: Attribution;
  sourceImage?: SourceImage;
  onImageEditSubmit?: Submit;
  initialPreviewSrc?: string | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onPreviousImage?: () => void;
  onNextImage?: () => void;
  disableOpenAnimation?: boolean;
  useImageDialog?: boolean;
};

type ImageDetails<Attribution, SourceImage, Submit> = {
  alt: string;
  availableImageCount: number;
  attachmentSrc: string;
  chatGptConversationId?: string;
  downloadSrc: string;
  imageSource?: string;
  imageEditAttribution?: Attribution;
  onImageEditSubmit?: Submit;
  referrerPolicy: 'no-referrer';
  sourceImage?: SourceImage;
  src: string;
  title: string;
};

export type UserMessageImageDependencies<
  Scope extends ImageRouteScope, Client, Resolver extends UserMessageImageAssetResolver, Attribution,
  SourceImage extends UserMessageSourceImage, Submit extends UserMessageImageEditSubmit<Attribution>, Identity, MenuItems, Asset,
> = {
  useScope: () => Scope;
  useIntl: () => { formatMessage: (message: MessageDescriptor) => string };
  useImageClient: () => Client;
  useConversationHostId: (conversationId: string) => string | null | undefined;
  useDisableImageOverlay: () => boolean;
  useReducedMotion: () => boolean;
  useResolvedImage: (src: string, resolver?: Resolver | null) => { isError: boolean; src: string | null };
  useImageOverlayEnabled: (options: { disableExposureLog: boolean }) => boolean;
  isAssetPointer: (src: string) => boolean;
  getLocalImagePath: (src: string) => string | null;
  resolveLocalImage: (path: string, hostId: string, client: Client, signal: undefined, conversationId: string) => Promise<string | null>;
  getDurableIdentity: (scope: Scope, conversationId: string, src: string, resolver: Resolver | null | undefined) => Identity | undefined;
  openImageEditor: (scope: Scope, image: ImageDetails<Attribution, SourceImage, Submit> & {
    entrypoint: ImageEntrypoint;
    openInEditor: true;
  }, options: { durableIdentity: Identity | undefined }) => boolean;
  openAnimatedOverlay: (options: {
    source: HTMLImageElement | null;
    reducedMotion: boolean;
    open: (imageRef: RefCallback<HTMLImageElement>) => void;
  }) => void;
  recordImagePreview: (scope: Scope, options: {
    availableImageCount: number;
    entrypoint: 'image_click';
    imageSource: string;
    view: 'preview_dialog';
  }) => void;
  parseChatGptConversationId: (id: string) => string;
  getImageContextMenu: (scope: Scope, options: {
    chatGptConversationId?: string;
    displaySrc: string;
    hostId: string;
    image: { kind: 'generic'; src: string; alt: string };
    imageAssetResolver?: Resolver | null;
    intl: { formatMessage: (message: MessageDescriptor) => string };
  }) => MenuItems;
  ImageContextMenu: ComponentType<{ getItems: () => MenuItems; children: ReactNode }>;
  ImageDialog: ComponentType<{
    src: string;
    alt: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onPreviousImage?: () => void;
    onNextImage?: () => void;
    disableOpenAnimation?: boolean;
    closeAriaLabel: string;
    imageReferrerPolicy: 'no-referrer';
    editButton?: { ariaLabel: string; icon: ReactNode; onClick: () => void };
    triggerContent: ReactNode;
  }>;
  ImageOverlay: ComponentType<{
    getThumbnail: () => HTMLImageElement | null;
    image: ImageDetails<Attribution, SourceImage, Submit> & { imageRef?: RefCallback<HTMLImageElement>; readOnly: boolean };
    onClose: () => void;
    onCloseAutoFocus: (event: { preventDefault: () => void }) => void;
    onPreviousImage?: () => void;
    onNextImage?: () => void;
  }>;
  LoadingIcon: ComponentType<{ className: string }>;
  AssetIcon: ComponentType<{ 'aria-hidden': boolean; asset: Asset }>;
  editAsset: Asset;
  FormattedMessage: ComponentType<MessageDescriptor>;
};

export function createUserMessageImageComponent<
  Scope extends ImageRouteScope, Client, Resolver extends UserMessageImageAssetResolver, Attribution,
  SourceImage extends UserMessageSourceImage, Submit extends UserMessageImageEditSubmit<Attribution>, Identity, MenuItems, Asset,
>(
  React: typeof import('react'),
  dependencies: UserMessageImageDependencies<Scope, Client, Resolver, Attribution, SourceImage, Submit, Identity, MenuItems, Asset>,
): ComponentType<UserMessageImageProps<Resolver, Attribution, SourceImage, Submit>> {
  const {
    useScope, useIntl, useImageClient, useConversationHostId, useDisableImageOverlay, useReducedMotion,
    useResolvedImage, useImageOverlayEnabled, isAssetPointer, getLocalImagePath, resolveLocalImage,
    getDurableIdentity, openImageEditor, openAnimatedOverlay, recordImagePreview, parseChatGptConversationId,
    getImageContextMenu, ImageContextMenu, ImageDialog, ImageOverlay, LoadingIcon, AssetIcon, editAsset, FormattedMessage,
  } = dependencies;

  return function UserMessageImage({
    src, conversationId, chatGptConversationId, hostId, alt, availableImageCount = 1, imageAssetResolver,
    imageSource, imageEditAttribution, sourceImage, onImageEditSubmit, initialPreviewSrc, open, onOpenChange,
    onPreviousImage, onNextImage, disableOpenAnimation, useImageDialog,
  }: UserMessageImageProps<Resolver, Attribution, SourceImage, Submit>) {
    const scope = useScope();
    const intl = useIntl();
    const client = useImageClient();
    const conversationHostId = useConversationHostId(conversationId);
    const resolvedHostId = hostId ?? conversationHostId ?? 'local';
    const isCurrentLocalThread = scope.value.kind === 'local' && scope.value.routeKind === 'local-thread'
      && scope.value.conversationId === conversationId && !useImageDialog;
    const disableOverlay = useDisableImageOverlay();
    const reducedMotion = useReducedMotion();
    const [overlayImageRef, setOverlayImageRef] = React.useState<RefCallback<HTMLImageElement>>();
    const thumbnailRef = React.useRef<HTMLImageElement>(null);
    const triggerRef = React.useRef<HTMLDivElement>(null);
    const assetPointer = isAssetPointer(src) ? src : '';
    const [initialPreview] = React.useState(initialPreviewSrc ?? null);
    const assetToResolve = initialPreview == null ? assetPointer : '';
    const { isError, src: resolvedAsset } = useResolvedImage(assetToResolve, imageAssetResolver);
    const [localOpen, setLocalOpen] = React.useState(false);
    const isOpen = open ?? localOpen;
    const setOpen = onOpenChange ?? setLocalOpen;
    const [localImage, setLocalImage] = React.useState<string | null>(() =>
      assetPointer.length > 0 || getLocalImagePath(src) != null ? null : src);
    const displaySrc = assetPointer.length > 0 ? initialPreview ?? resolvedAsset : localImage;
    const failed = assetToResolve.length > 0 && isError;
    const canUseOverlay = displaySrc != null && !failed && !useImageDialog && !disableOverlay
      && (scope.value.kind === 'local' || scope.value.kind === 'chatgpt');
    const overlayEnabled = useImageOverlayEnabled({ disableExposureLog: !canUseOverlay });
    const useOverlay = canUseOverlay && overlayEnabled;
    const failedLabel = intl.formatMessage({ id: 'codex.localConversation.userImageAttachmentFailed', defaultMessage: 'Image failed to load', description: 'Alt text for a user image attachment that could not be loaded in local conversation' });
    const imageAlt = alt ?? intl.formatMessage({ id: 'codex.localConversation.userImageAttachment', defaultMessage: 'User attachment', description: 'Alt text for user image attachment in local conversation' });
    const closeLabel = intl.formatMessage({ id: 'codex.localConversation.closeImagePreview', defaultMessage: 'Close image preview', description: 'Aria label for closing the image preview dialog in local conversation' });

    React.useEffect(() => {
      if (assetPointer.length > 0) return;
      const path = getLocalImagePath(src);
      if (path == null) {
        setLocalImage(src);
        return;
      }
      let cancelled = false;
      setLocalImage(null);
      void resolveLocalImage(path, resolvedHostId, client, undefined, conversationId).then(result => {
        if (!cancelled) setLocalImage(result);
      });
      return () => { cancelled = true; };
    }, [conversationId, resolvedHostId, assetPointer, client, src]);

    if (failed) return <div className="flex size-16 items-center justify-center rounded-lg border border-text-danger/20 bg-background-danger-surface/20 px-1 text-center text-[10px] leading-3 text-danger" role="img" aria-label={failedLabel}>
      <FormattedMessage id="codex.localConversation.userImageAttachmentFailedShort" defaultMessage="Failed" description="Short visible text for a user image attachment that could not be loaded in local conversation" />
    </div>;
    if (displaySrc == null) return <div className="flex size-20 items-center justify-center rounded-lg border border-strong"><LoadingIcon className="icon-xs" /></div>;

    const imageDetails: ImageDetails<Attribution, SourceImage, Submit> = {
      alt: imageAlt, availableImageCount, attachmentSrc: src, chatGptConversationId, downloadSrc: displaySrc,
      imageSource, imageEditAttribution, onImageEditSubmit, referrerPolicy: 'no-referrer', sourceImage, src: displaySrc, title: imageAlt,
    };
    const openEditor = (entrypoint: ImageEntrypoint) => openImageEditor(scope, {
      ...imageDetails, entrypoint, openInEditor: true,
    }, { durableIdentity: getDurableIdentity(scope, conversationId, src, imageAssetResolver) });
    const openPreview = (event?: MouseEvent<HTMLDivElement>) => {
      if (useOverlay || imageSource === 'uploaded') {
        event?.preventDefault();
        if (useOverlay) openAnimatedOverlay({ source: thumbnailRef.current, reducedMotion, open: imageRef => {
          setOverlayImageRef(() => imageRef);
          setOpen(true);
        } });
        else setOpen(true);
        if (imageSource != null) recordImagePreview(scope, { availableImageCount, entrypoint: 'image_click', imageSource, view: 'preview_dialog' });
        return;
      }
      if (isCurrentLocalThread && openEditor('image_click')) {
        event?.preventDefault();
        return;
      }
      if (event == null) setOpen(true);
    };
    const onClick = (event: MouseEvent<HTMLDivElement>) => {
      if (event.target instanceof Node && !event.currentTarget.contains(event.target)) {
        event.preventDefault();
        return;
      }
      openPreview(event);
    };
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openPreview();
      }
    };
    const getItems = () => getImageContextMenu(scope, {
      chatGptConversationId: conversationId.startsWith('chatgpt:') ? parseChatGptConversationId(conversationId.slice(8)) : undefined,
      displaySrc, hostId: resolvedHostId, image: { kind: 'generic', src, alt: imageAlt }, imageAssetResolver, intl,
    });
    const trigger = <div ref={triggerRef} className="size-20 cursor-interaction rounded-lg border border-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0" role="button" tabIndex={0} aria-label={imageAlt} onClick={onClick} onKeyDown={onKeyDown}>
      <ImageContextMenu getItems={getItems}><img ref={thumbnailRef} src={displaySrc} className="h-full w-full rounded-md object-cover" referrerPolicy="no-referrer" alt={imageAlt} /></ImageContextMenu>
    </div>;
    if (useOverlay) return <>{trigger}{isOpen ? <ImageOverlay
      getThumbnail={() => thumbnailRef.current}
      image={{ ...imageDetails, imageRef: overlayImageRef, readOnly: !isCurrentLocalThread && onImageEditSubmit == null }}
      onClose={() => setOpen(false)}
      onCloseAutoFocus={event => { event.preventDefault(); triggerRef.current?.focus(); }}
      onPreviousImage={onPreviousImage}
      onNextImage={onNextImage}
    /> : null}</>;
    const editButton = isCurrentLocalThread && imageSource === 'uploaded' ? {
      ariaLabel: intl.formatMessage({ id: 'codex.localConversation.editImageAttachment', defaultMessage: 'Edit image', description: 'Accessible label for opening an uploaded image attachment in the image editor' }),
      icon: <AssetIcon aria-hidden={false} asset={editAsset} />,
      onClick: () => { if (openEditor('lightbox_edit_button')) setOpen(false); },
    } : undefined;
    return <ImageDialog src={displaySrc} alt={imageAlt} open={isOpen} onOpenChange={setOpen}
      onPreviousImage={onPreviousImage} onNextImage={onNextImage} disableOpenAnimation={disableOpenAnimation}
      closeAriaLabel={closeLabel} imageReferrerPolicy="no-referrer" editButton={editButton} triggerContent={trigger} />;
  };
}
