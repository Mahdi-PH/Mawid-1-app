/**
 * حالة الغرفة بصيغة Colyseus Schema.
 * The Colyseus-synchronised mirror of the authoritative simulation. Only what the
 * client actually needs to draw is mirrored here; the simulation keeps the rest.
 */
import { ArraySchema, MapSchema, Schema, type } from '@colyseus/schema';

export class PlayerSchema extends Schema {
  @type('string') id = '';
  @type('string') userId = '';
  @type('string') name = '';
  @type('uint8') team = 0;
  @type('string') classKey = 'guardian';
  @type('float32') x = 0;
  @type('float32') y = 0;
  @type('float32') z = 0;
  @type('float32') vx = 0;
  @type('float32') vy = 0;
  @type('float32') vz = 0;
  @type('float32') yaw = 0;
  @type('float32') pitch = 0;
  @type('float32') health = 0;
  @type('float32') maxHealth = 0;
  @type('float32') shield = 0;
  @type('float32') lumen = 0;
  @type('float32') light = 0;
  @type('string') zone = 'dusk';
  @type('float32') heat = 0;
  @type('float32') cold = 0;
  @type('float32') temperatureC = 0;
  @type('boolean') alive = true;
  @type('boolean') cloaked = false;
  @type('boolean') marked = false;
  @type('boolean') crouching = false;
  @type('boolean') grounded = true;
  @type('float32') respawnAt = 0;
  @type('float32') ultimateCharge = 0;
  @type('int16') kills = 0;
  @type('int16') deaths = 0;
  @type('int16') assists = 0;
  @type('uint16') ping = 0;
  @type('boolean') isBot = false;
  @type('boolean') connected = true;
  /** آخر رقم إدخال طبّقه الخادم — أساس التصحيح لدى العميل */
  @type('uint32') lastSeq = 0;
  @type('uint16') magazine = 0;
  @type('uint16') reserve = 0;
  @type('uint8') grenades = 0;
  @type('float32') cooldownQ = 0;
  @type('float32') cooldownE = 0;
}

export class CrawlerSchema extends Schema {
  @type('uint8') team = 0;
  @type('float32') x = 0;
  @type('float32') y = 0;
  @type('float32') z = 0;
  @type('float32') integrity = 100;
  @type('float32') coreHealth = 0;
  @type('float32') coreMaxHealth = 0;
  @type('float32') coreShieldUntil = 0;
  @type('float32') steerOffset = 0;
  @type('float32') boostUntil = 0;
  @type('string') zone = 'dusk';
  @type('float32') outsideSince = -1;
}

export class WellSchema extends Schema {
  @type('uint8') id = 0;
  @type('float32') x = 0;
  @type('float32') z = 0;
  @type('int8') owner = -1;
  @type('float32') progress = 0;
  @type('int8') capturingTeam = -1;
}

export class StructureSchema extends Schema {
  @type('string') id = '';
  @type('string') kind = 'mirror';
  @type('string') ownerId = '';
  @type('uint8') team = 0;
  @type('float32') x = 0;
  @type('float32') y = 0;
  @type('float32') z = 0;
  @type('float32') yaw = 0;
  @type('float32') health = 0;
  @type('float32') maxHealth = 0;
  @type('float32') expiresAt = 0;
  @type('float32') radius = 0;
}

export class GrenadeSchema extends Schema {
  @type('string') id = '';
  @type('uint8') team = 0;
  @type('float32') x = 0;
  @type('float32') y = 0;
  @type('float32') z = 0;
}

export class StrikeSchema extends Schema {
  @type('string') id = '';
  @type('float32') x = 0;
  @type('float32') z = 0;
  @type('float32') at = 0;
  @type('float32') radius = 0;
}

export class MatchState extends Schema {
  @type('string') matchId = '';
  @type('string') mode = 'crawl';
  @type('string') mapKey = 'ash_valley';
  @type('uint32') mapSeed = 0;
  @type('string') phase = 'warmup';
  @type('float32') timeSec = 0;
  @type('float32') durationSec = 0;
  @type('float32') duskX = 0;
  @type('uint32') tick = 0;
  @type(['float32']) teamLumen = new ArraySchema<number>(0, 0);
  @type(['uint16']) teamScore = new ArraySchema<number>(0, 0);
  @type('int8') winnerTeam = -1;
  @type('string') winReason = '';
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
  @type([CrawlerSchema]) crawlers = new ArraySchema<CrawlerSchema>();
  @type([WellSchema]) wells = new ArraySchema<WellSchema>();
  @type({ map: StructureSchema }) structures = new MapSchema<StructureSchema>();
  @type([GrenadeSchema]) grenades = new ArraySchema<GrenadeSchema>();
  @type([StrikeSchema]) strikes = new ArraySchema<StrikeSchema>();
}
