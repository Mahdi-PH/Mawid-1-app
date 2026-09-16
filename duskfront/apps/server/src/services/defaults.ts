/** الإعدادات الافتراضية للاعب الجديد / default settings bundle. */
import { balance, type PlayerSettingsBundle } from '@duskfront/shared';

export function defaultSettings(locale = 'ar'): PlayerSettingsBundle {
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
