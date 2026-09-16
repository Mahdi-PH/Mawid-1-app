/**
 * الشخصيات والبنى: جنود بدروع متوهّجة، مرايا تعكس الشمس، أبراج ظل، جدران فجر.
 * Player rigs and player-built structures. Everything is generated in code — no asset
 * pipeline — and tinted by team so friend and foe read instantly at distance.
 */
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector3,
} from 'three';
import {
  balance,
  type ClassKey,
  type PlayerPublicState,
  type StructureState,
  type TeamId,
} from '@duskfront/shared';
import { PALETTE, css, teamColor } from './palette.js';

const P = balance.player;

/** ملامح بصرية لكل صنف حتى يُعرف من بعيد. */
const CLASS_LOOK: Record<ClassKey, { bulk: number; helmet: number; accent: number }> = {
  guardian: { bulk: 1.18, helmet: 1.12, accent: PALETTE.hudAmber },
  sunshot: { bulk: 0.94, helmet: 0.96, accent: PALETTE.sunDeep },
  nightstalker: { bulk: 0.88, helmet: 0.9, accent: PALETTE.duskMagenta },
  engineer: { bulk: 1.05, helmet: 1.0, accent: PALETTE.techTeal },
};

export class PlayerView {
  readonly group = new Group();
  readonly id: string;
  private readonly body: Mesh;
  private readonly helmet: Mesh;
  private readonly visor: Mesh;
  private readonly backpack: Mesh;
  private readonly packRing: Mesh;
  private readonly weapon: Group;
  private readonly muzzleFlash: Mesh;
  private readonly outline: Mesh;
  private readonly nameplate: Sprite;
  private readonly rimLight: PointLight;
  private readonly disposables: { dispose(): void }[] = [];
  private nameplateKey = '';
  private classKey: ClassKey;
  private team: TeamId;
  private muzzleUntil = 0;

  constructor(id: string, team: TeamId, classKey: ClassKey, isLocal: boolean) {
    this.id = id;
    this.team = team;
    this.classKey = classKey;
    this.group.name = `player_${id}`;

    const look = CLASS_LOOK[classKey];
    const accent = new Color(look.accent);
    /*
      انبعاث خافت بلون الفريق: في العتمة تصبح الخامة القياسية سوداء تمامًا،
      فيختفي الجندي بصريًا. هذا يبقيه مقروءًا دون أن يضيء ما حوله.
    */
    const armorMaterial = new MeshStandardMaterial({
      color: new Color(team === 0 ? 0x6d6450 : 0x454d73),
      emissive: accent.clone().multiplyScalar(0.16),
      roughness: 0.58,
      metalness: 0.52,
      flatShading: true,
    });
    const accentMaterial = new MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.95 });
    this.disposables.push(armorMaterial, accentMaterial);

    // الجسم
    const bodyGeometry = new CapsuleGeometry(P.radius * look.bulk, P.height * 0.46, 4, 10);
    this.disposables.push(bodyGeometry);
    this.body = new Mesh(bodyGeometry, armorMaterial);
    this.body.position.y = P.height * 0.5;
    this.body.castShadow = true;
    this.group.add(this.body);

    // الخوذة والزجاج المتوهّج
    const helmetGeometry = new BoxGeometry(0.42 * look.helmet, 0.36 * look.helmet, 0.46 * look.helmet);
    this.disposables.push(helmetGeometry);
    this.helmet = new Mesh(helmetGeometry, armorMaterial);
    this.helmet.position.y = P.height * 0.9;
    this.helmet.castShadow = true;
    this.group.add(this.helmet);

    const visorGeometry = new BoxGeometry(0.34 * look.helmet, 0.12, 0.06);
    this.disposables.push(visorGeometry);
    this.visor = new Mesh(visorGeometry, accentMaterial);
    this.visor.position.set(0, P.height * 0.9, -0.24 * look.helmet);
    this.group.add(this.visor);

    // حقيبة الظهر بحلقة طاقة (كما في اللوحة المرجعية)
    const packGeometry = new BoxGeometry(0.46, 0.52, 0.26);
    this.disposables.push(packGeometry);
    this.backpack = new Mesh(packGeometry, armorMaterial);
    this.backpack.position.set(0, P.height * 0.62, 0.3);
    this.group.add(this.backpack);

    const ringGeometry = new TorusGeometry(0.17, 0.05, 8, 18);
    this.disposables.push(ringGeometry);
    this.packRing = new Mesh(ringGeometry, accentMaterial);
    this.packRing.position.set(0, P.height * 0.62, 0.44);
    this.group.add(this.packRing);

    // السلاح
    this.weapon = buildWeapon(classKey, accent, this.disposables);
    this.weapon.position.set(0.28, P.height * 0.64, -0.3);
    this.group.add(this.weapon);

    const flashGeometry = new ConeGeometry(0.16, 0.5, 6);
    const flashMaterial = new MeshBasicMaterial({
      color: new Color(PALETTE.sunCore),
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.disposables.push(flashGeometry, flashMaterial);
    this.muzzleFlash = new Mesh(flashGeometry, flashMaterial);
    this.muzzleFlash.rotation.x = -Math.PI / 2;
    this.muzzleFlash.position.set(0, 0, -0.85);
    this.weapon.add(this.muzzleFlash);

    // إطار خارجي للكشف (العلامة الحرارية / الأعداء المرصودون)
    const outlineGeometry = new CapsuleGeometry(P.radius * look.bulk * 1.14, P.height * 0.5, 4, 10);
    const outlineMaterial = new MeshBasicMaterial({
      color: new Color(PALETTE.hudDanger),
      side: BackSide,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.disposables.push(outlineGeometry, outlineMaterial);
    this.outline = new Mesh(outlineGeometry, outlineMaterial);
    this.outline.position.y = P.height * 0.5;
    this.group.add(this.outline);

    // لوحة الاسم والصحة
    this.nameplate = createNameplate('', 1, team);
    this.nameplate.position.y = P.height + 0.55;
    this.group.add(this.nameplate);
    this.disposables.push(this.nameplate.material as SpriteMaterial);

    this.rimLight = new PointLight(accent.getHex(), isLocal ? 0.6 : 0.35, 9, 2);
    this.rimLight.position.set(0, P.height * 0.6, 0);
    this.group.add(this.rimLight);

    this.group.visible = false;
  }

  /** يعيد بناء الشخصية عند تبديل الصنف. */
  get currentClass(): ClassKey {
    return this.classKey;
  }

  triggerMuzzleFlash(now: number): void {
    this.muzzleUntil = now + 0.07;
  }

  update(options: {
    state: PlayerPublicState;
    now: number;
    isLocal: boolean;
    localTeam: TeamId;
    nameplateVisible: boolean;
    firstPerson: boolean;
    /** المسافة إلى الكاميرا — تُستخدم لتثبيت حجم لوحة الاسم على الشاشة */
    cameraDistance: number;
  }): void {
    const { state, now, isLocal, localTeam } = options;
    this.team = state.team;

    this.group.visible = state.alive && !(isLocal && options.firstPerson);
    if (!this.group.visible) return;

    this.group.position.set(state.position.x, state.position.y, state.position.z);
    this.group.rotation.y = state.yaw;

    // الانحناء والميل
    const crouchScale = state.crouching ? 0.72 : 1;
    this.body.scale.y = crouchScale;
    this.helmet.position.y = P.height * (state.crouching ? 0.68 : 0.9);
    this.visor.position.y = this.helmet.position.y;
    this.weapon.position.y = P.height * (state.crouching ? 0.48 : 0.64);
    this.weapon.rotation.x = -state.pitch;

    // مشية بسيطة: تمايل حسب السرعة الأفقية
    const speed = Math.hypot(state.velocity.x, state.velocity.z);
    const bob = Math.sin(now * 9 * Math.min(1, speed / 5)) * Math.min(0.06, speed * 0.012);
    this.body.position.y = P.height * 0.5 * crouchScale + bob;
    this.packRing.rotation.z += 0.05 + speed * 0.01;

    // التخفي: الجسم يصبح شبحًا
    const cloaked = state.cloaked;
    const friendly = state.team === localTeam;
    const bodyMaterial = this.body.material as MeshStandardMaterial;
    const targetOpacity = cloaked ? (friendly || isLocal ? 0.3 : 0.06) : 1;
    bodyMaterial.transparent = targetOpacity < 1;
    bodyMaterial.opacity += (targetOpacity - bodyMaterial.opacity) * 0.25;
    (this.helmet.material as MeshStandardMaterial).opacity = bodyMaterial.opacity;

    // الوهج حسب مستوى الضوء عند اللاعب
    const accentMaterial = this.visor.material as MeshBasicMaterial;
    accentMaterial.opacity = 0.45 + (1 - state.light) * 0.55;
    this.rimLight.intensity = (isLocal ? 0.5 : 0.3) + (1 - state.light) * 0.8;

    // إطار الكشف: أحمر للمعلَّم، أزرق للحليف خلف الجدار
    const outlineMaterial = this.outline.material as MeshBasicMaterial;
    const outlineTarget = state.marked && !friendly ? 0.55 : friendly && !isLocal ? 0.12 : 0;
    outlineMaterial.color.setHex(state.marked && !friendly ? PALETTE.hudDanger : teamColor(state.team));
    outlineMaterial.opacity += (outlineTarget - outlineMaterial.opacity) * 0.2;

    // وميض الفوهة
    const flashMaterial = this.muzzleFlash.material as MeshBasicMaterial;
    flashMaterial.opacity = now < this.muzzleUntil ? 0.9 : Math.max(0, flashMaterial.opacity - 0.12);

    // لوحة الاسم
    const healthRatio = state.maxHealth > 0 ? state.health / state.maxHealth : 0;
    const key = `${state.name}|${Math.round(healthRatio * 12)}|${state.team}`;
    if (key !== this.nameplateKey) {
      this.nameplateKey = key;
      updateNameplate(this.nameplate, state.name, healthRatio, state.team);
    }
    /*
      اللوحة تُرسم بلا اختبار عمق، فلو بقي حجمها ثابتًا في الفضاء لملأت الشاشة
      عند الاقتراب. نكبّرها خطيًا مع المسافة ليثبت حجمها الظاهري، ونخفيها في
      الاشتباك القريب حيث تحجب الرؤية ولا تضيف معلومة.
    */
    const distance = options.cameraDistance;
    const nameplateScale = Math.min(9, Math.max(1, distance * 0.13));
    this.nameplate.scale.set(2.6 * nameplateScale, 0.73 * nameplateScale, 1);
    this.nameplate.visible = options.nameplateVisible && !isLocal && distance > 5 && distance < 180;
    this.nameplate.position.y = P.height * (state.crouching ? 0.8 : 1) + 0.55 + nameplateScale * 0.16;
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
    this.group.clear();
  }
}

function buildWeapon(classKey: ClassKey, accent: Color, disposables: { dispose(): void }[]): Group {
  const group = new Group();
  const metal = new MeshStandardMaterial({ color: new Color(0x23262f), roughness: 0.5, metalness: 0.75, flatShading: true });
  const glow = new MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.9 });
  disposables.push(metal, glow);

  const isSniper = classKey === 'sunshot';
  const length = isSniper ? 1.5 : classKey === 'guardian' ? 0.9 : 1.15;
  const bodyGeometry = new BoxGeometry(0.11, 0.16, length);
  disposables.push(bodyGeometry);
  const body = new Mesh(bodyGeometry, metal);
  body.position.z = -length * 0.35;
  group.add(body);

  const coilGeometry = new TorusGeometry(0.1, 0.03, 6, 12);
  disposables.push(coilGeometry);
  for (let i = 0; i < 3; i++) {
    const coil = new Mesh(coilGeometry, glow);
    coil.rotation.y = Math.PI / 2;
    coil.position.z = -length * (0.45 + i * 0.16);
    group.add(coil);
  }

  const stockGeometry = new BoxGeometry(0.1, 0.2, 0.3);
  disposables.push(stockGeometry);
  const stock = new Mesh(stockGeometry, metal);
  stock.position.z = 0.16;
  group.add(stock);

  if (isSniper) {
    const scopeGeometry = new CylinderGeometry(0.05, 0.05, 0.36, 8);
    disposables.push(scopeGeometry);
    const scope = new Mesh(scopeGeometry, metal);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.14, -0.3);
    group.add(scope);
  }
  return group;
}

/** لوحة اسم مرسومة على canvas — رخيصة ومقروءة بالعربية والإنجليزية. */
function createNameplate(name: string, healthRatio: number, team: TeamId): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 72;
  const texture = new CanvasTexture(canvas);
  const material = new SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new Sprite(material);
  sprite.scale.set(2.6, 0.73, 1);
  sprite.renderOrder = 900;
  sprite.userData.canvas = canvas;
  sprite.userData.texture = texture;
  drawNameplate(canvas, texture, name, healthRatio, team);
  return sprite;
}

function updateNameplate(sprite: Sprite, name: string, healthRatio: number, team: TeamId): void {
  const canvas = sprite.userData.canvas as HTMLCanvasElement;
  const texture = sprite.userData.texture as CanvasTexture;
  drawNameplate(canvas, texture, name, healthRatio, team);
}

function drawNameplate(
  canvas: HTMLCanvasElement,
  texture: CanvasTexture,
  name: string,
  healthRatio: number,
  team: TeamId,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.font = '600 30px "Tajawal", "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 8;
  ctx.fillStyle = '#f3f6ff';
  ctx.fillText(name, canvas.width / 2, 24, canvas.width - 16);

  ctx.shadowBlur = 0;
  const barWidth = 190;
  const barX = (canvas.width - barWidth) / 2;
  ctx.fillStyle = 'rgba(8,12,28,0.72)';
  ctx.fillRect(barX - 2, 46, barWidth + 4, 12);
  ctx.fillStyle = css(teamColor(team));
  ctx.fillRect(barX, 48, barWidth * Math.max(0, Math.min(1, healthRatio)), 8);
  texture.needsUpdate = true;
}

/** تمثيل بصري للبنى التي ينشرها اللاعبون. */
export class StructureView {
  readonly group = new Group();
  readonly id: string;
  readonly kind: StructureState['kind'];
  private readonly beam: Mesh | null = null;
  private readonly disposables: { dispose(): void }[] = [];

  constructor(state: StructureState) {
    this.id = state.id;
    this.kind = state.kind;
    this.group.name = `structure_${state.id}`;
    const accent = new Color(teamColor(state.team));

    if (state.kind === 'mirror') {
      const frameGeometry = new CylinderGeometry(balance.structures.mirror.radius, balance.structures.mirror.radius, 0.14, 6);
      const frameMaterial = new MeshStandardMaterial({
        color: new Color(0xdfe7ff),
        roughness: 0.08,
        metalness: 1,
        flatShading: true,
      });
      this.disposables.push(frameGeometry, frameMaterial);
      const plate = new Mesh(frameGeometry, frameMaterial);
      plate.rotation.x = Math.PI / 2;
      plate.position.y = balance.structures.mirror.height;
      plate.castShadow = true;
      this.group.add(plate);

      const postGeometry = new CylinderGeometry(0.12, 0.2, balance.structures.mirror.height, 6);
      const postMaterial = new MeshStandardMaterial({ color: new Color(0x33384d), roughness: 0.7, metalness: 0.5 });
      this.disposables.push(postGeometry, postMaterial);
      const post = new Mesh(postGeometry, postMaterial);
      post.position.y = balance.structures.mirror.height / 2;
      this.group.add(post);

      // شعاع الضوء المنعكس
      const beamGeometry = new CylinderGeometry(
        balance.light.mirrorBeamWidth * 0.25,
        balance.light.mirrorBeamWidth * 0.75,
        balance.light.mirrorBeamLength,
        14,
        1,
        true,
      );
      const beamMaterial = new MeshBasicMaterial({
        color: new Color(PALETTE.sunDisc),
        transparent: true,
        opacity: 0.22,
        blending: AdditiveBlending,
        depthWrite: false,
        side: 2,
      });
      this.disposables.push(beamGeometry, beamMaterial);
      this.beam = new Mesh(beamGeometry, beamMaterial);
      this.beam.rotation.x = Math.PI / 2;
      this.beam.position.set(0, balance.structures.mirror.height, -balance.light.mirrorBeamLength / 2);
      this.group.add(this.beam);

      const light = new PointLight(PALETTE.sunDisc, 1.6, balance.light.mirrorRadius * 1.6, 2);
      light.position.y = balance.structures.mirror.height;
      this.group.add(light);
    } else if (state.kind === 'shadow_tower') {
      const isTemporary = (state.meta?.temporary ?? 0) > 0;
      const radius = state.radius ?? balance.light.shadowRadius;
      const pylonGeometry = new ConeGeometry(balance.structures.shadow_tower.radius, balance.structures.shadow_tower.height, 6);
      const pylonMaterial = new MeshStandardMaterial({
        color: new Color(0x181a2c),
        emissive: new Color(PALETTE.duskDeep),
        emissiveIntensity: 0.6,
        roughness: 0.85,
        metalness: 0.3,
        flatShading: true,
      });
      this.disposables.push(pylonGeometry, pylonMaterial);
      if (!isTemporary) {
        const pylon = new Mesh(pylonGeometry, pylonMaterial);
        pylon.position.y = balance.structures.shadow_tower.height / 2;
        pylon.castShadow = true;
        this.group.add(pylon);
      }

      const domeGeometry = new CylinderGeometry(radius, radius * 0.82, 0.9, 24, 1, true);
      const domeMaterial = new MeshBasicMaterial({
        color: new Color(PALETTE.duskDeep),
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        side: 2,
      });
      this.disposables.push(domeGeometry, domeMaterial);
      const dome = new Mesh(domeGeometry, domeMaterial);
      dome.position.y = isTemporary ? 1.6 : balance.structures.shadow_tower.height * 0.9;
      this.group.add(dome);
    } else if (state.kind === 'dawn_wall') {
      const wall = balance.classes.guardian.abilities.f;
      const geometry = new PlaneGeometry(wall.length, wall.height);
      const material = new MeshBasicMaterial({
        color: new Color(PALETTE.sunDisc),
        transparent: true,
        opacity: 0.4,
        blending: AdditiveBlending,
        depthWrite: false,
        side: 2,
      });
      this.disposables.push(geometry, material);
      const plane = new Mesh(geometry, material);
      plane.position.y = wall.height / 2;
      this.group.add(plane);
      const light = new PointLight(PALETTE.sunHalo, 2.2, wall.length * 2, 2);
      light.position.y = wall.height / 2;
      this.group.add(light);
    } else {
      // نسخة وهمية: شبح بلون الفريق
      const geometry = new CapsuleGeometry(P.radius, P.height * 0.5, 4, 8);
      const material = new MeshBasicMaterial({
        color: accent,
        transparent: true,
        opacity: 0.35,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      this.disposables.push(geometry, material);
      const ghost = new Mesh(geometry, material);
      ghost.position.y = P.height * 0.5;
      this.group.add(ghost);
    }
  }

  update(state: StructureState, elapsed: number): void {
    this.group.position.set(state.position.x, state.position.y, state.position.z);
    this.group.rotation.y = state.yaw;
    if (this.kind === 'mirror') {
      this.group.children[0]!.rotation.z = elapsed * 0.4;
      if (this.beam) {
        (this.beam.material as MeshBasicMaterial).opacity = 0.16 + 0.08 * Math.sin(elapsed * 2.4);
      }
    } else if (this.kind === 'decoy') {
      this.group.children[0]!.position.y = P.height * 0.5 + Math.sin(elapsed * 6) * 0.05;
    }
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
    this.group.clear();
  }
}

export function attach(parent: Object3D, child: Object3D): void {
  parent.add(child);
}

export const TMP_VEC3 = new Vector3();
