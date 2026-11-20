/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import type * as ReactRuntime from 'react';

interface TabAction {
  id: string;
  title: string;
  icon: ReactRuntime.ReactNode;
  showInNewTabTools?: boolean;
  deferSelectionUntilDropdownClose?: boolean;
}
interface NewTabProps {
  actions: TabAction[];
  children?: ReactRuntime.ReactNode;
  onActionSelect(action: TabAction): void;
  onToggleBottomPanel(): void;
  yardResolveUrl?(value: string): string | null;
  yardOpenUrl?(url: string): unknown;
  onSearchFiles?(query: string): void;
}
export interface NewTabMenu {
  Dropdown: ReactRuntime.ComponentType<{ align: 'end'; triggerButton: ReactRuntime.ReactElement; children: ReactRuntime.ReactNode; onCloseAutoFocus(event: { preventDefault(): void }): void }>;
  Item: ReactRuntime.ComponentType<{ onSelect(): void; children: ReactRuntime.ReactNode }>;
}

// Layout metrics follow New tab's L/X/ee components in App 26.1111.21308.
// Keep the pinned renderer's theme tokens and React dispatcher.
const css = `
.yard-new-tab { container-type:size; padding:0 24px 32px; background:var(--color-surface); }
.yard-new-tab-content { width:100%; max-width:576px; margin:0 auto; padding-top:max(25cqh,32px); display:flex; flex-direction:column; gap:32px; }
.yard-new-tab-search { display:flex; align-items:center; gap:10px; width:100%; min-height:50px; padding:0 18px; border:1px solid var(--color-border); border-radius:999px; box-shadow:0 4px 20px #00000006; }
.yard-new-tab-search:focus-within { outline:2px solid var(--color-text-tertiary); outline-offset:2px; }
.yard-new-tab-search svg { flex:none; width:16px; height:16px; }
.yard-new-tab-search input { width:100%; min-width:0; padding:12px 0; border:0; outline:0; background:transparent; color:inherit; font:inherit; font-size:14px; }
.yard-new-tab-search input::placeholder { color:var(--color-text-tertiary); opacity:1; }
.yard-new-tab-tools { display:flex; flex-direction:column; gap:16px; }
.yard-new-tab-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.yard-new-tab-heading h3 { margin:0; font-size:14px; font-weight:500; }
.yard-new-tab-cards { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
.yard-new-tab-card { display:flex; flex-direction:column; align-items:flex-start; justify-content:center; gap:12px; min-width:0; min-height:88px; border:0; border-radius:16px; padding:16px 24px; background:var(--alpha-04); text-align:start; cursor:pointer; font:inherit; transition:background-color var(--yard-motion-fast,100ms) ease-out,transform var(--yard-motion-fast,100ms) var(--yard-motion-ease,ease-out); }
.yard-new-tab-card:hover { background:var(--alpha-08); }
.yard-new-tab-card:active { transform:translateY(1px); }
.yard-new-tab-card svg { width:16px; height:16px; }
.yard-new-tab-card span { max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:14px; }
.yard-new-tab-card:focus-visible,.yard-new-tab-more:focus-visible { outline:2px solid currentColor; outline-offset:3px; }
.yard-new-tab-more { display:flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius:6px; cursor:pointer; transition:background-color var(--yard-motion-fast,100ms) ease-out; }
.yard-new-tab-more:hover { background:var(--alpha-04); }
@container (max-width:440px) { .yard-new-tab-card { padding-inline:16px; } }
@container (max-width:320px) { .yard-new-tab-cards { grid-template-columns:repeat(2,minmax(0,1fr)); } }
`;

type NewTabViewProps = NewTabProps & { recentContent?: ReactRuntime.ReactNode; menu: NewTabMenu };

function NewTabView({ runtime: React, actions, children, onActionSelect, onToggleBottomPanel, yardResolveUrl, yardOpenUrl, onSearchFiles, recentContent, menu }:
  NewTabViewProps & { runtime: typeof ReactRuntime }) {
  const [query, setQuery] = React.useState('');
  const [error, setError] = React.useState('');
  const pendingAction = React.useRef<TabAction | null>(null);
  const { Dropdown, Item } = menu;
  const available = actions.filter(action => action.id !== 'review' && action.showInNewTabTools !== false);
  const cards = ['terminal', 'side-chat', 'open-file'].flatMap(id => available.filter(action => action.id === id));
  const more = available.filter(action => !cards.includes(action));
  const hasFiles = available.some(action => action.id === 'open-file');
  const searchLabel = hasFiles ? yardResolveUrl ? '搜索文件或输入网址' : '搜索文件' : '输入网址';
  return <div data-new-tab-scroll-root className="yard-new-tab flex h-full min-h-0 flex-col overflow-x-hidden overflow-y-auto bg-surface-canvas select-none">
    <style>{css}</style>
    <div className="yard-new-tab-content">
      {(yardResolveUrl || onSearchFiles) && <form className="yard-new-tab-search text-secondary" role="search" onSubmit={event => {
        event.preventDefault();
        const value = query.trim();
        if (!value) return;
        setError('');
        const url = yardResolveUrl?.(value);
        if (url) {
          if (yardOpenUrl?.(url) == null) setError('暂时无法打开网页，请稍后重试。');
        }
        else if (hasFiles) {
          if (onSearchFiles) onSearchFiles(value);
          else window.postMessage({ type: 'file-search-command-menu', query: value }, location.origin);
        }
      }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="7" /><path d="m16 16 4.5 4.5" /></svg>
        <input type="search" aria-label={searchLabel} placeholder={searchLabel} value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" spellCheck={false} />
      </form>}
      {error ? <p role="alert" className="text-secondary">{error}</p> : null}
      <section className="yard-new-tab-tools" aria-label="新建">
        <div className="yard-new-tab-heading text-secondary">
          <h3>新建</h3>
          {more.length > 0 || cards.some(action => action.id === 'terminal') ? <Dropdown align="end" triggerButton={<button type="button" className="yard-new-tab-more" aria-label="更多工具" title="更多工具">···</button>} onCloseAutoFocus={event => {
            const action = pendingAction.current;
            if (action) { pendingAction.current = null; event.preventDefault(); onActionSelect(action); }
          }}>
            {more.map(action => <Item key={action.id} onSelect={() => {
              if (action.deferSelectionUntilDropdownClose) pendingAction.current = action;
              else onActionSelect(action);
            }}>{action.title}</Item>)}
            {cards.some(action => action.id === 'terminal') ? <Item onSelect={onToggleBottomPanel}>在底部面板打开终端</Item> : null}
          </Dropdown> : null}
        </div>
        <div className="yard-new-tab-cards">
          {cards.map(action => <button key={action.id} type="button" className="yard-new-tab-card text-default" onClick={() => onActionSelect(action)} title={action.title}>
            {action.icon}<span>{action.title}</span>
          </button>)}
        </div>
      </section>
      {children}
      {recentContent}
    </div>
  </div>;
}

export function createNewTab(React: typeof ReactRuntime) {
  return function NewTab(props: NewTabViewProps) {
    return <NewTabView {...props} runtime={React} />;
  };
}

export function installNewTab(React: typeof ReactRuntime): void {
  const NewTab = createNewTab(React);
  const surface = window as Window & {
    workbenchNewTab?: (props: NewTabProps, recentContent: ReactRuntime.ReactNode, menu: NewTabMenu) => ReactRuntime.ReactNode;
    workbenchNewTabIcon?: () => ReactRuntime.ReactNode;
  };
  surface.workbenchNewTab = (props, recentContent, menu) => <NewTab {...props} recentContent={recentContent} menu={menu} />;
  surface.workbenchNewTabIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></svg>;
}
