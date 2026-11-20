export const appUri = 'ui://fixture/sample-view';
export const appHtml = `<!doctype html><html><head><style>
  :root { color-scheme: light dark; } body { margin: 0; padding: 16px; font: 14px system-ui; }
  h2 { font-size: 16px; margin: 0 0 10px; } button { font: inherit; }
</style></head><body><h2>Sample viewer</h2><p id="sample">Waiting for tool result</p>
  <button id="read" type="button">Read sample details</button><p id="detail"></p>
  <button id="other" type="button">Request model-only tool</button><p id="restricted"></p>
  <script>
  const send = value => parent.postMessage({jsonrpc:'2.0', ...value}, '*');
  addEventListener('message', ({source,data}) => {
    if (source !== parent || data?.jsonrpc !== '2.0') return;
    if (data.id === 1 && data.result) {
      document.body.dataset.displayMode = data.result.hostContext.displayMode;
      send({method:'ui/notifications/initialized'});
      send({method:'ui/notifications/size-changed',params:{height:140}});
    }
    if (data.method === 'ui/notifications/tool-result') {
      document.querySelector('#sample').textContent = data.params.structuredContent?.sample ?? 'No sample';
    }
    if (data.method === 'ui/notifications/tool-input') {
      document.querySelector('#sample').dataset.input = data.params.arguments?.sample;
    }
    if (data.method === 'ui/notifications/host-context-changed') {
      document.body.dataset.displayMode = data.params.displayMode;
    }
    if (data.id === 2) {
      document.querySelector('#detail').textContent = data.result?.structuredContent?.detail ?? data.error?.message;
    }
    if (data.id === 3) document.querySelector('#restricted').textContent = data.error?.message ?? 'Unexpected tool access';
  });
  document.querySelector('#read').onclick = () => send({
    id:2,method:'tools/call',params:{name:'read_sample_details',arguments:{sample:'Sample A'}}
  });
  document.querySelector('#other').onclick = () => send({
    id:3,method:'tools/call',params:{name:'model_only',arguments:{}}
  });
  send({id:1,method:'ui/initialize',params:{
    protocolVersion:'2026-01-26',appInfo:{name:'Sample viewer',version:'1.0.0'},
    appCapabilities:{availableDisplayModes:['inline','fullscreen']}
  }});
  </script></body></html>`;

const schema = { type: 'object', properties: { sample: { type: 'string' } }, required: ['sample'], additionalProperties: false };
const readOnly = { readOnlyHint: true };
export const appTools = [
  { name: 'inspect_sample', description: 'Show a sample', inputSchema: schema, annotations: readOnly,
    _meta: { ui: { resourceUri: appUri, preferredModelDisplayMode: 'inline' } } },
  { name: 'read_sample_details', description: 'Read fixture details', inputSchema: schema, annotations: readOnly,
    _meta: { ui: { visibility: ['app'] } } },
  { name: 'model_only', description: 'Tool for the model', inputSchema: schema, annotations: readOnly,
    _meta: { ui: { visibility: ['model'] } } },
];
export const appResource = { uri: appUri, mimeType: 'text/html;profile=mcp-app', text: appHtml,
  _meta: { ui: { prefersBorder: true }, 'openai/widgetHeightHint': 140 } };
export const appResult = { content: [{ type: 'text', text: 'Sample tool result' }], structuredContent: { sample: 'Sample A' } };
export const appDetails = { content: [{ type: 'text', text: 'Sample details loaded' }], structuredContent: { detail: 'Sample details loaded' } };
