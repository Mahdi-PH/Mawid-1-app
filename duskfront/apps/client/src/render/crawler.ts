/**
 * القلعة الزاحفة: قاعدة الفريق المتحركة العملاقة، بنواة مكشوفة عند الضعف.
 * The crawling fortress — the silhouette that dominates the reference art. Built
 * procedurally from boxes and emissive strips, with a core that opens up (and starts
 * glowing red) once integrity drops below the exposure threshold.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  SphereGeometry,
  TorusGeometry,
  type Object3D,
} from 'three';
import { balance, type CrawlerState, type TeamId } from '@duskfront/shared';
import { PALETTE, teamColor } from './palette.js';

const C = balance.crawler;

export class CrawlerView {
  readonly group = new Group();
  readonly team: TeamId;
  private readonly core: Mesh;
  private readonly coreHalo: Mesh;
  private readonly coreLight: PointLight;
  private readonly shieldDome: Mesh;
  private readonly strips: Mesh[] = [];
  private readonly treads: Mesh[] = [];
  private readonly warningLights: Mesh[] = [];
  private readonly disposables: { dispose(): void }[] = [];

  constructor(team: TeamId) {
    this.team = team;
    this.group.name = `crawler_${team}`;
    const accent = new Color(teamColor(team));

    // القلعة معلَم يُرى من مئات الأمتار: تحتاج انبعاثًا خاصًا بها لا ضوء الشمس وحده
    const hullMaterial = new MeshStandardMaterial({
      color: new Color(0x424a68),
      emissive: new Color(0x1a2038),
      emissiveIntensity: 0.9,
      roughness: 0.68,
      metalness: 0.55,
      flatShading: true,
    });
    const plateMaterial = new MeshStandardMaterial({
      color: new Color(0x5a648c),
      emissive: accent.clone().multiplyScalar(0.1),
      roughness: 0.55,
      metalness: 0.7,
      flatShading: true,
    });
    const stripMaterial = new MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.9 });
    this.disposables.push(hullMaterial, plateMaterial, stripMaterial);

    // 1) الهيكل الأساسي
    const hullGeometry = new BoxGeometry(C.halfLength * 2, C.height * 0.55, C.halfWidth * 2);
    this.disposables.push(hullGeometry);
    const hull = new Mesh(hullGeometry, hullMaterial);
    hull.position.y = C.height * 0.32;
    hull.castShadow = true;
    hull.receiveShadow = true;
    this.group.add(hull);

    // 2) الطبقة العلوية المدرّجة (مدينة فوق القلعة)
    const tiers = 3;
    for (let i = 0; i < tiers; i++) {
      const shrink = 1 - (i + 1) * 0.19;
      const geometry = new BoxGeometry(C.halfLength * 2 * shrink, C.height * 0.2, C.halfWidth * 2 * shrink);
      this.disposables.push(geometry);
      const tier = new Mesh(geometry, plateMaterial);
      tier.position.y = C.height * (0.6 + i * 0.19);
      tier.castShadow = true;
      this.group.add(tier);
    }

    // 3) أبراج جانبية
    const towerGeometry = new CylinderGeometry(3.4, 4.6, C.height * 0.78, 6);
    const spireGeometry = new ConeGeometry(3.6, 14, 6);
    this.disposables.push(towerGeometry, spireGeometry);
    for (const sx of [-0.72, 0.72]) {
      for (const sz of [-0.68, 0.68]) {
        const tower = new Mesh(towerGeometry, plateMaterial);
        tower.position.set(C.halfLength * sx, C.height * 0.7, C.halfWidth * sz);
        tower.castShadow = true;
        this.group.add(tower);
        const spire = new Mesh(spireGeometry, hullMaterial);
        spire.position.set(C.halfLength * sx, C.height * 1.16, C.halfWidth * sz);
        this.group.add(spire);
      }
    }

    // 4) أشرطة ضوء تعرّف الفريق من بعيد
    const stripGeometry = new BoxGeometry(C.halfLength * 1.86, 0.9, 0.5);
    this.disposables.push(stripGeometry);
    for (let i = 0; i < 4; i++) {
      const strip = new Mesh(stripGeometry, stripMaterial);
      const level = C.height * (0.2 + i * 0.22);
      strip.position.set(0, level, i % 2 === 0 ? C.halfWidth + 0.3 : -C.halfWidth - 0.3);
      this.group.add(strip);
      this.strips.push(strip);
    }

    // 5) الجنازير
    const treadGeometry = new BoxGeometry(C.halfLength * 2.06, 7, 9);
    this.disposables.push(treadGeometry);
    const treadMaterial = new MeshStandardMaterial({ color: new Color(0x15182a), roughness: 0.95, metalness: 0.2 });
    this.disposables.push(treadMaterial);
    for (const sz of [-1, 1]) {
      const tread = new Mesh(treadGeometry, treadMaterial);
      tread.position.set(0, 3.2, (C.halfWidth - 5) * sz);
      tread.castShadow = true;
      this.group.add(tread);
      this.treads.push(tread);
    }

    // 6) النواة + هالتها + درعها
    const coreGeometry = new IcosahedronGeometry(C.core.radius, 1);
    const coreMaterial = new MeshStandardMaterial({
      color: accent.clone(),
      emissive: accent.clone(),
      emissiveIntensity: 1.4,
      roughness: 0.25,
      metalness: 0.6,
      flatShading: true,
    });
    this.disposables.push(coreGeometry, coreMaterial);
    this.core = new Mesh(coreGeometry, coreMaterial);
    this.core.position.y = C.height * 0.55;
    this.group.add(this.core);

    const haloGeometry = new TorusGeometry(C.core.radius * 1.7, 0.7, 8, 32);
    const haloMaterial = new MeshBasicMaterial({
      color: accent.clone(),
      transparent: true,
      opacity: 0.6,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.disposables.push(haloGeometry, haloMaterial);
    this.coreHalo = new Mesh(haloGeometry, haloMaterial);
    this.coreHalo.position.copy(this.core.position);
    this.coreHalo.rotation.x = Math.PI / 2;
    this.group.add(this.coreHalo);

    this.coreLight = new PointLight(accent.getHex(), 2.4, 220, 2);
    this.coreLight.position.copy(this.core.position);
    this.group.add(this.coreLight);

    const shieldGeometry = new SphereGeometry(C.core.radius * 2.6, 20, 14);
    const shieldMaterial = new MeshBasicMaterial({
      color: new Color(PALETTE.techCyan),
      transparent: true,
      opacity: 0.0,
      blending: AdditiveBlending,
      depthWrite: false,
      wireframe: true,
    });
    this.disposables.push(shieldGeometry, shieldMaterial);
    this.shieldDome = new Mesh(shieldGeometry, shieldMaterial);
    this.shieldDome.position.copy(this.core.position);
    this.group.add(this.shieldDome);

    // 7) أضواء إنذار تشتعل عندما تخرج القلعة من الشفق
    const warnGeometry = new SphereGeometry(1.2, 8, 6);
    this.disposables.push(warnGeometry);
    for (const sx of [-0.9, 0, 0.9]) {
      const warnMaterial = new MeshBasicMaterial({ color: new Color(PALETTE.hudDanger), transparent: true, opacity: 0 });
      this.disposables.push(warnMaterial);
      const light = new Mesh(warnGeometry, warnMaterial);
      light.position.set(C.halfLength * sx * 0.8, C.height * 1.22, 0);
      this.group.add(light);
      this.warningLights.push(light);
    }
  }

  addTo(parent: Object3D): void {
    parent.add(this.group);
  }

  /** يحدّث المظهر من حالة القلعة الموثوقة. */
  update(state: CrawlerState, elapsed: number, matchTimeSec: number): void {
    this.group.position.set(state.position.x, state.position.y, state.position.z);

    const integrity = state.integrity / C.integrityMax;
    const exposed = state.integrity <= C.core.exposedAfterIntegrity;
    const danger = state.zone !== 'dusk';

    // النواة تنبض أسرع كلما ضعفت، وتتحول إلى الأحمر عندما تُكشف
    const pulse = 0.85 + 0.15 * Math.sin(elapsed * (exposed ? 7 : 2.4));
    const coreMaterial = this.core.material as MeshStandardMaterial;
    const target = exposed ? new Color(PALETTE.hudDanger) : new Color(teamColor(this.team));
    coreMaterial.emissive.lerp(target, 0.06);
    coreMaterial.emissiveIntensity = (exposed ? 2.6 : 1.3) * pulse;
    this.core.rotation.y += 0.004;
    this.core.scale.setScalar(exposed ? 1.18 : 1);
    this.coreHalo.rotation.z += exposed ? 0.02 : 0.006;
    (this.coreHalo.material as MeshBasicMaterial).opacity = 0.35 + (exposed ? 0.45 : 0.15) * pulse;
    this.coreLight.intensity = (exposed ? 4.2 : 2.2) * pulse;
    this.coreLight.color.copy(coreMaterial.emissive);

    // درع النواة المشترى بلومِن الفريق
    const shielded = state.coreShieldUntil > matchTimeSec;
    const shieldMaterial = this.shieldDome.material as MeshBasicMaterial;
    shieldMaterial.opacity += ((shielded ? 0.4 : 0) - shieldMaterial.opacity) * 0.1;
    this.shieldDome.rotation.y += 0.01;

    // الأشرطة تخفت كلما تآكلت المتانة
    for (let i = 0; i < this.strips.length; i++) {
      const strip = this.strips[i]!;
      const material = strip.material as MeshBasicMaterial;
      material.opacity = 0.2 + integrity * 0.75;
    }

    // إنذار الخروج من الشفق
    const blink = danger ? 0.35 + 0.65 * Math.abs(Math.sin(elapsed * 5)) : 0;
    for (const light of this.warningLights) {
      (light.material as MeshBasicMaterial).opacity = blink;
    }

    // حركة الجنازير
    for (const tread of this.treads) {
      tread.position.y = 3.2 + Math.sin(elapsed * 2.2 + tread.position.z * 0.1) * 0.12;
    }
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
    this.group.clear();
  }
}
