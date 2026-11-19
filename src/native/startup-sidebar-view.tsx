/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import type * as ReactRuntime from 'react';
import type { Root } from 'react-dom/client';
import type { StartupSidebar, StartupThread } from './startup-sidebar.ts';
import { initialWorkspaceRoute } from './history-startup.ts';

let React: typeof ReactRuntime;
export interface StartupSidebarBridge {
  load(): Promise<StartupSidebar>;
  navigate(route: string): void;
  route(): string | null;
}

const styles = `
#yard-startup{position:fixed;inset:0 auto auto 0;width:calc(100vw / var(--yard-startup-zoom,1));height:calc(100svh / var(--yard-startup-zoom,1));zoom:var(--yard-startup-zoom,1);z-index:100;color-scheme:light dark;background:#fff;background:light-dark(#fff,#212121);color:#303438;display:flex;font:430 13px/1.4285714 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;--yard-startup-muted:#92969b;--yard-startup-placeholder:#ededed}
#yard-startup *{box-sizing:border-box}
#yard-startup aside{width:var(--yard-startup-sidebar-width,340px);flex:none;min-height:0;border-right:1px solid #8882;display:flex;flex-direction:column;padding:0 8px}
#yard-startup header{display:flex;align-items:center;gap:8px;height:32px;flex:none;padding:0 8px;font-size:17px;font-weight:600;letter-spacing:-.4px}
#yard-startup header img{width:22px;height:22px;flex:none}
#yard-startup .yard-startup-window-controls{height:46px;display:flex;align-items:center;gap:18px;padding:0 8px;flex:none}
#yard-startup .yard-startup-header-actions{display:flex;gap:16px;margin-left:auto}
#yard-startup nav{overflow:auto;flex:1;min-height:0;margin-top:16px;padding-bottom:12px;scrollbar-width:thin}
#yard-startup section+section{margin-top:16px}
#yard-startup h2{font:inherit;font-size:13px;color:var(--yard-startup-muted);margin:12px 8px 8px}
#yard-startup button{border:0;background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit;width:100%;min-height:30px;padding:5px 8px;border-radius:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#yard-startup button:hover,#yard-startup button[aria-current=page]{background:#8882}
#yard-startup button:focus-visible{outline:2px solid #6a9ddb;outline-offset:-2px}
#yard-startup .yard-startup-new-chat{display:flex;align-items:center;gap:8px;flex:none}
#yard-startup .yard-startup-new-chat svg{width:16px;height:16px;flex:none}
#yard-startup .yard-startup-thread{padding-left:28px}
#yard-startup .yard-startup-pinned .yard-startup-thread,#yard-startup .yard-startup-recent .yard-startup-thread{padding-left:8px}
#yard-startup .yard-startup-project{height:30px;padding:6px 8px;color:inherit;display:flex;align-items:center;gap:8px;min-width:0}
#yard-startup .yard-startup-project svg{width:16px;height:16px;flex:none}
#yard-startup .yard-startup-project-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#yard-startup .yard-startup-skeleton{display:block;height:10px;border-radius:4px;background:var(--yard-startup-placeholder);flex:none}
#yard-startup .yard-startup-skeleton-icon{width:14px;height:14px}
#yard-startup .yard-startup-placeholder-row{height:30px;display:flex;align-items:center;gap:8px;padding:0 8px}
#yard-startup .yard-startup-placeholder-row[data-indent]{padding-left:28px}
#yard-startup .yard-startup-placeholder-heading{height:34px;display:flex;align-items:center;padding:0 8px}
#yard-startup footer{height:40px;border-top:1px solid #8882;display:flex;align-items:center;gap:8px;padding:0 8px;flex:none}
#yard-startup .yard-startup-status{margin:8px;color:var(--yard-startup-muted)}
#yard-startup .yard-startup-sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
#yard-startup main{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;padding-left:calc(1px / var(--yard-startup-zoom,1));color:#1a1c1f;font-size:16px;line-height:24px}
#yard-startup .yard-startup-tabs{height:46px;flex:none;border-bottom:1px solid #8882;background:#fafafa;display:flex;align-items:center;gap:16px;padding:6px 8px;color:var(--yard-startup-muted)}
#yard-startup .yard-startup-tab{width:min(240px,70%);height:32px;border:1px solid #8882;border-radius:8px;background:#fff;display:flex;align-items:center;gap:6px;padding:0 10px;font-size:13px;color:#303438}
#yard-startup .yard-startup-tab svg{width:16px;height:16px}
#yard-startup .yard-startup-home{display:flex;flex:1;flex-direction:column;min-height:0;padding:24px calc(10px / var(--yard-startup-zoom,1)) 0}
#yard-startup .yard-startup-hero-region{display:flex;flex:1 1 0px;min-height:min-content;align-items:flex-end;justify-content:center;padding-bottom:96px}
#yard-startup .yard-startup-hero{display:flex;flex-direction:column;align-items:center;gap:24px;width:min(100%,768px);padding:0 20px}
#yard-startup main img{width:56px;height:56px;flex:none}
#yard-startup .yard-startup-hero h1{font:400 28px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center;overflow-wrap:anywhere;margin:0;max-width:100%}
#yard-startup .yard-startup-project-name{text-decoration:underline dotted #92969b 1px;text-underline-offset:4px}
#yard-startup .yard-startup-heading-placeholder{height:33.6px;width:min(440px,100%);display:flex;align-items:center;justify-content:center}
#yard-startup .yard-startup-heading-placeholder span{height:20px;width:85%}
#yard-startup .yard-startup-composer-region{display:flex;flex:1 0 0px;min-height:min-content;flex-direction:column;justify-content:flex-end}
#yard-startup .yard-startup-composer-width{width:100%;max-width:768px;padding:14px 16px 16px;margin:0 auto}
#yard-startup .yard-startup-composer-stack{position:relative}
#yard-startup .yard-startup-composer-project{position:absolute;bottom:calc(100% - 12px);left:12px;right:12px;height:50px;border-radius:16px 16px 0 0;background:#f5f5f5;padding:10px 12px 24px;display:flex;align-items:center;gap:8px;font-size:13px;line-height:18px;color:#45484b}
#yard-startup .yard-startup-composer-project svg{width:16px;height:16px;flex:none}
#yard-startup .yard-startup-composer-project-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#yard-startup .yard-startup-composer{position:relative;background:#fff;border-radius:22px;padding:14px 12px 8px;box-shadow:0 0 0 1px #0000000a,0 2px 8px #0000000a,0 4px 80px 8px #00000006}
#yard-startup textarea{display:block;width:100%;min-width:0;height:44px;min-height:44px;max-height:25dvh;margin:0;padding:0;border:0;border-radius:0;background:transparent;color:inherit;font:430 14px/20px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;resize:none;outline:none}
#yard-startup textarea::placeholder{color:#92969b;opacity:.5}
#yard-startup textarea:focus-visible{outline:none}
#yard-startup .yard-startup-composer:focus-within{box-shadow:0 0 0 1px #8885,0 2px 8px #0000000a,0 4px 80px 8px #00000006}
#yard-startup .yard-startup-input-placeholder{height:44px;padding-top:6px}
#yard-startup .yard-startup-composer-tools{height:28px;margin-top:4px;display:flex;align-items:center;gap:16px}
#yard-startup .yard-startup-composer-tools svg{width:16px;height:16px;color:#45484b}
#yard-startup .yard-startup-model-placeholder{margin-left:auto;width:80px}
#yard-startup .yard-startup-send-placeholder{width:28px;height:28px;border-radius:50%;background:#8888;display:grid;place-items:center}
#yard-startup .yard-startup-send-placeholder svg{color:#fff}
#yard-startup .yard-startup-opening{display:none;flex:1;min-width:0;align-items:center;justify-content:center;flex-direction:column;gap:20px;padding:24px;text-align:center}
#yard-startup .yard-startup-opening p{margin:0;color:var(--yard-startup-muted);max-width:40ch;overflow-wrap:anywhere}
#yard-startup[data-page=conversation] .yard-startup-home{display:none}
#yard-startup[data-page=conversation] .yard-startup-opening{display:flex}
#yard-startup textarea[hidden]{display:none}
#yard-startup-draft-recovery{position:fixed;inset:auto 12px 12px auto;z-index:100;color-scheme:light dark;padding:12px;border:1px solid #8886;border-radius:8px;background:light-dark(white,#212121);color:inherit;font:14px/1.5 system-ui,sans-serif}
#yard-startup-draft-recovery textarea{display:block;width:min(22rem,calc(100vw - 48px));min-height:5rem;font:inherit}
#yard-startup .yard-startup-toggle{display:none}
@media(prefers-color-scheme:dark){#yard-startup{color:#eee;--yard-startup-muted:#9b9b9b;--yard-startup-placeholder:#383838}#yard-startup main{color:#eee;background:#181818}#yard-startup .yard-startup-tabs{background:#181818}#yard-startup .yard-startup-tab{background:#212121;color:#eee}#yard-startup .yard-startup-composer{background:#363636;color:#eee;box-shadow:none}#yard-startup .yard-startup-composer-project{background:#292929;color:#ddd}#yard-startup .yard-startup-composer-tools svg{color:#ddd}}
@media(prefers-reduced-motion:no-preference){:root:not([data-reduced-motion=true]) #yard-startup .yard-startup-skeleton{animation:yard-startup-pulse 1.8s ease-in-out infinite}}
@keyframes yard-startup-pulse{50%{opacity:.45}}
@media(max-width:767px){#yard-startup aside{display:none;position:absolute;inset:0 auto 0 0;width:min(var(--yard-startup-sidebar-width,340px),85%);z-index:2;background:inherit;padding-top:42px;box-shadow:8px 0 30px #0002}#yard-startup[data-open=true] aside{display:flex}#yard-startup main{padding-left:0}#yard-startup .yard-startup-toggle{display:block;position:absolute;top:5px;left:10px;width:36px;z-index:3}#yard-startup .yard-startup-tabs{padding-left:54px}#yard-startup .yard-startup-window-controls{display:none}#yard-startup .yard-startup-composer{box-shadow:0 0 0 1px #0000000a,0 2px 8px #0000000a,0 4px 40px 8px #00000006}}
`;

function SkeletonRows({ indent = false }: { indent?: boolean }) {
  return <div aria-hidden="true" data-yard-startup-skeleton="">
    {[78, 62, 86, 70, 58].map((width, index) => <div key={index} className="yard-startup-placeholder-row" data-indent={indent || undefined}>
      <span className="yard-startup-skeleton" style={{ width: `${width}%` }} />
    </div>)}
  </div>;
}

function mayHaveSavedHomeDraft(): boolean {
  try {
    const atoms = JSON.parse(localStorage.getItem('native-atoms') ?? '{}');
    // A conservative hint. The renderer makes the decision from its actual
    // hydrated scope, including attachments and structured drafts.
    for (const key of ['composer-prompt-drafts-v2', 'composer-prompt-drafts-v1', 'composer-retained-documents-v1']) {
      if (atoms?.[key]?.['new-conversation'] != null ||
          JSON.parse(localStorage.getItem('codex:persisted-atom:' + key) ?? 'null')?.['new-conversation'] != null) return true;
    }
    return false;
  } catch {
    return true;
  }
}

/** An initial view of real recent metadata, using an independent React root.
 * It owns no conversation state and is removed once that renderer takes over. */
export function mountStartupSidebar(runtime: typeof ReactRuntime, renderer: { createRoot(element: Element): Root }, bridge: StartupSidebarBridge,
    transferComposerFocus: (previous: HTMLElement, next: HTMLElement) => void): Promise<void> {
  let selectedRoute = initialWorkspaceRoute(document.querySelector<HTMLMetaElement>('meta[name="initial-route"]')?.content,
    location.search, location.pathname);
  // Settings and plugin pages have their own navigation lifecycle. Their
  // original interface loads directly, without a conversation startup view.
  if (selectedRoute !== '/' && !selectedRoute.startsWith('/local/') && !selectedRoute.startsWith('/remote-')) return Promise.resolve();
  const showDraft = selectedRoute === '/' && !location.search && !location.hash && !mayHaveSavedHomeDraft();
  let eligibleDraft = showDraft;
  React = runtime;
  const container = document.createElement('div');
  container.id = 'yard-startup';
  container.dataset.page = selectedRoute === '/' ? 'home' : 'conversation';
  // Match the renderer's existing per-browser layout before its state hydrates.
  // These are display preferences only; the original renderer owns persistence.
  try {
    const saved = JSON.parse(localStorage.getItem('native-atoms') ?? '{}');
    const zoom = saved['electron:window-zoom'];
    if (typeof zoom === 'number' && Number.isFinite(zoom) && zoom > 0) container.style.setProperty('--yard-startup-zoom', String(zoom));
    const width = saved['sidebar-width'];
    if (typeof width === 'number' && Number.isFinite(width)) container.style.setProperty('--yard-startup-sidebar-width', `${Math.max(240, Math.min(width, 520))}px`);
  } catch { /* Use the same default width as the renderer. */ }
  document.body.append(container);
  const style = document.createElement('style');
  style.textContent = styles;
  document.head.append(style);
  const original = document.getElementById('root')!;
  original.inert = true;
  original.setAttribute('aria-hidden', 'true');
  const root = renderer.createRoot(container);
  let pending: HTMLTextAreaElement | null = null;
  let finalizeComposition: ReturnType<typeof setTimeout> | undefined;
  let selectedByUser = false;
  let snapshot: StartupSidebar | undefined, disposed = false;
  let ready: () => void;
  const painted = new Promise<void>(resolve => { ready = resolve; });
  // An unavailable backend must not hold the full application's recovery UI.
  const fallback = setTimeout(() => ready(), 250);
  const observer = new MutationObserver(check);
  observer.observe(original, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['data-app-shell-frame', 'data-app-action-sidebar-project-collapsed', 'data-app-action-sidebar-section-collapsed', 'aria-expanded'] });
  window.addEventListener('yard-workspace-route', routeChanged);
  function invalidateDraft() {
    eligibleDraft = false;
    if (pending) {
      delete pending.dataset.yardActive;
      if (pending.dataset.composition == null) pending.hidden = true;
    }
  }
  function routeChanged() {
    const route = bridge.route();
    if (route != null) container.dataset.page = route === '/' ? 'home' : 'conversation';
    if (route != null && route !== '/') invalidateDraft();
    check();
  }
  let scheduled = false;
  function check() {
    if (scheduled || disposed) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (selectedByUser && bridge.route() !== selectedRoute) return;
      const shell = original.querySelector('[data-app-shell-frame]');
      const rows = original.querySelector('[data-app-action-sidebar-thread-row]');
      const hiddenSidebar = original.querySelector('[data-app-shell-sidebar-trigger][aria-expanded="false"]');
      const projectRows = [...original.querySelectorAll('[data-app-action-sidebar-project-id]')];
      const projectsClosed = snapshot?.threads.every(thread => thread.projectId != null && projectRows.some(project =>
        project.getAttribute('data-app-action-sidebar-project-id') === thread.projectId && project.getAttribute('data-app-action-sidebar-project-collapsed') === 'true'));
      const sections = [...original.querySelectorAll('[data-app-action-sidebar-section]')];
      const sectionsClosed = sections.length > 0 && sections.every(section => section.getAttribute('data-app-action-sidebar-section-collapsed') === 'true');
      if (!shell || snapshot?.threads.length && !rows && !hiddenSidebar && !projectsClosed && !sectionsClosed) return;
      if (pending?.dataset.composition != null) return;
      const accepted = eligibleDraft && selectedRoute === '/' && pending?.dataset.yardAdopted === 'true';
      const editor = accepted ? original.querySelector<HTMLElement>('[data-codex-composer="true"]') : null;
      if (accepted && !editor) return;
      const focusFrom = document.activeElement === pending ? pending : null;
      const restoreFocus = container.contains(document.activeElement);
      if (accepted) pending?.dispatchEvent(new Event('select'));
      if (pending) {
        delete pending.dataset.yardActive;
        pending.readOnly = true;
      }
      const recovery = !accepted ? pending?.value : undefined;
      disposed = true;
      observer.disconnect();
      window.removeEventListener('yard-workspace-route', routeChanged);
      if (recovery) {
        container.id = 'yard-startup-draft-recovery';
        root.render(<details open><summary>启动时的草稿</summary>
          <textarea readOnly aria-label="启动时的草稿" value={recovery} />
          <button onClick={() => queueMicrotask(cleanup)}>丢弃临时草稿</button>
        </details>);
      } else cleanup();
      original.inert = false; original.removeAttribute('aria-hidden');
      performance.mark('workbench-workspace-takeover');
      if (focusFrom && editor) transferComposerFocus(focusFrom, editor);
      else if (restoreFocus && !recovery) {
        const sidebar = original.querySelector<HTMLElement>('#app-shell-sidebar');
        if (sidebar) { sidebar.tabIndex = -1; sidebar.focus({ preventScroll: true }); }
      }
      requestAnimationFrame(() => requestAnimationFrame(() => {
        performance.mark('workbench-workspace-visible');
        window.dispatchEvent(new Event('yard-workspace-ready'));
      }));
    });
  }
  function cleanup() {
    clearTimeout(finalizeComposition);
    root.unmount(); container.remove(); style.remove();
  }
  function Sidebar() {
    const [data, setData] = React.useState<StartupSidebar>();
    const [error, setError] = React.useState(false);
    const [selection, setSelection] = React.useState<string>();
    const [expanded, setExpanded] = React.useState<string[]>([]);
    const [open, setOpen] = React.useState(false);
    React.useEffect(() => {
      let active = true;
      void bridge.load().then(value => { if (active) { snapshot = value; setData(value); } }, () => { if (active) setError(true); });
      return () => { active = false; };
    }, []);
    React.useEffect(() => {
      container.dataset.open = String(open);
    }, [open]);
    React.useEffect(() => {
      if (!data && !error) return;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        // Resume imports in a task after this rendering opportunity. Resolving
        // inside rAF would let import/init microtasks block the very same paint.
        setTimeout(() => {
          performance.mark('workbench-startup-sidebar-visible');
          clearTimeout(fallback); ready();
        }, 0);
      }));
    }, [data, error]);
    function navigate(route: string, title?: string) {
      if (route !== '/') invalidateDraft();
      selectedRoute = route;
      container.dataset.page = route === '/' ? 'home' : 'conversation';
      selectedByUser = true;
      setSelection(title); setOpen(false);
      bridge.navigate(route);
      performance.mark('workbench-startup-sidebar-select');
      check();
    }
    function thread(row: StartupThread) {
      const route = '/local/' + encodeURIComponent(row.id);
      return <button key={row.id} className="yard-startup-thread" data-yard-startup-thread-row="" aria-current={selectedRoute === route ? 'page' : undefined}
        title={row.title} onClick={() => navigate(route, row.title)}>{row.title}</button>;
    }
    const pinned = new Set(data?.pinnedIds);
    const homeProject = data?.projects.find(project => project.id === data.selectedProjectId);
    const chinese = data?.locale.startsWith('zh') ?? true;
    return <>
      <button className="yard-startup-toggle" aria-label={open ? '收起侧栏' : '打开侧栏'} aria-expanded={open} onClick={() => setOpen(!open)}>☰</button>
      <aside aria-label="对话列表">
        <div className="yard-startup-window-controls" aria-hidden="true">
          {[0, 1, 2].map(key => <span key={key} className="yard-startup-skeleton yard-startup-skeleton-icon" />)}
        </div>
        <header><img src="/brand/icon.svg" alt="" />Codex Yard
          <span className="yard-startup-header-actions" aria-hidden="true">
            <span className="yard-startup-skeleton yard-startup-skeleton-icon" /><span className="yard-startup-skeleton yard-startup-skeleton-icon" />
          </span>
        </header>
        <button className="yard-startup-new-chat" onClick={() => navigate('/')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M16 3a2.12 2.12 0 0 1 3 3l-9 9-4 1 1-4Z" />
          </svg>新聊天
        </button>
        <div aria-hidden="true">
          {[72, 56].map(width => <div key={width} className="yard-startup-placeholder-row">
            <span className="yard-startup-skeleton yard-startup-skeleton-icon" /><span className="yard-startup-skeleton" style={{ width }} />
          </div>)}
        </div>
        <nav aria-label="最近对话" aria-busy={!data}>
          {!data && <>
            <div className="yard-startup-placeholder-heading" aria-hidden="true"><span className="yard-startup-skeleton" style={{ width: 42 }} /></div>
            <SkeletonRows />
            <div className="yard-startup-placeholder-heading" aria-hidden="true"><span className="yard-startup-skeleton" style={{ width: 56 }} /></div>
            <SkeletonRows indent />
            <p className={error ? 'yard-startup-status' : 'yard-startup-sr-only'} role="status">{error ? '正在连接工作区…' : '正在读取对话…'}</p>
          </>}
          {data?.threads.some(row => pinned.has(row.id)) && <section className="yard-startup-pinned"><h2>置顶</h2>{data.threads.filter(row => pinned.has(row.id)).map(thread)}</section>}
          {!!data?.projects.length && <h2>项目</h2>}
          {data?.projects.map(project => {
            const rows = data.threads.filter(row => row.projectId === project.id && !pinned.has(row.id));
            const showAll = expanded.includes(project.id);
            return <section key={project.id}><span className="yard-startup-project" title={project.label}>
              {/* Same FolderOpen path as the pinned renderer, without its deferred icon module or styles. */}
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
              </svg>
              <span className="yard-startup-project-label">{project.label}</span>
            </span>
              {(showAll ? rows : rows.slice(0, 5)).map(thread)}
              {!showAll && rows.length > 5 && <button className="yard-startup-thread" onClick={() => setExpanded([...expanded, project.id])}>展开显示</button>}
            </section>;
          })}
          {data?.threads.some(row => !pinned.has(row.id) && !data.projects.some(project => project.id === row.projectId)) && <section className="yard-startup-recent"><h2>最近对话</h2>
            {data.threads.filter(row => !pinned.has(row.id) && !data.projects.some(project => project.id === row.projectId)).map(thread)}</section>}
          {data?.threads.length === 0 && <p className="yard-startup-status">暂无最近对话</p>}
        </nav>
        <footer aria-hidden="true"><span className="yard-startup-skeleton yard-startup-skeleton-icon" /><span className="yard-startup-skeleton" style={{ width: 64 }} /></footer>
      </aside>
      <main>
        <div className="yard-startup-tabs" aria-hidden="true">
          <div className="yard-startup-tab">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" /></svg>
            <span>Chat</span>
          </div>
          <span className="yard-startup-skeleton yard-startup-skeleton-icon" />
        </div>
        <div className="yard-startup-home">
          <div className="yard-startup-hero-region">
            <div className="yard-startup-hero">
              <img src="/brand/icon.svg" alt="" />
              {data ? <h1>{homeProject ? chinese
                ? <>我们应该在<span className="yard-startup-project-name">{homeProject.label}</span>中做些什么？</>
                : <>What should we work on in <span className="yard-startup-project-name">{homeProject.label}?</span></>
                : chinese ? '我们要构建什么？' : 'What should we build?'}</h1>
                : <div className="yard-startup-heading-placeholder" aria-hidden="true"><span className="yard-startup-skeleton" /></div>}
            </div>
          </div>
          <div className="yard-startup-composer-region">
            <div className="yard-startup-composer-width">
              <div className="yard-startup-composer-stack">
                {(!data || homeProject) && <div className="yard-startup-composer-project" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7h18" /></svg>
                  {homeProject ? <span className="yard-startup-composer-project-label">{homeProject.label}</span>
                    : <span className="yard-startup-skeleton" style={{ width: 64 }} />}
                </div>}
                <div className="yard-startup-composer" aria-label="消息输入区">
        {showDraft && <textarea id="pending-yard-home-input" data-yard-active={eligibleDraft ? 'true' : undefined}
          hidden={!eligibleDraft} ref={element => { pending = element; }} placeholder={data ? chinese ? '随心输入' : 'Do anything' : ''} aria-label="输入消息"
          onInput={event => {
            const input = event.currentTarget;
            input.style.height = '0px';
            input.style.height = `${input.scrollHeight}px`;
            input.dataset.edited = 'true';
            input.dispatchEvent(new Event('yard-draft-input'));
          }}
          onCompositionStart={event => {
            clearTimeout(finalizeComposition);
            event.currentTarget.dataset.composition = 'active';
          }}
          onCompositionEnd={event => {
            const input = event.currentTarget;
            clearTimeout(finalizeComposition);
            finalizeComposition = setTimeout(() => {
              delete input.dataset.composition;
              input.dispatchEvent(new Event('pending-input-ready'));
              check();
            }, 0);
          }} />}
                  {!showDraft && <div className="yard-startup-input-placeholder" aria-hidden="true"><span className="yard-startup-skeleton" style={{ width: 86 }} /></div>}
                  <div className="yard-startup-composer-tools" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                    <span className="yard-startup-skeleton" style={{ width: 72 }} />
                    <span className="yard-startup-skeleton yard-startup-model-placeholder" />
                    <span className="yard-startup-send-placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m6 12 6-6 6 6M12 6v13" /></svg></span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <p className="yard-startup-sr-only" role="status">正在打开工作区…</p>
        </div>
        <div className="yard-startup-opening">
          <img src="/brand/icon.svg" alt="" />
          <p role="status">{selection ? `正在打开“${selection}”…` : '正在打开工作区…'}</p>
        </div>
      </main>
    </>;
  }
  root.render(<Sidebar />);
  return painted;
}
