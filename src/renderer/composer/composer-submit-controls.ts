import type * as ReactTypes from 'react';
import type { ComposerDocument } from './composer-types.ts';

export interface ComposerShortcutController {
  view: {
    hasFocus(): boolean;
    state: {
      doc: ComposerDocument;
      selection: { $from: { parent: { type: { name: string } } } };
    };
  };
  setText(text: string): void;
}

export interface ComposerSubmitCallbacks {
  onComposerSubmitted?: () => void;
}

export type ComposerSubmitHandler = (source?: string, callbacks?: ComposerSubmitCallbacks) => void;
export type ComposerShortcut =
  | 'composer.submitInBackground'
  | 'composer.submit'
  | 'composer.steer'
  | 'composer.queue'
  | 'composer.clear';

export interface ComposerSubmitControlsProps {
  backgroundSubmit: { enabled: boolean; onSubmit(): void };
  composerInteractionsEnabled: boolean;
  isResumePending: boolean;
  maybeSendQueuedSteerMessage(action: 'steer'): boolean;
  submit(options: {
    focusComposerAfterSubmit: true;
    onSubmitted?: () => void;
    followUpSubmitAction?: 'steer' | 'queue';
  }): void;
  submitButtonMode: 'stop' | 'submit';
  submitDisabled: boolean;
  voiceControls: {
    isDictationStarting: boolean;
    isDictating: boolean;
    isTranscribing: boolean;
    stopDictation(action: 'send'): void;
  };
}

export interface ComposerSubmitControlsDependencies<Scope> {
  useComposerScope(): Scope;
  useComposerController(): ComposerShortcutController;
  useShortcut(name: ComposerShortcut, handler: ComposerSubmitHandler, options: {
    enabled: boolean;
    keyboardHandler?: (event: KeyboardEvent) => boolean | void;
  }): void;
  useStableEvent(handler: ComposerSubmitHandler): ComposerSubmitHandler;
  isShortcut(event: KeyboardEvent, shortcut: 'CmdOrCtrl+Enter'): boolean;
  getEnterBehavior(scope: Scope): string;
  isMultilineDocument(document: ComposerDocument): boolean;
}

export function createComposerSubmitControls<Scope>(
  React: typeof ReactTypes,
  dependencies: ComposerSubmitControlsDependencies<Scope>,
): (props: ComposerSubmitControlsProps) => () => void {
  return function useComposerSubmitControls({
    backgroundSubmit,
    composerInteractionsEnabled,
    isResumePending,
    maybeSendQueuedSteerMessage,
    submit,
    submitButtonMode,
    submitDisabled,
    voiceControls,
  }: ComposerSubmitControlsProps): () => void {
    const scope = dependencies.useComposerScope();
    const controller = dependencies.useComposerController();
    const isDictating = voiceControls.isDictationStarting || voiceControls.isDictating || voiceControls.isTranscribing;
    const keyboardHandler = React.useCallback((event: KeyboardEvent) => {
      const { state } = controller.view;
      if (!controller.view.hasFocus() || state.selection.$from.parent.type.name === 'code_block') return false;
      if (dependencies.isShortcut(event, 'CmdOrCtrl+Enter')) {
        const behavior = dependencies.getEnterBehavior(scope);
        if (behavior === 'cmdAlways' || behavior === 'cmdIfMultiline' && dependencies.isMultilineDocument(state.doc)) return false;
      }
    }, [controller.view, scope]);
    const backgroundEnabled = backgroundSubmit.enabled && !isDictating;
    const backgroundOptions = React.useMemo(() => ({ enabled: backgroundEnabled, keyboardHandler }), [backgroundEnabled, keyboardHandler]);
    dependencies.useShortcut('composer.submitInBackground', backgroundSubmit.onSubmit, backgroundOptions);

    const submitHandler = React.useCallback<ComposerSubmitHandler>((source, callbacks) => {
      if (composerInteractionsEnabled && !isResumePending) {
        if (isDictating) {
          voiceControls.stopDictation('send');
          return;
        }
        if (!submitDisabled && !(source === 'codex_micro_hid' && maybeSendQueuedSteerMessage('steer'))) {
          switch (submitButtonMode) {
            case 'stop': break;
            case 'submit': submit({ focusComposerAfterSubmit: true, onSubmitted: callbacks?.onComposerSubmitted });
          }
        }
      }
    }, [composerInteractionsEnabled, isResumePending, isDictating, voiceControls, submitDisabled, maybeSendQueuedSteerMessage, submitButtonMode, submit]);
    const stableSubmit = dependencies.useStableEvent(submitHandler);
    const submitEnabled = composerInteractionsEnabled && !isResumePending && (isDictating || !submitDisabled);
    const submitOptions = React.useMemo(() => ({ enabled: submitEnabled }), [submitEnabled]);
    dependencies.useShortcut('composer.submit', stableSubmit, submitOptions);
    const canQueueOrSteer = composerInteractionsEnabled && !isResumePending && !isDictating && !submitDisabled && submitButtonMode === 'submit';
    const steer = React.useCallback(() => {
      submit({ followUpSubmitAction: 'steer', focusComposerAfterSubmit: true });
    }, [submit]);
    const steerOptions = React.useMemo(() => ({ enabled: canQueueOrSteer }), [canQueueOrSteer]);
    dependencies.useShortcut('composer.steer', steer, steerOptions);
    const queue = React.useCallback(() => {
      submit({ followUpSubmitAction: 'queue', focusComposerAfterSubmit: true });
    }, [submit]);
    const queueOptions = React.useMemo(() => ({ enabled: canQueueOrSteer }), [canQueueOrSteer]);
    dependencies.useShortcut('composer.queue', queue, queueOptions);
    const clear = React.useCallback(() => controller.setText(''), [controller]);
    const clearOptions = React.useMemo(() => ({ enabled: composerInteractionsEnabled }), [composerInteractionsEnabled]);
    dependencies.useShortcut('composer.clear', clear, clearOptions);
    return React.useCallback(() => stableSubmit(), [stableSubmit]);
  };
}
