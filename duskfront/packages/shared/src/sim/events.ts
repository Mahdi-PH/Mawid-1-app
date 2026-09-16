/** أحداث المحاكاة التي يستهلكها الخادم والعميل / simulation events drained every tick. */
import type { ClassKey, StructureState, TeamId, Vec3, WeaponKey, WinReason } from '../types.js';

export type SimEvent =
  | { type: 'hit'; attackerId: string; targetId: string; damage: number; headshot: boolean; killed: boolean; distance: number; weapon: WeaponKey | 'ability' | 'explosion' }
  | { type: 'damaged'; targetId: string; amount: number; fromYaw: number; source: 'player' | 'heat' | 'cold' | 'fall' | 'explosion' | 'crawler'; attackerId?: string }
  | { type: 'kill'; killerId: string | null; victimId: string; weapon: WeaponKey | 'ability' | 'environment'; headshot: boolean; assistIds: string[] }
  | { type: 'respawn'; playerId: string; position: Vec3 }
  | { type: 'structure_placed'; structure: StructureState }
  | { type: 'structure_destroyed'; structureId: string; kind: StructureState['kind']; position: Vec3 }
  | { type: 'well_captured'; wellId: number; team: TeamId; playerIds: string[] }
  | { type: 'well_lost'; wellId: number; team: TeamId }
  | { type: 'crawler_damaged'; team: TeamId; integrity: number; reason: 'exposure' | 'core' }
  | { type: 'crawler_zone'; team: TeamId; zone: 'bright' | 'dusk' | 'dark'; secondsOutside: number }
  | { type: 'core_damaged'; team: TeamId; coreHealth: number; attackerId: string }
  | { type: 'ability_used'; playerId: string; classKey: ClassKey; slot: 'q' | 'e' | 'f' }
  | { type: 'ultimate_ready'; playerId: string }
  | { type: 'reveal'; byPlayerId: string; targetId: string }
  | { type: 'shot'; playerId: string; weapon: WeaponKey; origin: Vec3; direction: Vec3; charge: number }
  | { type: 'explosion'; position: Vec3; radius: number; ownerId: string }
  | { type: 'announce'; key: string; severity: 'info' | 'warning' | 'critical'; team?: TeamId; params?: Record<string, string | number> }
  | { type: 'match_end'; winnerTeam: TeamId | null; reason: WinReason };
