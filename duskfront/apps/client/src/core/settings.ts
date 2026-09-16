/**
 * إعدادات اللاعب: مصدرها الخادم، ونسخة محلية فورية، وحفظ مؤجّل ثانية واحدة.
 * Settings live on the server but are mirrored to localStorage so the game starts with
 * the right look before the first request lands. Writes are debounced by one second,
 * exactly as the spec requires.
 */
import type { PlayerSettingsBundle } from '@duskfront/shared';
import { balance } from '@duskfront/shared';
import type { ApiClient } from './api.js';
import { LocalSettings } from './storage.js';

const DEBOUNCE_MS = 1000;

export function defaultClientSettings(locale = 'ar'): PlayerSettingsBundle {
  return {
    graphics: {
      tier: 'medium',
      resolutionScale: balance.graphics.medium.resolutionScale,
      shadows: true,
      fov: balance.graphics.fovDefault,
      fpsCap: 120,
      bloom: balance.graphics.medium.bloom,
    },
    audio: {
      master: balance.audio.masterDefault,
      music: balance.audio.musicDefault,
      sfx: balance.audio.sfxDefault,
    },
    controls: {
      sensitivity: 1,
      adsSensitivity: 0.7,
      invertY: false,
      gamepadSensitivity: 1,
      autoFireOnAim: false,
      aimAssist: true,
      bindings: {
        moveForward: 'KeyW',
        moveBack: 'KeyS',
        moveLeft: 'KeyA',
        moveRight: 'KeyD',
        jump: 'Space',
        crouch: 'ControlLeft',
        sprint: 'ShiftLeft',
        reload: 'KeyR',
        grenade: 'KeyG',
        abilityQ: 'KeyQ',
        abilityE: 'KeyE',
        abilityF: 'KeyF',
        melee: 'KeyV',
        interact: 'KeyX',
        scoreboard: 'Tab',
        ping: 'KeyZ',
        commandWheel: 'KeyB',
        swapShoulder: 'KeyC',
        tacticalMap: 'KeyM',
      },
      touchLayout: {},
    },
    accessibility: {
      colorBlindMode: 'none',
      fontScale: 1,
      subtitles: locale === 'ar',
      reducedShake: false,
      highContrastHud: false,
    },
  };
}

export type SettingsListener = (settings: PlayerSettingsBundle) => void;

export class SettingsStore {
  private current: PlayerSettingsBundle;
  private timer: number | null = null;
  private readonly listeners = new Set<SettingsListener>();

  constructor(private readonly api: ApiClient, locale = 'ar') {
    this.current = LocalSettings.load<PlayerSettingsBundle>() ?? defaultClientSettings(locale);
    this.applyToDocument();
  }

  get value(): PlayerSettingsBundle {
    return this.current;
  }

  subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** يجلب الإعدادات من الخادم بعد تسجيل الدخول. */
  async pull(): Promise<void> {
    try {
      const remote = await this.api.getSettings();
      this.current = mergeSettings(this.current, remote);
      LocalSettings.save(this.current);
      this.applyToDocument();
      this.emit();
    } catch {
      /* نبقى على النسخة المحلية */
    }
  }

  /** تعديل جزئي مع حفظ مؤجّل. */
  patch(patch: DeepPartial<PlayerSettingsBundle>): void {
    this.current = mergeSettings(this.current, patch as Partial<PlayerSettingsBundle>);
    LocalSettings.save(this.current);
    this.applyToDocument();
    this.emit();
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, DEBOUNCE_MS);
  }

  async flush(): Promise<void> {
    if (!this.api.isAuthenticated) return;
    try {
      await this.api.putSettings(this.current);
    } catch {
      /* سيُعاد المحاولة عند التعديل التالي */
    }
  }

  /** يطبّق إعدادات إمكانية الوصول على المستند مباشرة. */
  applyToDocument(): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.style.setProperty('--font-scale', String(this.current.accessibility.fontScale));
    root.dataset.contrast = this.current.accessibility.highContrastHud ? 'high' : 'normal';
    root.dataset.colorblind = this.current.accessibility.colorBlindMode;
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.current);
  }
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function mergeSettings(base: PlayerSettingsBundle, patch: Partial<PlayerSettingsBundle>): PlayerSettingsBundle {
  return {
    graphics: { ...base.graphics, ...(patch.graphics ?? {}) },
    audio: { ...base.audio, ...(patch.audio ?? {}) },
    controls: {
      ...base.controls,
      ...(patch.controls ?? {}),
      bindings: { ...base.controls.bindings, ...(patch.controls?.bindings ?? {}) },
      touchLayout: { ...base.controls.touchLayout, ...(patch.controls?.touchLayout ?? {}) },
    },
    accessibility: { ...base.accessibility, ...(patch.accessibility ?? {}) },
  };
}
