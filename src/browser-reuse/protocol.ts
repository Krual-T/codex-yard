/** Web adapter boundary for the unmodified 26.1013.40934 browser panel. */
export interface BrowserTarget { conversationId: string; browserTabId: string }
export interface ChromePage { id: number; url: string; selected: boolean }
export interface ChromeFrame {
  pageId: number; image: string; width: number; height: number;
  url: string; title: string; capturedAt: string;
  canGoBack: boolean; canGoForward: boolean;
}
export interface ChromePanelState {
  location: string; configured: boolean; pages: ChromePage[];
  pageId?: number; frame?: ChromeFrame; error?: string;
  elementContext?: ChromeElementContext;
}
/** Input to the shipped renderer's browser-comment converter (Amt). */
export interface ChromeElementContext {
  kind: 'element'; pageUrl: string; frameUrl?: string; framePath: string[];
  title: string; immediateText: string; role: string; name: string;
  selector: string; elementPath: string; nearbyText: string;
  rect: { x: number; y: number; width: number; height: number };
  elementMetadata: Record<string, string>;
}
export interface ChromeElementComment {
  id: string; body: string; anchor: ChromeElementContext;
}
export type ChromeRequest = BrowserTarget & {
  connection?: 'client' | 'server'; clientKey?: string;
  operation: 'state' | 'select' | 'capture' | 'element-context' | 'click' | 'text' | 'key' | 'command' | 'release';
  pageId?: number; x?: number; y?: number; text?: string; key?: string;
  command?: { type: string; url?: string };
};
export type ChromeTransport = (request: ChromeRequest) => Promise<ChromePanelState>;
export const targetKey = (target: BrowserTarget) => `${target.conversationId}\0${target.browserTabId}`;

export function chromeSnapshot(page: { url: string; title: string; canGoBack?: boolean; canGoForward?: boolean }) {
  return {
    url: page.url, committedUrl: page.url, title: page.title, tabType: 'web',
    isLoading: false, isWaitingForResponse: false, isSuspended: false,
    canGoBack: page.canGoBack ?? false, canGoForward: page.canGoForward ?? false,
    isAudible: false, isAudioMuted: false, isCapturingUserMedia: false, isCapturingCamera: false, isCapturingMicrophone: false,
    zoomPercent: 100, interactionMode: 'browse', comments: [], faviconUrl: null,
    securityState: null, commentModeDisabledReason: 'Web Chrome preview',
  };
}
