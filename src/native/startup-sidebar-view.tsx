/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import type * as ReactRuntime from 'react';
import type { Root } from 'react-dom/client';
import type { StartupSidebar, StartupThread } from './startup-sidebar.ts';

let React: typeof ReactRuntime;
export interface StartupSidebarBridge {
  load(): Promise<StartupSidebar>;
  navigate(route: string): void;
  route(): string | null;
}

const styles = `
#yard-startup{position:fixed;inset:0;z-index:100;background:light-dark(#fff,#212121);color:var(--color-token-text-primary,#303438);display:flex;font:14px/1.5 system-ui,sans-serif}
#yard-startup *{box-sizing:border-box}
#yard-startup aside{width:340px;flex:none;border-right:1px solid #8882;display:flex;flex-direction:column;padding:42px 12px 12px}
#yard-startup header{display:flex;align-items:center;gap:8px;padding:6px 4px;font-size:17px;font-weight:600}
#yard-startup header img{width:22px;height:22px}
#yard-startup nav{overflow:auto;flex:1;margin-top:18px}
#yard-startup h2{font-size:14px;color:#888;font-weight:400;margin:14px 4px 6px}
#yard-startup button{border:0;background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit;width:100%;min-height:32px;padding:5px 12px;border-radius:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#yard-startup button:hover,#yard-startup button[aria-current=page]{background:#8882}
#yard-startup button:focus-visible{outline:2px solid #6a9ddb;outline-offset:-2px}
#yard-startup .yard-startup-thread{padding-left:28px}
#yard-startup .yard-startup-project{padding:7px 4px;color:inherit;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#yard-startup main{display:grid;place-content:center;text-align:center;flex:1;min-width:0;padding:24px}
#yard-startup main img{width:56px;height:56px;margin:0 auto 20px}
#yard-startup main p{margin:0;color:#888;max-width:40ch;overflow-wrap:anywhere}
#yard-startup .yard-startup-toggle{display:none}
@media(prefers-color-scheme:dark){#yard-startup{color:var(--color-token-text-primary,#eee)}}
@media(max-width:767px){#yard-startup aside{display:none;position:absolute;inset:0 auto 0 0;width:min(340px,85vw);background:inherit;padding-top:48px;box-shadow:8px 0 30px #0002}#yard-startup[data-open=true] aside{display:flex}#yard-startup .yard-startup-toggle{display:block;position:absolute;top:10px;left:10px;width:36px;z-index:1}}
`;

/** An initial view of real recent metadata, using the pinned renderer's React.
 * It owns no conversation state and is removed once that renderer takes over. */
export function mountStartupSidebar(runtime: typeof ReactRuntime, renderer: { createRoot(element: Element): Root }, bridge: StartupSidebarBridge): Promise<void> {
  let selectedRoute = document.querySelector<HTMLMetaElement>('meta[name="initial-route"]')?.content.trim() ||
    new URLSearchParams(location.search).get('initialRoute')?.trim() || '/';
  // Settings and plugin pages have their own navigation lifecycle. Their
  // original interface loads directly, without a conversation startup view.
  if (selectedRoute !== '/' && !selectedRoute.startsWith('/local/') && !selectedRoute.startsWith('/remote-')) return Promise.resolve();
  React = runtime;
  const container = document.createElement('div');
  container.id = 'yard-startup';
  document.body.append(container);
  const style = document.createElement('style');
  style.textContent = styles;
  document.head.append(style);
  const original = document.getElementById('root')!;
  original.inert = true;
  original.setAttribute('aria-hidden', 'true');
  const root = renderer.createRoot(container);
  let selectedByUser = false;
  let snapshot: StartupSidebar | undefined, disposed = false;
  let ready: () => void;
  const painted = new Promise<void>(resolve => { ready = resolve; });
  // An unavailable backend must not hold the full application's recovery UI.
  const fallback = setTimeout(() => ready(), 250);
  const observer = new MutationObserver(check);
  observer.observe(original, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['data-app-shell-frame', 'data-app-action-sidebar-project-collapsed', 'data-app-action-sidebar-section-collapsed', 'aria-expanded'] });
  window.addEventListener('yard-workspace-route', check);
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
      const restoreFocus = container.contains(document.activeElement);
      disposed = true;
      observer.disconnect();
      window.removeEventListener('yard-workspace-route', check);
      root.unmount(); container.remove(); style.remove();
      original.inert = false; original.removeAttribute('aria-hidden');
      performance.mark('workbench-workspace-takeover');
      if (restoreFocus) {
        const sidebar = original.querySelector<HTMLElement>('#app-shell-sidebar');
        if (sidebar) { sidebar.tabIndex = -1; sidebar.focus({ preventScroll: true }); }
      }
      requestAnimationFrame(() => requestAnimationFrame(() => {
        performance.mark('workbench-workspace-visible');
      }));
    });
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
      selectedRoute = route;
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
    return <>
      <button className="yard-startup-toggle" aria-label={open ? '收起侧栏' : '打开侧栏'} aria-expanded={open} onClick={() => setOpen(!open)}>☰</button>
      <aside aria-label="对话列表">
        <header><img src="/brand/icon.svg" alt="" />Codex Yard</header>
        <button onClick={() => navigate('/')}>新聊天</button>
        <nav aria-label="最近对话">
          {data?.threads.some(row => pinned.has(row.id)) && <section><h2>置顶</h2>{data.threads.filter(row => pinned.has(row.id)).map(thread)}</section>}
          {data?.projects.map(project => {
            const rows = data.threads.filter(row => row.projectId === project.id && !pinned.has(row.id));
            const showAll = expanded.includes(project.id);
            return <section key={project.id}><span className="yard-startup-project" title={project.label}>▱ &nbsp;{project.label}</span>
              {(showAll ? rows : rows.slice(0, 5)).map(thread)}
              {!showAll && rows.length > 5 && <button className="yard-startup-thread" onClick={() => setExpanded([...expanded, project.id])}>展开显示</button>}
            </section>;
          })}
          {data?.threads.some(row => !pinned.has(row.id) && !data.projects.some(project => project.id === row.projectId)) && <section><h2>最近对话</h2>
            {data.threads.filter(row => !pinned.has(row.id) && !data.projects.some(project => project.id === row.projectId)).map(thread)}</section>}
          {!data && <p role="status">{error ? '正在连接工作区…' : '正在读取对话…'}</p>}
          {data?.threads.length === 0 && <p>暂无最近对话</p>}
        </nav>
      </aside>
      <main><img src="/brand/icon.svg" alt="" /><p role="status">{selection ? `正在打开“${selection}”…` : '正在打开工作区…'}</p></main>
    </>;
  }
  root.render(<Sidebar />);
  return painted;
}
