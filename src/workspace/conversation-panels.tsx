import { AtSign, Bot, Diff, Download, Folders, MessageSquare, MessageSquarePlus, SquareTerminal, Workflow } from 'lucide-react';
import { WorkspaceIcon } from './workspace-icon.tsx';
import { lazy, Suspense, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Ref, RefObject } from 'react';
import type { ThreadSummary, TurnSummary } from '../../lib/codex-protocol.ts';
import { mergeSidechats } from '../native/sidechat-thread-view.ts';
import { Composer, recoverQueuedDraft, type ComposerHandle, type ComposerImageAttachments } from './composer.tsx';
import { Transcript, useConversation } from './conversation.tsx';
import { AsyncQuestionsProvider } from './async-questions.tsx';
import type { ConversationView } from './conversation.tsx';
import { deleteQueuedSubmission, forkSidechat, listSidechats, resumeThread, sendExistingThread, sidechats, submitTransferredInput,
  WorkspaceRequestError, type QueuedSubmission } from './host.ts';
import { browserAtoms, writeAtom } from './host.ts';
import { Outputs } from './outputs.tsx';
import { OutputPreview } from './output-preview.tsx';
import { attachmentOutput, outputFileUrl, type OutputFile, type OutputType, type PluginMention } from './output-types.ts';
import { SourcesPanel, SourcesSummary, useConversationSources } from './conversation-sources.tsx';
import type { PromptAttachment } from './composer-input.ts';
import { mergeLiveTurns, TurnStream } from './turn-stream.ts';
import { AgentLink, subagentTitle, type OpenSubagent } from './turn-agents.tsx';
import { TurnChangesPanel, type OpenTurnChanges } from './turn-changes-view.tsx';
import { NewTab, newTabMenu } from './new-tab-tools.tsx';
import { TerminalPanel, type WorkspaceTerminalSession } from './terminal-panel.tsx';
import { WorkspaceFiles } from './workspace-files.tsx';
import { BrowserTab, BrowserTabTitle, newTabAddress, parseBrowserAddress, type WorkspaceBrowserView } from './browser-tab.tsx';
import { IabBrowserPanel } from '../browser-reuse/iab-panel.tsx';
import { requestIabBrowser } from './host.ts';
import { WorkspaceSplitter } from './workspace-splitter.tsx';
import { McpAppTabContent, type McpAppTab } from './mcp-app.tsx';
import type { ChromeWindow } from '../browser-reuse/browser-bridge.ts';
import { WorkspaceOutputLinks } from './message-markdown.tsx';
import { openClientBrowser } from '../native/client-browser.ts';
import './tool-tabs.css';
import { ConversationGoalEditor, useConversationGoal } from './conversation-goal.tsx';
import { GoalIcon } from './conversation-goal-icons.tsx';
import { SummarySection } from './summary-section.tsx';
import { extractGeneratedImages, type EditableImage } from './image-edit-model.ts';

const GeneratedImageEditor = lazy(() => import('./generated-image-editor.tsx'));
type ImageEditorTarget = { composer(): ComposerHandle | null; stream: TurnStream; turns?: readonly TurnSummary[];
  readHistory?(): readonly TurnSummary[] | undefined; title?: string; ownerTabId?: string };
type ImageEditorTool = { kind: 'image-editor'; target: ImageEditorTarget; images: readonly EditableImage[]; selectedId: string };
const emptyImageAttachments: ComposerImageAttachments = { images: [], comments: [] };

function ImageEditorTab({ tool, visible, select, openImage }: {
  tool: ImageEditorTool; visible: boolean; select(id: string): void; openImage(image: EditableImage, hostId: string): void;
}) {
  const { target } = tool;
  const live = useSyncExternalStore(target.stream.subscribe, target.stream.read);
  const history = target.readHistory?.() ?? target.turns;
  const known = useRef(new Map(tool.images.map(image => [image.id, image])));
  const images = useMemo(() => {
    for (const image of tool.images) known.current.set(image.id, image);
    for (const turn of mergeLiveTurns(history, live)) for (const image of extractGeneratedImages(turn.items, turn.id, turn.startedAt ?? undefined)) known.current.set(image.id, image);
    return [...known.current.values()].map((image, index) => ({ ...image, label: 'Generated image ' + (index + 1) }));
  }, [tool.images, history, live]);
  const subscribe = useCallback((listener: () => void) => target.composer()?.subscribeImageAttachments(listener) ?? (() => {}), [target]);
  const snapshot = useCallback(() => target.composer()?.imageAttachments() ?? emptyImageAttachments, [target]);
  const attached = useSyncExternalStore(subscribe, snapshot);
  const loading = useMemo(() => {
    const pending = mergeLiveTurns(history, live).flatMap(turn => turn.items.flatMap(item =>
      item.type === 'imageGeneration' && (item.status === 'inProgress' || item.status === 'in_progress') && !images.some(image => image.id === item.id)
        ? [{ id: item.id, turnId: turn.id, startedAt: turn.startedAt ?? undefined }] : []));
    if (attached.pendingEditId && !pending.length) pending.push({ id: 'optimistic-image-edit:' + attached.pendingEditId,
      turnId: attached.pendingEditId, startedAt: undefined });
    return pending;
  }, [history, live, images, attached.pendingEditId]);
  const seen = useRef(new Set(tool.images.map(image => image.id)));
  useEffect(() => {
    const all = [...images, ...loading], newest = all.filter(image => !seen.current.has(image.id)).at(-1);
    for (const image of all) seen.current.add(image.id);
    if (newest && visible) select(newest.id);
  }, [images, loading, visible, select]);
  return <Suspense fallback={null}><GeneratedImageEditor images={images} selectedId={tool.selectedId} hostId={target.stream.hostId}
    loadingImages={loading}
    visible={visible} onSelectImage={select} attachedImages={attached.images} attachedComments={attached.comments}
    onOpenImage={image => openImage(image, target.stream.hostId)}
    onAction={async action => {
      const composer = target.composer();
      if (!composer) throw new Error('The editor is not ready.');
      await composer.imageEdit(action);
    }} /></Suspense>;
}

const fallbackTitle = (index: number) => index === 1 ? 'Side chat' : 'Side chat ' + index;
type Tool = { kind: 'new'; placeholder?: boolean; working?: boolean; error?: string } | { kind: 'chat'; view: ConversationView; error?: string } |
  { kind: 'agent'; view: ConversationView; title: string } |
  { kind: 'output'; file: OutputFile } | { kind: 'terminal'; session: WorkspaceTerminalSession; number: number } |
  { kind: 'files'; cwd: string; query?: string } | { kind: 'browser'; view: WorkspaceBrowserView } | { kind: 'iab' } |
  { kind: 'changes'; turnId: string; expanded: boolean } | { kind: 'sources' } | { kind: 'mcp-app'; app: McpAppTab } |
  { kind: 'goal'; threadId: string; hostId: string } | { kind: 'image-preview'; image: EditableImage; hostId: string } | ImageEditorTool;
type ToolTab = { id: string; tool: Tool };

function Sidechat({ view, transferError, openOutput, openSubagent, openPage, openGoal, openImages, tabId }: {
  view: ConversationView; transferError?: string; openOutput(file: OutputFile): void; openSubagent: OpenSubagent; openPage(url: string): void;
  openGoal(threadId: string, hostId: string): void;
  tabId: string; openImages(images: readonly EditableImage[], selectedId: string, target: ImageEditorTarget): void;
}) {
  const { page, fault, more } = useConversation(view);
  const imageHistory = useRef(page?.turns);
  imageHistory.current = page?.turns;
  const composer = useRef<ComposerHandle>(null);
  const alive = useRef(false);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const { stream } = view;
  return <AsyncQuestionsProvider stream={stream} history={page?.turns}>
    {(transferError || fault) && <p role="alert">{transferError ?? fault}</p>}
    <WorkspaceOutputLinks value={{ cwd: page?.thread?.cwd ?? '', open: openOutput, openPage,
      openImages: (images, selectedId) => openImages(images, selectedId, { composer: () => composer.current, stream, turns: page?.turns,
        readHistory: () => imageHistory.current, title: page?.thread?.name ?? undefined, ownerTabId: tabId }) }}>
    <Transcript page={page} stream={stream} more={more} label="Side chat conversation" openSubagent={openSubagent}
      stop={turnId => composer.current?.stop(turnId) ?? Promise.resolve()}
      runMessageEdit={run => composer.current?.runMessageEdit(run) ?? Promise.reject(new Error('The editor is not ready.'))} />
    </WorkspaceOutputLinks>
    <div className="yard-source-composer">
      <Composer ref={composer} scope={stream.hostId === 'local' ? stream.threadId : stream.hostId + ':' + stream.threadId}
        label="Work with Codex" stream={stream} historyTurns={page?.turns} openGoal={openGoal}
        onSend={page ? async (text, _permission, attachments, clientUserMessageId, options) => {
          const { turn } = await sendExistingThread(stream.threadId, text, () => alive.current, attachments, stream.hostId, clientUserMessageId, options);
          if (alive.current) stream.acknowledge(turn);
        } : undefined} />
    </div>
  </AsyncQuestionsProvider>;
}

function GoalTab({ threadId, hostId }: { threadId: string; hostId: string }) {
  const controller = useConversationGoal(threadId, hostId);
  return <ConversationGoalEditor key={`${hostId}:${threadId}:${controller.goal?.objective ?? ''}`} controller={controller} />;
}

export type ConversationPanelsHandle = {
  createSidechat(): void;
  openQueuedSidechat(item: QueuedSubmission): Promise<void>;
  openOutput(file: OutputFile): void;
  openPage(url: string): void;
  openSubagent: OpenSubagent;
  openChanges: OpenTurnChanges;
  openMcpApp(app: McpAppTab): void;
  closeMcpApp(id: string): void;
  openGoal(threadId: string, hostId: string): void;
  openImages(images: readonly EditableImage[], selectedId: string, target: ImageEditorTarget): void;
};
export function ConversationPanels({ ref, parentId, hostId, workspace, createOutput, attachSource, insertPlugin, cwd, turns, stream, subagents, openBottomTerminal }: {
  ref?: Ref<ConversationPanelsHandle>;
  parentId: string; hostId: string; workspace: RefObject<HTMLDivElement | null>;
  createOutput(type: OutputType): void;
  attachSource(): void;
  insertPlugin(mention: PluginMention): void;
  cwd?: string;
  turns?: TurnSummary[];
  stream?: TurnStream;
  subagents: ReadonlyMap<string, ThreadSummary>;
  openBottomTerminal(): void;
}) {
  const summaryId = useId(), tabId = useId();
  const browserStateKey = 'yard-source-browser-tabs:' + hostId + ':' + parentId;
  const [savedBrowserState] = useState(() => {
    const value = browserAtoms()[browserStateKey] as { tabs?: { id?: unknown; url?: unknown }[]; selected?: string; visible?: boolean; expanded?: boolean } | undefined;
    const bridge = (window as ChromeWindow).workbenchChrome;
    const entries = bridge && Array.isArray(value?.tabs) ? value.tabs.filter((row): row is { id: string; url: string } =>
      !!row && typeof row.id === 'string' && typeof row.url === 'string' && !!parseBrowserAddress(row.url)) : [];
    return { tabs: entries.map(({ id }) => ({ id, tool: { kind: 'browser', view: { bridge: bridge!, target: {
      conversationId: hostId === 'local' ? parentId : hostId + ':' + parentId, browserTabId: id,
    } } } } satisfies ToolTab)), entries, selected: value?.selected, visible: value?.visible === true, expanded: value?.expanded === true };
  });
  const [inline, setInline] = useState(false);
  const [pinned, setPinned] = useState(true);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [tabs, setTabs] = useState<ToolTab[]>(savedBrowserState.tabs);
  const [selected, setSelected] = useState<string | undefined>(savedBrowserState.selected);
  const [tabVisible, setTabVisible] = useState(savedBrowserState.visible);
  const [toolsExpanded, setToolsExpanded] = useState(savedBrowserState.expanded);
  const paneRatio = useRef<number>(undefined);
  const alive = useRef(false);
  const opening = useRef(new Map<string, symbol>());
  const terminalNumber = useRef(0);
  const summaryTrigger = useRef<HTMLButtonElement>(null);
  const summarySurface = useRef<HTMLElement>(null);
  const rightTrigger = useRef<HTMLButtonElement>(null);
  const rightPane = useRef<HTMLElement>(null);

  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    for (const entry of savedBrowserState.entries) {
      const view = savedBrowserState.tabs.find(tab => tab.id === entry.id)!.tool.view;
      view.bridge.enableEmbeddedPages();
      view.bridge.setConversationHost(view.target.conversationId, hostId);
      view.bridge.commandEmbeddedPage(view.target, { type: 'navigate', url: entry.url });
    }
  }, [savedBrowserState, hostId]);
  useEffect(() => {
    const browsers = tabs.flatMap(tab => tab.tool.kind === 'browser' ? [{ id: tab.id, view: tab.tool.view }] : []);
    const persist = () => {
      const entries = browsers.map(({ id, view }) => ({ id, url: view.bridge.embeddedPage(view.target).url }));
      // Persist source URLs; HTTPS forwarding leases are resolved again by the host.
      void writeAtom(browserStateKey, { tabs: entries, selected,
        visible: tabVisible && entries.some(tab => tab.id === selected), expanded: toolsExpanded }).catch(() => {});
    };
    persist();
    const releases = browsers.map(({ view }) => view.bridge.subscribePage(view.target, persist));
    return () => { for (const release of releases) release(); };
  }, [tabs, selected, tabVisible, toolsExpanded, browserStateKey]);
  useEffect(() => {
    if (!workspace.current) return;
    const observer = new ResizeObserver(([entry]) => setInline(entry!.contentRect.width >= 1096));
    observer.observe(workspace.current);
    return () => observer.disconnect();
  }, [workspace]);

  const subscribe = useCallback((listener: () => void) => sidechats.subscribe(hostId, parentId, listener), [hostId, parentId]);
  const read = useCallback(() => sidechats.snapshot(hostId, parentId), [hostId, parentId]);
  const branch = useSyncExternalStore(subscribe, read);
  const sources = useConversationSources(turns, stream);
  const supported = sidechats.supportsHost(hostId);
  const tab = tabs.find(row => row.id === selected) ?? tabs.at(-1);
  const expanded = tab?.tool.kind === 'changes' ? tab.tool.expanded : toolsExpanded;
  const rightOpen = !!tab && tabVisible;
  const imageTarget = rightOpen && tab?.tool.kind === 'image-editor' ? tab.tool.target : undefined;
  useLayoutEffect(() => {
    const pane = rightPane.current, editor = imageTarget?.composer();
    if (!pane || !editor) return;
    const origin = editor.element()?.closest<HTMLElement>('.yard-source-main, .yard-source-sidechat');
    if (!origin) return;
    const measure = () => {
      const box = pane.getBoundingClientRect();
      const container = origin.getBoundingClientRect();
      const scale = pane.offsetWidth > 0 ? box.width / pane.offsetWidth : 1;
      const width = Math.min(560, Math.max(0, box.width / scale - 24));
      editor.placeImageEditor({ left: (box.left - container.left + (box.width - width * scale) / 2) / scale,
        bottom: (container.bottom - box.bottom) / scale + 16, width });
      const form = editor.element();
      if (form) pane.style.setProperty('--right-panel-composer-overlay-reserve', Math.max(118, form.getBoundingClientRect().height / scale + 16) + 'px');
    };
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    observer.observe(origin);
    if (editor.element()) observer.observe(editor.element()!);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      observer.disconnect(); window.removeEventListener('resize', measure);
      editor.placeImageEditor();
      pane.style.removeProperty('--right-panel-composer-overlay-reserve');
    };
  }, [imageTarget]);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  useEffect(() => {
    if (!rightOpen) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const release = () => { clearTimeout(timer); timer = undefined; setShowShortcuts(false); };
    const press = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey || !(mac ? event.metaKey : event.ctrlKey)) return;
      if (event.key === (mac ? 'Meta' : 'Control') && !event.repeat && !timer) {
        timer = setTimeout(() => setShowShortcuts(true), 500);
      }
      if (!/^[1-9]$/.test(event.key)) return;
      const index = Number(event.key) - 1;
      const next = document.dir === 'rtl' ? tabs.at(-1 - index) : tabs[index];
      if (!next || document.querySelector('dialog:modal')) return;
      event.preventDefault();
      setSelected(next.id);
    };
    const up = (event: KeyboardEvent) => { if (event.key === (mac ? 'Meta' : 'Control')) release(); };
    window.addEventListener('keydown', press); window.addEventListener('keyup', up); window.addEventListener('blur', release);
    return () => {
      release();
      window.removeEventListener('keydown', press); window.removeEventListener('keyup', up); window.removeEventListener('blur', release);
    };
  }, [rightOpen, tabs, mac]);
  const summaryOpen = !rightOpen && (inline ? pinned : popoverOpen);
  useEffect(() => {
    if (!summaryOpen || inline) return;
    const outside = (event: PointerEvent) => {
      const path = event.composedPath();
      if (!path.includes(summarySurface.current!) && !path.includes(summaryTrigger.current!)) setPopoverOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || summarySurface.current?.querySelector('[popover]:popover-open')) return;
      setPopoverOpen(false);
      summaryTrigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [inline, summaryOpen]);
  useEffect(() => {
    if (!supported || !summaryOpen || branch.loading || branch.error) return;
    const list = (params: Record<string, unknown>) => listSidechats(params, hostId);
    if (!branch.loaded) void sidechats.load(hostId, parentId, list);
    else if (branch.nextCursor) void sidechats.load(hostId, parentId, list, true);
  }, [supported, summaryOpen, hostId, parentId, branch.loaded, branch.loading, branch.error, branch.nextCursor]);

  const rows = mergeSidechats(sidechats, hostId, branch.children, [], branch.loaded, fallbackTitle);
  const labels = { new: 'New tab', chat: 'Side chat', agent: 'Subagent', output: 'Output preview', terminal: 'Terminal', files: 'Files', browser: 'Browser', iab: 'Agent Browser',
    changes: 'Changes', sources: 'Sources', 'mcp-app': 'Tool app', goal: 'Goal', 'image-editor': 'Image editor', 'image-preview': 'Image preview' };
  const tabButton = (id: string) => tabId + '-button-' + id;
  const tabPanel = (id: string) => tabId + '-panel-' + id;
  function toolTitle(tool: Tool) {
    if (tool.kind === 'chat') return rows.find(row => row.conversationId === tool.view.stream.threadId)?.title ?? 'Side chat';
    if (tool.kind === 'agent') return subagents.has(tool.view.stream.threadId) ? subagentTitle(subagents.get(tool.view.stream.threadId)) : tool.title;
    if (tool.kind === 'output') return tool.file.name;
    if (tool.kind === 'terminal') return 'Terminal ' + tool.number;
    if (tool.kind === 'mcp-app') return tool.app.name;
    if (tool.kind === 'image-editor') return tool.target.title ?? 'Generated image';
    if (tool.kind === 'image-preview') return tool.image.label;
    return labels[tool.kind];
  }

  function showTab(tool: Tool = { kind: 'new' }, existing?: ToolTab, id = existing?.id ?? crypto.randomUUID()) {
    if (!existing) setTabs(current => [...current, { id, tool }]);
    setSelected(id);
    setPopoverOpen(false);
    setTabVisible(true);
    return id;
  }

  function replaceTab(id: string, tool: Tool) {
    opening.current.delete(id);
    setTabs(current => current.map(row => row.id === id ? { id, tool } : row));
  }

  function openChild(id: string) {
    const existing = tabs.find(row => row.tool.kind === 'chat' && row.tool.view.stream.threadId === id);
    showTab({ kind: 'chat', view: { stream: new TurnStream(id, hostId) } }, existing);
  }

  function openSubagent(id: string, title: string) {
    const existing = tabs.find(row => row.tool.kind === 'agent' && row.tool.view.stream.threadId === id);
    showTab({ kind: 'agent', view: { stream: new TurnStream(id, hostId) }, title }, existing);
    setToolsExpanded(true);
  }

  function openGoal(threadId: string, goalHost: string) {
    showTab({ kind: 'goal', threadId, hostId: goalHost },
      tabs.find(row => row.tool.kind === 'goal' && row.tool.threadId === threadId && row.tool.hostId === goalHost));
  }

  function openImages(images: readonly EditableImage[], selectedId: string, target: ImageEditorTarget) {
    const historyImages = target.turns?.flatMap(turn => extractGeneratedImages(turn.items, turn.id, turn.startedAt ?? undefined)) ?? [];
    const available = [...new Map([...historyImages, ...images].map(image => [image.id, image])).values()];
    const existing = tabs.find(row => row.tool.kind === 'image-editor' && row.tool.target.stream === target.stream);
    const next: ImageEditorTool = { kind: 'image-editor', images: available, selectedId, target };
    if (existing) replaceTab(existing.id, next);
    showTab(next, existing);
    setToolsExpanded(true);
  }

  function openImagePreview(image: EditableImage, ownerHostId: string) {
    const existing = tabs.find(row => row.tool.kind === 'image-preview' && row.tool.hostId === ownerHostId && row.tool.image.id === image.id);
    if (existing) replaceTab(existing.id, { kind: 'image-preview', image, hostId: ownerHostId });
    showTab({ kind: 'image-preview', image, hostId: ownerHostId }, existing);
    setToolsExpanded(true);
  }

  function closeTab(target = tab, restoreFocus = true) {
    if (!target) return;
    opening.current.delete(target.id);
    const retained = (row: ToolTab) => row.id !== target.id &&
      !(row.tool.kind === 'image-editor' && row.tool.target.ownerTabId === target.id);
    setTabs(current => current.filter(retained));
    if (!tab || retained(tab)) return;
    const index = tabs.indexOf(tab), next = tabs.slice(index + 1).find(retained) ?? tabs.slice(0, index).filter(retained).at(-1);
    setSelected(next?.id);
    if (!next) {
      setTabVisible(false);
      setToolsExpanded(false);
    }
    if (!restoreFocus) return;
    if (next) document.getElementById(tabButton(next.id))?.focus();
    else if (target.tool.kind === 'mcp-app') {
      const { app } = target.tool;
      requestAnimationFrame(() => { if (!app.focusInline()) rightTrigger.current?.focus(); });
    } else rightTrigger.current?.focus();
  }

  async function createChild(id: string, queued?: QueuedSubmission) {
    if (opening.current.has(id)) return;
    const request = Symbol();
    replaceTab(id, { kind: 'new', working: true });
    opening.current.set(id, request);
    const current = () => alive.current && opening.current.get(id) === request;
    let stream: TurnStream | undefined;
    let removed = false;
    try {
      const thread = await forkSidechat(parentId, current, hostId);
      if (!current()) return;
      stream = new TurnStream(thread.id, hostId);
      if (queued) {
        const { thread: resumed } = await resumeThread(thread.id, hostId);
        if (resumed.id !== thread.id || !current()) return;
        const { deleted } = await deleteQueuedSubmission(parentId, queued.id, hostId);
        if (!deleted) throw new Error('This message is no longer queued.');
        removed = true;
        if (!current()) { await recoverQueuedDraft(hostId === 'local' ? thread.id : hostId + ':' + thread.id, queued); return; }
        stream.acknowledge((await submitTransferredInput(thread.id, queued, hostId)).turn);
      }
      if (current()) replaceTab(id, { kind: 'chat', view: { stream } });
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error);
      if (stream && queued && removed) {
        const uncertain = error instanceof WorkspaceRequestError && error.uncertain;
        if (uncertain) message = 'Delivery to this side chat is unknown. Check the conversation before trying again.';
        else {
          await recoverQueuedDraft(hostId === 'local' ? stream.threadId : hostId + ':' + stream.threadId, queued);
          message = 'The message is back in the side chat draft. ' + message;
        }
        if (current()) replaceTab(id, { kind: 'chat', view: { stream }, error: message });
      } else if (current()) replaceTab(id, { kind: 'new', error: message });
    }
  }

  function openOutput(file: OutputFile) {
    showTab({ kind: 'output', file }, tabs.find(row => row.tool.kind === 'output' && row.tool.file.path === file.path));
  }

  function openSourceFile(file: PromptAttachment) { openOutput(attachmentOutput(file)); }

  function openSources() {
    showTab({ kind: 'sources' }, tabs.find(row => row.tool.kind === 'sources'));
    setToolsExpanded(true);
  }

  useImperativeHandle(ref, () => ({
    createSidechat() { void createChild(showTab()); },
    openQueuedSidechat(item) { return createChild(showTab(), item); },
    openOutput,
    openPage,
    openSubagent,
    openGoal,
    openImages,
    openMcpApp(app) {
      const existing = tabs.find(row => row.id === app.id);
      showTab({ kind: 'mcp-app', app }, existing, app.id);
      setToolsExpanded(true);
      requestAnimationFrame(() => document.getElementById(tabButton(app.id))?.focus({ preventScroll: true }));
    },
    closeMcpApp(id) {
      const existing = tabs.find(row => row.id === id && row.tool.kind === 'mcp-app');
      if (existing) closeTab(existing, false);
    },
    openChanges(turnId) {
      const existing = tabs.find(row => row.tool.kind === 'changes');
      const tool = { kind: 'changes', turnId, expanded: existing?.tool.kind === 'changes' ? existing.tool.expanded : true } as const;
      if (existing?.tool.kind === 'changes' && existing.tool.turnId !== turnId) replaceTab(existing.id, tool);
      showTab(tool, existing);
    },
  }));

  function openPage(url: string) {
    openClientBrowser({ type: 'open-in-browser', url, conversationId: parentId, hostId }, message => {
      if (typeof message.url === 'string') {
        openBrowser(undefined, message.url);
        setToolsExpanded(false);
      }
    });
  }

  function openBrowser(id: string | undefined, value: string, current?: WorkspaceBrowserView) {
    const url = parseBrowserAddress(value);
    const bridge = (window as ChromeWindow).workbenchChrome;
    if (!url || !bridge) return null;
    const target = current?.target ?? { conversationId: hostId === 'local' ? parentId : hostId + ':' + parentId, browserTabId: id ?? crypto.randomUUID() };
    if (!current) bridge.enableEmbeddedPages();
    bridge.setConversationHost(target.conversationId, hostId);
    bridge.commandEmbeddedPage(target, { type: 'navigate', url: url.href });
    if (!current) {
      const tool: Tool = { kind: 'browser', view: { bridge, target } };
      if (id !== undefined) replaceTab(id, tool);
      else showTab(tool, undefined, target.browserTabId);
    }
    return target.browserTabId;
  }
  return <>
    <div className="yard-source-right-controls">
      <button type="button" title="Summary" aria-label="Summary" ref={summaryTrigger} aria-controls={summaryId} aria-expanded={summaryOpen}
        onClick={() => {
          if (rightOpen) {
            setTabVisible(false);
            if (inline) setPinned(true); else setPopoverOpen(true);
          } else if (inline) setPinned(value => !value);
          else setPopoverOpen(value => !value);
        }}><WorkspaceIcon name="summary" /></button>
      <button type="button" ref={rightTrigger} title={rightOpen ? 'Close right sidebar' : 'Open right sidebar'}
        aria-label={rightOpen ? 'Close right sidebar' : 'Open right sidebar'} aria-controls={tabId} aria-expanded={rightOpen}
        onClick={() => {
          if (!rightOpen && !tab) showTab({ kind: 'new', placeholder: true });
          else { setPopoverOpen(false); setTabVisible(!rightOpen); }
        }}><WorkspaceIcon name={rightOpen ? 'sidebar' : 'sidebarClosed'} className="rotate-180" /></button>
    </div>
    {summaryOpen && <aside className="yard-source-summary rounded-2xl bg-surface-elevated-secondary electron:elevation-prominent" id={summaryId} ref={summarySurface}
      aria-label="Conversation summary" data-summary-inline={inline} data-summary-panel-variant="summary" data-summary-panel-density="default">
      <Outputs create={createOutput} cwd={cwd} turns={turns} choose={openOutput} hostId={hostId} />
      {subagents.size > 0 && <SummarySection key={`${hostId}:${parentId}:subagents`} sectionKey="subagents"
        title="Subagents" itemCount={subagents.size} className="yard-source-subagent-list">
        {[...subagents].map(([id, child]) => <AgentLink key={id} id={id} name={subagentTitle(child)}
          status={child.status.type === 'active' ? 'running' : undefined} open={openSubagent} />)}
      </SummarySection>}
      {rows.length > 0 && <SummarySection key={`${hostId}:${parentId}:side-chats`} sectionKey="side-chats"
        title="Side chats" itemCount={rows.length} className="yard-source-sidechat-list">
        {rows.map(row => <button type="button" key={row.conversationId}
          data-attached-thread-id={row.conversationId} onClick={() => openChild(row.conversationId)}>
          <MessageSquare size={14} aria-hidden="true" /><span dir="auto">{row.title}</span>
          {row.isResponseInProgress && <span className="yard-source-sidechat-activity" aria-label="In progress" />}
        </button>)}
      </SummarySection>}
      <SourcesSummary key={`${hostId}:${parentId}:sources`} data={sources} openDetails={openSources} openFile={openSourceFile} attach={attachSource} cwd={cwd} insertPlugin={insertPlugin} hostId={hostId} />
      {branch.error && <p role="alert">{branch.error}</p>}
    </aside>}
    {tab && <aside ref={rightPane} className="yard-source-sidechat" id={tabId} hidden={!rightOpen} data-expanded={expanded} data-tool-kind={tab.tool.kind}
      aria-label={labels[tab.tool.kind]}>
      {rightOpen && !expanded && <WorkspaceSplitter workspace={workspace} pane={tabId} ratio={paneRatio} />}
      <div className="yard-source-sidechat-tabbar">
        <div className="yard-source-tool-tabs" role="tablist" aria-label="Chat tabs" hidden={tab.tool.kind === 'new' && tab.tool.placeholder}
          onKeyDown={event => {
            if ((event.target as HTMLElement).getAttribute('role') !== 'tab') return;
            const index = tabs.indexOf(tab), last = tabs.length - 1;
            const target = event.key === 'Home' ? 0 : event.key === 'End' ? last :
              event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + last) % tabs.length : -1;
            const next = tabs[target];
            if (!next) return;
            event.preventDefault(); setSelected(next.id); document.getElementById(tabButton(next.id))?.focus();
          }}>
          {tabs.map((row, index) => {
            const { id, tool } = row;
            const button = <button type="button" role="tab" key={id} id={tabButton(id)} aria-selected={id === tab.id}
            tabIndex={id === tab.id ? 0 : -1} aria-controls={tabPanel(id)} aria-label={toolTitle(tool)}
            title={tool.kind === 'browser' ? undefined : toolTitle(tool)} onClick={() => setSelected(id)}
            onAuxClick={event => { if (event.button === 1) { event.preventDefault(); closeTab(row); } }}
            onMouseDown={event => { if (event.button === 1) event.preventDefault(); }}>
            {tool.kind === 'agent' ? <Bot className="yard-source-subagent-icon" size={14} aria-hidden="true" /> :
              tool.kind === 'terminal' ? <WorkspaceIcon name="tabTerminal" /> : tool.kind === 'browser' || tool.kind === 'iab' || tool.kind === 'new' ? <WorkspaceIcon name="tabBrowser" /> :
              tool.kind === 'chat' ? <WorkspaceIcon name="tabChat" /> : tool.kind === 'output' ? <WorkspaceIcon name="tabFile" /> :
              tool.kind === 'files' ? <WorkspaceIcon name="tabFiles" /> :
              tool.kind === 'changes' ? <Diff size={14} aria-hidden="true" /> : tool.kind === 'sources' ? <Workflow size={13} aria-hidden="true" /> :
              tool.kind === 'mcp-app' ? <AtSign size={14} aria-hidden="true" /> : tool.kind === 'goal' ? <GoalIcon name="goal" size={16} /> :
              tool.kind === 'image-editor' || tool.kind === 'image-preview' ? <WorkspaceIcon name="toolImage" /> : null}
            <span className="yard-source-tool-tab-title">{tool.kind === 'browser' ? <BrowserTabTitle view={tool.view} /> : toolTitle(tool)}</span>
            {showShortcuts && index < 9 && <kbd aria-hidden="true">{mac ? '⌘' : 'Ctrl+'}{document.dir === 'rtl' ? tabs.length - index : index + 1}</kbd>}
            </button>;
            const closeLabel = 'Close ' + toolTitle(tool) + ' tab';
            return <div className="yard-source-labeled-tab" key={id} data-active={id === tab.id}>
              {button}
              <button type="button" title={closeLabel} aria-label={closeLabel} data-app-shell-tab-close-button="" tabIndex={-1}
                onMouseDown={event => event.preventDefault()} onClick={() => closeTab(row)}>
                <WorkspaceIcon name="close" size={14} />
              </button>
            </div>;
          })}
        </div>
        <button type="button" aria-label="New tab" title="New tab" onClick={() => {
          if (tab.tool.kind === 'new' && tab.tool.placeholder && !tab.tool.working) replaceTab(tab.id, { ...tab.tool, placeholder: false });
          else showTab();
        }}><WorkspaceIcon name="plus" /></button>
        {tab.tool.kind === 'output' && <a aria-label="Download output" title="Download output" href={outputFileUrl(tab.tool.file, 'download', hostId)}>
          <Download size={14} aria-hidden="true" />
        </a>}
        <button type="button" className="yard-source-tool-expand" aria-pressed={expanded} aria-label={expanded ? 'Exit full screen' : 'Enter full screen'}
          title={expanded ? 'Exit full screen' : 'Enter full screen'} onClick={() =>
            tab.tool.kind === 'changes' ? replaceTab(tab.id, { ...tab.tool, expanded: !expanded }) : setToolsExpanded(value => !value)}>
          <WorkspaceIcon name={expanded ? 'panelCollapse' : 'panelExpand'} />
        </button>
      </div>
      {tabs.map(({ id, tool }) => {
        const panel = { panelId: tabPanel(id), labelId: tabButton(id) };
        const visible = id === tab.id && rightOpen;
        const ownsImageComposer = imageTarget?.ownerTabId === id;
        if (tool.kind === 'terminal') return <TerminalPanel key={id} session={tool.session} visible={visible} tab={panel} />;
        const newTools = (tool.kind === 'new' || tool.kind === 'browser') && <NewTab menu={newTabMenu} actions={[
              ...(cwd ? [{ id: 'terminal', title: 'Terminal', icon: <SquareTerminal size={16} aria-hidden="true" /> }] : []),
              ...(supported ? [{ id: 'side-chat', title: 'Side chat', icon: <MessageSquarePlus size={16} aria-hidden="true" /> }] : []),
              ...(cwd ? [{ id: 'open-file', title: 'Files', icon: <Folders size={16} aria-hidden="true" /> }] : []),
              ...(hostId === 'local' ? [{ id: 'agent-browser', title: 'Agent Browser', icon: <WorkspaceIcon name="tabBrowser" /> }] : []),
            ]}
            yardResolveUrl={newTabAddress} yardOpenUrl={value => openBrowser(id, value, tool.kind === 'browser' ? tool.view : undefined)}
            onSearchFiles={cwd ? query => replaceTab(id, { kind: 'files', cwd, query }) : undefined}
            onActionSelect={action => {
              if (action.id === 'terminal' && cwd) replaceTab(id, { kind: 'terminal', number: ++terminalNumber.current, session: { sessionId: crypto.randomUUID(), hostId, cwd } });
              else if (action.id === 'side-chat') void createChild(id);
              else if (action.id === 'open-file' && cwd) replaceTab(id, { kind: 'files', cwd });
              else if (action.id === 'agent-browser') replaceTab(id, { kind: 'iab' });
            }} onToggleBottomPanel={openBottomTerminal}>
              {tool.kind === 'new' && tool.working && <p role="status">Opening side chat…</p>}
              {tool.kind === 'new' && tool.error && <p role="alert">{tool.error}</p>}
            </NewTab>;
        return <div className="yard-source-tool-panel" key={id} role="tabpanel" id={panel.panelId} aria-labelledby={panel.labelId}
          hidden={!visible && !ownsImageComposer} data-image-composer-owner={ownsImageComposer ? '' : undefined}>
          {tool.kind === 'iab' ? visible && <IabBrowserPanel sessionId={parentId} request={requestIabBrowser} /> :
            tool.kind === 'mcp-app' ? <McpAppTabContent app={tool.app} /> :
            tool.kind === 'output' ? <OutputPreview file={tool.file} hostId={hostId} /> : tool.kind === 'chat' ?
            <Sidechat view={tool.view} transferError={tool.error} openOutput={openOutput} openSubagent={openSubagent} openPage={openPage} openGoal={openGoal}
              openImages={openImages} tabId={id} /> :
            tool.kind === 'agent' ? <Sidechat view={tool.view} openOutput={openOutput} openSubagent={openSubagent} openPage={openPage} openGoal={openGoal}
              openImages={openImages} tabId={id} /> :
            tool.kind === 'files' ? <WorkspaceFiles root={tool.cwd} initialQuery={tool.query} hostId={hostId} /> : tool.kind === 'browser' ?
            <BrowserTab view={tool.view}>{newTools}</BrowserTab> : tool.kind === 'sources' ?
            <SourcesPanel data={sources} openFile={openSourceFile} openPage={url => openBrowser(undefined, url)} /> : tool.kind === 'changes' && stream ?
            <TurnChangesPanel key={tool.turnId} turnId={tool.turnId} stream={stream} turns={turns} cwd={cwd} /> :
            tool.kind === 'goal' ? <GoalTab threadId={tool.threadId} hostId={tool.hostId} /> :
            tool.kind === 'image-editor' ? <ImageEditorTab tool={tool} visible={visible} select={selectedId => replaceTab(id, { ...tool, selectedId })} openImage={openImagePreview} /> :
            tool.kind === 'image-preview' ? <Suspense fallback={null}><GeneratedImageEditor readOnly images={[tool.image]} selectedId={tool.image.id}
              hostId={tool.hostId} visible={visible} onOpenImage={image => openImagePreview(image, tool.hostId)} /></Suspense> : newTools}
        </div>;
      })}
    </aside>}
  </>;
}
