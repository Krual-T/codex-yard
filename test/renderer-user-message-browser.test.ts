import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

declare global {
  interface Window {
    userMessageHarness: {
      renderMessage: (text: string, printing?: boolean) => void;
      unmountMessage: () => void;
      getDraft: () => { literalMarkdownLinkSources: (string | null)[] | null } | null;
      renderFiles: () => void;
      renderImages: () => void;
      renderSingleImage: (src: string, options?: { overlay?: boolean; uploaded?: boolean; withResolver?: boolean; withEdit?: boolean; assetStatus?: 'loading' | 'error' | 'ready' }) => void;
      resolveImage: (path: string, src: string | null) => void;
      find?: { text: string; isTruncated: boolean; reveal?: () => void };
      reads: { path: string; hostId: string; conversationId: string }[];
      files: { path: string; line?: number; column?: number; cwd?: string; hostId?: string; isAttachmentPreview: boolean; openInSidePanel: boolean; target?: string }[];
      uploads: string[];
      shares: string[];
      copies: { 'text/plain': string; 'text/html': string }[];
      copySucceeded: string[];
      edits: string[];
      editCalls: { text: string; format?: string; hints?: string[] }[];
      editorMounts: number;
      editorCleanups: number;
      failEdit: boolean;
      editorCalls: { entrypoint: string; src: string; identity?: string }[];
      identityCalls: { src: string; hasResolver: boolean }[];
      resolvedAssets: string[];
      submittedEdits: { prompt: string; maskSrc: string; attribution: { imageSource: string }; signalAborted: boolean; sourceImage: { id: string; src: string; status: string; type: string } }[];
    };
  }
}

const chromePath = '/usr/bin/google-chrome';
test('user message, attachment actions and image loading use the supplied state and services', {
  skip: !existsSync(chromePath) && 'Google Chrome is unavailable; portable user-message checks still run',
}, async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import * as React from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { createCollapsibleUserMessageContentComponent } from './src/renderer/messages/collapsible-user-message-content.tsx';
        import { createUserMessageBodyComponent, createUserMessageComponent } from './src/renderer/messages/user-message.tsx';
        import { createUserMessageFileAttachmentComponent, createUserMessageImageListComponent } from './src/renderer/messages/user-message-attachments.tsx';
        import { createUserMessageImageComponent } from './src/renderer/messages/user-message-image.tsx';
        const h = React.createElement;
        const intl = {formatMessage: ({defaultMessage}) => defaultMessage};
        const scope = {value: {kind: 'local', routeKind: 'local-thread', conversationId: 'thread-a'}, draft: null};
        const listeners = new Set();
        const client = {};
        const pending = new Map();
        let printing = false, overlay = false, assetStatus = 'loading';
        const classes = (...values) => values.filter(Boolean).join(' ');
        const Button = ({children, color, size, ...props}) => h('button', props, children);
        const Formatted = ({defaultMessage}) => defaultMessage;
        const Icon = ({className}) => h('i', {className});
        const previewContext = React.createContext(false);
        const Collapsible = createCollapsibleUserMessageContentComponent(React, {
          useIsPrinting: () => printing,
          useTextContentMeasurement: ({forceCollapsible}) => {
            const [expanded, setExpanded] = React.useState(false);
            return {collapseState: forceCollapsible ? (expanded ? 'expanded' : 'collapsed') : 'uncollapsible',
              setTextContentMeasurementRef: () => {}, handleToggleExpansion: () => setExpanded(!expanded)};
          },
          registerThreadFindTarget: (element, target) => { window.userMessageHarness.find = target; return () => {}; },
          CodeBlockPreviewContext: previewContext, Button, FormattedMessage: Formatted, ChevronDown: Icon, classNames: classes,
        });
        const Body = createUserMessageBodyComponent(React, {
          useExternalLinkConversationId: () => 'thread-a', CollapsibleContent: Collapsible,
          Markdown: ({ref, text, cwd, hostId, externalLinkContextMenuConversationId}) => h('div', {ref, id: 'message-text',
            'data-cwd': cwd, 'data-host': hostId, 'data-conversation': externalLinkContextMenuConversationId}, text),
        });
        const Message = createUserMessageComponent(React, {
          useScope: () => scope, getThreadId: () => 'thread-a', useIsAeonFormatted: () => false,
          useCurrentUser: () => null,
          useEditDraft: () => React.useSyncExternalStore(fn => {listeners.add(fn); return () => listeners.delete(fn)}, () => scope.draft),
          setEditDraft: (s, id, draft) => {s.draft = draft; listeners.forEach(fn => fn())},
          useEditingDisabled: () => false, isEditingDisabled: () => false, useIntl: () => intl,
          useAnalytics: () => ({}), normalizeMessage: text => text, isPlanImplementationRequest: () => false,
          getCopyContent: ref => ({plainText: ref.current.textContent, htmlText: '<p>official selection</p>'}),
          toPlainText: text => text,
          copyToClipboard: content => {window.userMessageHarness.copies.push(content); return Promise.resolve(true)},
          UserMessageBody: Body,
          Editor: ({initialMessage, initialLiteralMarkdownLinkSources, onDraftChange, onCancel, onSubmit, onEditInputMount}) => {
            const ref=React.useRef(null);
            React.useLayoutEffect(() => onEditInputMount?.(ref.current), []);
            return h('div', {id: 'editor',ref}, h('span', null, initialMessage), h('span', {id:'draft-links'}, JSON.stringify(initialLiteralMarkdownLinkSources)),
              h('button', {onClick: () => onDraftChange({message:initialMessage,authoredMarkdownLinkSourcesByOccurrence:[null],literalMarkdownLinkSources:[null]})}, 'Draft link'),
              h('button', {onClick: onCancel}, 'Cancel edit'),
              h('button', {onClick: () => void onSubmit('updated')}, 'Save edit'),
              h('button', {onClick: () => void onSubmit('with hints','markdown',['search','note'])}, 'Save with hints'));
          },
          Button, Tooltip: ({children}) => children, FormattedMessage: Formatted, Timestamp: () => null,
          HookStatsButton: () => null, CopyIcon: Icon, CopiedIcon: Icon, EditIcon: Icon,
          styles: {bubble:'bubble',leadingBubble:'leading',compactMessageReaction:'reaction',compactMessageBubble:'compact',
            compactMessageContainer:'compact-container',otherUserMessage:'other',accentedBubble:'accented',temporaryBubble:'temporary',temporaryOutline:'outline'},
          classNames: classes,
        });
        const File = createUserMessageFileAttachmentComponent(React, {
          useScope: () => scope,
          FileCard: ({filename, onClick, layout, showOpenAffordance}) => h('button', {onClick, 'data-layout': layout,
            'data-affordance': String(showOpenAffordance)}, filename),
          PastedTextCard: ({preview, onClick}) => h('button', {onClick}, preview),
          FileContextMenu: ({children, path}) => h('div', {'data-menu-path': path}, children),
          openUploadedFile: (s, upload) => {window.userMessageHarness.uploads.push(upload.fileId)},
          openSharedThread: ({href}) => {window.userMessageHarness.shares.push(href)},
          openFile: ({scope, ...options}) => {window.userMessageHarness.files.push(options)},
          isDirectory: attachment => attachment.path.endsWith('/'),
          getPreviewKind: path => path.endsWith('.pdf') ? 'pdf' : null,
          isSidePanelFile: path => path.endsWith('.md'), isSidePanelMedia: () => false,
          formatLabel: (label, lineInfo) => lineInfo ? label.replace(/ \\(.*\\)$/, '') : label,
          formatLineInfo: attachment => attachment.startLine == null ? undefined
            : attachment.endLine != null && attachment.endLine !== attachment.startLine
              ? String(attachment.startLine) + '-' + String(attachment.endLine) : String(attachment.startLine),
        });
        const png = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
        const resolver = {cacheKey:['fixture'],resolveAsset:async fileId => {
          window.userMessageHarness.resolvedAssets.push(fileId);
          if(fileId==='missing-resolved') throw new Error('fixture failure');
          return {kind:'available',downloadUrl:png};
        }};
        const Image = createUserMessageImageComponent(React, {
          useScope: () => scope, useIntl: () => intl, useImageClient: () => client, useConversationHostId: () => 'ssh-host',
          useDisableImageOverlay: () => false, useReducedMotion: () => true,
          useResolvedImage: (src, selectedResolver) => {
            const [resolved, setResolved] = React.useState({isError:false,src:null});
            React.useEffect(() => {
              if(!src || !selectedResolver) return;
              let cancelled=false;
              setResolved({isError:false,src:null});
              selectedResolver.resolveAsset(src.slice('file-service://'.length)).then(value => {
                if(!cancelled) setResolved(value.kind==='available' ? {isError:false,src:value.downloadUrl} : {isError:true,src:null});
              }, () => {if(!cancelled) setResolved({isError:true,src:null})});
              return () => {cancelled=true};
            }, [src, selectedResolver]);
            return selectedResolver && src ? resolved : !src ? {isError:false,src:null}
              : assetStatus === 'error' ? {isError:true, src:null} : {isError:false, src:assetStatus === 'ready' ? png : null};
          },
          useImageOverlayEnabled: () => overlay,
          isAssetPointer: src => src.startsWith('file-service://'),
          getLocalImagePath: src => src.startsWith('/') ? src : null,
          resolveLocalImage: (path, hostId, c, signal, conversationId) => {
            window.userMessageHarness.reads.push({path, hostId, conversationId});
            return new Promise(resolve => pending.set(path, resolve));
          },
          getDurableIdentity: (s, id, src, resolver) => {
            window.userMessageHarness.identityCalls.push({src, hasResolver: resolver != null});
            return resolver == null ? 'identity:' + src : undefined;
          },
          openImageEditor: (s, image, options) => {window.userMessageHarness.editorCalls.push({
            entrypoint: image.entrypoint, src: image.attachmentSrc, identity: options.durableIdentity}); return true},
          openAnimatedOverlay: ({open}) => open(() => {}),
          recordImagePreview: () => {}, parseChatGptConversationId: id => id,
          getImageContextMenu: () => [], ImageContextMenu: ({children}) => children,
          ImageDialog: ({triggerContent, src, open, onOpenChange, onPreviousImage, onNextImage, editButton}) => h(React.Fragment, null,
            triggerContent, open && h('div', {role: 'dialog', 'aria-label': 'Image preview', 'data-src': src},
              onPreviousImage && h('button', {onClick: onPreviousImage}, 'Previous image'),
              onNextImage && h('button', {onClick: onNextImage}, 'Next image'),
              editButton && h('button', {onClick: editButton.onClick}, editButton.ariaLabel),
              h('button', {onClick: () => onOpenChange(false)}, 'Close image preview'))),
          ImageOverlay: ({image, onClose, onCloseAutoFocus}) => h('div', {role: 'dialog', 'aria-label': 'Image overlay'},
            image.onImageEditSubmit && h('button', {onClick: () => {
              const controller=new AbortController();
              window.userMessageHarness.submittedSource=image.sourceImage;
              void image.onImageEditSubmit({prompt:'change',maskSrc:'mask',attribution:image.imageEditAttribution},controller.signal);
              controller.abort();
            }}, 'Submit image edit'),
            h('button', {onClick: () => {onClose(); onCloseAutoFocus({preventDefault(){}})}}, 'Close overlay')),
          LoadingIcon: () => h('i', {'data-loading': ''}), AssetIcon: () => h('i'), editAsset: 'edit', FormattedMessage: Formatted,
        });
        const ImageList = createUserMessageImageListComponent(React, {ImageAttachment: Image});
        const messageRoot = createRoot(document.getElementById('message-root'));
        const fileRoot = createRoot(document.getElementById('file-root'));
        const imageRoot = createRoot(document.getElementById('image-root'));
        window.userMessageHarness = {
          reads: [], files: [], uploads: [], shares: [], copies: [], copySucceeded: [], edits: [], editCalls: [], editorMounts: 0, editorCleanups: 0, editorCalls: [], identityCalls: [], resolvedAssets: [], submittedEdits: [], failEdit: false,
          renderMessage(text, isPrinting = false) {
            printing = isPrinting;
            flushSync(() => messageRoot.render(h(Message, {message:text, threadId:'thread-a', turnId:'turn-a',
              cwd:'/srv/repo', hostId:'ssh-host', collapsedLineCount:3,
              onCopySucceeded: text => window.userMessageHarness.copySucceeded.push(text),
              onEditInputMount: element => {if(!element) throw Error('missing editor element');window.userMessageHarness.editorMounts++;
                return () => {window.userMessageHarness.editorCleanups++}},
              onEditMessage: async (text,format,hints) => {if (window.userMessageHarness.failEdit) throw Error('failed');
                window.userMessageHarness.edits.push(text);window.userMessageHarness.editCalls.push({text,format,hints})}})));
          },
          unmountMessage() {flushSync(() => messageRoot.render(null))},
          getDraft() {return scope.draft},
          renderFiles() {
            const items = [
              {path:'src/main.ts',fsPath:'/srv/repo/src/main.ts',label:'main.ts (8-10)',startLine:8,endLine:10},
              {path:'/srv/repo/report.pdf',label:'report.pdf'},
              {path:'/srv/repo/folder/',label:'folder'},
              {path:'shared.txt',label:'shared.txt',sharedThread:{shareId:'a/b ?'}},
              {upload:{fileName:'upload.txt',fileId:'file-1'}},
              {upload:{fileName:'paste.txt',fileId:'file-2'},preview:'Pasted preview'},
            ];
            flushSync(() => fileRoot.render(h(React.Fragment,null,items.map((attachment,index) =>
              h(File,{key:index,attachment,cwd:'/srv/repo',hostId:'ssh-host',isUploadedFileViewerEnabled:true})))));
          },
          renderImages() {
            overlay = false;
            flushSync(() => imageRoot.render(h(ImageList,{srcs:['/srv/a.png','/srv/b.png'],conversationId:'thread-a',imageSource:'uploaded'})));
          },
          renderSingleImage(src, options = {}) {
            overlay = !!options.overlay; assetStatus = options.assetStatus ?? 'loading';
            flushSync(() => imageRoot.render(h(Image,{src,conversationId:'thread-a',imageSource:options.uploaded ? 'uploaded' : undefined,
              imageAssetResolver:options.withResolver ? resolver : undefined,
              sourceImage:options.withEdit ? {id:'image-1',src,status:'completed',type:'generated-image'} : undefined,
              imageEditAttribution:options.withEdit ? {imageSource:'uploaded'} : undefined,
              onImageEditSubmit:options.withEdit ? async (request,signal) => {
                const entry={...request,signalAborted:false,sourceImage:window.userMessageHarness.submittedSource};
                window.userMessageHarness.submittedEdits.push(entry);
                signal.addEventListener('abort',()=>{entry.signalAborted=signal.aborted},{once:true});
                return false;
              } : undefined})));
          },
          resolveImage(path, src) {const resolve = pending.get(path); if (!resolve) throw Error('missing image request'); resolve(src)},
        };
      `,
      resolveDir: process.cwd(),
      loader: 'jsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'transform',
  });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="message-root"></div><div id="file-root"></div><div id="image-root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const longText = 'a'.repeat(3 * 512) + ' END';
    await page.evaluate(text => window.userMessageHarness.renderMessage(text), longText);
    assert.equal(await page.locator('#message-text').textContent(), longText.slice(0, 3 * 512));
    assert.equal(await page.locator('#message-text').getAttribute('data-host'), 'ssh-host');
    assert.equal(await page.locator('#message-text').getAttribute('data-conversation'), 'thread-a');
    assert.equal(await page.evaluate(() => window.userMessageHarness.find?.isTruncated), true);
    await page.evaluate(() => window.userMessageHarness.find?.reveal?.());
    await page.getByRole('button', { name: 'Show less' }).waitFor();
    assert.equal(await page.locator('#message-text').textContent(), longText);
    await page.getByRole('button', { name: 'Copy message' }).click();
    await page.getByRole('button', { name: 'Copied' }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.userMessageHarness.copies), [{ 'text/plain': longText, 'text/html': '<p>official selection</p>' }]);
    assert.deepEqual(await page.evaluate(() => window.userMessageHarness.copySucceeded), [longText]);
    await page.getByRole('button', { name: 'Edit message' }).click();
    await page.locator('#editor').waitFor();
    await page.getByRole('button', { name: 'Draft link' }).click();
    assert.deepEqual((await page.evaluate(() => window.userMessageHarness.getDraft()))?.literalMarkdownLinkSources, [null]);
    await page.evaluate(() => window.userMessageHarness.unmountMessage());
    assert.equal(await page.evaluate(() => window.userMessageHarness.editorCleanups), 1);
    await page.evaluate(text => window.userMessageHarness.renderMessage(text), longText);
    assert.equal(await page.locator('#draft-links').textContent(), '[null]');
    await page.evaluate(() => { window.userMessageHarness.failEdit = true; });
    await page.getByRole('button', { name: 'Save edit' }).click();
    assert.equal(await page.locator('#editor').count(), 1);
    await page.evaluate(() => { window.userMessageHarness.failEdit = false; });
    await page.getByRole('button', { name: 'Save edit' }).click();
    await page.locator('#editor').waitFor({ state: 'detached' });
    assert.deepEqual(await page.evaluate(() => window.userMessageHarness.edits), ['updated']);
    await page.getByRole('button', { name: 'Edit message' }).click();
    await page.getByRole('button', { name: 'Save with hints' }).click();
    await page.locator('#editor').waitFor({ state: 'detached' });
    assert.deepEqual(await page.evaluate(() => window.userMessageHarness.editCalls[1]), { text: 'with hints', format: 'markdown', hints: ['search', 'note'] });
    assert.equal(await page.evaluate(() => window.userMessageHarness.editorMounts), 3);
    assert.equal(await page.evaluate(() => window.userMessageHarness.editorCleanups), 3);
    await page.evaluate(text => window.userMessageHarness.renderMessage(text, true), longText);
    assert.equal(await page.locator('#message-text').textContent(), longText);

    await page.evaluate(() => window.userMessageHarness.renderFiles());
    assert.equal(await page.getByRole('button', { name: 'report.pdf' }).getAttribute('data-layout'), 'card');
    await page.getByRole('button', { name: 'main.ts' }).click();
    await page.getByRole('button', { name: 'report.pdf' }).click();
    await page.getByRole('button', { name: 'folder' }).click();
    await page.getByRole('button', { name: 'shared.txt' }).click();
    await page.getByRole('button', { name: 'upload.txt' }).click();
    await page.getByRole('button', { name: 'Pasted preview' }).click();
    const files = await page.evaluate(() => window.userMessageHarness.files);
    assert.deepEqual(files[0], { path: '/srv/repo/src/main.ts', line: 8, column: 1, cwd: '/srv/repo', hostId: 'ssh-host', attachmentPreviewOrigin: undefined, isAttachmentPreview: false, openInSidePanel: false, target: undefined });
    assert.equal(files[1].isAttachmentPreview, true);
    assert.equal(files[1].openInSidePanel, true);
    assert.equal(files[2].target, 'fileManager');
    assert.deepEqual(await page.evaluate(() => window.userMessageHarness.uploads), ['file-1', 'file-2']);
    assert.deepEqual(await page.evaluate(() => window.userMessageHarness.shares), ['https://chatgpt.com/s/a%2Fb%20%3F']);

    await page.evaluate(() => window.userMessageHarness.renderImages());
    await page.waitForFunction(() => window.userMessageHarness.reads.length === 2);
    assert.deepEqual(await page.evaluate(() => window.userMessageHarness.reads), [
      { path: '/srv/a.png', hostId: 'ssh-host', conversationId: 'thread-a' },
      { path: '/srv/b.png', hostId: 'ssh-host', conversationId: 'thread-a' },
    ]);
    const png = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
    await page.evaluate(src => { window.userMessageHarness.resolveImage('/srv/a.png', src); window.userMessageHarness.resolveImage('/srv/b.png', src); }, png);
    await page.getByRole('button', { name: 'User attachment' }).first().focus();
    await page.keyboard.press('Enter');
    await page.getByRole('dialog', { name: 'Image preview' }).waitFor();
    await page.getByRole('button', { name: 'Next image' }).click();
    assert.equal(await page.getByRole('button', { name: 'Previous image' }).count(), 1);
    await page.getByRole('button', { name: 'Close image preview' }).click();
    assert.equal(await page.getByRole('dialog').count(), 0);

    await page.evaluate(src => window.userMessageHarness.renderSingleImage(src, { uploaded: true, overlay: true }), png);
    const trigger = page.getByRole('button', { name: 'User attachment' });
    await trigger.focus();
    await page.keyboard.press(' ');
    await page.getByRole('dialog', { name: 'Image overlay' }).waitFor();
    await page.getByRole('button', { name: 'Close overlay' }).click();
    assert.equal(await trigger.evaluate(element => document.activeElement === element), true);

    await page.evaluate(() => window.userMessageHarness.renderSingleImage('/srv/slow.png'));
    await page.evaluate(() => window.userMessageHarness.renderSingleImage('/srv/fresh.png'));
    await page.evaluate(src => window.userMessageHarness.resolveImage('/srv/slow.png', src), png);
    assert.equal(await page.locator('[data-loading]').count(), 1);
    await page.evaluate(src => window.userMessageHarness.resolveImage('/srv/fresh.png', src), png);
    await page.getByRole('button', { name: 'User attachment' }).click();
    assert.deepEqual(await page.evaluate(() => window.userMessageHarness.editorCalls), [
      { entrypoint: 'image_click', src: '/srv/fresh.png', identity: 'identity:/srv/fresh.png' },
    ]);
    await page.evaluate(src => window.userMessageHarness.renderSingleImage(src, { withResolver: true }), png);
    await page.getByRole('button', { name: 'User attachment' }).click();
    assert.deepEqual(await page.evaluate(() => window.userMessageHarness.identityCalls), [
      { src: '/srv/fresh.png', hasResolver: false }, { src: png, hasResolver: true },
    ]);
    assert.deepEqual(await page.evaluate(() => window.userMessageHarness.editorCalls[1]),
      { entrypoint: 'image_click', src: png, identity: undefined });
    await page.evaluate(() => window.userMessageHarness.renderSingleImage('file-service://missing', { assetStatus: 'error' }));
    assert.equal(await page.getByRole('img', { name: 'Image failed to load' }).textContent(), 'Failed');
    await page.evaluate(() => window.userMessageHarness.renderSingleImage('file-service://good', { withResolver: true, withEdit: true, uploaded: true, overlay: true }));
    await page.getByRole('button', { name: 'User attachment' }).click();
    await page.getByRole('button', { name: 'Submit image edit' }).click();
    assert.deepEqual(await page.evaluate(() => window.userMessageHarness.submittedEdits), [{ prompt:'change', maskSrc:'mask',
      attribution:{ imageSource:'uploaded' }, signalAborted:true,
      sourceImage:{ id:'image-1', src:'file-service://good', status:'completed', type:'generated-image' } }]);
    await page.evaluate(() => window.userMessageHarness.renderSingleImage('file-service://missing-resolved', { withResolver: true }));
    await page.getByRole('img', { name: 'Image failed to load' }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.userMessageHarness.resolvedAssets), ['good', 'missing-resolved']);
    await page.close();
  } finally {
    await browser.close();
  }
});
