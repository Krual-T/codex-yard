import type { ComposerController, ComposerDocument, ComposerTransaction } from '../src/renderer/composer/composer-types.ts';
import type {
  ComposerAtomGetter,
  ComposerAtomSetter,
  ComposerDraftScope,
  ComposerWritableScopeAtom,
} from '../src/renderer/composer/composer-draft-scope.tsx';

export function createComposerScopeSignal<Value>(initial: Value): ComposerWritableScopeAtom<Value> {
  let current = initial;
  const scope = { __scopeBrand: 'ComposerScope', id: Symbol('scope') };
  return {
    scope,
    resolve: () => ({
      read: () => current,
      write: (_get, _set, value) => { current = value; },
    }),
  };
}

export function createComposerScopeFixture(value: ComposerDraftScope['value']): ComposerDraftScope {
  const read: ComposerAtomGetter = atom => atom.read(read);
  const write: ComposerAtomSetter = (atom, next) => { atom.write(read, write, next); };
  return {
    value,
    get: atom => read(atom.resolve(undefined, undefined)),
    set: (atom, next) => { write(atom.resolve(undefined, undefined), next); },
  };
}

export function createComposerDocumentFixture(text: string): ComposerDocument {
  return {
    content: { size: text.length },
    type: { schema: { nodes: {}, marks: {} } },
    textBetween: () => text,
    descendants: () => {},
    toJSON: () => ({ type: 'doc', content: text ? [{ type: 'text', text }] : [] }),
  };
}

export function createComposerControllerFixture(): ComposerController {
  let text = 'fixture';
  const document = createComposerDocumentFixture(text);
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
