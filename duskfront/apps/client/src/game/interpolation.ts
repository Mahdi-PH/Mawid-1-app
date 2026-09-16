/**
 * الاستيفاء: يرسم اللاعبين البعيدين متأخرين 100ms حتى تبدو حركتهم ناعمة.
 * Remote players are rendered 100 ms in the past and interpolated between the two
 * bracketing authoritative snapshots, which hides jitter without hiding the truth.
 */
import { balance, type MatchSnapshot, type PlayerPublicState } from '@duskfront/shared';

const DELAY_MS = balance.network.interpolationDelayMs;
const BUFFER_MS = 1200;

interface TimedSnapshot {
  receivedAt: number;
  snapshot: MatchSnapshot;
}

export class SnapshotInterpolator {
  private readonly buffer: TimedSnapshot[] = [];

  push(snapshot: MatchSnapshot, receivedAt = performance.now()): void {
    this.buffer.push({ receivedAt, snapshot });
    while (this.buffer.length > 2 && receivedAt - this.buffer[0]!.receivedAt > BUFFER_MS) this.buffer.shift();
  }

  get latest(): MatchSnapshot | null {
    return this.buffer.length > 0 ? this.buffer[this.buffer.length - 1]!.snapshot : null;
  }

  get bufferSize(): number {
    return this.buffer.length;
  }

  /**
   * يُنتج لقطة مستوفاة عند اللحظة (الآن − 100ms).
   * الحقول غير المستمرة (الصحة، الذخيرة، الأعلام) تُؤخذ من اللقطة الأحدث.
   */
  sample(now = performance.now()): MatchSnapshot | null {
    if (this.buffer.length === 0) return null;
    if (this.buffer.length === 1) return this.buffer[0]!.snapshot;

    const target = now - DELAY_MS;
    let older: TimedSnapshot | null = null;
    let newer: TimedSnapshot | null = null;
    for (let i = this.buffer.length - 1; i > 0; i--) {
      if (this.buffer[i - 1]!.receivedAt <= target && this.buffer[i]!.receivedAt >= target) {
        older = this.buffer[i - 1]!;
        newer = this.buffer[i]!;
        break;
      }
    }
    if (!older || !newer) {
      // تأخرنا كثيرًا أو وصلنا مبكرًا: استخدم الأحدث كما هو
      return this.buffer[this.buffer.length - 1]!.snapshot;
    }

    const span = newer.receivedAt - older.receivedAt;
    const t = span > 0.001 ? (target - older.receivedAt) / span : 1;
    return blendSnapshots(older.snapshot, newer.snapshot, Math.max(0, Math.min(1, t)));
  }

  clear(): void {
    this.buffer.length = 0;
  }
}

function blendSnapshots(a: MatchSnapshot, b: MatchSnapshot, t: number): MatchSnapshot {
  const byId = new Map<string, PlayerPublicState>();
  for (const player of a.players) byId.set(player.id, player);

  const players = b.players.map((current) => {
    const previous = byId.get(current.id);
    if (!previous || !previous.alive || !current.alive) return current;
    return {
      ...current,
      position: {
        x: lerp(previous.position.x, current.position.x, t),
        y: lerp(previous.position.y, current.position.y, t),
        z: lerp(previous.position.z, current.position.z, t),
      },
      yaw: lerpAngle(previous.yaw, current.yaw, t),
      pitch: lerp(previous.pitch, current.pitch, t),
    };
  });

  const crawlers = b.crawlers.map((current, index) => {
    const previous = a.crawlers[index];
    if (!previous) return current;
    return {
      ...current,
      position: {
        x: lerp(previous.position.x, current.position.x, t),
        y: lerp(previous.position.y, current.position.y, t),
        z: lerp(previous.position.z, current.position.z, t),
      },
      integrity: lerp(previous.integrity, current.integrity, t),
    };
  });

  return {
    ...b,
    players,
    crawlers,
    duskX: lerp(a.duskX, b.duskX, t),
    timeSec: lerp(a.timeSec, b.timeSec, t),
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let delta = (b - a) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
}
