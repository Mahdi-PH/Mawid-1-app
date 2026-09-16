/**
 * المدخلات: لوحة مفاتيح وفأرة + يد تحكم + لمس، بتخصيص كامل للأزرار.
 * Unified input. Every source funnels into one `InputFrame`, so the game loop never
 * knows (or cares) whether a command came from a keyboard, a gamepad or a thumb.
 */
import { InputButton, balance, clamp, type ControlSettings } from '@duskfront/shared';

export interface InputFrame {
  moveX: number;
  moveZ: number;
  lookDeltaYaw: number;
  lookDeltaPitch: number;
  buttons: number;
  /** ضغطات لحظية تُستهلك مرة واحدة */
  pressed: Set<string>;
}

export type ActionName =
  | 'moveForward' | 'moveBack' | 'moveLeft' | 'moveRight'
  | 'jump' | 'crouch' | 'sprint' | 'reload' | 'grenade'
  | 'abilityQ' | 'abilityE' | 'abilityF'
  | 'melee' | 'interact' | 'scoreboard' | 'ping' | 'commandWheel'
  | 'swapShoulder' | 'tacticalMap';

export const ACTIONS: ActionName[] = [
  'moveForward', 'moveBack', 'moveLeft', 'moveRight',
  'jump', 'crouch', 'sprint', 'reload', 'grenade',
  'abilityQ', 'abilityE', 'abilityF',
  'melee', 'interact', 'scoreboard', 'ping', 'commandWheel',
  'swapShoulder', 'tacticalMap',
];

export class InputManager {
  private readonly held = new Set<string>();
  private readonly pressedThisFrame = new Set<string>();
  private bindings: Record<string, string> = {};
  private reverse = new Map<string, ActionName>();
  private settings: ControlSettings;
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;
  private mouseButtons = 0;
  private pointerLocked = false;
  private wheelDelta = 0;
  private enabled = false;
  private captureTarget: HTMLElement | null = null;
  private gamepadIndex: number | null = null;
  private readonly touch: TouchState = {
    moveX: 0,
    moveZ: 0,
    lookX: 0,
    lookY: 0,
    buttons: 0,
    pressed: new Set<string>(),
    active: false,
  };

  constructor(settings: ControlSettings) {
    this.settings = settings;
    this.setBindings(settings.bindings);
  }

  setBindings(bindings: Record<string, string>): void {
    this.bindings = { ...bindings };
    this.reverse.clear();
    for (const [action, code] of Object.entries(this.bindings)) {
      this.reverse.set(code, action as ActionName);
    }
  }

  updateSettings(settings: ControlSettings): void {
    this.settings = settings;
    this.setBindings(settings.bindings);
  }

  getBinding(action: ActionName): string {
    return this.bindings[action] ?? '';
  }

  bind(action: ActionName, code: string): void {
    // امنع تكرار نفس الزر لأكثر من أمر
    for (const [other, existing] of Object.entries(this.bindings)) {
      if (existing === code && other !== action) delete this.bindings[other];
    }
    this.bindings[action] = code;
    this.setBindings(this.bindings);
  }

  get currentBindings(): Record<string, string> {
    return { ...this.bindings };
  }

  attach(target: HTMLElement): void {
    this.captureTarget = target;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    target.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    target.addEventListener('wheel', this.onWheel, { passive: true });
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('contextmenu', this.onContextMenu);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.captureTarget?.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.captureTarget?.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('contextmenu', this.onContextMenu);
    this.captureTarget = null;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.held.clear();
      this.mouseButtons = 0;
      this.mouseDeltaX = 0;
      this.mouseDeltaY = 0;
    }
  }

  requestPointerLock(): void {
    if (!this.captureTarget) return;
    // قد يرفضه المتصفّح أو سياسة الإطار؛ الرفض ليس خطأً — يتولّاه السحب للنظر
    try {
      const result = this.captureTarget.requestPointerLock?.() as unknown;
      if (result && typeof (result as Promise<void>).catch === 'function') {
        void (result as Promise<void>).catch(() => undefined);
      }
    } catch {
      /* السحب للنظر يغطّي هذه الحالة */
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  get isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  /** لقطة مدخلات هذا الإطار / consume one frame of input. */
  sample(aiming: boolean): InputFrame {
    const frame: InputFrame = {
      moveX: 0,
      moveZ: 0,
      lookDeltaYaw: 0,
      lookDeltaPitch: 0,
      buttons: 0,
      pressed: new Set(this.pressedThisFrame),
    };
    this.pressedThisFrame.clear();
    if (!this.enabled) return frame;

    // لوحة المفاتيح
    if (this.isActionHeld('moveForward')) frame.moveZ += 1;
    if (this.isActionHeld('moveBack')) frame.moveZ -= 1;
    if (this.isActionHeld('moveRight')) frame.moveX += 1;
    if (this.isActionHeld('moveLeft')) frame.moveX -= 1;

    if (this.isActionHeld('jump')) frame.buttons |= InputButton.Jump;
    if (this.isActionHeld('crouch')) frame.buttons |= InputButton.Crouch;
    if (this.isActionHeld('sprint')) frame.buttons |= InputButton.Sprint;
    if (this.isActionHeld('reload')) frame.buttons |= InputButton.Reload;
    if (this.isActionHeld('interact')) frame.buttons |= InputButton.Interact;

    if ((this.mouseButtons & 1) !== 0) frame.buttons |= InputButton.Fire;
    if ((this.mouseButtons & 2) !== 0) frame.buttons |= InputButton.Aim;

    // الفأرة
    const sensitivity = (aiming ? this.settings.adsSensitivity : this.settings.sensitivity) * 0.0022;
    frame.lookDeltaYaw -= this.mouseDeltaX * sensitivity;
    frame.lookDeltaPitch += this.mouseDeltaY * sensitivity * (this.settings.invertY ? 1 : -1);
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;

    // يد التحكم
    this.sampleGamepad(frame, aiming);

    // اللمس
    if (this.touch.active) {
      frame.moveX += this.touch.moveX;
      frame.moveZ += this.touch.moveZ;
      const touchSensitivity = (aiming ? this.settings.adsSensitivity : this.settings.sensitivity) * 0.006;
      frame.lookDeltaYaw -= this.touch.lookX * touchSensitivity;
      frame.lookDeltaPitch += this.touch.lookY * touchSensitivity * (this.settings.invertY ? 1 : -1);
      this.touch.lookX = 0;
      this.touch.lookY = 0;
      frame.buttons |= this.touch.buttons;
      for (const action of this.touch.pressed) frame.pressed.add(action);
      this.touch.pressed.clear();
      // إطلاق تلقائي عند التصويب (خيار الجوال)
      if (this.settings.autoFireOnAim && (frame.buttons & InputButton.Aim) !== 0) {
        frame.buttons |= InputButton.Fire;
      }
    }

    const magnitude = Math.hypot(frame.moveX, frame.moveZ);
    if (magnitude > 1) {
      frame.moveX /= magnitude;
      frame.moveZ /= magnitude;
    }
    return frame;
  }

  /** تخطيط قياسي لـ Gamepad API. */
  private sampleGamepad(frame: InputFrame, aiming: boolean): void {
    const pads = navigator.getGamepads?.() ?? [];
    let pad: Gamepad | null = null;
    for (const candidate of pads) {
      if (candidate && candidate.connected) {
        pad = candidate;
        this.gamepadIndex = candidate.index;
        break;
      }
    }
    if (!pad) return;

    const deadzone = 0.18;
    const axis = (value: number): number => (Math.abs(value) < deadzone ? 0 : value);
    frame.moveX += axis(pad.axes[0] ?? 0);
    frame.moveZ -= axis(pad.axes[1] ?? 0);

    const lookSensitivity = this.settings.gamepadSensitivity * (aiming ? 0.024 : 0.038);
    frame.lookDeltaYaw -= axis(pad.axes[2] ?? 0) * lookSensitivity;
    frame.lookDeltaPitch -= axis(pad.axes[3] ?? 0) * lookSensitivity * (this.settings.invertY ? -1 : 1);

    const button = (index: number): boolean => pad!.buttons[index]?.pressed === true;
    if (button(7)) frame.buttons |= InputButton.Fire;
    if (button(6)) frame.buttons |= InputButton.Aim;
    if (button(0)) frame.buttons |= InputButton.Jump;
    if (button(1)) frame.buttons |= InputButton.Crouch;
    if (button(10)) frame.buttons |= InputButton.Sprint;
    if (button(2)) frame.buttons |= InputButton.Reload;
    if (button(4)) frame.pressed.add('abilityQ');
    if (button(5)) frame.pressed.add('abilityE');
    if (button(3)) frame.pressed.add('abilityF');
    if (button(9)) frame.pressed.add('scoreboard');
  }

  private isActionHeld(action: ActionName): boolean {
    const code = this.bindings[action];
    return code ? this.held.has(code) : false;
  }

  // ─────────────────────────── مستمعو الأحداث ───────────────────────────────

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    if (!this.enabled) return;
    const action = this.reverse.get(event.code);
    if (action || event.code === 'Tab' || event.code === 'Escape') event.preventDefault();
    this.held.add(event.code);
    if (action) this.pressedThisFrame.add(action);
    if (event.code === 'Escape') this.pressedThisFrame.add('escape');
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(event.code);
    const action = this.reverse.get(event.code);
    if (action === 'scoreboard') this.pressedThisFrame.add('scoreboardRelease');
  };

  private readonly onBlur = (): void => {
    this.held.clear();
    this.mouseButtons = 0;
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (!this.enabled) return;
    if (event.button === 0) this.mouseButtons |= 1;
    if (event.button === 2) this.mouseButtons |= 2;
    if (!this.pointerLocked) this.requestPointerLock();
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    if (event.button === 0) this.mouseButtons &= ~1;
    if (event.button === 2) this.mouseButtons &= ~2;
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.enabled) return;
    /*
      قفل المؤشر غير متاح دائمًا — إطار مضمَّن بلا إذن pointer-lock مثلًا.
      في تلك الحالة نتيح «السحب للنظر»: نقرأ الإزاحة ما دام زر الفأرة مضغوطًا.
      Pointer lock is not always available (an embedded frame without the
      pointer-lock permission). Fall back to drag-to-look so the game stays playable.
    */
    if (!this.pointerLocked && this.mouseButtons === 0) return;
    this.mouseDeltaX += event.movementX;
    this.mouseDeltaY += event.movementY;
  };

  private readonly onWheel = (event: WheelEvent): void => {
    this.wheelDelta += event.deltaY;
  };

  private readonly onPointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.captureTarget;
    if (!this.pointerLocked) this.mouseButtons = 0;
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    if (this.enabled) event.preventDefault();
  };

  consumeWheel(): number {
    const value = this.wheelDelta;
    this.wheelDelta = 0;
    return value;
  }

  get touchState(): TouchState {
    return this.touch;
  }

  get hasGamepad(): boolean {
    return this.gamepadIndex !== null;
  }
}

export interface TouchState {
  moveX: number;
  moveZ: number;
  lookX: number;
  lookY: number;
  buttons: number;
  pressed: Set<string>;
  active: boolean;
}

/** أدوات تسمية الأزرار في قائمة الإعدادات. */
export function describeKeyCode(code: string): string {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5);
  const named: Record<string, string> = {
    Space: 'SPACE',
    ShiftLeft: 'L-SHIFT',
    ShiftRight: 'R-SHIFT',
    ControlLeft: 'L-CTRL',
    ControlRight: 'R-CTRL',
    AltLeft: 'L-ALT',
    AltRight: 'R-ALT',
    Tab: 'TAB',
    Escape: 'ESC',
    Enter: 'ENTER',
  };
  return named[code] ?? code.toUpperCase();
}

/** يطبّق حدود زاوية النظر / clamp pitch to a sane range. */
export function clampPitch(pitch: number): number {
  return clamp(pitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
}

export const DEFAULT_FOV = balance.graphics.fovDefault;
