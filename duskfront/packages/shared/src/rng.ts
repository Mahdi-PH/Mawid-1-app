/**
 * مولّد أرقام شبه عشوائية حتمي (mulberry32) + تجزئة قيمية.
 * Deterministic PRNG + integer hash — identical results on Node and in browsers,
 * which is what lets the client and the authoritative server agree on the world.
 */

export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** 0..1 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  int(minInclusive: number, maxExclusive: number): number {
    return Math.floor(this.range(minInclusive, maxExclusive));
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('[rng] pick from empty array');
    return items[this.int(0, items.length)]!;
  }

  /** توزيع طبيعي تقريبي / approximately gaussian (Irwin–Hall). */
  gaussian(mean = 0, stdDev = 1): number {
    const sum = this.next() + this.next() + this.next() + this.next() + this.next() + this.next();
    return mean + (sum - 3) * stdDev;
  }
}

/** تجزئة عدد صحيح ثنائي الأبعاد إلى 0..1 / 2D integer hash → 0..1. */
export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
