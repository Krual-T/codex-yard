import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";import{n as t,t as n}from"./chunk-X3CZISLH-428fb64d25b1.js";import{d as r,i}from"./chunk-ICXQ74PX-18fc0833b36a.js";import{n as a,r as o}from"./chunk-Y2CYZVJY-24cce454fd91.js";import{U as s,W as c,a as l,b as u,c as d,f,j as p,q as m,v as h,w as g,y as _}from"./chunk-WYO6CB5R-740efcbb02de.js";import{n as v,t as y}from"./chunk-VAUOI2AC-15509e09eec7.js";import{n as b,t as x}from"./chunk-JWPE2WC7-dd581fb60828.js";import{n as S,r as C}from"./mermaid-parser.core-529c84562d08.js";var w,T,E,D,O,k,A,j,M,N,P;function F(){return(F=e((()=>{x(),y(),r(),p(),n(),o(),S(),w=f.packet,T=class{constructor(){this.packet=[],this.setAccTitle=c,this.getAccTitle=_,this.setDiagramTitle=m,this.getDiagramTitle=g,this.getAccDescription=h,this.setAccDescription=s}static{a(this,`PacketDB`)}getConfig(){let e=i({...w,...u().packet});return e.showBits&&(e.paddingY+=10),e}getPacket(){return this.packet}pushWord(e){e.length>0&&this.packet.push(e)}clear(){l(),this.packet=[]}},E=1e4,D=a((e,n)=>{b(e,n);let r=-1,i=[],a=1,{bitsPerRow:o}=n.getConfig();for(let{start:s,end:c,bits:l,label:u}of e.blocks){if(s!==void 0&&c!==void 0&&c<s)throw Error(`Packet block ${s} - ${c} is invalid. End must be greater than start.`);if(s??=r+1,s!==r+1)throw Error(`Packet block ${s} - ${c??s} is not contiguous. It should start from ${r+1}.`);if(l===0)throw Error(`Packet block ${s} is invalid. Cannot have a zero bit field.`);for(c??=s+(l??1)-1,l??=c-s+1,r=c,t.debug(`Packet block ${s} - ${r} with label ${u}`);i.length<=o+1&&n.getPacket().length<E;){let[e,t]=O({start:s,end:c,bits:l,label:u},a,o);if(i.push(e),e.end+1===a*o&&(n.pushWord(i),i=[],a++),!t)break;({start:s,end:c,bits:l,label:u}=t)}}n.pushWord(i)},`populate`),O=a((e,t,n)=>{if(e.start===void 0)throw Error(`start should have been set during first phase`);if(e.end===void 0)throw Error(`end should have been set during first phase`);if(e.start>e.end)throw Error(`Block start ${e.start} is greater than block end ${e.end}.`);if(e.end+1<=t*n)return[e,void 0];let r=t*n-1,i=t*n;return[{start:e.start,end:r,label:e.label,bits:r-e.start},{start:i,end:e.end,label:e.label,bits:e.end-i}]},`getNextFittingBlock`),k={parser:{yy:void 0},parse:a(async e=>{let n=await C(`packet`,e),r=k.parser?.yy;if(!(r instanceof T))throw Error(`parser.parser?.yy was not a PacketDB. This is due to a bug within Mermaid, please report this issue at https://github.com/mermaid-js/mermaid/issues.`);t.debug(n),D(n,r)},`parse`)},A=a((e,t,n,r)=>{let i=r.db,a=i.getConfig(),{rowHeight:o,paddingY:s,bitWidth:c,bitsPerRow:l}=a,u=i.getPacket(),f=i.getDiagramTitle(),p=o+s,m=p*(u.length+1)-(f?0:o),h=c*l+2,g=v(t);g.attr(`viewBox`,`0 0 ${h} ${m}`),d(g,m,h,a.useMaxWidth);for(let[e,t]of u.entries())j(g,t,e,a);g.append(`text`).text(f).attr(`x`,h/2).attr(`y`,m-p/2).attr(`dominant-baseline`,`middle`).attr(`text-anchor`,`middle`).attr(`class`,`packetTitle`)},`draw`),j=a((e,t,n,{rowHeight:r,paddingX:i,paddingY:a,bitWidth:o,bitsPerRow:s,showBits:c})=>{let l=e.append(`g`),u=n*(r+a)+a;for(let e of t){let t=e.start%s*o+1,n=(e.end-e.start+1)*o-i;if(l.append(`rect`).attr(`x`,t).attr(`y`,u).attr(`width`,n).attr(`height`,r).attr(`class`,`packetBlock`),l.append(`text`).attr(`x`,t+n/2).attr(`y`,u+r/2).attr(`class`,`packetLabel`).attr(`dominant-baseline`,`middle`).attr(`text-anchor`,`middle`).text(e.label),!c)continue;let a=e.end===e.start,d=u-2;l.append(`text`).attr(`x`,t+(a?n/2:0)).attr(`y`,d).attr(`class`,`packetByte start`).attr(`dominant-baseline`,`auto`).attr(`text-anchor`,a?`middle`:`start`).text(e.start),a||l.append(`text`).attr(`x`,t+n).attr(`y`,d).attr(`class`,`packetByte end`).attr(`dominant-baseline`,`auto`).attr(`text-anchor`,`end`).text(e.end)}},`drawWord`),M={draw:A},N={byteFontSize:`10px`,startByteColor:`black`,endByteColor:`black`,labelColor:`black`,labelFontSize:`12px`,titleColor:`black`,titleFontSize:`14px`,blockStrokeColor:`black`,blockStrokeWidth:`1`,blockFillColor:`#efefef`},P={parser:k,get db(){return new T},renderer:M,styles:a(({packet:e}={})=>{let t=i(N,e);return`
	.packetByte {
		font-size: ${t.byteFontSize};
	}
	.packetByte.start {
		fill: ${t.startByteColor};
	}
	.packetByte.end {
		fill: ${t.endByteColor};
	}
	.packetLabel {
		fill: ${t.labelColor};
		font-size: ${t.labelFontSize};
	}
	.packetTitle {
		fill: ${t.titleColor};
		font-size: ${t.titleFontSize};
	}
	.packetBlock {
		stroke: ${t.blockStrokeColor};
		stroke-width: ${t.blockStrokeWidth};
		fill: ${t.blockFillColor};
	}
	`},`styles`)}})))()}F();export{P as diagram};
//# sourceMappingURL=diagram-NH7WQ7WH-567a8998da17.js.map