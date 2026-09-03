// Light, static (non-animated — "ثابتة") decorative background for the
// home screen. Rendered exactly once, unconditionally, and never remounted
// by page.tsx's own phase changes (intro -> revealing -> home) — it is the
// one constant layer every phase sits in front of, matching the user's
// explicit ask that this stays "الخلفية الدائمة والمستمرة في كل مراحل
// التطبيق خلف الخيارات" (the permanent, continuous background behind the
// clickable options throughout every phase).
//
// After an earlier attempt recreated the user's uploaded reference image
// as hand-drawn SVG icons (this session has no image-editing/inpainting
// tool, so the comb/stethoscope swap and recolor were done as vector
// icons instead of pixel edits), the user asked to use the actual
// uploaded photo itself, unedited, in the same persistent-backdrop role —
// saved as public/brand/backdrop-tools.jpg (1024x1536, 43KB — already
// small, no further compression needed) and rendered here with
// object-fit: cover so it fills any phone viewport without distortion,
// cropping only the outer edges rather than stretching.
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
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/backdrop-tools.jpg"
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
      />
    </div>
  );
}
