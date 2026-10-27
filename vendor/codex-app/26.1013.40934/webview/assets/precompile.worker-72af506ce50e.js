var e=`#version 300 es
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
`,t=`#version 300 es
in vec2 aPosition;
out vec2 vSdfPosition;

void main() {
  vSdfPosition = aPosition;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`,n=`#version 300 es
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
`,r=`#version 300 es
in vec2 aPosition;
in vec3 aGenerated;
out vec3 vGenerated;

void main() {
  vGenerated = aGenerated;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;const i=performance.now();let a=!1,o=null;try{if(o=new OffscreenCanvas(1,1).getContext(`webgl2`),o!=null){for(let[i,a]of[[r,n],[t,e]]){let e=o.createProgram();if(e==null)throw Error(`Could not create shader program`);for(let[t,n]of[[o.VERTEX_SHADER,i],[o.FRAGMENT_SHADER,a]]){let r=o.createShader(t);if(r==null)throw Error(`Could not create shader`);if(o.shaderSource(r,n),o.compileShader(r),!o.getShaderParameter(r,o.COMPILE_STATUS))throw Error(`Could not compile shader`);o.attachShader(e,r),o.deleteShader(r)}if(o.linkProgram(e),!o.getProgramParameter(e,o.LINK_STATUS))throw Error(`Could not link shader program`);o.useProgram(e),o.deleteProgram(e)}a=!0}}catch{}finally{o?.getExtension(`WEBGL_lose_context`)?.loseContext()}self.postMessage({success:a,durationMs:performance.now()-i});
//# sourceMappingURL=precompile.worker-72af506ce50e.js.map