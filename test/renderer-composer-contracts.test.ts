import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  ComposerController,
  ComposerControllerOptions,
  ComposerEditorProps,
  ComposerLegacyDictation,
  ComposerRealtimeVoice,
} from '../src/renderer/composer/composer-types.ts';
import { createComposerControllerFixture } from './renderer-composer-fixture.ts';

// This is the structural surface currently declared by the manager-owned home layout.
interface HomeController {
  readonly view: { readonly dom: HTMLElement };
  getText: () => string;
}

function checkRejectedContracts(
  withoutPlaceholder: Omit<ComposerController, 'setPlaceholder'>,
  withoutGetText: Omit<ComposerController, 'getText'>,
  withoutSubmitHandler: Omit<ComposerController, 'addSubmitHandler'>,
): void {
  // @ts-expect-error The original editor calls setPlaceholder on mount.
  const editorWithoutPlaceholder: ComposerEditorProps = { composerController: withoutPlaceholder };
  // @ts-expect-error Home suggestions read getText from the same controller.
  const homeWithoutText: HomeController = withoutGetText;
  // @ts-expect-error The original editor registers its submit handler.
  const editorWithoutSubmitHandler: ComposerEditorProps = { composerController: withoutSubmitHandler };
  // @ts-expect-error Slash command triggers must be an array.
  const options: ComposerControllerOptions = { enableSlashCommands: { triggers: '/' } };
  // @ts-expect-error The legacy voice buttons call stopDictation.
  const legacy: ComposerLegacyDictation = {};
  // @ts-expect-error Realtime voice requires its phase and control callbacks.
  const realtime: ComposerRealtimeVoice = {};
  void [editorWithoutPlaceholder, homeWithoutText, editorWithoutSubmitHandler, options, legacy, realtime];
}
void checkRejectedContracts;

test('home and editor contracts accept the same controller and typed options and voice controls', () => {
  const controller = createComposerControllerFixture();
  const home: HomeController = controller;
  const editor: ComposerEditorProps = { composerController: controller };
  const options: ComposerControllerOptions = { enableSlashCommands: { triggers: ['/'] }, enableRichText: true };
  const legacy: ComposerLegacyDictation = { stopDictation: () => {} };
  const realtime: ComposerRealtimeVoice = {
    phase: 'active', isMicrophoneMuted: false, isMuted: false,
    toggleMicrophoneMute: () => {}, toggleMute: () => {}, stop: () => {},
  };
  controller.setText('shared controller');
  assert.equal(home.getText(), 'shared controller');
  assert.equal(editor.composerController, controller);
  assert.deepEqual(options.enableSlashCommands, { triggers: ['/'] });
  assert.equal(typeof legacy.stopDictation, 'function');
  assert.equal(typeof realtime.stop, 'function');
});
