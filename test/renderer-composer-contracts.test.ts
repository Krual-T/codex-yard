import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  ComposerController,
  ComposerControllerOptions,
  ComposerDocument,
  ComposerEditorProps,
  ComposerLegacyDictation,
  ComposerRealtimeVoice,
} from '../src/renderer/composer/composer-types.ts';
import type { ComposerDraftScope } from '../src/renderer/composer/composer-draft-scope.tsx';
import { createComposerControllerFixture, createComposerDocumentFixture, createComposerScopeFixture, createComposerScopeSignal } from './renderer-composer-fixture.ts';

// This is the structural surface currently declared by the manager-owned home layout.
interface HomeController {
  readonly view: { readonly dom: HTMLElement };
  getText: () => string;
}

function checkRejectedContracts(
  withoutPlaceholder: Omit<ComposerController, 'setPlaceholder'>,
  withoutGetText: Omit<ComposerController, 'getText'>,
  withoutSubmitHandler: Omit<ComposerController, 'addSubmitHandler'>,
  scopeWithoutGet: Omit<ComposerDraftScope, 'get'>,
  scopeWithoutSet: Omit<ComposerDraftScope, 'set'>,
  documentWithoutJson: Omit<ComposerDocument, 'toJSON'>,
  documentWithoutSchema: Omit<ComposerDocument, 'type'>,
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
  // @ts-expect-error The original protected-draft and snapshot services read the scope.
  const unreadableScope: ComposerDraftScope = scopeWithoutGet;
  // @ts-expect-error The original retained-document service writes the scope.
  const unwritableScope: ComposerDraftScope = scopeWithoutSet;
  // @ts-expect-error The original document writer serializes the document.
  const unserializableDocument: ComposerDocument = documentWithoutJson;
  // @ts-expect-error The original controller compares the initial document schema.
  const documentWithoutType: ComposerDocument = documentWithoutSchema;
  const scope = createComposerScopeFixture({ kind: 'local', conversationId: 'thread' });
  const textAtom = createComposerScopeSignal('draft');
  // @ts-expect-error The atom's value type controls writes through the scope.
  scope.set(textAtom, 42);
  void [editorWithoutPlaceholder, homeWithoutText, editorWithoutSubmitHandler, options, legacy, realtime,
    unreadableScope, unwritableScope, unserializableDocument, documentWithoutType];
}
void checkRejectedContracts;

test('home and editor contracts accept the same controller and typed options and voice controls', () => {
  const controller = createComposerControllerFixture();
  const scope = createComposerScopeFixture({ kind: 'local', conversationId: 'thread' });
  const atom = createComposerScopeSignal('draft');
  const document = createComposerDocumentFixture('draft');
  scope.set(atom, 'updated');
  assert.equal(scope.get(atom), 'updated');
  assert.deepEqual(document.toJSON(), { type: 'doc', content: [{ type: 'text', text: 'draft' }] });
  assert.deepEqual(document.type.schema.nodes, {});
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
