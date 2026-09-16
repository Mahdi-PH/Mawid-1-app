/**
 * شبكة تنقّل للبوتات + A*.
 * Navigation grid + A* pathfinding for the bots.
 *
 * ملاحظة تصميمية: بديل حتمي وخفيف عن recast-navigation-js (انظر README «تعديلات مقترحة»).
 * A deterministic, dependency-free replacement for recast-navigation-js: the terrain is
 * an analytic heightfield, so a slope-sampled grid is both exact and cheap to rebuild.
 */
import { balance } from '../balance.js';
import { MAP_HALF, isWalkable, terrainHeight } from '../terrain.js';
import type { Vec3 } from '../types.js';

const CELL = 12;
const DIM = Math.floor(balance.map.size / CELL);

export class NavGrid {
  readonly dim = DIM;
  readonly cell = CELL;
  private readonly walkable: Uint8Array;
  private readonly heights: Float32Array;

  constructor() {
    this.walkable = new Uint8Array(DIM * DIM);
    this.heights = new Float32Array(DIM * DIM);
    for (let iz = 0; iz < DIM; iz++) {
      for (let ix = 0; ix < DIM; ix++) {
        const { x, z } = this.cellCenter(ix, iz);
        const idx = iz * DIM + ix;
        this.walkable[idx] = isWalkable(x, z) ? 1 : 0;
        this.heights[idx] = terrainHeight(x, z);
      }
    }
  }

  cellCenter(ix: number, iz: number): { x: number; z: number } {
    return { x: -MAP_HALF + (ix + 0.5) * CELL, z: -MAP_HALF + (iz + 0.5) * CELL };
  }

  toCell(x: number, z: number): { ix: number; iz: number } {
    return {
      ix: Math.min(DIM - 1, Math.max(0, Math.floor((x + MAP_HALF) / CELL))),
      iz: Math.min(DIM - 1, Math.max(0, Math.floor((z + MAP_HALF) / CELL))),
    };
  }

  isFree(ix: number, iz: number): boolean {
    if (ix < 0 || iz < 0 || ix >= DIM || iz >= DIM) return false;
    return this.walkable[iz * DIM + ix] === 1;
  }

  /** أقرب خلية سالكة / nearest walkable cell (spiral search). */
  nearestFree(x: number, z: number): { ix: number; iz: number } {
    const start = this.toCell(x, z);
    if (this.isFree(start.ix, start.iz)) return start;
    for (let r = 1; r < 12; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          if (this.isFree(start.ix + dx, start.iz + dz)) return { ix: start.ix + dx, iz: start.iz + dz };
        }
      }
    }
    return start;
  }

  /**
   * مسار A* بين نقطتين في العالم / A* path in world coordinates.
   * يعيد قائمة نقاط طريق (waypoints) أو مصفوفة فارغة إن تعذّر.
   */
  findPath(from: Vec3, to: Vec3, maxNodes = 4000): Vec3[] {
    const start = this.nearestFree(from.x, from.z);
    const goal = this.nearestFree(to.x, to.z);
    const startIdx = start.iz * DIM + start.ix;
    const goalIdx = goal.iz * DIM + goal.ix;
    if (startIdx === goalIdx) return [{ x: to.x, y: terrainHeight(to.x, to.z), z: to.z }];

    const gScore = new Map<number, number>();
    const cameFrom = new Map<number, number>();
    const open: { idx: number; f: number }[] = [];
    const closed = new Set<number>();

    const heuristic = (idx: number): number => {
      const ix = idx % DIM;
      const iz = Math.floor(idx / DIM);
      return Math.hypot(ix - goal.ix, iz - goal.iz);
    };

    gScore.set(startIdx, 0);
    open.push({ idx: startIdx, f: heuristic(startIdx) });

    let expanded = 0;
    while (open.length > 0 && expanded < maxNodes) {
      open.sort((a, b) => a.f - b.f);
      const current = open.shift()!;
      if (current.idx === goalIdx) return this.reconstruct(cameFrom, current.idx, to);
      if (closed.has(current.idx)) continue;
      closed.add(current.idx);
      expanded++;

      const cx = current.idx % DIM;
      const cz = Math.floor(current.idx / DIM);
      const baseG = gScore.get(current.idx) ?? 0;
      const baseH = this.heights[current.idx] ?? 0;

      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (!this.isFree(nx, nz)) continue;
          const nIdx = nz * DIM + nx;
          if (closed.has(nIdx)) continue;
          // منع القطع القطري عبر زاوية مسدودة
          if (dx !== 0 && dz !== 0 && (!this.isFree(cx + dx, cz) || !this.isFree(cx, cz + dz))) continue;
          const climb = Math.abs((this.heights[nIdx] ?? 0) - baseH);
          const stepCost = (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1) + climb * 0.12;
          const tentative = baseG + stepCost;
          if (tentative < (gScore.get(nIdx) ?? Number.POSITIVE_INFINITY)) {
            gScore.set(nIdx, tentative);
            cameFrom.set(nIdx, current.idx);
            open.push({ idx: nIdx, f: tentative + heuristic(nIdx) * 1.05 });
          }
        }
      }
    }
    return [];
  }

  private reconstruct(cameFrom: Map<number, number>, endIdx: number, goal: Vec3): Vec3[] {
    const idxPath: number[] = [endIdx];
    let cur = endIdx;
    while (cameFrom.has(cur)) {
      cur = cameFrom.get(cur)!;
      idxPath.push(cur);
    }
    idxPath.reverse();
    const points: Vec3[] = [];
    // تبسيط المسار: احتفظ بنقاط تغيّر الاتجاه فقط
    let prevDir = { dx: 0, dz: 0 };
    for (let i = 1; i < idxPath.length; i++) {
      const a = idxPath[i - 1]!;
      const b = idxPath[i]!;
      const dx = Math.sign((b % DIM) - (a % DIM));
      const dz = Math.sign(Math.floor(b / DIM) - Math.floor(a / DIM));
      if (dx !== prevDir.dx || dz !== prevDir.dz) {
        const ix = a % DIM;
        const iz = Math.floor(a / DIM);
        const c = this.cellCenter(ix, iz);
        points.push({ x: c.x, y: terrainHeight(c.x, c.z), z: c.z });
        prevDir = { dx, dz };
      }
    }
    points.push({ x: goal.x, y: terrainHeight(goal.x, goal.z), z: goal.z });
    return points;
  }
}

let shared: NavGrid | null = null;
/** شبكة التنقّل المشتركة (تُبنى مرة واحدة) / lazily-built shared nav grid. */
export function getNavGrid(): NavGrid {
  if (!shared) shared = new NavGrid();
  return shared;
}
