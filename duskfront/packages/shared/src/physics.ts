/**
 * محرّك حركة الشخصية المشترك.
 * Shared character controller — the exact same code runs inside the authoritative
 * server tick and inside the client's local prediction, which is what makes
 * reconciliation converge instead of fighting itself.
 *
 * ملاحظة تصميمية: استُبدلت Rapier بمحرّك مصغّر حتمي (انظر README قسم «تعديلات مقترحة»)
 * لأن التنبؤ/التصحيح يتطلب نتيجة متطابقة بت-ببت بين Node والمتصفّح.
 */
import { balance } from './balance.js';
import { clamp, clamp01 } from './math.js';
import { MAP_HALF, getObstacles, raycastTerrain, terrainHeight, type BoxObstacle } from './terrain.js';
import { InputButton, type InputCommand, type PlayerMotionState, type Vec3 } from './types.js';

const P = balance.player;
const MAP = balance.map;

export interface MoveParams {
  /** سرعة الصنف الأساسية م/ث */
  baseSpeed: number;
  /** مضاعف مؤقت (مثل تعزيز التخفي) */
  speedMultiplier: number;
  canSprint: boolean;
  canJump: boolean;
}

export interface StepResult {
  /** سرعة السقوط لحظة الهبوط، لحساب ضرر السقوط */
  landingSpeed: number;
  /** هل اصطدم أفقيًا هذا الإطار */
  bumped: boolean;
}

/** فهرس مكاني بسيط للعوائق / uniform-grid broadphase over static + dynamic boxes. */
export class CollisionWorld {
  private readonly cellSize = 32;
  private readonly cells = new Map<number, BoxObstacle[]>();
  private dynamic: BoxObstacle[] = [];

  constructor(staticBoxes: readonly BoxObstacle[] = getObstacles()) {
    for (const box of staticBoxes) this.insert(box);
  }

  private key(cx: number, cz: number): number {
    return (cx + 4096) * 100000 + (cz + 4096);
  }

  private insert(box: BoxObstacle): void {
    const reach = Math.max(box.half.x, box.half.z) + 2;
    const minX = Math.floor((box.center.x - reach) / this.cellSize);
    const maxX = Math.floor((box.center.x + reach) / this.cellSize);
    const minZ = Math.floor((box.center.z - reach) / this.cellSize);
    const maxZ = Math.floor((box.center.z + reach) / this.cellSize);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const k = this.key(cx, cz);
        let bucket = this.cells.get(k);
        if (!bucket) {
          bucket = [];
          this.cells.set(k, bucket);
        }
        bucket.push(box);
      }
    }
  }

  /** العوائق المتحركة (القلاع، جدران الفجر، المرايا) تُستبدل كل تحديث. */
  setDynamic(boxes: BoxObstacle[]): void {
    this.dynamic = boxes;
  }

  getDynamic(): readonly BoxObstacle[] {
    return this.dynamic;
  }

  /** العوائق القريبة من نقطة / candidate boxes near a point. */
  query(x: number, z: number, radius: number): BoxObstacle[] {
    const out: BoxObstacle[] = [];
    const minX = Math.floor((x - radius) / this.cellSize);
    const maxX = Math.floor((x + radius) / this.cellSize);
    const minZ = Math.floor((z - radius) / this.cellSize);
    const maxZ = Math.floor((z + radius) / this.cellSize);
    const seen = new Set<string>();
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const bucket = this.cells.get(this.key(cx, cz));
        if (!bucket) continue;
        for (const b of bucket) {
          if (seen.has(b.id)) continue;
          seen.add(b.id);
          out.push(b);
        }
      }
    }
    for (const b of this.dynamic) {
      const reach = Math.max(b.half.x, b.half.z) + radius;
      if (Math.abs(b.center.x - x) <= reach && Math.abs(b.center.z - z) <= reach) out.push(b);
    }
    return out;
  }

  allBoxesNearSegment(origin: Vec3, dir: Vec3, maxDist: number): BoxObstacle[] {
    const mid = { x: origin.x + dir.x * maxDist * 0.5, z: origin.z + dir.z * maxDist * 0.5 };
    return this.query(mid.x, mid.z, maxDist * 0.5 + 40);
  }
}

/** تحويل نقطة إلى الفضاء المحلي لصندوق مُدار / world point → box local space. */
function toLocal(box: BoxObstacle, x: number, y: number, z: number): Vec3 {
  const dx = x - box.center.x;
  const dz = z - box.center.z;
  const c = Math.cos(-box.yaw);
  const s = Math.sin(-box.yaw);
  return { x: dx * c - dz * s, y: y - box.center.y, z: dx * s + dz * c };
}

function toWorldDelta(box: BoxObstacle, lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(box.yaw);
  const s = Math.sin(box.yaw);
  return { x: lx * c - lz * s, z: lx * s + lz * c };
}

/**
 * يدفع أسطوانة اللاعب خارج صندوق.
 * Push a capsule-ish cylinder out of an oriented box; returns true when it landed
 * on top of the box (so bridges and crawler decks are walkable surfaces).
 */
function resolveAgainstBox(
  position: Vec3,
  velocity: Vec3,
  radius: number,
  height: number,
  box: BoxObstacle,
): { landed: boolean; bumped: boolean } {
  const local = toLocal(box, position.x, position.y, position.z);
  const feet = local.y;
  const head = local.y + height;
  const boxBottom = -box.half.y;
  const boxTop = box.half.y;
  if (head <= boxBottom || feet >= boxTop) return { landed: false, bumped: false };

  const cx = clamp(local.x, -box.half.x, box.half.x);
  const cz = clamp(local.z, -box.half.z, box.half.z);
  let dx = local.x - cx;
  let dz = local.z - cz;
  let distSq = dx * dx + dz * dz;
  const inside = distSq < 1e-8;
  if (!inside && distSq > radius * radius) return { landed: false, bumped: false };

  // الهبوط على السطح العلوي / land on the deck when arriving from above
  const topPenetration = boxTop - feet;
  if (velocity.y <= 0.001 && topPenetration >= 0 && topPenetration <= P.maxStepHeight + 0.35) {
    position.y = box.center.y + boxTop;
    if (velocity.y < 0) velocity.y = 0;
    return { landed: true, bumped: false };
  }

  // الارتطام بالسقف / bonk the underside
  const bottomPenetration = head - boxBottom;
  if (velocity.y > 0 && bottomPenetration >= 0 && bottomPenetration < 0.4) {
    position.y = box.center.y + boxBottom - height - 0.01;
    velocity.y = 0;
    return { landed: false, bumped: true };
  }

  // دفع أفقي / horizontal push-out
  if (inside) {
    const penX = box.half.x + radius - Math.abs(local.x);
    const penZ = box.half.z + radius - Math.abs(local.z);
    if (penX < penZ) {
      dx = Math.sign(local.x) || 1;
      dz = 0;
      distSq = 0;
    } else {
      dx = 0;
      dz = Math.sign(local.z) || 1;
      distSq = 0;
    }
  }
  const dist = Math.sqrt(distSq);
  const nx = dist > 1e-6 ? dx / dist : dx;
  const nz = dist > 1e-6 ? dz / dist : dz;
  const push = radius - dist;
  const world = toWorldDelta(box, nx * push, nz * push);
  position.x += world.x;
  position.z += world.z;

  // إزالة مركّبة السرعة الداخلة في الجدار / kill inward velocity
  const worldNormal = toWorldDelta(box, nx, nz);
  const vn = velocity.x * worldNormal.x + velocity.z * worldNormal.z;
  if (vn < 0) {
    velocity.x -= worldNormal.x * vn;
    velocity.z -= worldNormal.z * vn;
  }
  return { landed: false, bumped: true };
}

/** يطبّق الاحتكاك الأرضي / ground friction (Quake-style, frame-rate independent). */
function applyFriction(velocity: Vec3, dt: number): void {
  const speed = Math.hypot(velocity.x, velocity.z);
  if (speed < 0.02) {
    velocity.x = 0;
    velocity.z = 0;
    return;
  }
  const scale = Math.max(0, 1 - P.friction * dt);
  velocity.x *= scale;
  velocity.z *= scale;
}

/**
 * تسريع باتجاه الرغبة دون تجاوز السرعة القصوى.
 * Classic projected acceleration: only the component of velocity *along* the wish
 * direction is capped, so the controller reaches exactly `wishSpeed` no matter the
 * tick rate — which is what keeps the 20 Hz server and a 144 Hz client in agreement.
 */
function accelerate(velocity: Vec3, wishX: number, wishZ: number, wishSpeed: number, accel: number, dt: number): void {
  if (wishSpeed <= 0) return;
  const current = velocity.x * wishX + velocity.z * wishZ;
  const add = wishSpeed - current;
  if (add <= 0) return;
  const accelSpeed = Math.min(accel * dt * wishSpeed, add);
  velocity.x += wishX * accelSpeed;
  velocity.z += wishZ * accelSpeed;
}

/**
 * خطوة واحدة من حركة اللاعب.
 * Advance one player by a single input command. Mutates `state` in place.
 */
export function stepCharacter(
  state: PlayerMotionState,
  input: InputCommand,
  params: MoveParams,
  world: CollisionWorld,
  dtOverride?: number,
): StepResult {
  const dt = clamp(dtOverride ?? input.dt, 1 / 240, 1 / 15);
  const buttons = input.buttons;
  const wantsCrouch = (buttons & InputButton.Crouch) !== 0;
  const wantsSprint = (buttons & InputButton.Sprint) !== 0 && params.canSprint;
  const wantsAim = (buttons & InputButton.Aim) !== 0;
  const wantsJump = (buttons & InputButton.Jump) !== 0 && params.canJump;

  state.yaw = input.yaw;
  state.pitch = clamp(input.pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
  state.crouching = wantsCrouch && state.grounded;

  let speed = params.baseSpeed * params.speedMultiplier;
  if (state.crouching) speed *= P.crouchMultiplier;
  else if (wantsSprint) speed *= P.sprintMultiplier;
  if (wantsAim && !wantsSprint) speed *= P.adsMultiplier;

  // اتجاه الرغبة في الحركة بالنسبة لزاوية النظر
  let mx = input.moveX;
  let mz = input.moveZ;
  const magnitude = Math.hypot(mx, mz);
  if (magnitude > 1) {
    mx /= magnitude;
    mz /= magnitude;
  }
  const sin = Math.sin(state.yaw);
  const cos = Math.cos(state.yaw);
  const wishX = mx * cos - mz * sin;
  const wishZ = -mx * sin - mz * cos;

  if (state.grounded) applyFriction(state.velocity, dt);
  const wishLength = Math.hypot(wishX, wishZ);
  if (wishLength > 1e-5) {
    const nx = wishX / wishLength;
    const nz = wishZ / wishLength;
    const wishSpeed = speed * Math.min(1, wishLength);
    const accel = state.grounded ? P.groundAccel : P.airAccel * P.airControl;
    accelerate(state.velocity, nx, nz, wishSpeed, accel, dt);
  }

  if (wantsJump && state.grounded) {
    state.velocity.y = P.jumpSpeed;
    state.grounded = false;
  }

  state.velocity.y += P.gravity * dt;

  const previousVy = state.velocity.y;
  state.position.x += state.velocity.x * dt;
  state.position.y += state.velocity.y * dt;
  state.position.z += state.velocity.z * dt;

  // حدود الخريطة / hard map bounds
  const lim = MAP_HALF - MAP.borderMargin * 0.5;
  state.position.x = clamp(state.position.x, -lim, lim);
  state.position.z = clamp(state.position.z, -lim, lim);

  // اصطدام العوائق / obstacle resolution (two passes settles corners)
  let bumped = false;
  let landedOnBox = false;
  const radius = P.radius;
  const height = state.crouching ? P.crouchEyeHeight + 0.2 : P.height;
  for (let pass = 0; pass < 2; pass++) {
    const nearby = world.query(state.position.x, state.position.z, radius + 2);
    for (const box of nearby) {
      if (!box.solid) continue;
      const r = resolveAgainstBox(state.position, state.velocity, radius, height, box);
      if (r.landed) landedOnBox = true;
      if (r.bumped) bumped = true;
    }
  }

  // اصطدام التضاريس / terrain collision + step-up
  const ground = terrainHeight(state.position.x, state.position.z);
  let landingSpeed = 0;
  if (state.position.y <= ground) {
    if (!state.grounded && previousVy < -P.fallDamageMinSpeed) landingSpeed = -previousVy;
    state.position.y = ground;
    if (state.velocity.y < 0) state.velocity.y = 0;
    state.grounded = true;
  } else if (landedOnBox) {
    if (!state.grounded && previousVy < -P.fallDamageMinSpeed) landingSpeed = -previousVy;
    state.grounded = true;
  } else {
    state.grounded = state.position.y - ground <= 0.08;
  }

  state.lastSeq = input.seq;
  return { landingSpeed, bumped };
}

export interface RaycastHit {
  distance: number;
  point: Vec3;
  kind: 'terrain' | 'obstacle';
  obstacleId?: string;
}

/** تقاطع شعاع مع العالم الساكن (تضاريس + عوائق). */
export function raycastWorld(
  origin: Vec3,
  dir: Vec3,
  maxDist: number,
  world: CollisionWorld,
): RaycastHit | null {
  let best = raycastTerrain(origin, dir, maxDist);
  let kind: 'terrain' | 'obstacle' = 'terrain';
  let obstacleId: string | undefined;
  if (best < 0) best = Number.POSITIVE_INFINITY;

  for (const box of world.allBoxesNearSegment(origin, dir, maxDist)) {
    if (!box.solid) continue;
    const t = rayObb(origin, dir, box, Math.min(best, maxDist));
    if (t >= 0 && t < best) {
      best = t;
      kind = 'obstacle';
      obstacleId = box.id;
    }
  }
  if (!Number.isFinite(best) || best > maxDist) return null;
  return {
    distance: best,
    point: { x: origin.x + dir.x * best, y: origin.y + dir.y * best, z: origin.z + dir.z * best },
    kind,
    obstacleId,
  };
}

/** تقاطع شعاع مع صندوق مُدار حول المحور Y. */
export function rayObb(origin: Vec3, dir: Vec3, box: BoxObstacle, maxDist: number): number {
  const c = Math.cos(-box.yaw);
  const s = Math.sin(-box.yaw);
  const ox = origin.x - box.center.x;
  const oz = origin.z - box.center.z;
  const lo = { x: ox * c - oz * s, y: origin.y - box.center.y, z: ox * s + oz * c };
  const ld = { x: dir.x * c - dir.z * s, y: dir.y, z: dir.x * s + dir.z * c };

  let tmin = 0;
  let tmax = maxDist;
  const o = [lo.x, lo.y, lo.z];
  const d = [ld.x, ld.y, ld.z];
  const h = [box.half.x, box.half.y, box.half.z];
  for (let i = 0; i < 3; i++) {
    const di = d[i]!;
    const oi = o[i]!;
    const hi = h[i]!;
    if (Math.abs(di) < 1e-9) {
      if (oi < -hi || oi > hi) return -1;
      continue;
    }
    const inv = 1 / di;
    let t1 = (-hi - oi) * inv;
    let t2 = (hi - oi) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin;
}

/** خط رؤية بين نقطتين / straightforward line-of-sight test. */
export function hasLineOfSight(from: Vec3, to: Vec3, world: CollisionWorld): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-4) return true;
  const dir = { x: dx / dist, y: dy / dist, z: dz / dist };
  const hit = raycastWorld(from, dir, dist - 0.2, world);
  return hit === null;
}

/** مسار قذيفة (قنبلة) بخطوات ثابتة / ballistic projectile integration for grenades. */
export function stepProjectile(
  position: Vec3,
  velocity: Vec3,
  dt: number,
  world: CollisionWorld,
  bounce: number,
): { hitSurface: boolean } {
  velocity.y += P.gravity * dt;
  const nx = position.x + velocity.x * dt;
  const ny = position.y + velocity.y * dt;
  const nz = position.z + velocity.z * dt;
  const ground = terrainHeight(nx, nz);
  let hitSurface = false;

  if (ny <= ground) {
    position.x = nx;
    position.z = nz;
    position.y = ground;
    velocity.y = -velocity.y * bounce;
    velocity.x *= bounce;
    velocity.z *= bounce;
    hitSurface = true;
    return { hitSurface };
  }

  for (const box of world.query(nx, nz, 1.2)) {
    if (!box.solid) continue;
    const local = toLocal(box, nx, ny, nz);
    if (
      Math.abs(local.x) < box.half.x + 0.25 &&
      Math.abs(local.z) < box.half.z + 0.25 &&
      local.y > -box.half.y - 0.25 &&
      local.y < box.half.y + 0.25
    ) {
      velocity.x *= -bounce;
      velocity.y *= -bounce;
      velocity.z *= -bounce;
      hitSurface = true;
      return { hitSurface };
    }
  }

  position.x = nx;
  position.y = ny;
  position.z = nz;
  return { hitSurface };
}
