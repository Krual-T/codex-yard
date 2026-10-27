import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";import{gzt as t,iwt as n,rwt as r,vMt as i}from"./app-shared-61271c39e3c5.js";import{$i as a,Gr as o,J as s,Qr as c,Ts as l,_n as u,a as d,ho as f,lo as p,mo as m,qi as h,qr as g,s as _,st as v}from"./three.module-859594e5f29f.js";function y(e){let t=e;return()=>(t=(t*1664525+1013904223)%4294967296,t/4294967296)}function b(e){return e()*2-1}function x(e){let t=Math.max(e(),2**-52),n=e();return Math.sqrt(-2*Math.log(t))*Math.cos(W*n)}function S(e,t){let n=Math.sin(e*127.1+t*311.7)*43758.5453123;return(n-Math.floor(n))*2-1}function C(e,t){let n=Math.floor(e),r=e-n,i=r*r*r*(r*(r*6-15)+10),a=S(n,t)*r;return(a+(S(n+1,t)*(r-1)-a)*i)*2}function w(e,t){return K(C(e,t)*.68+C(e*2.07,t+17)*.23+C(e*4.11,t+43)*.09,-1,1)}function T(e){return .36*Math.min(1.12,e.radiusScale)*(e.railRadiusScale??1)}function E(e){return e==null?I:{height:Math.max(1,e.height+U*2),width:Math.max(1,e.width+U*2)}}function D([e,t,n]){let r=Math.max(Math.hypot(e,t,n),1e-4);return[e/r,t/r,n/r]}function O([e,t,n],[r,i,a]){return[e+r,t+i,n+a]}function k([e,t,n],r){return[e*r,t*r,n*r]}function A(e,t,n){let r=K((n-e)/(t-e));return r*r*(3-2*r)}function j(e,t,n){return[e[0]+(t[0]-e[0])*n,e[1]+(t[1]-e[1])*n,e[2]+(t[2]-e[2])*n]}function M(e,t,n){let r=(t.depthEnd??t.depth)-t.depth;if(t.aperture||r===0)return e;let i=K((F-t.depth)/r);if(e<=i)return e;let a=(e-i)/(1-i);return i+(n*a+(1-n)*(1-(1-a)**3)/3)*(1-i)}function N(e,t,n){if(n.mobilePath){let r=e*2-1,i=1-r*r,a=r*t.width*.95,o=t.height*(n.mobilePath.y+r*n.mobilePath.slope+i*n.mobilePath.curvature),s=n.mobilePath.rotation??0,c=Math.cos(s),l=Math.sin(s);return[n.offsetX+a*c-o*l,n.offsetY+a*l+o*c,n.depth+((n.depthEnd??n.depth)-n.depth)*e]}let r=n.tunnelTurns??1,i=Math.sign(r),a=M(e,n,ye),o=n.aperture?0:A(Pe,Ne,t.width/t.height),s=A(.82,1,e),c=n.depth+((n.depthEnd??n.depth)-n.depth)*e,l=a*W*r-Math.PI/2+n.angleOffset+o*s*W*Ie*i,u=A(0,1,e),d=n.radiusScale+((n.radiusScaleEnd??n.radiusScale)-n.radiusScale)*u,f=(n.depthEnd??n.depth)-n.depth,p=A(f===0?1:K((le-n.depth)/f),1,e),m=A(xe,1,e),h=n.aperture?0:A(V,H,c)*(1-A(B,z,c))*Me,g=n.aperture?0:w(e*R,n.motionPhase+23)*p*(.14+m*ke),_=l+(n.aperture?0:w(e*R*.83+3.4,n.motionPhase+13)*p*(.07+m*Ae)),v=n.aperture?1:(1-p*.54)*(1+m*be),y=n.aperture?1:1-Math.max(0,Math.cos(_))*m*Se,b=n.aperture?1:1-Math.max(0,Math.cos(_))*A(we,.78,e)*(1-A(.82,Te,e))*Ce,x=n.aperture?1:1+Math.max(0,Math.cos(_))*A(De,1,e)*Ee,S=n.aperture?0:A(V,H,c)*(1-A(B,z,c)),C=n.aperture?1:1-Math.cos(_)*S*Oe,T=Math.min(t.height*.39,t.width*.5)*d*v*y*b*x*C*(1+h)*(1+o*s*Fe)*(1+g);return[n.offsetX+Math.cos(_)*T,n.offsetY+Math.sin(_)*T,c]}function ee(e,t,n){let r=N(e,t,n),i=1/534,a=N(Math.max(0,e-i),t,n),o=N(Math.min(1,e+i),t,n);return{position:r,tangent:D([o[0]-a[0],o[1]-a[1],o[2]-a[2]])}}function P(e,t,n,r,i,a={}){e.push({aperture:i.aperture??!1,end:n,kind:r,layerOpacity:i.opacity,particleWeight:a.particleWeight??i.particleWeight,start:t,thicknessScale:a.thicknessScale??1})}function te(e,t){if(e.aperture)return e.particleWeight;let n=Math.abs(t-Re),r=1-A(0,ze,n);return Math.round(e.particleWeight*(1+r*Be))}function ne(e,t,n,r){let i=[],a=[],o=Math.round((r.helixTurns??L)*he),s=new Set(Array.from({length:o},(e,t)=>Math.round((t+.5)/o*(n-1)))),c=T(r),l=.48*Math.min(1.08,r.radiusScale)*(r.railDepthScale??1);for(let o=0;o<n;o+=1){let u=o/(n-1),{position:d,tangent:f}=ee(u,t,r),p=D([-f[1],f[0],0]),m=D([f[1]*p[2]-f[2]*p[1],f[2]*p[0]-f[0]*p[2],f[0]*p[1]-f[1]*p[0]]),h=1+.3400000000000001*(r.aperture?0:A(F,ce,d[2]))**1.08,g=u*W*(r.helixTurns??L)+r.motionPhase,_=O(k(p,Math.cos(g)*c*h),k(m,Math.sin(g)*l*h)),v=d,y=e.nodes.length;e.nodes.push({centerline:v,layerOpacity:r.opacity,position:O(v,_),strandPhase:g,tangent:f});let b=e.nodes.length;if(e.nodes.push({centerline:v,layerOpacity:r.opacity,position:O(v,k(_,-1)),strandPhase:g,tangent:f}),a.push([y,b]),r.aperture){let t=e.nodes.length;e.nodes.push({centerline:v,layerOpacity:r.opacity,position:v,strandPhase:g,tangent:f}),i.push(t)}if(o>0){let t=a[o-1],n=te(r,d[2]);P(e.edges,t[0],y,`backbone`,r,{particleWeight:n}),P(e.edges,t[1],b,`backbone`,r,{particleWeight:n}),r.aperture&&P(e.edges,i[o-1],i[o],`backbone`,r,{particleWeight:r.rimParticleWeight,thicknessScale:.24})}s.has(o)&&P(e.edges,y,b,`bond`,r,{particleWeight:te(r,d[2])})}}function re(e,t=`default`,n){let r={edges:[],nodes:[]},i=t===`mobile`?me:pe;return(t===`mobile`?Qe.map((e,t)=>{let r=n?.[t];if(r==null)return e;let i=r.z-e.depth;return{...e,depth:r.z,depthEnd:(e.depthEnd??e.depth)+i,mobilePath:e.mobilePath?{...e.mobilePath,rotation:r.rotationDegrees*Math.PI/180}:void 0,offsetX:r.x,offsetY:r.y}}):Ze).forEach(t=>{ne(r,e,Math.round(i*(t.sampleMultiplier??1)),t)}),r}function ie(e,t){return Array.from({length:He},()=>{let n=(e()<.5?-1:1)*(.9+e()**.72*4.2),r=.48+e()*1.42,i=.42+e()*1.22;return{depth:n,radiusX:r,radiusY:i,radiusZ:.72+Math.abs(n)*.16+i*.24,x:b(e)*t.width*.5,y:b(e)*t.height*.5}})}function ae(e,t,n=!1){let r=G;n?r=Xe:e&&(r=Ye);let i=E(t),a=i.width*i.height/(I.width*I.height);return{backbones:Math.round(r.backbones*a),bonds:Math.round(r.bonds*a),motes:Math.round(r.motes*a)}}function oe(e,t=0){let n=E(e),r=Math.max(0,t)*.5*(9.96/10);return Math.max(Math.min(n.height*.39,n.width*.5)*fe,r)}function se(e=G,t,n=t,r={}){let i=E(t),a=E(n),o=e.backbones+e.bonds+e.motes,s=oe(n,r.minimumApertureDiameter),c=new Float32Array(o*3),l=new Float32Array(o*2),u=new Float32Array(o),d=new Float32Array(o),f=new Float32Array(o*3),p=new Float32Array(o),m=new Float32Array(o),h=new Float32Array(o),g=new Float32Array(o*3),_=y(1952),v=ie(_,i),S=re(a,r.layout,r.mobileSpecimens),C=e=>S.edges.flatMap((t,n)=>t.kind===e?Array.from({length:t.particleWeight},()=>({edge:t,edgeIndex:n})):[]),w=C(`backbone`),T=C(`bond`),O=(e,t,n)=>e[r.layout===`mobile`?Math.floor(t/n*e.length):t%e.length],k=0,A=(e,t,n,r)=>{let i=S.edges[e],a=S.nodes[i.start],o=S.nodes[i.end],s=_(),v=j(a.position,o.position,s),y=j(a.centerline,o.centerline,s),b=D(j(a.tangent,o.tangent,s)),C=D([-b[1],b[0],0]),w=D([b[1]*C[2]-b[2]*C[1],b[2]*C[0]-b[0]*C[2],b[0]*C[1]-b[1]*C[0]]),T=i.aperture?je:1,E=x(_)*n*i.thicknessScale*T,O=x(_)*n*i.thicknessScale*T,A=k*3;f[A]=v[0]+C[0]*E+w[0]*O,f[A+1]=v[1]+C[1]*E+w[1]*O,f[A+2]=v[2]+C[2]*E+w[2]*O,c[A]=y[0],c[A+1]=y[1],c[A+2]=y[2],g[A]=b[0],g[A+1]=b[1],g[A+2]=b[2],l[k*2]=+!!i.aperture,l[k*2+1]=i.aperture&&i.thicknessScale>.5?1:0,u[k]=t,d[k]=i.layerOpacity,p[k]=r,m[k]=_(),h[k]=a.strandPhase+(o.strandPhase-a.strandPhase)*s,k+=1};for(let t=0;t<e.backbones;t+=1)A(O(w,t,e.backbones).edgeIndex,0,ue,.14+_()**2.4*.76+(_()<.045?.4+_()*.52:0));for(let t=0;t<e.bonds;t+=1)A(O(T,t,e.bonds).edgeIndex,1,de,.1+_()**2.5*.5+(_()<.025?.22+_()*.3:0));for(let t=0;t<e.motes;t+=1){let e=k*3,t=_()*W,n=r.layout===`mobile`?We:Ue,a=r.layout===`mobile`?Ge:.78,o=_()<n,y=_(),S=r.layout===`mobile`&&!o&&y<Ke,C=r.layout===`mobile`&&o,w=y<qe,T=v[Math.floor(_()*v.length)],E=_()*W,D=Math.sqrt(_())*s*a,O;O=S?[i.width*(.16+_()*.38),i.height*(.12+_()*.36),-1.8+_()*3.6]:o?[Math.cos(E)*D,Math.sin(E)*D,.18000000000000002+_()*.34]:w?[b(_)*i.width*.5,b(_)*i.height*.5,b(_)*Je]:[K(T.x+x(_)*T.radiusX,-i.width*.54,i.width*.54),K(T.y+x(_)*T.radiusY,-i.height*.54,i.height*.54),T.depth+Math.tanh(x(_)*.68)*T.radiusZ*1.65],f[e]=O[0],f[e+1]=O[1],f[e+2]=O[2],c[e]=f[e],c[e+1]=f[e+1],c[e+2]=f[e+2],g[e+2]=1,l[k*2]=Math.cos(t),l[k*2+1]=Math.sin(t),u[k]=2;let A=.34+_()*.4,j=K((f[e+2]-.8)/2.8),M=.16+_()**2.05*1.18+j*(.46+_()*1.16)+(_()<.04?1.34+_()*2.24:0);d[k]=C?Math.min(1,A+.22):A,p[k]=C?.12+Math.min(M,1.6)*.42:M,m[k]=_(),h[k]=_()*W,k+=1}return{apertureRadius:s,centerlinePositions:c,flowDirections:l,kinds:u,layerOpacities:d,positions:f,scales:p,seeds:m,strandPhases:h,tangentDirections:g}}var ce,F,le,ue,de,fe,I,pe,me,L,he,ge,_e,ve,ye,be,xe,Se,Ce,we,Te,Ee,De,Oe,ke,Ae,R,je,Me,z,B,V,H,Ne,Pe,Fe,Ie,Le,Re,ze,Be,Ve,He,Ue,We,Ge,Ke,qe,Je,U,W,G,Ye,Xe,K,Ze,Qe;function $e(){return($e=e((()=>{ce=7.7,F=.68,le=.04,ue=.026,de=.018,fe=.9122,I={height:10.2,width:14.2},pe=178,me=204,L=10.25,he=10,ge=-6.4,_e=-5.8,ve=7.2,ye=.91,be=1.76,xe=.6,Se=.32,Ce=.13,we=.7,Te=.9,Ee=.16,De=.9,Oe=.1,ke=.42,Ae=.28,R=7.2,je=.76,Me=.25,z=4.8,B=4.1,V=-1.8599999999999999,H=-1.06,Ne=3.3,Pe=2.75,Fe=.48,Ie=1,Le=42,Re=-1.06,ze=1.35,Be=1.65,Ve=4.15,He=15,Ue=.022,We=.32,Ge=1.08,Ke=.1,qe=.2,Je=4.8,U=.42,W=Math.PI*2,G={backbones:64e3,bonds:2e4,motes:7600},Ye={backbones:44e3,bonds:14200,motes:5e3},Xe={backbones:38e3,bonds:12200,motes:4200},K=(e,t=0,n=1)=>Math.min(n,Math.max(t,e)),Ze=[{angleOffset:-4.99,depth:_e,depthEnd:ve,helixTurns:Le,motionPhase:.42,offsetX:.08,offsetY:-.04,opacity:.82,particleWeight:5,radiusScale:.64,radiusScaleEnd:1.48,sampleMultiplier:Ve,tunnelTurns:ge}],Qe=[{angleOffset:0,depth:.83,depthEnd:.38,helixTurns:1.05,mobilePath:{curvature:.045,rotation:-Math.PI*27/180,slope:-.075,y:.3},motionPhase:.36,offsetX:-2.03,offsetY:.27,opacity:1,particleWeight:6,railDepthScale:1.7,railRadiusScale:2.65,radiusScale:1,sampleMultiplier:1.65},{angleOffset:0,depth:.45,depthEnd:0,helixTurns:.92,mobilePath:{curvature:-.045,rotation:-Math.PI*13/180,slope:.065,y:-.3},motionPhase:.36,offsetX:0,offsetY:0,opacity:1,particleWeight:6,railDepthScale:1.65,railRadiusScale:2.35,radiusScale:.98,sampleMultiplier:1.65}]})))()}function et(e,t=!1){if(t)return{bokehScale:1.5,cameraFov:39,dialRotation:0,opacity:1};let n=Math.min(Y,Math.max(0,e)),r=Z.findIndex(e=>e.elapsedSeconds>=n),i=Math.min(1,Math.max(0,e/it)),a=i*i*(3-2*i);if(r<=0)return{...r<0?Z[Z.length-1]:Z[0],opacity:a};let o=Z[r-1],s=Z[r],c=Z[Math.max(r-2,0)],l=Z[Math.min(r+1,Z.length-1)],u=(n-o.elapsedSeconds)/(s.elapsedSeconds-o.elapsedSeconds);return{bokehScale:q(c.bokehScale,o.bokehScale,s.bokehScale,l.bokehScale,u),cameraFov:q(c.cameraFov,o.cameraFov,s.cameraFov,l.cameraFov,u),dialRotation:q(c.dialRotation,o.dialRotation,s.dialRotation,l.dialRotation,u),opacity:a}}function q(e,t,n,r,i){let a=i*i,o=a*i,s=(n-e)/2*.38,c=(r-t)/2*.38;return(2*o-3*a+1)*t+(o-2*a+i)*s+(-2*o+3*a)*n+(o-a)*c}var J,tt,nt,rt,it,Y,X,Z;function at(){return(at=e((()=>{J=1.55,tt=13.96,nt=-.018,rt=.22,it=.8,Y=2.72,X=e=>(e-J)*nt,Z=[{bokehScale:32,cameraFov:43.2,dialRotation:X(J),elapsedSeconds:0},{bokehScale:30,cameraFov:42.8,dialRotation:X(1.62),elapsedSeconds:rt},{bokehScale:24,cameraFov:42,dialRotation:X(2.58),elapsedSeconds:.56},{bokehScale:6.7,cameraFov:39.4,dialRotation:X(12.510000000000002),elapsedSeconds:1.22},{bokehScale:2.66,cameraFov:38.32,dialRotation:X(14.340000000000002),elapsedSeconds:1.62},{bokehScale:1.8,cameraFov:39.08,dialRotation:X(13.860000000000001),elapsedSeconds:2.22},{bokehScale:1.56,cameraFov:38.98,dialRotation:X(13.985000000000001),elapsedSeconds:2.5},{bokehScale:1.5,cameraFov:39,dialRotation:X(tt),elapsedSeconds:Y}]})))()}var ot,st,ct,lt,ut,dt;function ft(){return(ft=e((()=>{ot=`
  attribute vec3 aCenterlinePosition;
  attribute float aKind;
  attribute float aLayerOpacity;
  attribute float aScale;
  attribute float aSeed;
  attribute float aStrandPhase;
  attribute vec3 aTangentDirection;
  attribute vec2 aFlowDirection;

  uniform float uApertureRadius;
  uniform float uFocusBokeh;
  uniform float uIntroOpacity;
  uniform float uMotion;
  uniform float uPixelRatio;
  uniform float uPointSize;
  uniform float uTime;
  uniform vec2 uPointer;
  uniform vec2 uViewport;

  varying float vKind;
  varying float vGlow;
  varying float vApertureStrength;
  varying float vApertureWrapStrength;
  varying float vCenterAttenuation;
  varying float vDepthBlur;
  varying float vParticleBokeh;
  varying float vOpacity;
  varying float vPulse;
  varying float vSeed;

  vec3 rotateAroundAxis(vec3 value, vec3 axis, float angle) {
    return value * cos(angle) +
      cross(axis, value) * sin(angle) +
      axis * dot(axis, value) * (1.0 - cos(angle));
  }

  void main() {
    float isMote = step(1.5, aKind);
    float isStructure = 1.0 - isMote;
    float spinSpeed = mix(0.74, 1.0, aLayerOpacity);
    float spinAngle =
      (uTime * 0.24 * spinSpeed +
        sin(uTime * 0.1 + aStrandPhase) * 0.045) * uMotion;

    vec3 radialPosition = position - aCenterlinePosition;
    vec3 spunPosition =
      aCenterlinePosition +
      rotateAroundAxis(
        radialPosition,
        normalize(aTangentDirection),
        spinAngle
      );
    vec3 resolvedPosition = mix(position, spunPosition, isStructure);

    float depthDrift = mix(
      0.52,
      1.58,
      smoothstep(-1.2, 1.2, position.z)
    );
    float strandDriftPhase = uTime * 0.18 + aStrandPhase;
    resolvedPosition.x +=
      cos(strandDriftPhase) * 0.026 * depthDrift * isStructure * uMotion;
    resolvedPosition.y +=
      sin(strandDriftPhase * 0.83) *
      0.022 *
      depthDrift *
      isStructure *
      uMotion;

    float moteTravelPhase = uTime * (0.22 + aSeed * 0.16) + aSeed * 19.0;
    float moteTravel =
      sin(moteTravelPhase) *
      (0.09 + aSeed * 0.08) *
      depthDrift *
      isMote *
      uMotion;
    resolvedPosition.xy += aFlowDirection * moteTravel;

    vec2 pointerWorld = uPointer * uViewport * 0.5;
    float pointerDistance = distance(resolvedPosition.xy, pointerWorld);
    float pointerGlow = exp(-pointerDistance * pointerDistance * 2.4) * uMotion;
    vec2 pointerOffset = resolvedPosition.xy - pointerWorld;
    resolvedPosition.xy += pointerOffset * pointerGlow * 0.09;

    vec4 viewPosition = modelViewMatrix * vec4(resolvedPosition, 1.0);
    float focusBlur = smoothstep(0.72, 7.2, abs(resolvedPosition.z + 4.0));
    float particleBokeh = clamp(
      pow(focusBlur, 1.34) * mix(0.45, 2.8, clamp(uFocusBokeh / 32.0, 0.0, 1.0)),
      0.0,
      1.0
    );
    float depthParallax = clamp(1.0 + position.z * 0.38, 0.55, 1.9);

    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize =
      aScale *
      uPointSize *
      uPixelRatio *
      (8.2 / max(-viewPosition.z, 0.1)) *
      depthParallax *
      mix(1.0, 2.2, particleBokeh) *
      (1.0 + pointerGlow * 0.3);

    float pulse =
      pow(
        max(sin(uTime * (0.58 + aSeed * 0.52) + aSeed * 41.0), 0.0),
        14.0
      ) *
      (0.26 + aSeed * 0.34) *
      isStructure *
      uMotion;
    float apertureVisibility = mix(
      1.0,
      smoothstep(
        uApertureRadius * 0.84,
        uApertureRadius * 1.03,
        length(resolvedPosition.xy)
      ),
      isStructure
    );
    float copyContrast = smoothstep(
      uApertureRadius * 0.72,
      uApertureRadius * 1.1,
      length(resolvedPosition.xy)
    );

    vKind = aKind;
    vGlow = pointerGlow;
    vApertureStrength = 0.0;
    vApertureWrapStrength = 0.0;
    vCenterAttenuation = mix(0.14, 1.0, copyContrast);
    vDepthBlur = focusBlur * isStructure;
    vParticleBokeh = particleBokeh * 0.45;
    vOpacity =
      uIntroOpacity *
      aLayerOpacity *
      apertureVisibility *
      (0.45 + isStructure * 0.23 - isMote * 0.12 + pulse * 0.36);
    vPulse = pulse;
    vSeed = aSeed;
  }
`,st=`
  uniform float uContrast;
  uniform vec3 uForeground;

  varying float vKind;
  varying float vGlow;
  varying float vApertureStrength;
  varying float vApertureWrapStrength;
  varying float vCenterAttenuation;
  varying float vDepthBlur;
  varying float vParticleBokeh;
  varying float vOpacity;
  varying float vPulse;
  varying float vSeed;

  void main() {
    float isMote = step(1.5, vKind);
    vec2 centered = gl_PointCoord - vec2(0.5);
    float radius = length(centered);
    float dustCore = pow(max(1.0 - radius / 0.34, 0.0), 1.8);
    float dustHalo = pow(max(1.0 - radius / 0.52, 0.0), 2.65);
    float apertureCore = pow(max(1.0 - radius / 0.49, 0.0), 1.7);
    float apertureHalo = pow(max(1.0 - radius / 0.52, 0.0), 4.4) * 0.26;
    float core = mix(dustCore, apertureCore, vApertureStrength);
    float halo = mix(dustHalo, apertureHalo, vApertureStrength);
    float depthSoftCore = pow(max(1.0 - radius / 0.46, 0.0), 2.2) * 0.38;
    float depthSoftHalo = pow(max(1.0 - radius / 0.52, 0.0), 1.52);
    core = mix(core, depthSoftCore, vDepthBlur);
    halo = mix(halo, depthSoftHalo, vDepthBlur);
    core *= mix(1.0, 0.08, vParticleBokeh);
    halo = mix(
      halo,
      pow(max(1.0 - radius / 0.52, 0.0), 0.52),
      vParticleBokeh
    );

    if (halo <= 0.001) discard;

    vec3 structureColor = uForeground * 0.82;
    vec3 moteColor = uForeground * 0.46;
    vec3 color = mix(structureColor, moteColor, isMote);
    float particleVariation = mix(0.34, 1.52, pow(vSeed, 1.82));
    float bioGlow = smoothstep(0.015, 0.82, vGlow);
    float copyContrast = pow(vCenterAttenuation, 1.9);
    float interactionCopyContrast = mix(copyContrast, 1.0, bioGlow);
    vec3 baseLight = color * (0.93 + core * 0.5 + vPulse * 0.46) * copyContrast * mix(1.0, mix(1.2, 1.7, vApertureWrapStrength), vApertureStrength) * particleVariation * mix(1.0, 0.76, vDepthBlur) * mix(1.0, 0.52, vParticleBokeh);
    vec3 monochromeHalo = uForeground;
    vec3 interactionHalo = monochromeHalo * bioGlow * halo * 0.62 * interactionCopyContrast;
    float hotCore = bioGlow * pow(core, 1.55);
    vec3 monochromeCore = uForeground;
    vec3 activeCore = monochromeCore * hotCore * 1.28 * interactionCopyContrast;
    float restingCore = 0.84;
    float restingHalo = 0.16;
    float copyAlphaFloor = 0.14;
    float copyAlpha = mix(copyAlphaFloor, 1.0, copyContrast);
    float alpha = (core * (restingCore + vPulse * 0.45 + hotCore * 0.48) + halo * (restingHalo + vPulse * 0.21 + bioGlow * 0.28)) * vOpacity * mix(copyAlpha, 1.0, bioGlow) * mix(1.0, mix(1.04, 1.42, vApertureWrapStrength), vApertureStrength) * mix(0.36, 1.18, particleVariation) * mix(1.0, 0.48, vDepthBlur) * mix(1.0, 0.22, vParticleBokeh);

    gl_FragColor = vec4(
      min((baseLight + interactionHalo + activeCore) * uContrast, vec3(1.0)),
      min(alpha * uContrast, 1.0)
    );
  }
`,ct=`
  varying float vAngle;
  varying float vRadius;

  void main() {
    vAngle = atan(position.y, position.x);
    vRadius = length(position.xy);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`,lt=`
  uniform float uApertureContrast;
  uniform vec3 uForeground;
  uniform float uApertureRadius;
  uniform float uCoronaIntensityScale;
  uniform float uCoronaSizeScale;
  uniform float uOpacity;
  uniform float uTime;

  varying float vAngle;
  varying float vRadius;

  void main() {
    float distanceFromRim = vRadius - uApertureRadius;
    float flareDistanceFromRim =
      distanceFromRim / max(uCoronaSizeScale, 0.001);
    float broadArc = 0.5 + 0.5 * sin(vAngle * 13.0 - uTime * 0.16);
    float fineArc = 0.5 + 0.5 * sin(vAngle * 29.0 + uTime * 0.11 + 1.7);
    float flareShape = pow(broadArc, 5.0) * 0.82 + pow(fineArc, 11.0) * 0.18;
    float glassArc =
      pow(max(cos(vAngle - 0.78), 0.0), 8.0) +
      pow(max(cos(vAngle + 2.18), 0.0), 12.0) * 0.82 +
      pow(max(cos(vAngle - 2.72), 0.0), 18.0) * 0.42;
    float glassGlint =
      pow(max(cos(vAngle * 3.0 + 0.64), 0.0), 22.0) *
      (0.6 + fineArc * 0.4);
    float outerReach = mix(0.034, 0.076, flareShape);
    float outerMask =
      smoothstep(-0.012, 0.018, flareDistanceFromRim) *
      (1.0 - smoothstep(0.02, outerReach, flareDistanceFromRim));
    float innerMask =
      smoothstep(-0.12, -0.012, distanceFromRim) *
      (1.0 - smoothstep(-0.012, 0.018, distanceFromRim));
    float innerGlow =
      smoothstep(-0.16, -0.02, flareDistanceFromRim) *
      (1.0 - smoothstep(-0.02, 0.018, flareDistanceFromRim));
    float hairline = 1.0 - smoothstep(0.0, 0.024, abs(distanceFromRim));
    float innerRefraction =
      1.0 - smoothstep(0.0, 0.014, abs(distanceFromRim + 0.022));
    float lensDepth = clamp(-distanceFromRim / max(uApertureRadius, 0.001), 0.0, 1.0);
    float convexEdge = pow(1.0 - lensDepth, 4.2);
    float convexMargin = 1.0 - smoothstep(0.08, 0.24, lensDepth);
    float convexHighlight =
      pow(max(cos(vAngle - 0.68), 0.0), 5.0) *
      convexEdge *
      convexMargin *
      smoothstep(0.08, 0.88, lensDepth);
    float convexCounterReflection =
      pow(max(cos(vAngle + 2.46), 0.0), 7.0) *
      convexEdge *
      convexMargin *
      smoothstep(0.06, 0.72, lensDepth);
    float wideHalo =
      smoothstep(-0.018, 0.032, flareDistanceFromRim) *
      (1.0 - smoothstep(0.028, 0.078, flareDistanceFromRim));
    float glassIntensity =
      hairline * (0.075 + glassArc * 0.22 + glassGlint * 0.11) +
      innerMask * (0.035 + glassArc * 0.13 + glassGlint * 0.055) +
      innerRefraction * (0.018 + glassArc * 0.035);
    float flareIntensity =
      outerMask * (0.045 + flareShape * 0.08) +
      innerGlow * (0.025 + glassArc * 0.09) +
      convexHighlight * 0.16 +
      convexCounterReflection * 0.055 +
      wideHalo * 0.025;
    float intensity = glassIntensity + flareIntensity * uCoronaIntensityScale;

    if (intensity <= 0.001) discard;

    gl_FragColor = vec4(
      uForeground,
      clamp(intensity * uApertureContrast, 0.0, 1.0) * uOpacity
    );
  }
`,ut=`
  varying float vAngle;
  varying float vLensAngle;
  varying float vRadius;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);

    vAngle = atan(position.y, position.x);
    vLensAngle = atan(worldPosition.y, worldPosition.x);
    vRadius = length(position.xy);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`,dt=`
  uniform float uApertureContrast;
  uniform vec3 uForeground;
  uniform float uApertureRadius;
  uniform float uFlareRotation;
  uniform float uOpacity;
  uniform float uTime;

  varying float vAngle;
  varying float vLensAngle;
  varying float vRadius;

  float getComplementaryBase(float base) {
    return mod(base + 2.0, 4.0);
  }

  void main() {
    const float notchCount = 48.0;
    const float pairedNotchCount = notchCount * 0.5;
    float notchProgress =
      (vAngle + 3.14159265359) / 6.28318530718 * notchCount;
    float notchIndex = floor(notchProgress);
    float notchOffset =
      (fract(notchProgress) - 0.5) *
      6.28318530718 /
      notchCount *
      vRadius;
    float distanceInsideRim = uApertureRadius - vRadius;
    float pairedNotchIndex = mod(notchIndex, pairedNotchCount);
    float base = mod(
      pairedNotchIndex * 3.0 + floor(pairedNotchIndex / 3.0) * 2.0,
      4.0
    );

    // The second half mirrors the first with valid DNA mates: A-T and C-G.
    if (notchIndex >= pairedNotchCount) {
      base = getComplementaryBase(base);
    }

    float halfWidth = 0.044;
    float outerGap = 0.074;
    float roundedOuterCap =
      1.0 - smoothstep(
        halfWidth,
        halfWidth + 0.014,
        length(vec2(notchOffset, distanceInsideRim - outerGap - 0.042))
      );
    float pillBody =
      (1.0 - smoothstep(halfWidth, halfWidth + 0.012, abs(notchOffset))) *
      smoothstep(outerGap, outerGap + 0.012, distanceInsideRim) *
      (1.0 - smoothstep(0.27, 0.282, distanceInsideRim));
    float tipEnvelope =
      smoothstep(0.26, 0.272, distanceInsideRim) *
      (1.0 - smoothstep(0.362, 0.374, distanceInsideRim));
    float flatTipMask =
      tipEnvelope *
      (1.0 - smoothstep(halfWidth, halfWidth + 0.012, abs(notchOffset)));
    float roundedTipMask =
      smoothstep(0.26, 0.272, distanceInsideRim) *
      (
        1.0 -
        smoothstep(
          halfWidth,
          halfWidth + 0.012,
          length(vec2(notchOffset, max(distanceInsideRim - 0.322, 0.0)))
        )
      );
    float pointedTipMask =
      tipEnvelope *
      (
        1.0 -
        smoothstep(
          0.0,
          0.018,
          abs(notchOffset) -
            mix(halfWidth, 0.0, smoothstep(0.27, 0.374, distanceInsideRim))
        )
      );
    float notchedTipMask =
      tipEnvelope *
      (1.0 - smoothstep(halfWidth, halfWidth + 0.012, abs(notchOffset))) *
      smoothstep(
        0.0,
        0.015,
        abs(notchOffset) -
          mix(0.0, halfWidth, smoothstep(0.27, 0.374, distanceInsideRim))
      );
    float concaveTipMask =
      flatTipMask *
      smoothstep(
        0.0,
        0.015,
        length(
          vec2(
            notchOffset,
            distanceInsideRim - 0.374
          )
        ) -
          halfWidth
      );
    float tipMask = mix(
      mix(notchedTipMask, roundedTipMask, step(0.5, base)),
      mix(pointedTipMask, concaveTipMask, step(2.5, base)),
      step(1.5, base)
    );
    float lensAngle = vLensAngle - uFlareRotation;
    float broadArc = 0.5 + 0.5 * sin(lensAngle * 13.0 - uTime * 0.16);
    float fineArc = 0.5 + 0.5 * sin(lensAngle * 29.0 + uTime * 0.11 + 1.7);
    float flareShape = pow(broadArc, 5.0) * 0.82 + pow(fineArc, 11.0) * 0.18;
    float lensLighting =
      pow(max(cos(lensAngle - 0.78), 0.0), 8.0) +
      pow(max(cos(lensAngle + 2.18), 0.0), 12.0) * 0.82 +
      pow(max(cos(lensAngle - 2.72), 0.0), 18.0) * 0.42 +
      pow(max(cos(lensAngle * 3.0 + 0.64), 0.0), 22.0) *
        (0.6 + fineArc * 0.4) *
        0.46 +
      flareShape * 0.08;
    float toothMask = min(roundedOuterCap + pillBody + tipMask, 1.0);
    float intensity =
      toothMask *
      (0.012 + lensLighting * 0.19);

    if (intensity <= 0.001) discard;

    gl_FragColor = vec4(
      uForeground,
      clamp(intensity * uApertureContrast, 0.0, 1.0) * uOpacity
    );
  }
`})))()}function pt({className:e,disableAnimation:t=!1,disableRendering:r=!1}){let i=(0,Q.useRef)(null),a=n()===!0;return(0,Q.useEffect)(()=>{if(r)return;let e=i.current;if(e==null)return;let n=e.getContext(`webgl2`,{alpha:!0,antialias:!0,powerPreference:`low-power`});if(n==null)return;let o=new vt(e,n);return o.start(!a&&!t),()=>o.dispose()},[t,r,a]),(0,mt.jsx)(`canvas`,{ref:i,"aria-hidden":`true`,className:e})}var Q,mt,ht,gt,_t,$,vt;function yt(){return(yt=e((()=>{r(),Q=t(),_(),$e(),at(),ft(),mt=i(),ht=1e3/30,gt=150,_t=56e3,$=39,vt=class{canvas;animationFrame=null;camera=new h($,1,.1,100);elapsedSeconds=0;geometryIsCompact=null;geometryResizeTimeout=null;geometryViewport=new l;lastFrameTime=0;notch=null;particleMaterial;particles=null;pointer=new l;renderer;resizeObserver=null;scene=new m;targetPointer=new l;themeObserver=null;viewport=new l;aperture=null;constructor(e,t){this.canvas=e,this.renderer=new d({alpha:!0,antialias:!0,canvas:e,context:t,powerPreference:`low-power`}),this.renderer.setClearColor(0,0),this.camera.position.z=10,this.particleMaterial=new f({blending:1,depthWrite:!1,fragmentShader:st,transparent:!0,uniforms:{uApertureRadius:{value:0},uContrast:{value:2},uFocusBokeh:{value:1.5},uForeground:{value:new v},uIntroOpacity:{value:1},uMotion:{value:1},uPixelRatio:{value:1},uPointSize:{value:2.92},uPointer:{value:this.pointer},uTime:{value:0},uViewport:{value:this.viewport}},vertexShader:ot})}start(e){this.particleMaterial.uniforms.uMotion.value=+!!e,this.resize(),this.applyFocusState(0,!e),typeof ResizeObserver<`u`&&(this.resizeObserver=new ResizeObserver(this.resize),this.resizeObserver.observe(this.canvas)),typeof MutationObserver<`u`&&(this.themeObserver=new MutationObserver(this.refreshForeground),this.themeObserver.observe(document.documentElement,{attributeFilter:[`class`,`data-theme`,`style`],attributes:!0}),this.themeObserver.observe(this.canvas,{attributeFilter:[`class`,`style`],attributes:!0})),e&&(window.addEventListener(`pointermove`,this.handlePointerMove,{passive:!0}),window.addEventListener(`pointerleave`,this.handlePointerLeave),document.addEventListener(`visibilitychange`,this.handleVisibility),this.animationFrame=window.requestAnimationFrame(this.animate))}dispose(){this.animationFrame!=null&&window.cancelAnimationFrame(this.animationFrame),this.geometryResizeTimeout!=null&&window.clearTimeout(this.geometryResizeTimeout),this.resizeObserver?.disconnect(),this.themeObserver?.disconnect(),window.removeEventListener(`pointermove`,this.handlePointerMove),window.removeEventListener(`pointerleave`,this.handlePointerLeave),document.removeEventListener(`visibilitychange`,this.handleVisibility),this.particles?.geometry.dispose(),this.particleMaterial.dispose(),this.disposeAperture(),this.renderer.dispose()}resize=()=>{let e=this.canvas.clientWidth,t=this.canvas.clientHeight;if(e===0||t===0)return;let n=Math.min(window.devicePixelRatio||1,1.75);this.camera.aspect=e/t,this.camera.updateProjectionMatrix(),this.renderer.setPixelRatio(n),this.renderer.setSize(e,t,!1);let r=2*Math.tan(g.degToRad($/2))*10,i=r*this.camera.aspect;this.viewport.set(i,r),this.particleMaterial.uniforms.uPixelRatio.value=n;let a={height:r,width:i},o=e<920;if(this.geometryIsCompact===o&&this.geometryViewport.x===a.width&&this.geometryViewport.y===a.height){this.geometryResizeTimeout!=null&&(window.clearTimeout(this.geometryResizeTimeout),this.geometryResizeTimeout=null),this.renderer.render(this.scene,this.camera);return}if(this.particles==null){this.rebuildGeometry(o,a);return}this.geometryResizeTimeout!=null&&window.clearTimeout(this.geometryResizeTimeout),this.geometryResizeTimeout=window.setTimeout(()=>{this.geometryResizeTimeout=null,this.rebuildGeometry(o,a)},gt),this.renderer.render(this.scene,this.camera)};rebuildGeometry(e,t){let n=ae(e,t),r=n.backbones+n.bonds+n.motes,i=Math.min(1,_t/r),o=se({backbones:Math.floor(n.backbones*i),bonds:Math.floor(n.bonds*i),motes:Math.floor(n.motes*i)},t),c=new s;c.setAttribute(`position`,new u(o.positions,3)),c.setAttribute(`aCenterlinePosition`,new u(o.centerlinePositions,3)),c.setAttribute(`aKind`,new u(o.kinds,1)),c.setAttribute(`aLayerOpacity`,new u(o.layerOpacities,1)),c.setAttribute(`aScale`,new u(o.scales,1)),c.setAttribute(`aSeed`,new u(o.seeds,1)),c.setAttribute(`aStrandPhase`,new u(o.strandPhases,1)),c.setAttribute(`aTangentDirection`,new u(o.tangentDirections,3)),c.setAttribute(`aFlowDirection`,new u(o.flowDirections,2)),this.particles!=null&&(this.scene.remove(this.particles),this.particles.geometry.dispose()),this.particles=new a(c,this.particleMaterial),this.particles.frustumCulled=!1,this.scene.add(this.particles),this.particleMaterial.uniforms.uApertureRadius.value=o.apertureRadius,this.createAperture(o.apertureRadius),this.applyFocusState(this.elapsedSeconds,this.particleMaterial.uniforms.uMotion.value===0),this.refreshForeground(),this.geometryIsCompact=e,this.geometryViewport.set(t.width,t.height)}createAperture(e){this.disposeAperture();let t={uApertureContrast:{value:1.85},uApertureRadius:{value:e},uForeground:{value:new v},uOpacity:{value:1},uTime:{value:0}};this.aperture=new c(new p(Math.max(.01,e-.72),e+.72,192),new f({blending:1,depthWrite:!1,fragmentShader:lt,transparent:!0,uniforms:{...t,uCoronaIntensityScale:{value:1.18},uCoronaSizeScale:{value:1}},vertexShader:ct})),this.aperture.position.z=.04,this.aperture.renderOrder=1,this.scene.add(this.aperture),this.notch=new c(new p(Math.max(.01,e-.385),Math.max(.02,e-.068),288),new f({blending:1,depthWrite:!1,fragmentShader:dt,transparent:!0,uniforms:{...t,uFlareRotation:{value:0}},vertexShader:ut})),this.notch.position.z=.045,this.notch.renderOrder=2,this.scene.add(this.notch)}disposeAperture(){for(let e of[this.aperture,this.notch])e!=null&&(this.scene.remove(e),e.geometry.dispose(),e.material instanceof o&&e.material.dispose());this.aperture=null,this.notch=null}refreshForeground=()=>{let e=new v(window.getComputedStyle(this.canvas).color),t=this.particleMaterial.uniforms.uForeground.value;t instanceof v&&t.copy(e);let n=(e.r+e.g+e.b)/3>.5,r=n?2:1;this.particleMaterial.uniforms.uContrast.value=n?2:1.65,this.particleMaterial.blending!==r&&(this.particleMaterial.blending=r,this.particleMaterial.needsUpdate=!0);for(let t of[this.aperture,this.notch])if(t?.material instanceof f){let i=t.material.uniforms.uForeground.value;i instanceof v&&i.copy(e),t.material.uniforms.uApertureContrast.value=n?1.85:1.25,t.material.blending!==r&&(t.material.blending=r,t.material.needsUpdate=!0)}this.renderer.render(this.scene,this.camera)};animate=e=>{if(document.visibilityState===`hidden`){this.animationFrame=null,this.lastFrameTime=0;return}if(e-this.lastFrameTime>=ht){this.lastFrameTime!==0&&(this.elapsedSeconds+=Math.min((e-this.lastFrameTime)/1e3,.1)),this.lastFrameTime=e,this.pointer.lerp(this.targetPointer,.065);let t=this.elapsedSeconds;this.particleMaterial.uniforms.uTime.value=t,this.applyFocusState(t,!1);for(let e of[this.aperture,this.notch])e?.material instanceof f&&(e.material.uniforms.uTime.value=t);this.renderer.render(this.scene,this.camera)}this.animationFrame=window.requestAnimationFrame(this.animate)};applyFocusState(e,t){let n=et(e,t);if(this.particleMaterial.uniforms.uIntroOpacity.value=n.opacity,this.particleMaterial.uniforms.uFocusBokeh.value=n.bokehScale,this.camera.fov!==n.cameraFov&&(this.camera.fov=n.cameraFov,this.camera.updateProjectionMatrix()),this.aperture!=null&&(this.aperture.rotation.z=n.dialRotation),this.notch!=null){let t=Math.max(0,e-Y)*-.1;this.notch.rotation.z=n.dialRotation*18+t}for(let e of[this.aperture,this.notch])e?.material instanceof f&&(e.material.uniforms.uOpacity.value=n.opacity);this.notch?.material instanceof f&&(this.notch.material.uniforms.uFlareRotation.value=n.dialRotation)}handlePointerMove=e=>{let t=this.canvas.getBoundingClientRect();this.targetPointer.set((e.clientX-t.left)/Math.max(t.width,1)*2-1,1-(e.clientY-t.top)/Math.max(t.height,1)*2)};handlePointerLeave=()=>{this.targetPointer.set(0,0)};handleVisibility=()=>{document.visibilityState!==`hidden`&&this.animationFrame==null&&(this.animationFrame=window.requestAnimationFrame(this.animate))}}})))()}function bt(){return(bt=e((()=>{yt()})))()}bt();export{pt as LifeSciencesHelixBackground};
//# sourceMappingURL=rosalind-helix-ec27a5d31a52.js.map