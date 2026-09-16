/**
 * نقطة إقلاع اللعبة: تربط المشهد والواجهة والمدخلات والصوت والشبكة في حلقة واحدة.
 * Application bootstrap. Owns the single render loop and the state machine that moves
 * between the menus, an active match, the tutorial and the campaign.
 */
import './ui/styles.css';
import {
  InputButton,
  balance,
  chargeRatio,
  classBalance,
  clamp,
  distanceToDuskEdge,
  isSolar,
  type ClassKey,
  type Difficulty,
  type GameMode,
  type PlayerPublicState,
  type TeamId,
  type WeaponKey,
} from '@duskfront/shared';
import { Vector3 } from 'three';
import { AudioEngine } from './audio/audio.js';
import { ApiClient, type ProfileDto } from './core/api.js';
import { SettingsStore } from './core/settings.js';
import { LocalAuth } from './core/storage.js';
import { CAMPAIGN_MISSIONS, CampaignRun, syncPendingSaves } from './game/campaign.js';
import { LocalMatch, OnlineMatch, type MatchEventSink, type MatchSession } from './game/match-session.js';
import { TutorialRun } from './game/tutorial.js';
import { initLocale, onLocaleChange, t, type Locale } from './i18n/index.js';
import { InputManager, clampPitch } from './input/input.js';
import { TouchControls, isTouchDevice } from './input/touch.js';
import { GameScene } from './render/scene.js';
import { Hud } from './ui/hud.js';
import { Menus } from './ui/menus.js';

type AppState = 'boot' | 'menu' | 'connecting' | 'match' | 'tutorial' | 'campaign' | 'result';

class DuskfrontApp {
  private readonly api = new ApiClient();
  private readonly settings: SettingsStore;
  private readonly input: InputManager;
  private readonly audio: AudioEngine;
  private readonly canvas: HTMLCanvasElement;
  private readonly container: HTMLElement;
  private scene!: GameScene;
  private hud!: Hud;
  private menus!: Menus;
  private touch: TouchControls | null = null;

  private state: AppState = 'boot';
  private session: MatchSession | null = null;
  private campaign: CampaignRun | null = null;
  private tutorial: TutorialRun | null = null;
  private profile: ProfileDto | null = null;

  private lastFrame = performance.now();
  private accumulatedTime = 0;
  private yaw = 0;
  private pitch = 0;
  private aiming = false;
  private firing = false;
  private chargeStartedAt = 0;
  private lastFireAt = 0;
  private showScoreboard = false;
  /** تبدأ كاميرا القائمة في منتصف المباراة حيث يكون خط الغسق في وسط الخريطة. */
  private menuClock = balance.match.crawl.durationSec * 0.52;
  private frameBudgetMs = 0;
  private readonly aimVector = new Vector3();

  constructor(container: HTMLElement) {
    this.container = container;
    initLocale();

    this.canvas = document.createElement('canvas');
    this.canvas.id = 'game-canvas';
    container.appendChild(this.canvas);

    this.settings = new SettingsStore(this.api);
    this.input = new InputManager(this.settings.value.controls);
    this.audio = new AudioEngine(this.settings.value.audio);

    this.api.observeTokens((tokens) => LocalAuth.save(tokens));
  }

  async start(): Promise<void> {
    const loading = this.showLoading();

    this.scene = new GameScene(this.canvas, this.settings.value.graphics);
    this.hud = new Hud(this.container, { onLeaveMatch: () => void this.leaveMatch() });
    this.hud.setVisible(false);

    this.menus = new Menus(this.container, this.api, this.settings, this.input, {
      onStartMatch: (mode, classKey, options) => void this.startMatch(mode, classKey, options),
      onStartCampaign: (slot, missionIndex, difficulty, classKey) =>
        void this.startCampaign(slot, missionIndex, difficulty, classKey),
      onStartTutorial: () => void this.startTutorial(),
      onLogout: () => void this.logout(),
      onLocaleChanged: (locale) => this.applyLocale(locale),
      onSettingsChanged: () => this.applySettings(),
      playUiSound: (name) => this.audio.play(name, null),
    });
    this.menus.setVisible(false);

    this.input.attach(this.canvas);
    if (isTouchDevice()) {
      this.touch = new TouchControls(this.container, this.input.touchState);
      this.touch.setLayout(this.settings.value.controls.touchLayout);
      this.touch.setEnabled(false);
    }

    this.settings.subscribe(() => this.applySettings());
    onLocaleChange(() => {
      this.hud.applyStaticText();
      void this.menus.render();
    });

    window.addEventListener('resize', this.onResize);
    this.onResize();

    await this.authenticate();
    await syncPendingSaves(this.api).catch(() => 0);

    loading.remove();
    this.enterMenu();
    requestAnimationFrame(this.frame);
  }

  // ─────────────────────────── المصادقة / auth ──────────────────────────────

  private async authenticate(): Promise<void> {
    const stored = LocalAuth.load();
    if (stored) {
      this.api.setTokens(stored);
      try {
        this.profile = await this.api.getProfile();
        await this.settings.pull();
        this.applySettings();
        return;
      } catch {
        this.api.setTokens(null);
      }
    }
    try {
      const result = await this.api.guest(this.settings.value.accessibility.subtitles ? 'ar' : 'ar');
      this.profile = { ...result.profile, isGuest: true };
      await this.settings.pull();
      this.applySettings();
    } catch {
      // الخادم غير متاح: نلعب دون اتصال بالمحاكاة المحلية
      this.profile = null;
      this.menus.toast(t('net.offline'), 'error');
    }
  }

  private async logout(): Promise<void> {
    await this.api.logout();
    this.profile = null;
    this.menus.setProfile(null);
    await this.authenticate();
    this.menus.setProfile(this.profile);
    void this.menus.render();
  }

  // ─────────────────────────── الحالات / states ─────────────────────────────

  private enterMenu(): void {
    this.state = 'menu';
    this.session = null;
    this.campaign = null;
    this.tutorial = null;
    this.hud.setVisible(false);
    this.menus.setVisible(true);
    this.menus.setProfile(this.profile);
    this.input.setEnabled(false);
    this.input.exitPointerLock();
    this.touch?.setEnabled(false);
    this.canvas.classList.add('cursor-visible');
  }

  private enterMatchState(state: AppState): void {
    this.state = state;
    this.menus.setVisible(false);
    this.hud.setVisible(true);
    this.input.setEnabled(true);
    this.touch?.setEnabled(true);
    this.canvas.classList.remove('cursor-visible');
    void this.audio.resume();
    this.audio.setSubtitles(this.settings.value.accessibility.subtitles, (key) =>
      this.hud.pushAnnouncement(key, 'info'),
    );
  }

  private eventSink(): MatchEventSink {
    return {
      onKillfeed: (entry) =>
        this.hud.pushKillfeed({ ...entry, localTeam: this.session?.localTeam ?? 0 }),
      onAnnounce: (key, severity, params) => this.hud.pushAnnouncement(key, severity, params),
      onHitConfirm: (payload) => {
        this.hud.showHitmarker(payload.killed);
        this.audio.play(payload.headshot ? 'headshot' : payload.killed ? 'kill' : 'hit', null);
      },
      onDamaged: (payload) => {
        const local = this.session?.localState();
        this.hud.showDamageDirection(payload.fromYaw, local?.yaw ?? 0);
        this.scene.cameraRig.shake(0.16, 0.25, performance.now() / 1000);
        this.audio.play('damage', null, Math.min(1, payload.amount / 40));
        if (payload.source === 'player') this.hud.flagDetected();
      },
      onShot: (payload) => {
        const view = this.scene.getPlayerView(payload.playerId);
        view?.triggerMuzzleFlash(performance.now() / 1000);
        const end = {
          x: payload.origin.x + payload.direction.x * 120,
          y: payload.origin.y + payload.direction.y * 120,
          z: payload.origin.z + payload.direction.z * 120,
        };
        this.scene.effects.spawnTracer(payload.origin, payload.hit ?? end, payload.weapon, performance.now() / 1000);
        this.audio.play(
          payload.weapon === 'beam_rifle' ? 'shot_beam' : isSolar(payload.weapon) ? 'shot_solar' : 'shot_kinetic',
          payload.origin,
        );
      },
      onExplosion: (payload) => {
        this.scene.effects.spawnExplosion(payload.position, payload.radius, performance.now() / 1000);
        this.audio.play('explosion', payload.position);
        this.scene.cameraRig.shake(0.3, 0.4, performance.now() / 1000);
      },
      onStructurePlaced: (payload) => {
        this.scene.effects.spawnImpact(payload.position, performance.now() / 1000);
        this.audio.play('ability', payload.position);
      },
      onMatchEnd: (payload) => this.onMatchEnd(payload),
      onReward: (payload) => {
        this.menus.toast(`+${payload.xp} XP · +${payload.shards}`, 'success');
        for (const key of payload.unlockedAchievements) this.hud.pushAnnouncement(key, 'info');
      },
      onDisconnected: (reason) => {
        this.hud.pushAnnouncement('net.disconnected', 'critical');
        this.menus.toast(`${t('net.disconnected')} (${reason})`, 'error');
        window.setTimeout(() => this.enterMenu(), 2200);
      },
    };
  }

  private async startMatch(
    mode: GameMode,
    classKey: ClassKey,
    options: { soloVsBots: boolean; difficulty: Difficulty },
  ): Promise<void> {
    this.state = 'connecting';
    const loading = this.showLoading(t('net.connecting'));

    const sink = this.eventSink();
    try {
      if (!this.api.isAuthenticated) throw new Error('offline');
      const policy = await this.api.queue({
        mode,
        classKey,
        difficulty: options.difficulty,
        soloVsBots: options.soloVsBots,
      });
      if (policy.local) throw new Error('local_mode');

      const online = new OnlineMatch(mode, classKey, sink);
      await online.connect(policy.roomName ?? 'match', policy.joinOptions ?? {}, this.api.getAccessToken());
      this.session = online;
    } catch {
      // مسار احتياطي: مناوشة محلية ضد البوتات بنفس المحاكاة
      this.session = new LocalMatch(
        {
          mode,
          classKey,
          difficulty: options.difficulty,
          playerName: this.profile?.displayName ?? 'Player',
        },
        sink,
      );
      this.menus.toast(t('net.offline'));
    }

    this.prepareSession(classKey);
    loading.remove();
    this.enterMatchState('match');
  }

  private async startTutorial(): Promise<void> {
    const sink = this.eventSink();
    const match = new LocalMatch(
      {
        mode: 'tutorial',
        classKey: 'engineer',
        difficulty: 'easy',
        playerName: this.profile?.displayName ?? 'Player',
        teamSize: 2,
        durationSec: 900,
      },
      sink,
    );
    this.session = match;
    this.tutorial = new TutorialRun(match);
    this.prepareSession('engineer');
    this.enterMatchState('tutorial');
    this.hud.pushAnnouncement('tutorial.step1', 'info');
  }

  private async startCampaign(
    slot: number,
    missionIndex: number,
    difficulty: Difficulty,
    classKey: ClassKey,
  ): Promise<void> {
    const mission = CAMPAIGN_MISSIONS[missionIndex] ?? CAMPAIGN_MISSIONS[0]!;
    const run = new CampaignRun(
      mission,
      { slot, difficulty, classKey, playerName: this.profile?.displayName ?? 'Player' },
      this.eventSink(),
      this.api,
    );
    this.campaign = run;
    this.session = run.match;
    this.prepareSession(mission.classKey ?? classKey);
    this.enterMatchState('campaign');
    this.hud.pushAnnouncement(mission.briefKey, 'info');
  }

  private prepareSession(classKey: ClassKey): void {
    const session = this.session;
    if (!session) return;
    this.scene.setLocalPlayer(session.localId, session.localTeam);
    const local = session.localState();
    this.yaw = local?.yaw ?? 0;
    this.pitch = 0;
    this.chargeStartedAt = 0;
    this.firing = false;
    void classKey;
  }

  private async leaveMatch(): Promise<void> {
    await this.session?.leave();
    this.enterMenu();
  }

  private onMatchEnd(payload: { winnerTeam: number | null; reason: string }): void {
    const localTeam = this.session?.localTeam ?? 0;
    const titleKey =
      payload.winnerTeam === null ? 'result.draw' : payload.winnerTeam === localTeam ? 'result.victory' : 'result.defeat';
    this.hud.pushAnnouncement(titleKey, 'info');
    this.hud.pushAnnouncement(`result.${payload.reason}`, 'info');
    this.audio.play(payload.winnerTeam === localTeam ? 'ultimate' : 'alarm', null);
    window.setTimeout(() => void this.leaveMatch(), 6500);
  }

  // ─────────────────────────── الحلقة / the loop ────────────────────────────

  private readonly frame = (now: number): void => {
    requestAnimationFrame(this.frame);

    const rawDelta = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    // نفس حدود zInputCommand في الحزمة المشتركة — لا يجوز أن يختلفا
    const dt = clamp(rawDelta, 1 / 240, 1 / 12);

    // حدّ الإطارات المختار في الإعدادات
    const cap = this.settings.value.graphics.fpsCap;
    if (cap > 0) {
      this.frameBudgetMs += rawDelta * 1000;
      const minimum = 1000 / cap;
      if (this.frameBudgetMs < minimum) return;
      this.frameBudgetMs = 0;
    }

    if (this.state === 'menu' || this.state === 'boot' || this.state === 'connecting') {
      this.menuClock += dt * 1.5;
      this.scene.setMenuCamera(this.menuClock);
      this.scene.idleSync(this.menuClock, dt);
      this.scene.render();
      return;
    }

    this.tickMatch(dt, now / 1000);
  };

  private tickMatch(dt: number, nowSec: number): void {
    const session = this.session;
    if (!session) return;

    const frame = this.input.sample(this.aiming);

    // 1) النظر — تُلَفّ الزاوية داخل [-π, π] وإلا تجاوزت حدود المخطّط بعد دقائق
    this.yaw = wrapAngle(this.yaw + frame.lookDeltaYaw);
    this.pitch = clampPitch(this.pitch + frame.lookDeltaPitch);
    this.aiming = (frame.buttons & InputButton.Aim) !== 0;

    // 2) إرسال أمر الإدخال (نفس البنية على الخادم والعميل)
    session.update(dt, {
      dt,
      moveX: frame.moveX,
      moveZ: frame.moveZ,
      yaw: this.yaw,
      pitch: this.pitch,
      buttons: frame.buttons,
      clientTimeMs: Date.now(),
    });

    const local = session.localState();
    const snapshot = session.snapshot();
    if (!snapshot) return;

    // 3) الأفعال اللحظية
    this.handleActions(frame.pressed, frame.buttons, session, local, nowSec);

    // 4) الإطلاق المستمر
    this.handleFiring(frame.buttons, session, local, nowSec);

    // 5) المشهد والصوت
    this.scene.sync(snapshot, local, dt, this.aiming);
    const camera = this.scene.cameraRig.camera;
    camera.getWorldDirection(this.aimVector);
    this.audio.updateListener(camera.position, this.aimVector);
    if (local) {
      this.audio.setZone(local.zone, local.light);
      const crawler = snapshot.crawlers[session.localTeam];
      if (crawler) {
        this.audio.crawlerAlarm(Math.abs(distanceToDuskEdge(crawler.position.x, snapshot.timeSec)));
      }
    }

    // 6) الواجهة
    const weapon = session.weaponView();
    this.hud.update({
      snapshot,
      local,
      localTeam: session.localTeam,
      camera,
      matchTimeSec: snapshot.timeSec,
      durationSec: session.durationSec,
      aiming: this.aiming,
      charging: this.chargeRatioNow(nowSec, weapon.weapon),
      weapon: weapon.weapon,
      magazine: weapon.magazine,
      reserve: weapon.reserve,
      grenades: weapon.grenades,
      reloading: weapon.reloading,
      cooldownQ: weapon.cooldownQ,
      cooldownE: weapon.cooldownE,
      ultimateCharge: weapon.ultimateCharge,
      showScoreboard: this.showScoreboard,
    });
    this.hud.setCrosshairState(this.chargeRatioNow(nowSec, weapon.weapon), this.aiming);

    // 7) الحملة والتدريب
    this.campaign?.tick(snapshot, dt);
    if (this.campaign?.complete) {
      this.hud.pushAnnouncement('result.victory', 'info');
      const run = this.campaign;
      this.campaign = null;
      void run.saveCheckpoint(snapshot).then(() => window.setTimeout(() => void this.leaveMatch(), 4200));
    }
    if (this.tutorial) {
      const before = this.tutorial.stepNumber;
      this.tutorial.tick(snapshot, dt);
      if (this.tutorial.finished) {
        this.hud.pushAnnouncement('tutorial.complete', 'info');
        this.tutorial = null;
        window.setTimeout(() => void this.leaveMatch(), 3500);
      } else if (this.tutorial.stepNumber !== before) {
        this.hud.pushAnnouncement(this.tutorial.currentStep!.key, 'info');
      }
    }

    // 8) القذائف والضربات المرئية (الوضع الشبكي)
    if (session instanceof OnlineMatch) {
      const { strikes } = session.projectiles();
      this.scene.effects.syncStrikes(
        strikes.map((strike) => ({
          id: strike.id,
          position: { x: strike.x, y: 0, z: strike.z },
          at: strike.at,
          radius: strike.radius,
        })),
        snapshot.timeSec,
      );
    } else if (session instanceof LocalMatch) {
      this.scene.effects.syncStrikes(
        session.sim.activeStrikes().map((strike) => ({
          id: strike.id,
          position: strike.position,
          at: strike.at,
          radius: strike.radius,
        })),
        snapshot.timeSec,
      );
    }

    this.scene.render();
  }

  private handleActions(
    pressed: Set<string>,
    buttons: number,
    session: MatchSession,
    local: PlayerPublicState | null,
    nowSec: number,
  ): void {
    if (pressed.has('escape')) {
      void this.leaveMatch();
      return;
    }
    if (pressed.has('scoreboard')) this.showScoreboard = true;
    if (pressed.has('scoreboardRelease')) this.showScoreboard = false;
    if (pressed.has('swapShoulder')) this.scene.cameraRig.swapShoulder();
    if (pressed.has('tacticalMap')) this.scene.cameraRig.toggleFirstPerson();
    if (pressed.has('reload')) session.reload();
    if (pressed.has('jump')) this.tutorial?.noteJump();
    if ((buttons & InputButton.Sprint) !== 0) this.tutorial?.noteSprint();

    const aim = this.scene.cameraRig.getAimRay({
      position: local?.position ?? { x: 0, y: 0, z: 0 },
      yaw: this.yaw,
      pitch: this.pitch,
      crouching: local?.crouching ?? false,
    });

    for (const slot of ['q', 'e', 'f'] as const) {
      if (pressed.has(`ability${slot.toUpperCase()}`)) {
        session.ability(slot, aim.direction, this.yaw);
        this.audio.play(slot === 'f' ? 'ultimate' : 'ability', local?.position ?? null);
      }
    }

    if (pressed.has('grenade')) {
      session.grenade(aim.direction);
      this.audio.play('ability', local?.position ?? null);
    }

    if (pressed.has('ping') && local) {
      const target = {
        x: local.position.x + aim.direction.x * 60,
        z: local.position.z + aim.direction.z * 60,
      };
      session.pingMark(target.x, target.z, 'attack');
    }

    // توجيه القلعة: B يفتح تصويتًا سريعًا يسارًا/يمينًا حسب النظر
    if (pressed.has('commandWheel') && local) {
      const offset = clamp(Math.sin(this.yaw), -1, 1);
      session.voteCrawler(offset);
      this.tutorial?.noteCrawlerVote();
      this.hud.pushAnnouncement('hud.crawler', 'info');
    }

    void nowSec;
  }

  private handleFiring(
    buttons: number,
    session: MatchSession,
    local: PlayerPublicState | null,
    nowSec: number,
  ): void {
    if (!local || !local.alive) {
      this.firing = false;
      this.chargeStartedAt = 0;
      return;
    }
    const weapon = session.weaponView().weapon;
    const definition = balance.weapons[weapon] as { fireMode: string; fireRate?: number; chargeSecMax?: number };
    const wantsFire = (buttons & InputButton.Fire) !== 0;

    const aim = this.scene.cameraRig.getAimRay({
      position: local.position,
      yaw: this.yaw,
      pitch: this.pitch,
      crouching: local.crouching,
    });

    if (definition.fireMode === 'charge') {
      if (wantsFire && this.chargeStartedAt === 0) this.chargeStartedAt = nowSec;
      if (!wantsFire && this.chargeStartedAt > 0) {
        const held = nowSec - this.chargeStartedAt;
        this.chargeStartedAt = 0;
        session.fire(aim.origin, aim.direction, held);
        this.scene.cameraRig.addRecoil((balance.weapons[weapon] as { recoil?: number }).recoil ?? 1);
        this.tutorial?.noteShot();
      }
      return;
    }

    const interval = definition.fireRate && definition.fireRate > 0 ? 1 / definition.fireRate : 0.2;
    const semiOnly = definition.fireMode === 'semi' || definition.fireMode === 'burst_pellets';
    const canRepeat = !semiOnly || !this.firing;
    if (wantsFire && canRepeat && nowSec - this.lastFireAt >= interval) {
      this.lastFireAt = nowSec;
      session.fire(aim.origin, aim.direction, 0);
      this.scene.cameraRig.addRecoil((balance.weapons[weapon] as { recoil?: number }).recoil ?? 1);
      this.tutorial?.noteShot();
    }
    this.firing = wantsFire;
  }

  private chargeRatioNow(nowSec: number, weapon: WeaponKey): number {
    if (this.chargeStartedAt === 0) return 0;
    return chargeRatio(weapon, nowSec - this.chargeStartedAt);
  }

  // ─────────────────────────── مساعدات ──────────────────────────────────────

  private applySettings(): void {
    const settings = this.settings.value;
    this.scene?.applyGraphics(settings.graphics);
    this.audio.applySettings(settings.audio);
    this.input.updateSettings(settings.controls);
    this.scene?.cameraRig.setReducedShake(settings.accessibility.reducedShake);
    this.touch?.setLayout(settings.controls.touchLayout);
    this.audio.setSubtitles(settings.accessibility.subtitles, (key) => this.hud?.pushAnnouncement(key, 'info'));
  }

  private applyLocale(locale: Locale): void {
    void locale;
    this.hud.applyStaticText();
  }

  private readonly onResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.scene?.resize(width, height);
  };

  private showLoading(status = t('common.loading')): HTMLElement {
    const element = document.createElement('div');
    element.className = 'loading-screen';
    element.innerHTML = `
      <div class="inner">
        <div class="title">DUSKFRONT</div>
        <div class="bar"><i></i></div>
        <div class="status">${status}</div>
      </div>`;
    this.container.appendChild(element);
    return element;
  }
}

/** يبقي الزاوية داخل [-π, π] / keep an angle inside the wire contract's range. */
function wrapAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  let wrapped = angle % twoPi;
  if (wrapped > Math.PI) wrapped -= twoPi;
  if (wrapped < -Math.PI) wrapped += twoPi;
  return wrapped;
}

const container = document.getElementById('app');
if (!container) throw new Error('[duskfront] #app container is missing');
void new DuskfrontApp(container).start();
