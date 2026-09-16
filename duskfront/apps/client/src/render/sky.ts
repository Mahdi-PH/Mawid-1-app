/**
 * السماء: تدرّج ذهبي → بنفسجي → أزرق داكن، وشمس وقمر ونجوم تظهر في العتمة،
 * وستارة ضوء عمودية عند خط الغسق تمامًا كما في اللوحة المرجعية.
 * The sky dome. One shader paints the whole arc from a molten western horizon,
 * through the magenta terminator curtain, into a star-filled indigo east.
 */
import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Mesh,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { balance } from '@duskfront/shared';
import { NOISE_GLSL, PALETTE_GLSL, ZONE_GLSL } from './shader-chunks.js';

const SKY_RADIUS = 6000;

const vertexShader = /* glsl */ `
varying vec3 vWorldDir;
varying vec3 vLocal;
void main() {
  vLocal = position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldDir = normalize(world.xyz - cameraPosition);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
${PALETTE_GLSL}
${ZONE_GLSL}
${NOISE_GLSL}

uniform vec3 uSunDirection;
uniform vec3 uMoonDirection;
uniform float uCameraX;
uniform float uStarDensity;
uniform float uExposure;

varying vec3 vWorldDir;
varying vec3 vLocal;

// نجوم إجرائية على قبة السماء
float starField(vec3 dir, float density) {
  vec2 uv = vec2(atan(dir.z, dir.x) * 1.9, asin(clamp(dir.y, -1.0, 1.0)) * 2.4);
  vec2 cell = floor(uv * 130.0);
  float rnd = hash21(cell);
  if (rnd > density) return 0.0;
  vec2 local = fract(uv * 130.0) - 0.5;
  float star = 1.0 - smoothstep(0.0, 0.16, length(local));
  float twinkle = 0.65 + 0.35 * sin(uTime * (1.4 + rnd * 4.0) + rnd * 40.0);
  return star * twinkle * (0.35 + rnd * 0.9);
}

void main() {
  vec3 dir = normalize(vWorldDir);
  float elevation = clamp(dir.y, -1.0, 1.0);

  // نُسقط شعاع النظر على الأرض لنعرف أين يقع بالنسبة لخط الغسق
  float reach = 2600.0;
  float groundX = uCameraX + dir.x * reach;
  float signedDist = groundX - uDuskX;
  float day = 1.0 - smoothstep(-uBandHalf - 520.0, uBandHalf + 520.0, signedDist);
  float glow = 1.0 - smoothstep(0.0, uBandHalf + 340.0, abs(signedDist));

  // تدرّج رأسي: أفق ساخن، وذروة باردة
  float horizon = 1.0 - smoothstep(-0.04, 0.55, elevation);
  float zenith = smoothstep(0.1, 0.85, elevation);

  vec3 dayHorizon = mix(C_SUN_DEEP, C_SUN_DISC, horizon * 0.85);
  vec3 dayZenith = mix(C_SUN_HALO, C_DUSK_VIO, zenith);
  vec3 dayColor = mix(dayZenith, dayHorizon, horizon);

  vec3 nightHorizon = mix(C_NIGHT_DEEP, C_DUSK_PUR, horizon * 0.5);
  vec3 nightZenith = mix(C_NIGHT_MID, C_NIGHT_ABYS, zenith);
  vec3 nightColor = mix(nightZenith, nightHorizon, horizon);

  vec3 color = mix(nightColor, dayColor, day);

  // ستارة الغسق: وهج بنفسجي عمودي عند الحد الفاصل
  color += C_DUSK_MAG * glow * (0.30 + 0.55 * horizon);

  // النجوم تظهر كلما ابتعدنا شرقًا
  float nightAmount = 1.0 - day;
  float stars = starField(dir, uStarDensity) * smoothstep(0.15, 0.75, nightAmount) * smoothstep(-0.05, 0.25, elevation);
  color += vec3(0.75, 0.86, 1.0) * stars;

  // قرص الشمس وهالتها
  float sunAmount = max(dot(dir, normalize(uSunDirection)), 0.0);
  float sunDisc = smoothstep(0.9985, 0.99965, sunAmount);
  float sunHalo = pow(sunAmount, 22.0) * 0.55 + pow(sunAmount, 5.0) * 0.16;
  color += C_SUN_CORE * sunDisc * 3.2;
  color += C_SUN_HALO * sunHalo;

  // القمر
  float moonAmount = max(dot(dir, normalize(uMoonDirection)), 0.0);
  float moonDisc = smoothstep(0.9990, 0.99975, moonAmount);
  color += vec3(0.80, 0.86, 1.0) * moonDisc * 1.4;
  color += vec3(0.42, 0.52, 0.95) * pow(moonAmount, 40.0) * 0.28;

  // سحب رقيقة عالية
  float clouds = fbm2(vec2(dir.x * 2.4 + uTime * 0.004, dir.z * 2.4)) ;
  clouds = smoothstep(0.55, 0.92, clouds) * smoothstep(0.02, 0.4, elevation);
  color = mix(color, mix(C_DUSK_VIO, C_SUN_DISC, day), clouds * 0.22);

  gl_FragColor = vec4(color * uExposure, 1.0);
}
`;

export interface SkyUniforms {
  uDuskX: { value: number };
  uBandHalf: { value: number };
  uSoftness: { value: number };
  uTime: { value: number };
  uSunDirection: { value: Vector3 };
  uMoonDirection: { value: Vector3 };
  uCameraX: { value: number };
  uStarDensity: { value: number };
  uExposure: { value: number };
}

export class Sky {
  readonly mesh: Mesh;
  readonly uniforms: SkyUniforms;
  private readonly stars: Points;

  constructor(starCount: number) {
    this.uniforms = {
      uDuskX: { value: 0 },
      uBandHalf: { value: balance.dusk.bandWidth / 2 },
      uSoftness: { value: balance.dusk.terminatorSoftness },
      uTime: { value: 0 },
      uSunDirection: { value: new Vector3(-1, 0.3, -0.2) },
      uMoonDirection: { value: new Vector3(1, 0.35, 0.2) },
      uCameraX: { value: 0 },
      uStarDensity: { value: 0.02 },
      uExposure: { value: 1 },
    };

    const material = new ShaderMaterial({
      uniforms: this.uniforms as unknown as Record<string, { value: unknown }>,
      vertexShader,
      fragmentShader,
      side: BackSide,
      depthWrite: false,
      fog: false,
    });

    this.mesh = new Mesh(new SphereGeometry(SKY_RADIUS, 48, 32), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'sky';

    this.stars = buildStarSprites(starCount);
    this.mesh.add(this.stars);
  }

  addTo(scene: Scene): void {
    scene.add(this.mesh);
  }

  /** يحدّث السماء من حالة المباراة / drive the sky from the match clock. */
  update(options: {
    duskX: number;
    cameraPosition: Vector3;
    sunDirection: Vector3;
    elapsed: number;
    starDensity: number;
    exposure: number;
  }): void {
    this.uniforms.uDuskX.value = options.duskX;
    this.uniforms.uCameraX.value = options.cameraPosition.x;
    this.uniforms.uTime.value = options.elapsed;
    this.uniforms.uSunDirection.value.copy(options.sunDirection).normalize();
    this.uniforms.uMoonDirection.value.set(-options.sunDirection.x, Math.abs(options.sunDirection.y) * 0.7 + 0.25, -options.sunDirection.z).normalize();
    this.uniforms.uStarDensity.value = options.starDensity;
    this.uniforms.uExposure.value = options.exposure;
    this.mesh.position.set(options.cameraPosition.x, 0, options.cameraPosition.z);
    const starMaterial = this.stars.material as PointsMaterial;
    starMaterial.opacity = Math.min(1, options.starDensity * 26);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
    this.stars.geometry.dispose();
    (this.stars.material as PointsMaterial).dispose();
  }
}

/** نجوم ساطعة إضافية كنقاط، تعطي عمقًا فوق نجوم الشيدر. */
function buildStarSprites(count: number): Points {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const color = new Color();
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 0.86 + 0.06);
    const radius = SKY_RADIUS * 0.94;
    positions[i * 3] = Math.sin(phi) * Math.cos(theta) * radius;
    positions[i * 3 + 1] = Math.cos(phi) * radius;
    positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius;
    const warm = Math.random();
    color.setHSL(warm > 0.82 ? 0.09 : 0.58, 0.45, 0.72 + Math.random() * 0.25);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const material = new PointsMaterial({
    size: 26,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  return points;
}
