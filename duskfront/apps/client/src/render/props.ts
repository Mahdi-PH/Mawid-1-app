/**
 * عناصر الخريطة الثابتة: أطلال المدينة، حقل البلورات، الجسور، وآبار اللومِن.
 * Static map dressing, all instanced: one draw call per family instead of hundreds.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  CylinderGeometry,
  Color,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  RingGeometry,
  ShaderMaterial,
  TorusGeometry,
  Vector3,
} from 'three';
import { balance, getBridges, getCrystals, getRuins, terrainHeight, type TeamId } from '@duskfront/shared';
import { PALETTE, teamColor } from './palette.js';
import { PALETTE_GLSL, ZONE_GLSL } from './shader-chunks.js';

/** شيدر البلورات: تتوهّج كلما غرقت في العتمة. */
const crystalVertex = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vNormal;
void main() {
  vec4 world = instanceMatrix * vec4(position, 1.0);
  vWorldPos = (modelMatrix * world).xyz;
  vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * world;
}
`;

const crystalFragment = /* glsl */ `
precision highp float;
${PALETTE_GLSL}
${ZONE_GLSL}
uniform vec3 uCameraPos;
varying vec3 vWorldPos;
varying vec3 vNormal;

void main() {
  float day = dayFactor(vWorldPos.x);
  float night = 1.0 - day;
  vec3 viewDir = normalize(uCameraPos - vWorldPos);
  float fresnel = pow(1.0 - max(dot(viewDir, normalize(vNormal)), 0.0), 2.2);

  vec3 core = mix(C_CRYSTAL, C_CRYSTAL_HI, fresnel);
  float pulse = 0.72 + 0.28 * sin(uTime * 1.7 + vWorldPos.x * 0.08 + vWorldPos.z * 0.05);
  vec3 color = core * (0.28 + night * 1.75 * pulse) + C_DUSK_VIO * fresnel * 0.5;
  // في وضح النهار تبدو كزجاج بارد بدل مصباح
  color = mix(color, mix(core, C_SUN_DISC, 0.35) * 0.9, day * 0.6);

  float dist = distance(vWorldPos, uCameraPos);
  float fade = 1.0 - smoothstep(520.0, 760.0, dist);
  gl_FragColor = vec4(color, 0.55 + 0.45 * night) * vec4(1.0, 1.0, 1.0, fade);
}
`;

export interface PropsUniformBridge {
  uDuskX: { value: number };
  uBandHalf: { value: number };
  uSoftness: { value: number };
  uTime: { value: number };
  uCameraPos: { value: Vector3 };
}

export class MapProps {
  readonly group = new Group();
  readonly crystalUniforms: PropsUniformBridge;
  private readonly wellRings: { mesh: Mesh; index: number }[] = [];
  private readonly disposables: { dispose(): void }[] = [];

  constructor(tier: 'low' | 'medium' | 'high') {
    const quality = balance.graphics[tier];
    this.group.name = 'props';

    this.crystalUniforms = {
      uDuskX: { value: 0 },
      uBandHalf: { value: balance.dusk.bandWidth / 2 },
      uSoftness: { value: balance.dusk.terminatorSoftness },
      uTime: { value: 0 },
      uCameraPos: { value: new Vector3() },
    };

    this.buildRuins(quality.ruinCount);
    this.buildCrystals(quality.crystalCount);
    this.buildBridges();
    this.buildWells();
  }

  /** أطلال المدينة: أربع عائلات، كل واحدة نداء رسم واحد. */
  private buildRuins(limit: number): void {
    const ruins = getRuins().slice(0, limit);
    const families: Record<string, typeof ruins> = { tower: [], slab: [], arch: [], shell: [] };
    for (const ruin of ruins) families[ruin.kind]!.push(ruin);

    const material = new MeshStandardMaterial({
      color: new Color(PALETTE.sandShadow),
      roughness: 0.92,
      metalness: 0.04,
      flatShading: true,
    });
    this.disposables.push(material);

    const dummy = new Object3D();
    for (const [kind, list] of Object.entries(families)) {
      if (list.length === 0) continue;
      const geometry = kind === 'arch' ? new TorusGeometry(0.5, 0.14, 6, 10, Math.PI) : new BoxGeometry(1, 1, 1);
      this.disposables.push(geometry);
      const mesh = new InstancedMesh(geometry, material, list.length);
      mesh.name = `ruins_${kind}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      for (let i = 0; i < list.length; i++) {
        const ruin = list[i]!;
        dummy.position.set(ruin.position.x, ruin.position.y + ruin.size.y / 2, ruin.position.z);
        dummy.rotation.set(0, ruin.yaw, kind === 'shell' ? 0.08 : 0);
        dummy.scale.set(ruin.size.x, ruin.size.y, ruin.size.z);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
    }
  }

  /** حقل البلورات المتوهّجة على ضفاف الوادي. */
  private buildCrystals(limit: number): void {
    const crystals = getCrystals().slice(0, limit);
    if (crystals.length === 0) return;
    const geometry = new IcosahedronGeometry(1, 0);
    const material = new ShaderMaterial({
      uniforms: this.crystalUniforms as unknown as Record<string, { value: unknown }>,
      vertexShader: crystalVertex,
      fragmentShader: crystalFragment,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.disposables.push(geometry, material);

    const mesh = new InstancedMesh(geometry, material, crystals.length);
    mesh.name = 'crystals';
    const dummy = new Object3D();
    for (let i = 0; i < crystals.length; i++) {
      const crystal = crystals[i]!;
      dummy.position.set(crystal.position.x, crystal.position.y + crystal.scale * 0.8, crystal.position.z);
      dummy.rotation.set(Math.random() * 0.4, crystal.yaw, Math.random() * 0.4);
      dummy.scale.set(crystal.scale * 0.55, crystal.scale * 1.9, crystal.scale * 0.55);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
  }

  /** الجسور التي تعبر الوادي — نفس الصناديق التي يصطدم بها الخادم. */
  private buildBridges(): void {
    const bridges = getBridges();
    if (bridges.length === 0) return;
    const deckMaterial = new MeshStandardMaterial({
      color: new Color(0x4a4a58),
      roughness: 0.8,
      metalness: 0.35,
      flatShading: true,
    });
    const railMaterial = new MeshBasicMaterial({ color: new Color(PALETTE.techCyan), transparent: true, opacity: 0.55 });
    const deckGeometry = new BoxGeometry(1, 1, 1);
    this.disposables.push(deckMaterial, railMaterial, deckGeometry);

    const dummy = new Object3D();
    const deck = new InstancedMesh(deckGeometry, deckMaterial, bridges.length);
    deck.name = 'bridge_decks';
    deck.castShadow = true;
    deck.receiveShadow = true;
    const rails = new InstancedMesh(deckGeometry, railMaterial, bridges.length * 2);
    rails.name = 'bridge_rails';

    for (let i = 0; i < bridges.length; i++) {
      const bridge = bridges[i]!;
      dummy.position.set(bridge.center.x, bridge.center.y, bridge.center.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(bridge.half.x * 2, bridge.half.y * 2, bridge.half.z * 2);
      dummy.updateMatrix();
      deck.setMatrixAt(i, dummy.matrix);

      for (let side = 0; side < 2; side++) {
        dummy.position.set(
          bridge.center.x,
          bridge.center.y + bridge.half.y + 0.7,
          bridge.center.z + (side === 0 ? bridge.half.z : -bridge.half.z),
        );
        dummy.scale.set(bridge.half.x * 2, 0.14, 0.14);
        dummy.updateMatrix();
        rails.setMatrixAt(i * 2 + side, dummy.matrix);
      }
    }
    deck.instanceMatrix.needsUpdate = true;
    rails.instanceMatrix.needsUpdate = true;
    this.group.add(deck, rails);
  }

  /** آبار اللومِن: حلقة أرضية + عمود ضوء يتلوّن بلون المالك. */
  private buildWells(): void {
    const ringGeometry = new RingGeometry(balance.wells.captureRadius * 0.82, balance.wells.captureRadius, 40);
    const pillarGeometry = new CylinderGeometry(1.5, 2.6, 26, 12, 1, true);
    this.disposables.push(ringGeometry, pillarGeometry);

    for (let i = 0; i < balance.wells.positions.length; i++) {
      const position = balance.wells.positions[i]!;
      const y = terrainHeight(position.x, position.z);

      const ringMaterial = new MeshBasicMaterial({
        color: new Color(PALETTE.hudNeutral),
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: AdditiveBlending,
      });
      const ring = new Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(position.x, y + 0.25, position.z);
      ring.name = `well_ring_${i}`;
      this.group.add(ring);
      this.disposables.push(ringMaterial);
      this.wellRings.push({ mesh: ring, index: i });

      const pillarMaterial = new MeshBasicMaterial({
        color: new Color(PALETTE.hudGold),
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        blending: AdditiveBlending,
        side: 2,
      });
      const pillar = new Mesh(pillarGeometry, pillarMaterial);
      pillar.position.set(position.x, y + 13, position.z);
      pillar.name = `well_pillar_${i}`;
      this.group.add(pillar);
      this.disposables.push(pillarMaterial);
    }
  }

  /** يلوّن حلقات الآبار حسب المالك وتقدّم الاستيلاء. */
  updateWells(wells: { owner: number; progress: number; capturingTeam: number }[]): void {
    for (const entry of this.wellRings) {
      const well = wells[entry.index];
      if (!well) continue;
      const material = entry.mesh.material as MeshBasicMaterial;
      if (well.owner >= 0) {
        material.color.setHex(teamColor(well.owner as TeamId));
        material.opacity = 0.7;
      } else if (well.capturingTeam >= 0 && well.progress > 0.01) {
        material.color.setHex(teamColor(well.capturingTeam as TeamId));
        material.opacity = 0.25 + well.progress * 0.45;
      } else {
        material.color.setHex(PALETTE.hudNeutral);
        material.opacity = 0.4;
      }
      entry.mesh.scale.setScalar(1 + Math.sin(performance.now() * 0.0018 + entry.index) * 0.02);
    }
  }

  update(elapsed: number, duskX: number, cameraPosition: Vector3): void {
    this.crystalUniforms.uTime.value = elapsed;
    this.crystalUniforms.uDuskX.value = duskX;
    this.crystalUniforms.uCameraPos.value.copy(cameraPosition);
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
    this.group.clear();
  }
}

/** مصفوفة مساعدة تُستخدم في الاختبارات. */
export const IDENTITY = new Matrix4();
