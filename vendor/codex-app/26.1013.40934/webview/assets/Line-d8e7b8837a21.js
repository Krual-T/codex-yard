import{n as e,o as t}from"./rolldown-runtime-2d059c5e81f4.js";import{gzt as n,hMt as r}from"./app-shared-61271c39e3c5.js";import{t as i}from"./extends-df342f7c2e8b.js";import{Ds as a,Eo as o,Es as s,Kn as c,Qr as l,Rs as u,Sr as d,Ts as f,U as p,Ui as m,Xr as h,_n as g,er as _,gs as v,ho as y,i as ee,qi as te,qn as b,qr as ne,s as x,st as re}from"./three.module-859594e5f29f.js";import{c as ie,i as ae,u as oe}from"./OrbitControls-50f368dfc364.js";function se(e,t,n){let r=w.setFromMatrixPosition(e.matrixWorld);r.project(t);let i=n.width/2,a=n.height/2;return[r.x*i+i,-(r.y*a)+a]}function ce(e,t){let n=w.setFromMatrixPosition(e.matrixWorld),r=T.setFromMatrixPosition(t.matrixWorld),i=n.sub(r),a=t.getWorldDirection(me);return i.angleTo(a)>Math.PI/2}function le(e,t,n,r){let i=w.setFromMatrixPosition(e.matrixWorld),a=i.clone();a.project(t),E.set(a.x,a.y),n.setFromCamera(E,t);let o=n.intersectObjects(r,!0);if(o.length){let e=o[0].distance;return i.distanceTo(n.ray.origin)<e}return!0}function ue(e,t){if(t instanceof m)return t.zoom;if(t instanceof te){let n=w.setFromMatrixPosition(e.matrixWorld),r=T.setFromMatrixPosition(t.matrixWorld),i=t.fov*Math.PI/180,a=n.distanceTo(r);return 1/(2*Math.tan(i/2)*a)}return 1}function de(e,t,n){if(t instanceof te||t instanceof m){let r=w.setFromMatrixPosition(e.matrixWorld),i=T.setFromMatrixPosition(t.matrixWorld),a=r.distanceTo(i),o=(n[1]-n[0])/(t.far-t.near),s=n[1]-o*t.far;return Math.round(o*a+s)}}function S(e,t,n=``){let r=`matrix3d(`;for(let n=0;n!==16;n++)r+=D(t[n]*e.elements[n])+(n===15?`)`:`,`);return n+r}function fe(e){return e&&typeof e==`object`&&`current`in e}var C,pe,w,T,me,E,D,he,ge,_e;function O(){return(O=e((()=>{C=t(n()),pe=t(r()),x(),ae(),w=new s,T=new s,me=new s,E=new f,D=e=>Math.abs(e)<1e-10?0:e,he=(e=>t=>S(t,e))([1,-1,1,1,1,-1,1,1,1,-1,1,1,1,-1,1,1]),ge=(e=>(t,n)=>S(t,e(n),`translate(-50%,-50%)`))(e=>[1/e,1/e,1/e,1,-1/e,-1/e,-1/e,-1,1/e,1/e,1/e,1,1,1,1,1]),_e=C.forwardRef(({children:e,eps:t=.001,style:n,className:r,prepend:a,center:o,fullscreen:c,portal:l,distanceFactor:u,sprite:d=!1,transform:f=!1,occlude:p,onOcclude:m,castShadow:h,receiveShadow:g,material:_,geometry:v,zIndexRange:y=[16777271,0],calculatePosition:ee=se,as:te=`div`,wrapperClass:b,pointerEvents:ne=`auto`,...x},re)=>{let{gl:ae,camera:S,scene:w,size:T,raycaster:me,events:E,viewport:_e}=oe(),[O]=C.useState(()=>document.createElement(te)),k=C.useRef(null),A=C.useRef(null),j=C.useRef(0),M=C.useRef([0,0]),N=C.useRef(null),P=C.useRef(null),F=l?.current||E.connected||ae.domElement.parentNode,I=C.useRef(null),L=C.useRef(!1),R=C.useMemo(()=>p&&p!==`blending`||Array.isArray(p)&&p.length&&fe(p[0]),[p]);C.useLayoutEffect(()=>{let e=ae.domElement;p&&p===`blending`?(e.style.zIndex=`${Math.floor(y[0]/2)}`,e.style.position=`absolute`,e.style.pointerEvents=`none`):(e.style.zIndex=null,e.style.position=null,e.style.pointerEvents=null)},[p]),C.useLayoutEffect(()=>{if(A.current){let e=k.current=pe.createRoot(O);if(w.updateMatrixWorld(),f)O.style.cssText=`position:absolute;top:0;left:0;pointer-events:none;overflow:hidden;`;else{let e=ee(A.current,S,T);O.style.cssText=`position:absolute;top:0;left:0;transform:translate3d(${e[0]}px,${e[1]}px,0);transform-origin:0 0;`}return F&&(a?F.prepend(O):F.appendChild(O)),()=>{F&&F.removeChild(O),e.unmount()}}},[F,f]),C.useLayoutEffect(()=>{b&&(O.className=b)},[b]);let z=C.useMemo(()=>f?{position:`absolute`,top:0,left:0,width:T.width,height:T.height,transformStyle:`preserve-3d`,pointerEvents:`none`}:{position:`absolute`,transform:o?`translate3d(-50%,-50%,0)`:`none`,...c&&{top:-T.height/2,left:-T.width/2,width:T.width,height:T.height},...n},[n,o,c,T,f]),B=C.useMemo(()=>({position:`absolute`,pointerEvents:ne}),[ne]);C.useLayoutEffect(()=>{if(L.current=!1,f){var t;(t=k.current)==null||t.render(C.createElement(`div`,{ref:N,style:z},C.createElement(`div`,{ref:P,style:B},C.createElement(`div`,{ref:re,className:r,style:n,children:e}))))}else{var i;(i=k.current)==null||i.render(C.createElement(`div`,{ref:re,style:z,className:r,children:e}))}});let V=C.useRef(!0);ie(e=>{if(A.current){S.updateMatrixWorld(),A.current.updateWorldMatrix(!0,!1);let e=f?M.current:ee(A.current,S,T);if(f||Math.abs(j.current-S.zoom)>t||Math.abs(M.current[0]-e[0])>t||Math.abs(M.current[1]-e[1])>t){let t=ce(A.current,S),n=!1;R&&(Array.isArray(p)?n=p.map(e=>e.current):p!==`blending`&&(n=[w]));let r=V.current;if(n){let e=le(A.current,S,me,n);V.current=e&&!t}else V.current=!t;r!==V.current&&(m?m(!V.current):O.style.display=V.current?`block`:`none`);let i=Math.floor(y[0]/2),a=p?R?[y[0],i]:[i-1,0]:y;if(O.style.zIndex=`${de(A.current,S,a)}`,f){let[e,t]=[T.width/2,T.height/2],n=S.projectionMatrix.elements[5]*t,{isOrthographicCamera:r,top:i,left:a,bottom:o,right:s}=S,c=he(S.matrixWorldInverse),l=r?`scale(${n})translate(${D(-(s+a)/2)}px,${D((i+o)/2)}px)`:`translateZ(${n}px)`,f=A.current.matrixWorld;d&&(f=S.matrixWorldInverse.clone().transpose().copyPosition(f).scale(A.current.scale),f.elements[3]=f.elements[7]=f.elements[11]=0,f.elements[15]=1),O.style.width=T.width+`px`,O.style.height=T.height+`px`,O.style.perspective=r?``:`${n}px`,N.current&&P.current&&(N.current.style.transform=`${l}${c}translate(${e}px,${t}px)`,P.current.style.transform=ge(f,1/((u||10)/400)))}else{let t=u===void 0?1:ue(A.current,S)*u;O.style.transform=`translate3d(${e[0]}px,${e[1]}px,0) scale(${t})`}M.current=e,j.current=S.zoom}}if(!R&&I.current&&!L.current){if(f){if(N.current){let e=N.current.children[0];if(e!=null&&e.clientWidth&&e!=null&&e.clientHeight){let{isOrthographicCamera:t}=S;if(t||v)x.scale&&(Array.isArray(x.scale)?x.scale instanceof s?I.current.scale.copy(x.scale.clone().divideScalar(1)):I.current.scale.set(1/x.scale[0],1/x.scale[1],1/x.scale[2]):I.current.scale.setScalar(1/x.scale));else{let t=(u||10)/400,n=e.clientWidth*t,r=e.clientHeight*t;I.current.scale.set(n,r,1)}L.current=!0}}}else{let t=O.children[0];if(t!=null&&t.clientWidth&&t!=null&&t.clientHeight){let e=1/_e.factor,n=t.clientWidth*e,r=t.clientHeight*e;I.current.scale.set(n,r,1),L.current=!0}I.current.lookAt(e.camera.position)}}});let ve=C.useMemo(()=>({vertexShader:f?void 0:`
          /*
            This shader is from the THREE's SpriteMaterial.
            We need to turn the backing plane into a Sprite
            (make it always face the camera) if "transfrom"
            is false.
          */
          #include <common>

          void main() {
            vec2 center = vec2(0., 1.);
            float rotation = 0.0;

            // This is somewhat arbitrary, but it seems to work well
            // Need to figure out how to derive this dynamically if it even matters
            float size = 0.03;

            vec4 mvPosition = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
            vec2 scale;
            scale.x = length( vec3( modelMatrix[ 0 ].x, modelMatrix[ 0 ].y, modelMatrix[ 0 ].z ) );
            scale.y = length( vec3( modelMatrix[ 1 ].x, modelMatrix[ 1 ].y, modelMatrix[ 1 ].z ) );

            bool isPerspective = isPerspectiveMatrix( projectionMatrix );
            if ( isPerspective ) scale *= - mvPosition.z;

            vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale * size;
            vec2 rotatedPosition;
            rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
            rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
            mvPosition.xy += rotatedPosition;

            gl_Position = projectionMatrix * mvPosition;
          }
      `,fragmentShader:`
        void main() {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
        }
      `}),[f]);return C.createElement(`group`,i({},x,{ref:A}),p&&!R&&C.createElement(`mesh`,{castShadow:h,receiveShadow:g,ref:I},v||C.createElement(`planeGeometry`,null),_||C.createElement(`shaderMaterial`,{side:2,vertexShader:ve.vertexShader,fragmentShader:ve.fragmentShader})))})})))()}var k;function A(){return(A=e((()=>{x(),k=parseInt(`179`.replace(/\D+/g,``))})))()}var j;function M(){return(M=e((()=>{A(),j=k>=125?`uv1`:`uv2`})))()}var N,P,F;function I(){return(I=e((()=>{x(),N=new p,P=new s,F=class extends c{constructor(){super(),this.isLineSegmentsGeometry=!0,this.type=`LineSegmentsGeometry`,this.setIndex([0,2,1,2,3,1,2,4,3,4,5,3,4,6,5,6,7,5]),this.setAttribute(`position`,new g([-1,2,0,1,2,0,-1,1,0,1,1,0,-1,0,0,1,0,0,-1,-1,0,1,-1,0],3)),this.setAttribute(`uv`,new g([-1,2,1,2,-1,1,1,1,-1,-1,1,-1,-1,-2,1,-2],2))}applyMatrix4(e){let t=this.attributes.instanceStart,n=this.attributes.instanceEnd;return t!==void 0&&(t.applyMatrix4(e),n.applyMatrix4(e),t.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}setPositions(e){let t;e instanceof Float32Array?t=e:Array.isArray(e)&&(t=new Float32Array(e));let n=new b(t,6,1);return this.setAttribute(`instanceStart`,new _(n,3,0)),this.setAttribute(`instanceEnd`,new _(n,3,3)),this.computeBoundingBox(),this.computeBoundingSphere(),this}setColors(e,t=3){let n;e instanceof Float32Array?n=e:Array.isArray(e)&&(n=new Float32Array(e));let r=new b(n,t*2,1);return this.setAttribute(`instanceColorStart`,new _(r,t,0)),this.setAttribute(`instanceColorEnd`,new _(r,t,t)),this}fromWireframeGeometry(e){return this.setPositions(e.attributes.position.array),this}fromEdgesGeometry(e){return this.setPositions(e.attributes.position.array),this}fromMesh(e){return this.fromWireframeGeometry(new u(e.geometry)),this}fromLineSegments(e){let t=e.geometry;return this.setPositions(t.attributes.position.array),this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new p);let e=this.attributes.instanceStart,t=this.attributes.instanceEnd;e!==void 0&&t!==void 0&&(this.boundingBox.setFromBufferAttribute(e),N.setFromBufferAttribute(t),this.boundingBox.union(N))}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new o),this.boundingBox===null&&this.computeBoundingBox();let e=this.attributes.instanceStart,t=this.attributes.instanceEnd;if(e!==void 0&&t!==void 0){let n=this.boundingSphere.center;this.boundingBox.getCenter(n);let r=0;for(let i=0,a=e.count;i<a;i++)P.fromBufferAttribute(e,i),r=Math.max(r,n.distanceToSquared(P)),P.fromBufferAttribute(t,i),r=Math.max(r,n.distanceToSquared(P));this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&console.error(`THREE.LineSegmentsGeometry.computeBoundingSphere(): Computed radius is NaN. The instanced position data is likely to have NaN values.`,this)}}toJSON(){}applyMatrix(e){return console.warn(`THREE.LineSegmentsGeometry: applyMatrix() has been renamed to applyMatrix4().`),this.applyMatrix4(e)}}})))()}var L;function R(){return(R=e((()=>{I(),L=class extends F{constructor(){super(),this.isLineGeometry=!0,this.type=`LineGeometry`}setPositions(e){let t=e.length-3,n=new Float32Array(2*t);for(let r=0;r<t;r+=3)n[2*r]=e[r],n[2*r+1]=e[r+1],n[2*r+2]=e[r+2],n[2*r+3]=e[r+3],n[2*r+4]=e[r+4],n[2*r+5]=e[r+5];return super.setPositions(n),this}setColors(e,t=3){let n=e.length-t,r=new Float32Array(2*n);if(t===3)for(let i=0;i<n;i+=t)r[2*i]=e[i],r[2*i+1]=e[i+1],r[2*i+2]=e[i+2],r[2*i+3]=e[i+3],r[2*i+4]=e[i+4],r[2*i+5]=e[i+5];else for(let i=0;i<n;i+=t)r[2*i]=e[i],r[2*i+1]=e[i+1],r[2*i+2]=e[i+2],r[2*i+3]=e[i+3],r[2*i+4]=e[i+4],r[2*i+5]=e[i+5],r[2*i+6]=e[i+6],r[2*i+7]=e[i+7];return super.setColors(r,t),this}fromLine(e){let t=e.geometry;return this.setPositions(t.attributes.position.array),this}}})))()}var z;function B(){return(B=e((()=>{x(),A(),z=class extends y{constructor(e){super({type:`LineMaterial`,uniforms:v.clone(v.merge([ee.common,ee.fog,{worldUnits:{value:1},linewidth:{value:1},resolution:{value:new f(1,1)},dashOffset:{value:0},dashScale:{value:1},dashSize:{value:1},gapSize:{value:1}}])),vertexShader:`
				#include <common>
				#include <fog_pars_vertex>
				#include <logdepthbuf_pars_vertex>
				#include <clipping_planes_pars_vertex>

				uniform float linewidth;
				uniform vec2 resolution;

				attribute vec3 instanceStart;
				attribute vec3 instanceEnd;

				#ifdef USE_COLOR
					#ifdef USE_LINE_COLOR_ALPHA
						varying vec4 vLineColor;
						attribute vec4 instanceColorStart;
						attribute vec4 instanceColorEnd;
					#else
						varying vec3 vLineColor;
						attribute vec3 instanceColorStart;
						attribute vec3 instanceColorEnd;
					#endif
				#endif

				#ifdef WORLD_UNITS

					varying vec4 worldPos;
					varying vec3 worldStart;
					varying vec3 worldEnd;

					#ifdef USE_DASH

						varying vec2 vUv;

					#endif

				#else

					varying vec2 vUv;

				#endif

				#ifdef USE_DASH

					uniform float dashScale;
					attribute float instanceDistanceStart;
					attribute float instanceDistanceEnd;
					varying float vLineDistance;

				#endif

				void trimSegment( const in vec4 start, inout vec4 end ) {

					// trim end segment so it terminates between the camera plane and the near plane

					// conservative estimate of the near plane
					float a = projectionMatrix[ 2 ][ 2 ]; // 3nd entry in 3th column
					float b = projectionMatrix[ 3 ][ 2 ]; // 3nd entry in 4th column
					float nearEstimate = - 0.5 * b / a;

					float alpha = ( nearEstimate - start.z ) / ( end.z - start.z );

					end.xyz = mix( start.xyz, end.xyz, alpha );

				}

				void main() {

					#ifdef USE_COLOR

						vLineColor = ( position.y < 0.5 ) ? instanceColorStart : instanceColorEnd;

					#endif

					#ifdef USE_DASH

						vLineDistance = ( position.y < 0.5 ) ? dashScale * instanceDistanceStart : dashScale * instanceDistanceEnd;
						vUv = uv;

					#endif

					float aspect = resolution.x / resolution.y;

					// camera space
					vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );
					vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );

					#ifdef WORLD_UNITS

						worldStart = start.xyz;
						worldEnd = end.xyz;

					#else

						vUv = uv;

					#endif

					// special case for perspective projection, and segments that terminate either in, or behind, the camera plane
					// clearly the gpu firmware has a way of addressing this issue when projecting into ndc space
					// but we need to perform ndc-space calculations in the shader, so we must address this issue directly
					// perhaps there is a more elegant solution -- WestLangley

					bool perspective = ( projectionMatrix[ 2 ][ 3 ] == - 1.0 ); // 4th entry in the 3rd column

					if ( perspective ) {

						if ( start.z < 0.0 && end.z >= 0.0 ) {

							trimSegment( start, end );

						} else if ( end.z < 0.0 && start.z >= 0.0 ) {

							trimSegment( end, start );

						}

					}

					// clip space
					vec4 clipStart = projectionMatrix * start;
					vec4 clipEnd = projectionMatrix * end;

					// ndc space
					vec3 ndcStart = clipStart.xyz / clipStart.w;
					vec3 ndcEnd = clipEnd.xyz / clipEnd.w;

					// direction
					vec2 dir = ndcEnd.xy - ndcStart.xy;

					// account for clip-space aspect ratio
					dir.x *= aspect;
					dir = normalize( dir );

					#ifdef WORLD_UNITS

						// get the offset direction as perpendicular to the view vector
						vec3 worldDir = normalize( end.xyz - start.xyz );
						vec3 offset;
						if ( position.y < 0.5 ) {

							offset = normalize( cross( start.xyz, worldDir ) );

						} else {

							offset = normalize( cross( end.xyz, worldDir ) );

						}

						// sign flip
						if ( position.x < 0.0 ) offset *= - 1.0;

						float forwardOffset = dot( worldDir, vec3( 0.0, 0.0, 1.0 ) );

						// don't extend the line if we're rendering dashes because we
						// won't be rendering the endcaps
						#ifndef USE_DASH

							// extend the line bounds to encompass  endcaps
							start.xyz += - worldDir * linewidth * 0.5;
							end.xyz += worldDir * linewidth * 0.5;

							// shift the position of the quad so it hugs the forward edge of the line
							offset.xy -= dir * forwardOffset;
							offset.z += 0.5;

						#endif

						// endcaps
						if ( position.y > 1.0 || position.y < 0.0 ) {

							offset.xy += dir * 2.0 * forwardOffset;

						}

						// adjust for linewidth
						offset *= linewidth * 0.5;

						// set the world position
						worldPos = ( position.y < 0.5 ) ? start : end;
						worldPos.xyz += offset;

						// project the worldpos
						vec4 clip = projectionMatrix * worldPos;

						// shift the depth of the projected points so the line
						// segments overlap neatly
						vec3 clipPose = ( position.y < 0.5 ) ? ndcStart : ndcEnd;
						clip.z = clipPose.z * clip.w;

					#else

						vec2 offset = vec2( dir.y, - dir.x );
						// undo aspect ratio adjustment
						dir.x /= aspect;
						offset.x /= aspect;

						// sign flip
						if ( position.x < 0.0 ) offset *= - 1.0;

						// endcaps
						if ( position.y < 0.0 ) {

							offset += - dir;

						} else if ( position.y > 1.0 ) {

							offset += dir;

						}

						// adjust for linewidth
						offset *= linewidth;

						// adjust for clip-space to screen-space conversion // maybe resolution should be based on viewport ...
						offset /= resolution.y;

						// select end
						vec4 clip = ( position.y < 0.5 ) ? clipStart : clipEnd;

						// back to clip space
						offset *= clip.w;

						clip.xy += offset;

					#endif

					gl_Position = clip;

					vec4 mvPosition = ( position.y < 0.5 ) ? start : end; // this is an approximation

					#include <logdepthbuf_vertex>
					#include <clipping_planes_vertex>
					#include <fog_vertex>

				}
			`,fragmentShader:`
				uniform vec3 diffuse;
				uniform float opacity;
				uniform float linewidth;

				#ifdef USE_DASH

					uniform float dashOffset;
					uniform float dashSize;
					uniform float gapSize;

				#endif

				varying float vLineDistance;

				#ifdef WORLD_UNITS

					varying vec4 worldPos;
					varying vec3 worldStart;
					varying vec3 worldEnd;

					#ifdef USE_DASH

						varying vec2 vUv;

					#endif

				#else

					varying vec2 vUv;

				#endif

				#include <common>
				#include <fog_pars_fragment>
				#include <logdepthbuf_pars_fragment>
				#include <clipping_planes_pars_fragment>

				#ifdef USE_COLOR
					#ifdef USE_LINE_COLOR_ALPHA
						varying vec4 vLineColor;
					#else
						varying vec3 vLineColor;
					#endif
				#endif

				vec2 closestLineToLine(vec3 p1, vec3 p2, vec3 p3, vec3 p4) {

					float mua;
					float mub;

					vec3 p13 = p1 - p3;
					vec3 p43 = p4 - p3;

					vec3 p21 = p2 - p1;

					float d1343 = dot( p13, p43 );
					float d4321 = dot( p43, p21 );
					float d1321 = dot( p13, p21 );
					float d4343 = dot( p43, p43 );
					float d2121 = dot( p21, p21 );

					float denom = d2121 * d4343 - d4321 * d4321;

					float numer = d1343 * d4321 - d1321 * d4343;

					mua = numer / denom;
					mua = clamp( mua, 0.0, 1.0 );
					mub = ( d1343 + d4321 * ( mua ) ) / d4343;
					mub = clamp( mub, 0.0, 1.0 );

					return vec2( mua, mub );

				}

				void main() {

					#include <clipping_planes_fragment>

					#ifdef USE_DASH

						if ( vUv.y < - 1.0 || vUv.y > 1.0 ) discard; // discard endcaps

						if ( mod( vLineDistance + dashOffset, dashSize + gapSize ) > dashSize ) discard; // todo - FIX

					#endif

					float alpha = opacity;

					#ifdef WORLD_UNITS

						// Find the closest points on the view ray and the line segment
						vec3 rayEnd = normalize( worldPos.xyz ) * 1e5;
						vec3 lineDir = worldEnd - worldStart;
						vec2 params = closestLineToLine( worldStart, worldEnd, vec3( 0.0, 0.0, 0.0 ), rayEnd );

						vec3 p1 = worldStart + lineDir * params.x;
						vec3 p2 = rayEnd * params.y;
						vec3 delta = p1 - p2;
						float len = length( delta );
						float norm = len / linewidth;

						#ifndef USE_DASH

							#ifdef USE_ALPHA_TO_COVERAGE

								float dnorm = fwidth( norm );
								alpha = 1.0 - smoothstep( 0.5 - dnorm, 0.5 + dnorm, norm );

							#else

								if ( norm > 0.5 ) {

									discard;

								}

							#endif

						#endif

					#else

						#ifdef USE_ALPHA_TO_COVERAGE

							// artifacts appear on some hardware if a derivative is taken within a conditional
							float a = vUv.x;
							float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
							float len2 = a * a + b * b;
							float dlen = fwidth( len2 );

							if ( abs( vUv.y ) > 1.0 ) {

								alpha = 1.0 - smoothstep( 1.0 - dlen, 1.0 + dlen, len2 );

							}

						#else

							if ( abs( vUv.y ) > 1.0 ) {

								float a = vUv.x;
								float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
								float len2 = a * a + b * b;

								if ( len2 > 1.0 ) discard;

							}

						#endif

					#endif

					vec4 diffuseColor = vec4( diffuse, alpha );
					#ifdef USE_COLOR
						#ifdef USE_LINE_COLOR_ALPHA
							diffuseColor *= vLineColor;
						#else
							diffuseColor.rgb *= vLineColor;
						#endif
					#endif

					#include <logdepthbuf_fragment>

					gl_FragColor = diffuseColor;

					#include <tonemapping_fragment>
					#include <${k>=154?`colorspace_fragment`:`encodings_fragment`}>
					#include <fog_fragment>
					#include <premultiplied_alpha_fragment>

				}
			`,clipping:!0}),this.isLineMaterial=!0,this.onBeforeCompile=function(){this.transparent?this.defines.USE_LINE_COLOR_ALPHA=`1`:delete this.defines.USE_LINE_COLOR_ALPHA},Object.defineProperties(this,{color:{enumerable:!0,get:function(){return this.uniforms.diffuse.value},set:function(e){this.uniforms.diffuse.value=e}},worldUnits:{enumerable:!0,get:function(){return`WORLD_UNITS`in this.defines},set:function(e){e===!0?this.defines.WORLD_UNITS=``:delete this.defines.WORLD_UNITS}},linewidth:{enumerable:!0,get:function(){return this.uniforms.linewidth.value},set:function(e){this.uniforms.linewidth.value=e}},dashed:{enumerable:!0,get:function(){return`USE_DASH`in this.defines},set(e){!!e!=`USE_DASH`in this.defines&&(this.needsUpdate=!0),e===!0?this.defines.USE_DASH=``:delete this.defines.USE_DASH}},dashScale:{enumerable:!0,get:function(){return this.uniforms.dashScale.value},set:function(e){this.uniforms.dashScale.value=e}},dashSize:{enumerable:!0,get:function(){return this.uniforms.dashSize.value},set:function(e){this.uniforms.dashSize.value=e}},dashOffset:{enumerable:!0,get:function(){return this.uniforms.dashOffset.value},set:function(e){this.uniforms.dashOffset.value=e}},gapSize:{enumerable:!0,get:function(){return this.uniforms.gapSize.value},set:function(e){this.uniforms.gapSize.value=e}},opacity:{enumerable:!0,get:function(){return this.uniforms.opacity.value},set:function(e){this.uniforms.opacity.value=e}},resolution:{enumerable:!0,get:function(){return this.uniforms.resolution.value},set:function(e){this.uniforms.resolution.value.copy(e)}},alphaToCoverage:{enumerable:!0,get:function(){return`USE_ALPHA_TO_COVERAGE`in this.defines},set:function(e){!!e!=`USE_ALPHA_TO_COVERAGE`in this.defines&&(this.needsUpdate=!0),e===!0?(this.defines.USE_ALPHA_TO_COVERAGE=``,this.extensions.derivatives=!0):(delete this.defines.USE_ALPHA_TO_COVERAGE,this.extensions.derivatives=!1)}}}),this.setValues(e)}}})))()}function V(e,t,n){return X.set(0,0,-t,1).applyMatrix4(e.projectionMatrix),X.multiplyScalar(1/X.w),X.x=Q/n.width,X.y=Q/n.height,X.applyMatrix4(e.projectionMatrixInverse),X.multiplyScalar(1/X.w),Math.abs(Math.max(X.x,X.y))}function ve(e,t){let n=e.matrixWorld,r=e.geometry,i=r.attributes.instanceStart,a=r.attributes.instanceEnd,o=Math.min(r.instanceCount,i.count);for(let r=0,c=o;r<c;r++){q.start.fromBufferAttribute(i,r),q.end.fromBufferAttribute(a,r),q.applyMatrix4(n);let o=new s,c=new s;Z.distanceSqToSegment(q.start,q.end,c,o),c.distanceTo(o)<Q*.5&&t.push({point:c,pointOnLine:o,distance:Z.origin.distanceTo(c),object:e,face:null,faceIndex:r,uv:null,[j]:null})}}function ye(e,t,n){let r=t.projectionMatrix,i=e.material.resolution,a=e.matrixWorld,o=e.geometry,c=o.attributes.instanceStart,l=o.attributes.instanceEnd,u=Math.min(o.instanceCount,c.count),d=-t.near;Z.at(1,G),G.w=1,G.applyMatrix4(t.matrixWorldInverse),G.applyMatrix4(r),G.multiplyScalar(1/G.w),G.x*=i.x/2,G.y*=i.y/2,G.z=0,K.copy(G),Se.multiplyMatrices(t.matrixWorldInverse,a);for(let t=0,o=u;t<o;t++){if(U.fromBufferAttribute(c,t),W.fromBufferAttribute(l,t),U.w=1,W.w=1,U.applyMatrix4(Se),W.applyMatrix4(Se),U.z>d&&W.z>d)continue;if(U.z>d){let e=U.z-W.z,t=(U.z-d)/e;U.lerp(W,t)}else if(W.z>d){let e=W.z-U.z,t=(W.z-d)/e;W.lerp(U,t)}U.applyMatrix4(r),W.applyMatrix4(r),U.multiplyScalar(1/U.w),W.multiplyScalar(1/W.w),U.x*=i.x/2,U.y*=i.y/2,W.x*=i.x/2,W.y*=i.y/2,q.start.copy(U),q.start.z=0,q.end.copy(W),q.end.z=0;let o=q.closestPointToPointParameter(K,!0);q.at(o,Ce);let u=ne.lerp(U.z,W.z,o),f=u>=-1&&u<=1,p=K.distanceTo(Ce)<Q*.5;if(f&&p){q.start.fromBufferAttribute(c,t),q.end.fromBufferAttribute(l,t),q.start.applyMatrix4(a),q.end.applyMatrix4(a);let r=new s,i=new s;Z.distanceSqToSegment(q.start,q.end,i,r),n.push({point:i,pointOnLine:r,distance:Z.origin.distanceTo(i),object:e,face:null,faceIndex:t,uv:null,[j]:null})}}}var H,be,xe,U,W,G,K,Se,q,Ce,J,Y,X,Z,Q,we;function Te(){return(Te=e((()=>{x(),I(),B(),M(),H=new a,be=new s,xe=new s,U=new a,W=new a,G=new a,K=new s,Se=new h,q=new d,Ce=new s,J=new p,Y=new o,X=new a,we=class extends l{constructor(e=new F,t=new z({color:Math.random()*16777215})){super(e,t),this.isLineSegments2=!0,this.type=`LineSegments2`}computeLineDistances(){let e=this.geometry,t=e.attributes.instanceStart,n=e.attributes.instanceEnd,r=new Float32Array(2*t.count);for(let e=0,i=0,a=t.count;e<a;e++,i+=2)be.fromBufferAttribute(t,e),xe.fromBufferAttribute(n,e),r[i]=i===0?0:r[i-1],r[i+1]=r[i]+be.distanceTo(xe);let i=new b(r,2,1);return e.setAttribute(`instanceDistanceStart`,new _(i,1,0)),e.setAttribute(`instanceDistanceEnd`,new _(i,1,1)),this}raycast(e,t){let n=this.material.worldUnits,r=e.camera;r===null&&!n&&console.error(`LineSegments2: "Raycaster.camera" needs to be set in order to raycast against LineSegments2 while worldUnits is set to false.`);let i=e.params.Line2===void 0?0:e.params.Line2.threshold||0;Z=e.ray;let a=this.matrixWorld,o=this.geometry,s=this.material;Q=s.linewidth+i,o.boundingSphere===null&&o.computeBoundingSphere(),Y.copy(o.boundingSphere).applyMatrix4(a);let c;if(c=n?Q*.5:V(r,Math.max(r.near,Y.distanceToPoint(Z.origin)),s.resolution),Y.radius+=c,Z.intersectsSphere(Y)===!1)return;o.boundingBox===null&&o.computeBoundingBox(),J.copy(o.boundingBox).applyMatrix4(a);let l;l=n?Q*.5:V(r,Math.max(r.near,J.distanceToPoint(Z.origin)),s.resolution),J.expandByScalar(l),Z.intersectsBox(J)!==!1&&(n?ve(this,t):ye(this,r,t))}onBeforeRender(e){let t=this.material.uniforms;t&&t.resolution&&(e.getViewport(H),this.material.uniforms.resolution.value.set(H.z,H.w))}}})))()}var Ee;function De(){return(De=e((()=>{Te(),R(),B(),Ee=class extends we{constructor(e=new L,t=new z({color:Math.random()*16777215})){super(e,t),this.isLine2=!0,this.type=`Line2`}}})))()}var $,Oe;function ke(){return(ke=e((()=>{$=t(n()),x(),ae(),Te(),De(),B(),I(),R(),Oe=$.forwardRef(function({points:e,color:t=16777215,vertexColors:n,linewidth:r,lineWidth:o,segments:c,dashed:l,...u},d){var p;let m=oe(e=>e.size),h=$.useMemo(()=>c?new we:new Ee,[c]),[g]=$.useState(()=>new z),_=(n==null||(p=n[0])==null?void 0:p.length)===4?4:3,v=$.useMemo(()=>{let r=c?new F:new L,i=e.map(e=>{let t=Array.isArray(e);return e instanceof s||e instanceof a?[e.x,e.y,e.z]:e instanceof f?[e.x,e.y,0]:t&&e.length===3?[e[0],e[1],e[2]]:t&&e.length===2?[e[0],e[1],0]:e});if(r.setPositions(i.flat()),n){t=16777215;let e=n.map(e=>e instanceof re?e.toArray():e);r.setColors(e.flat(),_)}return r},[e,c,n,_]);return $.useLayoutEffect(()=>{h.computeLineDistances()},[e,h]),$.useLayoutEffect(()=>{l?g.defines.USE_DASH=``:delete g.defines.USE_DASH,g.needsUpdate=!0},[l,g]),$.useEffect(()=>()=>{v.dispose(),g.dispose()},[v]),$.createElement(`primitive`,i({object:h,ref:d},u),$.createElement(`primitive`,{object:v,attach:`geometry`}),$.createElement(`primitive`,i({object:g,attach:`material`,color:t,vertexColors:!!n,resolution:[m.width,m.height],linewidth:r??o??1,dashed:l,transparent:_===4},u)))})})))()}export{O as i,ke as n,_e as r,Oe as t};
//# sourceMappingURL=Line-d8e7b8837a21.js.map