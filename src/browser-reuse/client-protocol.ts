import type { ChromePanelState, ChromeRequest } from './protocol.ts';

export interface ChromeConnections {
  client: { connected: boolean; label?: string };
  server: { configured: boolean; label: string };
  pairing?: { token: string; expiresAt: number };
}
export interface ConnectionRequest { clientKey: string; operation: 'state' | 'pair' | 'disconnect' }
export type ClientChromeMessage =
  | { type: 'request'; id: string; session: string; request: ChromeRequest }
  | { type: 'release'; session: string };
export type ClientChromeReply = { type: 'result'; id: string; state?: ChromePanelState; error?: string };

export const clientChromePath = '/chrome-client';
export const clientChromePackagePath = '/chrome-client.tgz';

export function checkClientKey(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{32,80}$/.test(value)) throw new Error('浏览器连接身份无效，请刷新工作台');
}
