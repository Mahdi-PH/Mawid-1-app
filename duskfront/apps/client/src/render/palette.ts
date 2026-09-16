/**
 * لوحة ألوان «جبهة الغسق» — مأخوذة من اللوحة الفنية المرجعية.
 * The Duskfront palette, sampled from the reference key art: a molten gold west, a
 * magenta terminator, an indigo night lit by cyan crystals.
 *
 * كل لون هنا يُستخدم في الرسم وفي الواجهة معًا حتى تبقى اللعبة قطعة واحدة.
 */

export const PALETTE = {
  // ── الشمس / the blazing west ───────────────────────────────────────────────
  sunCore: 0xfff3cf,
  sunDisc: 0xffd782,
  sunHalo: 0xffb347,
  sunDeep: 0xff8a3d,
  emberDeep: 0xe85d26,
  sandLit: 0xc98b58,
  sandShadow: 0x8a5a3c,

  // ── الشفق / the terminator ─────────────────────────────────────────────────
  duskMagenta: 0xc64bff,
  duskViolet: 0xa855f7,
  duskPurple: 0x7c3aed,
  duskDeep: 0x4c1d95,

  // ── الليل / the indigo east ────────────────────────────────────────────────
  nightHigh: 0x1a1b4b,
  nightMid: 0x151c44,
  nightDeep: 0x0b1026,
  nightAbyss: 0x050814,

  // ── البلورات والتقنية / crystals and tech ─────────────────────────────────
  crystalCyan: 0x4fc3f7,
  crystalBright: 0x67e8f9,
  techCyan: 0x38bdf8,
  techTeal: 0x2dd4bf,

  // ── الواجهة / HUD ─────────────────────────────────────────────────────────
  hudAmber: 0xffc93c,
  hudGold: 0xffe6a8,
  hudCyan: 0x7fe3ff,
  hudDanger: 0xff4d4d,
  hudWarn: 0xffa62b,
  hudFriendly: 0x54d6ff,
  hudEnemy: 0xff5470,
  hudNeutral: 0x9aa8c7,
} as const;

/** لون فريق (0 = الشمس، 1 = القمر) / team accent colour. */
export function teamColor(team: number): number {
  return team === 0 ? PALETTE.hudAmber : PALETTE.techCyan;
}

export function teamColorCss(team: number): string {
  return team === 0 ? '#ffc93c' : '#38bdf8';
}

/** تحويل رقم لون إلى CSS / numeric colour → css hex. */
export function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** مزج لونين / linear blend between two packed colours. */
export function mixColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const k = Math.max(0, Math.min(1, t));
  const r = Math.round(ar + (br - ar) * k);
  const g = Math.round(ag + (bg - ag) * k);
  const bl = Math.round(ab + (bb - ab) * k);
  return (r << 16) | (g << 8) | bl;
}

/** لون الأفق حسب المنطقة / horizon tint for a zone, used by sky and fog. */
export function zoneTint(signedDistanceToDusk: number, bandHalfWidth: number): number {
  const d = signedDistanceToDusk;
  if (d < -bandHalfWidth) {
    const t = Math.min(1, (-d - bandHalfWidth) / 420);
    return mixColor(PALETTE.duskMagenta, PALETTE.sunHalo, t);
  }
  if (d > bandHalfWidth) {
    const t = Math.min(1, (d - bandHalfWidth) / 420);
    return mixColor(PALETTE.duskPurple, PALETTE.nightDeep, t);
  }
  const t = (d + bandHalfWidth) / (bandHalfWidth * 2);
  return mixColor(PALETTE.sunDeep, PALETTE.duskMagenta, t);
}
