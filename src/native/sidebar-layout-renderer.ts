/** Keep the pinned sidebar's mounted tree across ordinary collapse/expand.
 * Its native motion values commit layout once; Yard animates the surfaces.
 * A collapsed tree is inert; hovering the original peek trigger releases it to the floating panel,
 * so the two containers never render the same sidebar at once. */
export function adaptSidebarLayout(path: string, content: Buffer): Buffer {
  if (path === '/assets/use-thread-summary-panel-49a5fc2c7142.js') {
    const source = content.toString('utf8');
    const before = 'function Ce(e,t,n){return n?';
    if (source.split(before).length !== 2) throw new Error('侧栏布局适配与固定界面版本不匹配：' + path);
    // The sidebar owns this layout change. Commit the Summary/Outputs offset
    // before measuring FLIP instead of starting a second, independent spring.
    return Buffer.from(source.replace(before,
      'function Ce(e,t,n){return n||globalThis.workbenchAnimateSidebar?.synchronizing?.()?'));
  }
  if (path !== '/assets/app-initial-a68277f60b93.js') return content;
  let source = content.toString('utf8');
  const edits = [
    ['function aur(e,t,n){t||Cc()',
      'function aur(e,t,n){if(n.animate!==!1&&n.transition==null&&globalThis.workbenchAnimateSidebar?.(t,()=>{(0,bs().flushSync)(()=>aur(e,t,{...n,animate:!1}))},e.get(E),e=>Nxe.postRender(e)))return;t||Cc()'],
    // The native resize observer reports the removed/added main border later.
    // Publish that inset during the layout commit, before derived Summary
    // widths choose their mode and before FLIP measures the final position.
    ['En=E&&(D!==`content-surface`||S?.hasPageSidebar)&&KJ.MainContentLeftBorder,Dn;',
      'En=E&&(D!==`content-surface`||S?.hasPageSidebar)&&KJ.MainContentLeftBorder,Dn;(0,jX.useLayoutEffect)(()=>{if(B&&globalThis.workbenchAnimateSidebar?.synchronizing?.()){let e=getComputedStyle(B);A.set([e.borderLeftWidth,e.borderRightWidth,e.paddingLeft,e.paddingRight].reduce((e,t)=>e+(parseFloat(t)||0),0))}},[A,B,En]);'],
    ['function vVa(e){let t=(0,wVa.c)(198)', 'function vVa(e){let t=(0,wVa.c)(199)'],
    ['Pt=R&&(ye||Be||T)&&(0,JJ.jsx)(tVa,', 'Pt=R&&(ye||Be||T||!ge)&&(0,JJ.jsx)(tVa,'],
    // The retained panel now also depends on the floating-peek state. Include
    // that input in the original compiler cache so a peek releases its tree.
    ['t[172]!==je?(Pt=', 't[172]!==je||t[198]!==ge?(Pt='],
    ['t[172]=je,t[173]=Pt', 't[172]=je,t[198]=ge,t[173]=Pt'],
    // Native history controls disappear on collapse. Reserve their space so
    // the adjacent sidebar trigger stays under the pointer on rapid reversals.
    ['if(!t&&n&&!r)return null;let u;', 'let u;'],
    ['e[22]=x,e[23]=h,e[24]=S):S=e[24],S}function hBa()',
      'e[22]=x,e[23]=h,e[24]=S):S=e[24],(0,WJ.jsx)(`div`,{style:{visibility:!t&&n&&!r?`hidden`:void 0},inert:!t&&n&&!r,"aria-hidden":!t&&n&&!r,children:S})}function hBa()'],
    // Keep the surface at its full width. Its slot owns the discrete layout
    // width; surface transform/opacity own the transition, including reversals.
    ['let z=!v||y?1:w,B;', 'let z=1,B;'],
    ['B={minWidth:P,width:P,opacity:z}', 'B={minWidth:P,width:P,opacity:z,pointerEvents:`auto`,background:`var(--color-surface)`}'],
    // C (expanded), v (collapsible), and y (visible when collapsed) must be
    // reflected on the aside even when its other props are unchanged. Keep the
    // expensive children cached, and render this small DOM wrapper directly.
    ['let pe;return t[46]!==_||t[47]!==oe||t[48]!==se||t[49]!==de||t[50]!==H||t[51]!==fe?(pe=(0,aVa.jsxs)(xc.aside,{className:oe,"data-app-shell-left-panel-appearance":_,"data-slate-sidebar-peeking":se,style:de,children:[H,fe]}),t[46]=_,t[47]=oe,t[48]=se,t[49]=de,t[50]=H,t[51]=fe,t[52]=pe):pe=t[52],pe',
      'let pe=(0,aVa.jsxs)(xc.aside,{className:oe,"data-app-shell-left-panel-appearance":_,"data-slate-sidebar-peeking":se,inert:globalThis.workbenchAnimateSidebar?.inert?.(v&&!C&&!y)??(v&&!C&&!y),"aria-hidden":v&&!C&&!y,style:v&&!y?{...de,width:N,position:`absolute`,insetBlock:0,left:0,zIndex:20,pointerEvents:`none`,background:`transparent`,transform:C?`translateX(0)`:`translateX(-100%)`,opacity:C?1:0}:de,children:[H,fe]});return v&&!y?(0,aVa.jsx)(xc.div,{"data-yard-sidebar-slot":``,style:{position:`relative`,flexShrink:0,width:h},children:pe}):pe'],
  ];
  for (const [before, after] of edits) {
    if (source.split(before!).length !== 2) throw new Error('侧栏布局适配与固定界面版本不匹配：' + path);
    source = source.replace(before!, after!);
  }
  return Buffer.from(source);
}
