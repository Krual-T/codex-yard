export interface IabPanelRequest {
  sessionId: string;
  operation: 'state' | 'new' | 'select' | 'navigate' | 'reload' | 'close' | 'click' | 'text' | 'key';
  tabId?: number; url?: string; x?: number; y?: number; text?: string; key?: string;
}
export interface IabPanelState {
  tabs: { id: number; title: string; url: string; active: boolean }[];
  selectedTabId?: number;
  frame?: { image: string; width: number; height: number };
}
