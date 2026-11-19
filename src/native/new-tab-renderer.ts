/** Adapt the pinned tab lifecycle to the New tab surface in App 26.1111.21308.
 * The original action registry, file search, drag/drop and recent files stay in
 * the renderer. The installed desktop App is only a development reference. */
export function adaptNewTabModule(path: string, content: Buffer): Buffer {
  const edits: [string, string][] = [];
  if (path === '/assets/app-initial-a68277f60b93.js') {
    edits.push([
      '?()=>[...N7r.keys()].some(t=>t({conversationId:e,href:$c(r),initiator:a,hostId:i,title:f?.textContent?.trim()})):void 0,',
      '?()=>e!=null&&tme(r)&&window.workbenchOpenConversationLink?.({type:`open-in-browser`,conversationId:e,url:$c(r),hostId:i,initiator:a})||[...N7r.keys()].some(t=>t({conversationId:e,href:$c(r),initiator:a,hostId:i,title:f?.textContent?.trim()})):void 0,',
    ], [
      // The pinned renderer can handle a link entirely in its own message bus.
      // Route its ordinary website fallback through Yard before the native opener.
      '||Kc.dispatchMessage(`open-in-browser`,{...e==null?{}:{clickModifiers:e}',
      '||t!=null&&c!==`external-browser`&&m!==!0&&n==null&&p==null&&window.workbenchOpenConversationLink?.({type:`open-in-browser`,conversationId:t,url:$c(i),hostId:a,initiator:o,source:f,openTarget:c,clickModifiers:e,presentationIntent:d})||Kc.dispatchMessage(`open-in-browser`,{...e==null?{}:{clickModifiers:e}',
    ], [
      'if(!o&&!s){let e=n??l,r;return t[3]===e?r=t[4]:(r=(0,GCl.jsx)(PCl,{showWhenEmpty:!0,target:`right`,title:e}),t[3]=e,t[4]=r),r}',
      '',
    ], [
      'd=()=>{o?Cj(`openBrowserTab`,`side_panel_menu`):V1o(r,{initiator:`side_panel_menu`})}',
      'd=()=>{H1o(r,{tabId:`workspace-new-tab:${crypto.randomUUID()}`,revealAndFocus:!0,target:`right`})}',
    ], [
      'isAvailable:e=>e.get(Nb)&&e.get(Eb),open:V1o',
      'isAvailable:e=>e.get(Nb),open:V1o',
    ], [
      'getIcon:()=>(0,U1o.jsx)(_De,{}),getTitle:e=>e.get(fh)',
      'getIcon:()=>window.workbenchNewTabIcon?.()??(0,U1o.jsx)(_De,{}),getTitle:e=>e.get(fh)',
    ]);
  } else if (path === '/assets/open-handler-96382bc3d49a.js') {
    // Yard's iframe renderer is available even when the backend's separate
    // browser-agent capability is disabled. Only Yard-created link actions opt in.
    edits.push([
      'l=n.get(ut,{name:`browser.in-app`});',
      'l=e.yardEmbedded===!0?{isCapable:!0,isLoading:!1,isError:!1}:n.get(ut,{name:`browser.in-app`});',
    ], [
      'p===`split`&&!n.get(Tt)',
      'p===`split`&&e.yardEmbedded!==!0&&!n.get(Tt)',
    ]);
  } else if (path === '/assets/thread-app-shell-chrome-f65cc9d3a9eb.js') {
    edits.push([
      '(0,$.jsx)(dt,{target:`right`,title:d})',
      '(0,$.jsx)(At,{menuTitle:d})',
    ], [
      'function _s(e){',
      'function YardResolveBrowserNewTabUrl(value){return Le(value)?null:r(value)}function _s(e){',
    ], [
      'onActionSelect:u,onChatSelect:f,children:p}',
      'onActionSelect:u,onChatSelect:f,children:p,yardResolveUrl:YardResolveBrowserNewTabUrl,yardOpenUrl:i}',
    ], [
      'Zi(),ao(),io(),gs(),ys=G()',
      'Zi(),ao(),io(),gs(),qe(),ys=G()',
    ], [
      'zwn as Za}',
      'zwn as Za,tCt as YardOpenBrowser}',
    ], [
      'function Zc(e){',
      'function Zc(e){let yardStore=ee(q);',
    ], [
      'K.RightPanelTabsEmptyState,{children:(0,$.jsx)(so,{})}',
      'K.RightPanelTabsEmptyState,{children:(0,$.jsx)(so,{surface:`new-tab`,yardResolveUrl:YardResolveBrowserNewTabUrl,yardOpenUrl:url=>YardOpenBrowser(yardStore,{initialUrl:url,target:`right`,initiator:`side_panel_menu`,source:`manual`})})}',
    ], [
      'Kc(),Zi(),Ei(),ao(),qr(),$=G()',
      'Kc(),Zi(),Ei(),ao(),qr(),qe(),$=G()',
    ]);
  } else if (path === '/assets/tab-content-7090d8d5ae50.js') {
    // G is the renderer's hasBrowserPage state and already participates in
    // this element's React cache. Empty tabs use the central file/URL search.
    edits.push([
      'annotationToolbar:fl,toolbar:Ju,viewportRef:Oe',
      'annotationToolbar:fl,toolbar:G?Ju:null,viewportRef:Oe',
    ], [
      'headerRows:[{id:`browser-navigation`,height:j?`content`:void 0,content:j?(0,el.jsx)(Gi,{inert:g||p,children:te}):te},',
      'headerRows:[...te==null?[]:[{id:`browser-navigation`,height:j?`content`:void 0,content:j?(0,el.jsx)(Gi,{inert:g||p,children:te}):te}],',
    ]);
  } else if (path === '/assets/native-page-ccd33c3eab0c.js') {
    edits.push([
      'vMt as a}',
      'vMt as a,$D as YardBrowserUrl,nO as YardIsWebSearch,tO as YardInitBrowserUrl}',
    ], [
      'v=a()})))()',
      'YardInitBrowserUrl(),v=a()})))()',
    ], [
      'qCr as u,vwr as d}',
      'qCr as u,vwr as d,tCt as YardOpenBrowser}',
    ], [
      'target:a,onActionSelect:p,onChatSelect:g}',
      'target:a,onActionSelect:p,onChatSelect:g,yardResolveUrl:value=>YardIsWebSearch(value)?null:YardBrowserUrl(value),yardOpenUrl:url=>YardOpenBrowser(o,{initialUrl:url,replaceTabId:i,target:a,initiator:`side_panel_menu`,source:`manual`})}',
    ]);
  } else if (path === '/assets/thread-side-panel-new-tab-17ea66857c53.js') {
    edits.push([
      'function Vt(e){',
      'function YardNewTabMenu(){return{Dropdown:o,Item:O.Item}}function Vt(e){if(window.workbenchNewTab&&e.yardResolveUrl)return window.workbenchNewTab(e,e.outputArtifacts?.length?(0,Z.jsx)(wt,{artifacts:e.outputArtifacts,onOpen:e.onOpenArtifact,replaceTabId:e.replaceTabId}):null,YardNewTabMenu());',
    ], [
      'onOpenArtifact:y,outputArtifacts:b,replaceTabId:c,children:r}',
      'onOpenArtifact:y,outputArtifacts:b,replaceTabId:c,children:r,yardResolveUrl:n.yardResolveUrl,yardOpenUrl:n.yardOpenUrl}',
    ]);
  } else if (path === '/assets/app-primary-f5ea123a0407.js') {
    edits.push([
      'p=()=>{u&&(bu.dispatchHostMessage({type:`command-menu`,query:window.getSelection()?.toString().trim()??``})',
      'p=e=>{u&&(bu.dispatchHostMessage({type:`command-menu`,query:e?.query??window.getSelection()?.toString().trim()??``})',
    ]);
  } else return content;
  let source = content.toString('utf8');
  for (const [before, after] of edits) {
    if (source.split(before).length !== 2) throw new Error('新标签页与固定界面版本不匹配：' + path);
    source = source.replace(before, after);
  }
  return Buffer.from(source);
}
