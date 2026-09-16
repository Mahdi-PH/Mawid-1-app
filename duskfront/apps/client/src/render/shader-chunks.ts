/**
 * مقاطع GLSL مشتركة — منها يستمد المشهد كله هويّته البصرية.
 * Shared GLSL. Every surface in the game asks the same function "how much dusk is
 * here?", which is why the terrain, the props and the sky agree on where the
 * terminator is down to the metre.
 */

/** ثوابت اللوحة داخل الشيدر / the palette, in shader space. */
export const PALETTE_GLSL = /* glsl */ `
const vec3 C_SUN_CORE   = vec3(1.000, 0.953, 0.812);
const vec3 C_SUN_DISC   = vec3(1.000, 0.843, 0.510);
const vec3 C_SUN_HALO   = vec3(1.000, 0.702, 0.278);
const vec3 C_SUN_DEEP   = vec3(1.000, 0.541, 0.239);
const vec3 C_EMBER      = vec3(0.910, 0.365, 0.149);
const vec3 C_SAND_LIT   = vec3(0.788, 0.545, 0.345);
const vec3 C_SAND_DARK  = vec3(0.541, 0.353, 0.235);
const vec3 C_DUSK_MAG   = vec3(0.776, 0.294, 1.000);
const vec3 C_DUSK_VIO   = vec3(0.659, 0.333, 0.969);
const vec3 C_DUSK_PUR   = vec3(0.486, 0.227, 0.929);
const vec3 C_NIGHT_HI   = vec3(0.102, 0.106, 0.294);
const vec3 C_NIGHT_MID  = vec3(0.082, 0.110, 0.267);
const vec3 C_NIGHT_DEEP = vec3(0.043, 0.063, 0.149);
const vec3 C_NIGHT_ABYS = vec3(0.020, 0.031, 0.078);
const vec3 C_CRYSTAL    = vec3(0.310, 0.765, 0.969);
const vec3 C_CRYSTAL_HI = vec3(0.404, 0.910, 0.976);
`;

/**
 * دوال المنطقة: تحوّل موقع العالم إلى «كم فيه من غسق».
 * Zone helpers. `duskSigned` is metres east of the terminator (negative = daylight).
 */
export const ZONE_GLSL = /* glsl */ `
uniform float uDuskX;
uniform float uBandHalf;
uniform float uSoftness;
uniform float uTime;

float duskSigned(float worldX) {
  return worldX - uDuskX;
}

// 0 = ليل كامل، 1 = نهار كامل
float dayFactor(float worldX) {
  float d = duskSigned(worldX);
  return 1.0 - smoothstep(-uBandHalf - uSoftness, uBandHalf + uSoftness, d);
}

// ذروة عند خط الغسق نفسه — تستخدم للوهج البنفسجي
float terminatorGlow(float worldX) {
  float d = abs(duskSigned(worldX));
  return 1.0 - smoothstep(0.0, uBandHalf * 1.6, d);
}

// لون الأرضية الأساسي حسب الموقع
vec3 zoneGround(float worldX) {
  float day = dayFactor(worldX);
  float glow = terminatorGlow(worldX);
  vec3 night = mix(C_NIGHT_DEEP, C_NIGHT_HI, 0.5);
  vec3 base = mix(night, C_SAND_LIT, day);
  base = mix(base, C_DUSK_MAG, glow * 0.34);
  return base;
}
`;

/** جيوب الضوء والظل التي يصنعها اللاعبون / player-made light and shadow pockets. */
export const POCKETS_GLSL = /* glsl */ `
#define MAX_POCKETS 12
uniform int uPocketCount;
// xyz = الموقع، w = نصف القطر (موجب = مرآة، سالب = برج ظل)
uniform vec4 uPockets[MAX_POCKETS];

// يعيد (إضاءة إضافية، تعتيم)
vec2 samplePockets(vec3 worldPos) {
  float add = 0.0;
  float sub = 0.0;
  for (int i = 0; i < MAX_POCKETS; i++) {
    if (i >= uPocketCount) break;
    vec4 pocket = uPockets[i];
    float radius = abs(pocket.w);
    if (radius < 0.01) continue;
    float d = distance(worldPos.xz, pocket.xz);
    float influence = 1.0 - smoothstep(radius * 0.35, radius, d);
    if (pocket.w > 0.0) add = max(add, influence);
    else sub = max(sub, influence);
  }
  return vec2(add, sub);
}
`;

/** ضجيج بسيط للخامات الإجرائية / cheap hash noise for procedural texturing. */
export const NOISE_GLSL = /* glsl */ `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm2(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += valueNoise(p) * amp;
    p *= 2.03;
    amp *= 0.5;
  }
  return sum;
}
`;

/** تصحيح ألوان بسيط + أوضاع عمى الألوان / tone shaping and colour-blind modes. */
export const GRADE_GLSL = /* glsl */ `
uniform int uColorBlindMode;

vec3 applyColorBlindMode(vec3 color) {
  if (uColorBlindMode == 1) {
    // بروتانوبيا: نقوّي التمييز بين الذهبي والبنفسجي
    return vec3(color.r * 0.56 + color.g * 0.44, color.g * 0.58 + color.r * 0.42, color.b);
  } else if (uColorBlindMode == 2) {
    return vec3(color.r * 0.62 + color.g * 0.38, color.g * 0.70 + color.r * 0.30, color.b);
  } else if (uColorBlindMode == 3) {
    return vec3(color.r, color.g * 0.67 + color.b * 0.33, color.b * 0.57 + color.g * 0.43);
  }
  return color;
}

vec3 tonemap(vec3 color) {
  color = max(vec3(0.0), color);
  // ACES تقريبية / cheap ACES-ish filmic curve
  vec3 a = color * (2.51 * color + 0.03);
  vec3 b = color * (2.43 * color + 0.59) + 0.14;
  return clamp(a / b, 0.0, 1.0);
}
`;
