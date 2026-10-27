import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";import{Jyt as t,Sj as n,Yyt as r,dj as i,nbt as a,obt as o,tbt as s}from"./app-shared-61271c39e3c5.js";import{fd as c,hd as l,md as u}from"./app-primary-f5ea123a0407.js";function d(e,{viewport:t={width:window.innerWidth,height:window.innerHeight},viewportScale:n,zoomFactor:r=1}={}){let i=s(e,{viewport:t,viewportScale:n,zoomFactor:r});return a(n)===1?{left:i.x,top:i.y,width:i.width}:{height:i.height,left:i.x,top:i.y,width:i.width}}var f,p,m,h,g,_,v,y;function b(){return(b=e((()=>{l(),o(),n(),f=`#000000`,p=`#0069FB`,m={...t,fill:c,hotspotByMode:{add:{x:t.width/2,y:t.height/2},comment:t.hotspot,text:{x:7,y:13.5}},path:u({width:t.width,height:t.height,strokeWidth:1.65}),stroke:`white`,strokeWidth:1.65},h=m.hotspotByMode.comment.x/m.width*100,g=(m.hotspotByMode.comment.y+(m.width-m.height)/2)/m.width*100,_=`translate(-${h}%,-${g}%)`,v={position:`fixed`,inset:0,pointerEvents:`none`,fontSize:`13px`,fontFamily:`-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`},y=`
.hover-box{position:fixed;box-sizing:border-box;border-radius:0;border:2px solid ${p};background:color-mix(in srgb,${p} 3%,transparent);box-shadow:inset 0 0 0 1px rgba(255,255,255,.28);pointer-events:none;transition:opacity 150ms cubic-bezier(${i.join(`,`)})}
[data-browser-comment-control-editing] .hover-box{opacity:0}
@media(prefers-reduced-motion:reduce){.hover-box{transition:none}}
.text-selection-highlight{position:fixed;box-sizing:border-box;background:#128dff66;pointer-events:none}
.flex-item-overlay{position:fixed;box-sizing:border-box;border-radius:0;border:1px solid rgba(2,133,255,.52);background:rgba(18,141,255,.18);box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);pointer-events:none}
.interaction-layer{position:fixed;inset:0;z-index:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;border:0;padding:0;background:transparent;pointer-events:none}
.interaction-layer::backdrop{background:transparent}
.interaction-blocker{position:absolute;inset:0;z-index:0;pointer-events:auto;touch-action:pan-x pan-y}
.annotation-selection-cursor{position:fixed;z-index:1;display:block}
.annotation-selection-modifier-cursor{z-index:2;color:${f};paint-order:stroke fill;stroke:${m.stroke};stroke-linejoin:round;stroke-width:2px}
.annotation-selection-comment-cursor{overflow:visible}
.annotation-selection-comment-cursor[data-browser-comment-annotation-selection-cursor-mode="text"]{z-index:2}
.annotation-selection-cursor-bubble{transform:translate(0,0) scale(1);transform-box:view-box;transform-origin:0 0;transition:transform 150ms cubic-bezier(${i.join(`,`)})}
.annotation-selection-cursor-beam{opacity:0;transition:opacity 150ms cubic-bezier(${i.join(`,`)})}
[data-browser-comment-annotation-selection-cursor-mode="text"] .annotation-selection-cursor-bubble{transform:translate(${12+m.hotspotByMode.comment.x-m.hotspotByMode.text.x}px,${-2+m.hotspotByMode.comment.y-m.hotspotByMode.text.y}px) scale(.55)}
[data-browser-comment-annotation-selection-cursor-mode="text"] .annotation-selection-cursor-beam{opacity:1}
@media(prefers-reduced-motion:reduce){.annotation-selection-cursor-bubble,.annotation-selection-cursor-beam{transition:none}}
[data-browser-comment-annotation-selection-modifier-active] .marker{cursor:none}
.annotation-selection-target-hover{border-color:color-mix(in srgb,${p} 80%,black)}
.annotation-selection-remove-hover{background:color-mix(in srgb,${p} 20%,transparent)}
.region-box{border-width:2px;border-style:dashed}
.posted-region-highlight{position:fixed;box-sizing:border-box;border-radius:0;background:color-mix(in srgb,${p} 3%,transparent);pointer-events:none}
.google-docs-annotation-box{background:transparent;box-shadow:none}
.google-docs-element-box{border-color:transparent}
.markers-layer{position:fixed;inset:0;z-index:1;pointer-events:none}
.marker{position:fixed;border:0;background:transparent;transform:${_};transform-origin:${h}% ${g}%;pointer-events:auto;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
.marker-icon{position:absolute;inset:0;display:block;width:100%;height:100%;pointer-events:none}
.saved-marker{width:var(--browser-sidebar-saved-marker-size);height:var(--browser-sidebar-saved-marker-size)}
.draft-marker{width:var(--browser-sidebar-draft-marker-size);height:var(--browser-sidebar-draft-marker-size)}
.marker-label{position:relative;color:${m.stroke};font-size:var(--browser-sidebar-marker-label-font-size);font-weight:700;line-height:1;pointer-events:none}
.marker-motion{position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:100%;pointer-events:none;transform-origin:bottom left;scale:1;transition:scale 150ms cubic-bezier(${i.join(`,`)})}
.marker:hover .marker-motion,.marker[data-selected="true"] .marker-motion{scale:1.08}
@media(prefers-reduced-motion:reduce){.marker-motion{transition:none}}
${r}
`})))()}export{d as a,m as i,v as n,b as o,y as r,p as t};
//# sourceMappingURL=style-70526dc84b07.js.map