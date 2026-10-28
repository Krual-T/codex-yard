import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transform } from 'esbuild';
import * as React from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AssistantMessageActionsDependencies, AssistantMessageActionsProps } from '../src/renderer/messages/assistant-message-actions.tsx';
import type { AssistantMessageDependencies, AssistantMessageDomain, AssistantMessageItem, AssistantMessageProps } from '../src/renderer/messages/assistant-message.tsx';

async function load(path: string) {
  const { code } = await transform(await readFile(new URL(path, import.meta.url), 'utf8'), { loader: 'tsx', format: 'esm', jsx: 'transform' });
  assert.doesNotMatch(code, /react\/jsx-runtime/);
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
const { createAssistantMessageActionsComponent } = await load('../src/renderer/messages/assistant-message-actions.tsx') as typeof import('../src/renderer/messages/assistant-message-actions.tsx');
const { createAssistantMessageComponent } = await load('../src/renderer/messages/assistant-message.tsx') as typeof import('../src/renderer/messages/assistant-message.tsx');
const vendor = await readFile(new URL('../vendor/codex-app/26.1013.40934/webview/assets/sites-end-resource-b11586198b69.js', import.meta.url), 'utf8');
const runtime = { jsx, jsxs, Fragment: React.Fragment };
const cache = { c: (size: number) => Array(size).fill(Symbol.for('react.memo_cache_sentinel')) };
const classes = (...values: (string | false | null | undefined)[]) => values.filter(Boolean).join(' ');
const intl = { formatMessage: ({ defaultMessage }: { defaultMessage: string }) => defaultMessage };

function original(start: string, end: string, bindings: Record<string, unknown>) {
  assert.equal(vendor.split(start).length, 2);
  assert.equal(vendor.split(end).length, 2);
  const begin = vendor.indexOf(start);
  const finish = vendor.indexOf(end, begin) + end.length;
  assert.ok(finish > begin);
  return new Function(...Object.keys(bindings), `return (${vendor.slice(begin, finish)})`)(...Object.values(bindings)) as React.ComponentType<never>;
}

type Stats = { rejectedCount: number };
type Hook = { runs: number };
type Memory = { path: string; lineStart: number; lineEnd: number; note: string };
type Goal = { id: string };
type ActionProps = AssistantMessageActionsProps<Stats, Hook, Memory, Goal>;

function actionFixture() {
  const calls: { copies: unknown[]; analytics: unknown[]; succeeded: string[]; copy?: (event: React.MouseEvent<HTMLButtonElement>) => Promise<boolean> } = {
    copies: [], analytics: [], succeeded: [],
  };
  let success = true;
  const analytics = { submitCodexAnalyticsEvent: (event: unknown) => { calls.analytics.push(event); } };
  const CopyButton: AssistantMessageActionsDependencies<Stats, Hook, Memory, Goal>['CopyButton'] = ({ buttonText, onCopy }) => {
    calls.copy = onCopy;
    return React.createElement('button', { 'aria-label': buttonText }, 'copy');
  };
  const Feedback: AssistantMessageActionsDependencies<Stats, Hook, Memory, Goal>['Feedback'] = ({ turnId }) => React.createElement('b', null, `feedback:${turnId}`);
  const RejectedReview: AssistantMessageActionsDependencies<Stats, Hook, Memory, Goal>['RejectedReview'] = ({ stats }) => React.createElement('b', null, `rejected:${stats.rejectedCount}`);
  const OverflowMenu: AssistantMessageActionsDependencies<Stats, Hook, Memory, Goal>['OverflowMenu'] = ({ forkLabel, open }) => React.createElement('i', null, `${forkLabel}:${open}`);
  const CompletedGoal: AssistantMessageActionsDependencies<Stats, Hook, Memory, Goal>['CompletedGoal'] = ({ goal }) => React.createElement('b', null, goal.id);
  const Timestamp: AssistantMessageActionsDependencies<Stats, Hook, Memory, Goal>['Timestamp'] = ({ sentAtMs }) => React.createElement('time', null, sentAtMs);
  const deps: AssistantMessageActionsDependencies<Stats, Hook, Memory, Goal> = {
    useIntl: () => intl, useAnalytics: () => analytics, useFeedbackEnabled: () => true,
    toPlainText: text => `plain:${text}`, copyToClipboard: async content => { calls.copies.push(content); return success; },
    CopyButton, Feedback, RejectedReview, OverflowMenu, CompletedGoal, Timestamp, classNames: classes,
  };
  const New = createAssistantMessageActionsComponent(React, deps);
  const Old = original('function Jx(e){let t=(0,$x.c)(52),', 't[46]=M,t[47]=fe,t[48]=pe,t[49]=me,t[50]=W,t[51]=he):he=t[51],he}', {
    $x: cache, eS: React, tS: runtime, Me: deps.useIntl, Fe: (atom: string) => atom === 'analytics' ? analytics : true,
    Ns: 'analytics', Ts: 'feedback', iS: [], J: classes, a_: Feedback, kr: CopyButton, Es: deps.toPlainText,
    Qn: deps.copyToClipboard, Yy: RejectedReview, Ax: OverflowMenu, Yx: CompletedGoal, Xg: Timestamp,
  }) as React.ComponentType<ActionProps>;
  return { New, Old, calls, fail: () => { success = false; } };
}

test('assistant action row matches the original across visibility, feedback, timestamps and menus', async () => {
  const fixture = actionFixture();
  const cases: ActionProps[] = [
    { threadId: 'thread' },
    { threadId: 'thread', sentAtMs: 123, showTimestampWithoutActions: true, timestampHoverOnly: true },
    { threadId: 'thread', turnId: 'turn', copyText: ' response ', sentAtMs: 123, autoReviewStats: { rejectedCount: 2 },
      completedThreadGoal: { id: 'goal' }, additionalActions: [React.createElement('b', { key: 'a' }, 'additional')], onFork: () => {} },
    { threadId: 'thread', copyText: '  ', tooltipSide: 'bottom', browserRatingControls: React.createElement('span'), endAction: 'end' },
    { threadId: 'thread', persistentAdditionalActions: ['persistent'], alwaysShowActions: true, overflowActions: 'overflow' },
  ];
  for (const props of cases) assert.equal(renderToStaticMarkup(React.createElement(fixture.New, props)), renderToStaticMarkup(React.createElement(fixture.Old, props)));
  renderToStaticMarkup(React.createElement(fixture.New, { threadId: 'thread', turnId: 'turn', copyText: 'original',
    getCopyText: () => 'selection', getCopyHtml: () => '<b>selection</b>', onCopySucceeded: text => fixture.calls.succeeded.push(text) }));
  assert.ok(fixture.calls.copy);
  assert.equal(await fixture.calls.copy({} as React.MouseEvent<HTMLButtonElement>), true);
  assert.deepEqual(fixture.calls.copies, [{ 'text/plain': 'plain:selection', 'text/html': '<b>selection</b>' }]);
  assert.deepEqual(fixture.calls.succeeded, ['plain:selection']);
  assert.deepEqual(fixture.calls.analytics, [{ action: 'copy', eventKind: 'action', metadata: { surface: 'assistant_message' }, threadId: 'thread', turnId: 'turn' }]);
  fixture.fail();
  assert.equal(await fixture.calls.copy({} as React.MouseEvent<HTMLButtonElement>), false);
  assert.deepEqual(fixture.calls.succeeded, ['plain:selection']);
});

type Domain = AssistantMessageDomain & {
  autoReviewStats: Stats; hookStats: Hook; memoryCitation: Memory; goal: Goal;
  automationArguments: { id?: string }; automationResult: { ok: boolean };
  responseAnnotation: { text: string }; handoff: { id: string }; completedResult: string;
  outputFileLinks: { output?: string }; visualizationPaths: { file: string }; fileOpenTarget: string;
  visualizationTrigger: string; intl: typeof intl; markdownComponents: { compact: boolean };
  markdownToken: { type: string }; deliveryAction: string;
};

function messageFixture() {
  const state = { aeon: false, formatted: false, nativeEnabled: false, feature: false, browser: true, route: 'local-thread' };
  const captured: { markdown?: React.ComponentProps<AssistantMessageDependencies<Domain>['Markdown']>; actions?: ActionProps } = {};
  const Scope = { value: { routeKind: 'local-thread', routeTemplate: '/thread/:conversationId', conversationId: 'thread' } };
  const Markdown: AssistantMessageDependencies<Domain>['Markdown'] = props => { captured.markdown = props; return React.createElement('article', { 'data-streaming': String(props.isStreaming) }, props.children); };
  const StreamingProvider: AssistantMessageDependencies<Domain>['StreamingProvider'] = ({ children }) => React.createElement(React.Fragment, null, children);
  const Actions: AssistantMessageDependencies<Domain>['Actions'] = props => { captured.actions = props; return React.createElement('footer', { 'data-copy': props.copyText }, props.turnId); };
  const AnnotationAction: AssistantMessageDependencies<Domain>['AnnotationAction'] = () => React.createElement('i', null, 'annotation');
  const ShareAction: AssistantMessageDependencies<Domain>['ShareAction'] = () => React.createElement('i', null, 'share');
  const AutomationCitation: AssistantMessageDependencies<Domain>['AutomationCitation'] = ({ elicitation }) => React.createElement('i', null, `citation:${elicitation.itemId}`);
  const CommentDirective: AssistantMessageDependencies<Domain>['CommentDirective'] = () => null;
  const DeliveryAction: AssistantMessageDependencies<Domain>['DeliveryAction'] = () => React.createElement('b', null, 'delivery action');
  const DeliveredMessage: AssistantMessageDependencies<Domain>['DeliveredMessage'] = ({ text }) => React.createElement('b', null, `delivered:${text}`);
  const NativeMessage: AssistantMessageDependencies<Domain>['NativeMessage'] = () => React.createElement('b', null, 'native');
  const Reveal: AssistantMessageDependencies<Domain>['Reveal'] = ({ children, className, reveal }) => React.createElement('div', { className, 'data-reveal': String(reveal) }, children);
  const Speaker: AssistantMessageDependencies<Domain>['Speaker'] = () => React.createElement('b', null, 'assistant');
  const ExternalDeliveryStatus: AssistantMessageDependencies<Domain>['ExternalDeliveryStatus'] = () => React.createElement('i', null, 'delivery status');
  const LiveRegion: AssistantMessageDependencies<Domain>['LiveRegion'] = ({ input }) => React.createElement('span', { 'data-live': input.content });
  const Spinner: AssistantMessageDependencies<Domain>['Spinner'] = () => React.createElement('i', null, 'spinner');
  const Timestamp: AssistantMessageDependencies<Domain>['Timestamp'] = ({ sentAtMs }) => React.createElement('time', null, sentAtMs);
  const ComputerHandoff: AssistantMessageDependencies<Domain>['ComputerHandoff'] = () => React.createElement('i', null, 'handoff');
  const CompletedResults: AssistantMessageDependencies<Domain>['CompletedResults'] = ({ results }) => React.createElement('i', null, results.join(','));
  const deps: AssistantMessageDependencies<Domain> = {
    useScope: () => { Scope.value.routeKind = state.route; return Scope; }, useIntl: () => intl, useBrowserEnabled: () => state.browser,
    useIsAeon: () => state.aeon, useAeonFormatting: () => state.formatted, useAeonReveal: () => null,
    useNativeMessageEnabled: () => state.nativeEnabled, useNativeMessageFeature: () => state.feature,
    getDeliveryAction: item => item.delivery === 'test-action' ? 'action' : null,
    describeDelivery: (text, count) => `${text}:${count}`, deliveryActionText: () => 'action',
    prepareCopyText: text => text, formatDisplayContent: content => content,
    hasAutomationCitationMarker: content => content.includes(':automation'),
    formatAutomationCitation: (_, index) => `:automation{index="${index}"}`,
    extractCompletedResults: content => content.includes('result') ? ['result'] : [],
    createFileDirectives: () => ({ file: true }), shouldRenderOutputPath: () => true,
    createFollowupDirectives: () => ({ followup: true }), createAnnotationDirectives: () => ({ annotation: true }),
    resolveAutomationCitation: ({ automationCitations }) => automationCitations[0] ?? null,
    directiveNames: { comment: 'comment', writing: 'writing', automation: 'automation', other: 'other' },
    writingDirective: 'writing', otherDirective: 'other', CommentDirective, AutomationCitation,
    formatMarkdown: content => content, attachOutputLinks: content => content,
    getSelectionContent: () => ({ plainText: 'selection', htmlText: '<b>selection</b>' }), shouldOfferAnnotation: () => false,
    AnnotationAction, ShareAction, markdownComponentsForAeon: { compact: true }, savedContentBackend: 'backend',
    isDurableHost: () => false, renderCompactRoot: (tokens, renderTokens) => renderTokens(tokens), Markdown, StreamingProvider, DeliveryAction,
    DeliveredMessage, NativeMessage, Reveal, getAnnouncementContent: content => content,
    trimStreamingAnnouncement: content => content, mergeRefs: ref => ref, shimmerRef: null,
    annotationDataAttributes: { conversationId: 'data-conversation', messageId: 'data-message' },
    formatTimestampTitle: (_, sentAtMs) => `time:${sentAtMs}`, Speaker, ExternalDeliveryStatus, LiveRegion, Spinner,
    Timestamp, ComputerHandoff, CompletedResults, Actions,
    styles: { activeCommentary: 'shimmer', compactMessageBody: 'compact-body', compactMessageBubble: 'compact', compactMessageBubbleWithAttachment: 'with-attachment' }, classNames: classes,
  };
  const New = createAssistantMessageComponent(React, deps);
  const atom = { browser: 'browser', aeon: 'aeon', format: 'format', reveal: 'reveal', native: 'native' };
  const V = (key: string | null) => key === atom.browser ? { isCapable: state.browser } : key === atom.aeon ? state.aeon
    : key === atom.format ? state.formatted : key === atom.native ? state.nativeEnabled : null;
  const Old = original('function zx(e){let t=(0,$x.c)(284),', 't[275]=kt,t[276]=At,t[277]=jt,t[278]=Mt,t[279]=Nt,t[280]=Pt,t[281]=Lt,t[282]=Rt,t[283]=zt):zt=t[283],zt}', {
    $x: cache, eS: React, tS: runtime, Se: deps.useScope, Jc: 'scope', Me: deps.useIntl, V, Hl: atom.browser, oS: atom.aeon,
    up: atom.format, xa: atom.reveal, Ed: atom.native, Fe: () => state.feature, Jd: 'feature', Zs: deps.getDeliveryAction,
    Ib: deps.describeDelivery, zb: deps.deliveryActionText, fd: (value: string) => value, Uc: (value: string) => value,
    il: (_a: unknown, _b: unknown, value: string) => value, rx: (value: string) => value, _g: (value: string) => value,
    Xd: (value: string) => value, ba: (value: string) => value, gi: (value: string) => value, Uf: deps.shouldRenderOutputPath,
    rS: [], iS: [], Xx: deps.hasAutomationCitationMarker, fc: deps.formatDisplayContent, Vx: deps.formatAutomationCitation,
    ib: deps.extractCompletedResults, Bx: (entry: Memory) => entry.path.trim().length > 0, Pf: deps.createFileDirectives,
    Nu: 'automation', Zx: deps.resolveAutomationCitation, kh: AutomationCitation, Td: 'comment', Mb: CommentDirective,
    Dx: deps.createFollowupDirectives, nx: deps.createAnnotationDirectives, Rc: 'writing', nS: 'writing', qy: 'other', Wy: 'other',
    Hi: deps.getSelectionContent, Ef: deps.shouldOfferAnnotation, ob: AnnotationAction, Qb: ShareAction, km: deps.attachOutputLinks,
    ou: (value: string) => value, J: classes, Lx: { activeCommentary: 'shimmer' }, lh: deps.markdownComponentsForAeon,
    ds: { CHATGPT_CONTENT_REFERENCE_SAVED_CONTENT_BACKEND_APP_SERVER: 'backend' }, As: () => 'local', ch: deps.renderCompactRoot,
    qu: Markdown, rs: StreamingProvider, Hb: DeliveryAction, qb: DeliveredMessage, xh: NativeMessage,
    ka: deps.styles, Zh: Reveal, Fo: deps.getAnnouncementContent, Nn: null, Bn: deps.mergeRefs, li: 'data-conversation',
    ff: 'data-message', Kg: ({ sentAtMs }: { sentAtMs: number }) => `time:${sentAtMs}`, qh: Speaker, _y: ExternalDeliveryStatus,
    Wx: LiveRegion, Vd: deps.trimStreamingAnnouncement, Xn: Spinner, Xg: Timestamp, Zm: ComputerHandoff,
    xx: CompletedResults, Jx: Actions, Ux: () => true, Hx: (animation: Animation) => animation.finished,
  }) as React.ComponentType<AssistantMessageProps<Domain>>;
  return { New, Old, state, captured };
}

test('local assistant parent matches original completed, streaming, attachment and delivery branches', () => {
  const fixture = messageFixture();
  const base: AssistantMessageItem<Domain> = { type: 'assistant-message', content: 'response', completed: true, searchItemId: 'item' };
  const cases: AssistantMessageProps<Domain>[] = [
    { item: base, conversationId: 'thread', turnId: 'turn', assistantCopyText: 'response', cwd: '/repo', hostId: 'ssh', markdownMediaCacheKey: 'cache' },
    { item: { ...base, completed: false }, conversationId: 'thread', turnId: 'turn', assistantCopyText: 'response', allowCopyWhileStreaming: true },
    { item: { ...base, completed: false, renderPlaceholderWhileStreaming: true }, conversationId: 'thread', assistantCopyText: 'response' },
    { item: { ...base, content: 'result', sentAtMs: 123, responseAnnotationTargetId: 'message' }, conversationId: 'thread', turnId: 'turn', assistantCopyText: 'result', showTimestampHeader: true, after: 'after' },
    { item: { ...base, delivery: 'test-action', externalDelivery: { attachmentCount: 2 } }, conversationId: 'thread' },
    { item: { ...base, externalDelivery: { state: 'accepted', attachmentCount: 1 }, nativeMessage: { roomId: 'room', messageId: 'native' } }, conversationId: 'thread' },
    { item: { ...base, automationCitations: [{ arguments: { id: 'auto' }, result: { ok: true }, callId: 'call' }] }, conversationId: 'thread', turnId: 'turn', assistantCopyText: 'response' },
  ];
  const snapshot = () => ({ markdown: fixture.captured.markdown, actions: fixture.captured.actions });
  for (const props of cases) {
    fixture.captured.markdown = undefined; fixture.captured.actions = undefined;
    const actual = renderToStaticMarkup(React.createElement(fixture.New, props));
    const actualCaptured = snapshot();
    fixture.captured.markdown = undefined; fixture.captured.actions = undefined;
    const expected = renderToStaticMarkup(React.createElement(fixture.Old, props));
    const expectedCaptured = snapshot();
    assert.equal(actual, expected);
    assert.equal(actualCaptured.markdown?.children, expectedCaptured.markdown?.children);
    assert.deepEqual(actualCaptured.markdown?.buffering, expectedCaptured.markdown?.buffering);
    assert.equal(actualCaptured.actions?.copyText, expectedCaptured.actions?.copyText);
  }
  fixture.state.aeon = true; fixture.state.formatted = true;
  const compact = { item: base, conversationId: 'thread', compactAttachment: React.createElement('span', null, 'attachment') };
  assert.equal(renderToStaticMarkup(React.createElement(fixture.New, compact)), renderToStaticMarkup(React.createElement(fixture.Old, compact)));
});
