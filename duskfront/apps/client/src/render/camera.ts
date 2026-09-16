/**
 * كاميرا الشخص الثالث من فوق الكتف، مع تبديل الكتف وارتداد وتقريب عند التصويب.
 * Over-the-shoulder third-person camera with shoulder swap, recoil kick, aim zoom and
 * terrain-aware collision so the view never clips into a dune.
 */
import { PerspectiveCamera, Vector3 } from 'three';
import { balance, clamp, terrainHeight } from '@duskfront/shared';

const DEFAULT_DISTANCE = 4.6;
const AIM_DISTANCE = 2.6;
const SHOULDER_OFFSET = 0.78;
const HEIGHT_OFFSET = 1.55;

export interface CameraTarget {
  position: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  crouching: boolean;
}

export class ThirdPersonCamera {
  readonly camera: PerspectiveCamera;
  private shoulder: 1 | -1 = 1;
  private distance = DEFAULT_DISTANCE;
  private shakeAmount = 0;
  private shakeUntil = 0;
  private recoilPitch = 0;
  private readonly desired = new Vector3();
  private readonly lookAt = new Vector3();
  private firstPerson = false;
  private reducedShake = false;

  constructor(fov: number, aspect: number) {
    this.camera = new PerspectiveCamera(fov, aspect, 0.12, 9000);
    this.camera.position.set(0, 40, 0);
  }

  setFov(fov: number): void {
    this.camera.fov = clamp(fov, balance.graphics.fovMin, balance.graphics.fovMax);
    this.camera.updateProjectionMatrix();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  setReducedShake(reduced: boolean): void {
    this.reducedShake = reduced;
  }

  swapShoulder(): void {
    this.shoulder = this.shoulder === 1 ? -1 : 1;
  }

  toggleFirstPerson(): void {
    this.firstPerson = !this.firstPerson;
  }

  get isFirstPerson(): boolean {
    return this.firstPerson;
  }

  /** اهتزاز الشاشة عند الإصابة أو الانفجار (يحترم إعداد إمكانية الوصول). */
  shake(amount: number, durationSec: number, now: number): void {
    if (this.reducedShake) return;
    this.shakeAmount = Math.max(this.shakeAmount, amount);
    this.shakeUntil = Math.max(this.shakeUntil, now + durationSec);
  }

  /** ارتداد رأسي بعد الإطلاق. */
  addRecoil(amount: number): void {
    this.recoilPitch = Math.min(0.14, this.recoilPitch + amount * 0.0035);
  }

  update(target: CameraTarget, aiming: boolean, dt: number, now: number): void {
    const eyeHeight = target.crouching ? balance.player.crouchEyeHeight : HEIGHT_OFFSET;
    const wantedDistance = this.firstPerson ? 0 : aiming ? AIM_DISTANCE : DEFAULT_DISTANCE;
    this.distance += (wantedDistance - this.distance) * Math.min(1, dt * 9);

    const pitch = clamp(target.pitch - this.recoilPitch, -1.35, 1.35);
    const sinYaw = Math.sin(target.yaw);
    const cosYaw = Math.cos(target.yaw);
    const forwardX = -sinYaw * Math.cos(pitch);
    const forwardY = Math.sin(pitch);
    const forwardZ = -cosYaw * Math.cos(pitch);

    const shoulderX = cosYaw * SHOULDER_OFFSET * this.shoulder * (this.firstPerson ? 0 : 1);
    const shoulderZ = -sinYaw * SHOULDER_OFFSET * this.shoulder * (this.firstPerson ? 0 : 1);

    const anchorX = target.position.x + shoulderX;
    const anchorY = target.position.y + eyeHeight;
    const anchorZ = target.position.z + shoulderZ;

    this.desired.set(
      anchorX - forwardX * this.distance,
      anchorY - forwardY * this.distance,
      anchorZ - forwardZ * this.distance,
    );

    // لا تدفن الكاميرا داخل التضاريس
    const ground = terrainHeight(this.desired.x, this.desired.z) + 0.55;
    if (this.desired.y < ground) this.desired.y = ground;

    this.camera.position.lerp(this.desired, Math.min(1, dt * 16));

    this.lookAt.set(anchorX + forwardX * 60, anchorY + forwardY * 60, anchorZ + forwardZ * 60);
    this.camera.lookAt(this.lookAt);

    // الاهتزاز
    if (now < this.shakeUntil && this.shakeAmount > 0) {
      const remaining = (this.shakeUntil - now) / 0.35;
      const magnitude = this.shakeAmount * Math.min(1, remaining);
      this.camera.position.x += (Math.random() - 0.5) * magnitude;
      this.camera.position.y += (Math.random() - 0.5) * magnitude;
      this.camera.position.z += (Math.random() - 0.5) * magnitude;
    } else {
      this.shakeAmount = 0;
    }

    // استرجاع الارتداد
    this.recoilPitch = Math.max(0, this.recoilPitch - dt * 0.35);
  }

  /** موضع العين المستخدم في حساب اتجاه الإطلاق. */
  getAimRay(target: CameraTarget): { origin: Vector3; direction: Vector3 } {
    const eyeHeight = target.crouching ? balance.player.crouchEyeHeight : balance.player.eyeHeight;
    const origin = new Vector3(target.position.x, target.position.y + eyeHeight, target.position.z);
    const pitch = clamp(target.pitch - this.recoilPitch, -1.4, 1.4);
    const direction = new Vector3(
      -Math.sin(target.yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(target.yaw) * Math.cos(pitch),
    ).normalize();
    return { origin, direction };
  }
}
