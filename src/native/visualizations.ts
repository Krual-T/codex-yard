import type { ObjectValue } from './protocol.ts';

// A distinct URL namespace prevents immutable Electron assets cached by an
// existing browser from being mixed with the Web transport adapters.
// v2 also routes the first authored React leaves. Changing the namespace keeps
// old immutable upstream modules from bypassing the new component seams.
export const webRendererPrefix = '/web-renderer-v2';
const resourceOrigins = ['https://persistent.oaistatic.com/plugins/visualize/charts/', 'https://cdnjs.cloudflare.com',
  'https://cdn.jsdelivr.net', 'https://esm.sh', 'https://fonts.bunny.net', 'https://fonts.googleapis.com',
  'https://fonts.gstatic.com', 'https://unpkg.com'].join(' ');

/** Adapt only the transport boundary of the pinned renderer. Its React views,
 * HTML wrapper, MessagePort RPC, widget state and interactions remain official. */
export function adaptVisualizationModule(path: string, content: Buffer): Buffer {
  const replacements: [string, string][] = path === '/assets/app-shared-61271c39e3c5.js' ? [
    ['Ltt=`codex-sandbox`', 'Ltt=`https`'],
    ['i.hostname=`${r}.${i.hostname}`', 'r.startsWith(`codex-inline-visualization-`)?i=new URL(window.location.origin):i.hostname=`${r}.${i.hostname}`'],
    ['let n=Ptt(e);return n==null||t&&', 'let n=Ptt(e);if(n==null){try{let r=new URL(e);if(r.origin===window.location.origin&&r.pathname===`/`&&r.searchParams.get(`app`)===`skybridge`)return r.origin}catch{}}return n==null||t&&'],
  ] : path === '/assets/visualization-sandbox-broker-16f3006b41b1.js' ? [
    ['element=document.createElement(`webview`)', 'element=document.createElement(`iframe`)'],
    ['this.element.setAttribute(`partition`,', 'this.element.setAttribute(`sandbox`,`allow-scripts`),this.element.setAttribute(`referrerpolicy`,`no-referrer`),this.element.setAttribute(`partition`,'],
  ] : path === '/assets/mcp-sandbox-element-c971411a0283.js' ? [
    // Keep visualization navigation opaque as well as the initial document.
    ['i.setAttribute(`sandbox`,`allow-scripts allow-same-origin`)', 'i.setAttribute(`sandbox`,n.startsWith(`visualization-`)?`allow-scripts`:`allow-scripts allow-same-origin`)'],
  ] : path === '/assets/mcp-sandbox-rpc-2746253abd6f.js' ? [
    // The local bootstrap has CSP sandbox allow-scripts, hence an opaque origin.
    // Preserve the official source-window, source-URL and init-ID checks.
    ['i.origin!==n||t(e,{requireSkybridge:!0})!==n', 'i.origin!==(n===window.location.origin?`null`:n)||t(e,{requireSkybridge:!0})!==n'],
  ] : [];
  if (!replacements.length) return content;
  let source = content.toString('utf8');
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2) throw new Error('可视化适配与固定界面版本不匹配：' + path);
    source = source.replace(before, after);
  }
  return Buffer.from(source);
}

export function visualizationService(Base: new () => object, request: (endpoint: string, body: unknown) => Promise<unknown>) {
  return new class extends Base {
    read(value: ObjectValue) { return request('visualization-read', value); }
    getTemporaryRoots() { return []; }
  }();
}

// Execute the official HTML kit and fragment in one opaque-origin frame. Its
// MessagePorts expose only the renderer's visualization handlers. The policy is
// an HTTP header, so authored markup cannot remove it via document.write.
export const visualizationSandboxPolicy = [
  "sandbox allow-scripts",
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' blob: " + resourceOrigins,
  "style-src 'unsafe-inline' " + resourceOrigins,
  'img-src data: blob: ' + resourceOrigins,
  'font-src data: ' + resourceOrigins,
  'connect-src data: blob:',
  "frame-src 'none'",
  'worker-src blob:',
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join('; ');
