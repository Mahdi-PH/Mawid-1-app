/**
 * واجهة اللعب (HUD) — إعادة إنتاج مباشرة لتخطيط اللوحة الفنية المرجعية.
 * The in-match HUD: brand + circular minimap on the leading edge, the dusk timeline
 * across the top, timer/team bars/killfeed on the trailing edge, roster down the side,
 * vitals and the LUMEN CORE gauge along the bottom, ammo opposite.
 */
import {
  balance,
  distanceToDuskEdge,
  duskProgress,
  MAP_HALF,
  MAP_SIZE,
  type ClassKey,
  type MatchSnapshot,
  type PlayerPublicState,
  type TeamId,
  type WeaponKey,
} from '@duskfront/shared';
import type { PerspectiveCamera } from 'three';
import { Vector3 } from 'three';
import { formatDuration, formatNumber, t } from '../i18n/index.js';
import { PALETTE, css, teamColorCss } from '../render/palette.js';

const CLASS_GLYPH: Record<ClassKey, string> = {
  guardian: '🛡',
  sunshot: '🎯',
  nightstalker: '🌑',
  engineer: '🔧',
};

const ABILITY_GLYPH: Record<ClassKey, [string, string, string]> = {
  guardian: ['🪞', '💨', '🌅'],
  sunshot: ['🔥', '🪝', '☀'],
  nightstalker: ['👻', '💧', '👥'],
  engineer: ['🪞', '🗼', '🛠'],
};

export interface HudCallbacks {
  onLeaveMatch(): void;
}

export interface HudFrameInput {
  snapshot: MatchSnapshot;
  local: PlayerPublicState | null;
  localTeam: TeamId;
  camera: PerspectiveCamera;
  matchTimeSec: number;
  durationSec: number;
  aiming: boolean;
  charging: number;
  weapon: WeaponKey;
  magazine: number;
  reserve: number;
  grenades: number;
  reloading: boolean;
  cooldownQ: number;
  cooldownE: number;
  ultimateCharge: number;
  showScoreboard: boolean;
}

interface KillFeedRow {
  element: HTMLElement;
  until: number;
}

export class Hud {
  readonly root: HTMLElement;
  private readonly minimapCanvas: HTMLCanvasElement;
  private readonly minimapCtx: CanvasRenderingContext2D | null;
  private readonly coreCanvas: HTMLCanvasElement;
  private readonly coreCtx: CanvasRenderingContext2D | null;
  private readonly refs: Record<string, HTMLElement> = {};
  private readonly killfeed: KillFeedRow[] = [];
  private readonly announcements: { element: HTMLElement; until: number }[] = [];
  private readonly markerPool: HTMLElement[] = [];
  private readonly projection = new Vector3();
  private damageArcUntil = 0;
  private hitmarkerTimeout: number | null = null;
  private detectUntil = 0;

  constructor(parent: HTMLElement, private readonly callbacks: HudCallbacks) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = template();
    parent.appendChild(this.root);

    const byId = (id: string): HTMLElement => {
      const element = this.root.querySelector<HTMLElement>(`[data-ref="${id}"]`);
      if (!element) throw new Error(`[hud] missing element ${id}`);
      this.refs[id] = element;
      return element;
    };
    for (const id of REF_IDS) byId(id);

    this.minimapCanvas = this.refs.minimap as HTMLCanvasElement;
    this.minimapCanvas.width = 260;
    this.minimapCanvas.height = 260;
    this.minimapCtx = this.minimapCanvas.getContext('2d');

    this.coreCanvas = this.refs.coreGauge as HTMLCanvasElement;
    this.coreCanvas.width = 264;
    this.coreCanvas.height = 264;
    this.coreCtx = this.coreCanvas.getContext('2d');

    this.applyStaticText();
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  /** يحدّث النصوص الثابتة بعد تغيير اللغة. */
  applyStaticText(): void {
    this.refs.brandMain.textContent = 'DUSKFRONT';
    this.refs.brandSub.textContent = 'جبهة الغسق';
    this.refs.duskTitle.textContent = t('hud.duskline');
    this.refs.sunLabel.textContent = t('hud.sun');
    this.refs.moonLabel.textContent = t('hud.moon');
    this.refs.timerLabel.textContent = t('hud.timeLeft');
    this.refs.teamSunName.textContent = t('hud.teamSun');
    this.refs.teamMoonName.textContent = t('hud.teamMoon');
    this.refs.coreLabel.textContent = t('hud.lumenCore');
    this.refs.wellLabel.textContent = t('hud.wells');
    this.refs.detectText.textContent = t('hud.enemyDetected');
    this.refs.healthLabel.textContent = t('hud.health');
    this.refs.shieldLabel.textContent = t('hud.shield');
    this.refs.lumenLabel.textContent = t('hud.lumen');
    this.refs.tempLabel.textContent = t('hud.temperature');
    this.refs.deathTitle.textContent = t('hud.respawnIn');
  }

  // ────────────────────────────── الإطار / frame ────────────────────────────

  update(input: HudFrameInput): void {
    const now = performance.now() / 1000;
    const { snapshot, local } = input;

    this.updateDuskline(input);
    this.updateTimer(input);
    this.updateTeams(input);
    this.updateRoster(input);
    this.updateVitals(input);
    this.updateCoreGauge(input);
    this.updateAbilities(input);
    this.updateAmmo(input);
    this.updateObjective(input);
    this.updateMinimap(input);
    const owned = input.snapshot.wells.filter((w) => w.owner === input.localTeam).length;
    this.refs.wellCount.textContent = `${owned}/${input.snapshot.wells.length}`;
    this.updateWorldMarkers(input);
    this.updateVignettes(input);
    this.updateDeathOverlay(input, now);
    this.updateScoreboard(input);
    this.pruneTimed(now);

    // مؤشر الرصد: يظهر عندما يكون اللاعب مُعلَّمًا أو داخل جيب ضوء معادٍ
    this.refs.detectWarning.hidden = !(local?.marked === true || now < this.detectUntil);

    void snapshot;
  }

  private updateDuskline(input: HudFrameInput): void {
    const progress = duskProgress(input.matchTimeSec, input.durationSec);
    const marker = this.refs.duskMarker;
    marker.style.insetInlineStart = `${(progress * 100).toFixed(2)}%`;
    marker.dataset.label = t('hud.dusk');
  }

  private updateTimer(input: HudFrameInput): void {
    const remaining = Math.max(0, input.durationSec - input.matchTimeSec);
    this.refs.timerValue.textContent = formatDuration(remaining);
    this.refs.timerValue.style.color = remaining < 60 ? css(PALETTE.hudDanger) : '#fff';
  }

  private updateTeams(input: HudFrameInput): void {
    for (const team of [0, 1] as TeamId[]) {
      const crawler = input.snapshot.crawlers[team];
      const percent = crawler
        ? (crawler.integrity / balance.crawler.integrityMax) * 100
        : (input.snapshot.teamScore[team] / balance.match.shadowhunt.killTarget) * 100;
      const row = team === 0 ? this.refs.teamSunRow : this.refs.teamMoonRow;
      const fill = team === 0 ? this.refs.teamSunFill : this.refs.teamMoonFill;
      const pct = team === 0 ? this.refs.teamSunPct : this.refs.teamMoonPct;
      fill.style.inlineSize = `${Math.max(0, Math.min(100, percent))}%`;
      pct.textContent = crawler ? `${Math.round(percent)}%` : String(input.snapshot.teamScore[team]);
      row.classList.toggle('danger', percent < 25);
    }
  }

  private updateRoster(input: HudFrameInput): void {
    const allies = input.snapshot.players
      .filter((p) => p.team === input.localTeam)
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 5);
    const container = this.refs.roster;
    while (container.children.length < allies.length) {
      const card = document.createElement('div');
      card.className = 'roster-card';
      card.innerHTML = `
        <div class="avatar"></div>
        <div class="info">
          <div class="name"></div>
          <div class="bars">
            <div class="bar health"><i></i></div>
            <div class="bar ult"><i></i></div>
          </div>
        </div>
        <div class="class-icon"></div>`;
      container.appendChild(card);
    }
    while (container.children.length > allies.length) container.lastElementChild?.remove();

    allies.forEach((player, index) => {
      const card = container.children[index] as HTMLElement;
      card.classList.toggle('dead', !player.alive);
      card.style.borderInlineStartColor = teamColorCss(player.team);
      card.querySelector('.avatar')!.textContent = CLASS_GLYPH[player.classKey];
      card.querySelector('.name')!.textContent = player.name;
      const health = card.querySelector<HTMLElement>('.bar.health > i')!;
      health.style.inlineSize = `${(player.health / Math.max(1, player.maxHealth)) * 100}%`;
      const ult = card.querySelector<HTMLElement>('.bar.ult > i')!;
      ult.style.inlineSize = `${(player.ultimateCharge / balance.ultimate.chargeTarget) * 100}%`;
      card.querySelector('.class-icon')!.textContent = CLASS_GLYPH[player.classKey];
    });
  }

  private updateVitals(input: HudFrameInput): void {
    const local = input.local;
    const health = local?.health ?? 0;
    const maxHealth = local?.maxHealth ?? 1;
    const shield = local?.shield ?? 0;
    const lumen = local?.lumen ?? 0;

    this.refs.healthFill.style.inlineSize = `${(health / maxHealth) * 100}%`;
    this.refs.healthValue.innerHTML = `${Math.ceil(health)}<small>/${Math.round(maxHealth)}</small>`;
    this.refs.healthRow.classList.toggle('low', health / maxHealth < 0.3);

    this.refs.shieldFill.style.inlineSize = `${(shield / balance.player.shieldMax) * 100}%`;
    this.refs.shieldValue.innerHTML = `${Math.ceil(shield)}<small>/${balance.player.shieldMax}</small>`;

    this.refs.lumenFill.style.inlineSize = `${(lumen / balance.lumen.personalMax) * 100}%`;
    this.refs.lumenValue.textContent = String(Math.round(lumen));

    // الحرارة: تُشتق من عدّادات التعرّض التي يرسلها الخادم
    const zone = local?.zone ?? 'dusk';
    const heat = local?.heat ?? 0;
    const cold = local?.cold ?? 0;
    const ambient = balance.zones[zone].ambientTempC;
    const duskAmbient = balance.zones.dusk.ambientTempC;
    const heatT = Math.min(1, heat / balance.zones.bright.heatGraceSec);
    const coldT = Math.min(1, cold / balance.zones.dark.coldGraceSec);
    const temperature =
      zone === 'bright'
        ? duskAmbient + (ambient - duskAmbient) * heatT
        : zone === 'dark'
          ? duskAmbient + (ambient - duskAmbient) * coldT
          : ambient;
    this.refs.tempValue.textContent = `${Math.round(temperature)}°C`;
    this.refs.tempRow.classList.toggle('hot', zone === 'bright' && heatT > 0.6);
    this.refs.tempRow.classList.toggle('cold', zone === 'dark' && coldT > 0.6);
    this.refs.portrait.textContent = local ? CLASS_GLYPH[local.classKey] : '◆';
  }

  /** مقياس نواة اللومِن: قوس متدرّج من الشمس إلى القمر، كما في اللوحة. */
  private updateCoreGauge(input: HudFrameInput): void {
    const ctx = this.coreCtx;
    if (!ctx) return;
    const local = input.local;
    const light = local?.light ?? 0.5;
    const size = this.coreCanvas.width;
    const center = size / 2;
    const radius = size * 0.38;

    ctx.clearRect(0, 0, size, size);

    // القوس الخلفي
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.arc(center, center, radius, Math.PI * 0.75, Math.PI * 2.25);
    ctx.stroke();

    // القوس الفعّال بتدرّج شمس→غسق→قمر
    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, css(PALETTE.sunDisc));
    gradient.addColorStop(0.5, css(PALETTE.duskMagenta));
    gradient.addColorStop(1, css(PALETTE.techCyan));
    ctx.strokeStyle = gradient;
    ctx.shadowBlur = 18;
    ctx.shadowColor = 'rgba(255,201,60,0.55)';
    ctx.beginPath();
    ctx.arc(center, center, radius, Math.PI * 0.75, Math.PI * 0.75 + Math.PI * 1.5 * light);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // شرطات الشحن حول القوس
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 24; i++) {
      const angle = Math.PI * 0.75 + (Math.PI * 1.5 * i) / 24;
      const inner = radius + 10;
      const outer = radius + (i % 6 === 0 ? 20 : 15);
      ctx.beginPath();
      ctx.moveTo(center + Math.cos(angle) * inner, center + Math.sin(angle) * inner);
      ctx.lineTo(center + Math.cos(angle) * outer, center + Math.sin(angle) * outer);
      ctx.stroke();
    }

    // قلب متوهّج يتبع مستوى الضوء
    const glow = ctx.createRadialGradient(center, center, 2, center, center, radius * 0.72);
    glow.addColorStop(0, `rgba(255,243,207,${0.18 + light * 0.75})`);
    glow.addColorStop(0.55, `rgba(255,179,71,${0.12 + light * 0.35})`);
    glow.addColorStop(1, 'rgba(12,16,38,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(center, center, radius * 0.72, 0, Math.PI * 2);
    ctx.fill();

    this.refs.coreReadout.textContent = `${Math.round(light * 100)}%`;
  }

  private updateAbilities(input: HudFrameInput): void {
    const local = input.local;
    if (!local) return;
    const glyphs = ABILITY_GLYPH[local.classKey];
    const slots: { ref: string; cooldown: number; glyph: string; key: string }[] = [
      { ref: 'abilityQ', cooldown: input.cooldownQ, glyph: glyphs[0], key: 'Q' },
      { ref: 'abilityE', cooldown: input.cooldownE, glyph: glyphs[1], key: 'E' },
      { ref: 'abilityF', cooldown: 0, glyph: glyphs[2], key: 'F' },
    ];
    for (const slot of slots) {
      const element = this.refs[slot.ref]!;
      element.querySelector('.glyph')!.textContent = slot.glyph;
      element.querySelector('.key')!.textContent = slot.key;
      const cooldownElement = element.querySelector<HTMLElement>('.cooldown')!;
      if (slot.ref === 'abilityF') {
        const ratio = input.ultimateCharge / balance.ultimate.chargeTarget;
        const ready = ratio >= 1;
        element.classList.toggle('ready', ready);
        cooldownElement.style.display = ready ? 'none' : 'grid';
        cooldownElement.textContent = `${Math.floor(ratio * 100)}%`;
        element.querySelector<HTMLElement>('.charge')!.style.inlineSize = `${Math.min(100, ratio * 100)}%`;
      } else {
        const ready = slot.cooldown <= 0.05;
        element.classList.toggle('ready', ready);
        cooldownElement.style.display = ready ? 'none' : 'grid';
        cooldownElement.textContent = slot.cooldown > 0 ? slot.cooldown.toFixed(1) : '';
      }
    }
  }

  private updateAmmo(input: HudFrameInput): void {
    const isSolar = input.weapon === 'beam_rifle' || input.weapon === 'lumen_cannon';
    const ammo = this.refs.ammoPanel;
    ammo.classList.toggle('solar', isSolar);
    ammo.classList.toggle('reloading', input.reloading);
    if (isSolar) {
      const cost = (balance.weapons[input.weapon] as { lumenPerShot?: number }).lumenPerShot ?? 0;
      const shots = cost > 0 ? Math.floor((input.local?.lumen ?? 0) / cost) : 0;
      this.refs.ammoMag.textContent = String(shots);
      this.refs.ammoReserve.textContent = `${Math.round(input.local?.lumen ?? 0)}`;
    } else {
      this.refs.ammoMag.textContent = String(input.magazine);
      this.refs.ammoReserve.textContent = String(input.reserve);
    }
    this.refs.weaponName.textContent = t(`weapon.${input.weapon}`);
    this.refs.grenadeCount.textContent = `${t('hud.grenades')}: ${input.grenades}`;
  }

  private updateObjective(input: HudFrameInput): void {
    const local = input.local;
    const enemyTeam = (1 - input.localTeam) as TeamId;
    const crawler = input.snapshot.crawlers[enemyTeam];
    if (!crawler || !local) {
      this.refs.objective.hidden = true;
      return;
    }
    this.refs.objective.hidden = false;
    this.refs.objectiveTitle.textContent = t('hud.crawler');
    const ratio = crawler.integrity / balance.crawler.integrityMax;
    this.refs.objectiveFill.style.inlineSize = `${ratio * 100}%`;
    const distance = Math.hypot(crawler.position.x - local.position.x, crawler.position.z - local.position.z);
    this.refs.objectiveDistance.textContent = `${Math.round(distance)}m`;

    // المسافة إلى حافة الشفق (عدّاد «الغسق يتحرك»)
    const edge = distanceToDuskEdge(local.position.x, input.matchTimeSec);
    this.refs.duskDistance.textContent =
      edge > 0
        ? `${t('hud.distanceToDusk')} ${Math.round(edge)}m`
        : `${t(`zone.${local.zone}`)} · ${Math.round(-edge)}m`;
  }

  /**
   * الخريطة المصغّرة: ثلاث مناطق ملوّنة، خط الغسق المتحرك، الآبار، القلعتان، والفريق.
   * Enemies obey the same visibility rule as the world: hidden while they are deep in
   * the dark, unless a mirror pocket or a thermal mark gives them away.
   */
  private updateMinimap(input: HudFrameInput): void {
    const ctx = this.minimapCtx;
    if (!ctx || !input.local) return;
    const size = this.minimapCanvas.width;
    const center = size / 2;
    const viewRange = 420;
    const scale = center / viewRange;
    const local = input.local;

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(center, center, center - 1, 0, Math.PI * 2);
    ctx.clip();

    // خلفية المناطق الثلاث
    const duskScreenX = center + (input.snapshot.duskX - local.position.x) * scale;
    const half = (balance.dusk.bandWidth / 2) * scale;
    ctx.fillStyle = 'rgba(12, 16, 40, 0.95)';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(232, 93, 38, 0.30)';
    ctx.fillRect(0, 0, duskScreenX - half, size);
    ctx.fillStyle = 'rgba(124, 58, 237, 0.34)';
    ctx.fillRect(duskScreenX - half, 0, half * 2, size);
    ctx.fillStyle = 'rgba(12, 20, 58, 0.55)';
    ctx.fillRect(duskScreenX + half, 0, size - (duskScreenX + half), size);

    // خط الغسق نفسه
    ctx.strokeStyle = css(PALETTE.duskMagenta);
    ctx.lineWidth = 2;
    ctx.shadowBlur = 10;
    ctx.shadowColor = css(PALETTE.duskMagenta);
    ctx.beginPath();
    ctx.moveTo(duskScreenX, 0);
    ctx.lineTo(duskScreenX, size);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // حدود الخريطة
    const worldToMap = (x: number, z: number): [number, number] => [
      center + (x - local.position.x) * scale,
      center + (z - local.position.z) * scale,
    ];
    ctx.strokeStyle = 'rgba(146, 186, 255, 0.28)';
    ctx.lineWidth = 1;
    const [bx, bz] = worldToMap(-MAP_HALF, -MAP_HALF);
    ctx.strokeRect(bx, bz, MAP_SIZE * scale, MAP_SIZE * scale);

    // الآبار
    for (const well of input.snapshot.wells) {
      const [x, y] = worldToMap(well.position.x, well.position.z);
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = well.owner >= 0 ? teamColorCss(well.owner) : 'rgba(154, 168, 199, 0.85)';
      ctx.fill();
      if (well.progress > 0.02 && well.owner < 0) {
        ctx.beginPath();
        ctx.arc(x, y, 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * well.progress);
        ctx.strokeStyle = well.capturingTeam >= 0 ? teamColorCss(well.capturingTeam) : '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // القلاع
    for (const crawler of input.snapshot.crawlers) {
      const [x, y] = worldToMap(crawler.position.x, crawler.position.z);
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = teamColorCss(crawler.team);
      ctx.globalAlpha = crawler.zone === 'dusk' ? 0.95 : 0.6;
      ctx.fillRect(-7, -4, 14, 8);
      ctx.strokeStyle = crawler.zone === 'dusk' ? 'rgba(255,255,255,0.6)' : css(PALETTE.hudDanger);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-7, -4, 14, 8);
      ctx.restore();
    }

    // اللاعبون
    for (const player of input.snapshot.players) {
      if (!player.alive) continue;
      if (player.id === local.id) continue;
      const friendly = player.team === input.localTeam;
      if (!friendly) {
        if (player.cloaked && !player.marked) continue;
        if (player.zone === 'dark' && player.light < balance.light.revealThreshold && !player.marked) continue;
      }
      const [x, y] = worldToMap(player.position.x, player.position.z);
      ctx.beginPath();
      ctx.arc(x, y, 3.4, 0, Math.PI * 2);
      ctx.fillStyle = friendly ? css(PALETTE.hudFriendly) : css(PALETTE.hudEnemy);
      ctx.fill();
    }

    ctx.restore();

    // سهم اللاعب في المركز
    ctx.save();
    ctx.translate(center, center);
    ctx.rotate(-local.yaw);
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5.5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5.5, 6);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.shadowBlur = 8;
    ctx.shadowColor = 'rgba(255,255,255,0.8)';
    ctx.fill();
    ctx.restore();
  }

  /** علامات عالمية مسقطة على الشاشة (حلفاء، أعداء مرصودون، آبار، قلعة العدو). */
  private updateWorldMarkers(input: HudFrameInput): void {
    const local = input.local;
    const container = this.refs.markers;
    if (!local) {
      container.replaceChildren();
      return;
    }
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    interface MarkerSpec {
      x: number;
      y: number;
      z: number;
      label: string;
      glyph: string;
      kind: string;
    }
    const specs: MarkerSpec[] = [];

    for (const player of input.snapshot.players) {
      if (!player.alive || player.id === local.id) continue;
      const friendly = player.team === input.localTeam;
      if (!friendly) {
        if (!player.marked) continue;
        specs.push({
          x: player.position.x,
          y: player.position.y + balance.player.height + 0.7,
          z: player.position.z,
          label: player.name,
          glyph: '◈',
          kind: 'enemy',
        });
      } else {
        specs.push({
          x: player.position.x,
          y: player.position.y + balance.player.height + 0.7,
          z: player.position.z,
          label: player.name,
          glyph: '◆',
          kind: 'ally',
        });
      }
    }

    for (const well of input.snapshot.wells) {
      specs.push({
        x: well.position.x,
        y: 6,
        z: well.position.z,
        label: well.owner >= 0 ? t('hud.wells') : t('hud.wells'),
        glyph: '◎',
        kind: 'well',
      });
    }

    const enemyCrawler = input.snapshot.crawlers[(1 - input.localTeam) as TeamId];
    if (enemyCrawler) {
      specs.push({
        x: enemyCrawler.position.x,
        y: enemyCrawler.position.y + balance.crawler.height + 8,
        z: enemyCrawler.position.z,
        label: t('hud.core'),
        glyph: '✦',
        kind: 'crawler',
      });
    }

    while (this.markerPool.length < specs.length) {
      const element = document.createElement('div');
      element.className = 'world-marker';
      element.innerHTML = '<span class="glyph"></span><span class="label"></span><span class="dist"></span>';
      container.appendChild(element);
      this.markerPool.push(element);
    }

    for (let i = 0; i < this.markerPool.length; i++) {
      const element = this.markerPool[i]!;
      const spec = specs[i];
      if (!spec) {
        element.style.display = 'none';
        continue;
      }
      this.projection.set(spec.x, spec.y, spec.z).project(input.camera);
      const behind = this.projection.z > 1;
      const distance = Math.hypot(spec.x - local.position.x, spec.z - local.position.z);
      if (behind || distance > 620) {
        element.style.display = 'none';
        continue;
      }
      element.style.display = 'flex';
      element.className = `world-marker ${spec.kind}`;
      element.style.insetInlineStart = `${((this.projection.x * 0.5 + 0.5) * width).toFixed(1)}px`;
      element.style.insetBlockStart = `${((-this.projection.y * 0.5 + 0.5) * height).toFixed(1)}px`;
      element.querySelector('.glyph')!.textContent = spec.glyph;
      element.querySelector('.label')!.textContent = distance > 40 ? '' : spec.label;
      element.querySelector('.dist')!.textContent = `${Math.round(distance)}m`;
    }
  }

  private updateVignettes(input: HudFrameInput): void {
    const local = input.local;
    const heat = local?.heat ?? 0;
    const cold = local?.cold ?? 0;
    const heatRatio = Math.max(0, (heat - balance.zones.bright.heatGraceSec * 0.5) / (balance.zones.bright.heatGraceSec * 0.5));
    const coldRatio = Math.max(0, (cold - balance.zones.dark.coldGraceSec * 0.5) / (balance.zones.dark.coldGraceSec * 0.5));
    this.refs.heatVignette.style.opacity = String(Math.min(0.85, heatRatio * 0.7));
    this.refs.coldVignette.style.opacity = String(Math.min(0.85, coldRatio * 0.7));

    const healthRatio = local && local.maxHealth > 0 ? local.health / local.maxHealth : 1;
    this.refs.damageVignette.style.opacity = String(healthRatio < 0.35 ? (0.35 - healthRatio) * 2.2 : 0);
  }

  private updateDeathOverlay(input: HudFrameInput, now: number): void {
    const local = input.local;
    const dead = local !== null && !local.alive;
    this.refs.deathOverlay.hidden = !dead;
    if (dead && local) {
      const remaining = Math.max(0, local.respawnAt - input.matchTimeSec);
      this.refs.deathCounter.textContent = remaining.toFixed(1);
    }
    void now;
  }

  private updateScoreboard(input: HudFrameInput): void {
    this.refs.scoreboard.hidden = !input.showScoreboard;
    if (!input.showScoreboard) return;
    const rows = [...input.snapshot.players].sort(
      (a, b) => a.team - b.team || b.kills - a.kills || a.deaths - b.deaths,
    );
    const body = this.refs.scoreboardBody;
    body.replaceChildren();
    for (const player of rows) {
      const tr = document.createElement('tr');
      tr.className = `team-${player.team}${player.id === input.local?.id ? ' me' : ''}`;
      tr.innerHTML = `
        <td>${escapeHtml(player.name)}${player.isBot ? ' 🤖' : ''}</td>
        <td>${escapeHtml(t(`class.${player.classKey}`))}</td>
        <td class="num">${player.kills}</td>
        <td class="num">${player.deaths}</td>
        <td class="num">${player.assists}</td>
        <td class="num">${player.ping}</td>`;
      body.appendChild(tr);
    }
    this.refs.scoreboardTitle.textContent = t('result.scoreboard');
    const headers = this.refs.scoreboardHead.querySelectorAll('th');
    const labels = [
      'scoreboard.player',
      'scoreboard.class',
      'scoreboard.kills',
      'scoreboard.deaths',
      'scoreboard.assists',
      'scoreboard.ping',
    ];
    headers.forEach((th, index) => {
      th.textContent = t(labels[index]!);
    });
  }

  private pruneTimed(now: number): void {
    for (let i = this.killfeed.length - 1; i >= 0; i--) {
      if (now > this.killfeed[i]!.until) {
        this.killfeed[i]!.element.remove();
        this.killfeed.splice(i, 1);
      }
    }
    for (let i = this.announcements.length - 1; i >= 0; i--) {
      if (now > this.announcements[i]!.until) {
        this.announcements[i]!.element.remove();
        this.announcements.splice(i, 1);
      }
    }
    if (now > this.damageArcUntil) this.refs.damageArc.style.opacity = '0';
  }

  // ─────────────────────────── أحداث / events ───────────────────────────────

  pushKillfeed(entry: {
    killerName: string;
    killerTeam: number;
    victimName: string;
    victimTeam: number;
    weapon: string;
    headshot: boolean;
    localTeam: TeamId;
  }): void {
    const element = document.createElement('div');
    element.className = 'entry';
    const weaponLabel = entry.weapon === 'environment' ? '☀/❄' : entry.weapon === 'ability' ? '✦' : '⌖';
    element.innerHTML = `
      <span class="killer ${entry.killerTeam === entry.localTeam ? '' : 'enemy'}">${escapeHtml(entry.killerName || '—')}</span>
      <span class="weapon">${weaponLabel}${entry.headshot ? '<span class="headshot"> ✶</span>' : ''}</span>
      <span class="victim ${entry.victimTeam === entry.localTeam ? 'friendly' : ''}">${escapeHtml(entry.victimName)}</span>`;
    this.refs.killfeed.prepend(element);
    this.killfeed.push({ element, until: performance.now() / 1000 + 6 });
    while (this.killfeed.length > 6) {
      const oldest = this.killfeed.shift();
      oldest?.element.remove();
    }
  }

  pushAnnouncement(key: string, severity: 'info' | 'warning' | 'critical', params?: Record<string, string | number>): void {
    const element = document.createElement('div');
    element.className = `announcement ${severity}`;
    element.textContent = t(key, params);
    this.refs.announcements.appendChild(element);
    this.announcements.push({ element, until: performance.now() / 1000 + (severity === 'critical' ? 5 : 3.2) });
  }

  showHitmarker(killed: boolean): void {
    const marker = this.refs.hitmarker;
    marker.classList.remove('show');
    marker.classList.toggle('kill', killed);
    void marker.offsetWidth;
    marker.classList.add('show');
    if (this.hitmarkerTimeout !== null) window.clearTimeout(this.hitmarkerTimeout);
    this.hitmarkerTimeout = window.setTimeout(() => marker.classList.remove('show'), 260);
  }

  /** مؤشر اتجاه الضرر: يدور حول التصويب نحو المهاجم. */
  showDamageDirection(fromYaw: number, playerYaw: number): void {
    const relative = fromYaw - playerYaw;
    this.refs.damageArc.style.transform = `rotate(${relative}rad)`;
    this.refs.damageArc.style.opacity = '1';
    this.damageArcUntil = performance.now() / 1000 + 1.1;
  }

  flagDetected(): void {
    this.detectUntil = performance.now() / 1000 + 4;
  }

  setCrosshairState(charging: number, aiming: boolean): void {
    const crosshair = this.refs.crosshair;
    crosshair.classList.toggle('charging', charging > 0.15);
    const spread = aiming ? 8 : 14 + charging * 6;
    crosshair.style.width = `${spread * 2}px`;
    crosshair.style.height = `${spread * 2}px`;
  }

  dispose(): void {
    this.root.remove();
  }
}

const REF_IDS = [
  'brandMain',
  'brandSub',
  'minimap',
  'wellLabel',
  'wellCount',
  'duskTitle',
  'duskMarker',
  'sunLabel',
  'moonLabel',
  'timerValue',
  'timerLabel',
  'teamSunRow',
  'teamSunName',
  'teamSunFill',
  'teamSunPct',
  'teamMoonRow',
  'teamMoonName',
  'teamMoonFill',
  'teamMoonPct',
  'killfeed',
  'detectWarning',
  'detectText',
  'roster',
  'portrait',
  'healthRow',
  'healthLabel',
  'healthFill',
  'healthValue',
  'shieldLabel',
  'shieldFill',
  'shieldValue',
  'lumenLabel',
  'lumenFill',
  'lumenValue',
  'tempRow',
  'tempLabel',
  'tempValue',
  'coreGauge',
  'coreReadout',
  'coreLabel',
  'abilityQ',
  'abilityE',
  'abilityF',
  'ammoPanel',
  'ammoMag',
  'ammoReserve',
  'weaponName',
  'grenadeCount',
  'objective',
  'objectiveTitle',
  'objectiveFill',
  'objectiveDistance',
  'duskDistance',
  'markers',
  'crosshair',
  'hitmarker',
  'damageArc',
  'damageVignette',
  'heatVignette',
  'coldVignette',
  'announcements',
  'deathOverlay',
  'deathTitle',
  'deathCounter',
  'scoreboard',
  'scoreboardTitle',
  'scoreboardHead',
  'scoreboardBody',
] as const;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

function template(): string {
  return `
  <div class="damage-vignette" data-ref="damageVignette"></div>
  <div class="heat-vignette" data-ref="heatVignette"></div>
  <div class="cold-vignette" data-ref="coldVignette"></div>

  <div class="hud-brand">
    <div class="brand-main" data-ref="brandMain">DUSKFRONT</div>
    <div class="brand-sub" data-ref="brandSub">جبهة الغسق</div>
  </div>

  <div class="hud-minimap">
    <canvas data-ref="minimap"></canvas>
    <span class="compass n">N</span><span class="compass s">S</span>
    <span class="compass e">E</span><span class="compass w">W</span>
  </div>

  <div class="hud-wells panel">
    <span class="well-icon"></span>
    <span class="well-count" data-ref="wellCount">0/6</span>
    <span class="well-label" data-ref="wellLabel"></span>
  </div>

  <div class="hud-duskline">
    <div class="dusk-title" data-ref="duskTitle"></div>
    <div class="dusk-track">
      <span class="endpoint sun">☀</span>
      <span class="endpoint-label sun" data-ref="sunLabel"></span>
      <span class="endpoint moon">☾</span>
      <span class="endpoint-label moon" data-ref="moonLabel"></span>
      <span class="dusk-marker" data-ref="duskMarker" data-label="DUSK"></span>
    </div>
  </div>

  <div class="hud-topright">
    <div class="hud-timer panel">
      <span class="value" data-ref="timerValue">20:00</span>
      <span class="label" data-ref="timerLabel"></span>
    </div>
    <div class="team-bars panel">
      <div class="team-row sun" data-ref="teamSunRow">
        <span class="team-icon">☀</span>
        <span class="team-name" data-ref="teamSunName"></span>
        <span class="bar"><i data-ref="teamSunFill" style="inline-size:100%"></i></span>
        <span class="pct" data-ref="teamSunPct">100%</span>
      </div>
      <div class="team-row moon" data-ref="teamMoonRow">
        <span class="team-icon">☾</span>
        <span class="team-name" data-ref="teamMoonName"></span>
        <span class="bar"><i data-ref="teamMoonFill" style="inline-size:100%"></i></span>
        <span class="pct" data-ref="teamMoonPct">100%</span>
      </div>
    </div>
    <div class="killfeed" data-ref="killfeed"></div>
  </div>

  <div class="detect-warning" data-ref="detectWarning" hidden>
    <span>⚠</span><span data-ref="detectText"></span>
  </div>

  <div class="hud-roster" data-ref="roster"></div>

  <div class="hud-vitals panel">
    <div class="portrait" data-ref="portrait">◆</div>
    <div class="vital-rows">
      <div class="vital-row health" data-ref="healthRow">
        <span class="icon">❤</span><span class="label" data-ref="healthLabel"></span>
        <span class="bar"><i data-ref="healthFill"></i></span>
        <span class="value" data-ref="healthValue">0</span>
      </div>
      <div class="vital-row shield">
        <span class="icon">🛡</span><span class="label" data-ref="shieldLabel"></span>
        <span class="bar"><i data-ref="shieldFill"></i></span>
        <span class="value" data-ref="shieldValue">0</span>
      </div>
      <div class="vital-row lumen">
        <span class="icon">◈</span><span class="label" data-ref="lumenLabel"></span>
        <span class="bar"><i data-ref="lumenFill"></i></span>
        <span class="value" data-ref="lumenValue">0</span>
      </div>
      <div class="vital-row temp" data-ref="tempRow">
        <span class="icon">🌡</span><span class="label" data-ref="tempLabel"></span>
        <span class="bar"><i style="inline-size:0"></i></span>
        <span class="value" data-ref="tempValue">0°C</span>
      </div>
    </div>
  </div>

  <div class="hud-core">
    <div class="gauge">
      <canvas data-ref="coreGauge"></canvas>
      <div class="readout" data-ref="coreReadout">0%</div>
    </div>
    <div class="core-label" data-ref="coreLabel">LUMEN CORE</div>
  </div>

  <div class="hud-abilities">
    <div class="ability" data-ref="abilityQ">
      <span class="glyph"></span><span class="key">Q</span>
      <div class="cooldown"></div><i class="charge"></i>
    </div>
    <div class="ability" data-ref="abilityE">
      <span class="glyph"></span><span class="key">E</span>
      <div class="cooldown"></div><i class="charge"></i>
    </div>
    <div class="ability ultimate" data-ref="abilityF">
      <span class="glyph"></span><span class="key">F</span>
      <div class="cooldown"></div><i class="charge"></i>
    </div>
  </div>

  <div class="hud-ammo panel" data-ref="ammoPanel">
    <div class="counts">
      <span class="mag" data-ref="ammoMag">30</span>
      <span class="sep">|</span>
      <span class="reserve" data-ref="ammoReserve">120</span>
    </div>
    <div class="weapon-name"><span>⌖</span><span data-ref="weaponName"></span></div>
    <div class="grenades" data-ref="grenadeCount"></div>
  </div>

  <div class="objective-marker" data-ref="objective">
    <div class="title" data-ref="objectiveTitle"></div>
    <div class="bar"><i data-ref="objectiveFill"></i></div>
    <div class="distance" data-ref="objectiveDistance"></div>
    <div class="distance" data-ref="duskDistance"></div>
  </div>

  <div class="layer" data-ref="markers"></div>

  <div class="crosshair" data-ref="crosshair">
    <span class="t"></span><span class="b"></span><span class="l"></span><span class="r"></span><span class="dot"></span>
  </div>
  <div class="hitmarker" data-ref="hitmarker">
    <span class="a"></span><span class="b"></span><span class="c"></span><span class="d"></span>
  </div>
  <div class="damage-arc" data-ref="damageArc"></div>

  <div class="announcements" data-ref="announcements"></div>

  <div class="death-overlay" data-ref="deathOverlay" hidden>
    <div style="text-align:center">
      <div class="title" data-ref="deathTitle"></div>
      <div class="respawn" data-ref="deathCounter">0.0</div>
    </div>
  </div>

  <div class="scoreboard panel" data-ref="scoreboard" hidden>
    <div class="head"><h2 data-ref="scoreboardTitle"></h2></div>
    <table>
      <thead data-ref="scoreboardHead"><tr><th></th><th></th><th></th><th></th><th></th><th></th></tr></thead>
      <tbody data-ref="scoreboardBody"></tbody>
    </table>
  </div>`;
}
