/**
 * أدوات تحكّم اللمس للجوال: عصا حركة على جهة، وسحب للتصويب على الأخرى،
 * وأزرار كبيرة قابلة لإعادة الترتيب.
 * Mobile controls: a virtual stick, a drag-to-aim zone, and large repositionable
 * buttons whose layout is persisted with the player's settings.
 */
import { InputButton, type ControlSettings } from '@duskfront/shared';
import type { TouchState } from './input.js';

interface TouchButtonSpec {
  id: string;
  glyph: string;
  action: 'fire' | 'aim' | 'jump' | 'crouch' | 'reload' | 'grenade' | 'abilityQ' | 'abilityE' | 'abilityF';
  size: 'fire' | 'small';
  defaultX: number;
  defaultY: number;
}

const BUTTONS: TouchButtonSpec[] = [
  { id: 'fire', glyph: '⌖', action: 'fire', size: 'fire', defaultX: 0.86, defaultY: 0.66 },
  { id: 'aim', glyph: '◎', action: 'aim', size: 'small', defaultX: 0.72, defaultY: 0.58 },
  { id: 'jump', glyph: '⤒', action: 'jump', size: 'small', defaultX: 0.72, defaultY: 0.82 },
  { id: 'crouch', glyph: '⤓', action: 'crouch', size: 'small', defaultX: 0.6, defaultY: 0.86 },
  { id: 'reload', glyph: '⟲', action: 'reload', size: 'small', defaultX: 0.86, defaultY: 0.88 },
  { id: 'grenade', glyph: '✹', action: 'grenade', size: 'small', defaultX: 0.6, defaultY: 0.66 },
  { id: 'abilityQ', glyph: 'Q', action: 'abilityQ', size: 'small', defaultX: 0.93, defaultY: 0.44 },
  { id: 'abilityE', glyph: 'E', action: 'abilityE', size: 'small', defaultX: 0.82, defaultY: 0.36 },
  { id: 'abilityF', glyph: 'F', action: 'abilityF', size: 'small', defaultX: 0.68, defaultY: 0.32 },
];

export class TouchControls {
  readonly root: HTMLElement;
  private readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly buttons = new Map<string, HTMLElement>();
  private stickPointer: number | null = null;
  private lookPointer: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private stickOrigin = { x: 0, y: 0 };
  private layout: ControlSettings['touchLayout'] = {};
  private editing = false;

  constructor(parent: HTMLElement, private readonly state: TouchState) {
    this.root = document.createElement('div');
    this.root.id = 'touch-layer';
    this.root.className = 'layer interactive';

    this.stick = document.createElement('div');
    this.stick.className = 'touch-stick';
    this.stick.style.insetInlineStart = '5%';
    this.stick.style.insetBlockEnd = '10%';
    this.knob = document.createElement('div');
    this.knob.className = 'knob';
    this.stick.appendChild(this.knob);
    this.root.appendChild(this.stick);

    for (const spec of BUTTONS) {
      const element = document.createElement('div');
      element.className = `touch-btn ${spec.size}`;
      element.textContent = spec.glyph;
      element.dataset.id = spec.id;
      this.root.appendChild(element);
      this.buttons.set(spec.id, element);
      this.positionButton(spec);
      this.wireButton(element, spec);
    }

    parent.appendChild(this.root);
    this.wireStick();
    this.wireLookZone();
  }

  setEnabled(enabled: boolean): void {
    this.root.classList.toggle('enabled', enabled);
    this.state.active = enabled;
    if (!enabled) {
      this.state.moveX = 0;
      this.state.moveZ = 0;
      this.state.buttons = 0;
    }
  }

  setLayout(layout: ControlSettings['touchLayout']): void {
    this.layout = layout ?? {};
    for (const spec of BUTTONS) this.positionButton(spec);
  }

  getLayout(): ControlSettings['touchLayout'] {
    return { ...this.layout };
  }

  /** وضع إعادة الترتيب: يسحب اللاعب الأزرار إلى ما يناسبه. */
  setEditing(editing: boolean): void {
    this.editing = editing;
  }

  private positionButton(spec: TouchButtonSpec): void {
    const element = this.buttons.get(spec.id);
    if (!element) return;
    const custom = this.layout[spec.id];
    const x = custom?.x ?? spec.defaultX;
    const y = custom?.y ?? spec.defaultY;
    const scale = custom?.scale ?? 1;
    element.style.insetInlineStart = `${x * 100}%`;
    element.style.insetBlockStart = `${y * 100}%`;
    element.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }

  private wireStick(): void {
    const onDown = (event: PointerEvent): void => {
      if (this.stickPointer !== null) return;
      this.stickPointer = event.pointerId;
      const rect = this.stick.getBoundingClientRect();
      this.stickOrigin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      this.stick.setPointerCapture(event.pointerId);
      event.preventDefault();
    };
    const onMove = (event: PointerEvent): void => {
      if (this.stickPointer !== event.pointerId) return;
      const dx = event.clientX - this.stickOrigin.x;
      const dy = event.clientY - this.stickOrigin.y;
      const radius = this.stick.clientWidth / 2;
      const distance = Math.min(radius, Math.hypot(dx, dy));
      const angle = Math.atan2(dy, dx);
      const nx = (Math.cos(angle) * distance) / radius;
      const ny = (Math.sin(angle) * distance) / radius;
      this.knob.style.transform = `translate(${nx * radius * 0.6}px, ${ny * radius * 0.6}px)`;
      this.state.moveX = nx;
      this.state.moveZ = -ny;
    };
    const onUp = (event: PointerEvent): void => {
      if (this.stickPointer !== event.pointerId) return;
      this.stickPointer = null;
      this.knob.style.transform = '';
      this.state.moveX = 0;
      this.state.moveZ = 0;
    };
    this.stick.addEventListener('pointerdown', onDown);
    this.stick.addEventListener('pointermove', onMove);
    this.stick.addEventListener('pointerup', onUp);
    this.stick.addEventListener('pointercancel', onUp);
  }

  private wireLookZone(): void {
    const onDown = (event: PointerEvent): void => {
      if (event.target !== this.root) return;
      if (this.lookPointer !== null) return;
      this.lookPointer = event.pointerId;
      this.lookLast = { x: event.clientX, y: event.clientY };
    };
    const onMove = (event: PointerEvent): void => {
      if (this.lookPointer !== event.pointerId) return;
      this.state.lookX += event.clientX - this.lookLast.x;
      this.state.lookY += event.clientY - this.lookLast.y;
      this.lookLast = { x: event.clientX, y: event.clientY };
    };
    const onUp = (event: PointerEvent): void => {
      if (this.lookPointer !== event.pointerId) return;
      this.lookPointer = null;
    };
    this.root.addEventListener('pointerdown', onDown);
    this.root.addEventListener('pointermove', onMove);
    this.root.addEventListener('pointerup', onUp);
    this.root.addEventListener('pointercancel', onUp);
  }

  private wireButton(element: HTMLElement, spec: TouchButtonSpec): void {
    const setBit = (on: boolean): void => {
      const map: Record<string, number> = {
        fire: InputButton.Fire,
        aim: InputButton.Aim,
        jump: InputButton.Jump,
        crouch: InputButton.Crouch,
        reload: InputButton.Reload,
      };
      const bit = map[spec.action];
      if (bit === undefined) return;
      if (on) this.state.buttons |= bit;
      else this.state.buttons &= ~bit;
    };

    element.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.editing) {
        this.startDrag(element, spec, event);
        return;
      }
      element.classList.add('active');
      element.setPointerCapture(event.pointerId);
      setBit(true);
      if (spec.action === 'grenade' || spec.action.startsWith('ability')) {
        this.state.pressed.add(spec.action);
      }
    });
    const release = (event: PointerEvent): void => {
      element.classList.remove('active');
      setBit(false);
      void event;
    };
    element.addEventListener('pointerup', release);
    element.addEventListener('pointercancel', release);
  }

  private startDrag(element: HTMLElement, spec: TouchButtonSpec, event: PointerEvent): void {
    element.setPointerCapture(event.pointerId);
    const onMove = (moveEvent: PointerEvent): void => {
      const x = moveEvent.clientX / window.innerWidth;
      const y = moveEvent.clientY / window.innerHeight;
      this.layout[spec.id] = { x, y, scale: this.layout[spec.id]?.scale ?? 1 };
      this.positionButton(spec);
    };
    const onUp = (): void => {
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
    };
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', onUp);
  }

  dispose(): void {
    this.root.remove();
  }
}

/** كشف الجهاز اللمسي / is this a touch-first device? */
export function isTouchDevice(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('ontouchstart' in window || navigator.maxTouchPoints > 0) &&
    window.matchMedia('(pointer: coarse)').matches
  );
}
