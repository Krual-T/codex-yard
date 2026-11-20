export const mcpAppSandboxPath = '/api/workspace/mcp-app-sandbox';

export const mcpAppSandboxPolicy = [
  "sandbox allow-scripts", "default-src 'none'", "script-src 'unsafe-inline'", "style-src 'unsafe-inline'",
  'img-src data: blob:', 'font-src data:', 'media-src data: blob:', "base-uri 'none'", "form-action 'none'", "frame-ancestors 'self'",
].join('; ');

// The response CSP remains in force after writing the app document. Accept a
// single document from the same URL origin's parent; this frame has no host RPC.
export const mcpAppSandboxHtml = `<!doctype html><meta charset="utf-8"><title>MCP App</title><script>
(() => {
  if (window === parent) return;
  const parentOrigin = location.origin;
  function load(event) {
    const { type, key, html } = event.data ?? {};
    if (event.source !== parent || event.origin !== parentOrigin || type !== 'yard-mcp-app-document' ||
      typeof key !== 'string' || !/^[a-f0-9-]{36}$/.test(key) || typeof html !== 'string') return;
    removeEventListener('message', load);
    document.open();
    document.write('<!doctype html><meta charset="utf-8"><script>(()=>{' +
      'const key=' + JSON.stringify(key) + ',origin=' + JSON.stringify(parentOrigin) + ';' +
      'parent.postMessage({type:"yard-mcp-app-bind",key},origin);' +
      'addEventListener("pagehide",()=>parent.postMessage({type:"yard-mcp-app-close",key},origin),{once:true});' +
      '})()<\\/script>' + html);
    document.close();
  }
  addEventListener('message', load);
  parent.postMessage({ type: 'yard-mcp-app-awaiting-document' }, parentOrigin);
})();
</script>`;
