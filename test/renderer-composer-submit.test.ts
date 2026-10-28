import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createComposerSubmitControls } from '../src/renderer/composer/composer-submit-controls.ts';
import type {
  ComposerShortcut,
  ComposerShortcutController,
  ComposerSubmitControlsDependencies,
  ComposerSubmitControlsProps,
  ComposerSubmitHandler,
} from '../src/renderer/composer/composer-submit-controls.ts';
import type { ComposerDocument } from '../src/renderer/composer/composer-types.ts';

interface RegisteredShortcut {
  handler: ComposerSubmitHandler;
  options: { enabled: boolean; keyboardHandler?: (event: KeyboardEvent) => boolean | void };
}

test('submit controls preserve shortcut routing, queue, dictation and keyboard priority', () => {
  const events: Array<unknown[]> = [];
  const registry = new Map<ComposerShortcut, RegisteredShortcut>();
  const document: ComposerDocument = { content: { size: 1 }, textBetween: () => 'x', descendants: () => {} };
  let focused = true;
  let multiline = false;
  let shouldSteer = false;
  const scope = { enterBehavior: 'enter' };
  const controller: ComposerShortcutController = {
    view: {
      hasFocus: () => focused,
      state: { doc: document, selection: { $from: { parent: { type: { name: 'paragraph' } } } } },
    },
    setText: text => events.push(['clear', text]),
  };
  const dependencies: ComposerSubmitControlsDependencies<typeof scope> = {
    useComposerScope: () => scope,
    useComposerController: () => controller,
    useShortcut: (name, handler, options) => { registry.set(name, { handler, options }); },
    useStableEvent: handler => handler,
    isShortcut: event => event.key === 'Enter' && event.ctrlKey,
    getEnterBehavior: current => current.enterBehavior,
    isMultilineDocument: () => multiline,
  };
  const useControls = createComposerSubmitControls(React, dependencies);
  const voice = {
    isDictationStarting: false, isDictating: false, isTranscribing: false,
    stopDictation: (action: 'send') => events.push(['dictation', action]),
  };
  const base: ComposerSubmitControlsProps = {
    backgroundSubmit: { enabled: true, onSubmit: () => events.push(['background']) },
    composerInteractionsEnabled: true, isResumePending: false,
    maybeSendQueuedSteerMessage: action => { events.push(['try-steer', action]); return shouldSteer; },
    submit: options => events.push(['submit', options]),
    submitButtonMode: 'submit', submitDisabled: false, voiceControls: voice,
  };
  let onSubmit: () => void = () => {};
  function Fixture(props: ComposerSubmitControlsProps): null {
    onSubmit = useControls(props);
    return null;
  }
  const render = (props: ComposerSubmitControlsProps) => {
    registry.clear();
    renderToStaticMarkup(React.createElement(Fixture, props));
    assert.deepEqual([...registry.keys()], [
      'composer.submitInBackground', 'composer.submit', 'composer.steer', 'composer.queue', 'composer.clear',
    ]);
  };
  const entry = (name: ComposerShortcut): RegisteredShortcut => {
    const result = registry.get(name);
    assert.ok(result);
    return result;
  };
  render(base);
  const completed = () => {};
  entry('composer.submit').handler(undefined, { onComposerSubmitted: completed });
  entry('composer.steer').handler();
  entry('composer.queue').handler();
  entry('composer.clear').handler();
  onSubmit();
  assert.deepEqual(events, [
    ['submit', { focusComposerAfterSubmit: true, onSubmitted: completed }],
    ['submit', { followUpSubmitAction: 'steer', focusComposerAfterSubmit: true }],
    ['submit', { followUpSubmitAction: 'queue', focusComposerAfterSubmit: true }],
    ['clear', ''],
    ['submit', { focusComposerAfterSubmit: true, onSubmitted: undefined }],
  ]);
  events.length = 0;
  shouldSteer = true;
  entry('composer.submit').handler('codex_micro_hid');
  assert.deepEqual(events, [['try-steer', 'steer']]);
  events.length = 0;
  shouldSteer = false;
  entry('composer.submit').handler('codex_micro_hid');
  assert.deepEqual(events, [['try-steer', 'steer'], ['submit', { focusComposerAfterSubmit: true, onSubmitted: undefined }]]);

  const keyboard = entry('composer.submitInBackground').options.keyboardHandler!;
  const commandEnter = { key: 'Enter', ctrlKey: true } as KeyboardEvent;
  focused = false;
  assert.equal(keyboard(commandEnter), false);
  focused = true;
  controller.view.state.selection.$from.parent.type.name = 'code_block';
  assert.equal(keyboard(commandEnter), false);
  controller.view.state.selection.$from.parent.type.name = 'paragraph';
  scope.enterBehavior = 'cmdAlways';
  assert.equal(keyboard(commandEnter), false);
  scope.enterBehavior = 'cmdIfMultiline';
  multiline = true;
  assert.equal(keyboard(commandEnter), false);
  multiline = false;
  assert.equal(keyboard(commandEnter), undefined);

  events.length = 0;
  render({ ...base, submitDisabled: true, voiceControls: { ...voice, isTranscribing: true } });
  assert.equal(entry('composer.submitInBackground').options.enabled, false);
  assert.equal(entry('composer.submit').options.enabled, true);
  assert.equal(entry('composer.queue').options.enabled, false);
  entry('composer.submit').handler();
  assert.deepEqual(events, [['dictation', 'send']]);

  events.length = 0;
  render({ ...base, isResumePending: true });
  assert.equal(entry('composer.submit').options.enabled, false);
  assert.equal(entry('composer.steer').options.enabled, false);
  entry('composer.submit').handler();
  assert.deepEqual(events, []);
  render({ ...base, submitButtonMode: 'stop' });
  assert.equal(entry('composer.queue').options.enabled, false);
  entry('composer.submit').handler();
  assert.deepEqual(events, []);
  render({ ...base, composerInteractionsEnabled: false });
  assert.equal(entry('composer.submit').options.enabled, false);
  assert.equal(entry('composer.clear').options.enabled, false);
});
