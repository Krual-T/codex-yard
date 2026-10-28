import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { UserMessageDependencies } from '../src/renderer/messages/user-message.tsx';
import type { UserMessageImageAssetResolver, UserMessageImageEditRequest, UserMessageImageEditSubmit,
  UserMessageImageProps, UserMessageSourceImage } from '../src/renderer/messages/user-message-image.tsx';

type Attribution = { imageSource: string; editEntryPoint: string };
type Props = UserMessageImageProps<UserMessageImageAssetResolver, Attribution, UserMessageSourceImage, UserMessageImageEditSubmit<Attribution>>;
type EditorProps = React.ComponentProps<UserMessageDependencies<object, object, object>['Editor']>;

test('user image and draft contracts accept the actual resolver, edit request and nullable link source', async () => {
  const draft = { message: 'edit', authoredMarkdownLinkSourcesByOccurrence: [null], literalMarkdownLinkSources: [null] };
  const readDraft = (onDraftChange: EditorProps['onDraftChange']) => onDraftChange(draft);
  let stored: typeof draft | undefined;
  readDraft(value => { stored = value as typeof draft; });
  assert.deepEqual(stored?.literalMarkdownLinkSources, [null]);
  const resolver: UserMessageImageAssetResolver = { resolveAsset: async id => ({ kind: 'available', downloadUrl: `https://fixture.invalid/${id}` }) };
  const request: UserMessageImageEditRequest<Attribution> = { prompt: 'change', maskSrc: 'mask', attribution: { imageSource: 'uploaded', editEntryPoint: 'conversation' } };
  const props: Props = { src: 'file-service://image', conversationId: 'thread', imageAssetResolver: resolver,
    sourceImage: { id: 'image', src: 'file-service://image', status: 'completed', type: 'generated-image' },
    onImageEditSubmit: async (value, signal) => value.prompt === request.prompt && !signal.aborted };
  assert.equal((await props.imageAssetResolver?.resolveAsset('image'))?.kind, 'available');
  assert.equal(await props.onImageEditSubmit?.(request, new AbortController().signal), true);
  // @ts-expect-error The upstream image loader calls resolveAsset on a non-null resolver.
  const invalidResolver: UserMessageImageAssetResolver = { id: 'resolver' };
  // @ts-expect-error The image editor expects image metadata rather than a number.
  const invalidImage: UserMessageSourceImage = 42;
  // @ts-expect-error The editor passes a request and AbortSignal, not a numeric argument.
  const invalidSubmit: UserMessageImageEditSubmit<Attribution> = async (input: number) => input > 0;
  void invalidResolver; void invalidImage; void invalidSubmit;
});
