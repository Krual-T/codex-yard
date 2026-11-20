import { Check, ChevronDown } from 'lucide-react';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import type { PortForwardingWindow } from '../native/port-forwarding-view.tsx';
import { ToolMenu, ToolMenuItem } from './new-tab-tools.tsx';
import { settingsUrl } from './sidebar-profile.tsx';

declare const __yardPortForwardingUrl: string;
type Runtime = typeof import('../native/port-forwarding-view.tsx');
let loading: Promise<Runtime> | undefined;
let installed = false;
let routeAfterSettings: string | undefined;

export function SidebarProduct({ returnRoute }: { returnRoute?: string }) {
  const id = React.useId();
  const [error, setError] = React.useState<string>();

  async function openForwarding() {
    setError(undefined);
    try {
      const { installPortForwarding } = await (loading ??= import(__yardPortForwardingUrl) as Promise<Runtime>);
      const trigger = document.getElementById(id);
      if (!trigger?.getBoundingClientRect().width) return;
      trigger.focus({ preventScroll: true });
      routeAfterSettings = returnRoute;
      if (!installed) {
        installPortForwarding(React, { createRoot }, () => location.assign(settingsUrl('connections/ssh', routeAfterSettings)));
        installed = true;
      }
      (window as unknown as PortForwardingWindow).workbenchOpenPortForwarding?.();
    } catch (error) {
      loading = undefined;
      setError(error instanceof Error ? error.message : String(error));
    }
  }

  return <>
    <ToolMenu align="start" label="Switch mode" className="yard-source-product-menu" triggerButton={
      <button type="button" id={id} className="yard-source-product-trigger" aria-label="Switch mode, current mode: Codex">
        <img alt="" width="22" height="22" src="/brand/icon.svg" />
        <span className="yard-source-brand-wide">Codex Yard</span><span className="yard-source-brand-compact">Yard</span>
        <ChevronDown size={12} className="text-tertiary" aria-hidden="true" />
      </button>
    }>
      <ToolMenuItem onSelect={() => void openForwarding()}><span>端口转发管理</span><small>连接远程服务到你的设备</small></ToolMenuItem>
      <ToolMenuItem onSelect={() => {}}><span className="font-openai-sans">Codex</span><small>Build, debug, and ship</small><Check size={14} aria-label="Current mode" /></ToolMenuItem>
    </ToolMenu>
    {error && <p role="alert" className="yard-source-product-error">{error}</p>}
  </>;
}
