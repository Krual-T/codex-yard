import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsxRuntime from 'react/jsx-runtime';
import type { TaskRowDependencies, TaskRowProps } from '../src/renderer/shared/task-row-types.ts';
import type { SidebarConversationRowProps } from '../src/renderer/sidebar/conversation-row.tsx';

const appSource = readFileSync(new URL(
  '../vendor/codex-app/26.1013.40934/webview/assets/app-initial-a68277f60b93.js', import.meta.url,
), 'utf8');

function pinnedFunction(start: string, end: string): string {
  const from = appSource.indexOf(start);
  const to = appSource.indexOf(end);
  assert.ok(from >= 0 && to > from && appSource.lastIndexOf(start) === from && appSource.lastIndexOf(end) === to);
  return appSource.slice(from, to + end.length);
}

const taskRowSource = pinnedFunction(
  'function GTc(e){', 't[272]=fee,t[273]=pee,t[274]=Or,t[275]=mee):mee=t[275],mee}',
);
const conversationRowSource = pinnedFunction(
  'function vEc(e){', 't[13]=i,t[14]=l,t[15]=u,t[16]=d):d=t[16],d}',
);

async function loadFactories() {
  const built = await build({
    entryPoints: ['src/renderer/shared/task-row.tsx', 'src/renderer/sidebar/conversation-row.tsx'],
    outdir: 'out', bundle: true, format: 'esm', platform: 'browser', write: false, metafile: true,
  });
  assert.deepEqual(Object.keys(built.metafile.inputs).sort(), [
    'src/renderer/shared/task-row.tsx', 'src/renderer/sidebar/conversation-row.tsx',
  ]);
  assert.deepEqual(Object.values(built.metafile.outputs).flatMap(output => output.imports), []);
  const importOutput = async (name: string) => {
    const file = built.outputFiles.find(output => output.path.endsWith(`/${name}.js`));
    assert.ok(file);
    return import(`data:text/javascript;base64,${Buffer.from(file.contents).toString('base64')}`);
  };
  return {
    taskRow: await importOutput('task-row') as typeof import('../src/renderer/shared/task-row.tsx'),
    conversationRow: await importOutput('conversation-row') as typeof import('../src/renderer/sidebar/conversation-row.tsx'),
  };
}

function createDependencies(): TaskRowDependencies {
  const modeAtom = Symbol('mode');
  const cloudAtom = Symbol('cloud');
  return {
    classNames: (...values) => values.filter(Boolean).join(' '),
    useAtomValue: atom => atom === modeAtom ? 'codex' : false,
    cloudEnvironmentAtom: cloudAtom,
    productModeAtom: modeAtom,
    isPlatform: ({ electron }) => electron === true,
    focusApp: () => {},
    isFileTransfer: () => true,
    onFileDragLeave: () => {},
    isImmediateHoverTarget: () => false,
    pulseRef: () => {},
    actionRailClassName: 'official-action-rail',
    endRailClassName: 'official-end-rail',
    inlineTitleSuffixClassName: 'official-inline-suffix',
    endIconWidth: 20,
    endIconGap: 8,
    endIconPadding: 8,
    errorAsset: 'error',
    RowRoot: ({ children, className, isActive, isDisabled, isHighlighted, multiline, variant,
      'aria-label': label, 'aria-labelledby': labelledBy, 'aria-describedby': describedBy,
      'data-title-aligned-trailing-rail': aligned, ...rest }) => React.createElement('div', {
      className, 'data-active': isActive, 'data-disabled': isDisabled, 'data-highlighted': isHighlighted,
      'data-multiline': multiline, 'data-variant': variant, 'data-title-aligned-trailing-rail': aligned,
      'aria-label': label, 'aria-labelledby': labelledBy, 'aria-describedby': describedBy,
      'data-test-row': (rest as Record<string, unknown>)['data-test-row'] as string | undefined,
    }, children),
    Indent: ({ children, indentLevel }) => React.createElement('div', { 'data-indent': indentLevel }, children),
    AnimatedTitle: ({ children, ...props }) => React.createElement('span', {
      id: props.id, className: props.className, 'data-thread-title': props['data-thread-title'],
      'data-thread-secondary-title': props['data-thread-secondary-title'],
      'data-animated': props.animateOnGroupHover,
    }, children),
    TitleContent: ({ children }) => React.createElement(React.Fragment, null, children),
    InlineBadges: ({ chips, iconBadges, envIconNode, className, hideInlineBadges }) => React.createElement('div', {
      className, 'data-inline-chips': chips.length, 'data-inline-icons': iconBadges.length, 'data-hide-inline': hideInlineBadges,
    }, envIconNode),
    EndBadges: ({ className, iconBadges, leadingIconNodes, trailingIconNodes }) => React.createElement('div', {
      className, 'data-end-icons': iconBadges.length,
    }, [...leadingIconNodes, ...trailingIconNodes].map((node, index) => React.createElement(React.Fragment, { key: index }, node))),
    Metadata: ({ className, content, metaState }) => React.createElement('small', { className, 'data-meta-state': metaState }, content),
    EnvironmentIcon: ({ className, envType, hostId }) => React.createElement('i', { className, 'data-env': envType, 'data-host': hostId }),
    StatusIndicator: ({ statusState }) => React.createElement('i', { 'data-status': statusState.type }),
    StatusPill: ({ label, onClick }) => React.createElement('span', { 'data-pill-clickable': onClick != null }, label),
    ArchiveAction: ({ archiveAriaLabel }) => React.createElement('button', { 'aria-label': archiveAriaLabel }, 'archive'),
    ArchiveConfirm: ({ label }) => React.createElement('button', null, label ?? 'confirm'),
    ActionRail: ({ className, trailingAction }) => React.createElement('div', { className }, trailingAction),
    PinnedIcon: ({ icon }) => React.createElement('div', { 'data-pinned': true }, icon),
    DefaultPinIcon: () => React.createElement('i', { 'data-pin-icon': true }),
    Icon: ({ className }) => React.createElement('i', { className, 'data-error': true }),
    FormattedMessage: ({ defaultMessage }) => React.createElement(React.Fragment, null, defaultMessage),
    Tooltip: ({ children, tooltipContent, disabled, disableHoverOpen, side, align }) => React.createElement('div', {
      'data-tooltip': true, 'data-tooltip-disabled': disabled, 'data-tooltip-hover-disabled': disableHoverOpen,
      'data-side': side, 'data-align': align,
    }, children, React.createElement('aside', null, tooltipContent)),
  };
}

function originalTaskRow(deps: TaskRowDependencies) {
  return runInNewContext(`(${taskRowSource})`, {
    sEc: { c: () => Array(276).fill(Symbol.for('react.memo_cache_sentinel')) },
    cEc: React, O2: jsxRuntime, Wc: deps.classNames, G: deps.useAtomValue,
    oR: deps.cloudEnvironmentAtom, iR: deps.productModeAtom, uMs: deps.isPlatform,
    Cc: deps.focusApp, E2o: deps.isFileTransfer, KTc: deps.onFileDragLeave,
    tEc: deps.isImmediateHoverTarget, qTc: (item: unknown) => item != null,
    Nc: deps.pulseRef, dEc: deps.actionRailClassName, fEc: deps.endRailClassName,
    UTc: { inlineTitleSuffix: deps.inlineTitleSuffixClassName },
    pEc: deps.endIconWidth, mEc: deps.endIconGap, hEc: deps.endIconPadding,
    dae: deps.errorAsset, eTc: deps.RowRoot, iTc: deps.Indent, zwc: deps.AnimatedTitle,
    $Io: deps.TitleContent, JTc: deps.InlineBadges, ZTc: deps.EndBadges, nEc: deps.Metadata,
    jTc: deps.EnvironmentIcon, w2: deps.StatusIndicator, XTc: deps.StatusPill,
    iEc: deps.ArchiveAction, rEc: deps.ArchiveConfirm, FTc: deps.ActionRail,
    Q$: deps.PinnedIcon, zwe: deps.DefaultPinIcon, Pi: deps.Icon, W: deps.FormattedMessage, Sl: deps.Tooltip,
  }) as React.ComponentType<TaskRowProps>;
}

test('shared task row preserves pinned layout, state and action contracts across variants', async () => {
  const { taskRow } = await loadFactories();
  const deps = createDependencies();
  const original = originalTaskRow(deps);
  const migrated = taskRow.createTaskRowComponent(React, deps);
  const onClick = () => {};
  const badge = { id: 'pr', icon: React.createElement('i', null, 'pr') };
  const cases: TaskRowProps[] = [
    { title: 'Ordinary conversation', onClick, statusState: { type: 'idle' }, variant: 'sidebar',
      dataAttributes: { 'data-test-row': 'ordinary' }, hoverCardContent: 'conversation details' },
    { title: 'Unread', onClick, statusState: { type: 'idle', unread: true, unreadCount: 2 }, variant: 'sidebar',
      isActive: true, icon: 'project', idleStatusIndicatorNode: 'idle', indicatorRestNode: 'pin',
      indicatorHoverNode: 'unpin', reserveLeadingSlot: true, metaContent: '2h', useStableTrailingRail: true },
    { title: 'Running', onClick, statusState: { type: 'loading' }, variant: 'sidebar', metaContent: '1m',
      statusIndicatorReplacesMeta: true, onArchive: () => {}, archiveAriaLabel: 'Archive',
      renderActions: ({ requestArchive }) => React.createElement('button', { onClick: requestArchive ?? undefined }, 'Actions'),
      titlePrefix: 'prefix', titleSuffix: 'suffix', titleSuffixPosition: 'inline' },
    { title: 'Disabled', onClick, statusState: { type: 'error' }, variant: 'tableRow', disabled: true,
      allowActionsWhenDisabled: true, primaryAction: 'action', metaContent: 'details', chips: [{ id: 'chip', label: 'team' }],
      iconBadges: [badge], envType: 'remote', hostId: 'fixture-host' },
    { title: 'Avatar', onClick, statusState: { type: 'idle' }, variant: 'sidebarAvatar', icon: 'avatar',
      secondaryLine: 'secondary', alignTrailingRailToTitle: true, secondaryLineWraps: false,
      overlayMetaContent: 'overlay', statusPill: { label: 'Running', onClick: () => {} }, titleSuffix: 'shortcut' },
    { title: 'Pinned', onClick, statusState: { type: 'error' }, variant: 'sidebarPinned', floatStatusIconsEnd: true,
      iconBadges: [badge], idleIndicatorNode: 'idle', envType: 'remote-worktree', hostId: 'fixture-host',
      metaContent: '4h', onArchive: () => {}, indentLevel: 1 },
    { title: 'Shared row', onClick, statusState: { type: 'idle' }, variant: 'default',
      titleSuffix: 'suffix', metaContent: 'date', chips: [{ id: 'one', label: 'One' }], hideInlineBadgesOnHover: true },
  ];
  for (const props of cases) {
    const expected = renderToStaticMarkup(React.createElement(original, props));
    const actual = renderToStaticMarkup(React.createElement(migrated, props));
    assert.equal(actual, expected, `${props.variant}: ${String(props.title)}`);
  }
});

test('conversation row preserves the upstream secondary title and default variant', async () => {
  const { conversationRow } = await loadFactories();
  const deps = createDependencies();
  const row = originalTaskRow(deps);
  const original = runInNewContext(`(${conversationRowSource})`, {
    yEc: { c: () => Array(17).fill(Symbol.for('react.memo_cache_sentinel')) },
    bEc: jsxRuntime, GTc: row, zwc: deps.AnimatedTitle, Wc: deps.classNames,
  }) as React.ComponentType<SidebarConversationRowProps>;
  const migrated = conversationRow.createSidebarConversationRowComponent(React, {
    TaskRow: row, AnimatedTitle: deps.AnimatedTitle, classNames: deps.classNames,
  });
  const base = { title: 'Conversation', onClick: () => {}, statusState: { type: 'idle' } };
  const cases: SidebarConversationRowProps[] = [
    base,
    { ...base, secondaryContent: 'Worktree details' },
    { ...base, variant: 'sidebarAvatar', secondaryContent: 'Wrapped details' },
    { ...base, variant: 'sidebarAvatar', secondaryContent: 'Scrolling details', wrapSecondaryContent: false },
    { ...base, variant: 'tableRow', secondaryContent: 'Two lines', wrapSecondaryContent: true },
  ];
  for (const props of cases) {
    assert.equal(
      renderToStaticMarkup(React.createElement(migrated, props)),
      renderToStaticMarkup(React.createElement(original, props)),
      `${String(props.variant)} / ${String(props.secondaryContent)}`,
    );
  }
});

const chromePath = '/usr/bin/google-chrome';
test('row selection, archive confirmation, menu and file drops retain their event boundaries', {
  skip: !existsSync(chromePath) && 'Google Chrome is unavailable; pinned rendering checks still run',
}, async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import * as React from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { createTaskRowComponent } from './src/renderer/shared/task-row.tsx';
        const mode = Symbol('mode');
        const dependencies = {
          classNames: (...values) => values.filter(Boolean).join(' '),
          useAtomValue: atom => atom === mode ? 'codex' : false,
          cloudEnvironmentAtom: Symbol('cloud'), productModeAtom: mode,
          isPlatform: ({electron}) => electron === true,
          focusApp: () => { window.rowEvents.focus += 1; },
          isFileTransfer: data => Array.from(data.types).includes('Files'),
          onFileDragLeave: event => { delete event.currentTarget.dataset.fileDropActive; },
          isImmediateHoverTarget: () => false, pulseRef: () => {},
          actionRailClassName: 'action-rail', endRailClassName: 'end-rail', inlineTitleSuffixClassName: 'suffix',
          endIconWidth: 20, endIconGap: 8, endIconPadding: 8, errorAsset: 'error',
          RowRoot: ({children, isDisabled, onPress, onClick, onDoubleClick, onDragEnter, onDragOver, onDragLeave, onDrop, onPointerLeave}) =>
            React.createElement('div', {id:'row', role:'button', tabIndex:0, onClick: event => {
              onClick(event); if (!isDisabled && !event.defaultPrevented) onPress?.(event);
            }, onDoubleClick, onDragEnter, onDragOver, onDragLeave, onDrop, onPointerLeave}, children),
          Indent: ({children}) => children,
          AnimatedTitle: ({children, id, className}) => React.createElement('span', {id, className}, children),
          TitleContent: ({children}) => children,
          InlineBadges: () => null, EndBadges: () => null, Metadata: ({content}) => React.createElement('span', null, content),
          EnvironmentIcon: () => null, StatusIndicator: () => null, StatusPill: () => null,
          ArchiveAction: ({onArchive}) => React.createElement('button', {id:'archive', onClick:event => {
            event.stopPropagation(); onArchive();
          }}, 'Archive'),
          ArchiveConfirm: ({onConfirm}) => React.createElement('button', {id:'confirm', onClick:onConfirm}, 'Confirm'),
          ActionRail: ({trailingAction}) => trailingAction, PinnedIcon: ({icon}) => icon,
          DefaultPinIcon: () => null, Icon: () => null, FormattedMessage: ({defaultMessage}) => defaultMessage,
          Tooltip: ({children, disableHoverOpen}) => React.createElement('div', {'data-hover-locked':String(disableHoverOpen)}, children),
        };
        const TaskRow = createTaskRowComponent(React, dependencies);
        const root = createRoot(document.getElementById('root'));
        window.rowEvents = {select:0, focus:0, archive:0, double:0, drop:0};
        window.renderRow = ({disabled = false, menu = false} = {}) => flushSync(() => root.render(React.createElement(TaskRow, {
          title:'Fixture conversation', variant:'sidebar', statusState:{type:'idle'}, disabled,
          allowActionsWhenDisabled:true, hoverCardContent:'Details', metaContent:'2h',
          onClick:() => { window.rowEvents.select += 1; },
          onArchive:() => { window.rowEvents.archive += 1; },
          onDoubleClick:() => { window.rowEvents.double += 1; },
          onFileDrop:() => { window.rowEvents.drop += 1; },
          renderActions: menu ? ({onMenuOpenChange}) => React.createElement('button', {id:'menu', onClick:event => {
            event.stopPropagation(); onMenuOpenChange(true);
          }}, 'Menu') : undefined,
        })));
      `,
      resolveDir: process.cwd(), loader: 'jsx',
    },
    bundle: true, write: false, format: 'iife', jsx: 'transform',
  });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.route('**/*', route => route.abort());
      await page.setContent('<div id="root"></div>');
      await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
      await page.evaluate(() => (window as unknown as { renderRow: () => void }).renderRow());
      await page.locator('#row').click();
      await page.locator('#archive').click();
      await page.locator('#confirm').waitFor();
      await page.locator('#row').dispatchEvent('dblclick');
      await page.locator('#confirm').click();
      assert.deepEqual(await page.evaluate(() => (window as unknown as { rowEvents: unknown }).rowEvents), {
        select: 1, focus: 1, archive: 1, double: 0, drop: 0,
      });
      await page.locator('#row').dispatchEvent('dblclick');
      assert.equal(await page.evaluate(() => (window as unknown as { rowEvents: { double: number } }).rowEvents.double), 1);

      await page.evaluate(() => (window as unknown as { renderRow: (options: object) => void }).renderRow({ menu: true }));
      await page.locator('#menu').click();
      assert.equal(await page.locator('[data-hover-locked]').getAttribute('data-hover-locked'), 'true');
      const dragState = await page.locator('#row').evaluate(element => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(['fixture'], 'fixture.txt', { type: 'text/plain' }));
        element.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }));
        const entered = (element as HTMLElement).dataset.fileDropActive;
        element.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
        element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
        return { entered, afterDrop: (element as HTMLElement).dataset.fileDropActive };
      });
      assert.deepEqual(dragState, { entered: 'true', afterDrop: undefined });
      assert.equal(await page.evaluate(() => (window as unknown as { rowEvents: { drop: number } }).rowEvents.drop), 1);

      await page.evaluate(() => (window as unknown as { renderRow: (options: object) => void }).renderRow({ disabled: true, menu: true }));
      await page.locator('#row').click();
      assert.equal(await page.evaluate(() => (window as unknown as { rowEvents: { select: number } }).rowEvents.select), 1);
      assert.equal(await page.locator('#menu').count(), 1);
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
});
