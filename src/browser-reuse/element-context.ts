import { resultText } from './chrome-mcp.ts';
import type { BrowserTools } from './chrome-mcp.ts';
import type { ChromeElementContext, ChromePage } from './protocol.ts';

/** Runs through official evaluate_script with the UID selected by DevTools.
 * Read only this element's bounded description; never collect form values,
 * cookies, full HTML, or the rest of the page snapshot as conversation context. */
function describeElement(element: Element) {
  if (!element.isConnected) throw new Error('所选元素已离开页面，请重新选择');
  const view = element.ownerDocument.defaultView!;
  const text = (value: string | null | undefined, limit = 2000) => (value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
  const tag = element.localName;
  const immediateText = text(Array.from(element.childNodes).filter(node => node.nodeType === 3).map(node => node.textContent).join(' '));
  const name = text(element.getAttribute('aria-label') || element.getAttribute('alt') || element.getAttribute('title') || immediateText || tag, 240);
  const parts: string[] = [];
  let current: Element | null = element;
  for (let depth = 0; current && depth < 8; depth++, current = current.parentElement) {
    if (current.id) { parts.unshift('#' + CSS.escape(current.id)); break; }
    const siblings = current.parentElement ? Array.from(current.parentElement.children).filter(sibling => sibling.localName === current!.localName) : [];
    parts.unshift(current.localName + (siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : ''));
  }
  const rect = element.getBoundingClientRect(), computed = view.getComputedStyle(element);
  const styles = Object.fromEntries(['display', 'position', 'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'padding', 'margin', 'border-radius']
    .map(property => [property, text(computed.getPropertyValue(property), 240)]));
  const styleGroup = (properties: string[]) => text(properties.map(property => property + ': ' + styles[property]).join('; '), 240);
  const selector = parts.join(' > ');
  return { kind: 'element', frameUrl: view === view.top ? undefined : view.location.href, framePath: [], title: name, name,
    role: text(element.getAttribute('role') || tag, 80), immediateText, selector,
    elementPath: selector, nearbyText: text(element.textContent),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    // The shipped metadata schema permits at most six flat primitive entries.
    elementMetadata: { tag, layout: styleGroup(['display', 'position', 'padding', 'margin']),
      colors: styleGroup(['color', 'background-color']), font: styleGroup(['font-family', 'font-size', 'font-weight']),
      shape: styleGroup(['border-radius']) } };
}

export async function readSelectedElement(tools: BrowserTools, page: ChromePage): Promise<ChromeElementContext> {
  const snapshot = resultText(await tools.callTool('take_snapshot', { pageId: page.id, verbose: true }));
  // This marker is part of pinned MCP 1.12.0's SnapshotFormatter contract.
  // Its structured snapshot omits the DevTools selection marker.
  const selected = [...snapshot.matchAll(/^\s*uid=(\d+_\d+)[^\n]* \[selected in the DevTools Elements panel\]$/gm)];
  if (selected.length !== 1) throw new Error('请先在这个 Chrome 标签按 Ctrl+Shift+C（Mac：⌘+Shift+C）选择元素，并保持开发者工具打开');
  const result = resultText(await tools.callTool('evaluate_script', { pageId: page.id, function: describeElement.toString(), args: [selected[0]![1]], waitForStableDom: false }));
  const json = result.match(/```json\s*\n([\s\S]*?)\n```/)?.[1];
  if (!json) throw new Error('官方 MCP 未返回所选元素，请重新选择');
  const context = JSON.parse(json) as Omit<ChromeElementContext, 'pageUrl'>;
  if (context?.kind !== 'element' || (context.frameUrl != null && typeof context.frameUrl !== 'string') || typeof context.title !== 'string' || json.length > 20000) throw new Error('所选元素上下文无效，请重新选择');
  return { ...context, pageUrl: page.url };
}
