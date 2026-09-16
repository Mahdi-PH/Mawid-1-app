/**
 * الحملة الفردية: 8 مهام تعمل على نفس المحاكاة المشتركة، مع حفظ تلقائي
 * عند كل نقطة تفتيش ونهاية كل مهمة، ونسخة محلية تُزامَن لاحقًا.
 * The campaign drives the same authoritative simulation the multiplayer uses; missions
 * are objective scripts layered on top, and every checkpoint autosaves locally first.
 */
import {
  balance,
  duskLineX,
  type CampaignCheckpoint,
  type CampaignSaveDto,
  type ClassKey,
  type Difficulty,
  type MatchSnapshot,
  type TeamId,
} from '@duskfront/shared';
import type { ApiClient } from '../core/api.js';
import { LocalSaves } from '../core/storage.js';
import { LocalMatch, type MatchEventSink } from './match-session.js';

export type ObjectiveKind =
  | 'reach_dusk'
  | 'survive_seconds'
  | 'kill_count'
  | 'place_mirrors'
  | 'reveal_enemies'
  | 'capture_wells'
  | 'escort_crawler'
  | 'damage_core'
  | 'stay_in_dark'
  | 'stay_out_of_dark';

export interface Objective {
  kind: ObjectiveKind;
  target: number;
  /** مفتاح ترجمة الوصف */
  labelKey: string;
}

export interface MissionDefinition {
  index: number;
  titleKey: string;
  briefKey: string;
  objectives: Objective[];
  durationSec: number;
  enemyCount: number;
  allyCount: number;
  classKey?: ClassKey;
}

/** المهام الثماني — كل واحدة تعلّم طبقة جديدة من آليات الضوء. */
export const CAMPAIGN_MISSIONS: MissionDefinition[] = [
  {
    index: 0,
    titleKey: 'campaign.m1.title',
    briefKey: 'campaign.m1.brief',
    objectives: [
      { kind: 'reach_dusk', target: 1, labelKey: 'campaign.m1.brief' },
      { kind: 'survive_seconds', target: 90, labelKey: 'campaign.m1.brief' },
    ],
    durationSec: 240,
    enemyCount: 2,
    allyCount: 1,
  },
  {
    index: 1,
    titleKey: 'campaign.m2.title',
    briefKey: 'campaign.m2.brief',
    objectives: [
      { kind: 'place_mirrors', target: 2, labelKey: 'campaign.m2.brief' },
      { kind: 'reveal_enemies', target: 2, labelKey: 'campaign.m2.brief' },
    ],
    durationSec: 300,
    enemyCount: 3,
    allyCount: 2,
    classKey: 'engineer',
  },
  {
    index: 2,
    titleKey: 'campaign.m3.title',
    briefKey: 'campaign.m3.brief',
    objectives: [
      { kind: 'kill_count', target: 4, labelKey: 'campaign.m3.brief' },
      { kind: 'escort_crawler', target: 120, labelKey: 'campaign.m3.brief' },
    ],
    durationSec: 360,
    enemyCount: 4,
    allyCount: 2,
  },
  {
    index: 3,
    titleKey: 'campaign.m4.title',
    briefKey: 'campaign.m4.brief',
    objectives: [{ kind: 'capture_wells', target: 3, labelKey: 'campaign.m4.brief' }],
    durationSec: 420,
    enemyCount: 4,
    allyCount: 3,
  },
  {
    index: 4,
    titleKey: 'campaign.m5.title',
    briefKey: 'campaign.m5.brief',
    objectives: [
      { kind: 'stay_in_dark', target: 120, labelKey: 'campaign.m5.brief' },
      { kind: 'kill_count', target: 3, labelKey: 'campaign.m5.brief' },
    ],
    durationSec: 420,
    enemyCount: 4,
    allyCount: 2,
    classKey: 'nightstalker',
  },
  {
    index: 5,
    titleKey: 'campaign.m6.title',
    briefKey: 'campaign.m6.brief',
    objectives: [
      { kind: 'stay_out_of_dark', target: 150, labelKey: 'campaign.m6.brief' },
      { kind: 'escort_crawler', target: 180, labelKey: 'campaign.m6.brief' },
    ],
    durationSec: 480,
    enemyCount: 5,
    allyCount: 3,
  },
  {
    index: 6,
    titleKey: 'campaign.m7.title',
    briefKey: 'campaign.m7.brief',
    objectives: [{ kind: 'damage_core', target: 3000, labelKey: 'campaign.m7.brief' }],
    durationSec: 540,
    enemyCount: 5,
    allyCount: 4,
  },
  {
    index: 7,
    titleKey: 'campaign.m8.title',
    briefKey: 'campaign.m8.brief',
    objectives: [
      { kind: 'damage_core', target: 6000, labelKey: 'campaign.m8.brief' },
      { kind: 'kill_count', target: 8, labelKey: 'campaign.m8.brief' },
    ],
    durationSec: 600,
    enemyCount: 5,
    allyCount: 4,
  },
];

export interface ObjectiveProgress {
  objective: Objective;
  progress: number;
  complete: boolean;
}

export type SaveStatus = 'synced' | 'local_only' | 'conflict';

export interface CampaignConflict {
  server: CampaignSaveDto;
  local: CampaignSaveDto;
}

/**
 * يدير مهمة حملة واحدة: يبني المباراة المحلية، ويتابع الأهداف، ويحفظ.
 */
export class CampaignRun {
  readonly match: LocalMatch;
  readonly mission: MissionDefinition;
  readonly difficulty: Difficulty;
  readonly slot: number;
  private readonly objectives: ObjectiveProgress[];
  private readonly startedAt = performance.now();
  private accumulatedPlayTime: number;
  private lastCheckpointIndex = -1;
  private flags: Record<string, boolean> = {};
  private version: number;
  private lastSaveStatus: SaveStatus = 'local_only';
  private conflict: CampaignConflict | null = null;

  constructor(
    mission: MissionDefinition,
    options: {
      slot: number;
      difficulty: Difficulty;
      classKey: ClassKey;
      playerName: string;
      resumeFrom?: CampaignSaveDto;
    },
    sink: MatchEventSink,
    private readonly api: ApiClient,
  ) {
    this.mission = mission;
    this.slot = options.slot;
    this.difficulty = options.difficulty;
    this.version = options.resumeFrom?.version ?? 0;
    this.accumulatedPlayTime = options.resumeFrom?.playTimeS ?? 0;
    this.flags = { ...(options.resumeFrom?.checkpoint.flags ?? {}) };
    this.lastCheckpointIndex = options.resumeFrom?.checkpoint.objectiveIndex ?? -1;

    this.objectives = mission.objectives.map((objective) => ({ objective, progress: 0, complete: false }));

    this.match = new LocalMatch(
      {
        mode: 'campaign',
        classKey: mission.classKey ?? options.classKey,
        difficulty: options.difficulty,
        playerName: options.playerName,
        teamSize: Math.max(mission.allyCount, mission.enemyCount),
        durationSec: mission.durationSec,
        seed: balance.map.seed + mission.index * 7919,
      },
      sink,
    );
  }

  get progress(): ObjectiveProgress[] {
    return this.objectives;
  }

  get saveStatus(): SaveStatus {
    return this.lastSaveStatus;
  }

  get pendingConflict(): CampaignConflict | null {
    return this.conflict;
  }

  get playTimeSeconds(): number {
    return this.accumulatedPlayTime + (performance.now() - this.startedAt) / 1000;
  }

  get complete(): boolean {
    return this.objectives.every((entry) => entry.complete);
  }

  /** يُستدعى كل إطار بعد تحديث المباراة. */
  tick(snapshot: MatchSnapshot, dt: number): void {
    const local = snapshot.players.find((player) => player.id === this.match.localId);
    if (!local) return;
    const sim = this.match.sim;
    const player = sim.getPlayer(this.match.localId);
    if (!player) return;

    for (const entry of this.objectives) {
      if (entry.complete) continue;
      switch (entry.objective.kind) {
        case 'reach_dusk':
          if (local.zone === 'dusk') entry.progress = 1;
          break;
        case 'survive_seconds':
          if (local.alive) entry.progress += dt;
          break;
        case 'kill_count':
          entry.progress = player.stats.kills;
          break;
        case 'place_mirrors':
          entry.progress = player.stats.mirrorsPlaced;
          break;
        case 'reveal_enemies':
          entry.progress = player.stats.revealsByMirror;
          break;
        case 'capture_wells':
          entry.progress = snapshot.wells.filter((well) => well.owner === this.match.localTeam).length;
          break;
        case 'escort_crawler': {
          const crawler = snapshot.crawlers[this.match.localTeam];
          if (crawler && crawler.zone === 'dusk') entry.progress += dt;
          break;
        }
        case 'damage_core':
          entry.progress = player.stats.crawlerDamage;
          break;
        case 'stay_in_dark':
          if (local.zone === 'dark' && local.alive) entry.progress += dt;
          break;
        case 'stay_out_of_dark':
          if (local.zone !== 'dark' && local.alive) entry.progress += dt;
          break;
        default:
          break;
      }
      if (entry.progress >= entry.objective.target) {
        entry.progress = entry.objective.target;
        entry.complete = true;
        this.flags[`objective_${entry.objective.kind}`] = true;
        void this.saveCheckpoint(snapshot);
      }
    }
  }

  /** حفظ تلقائي عند نقطة تفتيش (هدف مكتمل) أو نهاية مهمة. */
  async saveCheckpoint(snapshot: MatchSnapshot): Promise<SaveStatus> {
    const local = snapshot.players.find((player) => player.id === this.match.localId);
    const completedCount = this.objectives.filter((entry) => entry.complete).length;
    if (completedCount === this.lastCheckpointIndex && !this.complete) return this.lastSaveStatus;
    this.lastCheckpointIndex = completedCount;

    const checkpoint: CampaignCheckpoint = {
      missionIndex: this.mission.index,
      objectiveIndex: completedCount,
      playerHealth: local?.health ?? 0,
      playerLumen: local?.lumen ?? 0,
      position: local?.position ?? { x: duskLineX(snapshot.timeSec), y: 0, z: 0 },
      flags: this.flags,
      score: Math.round((local?.kills ?? 0) * 100),
    };

    const dto: CampaignSaveDto = {
      slot: this.slot,
      missionIndex: this.complete ? Math.min(this.mission.index + 1, CAMPAIGN_MISSIONS.length - 1) : this.mission.index,
      checkpoint,
      difficulty: this.difficulty,
      playTimeS: Math.round(this.playTimeSeconds),
      version: this.version,
      updatedAt: new Date().toISOString(),
    };

    // 1) الكتابة المحلية أولًا — لا نخسر التقدّم أبدًا
    await LocalSaves.put(dto);

    // 2) ثم المزامنة مع الخادم بقفل تفاؤلي
    if (!this.api.isAuthenticated) {
      await LocalSaves.markPending(dto);
      this.lastSaveStatus = 'local_only';
      return this.lastSaveStatus;
    }
    try {
      const saved = await this.api.putSave(this.slot, {
        missionIndex: dto.missionIndex,
        checkpoint: dto.checkpoint,
        difficulty: dto.difficulty,
        playTimeS: dto.playTimeS,
        version: dto.version,
      });
      this.version = saved.version;
      await LocalSaves.put({ ...dto, version: saved.version, updatedAt: saved.updatedAt });
      await LocalSaves.clearPending(this.slot);
      this.lastSaveStatus = 'synced';
    } catch (error) {
      const details = (error as { details?: { server?: CampaignSaveDto } }).details;
      if (details?.server) {
        // تعارض نسخ: نحتفظ بالاثنين ويقرّر اللاعب
        this.conflict = { server: details.server, local: dto };
        this.lastSaveStatus = 'conflict';
      } else {
        await LocalSaves.markPending(dto);
        this.lastSaveStatus = 'local_only';
      }
    }
    return this.lastSaveStatus;
  }

  /** حلّ التعارض باختيار اللاعب. */
  async resolveConflict(keep: 'server' | 'local'): Promise<void> {
    const conflict = this.conflict;
    if (!conflict) return;
    if (keep === 'server') {
      this.version = conflict.server.version;
      await LocalSaves.put(conflict.server);
    } else {
      this.version = conflict.server.version;
      await this.api
        .putSave(this.slot, {
          missionIndex: conflict.local.missionIndex,
          checkpoint: conflict.local.checkpoint,
          difficulty: conflict.local.difficulty,
          playTimeS: conflict.local.playTimeS,
          version: conflict.server.version,
        })
        .then(async (saved) => {
          this.version = saved.version;
          await LocalSaves.put({ ...conflict.local, version: saved.version, updatedAt: saved.updatedAt });
        })
        .catch(() => undefined);
    }
    this.conflict = null;
    this.lastSaveStatus = 'synced';
  }
}

/** يزامن أي حفظ محلي معلّق عند عودة الاتصال. */
export async function syncPendingSaves(api: ApiClient): Promise<number> {
  if (!api.isAuthenticated) return 0;
  const pending = await LocalSaves.listPending();
  let synced = 0;
  for (const save of pending) {
    try {
      const saved = await api.putSave(save.slot, {
        missionIndex: save.missionIndex,
        checkpoint: save.checkpoint,
        difficulty: save.difficulty,
        playTimeS: save.playTimeS,
        version: save.version,
      });
      await LocalSaves.put({ ...save, version: saved.version, updatedAt: saved.updatedAt });
      await LocalSaves.clearPending(save.slot);
      synced++;
    } catch {
      /* يبقى في الطابور حتى المحاولة التالية */
    }
  }
  return synced;
}

/** يدمج قائمة الحفظ المحلية مع قائمة الخادم لعرضها في القائمة. */
export async function listSaveSlots(api: ApiClient): Promise<(CampaignSaveDto | null)[]> {
  const slots: (CampaignSaveDto | null)[] = new Array(balance.campaign.saveSlots).fill(null);
  const localSaves = await LocalSaves.list();
  for (const save of localSaves) {
    if (save.slot >= 1 && save.slot <= slots.length) slots[save.slot - 1] = save;
  }
  if (api.isAuthenticated) {
    try {
      const remote = await api.listSaves();
      for (const save of remote.saves) {
        const index = save.slot - 1;
        const current = slots[index];
        // الأحدث يفوز في العرض؛ التعارض الحقيقي يُكشف عند الكتابة
        if (!current || new Date(save.updatedAt) > new Date(current.updatedAt)) slots[index] = save;
      }
    } catch {
      /* نعرض المحلي فقط */
    }
  }
  return slots;
}

export const TEAM_PLAYER: TeamId = 0;
