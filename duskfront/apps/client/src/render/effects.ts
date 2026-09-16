/**
 * المؤثرات: خطوط الرصاص، شرر الاصطدام، الانفجارات، وضربة الظهيرة المدارية.
 * Pooled visual effects — every effect reuses a fixed set of meshes so a firefight
 * never allocates, which is what keeps the frame time flat on a mid-range laptop.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  Points,
  PointsMaterial,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { balance, type Vec3, type WeaponKey } from '@duskfront/shared';
import { PALETTE } from './palette.js';

const MAX_TRACERS = 48;
const MAX_IMPACTS = 40;
const MAX_EXPLOSIONS = 10;
const MAX_STRIKES = 6;

interface Tracer {
  line: LineSegments;
  until: number;
}

interface Impact {
  points: Points;
  velocities: Float32Array;
  until: number;
  origin: Vector3;
}

interface Explosion {
  sphere: Mesh;
  ring: Mesh;
  light: PointLight;
  until: number;
  startedAt: number;
  radius: number;
}

interface StrikeMarker {
  ring: Mesh;
  beam: Mesh;
  at: number;
  active: boolean;
  radius: number;
}

export class Effects {
  readonly group = new Group();
  private readonly tracers: Tracer[] = [];
  private readonly impacts: Impact[] = [];
  private readonly explosions: Explosion[] = [];
  private readonly strikes: StrikeMarker[] = [];
  private readonly disposables: { dispose(): void }[] = [];
  private tracerCursor = 0;
  private impactCursor = 0;
  private explosionCursor = 0;

  constructor() {
    this.group.name = 'effects';
    this.buildTracers();
    this.buildImpacts();
    this.buildExplosions();
    this.buildStrikes();
  }

  private buildTracers(): void {
    for (let i = 0; i < MAX_TRACERS; i++) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(6), 3));
      const material = new LineBasicMaterial({
        color: new Color(PALETTE.hudGold),
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      this.disposables.push(geometry, material);
      const line = new LineSegments(geometry, material);
      line.frustumCulled = false;
      this.group.add(line);
      this.tracers.push({ line, until: 0 });
    }
  }

  private buildImpacts(): void {
    const count = 14;
    for (let i = 0; i < MAX_IMPACTS; i++) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
      const material = new PointsMaterial({
        color: new Color(PALETTE.sunDisc),
        size: 0.3,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      this.disposables.push(geometry, material);
      const points = new Points(geometry, material);
      points.frustumCulled = false;
      this.group.add(points);
      this.impacts.push({
        points,
        velocities: new Float32Array(count * 3),
        until: 0,
        origin: new Vector3(),
      });
    }
  }

  private buildExplosions(): void {
    const sphereGeometry = new SphereGeometry(1, 14, 10);
    const ringGeometry = new RingGeometry(0.85, 1, 28);
    this.disposables.push(sphereGeometry, ringGeometry);
    for (let i = 0; i < MAX_EXPLOSIONS; i++) {
      const sphereMaterial = new MeshBasicMaterial({
        color: new Color(PALETTE.sunHalo),
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const ringMaterial = new MeshBasicMaterial({
        color: new Color(PALETTE.sunCore),
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        side: 2,
      });
      this.disposables.push(sphereMaterial, ringMaterial);
      const sphere = new Mesh(sphereGeometry, sphereMaterial);
      const ring = new Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      const light = new PointLight(PALETTE.sunHalo, 0, 40, 2);
      sphere.visible = false;
      ring.visible = false;
      this.group.add(sphere, ring, light);
      this.explosions.push({ sphere, ring, light, until: 0, startedAt: 0, radius: 1 });
    }
  }

  private buildStrikes(): void {
    const ringGeometry = new RingGeometry(0.9, 1, 40);
    this.disposables.push(ringGeometry);
    const beamGeometry = new CylinderGeometry(1, 1, 400, 18, 1, true);
    this.disposables.push(beamGeometry);
    for (let i = 0; i < MAX_STRIKES; i++) {
      const ringMaterial = new MeshBasicMaterial({
        color: new Color(PALETTE.hudDanger),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: 2,
      });
      const beamMaterial = new MeshBasicMaterial({
        color: new Color(PALETTE.sunCore),
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        side: 2,
      });
      this.disposables.push(ringMaterial, beamMaterial);
      const ring = new Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      const beam = new Mesh(beamGeometry, beamMaterial);
      beam.visible = false;
      this.group.add(ring, beam);
      this.strikes.push({ ring, beam, at: 0, active: false, radius: 1 });
    }
  }

  /** خط رصاص من الفوهة إلى نقطة الاصطدام. */
  spawnTracer(from: Vec3, to: Vec3, weapon: WeaponKey, now: number): void {
    const tracer = this.tracers[this.tracerCursor]!;
    this.tracerCursor = (this.tracerCursor + 1) % MAX_TRACERS;
    const attribute = tracer.line.geometry.getAttribute('position') as BufferAttribute;
    attribute.setXYZ(0, from.x, from.y, from.z);
    attribute.setXYZ(1, to.x, to.y, to.z);
    attribute.needsUpdate = true;
    tracer.line.geometry.computeBoundingSphere();
    const material = tracer.line.material as LineBasicMaterial;
    const solar = weapon === 'beam_rifle' || weapon === 'lumen_cannon';
    material.color.setHex(solar ? PALETTE.sunDisc : PALETTE.hudCyan);
    material.opacity = weapon === 'beam_rifle' ? 1 : 0.75;
    material.linewidth = 2;
    tracer.until = now + (weapon === 'beam_rifle' ? 0.16 : 0.07);
  }

  /** شرر عند نقطة الإصابة. */
  spawnImpact(at: Vec3, now: number, color: number = PALETTE.sunDisc): void {
    const impact = this.impacts[this.impactCursor]!;
    this.impactCursor = (this.impactCursor + 1) % MAX_IMPACTS;
    const attribute = impact.points.geometry.getAttribute('position') as BufferAttribute;
    const count = attribute.count;
    impact.origin.set(at.x, at.y, at.z);
    for (let i = 0; i < count; i++) {
      attribute.setXYZ(i, at.x, at.y, at.z);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      const speed = 2 + Math.random() * 6;
      impact.velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
      impact.velocities[i * 3 + 1] = Math.abs(Math.cos(phi)) * speed;
      impact.velocities[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed;
    }
    attribute.needsUpdate = true;
    const material = impact.points.material as PointsMaterial;
    material.color.setHex(color);
    material.opacity = 1;
    impact.until = now + 0.45;
  }

  /** انفجار كروي مع حلقة صدمة. */
  spawnExplosion(at: Vec3, radius: number, now: number): void {
    const explosion = this.explosions[this.explosionCursor]!;
    this.explosionCursor = (this.explosionCursor + 1) % MAX_EXPLOSIONS;
    explosion.sphere.position.set(at.x, at.y + 0.6, at.z);
    explosion.ring.position.set(at.x, at.y + 0.3, at.z);
    explosion.light.position.set(at.x, at.y + 2, at.z);
    explosion.radius = radius;
    explosion.startedAt = now;
    explosion.until = now + 0.55;
    explosion.sphere.visible = true;
    explosion.ring.visible = true;
  }

  /** علامة ضربة الظهيرة قبل سقوطها. */
  syncStrikes(markers: { id: string; position: Vec3; at: number; radius: number }[], matchTime: number): void {
    for (let i = 0; i < this.strikes.length; i++) {
      const slot = this.strikes[i]!;
      const marker = markers[i];
      if (!marker) {
        slot.ring.visible = false;
        slot.beam.visible = false;
        slot.active = false;
        continue;
      }
      slot.active = true;
      slot.radius = marker.radius;
      slot.at = marker.at;
      slot.ring.visible = true;
      slot.ring.position.set(marker.position.x, marker.position.y + 0.4, marker.position.z);
      slot.ring.scale.setScalar(marker.radius);
      const remaining = Math.max(0, marker.at - matchTime);
      const urgency = 1 - Math.min(1, remaining / balance.classes.sunshot.abilities.f.delaySec);
      (slot.ring.material as MeshBasicMaterial).opacity = 0.35 + 0.5 * Math.abs(Math.sin(urgency * 14));
      slot.beam.visible = remaining < 0.25;
      slot.beam.position.set(marker.position.x, marker.position.y + 200, marker.position.z);
      slot.beam.scale.set(marker.radius * 0.6, 1, marker.radius * 0.6);
      (slot.beam.material as MeshBasicMaterial).opacity = slot.beam.visible ? 0.75 : 0;
    }
  }

  update(now: number, dt: number): void {
    for (const tracer of this.tracers) {
      const material = tracer.line.material as LineBasicMaterial;
      if (now > tracer.until) {
        if (material.opacity > 0) material.opacity = Math.max(0, material.opacity - dt * 8);
      }
    }

    for (const impact of this.impacts) {
      const material = impact.points.material as PointsMaterial;
      if (material.opacity <= 0) continue;
      const attribute = impact.points.geometry.getAttribute('position') as BufferAttribute;
      for (let i = 0; i < attribute.count; i++) {
        impact.velocities[i * 3 + 1]! -= 14 * dt;
        attribute.setXYZ(
          i,
          attribute.getX(i) + impact.velocities[i * 3]! * dt,
          attribute.getY(i) + impact.velocities[i * 3 + 1]! * dt,
          attribute.getZ(i) + impact.velocities[i * 3 + 2]! * dt,
        );
      }
      attribute.needsUpdate = true;
      material.opacity = Math.max(0, material.opacity - dt * 2.4);
    }

    for (const explosion of this.explosions) {
      if (!explosion.sphere.visible) continue;
      const progress = Math.min(1, (now - explosion.startedAt) / 0.55);
      const scale = explosion.radius * (0.25 + progress * 1.1);
      explosion.sphere.scale.setScalar(scale);
      explosion.ring.scale.setScalar(explosion.radius * (0.4 + progress * 2.2));
      (explosion.sphere.material as MeshBasicMaterial).opacity = (1 - progress) * 0.85;
      (explosion.ring.material as MeshBasicMaterial).opacity = (1 - progress) * 0.6;
      explosion.light.intensity = (1 - progress) * 24;
      if (progress >= 1) {
        explosion.sphere.visible = false;
        explosion.ring.visible = false;
        explosion.light.intensity = 0;
      }
    }
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
    this.group.clear();
  }
}
