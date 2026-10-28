import type * as ReactTypes from 'react';
import type {
  ComposerController,
  ComposerControllerDependencies,
  ComposerControllerProviderProps,
  ComposerInitialContent,
} from './composer-types.ts';

export function createComposerControllerProvider(
  React: typeof ReactTypes,
  dependencies: ComposerControllerDependencies,
): ReactTypes.ComponentType<ComposerControllerProviderProps> {
  const { ControllerContext, useEnterBehavior, usePlainTextMode, useIsHydrating } = dependencies;

  function ComposerControllerProvider({
    children,
    composerController,
    controllerOptions,
    defaultText,
    defaultTextKind = 'plain',
    initialDocument,
    getInitialContent,
    getInitialInput,
    initialSuggestionOptions,
    onDocumentChange,
    onDocumentDispose,
    renderWhilePending = false,
  }: ComposerControllerProviderProps): ReactTypes.ReactNode {
    const enterBehavior = useEnterBehavior();
    const plainTextMode = usePlainTextMode();
    const isHydrating = useIsHydrating();
    const [initialInput] = React.useState(() => getInitialInput);
    const [suggestionOptions] = React.useState(initialSuggestionOptions);
    const content: ComposerInitialContent & { plainTextMode: boolean } = {
      defaultText, defaultTextKind, initialDocument, plainTextMode,
    };
    const [resolvedContent, setResolvedContent] = React.useState(
      () => getInitialInput == null ? content : null,
    );
    if (resolvedContent == null && !isHydrating) setResolvedContent(content);

    const [createdController, setCreatedController] = React.useState<ComposerController | null>(null);
    const current = React.useRef<{ controller: ComposerController; options?: object } | null>(null);
    const [isComposingPendingInput, setIsComposingPendingInput] = React.useState(false);
    const resolveContent = React.useEffectEvent((mode: boolean) => getInitialContent?.(mode));
    const documentChanged = React.useEffectEvent((document: ComposerController['view']['state']['doc'], mode: boolean) => {
      onDocumentChange?.(document, mode);
    });
    const documentDisposed = React.useEffectEvent((document: ComposerController['view']['state']['doc']) => {
      onDocumentDispose?.(document, plainTextMode);
    });

    React.useInsertionEffect(() => () => {
      const controller = current.current?.controller;
      window.setTimeout(() => controller?.destroy(), 0);
    }, []);

    React.useLayoutEffect(() => {
      if (composerController != null) {
        current.current = null;
        return;
      }
      if (resolvedContent == null) return;

      const pending = initialInput?.();
      const input = pending?.element;
      const inputWindow = input?.ownerDocument.defaultView;
      const previous = current.current;
      let controller = previous != null && previous.options === controllerOptions && !previous.controller.view.isDestroyed
        ? previous.controller
        : undefined;

      function syncPendingInput(replaceDocument: boolean): void {
        if (input == null || controller == null) return;
        const edited = input.dataset.edited === 'true';
        const activeElement = input.ownerDocument.activeElement;
        if (activeElement === input) controller.initialInputFocused = true;
        else if (activeElement !== input.ownerDocument.body) controller.initialInputFocused = false;
        if (edited && pending != null) controller.consumeLocationPromptPrefill(pending.locationKey);

        const { state } = controller.view;
        const transaction = state.tr;
        if (replaceDocument && edited) {
          transaction.replaceWith(0, state.doc.content.size, dependencies.documentFromText({ schema: state.schema, text: input.value }).content);
        }
        if (transaction.doc.textBetween(0, transaction.doc.content.size, '\n') === input.value) {
          const position = (offset: number) => offset + 1 + (input.value.slice(0, offset).match(/\n/g)?.length ?? 0);
          const start = position(input.selectionStart ?? 0);
          const end = position(input.selectionEnd ?? 0);
          transaction.setSelection(dependencies.createTextSelection(
            transaction.doc,
            input.selectionDirection === 'backward' ? end : start,
            input.selectionDirection === 'backward' ? start : end,
          ));
          controller.view.dispatch(transaction);
        }
      }

      function create(): void {
        if (input?.dataset.composition != null || controller != null) return;
        const edited = input?.dataset.edited === 'true';
        const initial = resolveContent(resolvedContent!.plainTextMode) ?? resolvedContent!;
        controller = dependencies.createController(edited ? input.value : initial.defaultText, {
          enableCodeBlocks: true,
          enableRichText: true,
          enableSelectedTextLinks: true,
          ...controllerOptions,
          defaultTextKind: edited ? 'literal' : initial.defaultTextKind,
          initialDocument: edited ? undefined : initial.initialDocument,
          onDocumentChange: documentChanged,
          plainTextMode: resolvedContent!.plainTextMode,
          suggestionOptions,
        });
        current.current = { controller, options: controllerOptions };
        syncPendingInput(false);
        documentChanged(controller.view.state.doc, resolvedContent!.plainTextMode);
        setCreatedController(controller);
      }

      const onPendingReady = () => dependencies.flushSync(() => {
        create();
        setIsComposingPendingInput(false);
      });
      const onCompositionStart = (event: Event) => {
        if (event.target === input && !controller?.view.dom.isConnected) setIsComposingPendingInput(true);
      };
      const onInput = (event: Event) => {
        if (event.target === input && !controller?.view.dom.isConnected) syncPendingInput(true);
      };
      const onSelectionOrFocus = () => {
        if (!controller?.view.dom.isConnected) syncPendingInput(false);
      };

      input?.addEventListener('pending-input-ready', onPendingReady);
      inputWindow?.addEventListener('compositionstart', onCompositionStart, true);
      inputWindow?.addEventListener('input', onInput, true);
      input?.addEventListener('select', onSelectionOrFocus);
      input?.addEventListener('focus', onSelectionOrFocus);
      input?.addEventListener('blur', onSelectionOrFocus);
      create();

      return () => {
        input?.removeEventListener('pending-input-ready', onPendingReady);
        inputWindow?.removeEventListener('compositionstart', onCompositionStart, true);
        inputWindow?.removeEventListener('input', onInput, true);
        input?.removeEventListener('select', onSelectionOrFocus);
        input?.removeEventListener('focus', onSelectionOrFocus);
        input?.removeEventListener('blur', onSelectionOrFocus);
        if (controller != null) {
          documentDisposed(controller.view.state.doc);
          const oldController = controller;
          window.setTimeout(() => {
            if (current.current?.controller !== oldController) oldController.destroy();
          }, 0);
        }
      };
    }, [initialInput, resolvedContent, suggestionOptions, composerController, controllerOptions]);

    const activeController = composerController ?? (
      isComposingPendingInput || createdController?.view.isDestroyed ? null : createdController
    );
    React.useLayoutEffect(() => {
      activeController?.setEnterBehavior(enterBehavior);
    }, [activeController, enterBehavior]);
    React.useLayoutEffect(() => {
      activeController?.setPlainTextMode(plainTextMode);
    }, [activeController, plainTextMode]);

    const contentToRender = activeController != null || renderWhilePending
      ? typeof children === 'function' ? children(activeController) : children
      : null;
    return React.createElement(ControllerContext.Provider, { value: activeController }, contentToRender);
  }

  return ComposerControllerProvider;
}
