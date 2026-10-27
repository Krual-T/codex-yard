import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";import{r as t}from"./ordinal-654830f58ee1.js";import{t as n}from"./src-2bd214aedacd.js";import{n as r,t as i}from"./chunk-X3CZISLH-428fb64d25b1.js";import{t as a}from"./arc-a62fdff23ebe.js";import{n as o}from"./pie-f34043ff89c8.js";import{d as s,i as c,m as l}from"./chunk-ICXQ74PX-18fc0833b36a.js";import{n as u,r as d}from"./chunk-Y2CYZVJY-24cce454fd91.js";import{U as f,W as p,a as m,c as h,f as g,j as _,q as v,v as y,w as b,x,y as S}from"./chunk-WYO6CB5R-740efcbb02de.js";import{n as C,t as w}from"./chunk-VAUOI2AC-15509e09eec7.js";import{n as T,t as E}from"./chunk-JWPE2WC7-dd581fb60828.js";import{n as D,r as O}from"./mermaid-parser.core-529c84562d08.js";var k,A,j,M,N,P,F,I,L,R,z;function B(){return(B=e((()=>{E(),w(),s(),_(),i(),d(),D(),n(),k=g.pie,A={sections:new Map,showData:!1,config:k},j=A.sections,M=A.showData,N=structuredClone(k),P={getConfig:u(()=>structuredClone(N),`getConfig`),clear:u(()=>{j=new Map,M=A.showData,m()},`clear`),setDiagramTitle:v,getDiagramTitle:b,setAccTitle:p,getAccTitle:S,setAccDescription:f,getAccDescription:y,addSection:u(({label:e,value:t})=>{if(t<0)throw Error(`"${e}" has invalid value: ${t}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);j.has(e)||(j.set(e,t),r.debug(`added new section: ${e}, with value: ${t}`))},`addSection`),getSections:u(()=>j,`getSections`),setShowData:u(e=>{M=e},`setShowData`),getShowData:u(()=>M,`getShowData`)},F=u((e,t)=>{T(e,t),t.setShowData(e.showData),e.sections.map(t.addSection)},`populateDb`),I={parse:u(async e=>{let t=await O(`pie`,e);r.debug(t),F(t,P)},`parse`)},L=u(e=>`
  .pieCircle{
    stroke: ${e.pieStrokeColor};
    stroke-width : ${e.pieStrokeWidth};
    opacity : ${e.pieOpacity};
  }
  .pieCircle.highlighted{
    scale: 1.05;
    opacity: 1;
  }
  .pieCircle.highlightedOnHover:hover{
    transition-duration: 250ms;
    scale: 1.05;
    opacity: 1;
  }
  .pieOuterCircle{
    stroke: ${e.pieOuterStrokeColor};
    stroke-width: ${e.pieOuterStrokeWidth};
    fill: none;
  }
  .pieTitleText {
    text-anchor: middle;
    font-size: ${e.pieTitleTextSize};
    fill: ${e.pieTitleTextColor};
    font-family: ${e.fontFamily};
  }
  .slice {
    font-family: ${e.fontFamily};
    fill: ${e.pieSectionTextColor};
    font-size:${e.pieSectionTextSize};
    // fill: white;
  }
  .legend text {
    fill: ${e.pieLegendTextColor};
    font-family: ${e.fontFamily};
    font-size: ${e.pieLegendTextSize};
  }
`,`getStyles`),R=u(e=>{let t=[...e.values()].reduce((e,t)=>e+t,0),n=[...e.entries()].map(([e,t])=>({label:e,value:t})).filter(e=>e.value/t*100>=1);return o().value(e=>e.value).sort(null)(n)},`createPieArcs`),z={parser:I,db:P,renderer:{draw:u((e,n,i,o)=>{r.debug(`rendering pie chart
`+e);let s=o.db,u=x(),d=c(s.getConfig(),u.pie),f=C(n),p=f.append(`g`);p.attr(`transform`,`translate(225,225)`);let{themeVariables:m}=u,[g]=l(m.pieOuterStrokeWidth);g??=2;let _=d.legendPosition,v=d.textPosition,y=d.donutHole>0&&d.donutHole<=.9?d.donutHole:0,b=a().innerRadius(y*185).outerRadius(185),S=a().innerRadius(185*v).outerRadius(185*v),w=p.append(`g`);w.append(`circle`).attr(`cx`,0).attr(`cy`,0).attr(`r`,185+g/2).attr(`class`,`pieOuterCircle`);let T=s.getSections(),E=R(T),D=[m.pie1,m.pie2,m.pie3,m.pie4,m.pie5,m.pie6,m.pie7,m.pie8,m.pie9,m.pie10,m.pie11,m.pie12],O=0;T.forEach(e=>{O+=e});let k=E.filter(e=>(e.data.value/O*100).toFixed(0)!==`0`),A=t(D).domain([...T.keys()]);w.selectAll(`mySlices`).data(k).enter().append(`path`).attr(`d`,b).attr(`fill`,e=>A(e.data.label)).attr(`class`,e=>{let t=`pieCircle`;return d.highlightSlice===`hover`?t+=` highlightedOnHover`:d.highlightSlice===e.data.label&&(t+=` highlighted`),t}),w.selectAll(`mySlices`).data(k).enter().append(`text`).text(e=>(e.data.value/O*100).toFixed(0)+`%`).attr(`transform`,e=>`translate(`+S.centroid(e)+`)`).style(`text-anchor`,`middle`).attr(`class`,`slice`);let j=p.append(`text`).text(s.getDiagramTitle()).attr(`x`,0).attr(`y`,-200).attr(`class`,`pieTitleText`),M=[...T.entries()].map(([e,t])=>({label:e,value:t})),N=p.selectAll(`.legend`).data(M).enter().append(`g`).attr(`class`,`legend`);N.append(`rect`).attr(`width`,18).attr(`height`,18).style(`fill`,e=>A(e.label)).style(`stroke`,e=>A(e.label)),N.append(`text`).attr(`x`,22).attr(`y`,14).text(e=>s.getShowData()?`${e.label} [${e.value}]`:e.label);let P=Math.max(...N.selectAll(`text`).nodes().map(e=>e?.getBoundingClientRect().width??0)),F=450,I=490,L=M.length*22;switch(_){case`center`:N.attr(`transform`,(e,t)=>{let n=22*M.length/2,r=-P/2-22,i=t*22-n;return`translate(`+r+`,`+i+`)`});break;case`top`:F+=L,N.attr(`transform`,(e,t)=>`translate(${-P/2-22}, ${t*22-185})`),w.attr(`transform`,()=>`translate(0, ${L+22})`);break;case`bottom`:F+=L,N.attr(`transform`,(e,t)=>{let n=-P/2-22,r=t*22- -207;return`translate(`+n+`,`+r+`)`});break;case`left`:I+=22+P,N.attr(`transform`,(e,t)=>{let n=22*M.length/2;return`translate(-207,`+(t*22-n)+`)`}),w.attr(`transform`,()=>`translate(${P+18+4}, 0)`);break;default:I+=22+P,N.attr(`transform`,(e,t)=>{let n=22*M.length/2;return`translate(216,`+(t*22-n)+`)`})}let z=j.node()?.getBoundingClientRect().width??0,B=225-z/2,V=225+z/2,H=Math.min(0,B),U=Math.max(I,V)-H;f.attr(`viewBox`,`${H} 0 ${U} ${F}`),h(f,F,U,d.useMaxWidth)},`draw`)},styles:L}})))()}B();export{z as diagram};
//# sourceMappingURL=pieDiagram-ENE6RG2P-43a33c4e5d52.js.map