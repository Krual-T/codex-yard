import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t,n,r,i,a;function o(){return(o=e((()=>{t=`
uniform float uHover;
uniform float uDrop;
uniform float uCurl;
uniform vec2 uAnchor;
uniform vec2 uTilt;

uniform float uApplicationRelease;
uniform vec2 uGripAnchor;
uniform vec2 uArtworkAspect;
uniform vec2 uGripMotion;
uniform float uGripPresence;

varying vec2 vUv;
varying float vFaceLight;
varying float vSpecular;
varying float vViewFacing;

void main() {
  vUv = uv;

  vec3 p = position;
  float drop = clamp(uDrop, 0.0, 1.0);
  float tracking = 1.0 - smoothstep(0.0, 0.04, drop);
  float dist = distance(uv, uAnchor);
  float centerDist = distance(uv, vec2(0.5));
  float edge = smoothstep(0.22, 0.72, centerDist);
  float topLead = (uv.y - 0.5) * 0.483;
  float bottomLag = 1.0 - uv.y;
  float anchorContact = (1.0 - smoothstep(0.0, 0.26, dist)) * 0.24;

  float localProgress = clamp(drop * 1.26 + topLead + anchorContact - dist * 0.184 - bottomLag * 0.046, 0.0, 1.0);
  localProgress = localProgress * localProgress * (3.0 - 2.0 * localProgress);
  float remainingHeight = uHover * (1.0 - localProgress);

  vec2 fromAnchor = uv - uAnchor;
  vec2 direction = normalize(fromAnchor + vec2(0.0001));
  float foldWave = sin((1.0 - localProgress) * 3.14159265);
  float fold = uCurl * foldWave * (0.228 + edge * 0.531 + bottomLag * 0.531);
  float dimple = anchorContact * (1.0 - drop) * 11.385;
  float ripple = sin((dist + bottomLag * 0.32) * 15.0) * 1.898 * (1.0 - drop) * drop;

  float horizontalBank = clamp(-position.x * uTilt.x * 0.095, -34.0, 34.0);
  float verticalLift = clamp(position.y * uTilt.y * 0.074, -38.0, 38.0);
  float trackingBend = horizontalBank + verticalLift;
  vec2 trailingOffset = vec2(
    -uTilt.x * (8.0 + edge * 7.0),
    uTilt.y * (3.0 + edge * 4.0)
  );
  vec2 dropWarp = direction * fold * 8.855 * (1.0 - localProgress);
  vec2 trailWarp = vec2(0.0, -bottomLag * fold * 10.12 * (1.0 - localProgress));

  p.z += mix(remainingHeight + fold * 48.07 + ripple - dimple, uHover + trackingBend, tracking);
  p.xy += mix(dropWarp + trailWarp, trailingOffset, tracking);
  p.xy += direction * (1.0 - localProgress) * drop * 5.06;

  float applicationBlend = clamp(uApplicationRelease, 0.0, 1.0);
  // Saved application: the bottom edge sticks first.
  vec2 applicationDirection = vec2(0.0, 1.0);
  vec2 applicationAspect = max(uArtworkAspect, vec2(0.000001));
  float applicationSpan = abs(applicationDirection.x) + abs(applicationDirection.y);
  vec2 applicationCenter = uv - vec2(0.5);
  float applicationAlong = dot(applicationCenter, applicationDirection);
  float applicationRow = 0.5 + applicationAlong / applicationSpan;
  float applicationWidth = 1.0;
  float applicationDrop = drop;
  float applicationWaveFront = applicationDrop * (1.0 + applicationWidth) - applicationWidth * 0.5;
  float applicationT = clamp((applicationWaveFront - applicationRow + applicationWidth * 0.5) / applicationWidth, 0.0, 1.0);
  float applicationContact = applicationT * applicationT * (3.0 - 2.0 * applicationT);
  if (drop >= 1.0) applicationContact = 1.0;
  float applicationCrest = applicationContact > 0.0 && applicationContact < 1.0
    ? sin(applicationContact * 3.14159265) : 0.0;
  float applicationFold = max(uCurl, 0.0) * 0.8;
  float applicationHeight = 48.07 * applicationFold;
  float applicationLift = max(max(uHover, 0.0), applicationHeight * 0.2);
  // Expansion is centered across the fold. There is no along-wave drag warp.
  float applicationBow = 0.12 * 0.5 * applicationCrest;
  // Retain the saved perspective expansion across the broad application wave.
  float applicationSize = min(0.09 * 1.2, 0.45 * applicationWidth);
  float applicationPendingSize = applicationSize * (1.0 - applicationContact);
  vec2 applicationLateral = applicationCenter - applicationDirection * applicationAlong;
  vec3 applicationPosition = position;
  applicationPosition.xy += 279.0 * applicationAspect * (applicationCenter * applicationPendingSize + applicationLateral * applicationBow);
  applicationPosition.z += applicationLift * (1.0 - applicationContact) + applicationHeight * applicationCrest;
  if (drop >= 1.0) applicationPosition = position;

  float applicationContactSlope = -6.0 * applicationT * (1.0 - applicationT) / applicationWidth;
  float applicationHeightSlope = (applicationHeight * 3.14159265 * cos(applicationContact * 3.14159265) - applicationLift) * applicationContactSlope;
  vec2 applicationSlope = 1.45 * applicationHeightSlope * applicationDirection / (applicationSpan * 279.0 * applicationAspect);
  if (drop >= 1.0) applicationSlope = vec2(0.0);
  if (applicationBlend > 0.0) {
    p = mix(p, applicationPosition, applicationBlend);
    fold = mix(fold, applicationFold * applicationCrest, applicationBlend);
  }

  vec2 gripAnchor = clamp(uGripAnchor, vec2(0.0), vec2(1.0));
  vec2 gripMotion = uGripMotion / max(1.0, length(uGripMotion));
  float gripStrength = 0.8 * clamp(uGripPresence, 0.0, 1.0);
  if (gripStrength > 0.0 && dot(gripMotion, gripMotion) > 0.0) {
    vec2 gripDelta = uv - gripAnchor;
    float gripDistanceSquared = dot(gripDelta, gripDelta);
    float gripLoose = gripDistanceSquared / (1.0 + gripDistanceSquared);
    // The loose sheet trails the grip. Reversing motion compresses the same
    // region that was stretched, while displacement at the grip stays zero.
    p.xy -= 72.0 * gripMotion * gripLoose * gripStrength * uArtworkAspect;
    float gripCompression = dot(gripDelta, gripMotion) / sqrt(1.0 + gripDistanceSquared);
    float gripBend = 0.65 * gripCompression + 0.35 * abs(gripCompression);
    float gripDepth = min(50.0, max(uHover, 0.0) * 0.6);
    p.z += gripDepth * gripLoose * gripBend * gripStrength * min(uArtworkAspect.x, uArtworkAspect.y);
  }

  float slopeX = clamp(uTilt.x * 0.9 + fold * direction.x * 0.38, -1.0, 1.0);
  float slopeY = clamp(uTilt.y * 0.9 + fold * direction.y * 0.38, -1.0, 1.0);
  if (applicationBlend > 0.0) {
    slopeX = mix(slopeX, clamp(applicationSlope.x, -1.0, 1.0), applicationBlend);
    slopeY = mix(slopeY, clamp(applicationSlope.y, -1.0, 1.0), applicationBlend);
  }
  vec3 normal = normalize(vec3(-slopeX, -slopeY, 1.45));
  vec3 lightDir = normalize(vec3(-0.55, 0.7, 1.0));
  vFaceLight = dot(normal, lightDir);
  vSpecular = pow(max(dot(reflect(-lightDir, normal), vec3(0.0, 0.0, 1.0)), 0.0), 5.0);
  vViewFacing = clamp(normal.z, 0.0, 1.0);

  vec4 applicationViewPosition = modelViewMatrix * vec4(p, 1.0);
  if (applicationBlend > 0.0) {
    vec4 applicationViewCenter = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    // Cancel off-axis drift while keeping perspective about the sticker center.
    if (abs(applicationViewCenter.z) > 0.000001) {
      applicationViewPosition.xy += applicationBlend * applicationViewCenter.xy
        * (applicationViewPosition.z - applicationViewCenter.z) / applicationViewCenter.z;
    }
  }

  gl_Position = applicationBlend > 0.0
    ? projectionMatrix * applicationViewPosition
    : projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`,n=`
uniform float uApplicationRelease;
uniform sampler2D uTexture;
uniform vec2 uTilt;
uniform float uDrop;
uniform float uHighlightMotion;
uniform float uIdlePrismOpacity;

varying vec2 vUv;
varying float vFaceLight;
varying float vSpecular;
varying float vViewFacing;

vec3 hologram(float t) {
  vec3 a = 0.5 + 0.5 * cos(6.2831853 * (t + vec3(0.0, 0.33, 0.67)));
  vec3 b = 0.5 + 0.5 * cos(6.2831853 * (t * 1.37 + vec3(0.62, 0.08, 0.39)));
  return mix(a, b, 0.42);
}

void main() {
  vec4 texel = texture2D(uTexture, vUv);
  texel.rgb = mix(vec3(1.0), texel.rgb, smoothstep(0.12, 0.72, texel.a));
  float finalAlpha = texel.a;

  if (finalAlpha < 0.025) {
    discard;
  }

  vec3 color = texel.rgb;
  vec2 centered = vUv - 0.5;
  float motion = clamp(uHighlightMotion, 0.0, 1.0);
  float drop = clamp(uDrop, 0.0, 1.0);
  float dropPulse = sin(drop * 3.14159265);
  float alphaMask = smoothstep(0.06, 0.5, texel.a);
  float landingStrength = mix(1.0, 0.2, clamp(uApplicationRelease, 0.0, 1.0));
  float motionActivity = smoothstep(0.06, 0.82, motion) * 0.9;
  motionActivity *= landingStrength;
  float dropActivity = smoothstep(0.12, 0.88, dropPulse) * 1.21;
  dropActivity *= landingStrength;
  float activity = clamp(1.0 - (1.0 - motionActivity) * (1.0 - dropActivity), 0.0, 1.0);
  activity = activity * activity * (3.0 - 2.0 * activity);
  float highlightStrength = alphaMask * activity;
  float motionHighlight = alphaMask * motionActivity;
  float dropHighlight = alphaMask * dropActivity;
  float faceLight = smoothstep(0.18, 0.92, vFaceLight);
  float fresnel = pow(1.0 - clamp(vViewFacing, 0.0, 1.0), 2.0);
  float broadSheen = faceLight * (0.55 + 0.45 * smoothstep(-0.6, 0.82, centered.y * 0.7 - centered.x * 0.35));
  float specular = vSpecular * (0.74 + fresnel * 0.46);
  float prismAngleShift = clamp(uTilt.x * 0.55 - uTilt.y * 0.34 + (vFaceLight - 0.45) * 0.38, -0.95, 0.95);
  vec2 prismDir = normalize(vec2(1.0 + prismAngleShift * 0.48, -1.0 + prismAngleShift * 0.72));
  float prismCoord = dot(centered, prismDir);
  float prismWave = sin(prismCoord * 5.15 + faceLight * 1.02 + uTilt.x * 0.72 - uTilt.y * 0.48) * 0.5 + 0.5;
  float prismBand = smoothstep(-0.06, 0.82, prismWave);
  vec3 holo = hologram(vFaceLight * 0.32 + prismCoord * 0.62 + uTilt.x * 0.15 - uTilt.y * 0.12);
  vec3 saturatedHolo = clamp((holo - vec3(0.5)) * 1.38 + vec3(0.5), 0.0, 1.0);
  vec3 holoGlow = mix(saturatedHolo, vec3(1.0), 0.14);
  vec3 coolHolo = mix(saturatedHolo, vec3(0.68, 0.92, 1.0), 0.08);
  float idlePrismStrength = alphaMask * prismBand * broadSheen * 0.026 * uIdlePrismOpacity;
  idlePrismStrength *= landingStrength;
  float motionHoloStrength = motionHighlight * (fresnel * 0.085 + prismBand * broadSheen * 0.172);
  float dropHoloStrength = dropHighlight * (specular * 0.12 + fresnel * 0.055 + prismBand * broadSheen * 0.073);
  color += texel.rgb * broadSheen * highlightStrength * 0.05;
  color += vec3(1.0, 0.98, 0.9) * specular * (motionHighlight * 0.075 + dropHighlight * 0.2);
  color += holoGlow * idlePrismStrength;
  color += holoGlow * (motionHoloStrength + dropHoloStrength);
  color += coolHolo * prismBand * broadSheen * highlightStrength * 0.056;
  color += vec3(1.0) * fresnel * highlightStrength * 0.11 * 0.61;
  color = min(color, vec3(1.0));

  gl_FragColor = vec4(color, finalAlpha);
  #include <colorspace_fragment>
}
`,r=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,i=`
uniform sampler2D uSoftShadow;
uniform sampler2D uContactShadow;
uniform float uOpacity;
uniform float uDrop;
varying vec2 vUv;
void main() {
  float contactMix = smoothstep(0.62, 1.0, clamp(uDrop, 0.0, 1.0));
  float alpha = mix(texture2D(uSoftShadow, vUv).a, texture2D(uContactShadow, vUv).a, contactMix);
  float finalAlpha = alpha * uOpacity;
  if (finalAlpha < 0.004) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, finalAlpha);
}
`,a=class{value;target;velocity;config;constructor(e,t){this.value=e,this.target=e,this.velocity=0,this.config=t}setTarget(e,t=this.velocity){this.target=e,this.velocity=t}jump(e){this.value=e,this.target=e,this.velocity=0}step(e){let t=Math.min(e,1/30),{stiffness:n,damping:r,mass:i}=this.config,a=(-n*(this.value-this.target)+-r*this.velocity)/i;this.velocity+=a*t,this.value+=this.velocity*t}}})))()}o();export{a as Spring,i as shadowFragmentShader,r as shadowVertexShader,n as stickerFragmentShader,t as stickerVertexShader};
//# sourceMappingURL=motion-shaders-4bcaa4568c8b.js.map