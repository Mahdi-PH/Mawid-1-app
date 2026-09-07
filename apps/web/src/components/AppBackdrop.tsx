// Decorative background — a generated SVG line-icon pattern, replacing the
// earlier uploaded photo. Rendered once per page (see the call sites: home,
// /subscribe, /signup, /find/*, /clinic, /admin — every page that used to
// render the photo now renders this same component with zero changes on
// their end, since this component takes no props).
//
// Design constraints, from the user's own brief: only flat/minimalist line
// icons across four balanced categories (medical/surgical, pharmaceutical,
// booking/appointments, light beauty tools) — never a human face, figure, or
// body; colors are muted/low-opacity brand tones only, so nothing here ever
// competes with the logo or a card's own full-opacity color. Built as a real
// SVG <pattern> tile (not JS-randomized placement) so it's deterministic —
// no client/server render mismatch — and repeats seamlessly at any viewport
// size, unlike a fixed-aspect-ratio raster photo.
//
// No negative z-index here on purpose: the parent must be `position:
// relative` (or otherwise positioned) with no z-index of its own, so it
// never forms a stacking context that would make a negative z-index child
// escape it and paint behind the parent's own background instead of in
// front of it — this was a real, caught-before-shipping bug the first time
// this backdrop was built (see CLAUDE.md). Simpler and robust instead: this
// stays a plain z-index:auto absolutely-positioned layer, and the actual
// content sibling(s) on the page must also be `position: relative` (or
// otherwise positioned) so both land in the same paint layer — DOM order
// (this element first) then decides the stacking, no stacking-context
// plumbing required. Every page that renders this component follows that
// same two-part rule.
export default function AppBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice">
        <defs>
          {/* Two very faint corner glows for a touch of depth — same soft
              treatment the original photo-based backdrop had, at an even
              lower opacity than the icon pattern itself so it never reads
              as its own shape. */}
          <radialGradient id="mb-wash-a" cx="12%" cy="6%" r="60%">
            <stop offset="0%" stopColor="#2DD6DC" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#2DD6DC" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="mb-wash-b" cx="90%" cy="96%" r="55%">
            <stop offset="0%" stopColor="#00ADB5" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#00ADB5" stopOpacity="0" />
          </radialGradient>

          {/* Twelve flat line-icon glyphs, three per required category —
              medical/surgical: stethoscope, scalpel, medical cross ·
              pharmaceutical: capsule, blister strip, medicine vial ·
              booking/appointments: clock, calendar, confirmation check ·
              light beauty tools: comb, brush, care droplet. Each is a plain
              stroke glyph (fill:none, stroke:currentColor) in a 32x32 box so
              every <use> below can recolor/resize it independently. */}
          <g id="mb-stetho" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 4v9a7 7 0 0 0 14 0V9" />
            <circle cx="9" cy="4" r="2" />
            <circle cx="23" cy="9" r="2" />
            <circle cx="16" cy="27" r="4" />
            <path d="M16 19v4" />
          </g>
          <g id="mb-scalpel" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="21" width="14" height="4.5" rx="2.25" transform="rotate(-35 11 23.25)" />
            <path d="M15.5 15 24 6.5a2.4 2.4 0 0 1 3.4 3.4L18.9 18.4z" />
          </g>
          <g id="mb-cross" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="4" width="24" height="24" rx="7" />
            <path d="M16 10v12M10 16h12" />
          </g>
          <g id="mb-pill" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <rect x="6" y="12" width="20" height="8" rx="4" transform="rotate(45 16 16)" />
            <path d="M16 9v14" transform="rotate(45 16 16)" />
          </g>
          <g id="mb-strip" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="11" width="24" height="10" rx="3" />
            <circle cx="9.5" cy="16" r="2" />
            <circle cx="16" cy="16" r="2" />
            <circle cx="22.5" cy="16" r="2" />
          </g>
          <g id="mb-vial" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 4h6v3.5h-6z" />
            <path d="M12 7.5h8V25a3 3 0 0 1-3 3h-2a3 3 0 0 1-3-3z" />
            <path d="M12 18h8" />
          </g>
          <g id="mb-clock" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="16" cy="16" r="12" />
            <path d="M16 9v7l5 3" />
          </g>
          <g id="mb-calendar" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="7" width="24" height="21" rx="4" />
            <path d="M4 13h24M10 4v6M22 4v6" />
            <path d="M11 19.5 14 22.5 20 16.5" />
          </g>
          <g id="mb-check" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="16" cy="16" r="11" />
            <path d="M11 16.2 14.4 19.6 21.2 12.4" />
          </g>
          <g id="mb-comb" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 6h20v5.5H6z" />
            <path d="M8 11.5v14M12.4 11.5v14M16.8 11.5v14M21.2 11.5v14M25.6 11.5v14" />
          </g>
          <g id="mb-brush" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6c2-2 5-2 6.5 0s0.5 4.5-1.5 6.5l-8.5 8.5-5-5z" />
            <path d="M11 21 5 27" />
            <circle cx="4" cy="28" r="1.5" fill="currentColor" stroke="none" />
          </g>
          <g id="mb-drop" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 5c6.2 8 9.4 12.9 9.4 16.9A9.4 9.4 0 1 1 6.6 21.9C6.6 17.9 9.8 13 16 5Z" />
          </g>

          {/* Fixed, hand-placed tile — deterministic, not random, so this
              never mismatches between server and client render. 12 icons,
              generous even spacing, small varied rotation/scale per icon
              for a soft, non-mechanical grid rather than a rigid checkerboard. */}
          <pattern id="mb-pattern" width="340" height="340" patternUnits="userSpaceOnUse">
            <use href="#mb-stetho" transform="translate(52 44) rotate(-8) scale(1.15) translate(-16 -16)" style={{ color: "#007A80", opacity: 0.13 }} />
            <use href="#mb-pill" transform="translate(159 41) rotate(6) scale(1.05) translate(-16 -16)" style={{ color: "#00ADB5", opacity: 0.17 }} />
            <use href="#mb-calendar" transform="translate(266 52) rotate(-5) scale(1.2) translate(-16 -16)" style={{ color: "#007A80", opacity: 0.14 }} />
            <use href="#mb-comb" transform="translate(96 111) rotate(9) scale(1.0) translate(-16 -16)" style={{ color: "#007A80", opacity: 0.13 }} />
            <use href="#mb-vial" transform="translate(207 122) rotate(-11) scale(1.1) translate(-16 -16)" style={{ color: "#007A80", opacity: 0.14 }} />
            <use href="#mb-check" transform="translate(296 140) rotate(4) scale(1.25) translate(-16 -16)" style={{ color: "#00ADB5", opacity: 0.17 }} />
            <use href="#mb-cross" transform="translate(41 170) rotate(7) scale(1.0) translate(-16 -16)" style={{ color: "#007A80", opacity: 0.14 }} />
            <use href="#mb-clock" transform="translate(144 185) rotate(-6) scale(1.15) translate(-16 -16)" style={{ color: "#007A80", opacity: 0.13 }} />
            <use href="#mb-brush" transform="translate(251 188) rotate(5) scale(1.05) translate(-16 -16)" style={{ color: "#007A80", opacity: 0.14 }} />
            <use href="#mb-strip" transform="translate(70 251) rotate(-9) scale(1.2) translate(-16 -16)" style={{ color: "#007A80", opacity: 0.13 }} />
            <use href="#mb-drop" transform="translate(181 262) rotate(8) scale(1.1) translate(-16 -16)" style={{ color: "#00ADB5", opacity: 0.17 }} />
            <use href="#mb-scalpel" transform="translate(285 255) rotate(-4) scale(1.0) translate(-16 -16)" style={{ color: "#007A80", opacity: 0.14 }} />
          </pattern>
        </defs>

        <rect width="100%" height="100%" fill="#F2FBFC" />
        <rect width="100%" height="100%" fill="url(#mb-wash-a)" />
        <rect width="100%" height="100%" fill="url(#mb-wash-b)" />
        <rect width="100%" height="100%" fill="url(#mb-pattern)" />
      </svg>
    </div>
  );
}
