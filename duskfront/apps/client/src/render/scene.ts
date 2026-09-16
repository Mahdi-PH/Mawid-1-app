/**
 * مدير المشهد: يجمع السماء والتضاريس والعناصر والشخصيات والمؤثرات في عالم واحد،
 * ويحافظ على ميزانية نداءات الرسم.
 * The scene orchestrator: one place that owns the WebGL renderer, the light rig, and
 * every subsystem above, and keeps them in sync with the authoritative match snapshot.
 */
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PCFSoftShadowMap,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import {
  MAP_HALF,
  balance,
  duskLineX,
  starIntensity,
  sunDirection,
  type GraphicsSettings,
  type MatchSnapshot,
  type PlayerPublicState,
  type StructureState,
  type TeamId,
} from '@duskfront/shared';
import { PlayerView, StructureView } from './actors.js';
import { ThirdPersonCamera } from './camera.js';
import { CrawlerView } from './crawler.js';
import { Effects } from './effects.js';
import { PALETTE, zoneTint } from './palette.js';

/** متجه مؤقّت لحساب المسافات دون تخصيص ذاكرة كل إطار. */
const TMP_DISTANCE = new Vector3();
import { MapProps } from './props.js';
import { Sky } from './sky.js';
import { Terrain } from './terrain.js';

export interface SceneStats {
  drawCalls: number;
  triangles: number;
  fps: number;
}

export class GameScene {
  readonly scene = new Scene();
  readonly renderer: WebGLRenderer;
  readonly cameraRig: ThirdPersonCamera;
  readonly effects = new Effects();

  private sky!: Sky;
  private terrain!: Terrain;
  private props!: MapProps;
  private readonly crawlers: CrawlerView[] = [];
  private readonly players = new Map<string, PlayerView>();
  private readonly structures = new Map<string, StructureView>();
  private readonly sun: DirectionalLight;
  private readonly ambient: AmbientLight;
  private readonly hemi: HemisphereLight;
  private readonly sunVector = new Vector3();
  private tier: GraphicsSettings['tier'];
  private localId = '';
  private localTeam: TeamId = 0;
  private elapsed = 0;
  private frameTimes: number[] = [];

  constructor(canvas: HTMLCanvasElement, settings: GraphicsSettings) {
    this.tier = settings.tier;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: settings.tier !== 'low',
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * settings.resolutionScale);
    this.renderer.shadowMap.enabled = settings.shadows && settings.tier !== 'low';
    this.renderer.shadowMap.type = PCFSoftShadowMap;

    this.cameraRig = new ThirdPersonCamera(settings.fov, canvas.clientWidth / Math.max(1, canvas.clientHeight));

    // منظومة الإضاءة: شمس اتجاهية + ضوء نصف كروي يعطي الليل لونه البنفسجي
    this.sun = new DirectionalLight(PALETTE.sunDisc, 2.4);
    this.sun.castShadow = this.renderer.shadowMap.enabled;
    const quality = balance.graphics[settings.tier];
    if (this.sun.castShadow && quality.shadowMapSize > 0) {
      this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
      this.sun.shadow.camera.near = 1;
      this.sun.shadow.camera.far = 900;
      this.sun.shadow.camera.left = -220;
      this.sun.shadow.camera.right = 220;
      this.sun.shadow.camera.top = 220;
      this.sun.shadow.camera.bottom = -220;
      this.sun.shadow.bias = -0.0008;
      this.sun.shadow.normalBias = 0.35;
    }
    this.scene.add(this.sun, this.sun.target);

    this.ambient = new AmbientLight(PALETTE.duskPurple, 0.45);
    this.hemi = new HemisphereLight(PALETTE.sunHalo, PALETTE.nightDeep, 0.6);
    this.scene.add(this.ambient, this.hemi);

    this.scene.fog = new Fog(PALETTE.duskPurple, 320, 1500);
    this.scene.add(this.effects.group);

    this.buildWorld(settings.tier);
  }

  private buildWorld(tier: GraphicsSettings['tier']): void {
    const quality = balance.graphics[tier];
    this.sky = new Sky(quality.starCount);
    this.sky.addTo(this.scene);

    this.terrain = new Terrain(tier);
    this.scene.add(this.terrain.group);

    this.props = new MapProps(tier);
    this.scene.add(this.props.group);

    for (const team of [0, 1] as TeamId[]) {
      const crawler = new CrawlerView(team);
      crawler.addTo(this.scene);
      this.crawlers.push(crawler);
    }
  }

  setLocalPlayer(sessionId: string, team: TeamId): void {
    this.localId = sessionId;
    this.localTeam = team;
  }

  /** يعيد بناء العالم عند تغيير مستوى الرسومات دون إعادة تحميل الصفحة. */
  applyGraphics(settings: GraphicsSettings): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * settings.resolutionScale);
    this.renderer.shadowMap.enabled = settings.shadows && settings.tier !== 'low';
    this.sun.castShadow = this.renderer.shadowMap.enabled;
    this.cameraRig.setFov(settings.fov);

    if (settings.tier !== this.tier) {
      this.tier = settings.tier;
      this.scene.remove(this.terrain.group, this.props.group, this.sky.mesh);
      this.terrain.dispose();
      this.props.dispose();
      this.sky.dispose();
      for (const crawler of this.crawlers) {
        this.scene.remove(crawler.group);
        crawler.dispose();
      }
      this.crawlers.length = 0;
      this.buildWorld(settings.tier);
    }
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.cameraRig.setAspect(width / Math.max(1, height));
  }

  /** يزامن المشهد مع لقطة المباراة الموثوقة. */
  sync(snapshot: MatchSnapshot, localState: PlayerPublicState | null, dt: number, aiming: boolean): void {
    this.elapsed += dt;
    const now = performance.now() / 1000;
    const duskX = snapshot.duskX;

    // 1) الشمس والإضاءة العامة تتبعان موقع اللاعب بالنسبة لخط الغسق
    const focusX = localState?.position.x ?? duskX;
    const focusZ = localState?.position.z ?? 0;
    const sun = sunDirection(focusX, snapshot.timeSec);
    this.sunVector.set(sun.x, sun.y, sun.z).normalize();
    this.sun.position.set(
      focusX + this.sunVector.x * 420,
      Math.max(40, this.sunVector.y * 420),
      focusZ + this.sunVector.z * 420,
    );
    this.sun.target.position.set(focusX, 0, focusZ);
    this.sun.target.updateMatrixWorld();

    /*
      أرضية إضاءة صريحة: حتى في قلب العتمة يجب أن تبقى الأشكال مقروءة. الليل
      هنا "أزرق قابل للقراءة" لا أسود مطلق، تمامًا كما في اللوحة المرجعية.
    */
    const light = localState?.light ?? 0.5;
    this.sun.intensity = 0.55 + light * 2.5;
    this.sun.color.setHex(light > 0.6 ? PALETTE.sunCore : PALETTE.sunHalo);
    this.ambient.intensity = 0.85 + (1 - light) * 0.75;
    this.ambient.color.setHex(light > 0.55 ? PALETTE.sunHalo : PALETTE.duskViolet);
    this.hemi.intensity = 0.75 + light * 0.6;
    this.hemi.color.setHex(light > 0.5 ? PALETTE.sunHalo : PALETTE.duskMagenta);
    this.hemi.groundColor.setHex(PALETTE.nightHigh);

    // 2) ضباب بلون المنطقة
    const tint = zoneTint(focusX - duskX, balance.dusk.bandWidth / 2);
    if (this.scene.fog instanceof Fog) {
      (this.scene.fog.color as Color).lerp(new Color(tint), 0.06);
      this.scene.fog.near = 260 + light * 220;
      this.scene.fog.far = 1100 + light * 900;
    }

    // 3) السماء
    const cameraPosition = this.cameraRig.camera.position;
    this.sky.update({
      duskX,
      cameraPosition,
      sunDirection: this.sunVector,
      elapsed: this.elapsed,
      starDensity: 0.004 + starIntensity(focusX, snapshot.timeSec) * 0.055,
      exposure: 1,
    });

    // 4) التضاريس ومستويات التفصيل + جيوب الضوء والظل
    this.terrain.uniforms.uDuskX.value = duskX;
    this.terrain.uniforms.uTime.value = this.elapsed;
    this.terrain.uniforms.uSunDirection.value.copy(this.sunVector);
    this.terrain.uniforms.uCameraPos.value.copy(cameraPosition);
    this.terrain.uniforms.uFogDensity.value = 0.00055 + (1 - light) * 0.0006;
    this.terrain.update(this.cameraRig.camera, cameraPosition);

    const pockets = snapshot.structures
      .filter((s) => s.kind === 'mirror' || s.kind === 'shadow_tower' || s.kind === 'dawn_wall')
      .slice(0, 12)
      .map((s) => ({
        x: s.position.x,
        y: s.position.y,
        z: s.position.z,
        radius:
          s.radius ??
          (s.kind === 'mirror'
            ? balance.light.mirrorRadius
            : s.kind === 'shadow_tower'
              ? balance.light.shadowRadius
              : balance.classes.guardian.abilities.f.length * 0.6),
        isShadow: s.kind === 'shadow_tower',
      }));
    this.terrain.setPockets(pockets);

    // 5) العناصر الثابتة والآبار
    this.props.update(this.elapsed, duskX, cameraPosition);
    this.props.updateWells(snapshot.wells);

    // 6) القلاع الزاحفة
    for (const crawlerState of snapshot.crawlers) {
      const view = this.crawlers[crawlerState.team];
      view?.update(crawlerState, this.elapsed, snapshot.timeSec);
    }

    // 7) اللاعبون
    const seen = new Set<string>();
    for (const state of snapshot.players) {
      seen.add(state.id);
      let view = this.players.get(state.id);
      if (!view || view.currentClass !== state.classKey) {
        if (view) {
          this.scene.remove(view.group);
          view.dispose();
        }
        view = new PlayerView(state.id, state.team, state.classKey, state.id === this.localId);
        this.players.set(state.id, view);
        this.scene.add(view.group);
      }
      const isLocal = state.id === this.localId;
      view.update({
        state,
        now,
        isLocal,
        localTeam: this.localTeam,
        nameplateVisible: this.shouldShowNameplate(state, localState),
        firstPerson: this.cameraRig.isFirstPerson,
        cameraDistance: this.cameraRig.camera.position.distanceTo(
          TMP_DISTANCE.set(state.position.x, state.position.y, state.position.z),
        ),
      });
    }
    for (const [id, view] of this.players) {
      if (seen.has(id)) continue;
      this.scene.remove(view.group);
      view.dispose();
      this.players.delete(id);
    }

    // 8) البنى
    const structureIds = new Set<string>();
    for (const structure of snapshot.structures) {
      structureIds.add(structure.id);
      let view = this.structures.get(structure.id);
      if (!view) {
        view = new StructureView(structure);
        this.structures.set(structure.id, view);
        this.scene.add(view.group);
      }
      view.update(structure, this.elapsed);
    }
    for (const [id, view] of this.structures) {
      if (structureIds.has(id)) continue;
      this.scene.remove(view.group);
      view.dispose();
      this.structures.delete(id);
    }

    // 9) الكاميرا والمؤثرات
    if (localState) {
      this.cameraRig.update(
        {
          position: localState.position,
          yaw: localState.yaw,
          pitch: localState.pitch,
          crouching: localState.crouching,
        },
        aiming,
        dt,
        now,
      );
    }
    this.effects.update(now, dt);
  }

  /**
   * قواعد ظهور الاسم فوق الرأس:
   * الحلفاء دائمًا، والأعداء فقط خارج العتمة أو ضمن 15م.
   */
  private shouldShowNameplate(state: PlayerPublicState, local: PlayerPublicState | null): boolean {
    if (!state.alive) return false;
    if (state.team === this.localTeam) return true;
    if (state.cloaked && !state.marked) return false;
    if (!local) return true;
    const distance = Math.hypot(
      state.position.x - local.position.x,
      state.position.y - local.position.y,
      state.position.z - local.position.z,
    );
    if (state.zone === 'dark' && state.light < balance.light.revealThreshold) {
      return distance <= balance.zones.dark.nameplateRange;
    }
    return distance <= 140;
  }

  render(): SceneStats {
    const started = performance.now();
    this.renderer.render(this.scene, this.cameraRig.camera);
    const frameMs = performance.now() - started;
    this.frameTimes.push(frameMs);
    if (this.frameTimes.length > 60) this.frameTimes.shift();

    const info = this.renderer.info;
    return {
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      fps: this.frameTimes.length > 0 ? 1000 / (this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length) : 0,
    };
  }

  /** موضع كاميرا للقائمة الرئيسية: مشهد سينمائي فوق الوادي. */
  setMenuCamera(timeSec: number): void {
    const duskX = duskLineX(timeSec % balance.match.crawl.durationSec);
    const angle = timeSec * 0.035;
    const radius = 240;
    this.cameraRig.camera.position.set(duskX - 120 + Math.cos(angle) * radius, 150, Math.sin(angle) * radius - 60);
    this.cameraRig.camera.lookAt(duskX + 40, 30, 0);
    this.cameraRig.camera.updateMatrixWorld();
  }

  /** حالة جاهزة للعرض في قائمة رئيسية بلا مباراة. */
  idleSync(timeSec: number, dt: number): void {
    this.elapsed += dt;
    const duskX = duskLineX(timeSec % balance.match.crawl.durationSec);
    const focusX = duskX - 80;
    const sun = sunDirection(focusX, timeSec % balance.match.crawl.durationSec);
    this.sunVector.set(sun.x, sun.y, sun.z).normalize();
    this.sun.position.set(focusX + this.sunVector.x * 420, Math.max(40, this.sunVector.y * 420), this.sunVector.z * 420);
    this.sun.target.position.set(focusX, 0, 0);
    this.sun.target.updateMatrixWorld();
    this.sun.intensity = 2.2;

    this.sky.update({
      duskX,
      cameraPosition: this.cameraRig.camera.position,
      sunDirection: this.sunVector,
      elapsed: this.elapsed,
      starDensity: 0.03,
      exposure: 1,
    });
    this.terrain.uniforms.uDuskX.value = duskX;
    this.terrain.uniforms.uTime.value = this.elapsed;
    this.terrain.uniforms.uSunDirection.value.copy(this.sunVector);
    this.terrain.uniforms.uCameraPos.value.copy(this.cameraRig.camera.position);
    this.terrain.update(this.cameraRig.camera, this.cameraRig.camera.position);
    this.props.update(this.elapsed, duskX, this.cameraRig.camera.position);

    for (const crawler of this.crawlers) {
      crawler.update(
        {
          team: crawler.team,
          position: { x: duskX + (crawler.team === 0 ? -60 : 90), y: 12, z: balance.crawler.laneZ[crawler.team]! },
          integrity: 100,
          coreHealth: balance.crawler.core.health,
          coreMaxHealth: balance.crawler.core.health,
          coreShieldUntil: 0,
          outsideSince: -1,
          steerOffset: 0,
          boostUntil: 0,
          zone: 'dusk',
        },
        this.elapsed,
        timeSec,
      );
    }
  }

  dispose(): void {
    for (const view of this.players.values()) view.dispose();
    for (const view of this.structures.values()) view.dispose();
    for (const crawler of this.crawlers) crawler.dispose();
    this.players.clear();
    this.structures.clear();
    this.crawlers.length = 0;
    this.terrain.dispose();
    this.props.dispose();
    this.sky.dispose();
    this.effects.dispose();
    this.renderer.dispose();
  }

  /** للاستخدام في المؤثرات: هل العنصر داخل حدود الخريطة. */
  static insideMap(x: number, z: number): boolean {
    return Math.abs(x) < MAP_HALF && Math.abs(z) < MAP_HALF;
  }

  getPlayerView(id: string): PlayerView | undefined {
    return this.players.get(id);
  }

  /** ربط بنية بمؤثر مرئي عند إنشائها. */
  spawnStructureEffect(structure: StructureState): void {
    this.effects.spawnImpact(structure.position, performance.now() / 1000, PALETTE.techCyan);
  }
}
