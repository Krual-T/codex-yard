/** The fixed loader's dynamic-import hints include chunks the selected route
 * never imports. Let native ESM fetch JavaScript dependencies as they are used;
 * retain CSS hints, since the JavaScript module graph does not load styles. */
export function adaptStartupModule(path: string, content: Buffer): Buffer {
  if (path === '/assets/app-primary-f5ea123a0407.js') {
    return Buffer.from(replaceStartup(content.toString('utf8'), [
      ['ge=x?()=>{let e=JV();return e==null?null:{element:e,locationKey:_}}:void 0',
        'ge=x||document.getElementById(`pending-yard-home-input`)!=null?()=>{let e=document.querySelector(`#yard-startup textarea#pending-yard-home-input[data-yard-active=true]`);if(e!=null&&p===`/`&&m===``&&h===``&&ae===`work`&&n==null&&r==null&&ee==null&&(g==null||Object.keys(g).every(XVt))&&i.value.kind===`new`&&i.value.entrypoint===`home`&&i.value.homeDraftKey==null&&!yardHasComposerDraft(i))return{element:e,locationKey:_,yardDraftScope:i};e=x?JV():null;return e==null?null:{element:e,locationKey:_}}:void 0'],
    ]) + '\nimport { Den as yardHasComposerDraft } from "./app-initial-a68277f60b93.js";');
  }
  if (path === '/assets/app-initial-a68277f60b93.js') {
    // Host services still initialize first. The existing route Suspense handles
    // its module promise, allowing root providers/configuration to start now.
    const before = 'await oRu(),SPi(),uRu(),!gRu&&!_Ru&&e!=null&&await e,dRu()';
    const after = 'await oRu(),performance.mark("workbench-host-services-initialized"),!gRu&&!_Ru&&window.workbenchPersistedStateStartup?.prepare(iEu(),vJt),SPi(),uRu(),dRu()';
    return Buffer.from(replaceStartup(content.toString('utf8'), [
      [before, after],
      ['[a,o]=(0,pEu.useState)(hEu)', '[a,o]=(0,pEu.useState)(()=>hEu||window.workbenchPersistedStateStartup?.isHydrated(r)===true)'],
      ['[s,c]=(0,pEu.useState)(`pending`)', '[s,c]=(0,pEu.useState)(()=>window.workbenchPersistedStateStartup?.isHydrated(r)===true&&pTt()===`host`?(Ky()?`enabled`:`disabled`):`pending`)'],
      ['l=()=>iEu(r)', 'l=()=>window.workbenchPersistedStateStartup?.get(r)??iEu(r)'],
      // The startup overlay can remain on top after the editor DOM connects.
      // Keep the original controller in sync until the overlay hands it over.
      ['t=e?.element,n=t?.ownerDocument.defaultView,a=O.current',
        't=e?.element,n=t?.ownerDocument.defaultView,yardSource=t?.id===`pending-yard-home-input`,yardDraftScope=e?.yardDraftScope;let yardAccepted=!1;let a=O.current'],
      ['!a.controller.view.isDestroyed?a.controller:void 0,s=n=>{let r=o;',
        '!a.controller.view.isDestroyed?a.controller:void 0;if(yardSource){yardAccepted=o!=null&&t.dataset.yardAdopted===`true`;if(o==null)delete t.dataset.yardAdopted}let s=n=>{let r=o;'],
      ['if(t==null||r==null)return;let i=t.dataset.edited===`true`',
        'if(t==null||r==null||yardSource&&(!yardAccepted||t.dataset.yardActive!==`true`))return;let i=t.dataset.edited===`true`'],
      ['let e=t?.dataset.edited===`true`,n=M(w.plainTextMode)??w;o=xUu',
        'let n=M(w.plainTextMode)??w;yardAccepted=yardSource&&t.dataset.yardActive===`true`&&pTt()===`host`&&Ky()&&!oja(yardDraftScope)&&n.defaultText===``&&n.initialDocument==null;let e=t?.dataset.edited===`true`&&(!yardSource||yardAccepted);o=xUu'],
      ['s(!1),P(o.view.state.doc,w.plainTextMode),D(o)},l=()=>{(0,HSd.flushSync)(()=>{c(),A(!1)})}',
        's(!1),P(o.view.state.doc,w.plainTextMode),D(o),yardAccepted&&(t.dataset.yardAdopted=`true`)},l=()=>{(0,HSd.flushSync)(()=>{c(),yardAccepted&&s(!0),A(!1)})}'],
      ['d=e=>{e.target===t&&!o?.view.dom.isConnected&&s(!0)}',
        'd=e=>{e.target===t&&(yardSource?e.type===`yard-draft-input`&&t.dataset.composition==null:!o?.view.dom.isConnected)&&s(!0)}'],
      ['f=()=>{o?.view.dom.isConnected||s(!1)}',
        'f=()=>{(yardSource?t.dataset.composition==null:!o?.view.dom.isConnected)&&s(!1)}'],
      ['return t?.addEventListener(`pending-input-ready`,l),n?.addEventListener(`compositionstart`,u,!0)',
        'return t?.addEventListener(`pending-input-ready`,l),yardSource&&t.addEventListener(`yard-draft-input`,d),n?.addEventListener(`compositionstart`,u,!0)'],
      ['t?.removeEventListener(`pending-input-ready`,l),n?.removeEventListener(`compositionstart`,u,!0)',
        't?.removeEventListener(`pending-input-ready`,l),yardSource&&t.removeEventListener(`yard-draft-input`,d),n?.removeEventListener(`compositionstart`,u,!0)'],
    ]));
  }
  if (path !== '/assets/app-shared-61271c39e3c5.js') return content;
  const before = 'if(t=ote(t,n),t=s(t),t in th)return;th[t]=!0;let r=t.endsWith(`.css`)';
  const after = 'if(t=ote(t,n),t=s(t),t in th||!t.endsWith(`.css`))return;th[t]=!0;let r=t.endsWith(`.css`)';
  const source = content.toString('utf8');
  if (source.split(before).length !== 2) throw new Error('启动适配与固定界面版本不匹配');
  return Buffer.from(source.replace(before, after));
}

function replaceStartup(source: string, edits: [string, string][]): string {
  for (const [from, to] of edits) {
    if (source.split(from).length !== 2) throw new Error('启动适配与固定界面版本不匹配');
    source = source.replace(from, to);
  }
  return source;
}
