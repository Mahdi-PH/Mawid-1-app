/**
 * الصوت: كل شيء مركّب برمجيًا عبر WebAudio — لا ملفات صوتية على الإطلاق.
 * Everything is synthesised at runtime: brass in the blaze, strings in the dusk, a low
 * electronic pulse in the dark, plus 3D-positioned weapon and impact sounds (HRTF).
 */
import { balance, type AudioSettings, type ZoneKey } from '@duskfront/shared';

type SfxName =
  | 'shot_solar'
  | 'shot_kinetic'
  | 'shot_beam'
  | 'reload'
  | 'hit'
  | 'headshot'
  | 'kill'
  | 'explosion'
  | 'ability'
  | 'ultimate'
  | 'capture'
  | 'alarm'
  | 'ui_click'
  | 'ui_hover'
  | 'damage';

export class AudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private listenerReady = false;
  private settings: AudioSettings;
  private musicLayers: { zone: ZoneKey; gain: GainNode; stop: () => void }[] = [];
  private alarmUntil = 0;
  private subtitleHandler: ((key: string) => void) | null = null;
  private subtitlesEnabled = false;

  constructor(settings: AudioSettings) {
    this.settings = settings;
  }

  /** يجب استدعاؤه من تفاعل مستخدم (سياسة التشغيل التلقائي في المتصفحات). */
  async resume(): Promise<void> {
    if (!this.context) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.context = new Ctor();
      this.master = this.context.createGain();
      this.musicBus = this.context.createGain();
      this.sfxBus = this.context.createGain();
      this.musicBus.connect(this.master);
      this.sfxBus.connect(this.master);
      this.master.connect(this.context.destination);
      this.applySettings(this.settings);
      this.startMusic();
    }
    if (this.context.state === 'suspended') await this.context.resume();
  }

  applySettings(settings: AudioSettings): void {
    this.settings = settings;
    if (!this.master || !this.musicBus || !this.sfxBus) return;
    this.master.gain.value = settings.master;
    this.musicBus.gain.value = settings.music;
    this.sfxBus.gain.value = settings.sfx;
  }

  setSubtitles(enabled: boolean, handler: (key: string) => void): void {
    this.subtitlesEnabled = enabled;
    this.subtitleHandler = handler;
  }

  /** يحدّث مستمع الصوت ثلاثي الأبعاد من الكاميرا. */
  updateListener(position: { x: number; y: number; z: number }, forward: { x: number; y: number; z: number }): void {
    const context = this.context;
    if (!context) return;
    const listener = context.listener;
    if (listener.positionX) {
      listener.positionX.value = position.x;
      listener.positionY.value = position.y;
      listener.positionZ.value = position.z;
      listener.forwardX.value = forward.x;
      listener.forwardY.value = forward.y;
      listener.forwardZ.value = forward.z;
      listener.upX.value = 0;
      listener.upY.value = 1;
      listener.upZ.value = 0;
    } else {
      // مسار احتياطي للمتصفحات القديمة
      (listener as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(
        position.x,
        position.y,
        position.z,
      );
      (listener as unknown as { setOrientation(...args: number[]): void }).setOrientation(
        forward.x,
        forward.y,
        forward.z,
        0,
        1,
        0,
      );
    }
    this.listenerReady = true;
  }

  /** يمزج طبقات الموسيقى حسب المنطقة التي يقف فيها اللاعب. */
  setZone(zone: ZoneKey, light: number): void {
    if (!this.context) return;
    for (const layer of this.musicLayers) {
      const target = layer.zone === zone ? 0.55 + light * 0.2 : 0.02;
      layer.gain.gain.setTargetAtTime(target, this.context.currentTime, 1.6);
    }
  }

  /** إنذار اقتراب القلعة من حافة الشفق. */
  crawlerAlarm(distanceToEdge: number): void {
    if (!this.context) return;
    const now = this.context.currentTime;
    if (distanceToEdge > balance.audio.crawlerAlarmDistance) return;
    if (now < this.alarmUntil) return;
    this.alarmUntil = now + 1.6;
    this.play('alarm', null);
  }

  /**
   * يشغّل مؤثرًا مركّبًا. عند تمرير موقع تُستخدم عقدة panner بـ HRTF.
   */
  play(name: SfxName, at: { x: number; y: number; z: number } | null, volume = 1): void {
    const context = this.context;
    const bus = this.sfxBus;
    if (!context || !bus) return;

    const destination: AudioNode = at && this.listenerReady ? this.createPanner(context, at, bus) : bus;
    const now = context.currentTime;

    switch (name) {
      case 'shot_kinetic':
        this.noiseBurst(context, destination, now, 0.08, 1800, volume * 0.5);
        this.tone(context, destination, now, 'square', 180, 60, 0.07, volume * 0.28);
        break;
      case 'shot_solar':
        this.tone(context, destination, now, 'sawtooth', 520, 140, 0.16, volume * 0.32);
        this.noiseBurst(context, destination, now, 0.1, 2600, volume * 0.22);
        break;
      case 'shot_beam':
        this.tone(context, destination, now, 'sine', 1400, 240, 0.34, volume * 0.36);
        this.tone(context, destination, now + 0.02, 'triangle', 700, 180, 0.28, volume * 0.22);
        break;
      case 'reload':
        this.click(context, destination, now, 0.05, volume * 0.5);
        this.click(context, destination, now + 0.22, 0.06, volume * 0.55);
        break;
      case 'hit':
        this.tone(context, destination, now, 'triangle', 900, 620, 0.06, volume * 0.35);
        break;
      case 'headshot':
        this.tone(context, destination, now, 'sine', 1500, 900, 0.1, volume * 0.42);
        break;
      case 'kill':
        this.tone(context, destination, now, 'sine', 660, 330, 0.26, volume * 0.4);
        this.tone(context, destination, now + 0.1, 'sine', 990, 660, 0.2, volume * 0.3);
        break;
      case 'explosion':
        this.noiseBurst(context, destination, now, 0.55, 420, volume * 0.85);
        this.tone(context, destination, now, 'sine', 90, 34, 0.6, volume * 0.5);
        break;
      case 'ability':
        this.tone(context, destination, now, 'triangle', 380, 760, 0.22, volume * 0.3);
        break;
      case 'ultimate':
        this.tone(context, destination, now, 'sawtooth', 160, 640, 0.75, volume * 0.36);
        this.noiseBurst(context, destination, now + 0.1, 0.5, 900, volume * 0.3);
        break;
      case 'capture':
        this.tone(context, destination, now, 'sine', 520, 780, 0.3, volume * 0.32);
        break;
      case 'alarm':
        for (let i = 0; i < 3; i++) {
          this.tone(context, destination, now + i * 0.28, 'square', 720, 440, 0.16, volume * 0.22);
        }
        this.emitSubtitle('announce.crawler_outside');
        break;
      case 'damage':
        this.noiseBurst(context, destination, now, 0.14, 700, volume * 0.42);
        break;
      case 'ui_click':
        this.tone(context, destination, now, 'sine', 640, 880, 0.07, volume * 0.22);
        break;
      case 'ui_hover':
        this.tone(context, destination, now, 'sine', 420, 520, 0.04, volume * 0.12);
        break;
      default:
        break;
    }
  }

  private emitSubtitle(key: string): void {
    if (this.subtitlesEnabled) this.subtitleHandler?.(key);
  }

  private createPanner(context: AudioContext, at: { x: number; y: number; z: number }, bus: GainNode): AudioNode {
    const panner = context.createPanner();
    panner.panningModel = balance.audio.hrtf ? 'HRTF' : 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = 8;
    panner.maxDistance = 420;
    panner.rolloffFactor = 1.1;
    if (panner.positionX) {
      panner.positionX.value = at.x;
      panner.positionY.value = at.y;
      panner.positionZ.value = at.z;
    } else {
      (panner as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(at.x, at.y, at.z);
    }
    panner.connect(bus);
    return panner;
  }

  private tone(
    context: AudioContext,
    destination: AudioNode,
    startAt: number,
    type: OscillatorType,
    fromHz: number,
    toHz: number,
    duration: number,
    gainValue: number,
  ): void {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(fromHz, startAt);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, toHz), startAt + duration);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainValue), startAt + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.05);
  }

  private noiseBurst(
    context: AudioContext,
    destination: AudioNode,
    startAt: number,
    duration: number,
    cutoffHz: number,
    gainValue: number,
  ): void {
    const frames = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, frames, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoffHz, startAt);
    const gain = context.createGain();
    gain.gain.setValueAtTime(gainValue, startAt);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    source.start(startAt);
  }

  private click(context: AudioContext, destination: AudioNode, startAt: number, duration: number, gainValue: number): void {
    this.noiseBurst(context, destination, startAt, duration, 3200, gainValue);
  }

  /**
   * ثلاث طبقات موسيقية دائمة تُمزج حسب المنطقة:
   * نحاسية في السطوع، وترية في الشفق، وإلكترونية خافتة في العتمة.
   */
  private startMusic(): void {
    const context = this.context;
    const bus = this.musicBus;
    if (!context || !bus) return;

    this.musicLayers = [
      this.buildLayer(context, bus, 'bright', [110, 165, 220], 'sawtooth', 0.045, 5.5),
      this.buildLayer(context, bus, 'dusk', [98, 147, 196, 247], 'triangle', 0.05, 7.5),
      this.buildLayer(context, bus, 'dark', [55, 82, 110], 'sine', 0.06, 11),
    ];
  }

  private buildLayer(
    context: AudioContext,
    bus: GainNode,
    zone: ZoneKey,
    frequencies: number[],
    type: OscillatorType,
    gainValue: number,
    lfoSeconds: number,
  ): { zone: ZoneKey; gain: GainNode; stop: () => void } {
    const layerGain = context.createGain();
    layerGain.gain.value = zone === 'dusk' ? 0.4 : 0.02;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = zone === 'dark' ? 620 : zone === 'dusk' ? 1400 : 2600;
    filter.Q.value = 0.8;
    layerGain.connect(filter);
    filter.connect(bus);

    const oscillators: OscillatorNode[] = [];
    for (const frequency of frequencies) {
      const oscillator = context.createOscillator();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      const voiceGain = context.createGain();
      voiceGain.gain.value = gainValue;

      // LFO بطيء يعطي الطبقة حياة
      const lfo = context.createOscillator();
      const lfoGain = context.createGain();
      lfo.frequency.value = 1 / lfoSeconds;
      lfoGain.gain.value = gainValue * 0.55;
      lfo.connect(lfoGain);
      lfoGain.connect(voiceGain.gain);
      lfo.start();

      oscillator.connect(voiceGain);
      voiceGain.connect(layerGain);
      oscillator.start();
      oscillators.push(oscillator, lfo);
    }

    return {
      zone,
      gain: layerGain,
      stop: () => {
        for (const oscillator of oscillators) {
          try {
            oscillator.stop();
          } catch {
            /* already stopped */
          }
        }
      },
    };
  }

  dispose(): void {
    for (const layer of this.musicLayers) layer.stop();
    this.musicLayers = [];
    void this.context?.close();
    this.context = null;
  }
}
