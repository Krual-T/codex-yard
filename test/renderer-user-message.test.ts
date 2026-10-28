import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transform } from 'esbuild';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { UserMessageBodyDependencies, UserMessageDependencies, UserMessageSystemHint } from '../src/renderer/messages/user-message.tsx';

const { code } = await transform(await readFile(new URL('../src/renderer/messages/user-message.tsx', import.meta.url), 'utf8'), {
  loader: 'tsx', format: 'esm', jsx: 'transform',
});
assert.doesNotMatch(code, /react\/jsx-runtime/);
const { createUserMessageBodyComponent, createUserMessageComponent } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
) as typeof import('../src/renderer/messages/user-message.tsx');

test('composes the original visible text, link context and Markdown props', () => {
  type Directives = { renderMentions: boolean };
  const captured: { props?: React.ComponentProps<UserMessageBodyDependencies<Directives>['Markdown']> } = {};
  const dependencies: UserMessageBodyDependencies<Directives> = {
    useExternalLinkConversationId: () => 'thread-1',
    CollapsibleContent: ({ text, children, collapsedLineCount, isAeonFormatted }) => React.createElement('section', {
      'data-lines': collapsedLineCount, 'data-compact': String(isAeonFormatted),
    }, typeof children === 'function' ? children(text.slice(0, 4)) : children),
    Markdown: props => { captured.props = props; return React.createElement('div', null, props.text); },
  };
  const Body = createUserMessageBodyComponent(React, dependencies);
  const markup = renderToStaticMarkup(React.createElement(Body, {
    text: 'abcdefgh', cwd: '/workspace', hostId: 'ssh-host', collapsedLineCount: 3,
    directives: { renderMentions: true }, hasSerializedParagraphs: true, isAeonFormatted: true,
    renderMath: false, serializeVisibleText: text => `[${text}]`,
  }));
  assert.match(markup, /data-lines="3" data-compact="true"/);
  assert.match(markup, /\[abcd\]/);
  assert.equal(captured.props?.text, '[abcd]');
  assert.equal(captured.props?.cwd, '/workspace');
  assert.equal(captured.props?.hostId, 'ssh-host');
  assert.equal(captured.props?.externalLinkContextMenuConversationId, 'thread-1');
  assert.equal(captured.props?.variant, 'user-message');
  assert.deepEqual(captured.props?.directives, { renderMentions: true });
});

test('renders user bubble, status chips and empty attachment-only messages', () => {
  const dependencies: UserMessageDependencies<object, { blockedCount: number }, UserMessageSystemHint[]> = {
    useScope: () => ({}), getThreadId: () => 'thread-1', useIsAeonFormatted: () => false,
    useCurrentUser: () => null, useEditDraft: () => null, setEditDraft: () => {}, useEditingDisabled: () => false,
    isEditingDisabled: () => false, useIntl: () => ({ formatMessage: ({ defaultMessage }) => defaultMessage }),
    useAnalytics: () => ({}), normalizeMessage: text => text, isPlanImplementationRequest: () => false,
    getCopyContent: () => null, toPlainText: text => text, copyToClipboard: async () => true,
    UserMessageBody: ({ text }) => React.createElement('div', { 'data-body': '' }, text),
    Editor: () => null,
    Button: ({ children, color, size, ...props }) => React.createElement('button', props, children),
    Tooltip: ({ children }) => React.createElement(React.Fragment, null, children),
    FormattedMessage: ({ defaultMessage }) => React.createElement(React.Fragment, null, defaultMessage),
    Timestamp: ({ sentAtMs }) => React.createElement('time', null, sentAtMs),
    HookStatsButton: () => null,
    CopyIcon: () => null, CopiedIcon: () => null, EditIcon: () => null,
    styles: { bubble: 'bubble', leadingBubble: 'leading', compactMessageReaction: 'reaction', compactMessageBubble: 'compact', compactMessageContainer: 'compact-container', otherUserMessage: 'other', accentedBubble: 'accented', temporaryBubble: 'temporary', temporaryOutline: 'outline' },
    classNames: (...classes) => classes.filter(Boolean).join(' '),
  };
  const Message = createUserMessageComponent(React, dependencies);
  const markup = renderToStaticMarkup(React.createElement(Message, {
    message: 'hello', threadId: 'thread-1', turnId: 'turn-1', onEditMessage: async () => {}, reviewMode: true,
  }));
  assert.match(markup, /data-user-message-bubble="true"/);
  assert.match(markup, /data-body="">hello/);
  assert.match(markup, /aria-label="Copy message"/);
  assert.match(markup, /aria-label="Edit message"/);
  assert.match(markup, /Review mode/);
  const attachmentOnly = renderToStaticMarkup(React.createElement(Message, { message: '', hasExternalAttachments: true }));
  assert.doesNotMatch(attachmentOnly, /data-user-message-bubble|\(No content\)/);
  const empty = renderToStaticMarkup(React.createElement(Message, { message: '' }));
  assert.match(empty, /\(No content\)/);
});
