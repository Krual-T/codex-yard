import type { ComposerController, ComposerDocument, ComposerTransaction } from '../src/renderer/composer/composer-types.ts';

export function createComposerControllerFixture(): ComposerController {
  let text = 'fixture';
  const document: ComposerDocument = {
    content: { size: text.length },
    textBetween: () => text,
    descendants: () => {},
  };
  const transaction: ComposerTransaction = {
    doc: document,
    replaceWith() { return this; },
    setSelection() { return this; },
  };
  return {
    view: {
      dom: { isConnected: false } as HTMLElement,
      isDestroyed: false,
      state: { doc: document, schema: {}, tr: transaction, selection: { $from: { parent: { type: { name: 'paragraph' } } } } },
      dispatch: () => {}, hasFocus: () => false, nodeDOM: () => null,
    },
    eventEmitter: { addListener: () => {}, removeListener: () => {} },
    inlineMentionIconRegistry: { subscribe: () => () => {}, getSnapshot: () => [] },
    getText: () => text,
    getPersistedText: () => text,
    setText: value => { text = value; },
    setPromptText: value => { text = value; },
    restoreText: value => { text = value; },
    focus: () => {}, setPlaceholder: () => {}, setInputActive: () => {}, clearInitialInputFocus: () => {},
    addSubmitHandler: () => () => {}, cancelPendingSubmit: () => {}, setSubmitReady: () => {},
    hasStandaloneBrowserAutocompleteMention: () => false,
    dismissStandaloneBrowserAutocompleteMentionOnBlur: () => {}, cancelBrowserAutocompleteMentionDismissal: () => {},
    getBrowserAutocompleteMentionDismissalSnapshot: () => false, completeBrowserAutocompleteMentionDismissal: () => {},
    updateLink: () => {}, consumeLocationPromptPrefill: () => true, setEnterBehavior: () => {}, setPlainTextMode: () => {},
    destroy: () => {},
  };
}
