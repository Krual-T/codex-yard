import { createElement, Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../renderer/app/App.tsx';
import { BrowserWorkbenchClient } from '../renderer/app/client.ts';

class PageBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Codex Yard page failed', error.message, info.componentStack); }
  render() {
    if (this.state.error) return createElement('main', { className: 'yard-dialog', role: 'alert' },
      createElement('h1', null, 'Unable to display Codex Yard'), createElement('p', null, this.state.error.message),
      createElement('button', { onClick: () => location.reload() }, 'Reload'));
    return this.props.children;
  }
}
performance.mark('workbench-entry');
const container = document.getElementById('root');
if (!container) throw new Error('Root container not found');
const client = new BrowserWorkbenchClient();
createRoot(container).render(createElement(PageBoundary, null, createElement(App, { client })));
window.addEventListener('pagehide', event => { if (event.persisted) client.suspend(); else client.close(); });
window.addEventListener('pageshow', event => {
  if (event.persisted) void client.resume().catch(error => console.error('Unable to resume Yard connection', error));
});
performance.mark('workbench-render-requested');
