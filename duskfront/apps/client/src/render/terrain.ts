/**
 * التضاريس: قطع (chunks) بمستويات تفصيل، وشيدر يعرف أين يقف خط الغسق.
 * Chunked terrain with distance LOD. The mesh is sampled from the *same* analytic
 * height function the server collides against, so the ground you see is the ground
 * you stand on — and the shader repaints it live as the terminator sweeps past.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Frustum,
  Group,
  Matrix4,
  Mesh,
  ShaderMaterial,
  Vector3,
  type Camera,
} from 'three';
import { MAP_HALF, MAP_SIZE, balance, riverCenterX, terrainHeight } from '@duskfront/shared';
import { NOISE_GLSL, PALETTE_GLSL, POCKETS_GLSL, ZONE_GLSL } from './shader-chunks.js';

const CHUNK = balance.map.chunkSize;
const CHUNKS_PER_SIDE = Math.round(MAP_SIZE / CHUNK);
const LOD = balance.graphics.lodDistances;

const vertexShader = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vSlope;
varying float vRiver;

attribute float aRiver;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vSlope = 1.0 - clamp(vNormal.y, 0.0, 1.0);
  vRiver = aRiver;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
${PALETTE_GLSL}
${ZONE_GLSL}
${POCKETS_GLSL}
${NOISE_GLSL}

uniform vec3 uSunDirection;
uniform vec3 uCameraPos;
uniform float uWaterLevel;
uniform float uFogDensity;
uniform vec3 uFogColorDay;
uniform vec3 uFogColorNight;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vSlope;
varying float vRiver;

void main() {
  float day = dayFactor(vWorldPos.x);
  float glow = terminatorGlow(vWorldPos.x);
  vec2 pockets = samplePockets(vWorldPos);
  float lightLevel = clamp(day + pockets.x * 0.9 - pockets.y * 0.85, 0.0, 1.0);

  // خامة إجرائية: رمل ناعم + صخر على المنحدرات
  float grain = fbm2(vWorldPos.xz * 0.055);
  float rock = smoothstep(0.30, 0.68, vSlope) ;
  vec3 sand = mix(C_SAND_DARK, C_SAND_LIT, grain);
  vec3 stone = mix(vec3(0.22, 0.20, 0.25), vec3(0.42, 0.37, 0.40), grain);
  vec3 albedo = mix(sand, stone, rock);

  // قاع الوادي: رماد داكن وبلورات
  float riverBed = smoothstep(0.35, 1.0, vRiver);
  albedo = mix(albedo, vec3(0.16, 0.17, 0.26), riverBed * 0.75);

  // إضاءة الشمس
  vec3 sunDir = normalize(uSunDirection);
  float ndl = max(dot(vNormal, sunDir), 0.0);
  float wrapped = ndl * 0.82 + 0.18;
  vec3 sunLight = mix(C_SUN_HALO, C_SUN_CORE, ndl) * wrapped * lightLevel * 1.55;

  // ضوء ليلي: سماء بنفسجية + توهّج البلورات من الأسفل
  float crystalGlow = smoothstep(0.55, 1.0, fbm2(vWorldPos.xz * 0.02 + 13.0)) * (1.0 - day);
  vec3 nightLight = mix(C_NIGHT_HI, C_NIGHT_MID, grain) * 0.9
                  + C_CRYSTAL * (0.10 + crystalGlow * 0.55) * (1.0 - lightLevel)
                  + C_DUSK_PUR * 0.14;

  vec3 color = albedo * (sunLight + nightLight);

  // خط الغسق نفسه: شريط بنفسجي حارق على الأرض
  color += C_DUSK_MAG * glow * 0.45 * (0.35 + grain * 0.6);

  // جيوب المرايا صفراء ساطعة، وأبراج الظل زرقاء باردة
  color += C_SUN_DISC * pockets.x * 0.85;
  color = mix(color, color * vec3(0.32, 0.38, 0.62), pockets.y * 0.75);

  // ماء/سائل في قاع النهر
  if (vWorldPos.y < uWaterLevel) {
    float depth = clamp((uWaterLevel - vWorldPos.y) * 0.22, 0.0, 1.0);
    vec3 liquid = mix(vec3(0.10, 0.30, 0.48), vec3(0.03, 0.08, 0.20), depth);
    color = mix(color, liquid + C_CRYSTAL * 0.25 * (1.0 - day), 0.72);
  }

  // ضباب جوي بلون المنطقة
  float dist = distance(vWorldPos, uCameraPos);
  float fog = 1.0 - exp(-dist * uFogDensity);
  vec3 fogColor = mix(uFogColorNight, uFogColorDay, day);
  fogColor = mix(fogColor, C_DUSK_MAG, glow * 0.55);
  color = mix(color, fogColor, clamp(fog, 0.0, 0.92));

  gl_FragColor = vec4(color, 1.0);
}
`;

export interface TerrainUniforms {
  uDuskX: { value: number };
  uBandHalf: { value: number };
  uSoftness: { value: number };
  uTime: { value: number };
  uSunDirection: { value: Vector3 };
  uCameraPos: { value: Vector3 };
  uWaterLevel: { value: number };
  uFogDensity: { value: number };
  uFogColorDay: { value: Color };
  uFogColorNight: { value: Color };
  uPocketCount: { value: number };
  uPockets: { value: Float32Array };
}

interface Chunk {
  ix: number;
  iz: number;
  centerX: number;
  centerZ: number;
  mesh: Mesh;
  lod: number;
  geometries: (BufferGeometry | null)[];
}

const MAX_POCKETS = 12;

export class Terrain {
  readonly group = new Group();
  readonly uniforms: TerrainUniforms;
  readonly material: ShaderMaterial;
  private readonly chunks: Chunk[] = [];
  private readonly frustum = new Frustum();
  private readonly projScreen = new Matrix4();
  private readonly resolutions: number[];

  constructor(tier: 'low' | 'medium' | 'high') {
    const verts = balance.map.chunkVerts[tier];
    this.resolutions = [verts, Math.max(9, Math.round(verts / 2)), Math.max(5, Math.round(verts / 4))];

    this.uniforms = {
      uDuskX: { value: 0 },
      uBandHalf: { value: balance.dusk.bandWidth / 2 },
      uSoftness: { value: balance.dusk.terminatorSoftness },
      uTime: { value: 0 },
      uSunDirection: { value: new Vector3(-1, 0.4, -0.2) },
      uCameraPos: { value: new Vector3() },
      uWaterLevel: { value: balance.map.waterLevel },
      uFogDensity: { value: 0.00085 },
      uFogColorDay: { value: new Color(0xffb37a) },
      uFogColorNight: { value: new Color(0x141a3a) },
      uPocketCount: { value: 0 },
      uPockets: { value: new Float32Array(MAX_POCKETS * 4) },
    };

    this.material = new ShaderMaterial({
      uniforms: this.uniforms as unknown as Record<string, { value: unknown }>,
      vertexShader,
      fragmentShader,
      side: DoubleSide,
    });

    this.group.name = 'terrain';
    this.buildChunks();
  }

  private buildChunks(): void {
    for (let iz = 0; iz < CHUNKS_PER_SIDE; iz++) {
      for (let ix = 0; ix < CHUNKS_PER_SIDE; ix++) {
        const centerX = -MAP_HALF + (ix + 0.5) * CHUNK;
        const centerZ = -MAP_HALF + (iz + 0.5) * CHUNK;
        const geometry = buildChunkGeometry(ix, iz, this.resolutions[2]!);
        const mesh = new Mesh(geometry, this.material);
        mesh.frustumCulled = true;
        mesh.name = `chunk_${ix}_${iz}`;
        this.group.add(mesh);
        this.chunks.push({
          ix,
          iz,
          centerX,
          centerZ,
          mesh,
          lod: 2,
          geometries: [null, null, geometry],
        });
      }
    }
  }

  /** يختار مستوى التفصيل حسب المسافة ويقصّ ما هو خارج مجال الرؤية. */
  update(camera: Camera, cameraPosition: Vector3): void {
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);

    for (const chunk of this.chunks) {
      const distance = Math.hypot(chunk.centerX - cameraPosition.x, chunk.centerZ - cameraPosition.z);
      const wanted = distance < LOD[0]! ? 0 : distance < LOD[1]! ? 1 : 2;
      if (wanted !== chunk.lod) {
        let geometry = chunk.geometries[wanted];
        if (!geometry) {
          geometry = buildChunkGeometry(chunk.ix, chunk.iz, this.resolutions[wanted]!);
          chunk.geometries[wanted] = geometry;
        }
        chunk.mesh.geometry = geometry;
        chunk.lod = wanted;
      }
      // إخفاء ما هو خلف الكاميرا تمامًا لتقليل نداءات الرسم
      chunk.mesh.visible = distance < LOD[2]! && this.frustum.intersectsObject(chunk.mesh);
    }
  }

  /** يمرّر مرايا اللاعبين وأبراج الظل إلى الشيدر. */
  setPockets(pockets: { x: number; y: number; z: number; radius: number; isShadow: boolean }[]): void {
    const data = this.uniforms.uPockets.value;
    const count = Math.min(pockets.length, MAX_POCKETS);
    for (let i = 0; i < count; i++) {
      const p = pockets[i]!;
      data[i * 4] = p.x;
      data[i * 4 + 1] = p.y;
      data[i * 4 + 2] = p.z;
      data[i * 4 + 3] = p.isShadow ? -p.radius : p.radius;
    }
    this.uniforms.uPocketCount.value = count;
  }

  get drawCallEstimate(): number {
    return this.chunks.filter((c) => c.mesh.visible).length;
  }

  dispose(): void {
    for (const chunk of this.chunks) {
      for (const geometry of chunk.geometries) geometry?.dispose();
    }
    this.material.dispose();
    this.chunks.length = 0;
    this.group.clear();
  }
}

/** يبني شبكة قطعة واحدة بأخذ عيّنات من دالة الارتفاع التحليلية. */
function buildChunkGeometry(ix: number, iz: number, resolution: number): BufferGeometry {
  const originX = -MAP_HALF + ix * CHUNK;
  const originZ = -MAP_HALF + iz * CHUNK;
  const step = CHUNK / (resolution - 1);

  const vertexCount = resolution * resolution;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const river = new Float32Array(vertexCount);

  for (let z = 0; z < resolution; z++) {
    for (let x = 0; x < resolution; x++) {
      const index = z * resolution + x;
      const worldX = originX + x * step;
      const worldZ = originZ + z * step;
      const height = terrainHeight(worldX, worldZ);
      positions[index * 3] = worldX;
      positions[index * 3 + 1] = height;
      positions[index * 3 + 2] = worldZ;

      const hL = terrainHeight(worldX - step, worldZ);
      const hR = terrainHeight(worldX + step, worldZ);
      const hD = terrainHeight(worldX, worldZ - step);
      const hU = terrainHeight(worldX, worldZ + step);
      const nx = hL - hR;
      const nz = hD - hU;
      const ny = 2 * step;
      const length = Math.hypot(nx, ny, nz) || 1;
      normals[index * 3] = nx / length;
      normals[index * 3 + 1] = ny / length;
      normals[index * 3 + 2] = nz / length;

      const distanceToRiver = Math.abs(worldX - riverCenterX(worldZ));
      river[index] = 1 - Math.min(1, distanceToRiver / balance.map.riverHalfWidth);
    }
  }

  const indices = new Uint32Array((resolution - 1) * (resolution - 1) * 6);
  let cursor = 0;
  for (let z = 0; z < resolution - 1; z++) {
    for (let x = 0; x < resolution - 1; x++) {
      const a = z * resolution + x;
      const b = a + 1;
      const c = a + resolution;
      const d = c + 1;
      indices[cursor++] = a;
      indices[cursor++] = c;
      indices[cursor++] = b;
      indices[cursor++] = b;
      indices[cursor++] = c;
      indices[cursor++] = d;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setAttribute('aRiver', new BufferAttribute(river, 1));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}
