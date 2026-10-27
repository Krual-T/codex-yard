import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";import{XEt as t,YEt as n}from"./app-initial-a68277f60b93.js";function r(e){return Math.min(Math.max(e,0),.1)}function i(e,t,n,r,i=d.speakingSpringFrequency,a=d.speakingSpringDampingRatio){let o=2*Math.PI*i,s=o*o,c=2*a*o,l=Math.max(1,Math.ceil(r/(1/120))),u=r/l,f=e,p=t;for(let e=0;e<l;e+=1){let e=(n-f)*s-p*c;p+=e*u,f+=p*u}return{value:f,velocity:p}}function a(){return{speakingSpeedDrive:0,speakingBoost:0,speakingVelocity:0,waveAmplitude:1,textureEdgeWarp:0,textureEdgeWarpVelocity:0,textureFlowBoost:0,speakingWatercolorAudio:[0,0,0],speakingWatercolorPhase:[0,2.1,4.2]}}function o(){return{waveMotionSpeed:1,waveAmplitude:1,textureEdgeWarp:0,listeningTextureNoiseScale:1,textureFlowSpeed:1,speakingWatercolorOffsets:[[0,0],[0,0],[0,0]]}}function s(e){return u(e.userSpeakingScale)*u(e.micLevel)}function c(e){return(1-Math.exp(-u(e.assistantWaveformLevel)*4))**1.15}function l(e,t,n,r,i){let a=t>e?r:i,o=1-Math.exp(-n/a);return e+(t-e)*o}function u(e,t=0,n=1){return Math.min(Math.max(e,t),n)}var d,f,p,m;function h(){return(h=e((()=>{d={textureEdgeWarpSpringFrequency:7,textureEdgeWarpSpringDampingRatio:.36,speakingTextureFlowSpeedScale:.96,textureFlowAttackDuration:.055,textureFlowReleaseDuration:.16,speakingWatercolorDriftAttackDuration:.07,speakingWatercolorDriftReleaseDuration:.22,minimumWaveMotionSpeed:.72,speakingWaveSpeedScale:.56,speakingSpeedBase:1.8,speakingSlowEnergyScale:4.6,speakingTransientAccentScale:.5,speakingSpeedAttackDuration:.045,speakingSpeedReleaseDuration:.14,speakingSpringFrequency:6,speakingSpringDampingRatio:.76,speakingWaveAmplitude:1.5,speakingWaveAmplitudeAttackDuration:.1,speakingWaveAmplitudeReleaseDuration:.28,speakingWatercolorDriftScale:.1,speakingWatercolorWindScale:.3,speakingWatercolorWindSpeed:.65,listeningTextureEdgeWarpDistance:.102,listeningTextureNoiseScale:2.2},f=[.72,1,1.28],p={stateListen:0,stateSpeak:0,userSpeakingScale:0,assistantWaveformLevel:0,assistantMotionLevel:0,assistantMotionAccent:0,cumulativeAudio:[0,0,0,0],micLevel:0},m=class{#e;#t;#n;constructor(e=d){this.#e=e,this.#n=a(),this.#t=o()}initialOutput(){return this.#t}update(e=p,t){let n=c(e),r=this.#r(e,t,n),i=this.#i(t,n),a=s(e),o=this.#a(t,a),l=this.#o(a),u=this.#s(e,t),d=this.#c(e,t);return this.#t.waveMotionSpeed=r,this.#t.waveAmplitude=i,this.#t.textureEdgeWarp=o,this.#t.listeningTextureNoiseScale=l,this.#t.textureFlowSpeed=u,this.#t.speakingWatercolorOffsets=d,this.#t}#r(e,t,n){let r=u(Math.max(...e.cumulativeAudio)/12);this.#n.speakingSpeedDrive=l(this.#n.speakingSpeedDrive,n,t,this.#e.speakingSpeedAttackDuration,this.#e.speakingSpeedReleaseDuration);let a=this.#n.speakingSpeedDrive*this.#e.speakingWaveSpeedScale*(this.#e.speakingSpeedBase+Math.max(e.assistantMotionLevel,r)*this.#e.speakingSlowEnergyScale+e.assistantMotionAccent*this.#e.speakingTransientAccentScale),o=i(this.#n.speakingBoost,this.#n.speakingVelocity,a,t,this.#e.speakingSpringFrequency,this.#e.speakingSpringDampingRatio);return this.#n.speakingBoost=o.value,this.#n.speakingVelocity=o.velocity,Math.max(this.#e.minimumWaveMotionSpeed,1+this.#n.speakingBoost)}#i(e,t){let n=1-t*(1-this.#e.speakingWaveAmplitude);return this.#n.waveAmplitude=l(this.#n.waveAmplitude,n,e,this.#e.speakingWaveAmplitudeAttackDuration,this.#e.speakingWaveAmplitudeReleaseDuration),this.#n.waveAmplitude}#a(e,t){let n=t*this.#e.listeningTextureEdgeWarpDistance,r=i(this.#n.textureEdgeWarp,this.#n.textureEdgeWarpVelocity,n,e,this.#e.textureEdgeWarpSpringFrequency,this.#e.textureEdgeWarpSpringDampingRatio);return this.#n.textureEdgeWarp=r.value,this.#n.textureEdgeWarpVelocity=r.velocity,this.#n.textureEdgeWarp}#o(e){return 1+e*(this.#e.listeningTextureNoiseScale-1)}#s(e,t){let n=u(Math.max(...e.cumulativeAudio)/12),r=Math.max(e.assistantMotionLevel,n)*this.#e.speakingTextureFlowSpeedScale;return this.#n.textureFlowBoost=l(this.#n.textureFlowBoost,r,t,this.#e.textureFlowAttackDuration,this.#e.textureFlowReleaseDuration),1+this.#n.textureFlowBoost}#c(e,t){let n=this.#n.speakingWatercolorAudio;for(let r=0;r<n.length;r+=1)n[r]=l(n[r],u((e.cumulativeAudio[r]??0)/12),t,this.#e.speakingWatercolorDriftAttackDuration,this.#e.speakingWatercolorDriftReleaseDuration);let[r,i,a]=n;if(u((e.cumulativeAudio[0]??0)/12)>0||u((e.cumulativeAudio[1]??0)/12)>0||u((e.cumulativeAudio[2]??0)/12)>0){let e=this.#n.speakingWatercolorPhase;for(let r=0;r<e.length;r+=1)e[r]+=t*this.#e.speakingWatercolorWindSpeed*f[r]*(1+n[r]*1.5)}let[o,s,c]=this.#n.speakingWatercolorPhase,d=this.#e.speakingWatercolorDriftScale,p=this.#e.speakingWatercolorWindScale,m=this.#t.speakingWatercolorOffsets;return m[0][0]=r*d+Math.sin(o)*r*p,m[0][1]=-i*d*.55+Math.cos(o*.82)*i*p*.65,m[1][0]=-i*d*.75+Math.cos(s*.91)*i*p*.8,m[1][1]=a*d+Math.sin(s)*a*p,m[2][0]=a*d*1.1+Math.sin(c*1.07)*a*p*1.1,m[2][1]=r*d*.7+Math.cos(c)*r*p*.75,m}}})))()}var g,_,v,y,b,x,S,C;function w(){return(w=e((()=>{g=.25,_=3,v=28,y=55,b=200,x=1.1,S=.65,C=class{#e=S;#t;#n;#r=!1;#i;#a=`down`;#o;#s;constructor(){document.addEventListener(`visibilitychange`,this.#c)}get scale(){return this.#e}recordFrame(e){this.#s?.(e)}update(e,t,n){let r=e!==this.#t||t!==this.#n;(r||n!==this.#r)&&(this.#f(),this.#t=e,this.#n=t,this.#r=n,r&&(this.#e=S),n&&!document.hidden&&this.#l())}dispose(){this.#f(),document.removeEventListener(`visibilitychange`,this.#c)}#c=()=>{this.#f(),!document.hidden&&this.#r&&this.#l()};#l(){this.#i=void 0,this.#a=`down`,this.#u()}#u(){this.#o=window.setTimeout(this.#d,b)}#d=()=>{this.#o=void 0;let e=this.#a===`up`?_:g,t=0,n,r=r=>{if(n??=r,r-n<e*1e3){t+=1;return}this.#s=void 0;let i=Math.floor(t/e);if(i<v){this.#a=`down`;let e=Math.max(i,1);this.#e*=Math.sqrt(e/v),this.#u()}else if(this.#i!=null||this.#e<S){let e=i>=y,t=this.#i!=null&&i>=this.#i*x;if(e||t){let e=Math.min(this.#e*x,S);e>this.#e&&(this.#a=`up`,this.#e=e,this.#u())}else i<y&&(this.#a=`down`,this.#e*=Math.sqrt(i/y))}this.#i=i};this.#s=r};#f(){window.clearTimeout(this.#o),this.#o=void 0,this.#s=void 0}}})))()}var T;function E(){return(E=e((()=>{T=`#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vSdfPosition;

uniform sampler2D uInteriorTexture;
uniform float uBaseShaderFrame;
uniform float uMicLevel;
uniform float uSurfaceScale;
uniform float uUserSpeakingScale;
uniform float uConnectionRevealAmount;
uniform float uPreConnectionDotVisibility;
uniform vec4 uPreConnectionDotColor;

out vec4 fragColor;

const float USER_SPEAKING_BASE_SCALE_REDUCTION = 0.14;
const float USER_SPEAKING_MIC_PULSE_SCALE = 0.08;
const float MIN_HORIZON_ORB_SCALE = 0.75;
// uBaseShaderFrame advances at this rate in horizon-canvas.tsx.
const float PRE_CONNECTION_DOT_FRAME_RATE = 24.0;
const float PRE_CONNECTION_DOT_BASE_RADIUS = 0.1;
const float PRE_CONNECTION_DOT_RADIUS_PULSE_SCALE = 0.04;
const float PRE_CONNECTION_DOT_RADIUS_PERIOD_SECONDS = 0.7;

float preConnectionDotRadius(float frame) {
  float timeSeconds = frame / PRE_CONNECTION_DOT_FRAME_RATE;
  float pulse =
    sin(2.0 * 3.14159265 * timeSeconds / PRE_CONNECTION_DOT_RADIUS_PERIOD_SECONDS);

  return PRE_CONNECTION_DOT_BASE_RADIUS *
    (1.0 + PRE_CONNECTION_DOT_RADIUS_PULSE_SCALE * pulse);
}

float connectionRevealScale(float frame) {
  float revealAmount = clamp(uConnectionRevealAmount, 0.0, 1.0);
  float easedReveal = revealAmount * revealAmount * (3.0 - 2.0 * revealAmount);

  return mix(preConnectionDotRadius(frame), 1.0, easedReveal);
}

float horizonOrbScale(float frame) {
  float userSpeaking = clamp(uUserSpeakingScale, 0.0, 1.0);
  float micLevel = clamp(uMicLevel, 0.0, 1.0);
  float baseScale = 1.0 - userSpeaking * USER_SPEAKING_BASE_SCALE_REDUCTION;
  float pulseScale = userSpeaking * micLevel * USER_SPEAKING_MIC_PULSE_SCALE;
  float voiceScale = max(baseScale + pulseScale, MIN_HORIZON_ORB_SCALE);

  return voiceScale * uSurfaceScale * connectionRevealScale(frame);
}

vec4 renderPreConnectionDot(vec2 sdfPosition, float frame) {
  float dotDistance = length(sdfPosition) - preConnectionDotRadius(frame);
  // The launch dot intentionally uses a hard full-resolution edge.
  float dotShape = 1.0 - step(0.0, dotDistance);

  return uPreConnectionDotColor * dotShape;
}

void main() {
  float frame = uBaseShaderFrame;

  // The launch state does not need the procedural interior at all.
  if (uPreConnectionDotVisibility >= 1.0) {
    fragColor = renderPreConnectionDot(vSdfPosition, frame);
    return;
  }

  float orbScale = horizonOrbScale(frame);
  vec2 scaledSdfPosition = vSdfPosition / orbScale;
  float sdfDistance = length(scaledSdfPosition) - 1.0;
  float edgeWidth = max(fwidth(sdfDistance), 0.000001);

  if (sdfDistance >= edgeWidth * 2.0) {
    fragColor = vec4(0.0);
    return;
  }

  vec2 interiorUv = scaledSdfPosition * 0.5 + 0.5;
  vec3 interiorColor = texture(uInteriorTexture, interiorUv).rgb;
  float shape = 1.0 - smoothstep(
    -edgeWidth,
    edgeWidth,
    sdfDistance + edgeWidth * 0.5
  );

  // GLCanvas uses premultiplied alpha, so only the cheap full-resolution pass
  // owns edge coverage.
  fragColor = vec4(interiorColor * shape, shape);
}
`})))()}var D;function ee(){return(ee=e((()=>{D=`#version 300 es
in vec2 aPosition;
out vec2 vSdfPosition;

void main() {
  vSdfPosition = aPosition;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`})))()}var te;function ne(){return(ne=e((()=>{te=`#version 300 es
// Faithful WebGL 2 port of the Super Assistant production Horizon material:
// https://github.com/openai/superassistant/pull/71592
// Noise and cellular cost reductions ported from:
// https://github.com/openai/openai/blob/eb313da633fabbe58c01c659c5e19149f439f927/chatgpt/web/src/voice/components/voice-mode-visualizer/horizon-visualizer/shaders/horizon.frag
// Runtime shape and Codex scaling remain
// owned by the separate full-resolution composite.

precision highp float;
precision highp int;
precision highp sampler2D;

in vec3 vGenerated;

uniform sampler2D uImage_0;

// BEGIN EDITABLE HORIZON MATERIAL
// Numeric sRGB accents are blended directly, matching the native Horizon material.
struct HorizonPalette {
  vec4 shadowColor;
  vec4 midLowColor;
  vec4 midHighColor;
  vec4 highlightColor;
};

const float materialShadowBrightness = 0.9465623;
const float materialMidLowBrightness = 0.89882153;
const float materialMidHighBrightness = 1.0;
const float materialHighlightBrightness = 0.63704175;

HorizonPalette materialPaletteForAccent(vec3 accent) {
  // Lift the black accent before blending so its darkest regions remain gray.
  if (all(equal(accent, vec3(0.0)))) {
    accent = vec3(0.08);
  }
  vec3 softLightCurve = mix(
    ((16.0 * accent - 12.0) * accent + 4.0) * accent,
    sqrt(accent),
    greaterThan(accent, vec3(0.25))
  );
  return HorizonPalette(
    vec4(max(vec3(0.0), accent + materialShadowBrightness - 1.0), 1.0),
    vec4(accent + (2.0 * materialMidLowBrightness - 1.0) * (softLightCurve - accent), 1.0),
    vec4(1.0 - (1.0 - accent) * (1.0 - materialMidHighBrightness), 1.0),
    vec4(1.0 - (1.0 - accent) * (1.0 - materialHighlightBrightness), 1.0)
  );
}

// Each ramp smoothly transitions between its start and end values.
const float materialMidLowRampStart = 0.3522728383541107;
const float materialMidLowRampEnd = 0.7400000095367432;
const float materialMidHighRampStart = 0.4113636016845703;
const float materialMidHighRampEnd = 0.5586364269256592;
const float materialHighlightRampStart = 0.3431819975376129;
const float materialHighlightRampEnd = 0.6200000047683716;
// END EDITABLE HORIZON MATERIAL

layout(std140) uniform HorizonUniformsObject {
  float waveFrame;
  float baseShaderFrame;
  float waveAmplitude;
  float textureFlowFrame;
  float textureEdgeWarp;
  float listeningTextureNoiseScale;
  vec2 speakingWatercolorOffset0;
  vec2 speakingWatercolorOffset1;
  vec2 speakingWatercolorOffset2;
  vec4 accentColor;
} ubo;

#define uWaveFrame ubo.waveFrame
#define uBaseShaderFrame ubo.baseShaderFrame
#define uWaveAmplitude ubo.waveAmplitude
#define uTextureFlowFrame ubo.textureFlowFrame
#define uTextureEdgeWarp ubo.textureEdgeWarp
#define uListeningTextureNoiseScale ubo.listeningTextureNoiseScale
#define uSpeakingWatercolorOffset0 ubo.speakingWatercolorOffset0
#define uSpeakingWatercolorOffset1 ubo.speakingWatercolorOffset1
#define uSpeakingWatercolorOffset2 ubo.speakingWatercolorOffset2
#define uAccentColor ubo.accentColor

out vec4 fragColor;

vec3 rotateX(vec3 value, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(value.x, c * value.y - s * value.z, s * value.y + c * value.z);
}

vec3 rotateY(vec3 value, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(c * value.x + s * value.z, value.y, -s * value.x + c * value.z);
}

vec3 rotateZ(vec3 value, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(c * value.x - s * value.y, s * value.x + c * value.y, value.z);
}

vec3 rotateEulerXYZ(vec3 value, vec3 rotation) {
  vec3 transformed = rotateX(value, rotation.x);
  transformed = rotateY(transformed, rotation.y);
  transformed = rotateZ(transformed, rotation.z);
  return transformed;
}

vec3 mappingPoint(vec3 value, vec3 location, vec3 rotation, vec3 scale) {
  return rotateEulerXYZ(value * scale, rotation) + location;
}

float hash2ToFloat(vec2 value) {
  return fract(sin(dot(value, vec2(127.1, 311.7))) * 43758.5453);
}

vec2 hash2ToVec2(vec2 value) {
  return vec2(
    hash2ToFloat(value),
    hash2ToFloat(value + vec2(19.19, 73.73))
  );
}

float valueNoise2(vec2 value) {
  vec2 cell = floor(value);
  vec2 fraction = fract(value);
  vec2 curve = fraction * fraction * (3.0 - 2.0 * fraction);
  float lower = mix(
    hash2ToFloat(cell),
    hash2ToFloat(cell + vec2(1.0, 0.0)),
    curve.x
  );
  float upper = mix(
    hash2ToFloat(cell + vec2(0.0, 1.0)),
    hash2ToFloat(cell + vec2(1.0, 1.0)),
    curve.x
  );
  return mix(lower, upper, curve.y);
}

float noiseFbm2(vec2 value, float roughness, float lacunarity) {
  float firstOctave = valueNoise2(value);
  float secondOctave = valueNoise2(value * lacunarity + vec2(17.17, 31.31));
  float thirdOctave = valueNoise2(
    value * lacunarity * lacunarity + vec2(47.47, 11.11)
  );
  float secondAmplitude = roughness;
  float thirdAmplitude = roughness * roughness;
  return (
    firstOctave +
    secondOctave * secondAmplitude +
    thirdOctave * thirdAmplitude
  ) / (1.0 + secondAmplitude + thirdAmplitude);
}

vec3 noiseColor4Detail2Normalized(
  vec3 coordinate,
  float w,
  float scale,
  float roughness,
  float lacunarity,
  bool normalizeTimeDirection
) {
  vec2 point = coordinate.xy * scale;
  float time = w * scale;
  vec2 firstDirection = vec2(0.17, 0.11);
  vec2 secondDirection = vec2(-0.13, 0.19);
  vec2 thirdDirection = vec2(0.07, -0.23);

  if (normalizeTimeDirection) {
    firstDirection = normalize(firstDirection);
    secondDirection = normalize(secondDirection);
    thirdDirection = normalize(thirdDirection);
  }

  return vec3(
    noiseFbm2(point + firstDirection * time, roughness, lacunarity),
    noiseFbm2(
      point + vec2(41.41, 17.17) + secondDirection * time,
      roughness,
      lacunarity
    ),
    noiseFbm2(
      point + vec2(23.23, 59.59) + thirdDirection * time,
      roughness,
      lacunarity
    )
  );
}

vec3 animatedColorRampWarp(vec3 coordinate, float frame) {
  vec2 point = coordinate.xy * 8.0;
  vec2 cell = floor(point);
  vec2 localPosition = fract(point);
  vec2 nearestPosition = vec2(0.0);
  float nearestDistance = 3.402823466e+38;
  float animationPhase = frame * 2.0 * 3.14159265 / 240.0;

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 cellOffset = vec2(float(x), float(y));
      vec2 randomPosition = hash2ToVec2(cell + cellOffset);
      vec2 animatedPosition = cellOffset +
        randomPosition * 0.7185189723968506 +
        sin(vec2(animationPhase) + randomPosition * 6.2831853) * 0.04;
      vec2 delta = animatedPosition - localPosition;
      float distanceSquared = dot(delta, delta);

      if (distanceSquared < nearestDistance) {
        nearestDistance = distanceSquared;
        nearestPosition = animatedPosition;
      }
    }
  }

  vec3 voronoiPosition = vec3((nearestPosition + cell) / 8.0, coordinate.z);
  vec3 continuousWarp =
    (coordinate - vec3(0.5)) * 0.25999999046325684;
  vec3 cellularWarp = (voronoiPosition - coordinate) * 0.06;
  return continuousWarp + cellularWarp;
}


vec4 ramp_color_ramp_006(float fac) {
  if (fac <= materialHighlightRampStart) {
    return vec4(1.0, 1.0, 1.0, 1.0);
  }
  if (fac <= materialHighlightRampEnd) {
    float t = clamp((fac - materialHighlightRampStart) / max(materialHighlightRampEnd - materialHighlightRampStart, 0.000001), 0.0, 1.0);
    t = t * t * (3.0 - 2.0 * t);
    return mix(vec4(1.0, 1.0, 1.0, 1.0), vec4(0.0, 0.0, 0.0, 1.0), t);
  }
  return vec4(0.0, 0.0, 0.0, 1.0);
}

vec4 ramp_color_ramp_005(float fac) {
  if (fac <= materialMidHighRampStart) {
    return vec4(1.0, 1.0, 1.0, 1.0);
  }
  if (fac <= materialMidHighRampEnd) {
    float t = clamp((fac - materialMidHighRampStart) / max(materialMidHighRampEnd - materialMidHighRampStart, 0.000001), 0.0, 1.0);
    t = t * t * (3.0 - 2.0 * t);
    return mix(vec4(1.0, 1.0, 1.0, 1.0), vec4(0.0, 0.0, 0.0, 1.0), t);
  }
  return vec4(0.0, 0.0, 0.0, 1.0);
}

vec4 ramp_color_ramp_009(float fac) {
  if (fac <= materialMidLowRampStart) {
    return vec4(1.0, 1.0, 1.0, 1.0);
  }
  if (fac <= materialMidLowRampEnd) {
    float t = clamp((fac - materialMidLowRampStart) / max(materialMidLowRampEnd - materialMidLowRampStart, 0.000001), 0.0, 1.0);
    t = t * t * (3.0 - 2.0 * t);
    return mix(vec4(1.0, 1.0, 1.0, 1.0), vec4(0.0, 0.0, 0.0, 1.0), t);
  }
  return vec4(0.0, 0.0, 0.0, 1.0);
}

vec4 ramp_color_ramp_007(float fac) {
  if (fac <= 0.0) {
    return vec4(1.0, 1.0, 1.0, 1.0);
  }
  if (fac <= 1.0) {
    return vec4(1.0, 1.0, 1.0, 1.0);
  }
  return vec4(0.0, 0.0, 0.0, 1.0);
}

void main() {
  HorizonPalette materialPalette = materialPaletteForAccent(uAccentColor.rgb);
  vec4 materialShadowColor = materialPalette.shadowColor;
  vec4 materialMidLowColor = materialPalette.midLowColor;
  vec4 materialMidHighColor = materialPalette.midHighColor;
  vec4 materialHighlightColor = materialPalette.highlightColor;
  float frame = uBaseShaderFrame;
  float waveFrame = uWaveFrame;
  float textureFlowFrame = uTextureFlowFrame;
  // This pass produces only the animated material. A separate full-resolution
  // composite pass owns the circle SDF, reveal, and mic-driven scaling.
  vec3 scaledGenerated = vGenerated;
  vec3 n_texture_coordinate_001_generated = scaledGenerated;
vec3 n_mapping_003_vector = mappingPoint(n_texture_coordinate_001_generated, vec3(0.0, -0.14000000059604645, 0.0), vec3(0.0, 0.0, 0.0), vec3(1.0, 1.0, 1.0));
  vec2 textureEdgeCentered = scaledGenerated.xy - vec2(0.5);
  float textureEdgeRadius = length(textureEdgeCentered);
  float textureEdgeWeight = smoothstep(0.015, 0.44, textureEdgeRadius);
  vec2 textureEdgeDirection = textureEdgeRadius > 0.000001
    ? textureEdgeCentered / textureEdgeRadius
    : vec2(0.0);
  n_mapping_003_vector.xy += textureEdgeDirection * textureEdgeWeight * uTextureEdgeWarp;
float n_value_001_value = waveFrame / 100.0;
vec3 n_noise_texture_009_color = noiseColor4Detail2Normalized(n_mapping_003_vector, n_value_001_value, 1.0, 0.4000000059604645, 2.0, true);
vec3 n_vector_math_015_vector = n_noise_texture_009_color - vec3(0.5, 0.5, 0.5);
float n_value_003_value = (0.800000011920929) * uWaveAmplitude;
vec3 n_vector_math_016_vector = n_vector_math_015_vector * n_value_003_value;
vec3 n_vector_math_020_vector = n_mapping_003_vector + n_vector_math_016_vector;
vec3 n_noise_texture_color = noiseColor4Detail2Normalized(n_vector_math_020_vector, textureFlowFrame / 10.0, 4000.0, 0.5, 2.0, false);
vec3 n_vector_math_026_vector = (n_noise_texture_color - vec3(0.5, 0.5, 0.5)) * uListeningTextureNoiseScale;
vec3 n_vector_math_028_vector = n_vector_math_026_vector * 0.05999999865889549;
float n_value_value = 0.800000011920929;
vec3 n_vector_math_004_vector = n_vector_math_020_vector * n_value_value;
vec3 n_vector_math_010_vector = n_vector_math_028_vector + n_vector_math_004_vector;
  n_vector_math_010_vector.xy += uSpeakingWatercolorOffset0;
vec4 n_image_texture_004_color = textureGrad(uImage_0, (n_vector_math_010_vector).xy, dFdx((n_vector_math_010_vector).xy) * (1.0 / 1.5), dFdy((n_vector_math_010_vector).xy) * (1.0 / 1.5));
float n_math_002_value = (n_image_texture_004_color).r - 0.5;
vec3 n_vector_math_005_vector = n_vector_math_004_vector;
vec3 n_vector_math_013_vector = n_vector_math_028_vector + n_vector_math_005_vector;
float n_math_004_value = 1.0 - (n_vector_math_013_vector).y;
vec3 n_combine_xyz_005_vector = vec3((n_vector_math_013_vector).x, n_math_004_value, 0.0);
  n_combine_xyz_005_vector.xy += uSpeakingWatercolorOffset0;
vec4 n_image_texture_005_color = textureGrad(uImage_0, (n_combine_xyz_005_vector).xy, dFdx((n_combine_xyz_005_vector).xy) * (1.0 / 1.5), dFdy((n_combine_xyz_005_vector).xy) * (1.0 / 1.5));
float n_math_005_value = (n_image_texture_005_color).r - 0.5;
float baseShaderFrameBlend120 =
  clamp(0.5 - 0.5*cos(frame * 2.0 * 3.14159265 / 120.0), 0.0, 1.0);
float n_mix_012_result_float = mix(n_math_002_value, n_math_005_value, baseShaderFrameBlend120);
float n_value_002_value = 0.2 - 0.06*cos((frame - 1.0) * 2.0 * 3.14159265 / 120.0);
float n_math_003_value = n_mix_012_result_float * n_value_002_value;
vec3 n_combine_xyz_004_vector = vec3(n_math_003_value, n_math_003_value, 0.0);
vec3 n_vector_math_023_vector = animatedColorRampWarp(n_vector_math_020_vector, frame);
vec3 n_vector_math_vector = n_combine_xyz_004_vector + n_vector_math_023_vector;
vec3 n_vector_math_001_vector = n_vector_math_020_vector + n_vector_math_vector;
vec3 n_mapping_006_vector = mappingPoint(n_vector_math_001_vector, vec3(0.0, 0.5600000023841858, 0.0), vec3(0.0, 0.7853981852531433, 0.0), vec3(1.0, 1.0, 1.0));
vec4 n_color_ramp_006_color = ramp_color_ramp_006(((n_mapping_006_vector).x + (n_mapping_006_vector).y + (n_mapping_006_vector).z) / 3.0);
float n_value_005_value = 0.800000011920929;
vec3 n_mapping_vector = mappingPoint(n_vector_math_020_vector, vec3(0.03999999910593033, 0.019999999552965164, 0.0), vec3(0.0, 0.0, 0.0), vec3(n_value_005_value));
vec3 n_vector_math_021_vector = n_vector_math_028_vector + n_mapping_vector;
  n_vector_math_021_vector.xy += uSpeakingWatercolorOffset1;
vec4 n_image_texture_006_color = textureGrad(uImage_0, (n_vector_math_021_vector).xy, dFdx((n_vector_math_021_vector).xy) * (1.0 / 1.5), dFdy((n_vector_math_021_vector).xy) * (1.0 / 1.5));
float n_math_006_value = (n_image_texture_006_color).r - 0.5;
vec3 n_mapping_001_vector = mappingPoint(n_vector_math_020_vector, vec3(-0.03999999910593033, -0.019999999552965164, 0.0), vec3(0.0, 0.0, 0.0), vec3(n_value_005_value));
vec3 n_vector_math_024_vector = n_vector_math_028_vector + n_mapping_001_vector;
float n_math_008_value = 1.0 - (n_vector_math_024_vector).y;
vec3 n_combine_xyz_007_vector = vec3((n_vector_math_024_vector).x, n_math_008_value, 0.0);
  n_combine_xyz_007_vector.xy += uSpeakingWatercolorOffset1;
vec4 n_image_texture_007_color = textureGrad(uImage_0, (n_combine_xyz_007_vector).xy, dFdx((n_combine_xyz_007_vector).xy) * (1.0 / 1.5), dFdy((n_combine_xyz_007_vector).xy) * (1.0 / 1.5));
float n_math_009_value = (n_image_texture_007_color).r - 0.5;
float n_mix_013_result_float = mix(n_math_006_value, n_math_009_value, baseShaderFrameBlend120);
float n_value_004_value = 0.2 - 0.06*cos((frame - 1.0) * 2.0 * 3.14159265 / 80.0);
float n_math_007_value = n_mix_013_result_float * n_value_004_value;
vec3 n_combine_xyz_006_vector = vec3(n_math_007_value, n_math_007_value, 0.0);
vec3 n_vector_math_003_vector = n_combine_xyz_006_vector + n_vector_math_023_vector;
vec3 n_vector_math_002_vector = n_vector_math_020_vector + n_vector_math_003_vector;
vec3 n_mapping_004_vector = mappingPoint(n_vector_math_002_vector, vec3(0.0, 0.25999999046325684, 0.0), vec3(0.0, 0.7853981852531433, 0.0), vec3(1.0, 1.0, 1.0));
vec4 n_color_ramp_005_color = ramp_color_ramp_005(((n_mapping_004_vector).x + (n_mapping_004_vector).y + (n_mapping_004_vector).z) / 3.0);
vec3 n_texture_coordinate_002_generated = scaledGenerated;
vec3 n_mapping_007_vector = mappingPoint(n_texture_coordinate_002_generated, vec3(-0.3199999928474426, 0.0, 0.0), vec3(0.0, 0.0, -1.5707963705062866), vec3(1.0, 1.0, 1.0));
float n_gradient_texture_clamped = clamp((n_mapping_007_vector).x, 0.0, 1.0);
float n_gradient_texture_fac = n_gradient_texture_clamped * n_gradient_texture_clamped
  * (3.0 - 2.0 * n_gradient_texture_clamped);
float n_value_007_value = 0.800000011920929;
vec3 n_mapping_002_vector = mappingPoint(n_vector_math_020_vector, vec3(-0.07999999821186066, -0.03999999910593033, 0.0), vec3(0.0, 0.0, 0.0), vec3(n_value_007_value));
vec3 n_vector_math_027_vector = n_vector_math_028_vector + n_mapping_002_vector;
  n_vector_math_027_vector.xy += uSpeakingWatercolorOffset2;
vec4 n_image_texture_008_color = textureGrad(uImage_0, (n_vector_math_027_vector).xy, dFdx((n_vector_math_027_vector).xy) * (1.0 / 1.5), dFdy((n_vector_math_027_vector).xy) * (1.0 / 1.5));
vec4 n_mix_002_result_color = mix(n_image_texture_008_color, vec4(1.0, 1.0, 1.0, 1.0), clamp(((vec4(vec3(n_gradient_texture_fac), 1.0)).r + (vec4(vec3(n_gradient_texture_fac), 1.0)).g + (vec4(vec3(n_gradient_texture_fac), 1.0)).b) / 3.0, 0.0, 1.0));
float n_math_010_value = (n_mix_002_result_color).r - 0.5;
vec3 n_mapping_005_vector = mappingPoint(n_vector_math_020_vector, vec3(-0.9599999189376831, 0.05999999865889549, 0.0), vec3(0.0, 0.0, 0.0), vec3(n_value_007_value));
vec3 n_vector_math_030_vector = n_vector_math_028_vector + n_mapping_005_vector;
float n_math_012_value = 1.0 - (n_vector_math_030_vector).y;
vec3 n_combine_xyz_009_vector = vec3((n_vector_math_030_vector).x, n_math_012_value, 0.0);
  n_combine_xyz_009_vector.xy += uSpeakingWatercolorOffset2;
vec4 n_image_texture_009_color = textureGrad(uImage_0, (n_combine_xyz_009_vector).xy, dFdx((n_combine_xyz_009_vector).xy) * (1.0 / 1.5), dFdy((n_combine_xyz_009_vector).xy) * (1.0 / 1.5));
vec4 n_mix_001_result_color = mix(n_image_texture_009_color, vec4(1.0, 1.0, 1.0, 1.0), clamp(((vec4(vec3(n_gradient_texture_fac), 1.0)).r + (vec4(vec3(n_gradient_texture_fac), 1.0)).g + (vec4(vec3(n_gradient_texture_fac), 1.0)).b) / 3.0, 0.0, 1.0));
float n_math_013_value = (n_mix_001_result_color).r - 0.5;
float n_mix_014_result_float = mix(n_math_010_value, n_math_013_value, baseShaderFrameBlend120);
float n_value_006_value = 0.14 - 0.06*cos((frame - 1.0) * 2.0 * 3.14159265 / 100.0);
float n_math_011_value = n_mix_014_result_float * n_value_006_value;
vec3 n_combine_xyz_008_vector = vec3(n_math_011_value, n_math_011_value, 0.0);
vec3 n_vector_math_007_vector = n_combine_xyz_008_vector + n_vector_math_023_vector;
vec3 n_vector_math_006_vector = n_vector_math_020_vector + n_vector_math_007_vector;
vec3 n_mapping_009_vector = mappingPoint(n_vector_math_006_vector, vec3(0.0, 0.12000000476837158, 0.0), vec3(0.0, 0.7853981852531433, 0.0), vec3(1.0, 1.0, 1.0));
vec4 n_color_ramp_009_color = ramp_color_ramp_009(((n_mapping_009_vector).x + (n_mapping_009_vector).y + (n_mapping_009_vector).z) / 3.0);
vec3 n_texture_coordinate_generated = scaledGenerated;
vec3 n_mapping_008_vector = mappingPoint(n_texture_coordinate_generated, vec3(0.0, 0.0, 0.0), vec3(0.0, 0.0, 0.0), vec3(1.0, 1.0, 1.0));
vec4 n_color_ramp_007_color = ramp_color_ramp_007(((n_mapping_008_vector).x + (n_mapping_008_vector).y + (n_mapping_008_vector).z) / 3.0);
vec4 n_mix_010_result_color = mix(vec4(0.0, 0.0, 0.0, 1.0), materialShadowColor, clamp(((n_color_ramp_007_color).r + (n_color_ramp_007_color).g + (n_color_ramp_007_color).b) / 3.0, 0.0, 1.0));
vec4 n_mix_011_result_color = mix(n_mix_010_result_color, materialMidLowColor, clamp(((n_color_ramp_009_color).r + (n_color_ramp_009_color).g + (n_color_ramp_009_color).b) / 3.0, 0.0, 1.0));
vec4 n_mix_008_result_color = mix(n_mix_011_result_color, materialMidHighColor, clamp(((n_color_ramp_005_color).r + (n_color_ramp_005_color).g + (n_color_ramp_005_color).b) / 3.0, 0.0, 1.0));
vec4 n_mix_009_result_color = mix(n_mix_008_result_color, materialHighlightColor, clamp(((n_color_ramp_006_color).r + (n_color_ramp_006_color).g + (n_color_ramp_006_color).b) / 3.0, 0.0, 1.0));
vec4 materialColor = vec4((n_mix_009_result_color).rgb, 1.0);
  fragColor = materialColor;
}
`})))()}var re;function O(){return(O=e((()=>{re=`#version 300 es
in vec2 aPosition;
in vec3 aGenerated;
out vec3 vGenerated;

void main() {
  vGenerated = aGenerated;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`})))()}function ie(e){let t=e.replace(/^.*\./,``);switch(t){case`accentColor`:case`waveFrame`:case`baseShaderFrame`:case`waveAmplitude`:case`textureFlowFrame`:case`textureEdgeWarp`:case`listeningTextureNoiseScale`:case`speakingWatercolorOffset0`:case`speakingWatercolorOffset1`:case`speakingWatercolorOffset2`:return t;default:throw Error(`Unsupported Horizon uniform: ${e}`)}}function ae(e,t){let n=e.getUniformBlockIndex(t,F);if(n===e.INVALID_INDEX)throw Error(`Could not find Horizon uniform block.`);let r=e.getActiveUniformBlockParameter(t,n,e.UNIFORM_BLOCK_DATA_SIZE),i=e.createBuffer();e.bindBuffer(e.UNIFORM_BUFFER,i),e.bufferData(e.UNIFORM_BUFFER,r,e.DYNAMIC_DRAW),e.bindBufferBase(e.UNIFORM_BUFFER,0,i),e.uniformBlockBinding(t,n,0);let a=e.getActiveUniformBlockParameter(t,n,e.UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES),o=[],s={};for(let n=0;n<a.length;n+=1){let r=a[n],i=e.getActiveUniform(t,r);if(!i)throw Error(`Could not find Horizon uniform info: ${r}`);let c=i.name.replace(/\[0\]$/,``),l=e.getActiveUniforms(t,[r],e.UNIFORM_OFFSET)[0];o.push(c),s[c]=l}return{buffer:i,bufferData:new ArrayBuffer(r),names:o,offsets:s}}function k(e,t){let n=e.createBuffer();if(!n)throw Error(`Could not create Horizon vertex buffer.`);return e.bindBuffer(e.ARRAY_BUFFER,n),e.bufferData(e.ARRAY_BUFFER,t,e.STATIC_DRAW),n}function oe(e){let t=e.createTexture();if(!t)throw Error(`Could not create Horizon interior texture.`);return e.activeTexture(e.TEXTURE0+I),e.bindTexture(e.TEXTURE_2D,t),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,1,1,0,e.RGBA,e.UNSIGNED_BYTE,null),t}function se(e,t){let n=e.createFramebuffer();if(!n)throw Error(`Could not create Horizon interior framebuffer.`);return e.bindFramebuffer(e.FRAMEBUFFER,n),e.framebufferTexture2D(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,t,0),e.bindFramebuffer(e.FRAMEBUFFER,null),n}function ce(e,t){return{baseShaderFrame:A(e,t,`uBaseShaderFrame`),connectionRevealAmount:A(e,t,`uConnectionRevealAmount`),interiorTexture:A(e,t,`uInteriorTexture`),micLevel:A(e,t,`uMicLevel`),preConnectionDotColor:A(e,t,`uPreConnectionDotColor`),preConnectionDotVisibility:A(e,t,`uPreConnectionDotVisibility`),surfaceScale:A(e,t,`uSurfaceScale`),userSpeakingScale:A(e,t,`uUserSpeakingScale`)}}function A(e,t,n){let r=e.getUniformLocation(t,n);if(r==null)throw Error(`Could not find Horizon composite uniform: ${n}`);return r}function le(e,t,n){let r=j(e,e.VERTEX_SHADER,t),i=j(e,e.FRAGMENT_SHADER,n),a=e.createProgram();if(!a)throw e.deleteShader(r),e.deleteShader(i),Error(`Could not create Horizon composite program.`);if(e.attachShader(a,r),e.attachShader(a,i),e.linkProgram(a),e.deleteShader(r),e.deleteShader(i),!e.getProgramParameter(a,e.LINK_STATUS)){let t=e.getProgramInfoLog(a);throw e.deleteProgram(a),Error(`Could not link Horizon composite program: ${t}`)}return a}function j(e,t,n){let r=e.createShader(t);if(!r)throw Error(`Could not create Horizon composite shader.`);if(e.shaderSource(r,n),e.compileShader(r),!e.getShaderParameter(r,e.COMPILE_STATUS)){let t=e.getShaderInfoLog(r);throw e.deleteShader(r),Error(`Could not compile Horizon composite shader: ${t}`)}return r}function ue({width:e,height:t,scale:n}){let r=Math.min(Math.max(n,0),1);return{width:Math.max(1,Math.floor(e*r)),height:Math.max(1,Math.floor(t*r))}}function de(e,t){let n=e.createTexture();if(!n)throw Error(`Could not create Horizon watercolor texture.`);return e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,n),e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,1),e.pixelStorei(e.UNPACK_COLORSPACE_CONVERSION_WEBGL,e.NONE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR_MIPMAP_LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.REPEAT),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.REPEAT),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,e.RGBA,e.UNSIGNED_BYTE,t),e.generateMipmap(e.TEXTURE_2D),n}var M,N,P,F,I,L;function R(){return(R=e((()=>{E(),ee(),ne(),O(),M=new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),N=new Float32Array([0,0,.5,1,0,.5,0,1,.5,0,1,.5,1,0,.5,1,1,.5]),P=6,F=`HorizonUniformsObject`,I=1,L=class{#e;#t;#n;#r;#i;#a;#o;#s;#c;#l;#u;#d;#f=[];#p={};#m;#h;#g;#_=0;#v=0;constructor(e,t,n){this.#t=e,this.#n=t,this.#r=le(e,D,T),this.#l=k(e,M),this.#o=k(e,N);let r=e.getAttribLocation(t,`aPosition`),i=e.getAttribLocation(t,`aGenerated`),a=e.getAttribLocation(this.#r,`aPosition`);if(r===-1)throw Error(`Could not find Horizon attribute: aPosition`);if(i===-1)throw Error(`Could not find Horizon attribute: aGenerated`);if(a===-1)throw Error(`Could not find Horizon composite attribute: aPosition`);this.#s=r,this.#a=i,this.#c=a,this.#m=de(e,n),this.#h=oe(e),this.#g=se(e,this.#h);let o=ae(e,t);this.#u=o.buffer,this.#d=o.bufferData,this.#e=new Float32Array(this.#d),this.#f=o.names,this.#p=o.offsets,e.useProgram(t),this.#y();let s=e.getUniformLocation(t,`uImage_0`);if(!s)throw Error(`Could not find Horizon uniform: uImage_0`);e.uniform1i(s,0),this.#i=ce(e,this.#r),e.useProgram(this.#r),e.uniform1i(this.#i.interiorTexture,I)}destroy(){let e=this.#t;e.deleteTexture(this.#m),e.deleteTexture(this.#h),e.deleteFramebuffer(this.#g),e.deleteBuffer(this.#l),e.deleteBuffer(this.#o),e.deleteBuffer(this.#u),e.deleteProgram(this.#r)}setVariablesAndRender(e,t){let n=this.#t,r=ue({width:n.drawingBufferWidth,height:n.drawingBufferHeight,scale:t});return this.#x(r.width,r.height),e.preConnectionDotVisibility<1&&(n.bindFramebuffer(n.FRAMEBUFFER,this.#g),n.viewport(0,0,r.width,r.height),n.useProgram(this.#n),this.#y(),this.#C(e),n.drawArrays(n.TRIANGLES,0,P)),n.bindFramebuffer(n.FRAMEBUFFER,null),n.viewport(0,0,n.drawingBufferWidth,n.drawingBufferHeight),n.useProgram(this.#r),this.#b(),this.#S(e),n.drawArrays(n.TRIANGLES,0,P),r}#y(){let e=this.#t;e.bindBuffer(e.ARRAY_BUFFER,this.#l),e.enableVertexAttribArray(this.#s),e.vertexAttribPointer(this.#s,2,e.FLOAT,!1,0,0),e.bindBuffer(e.ARRAY_BUFFER,this.#o),e.enableVertexAttribArray(this.#a),e.vertexAttribPointer(this.#a,3,e.FLOAT,!1,0,0)}#b(){let e=this.#t;e.bindBuffer(e.ARRAY_BUFFER,this.#l),e.enableVertexAttribArray(this.#c),e.vertexAttribPointer(this.#c,2,e.FLOAT,!1,0,0)}#x(e,t){if(this.#_===e&&this.#v===t)return;let n=this.#t;if(n.activeTexture(n.TEXTURE0+I),n.bindTexture(n.TEXTURE_2D,this.#h),n.texImage2D(n.TEXTURE_2D,0,n.RGBA8,e,t,0,n.RGBA,n.UNSIGNED_BYTE,null),n.bindFramebuffer(n.FRAMEBUFFER,this.#g),n.checkFramebufferStatus(n.FRAMEBUFFER)!==n.FRAMEBUFFER_COMPLETE)throw Error(`Could not create Horizon interior framebuffer.`);this.#_=e,this.#v=t}#S(e){let t=this.#t,n=this.#i;t.uniform1f(n.baseShaderFrame,e.baseShaderFrame),t.uniform1f(n.micLevel,e.micLevel),t.uniform1f(n.surfaceScale,e.surfaceScale),t.uniform1f(n.userSpeakingScale,e.userSpeakingScale),t.uniform1f(n.connectionRevealAmount,e.connectionRevealAmount),t.uniform1f(n.preConnectionDotVisibility,e.preConnectionDotVisibility),t.uniform4fv(n.preConnectionDotColor,e.preConnectionDotColor)}#C(e){for(let t of this.#f){let n=ie(t),r=this.#p[t]/4,i=e[n];typeof i==`number`?this.#e[r]=i:Array.isArray(i)&&this.#e.set(i,r)}this.#t.bindBuffer(this.#t.UNIFORM_BUFFER,this.#u),this.#t.bufferSubData(this.#t.UNIFORM_BUFFER,0,this.#d)}}})))()}var z;function B(){return(B=e((()=>{z=``+new URL(`watercolor-7f01d7071d0b.webp`,import.meta.url).href})))()}function fe(){return W??=new Promise((e,t)=>{let n=new window.Image;n.crossOrigin=`anonymous`,n.onload=()=>{e(n)},n.onerror=()=>{W=void 0,t(Error(`Failed to load Horizon watercolor texture.`))},n.src=z}),W}function pe(e,t,n){let r=V(e,e.VERTEX_SHADER,t),i=V(e,e.FRAGMENT_SHADER,n),a=e.createProgram();if(a==null)throw e.deleteShader(r),e.deleteShader(i),Error(`Could not create Horizon shader program.`);if(e.attachShader(a,r),e.attachShader(a,i),e.linkProgram(a),e.deleteShader(r),e.deleteShader(i),!e.getProgramParameter(a,e.LINK_STATUS)){let t=e.getProgramInfoLog(a);throw e.deleteProgram(a),Error(`Could not link Horizon shader program: ${t}`)}return a}function V(e,t,n){let r=e.createShader(t);if(r==null)throw Error(`Could not create Horizon shader.`);if(e.shaderSource(r,n),e.compileShader(r),!e.getShaderParameter(r,e.COMPILE_STATUS)){let t=e.getShaderInfoLog(r);throw e.deleteShader(r),Error(`Could not compile Horizon shader: ${t}`)}return r}var H,U,W,G;function me(){return(me=e((()=>{w(),h(),t(),R(),B(),H=350,U=[0,0,0,1],G=class e{static async create(t,n={}){let r=t.getContext(`webgl2`,{premultipliedAlpha:!0});return r==null?null:new e(t,r,await fe(),n)}#e;#t;#n;#r;#i=H;#a;#o;#s;#c=!1;#l=!1;#u=new m;#d;#f;#p;#m;#h=H;#g;#_=H;constructor(e,t,n,r){this.#e=e,this.#a=r.displayScale??1,this.#t=t,this.#d=r.onDraw,this.#f=r.onRenderError,this.#n=n,this.#m=this.#b(),this.#r=new C,this.#o=Math.floor(Math.min(e.clientWidth,e.clientHeight)),this.#s=new ResizeObserver(e=>{for(let t of e)this.#o=Math.floor(Math.min(t.contentRect.width,t.contentRect.height))}),this.#s.observe(e),e.addEventListener(`webglcontextlost`,this.#v),e.addEventListener(`webglcontextrestored`,this.#y)}setVariables(e){this.#g=e}resetAnimation(){this.#i=H,this.#u=new m,this.#p=void 0,this.#h=H,this.#_=H}render(e){if(this.#c||this.#m==null)return;this.#S();let t=this.#g?.voiceSnapshot??p;this.#r.update(this.#e.width,this.#e.height,t.stateListen===1||t.stateSpeak===1);let i=r(this.#p==null?0:(e-this.#p)/1e3),a=this.#p==null?this.#u.initialOutput():this.#u.update(t,i);if(this.#p!=null&&(this.#_+=i*24*a.waveMotionSpeed,this.#i+=i*24,this.#h+=i*24*a.textureFlowSpeed),this.#p=e,this.#g==null)return;let o=a.speakingWatercolorOffsets,s={accentColor:n(this.#g.paletteIndex).accentColor,waveFrame:this.#_,baseShaderFrame:this.#i,waveAmplitude:a.waveAmplitude,textureFlowFrame:this.#h,textureEdgeWarp:a.textureEdgeWarp,listeningTextureNoiseScale:a.listeningTextureNoiseScale,micLevel:t.micLevel,surfaceScale:this.#g.codexSurfaceScale,userSpeakingScale:0,connectionRevealAmount:1,preConnectionDotVisibility:0,preConnectionDotColor:U,speakingWatercolorOffset0:o[0],speakingWatercolorOffset1:o[1],speakingWatercolorOffset2:o[2]};try{this.#m.uniformsSetter.setVariablesAndRender(s,this.#r.scale*Math.min(1,this.#a))}catch(e){if(!this.#t.isContextLost())throw e;return}if(this.#t.isContextLost())return;this.#r.recordFrame(e);let c=!this.#l;this.#l=!0,this.#d?.({canvas:this.#e,isFirstDraw:c,isListeningOrSpeaking:this.#g.isListeningOrSpeaking})}dispose(){this.#c||(this.#c=!0,this.#r.dispose(),this.#s.disconnect(),this.#e.removeEventListener(`webglcontextlost`,this.#v),this.#e.removeEventListener(`webglcontextrestored`,this.#y),this.#x())}#v=e=>{e.preventDefault(),this.#r.update(this.#e.width,this.#e.height,!1),this.#m=null};#y=()=>{if(!this.#c)try{this.#m=this.#b(),this.render(performance.now())}catch{this.dispose(),this.#f?.()}};#b(){let e=pe(this.#t,re,te);try{return{program:e,uniformsSetter:new L(this.#t,e,this.#n)}}catch(t){throw this.#t.deleteProgram(e),t}}#x(){this.#m!=null&&(this.#m.uniformsSetter.destroy(),this.#t.deleteProgram(this.#m.program),this.#m=null)}#S(){let e=window.devicePixelRatio??1,t=Math.max(1,Math.floor(this.#o*e));(this.#e.width!==t||this.#e.height!==t)&&(this.#e.width=t,this.#e.height=t,this.#t.viewport(0,0,t,t))}}})))()}function he({outputLevel:e,stateListen:t,stateSpeak:n,stateThink:r,timeSeconds:i}){let a=Math.max(t,r,n),o=q(.04,.46,e),s=Math.sin(i*Math.PI*.34)*.5+.5,c=q(0,.9,a),l=X*(.88+(.94-.88)*r)*(.82+(1-.82)*c);return l+=o*X*.12,l+=(1-r)*(1-o)*s*X*.01,Math.min(X,l)*2}function ge(e,t){switch(e){case`inactive`:return{listen:0,speak:0,think:0};case`starting`:return{listen:0,speak:0,think:1};case`stopping`:return{listen:.35,speak:0,think:0}}switch(t){case`idle`:case`listening`:return{listen:1,speak:0,think:0};case`thinking`:return{listen:.65,speak:0,think:1};case`speaking`:return{listen:.2,speak:1,think:0}}}function K(e,t,n,r){let i=Math.max(n&&e===`speaking`?.42:0,Math.min(1,t)),a=q(.08,.72,Math.sin(r*.78)*.5+.5),o=.58+Math.sin(r*3.1+.6)*.17+Math.sin(r*4.2+2.1)*.12,s=e===`speaking`?i*(.08+a*Math.max(.24,o)):0,c=e===`thinking`?i*(.1+(Math.sin(r*1.4)*.5+.5)*.06):0,l=e===`listening`?i*.08:0;return Math.min(1,Math.max(s,c,l))}function _e(e,t){let n=t/1e3,r=ve(e.voiceActivity,e.previewAudioLevel,n),i=e.phase===`active`,a=i&&e.voiceActivity===`speaking`,o=i&&(e.voiceActivity===`idle`||e.voiceActivity===`listening`);return{stateListen:+!!o,stateSpeak:+!!a,userSpeakingScale:o&&r[3]>0?1:0,assistantWaveformLevel:a?ye(r):0,assistantMotionLevel:a?Math.max(r[0],r[1],r[2]):0,assistantMotionAccent:0,cumulativeAudio:a?r.map(e=>e*n*2.5):[0,0,0,0],micLevel:o?r[3]:0}}function ve(e,t,n){let r=K(e,t,!1,n);return[r*(.82+Math.sin(n*1.1)*.14),r*(.76+Math.sin(n*1.5+1.2)*.16),r*(.68+Math.sin(n*1.9+2.1)*.18),r]}function ye(e){return((e[0]??0)+(e[1]??0)+(e[2]??0)+(e[3]??0))/4}function q(e,t,n){let r=Math.max(0,Math.min(1,(n-e)/(t-e)));return r*r*(3-2*r)}var J,be,xe,Se,Ce,we,Te,Ee,De,Oe,ke,Ae,Y,X,je,Me,Z,Ne,Pe,Fe,Ie,Q;function $(){return($=e((()=>{h(),t(),me(),J=500,be=.2,xe=3.6,Se=.024,Ce=1.75,we=140,Te=.48,Ee=.32,De=.08,Oe=.04,ke=1e3/24,Ae=16,Y=[0,0,0,0],X=.34,je=.09,Me=.3,Z=.28,Ne={phase:`inactive`,previewAudioLevel:0,previewTimeMs:void 0,voiceActivity:`idle`},Pe=class e{static async create(t,n){let r=n.presentation===`preview`?n.displayScale:void 0,i=null,a;try{a=await G.create(t,{displayScale:n.displayScale,onDraw:n.onDraw,onRenderError:()=>{i!=null&&i.#A()}})}catch{a=null}if(a==null)try{a=Fe.create(t,r,n.onDraw)}catch{a=null}return a==null?(n.onRenderError?.(),null):(i=new e(a,r,n.onRenderError,void 0),i)}#e=new Ie;#t=[0,0,0,0];#n;#r;#i;#a;#o=new Q;#s=new Q;#c=new Q;#l;#u={...p,cumulativeAudio:[0,0,0,0]};#d=null;#f=0;#p=0;#m=null;#h=!1;#g=Ne;#_=!1;#v=!0;#y=!1;#b;#x;#S=0;#C;#w=null;#T=0;#E=0;constructor(e,t,n,r){this.#n=e,this.#r=t,this.#i=n,this.#a=r,this.#l={paletteIndex:0,codexSurfaceScale:X*2,isListeningOrSpeaking:!1,voiceSnapshot:this.#u},this.#c.reset(0)}setInputs(e){if(this.#h)return;this.#g=e,this.#l.paletteIndex=e.paletteIndex??0;let t=performance.now();if(this.#I(t),e.previewTimeMs!=null){this.#F(),this.#e.reset(),this.#j(e.previewTimeMs);return}if(e.phase===`inactive`){this.#b=void 0,this.#x=void 0,this.#F(),this.#n.resetAnimation(),this.#_=!1,this.#C=void 0,this.#M(),this.#y=!1,this.#c.reset(0),this.#k(t),this.#v=!0;return}this.#v&&=(this.#f=0,this.#p=0,this.#S=0,this.#t.fill(0),this.#n.resetAnimation(),this.#C=void 0,!1),this.#P()}setAudioLevels(e){if(this.#h)return;this.#m=e;let t=e?.overall??0,n=this.#_?t>Oe:t>=De;n!==this.#_&&(this.#_=n,this.#I(performance.now()))}dispose(){this.#h||(this.#h=!0,this.#F(),this.#n.dispose())}#D=e=>{this.#F(),this.#k(e),this.#P()};#O=()=>{this.#D(performance.now())};#k(e){if(this.#h)return;let t=this.#g.previewTimeMs!=null||this.#g.previewAudioLevel>0?_e(this.#g,e):void 0;t??this.#L(e);let n=Math.min(1,Math.max(0,(this.#m?.micLevel??0)*Ce)),r=t?.micLevel??n;this.#u.userSpeakingScale=t?.userSpeakingScale??this.#N(e,r),this.#u.stateListen=this.#o.valueAt(e),this.#u.stateSpeak=this.#s.valueAt(e),this.#u.assistantWaveformLevel=t?.assistantWaveformLevel??Math.min(1,Math.max(this.#m?.low??0,this.#m?.mid??0,this.#m?.high??0,this.#m?.overall??0)),this.#u.assistantMotionLevel=t?.assistantMotionLevel??this.#p,this.#u.assistantMotionAccent=t?.assistantMotionAccent??this.#f,this.#u.cumulativeAudio=t?.cumulativeAudio??(this.#u.assistantWaveformLevel>=Se?this.#t:Y),this.#u.micLevel=r,this.#l.codexSurfaceScale=this.#r??this.#e.update(this.#g,this.#m,e),this.#l.isListeningOrSpeaking=this.#g.phase===`active`&&this.#g.voiceActivity!==`thinking`;try{this.#n.setVariables(this.#l),this.#n.render(e)}catch{this.#A()}}#A(){this.#h||(this.dispose(),this.#i?.())}#j(e){let t=Math.max(0,e);this.#n.resetAnimation(),this.#C=void 0,this.#M();for(let e=0;e<t;e+=ke)this.#k(e);this.#k(t)}#M(){this.#o.reset(this.#T),this.#s.reset(this.#E)}#N(e,t){let n=this.#g.phase===`active`&&!this.#_&&this.#g.voiceActivity!==`speaking`&&this.#g.voiceActivity!==`thinking`&&(this.#y?t>Ee:t>=Te);return n!==this.#y&&(this.#y=n,this.#c.setTarget(+!!n,e,we),this.#I(e)),this.#c.valueAt(e)}#P(){this.#h||this.#d!=null||this.#w!=null||(this.#d=window.requestAnimationFrame(this.#D),this.#w=window.setTimeout(this.#O,Ae))}#F(){this.#d!=null&&(window.cancelAnimationFrame(this.#d),this.#d=null),this.#w!=null&&(window.clearTimeout(this.#w),this.#w=null)}#I(e){let t=this.#g.phase===`active`,n=t&&(this.#_||this.#g.voiceActivity===`speaking`),r=t&&!n&&(this.#g.voiceActivity===`idle`||this.#g.voiceActivity===`listening`);this.#T=+!!r,this.#E=+!!n,this.#o.setTarget(this.#T,e,J),this.#s.setTarget(this.#E,e,J)}#L(e){let t=this.#C==null?.016:Math.max(0,Math.min(.1,(e-this.#C)/1e3));this.#C=e;let n=this.#m,r=n==null?Y:[n.low,n.mid,n.high,n.overall],i=Math.min(1,Math.max(r[0],r[1],r[2],r[3])),a=1-Math.exp(-t/be);this.#p+=(i-this.#p)*a,this.#f=Math.max(i-this.#S,0)*xe,this.#S=i;let o=t*60,s=1-Math.exp(-t/2);for(let e=0;e<this.#t.length;e+=1)this.#t[e]+=(r[e]??0)*o*40*s}},Fe=class e{static create(t,n,r){if(t.parentElement==null)return null;let i=t.ownerDocument.createElement(`canvas`),a=i.getContext(`2d`);return a==null?null:(i.className=t.className,i.style.cssText=t.style.cssText,t.after(i),new e(t,i,a,n,r))}#e;#t;#n;#r;#i;#a=!1;#o=!1;#s;constructor(e,t,n,r,i){this.#e=e,this.#t=t,this.#n=n,this.#r=r,this.#i=i}setVariables(e){this.#s=e}resetAnimation(){this.#s=void 0}render(e){if(this.#a||this.#s==null)return;this.#t.style.cssText!==this.#e.style.cssText&&(this.#t.style.cssText=this.#e.style.cssText);let t=Math.min(window.devicePixelRatio||1,1.5),r=Math.min(this.#e.clientWidth,this.#e.clientHeight),i=Math.max(1,Math.round(r*t));this.#t.width!==i&&(this.#t.width=i),this.#t.height!==i&&(this.#t.height=i);let a=i/2,o=i/2+(this.#r==null?Math.sin(e/1e3*.36)*1.5:0),s=this.#r==null?i*.29:i*this.#r/2,c=this.#n.createLinearGradient(a-s*.7,o-s,a+s*.55,o+s),l=n(this.#s.paletteIndex).fallbackColors;c.addColorStop(0,l[0]),c.addColorStop(.46,l[1]),c.addColorStop(1,l[2]),this.#n.clearRect(0,0,i,i),this.#n.fillStyle=c,this.#n.beginPath(),this.#n.arc(a,o,s*(this.#r==null?1+this.#s.voiceSnapshot.assistantWaveformLevel*.12:1),0,Math.PI*2),this.#n.fill();let u=!this.#o;this.#o=!0,this.#i?.({canvas:this.#t,isFirstDraw:u,isListeningOrSpeaking:this.#s.isListeningOrSpeaking})}dispose(){this.#a=!0,this.#t.remove()}},Ie=class{#e=!1;#t;#n=0;#r=0;#i=0;#a=0;reset(){this.#e=!1,this.#t=void 0,this.#n=0,this.#r=0,this.#i=0,this.#a=0}update(e,t,n){let r=n/1e3,i=this.#t==null||e.previewTimeMs!=null?.016:Math.max(0,Math.min(.05,(n-this.#t)/1e3));this.#t=n;let a=ge(e.phase,e.voiceActivity);this.#e||=(this.#r=a.listen,this.#i=a.speak,this.#a=a.think,!0);let o=e.previewTimeMs==null?1-Math.exp(-i/Z):1;if(this.#r+=(a.listen-this.#r)*o,this.#i+=(a.speak-this.#i)*o,this.#a+=(a.think-this.#a)*o,e.phase===`starting`&&(this.#a=Math.max(this.#a,.6)),e.previewTimeMs!=null)this.#n=K(e.voiceActivity,e.previewAudioLevel,!1,r);else{let n=t?.codexScaleLevel??t?.overall??K(e.voiceActivity,e.previewAudioLevel,!0,r),a=1-Math.exp(-i/(n>this.#n?je:Me));this.#n+=(n-this.#n)*a}return he({outputLevel:this.#n,stateListen:this.#r,stateSpeak:this.#i,stateThink:this.#a,timeSeconds:r})}},Q=class{#e=0;#t=!1;#n=0;#r=0;#i=0;setTarget(e,t,n){if(!this.#t){this.#t=!0,this.#n=e,this.#i=e,this.#r=t,this.#e=n;return}e!==this.#i&&(this.#n=this.valueAt(t),this.#i=e,this.#r=t,this.#e=n)}reset(e){this.#e=0,this.#t=!0,this.#n=e,this.#r=0,this.#i=e}valueAt(e){if(!this.#t||this.#e<=0)return this.#i;let t=Math.min(1,Math.max(0,(e-this.#r)/this.#e));return this.#n+(this.#i-this.#n)*t}}})))()}$();export{Pe as HorizonVoiceOrbController};
//# sourceMappingURL=horizon-voice-orb-controller-115de13e4bf5.js.map