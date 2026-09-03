// Light, static (non-animated — "ثابتة") decorative background for the
// home screen. Rendered exactly once, unconditionally, and never remounted
// by page.tsx's own phase changes (intro -> revealing -> home) — it is the
// one constant layer every phase sits in front of, matching the user's
// explicit ask that this stays "الخلفية الدائمة والمستمرة في كل مراحل
// التطبيق خلف الخيارات" (the permanent, continuous background behind the
// clickable options throughout every phase).
//
// Redesigned per the user's reference image (a beauty/clinic-tools frame:
// brush, comb, mirror, scissors, razor, lotion bottle, calendar, leaves,
// scattered around the edges over a cream-to-teal gradient) — reproduced
// here as clean line-icons in the app's own existing visual language
// (matching the logo mark's stroke style) rather than embedding the
// uploaded photo directly: a raster image with its own cream background
// and fixed aspect ratio wouldn't blend into this app's actual
// `#F5FBF9` background or scale cleanly across the very different phone
// viewport sizes this app runs on, where an SVG scales natively with no
// visible seam. Two explicit edits from the reference were applied here:
// the comb is replaced with a stethoscope (السماعة الطبية), and every
// color is pulled from the app's own brand palette (#17A892/#0F7A6C/
// #0A5A4F) at low opacity instead of the reference's pastel illustration
// tones, answering "قريبة من لون الشعار" + "تخفف السطوع قليلا".
//
// One shared radialGradient stroke (light-to-dark brand teal) is reused
// by every icon and the background wash itself, so "تدريجية" (gradient)
// holds for the whole composition, not just individual pieces.
export default function HomeBackdrop() {
  return (
    // No negative z-index here on purpose: `main` (the parent) is only
    // `position: relative` with no z-index of its own, so it never forms
    // a stacking context — a negative z-index child would escape it and
    // paint behind main's own background instead of in front of it,
    // making the whole backdrop invisible. Simpler and robust instead:
    // this stays a plain z-index:auto absolutely-positioned layer, and
    // the actual content siblings in page.tsx get `relative` too, so both
    // land in the same paint layer and DOM order (this element first)
    // decides the stacking — no stacking-context plumbing required.
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* Soft cream-to-teal gradient wash, echoing the reference image's
          own background — kept subtle (see the radialGradient stops)
          rather than a strong color field, per "تخفف السطوع قليلا". */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 8%, rgba(23,168,146,0.10) 0%, rgba(23,168,146,0) 55%), " +
            "linear-gradient(160deg, rgba(15,122,108,0.10) 0%, rgba(23,168,146,0.03) 45%, rgba(10,90,79,0.12) 100%)",
        }}
      />

      <svg
        viewBox="0 0 400 800"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
      >
        <defs>
          <linearGradient id="toolGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#17A892" />
            <stop offset="100%" stopColor="#0A5A4F" />
          </linearGradient>
        </defs>
        <g fill="none" stroke="url(#toolGrad)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.16">
          {/* Makeup brush — top-left */}
          <g transform="translate(46,64) rotate(-24)">
            <path d="M-10 -22 C-16 -14 -16 -4 -8 2 C-2 6 4 4 6 -2 C8 -10 4 -18 -2 -22 C-5 -24 -8 -24 -10 -22 Z" />
            <line x1="-6" y1="1" x2="14" y2="34" />
          </g>

          {/* Stethoscope — top-right (replaces the reference's comb) */}
          <g transform="translate(338,92)">
            <path d="M-20 -30 C-22 -24 -20 -20 -16 -20 C-12 -20 -10 -24 -12 -30" />
            <path d="M-16 -20 C-16 -6 -10 2 0 2 C6 2 8 -2 8 -8 L8 -14" />
            <circle cx="8" cy="18" r="9" />
          </g>

          {/* Hand mirror — mid-left */}
          <g transform="translate(38,270)">
            <circle cx="0" cy="-6" r="17" />
            <line x1="0" y1="11" x2="0" y2="34" />
            <line x1="-9" y1="34" x2="9" y2="34" />
          </g>

          {/* Lotion / pump bottle — mid-right */}
          <g transform="translate(362,318)">
            <rect x="-13" y="-4" width="26" height="36" rx="8" />
            <rect x="-5" y="-16" width="10" height="13" rx="2" />
            <path d="M5 -16 L16 -24" />
            <circle cx="18" cy="-26" r="2.6" />
          </g>

          {/* Scissors — lower-left */}
          <g transform="translate(50,520)">
            <circle cx="-14" cy="16" r="6.5" />
            <circle cx="-14" cy="-16" r="6.5" />
            <line x1="-9" y1="12" x2="20" y2="-18" />
            <line x1="-9" y1="-12" x2="20" y2="18" />
          </g>

          {/* Calendar with a confirmed booking check — bottom-right */}
          <g transform="translate(340,656)">
            <rect x="-22" y="-14" width="44" height="38" rx="6" />
            <line x1="-10" y1="-20" x2="-10" y2="-10" />
            <line x1="12" y1="-20" x2="12" y2="-10" />
            <line x1="-22" y1="-2" x2="22" y2="-2" />
            <path d="M-10 10 L-2 18 L14 2" />
          </g>

          {/* Small leaf accents, top-left and bottom-left corners */}
          <g transform="translate(18,18) rotate(20)">
            <path d="M0 22 C4 6 20 0 30 4 C26 18 12 26 0 22 Z" />
            <line x1="2" y1="19" x2="24" y2="6" />
          </g>
          <g transform="translate(16,760) rotate(-10)">
            <path d="M0 22 C4 6 20 0 30 4 C26 18 12 26 0 22 Z" />
            <line x1="2" y1="19" x2="24" y2="6" />
          </g>
        </g>
      </svg>
    </div>
  );
}
